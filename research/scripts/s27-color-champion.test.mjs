/**
 * Regression checks for S27 color champion policy artifact.
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

const s27 = loadJson('color-diamond-ml-model-s27-champion.json');
const colorS22 = loadJson('color-diamond-ml-model.json');
const colorS23 = loadJson('color-diamond-ml-model-s23.json');

assert.equal(s27.modelVersion, 's27-color-champion-v1');
assert.equal(s27.scope.whiteDiamonds, false);
assert.equal(s27.scope.fancyColorDiamonds, true);
assert.equal(s27.sourceAdjustment.messiColorToStarsgemLikeFactor, 1.25);
assert.equal(s27.sourceAdjustment.starsgemDirectFactor, 1.0);

assert.equal(
  s27.metrics.rows.messiColorSourceAdjusted,
  colorS22.metrics.rowCounts.source_messi_color,
  'S27 should account for every Messi color row in the source-adjusted benchmark',
);
assert.equal(
  s27.metrics.rows.directStarsgemColorAnchors,
  colorS22.metrics.rowCounts.source_starsgem_color,
  'S27 should account for every direct StarGem color anchor',
);

const s27ValidationMape = s27.metrics.validation.colorS27.mape;
assert.equal(s27ValidationMape, colorS22.metrics.validation.mape);
assert.ok(s27ValidationMape <= colorS23.metrics.validation.mape, 'S27 validation point-error should beat Color S23');

const all = s27.metrics.productionPolicyAllAdjustedRows;
assert.ok(all.colorS27.mape < 2.0, 'S27 all-row source-adjusted MAPE should stay below 2%');
assert.ok(all.colorS27.mape <= all.colorS23.mape, 'S27 should beat Color S23 on all adjusted rows');
assert.ok(all.colorS27.mape < all.colorCompEngine.mape, 'S27 should beat comp-only color pricing');

const anchors = s27.metrics.directStarsgemAnchors;
assert.ok(anchors.colorS27.mape < 0.01, 'S27 should preserve direct StarGem color anchors');
assert.ok(s27.metrics.compCoverage.predicted >= 1656, 'S27 benchmark should have comp support for nearly all color rows');

console.log('S27 color champion checks passed.');
console.log(`  Messi adjustment: ÷${s27.sourceAdjustment.messiColorToStarsgemLikeFactor}`);
console.log(`  Validation MAPE: ${(s27ValidationMape * 100).toFixed(2)}%`);
console.log(`  All adjusted rows MAPE: ${all.colorS27.mape.toFixed(2)}%`);
