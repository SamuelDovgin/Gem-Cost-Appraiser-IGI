#!/usr/bin/env node
/**
 * Multi-split evaluation for latest white-diamond pricing models (S26, S28, S29, S30, S31).
 *
 * Split protocols (ML best practice for tabular / grouped inventory):
 *   1. rowHoldout       — reportHash % 5 (canonical; matches S28 trainer)
 *   2. cellHoldout      — whole benchmark cells held out (shape||color||clarity||carat_band)
 *   3. leaveShapeOut    — hold out one shape_style at a time (generalization)
 *   4. highCarat        — carat >= 5ct on holdout rows
 *   5. sparseSupport    — train-cell count < 5 (evaluated on row holdout)
 *   6. selectedSpec     — strip lw/table/depth (app inference mode)
 *
 * Fairness notes are embedded per model (lookup vs train-on-all artifact).
 *
 * Usage:
 *   node research/scripts/benchmark-comprehensive-latest.mjs
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { starsgemNorm, starsgemCaratBucket } from './starsgem-ml-predict.mjs';
import { predictS28 } from './s28-predict.mjs';
import { predictS29, s29BenchmarkCellKey } from './s29-predict.mjs';
import { predictS30 } from './s30-predict.mjs';
import { predictS31, s31PredictionInput } from './s31-predict.mjs';
import { predictS32 } from './s32-predict.mjs';
import { buildS30Artifact } from './train-s30-bounded-smooth.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, '../data');
const OUT = path.join(DATA, 'benchmark-comprehensive-latest.json');

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

function stats(apes, signed = []) {
  if (!apes.length) {
    return { n: 0, mape: null, mdape: null, p90ape: null, biasPct: null };
  }
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

function accumulate(records, modelKey, pred, actual) {
  if (!Number.isFinite(pred) || pred <= 0 || !Number.isFinite(actual) || actual <= 0) return;
  const a = ape(pred, actual);
  const s = ((pred - actual) / actual) * 100;
  if (!records[modelKey]) records[modelKey] = { apes: [], signed: [] };
  records[modelKey].apes.push(a);
  records[modelKey].signed.push(s);
}

function finalize(records) {
  const out = {};
  for (const [k, v] of Object.entries(records)) {
    out[k] = stats(v.apes, v.signed);
  }
  return out;
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
    const key = table.fields.map((field) => normalized[field] ?? '-').join('||');
    const hit = table.groups?.[key];
    if (hit) {
      const price = (carat * hit.rate) / 170;
      return { price, lookupLevel: table.level, lookupCount: hit.count };
    }
  }
  const rate = Number(intel.lookup?.globalMedianInternalRatePerCt) / 170;
  return rate > 0 ? { price: carat * rate, lookupLevel: 'GLOBAL', lookupCount: 0 } : null;
}

function rowInput(raw, selectedSpec = false) {
  const base = {
    carat: Number(raw.carat),
    shape_style: String(raw.shape_style || `${raw.shape || 'ROUND'}_STANDARD`).toLowerCase(),
    color: raw.color,
    clarity: raw.clarity,
    cut_raw: raw.cut_raw,
    typeName: raw.typeName || 'CVD',
    polish: raw.polish || 'EX',
    symmetry: raw.symmetry || 'EX',
    Shape: raw.shape,
    raw_shape_code: raw.raw_shape_code,
  };
  if (selectedSpec) return base;
  return {
    ...base,
    lw_ratio: raw.lw_ratio,
    table_pct: raw.table_pct,
    depth_pct: raw.depth_pct,
    LengthWidthRatio: raw.lw_ratio,
    Table_Scale: raw.table_pct,
    Depth_Scale: raw.depth_pct,
  };
}

/** Cells used for S29 training (cell_hash/1000 >= holdoutFrac); matches train-s29-hybrid.py train_cells. */
function buildS29TrainCells(allRows, holdoutFrac = 0.2) {
  const cells = new Set();
  for (const row of allRows) {
    const key = s29BenchmarkCellKey({
      carat: row.carat,
      shape_style: row.shape_style,
      color: row.color,
      clarity: row.clarity,
    });
    if (cellHash(key) / 1000 >= holdoutFrac) cells.add(key);
  }
  return cells;
}

function predictAll(raw, ctx) {
  const actual = Number(raw.price);
  const full = rowInput(raw, false);
  const selected = rowInput(raw, true);
  const s31in = s31PredictionInput(raw);

  const s26 = s26LookupPrediction(raw, ctx.intel);
  const s28 = predictS28(s31PredictionInput(raw), ctx.s28);
  const s29 = predictS29(full, ctx.s29, { trainBenchmarkCells: ctx.trainBenchmarkCells });
  const s30 = predictS30(full, ctx.s30Model);
  const s31 = predictS31(s31in, ctx.s31);
  const s32a = ctx.s32a ? predictS32(s31in, ctx.s32a) : null;

  const s28Selected = predictS28(s31PredictionInput({ ...raw, lw_ratio: null, table_pct: null, depth_pct: null }), ctx.s28);
  const s29Selected = predictS29(selected, ctx.s29, { trainBenchmarkCells: ctx.trainBenchmarkCells });

  return {
    actual,
    s26: s26?.price ?? null,
    s28: s28?.price ?? null,
    s29: s29?.price ?? null,
    s30: s30?.price ?? null,
    s31: s31?.price ?? null,
    s32a: s32a?.price ?? null,
    s28Selected: s28Selected?.price ?? null,
    s29Selected: s29Selected?.price ?? null,
    s30HasCurve: Boolean(s30?.price > 0),
    s30Bounded: Boolean(s30?.bounded),
    lookupLevel: s26?.lookupLevel ?? null,
    lookupCount: s26?.lookupCount ?? 0,
  };
}

function evaluateRows(rows, ctx, filterFn = () => true) {
  const buckets = {};
  const add = (slice, preds) => {
    if (!buckets[slice]) buckets[slice] = {};
    for (const [k, price] of Object.entries(preds)) {
      if (k === 'actual') continue;
      accumulate(buckets[slice], k, price, preds.actual);
    }
  };

  const modelKeys = ['s26', 's28', 's29', 's30', 's31', 's32a'];
  for (const raw of rows) {
    if (!filterFn(raw)) continue;
    const p = predictAll(raw, ctx);
    const preds = { actual: p.actual };
    for (const k of modelKeys) preds[k] = p[k];
    add('all', preds);
    if (p.s28Selected != null) {
      add('selectedSpec', { actual: p.actual, s28: p.s28Selected, s29: p.s29Selected });
    }
  }
  const out = {};
  for (const [slice, rec] of Object.entries(buckets)) {
    out[slice] = finalize(rec);
  }
  return out;
}

function supportCounts(trainRows) {
  const m = new Map();
  for (const r of trainRows) {
    const k = benchmarkCellKey(r);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

function main() {
  const allRows = loadJson('dataset-clean-training.json');
  const intel = loadJson('starsgem-pricing-intelligence.json');
  const s28 = loadJson('starsgem-ml-model-s28-monotone-parametric.json');
  const s29 = loadJson('starsgem-ml-model-s29-hybrid.json');
  const s31 = loadJson('starsgem-ml-model-s31-guarded-anchor.json');
  const s32a = loadJson('starsgem-ml-model-s32a-anchors.json');
  const s30Shipped = loadJson('starsgem-ml-model-s30-bounded-smooth.json');

  const rowHoldout = allRows.filter((r) => reportHash(r) % HOLDOUT_MOD === 0);
  const rowTrain = allRows.filter((r) => reportHash(r) % HOLDOUT_MOD !== 0);
  const cellHoldoutFrac = s29.configuration?.cellHoldoutFrac ?? 0.2;
  const s29CellKey = (r) => s29BenchmarkCellKey({
    carat: r.carat,
    shape_style: r.shape_style,
    color: r.color,
    clarity: r.clarity,
  });
  const cellHoldoutRows = allRows.filter((r) => cellHash(s29CellKey(r)) / 1000 < cellHoldoutFrac);
  const cellTrainRows = allRows.filter((r) => cellHash(s29CellKey(r)) / 1000 >= cellHoldoutFrac);

  const trainBenchmarkCells = buildS29TrainCells(allRows, s29.configuration?.cellHoldoutFrac ?? 0.2);
  const trainSupport = supportCounts(rowTrain);

  const ctxShippedS30 = {
    intel,
    s28,
    s29,
    s31,
    s32a,
    trainBenchmarkCells,
    s30Model: s30Shipped,
  };
  const ctxFairS30 = {
    ...ctxShippedS30,
    s30Model: buildS30Artifact(rowTrain),
  };

  const models = ['s26', 's28', 's29', 's30', 's31', 's32a'];

  const report = {
    date: new Date().toISOString().slice(0, 10),
    dataset: 'research/data/dataset-clean-training.json',
    totalRows: allRows.length,
    models: {
      s26: { family: 'lookup-reconstruction', trainsOnData: false, notes: 'Uses starsgem-pricing-intelligence.json; no row leakage' },
      s28: { family: 'monotone parametric ridge', trainsOnData: true, notes: 'Artifact fit on train rows only (reportHash holdout in Python trainer)' },
      s29: { family: 'surface + EB offsets + monotone LightGBM residual', trainsOnData: true, notes: 'Cell holdout during training; held-out cells → pure S28 surface' },
      s30: { family: 'bounded smooth median curves', trainsOnData: true, notes: 'Report both shipped (optimistic) and train-only curve rebuild' },
      s31: { family: 'S28 + guarded monotone anchor grid', trainsOnData: true, notes: 'Trained on row train split; anchor offsets shrunk' },
      s32a: { family: 'S28 + hierarchical credibility anchors (S32-A)', trainsOnData: true, notes: 'Cross-fitted OOF anchors; 5 hierarchical levels with level caps. Pre-PAV — monotonicity fixed in S32-C.' },
    },
    splits: {
      rowHoldout: {
        description: 'reportHash(row) % 5 === 0 (~20%, matches S28 trainer)',
        n: rowHoldout.length,
        shippedS30: evaluateRows(rowHoldout, ctxShippedS30),
        fairS30: evaluateRows(rowHoldout, ctxFairS30),
      },
      cellHoldout: {
        description: 'cellHash/1000 < 0.2 (S29 held-out cells only; tests cold-cell generalization)',
        n: cellHoldoutRows.length,
        metrics: evaluateRows(cellHoldoutRows, ctxFairS30),
      },
      cellTrain: {
        description: 'cellHash/1000 >= 0.2 (S29 trained cells; in-sample cell accuracy)',
        n: cellTrainRows.length,
        metrics: evaluateRows(cellTrainRows, ctxFairS30),
      },
      highCaratHoldout: {
        description: 'Row holdout with carat >= 5',
        n: rowHoldout.filter((r) => Number(r.carat) >= 5).length,
        metrics: evaluateRows(rowHoldout, ctxFairS30, (r) => Number(r.carat) >= 5),
      },
      sparseSupportHoldout: {
        description: 'Row holdout where train support for benchmark cell < 5 rows',
        metrics: evaluateRows(
          rowHoldout,
          ctxFairS30,
          (r) => (trainSupport.get(benchmarkCellKey(r)) || 0) < 5,
        ),
      },
      globalLookupHoldout: {
        description: 'Row holdout where S26 hits GLOBAL fallback',
        metrics: evaluateRows(rowHoldout, ctxFairS30, (r) => {
          const p = predictAll(r, ctxFairS30);
          return p.lookupLevel === 'GLOBAL';
        }),
      },
      selectedSpecRowHoldout: {
        description: 'Row holdout, app mode (no lw/table/depth) — S28/S29 only in slice',
        metrics: evaluateRows(rowHoldout, ctxFairS30).selectedSpec ?? {},
      },
    },
    leaveShapeOut: {},
    s28EmbeddedHoldout: s28.metrics?.holdout ?? null,
    winners: {},
  };

  // Leave-one-shape-out (top shapes by volume)
  const shapeCounts = new Map();
  for (const r of allRows) {
    const s = String(r.shape_style || '').toLowerCase();
    shapeCounts.set(s, (shapeCounts.get(s) || 0) + 1);
  }
  const topShapes = [...shapeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([s]) => s);

  for (const shape of topShapes) {
    const held = allRows.filter((r) => String(r.shape_style || '').toLowerCase() === shape);
    report.leaveShapeOut[shape] = {
      n: held.length,
      metrics: evaluateRows(held, ctxFairS30),
    };
  }

  // Rank models on row holdout (fair S30)
  const rowMetrics = report.splits.rowHoldout.fairS30.all || {};
  report.winners.rowHoldoutFair = models
    .map((m) => ({ model: m, mape: rowMetrics[m]?.mape ?? Infinity }))
    .filter((x) => Number.isFinite(x.mape))
    .sort((a, b) => a.mape - b.mape);

  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);

  console.log('COMPREHENSIVE LATEST-MODEL BENCHMARK');
  console.log('====================================\n');
  console.log(`Dataset rows: ${allRows.length}`);
  console.log(`Row holdout: ${rowHoldout.length} | S29 cell holdout: ${cellHoldoutRows.length}\n`);

  const printSlice = (title, slice) => {
    console.log(title);
    for (const m of models) {
      const s = slice?.[m];
      if (!s?.n) continue;
      console.log(
        `  ${m.padEnd(4)} MAPE=${String(s.mape).padStart(7)}%  MdAPE=${String(s.mdape).padStart(7)}%  p90=${String(s.p90ape).padStart(7)}%  bias=${String(s.biasPct).padStart(7)}%  n=${s.n}`,
      );
    }
    console.log('');
  };

  printSlice('Row holdout (fair S30 curves):', report.splits.rowHoldout.fairS30.all);
  printSlice('Row holdout (shipped S30 — optimistic):', report.splits.rowHoldout.shippedS30.all);
  printSlice('S29 cell holdout (cold cells):', report.splits.cellHoldout.metrics.all);
  printSlice('S29 cell train (warm cells):', report.splits.cellTrain.metrics.all);
  printSlice('High carat (>=5ct, row holdout):', report.splits.highCaratHoldout.metrics.all);
  printSlice('Sparse support (<5 train rows/cell):', report.splits.sparseSupportHoldout.metrics.all);
  printSlice('S26 GLOBAL fallback rows:', report.splits.globalLookupHoldout.metrics.all);

  console.log('Leave-shape-out (fair S30), top shapes:');
  for (const shape of topShapes) {
    const s26 = report.leaveShapeOut[shape]?.metrics?.all?.s26;
    const s31 = report.leaveShapeOut[shape]?.metrics?.all?.s31;
    if (!s26?.n) continue;
    console.log(
      `  ${shape.padEnd(22)} n=${String(s26.n).padStart(5)}  S26=${s26.mape}%  S31=${s31?.mape ?? 'n/a'}%`,
    );
  }

  console.log(`\nWrote ${path.relative(process.cwd(), OUT)}`);
}

main();
