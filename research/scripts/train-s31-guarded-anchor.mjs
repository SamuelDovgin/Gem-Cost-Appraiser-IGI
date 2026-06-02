#!/usr/bin/env node
/**
 * Train S31 — guarded monotone anchor over S28 v0.4.
 *
 * S31 deliberately stops before a residual model:
 *   log($/ct) = S28 surface + support-shrunk anchor offset
 *
 * Anchor grids are projected so displayed $/ct remains nondecreasing in carat
 * and nonincreasing as color/clarity ranks worsen.
 */

import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { starsgemNorm, starsgemCaratBucket } from './starsgem-ml-predict.mjs';
import { predictS28 } from './s28-predict.mjs';
import { predictS31, s31PredictionInput, s31Shape, s31CutTier, S31_COLORS, S31_CLARITIES } from './s31-predict.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DATA = path.join(ROOT, 'research/data');
const OUT_MODEL = path.join(DATA, 'starsgem-ml-model-s31-guarded-anchor.json');
const OUT_BENCH = path.join(DATA, 'benchmark-s31-guarded-anchor.json');

const K_PRIOR = 8;
const MAX_ABS_OFFSET = 0.32;
const HOLDOUT_MOD = 5;
const CELL_HOLDOUT_MOD = 5;

const CARAT_BANDS = [
  { lo: 1.0, hi: 1.49, label: '1.00-1.49', mid: 1.22 },
  { lo: 1.5, hi: 1.99, label: '1.50-1.99', mid: 1.72 },
  { lo: 2.0, hi: 2.99, label: '2.00-2.99', mid: 2.45 },
  { lo: 3.0, hi: 3.99, label: '3.00-3.99', mid: 3.45 },
  { lo: 4.0, hi: 4.99, label: '4.00-4.99', mid: 4.45 },
  { lo: 5.0, hi: 9.99, label: '5.00-9.99', mid: 7.25 },
  { lo: 10.0, hi: 99.99, label: '10.00+', mid: 12.0 },
];

function loadJson(name) {
  return JSON.parse(readFileSync(path.join(DATA, name), 'utf8'));
}

const allRowsRaw = loadJson('dataset-clean-training.json');
const s28Model = loadJson('starsgem-ml-model-s28-monotone-parametric.json');
const intel = loadJson('starsgem-pricing-intelligence.json');

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

function benchmarkCellKey(row) {
  return [
    String(row.shape_style || row.shape || 'round_standard').trim().toLowerCase(),
    starsgemNorm(row.color),
    starsgemNorm(row.clarity),
    caratBand(Number(row.carat)),
  ].join('||');
}

function normalizeRow(row) {
  const carat = Number(row.carat);
  const price = Number(row.price);
  if (!Number.isFinite(carat) || carat <= 0 || !Number.isFinite(price) || price <= 0) return null;
  const color = starsgemNorm(row.color);
  const clarity = starsgemNorm(row.clarity);
  if (!S31_COLORS.includes(color) || !S31_CLARITIES.includes(clarity)) return null;
  const input = s31PredictionInput(row);
  const base = predictS28(input, s28Model);
  if (!base?.upc) return null;
  return {
    ...row,
    carat,
    price,
    upc: price / carat,
    shape_style: String(row.shape_style || row.shape || 'round_standard').trim().toLowerCase(),
    color,
    clarity,
    cutTier: s31CutTier(input),
    band: caratBand(carat),
    s28LogUpc: Math.log(base.upc),
    residual: Math.log(price / carat) - Math.log(base.upc),
  };
}

const allRows = allRowsRaw.map(normalizeRow).filter(Boolean);

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

function groupOffsets(rows) {
  const groups = new Map();
  const add = (key, value) => {
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(value);
  };
  for (const row of rows) {
    const s = row.shape_style;
    const c = row.color;
    const cl = row.clarity;
    const b = row.band;
    const t = row.cutTier;
    const r = row.residual;
    add(`global||ALL||${c}||${cl}`, r);
    add(`global||ALL||${c}||${cl}||${b}`, r);
    add(`${s}||ALL||${c}||${cl}`, r);
    add(`${s}||ALL||${c}||${cl}||${b}`, r);
    add(`${s}||${t}||${c}||${cl}`, r);
    add(`${s}||${t}||${c}||${cl}||${b}`, r);
  }
  const stats = new Map();
  for (const [key, vals] of groups) {
    stats.set(key, { n: vals.length, median: median(vals) });
  }
  return stats;
}

function shrunkOffset(stats, keys) {
  let prior = 0;
  for (const key of keys) {
    const hit = stats.get(key);
    if (!hit?.n) continue;
    const w = hit.n / (hit.n + K_PRIOR);
    prior = w * hit.median + (1 - w) * prior;
  }
  return clamp(prior, -MAX_ABS_OFFSET, MAX_ABS_OFFSET);
}

const s28LogAtCache = new Map();

function s28LogAt(shape, tier, color, clarity, carat) {
  const cacheKey = `${shape}||${tier}||${color}||${clarity}||${carat}`;
  if (s28LogAtCache.has(cacheKey)) return s28LogAtCache.get(cacheKey);
  const out = predictS28({
    carat,
    Carat: carat,
    shape_style: shape === '_global' ? 'round_standard' : shape,
    Shape_Style: shape === '_global' ? 'round_standard' : shape,
    color,
    Color: color,
    clarity,
    Clarity: clarity,
    cut_raw: tier === 'A' ? 'EX' : '-',
    Cut: tier === 'A' ? 'EX' : '-',
    polish: 'EX',
    symmetry: 'EX',
    typeName: 'CVD',
    TypeName: 'CVD',
  }, s28Model);
  const value = Math.log(out.upc);
  s28LogAtCache.set(cacheKey, value);
  return value;
}

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

function projectCube(cube) {
  const C = S31_COLORS.length;
  const L = S31_CLARITIES.length;
  const B = CARAT_BANDS.length;
  for (let iter = 0; iter < 30; iter++) {
    for (let c = 0; c < C; c++) for (let l = 0; l < L; l++) {
      const vals = CARAT_BANDS.map((_, b) => cube[c][l][b]);
      const projected = pavIncreasing(vals);
      for (let b = 0; b < B; b++) cube[c][l][b] = projected[b];
    }
    for (let l = 0; l < L; l++) for (let b = 0; b < B; b++) {
      const vals = S31_COLORS.map((_, c) => -cube[c][l][b]);
      const projected = pavIncreasing(vals).map((v) => -v);
      for (let c = 0; c < C; c++) cube[c][l][b] = projected[c];
    }
    for (let c = 0; c < C; c++) for (let b = 0; b < B; b++) {
      const vals = S31_CLARITIES.map((_, l) => -cube[c][l][b]);
      const projected = pavIncreasing(vals).map((v) => -v);
      for (let l = 0; l < L; l++) cube[c][l][b] = projected[l];
    }
  }
}

function buildArtifact(trainRows) {
  const stats = groupOffsets(trainRows);
  const shapes = [...new Set(trainRows.map((r) => r.shape_style))].sort();
  const gridIds = [];
  for (const shape of ['_global', ...shapes]) {
    for (const tier of ['ALL', 'A', 'B']) gridIds.push(`${shape}||${tier}`);
  }

  const anchorGrids = {};
  const anchorLogUpcGrids = {};
  for (const id of gridIds) {
    const [shape, tier] = id.split('||');
    const cube = S31_COLORS.map((color) => S31_CLARITIES.map((clarity) => CARAT_BANDS.map((band) => {
      const keys = [
        `global||ALL||${color}||${clarity}`,
        `global||ALL||${color}||${clarity}||${band.label}`,
      ];
      if (shape !== '_global') {
        keys.push(`${shape}||ALL||${color}||${clarity}`);
        keys.push(`${shape}||ALL||${color}||${clarity}||${band.label}`);
        if (tier !== 'ALL') {
          keys.push(`${shape}||${tier}||${color}||${clarity}`);
          keys.push(`${shape}||${tier}||${color}||${clarity}||${band.label}`);
        }
      }
      return s28LogAt(shape, tier, color, clarity, band.mid) + shrunkOffset(stats, keys);
    })));
    projectCube(cube);
    anchorGrids[id] = {};
    anchorLogUpcGrids[id] = {};
    for (let c = 0; c < S31_COLORS.length; c++) {
      const color = S31_COLORS[c];
      anchorGrids[id][color] = {};
      anchorLogUpcGrids[id][color] = {};
      for (let l = 0; l < S31_CLARITIES.length; l++) {
        const clarity = S31_CLARITIES[l];
        anchorLogUpcGrids[id][color][clarity] = CARAT_BANDS.map((_, b) => +cube[c][l][b].toFixed(6));
        anchorGrids[id][color][clarity] = CARAT_BANDS.map((band, b) => {
          const offset = cube[c][l][b] - s28LogAt(shape, tier, color, clarity, band.mid);
          return +clamp(offset, -MAX_ABS_OFFSET, MAX_ABS_OFFSET).toFixed(6);
        });
      }
    }
  }

  return {
    generatedDate: new Date().toISOString().slice(0, 10),
    modelName: 'S31 — guarded monotone anchor over S28',
    modelVersion: 's31-guarded-anchor-v0.2-projected-total-grid',
    targetType: 'surface_plus_monotone_anchor',
    surfaceModel: s28Model,
    colors: S31_COLORS,
    clarities: S31_CLARITIES,
    caratBands: CARAT_BANDS,
    hyperparameters: { kPrior: K_PRIOR, maxAbsOffset: MAX_ABS_OFFSET },
    anchorGrids,
    anchorLogUpcGrids,
  };
}

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

function metric(records, key) {
  const apes = [];
  const signed = [];
  for (const r of records) {
    const pred = r[key];
    if (!Number.isFinite(pred) || pred <= 0) continue;
    apes.push(Math.abs(pred - r.actual) / r.actual * 100);
    signed.push((pred - r.actual) / r.actual * 100);
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

function evaluate(rows, model, trainRows) {
  const support = new Map();
  for (const r of trainRows) support.set(benchmarkCellKey(r), (support.get(benchmarkCellKey(r)) || 0) + 1);
  const records = [];
  for (const row of rows) {
    const input = s31PredictionInput(row);
    const s31 = predictS31(input, model);
    const s28 = predictS28(input, s28Model);
    const s26 = s26LookupPrediction(row);
    records.push({
      actual: row.price,
      s31: s31?.price ?? null,
      s28: s28?.price ?? null,
      s26: s26?.price ?? null,
      supportTier: supportTier(support.get(benchmarkCellKey(row)) || 0),
      band: row.band,
      shape: row.shape_style,
    });
  }
  const byTier = {};
  for (const tier of ['dense', 'medium', 'sparse', 'empty']) {
    const subset = records.filter((r) => r.supportTier === tier);
    byTier[tier] = { n: subset.length, s31: metric(subset, 's31'), s28: metric(subset, 's28'), s26: metric(subset, 's26') };
  }
  return {
    n: records.length,
    s31: metric(records, 's31'),
    s28: metric(records, 's28'),
    s26: metric(records, 's26'),
    bySupportTier: byTier,
  };
}

function monotonicityScan(model) {
  const sweep = [1, 1.5, 2, 3, 4, 5, 7, 10, 15, 20, 30];
  let caratViolations = 0;
  for (const color of S31_COLORS) for (const clarity of S31_CLARITIES) {
    const vals = sweep.map((carat) => predictS31({
      carat,
      shape_style: 'round_standard',
      color,
      clarity,
      cut_raw: 'EX',
      polish: 'EX',
      symmetry: 'EX',
      typeName: 'CVD',
    }, model)?.upc ?? null);
    for (let i = 1; i < vals.length; i++) {
      if (vals[i] + 1e-6 < vals[i - 1]) {
        caratViolations++;
        break;
      }
    }
  }
  let colorViolations = 0;
  for (const clarity of S31_CLARITIES) for (const carat of [1, 2, 3, 5, 10]) {
    const vals = S31_COLORS.map((color) => predictS31({ carat, shape_style: 'round_standard', color, clarity, cut_raw: 'EX', polish: 'EX', symmetry: 'EX', typeName: 'CVD' }, model)?.upc ?? null);
    for (let i = 1; i < vals.length; i++) if (vals[i] > vals[i - 1] + 1e-6) colorViolations++;
  }
  let clarityViolations = 0;
  for (const color of S31_COLORS) for (const carat of [1, 2, 3, 5, 10]) {
    const vals = S31_CLARITIES.map((clarity) => predictS31({ carat, shape_style: 'round_standard', color, clarity, cut_raw: 'EX', polish: 'EX', symmetry: 'EX', typeName: 'CVD' }, model)?.upc ?? null);
    for (let i = 1; i < vals.length; i++) if (vals[i] > vals[i - 1] + 1e-6) clarityViolations++;
  }
  return {
    caratSpecs: S31_COLORS.length * S31_CLARITIES.length,
    caratViolatingSpecs: caratViolations,
    colorViolations,
    clarityViolations,
  };
}

const rowTrain = allRows.filter((r) => reportHash(r) % HOLDOUT_MOD !== 0);
const rowHoldout = allRows.filter((r) => reportHash(r) % HOLDOUT_MOD === 0);
const heldoutCellRows = allRows.filter((r) => cellHash(benchmarkCellKey(r)) % CELL_HOLDOUT_MOD === 0);
const heldoutCellTrain = allRows.filter((r) => cellHash(benchmarkCellKey(r)) % CELL_HOLDOUT_MOD !== 0);

const rowModel = buildArtifact(rowTrain);
const cellModel = buildArtifact(heldoutCellTrain);
const fullModel = buildArtifact(allRows);

const report = {
  date: new Date().toISOString().slice(0, 10),
  model: fullModel.modelVersion,
  decision: 'research-only: monotonicity passes, but it must match S26 dense accuracy and beat S28 on held-out cells before production',
  rowHoldout: evaluate(rowHoldout, rowModel, rowTrain),
  heldOutCells: evaluate(heldoutCellRows, cellModel, heldoutCellTrain),
  monotonicity: monotonicityScan(fullModel),
};

fullModel.metrics = {
  rowHoldout: report.rowHoldout,
  heldOutCells: report.heldOutCells,
  monotonicity: report.monotonicity,
};

writeFileSync(OUT_MODEL, `${JSON.stringify(fullModel, null, 2)}\n`);
writeFileSync(OUT_BENCH, `${JSON.stringify(report, null, 2)}\n`);

console.log('S31 guarded anchor');
console.log(`  row holdout:  S31 ${report.rowHoldout.s31.mape}% | S28 ${report.rowHoldout.s28.mape}% | S26 ${report.rowHoldout.s26.mape}%`);
console.log(`  heldout cell: S31 ${report.heldOutCells.s31.mape}% | S28 ${report.heldOutCells.s28.mape}% | S26 ${report.heldOutCells.s26.mape}%`);
console.log(`  monotonicity: carat ${report.monotonicity.caratViolatingSpecs}/${report.monotonicity.caratSpecs}, color ${report.monotonicity.colorViolations}, clarity ${report.monotonicity.clarityViolations}`);
console.log(`Wrote ${path.relative(ROOT, OUT_MODEL)}`);
console.log(`Wrote ${path.relative(ROOT, OUT_BENCH)}`);
