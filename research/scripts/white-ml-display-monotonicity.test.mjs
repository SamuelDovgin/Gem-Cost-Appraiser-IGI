/**
 * Regression checks for visible white-diamond ML display monotonicity.
 *
 * The raw S20/S23 models can fall back to S21 at large carats. That fallback can
 * still invert sparse clarity cells, so the UI applies a final monotone ceiling:
 * a worse clarity grade may not display above the nearest better clarity grade.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStarsgemRow, predictStarsgemMl } from './starsgem-ml-predict.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, '..', 'data');
const CLARITY_ORDER = ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2'];

function loadJson(name) {
  return JSON.parse(readFileSync(path.join(DATA, name), 'utf8'));
}

const s20 = loadJson('starsgem-ml-extra-trees-model-s20-specialty-tail.json');
const s21 = loadJson('starsgem-ml-extra-trees-model-s21-monotone.json');
const s23 = loadJson('starsgem-ml-extra-trees-model-s23-grade-agnostic-anchor.json');

function isEffectivelyGlobal(pred) {
  return !pred || pred.lookupLevel === 'GLOBAL' || (pred.lookupCount ?? 0) <= 3;
}

function predictWithCoverageFallback(row, model) {
  let pred = predictStarsgemMl(row, model);
  let usedS21Fallback = false;
  if (pred && isEffectivelyGlobal(pred)) {
    const s21Pred = predictStarsgemMl(row, s21);
    if (s21Pred && (s21Pred.lookupCount ?? 0) > (pred.lookupCount ?? 0) && s21Pred.price > pred.price) {
      pred = s21Pred;
      usedS21Fallback = true;
    }
  }
  return { pred, usedS21Fallback };
}

function displayPriceWithClarityCeiling(row, model) {
  let ceiling = Infinity;
  for (const clarity of CLARITY_ORDER) {
    const { pred } = predictWithCoverageFallback({ ...row, Clarity: clarity }, model);
    if (!pred || !Number.isFinite(pred.price) || pred.price <= 0) continue;
    const capped = Math.min(pred.price, ceiling);
    if (clarity === row.Clarity) return capped;
    if (capped < ceiling) ceiling = capped;
  }
  return null;
}

for (const [name, model] of [['S22', s20], ['S23', s23]]) {
  const vs2 = buildStarsgemRow({ carat: 40, shape: 'ROUND', color: 'E', clarity: 'VS2', cut: 'ID', typeName: 'CVD' });
  const si1 = buildStarsgemRow({ carat: 40, shape: 'ROUND', color: 'E', clarity: 'SI1', cut: 'ID', typeName: 'CVD' });

  const rawVs2 = predictWithCoverageFallback(vs2, model).pred.price;
  const rawSi1 = predictWithCoverageFallback(si1, model).pred.price;
  assert.ok(rawSi1 > rawVs2, `${name} fixture should exercise the known raw fallback inversion`);

  const displayVs2 = displayPriceWithClarityCeiling(vs2, model);
  const displaySi1 = displayPriceWithClarityCeiling(si1, model);
  assert.ok(displaySi1 <= displayVs2 + 0.01, `${name} display should not price SI1 above VS2`);
}

console.log('White ML display monotonicity checks passed.');
