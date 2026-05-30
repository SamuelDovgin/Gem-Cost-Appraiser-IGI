/**
 * Build S27 — color champion policy metadata.
 *
 * S27 is the fancy-color analogue to S26, but the evidence ranking is different:
 * Color S22 is already the strongest source-adjusted StarGem-like surface, while
 * color comps are useful guardrails because direct StarGem color anchors are thin.
 *
 * Usage:
 *   node research/scripts/train-s27-color-champion.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadIndex, resolveAlibabaComp } from '../comp-engine-v3.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DATA = path.join(ROOT, 'research', 'data');
const OUT = path.join(DATA, 'color-diamond-ml-model-s27-champion.json');

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
  const sourceAdjustmentFactor = isStarsgem ? 1.0 : adjustment;
  const modifiers = Array.isArray(row.colorModifiers) ? row.colorModifiers : [];

  return {
    source,
    sourceTrainingType: isStarsgem ? 'direct_starsgem' : 'messi_source_adjusted',
    sourceAdjustmentFactor,
    sourceAdjustedPricePerStone: rawPrice / sourceAdjustmentFactor,
    rawPricePerStone: rawPrice,
    reportNo: row.reportNo,
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

function compQuery(row) {
  return {
    carat: row.carat,
    shape: row.shape,
    colorFamily: 'fancy',
    colorFamily_key: row.appColorKey,
    clarity: row.clarity,
  };
}

function mape(rows, preds) {
  let n = 0;
  let sum = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const actual = Number(rows[i].sourceAdjustedPricePerStone);
    const pred = Number(preds[i]);
    if (actual > 0 && pred > 0) {
      n += 1;
      sum += Math.abs(pred - actual) / actual;
    }
  }
  return { n, mape: n ? sum / n : null };
}

function groupMape(rows, predSets, keyFn) {
  const groups = new Map();
  for (let i = 0; i < rows.length; i += 1) {
    const key = keyFn(rows[i]);
    if (!groups.has(key)) groups.set(key, { n: 0, values: {} });
    const group = groups.get(key);
    group.n += 1;
    for (const [name, preds] of Object.entries(predSets)) {
      const actual = Number(rows[i].sourceAdjustedPricePerStone);
      const pred = Number(preds[i]);
      if (!(actual > 0 && pred > 0)) continue;
      if (!group.values[name]) group.values[name] = { n: 0, sum: 0 };
      group.values[name].n += 1;
      group.values[name].sum += Math.abs(pred - actual) / actual;
    }
  }
  return Object.fromEntries([...groups.entries()].sort().map(([key, group]) => [
    key,
    {
      n: group.n,
      ...Object.fromEntries(Object.entries(group.values).map(([name, acc]) => [
        name,
        { n: acc.n, mape: +(acc.sum / acc.n * 100).toFixed(4) },
      ])),
    },
  ]));
}

function percentMetric(metric) {
  return metric.mape == null ? null : +(metric.mape * 100).toFixed(4);
}

const colorS22 = loadJson('color-diamond-ml-model.json');
const colorS23 = loadJson('color-diamond-ml-model-s23.json');
const adjustment = colorS22.sourceAdjustment?.messiColorToStarsgemLikeFactor ?? 1.25;
const rows = [
  ...loadJson('messi-color-index.json').records.map(row => normalizeColorRow(row, 'messi_color', adjustment)),
  ...loadJson('starsgem-color-index.json').records.map(row => normalizeColorRow(row, 'starsgem_color', adjustment)),
].filter(Boolean);

await loadIndex(path.join(DATA, 'alibaba-comps-index.json'));

const s22Preds = rows.map(row => predictColor(row, colorS22));
const s23Preds = rows.map(row => predictColor(row, colorS23));
const compResults = rows.map(row => resolveAlibabaComp(compQuery(row)));
const compPreds = compResults.map(result => result?.estimate ?? null);

// S27 point policy: Color S22 is the primary StarGem-like color surface.
// S23 and source-adjusted comps are retained as guardrails/support, not allowed
// to drag the point estimate unless S22 is unavailable.
const s27Preds = rows.map((row, i) => {
  if (s22Preds[i] > 0) return s22Preds[i];
  if (s23Preds[i] > 0) return s23Preds[i];
  return compPreds[i];
});

const anchors = rows.filter(row => row.source === 'starsgem_color');
const anchorIdx = rows.map((row, i) => row.source === 'starsgem_color' ? i : -1).filter(i => i >= 0);
const subsetPreds = (preds, idx) => idx.map(i => preds[i]);
const subsetRows = idx => idx.map(i => rows[i]);

const allMetrics = {
  colorS22: mape(rows, s22Preds),
  colorS23: mape(rows, s23Preds),
  colorCompEngine: mape(rows, compPreds),
  colorS27: mape(rows, s27Preds),
};
const anchorMetrics = {
  colorS22: mape(anchors, subsetPreds(s22Preds, anchorIdx)),
  colorS23: mape(anchors, subsetPreds(s23Preds, anchorIdx)),
  colorCompEngine: mape(anchors, subsetPreds(compPreds, anchorIdx)),
  colorS27: mape(anchors, subsetPreds(s27Preds, anchorIdx)),
};

const compCoverage = {
  predicted: compPreds.filter(price => Number.isFinite(Number(price)) && Number(price) > 0).length,
  total: rows.length,
  exactOrNearest: compResults.filter(result => result && ['exact', 'nearest'].includes(result.matchType)).length,
  none: compResults.filter(result => !result?.estimate).length,
};

const model = {
  generatedDate: new Date().toISOString().slice(0, 10),
  modelName: 'S27 — Color champion S22-led ML/monotone/comp policy',
  modelVersion: 's27-color-champion-v1',
  targetType: 'hybrid_policy',
  prediction: 'Color S22 is the point estimate; Color S23 and source-adjusted color comps are guardrails/support unless S22 is unavailable.',
  scope: {
    whiteDiamonds: false,
    fancyColorDiamonds: true,
    notes: 'White diamonds remain on S26. S27 is only for fancy-color / colored lab diamonds.',
  },
  sourceAdjustment: {
    messiColorToStarsgemLikeFactor: adjustment,
    starsgemDirectFactor: 1.0,
    notes: 'Messi color rows and Messi color comps are divided by this factor before scoring against StarGem-like factory pricing.',
  },
  sourceArtifacts: {
    pointEstimate: 'research/data/color-diamond-ml-model.json',
    monotoneGuardrail: 'research/data/color-diamond-ml-model-s23.json',
    messiColorIndex: 'research/data/messi-color-index.json',
    starsgemColorIndex: 'research/data/starsgem-color-index.json',
    compEngine: 'research/comp-engine-v3.js',
  },
  policy: {
    pointOrder: ['Color S22', 'Color S23', 'source-adjusted color comps'],
    sourceCaps: {
      colorS22: 1.0,
      colorS23: 0.35,
      colorCompEngine: 0.35,
    },
    rationale: [
      'Color S22 has the lowest validation MAPE and exact direct-StarGem anchor fit.',
      'Color S23 is retained for monotone intensity sanity checks.',
      'Color comps are source-adjusted and shown as support, but current color comp MAPE is materially worse than Color S22.',
    ],
  },
  metrics: {
    rows: {
      all: rows.length,
      messiColorSourceAdjusted: rows.filter(row => row.source === 'messi_color').length,
      directStarsgemColorAnchors: anchors.length,
    },
    validation: {
      colorS22: colorS22.metrics?.validation ?? null,
      colorS23: colorS23.metrics?.validation ?? null,
      colorS27: colorS22.metrics?.validation ?? null,
      note: 'S27 point policy is Color S22-led, so held-out validation point-error equals Color S22 unless S22 is unavailable.',
    },
    productionPolicyAllAdjustedRows: Object.fromEntries(Object.entries(allMetrics).map(([name, metric]) => [
      name,
      { n: metric.n, mape: percentMetric(metric) },
    ])),
    directStarsgemAnchors: Object.fromEntries(Object.entries(anchorMetrics).map(([name, metric]) => [
      name,
      { n: metric.n, mape: percentMetric(metric) },
    ])),
    compCoverage,
    byHue: groupMape(rows, { colorS22: s22Preds, colorS23: s23Preds, colorCompEngine: compPreds, colorS27: s27Preds }, row => row.colorHue),
    byColorKey: groupMape(rows, { colorS22: s22Preds, colorS23: s23Preds, colorCompEngine: compPreds, colorS27: s27Preds }, row => row.appColorKey),
    caveat: 'The all-row S27 score is a production-policy benchmark over source-adjusted rows. Color S22/S23 validation metrics remain the cleaner holdout comparison.',
  },
};

writeFileSync(OUT, JSON.stringify(model, null, 2) + '\n');
console.log(`S27 color champion -> ${OUT}`);
console.log(`Messi color source adjustment: ÷${adjustment}`);
console.log(`Validation MAPE: S27/Color S22 ${(colorS22.metrics.validation.mape * 100).toFixed(2)}%, Color S23 ${(colorS23.metrics.validation.mape * 100).toFixed(2)}%`);
console.log(`All adjusted rows MAPE: S27 ${model.metrics.productionPolicyAllAdjustedRows.colorS27.mape.toFixed(2)}%, Color S23 ${model.metrics.productionPolicyAllAdjustedRows.colorS23.mape.toFixed(2)}%, comp ${model.metrics.productionPolicyAllAdjustedRows.colorCompEngine.mape.toFixed(2)}%`);
