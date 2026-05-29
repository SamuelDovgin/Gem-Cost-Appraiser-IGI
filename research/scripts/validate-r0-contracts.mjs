#!/usr/bin/env node
/**
 * validate-r0-contracts.mjs
 *
 * Lightweight Stage 0 gate for R0 contract artifacts. This intentionally avoids
 * external JSON-schema dependencies; it catches broken JSON, missing required
 * files, and the invariants future R0.1/R0.2/R0.3 work depends on.
 */

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const files = {
  inputSchema: 'research/schemas/reconcile-input.schema.json',
  resultSchema: 'research/schemas/reconcile-result.schema.json',
  holdoutSplit: 'research/data/conformal-holdout-split-v1.json',
  reconciledCalibration: 'research/data/reconciled-conformal-calibration-v1.json',
  pinned: 'research/fixtures/reconciler-pinned.json',
  plan: 'research/r0-staged-implementation-plan.md',
  decisions: 'research/r0-decision-log.md',
};

let failed = 0;

function loadJson(rel) {
  return JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
}

function loadText(rel) {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

function assert(cond, label) {
  if (cond) {
    console.log(`  ok  ${label}`);
    return;
  }
  failed++;
  console.error(`  bad ${label}`);
}

console.log('R0 Stage 0 contract validation');

const inputSchema = loadJson(files.inputSchema);
const resultSchema = loadJson(files.resultSchema);
const split = loadJson(files.holdoutSplit);
const reconciledCalibration = loadJson(files.reconciledCalibration);
const pinned = loadJson(files.pinned);
const plan = loadText(files.plan);
const decisions = loadText(files.decisions);

assert(inputSchema.properties?.schemaVersion?.const === 'reconcile-input-v1',
  'input schema version is reconcile-input-v1');
assert(resultSchema.properties?.schemaVersion?.const === 'reconcile-result-v1',
  'result schema version is reconcile-result-v1');
assert(resultSchema.properties?.bandKind?.enum?.includes('heuristic')
  && resultSchema.properties?.bandKind?.enum?.includes('conformal'),
  'result schema has bandKind taxonomy');

assert(split.version === 'conformal-holdout-split-v1', 'holdout split version is frozen');
assert(split.targetCoverage === 0.8, 'holdout split target coverage is 0.8');
assert(Array.isArray(split.calibrationSuppliers) && split.calibrationSuppliers.length > 0,
  'holdout split has calibration suppliers');
assert(Array.isArray(split.reportingSuppliers) && split.reportingSuppliers.length > 0,
  'holdout split has reporting suppliers');
assert(!split.calibrationSuppliers.some(s => split.reportingSuppliers.includes(s)),
  'calibration and reporting suppliers do not overlap');
assert(reconciledCalibration.version === 'reconciled-conformal-v1',
  'reconciled conformal artifact version is v1');
assert(reconciledCalibration.targetCoverage === 0.8,
  'reconciled conformal target coverage is 0.8');
assert(reconciledCalibration.segments?.white?.qLog > 0 && reconciledCalibration.segments?.fancy?.qLog > 0,
  'reconciled conformal segment qLog values are positive');

const expected = pinned.expectedShape;
const weights = expected.weights;
const weightSum = weights.baseline + weights.comp + weights.ml;
assert(pinned.input.schemaVersion === 'reconcile-input-v1', 'pinned input uses v1 schema');
assert(expected.schemaVersion === 'reconcile-result-v1', 'pinned result uses v1 schema');
assert(Math.abs(weightSum - 1) < 0.011, 'pinned weights sum to approximately 1');
assert(expected.low < expected.estimate && expected.estimate < expected.high,
  'pinned result has low < estimate < high');
assert(expected.bandKind === 'heuristic', 'pinned result is heuristic');
assert(expected.calibration === null, 'pinned heuristic result has null calibration');

assert(plan.includes('Stage 0 - Contract Baseline'), 'staged plan includes Stage 0');
assert(plan.includes('Stage 1 - R0.1 Rules Reconciler'), 'staged plan includes Stage 1');
assert(decisions.includes('DL-001 - Channel Toggles'), 'decision log covers channel toggles');
assert(decisions.includes('DL-006 - Heuristic Band Language'), 'decision log covers heuristic copy');

if (failed) {
  console.error(`\nR0 contract validation failed: ${failed} issue(s).`);
  process.exit(1);
}

console.log('\nR0 contract validation passed.');
