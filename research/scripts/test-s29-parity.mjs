/**
 * S29 artifact smoke/parity test.
 *
 * This validates that the JSON artifact contains the state required by the
 * standalone Node predictor and that benchmark-held-out cells are scored as
 * pure surface predictions.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { predictS29, s29BenchmarkCellKey } from './s29-predict.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '..', 'data');

function loadJson(name) {
  return JSON.parse(readFileSync(path.join(DATA, name), 'utf8'));
}

function cellHash(key) {
  return Number(BigInt(`0x${createHash('md5').update(key).digest('hex')}`) % 1000n);
}

function buildTrainBenchmarkCells(rows, model) {
  const holdoutFrac = Number(model.configuration?.cellHoldoutFrac ?? 0.2);
  const cells = new Set();
  for (const row of rows) {
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

function asPredictionRow(row) {
  return {
    carat: row.carat,
    shape_style: row.shape_style,
    color: row.color,
    clarity: row.clarity,
    cut_raw: row.cut_raw,
    polish: row.polish,
    symmetry: row.symmetry,
    typeName: row.typeName,
    lw_ratio: row.lw_ratio,
    table_pct: row.table_pct,
    depth_pct: row.depth_pct,
  };
}

const model = loadJson('starsgem-ml-model-s29-hybrid.json');
const rows = loadJson('dataset-clean-training.json');
const trainBenchmarkCells = buildTrainBenchmarkCells(rows, model);

console.log('S29 Artifact Parity Test');
console.log('=======================\n');

const checks = [
  {
    label: 'surfaceModel.featureNames',
    ok: Array.isArray(model.surfaceModel?.featureNames) && model.surfaceModel.featureNames.length > 0,
  },
  {
    label: 'surfaceModel.coefficients',
    ok: typeof model.surfaceModel?.coefficients === 'object' && Object.keys(model.surfaceModel.coefficients).length > 0,
  },
  {
    label: 'surfaceModel.featureMeans',
    ok: Array.isArray(model.surfaceModel?.featureMeans)
      && model.surfaceModel.featureMeans.length === model.surfaceModel.featureNames.length,
  },
  {
    label: 'surfaceModel.featureStds',
    ok: Array.isArray(model.surfaceModel?.featureStds)
      && model.surfaceModel.featureStds.length === model.surfaceModel.featureNames.length,
  },
  {
    label: 'anchors.baseAnchors',
    ok: typeof model.anchors?.baseAnchors === 'object' && Object.keys(model.anchors.baseAnchors).length > 0,
  },
  {
    label: 'anchors.cutStratifiedAnchors',
    ok: typeof model.anchors?.cutStratifiedAnchors === 'object',
  },
  {
    label: 'residualModel.lightgbmDump',
    ok: model.residualModel?.lightgbmDump?.tree_info?.length > 0,
  },
];

let allOk = true;
for (const check of checks) {
  console.log(`  ${check.ok ? 'PASS' : 'FAIL'} ${check.label}`);
  if (!check.ok) allOk = false;
}

let tested = 0;
let residualNonZero = 0;
let heldOutChecked = false;
let heldOutOk = true;

console.log('\nPrediction samples:');
for (const row of rows) {
  const carat = Number(row.carat);
  const upc = Number(row.upc);
  if (!carat || carat <= 0 || !upc || upc <= 0) continue;
  if (tested >= 12 && heldOutChecked && residualNonZero > 0) break;

  const key = s29BenchmarkCellKey(asPredictionRow(row));
  const heldOut = !trainBenchmarkCells.has(key);
  const pred = predictS29(asPredictionRow(row), model, { trainBenchmarkCells });
  if (!pred?.upc) continue;

  if (tested < 12) {
    console.log(
      `  ${key}: $${pred.upc.toFixed(0)}/ct actual=$${upc.toFixed(0)}/ct`
      + ` source=${pred.anchorSource} residual=${pred.residual.toFixed(5)} held_out=${heldOut}`,
    );
    tested += 1;
  }
  if (Math.abs(pred.residual || 0) > 1e-9) residualNonZero += 1;
  if (heldOut) {
    heldOutChecked = true;
    if (pred.anchorSource !== 'surface_held_out' || pred.shrinkWeight !== 0 || pred.residual !== 0) {
      heldOutOk = false;
    }
  }
}

const behavioralChecks = [
  { label: 'predictS29 generates sample predictions', ok: tested > 0 },
  { label: 'LightGBM residual participates on supported cells', ok: residualNonZero > 0 },
  { label: 'held-out benchmark cells force pure surface', ok: heldOutChecked && heldOutOk },
];

for (const check of behavioralChecks) {
  console.log(`  ${check.ok ? 'PASS' : 'FAIL'} ${check.label}`);
  if (!check.ok) allOk = false;
}

console.log(`\n  Train benchmark cells: ${trainBenchmarkCells.size}`);
console.log(`\nParity test result: ${allOk ? 'PASS' : 'FAIL'}`);
if (!allOk) process.exit(1);
