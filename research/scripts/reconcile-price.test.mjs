#!/usr/bin/env node

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  applyBaselineFallbackPolicy,
  applyReconciledCalibration,
  buildReconcileInput,
  reconcileWholesale,
} from '../reconcile-price.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

let passed = 0;
let failed = 0;

function assert(cond, label, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.error(`  bad ${label}${detail ? ': ' + detail : ''}`);
  }
}

function approx(a, b, tol, label) {
  assert(Math.abs(a - b) <= tol, label, `expected ${b} +/- ${tol}, got ${a}`);
}

function loadJson(rel) {
  return JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
}

console.log('R0.1 reconcile-price tests');

{
  const fixture = loadJson('research/fixtures/reconciler-pinned.json');
  const input = applyBaselineFallbackPolicy(fixture.input);
  const result = reconcileWholesale(input);
  assert(result.schemaVersion === 'reconcile-result-v1', 'pinned result schema version');
  assert(result.method === 'rules_v1', 'pinned method');
  assert(result.bandKind === 'heuristic', 'pinned band is heuristic');
  assert(result.calibration === null, 'pinned heuristic has null calibration');
  assert(result.low < result.estimate && result.estimate < result.high, 'pinned range brackets estimate');
  approx(result.weights.baseline + result.weights.comp + result.weights.ml, 1, 0.001, 'pinned weights sum to 1');
  assert(result.weights.baseline === 0, 'pinned baseline omitted when comp and ML are available');
  assert(result.weights.comp > result.weights.ml, 'comp gets more weight than ML on anchored medium-support case');
}

{
  const input = buildReconcileInput({
    query: { carat: 2, segment: 'white', shape: 'oval', whiteGrade: 'E', clarity: 'VS1' },
    baseline: { total: 800 },
    comp: { total: 1000, supportCount: 6, matchType: 'nearest', confidence: 'medium' },
    ml: { total: 900, anchorHit: true, modelName: 'test-ml' },
  });
  const result = reconcileWholesale(input);
  assert(result.estimate > 800 && result.estimate < 1000, 'comp+ML estimate stays inside source envelope');
  assert(result.inputs.baseline === null && result.inputs.comp === 1000 && result.inputs.ml === 900, 'baseline omitted from blend inputs');
  assert(result.weights.baseline === 0, 'baseline weight is zero when comp and ML are available');
  assert(result.warnings.some(w => /baseline source unavailable/i.test(w)), 'baseline omitted warning in result');
}

{
  const input = buildReconcileInput({
    query: { carat: 1.5, segment: 'fancy', shape: 'radiant', colorFamily: 'pink', colorFamilyKey: 'pink_fv', clarity: 'VVS2' },
    baseline: { total: 1800 },
    comp: { total: null, available: false, supportCount: 0, matchType: 'none' },
    ml: { total: 2100, anchorHit: false, modelName: 'color-ml' },
    flags: { specialtyCut: true },
  });
  const result = reconcileWholesale(input);
  assert(result.weights.comp === 0, 'missing comp gets zero weight');
  assert(result.weights.baseline === 0, 'baseline omitted when ML is available');
  assert(result.weights.ml === 1, 'ML-only case uses ML alone');
  assert(result.warnings.some(w => /comp source unavailable/i.test(w)), 'missing comp warning');
  assert(result.warnings.some(w => /ML source has no direct anchor/i.test(w)), 'missing ML anchor warning');
}

{
  const calm = buildReconcileInput({
    query: { carat: 3, segment: 'white', shape: 'round', whiteGrade: 'D', clarity: 'VS1' },
    baseline: { total: 1000 },
    comp: { total: 1050, supportCount: 8, matchType: 'exact', confidence: 'high' },
    ml: { total: 980, anchorHit: true },
  });
  const tense = buildReconcileInput({
    query: { carat: 3, segment: 'white', shape: 'round', whiteGrade: 'D', clarity: 'VS1' },
    baseline: { total: 1000 },
    comp: { total: 1800, supportCount: 2, matchType: 'best_available', confidence: 'low' },
    ml: { total: 900, anchorHit: false },
  });
  const calmResult = reconcileWholesale(calm);
  const tenseResult = reconcileWholesale(tense);
  const calmSpread = calmResult.high / calmResult.low;
  const tenseSpread = tenseResult.high / tenseResult.low;
  assert(tenseSpread > calmSpread, 'high disagreement widens the heuristic band');
  assert(tenseResult.confidence === 'low', 'high disagreement lowers confidence');
}

{
  const input = buildReconcileInput({
    query: { carat: 2, segment: 'white', shape: 'round', whiteGrade: 'E', clarity: 'VS1' },
    baseline: { total: 700 },
    comp: { total: 720, supportCount: 5, matchType: 'nearest', confidence: 'medium' },
    ml: { total: 710, anchorHit: true },
  });
  const result = reconcileWholesale(input);
  const calibrated = applyReconciledCalibration(result, input, {
    version: 'test',
    createdAt: '2026-05-28T00:00:00.000Z',
    targetCoverage: 0.8,
    method: 'split_conformal_log_residual',
    runId: 'test-run',
    segments: {
      white: { qLog: 0.2, reportingCoverage: 0.8, nReport: 100 },
    },
  });
  assert(calibrated.bandKind === 'conformal', 'applyReconciledCalibration marks band conformal');
  assert(calibrated.calibration?.qLog === 0.2, 'calibration metadata is attached');
  assert(calibrated.low < calibrated.estimate && calibrated.estimate < calibrated.high, 'calibrated band brackets estimate');
}

{
  const input = buildReconcileInput({
    query: { carat: 1, segment: 'white', shape: 'emerald', whiteGrade: 'F', clarity: 'VS2' },
    baseline: { total: 300 },
    comp: { total: null, available: false, supportCount: 0, matchType: 'none' },
    ml: { total: null, available: false, anchorHit: null },
  });
  const result = reconcileWholesale(input);
  assert(result.estimate === 300, 'single-source baseline returns baseline estimate');
  assert(result.weights.baseline === 1 && result.weights.comp === 0 && result.weights.ml === 0, 'single-source weights are assigned cleanly');
  assert(result.confidence === 'low', 'single-source result is low confidence');
}

{
  const input = buildReconcileInput({
    query: { carat: 2, segment: 'white', shape: 'round', whiteGrade: 'E', clarity: 'VS1' },
    baseline: { total: 900 },
    comp: { total: 720, supportCount: 5, matchType: 'exact', confidence: 'high' },
    ml: { total: null, available: false, anchorHit: null },
  });
  const result = reconcileWholesale(input);
  assert(result.weights.baseline === 0, 'baseline omitted when comp alone is available');
  assert(result.weights.comp === 1, 'comp-only case uses comp alone');
}

{
  const raw = buildReconcileInput({
    query: { carat: 2, segment: 'white', shape: 'round', whiteGrade: 'E', clarity: 'VS1' },
    baseline: { total: 900 },
    comp: { total: 720, supportCount: 5, matchType: 'exact', confidence: 'high' },
    ml: { total: 710, anchorHit: true },
    baselineFallbackOnly: false,
  });
  const gated = applyBaselineFallbackPolicy(raw);
  const withBaseline = reconcileWholesale(raw);
  const withoutBaseline = reconcileWholesale(gated);
  assert(withBaseline.weights.baseline > 0, 'legacy three-source blend still possible when policy disabled');
  assert(withoutBaseline.weights.baseline === 0, 'policy strips baseline when comp and ML exist');
}

{
  const input = buildReconcileInput({
    query: { carat: 4, segment: 'white', shape: 'oval', whiteGrade: 'D', clarity: 'VVS1' },
    baseline: { total: 2400 },
    comp: { total: 1200, supportCount: 1, matchType: 'best_available', confidence: 'low' },
    ml: { total: 1250, anchorHit: false },
    baselineFallbackOnly: false,
  });
  const result = reconcileWholesale(input);
  assert(result.weights.comp < 0.58, 'sparse best-available comp is capped below normal comp dominance');
  assert(result.warnings.some(w => /Comp source is thin/i.test(w)), 'thin comp warning is emitted');
  assert(result.disagreementRatio > 1.8, 'disagreement ratio captures wide source spread');
}

{
  const input = buildReconcileInput({
    query: { carat: 4, segment: 'white', shape: 'oval', whiteGrade: 'D', clarity: 'VVS1' },
    baseline: { total: 2400 },
    comp: { total: 1200, supportCount: 1, matchType: 'best_available', confidence: 'low' },
    ml: { total: 1250, anchorHit: false },
  });
  const result = reconcileWholesale(input);
  assert(result.weights.baseline === 0, 'weak comp+ML case still omits baseline');
  approx(result.weights.comp + result.weights.ml, 1, 0.001, 'comp and ML renormalize to 1');
}

{
  const input = buildReconcileInput({
    query: { carat: 3.8, segment: 'fancy', shape: 'radiant', colorFamily: 'Fancy Vivid Pink', colorFamilyKey: 'pink_fv', clarity: 'VVS2' },
    baseline: { total: 1900 },
    comp: { total: 1450, supportCount: 5, matchType: 'nearest', confidence: 'high' },
    ml: { total: 1700, anchorHit: false },
  });
  const result = reconcileWholesale(input);
  const calibrated = applyReconciledCalibration(result, input, {
    version: 'test',
    targetCoverage: 0.8,
    method: 'split_conformal_log_residual',
    runId: 'low-support-test',
    segments: { fancy: { qLog: 0.55, reportingCoverage: 0.6, nReport: 5 } },
  });
  assert(calibrated.calibration?.reportingSupport === 'low', 'low reporting support is exposed in calibration metadata');
  assert(calibrated.bandKind === 'conformal', 'low-support calibration still marks statistical band distinctly');
}

if (failed) {
  console.error(`\nreconcile-price tests failed: ${failed}`);
  process.exit(1);
}

console.log(`\nreconcile-price tests passed: ${passed}`);
