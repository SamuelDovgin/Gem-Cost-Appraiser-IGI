/**
 * Build S26 — champion hybrid policy metadata.
 *
 * S26 is intentionally not another free-form curve. It makes the deterministic
 * StarGem lookup surface the primary white-diamond anchor, then the browser
 * can blend in monotone-capped ML and live comps for sparse/out-of-range cases.
 *
 * Usage:
 *   node research/scripts/train-s26-champion.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DATA = path.join(ROOT, 'research', 'data');
const OUT = path.join(DATA, 'starsgem-ml-model-s26-champion.json');

function loadJson(name) {
  return JSON.parse(readFileSync(path.join(DATA, name), 'utf8'));
}

function norm(value) {
  const text = String(value ?? '-').trim().toUpperCase();
  return text || '-';
}

function caratBucket(carat) {
  const bands = [
    [0.30, 0.49, '0.30-0.49'],
    [0.50, 0.69, '0.50-0.69'],
    [0.70, 0.89, '0.70-0.89'],
    [0.90, 0.99, '0.90-0.99'],
    [1.00, 1.49, '1.00-1.49'],
    [1.50, 1.99, '1.50-1.99'],
    [2.00, 2.99, '2.00-2.99'],
    [3.00, 3.99, '3.00-3.99'],
    [4.00, 4.99, '4.00-4.99'],
    [5.00, 9.99, '5.00-9.99'],
  ];
  for (const [lo, hi, label] of bands) {
    if (carat >= lo && carat <= hi) return label;
  }
  if (carat >= 10) return '10.00+';
  return '<0.30';
}

function predictLookup(row, intel) {
  const carat = Number(row.carat ?? row.Carat);
  if (!Number.isFinite(carat) || carat <= 0) return null;
  const normalized = {
    carat_bucket: caratBucket(carat),
    Shape: norm(row.shape ?? row.Shape),
    Color: norm(row.color ?? row.Color),
    Clarity: norm(row.clarity ?? row.Clarity),
    TypeName: norm(row.typeName ?? row.TypeName),
    Report: norm(row.report ?? row.Report ?? 'IGI'),
    Cut: norm(row.cut_raw ?? row.Cut),
    Polish: norm(row.polish ?? row.Polish),
    Symmetry: norm(row.symmetry ?? row.Symmetry),
  };
  for (const table of intel.lookup?.tables || []) {
    const key = table.fields.map(field => normalized[field] ?? '-').join('||');
    const hit = table.groups?.[key];
    if (hit) {
      const price = carat * hit.rate / 170;
      return {
        price,
        perCt: price / carat,
        level: table.level,
        fields: table.fields,
        count: hit.count,
      };
    }
  }
  const rate = Number(intel.lookup?.globalMedianInternalRatePerCt) / 170;
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return { price: carat * rate, perCt: rate, level: 'GLOBAL', fields: [], count: 0 };
}

function mape(rows, preds) {
  let n = 0;
  let sum = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const actual = Number(rows[i].price);
    const pred = Number(preds[i]?.price);
    if (actual > 0 && pred > 0) {
      n += 1;
      sum += Math.abs(pred - actual) / actual;
    }
  }
  return { n, mape: n ? sum / n * 100 : null };
}

function groupMape(rows, preds, keyFn) {
  const groups = new Map();
  for (let i = 0; i < rows.length; i += 1) {
    const key = keyFn(rows[i]);
    const actual = Number(rows[i].price);
    const pred = Number(preds[i]?.price);
    if (!(actual > 0 && pred > 0)) continue;
    if (!groups.has(key)) groups.set(key, { n: 0, sum: 0 });
    const acc = groups.get(key);
    acc.n += 1;
    acc.sum += Math.abs(pred - actual) / actual;
  }
  return Object.fromEntries([...groups.entries()].sort().map(([key, acc]) => [
    key,
    { n: acc.n, mape: +(acc.sum / acc.n * 100).toFixed(4) },
  ]));
}

const rows = loadJson('dataset-clean-training.json');
const intel = loadJson('starsgem-pricing-intelligence.json');
const preds = rows.map(row => predictLookup(row, intel));
const overall = mape(rows, preds);

const levelCounts = {};
for (const pred of preds) {
  const key = pred?.level || 'NONE';
  levelCounts[key] = (levelCounts[key] || 0) + 1;
}

const now = new Date().toISOString().slice(0, 10);
const model = {
  generatedDate: now,
  modelName: 'S26 — Champion hybrid lookup/ML/comp policy',
  modelVersion: 's26-champion-v1.2',
  targetType: 'hybrid_policy',
  prediction: 'Dense StarGem lookup anchor; browser blends lookup + monotone-capped ML + live comp evidence when available.',
  scope: {
    whiteDiamonds: true,
    fancyColorDiamonds: false,
    notes: 'Fancy-color diamonds remain on Color S22/S23; S26 replaces the white S25 audit panel.',
  },
  sourceArtifacts: {
    lookup: 'research/data/starsgem-pricing-intelligence.json',
    mlPrimary: 'research/data/starsgem-ml-extra-trees-model-s20-specialty-tail.json',
    mlCandidate: 'research/data/starsgem-ml-extra-trees-model-s23-grade-agnostic-anchor.json',
    compEngine: 'research/comp-engine-v3.js',
  },
  policy: {
    lookupSigma: {
      exactDense: 0.08,
      exactMedium: 0.12,
      exactSparse: 0.18,
      gradeDropped: 0.24,
      shapeDropped: 0.34,
      global: 0.45,
    },
    mlSigma: 0.22,
    mlClarityCappedSigma: 0.26,
    compSigma: {
      exact: 0.12,
      high: 0.18,
      medium: 0.26,
      low: 0.38,
      extrapolated: 0.48,
    },
    sourceCaps: {
      lookup: 0.65,
      ml: 0.35,
      comp: 0.70,
    },
    mlAnchorDisagreement: {
      minStrongAnchors: 2,
      maxAnchorSigma: 0.18,
      maxAnchorSpread: 1.45,
      lowRatio: 0.55,
      highRatio: 1.80,
      outlierSigma: 1.50,
    },
    monotonicity: [
      'S26 consumes monotone-capped S22/S23 display predictions.',
      'Final UI comparison keeps lower clarity from exceeding better clarity for same carat/color/shape.',
    ],
  },
  metrics: {
    dataset: 'research/data/dataset-clean-training.json',
    n: overall.n,
    mape: +overall.mape.toFixed(4),
    caveat: 'White benchmark is in-sample against the StarGem lookup reconstruction; use as production policy comparison, not academic holdout.',
    levelCounts,
    perShapeMape: groupMape(rows, preds, row => row.shape),
    perCaratBucketMape: groupMape(rows, preds, row => caratBucket(Number(row.carat))),
  },
  pinnedCases: {
    '7.77ct ROUND E VS1': {
      policy: 'Blend exact/nearest comp and lookup; do not use S25 beta extrapolation.',
      expectedBehavior: 'S26 should price above the old S25 floor and flag high-carat support.',
    },
    '40ct ROUND E VS2/SI1': {
      policy: 'Use comp/lookup/monotone-capped ML; SI1 must not exceed VS2.',
      expectedBehavior: 'S26 display obeys clarity ordering after fallback.',
    },
  },
};

writeFileSync(OUT, JSON.stringify(model, null, 2) + '\n');
console.log(`S26 model -> ${OUT}`);
console.log(`S26 lookup benchmark MAPE: ${model.metrics.mape}% (n=${model.metrics.n})`);
console.log('Lookup level counts:', model.metrics.levelCounts);
