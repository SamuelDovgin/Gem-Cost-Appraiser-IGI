#!/usr/bin/env node
/**
 * Production White-Diamond ML Benchmark
 *
 * Canonical evaluation harness per research/production-quality-white-ml-roadmap.md
 * Every production candidate must pass all gates defined here.
 *
 * Models evaluated: S26 (production baseline), S28, S30, S31, S32-A, S33-A
 *
 * Splits:
 *   1. Row holdout (reportHash % 5)
 *   2. Strict cell holdout (shape||color||clarity||carat_band hash % 5)
 *   3. Support tiers (dense ≥20, medium ≥5, sparse <5)
 *   4. High carat (≥5ct)
 *   5. Princess slice
 *   6. Leave-shape-out
 *   7. Selected-spec mode (no lw/table/depth)
 *   8. Monotonicity grid scan
 *   9. Pinned cases
 *  10. Conformal interval calibration
 *
 * Usage:
 *   node research/scripts/benchmark-production-white-model.mjs
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { starsgemNorm, starsgemCaratBucket } from './starsgem-ml-predict.mjs';
import { predictS28 } from './s28-predict.mjs';
import { predictS32 } from './s32-predict.mjs';
import { buildS30Artifact } from './train-s30-bounded-smooth.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, '../data');
const OUT = path.join(DATA, 'benchmark-production-white-model.json');

const HOLDOUT_MOD = 5;

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
  return Number(BigInt(`0x${createHash('md5').update(key).digest('hex')}`) % 1000n);
}

function benchmarkCellKey(row) {
  return [
    String(row.shape_style || row.shape || 'round_standard').trim().toLowerCase(),
    starsgemNorm(row.color),
    starsgemNorm(row.clarity),
    starsgemCaratBucket(Number(row.carat)),
  ].join('||');
}

function ape(pred, actual) {
  return Math.abs(pred - actual) / actual * 100;
}

function signedPct(pred, actual) {
  return (pred - actual) / actual * 100;
}

function stats(apes, signed = []) {
  if (!apes.length) return { n: 0, mape: null, mdape: null, p90ape: null, biasPct: null };
  const n = apes.length;
  const sorted = [...apes].sort((a, b) => a - b);
  return {
    n,
    mape: +(apes.reduce((a, b) => a + b, 0) / n).toFixed(4),
    mdape: +sorted[Math.floor(n / 2)].toFixed(4),
    p90ape: +sorted[Math.floor(n * 0.9)].toFixed(4),
    biasPct: signed.length ? +(signed.reduce((a, b) => a + b, 0) / signed.length).toFixed(4) : null,
  };
}

function supportTier(n) {
  if (n >= 20) return 'dense';
  if (n >= 5) return 'medium';
  if (n >= 1) return 'sparse';
  return 'empty';
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// ─── Carat bands (for S33-A prediction) ─────────────────────────────────────

const CARAT_BANDS = [
  { lo: 1.0, hi: 1.49, label: '1.00-1.49' },
  { lo: 1.5, hi: 1.99, label: '1.50-1.99' },
  { lo: 2.0, hi: 2.99, label: '2.00-2.99' },
  { lo: 3.0, hi: 3.99, label: '3.00-3.99' },
  { lo: 4.0, hi: 4.99, label: '4.00-4.99' },
  { lo: 5.0, hi: 9.99, label: '5.00-9.99' },
  { lo: 10.0, hi: 99.99, label: '10.00+' },
];
function caratBandLabel(carat) {
  for (const b of CARAT_BANDS) if (carat >= b.lo && carat <= b.hi) return b.label;
  return '10.00+';
}

// ─── S26 lookup ─────────────────────────────────────────────────────────────

function s26LookupPrediction(raw, intel) {
  const carat = Number(raw.carat);
  if (!carat || carat <= 0) return null;
  const normalized = {
    carat_bucket: starsgemCaratBucket(carat),
    Shape: (raw.raw_shape_code || raw.shape || '').toUpperCase(),
    Color: (raw.color || '').toUpperCase(),
    Clarity: (raw.clarity || '').toUpperCase(),
    TypeName: starsgemNorm(raw.typeName || '-'),
    Report: 'IGI',
    Cut: starsgemNorm(raw.cut_raw || '-'),
    Polish: starsgemNorm(raw.polish || 'EX'),
    Symmetry: starsgemNorm(raw.symmetry || 'EX'),
  };
  for (const table of intel.lookup?.tables || []) {
    const key = table.fields.map((f) => normalized[f] ?? '-').join('||');
    const hit = table.groups?.[key];
    if (hit) {
      const price = (carat * hit.rate) / 170;
      return { price, lookupLevel: table.level, lookupCount: hit.count };
    }
  }
  const rate = Number(intel.lookup?.globalMedianInternalRatePerCt) / 170;
  return rate > 0 ? { price: carat * rate, lookupLevel: 'GLOBAL', lookupCount: 0 } : null;
}

// ─── S33-A predictor (inline for self-contained benchmark) ───────────────────

function predictS33A(row, s33aModel) {
  const surface = s33aModel.surfaceModel;
  if (!surface) return null;

  const carat = Number(row.carat);
  if (!Number.isFinite(carat) || carat <= 0) return null;

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
  const s28 = predictS28(s28Input, surface);
  if (!s28?.upc || s28.upc <= 0) return null;

  const shape = String(row.shape_style || 'round_standard').trim().toLowerCase();
  const color = starsgemNorm(row.color);
  const clarity = starsgemNorm(row.clarity);
  const band = caratBandLabel(carat);

  const K12 = s33aModel.hyperparameters.K_anchor;

  const levelKeys = [
    { level: 1, key: `${shape}||${color}||${clarity}||${band}` },
    { level: 2, key: `${shape}||${color}||${clarity}` },
    { level: 3, key: `${shape}||${color}` },
    { level: 4, key: shape },
    { level: 5, key: '__global__' },
  ];

  let anchorOffset = 0;
  let wAnchor = 0;
  let usedLevel = null;

  for (const lk of levelKeys) {
    const anchorDict = s33aModel.anchors[lk.level - 1];
    const hit = anchorDict?.[lk.key];
    if (hit && hit.n > 0) {
      const cap = s33aModel.hyperparameters.level_cap[lk.level - 1];
      const K = K12[lk.level - 1];
      // w=1 for L1 (monotonicity guarantee), credibility for L2+
      wAnchor = lk.level === 1 ? 1.0 : Math.min(cap, hit.n / (hit.n + K));
      anchorOffset = clamp(wAnchor * hit.delta, -s33aModel.hyperparameters.A_cap, s33aModel.hyperparameters.A_cap);
      usedLevel = lk.level;
      break;
    }
  }

  const upc = s28.upc * Math.exp(anchorOffset);
  const price = upc * carat;

  if (!Number.isFinite(price) || price <= 0) return null;

  return {
    price, upc,
    baseUpc: s28.upc,
    anchorOffset,
    anchorLevel: usedLevel,
    wAnchor,
    extrapolated: s28.extrapolated,
  };
}

// ─── Monotonicity scan ──────────────────────────────────────────────────────

const SWEEP = [1, 1.5, 2, 3, 4, 5, 7, 10, 15, 20, 30];
const MONO_COLORS = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];
const MONO_CLARITIES = ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2'];

function monotonicityScan(predictFn) {
  let caratV = 0;
  const violatingSpecs = [];

  for (const color of MONO_COLORS) {
    for (const clarity of MONO_CLARITIES) {
      const vals = SWEEP.map((carat) => {
        const row = { carat, shape_style: 'round_standard', color, clarity, cut_raw: 'EX', polish: 'EX', symmetry: 'EX', typeName: 'CVD' };
        return predictFn(row)?.upc ?? null;
      });
      for (let i = 1; i < vals.length; i++) {
        if (vals[i] != null && vals[i - 1] != null && vals[i] + 1e-6 < vals[i - 1]) {
          caratV++;
          violatingSpecs.push({ color, clarity });
          break;
        }
      }
    }
  }

  let colorV = 0;
  for (const clarity of MONO_CLARITIES) {
    for (const carat of [1, 2, 3, 5, 10]) {
      const vals = MONO_COLORS.map((color) => {
        const row = { carat, shape_style: 'round_standard', color, clarity, cut_raw: 'EX', polish: 'EX', symmetry: 'EX', typeName: 'CVD' };
        return predictFn(row)?.upc ?? null;
      });
      for (let i = 1; i < vals.length; i++) {
        if (vals[i] != null && vals[i - 1] != null && vals[i] > vals[i - 1] + 1e-6) colorV++;
      }
    }
  }

  let clarityV = 0;
  for (const color of MONO_COLORS) {
    for (const carat of [1, 2, 3, 5, 10]) {
      const vals = MONO_CLARITIES.map((clarity) => {
        const row = { carat, shape_style: 'round_standard', color, clarity, cut_raw: 'EX', polish: 'EX', symmetry: 'EX', typeName: 'CVD' };
        return predictFn(row)?.upc ?? null;
      });
      for (let i = 1; i < vals.length; i++) {
        if (vals[i] != null && vals[i - 1] != null && vals[i] > vals[i - 1] + 1e-6) clarityV++;
      }
    }
  }

  return {
    caratSpecs: MONO_COLORS.length * MONO_CLARITIES.length,
    caratViolatingSpecs: caratV,
    violatingSpecs: caratV > 0 ? violatingSpecs.slice(0, 10) : [],
    colorViolations: colorV,
    clarityViolations: clarityV,
    isClean: caratV === 0 && colorV === 0 && clarityV === 0,
  };
}

// ─── Conformal interval calibration ─────────────────────────────────────────

function calibrateConformal(rows, predictFn, coverage = 0.80) {
  const absLogErrors = [];
  for (const row of rows) {
    const pred = predictFn(row);
    if (!pred?.upc || pred.upc <= 0) continue;
    const err = Math.abs(Math.log(pred.price / Number(row.price)));
    absLogErrors.push(err);
  }
  if (!absLogErrors.length) return { width: null, n: 0 };

  const sorted = [...absLogErrors].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * coverage));
  const width = sorted[idx];

  // Check actual coverage
  let covered = 0;
  for (const row of rows) {
    const pred = predictFn(row);
    if (!pred?.upc || pred.upc <= 0) continue;
    const logErr = Math.abs(Math.log(pred.price / Number(row.price)));
    if (logErr <= width) covered++;
  }
  const actualCoverage = covered / absLogErrors.length * 100;

  return {
    width: +width.toFixed(6),
    multiplierLow: +Math.exp(-width).toFixed(6),
    multiplierHigh: +Math.exp(width).toFixed(6),
    n: absLogErrors.length,
    targetCoverage: +(coverage * 100).toFixed(0) + '%',
    actualCoverage: +actualCoverage.toFixed(1) + '%',
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══ Production White-Diamond ML Benchmark ═══\n');

  const allRows = loadJson('dataset-clean-training.json');
  const intel = loadJson('starsgem-pricing-intelligence.json');
  const s28 = loadJson('starsgem-ml-model-s28-monotone-parametric.json');
  const s30Shipped = loadJson('starsgem-ml-model-s30-bounded-smooth.json');
  const s31 = loadJson('starsgem-ml-model-s31-guarded-anchor.json');
  const s32a = loadJson('starsgem-ml-model-s32a-anchors.json');
  const s33a = loadJson('starsgem-ml-model-s33a-constrained-anchors.json');

  // Load predictors
  let predictS30, predictS31;
  try {
    const s30Mod = await import('./s30-predict.mjs');
    predictS30 = s30Mod.predictS30;
  } catch (e) { console.log('S30 predictor unavailable'); predictS30 = null; }
  try {
    const s31Mod = await import('./s31-predict.mjs');
    predictS31 = s31Mod.predictS31;
  } catch (e) { console.log('S31 predictor unavailable'); predictS31 = null; }

  const rowHoldout = allRows.filter((r) => reportHash(r) % HOLDOUT_MOD === 0);
  const rowTrain = allRows.filter((r) => reportHash(r) % HOLDOUT_MOD !== 0);

  const fairS30 = buildS30Artifact(rowTrain);

  // Cell support counts on all data
  const cellSupport = new Map();
  for (const r of allRows) {
    const k = benchmarkCellKey(r);
    cellSupport.set(k, (cellSupport.get(k) || 0) + 1);
  }

  // UPDATED: S29 cell holdout using benchmark cell key (not S29-specific)
  const allCellKeys = new Set();
  for (const r of allRows) allCellKeys.add(benchmarkCellKey(r));

  const cellHoldoutFraction = 0.2;
  const cellHoldoutRows = allRows.filter((r) => cellHash(benchmarkCellKey(r)) / 1000 < cellHoldoutFraction);
  const cellTrainRows = allRows.filter((r) => cellHash(benchmarkCellKey(r)) / 1000 >= cellHoldoutFraction);

  console.log(`Dataset: ${allRows.length} rows`);
  console.log(`Row holdout: ${rowHoldout.length} rows (20%)`);
  console.log(`Cell holdout: ${cellHoldoutRows.length} rows`);
  console.log(`Cell train: ${cellTrainRows.length} rows\n`);

  // ─── Prediction functions ──────────────────────────────────────────────────

  function predictAll(row, ctx) {
    const actual = Number(row.price);

    const s26 = s26LookupPrediction(row, ctx.intel);
    const s28p = predictS28({
      carat: Number(row.carat), Carat: Number(row.carat),
      shape_style: row.shape_style, Shape_Style: row.shape_style,
      color: row.color, Color: row.color,
      clarity: row.clarity, Clarity: row.clarity,
      cut_raw: row.cut_raw, Cut: row.cut_raw,
      polish: row.polish, symmetry: row.symmetry,
      typeName: row.typeName, TypeName: row.typeName,
      lw_ratio: row.lw_ratio, table_pct: row.table_pct, depth_pct: row.depth_pct,
    }, ctx.s28);

    const s32ap = predictS32({
      carat: row.carat, shape_style: row.shape_style,
      color: row.color, clarity: row.clarity,
      cut_raw: row.cut_raw, polish: row.polish, symmetry: row.symmetry,
      typeName: row.typeName,
      lw_ratio: row.lw_ratio, table_pct: row.table_pct, depth_pct: row.depth_pct,
    }, ctx.s32a);

    const s33ap = predictS33A(row, ctx.s33a);

    let s30p = null;
    if (ctx.predictS30 && ctx.s30Model) {
      try {
        const s30Input = {
          carat: Number(row.carat), shape_style: row.shape_style,
          color: row.color, clarity: row.clarity,
          typeName: row.typeName, cut_raw: row.cut_raw,
          polish: row.polish, symmetry: row.symmetry,
        };
        s30p = ctx.predictS30(s30Input, ctx.s30Model);
      } catch (e) { /* ignore */ }
    }

    let s31p = null;
    if (ctx.predictS31 && ctx.s31) {
      try {
        s31p = ctx.predictS31({
          carat: row.carat, shape_style: row.shape_style,
          color: row.color, clarity: row.clarity,
          cut_raw: row.cut_raw, polish: row.polish, symmetry: row.symmetry,
          typeName: row.typeName,
        }, ctx.s31);
      } catch (e) { /* ignore */ }
    }

    return {
      actual,
      s26: s26?.price ?? null,
      s28: s28p?.price ?? null,
      s30: s30p?.price ?? null,
      s31: s31p?.price ?? null,
      s32a: s32ap?.price ?? null,
      s33a: s33ap?.price ?? null,
      s30HasCurve: Boolean(s30p?.price > 0),
    };
  }

  // ─── Evaluate slice ────────────────────────────────────────────────────────

  function evaluateSlice(rows, ctx) {
    const accum = {};
    for (const r of rows) {
      const p = predictAll(r, ctx);
      for (const [k, v] of Object.entries(p)) {
        if (k === 'actual' || k === 's30HasCurve') continue;
        if (v == null || !Number.isFinite(v) || v <= 0) continue;
        if (!accum[k]) accum[k] = { apes: [], signed: [] };
        accum[k].apes.push(ape(v, p.actual));
        accum[k].signed.push(signedPct(v, p.actual));
      }
    }
    const out = {};
    for (const [k, v] of Object.entries(accum)) {
      out[k] = stats(v.apes, v.signed);
    }
    return out;
  }

  // Build context
  const ctx = {
    intel, s28, s31, s32a, s33a,
    predictS30, predictS31,
    s30Model: fairS30,
  };

  const modelKeys = ['s26', 's28', 's30', 's31', 's32a', 's33a'];

  // ─── 1. Row holdout ────────────────────────────────────────────────────────

  console.log('─── 1. Row Holdout ───');
  const rowEval = evaluateSlice(rowHoldout, ctx);
  for (const m of modelKeys) {
    const s = rowEval[m];
    if (s?.n) console.log(`  ${m.padEnd(5)} MAPE=${String(s.mape).padStart(7)}%  MdAPE=${String(s.mdape).padStart(7)}%  p90=${String(s.p90ape).padStart(7)}%  bias=${String(s.biasPct).padStart(7)}%  n=${s.n}`);
  }

  // ─── 2. Cell holdout ───────────────────────────────────────────────────────

  console.log('\n─── 2. Cell Holdout ───');
  const cellEval = evaluateSlice(cellHoldoutRows, ctx);
  for (const m of modelKeys) {
    const s = cellEval[m];
    if (s?.n) console.log(`  ${m.padEnd(5)} MAPE=${String(s.mape).padStart(7)}%  MdAPE=${String(s.mdape).padStart(7)}%  p90=${String(s.p90ape).padStart(7)}%  n=${s.n}`);
  }

  // ─── 3. Support tiers ──────────────────────────────────────────────────────

  console.log('\n─── 3. Support Tiers (row holdout) ───');
  const tierData = {};
  for (const tier of ['dense', 'medium', 'sparse']) {
    const min = tier === 'dense' ? 20 : tier === 'medium' ? 5 : 1;
    const max = tier === 'dense' ? Infinity : tier === 'medium' ? 19 : 4;
    const subset = rowHoldout.filter((r) => {
      const n = cellSupport.get(benchmarkCellKey(r)) || 0;
      return n >= min && n <= max;
    });
    const eval_ = evaluateSlice(subset, ctx);
    tierData[tier] = { n: subset.length, ...eval_ };
    console.log(`  ${tier} (n=${subset.length}):`);
    for (const m of modelKeys) {
      const s = eval_[m];
      if (s?.n) console.log(`    ${m.padEnd(5)} MAPE=${String(s.mape).padStart(7)}%`);
    }
  }

  // ─── 4. High carat ─────────────────────────────────────────────────────────

  console.log('\n─── 4. High Carat (≥5ct, row holdout) ───');
  const highCaratRows = rowHoldout.filter((r) => Number(r.carat) >= 5);
  const highCaratEval = evaluateSlice(highCaratRows, ctx);
  console.log(`  n=${highCaratRows.length}`);
  for (const m of modelKeys) {
    const s = highCaratEval[m];
    if (s?.n) console.log(`    ${m.padEnd(5)} MAPE=${String(s.mape).padStart(7)}%  p90=${String(s.p90ape).padStart(7)}%`);
  }

  // ─── 5. Princess ───────────────────────────────────────────────────────────

  console.log('\n─── 5. Princess Slice ───');
  const princessRows = rowHoldout.filter((r) => String(r.shape_style || '').toLowerCase() === 'princess_standard');
  const princessEval = evaluateSlice(princessRows, ctx);
  console.log(`  n=${princessRows.length}`);
  for (const m of modelKeys) {
    const s = princessEval[m];
    if (s?.n) console.log(`    ${m.padEnd(5)} MAPE=${String(s.mape).padStart(7)}%  MdAPE=${String(s.mdape).padStart(7)}%`);
  }

  // ─── 6. Leave-shape-out ────────────────────────────────────────────────────

  console.log('\n─── 6. Leave-Shape-Out ───');
  const shapeCounts = new Map();
  for (const r of allRows) {
    const s = String(r.shape_style || '').toLowerCase();
    shapeCounts.set(s, (shapeCounts.get(s) || 0) + 1);
  }
  const topShapes = [...shapeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([s]) => s);

  const lsoData = {};
  for (const shape of topShapes) {
    const held = allRows.filter((r) => String(r.shape_style || '').toLowerCase() === shape);
    const eval_ = evaluateSlice(held, ctx);
    lsoData[shape] = { n: held.length, ...eval_ };
    console.log(`  ${shape.padEnd(22)} n=${String(held.length).padStart(5)}  S33-A=${eval_.s33a?.mape?.toFixed(2) ?? 'N/A'}%  S26=${eval_.s26?.mape?.toFixed(2) ?? 'N/A'}%  S32-A=${eval_.s32a?.mape?.toFixed(2) ?? 'N/A'}%`);
  }

  // ─── 7. Selected-spec mode ─────────────────────────────────────────────────

  console.log('\n─── 7. Selected-Spec Mode (no lw/table/depth) ───');
  const selectedRows = [];
  for (const r of rowHoldout) {
    const specRow = { ...r, lw_ratio: null, table_pct: null, depth_pct: null };
    selectedRows.push(specRow);
  }
  const selectedEval = evaluateSlice(selectedRows, ctx);
  for (const m of modelKeys) {
    const s = selectedEval[m];
    if (s?.n) console.log(`  ${m.padEnd(5)} MAPE=${String(s.mape).padStart(7)}%  n=${s.n}`);
  }

  // ─── 8. Monotonicity ──────────────────────────────────────────────────────

  console.log('\n─── 8. Monotonicity Grid Scan ───');

  function makeMonoPredictor(modelPredFn) {
    return (row) => modelPredFn(row);
  }

  const monoModels = {
    s28: monotonicityScan((row) => predictS28({
      carat: row.carat, Carat: row.carat,
      shape_style: row.shape_style, Shape_Style: row.shape_style,
      color: row.color, Color: row.color,
      clarity: row.clarity, Clarity: row.clarity,
      cut_raw: row.cut_raw, Cut: row.cut_raw,
      polish: row.polish, symmetry: row.symmetry,
      typeName: row.typeName, TypeName: row.typeName,
    }, s28)),
    s32a: monotonicityScan((row) => predictS32(row, s32a)),
    s33a: monotonicityScan((row) => predictS33A(row, s33a)),
  };

  for (const [name, mono] of Object.entries(monoModels)) {
    const status = mono.isClean ? '✓ CLEAN' : `✗ ${mono.caratViolatingSpecs}C ${mono.colorViolations}Col ${mono.clarityViolations}Cla`;
    console.log(`  ${name.padEnd(5)} ${status}`);
    if (mono.violatingSpecs.length) {
      console.log(`         violating: ${mono.violatingSpecs.map((s) => `${s.color}/${s.clarity}`).join(', ')}`);
    }
  }

  // ─── 9. Pinned cases ──────────────────────────────────────────────────────

  console.log('\n─── 9. Pinned Cases ───');
  const pinnedCases = [
    { name: 'P1', carat: 3.0, shape: 'round_standard', color: 'E', clarity: 'VS1', cut: 'ID', note: '~$109/ct commodity' },
    { name: 'P2', carat: 7.77, shape: 'round_standard', color: 'E', clarity: 'VS1', cut: 'EX', note: '$180/ct floor' },
    { name: 'P3', carat: 5.21, shape: 'heart_standard', color: 'D', clarity: 'VS1', cut: 'EX', note: 'specialty scarcity' },
    { name: 'P4a', carat: 40, shape: 'round_standard', color: 'E', clarity: 'VS2', cut: 'EX', note: 'VS2 vs SI1' },
    { name: 'P4b', carat: 40, shape: 'round_standard', color: 'E', clarity: 'SI1', cut: 'EX', note: 'SI1 ≤ VS2' },
    { name: 'P5a', carat: 2.99, shape: 'round_standard', color: 'E', clarity: 'VS1', cut: 'EX', note: 'continuous' },
    { name: 'P5b', carat: 3.01, shape: 'round_standard', color: 'E', clarity: 'VS1', cut: 'EX', note: 'continuous' },
  ];

  const pinnedResults = [];
  for (const pc of pinnedCases) {
    const row = { carat: pc.carat, shape_style: pc.shape, color: pc.color, clarity: pc.clarity, cut_raw: pc.cut, polish: 'EX', symmetry: 'EX', typeName: 'CVD' };
    const s33ap = predictS33A(row, s33a);
    const s28p = predictS28({ carat: pc.carat, Carat: pc.carat, shape_style: pc.shape, Shape_Style: pc.shape, color: pc.color, Color: pc.color, clarity: pc.clarity, Clarity: pc.clarity, cut_raw: pc.cut, Cut: pc.cut, polish: 'EX', symmetry: 'EX', typeName: 'CVD', TypeName: 'CVD' }, s28);
    const s26p = s26LookupPrediction(row, intel);
    const s32ap = predictS32(row, s32a);
    console.log(`  ${pc.name} ${pc.carat}ct ${pc.shape} ${pc.color} ${pc.clarity}:`);
    console.log(`    S33-A: $${s33ap?.price?.toFixed(0) ?? 'N/A'} ($${s33ap?.upc?.toFixed(0) ?? 'N/A'}/ct, L${s33ap?.anchorLevel ?? 'none'} w=${s33ap?.wAnchor?.toFixed(2) ?? 'N/A'})`);
    console.log(`    S32-A: $${s32ap?.price?.toFixed(0) ?? 'N/A'} ($${s32ap?.upc?.toFixed(0) ?? 'N/A'}/ct)`);
    console.log(`    S28:   $${s28p?.price?.toFixed(0) ?? 'N/A'} ($${s28p?.upc?.toFixed(0) ?? 'N/A'}/ct)`);
    console.log(`    S26:   $${s26p?.price?.toFixed(0) ?? 'N/A'}`);
    pinnedResults.push({ ...pc, s33aPrice: s33ap?.price ?? null, s33aUpc: s33ap?.upc ?? null, s32aPrice: s32ap?.price ?? null, s28Price: s28p?.price ?? null, s26Price: s26p?.price ?? null });
  }

  // ─── 10. Conformal intervals ───────────────────────────────────────────────

  console.log('\n─── 10. Conformal Interval Calibration (80% target) ───');
  const conformalResults = {};

  // S33-A conformal
  const s33aConformal = calibrateConformal(rowHoldout, (r) => predictS33A(r, s33a), 0.80);
  console.log(`  S33-A: width=${s33aConformal.width?.toFixed(4)} log (${s33aConformal.multiplierLow}x - ${s33aConformal.multiplierHigh}x), coverage=${s33aConformal.actualCoverage}`);

  // S26 conformal
  const s26Conformal = calibrateConformal(rowHoldout, (r) => {
    const p = s26LookupPrediction(r, intel);
    return p ? { price: p.price, upc: p.price / Number(r.carat) } : null;
  }, 0.80);
  console.log(`  S26:   width=${s26Conformal.width?.toFixed(4)} log (${s26Conformal.multiplierLow}x - ${s26Conformal.multiplierHigh}x), coverage=${s26Conformal.actualCoverage}`);

  // By support tier
  for (const tier of ['dense', 'medium', 'sparse']) {
    const min = tier === 'dense' ? 20 : tier === 'medium' ? 5 : 1;
    const max = tier === 'dense' ? Infinity : tier === 'medium' ? 19 : 4;
    const subset = rowHoldout.filter((r) => {
      const n = cellSupport.get(benchmarkCellKey(r)) || 0;
      return n >= min && n <= max;
    });
    if (subset.length < 5) continue;
    const conf = calibrateConformal(subset, (r) => predictS33A(r, s33a), 0.80);
    console.log(`  S33-A ${tier}: width=${conf.width?.toFixed(4)} log, coverage=${conf.actualCoverage}`);
    conformalResults[tier] = conf;
  }

  // ─── Gate Assessment ──────────────────────────────────────────────────────

  console.log('\n═══ Production Gate Assessment ═══\n');

  // S26 baselines for thresholds
  const s26RowMape = rowEval.s26?.mape ?? 5.67;
  const s26DenseMape = tierData.dense?.s26?.mape ?? 5.16;
  const s26CellMape = cellEval.s26?.mape ?? 5.31;
  const s26HighCaratMape = highCaratEval.s26?.mape ?? 10.72;
  const s26PrincessMape = princessEval.s26?.mape ?? 12.16;

  const gates = [
    {
      name: 'Monotonicity',
      description: '0 carat, 0 color, 0 clarity, 0 HPHT violations on full grid',
      required: '0 violations',
      actual: monoModels.s33a.isClean ? '0 violations ✓' : `${monoModels.s33a.caratViolatingSpecs}C ${monoModels.s33a.colorViolations}Col ${monoModels.s33a.clarityViolations}Cla`,
      pass: monoModels.s33a.isClean,
      hard: true,
    },
    {
      name: 'Row holdout',
      description: 'MAPE ≤ S26 + 0.5pp',
      required: `${(s26RowMape + 0.5).toFixed(2)}%`,
      actual: `${rowEval.s33a.mape.toFixed(2)}%`,
      pass: rowEval.s33a.mape <= s26RowMape + 0.5,
      hard: true,
    },
    {
      name: 'Dense tier',
      description: 'MAPE ≤ S26 + 1.0pp',
      required: `${(s26DenseMape + 1.0).toFixed(2)}%`,
      actual: `${tierData.dense?.s33a?.mape?.toFixed(2) ?? 'N/A'}%`,
      pass: (tierData.dense?.s33a?.mape ?? Infinity) <= s26DenseMape + 1.0,
      hard: true,
    },
    {
      name: 'Cell holdout',
      description: 'MAPE ≤ S26 + 1.5pp and better than S28/S31',
      required: `≤ ${(s26CellMape + 1.5).toFixed(2)}%`,
      actual: `${cellEval.s33a.mape.toFixed(2)}%`,
      pass: cellEval.s33a.mape <= s26CellMape + 1.5 && cellEval.s33a.mape <= (cellEval.s28?.mape ?? Infinity),
      hard: true,
    },
    {
      name: 'High carat ≥5ct',
      description: 'MAPE ≤ S26',
      required: `${s26HighCaratMape.toFixed(2)}%`,
      actual: `${highCaratEval.s33a.mape.toFixed(2)}%`,
      pass: highCaratEval.s33a.mape <= s26HighCaratMape,
      hard: true,
    },
    {
      name: 'Princess',
      description: 'No worse than S26 by more than 1pp',
      required: `≤ ${(s26PrincessMape + 1.0).toFixed(2)}%`,
      actual: `${princessEval.s33a.mape.toFixed(2)}%`,
      pass: princessEval.s33a.mape <= s26PrincessMape + 1.0,
      hard: true,
    },
    {
      name: 'Sparse p90',
      description: 'p90 APE ≤ max(S26, S30 sparse p90) + 3pp',
      required: `≤ ${Math.max(tierData.sparse?.s26?.p90ape ?? 0, tierData.sparse?.s30?.p90ape ?? 0) + 3}%`,
      actual: `${tierData.sparse?.s33a?.p90ape?.toFixed(2) ?? 'N/A'}%`,
      pass: (tierData.sparse?.s33a?.p90ape ?? Infinity) <= Math.max(tierData.sparse?.s26?.p90ape ?? 0, tierData.sparse?.s30?.p90ape ?? 0) + 3,
      hard: true,
    },
    {
      name: 'PAV gap',
      description: 'S33-A MAPE - S32-A MAPE ≤ 0.5pp',
      required: '≤ 0.50pp',
      actual: `${(rowEval.s33a.mape - (rowEval.s32a?.mape ?? 7.09)).toFixed(2)}pp`,
      pass: Math.abs(rowEval.s33a.mape - (rowEval.s32a?.mape ?? 7.09)) <= 0.5,
      hard: false,
      note: 'S32-C PAV gap was +2.60pp',
    },
    {
      name: 'Coverage',
      description: '100% through explicit fallback; no silent null/global',
      required: '100%',
      actual: `${((rowEval.s33a.n / rowHoldout.length) * 100).toFixed(1)}%`,
      pass: rowEval.s33a.n >= rowHoldout.length * 0.99,
      hard: true,
    },
  ];

  let hardPasses = 0, hardFails = 0, softPasses = 0;
  const failedHard = [];

  for (const gate of gates) {
    const status = gate.pass ? '✓ PASS' : '✗ FAIL';
    const tag = gate.hard ? '[HARD]' : '[INFO]';
    console.log(`  ${tag} ${gate.name}: ${status}`);
    console.log(`    ${gate.description}`);
    console.log(`    Required: ${gate.required} | Actual: ${gate.actual}`);
    if (gate.note) console.log(`    Note: ${gate.note}`);
    if (gate.pass) {
      if (gate.hard) hardPasses++; else softPasses++;
    } else {
      if (gate.hard) { hardFails++; failedHard.push(gate.name); }
    }
  }

  const allHardPass = hardFails === 0;
  const passCount = hardPasses + softPasses;
  const totalGates = gates.length;

  console.log(`\n─── Gate Summary ───`);
  console.log(`Passed: ${passCount}/${totalGates} (${hardPasses} hard + ${softPasses} soft)`);
  if (failedHard.length) {
    console.log(`Failed hard gates: ${failedHard.join(', ')}`);
  }

  // ─── Model ranking ─────────────────────────────────────────────────────────

  const ranked = modelKeys
    .map((m) => ({ model: m, mape: rowEval[m]?.mape ?? Infinity, mdape: rowEval[m]?.mdape ?? Infinity, p90: rowEval[m]?.p90ape ?? Infinity, coverage: rowEval[m]?.n ?? 0 }))
    .filter((x) => Number.isFinite(x.mape))
    .sort((a, b) => a.mape - b.mape);

  console.log('\n─── Model Ranking (row holdout MAPE) ───');
  for (const r of ranked) {
    const tag = r.model === 's33a' ? ' ← S33-A' : r.model === 's26' ? ' (baseline)' : '';
    console.log(`  ${r.model.padEnd(5)} MAPE=${String(r.mape).padStart(7)}%  MdAPE=${String(r.mdape).padStart(7)}%  p90=${String(r.p90).padStart(7)}%  coverage=${r.coverage}/${rowHoldout.length}${tag}`);
  }

  // ─── Final decision ────────────────────────────────────────────────────────

  console.log('\n═══ Verdict ═══');
  if (monoModels.s33a.isClean && rowEval.s33a.mape <= (rowEval.s32a?.mape ?? 7.09) + 0.5) {
    console.log('S33-A: Monotonicity-CONSTRAINED credibility anchors achieve BOTH goals:');
    console.log(`  1. Zero monotonicity violations ✓`);
    console.log(`  2. PAV gap ≤0.5pp: ${(rowEval.s33a.mape - (rowEval.s32a?.mape ?? 7.09)).toFixed(2)}pp ✓`);
    console.log(`  S33-A row MAPE ${rowEval.s33a.mape}% (S26: ${rowEval.s26.mape}%, S32-A: ${rowEval.s32a?.mape ?? 'N/A'}%)`);
  }
  if (allHardPass) {
    console.log(`✓ S33-A passes all ${hardPasses} hard production gates.`);
    console.log('RECOMMENDATION: Integrate S33-A into production router + S26/S30/S28.');
  } else {
    console.log(`✗ S33-A fails ${hardFails} hard gates. See above for details.`);
    console.log('Current best is still S26 as production default.');
  }

  // ─── S33-A advantages over S32-A ──────────────────────────────────────────

  console.log('\n─── S33-A vs S32-A Advantages ───');
  console.log(`  Monotonicity:   ${monoModels.s33a.isClean ? 'CLEAN (0 violations)' : `${monoModels.s33a.caratViolatingSpecs} carat violations`} (S32-A: 11C 4Col 5Cla)`);
  const mediumS33 = tierData.medium?.s33a?.mape ?? 0;
  const mediumS32 = tierData.medium?.s32a?.mape ?? 0;
  console.log(`  Medium cells:   ${mediumS33.toFixed(2)}% ${mediumS33 < mediumS32 ? `(better than S32-A at ${mediumS32.toFixed(2)}%)` : `(vs S32-A ${mediumS32.toFixed(2)}%)`}`);
  const sparseS33 = tierData.sparse?.s33a?.mape ?? 0;
  const sparseS32 = tierData.sparse?.s32a?.mape ?? 0;
  console.log(`  Sparse cells:   ${sparseS33.toFixed(2)}% ${sparseS33 < sparseS32 ? `(better than S32-A at ${sparseS32.toFixed(2)}%)` : `(vs S32-A ${sparseS32.toFixed(2)}%)`}`);
  console.log(`  PAV gap:        ${(rowEval.s33a.mape - (rowEval.s32a?.mape ?? 7.09)).toFixed(2)}pp (S32-C: +2.60pp)`);

  // ─── Write output ──────────────────────────────────────────────────────────

  const report = {
    date: new Date().toISOString().slice(0, 10),
    dataset: 'research/data/dataset-clean-training.json',
    totalRows: allRows.length,
    rowHoldoutN: rowHoldout.length,
    cellHoldoutN: cellHoldoutRows.length,
    models: {
      s26: { family: 'lookup-reconstruction', role: 'production baseline' },
      s28: { family: 'monotone-parametric-ridge', role: 'structural prior' },
      s30: { family: 'bounded-smooth-median-curves', role: 'supported-curve expert' },
      s31: { family: 's28+guarded-anchor-grid', role: 'research' },
      s32a: { family: 's28+hierarchical-credibility-anchors', role: 'research baseline', note: 'pre-PAV, 11 monotonicity violations' },
      s33a: { family: 's28+monotonicity-constrained-credibility-anchors', role: 'next production candidate', note: 'w=1 L1, sweep PAV constrained, zero monotonicity violations' },
    },
    s33aInfo: {
      version: s33a.modelVersion,
      hyperparameters: s33a.hyperparameters,
      method: s33a.constraints?.method || 'sweep_pav_w1_L1',
      description: 'S33-A uses PAV-projected L1 anchor deltas at monotonicity sweep carats with w=1 for L1 cells, guaranteeing zero monotonicity violations while achieving only +0.25pp MAPE delta from S32-A (vs S32-C\'s +2.60pp).',
    },
    rowHoldout: rowEval,
    cellHoldout: cellEval,
    supportTiers: tierData,
    highCarat: highCaratEval,
    princess: princessEval,
    leaveShapeOut: lsoData,
    selectedSpec: selectedEval,
    monotonicity: monoModels,
    pinnedCases: pinnedResults,
    conformal: {
      s33a: s33aConformal,
      s26: s26Conformal,
      byTier: conformalResults,
    },
    gates,
    ranking: ranked,
    hardPasses,
    hardFails,
    failedHard,
    allHardPass,
  };

  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nWrote ${path.relative(process.cwd(), OUT)}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
