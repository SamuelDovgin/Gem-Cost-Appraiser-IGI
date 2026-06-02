/**
 * Regression checks for ColorProd vNext predictor.
 *
 * Verifies the WhiteProd-shaped contract:
 *   - loadColorProdVNext returns proper context
 *   - predictColorProdVNext returns the shared contract fields
 *   - supportTier and cellKey work correctly
 *   - Routing honors rare-hue rules
 *   - S23 monotone display guard works
 *   - Source adjustment is exposed
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadColorProdVNext,
  predictColorProdVNext,
  predictColorProdVNextBatch,
  supportTier,
  cellKey,
  normHue,
  normIntensity,
  hueTier,
  curatedPriorPrice,
} from './predict-color-prod-vnext.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, '..', 'data');

function loadJson(name) {
  return JSON.parse(readFileSync(path.join(DATA, name), 'utf8'));
}

// ─── Load context ────────────────────────────────────────────────────────────

const ctx = loadColorProdVNext();
assert.ok(ctx, 'loadColorProdVNext should return a context object');
assert.equal(ctx.modelVersion, 'color-prod-vnext-v0.1.0');
assert.equal(ctx.branch, 'fancy-color');
assert.ok(ctx.s22, 'should load S22 model');
assert.ok(ctx.s23, 'should load S23 model');
assert.ok(ctx.s27, 'should load S27 policy');
assert.ok(ctx.sourceAdjustment, 'should have source adjustment config');
assert.ok(ctx.sourceAdjustment.messiToFactoryFactor >= 1.20, 'Messi factor should be in range');
assert.ok(ctx.sourceAdjustment.messiToFactoryFactor <= 1.30, 'Messi factor should be in range');
assert.ok(ctx.cellSupport instanceof Map, 'cellSupport should be a Map');
assert.ok(ctx.cellSupport.size > 0, 'cellSupport should not be empty');
assert.ok(ctx.directAnchors instanceof Map, 'directAnchors should be a Map');

console.log('✓ Context loads correctly');

// ─── Support tier classification ────────────────────────────────────────────

assert.equal(supportTier(0), 'empty');
assert.equal(supportTier(1), 'sparse');
assert.equal(supportTier(5), 'medium');
assert.equal(supportTier(20), 'dense');
assert.equal(supportTier(100), 'dense');
console.log('✓ supportTier works');

// ─── Cell key ────────────────────────────────────────────────────────────────

const ck = cellKey({ colorHue: 'pink', colorIntensity: 'fancy vivid', shape: 'cushion', carat: 2.0 });
assert.ok(ck.includes('pink'), 'cellKey should include normalized hue');
assert.ok(ck.includes('vivid'), 'cellKey should include normalized intensity');
assert.ok(ck.includes('cushion'), 'cellKey should include shape');
assert.ok(ck.includes('2.00'), 'cellKey should include carat bucket');
console.log('✓ cellKey works');

// ─── Hue/intensity normalization ─────────────────────────────────────────────

assert.equal(normHue('Fancy Vivid Pink'), 'pink');
assert.equal(normHue('Fancy Intense Blue'), 'blue');
assert.equal(normHue('Fancy Yellow'), 'yellow');
assert.equal(normHue('Fancy Brown / Coffee'), 'brown');
assert.equal(normHue('Fancy Red'), 'red');
assert.equal(normHue('Fancy Orangy'), 'orange');
assert.equal(normHue('Purple'), 'purple');
assert.equal(normIntensity('Fancy Vivid'), 'vivid');
assert.equal(normIntensity('Fancy Intense'), 'intense');
assert.equal(normIntensity('Fancy'), 'fancy');
assert.equal(normIntensity('Fancy Light'), 'light');
assert.equal(normIntensity('Fancy Dark'), 'dark');
console.log('✓ hue/intensity normalization works');

// ─── Hue tier classification ─────────────────────────────────────────────────

assert.equal(hueTier('yellow'), 'primary');
assert.equal(hueTier('pink'), 'primary');
assert.equal(hueTier('blue'), 'primary');
assert.equal(hueTier('green'), 'caution');
assert.equal(hueTier('brown'), 'caution');
assert.equal(hueTier('red'), 'caution');
assert.equal(hueTier('orange'), 'rare');
assert.equal(hueTier('purple'), 'rare');
console.log('✓ hueTier classification works');

// ─── Curated prior ───────────────────────────────────────────────────────────

const prior = curatedPriorPrice({ colorHue: 'pink', colorIntensity: 'fancy vivid', carat: 2.0 });
assert.ok(prior?.price > 0, 'curated prior should return a positive price for pink vivid');
assert.ok(prior?.upc > 0, 'curated prior should return a positive upc');

const rarePrior = curatedPriorPrice({ colorHue: 'orange', colorIntensity: 'fancy', carat: 1.5 });
assert.ok(rarePrior?.price > 0, 'curated prior should return a price for rare hues');
console.log('✓ curatedPriorPrice works');

// ─── Predict common fancy-color diamonds ─────────────────────────────────────

// Yellow vivid (primary, should use S22)
const yellowVivid = predictColorProdVNext({
  carat: 2.0,
  shape: 'radiant',
  colorHue: 'yellow',
  colorIntensity: 'fancy vivid',
  clarity: 'VS1',
}, ctx);
assert.ok(yellowVivid.price > 0, 'yellow vivid should get a price');
assert.ok(yellowVivid.selectedExpert, 'should report selected expert');
assert.ok(yellowVivid.supportTier, 'should report support tier');
assert.equal(yellowVivid.branch, 'fancy-color');
assert.equal(yellowVivid.modelVersion, 'color-prod-vnext-v0.1.0');
assert.ok(yellowVivid.sourceAdjustment, 'should expose source adjustment');
console.log(`  Yellow vivid 2ct: $${yellowVivid.price.toFixed(0)} (expert=${yellowVivid.selectedExpert}, tier=${yellowVivid.supportTier})`);

// Pink intense (primary)
const pinkIntense = predictColorProdVNext({
  carat: 1.5,
  shape: 'cushion',
  colorHue: 'pink',
  colorIntensity: 'fancy intense',
  clarity: 'VS2',
}, ctx);
assert.ok(pinkIntense.price > 0, 'pink intense should get a price');
console.log(`  Pink intense 1.5ct: $${pinkIntense.price.toFixed(0)} (expert=${pinkIntense.selectedExpert})`);

// Blue fancy (primary)
const blueFancy = predictColorProdVNext({
  carat: 3.0,
  shape: 'oval',
  colorHue: 'blue',
  colorIntensity: 'fancy',
  clarity: 'VVS2',
}, ctx);
assert.ok(blueFancy.price > 0, 'blue fancy should get a price');
console.log(`  Blue fancy 3ct: $${blueFancy.price.toFixed(0)} (expert=${blueFancy.selectedExpert})`);

// ─── Rare hue routing ────────────────────────────────────────────────────────

// Orange should go to E5_CURATED_PRIOR with direct-quote warning
const orange = predictColorProdVNext({
  carat: 1.5,
  shape: 'cushion',
  colorHue: 'orange',
  colorIntensity: 'fancy intense',
  clarity: 'VS2',
}, ctx);
assert.ok(orange.price > 0, 'orange should get a curated prior price');
assert.equal(orange.selectedExpert, 'E5_CURATED_PRIOR', 'orange should route to curated prior');
assert.ok(orange.diagnostics?.directQuoteRecommended, 'rare hues should recommend direct quote');
console.log(`  Orange 1.5ct: $${orange.price.toFixed(0)} (expert=${orange.selectedExpert}, directQuoteRecommended=${orange.diagnostics.directQuoteRecommended})`);

// ─── Brown routing (should use S22, not curated prior) ───────────────────────

const brown = predictColorProdVNext({
  carat: 2.0,
  shape: 'pear',
  colorHue: 'brown',
  colorIntensity: 'fancy',
  clarity: 'VS1',
}, ctx);
assert.ok(brown.price > 0, 'brown should get a price');
// Brown should use S22 (excellent accuracy 0.38% MAPE)
assert.ok(brown.selectedExpert === 'E2_S22' || brown.selectedExpert === 'E3_S23',
  'brown should route through S22 or S23, not curated prior');
console.log(`  Brown 2ct: $${brown.price.toFixed(0)} (expert=${brown.selectedExpert})`);

// ─── Red routing (should use S22, not curated prior) ─────────────────────────

const red = predictColorProdVNext({
  carat: 1.0,
  shape: 'round',
  colorHue: 'red',
  colorIntensity: 'fancy',
  clarity: 'SI1',
}, ctx);
assert.ok(red.price > 0, 'red should get a price');
assert.ok(red.selectedExpert === 'E2_S22' || red.selectedExpert === 'E3_S23',
  'red should route through S22/S23, not curated prior');
console.log(`  Red 1ct: $${red.price.toFixed(0)} (expert=${red.selectedExpert})`);

// ─── Display grid intensity scan (should use S23) ────────────────────────────

const displayRow = {
  _intensityDisplayGrid: true,
  carat: 2.0,
  shape: 'cushion',
  colorHue: 'pink',
  colorIntensity: 'fancy vivid',
  clarity: 'VS1',
};
const displayPred = predictColorProdVNext(displayRow, ctx);
assert.ok(displayPred.price > 0, 'display grid should get a price');
assert.equal(displayPred.selectedExpert, 'E3_S23', 'display grid should use S23 for monotonicity');
assert.equal(displayPred.fallbackReason, 'intensity_display_grid_s23');
assert.ok(displayPred.diagnostics?.intensityDisplayGrid, 'should mark as display grid');
assert.ok(displayPred.diagnostics?.monotoneGuard === 'S23', 'should note S23 as monotone guard');
console.log(`  Display grid pink vivid 2ct: $${displayPred.price.toFixed(0)} (expert=${displayPred.selectedExpert})`);

// ─── Intensity monotonicity verification ─────────────────────────────────────

// S23 should be monotone in intensity for display grid cells
const intensities = ['fancy light', 'fancy', 'fancy intense', 'fancy vivid'];
const intensityPreds = intensities.map((intensity) => {
  return predictColorProdVNext({
    _intensityDisplayGrid: true,
    carat: 1.0,
    shape: 'round',
    colorHue: 'pink',
    colorIntensity: intensity,
    clarity: 'VS1',
  }, ctx);
});

for (let i = 1; i < intensityPreds.length; i++) {
  const prevUpc = intensityPreds[i - 1].pricePerCarat;
  const currUpc = intensityPreds[i].pricePerCarat;
  assert.ok(currUpc + 1e-6 >= prevUpc,
    `S23 display grid should be monotone in intensity: ${intensities[i - 1]}→${intensities[i]}: $${prevUpc?.toFixed(0)}→$${currUpc?.toFixed(0)}`);
}
console.log('✓ S23 display grid is monotone in intensity');

// ─── Batch predict ───────────────────────────────────────────────────────────

const batchRows = [
  { carat: 1.0, shape: 'round', colorHue: 'yellow', colorIntensity: 'fancy', clarity: 'VS2' },
  { carat: 2.0, shape: 'cushion', colorHue: 'pink', colorIntensity: 'fancy vivid', clarity: 'VS1' },
  { carat: 3.0, shape: 'oval', colorHue: 'blue', colorIntensity: 'fancy intense', clarity: 'VVS2' },
];
const batchResults = predictColorProdVNextBatch(batchRows, ctx);
assert.equal(batchResults.length, 3);
for (const r of batchResults) {
  assert.ok(r.price > 0, 'batch result should have a price');
  assert.ok(r.selectedExpert, 'batch result should have an expert');
}
console.log('✓ batch predict works');

// ─── Invalid input ───────────────────────────────────────────────────────────

const invalidCarat = predictColorProdVNext({ carat: -1, colorHue: 'pink' }, ctx);
assert.equal(invalidCarat.price, null);
assert.equal(invalidCarat.fallbackReason, 'invalid_carat');
console.log('✓ invalid carat handled');

const nullCarat = predictColorProdVNext({ carat: 0, colorHue: 'pink' }, ctx);
assert.equal(nullCarat.price, null);
assert.equal(nullCarat.fallbackReason, 'invalid_carat');
console.log('✓ zero carat handled');

// ─── Coverage ────────────────────────────────────────────────────────────────

const allColorRows = [
  ...(loadJson('messi-color-index.json').records || []),
  ...(loadJson('starsgem-color-index.json').records || []),
];
let covered = 0, noPrice = 0;
for (const r of allColorRows) {
  const p = predictColorProdVNext(r, ctx);
  if (p?.price > 0) covered++;
  else noPrice++;
}
const coveragePct = (covered / allColorRows.length * 100).toFixed(2);
console.log(`✓ Coverage: ${covered}/${allColorRows.length} (${coveragePct}%) rows predicted`);
assert.ok(covered >= allColorRows.length * 0.99, 'should cover ≥99% of color rows');

// ─── Source adjustment in diagnostics ─────────────────────────────────────────

assert.ok(yellowVivid.sourceAdjustment?.messiToFactoryFactor > 0, 'source adjustment should be exposed');
assert.ok(yellowVivid.hue, 'hue should be in result');
assert.ok(yellowVivid.intensity, 'intensity should be in result');
assert.ok(typeof yellowVivid.supportCount === 'number', 'supportCount should be in result');
console.log('✓ all contract fields present');

console.log('\nColorProd vNext checks passed.');
