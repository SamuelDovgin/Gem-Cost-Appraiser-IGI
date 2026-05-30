/**
 * Regression checks for the fancy-color diamond ML artifacts.
 *
 * These checks intentionally exercise the browser-serialized model JSON instead
 * of the Python estimator objects, so they catch export/vectorization drift.
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

function category(value) {
  const text = String(value ?? '').trim();
  return text || '-';
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function treatmentGroup(value) {
  const text = String(value ?? '').toLowerCase();
  if (!text) return '-';
  if (text.includes('as grown') || text.includes('no indication')) return 'as_grown';
  if (text.includes('may include')) return 'may_include_treatment';
  if (text.includes('post-growth') || text.includes('post growth')) return 'post_growth';
  return 'other';
}

function normalizeColorRow(row, source, adjustment) {
  const carat = safeNumber(row.carat);
  const rawPrice = safeNumber(row.pricePerStone);
  if (!carat || carat <= 0 || !rawPrice || rawPrice <= 0) return null;

  const igi = row.igi && typeof row.igi === 'object' ? row.igi : {};
  const isStarsgem = source === 'starsgem_color';
  const sourceAdjustment = isStarsgem ? 1.0 : adjustment;
  const adjustedPrice = rawPrice / sourceAdjustment;
  const modifiers = Array.isArray(row.colorModifiers) ? row.colorModifiers : [];

  return {
    source,
    sourceAdjustedPricePerStone: adjustedPrice,
    shape: category(row.shape),
    subVariant: category(row.subVariant),
    color: category(row.color),
    colorHue: category(row.colorHue),
    colorIntensity: category(row.colorIntensity),
    appColorKey: category(row.appColorKey),
    clarity: category(row.clarity),
    growthMethod: category(igi.growthMethod ?? row.growthMethod),
    cut: category(igi.cut ?? row.cut),
    polish: category(igi.polish ?? row.polish),
    symmetry: category(igi.symmetry ?? row.symmetry),
    fluorescence: category(igi.fluorescence ?? row.fluorescence),
    treatmentGroup: treatmentGroup(igi.treatment ?? row.treatment),
    diamondType: category(igi.diamondType),
    certShapeMapped: category(igi.shapeMapped),
    carat,
    logCarat: Math.log(carat),
    colorIntensityRank: safeNumber(row.colorIntensityRank) ?? 1.0,
    modifierCount: modifiers.length,
    lwRatio: safeNumber(igi.lwRatio) ?? safeNumber(row.lwRatio),
    size1: safeNumber(igi.size1) ?? safeNumber(row.size1),
    size2: safeNumber(igi.size2) ?? safeNumber(row.size2),
    size3: safeNumber(igi.size3) ?? safeNumber(row.size3),
    tablePct: safeNumber(igi.tablePct) ?? safeNumber(row.tablePct),
    depthPct: safeNumber(igi.depthPct) ?? safeNumber(row.depthPct),
    IGI_Enriched: igi.status === 'ok' ? 1.0 : 0.0,
    IGI_IsTypeIIa: igi.diamondType === 'Type IIa' ? 1.0 : 0.0,
    isLargeCarat: carat >= 5 ? 1.0 : 0.0,
    is10ctPlus: carat >= 10 ? 1.0 : 0.0,
  };
}

function colorModelVector(row, model) {
  const features = model.features;
  const vector = [];
  for (const field of features.categorical || []) {
    const value = category(row[field]);
    const cats = features.categories?.[field] || [];
    for (const cat of cats) vector.push(value === cat ? 1 : 0);
  }
  for (const field of features.numeric || []) {
    const n = Number(row[field]);
    const fallback = Number(features.numericMedians?.[field]);
    vector.push(Number.isFinite(n) ? n : Number.isFinite(fallback) ? fallback : 0);
  }
  return vector;
}

function predictColor(row, model) {
  const vector = colorModelVector(row, model);
  let logSum = 0;
  for (const tree of model.trees) {
    let node = 0;
    while (tree.childrenLeft[node] !== -1) {
      const feature = tree.feature[node];
      const threshold = tree.threshold[node];
      const value = vector[feature] ?? 0;
      node = value <= threshold ? tree.childrenLeft[node] : tree.childrenRight[node];
    }
    logSum += tree.value[node];
  }
  const logRate = model.lgbmBaseScore != null
    ? logSum + model.lgbmBaseScore
    : logSum / model.trees.length;
  return Math.exp(logRate) * Number(row.carat);
}

function mape(rows, preds) {
  const vals = rows.map((row, i) => Math.abs(preds[i] - row.sourceAdjustedPricePerStone) / row.sourceAdjustedPricePerStone);
  return vals.reduce((sum, v) => sum + v, 0) / vals.length;
}

const colorS22 = loadJson('color-diamond-ml-model.json');
const colorS23 = loadJson('color-diamond-ml-model-s23.json');
const messi = loadJson('messi-color-index.json').records || [];
const starsgem = loadJson('starsgem-color-index.json').records || [];
const adjustment = colorS22.sourceAdjustment?.messiColorToStarsgemLikeFactor ?? 1.25;

const rows = [
  ...messi.map(row => normalizeColorRow(row, 'messi_color', adjustment)),
  ...starsgem.map(row => normalizeColorRow(row, 'starsgem_color', adjustment)),
].filter(Boolean);
const anchors = rows.filter(row => row.source === 'starsgem_color');

assert.ok(rows.length >= 1657, 'expected all enriched fancy-color rows to be loadable');
assert.ok(anchors.length >= 5, 'expected direct StarGem colored-gem anchors');

for (const [name, model] of [['S22 color', colorS22], ['S23 color', colorS23]]) {
  assert.ok(model.trees?.length > 0, `${name} should contain exported trees`);
  const preds = rows.map(row => predictColor(row, model));
  assert.equal(preds.filter(Number.isFinite).length, rows.length, `${name} should predict every colored row`);
  assert.ok(Math.max(...preds) > Math.min(...preds), `${name} predictions should not collapse to a constant`);
}

assert.ok(colorS22.metrics.validation.mape < 0.06, 'S22 color validation MAPE should remain below 6%');
assert.ok(colorS23.metrics.validation.mape < 0.07, 'S23 color validation MAPE should remain below 7%');

const anchorPredsS22 = anchors.map(row => predictColor(row, colorS22));
const anchorPredsS23 = anchors.map(row => predictColor(row, colorS23));
assert.ok(mape(anchors, anchorPredsS22) < 0.01, 'S22 color should preserve direct StarGem anchors');
assert.ok(mape(anchors, anchorPredsS23) < 0.01, 'S23 color should preserve direct StarGem anchors');

const vividPink = anchors.find(row => row.colorHue === 'pink') || anchors[0];
const intensityRanks = [0, 1, 2, 3];
let previous = 0;
for (const rank of intensityRanks) {
  const pred = predictColor({ ...vividPink, colorIntensityRank: rank }, colorS23);
  assert.ok(pred + 0.01 >= previous, 'S23 color should be monotone in numeric intensity rank');
  previous = pred;
}

console.log('Colored gem model checks passed.');
console.log(`  Rows predicted: ${rows.length}`);
console.log(`  S22 validation MAPE: ${(colorS22.metrics.validation.mape * 100).toFixed(2)}%`);
console.log(`  S23 validation MAPE: ${(colorS23.metrics.validation.mape * 100).toFixed(2)}%`);
console.log(`  Direct StarGem anchor MAPE: S22 ${(mape(anchors, anchorPredsS22) * 100).toFixed(2)}%, S23 ${(mape(anchors, anchorPredsS23) * 100).toFixed(2)}%`);
