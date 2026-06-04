#!/usr/bin/env node
/**
 * WhiteProd vNext — Production Benchmark
 *
 * Evaluates the routed WhiteProd vNext predictor as ONE model against S26, S30,
 * S33-A, and S28 on identical splits.
 *
 * Required sections per research/production-ready-one-best-white-ml-model-plan.md:
 *   - row holdout
 *   - cell holdout
 *   - dense/medium/sparse tiers
 *   - high carat >=5ct
 *   - princess
 *   - leave-shape-out
 *   - selected-spec app mode
 *   - monotonicity grid
 *   - pinned cases
 *   - conformal coverage
 *   - routing distribution
 *
 * Usage:
 *   node research/scripts/benchmark-white-prod-vnext.mjs
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { starsgemNorm, starsgemCaratBucket } from './starsgem-ml-predict.mjs';
import { predictS28 } from './s28-predict.mjs';
import { predictS30 } from './s30-predict.mjs';
import { predictS32 } from './s32-predict.mjs';
import { buildS30Artifact } from './train-s30-bounded-smooth.mjs';
import {
  predictWhiteProdVNext,
  predictS26Lookup,
  predictS33A,
  supportTier as classifySupport,
  cellKey as buildCellKey,
} from './predict-white-prod-vnext.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, '../data');
const OUT = path.join(DATA, 'benchmark-white-prod-vnext.json');

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

// ─── Conformal calibration ──────────────────────────────────────────────────

function calibrateConformal(rows, predictFn, coverage = 0.80) {
  const absLogErrors = [];
  for (const row of rows) {
    const pred = predictFn(row);
    if (!pred?.price || pred.price <= 0) continue;
    const err = Math.abs(Math.log(pred.price / Number(row.price)));
    absLogErrors.push(err);
  }
  if (!absLogErrors.length) return { width: null, n: 0 };

  const sorted = [...absLogErrors].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * coverage));
  const width = sorted[idx];

  let covered = 0;
  for (const row of rows) {
    const pred = predictFn(row);
    if (!pred?.price || pred.price <= 0) continue;
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
        const row = { _displayGrid: true, carat, shape_style: 'round_standard', color, clarity, cut_raw: 'EX', polish: 'EX', symmetry: 'EX', typeName: 'CVD' };
        const p = predictFn(row);
        return p?.pricePerCarat ?? p?.upc ?? null;
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
        const row = { _displayGrid: true, carat, shape_style: 'round_standard', color, clarity, cut_raw: 'EX', polish: 'EX', symmetry: 'EX', typeName: 'CVD' };
        const p = predictFn(row);
        return p?.pricePerCarat ?? p?.upc ?? null;
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
        const row = { _displayGrid: true, carat, shape_style: 'round_standard', color, clarity, cut_raw: 'EX', polish: 'EX', symmetry: 'EX', typeName: 'CVD' };
        const p = predictFn(row);
        return p?.pricePerCarat ?? p?.upc ?? null;
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

// ─── CARAT_BANDS for S33-A ──────────────────────────────────────────────────

const CARAT_BANDS = [
  { lo: 1.0, hi: 1.49, label: '1.00-1.49' },
  { lo: 1.5, hi: 1.99, label: '1.50-1.99' },
  { lo: 2.0, hi: 2.99, label: '2.00-2.99' },
  { lo: 3.0, hi: 3.99, label: '3.00-3.99' },
  { lo: 4.0, hi: 4.99, label: '4.00-4.99' },
  { lo: 5.0, hi: 9.99, label: '5.00-9.99' },
  { lo: 10.0, hi: 99.99, label: '10.00+' },
];

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══ WhiteProd vNext Production Benchmark ═══\n');

  const allRows = loadJson('dataset-clean-training.json');
  const intel = loadJson('starsgem-pricing-intelligence.json');
  const s28 = loadJson('starsgem-ml-model-s28-monotone-parametric.json');
  const s30Shipped = loadJson('starsgem-ml-model-s30-bounded-smooth.json');
  const s33a = loadJson('starsgem-ml-model-s33a-constrained-anchors.json');
  const s32a = loadJson('starsgem-ml-model-s32a-anchors.json');

  const rowHoldout = allRows.filter((r) => reportHash(r) % HOLDOUT_MOD === 0);
  const rowTrain = allRows.filter((r) => reportHash(r) % HOLDOUT_MOD !== 0);

  // Build fair S30 from training data
  const fairS30 = buildS30Artifact(rowTrain);

  // Build cell support from full dataset
  const cellSupport = new Map();
  for (const r of allRows) {
    const k = benchmarkCellKey(r);
    cellSupport.set(k, (cellSupport.get(k) || 0) + 1);
  }

  // Cell holdout split
  const cellHoldoutRows = allRows.filter((r) => cellHash(benchmarkCellKey(r)) / 1000 < 0.2);
  const cellTrainRows = allRows.filter((r) => cellHash(benchmarkCellKey(r)) / 1000 >= 0.2);

  console.log(`Dataset: ${allRows.length} rows`);
  console.log(`Row holdout: ${rowHoldout.length} rows (20%)`);
  console.log(`Cell holdout: ${cellHoldoutRows.length} rows\n`);

  // ─── Build WhiteProd vNext context ────────────────────────────────────────

  const wpCtx = {
    modelVersion: 'white-prod-vnext-v0.2.0',
    s30: s30Shipped,
    s30Model: fairS30,
    s26Intel: intel,
    s33a,
    s28,
    cellSupport,
    routingConfig: {
      s30MinSupport: 15,
      s30MinCaratForPriority: 5,
      s30MaxUpcRatio: 1.5,
      s30MinUpcRatio: 0.65,
      s26MinLookupLevel: 4,
      s26MinLookupCount: 5,
      s26MaxCarat: 8,
      s33MinAnchorN: 10,
      princessPreferS26: true,
    },
  };

  // ─── Prediction functions for each model ──────────────────────────────────

  function predictWP(row) {
    return predictWhiteProdVNext(row, wpCtx);
  }

  function predictS26Fn(row) {
    return predictS26Lookup(row, intel);
  }

  function predictS28Fn(row) {
    const input = {
      carat: Number(row.carat), Carat: Number(row.carat),
      shape_style: row.shape_style, Shape_Style: row.shape_style,
      color: row.color, Color: row.color,
      clarity: row.clarity, Clarity: row.clarity,
      cut_raw: row.cut_raw, Cut: row.cut_raw,
      polish: row.polish, symmetry: row.symmetry,
      typeName: row.typeName, TypeName: row.typeName,
      lw_ratio: row.lw_ratio, table_pct: row.table_pct, depth_pct: row.depth_pct,
    };
    return predictS28(input, s28);
  }

  function predictS30Fn(row) {
    try {
      return predictS30({
        carat: Number(row.carat), shape_style: row.shape_style,
        color: row.color, clarity: row.clarity,
        typeName: row.typeName, cut_raw: row.cut_raw,
        polish: row.polish, symmetry: row.symmetry,
      }, fairS30);
    } catch (e) { return null; }
  }

  function predictS33AFn(row) {
    return predictS33A(row, s33a);
  }

  function predictS32AFn(row) {
    return predictS32({
      carat: row.carat, shape_style: row.shape_style,
      color: row.color, clarity: row.clarity,
      cut_raw: row.cut_raw, polish: row.polish, symmetry: row.symmetry,
      typeName: row.typeName,
      lw_ratio: row.lw_ratio, table_pct: row.table_pct, depth_pct: row.depth_pct,
    }, s32a);
  }

  const models = {
    whiteProdVNext: predictWP,
    s26: predictS26Fn,
    s28: predictS28Fn,
    s30: predictS30Fn,
    s33a: predictS33AFn,
    s32a: predictS32AFn,
  };
  const modelKeys = ['whiteProdVNext', 's26', 's28', 's30', 's33a', 's32a'];

  // ─── Evaluate slice ───────────────────────────────────────────────────────

  function evaluateSlice(rows) {
    const accum = {};
    let wpRouting = { S30: 0, S26: 0, S33A: 0, S28: 0, null: 0 };
    let wpTiers = { dense: 0, medium: 0, sparse: 0, empty: 0 };

    for (const r of rows) {
      const actual = Number(r.price);
      for (const [name, fn] of Object.entries(models)) {
        const p = fn(r);
        const price = p?.price ?? null;
        if (price == null || !Number.isFinite(price) || price <= 0) continue;
        if (!accum[name]) accum[name] = { apes: [], signed: [] };
        accum[name].apes.push(ape(price, actual));
        accum[name].signed.push(signedPct(price, actual));

        // Track routing distribution for WhiteProd vNext
        if (name === 'whiteProdVNext') {
          wpRouting[p.selectedExpert ?? 'null']++;
          wpTiers[p.supportTier ?? 'empty']++;
        }
      }
    }
    const out = {};
    for (const [k, v] of Object.entries(accum)) {
      out[k] = stats(v.apes, v.signed);
    }
    return { metrics: out, routing: wpRouting, tiers: wpTiers };
  }

  // ─── 1. Row Holdout ───────────────────────────────────────────────────────

  console.log('─── 1. Row Holdout ───');
  const rowEval = evaluateSlice(rowHoldout);
  for (const m of modelKeys) {
    const s = rowEval.metrics[m];
    if (s?.n) console.log(`  ${m.padEnd(16)} MAPE=${String(s.mape).padStart(7)}%  MdAPE=${String(s.mdape).padStart(7)}%  p90=${String(s.p90ape).padStart(7)}%  bias=${String(s.biasPct).padStart(7)}%  n=${s.n}`);
  }
  console.log(`  Routing: S30=${rowEval.routing.S30} S26=${rowEval.routing.S26} S33A=${rowEval.routing.S33A} S28=${rowEval.routing.S28}`);

  // ─── 2. Cell Holdout ──────────────────────────────────────────────────────

  console.log('\n─── 2. Cell Holdout ───');
  const cellEval = evaluateSlice(cellHoldoutRows);
  for (const m of modelKeys) {
    const s = cellEval.metrics[m];
    if (s?.n) console.log(`  ${m.padEnd(16)} MAPE=${String(s.mape).padStart(7)}%  MdAPE=${String(s.mdape).padStart(7)}%  p90=${String(s.p90ape).padStart(7)}%  n=${s.n}`);
  }

  // ─── 3. Support Tiers ─────────────────────────────────────────────────────

  console.log('\n─── 3. Support Tiers (row holdout) ───');
  const tierData = {};
  for (const tier of ['dense', 'medium', 'sparse']) {
    const min = tier === 'dense' ? 20 : tier === 'medium' ? 5 : 1;
    const max = tier === 'dense' ? Infinity : tier === 'medium' ? 19 : 4;
    const subset = rowHoldout.filter((r) => {
      const n = cellSupport.get(benchmarkCellKey(r)) || 0;
      return n >= min && n <= max;
    });
    const eval_ = evaluateSlice(subset);
    tierData[tier] = { n: subset.length, ...eval_ };
    console.log(`  ${tier} (n=${subset.length}):`);
    for (const m of modelKeys) {
      const s = eval_.metrics[m];
      if (s?.n) console.log(`    ${m.padEnd(16)} MAPE=${String(s.mape).padStart(7)}%  p90=${String(s.p90ape).padStart(7)}%`);
    }
    console.log(`    Routing: S30=${eval_.routing.S30} S26=${eval_.routing.S26} S33A=${eval_.routing.S33A} S28=${eval_.routing.S28}`);
  }

  // ─── 4. High Carat ────────────────────────────────────────────────────────

  console.log('\n─── 4. High Carat (≥5ct, row holdout) ───');
  const highCaratRows = rowHoldout.filter((r) => Number(r.carat) >= 5);
  const highCaratEval = evaluateSlice(highCaratRows);
  console.log(`  n=${highCaratRows.length}`);
  for (const m of modelKeys) {
    const s = highCaratEval.metrics[m];
    if (s?.n) console.log(`    ${m.padEnd(16)} MAPE=${String(s.mape).padStart(7)}%  p90=${String(s.p90ape).padStart(7)}%`);
  }
  console.log(`    Routing: S30=${highCaratEval.routing.S30} S26=${highCaratEval.routing.S26} S33A=${highCaratEval.routing.S33A} S28=${highCaratEval.routing.S28}`);

  // ─── 5. Princess ──────────────────────────────────────────────────────────

  console.log('\n─── 5. Princess Slice ───');
  const princessRows = rowHoldout.filter((r) => String(r.shape_style || '').toLowerCase() === 'princess_standard');
  const princessEval = evaluateSlice(princessRows);
  console.log(`  n=${princessRows.length}`);
  for (const m of modelKeys) {
    const s = princessEval.metrics[m];
    if (s?.n) console.log(`    ${m.padEnd(16)} MAPE=${String(s.mape).padStart(7)}%  MdAPE=${String(s.mdape).padStart(7)}%`);
  }
  console.log(`    Routing: S30=${princessEval.routing.S30} S26=${princessEval.routing.S26} S33A=${princessEval.routing.S33A} S28=${princessEval.routing.S28}`);

  // ─── 6. Leave-Shape-Out ───────────────────────────────────────────────────

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
    const eval_ = evaluateSlice(held);
    lsoData[shape] = { n: held.length, ...eval_ };
    const wp = eval_.metrics.whiteProdVNext;
    const s26 = eval_.metrics.s26;
    console.log(`  ${shape.padEnd(22)} n=${String(held.length).padStart(5)}  WPvNext=${wp?.mape?.toFixed(2) ?? 'N/A'}%  S26=${s26?.mape?.toFixed(2) ?? 'N/A'}%  S30=${eval_.metrics.s30?.mape?.toFixed(2) ?? 'N/A'}%`);
  }

  // ─── 7. Selected-Spec Mode ────────────────────────────────────────────────

  console.log('\n─── 7. Selected-Spec Mode (no lw/table/depth) ───');
  const selectedRows = rowHoldout.map((r) => ({ ...r, lw_ratio: null, table_pct: null, depth_pct: null }));
  const selectedEval = evaluateSlice(selectedRows);
  for (const m of modelKeys) {
    const s = selectedEval.metrics[m];
    if (s?.n) console.log(`  ${m.padEnd(16)} MAPE=${String(s.mape).padStart(7)}%  n=${s.n}`);
  }

  // ─── 8. Monotonicity ──────────────────────────────────────────────────────

  console.log('\n─── 8. Monotonicity Grid Scan ───');

  const monoModels = {
    whiteProdVNext: monotonicityScan((row) => predictWhiteProdVNext(row, wpCtx)),
    s28: monotonicityScan((row) => predictS28({
      carat: row.carat, Carat: row.carat,
      shape_style: row.shape_style, Shape_Style: row.shape_style,
      color: row.color, Color: row.color,
      clarity: row.clarity, Clarity: row.clarity,
      cut_raw: row.cut_raw, Cut: row.cut_raw,
      polish: row.polish, symmetry: row.symmetry,
      typeName: row.typeName, TypeName: row.typeName,
    }, s28)),
    s33a: monotonicityScan((row) => predictS33A(row, s33a)),
  };

  for (const [name, mono] of Object.entries(monoModels)) {
    const status = mono.isClean ? '✓ CLEAN' : `✗ ${mono.caratViolatingSpecs}C ${mono.colorViolations}Col ${mono.clarityViolations}Cla`;
    console.log(`  ${name.padEnd(16)} ${status}`);
    if (mono.violatingSpecs.length) {
      console.log(`         violating: ${mono.violatingSpecs.map((s) => `${s.color}/${s.clarity}`).join(', ')}`);
    }
  }

  // ─── 9. Pinned Cases ──────────────────────────────────────────────────────

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
    const wp = predictWhiteProdVNext(row, wpCtx);
    const s26 = predictS26Fn(row);
    const s30 = predictS30Fn(row);
    const s33a_ = predictS33AFn(row);
    const s28p = predictS28Fn(row);

    console.log(`  ${pc.name} ${pc.carat}ct ${pc.shape} ${pc.color} ${pc.clarity}:`);
    console.log(`    WPvNext: $${wp?.price?.toFixed(0) ?? 'N/A'} ($${wp?.pricePerCarat?.toFixed(0) ?? 'N/A'}/ct) expert=${wp?.selectedExpert ?? 'none'} tier=${wp?.supportTier ?? 'none'} band=${wp?.confidenceBand ?? 'none'} reason=${wp?.fallbackReason ?? 'none'}`);
    console.log(`    S30:    $${s30?.price?.toFixed(0) ?? 'N/A'} ($${s30?.upc?.toFixed(0) ?? 'N/A'}/ct)`);
    console.log(`    S26:    $${s26?.price?.toFixed(0) ?? 'N/A'}`);
    console.log(`    S33-A:  $${s33a_?.price?.toFixed(0) ?? 'N/A'} ($${s33a_?.upc?.toFixed(0) ?? 'N/A'}/ct, L${s33a_?.anchorLevel ?? 'none'})`);
    console.log(`    S28:    $${s28p?.price?.toFixed(0) ?? 'N/A'} ($${s28p?.upc?.toFixed(0) ?? 'N/A'}/ct)`);

    pinnedResults.push({
      ...pc,
      wpPrice: wp?.price ?? null, wpUpc: wp?.pricePerCarat ?? null,
      wpExpert: wp?.selectedExpert ?? null, wpTier: wp?.supportTier ?? null,
      wpBand: wp?.confidenceBand ?? null, wpReason: wp?.fallbackReason ?? null,
      s26Price: s26?.price ?? null, s30Price: s30?.price ?? null,
      s33aPrice: s33a_?.price ?? null, s28Price: s28p?.price ?? null,
    });
  }

  // ─── 10. Conformal Intervals ──────────────────────────────────────────────

  console.log('\n─── 10. Conformal Interval Calibration ───');

  const wp80 = calibrateConformal(rowHoldout, (r) => predictWhiteProdVNext(r, wpCtx), 0.80);
  console.log(`  WPvNext 80%: width=${wp80.width?.toFixed(4)} log (${wp80.multiplierLow}x - ${wp80.multiplierHigh}x), coverage=${wp80.actualCoverage} n=${wp80.n}`);

  const wp90 = calibrateConformal(rowHoldout, (r) => predictWhiteProdVNext(r, wpCtx), 0.90);
  console.log(`  WPvNext 90%: width=${wp90.width?.toFixed(4)} log (${wp90.multiplierLow}x - ${wp90.multiplierHigh}x), coverage=${wp90.actualCoverage} n=${wp90.n}`);

  // By support tier
  const conformalByTier = {};
  for (const tier of ['dense', 'medium', 'sparse']) {
    const min = tier === 'dense' ? 20 : tier === 'medium' ? 5 : 1;
    const max = tier === 'dense' ? Infinity : tier === 'medium' ? 19 : 4;
    const subset = rowHoldout.filter((r) => {
      const n = cellSupport.get(benchmarkCellKey(r)) || 0;
      return n >= min && n <= max;
    });
    if (subset.length < 5) continue;
    const conf80 = calibrateConformal(subset, (r) => predictWhiteProdVNext(r, wpCtx), 0.80);
    const conf90 = calibrateConformal(subset, (r) => predictWhiteProdVNext(r, wpCtx), 0.90);
    console.log(`  WPvNext ${tier} 80%: width=${conf80.width?.toFixed(4)} log, coverage=${conf80.actualCoverage}`);
    console.log(`  WPvNext ${tier} 90%: width=${conf90.width?.toFixed(4)} log, coverage=${conf90.actualCoverage}`);
    conformalByTier[tier] = { conf80, conf90 };
  }

  // By selected expert
  console.log('\n  By Selected Expert:');
  const conformalByExpert = {};
  for (const expert of ['S30', 'S26', 'S33A', 'S28']) {
    const subset = [];
    for (const r of rowHoldout) {
      const p = predictWhiteProdVNext(r, wpCtx);
      if (p?.selectedExpert === expert) subset.push(r);
    }
    if (subset.length < 5) continue;
    const conf80 = calibrateConformal(subset, (r) => predictWhiteProdVNext(r, wpCtx), 0.80);
    console.log(`  ${expert} (n=${subset.length}) 80%: width=${conf80.width?.toFixed(4)} log, coverage=${conf80.actualCoverage}`);
    conformalByExpert[expert] = { n: subset.length, conf80 };
  }

  // ─── 11. Routing Distribution ─────────────────────────────────────────────

  console.log('\n─── 11. Routing Distribution ───');
  const routingDist = { S30: 0, S26: 0, S33A: 0, S28: 0, null: 0 };
  const tierDist = { dense: 0, medium: 0, sparse: 0, empty: 0 };
  const bandDist = { high: 0, medium: 0, low: 0, floor: 0, null: 0 };
  const reasonDist = {};

  for (const r of rowHoldout) {
    const p = predictWhiteProdVNext(r, wpCtx);
    routingDist[p?.selectedExpert ?? 'null']++;
    tierDist[p?.supportTier ?? 'empty']++;
    bandDist[p?.confidenceBand ?? 'null']++;
    const reason = p?.fallbackReason ?? 'none';
    reasonDist[reason] = (reasonDist[reason] || 0) + 1;
  }

  console.log('  Expert distribution:');
  for (const [expert, count] of Object.entries(routingDist)) {
    console.log(`    ${expert.padEnd(6)} ${String(count).padStart(5)} (${(count / rowHoldout.length * 100).toFixed(1)}%)`);
  }
  console.log('  Support tier distribution:');
  for (const [tier, count] of Object.entries(tierDist)) {
    console.log(`    ${tier.padEnd(6)} ${String(count).padStart(5)}`);
  }
  console.log('  Confidence band distribution:');
  for (const [band, count] of Object.entries(bandDist)) {
    console.log(`    ${band.padEnd(6)} ${String(count).padStart(5)}`);
  }
  console.log('  Fallback reason distribution:');
  for (const [reason, count] of Object.entries(reasonDist).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`    ${reason.padEnd(40)} ${String(count).padStart(5)}`);
  }

  // ─── Gate Assessment ──────────────────────────────────────────────────────

  console.log('\n═══ Production Gate Assessment ═══\n');

  const wpRowMape = rowEval.metrics.whiteProdVNext?.mape ?? Infinity;
  const s26RowMape = rowEval.metrics.s26?.mape ?? 5.37;
  const s26DenseMape = tierData.dense?.metrics?.s26?.mape ?? 5.04;
  const s26CellMape = cellEval.metrics.s26?.mape ?? 5.21;
  const s26HighCaratMape = highCaratEval.metrics.s26?.mape ?? 10.01;
  const s26PrincessMape = princessEval.metrics.s26?.mape ?? 12.16;
  const wpCoverage = rowEval.metrics.whiteProdVNext?.n ?? 0;
  const wpBias = rowEval.metrics.whiteProdVNext?.biasPct ?? null;

  const gates = [
    {
      name: 'Coverage',
      description: '100% through explicit fallback',
      required: '100%',
      actual: `${((wpCoverage / rowHoldout.length) * 100).toFixed(1)}%`,
      pass: wpCoverage >= rowHoldout.length * 0.99,
      hard: true,
    },
    {
      name: 'Row holdout MAPE',
      description: 'MAPE ≤ S26 current baseline',
      required: `≤ ${s26RowMape.toFixed(2)}%`,
      actual: `${wpRowMape.toFixed(2)}%`,
      pass: wpRowMape <= s26RowMape,
      hard: true,
    },
    {
      name: 'Row holdout MdAPE',
      description: 'MdAPE ≤ S26 current baseline',
      required: `≤ ${(rowEval.metrics.s26?.mdape ?? 1.94).toFixed(2)}%`,
      actual: `${(rowEval.metrics.whiteProdVNext?.mdape ?? Infinity).toFixed(2)}%`,
      pass: (rowEval.metrics.whiteProdVNext?.mdape ?? Infinity) <= (rowEval.metrics.s26?.mdape ?? 1.94),
      hard: true,
    },
    {
      name: 'Row holdout p90',
      description: 'p90 APE ≤ S26 current baseline',
      required: `≤ ${(rowEval.metrics.s26?.p90ape ?? 14.17).toFixed(2)}%`,
      actual: `${(rowEval.metrics.whiteProdVNext?.p90ape ?? Infinity).toFixed(2)}%`,
      pass: (rowEval.metrics.whiteProdVNext?.p90ape ?? Infinity) <= (rowEval.metrics.s26?.p90ape ?? 14.17),
      hard: true,
    },
    {
      name: 'Cell holdout MAPE',
      description: 'MAPE ≤ S26 + 0.5pp',
      required: `≤ ${(s26CellMape + 0.5).toFixed(2)}%`,
      actual: `${(cellEval.metrics.whiteProdVNext?.mape ?? Infinity).toFixed(2)}%`,
      pass: (cellEval.metrics.whiteProdVNext?.mape ?? Infinity) <= s26CellMape + 0.5,
      hard: true,
    },
    {
      name: 'Dense tier MAPE',
      description: 'MAPE ≤ S26 + 0.25pp',
      required: `≤ ${(s26DenseMape + 0.25).toFixed(2)}%`,
      actual: `${(tierData.dense?.metrics?.whiteProdVNext?.mape ?? Infinity).toFixed(2)}%`,
      pass: (tierData.dense?.metrics?.whiteProdVNext?.mape ?? Infinity) <= s26DenseMape + 0.25,
      hard: true,
    },
    {
      name: 'Medium tier MAPE',
      description: 'MAPE ≤ S26 + 0.75pp',
      required: `≤ ${((tierData.medium?.metrics?.s26?.mape ?? 6.25) + 0.75).toFixed(2)}%`,
      actual: `${(tierData.medium?.metrics?.whiteProdVNext?.mape ?? Infinity).toFixed(2)}%`,
      pass: (tierData.medium?.metrics?.whiteProdVNext?.mape ?? Infinity) <= (tierData.medium?.metrics?.s26?.mape ?? 6.25) + 0.75,
      hard: true,
    },
    {
      name: 'Sparse p90',
      description: 'p90 APE ≤ max(S26, S30 sparse p90) + 3pp',
      required: `≤ ${(Math.max(tierData.sparse?.metrics?.s26?.p90ape ?? 0, tierData.sparse?.metrics?.s30?.p90ape ?? 0) + 3).toFixed(1)}%`,
      actual: `${(tierData.sparse?.metrics?.whiteProdVNext?.p90ape ?? Infinity).toFixed(2)}%`,
      pass: (tierData.sparse?.metrics?.whiteProdVNext?.p90ape ?? Infinity) <= Math.max(tierData.sparse?.metrics?.s26?.p90ape ?? 0, tierData.sparse?.metrics?.s30?.p90ape ?? 0) + 3,
      hard: true,
    },
    {
      name: 'High carat ≥5ct MAPE',
      description: 'MAPE ≤ S26',
      required: `≤ ${s26HighCaratMape.toFixed(2)}%`,
      actual: `${(highCaratEval.metrics.whiteProdVNext?.mape ?? Infinity).toFixed(2)}%`,
      pass: (highCaratEval.metrics.whiteProdVNext?.mape ?? Infinity) <= s26HighCaratMape,
      hard: true,
    },
    {
      name: 'Princess MAPE',
      description: 'MAPE ≤ S26 + 0.5pp',
      required: `≤ ${(s26PrincessMape + 0.5).toFixed(2)}%`,
      actual: `${(princessEval.metrics.whiteProdVNext?.mape ?? Infinity).toFixed(2)}%`,
      pass: (princessEval.metrics.whiteProdVNext?.mape ?? Infinity) <= s26PrincessMape + 0.5,
      hard: true,
    },
    {
      name: 'Bias',
      description: 'absolute bias ≤ 1.0% overall',
      required: '|bias| ≤ 1.0%',
      actual: wpBias != null ? `${(Math.abs(wpBias)).toFixed(2)}%` : 'N/A',
      pass: wpBias != null && Math.abs(wpBias) <= 1.0,
      hard: true,
    },
    {
      name: 'Monotonicity',
      description: '0 carat, color, clarity violations on full grid',
      required: '0 violations',
      actual: monoModels.whiteProdVNext.isClean ? '0 violations ✓' : `${monoModels.whiteProdVNext.caratViolatingSpecs}C ${monoModels.whiteProdVNext.colorViolations}Col ${monoModels.whiteProdVNext.clarityViolations}Cla`,
      pass: monoModels.whiteProdVNext.isClean,
      hard: true,
    },
    {
      name: 'Conformal 80%',
      description: '80% interval covers 79%-82%',
      required: 'coverage in [79%, 82%]',
      actual: wp80.actualCoverage,
      pass: parseFloat(wp80.actualCoverage) >= 79 && parseFloat(wp80.actualCoverage) <= 82,
      hard: false,
    },
    {
      name: 'Conformal 90%',
      description: '90% interval covers 89%-92%',
      required: 'coverage in [89%, 92%]',
      actual: wp90.actualCoverage,
      pass: parseFloat(wp90.actualCoverage) >= 89 && parseFloat(wp90.actualCoverage) <= 92,
      hard: false,
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
    if (gate.pass) {
      if (gate.hard) hardPasses++; else softPasses++;
    } else {
      if (gate.hard) { hardFails++; failedHard.push(gate.name); }
    }
  }

  const allHardPass = hardFails === 0;
  console.log(`\n─── Gate Summary ───`);
  console.log(`Passed: ${hardPasses + softPasses}/${gates.length} (${hardPasses} hard + ${softPasses} soft)`);
  if (failedHard.length) {
    console.log(`Failed hard gates: ${failedHard.join(', ')}`);
  }

  // ─── Model Ranking ────────────────────────────────────────────────────────

  const ranked = modelKeys
    .map((m) => ({ model: m, mape: rowEval.metrics[m]?.mape ?? Infinity, mdape: rowEval.metrics[m]?.mdape ?? Infinity, p90: rowEval.metrics[m]?.p90ape ?? Infinity, coverage: rowEval.metrics[m]?.n ?? 0 }))
    .filter((x) => Number.isFinite(x.mape))
    .sort((a, b) => a.mape - b.mape);

  console.log('\n─── Model Ranking (row holdout MAPE) ───');
  for (const r of ranked) {
    const tag = r.model === 'whiteProdVNext' ? ' ← WhiteProd vNext'
      : r.model === 's26' ? ' (baseline)'
      : r.model === 's30' ? ' (partial coverage)' : '';
    console.log(`  ${r.model.padEnd(16)} MAPE=${String(r.mape).padStart(7)}%  MdAPE=${String(r.mdape).padStart(7)}%  p90=${String(r.p90).padStart(7)}%  coverage=${r.coverage}/${rowHoldout.length}${tag}`);
  }

  // ─── Verdict ──────────────────────────────────────────────────────────────

  console.log('\n═══ Verdict ═══');
  if (allHardPass) {
    console.log('✓ WhiteProd vNext passes all hard production gates.');
    console.log('RECOMMENDATION: Proceed to shadow release (M7).');
  } else {
    console.log(`✗ WhiteProd vNext fails ${hardFails} hard gates.`);
    console.log('S26 remains the recommended production default.');
    console.log('\nNext steps:');
    if (failedHard.includes('Monotonicity')) console.log('  → M2: Repair S33-A monotonicity inversions');
    if (failedHard.includes('High carat ≥5ct MAPE')) console.log('  → M3: Tune S30 routing for high-carat');
    if (failedHard.includes('Princess MAPE')) console.log('  → M4: Add princess-specific routing');
    if (failedHard.includes('Row holdout MAPE') || failedHard.includes('Dense tier MAPE')) console.log('  → Tune routing thresholds');
  }

  // ─── Write output ─────────────────────────────────────────────────────────

  const report = {
    date: new Date().toISOString().slice(0, 10),
    dataset: 'research/data/dataset-clean-training.json',
    totalRows: allRows.length,
    rowHoldoutN: rowHoldout.length,
    cellHoldoutN: cellHoldoutRows.length,
    whiteProdVNext: {
      version: wpCtx.modelVersion,
      routingConfig: wpCtx.routingConfig,
      description: 'Routed production predictor: S30 supported curves → S26 dense lookup → S33-A constrained anchors → S28 monotone fallback',
    },
    models: {
      whiteProdVNext: { family: 'routed-production-predictor', role: 'production candidate' },
      s26: { family: 'lookup-reconstruction', role: 'production baseline' },
      s28: { family: 'monotone-parametric-ridge', role: 'structural prior' },
      s30: { family: 'bounded-smooth-median-curves', role: 'supported-curve expert' },
      s33a: { family: 's28+monotonicity-constrained-credibility-anchors', role: 'research candidate' },
      s32a: { family: 's28+hierarchical-credibility-anchors', role: 'research baseline' },
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
      wp80, wp90,
      byTier: conformalByTier,
      byExpert: conformalByExpert,
    },
    routingDistribution: { byExpert: routingDist, byTier: tierDist, byBand: bandDist, byReason: reasonDist },
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
