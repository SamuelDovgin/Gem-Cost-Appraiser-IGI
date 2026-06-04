/**
 * Regression checks for DiamondProd vNext unified predictor.
 *
 * Verifies:
 *   - Branch classification accuracy
 *   - White routing unchanged
 *   - Color routing works
 *   - Unified output contract
 *   - No white input uses color fallback
 *   - No color input uses white fallback
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  loadDiamondProdVNext,
  predictDiamondProdVNext,
  predictDiamondProdVNextBatch,
  classifyColorFamily,
} from './predict-diamond-prod-vnext.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, '..', 'data');

function loadJson(name) {
  return JSON.parse(readFileSync(path.join(DATA, name), 'utf8'));
}

// ─── Classification ──────────────────────────────────────────────────────────

assert.equal(classifyColorFamily({ color: 'E' }), 'white');
assert.equal(classifyColorFamily({ color: 'D' }), 'white');
assert.equal(classifyColorFamily({ color: 'K' }), 'white');
assert.equal(classifyColorFamily({ color: 'H' }), 'white');
assert.equal(classifyColorFamily({ colorHue: 'pink' }), 'fancy-color');
assert.equal(classifyColorFamily({ colorIntensity: 'vivid' }), 'fancy-color');
assert.equal(classifyColorFamily({ color: 'Fancy Vivid Yellow' }), 'fancy-color');
assert.equal(classifyColorFamily({ colorFamily: 'fancy' }), 'fancy-color');
assert.equal(classifyColorFamily({}), 'white');  // default
console.log('✓ Branch classification works');

// ─── Load context ────────────────────────────────────────────────────────────

const ctx = loadDiamondProdVNext();
assert.ok(ctx, 'should return a context');
assert.equal(ctx.modelVersion, 'diamond-prod-vnext-v0.2.0');
assert.ok(ctx.white, 'should have white branch');
assert.ok(ctx.color, 'should have color branch');
assert.ok(ctx.routerConfig, 'should have router config');
assert.ok(ctx.routerConfig.sourceAdjustment, 'should have source adjustment');
console.log('✓ Unified context loads');

// ─── Predict white diamond ───────────────────────────────────────────────────

const whitePred = predictDiamondProdVNext({
  carat: 2.0,
  shape_style: 'round_standard',
  color: 'E',
  clarity: 'VS1',
  cut_raw: 'EX',
  polish: 'EX',
  symmetry: 'EX',
  typeName: 'CVD',
}, ctx);

assert.ok(whitePred.price > 0, 'white diamond should get a price');
assert.equal(whitePred.branch, 'white');
assert.equal(whitePred.colorFamily, 'white');
assert.ok(whitePred.selectedExpert, 'should have selected expert');
assert.ok(whitePred.modelVersion, 'should have model version');
assert.ok(whitePred.diagnostics, 'should have diagnostics');
console.log(`  White E/VS1 2ct: $${whitePred.price.toFixed(0)} (branch=${whitePred.branch}, expert=${whitePred.selectedExpert})`);

// ─── Predict fancy-color diamond ─────────────────────────────────────────────

const colorPred = predictDiamondProdVNext({
  carat: 2.0,
  shape: 'cushion',
  colorHue: 'pink',
  colorIntensity: 'fancy vivid',
  clarity: 'VS1',
}, ctx);

assert.ok(colorPred.price > 0, 'fancy-color diamond should get a price');
assert.equal(colorPred.branch, 'fancy-color');
assert.equal(colorPred.colorFamily, 'fancy-color');
assert.ok(colorPred.selectedExpert, 'should have selected expert');
assert.ok(colorPred.hue, 'should have hue');
assert.ok(colorPred.intensity, 'should have intensity');
assert.ok(colorPred.sourceAdjustment, 'should expose source adjustment');
console.log(`  Pink vivid 2ct: $${colorPred.price.toFixed(0)} (branch=${colorPred.branch}, expert=${colorPred.selectedExpert})`);

// ─── No cross-contamination ──────────────────────────────────────────────────

// White input should never route to color
assert.notEqual(whitePred.selectedExpert, 'E2_S22', 'white should not use color experts');
assert.notEqual(whitePred.selectedExpert, 'E3_S23', 'white should not use color experts');

// Color input should never route to white
assert.notEqual(colorPred.selectedExpert, 'S30', 'color should not use white experts');
assert.notEqual(colorPred.selectedExpert, 'S26', 'color should not use white experts');
assert.notEqual(colorPred.selectedExpert, 'S33A', 'color should not use white experts');
assert.notEqual(colorPred.selectedExpert, 'S28', 'color should not use white experts');
console.log('✓ No cross-contamination between branches');

// ─── Batch predict ───────────────────────────────────────────────────────────

const batch = predictDiamondProdVNextBatch([
  { carat: 1.0, shape_style: 'round_standard', color: 'D', clarity: 'IF', cut_raw: 'EX', typeName: 'CVD' },
  { carat: 2.0, shape: 'radiant', colorHue: 'yellow', colorIntensity: 'fancy vivid', clarity: 'VS1' },
], ctx);
assert.equal(batch.length, 2);
assert.equal(batch[0].branch, 'white');
assert.equal(batch[1].branch, 'fancy-color');
assert.ok(batch[0].price > 0);
assert.ok(batch[1].price > 0);
console.log('✓ Batch predict works');

// ─── Unclassifiable ──────────────────────────────────────────────────────────

const unknown = predictDiamondProdVNext({ carat: 1.0, color: 'something_weird' }, ctx);
// Should still route (classifies as fancy-color since it doesn't match white grades)
assert.ok(unknown.branch, 'should have a branch');
assert.ok(unknown.price > 0 || unknown.fallbackReason, 'should have price or fallback reason');
console.log(`  Unknown color label: branch=${unknown.branch}, expert=${unknown.selectedExpert}, reason=${unknown.fallbackReason}`);

// ─── Contract fields ─────────────────────────────────────────────────────────

const requiredFields = ['price', 'pricePerCarat', 'modelVersion', 'branch', 'colorFamily',
  'selectedExpert', 'supportTier', 'supportCount', 'sourceAdjustment',
  'confidenceBand', 'fallbackReason', 'diagnostics'];
for (const field of requiredFields) {
  assert.ok(field in whitePred, `white result should have ${field}`);
  assert.ok(field in colorPred, `color result should have ${field}`);
}
console.log('✓ All contract fields present');

// ─── Golden fixture: white inputs give same result as WhiteProd vNext ────────

const { predictWhiteProdVNext, loadWhiteProdVNext } = await import('./predict-white-prod-vnext.mjs');
const wpCtx = loadWhiteProdVNext();
const fixtureRow = { carat: 3.0, shape_style: 'round_standard', color: 'E', clarity: 'VS1', cut_raw: 'EX', polish: 'EX', symmetry: 'EX', typeName: 'CVD' };
const wpResult = predictWhiteProdVNext(fixtureRow, wpCtx);
const dpResult = predictDiamondProdVNext(fixtureRow, ctx);
assert.equal(dpResult.branch, 'white');
assert.equal(dpResult.selectedExpert, wpResult.selectedExpert, 'DiamondProd white route should match WhiteProd vNext expert');
assert.ok(Math.abs(dpResult.price - wpResult.price) < 0.01, 'DiamondProd white route should match WhiteProd vNext price');
console.log(`✓ DiamondProd white route matches WhiteProd vNext: $${dpResult.price.toFixed(0)} vs $${wpResult.price.toFixed(0)} (expert=${dpResult.selectedExpert})`);

// ─── Coverage: all white rows route correctly ────────────────────────────────

const allWhiteRows = loadJson('dataset-clean-training.json');
let whiteMisroutes = 0;
for (const r of allWhiteRows.slice(0, 500)) {
  const p = predictDiamondProdVNext(r, ctx);
  if (p.branch !== 'white') whiteMisroutes++;
}
assert.equal(whiteMisroutes, 0, 'no white rows should misroute');
console.log(`✓ White routing: 0 misroutes in 500-row sample`);

// ─── Coverage: all color rows route correctly ────────────────────────────────

const allColorRows = [
  ...(loadJson('messi-color-index.json').records || []),
  ...(loadJson('starsgem-color-index.json').records || []),
];
let colorMisroutes = 0;
for (const r of allColorRows) {
  const p = predictDiamondProdVNext(r, ctx);
  if (p.branch !== 'fancy-color') colorMisroutes++;
}
assert.equal(colorMisroutes, 0, 'no color rows should misroute');
console.log(`✓ Color routing: 0 misroutes in ${allColorRows.length}-row dataset`);

console.log('\nDiamondProd vNext checks passed.');
