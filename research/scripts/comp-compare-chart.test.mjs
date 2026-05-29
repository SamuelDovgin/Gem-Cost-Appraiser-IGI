#!/usr/bin/env node

import { modifiersFromParts, collectPremiumColumns, columnFromCompEntry } from '../comp-compare-chart.js';

let passed = 0;
let failed = 0;

function ok(cond, label) {
  if (cond) { passed++; console.log(`  ok  ${label}`); }
  else { failed++; console.error(`  bad ${label}`); }
}

const mods = modifiersFromParts([
  'carat total ×1.095 (price/ct ×1.033; 1.75ct vs 1.65ct slope=0.55)',
  'color ×0.926 (E vs D)',
]);
ok(mods.carat && mods.carat.includes('×'), 'parses carat modifier');
ok(mods.color && mods.color.includes('0.926'), 'parses color modifier');

const spec = { carat: 1.75, shapeLabel: 'Round', color: 'E', clarity: 'VS1', isWhite: true };
const floor = columnFromCompEntry({
  row: { carat: 1.65, shape: 'round', clarity: 'VS1', colorNormalized: 'E', colorFamily: 'white', priceUsd: 172 },
  listingPrice: 172,
  estimatedPrice: 199,
  modifiers: { parts: ['carat total ×1.095'] },
}, { id: 'a', title: 'Floor', tag: 'exact' });
const premium = collectPremiumColumns(
  { estimate: 199, primary: { estimatedPrice: 199 }, supplierComparisons: [] },
  spec,
  [floor],
  { mlPrice: 204, lookupPrice: 200, reconciledPrice: 201 },
);
ok(premium.some(c => c.id === 'model-ml'), 'ML in premium when above floor');
ok(!premium.some(c => c.id === 'a'), 'floor not duplicated in premium');

if (failed) {
  console.error(`\ncomp-compare-chart tests failed: ${failed}`);
  process.exit(1);
}
console.log(`\ncomp-compare-chart tests passed: ${passed}`);
