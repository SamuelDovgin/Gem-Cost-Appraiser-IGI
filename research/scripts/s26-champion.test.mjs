/**
 * Regression checks for S26 champion policy artifact.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, '..', 'data');

function loadJson(name) {
  return JSON.parse(readFileSync(path.join(DATA, name), 'utf8'));
}

const s26 = loadJson('starsgem-ml-model-s26-champion.json');

assert.equal(s26.modelVersion, 's26-champion-v1');
assert.equal(s26.scope.whiteDiamonds, true);
assert.equal(s26.scope.fancyColorDiamonds, false);
assert.ok(s26.metrics.mape < 5.0, 'S26 lookup benchmark should remain below 5% MAPE');
assert.ok(s26.metrics.n >= 12843, 'S26 benchmark should cover the white Segment-A sheet');
assert.equal(s26.metrics.levelCounts.GLOBAL ?? 0, 0, 'S26 lookup benchmark should have no global hits');
assert.ok(s26.policy.sourceCaps.comp <= 0.7, 'S26 should cap comp dominance');
assert.ok(s26.policy.sourceCaps.lookup <= 0.65, 'S26 should cap lookup dominance');

console.log('S26 champion checks passed.');
console.log(`  White benchmark MAPE: ${s26.metrics.mape.toFixed(2)}%`);
console.log(`  Rows: ${s26.metrics.n}`);
