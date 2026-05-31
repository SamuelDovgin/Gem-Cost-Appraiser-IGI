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

function cappedWeights(sources, caps) {
  const rawSum = sources.reduce((sum, s) => sum + s.rawWeight, 0) || 1;
  const weights = sources.map(s => s.rawWeight / rawSum);
  const locked = new Set();
  for (let pass = 0; pass < sources.length; pass++) {
    let changed = false;
    for (let i = 0; i < sources.length; i++) {
      const cap = caps[sources[i].kind] ?? 1;
      if (!locked.has(i) && weights[i] > cap) {
        weights[i] = cap;
        locked.add(i);
        changed = true;
      }
    }
    if (!changed) break;
    const lockedSum = [...locked].reduce((sum, i) => sum + weights[i], 0);
    const free = sources.map((_, i) => i).filter(i => !locked.has(i));
    const freeRaw = free.reduce((sum, i) => sum + sources[i].rawWeight, 0);
    for (const i of free) {
      weights[i] = freeRaw > 0
        ? (1 - lockedSum) * sources[i].rawWeight / freeRaw
        : (1 - lockedSum) / Math.max(free.length, 1);
    }
  }
  return weights;
}

function applyMlAnchorDisagreementGuard(sources, model) {
  const p = model.policy.mlAnchorDisagreement;
  const anchors = sources.filter(s => s.kind !== 'ml' && s.sigma <= p.maxAnchorSigma);
  const prices = anchors.map(s => s.price);
  const anchorMin = Math.min(...prices);
  const anchorMax = Math.max(...prices);
  if (anchors.length < p.minStrongAnchors || anchorMax / anchorMin > p.maxAnchorSpread) return;
  const anchorCenter = Math.exp(prices.reduce((sum, price) => sum + Math.log(price), 0) / prices.length);
  for (const source of sources) {
    if (source.kind !== 'ml') continue;
    const ratio = source.price / anchorCenter;
    if (ratio < p.lowRatio || ratio > p.highRatio) {
      source.sigma = Math.max(source.sigma, p.outlierSigma);
      source.rawWeight = 1 / (source.sigma * source.sigma);
    }
  }
}

function blendPrice(sources, model) {
  for (const source of sources) source.rawWeight = 1 / (source.sigma * source.sigma);
  applyMlAnchorDisagreementGuard(sources, model);
  const weights = cappedWeights(sources, model.policy.sourceCaps);
  return Math.exp(sources.reduce((sum, source, i) => sum + weights[i] * Math.log(source.price), 0));
}

assert.equal(s26.modelVersion, 's26-champion-v1.2');
assert.equal(s26.scope.whiteDiamonds, true);
assert.equal(s26.scope.fancyColorDiamonds, false);
assert.ok(s26.metrics.mape < 5.0, 'S26 lookup benchmark should remain below 5% MAPE');
assert.ok(s26.metrics.n >= 12843, 'S26 benchmark should cover the white Segment-A sheet');
assert.equal(s26.metrics.levelCounts.GLOBAL ?? 0, 0, 'S26 lookup benchmark should have no global hits');
assert.ok(s26.policy.sourceCaps.comp <= 0.7, 'S26 should cap comp dominance');
assert.ok(s26.policy.sourceCaps.lookup <= 0.65, 'S26 should cap lookup dominance');
assert.ok(s26.policy.mlAnchorDisagreement, 'S26 should define ML/anchor disagreement policy');

const marquiseCase = [
  { kind: 'lookup', price: 907, sigma: 0.12 },
  { kind: 'comp', price: 711, sigma: 0.12 },
  { kind: 'ml', price: 112, sigma: 0.26 },
  { kind: 'ml', price: 129, sigma: 0.26 },
];
const guardedMarquise = blendPrice(marquiseCase.map(source => ({ ...source })), s26);
assert.ok(
  guardedMarquise >= 700 && guardedMarquise <= 920,
  `S26 should not let severe low ML outliers drag an exact-comp/high-lookup case below support anchors; got $${Math.round(guardedMarquise)}`
);

console.log('S26 champion checks passed.');
console.log(`  White benchmark MAPE: ${s26.metrics.mape.toFixed(2)}%`);
console.log(`  Rows: ${s26.metrics.n}`);
