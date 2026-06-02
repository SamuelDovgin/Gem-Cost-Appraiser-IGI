#!/usr/bin/env node
/**
 * Train S32-C — PAV lattice projection for monotonicity guarantee.
 *
 * Builds PAV-projected grids from S32-A predictions and benchmarks
 * pre-PAV (raw anchors) vs post-PAV (grid interpolation) MAPE.
 *
 * The grid stores projected log($/ct) values at carat band midpoints.
 * At prediction time, interpolation in log-carat space preserves monotonicity.
 * This is the same proven approach S31 uses.
 *
 * Usage:
 *   node research/scripts/train-s32c-pav.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { starsgemNorm } from './starsgem-ml-predict.mjs';
import { predictS28 } from './s28-predict.mjs';
import { predictS32 } from './s32-predict.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DATA = path.join(ROOT, 'research/data');
const OUT_MODEL = path.join(DATA, 'starsgem-ml-model-s32c-pav.json');
const OUT_BENCH = path.join(DATA, 'benchmark-s32c-pav.json');

const COLORS = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];
const CLARITIES = ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2'];
const HOLDOUT_MOD = 5;

const CARAT_BANDS = [
  { lo: 1.0, hi: 1.49, label: '1.00-1.49' },
  { lo: 1.5, hi: 1.99, label: '1.50-1.99' },
  { lo: 2.0, hi: 2.99, label: '2.00-2.99' },
  { lo: 3.0, hi: 3.99, label: '3.00-3.99' },
  { lo: 4.0, hi: 4.99, label: '4.00-4.99' },
  { lo: 5.0, hi: 9.99, label: '5.00-9.99' },
  { lo: 10.0, hi: 99.99, label: '10.00+' },
];

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

function ape(pred, actual) {
  return Math.abs(pred - actual) / actual * 100;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
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

// ─── PAV Projection ──────────────────────────────────────────────────────────

function pavIncreasing(values, weights = values.map(() => 1)) {
  const blocks = values.map((value, idx) => ({ value, weight: weights[idx] || 1, start: idx, end: idx }));
  for (let i = 0; i < blocks.length - 1;) {
    if (blocks[i].value <= blocks[i + 1].value + 1e-12) { i++; continue; }
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

function projectCube(cube, nIter = 30) {
  const C = COLORS.length;
  const L = CLARITIES.length;
  const B = CARAT_BANDS.length;
  for (let iter = 0; iter < nIter; iter++) {
    // Carat: non-decreasing within each (color, clarity)
    for (let c = 0; c < C; c++)
      for (let l = 0; l < L; l++) {
        const vals = CARAT_BANDS.map((_, b) => cube[c][l][b]);
        const proj = pavIncreasing(vals);
        for (let b = 0; b < B; b++) cube[c][l][b] = proj[b];
      }
    // Color: better (lower index) → higher $/ct
    for (let l = 0; l < L; l++)
      for (let b = 0; b < B; b++) {
        const vals = COLORS.map((_, c) => -cube[c][l][b]);
        const proj = pavIncreasing(vals).map((v) => -v);
        for (let c = 0; c < C; c++) cube[c][l][b] = proj[c];
      }
    // Clarity: better (lower index) → higher $/ct
    for (let c = 0; c < C; c++)
      for (let b = 0; b < B; b++) {
        const vals = CLARITIES.map((_, l) => -cube[c][l][b]);
        const proj = pavIncreasing(vals).map((v) => -v);
        for (let l = 0; l < L; l++) cube[c][l][b] = proj[l];
      }
  }
}

// ─── Build PAV Grids ─────────────────────────────────────────────────────────

function buildPavGrid(s32aModel, s28Model) {
  // Collect all shapes from anchors
  const shapes = new Set();
  for (const anchorDict of s32aModel.anchors) {
    for (const key of Object.keys(anchorDict)) {
      if (key === '__global__') continue;
      const parts = key.split('||');
      if (parts.length >= 1) shapes.add(parts[0]);
    }
  }

  const grids = {};

  for (const shape of shapes) {
    // Build raw cube from S32-A predictions at band midpoints
    const raw = COLORS.map(() => CLARITIES.map(() => CARAT_BANDS.map(() => null)));

    for (let c = 0; c < COLORS.length; c++) {
      for (let l = 0; l < CLARITIES.length; l++) {
        for (let b = 0; b < CARAT_BANDS.length; b++) {
          const color = COLORS[c];
          const clarity = CLARITIES[l];
          const band = CARAT_BANDS[b];
          const carat = band.lo + (band.hi - band.lo) / 2;

          // Use S32-A prediction at this grid point
          const row = {
            carat,
            shape_style: shape,
            color,
            clarity,
            cut_raw: 'EX',
            polish: 'EX',
            symmetry: 'EX',
            typeName: 'CVD',
            lw_ratio: null,
            table_pct: null,
            depth_pct: null,
          };

          const pred = predictS32(row, s32aModel);
          if (pred?.upc && pred.upc > 0) {
            raw[c][l][b] = Math.log(pred.upc);
          }
        }
      }
    }

    // Fill nulls with S28-only predictions
    for (let c = 0; c < COLORS.length; c++) {
      for (let l = 0; l < CLARITIES.length; l++) {
        for (let b = 0; b < CARAT_BANDS.length; b++) {
          if (raw[c][l][b] == null) {
            const color = COLORS[c];
            const clarity = CLARITIES[l];
            const band = CARAT_BANDS[b];
            const carat = band.lo + (band.hi - band.lo) / 2;
            const s28 = predictS28({
              carat, Carat: carat,
              shape_style: shape, Shape_Style: shape,
              color, Color: color,
              clarity, Clarity: clarity,
              cut_raw: 'EX', Cut: 'EX',
              polish: 'EX', symmetry: 'EX',
              typeName: 'CVD', TypeName: 'CVD',
            }, s28Model);
            raw[c][l][b] = s28?.upc ? Math.log(s28.upc) : 0;
          }
        }
      }
    }

    // PAV-project
    const projected = raw.map((cs) => cs.map((ls) => [...ls]));
    projectCube(projected);

    // Store as lookup
    const grid = {};
    for (let c = 0; c < COLORS.length; c++) {
      grid[COLORS[c]] = {};
      for (let l = 0; l < CLARITIES.length; l++) {
        grid[COLORS[c]][CLARITIES[l]] = projected[c][l].map((v) => +v.toFixed(8));
      }
    }

    grids[shape] = { grid, bandMids: CARAT_BANDS.map((b) => (b.lo + b.hi) / 2) };
  }

  return grids;
}

// ─── Grid-based predictor ────────────────────────────────────────────────────

function predictFromGrid(row, gridData, s28Model) {
  if (!gridData) return null;
  const carat = Number(row.carat ?? row.Carat);
  const color = starsgemNorm(row.color);
  const clarity = starsgemNorm(row.clarity);

  const colorSlice = gridData.grid[color];
  if (!colorSlice) return null;
  const series = colorSlice[clarity];
  if (!series?.length) return null;

  const logCarat = Math.log(Math.max(0.01, carat));
  const logMids = gridData.bandMids.map((m) => Math.log(m));

  let logUpc;
  if (logCarat <= logMids[0]) {
    logUpc = series[0];
  } else if (logCarat >= logMids[logMids.length - 1]) {
    logUpc = series[series.length - 1];
  } else {
    for (let i = 1; i < logMids.length; i++) {
      if (logCarat <= logMids[i]) {
        const t = (logCarat - logMids[i - 1]) / Math.max(1e-9, logMids[i] - logMids[i - 1]);
        logUpc = series[i - 1] * (1 - t) + series[i] * t;
        break;
      }
    }
  }

  if (logUpc == null || !Number.isFinite(logUpc)) return null;
  const upc = Math.exp(logUpc);
  const price = upc * carat;
  if (!Number.isFinite(price) || price <= 0) return null;

  return { price, upc };
}

// ─── Monotonicity scan ───────────────────────────────────────────────────────

function monotonicityScan(grids) {
  const sweep = [1, 1.5, 2, 3, 4, 5, 7, 10, 15, 20, 30];

  let caratViolations = 0;
  const caratTotal = COLORS.length * CLARITIES.length;

  // Use round_standard grid for scan
  const gridData = grids['round_standard'];
  if (!gridData) {
    return { caratSpecs: 56, caratViolatingSpecs: -1, colorViolations: -1, clarityViolations: -1 };
  }

  for (const color of COLORS) {
    for (const clarity of CLARITIES) {
      const vals = sweep.map((carat) => {
        const r = { carat, shape_style: 'round_standard', color, clarity };
        const pred = predictFromGrid(r, gridData);
        return pred?.upc ?? null;
      });
      for (let i = 1; i < vals.length; i++) {
        if (vals[i] != null && vals[i - 1] != null && vals[i] + 1e-6 < vals[i - 1]) {
          caratViolations++;
          break;
        }
      }
    }
  }

  // Color violations
  let colorViolations = 0;
  for (const clarity of CLARITIES) {
    for (const carat of [1, 2, 3, 5, 10]) {
      const vals = COLORS.map((color) => {
        const r = { carat, shape_style: 'round_standard', color, clarity };
        const pred = predictFromGrid(r, gridData);
        return pred?.upc ?? null;
      });
      for (let i = 1; i < vals.length; i++) {
        if (vals[i] != null && vals[i - 1] != null && vals[i] > vals[i - 1] + 1e-6) {
          colorViolations++;
        }
      }
    }
  }

  // Clarity violations
  let clarityViolations = 0;
  for (const color of COLORS) {
    for (const carat of [1, 2, 3, 5, 10]) {
      const vals = CLARITIES.map((clarity) => {
        const r = { carat, shape_style: 'round_standard', color, clarity };
        const pred = predictFromGrid(r, gridData);
        return pred?.upc ?? null;
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

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('─── S32-C PAV Lattice Training ───\n');

  const allRows = loadJson('dataset-clean-training.json');
  const s28Model = loadJson('starsgem-ml-model-s28-monotone-parametric.json');
  const s32aModel = loadJson('starsgem-ml-model-s32a-anchors.json');

  const rowHoldout = allRows.filter((r) => reportHash(r) % HOLDOUT_MOD === 0);

  // Build PAV grids from S32-A predictions
  console.log('Building PAV-projected grids...');
  const pavGrids = buildPavGrid(s32aModel, s28Model);
  const gridShapes = Object.keys(pavGrids);
  console.log(`Grids built for ${gridShapes.length} shapes`);

  // Build S32-C artifact
  const artifact = {
    generatedDate: new Date().toISOString().slice(0, 10),
    modelName: 'S32-C — S32-A anchors + PAV lattice projection',
    modelVersion: 's32c-pav-v0.1',
    targetType: 'surface_plus_hierarchical_credibility_anchors_plus_pav',
    surfaceModel: s32aModel.surfaceModel,
    anchors: s32aModel.anchors,
    anchorLevels: s32aModel.anchorLevels,
    colors: COLORS,
    clarities: CLARITIES,
    caratBands: CARAT_BANDS,
    hyperparameters: s32aModel.hyperparameters,
    pavGrids,
  };

  // Evaluate pre-PAV (S32-A raw) vs post-PAV (grid interpolation) on row holdout
  console.log('\nEvaluating pre-PAV vs post-PAV...');

  const records = [];
  for (const row of rowHoldout) {
    const carat = Number(row.carat);
    const shape = String(row.shape_style || 'round_standard').trim().toLowerCase();
    const color = starsgemNorm(row.color);
    const clarity = starsgemNorm(row.clarity);

    // Pre-PAV: raw S32-A prediction
    const prePav = predictS32(row, s32aModel);

    // Post-PAV: grid interpolation
    const gridData = pavGrids[shape];
    const postPav = gridData ? predictFromGrid(row, gridData, s28Model) : null;

    records.push({
      actual: Number(row.price),
      prePav: prePav?.price ?? null,
      postPav: postPav?.price ?? null,
      shape,
      carat,
    });
  }

  const prePavMetrics = metric(records, 'prePav');
  const postPavMetrics = metric(records, 'postPav');

  console.log(`Pre-PAV  (S32-A raw):    MAPE=${prePavMetrics.mape}%  MdAPE=${prePavMetrics.mdape}%  p90=${prePavMetrics.p90ape}%`);
  console.log(`Post-PAV (grid interp):  MAPE=${postPavMetrics.mape}%  MdAPE=${postPavMetrics.mdape}%  p90=${postPavMetrics.p90ape}%`);

  const pavGap = postPavMetrics.mape - prePavMetrics.mape;
  console.log(`PAV gap: ${pavGap > 0 ? '+' : ''}${pavGap.toFixed(2)}pp`);

  // By shape
  console.log('\nBy shape (post-PAV):');
  for (const shape of ['round_standard', 'oval_standard', 'pear_standard', 'emerald_standard', 'princess_standard', 'marquise_standard']) {
    const subset = records.filter((r) => r.shape === shape);
    if (subset.length < 10) continue;
    const preM = metric(subset, 'prePav');
    const postM = metric(subset, 'postPav');
    console.log(`  ${shape} (n=${subset.length}): pre=${preM.mape}% post=${postM.mape}% gap=${(postM.mape - preM.mape).toFixed(2)}pp`);
  }

  // Monotonicity
  console.log('\n─── Monotonicity Scan (Post-PAV) ───');
  const mono = monotonicityScan(pavGrids);
  console.log(`Carat: ${mono.caratViolatingSpecs}/${mono.caratSpecs} specs with inversions`);
  console.log(`Color violations: ${mono.colorViolations}`);
  console.log(`Clarity violations: ${mono.clarityViolations}`);

  // Assessment
  const monoPass = mono.caratViolatingSpecs === 0 && mono.colorViolations === 0 && mono.clarityViolations === 0;
  const pavGapOk = Math.abs(pavGap) < 0.5;

  console.log('\n─── S32-C Assessment ───');
  console.log(`Monotonicity: ${monoPass ? '✓ ZERO violations' : '✗ HAS violations'}`);
  console.log(`PAV MAPE gap: ${pavGapOk ? '✓ <0.5pp' : '✗ ≥0.5pp'} (${pavGap > 0 ? '+' : ''}${pavGap.toFixed(2)}pp)`);
  console.log(`Pre-PAV vs Post-PAV MAPE gap is ${Math.abs(pavGap) < 0.5 ? 'acceptable' : 'a DIAGNOSTIC — model is fighting constraints'}`);

  // Write outputs
  writeFileSync(OUT_MODEL, JSON.stringify(artifact, null, 2) + '\n');

  const benchmark = {
    date: new Date().toISOString().slice(0, 10),
    model: artifact.modelVersion,
    phase: 'S32-C',
    prePav: prePavMetrics,
    postPav: postPavMetrics,
    pavGap: +pavGap.toFixed(4),
    monotonicity: mono,
    monotonicityPass: monoPass,
    pavGapOk,
  };

  writeFileSync(OUT_BENCH, JSON.stringify(benchmark, null, 2) + '\n');

  console.log(`\nWrote ${OUT_MODEL.name}`);
  console.log(`Wrote ${OUT_BENCH.name}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
