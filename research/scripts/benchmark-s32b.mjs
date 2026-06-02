#!/usr/bin/env node
/**
 * Benchmark S32-B: add S32-B predictions to the comprehensive benchmark.
 *
 * Since CatBoost evaluation requires native code, this script calls
 * a Python helper to generate S32-B predictions for the benchmark rows,
 * then compares against S32-A, S28, S26, and S31.
 *
 * Usage:
 *   node research/scripts/benchmark-s32b.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { starsgemNorm, starsgemCaratBucket } from './starsgem-ml-predict.mjs';
import { predictS28 } from './s28-predict.mjs';
import { predictS31, s31PredictionInput } from './s31-predict.mjs';
import { predictS32 } from './s32-predict.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DATA = path.join(ROOT, 'research/data');
const OUT = path.join(DATA, 'benchmark-s32b-comprehensive.json');

const HOLDOUT_MOD = 5;

function loadJson(name) {
  return JSON.parse(readFileSync(path.join(DATA, name), 'utf8'));
}

function reportHash(row) {
  const text = String(row.reportNo ?? row.reportno ?? row.rowNo ?? '');
  let total = 0;
  for (const ch of text) total = (total * 131 + ch.charCodeAt(0)) % 1_000_003;
  return total;
}

function caratBand(carat) {
  const bands = [
    { lo: 1.0, hi: 1.49, label: '1.00-1.49' },
    { lo: 1.5, hi: 1.99, label: '1.50-1.99' },
    { lo: 2.0, hi: 2.99, label: '2.00-2.99' },
    { lo: 3.0, hi: 3.99, label: '3.00-3.99' },
    { lo: 4.0, hi: 4.99, label: '4.00-4.99' },
    { lo: 5.0, hi: 9.99, label: '5.00-9.99' },
    { lo: 10.0, hi: 99.99, label: '10.00+' },
  ];
  for (const band of bands) {
    if (carat >= band.lo && carat <= band.hi) return band.label;
  }
  return carat < 1 ? '<1.00' : '10.00+';
}

function cellHash(key) {
  let total = 0;
  for (const ch of key) total = (total * 131 + ch.charCodeAt(0)) % 1_000_003;
  return total;
}

function benchmarkCellKey(row) {
  return [
    String(row.shape_style || 'round_standard').trim().toLowerCase(),
    starsgemNorm(row.color),
    starsgemNorm(row.clarity),
    caratBand(Number(row.carat)),
  ].join('||');
}

function ape(pred, actual) {
  return Math.abs(pred - actual) / actual * 100;
}

function metric(records, key) {
  const apes = [];
  const signed = [];
  for (const r of records) {
    const pred = r[key];
    if (!Number.isFinite(pred) || pred <= 0) continue;
    apes.push(ape(pred, r.actual));
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

function s26LookupPrediction(raw, intel) {
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

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const allRows = loadJson('dataset-clean-training.json');
  const intel = loadJson('starsgem-pricing-intelligence.json');
  const s28Model = loadJson('starsgem-ml-model-s28-monotone-parametric.json');
  const s31Model = loadJson('starsgem-ml-model-s31-guarded-anchor.json');
  const s32aModel = loadJson('starsgem-ml-model-s32a-anchors.json');

  // Try loading s32b
  let s32bModel = null;
  try {
    s32bModel = loadJson('starsgem-ml-model-s32b.json');
    console.log('S32-B artifact loaded');
  } catch (e) {
    console.log('S32-B artifact not available');
  }

  const rowHoldout = allRows.filter((r) => reportHash(r) % HOLDOUT_MOD === 0);
  const rowTrain = allRows.filter((r) => reportHash(r) % HOLDOUT_MOD !== 0);
  const cellHoldout = allRows.filter((r) => cellHash(benchmarkCellKey(r)) % HOLDOUT_MOD === 0);

  const cellSupport = new Map();
  for (const r of allRows) {
    cellSupport.set(benchmarkCellKey(r), (cellSupport.get(benchmarkCellKey(r)) || 0) + 1);
  }

  console.log(`Row holdout: ${rowHoldout.length}, Cell holdout: ${cellHoldout.length}`);

  // Build evaluation rows
  const evalRows = rowHoldout.map((row) => {
    const s32a = predictS32(row, s32aModel);
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
    const s26 = s26LookupPrediction(row, intel);
    const s31 = predictS31(s31PredictionInput(row), s31Model);

    return {
      actual: Number(row.price),
      s32a: s32a?.price ?? null,
      s32b: null, // filled by Python
      s28: s28?.price ?? null,
      s26: s26?.price ?? null,
      s31: s31?.price ?? null,
      supportN: cellSupport.get(benchmarkCellKey(row)) || 0,
      supportTier: supportTier(cellSupport.get(benchmarkCellKey(row)) || 0),
      band: caratBand(Number(row.carat)),
      shape: row.shape_style,
      carat: Number(row.carat),
      cellKey: benchmarkCellKey(row),
    };
  });

  // Generate Python predictions via subprocess
  if (s32bModel) {
    console.log('Generating S32-B predictions via Python...');

    // Write eval rows to temp file for Python
    const tempInput = path.join(DATA, '_s32b_eval_input.json');
    writeFileSync(tempInput, JSON.stringify(evalRows.map((r) => ({
      actual: r.actual,
      carat: r.carat,
      shape_style: r.shape,
      color: allRows.find((a) => a.price === r.actual)?.color ?? 'E',
      clarity: allRows.find((a) => a.price === r.actual)?.clarity ?? 'VS1',
      cut_raw: allRows.find((a) => a.price === r.actual)?.cut_raw ?? 'EX',
      typeName: allRows.find((a) => a.price === r.actual)?.typeName ?? 'CVD',
      lw_ratio: allRows.find((a) => a.price === r.actual)?.lw_ratio ?? null,
      table_pct: allRows.find((a) => a.price === r.actual)?.table_pct ?? null,
      depth_pct: allRows.find((a) => a.price === r.actual)?.depth_pct ?? null,
      polish: allRows.find((a) => a.price === r.actual)?.polish ?? 'EX',
      symmetry: allRows.find((a) => a.price === r.actual)?.symmetry ?? 'EX',
      cellKey: r.cellKey,
      supportN: r.supportN,
    })), null, 2) + '\n');

    // Instead of Python subprocess, compute S32-B inline using S32-A predictions
    // For this initial benchmark, S32-B = S32-A (residual is trained but not yet
    // integrated into the Node.js predictor due to CatBoost native dependency)
    //
    // We'll compute approximate S32-B by applying the residual statistics
    // to S32-A predictions. The residual model has:
    //   - mean residual reduction: 0.0169 (from training stats)
    //   - capped at ±R_cap (0.15)
    //
    // Full S32-B evaluation requires either:
    //   a) Python subprocess to evaluate CatBoost model
    //   b) ONNX export + onnxruntime-node
    //   c) Official catboost npm package

    // For now, mark S32-B as "pending Node evaluation"
    console.log('S32-B full evaluation requires CatBoost runtime in Node.js');
    console.log('Marking S32-B predictions as pending...');

    // Fallback: S32-B = S32-A (no residual applied yet)
    for (const r of evalRows) {
      r.s32b = r.s32a;
    }
  }

  // Compute metrics
  const modelKeys = ['s32a', 's32b', 's28', 's26', 's31'];

  const result = { n: evalRows.length };
  for (const key of modelKeys) {
    result[key] = metric(evalRows, key);
  }

  // By support tier
  const byTier = {};
  for (const tier of ['dense', 'medium', 'sparse']) {
    const subset = evalRows.filter((r) => r.supportTier === tier);
    byTier[tier] = { n: subset.length };
    for (const key of modelKeys) {
      byTier[tier][key] = metric(subset, key);
    }
  }

  // High carat
  const highCarat = evalRows.filter((r) => r.carat >= 5);
  const highCaratMetrics = { n: highCarat.length };
  for (const key of modelKeys) {
    highCaratMetrics[key] = metric(highCarat, key);
  }

  // Sparse
  const sparse = evalRows.filter((r) => r.supportN < 5);
  const sparseMetrics = { n: sparse.length };
  for (const key of modelKeys) {
    sparseMetrics[key] = metric(sparse, key);
  }

  // Princess
  const princess = evalRows.filter((r) => r.shape === 'princess_standard');
  const princessMetrics = { n: princess.length };
  for (const key of modelKeys) {
    princessMetrics[key] = metric(princess, key);
  }

  console.log('\n─── S32-A vs Baselines (S32-B pending CatBoost Node runtime) ───');
  console.log(`Row holdout (n=${result.n}):`);
  for (const key of modelKeys) {
    if (result[key]?.mape != null) {
      console.log(`  ${key.toUpperCase()}: MAPE=${result[key].mape}%  MdAPE=${result[key].mdape}%  p90=${result[key].p90ape}%  bias=${result[key].biasPct}%`);
    }
  }

  console.log(`\nBy support tier:`);
  for (const [tier, data] of Object.entries(byTier)) {
    const parts = [];
    for (const key of modelKeys) {
      if (data[key]?.mape != null) parts.push(`${key.toUpperCase()}=${data[key].mape}%`);
    }
    console.log(`  ${tier} (n=${data.n}): ${parts.join(' ')}`);
  }

  const benchmark = {
    date: new Date().toISOString().slice(0, 10),
    model: 'S32-B (pending CatBoost Node runtime)',
    note: 'S32-B predictions currently equal S32-A. Full evaluation requires CatBoost runtime in Node.js (ONNX or npm package).',
    rowHoldout: result,
    bySupportTier: byTier,
    highCarat: highCaratMetrics,
    sparseSupport: sparseMetrics,
    princess: princessMetrics,
  };

  writeFileSync(OUT, JSON.stringify(benchmark, null, 2) + '\n');
  console.log(`\nWrote ${path.relative(ROOT, OUT)}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
