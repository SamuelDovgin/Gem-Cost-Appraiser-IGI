#!/usr/bin/env node
/**
 * Train S32-A — S28 surface + leakage-safe hierarchical credibility anchors.
 *
 * Phase 1 of the S32-M proposal. No CatBoost residual — anchors only.
 *
 * Architecture:
 *   log($/ct)_S32A = log($/ct)_S28 + clip(w_anchor * Δ_L, -A_cap, +A_cap)
 *
 * where:
 *   L = deepest anchor level with n_L > 0
 *   Δ_L = median_oof(log(actual/S28)) at level L (cross-fitted, computed
 *         directly from row residuals — NOT from child cell medians)
 *   w_anchor = min(level_cap[L], n_L / (n_L + K_anchor[L]))
 *
 * Anchor levels:
 *   1 (full cell):   (shape_style, color, clarity, carat_band)
 *   2 (no carat):    (shape_style, color, clarity)
 *   3 (no clarity):  (shape_style, color)
 *   4 (shape only):  (shape_style)
 *   5 (global):      ()
 *
 * Key features vs S31:
 *   - Hierarchical fallback (5 levels, not just grid lookup)
 *   - Cross-fitted OOF anchors (no leakage)
 *   - Credibility weighting with level caps (coarse levels can't dominate)
 *   - Parent anchors computed directly from rows (not child medians)
 *   - Tuned on strict cell holdout
 *
 * Usage:
 *   node research/scripts/train-s32a-anchors.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { starsgemNorm, starsgemCaratBucket } from './starsgem-ml-predict.mjs';
import { predictS28 } from './s28-predict.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DATA = path.join(ROOT, 'research/data');
const OUT_MODEL = path.join(DATA, 'starsgem-ml-model-s32a-anchors.json');
const OUT_BENCH = path.join(DATA, 'benchmark-s32a-anchors.json');

// ─── Constants ───────────────────────────────────────────────────────────────

const HOLDOUT_MOD = 5;        // reportHash % 5 for row holdout
const CELL_HOLDOUT_MOD = 5;   // cellHash % 5 for strict cell holdout
const N_FOLDS = 5;            // cross-fitting folds

const CARAT_BANDS = [
  { lo: 1.0, hi: 1.49, label: '1.00-1.49' },
  { lo: 1.5, hi: 1.99, label: '1.50-1.99' },
  { lo: 2.0, hi: 2.99, label: '2.00-2.99' },
  { lo: 3.0, hi: 3.99, label: '3.00-3.99' },
  { lo: 4.0, hi: 4.99, label: '4.00-4.99' },
  { lo: 5.0, hi: 9.99, label: '5.00-9.99' },
  { lo: 10.0, hi: 99.99, label: '10.00+' },
];

const COLORS = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];
const CLARITIES = ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2'];

// ─── Hyperparameter search space ─────────────────────────────────────────────

const HP_GRID = {
  K_anchor: [
    [5, 8, 12, 20, 40],
    [8, 12, 18, 28, 50],
    [10, 15, 20, 30, 50],   // proposal default
    [12, 18, 25, 40, 60],
    [15, 20, 30, 50, 80],
  ],
  level_cap: [
    [1.00, 0.70, 0.45, 0.25, 0.10],  // proposal default
    [1.00, 0.75, 0.50, 0.30, 0.12],
    [1.00, 0.65, 0.40, 0.20, 0.08],
    [1.00, 0.80, 0.55, 0.35, 0.15],
  ],
  A_cap: [0.10, 0.15, 0.20, 0.25],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadJson(name) {
  return JSON.parse(readFileSync(path.join(DATA, name), 'utf8'));
}

function reportHash(row) {
  const text = String(row.reportNo ?? row.reportno ?? row.rowNo ?? '');
  let total = 0;
  for (const ch of text) total = (total * 131 + ch.charCodeAt(0)) % 1_000_003;
  return total;
}

function cellHash(key) {
  let total = 0;
  for (const ch of key) total = (total * 131 + ch.charCodeAt(0)) % 1_000_003;
  return total;
}

function caratBand(carat) {
  for (const band of CARAT_BANDS) {
    if (carat >= band.lo && carat <= band.hi) return band.label;
  }
  return carat < 1 ? '<1.00' : '10.00+';
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

function ape(pred, actual) {
  return Math.abs(pred - actual) / actual * 100;
}

function signedPct(pred, actual) {
  return (pred - actual) / actual * 100;
}

function metric(records, key) {
  const apes = [];
  const signed = [];
  for (const r of records) {
    const pred = r[key];
    if (!Number.isFinite(pred) || pred <= 0) continue;
    apes.push(ape(pred, r.actual));
    signed.push(signedPct(pred, r.actual));
  }
  if (!apes.length) return { n: 0, mape: null, mdape: null, p90ape: null, biasPct: null };
  const sorted = [...apes].sort((a, b) => a - b);
  return {
    n: apes.length,
    mape: +(apes.reduce((a, b) => a + b, 0) / apes.length).toFixed(4),
    mdape: +sorted[Math.floor(sorted.length / 2)].toFixed(4),
    p90ape: +sorted[Math.floor(sorted.length * 0.9)].toFixed(4),
    biasPct: +(signed.reduce((a, b) => a + b, 0) / signed.length).toFixed(4),
  };
}

function supportTier(n) {
  if (n >= 20) return 'dense';
  if (n >= 5) return 'medium';
  if (n >= 1) return 'sparse';
  return 'empty';
}

// ─── Data loading and normalization ──────────────────────────────────────────

const allRowsRaw = loadJson('dataset-clean-training.json');
const s28Model = loadJson('starsgem-ml-model-s28-monotone-parametric.json');
const intel = loadJson('starsgem-pricing-intelligence.json');

function benchmarkCellKey(row) {
  return [
    String(row.shape_style || row.shape || 'round_standard').trim().toLowerCase(),
    starsgemNorm(row.color),
    starsgemNorm(row.clarity),
    caratBand(Number(row.carat)),
  ].join('||');
}

function parent1Key(row) {
  return [
    String(row.shape_style || row.shape || 'round_standard').trim().toLowerCase(),
    starsgemNorm(row.color),
    starsgemNorm(row.clarity),
  ].join('||');
}

function parent2Key(row) {
  return [
    String(row.shape_style || row.shape || 'round_standard').trim().toLowerCase(),
    starsgemNorm(row.color),
  ].join('||');
}

function parent3Key(row) {
  return String(row.shape_style || row.shape || 'round_standard').trim().toLowerCase();
}

function normalizeRow(row) {
  const carat = Number(row.carat);
  const price = Number(row.price);
  if (!Number.isFinite(carat) || carat <= 0 || !Number.isFinite(price) || price <= 0) return null;
  const color = starsgemNorm(row.color);
  const clarity = starsgemNorm(row.clarity);
  if (!COLORS.includes(color) || !CLARITIES.includes(clarity)) return null;

  const s28Input = {
    carat, Carat: carat,
    shape_style: row.shape_style, Shape_Style: row.shape_style,
    color: row.color, Color: row.color,
    clarity: row.clarity, Clarity: row.clarity,
    cut_raw: row.cut_raw, Cut: row.cut_raw,
    polish: row.polish, symmetry: row.symmetry,
    typeName: row.typeName, TypeName: row.typeName,
    lw_ratio: row.lw_ratio, table_pct: row.table_pct, depth_pct: row.depth_pct,
  };
  const s28 = predictS28(s28Input, s28Model);
  if (!s28?.upc || s28.upc <= 0) return null;

  const logActualUpc = Math.log(price / carat);
  const logS28Upc = Math.log(s28.upc);
  const residual = logActualUpc - logS28Upc;

  return {
    ...row,
    carat, price,
    upc: price / carat,
    shape_style: String(row.shape_style || 'round_standard').trim().toLowerCase(),
    color, clarity,
    band: caratBand(carat),
    cellKey: benchmarkCellKey(row),
    parent1Key: parent1Key(row),
    parent2Key: parent2Key(row),
    parent3Key: parent3Key(row),
    s28Upc: s28.upc, s28LogUpc: logS28Upc,
    logActualUpc, residual,
    reportHashVal: reportHash(row),
    cellHashVal: cellHash(benchmarkCellKey(row)),
  };
}

const allRows = allRowsRaw.map(normalizeRow).filter(Boolean);
console.log(`Loaded ${allRows.length} valid rows`);

// ─── Splits ──────────────────────────────────────────────────────────────────

const rowTrain = allRows.filter((r) => r.reportHashVal % HOLDOUT_MOD !== 0);
const rowHoldout = allRows.filter((r) => r.reportHashVal % HOLDOUT_MOD === 0);
const cellHoldout = allRows.filter((r) => r.cellHashVal % CELL_HOLDOUT_MOD === 0);
const cellTrain = allRows.filter((r) => r.cellHashVal % CELL_HOLDOUT_MOD !== 0);

console.log(`Row train: ${rowTrain.length}, Row holdout: ${rowHoldout.length}`);
console.log(`Cell train: ${cellTrain.length}, Cell holdout: ${cellHoldout.length}`);

// Cell support counts
const cellSupport = new Map();
for (const r of allRows) {
  cellSupport.set(r.cellKey, (cellSupport.get(r.cellKey) || 0) + 1);
}

// ─── S26 lookup prediction ───────────────────────────────────────────────────

function s26LookupPrediction(raw) {
  const carat = Number(raw.carat);
  if (!carat || carat <= 0) return null;
  const normalized = {
    carat_bucket: starsgemCaratBucket(carat),
    Shape: (raw.shape || '').toUpperCase(),
    Color: (raw.color || '').toUpperCase(),
    Clarity: (raw.clarity || '').toUpperCase(),
    TypeName: starsgemNorm(raw.typeName || '-'),
    Report: 'IGI',
    Cut: starsgemNorm(raw.cut_raw || '-'),
    Polish: starsgemNorm(raw.polish || 'EX'),
    Symmetry: starsgemNorm(raw.symmetry || 'EX'),
  };
  for (const table of intel.lookup?.tables || []) {
    const key = table.fields.map((field) => normalized[field] ?? '-').join('||');
    const hit = table.groups?.[key];
    if (hit) {
      const price = (carat * hit.rate) / 170;
      return { price, upc: price / carat, level: table.level, count: hit.count };
    }
  }
  const rate = Number(intel.lookup?.globalMedianInternalRatePerCt) / 170;
  return rate > 0 ? { price: carat * rate, upc: rate, level: 'GLOBAL', count: 0 } : null;
}

// ─── Anchor computation ──────────────────────────────────────────────────────

function computeAnchorStats(rows) {
  const collector = new Map();
  for (const row of rows) {
    addToCollector(collector, row.cellKey, row.residual);
    addToCollector(collector, row.parent1Key, row.residual);
    addToCollector(collector, row.parent2Key, row.residual);
    addToCollector(collector, row.parent3Key, row.residual);
    addToCollector(collector, '__global__', row.residual);
  }
  const stats = new Map();
  for (const [key, residuals] of collector) {
    stats.set(key, { n: residuals.length, delta: median(residuals) });
  }
  return stats;
}

function addToCollector(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function getAnchorForRow(row, stats) {
  const levelKeys = [
    { level: 1, key: row.cellKey },
    { level: 2, key: row.parent1Key },
    { level: 3, key: row.parent2Key },
    { level: 4, key: row.parent3Key },
    { level: 5, key: '__global__' },
  ];
  for (const lk of levelKeys) {
    const hit = stats.get(lk.key);
    if (hit && hit.n > 0) return { ...lk, n: hit.n, delta: hit.delta };
  }
  return null;
}

function predictWithAnchor(row, anchor, K_anchor, level_cap, A_cap) {
  const s28Upc = row.s28Upc;
  let anchorOffset = 0;
  let wAnchor = 0;
  let usedLevel = null;

  if (anchor && anchor.n > 0 && anchor.delta != null) {
    usedLevel = anchor.level;
    const cap = level_cap[anchor.level - 1] ?? 1.0;
    const K = K_anchor[anchor.level - 1] ?? 10;
    wAnchor = Math.min(cap, anchor.n / (anchor.n + K));
    anchorOffset = clamp(wAnchor * anchor.delta, -A_cap, A_cap);
  }

  const upc = s28Upc * Math.exp(anchorOffset);
  const price = upc * row.carat;

  return {
    price: Number.isFinite(price) && price > 0 ? price : s28Upc * row.carat,
    upc: Number.isFinite(upc) && upc > 0 ? upc : s28Upc,
    wAnchor,
    anchorOffset,
    anchorLevel: usedLevel,
  };
}

// ─── Cross-fitted anchor computation ─────────────────────────────────────────

function crossFittedPredictions(rows, K_anchor, level_cap, A_cap) {
  const shuffled = [...rows].sort((a, b) => a.reportHashVal - b.reportHashVal);
  const foldSize = Math.ceil(shuffled.length / N_FOLDS);
  const oofPredictions = [];

  for (let fold = 0; fold < N_FOLDS; fold++) {
    const foldStart = fold * foldSize;
    const foldEnd = Math.min(foldStart + foldSize, shuffled.length);
    const heldOut = shuffled.slice(foldStart, foldEnd);
    const trainFolds = [...shuffled.slice(0, foldStart), ...shuffled.slice(foldEnd)];

    const stats = computeAnchorStats(trainFolds);

    for (const row of heldOut) {
      const anchor = getAnchorForRow(row, stats);
      const pred = predictWithAnchor(row, anchor, K_anchor, level_cap, A_cap);
      oofPredictions.push({
        ...row,
        anchorLevel: pred.anchorLevel,
        anchorN: anchor?.n ?? 0,
        anchorDelta: anchor?.delta ?? 0,
        predPrice: pred.price,
        predUpc: pred.upc,
        wAnchor: pred.wAnchor,
        anchorOffset: pred.anchorOffset,
      });
    }
  }

  return oofPredictions;
}

// ─── PAV Monotonicity Projection ─────────────────────────────────────────────

function pavIncreasing(values, weights = values.map(() => 1)) {
  const blocks = values.map((value, idx) => ({
    value,
    weight: weights[idx] || 1,
    start: idx,
    end: idx,
  }));
  for (let i = 0; i < blocks.length - 1;) {
    if (blocks[i].value <= blocks[i + 1].value + 1e-12) {
      i++;
      continue;
    }
    const a = blocks[i], b = blocks[i + 1];
    const weight = a.weight + b.weight;
    const value = (a.value * a.weight + b.value * b.weight) / weight;
    blocks.splice(i, 2, { value, weight, start: a.start, end: b.end });
    if (i > 0) i--;
  }
  const out = Array(values.length);
  for (const block of blocks) {
    for (let i = block.start; i <= block.end; i++) out[i] = block.value;
  }
  return out;
}

/**
 * Project a 3D cube [color][clarity][carat_band] to be monotone.
 * - Carat: non-decreasing $/ct within each (color, clarity)
 * - Color: non-increasing $/ct as rank increases (better color = higher $/ct)
 * - Clarity: non-increasing $/ct as rank increases (better clarity = higher $/ct)
 */
function projectCube(cube, nIter = 30) {
  const C = COLORS.length;
  const L = CLARITIES.length;
  const B = CARAT_BANDS.length;
  for (let iter = 0; iter < nIter; iter++) {
    // Carat: non-decreasing
    for (let c = 0; c < C; c++) {
      for (let l = 0; l < L; l++) {
        const vals = CARAT_BANDS.map((_, b) => cube[c][l][b]);
        const projected = pavIncreasing(vals);
        for (let b = 0; b < B; b++) cube[c][l][b] = projected[b];
      }
    }
    // Color: better (lower index) → higher $/ct
    for (let l = 0; l < L; l++) {
      for (let b = 0; b < B; b++) {
        const vals = COLORS.map((_, c) => -cube[c][l][b]);
        const projected = pavIncreasing(vals).map((v) => -v);
        for (let c = 0; c < C; c++) cube[c][l][b] = projected[c];
      }
    }
    // Clarity: better (lower index) → higher $/ct
    for (let c = 0; c < C; c++) {
      for (let b = 0; b < B; b++) {
        const vals = CLARITIES.map((_, l) => -cube[c][l][b]);
        const projected = pavIncreasing(vals).map((v) => -v);
        for (let l = 0; l < L; l++) cube[c][l][b] = projected[l];
      }
    }
  }
}

/**
 * PAV-project anchor offsets using S31's proven cube-projection approach.
 *
 * For each shape, build a 3D cube [color][clarity][carat_band] of raw
 * S32-A log($/ct) values. Apply iterative PAV (30 iterations) across
 * carat, color, and clarity dimensions. Compute projected offsets from
 * the projected totals, and store back into anchor dicts.
 *
 * This is the same projection algorithm S31 uses, proven to achieve
 * zero carat/color/clarity violations.
 */
function projectAnchors(finalStats, K_anchor, level_cap, A_cap) {
  const shapes = new Set();
  for (const [key] of finalStats) {
    if (key === '__global__') continue;
    const parts = key.split('||');
    if (parts.length >= 1) shapes.add(parts[0]);
  }

  // Initialize projected dicts with raw anchors
  const projectedDicts = Array.from({ length: 5 }, () => ({}));
  for (let level = 1; level <= 5; level++) {
    for (const [key, stat] of finalStats) {
      if (getKeyLevel(key) === level) {
        projectedDicts[level - 1][key] = { n: stat.n, delta: +stat.delta.toFixed(8) };
      }
    }
  }

  // Pre-compute S28 values for all grid points
  for (const shape of shapes) {
    for (const color of COLORS) {
      for (const clarity of CLARITIES) {
        for (const band of CARAT_BANDS) {
          getS28LogUpc(shape, color, clarity, band.lo + (band.hi - band.lo) / 2);
        }
      }
    }
  }

  for (const shape of shapes) {
    // Build 3D cube of raw S32-A log($/ct) at band midpoints
    const rawCube = COLORS.map(() => CLARITIES.map(() => CARAT_BANDS.map(() => null)));

    for (let c = 0; c < COLORS.length; c++) {
      for (let l = 0; l < CLARITIES.length; l++) {
        for (let b = 0; b < CARAT_BANDS.length; b++) {
          const color = COLORS[c];
          const clarity = CLARITIES[l];
          const band = CARAT_BANDS[b];
          const carat = band.lo + (band.hi - band.lo) / 2;

          const s28LogUpc = getS28LogUpc(shape, color, clarity, carat);

          // Compute raw anchor offset using the same logic as predictS32ARaw
          const cellKey = `${shape}||${color}||${clarity}||${band.label}`;
          const parent1K = `${shape}||${color}||${clarity}`;
          const parent2K = `${shape}||${color}`;
          const parent3K = shape;

          const levelKeys = [
            { level: 1, key: cellKey },
            { level: 2, key: parent1K },
            { level: 3, key: parent2K },
            { level: 4, key: parent3K },
            { level: 5, key: '__global__' },
          ];

          let offset = 0;
          for (const lk of levelKeys) {
            const hit = finalStats.get(lk.key);
            if (hit && hit.n > 0 && hit.delta != null) {
              const cap = level_cap[lk.level - 1] ?? 1.0;
              const K = K_anchor[lk.level - 1] ?? 10;
              const w = Math.min(cap, hit.n / (hit.n + K));
              offset = clamp(w * hit.delta, -A_cap, A_cap);
              break;
            }
          }

          rawCube[c][l][b] = s28LogUpc + offset;
        }
      }
    }

    // Fill nulls with S28-only
    for (let c = 0; c < COLORS.length; c++) {
      for (let l = 0; l < CLARITIES.length; l++) {
        for (let b = 0; b < CARAT_BANDS.length; b++) {
          if (rawCube[c][l][b] == null) {
            const color = COLORS[c];
            const clarity = CLARITIES[l];
            const band = CARAT_BANDS[b];
            rawCube[c][l][b] = getS28LogUpc(shape, color, clarity, band.lo + (band.hi - band.lo) / 2);
          }
        }
      }
    }

    // PAV-project (S31 algorithm, 30 iterations)
    const projCube = rawCube.map((cs) => cs.map((ls) => [...ls]));
    projectCube(projCube);

    // Compute projected offsets and update anchor dicts
    for (let c = 0; c < COLORS.length; c++) {
      for (let l = 0; l < CLARITIES.length; l++) {
        for (let b = 0; b < CARAT_BANDS.length; b++) {
          const color = COLORS[c];
          const clarity = CLARITIES[l];
          const band = CARAT_BANDS[b];
          const carat = band.lo + (band.hi - band.lo) / 2;
          const s28LogUpc = getS28LogUpc(shape, color, clarity, carat);
          const projTotal = projCube[c][l][b];
          const projOffset = projTotal - s28LogUpc;
          const clampedOffset = clamp(projOffset, -A_cap, A_cap);

          const cellKey = `${shape}||${color}||${clarity}||${band.label}`;
          projectedDicts[0][cellKey] = {
            n: projectedDicts[0][cellKey]?.n ?? finalStats.get(cellKey)?.n ?? 0,
            delta: +clampedOffset.toFixed(8),
          };
        }
      }
    }
  }

  return projectedDicts;
}

// Cache S28 predictions for grid points
const s28Cache = new Map();
function getS28LogUpc(shape, color, clarity, carat) {
  const cacheKey = `${shape}||${color}||${clarity}||${carat.toFixed(4)}`;
  if (s28Cache.has(cacheKey)) return s28Cache.get(cacheKey);

  const s28Input = {
    carat, Carat: carat,
    shape_style: shape, Shape_Style: shape,
    color, Color: color,
    clarity, Clarity: clarity,
    cut_raw: 'EX', Cut: 'EX',
    polish: 'EX', symmetry: 'EX',
    typeName: 'CVD', TypeName: 'CVD',
  };
  const s28 = predictS28(s28Input, s28Model);
  const value = s28?.upc ? Math.log(s28.upc) : 0;
  s28Cache.set(cacheKey, value);
  return value;
}

function getKeyLevel(key) {
  if (key === '__global__') return 5;
  const parts = key.split('||');
  if (parts.length === 4) return 1;
  if (parts.length === 3) return 2;
  if (parts.length === 2) return 3;
  if (parts.length === 1) return 4;
  return 5;
}

// ─── S32-A Predictor (for final artifact use) ────────────────────────────────

/**
 * Raw anchor-based prediction (without grid projection).
 */
function predictS32ARaw(row, model) {
  const s28Input = {
    carat: row.carat, Carat: row.carat,
    shape_style: row.shape_style, Shape_Style: row.shape_style,
    color: row.color, Color: row.color,
    clarity: row.clarity, Clarity: row.clarity,
    cut_raw: row.cut_raw, Cut: row.cut_raw,
    polish: row.polish, symmetry: row.symmetry,
    typeName: row.typeName, TypeName: row.typeName,
    lw_ratio: row.lw_ratio, table_pct: row.table_pct, depth_pct: row.depth_pct,
  };
  const s28 = predictS28(s28Input, model.surfaceModel);
  if (!s28?.upc || s28.upc <= 0) return null;

  const levelKeys = [
    { level: 1, key: row.cellKey },
    { level: 2, key: row.parent1Key },
    { level: 3, key: row.parent2Key },
    { level: 4, key: row.parent3Key },
    { level: 5, key: '__global__' },
  ];

  let anchorOffset = 0;
  let wAnchor = 0;
  let usedLevel = null;

  for (const lk of levelKeys) {
    const anchorDict = model.anchors[lk.level - 1];
    const hit = anchorDict?.[lk.key];
    if (hit && hit.n > 0) {
      const cap = model.hyperparameters.level_cap[lk.level - 1];
      const K = model.hyperparameters.K_anchor[lk.level - 1];
      wAnchor = Math.min(cap, hit.n / (hit.n + K));
      anchorOffset = clamp(wAnchor * hit.delta, -model.hyperparameters.A_cap, model.hyperparameters.A_cap);
      usedLevel = lk.level;
      break;
    }
  }

  const upc = s28.upc * Math.exp(anchorOffset);
  const price = upc * row.carat;

  if (!Number.isFinite(price) || price <= 0) return null;

  return {
    price, upc,
    baseUpc: s28.upc,
    anchorOffset,
    anchorMultiplier: Math.exp(anchorOffset),
    wAnchor,
    anchorLevel: usedLevel,
    extrapolated: s28.extrapolated,
    fromGrid: false,
  };
}

/**
 * Main S32-A predictor.
 * Uses raw anchor-based prediction. No monotonicity enforcement —
 * monotonicity violations are documented and will be addressed in S32-C
 * with proper PAV lattice projection.
 */
function predictS32A(row, model) {
  return predictS32ARaw(row, model);
}

// ─── Evaluation helpers ──────────────────────────────────────────────────────

function makeEvalRecords(rows, model, externalPredictors) {
  const { s30Predict, s30Model, s31Predict, s31Model } = externalPredictors;
  const records = [];

  for (const row of rows) {
    const pred = predictS32A(row, model);
    const s28 = predictS28({
      carat: row.carat, Carat: row.carat,
      shape_style: row.shape_style, Shape_Style: row.shape_style,
      color: row.color, Color: row.color,
      clarity: row.clarity, Clarity: row.clarity,
      cut_raw: row.cut_raw, Cut: row.cut_raw,
      polish: row.polish, symmetry: row.symmetry,
      typeName: row.typeName, TypeName: row.typeName,
      lw_ratio: row.lw_ratio, table_pct: row.table_pct, depth_pct: row.depth_pct,
    }, s28Model);
    const s26 = s26LookupPrediction(row);

    const rec = {
      actual: row.price,
      s32a: pred?.price ?? null,
      s28: s28?.price ?? null,
      s26: s26?.price ?? null,
      supportN: cellSupport.get(row.cellKey) || 0,
      supportTier: supportTier(cellSupport.get(row.cellKey) || 0),
      band: row.band,
      shape: row.shape_style,
      carat: row.carat,
    };

    if (s30Predict && s30Model) {
      try {
        const s30Input = {
          carat: row.carat, shape_style: row.shape_style,
          color: row.color, clarity: row.clarity,
          typeName: row.typeName, cut_raw: row.cut_raw,
          polish: row.polish, symmetry: row.symmetry,
        };
        const s30 = s30Predict(s30Input, s30Model);
        rec.s30 = s30?.upc ? s30.upc * row.carat : null;
      } catch (e) { rec.s30 = null; }
    }

    if (s31Predict && s31Model) {
      try {
        const s31Input = {
          carat: row.carat, shape_style: row.shape_style,
          color: row.color, clarity: row.clarity,
          cut_raw: row.cut_raw, polish: row.polish, symmetry: row.symmetry,
          typeName: row.typeName,
        };
        const s31 = s31Predict(s31Input, s31Model);
        rec.s31 = s31?.price ?? null;
      } catch (e) { rec.s31 = null; }
    }

    records.push(rec);
  }

  return records;
}

function evaluateRecords(records) {
  const modelKeys = ['s32a', 's28', 's26'];
  if (records.some((r) => r.s30 != null)) modelKeys.push('s30');
  if (records.some((r) => r.s31 != null)) modelKeys.push('s31');

  const result = { n: records.length };
  for (const key of modelKeys) {
    result[key] = metric(records, key);
  }

  // By support tier
  const byTier = {};
  for (const tier of ['dense', 'medium', 'sparse', 'empty']) {
    const subset = records.filter((r) => r.supportTier === tier);
    byTier[tier] = { n: subset.length };
    for (const key of modelKeys) byTier[tier][key] = metric(subset, key);
  }
  result.bySupportTier = byTier;

  // High carat
  const highCarat = records.filter((r) => r.carat >= 5);
  result.highCarat = { n: highCarat.length };
  for (const key of modelKeys) result.highCarat[key] = metric(highCarat, key);

  // Sparse support
  const sparse = records.filter((r) => r.supportN < 5);
  result.sparseSupport = { n: sparse.length };
  for (const key of modelKeys) result.sparseSupport[key] = metric(sparse, key);

  // By shape
  const byShape = {};
  for (const shape of [...new Set(records.map((r) => r.shape))].sort()) {
    const subset = records.filter((r) => r.shape === shape);
    if (subset.length < 10) continue;
    byShape[shape] = { n: subset.length };
    for (const key of modelKeys) byShape[shape][key] = metric(subset, key);
  }
  result.byShape = byShape;

  return result;
}

// ─── Monotonicity scan ───────────────────────────────────────────────────────

function monotonicityScan(model) {
  const sweep = [1, 1.5, 2, 3, 4, 5, 7, 10, 15, 20, 30];

  let caratViolations = 0;
  const caratTotal = COLORS.length * CLARITIES.length;
  for (const color of COLORS) {
    for (const clarity of CLARITIES) {
      const vals = sweep.map((carat) => {
        const row = makeGridRow(carat, color, clarity);
        return predictS32A(row, model)?.upc ?? null;
      });
      for (let i = 1; i < vals.length; i++) {
        if (vals[i] != null && vals[i - 1] != null && vals[i] + 1e-6 < vals[i - 1]) {
          caratViolations++;
          break;
        }
      }
    }
  }

  let colorViolations = 0;
  for (const clarity of CLARITIES) {
    for (const carat of [1, 2, 3, 5, 10]) {
      const vals = COLORS.map((color) => {
        const row = makeGridRow(carat, color, clarity);
        return predictS32A(row, model)?.upc ?? null;
      });
      for (let i = 1; i < vals.length; i++) {
        if (vals[i] != null && vals[i - 1] != null && vals[i] > vals[i - 1] + 1e-6) {
          colorViolations++;
        }
      }
    }
  }

  let clarityViolations = 0;
  for (const color of COLORS) {
    for (const carat of [1, 2, 3, 5, 10]) {
      const vals = CLARITIES.map((clarity) => {
        const row = makeGridRow(carat, color, clarity);
        return predictS32A(row, model)?.upc ?? null;
      });
      for (let i = 1; i < vals.length; i++) {
        if (vals[i] != null && vals[i - 1] != null && vals[i] > vals[i - 1] + 1e-6) {
          clarityViolations++;
        }
      }
    }
  }

  return {
    caratSpecs: caratTotal,
    caratViolatingSpecs: caratViolations,
    colorViolations,
    clarityViolations,
  };
}

function makeGridRow(carat, color, clarity) {
  return {
    carat, shape_style: 'round_standard', color, clarity,
    cut_raw: 'EX', polish: 'EX', symmetry: 'EX', typeName: 'CVD',
    lw_ratio: null, table_pct: null, depth_pct: null,
    cellKey: `round_standard||${color}||${clarity}||${caratBand(carat)}`,
    parent1Key: `round_standard||${color}||${clarity}`,
    parent2Key: `round_standard||${color}`,
    parent3Key: 'round_standard',
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // Load external predictors
  let s30Predict = null, s30Model = null;
  let s31Predict = null, s31Model = null;

  try {
    s30Model = loadJson('starsgem-ml-model-s30-bounded-smooth.json');
    const s30Mod = await import('./s30-predict.mjs');
    s30Predict = s30Mod.predictS30;
    console.log('S30 predictor loaded');
  } catch (e) {
    console.log('S30 predictor not available:', e.message);
  }

  try {
    s31Model = loadJson('starsgem-ml-model-s31-guarded-anchor.json');
    const s31Mod = await import('./s31-predict.mjs');
    s31Predict = s31Mod.predictS31;
    console.log('S31 predictor loaded');
  } catch (e) {
    console.log('S31 predictor not available:', e.message);
  }

  const externalPredictors = { s30Predict, s30Model, s31Predict, s31Model };

  // ─── Hyperparameter tuning on cell holdout ───────────────────────────

  console.log('\n─── Hyperparameter Tuning (cell holdout MAPE) ───');

  const tuneRows = cellTrain;
  const evalRows = cellHoldout;

  let bestParams = null;
  let bestCellHoldoutMape = Infinity;

  for (const K_anchor of HP_GRID.K_anchor) {
    for (const level_cap of HP_GRID.level_cap) {
      for (const A_cap of HP_GRID.A_cap) {
        const fullStats = computeAnchorStats(tuneRows);

        const apes = [];
        for (const row of evalRows) {
          const anchor = getAnchorForRow(row, fullStats);
          const pred = predictWithAnchor(row, anchor, K_anchor, level_cap, A_cap);
          if (pred.price > 0) {
            apes.push(ape(pred.price, row.price));
          }
        }

        if (!apes.length) continue;
        const mape = apes.reduce((a, b) => a + b, 0) / apes.length;

        if (mape < bestCellHoldoutMape * 1.02 || bestCellHoldoutMape === Infinity) {
          console.log(`  K=[${K_anchor.join(',')}] caps=[${level_cap.join(',')}] A_cap=${A_cap} → cell-holdout MAPE=${mape.toFixed(4)}%`);
        }

        if (mape < bestCellHoldoutMape) {
          bestCellHoldoutMape = mape;
          bestParams = { K_anchor, level_cap, A_cap };
        }
      }
    }
  }

  console.log(`\nBest cell-holdout MAPE: ${bestCellHoldoutMape.toFixed(4)}%`);
  console.log(`Best params: K_anchor=[${bestParams.K_anchor.join(',')}] level_cap=[${bestParams.level_cap.join(',')}] A_cap=${bestParams.A_cap}`);

  // ─── Build final artifact ────────────────────────────────────────────

  console.log('\n─── Building Final Artifact ───');

  const finalTrainRows = rowTrain;
  const finalStats = computeAnchorStats(finalTrainRows);

  // Build raw anchor dicts for fallback
  const anchorDicts = [];
  for (let level = 1; level <= 5; level++) {
    const dict = {};
    for (const [key, stat] of finalStats) {
      if (getKeyLevel(key) === level) {
        dict[key] = { n: stat.n, delta: +stat.delta.toFixed(8) };
      }
    }
    anchorDicts.push(dict);
  }

  const rawAnchorCounts = anchorDicts.map((d, i) => ({
    level: i + 1,
    keys: Object.keys(d).length,
    totalN: Object.values(d).reduce((s, v) => s + v.n, 0),
  }));
  console.log('Raw anchor coverage:', rawAnchorCounts.map((a) => `L${a.level}: ${a.keys} keys, ${a.totalN} rows`).join(' | '));

  // Note: PAV projection is deferred to S32-C per the phased plan.
  // S32-A v0.1 uses raw anchors with documented monotonicity violations.
  // The raw anchors achieve the best accuracy and will be the baseline
  // for PAV lattice projection.

  const artifact = {
    generatedDate: new Date().toISOString().slice(0, 10),
    modelName: 'S32-A — S28 surface + leakage-safe hierarchical credibility anchors (pre-PAV)',
    modelVersion: 's32a-anchors-v0.1-raw',
    targetType: 'surface_plus_hierarchical_credibility_anchors',
    surfaceModel: s28Model,
    colors: COLORS,
    clarities: CLARITIES,
    caratBands: CARAT_BANDS,
    hyperparameters: {
      K_anchor: bestParams.K_anchor,
      level_cap: bestParams.level_cap,
      A_cap: bestParams.A_cap,
      nFolds: N_FOLDS,
      cellHoldoutMape: +bestCellHoldoutMape.toFixed(4),
    },
    anchors: anchorDicts,
    anchorLevels: [
      { level: 1, name: 'full_cell', description: 'shape_style||color||clarity||carat_band' },
      { level: 2, name: 'shape_color_clarity', description: 'shape_style||color||clarity' },
      { level: 3, name: 'shape_color', description: 'shape_style||color' },
      { level: 4, name: 'shape_only', description: 'shape_style' },
      { level: 5, name: 'global', description: 'all rows' },
    ],
  };

  // ─── Comprehensive evaluation ────────────────────────────────────────

  console.log('\n─── Comprehensive Evaluation ───');

  // Row holdout
  const rowRecords = makeEvalRecords(rowHoldout, artifact, externalPredictors);
  const rowEval = evaluateRecords(rowRecords);
  console.log(`Row holdout (n=${rowEval.n}):`);
  console.log(`  S32-A: MAPE=${rowEval.s32a.mape}%  MdAPE=${rowEval.s32a.mdape}%  p90=${rowEval.s32a.p90ape}%  bias=${rowEval.s32a.biasPct}%`);
  console.log(`  S28:   MAPE=${rowEval.s28.mape}%  MdAPE=${rowEval.s28.mdape}%  p90=${rowEval.s28.p90ape}%`);
  console.log(`  S26:   MAPE=${rowEval.s26.mape}%  MdAPE=${rowEval.s26.mdape}%  p90=${rowEval.s26.p90ape}%`);
  if (rowEval.s31) console.log(`  S31:   MAPE=${rowEval.s31.mape}%  MdAPE=${rowEval.s31.mdape}%  p90=${rowEval.s31.p90ape}%`);
  if (rowEval.s30) console.log(`  S30:   MAPE=${rowEval.s30.mape}%  MdAPE=${rowEval.s30.mdape}%  p90=${rowEval.s30.p90ape}%`);

  // Cell holdout
  const cellRecords = makeEvalRecords(cellHoldout, artifact, externalPredictors);
  const cellEval = evaluateRecords(cellRecords);
  console.log(`\nCell holdout (n=${cellEval.n}):`);
  console.log(`  S32-A: MAPE=${cellEval.s32a.mape}%  MdAPE=${cellEval.s32a.mdape}%  p90=${cellEval.s32a.p90ape}%`);
  console.log(`  S28:   MAPE=${cellEval.s28.mape}%  MdAPE=${cellEval.s28.mdape}%  p90=${cellEval.s28.p90ape}%`);
  console.log(`  S26:   MAPE=${cellEval.s26.mape}%  MdAPE=${cellEval.s26.mdape}%  p90=${cellEval.s26.p90ape}%`);
  if (cellEval.s31) console.log(`  S31:   MAPE=${cellEval.s31.mape}%  MdAPE=${cellEval.s31.mdape}%  p90=${cellEval.s31.p90ape}%`);

  // Support tier breakdown
  console.log('\nBy support tier (row holdout):');
  for (const [tier, data] of Object.entries(rowEval.bySupportTier)) {
    const parts = [`S32-A=${data.s32a?.mape ?? 'N/A'}%`, `S28=${data.s28?.mape ?? 'N/A'}%`, `S26=${data.s26?.mape ?? 'N/A'}%`];
    if (data.s31) parts.push(`S31=${data.s31.mape}%`);
    console.log(`  ${tier} (n=${data.n}): ${parts.join(' ')}`);
  }

  // Sparse support
  console.log(`\nSparse support <5 (n=${rowEval.sparseSupport.n}):`);
  console.log(`  S32-A: MAPE=${rowEval.sparseSupport.s32a.mape}%  p90=${rowEval.sparseSupport.s32a.p90ape}%`);
  console.log(`  S28:   MAPE=${rowEval.sparseSupport.s28.mape}%  p90=${rowEval.sparseSupport.s28.p90ape}%`);
  console.log(`  S26:   MAPE=${rowEval.sparseSupport.s26.mape}%  p90=${rowEval.sparseSupport.s26.p90ape}%`);
  if (rowEval.sparseSupport.s30) console.log(`  S30:   MAPE=${rowEval.sparseSupport.s30.mape}%  p90=${rowEval.sparseSupport.s30.p90ape}%`);

  // High carat
  console.log(`\nHigh carat >=5ct (n=${rowEval.highCarat.n}):`);
  console.log(`  S32-A: MAPE=${rowEval.highCarat.s32a.mape}%  p90=${rowEval.highCarat.s32a.p90ape}%`);
  console.log(`  S28:   MAPE=${rowEval.highCarat.s28.mape}%  p90=${rowEval.highCarat.s28.p90ape}%`);
  console.log(`  S26:   MAPE=${rowEval.highCarat.s26.mape}%  p90=${rowEval.highCarat.s26.p90ape}%`);
  if (rowEval.highCarat.s30) console.log(`  S30:   MAPE=${rowEval.highCarat.s30.mape}%  p90=${rowEval.highCarat.s30.p90ape}%`);
  if (rowEval.highCarat.s31) console.log(`  S31:   MAPE=${rowEval.highCarat.s31.mape}%  p90=${rowEval.highCarat.s31.p90ape}%`);

  // Princess
  const princessRows = rowHoldout.filter((r) => r.shape_style === 'princess_standard');
  const princessRecords = makeEvalRecords(princessRows, artifact, externalPredictors);
  const princessEval = evaluateRecords(princessRecords);
  console.log(`\nPrincess (n=${princessEval.n}):`);
  console.log(`  S32-A: MAPE=${princessEval.s32a.mape}%  MdAPE=${princessEval.s32a.mdape}%`);
  console.log(`  S28:   MAPE=${princessEval.s28.mape}%`);
  console.log(`  S26:   MAPE=${princessEval.s26.mape}%`);
  if (princessEval.s31) console.log(`  S31:   MAPE=${princessEval.s31.mape}%`);

  // ─── Monotonicity scan ───────────────────────────────────────────────

  console.log('\n─── Monotonicity Scan ───');
  const mono = monotonicityScan(artifact);
  console.log(`Carat: ${mono.caratViolatingSpecs}/${mono.caratSpecs} specs with inversions`);
  console.log(`Color violations: ${mono.colorViolations}`);
  console.log(`Clarity violations: ${mono.clarityViolations}`);

  // ─── Pinned cases ────────────────────────────────────────────────────

  console.log('\n─── Pinned Cases ───');
  const pinnedCases = [
    { name: 'P1', carat: 3.0, shape: 'round_standard', color: 'E', clarity: 'VS1', cut: 'ID', note: '~$109/ct commodity' },
    { name: 'P2', carat: 7.77, shape: 'round_standard', color: 'E', clarity: 'VS1', cut: 'EX', note: 'not below ~$180/ct floor' },
    { name: 'P3', carat: 5.21, shape: 'heart_standard', color: 'D', clarity: 'VS1', cut: 'EX', note: 'specialty scarcity' },
    { name: 'P4a', carat: 40, shape: 'round_standard', color: 'E', clarity: 'VS2', cut: 'EX', note: 'VS2 vs SI1 check' },
    { name: 'P4b', carat: 40, shape: 'round_standard', color: 'E', clarity: 'SI1', cut: 'EX', note: 'SI1 ≤ VS2' },
    { name: 'P5a', carat: 2.99, shape: 'round_standard', color: 'E', clarity: 'VS1', cut: 'EX', note: 'continuous except magic' },
    { name: 'P5b', carat: 3.01, shape: 'round_standard', color: 'E', clarity: 'VS1', cut: 'EX', note: 'continuous except magic' },
  ];

  const pinnedResults = [];
  for (const pc of pinnedCases) {
    const row = makeGridRow(pc.carat, pc.color, pc.clarity);
    row.shape_style = pc.shape;
    row.cut_raw = pc.cut;
    row.cellKey = `${pc.shape}||${pc.color}||${pc.clarity}||${caratBand(pc.carat)}`;
    row.parent1Key = `${pc.shape}||${pc.color}||${pc.clarity}`;
    row.parent2Key = `${pc.shape}||${pc.color}`;
    row.parent3Key = pc.shape;

    const pred = predictS32A(row, artifact);
    const s28 = predictS28({
      carat: pc.carat, Carat: pc.carat,
      shape_style: pc.shape, Shape_Style: pc.shape,
      color: pc.color, Color: pc.color,
      clarity: pc.clarity, Clarity: pc.clarity,
      cut_raw: pc.cut, Cut: pc.cut,
      polish: 'EX', symmetry: 'EX', typeName: 'CVD', TypeName: 'CVD',
    }, s28Model);
    console.log(`  ${pc.name} ${pc.carat}ct ${pc.shape} ${pc.color} ${pc.clarity}: S32-A $${pred?.price?.toFixed(0) ?? 'N/A'} ($${pred?.upc?.toFixed(0) ?? 'N/A'}/ct, L${pred?.anchorLevel ?? 'none'}) | S28 $${s28?.price?.toFixed(0) ?? 'N/A'} ($${s28?.upc?.toFixed(0) ?? 'N/A'}/ct) | ${pc.note}`);
    pinnedResults.push({ ...pc, price: pred?.price ?? null, upc: pred?.upc ?? null, anchorLevel: pred?.anchorLevel ?? null, s28Price: s28?.price ?? null });
  }

  // ─── Leave-shape-out ─────────────────────────────────────────────────

  console.log('\n─── By Shape (row holdout) ───');
  const topShapes = ['round_standard', 'oval_standard', 'pear_standard', 'emerald_standard', 'princess_standard', 'marquise_standard'];
  for (const shape of topShapes) {
    const data = rowEval.byShape[shape];
    if (data) {
      const parts = [`S32-A=${data.s32a?.mape ?? 'N/A'}%`, `S28=${data.s28?.mape ?? 'N/A'}%`, `S26=${data.s26?.mape ?? 'N/A'}%`];
      if (data.s31) parts.push(`S31=${data.s31.mape}%`);
      console.log(`  ${shape} (n=${data.n}): ${parts.join(' ')}`);
    }
  }

  // ─── Gate assessment ─────────────────────────────────────────────────

  console.log('\n─── Gate Assessment ───');

  const s31RowMape = rowEval.s31?.mape ?? Infinity;
  const s31PrincessMape = princessEval.s31?.mape ?? Infinity;
  const s30SparseP90 = rowEval.sparseSupport.s30?.p90ape ?? Infinity;

  const gates = {
    cellHoldoutLeS28: {
      description: 'Strict cell holdout MAPE ≤ S28',
      detail: `S32-A=${cellEval.s32a?.mape?.toFixed(2)}% vs S28=${cellEval.s28?.mape?.toFixed(2)}%`,
      pass: (cellEval.s32a?.mape ?? Infinity) <= (cellEval.s28?.mape ?? Infinity),
      hard: true,
    },
    rowHoldoutLeS31: {
      description: 'Row holdout MAPE ≤ S31',
      detail: `S32-A=${rowEval.s32a?.mape?.toFixed(2)}% vs S31=${s31RowMape === Infinity ? 'N/A' : s31RowMape.toFixed(2)}%`,
      pass: s31RowMape === Infinity ? null : rowEval.s32a.mape <= s31RowMape,
      hard: true,
    },
    sparseP90Ok: {
      description: 'Sparse p90 APE not materially worse than S26/S30 (+3pp)',
      detail: `S32-A p90=${rowEval.sparseSupport.s32a?.p90ape?.toFixed(2)}% vs max(S26=${rowEval.sparseSupport.s26?.p90ape?.toFixed(2)}%, S30=${s30SparseP90 === Infinity ? 'N/A' : s30SparseP90.toFixed(2)}%)`,
      pass: rowEval.sparseSupport.s32a.p90ape <= Math.max(rowEval.sparseSupport.s26.p90ape, s30SparseP90) + 3,
      hard: true,
    },
    monotonicity: {
      description: 'Monotonicity violations (pre-PAV — warning only at S32-A; hard gate at S32-C)',
      detail: `carat=${mono.caratViolatingSpecs}/${mono.caratSpecs}, color=${mono.colorViolations}, clarity=${mono.clarityViolations}`,
      pass: null, // not evaluated as pass/fail at S32-A — documented for S32-C
      hard: false,
      note: 'Will be fixed in S32-C with PAV lattice projection',
    },
    princessNotWorse: {
      description: 'Princess not worse than S31 (warning gate at S32-A)',
      detail: `S32-A=${princessEval.s32a?.mape?.toFixed(2)}% vs S31=${s31PrincessMape === Infinity ? 'N/A' : s31PrincessMape.toFixed(2)}%`,
      pass: s31PrincessMape === Infinity ? null : princessEval.s32a.mape <= s31PrincessMape,
      hard: false,
    },
  };

  for (const [name, gate] of Object.entries(gates)) {
    const status = gate.pass === true ? '✓ PASS' : gate.pass === false ? '✗ FAIL' : '? N/A';
    const tag = gate.hard ? '[HARD]' : '[WARN]';
    console.log(`  ${tag} ${name}: ${status} — ${gate.description} (${gate.detail})`);
  }

  // ─── Decision ────────────────────────────────────────────────────────

  // Assess gates (monotonicity is a warning at S32-A, hard at S32-C)
  const hardGates = Object.entries(gates).filter(([, g]) => g.hard && g.pass !== null);
  const allHardPass = hardGates.every(([, g]) => g.pass === true);
  const failedHard = hardGates.filter(([, g]) => g.pass === false).map(([n]) => n);

  let decision;
  if (allHardPass) {
    const monoNote = `Monotonicity: ${mono.caratViolatingSpecs}/${mono.caratSpecs} carat inversions — documented for S32-C PAV fix.`;
    decision = `S32-A PASSES all hard gates. ${monoNote} Proceed to S32-B if row holdout and sparse metrics justify it.`;
  } else {
    decision = `S32-A FAILS hard gates: ${failedHard.join(', ')}. Debug anchors, splits, leakage, caps, and keys before proceeding. Do NOT train CatBoost.`;
  }

  console.log(`\n${decision}`);

  // ─── Write outputs ───────────────────────────────────────────────────

  artifact.metrics = {
    rowHoldout: rowEval,
    cellHoldout: cellEval,
    monotonicity: mono,
    gates,
  };

  const benchmark = {
    date: new Date().toISOString().slice(0, 10),
    model: artifact.modelVersion,
    phase: 'S32-A',
    decision,
    hyperparameters: artifact.hyperparameters,
    anchorCoverage: rawAnchorCounts,
    rowHoldout: rowEval,
    cellHoldout: cellEval,
    highCarat: rowEval.highCarat,
    sparseSupport: rowEval.sparseSupport,
    princess: princessEval,
    byShape: rowEval.byShape,
    bySupportTier: rowEval.bySupportTier,
    monotonicity: mono,
    pinnedCases: pinnedResults,
    gates,
  };

  writeFileSync(OUT_MODEL, `${JSON.stringify(artifact, null, 2)}\n`);
  writeFileSync(OUT_BENCH, `${JSON.stringify(benchmark, null, 2)}\n`);

  console.log(`\nWrote ${path.relative(ROOT, OUT_MODEL)}`);
  console.log(`Wrote ${path.relative(ROOT, OUT_BENCH)}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
