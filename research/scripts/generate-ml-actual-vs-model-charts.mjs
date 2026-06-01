/**
 * Build chart data: StarGem actuals (raw index + clean dataset) vs ML estimates.
 *
 * Outputs: research/data/ml-actual-vs-model-charts-data.json
 * View:    research/ml-actual-vs-model-charts.html (via npm run serve)
 *
 * Usage:
 *   node research/scripts/generate-ml-actual-vs-model-charts.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildStarsgemRow,
  predictStarsgemMl,
  starsgemNorm,
  starsgemCaratBucket,
} from './starsgem-ml-predict.mjs';
import { predictS28 } from './s28-predict.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DATA = path.join(ROOT, 'research', 'data');
const OUT = path.join(DATA, 'ml-actual-vs-model-charts-data.json');

function loadJson(rel) {
  return JSON.parse(readFileSync(path.join(DATA, rel), 'utf8'));
}

const s20 = loadJson('starsgem-ml-extra-trees-model-s20-specialty-tail.json');
const s21 = loadJson('starsgem-ml-extra-trees-model-s21-monotone.json');
const s23 = loadJson('starsgem-ml-extra-trees-model-s23-grade-agnostic-anchor.json');
const s26 = loadJson('starsgem-ml-model-s26-champion.json');
const s28 = loadJson('starsgem-ml-model-s28-monotone-parametric.json');
const intel = loadJson('starsgem-pricing-intelligence.json');

const cleanRows = loadJson('dataset-clean-training.json');
const starsgemIndex = loadJson('starsgem-index.json');
const starsgemRecords = starsgemIndex.records || [];

function normShape(value) {
  const text = String(value ?? '').trim().toUpperCase();
  if (!text) return '';
  if (text === 'ROUND' || text === 'OVAL' || text === 'PEAR' || text === 'EMERALD') return text;
  if (text === 'MARQUISE' || text === 'RADIANT' || text === 'PRINCESS' || text === 'HEART') return text;
  if (text === 'CUSHION' || text === 'ASSCHER' || text === 'SQUARE') return text;
  return text;
}

function recordShape(row) {
  return normShape(row.rawShapeCode ?? row.shape ?? row.Shape);
}

function normCut(row) {
  const raw = row.cut_raw ?? row.Cut ?? row.cut ?? '';
  const text = starsgemNorm(raw);
  if (text === 'ID' || text === 'IDEAL') return 'ID';
  if (text === 'EX' || text === 'EXCELLENT') return 'EX';
  if (!text || text === '-') return '-';
  return text;
}

function normType(row) {
  return starsgemNorm(row.typeName ?? row.TypeName ?? row.growthMethod ?? 'CVD');
}

function matchesSpec(row, spec, { fromClean = false } = {}) {
  const shape = fromClean ? normShape(row.shape) : recordShape(row);
  if (shape !== spec.shape) return false;
  if (starsgemNorm(row.color ?? row.Color) !== spec.color) return false;
  if (starsgemNorm(row.clarity ?? row.Clarity) !== spec.clarity) return false;
  if (spec.cut && spec.cut !== '*' && normCut(row) !== spec.cut) return false;
  if (spec.typeName && spec.typeName !== '*' && normType(row) !== spec.typeName) return false;
  if (spec.shapeStyle && fromClean) {
    const style = String(row.shape_style || '').toUpperCase();
    if (spec.shapeStyle !== style) return false;
  }
  return true;
}

function actualPoint(row, fromClean) {
  const carat = Number(row.carat ?? row.Carat);
  const upc = Number(
    row.upc ??
      row.pricePerCarat ??
      (row.price && carat ? row.price / carat : NaN) ??
      (row.pricePerStone && carat ? row.pricePerStone / carat : NaN),
  );
  if (!Number.isFinite(carat) || carat <= 0 || !Number.isFinite(upc) || upc <= 0) return null;
  return { x: carat, y: upc };
}

function s26LookupPrediction(raw, rowForLookup) {
  const carat = Number(raw.carat ?? raw.Carat);
  if (!carat || carat <= 0) return null;
  const normalized = {
    carat_bucket: starsgemCaratBucket(carat),
    Shape: normShape(raw.shape ?? raw.Shape ?? rowForLookup?.Shape),
    Color: starsgemNorm(raw.color ?? raw.Color),
    Clarity: starsgemNorm(raw.clarity ?? raw.Clarity),
    TypeName: starsgemNorm(raw.typeName ?? raw.TypeName ?? raw.growthMethod ?? 'CVD'),
    Report: 'IGI',
    Cut: starsgemNorm(raw.cut_raw ?? raw.Cut ?? '-'),
    Polish: starsgemNorm(raw.polish ?? 'EX'),
    Symmetry: starsgemNorm(raw.symmetry ?? 'EX'),
  };
  for (const table of intel.lookup?.tables || []) {
    const key = table.fields.map(field => normalized[field] ?? '-').join('||');
    const hit = table.groups?.[key];
    if (hit) {
      const price = (carat * hit.rate) / 170;
      return { price, upc: price / carat, level: table.level, count: hit.count, fields: table.fields };
    }
  }
  const rate = Number(intel.lookup?.globalMedianInternalRatePerCt) / 170;
  return rate > 0
    ? { price: carat * rate, upc: rate, level: 'GLOBAL', count: 0, fields: [] }
    : null;
}

function isEffectivelyGlobal(pred) {
  return !pred || pred.lookupLevel === 'GLOBAL' || (pred.lookupCount ?? pred.count ?? 0) <= 3;
}

function s22Prediction(row) {
  const pred = predictStarsgemMl(row, s20);
  if (pred && isEffectivelyGlobal(pred)) {
    const fallback = predictStarsgemMl(row, s21);
    if (
      fallback &&
      (fallback.lookupCount ?? 0) > (pred.lookupCount ?? 0) &&
      fallback.price > pred.price
    ) {
      return { ...fallback, usedS21Fallback: true };
    }
  }
  return { ...pred, usedS21Fallback: false };
}

function s23Prediction(row) {
  const pred = predictStarsgemMl(row, s23);
  if (pred && isEffectivelyGlobal(pred)) {
    const fallback = predictStarsgemMl(row, s21);
    if (
      fallback &&
      (fallback.lookupCount ?? 0) > (pred.lookupCount ?? 0) &&
      fallback.price > pred.price
    ) {
      return { ...fallback, usedS21Fallback: true };
    }
  }
  return { ...pred, usedS21Fallback: false };
}

function s26LookupSigma(lookupPred) {
  const p = s26?.policy?.lookupSigma || {};
  if (!lookupPred) return p.global ?? 0.45;
  const fields = lookupPred.fields || [];
  if (lookupPred.level === 'GLOBAL') return p.global ?? 0.45;
  if (!fields.includes('Shape')) return p.shapeDropped ?? 0.34;
  if (!fields.includes('Color') || !fields.includes('Clarity')) return p.gradeDropped ?? 0.24;
  const count = Number(lookupPred.count ?? 0);
  if (count >= 50) return p.exactDense ?? 0.08;
  if (count >= 10) return p.exactMedium ?? 0.12;
  return p.exactSparse ?? 0.18;
}

function s26CappedWeights(sources, caps) {
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
      weights[i] =
        freeRaw > 0
          ? ((1 - lockedSum) * sources[i].rawWeight) / freeRaw
          : (1 - lockedSum) / Math.max(free.length, 1);
    }
  }
  return weights;
}

function predictS26Hybrid(row, raw) {
  const carat = Number(row.Carat);
  if (!carat || carat <= 0) return null;
  const sources = [];
  const add = (kind, label, price, sigma) => {
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(sigma) || sigma <= 0) return;
    sources.push({ kind, label, price, sigma, rawWeight: 1 / (sigma * sigma) });
  };

  const lookupPred = s26LookupPrediction(raw, row);
  if (lookupPred?.price > 0) {
    add('lookup', 'lookup', lookupPred.price, s26LookupSigma(lookupPred));
  }

  const mlSigma = s26.policy?.mlSigma ?? 0.22;
  const globalSigma = s26.policy?.mlGlobalFallbackSigma ?? 1.5;
  const p22 = s22Prediction(row);
  const p23 = s23Prediction(row);
  if (p22?.price > 0) {
    const global = p22.tail?.level === 'GLOBAL';
    add('ml', 'S22', p22.price, global ? globalSigma : mlSigma);
  }
  if (p23?.price > 0) {
    const global = p23.tail?.level === 'GLOBAL';
    add('ml', 'S23', p23.price, global ? globalSigma : mlSigma);
  }

  if (!sources.length) return null;
  const weights = s26CappedWeights(sources, s26.policy?.sourceCaps || {});
  let logPrice = 0;
  for (let i = 0; i < sources.length; i++) {
    logPrice += weights[i] * Math.log(sources[i].price);
  }
  const price = Math.exp(logPrice);
  return { price, upc: price / carat };
}

function rowSpec(spec, carat) {
  const shapeStyle = (spec.shapeStyle || `${spec.shape}_STANDARD`).toLowerCase();
  return {
    ...buildStarsgemRow({
      carat,
      shape: spec.shape,
      color: spec.color,
      clarity: spec.clarity,
      cut: spec.cut === '-' ? 'EX' : spec.cut,
      typeName: spec.typeName || 'CVD',
    }),
    shape_style: shapeStyle,
    Shape_Style: shapeStyle,
  };
}

function rawSpec(spec, carat) {
  return {
    carat,
    shape: spec.shape,
    color: spec.color,
    clarity: spec.clarity,
    cut_raw: spec.cut === 'ID' ? 'ID' : spec.cut === 'EX' ? 'EX' : spec.cut === '*' ? '-' : '-',
    typeName: spec.typeName || 'CVD',
    shape_style: spec.shapeStyle || `${spec.shape}_STANDARD`,
  };
}

function caratGrid(maxCt) {
  const pts = [];
  for (let c = 0.5; c <= maxCt + 0.001; c += c < 2 ? 0.05 : c < 5 ? 0.1 : 0.25) {
    pts.push(Number(c.toFixed(2)));
  }
  return pts;
}

function binnedMedian(points, binWidth = 0.08) {
  const bins = new Map();
  for (const p of points) {
    const key = Math.round(p.x / binWidth) * binWidth;
    if (!bins.has(key)) bins.set(key, []);
    bins.get(key).push(p.y);
  }
  return [...bins.entries()]
    .map(([x, ys]) => ({
      x: Number(x.toFixed(2)),
      y: ys.sort((a, b) => a - b)[Math.floor(ys.length / 2)],
      n: ys.length,
    }))
    .sort((a, b) => a.x - b.x);
}

function samplePoints(points, max = 1200) {
  if (points.length <= max) return points;
  const step = Math.ceil(points.length / max);
  return points.filter((_, i) => i % step === 0);
}

const CHART_SPECS = [
  {
    id: 'round-e-vs1',
    title: 'ROUND · E · VS1 · ID · CVD',
    subtitle: 'Dense commodity cell (3ct diagnosis case)',
    spec: { shape: 'ROUND', color: 'E', clarity: 'VS1', cut: 'ID', typeName: 'CVD', shapeStyle: 'ROUND_STANDARD' },
    maxCt: 20,
  },
  {
    id: 'round-d-if',
    title: 'ROUND · D · IF · ID · HPHT',
    subtitle: 'Top white grade (clean Segment A is HPHT for this cell)',
    spec: { shape: 'ROUND', color: 'D', clarity: 'IF', cut: 'ID', typeName: 'HPHT', shapeStyle: 'ROUND_STANDARD' },
    maxCt: 20,
  },
  {
    id: 'round-d-vvs1',
    title: 'ROUND · D · VVS1 (all cuts & growth)',
    subtitle: 'High-volume round cell — CVD + HPHT, ID + EX',
    spec: { shape: 'ROUND', color: 'D', clarity: 'VVS1', cut: '*', typeName: '*', shapeStyle: 'ROUND_STANDARD' },
    maxCt: 20,
  },
  {
    id: 'pear-e-vs1',
    title: 'PEAR · E · VS1 · CVD',
    subtitle: 'Common fancy shape (clean training 0.5–1.4ct)',
    spec: { shape: 'PEAR', color: 'E', clarity: 'VS1', cut: '-', typeName: 'CVD', shapeStyle: 'PEAR_STANDARD' },
    maxCt: 5,
  },
  {
    id: 'heart-d-vs1',
    title: 'HEART · D · VS1 · CVD',
    subtitle: 'Sparse shape — large-carat extrapolation stress test',
    spec: { shape: 'HEART', color: 'D', clarity: 'VS1', cut: '-', typeName: 'CVD', shapeStyle: 'HEART_STANDARD' },
    maxCt: 12,
  },
  {
    id: 'oval-d-vvs1',
    title: 'OVAL · D · VVS1 · CVD',
    subtitle: 'Large-carat IGI-enriched range (to ~40ct in index)',
    spec: { shape: 'OVAL', color: 'D', clarity: 'VVS1', cut: '-', typeName: 'CVD', shapeStyle: 'OVAL_STANDARD' },
    maxCt: 42,
  },
  {
    id: 'marquise-e-vs1',
    title: 'MARQUISE · E · VS1 · CVD',
    subtitle: 'Mid fancy shape',
    spec: { shape: 'MARQUISE', color: 'E', clarity: 'VS1', cut: '-', typeName: 'CVD', shapeStyle: 'MARQUISE_STANDARD' },
    maxCt: 8,
  },
];

function buildChart(chartSpec) {
  const { spec, maxCt } = chartSpec;
  const carats = caratGrid(maxCt);

  const curves = {
    s26: [],
    s28: [],
    s22: [],
    s26Lookup: [],
  };

  for (const carat of carats) {
    const row = rowSpec(spec, carat);
    const raw = rawSpec(spec, carat);

    const p26 = predictS26Hybrid(row, raw);
    const p28 = predictS28(
      {
        ...row,
        shape_style: spec.shapeStyle,
        Shape_Style: spec.shapeStyle,
      },
      s28,
    );
    const p22 = s22Prediction(row);
    const pLookup = s26LookupPrediction(raw, row);

    if (p26?.upc > 0) curves.s26.push({ x: carat, y: p26.upc });
    if (p28?.upc > 0) curves.s28.push({ x: carat, y: p28.upc });
    if (p22?.price > 0) curves.s22.push({ x: carat, y: p22.price / carat });
    if (pLookup?.upc > 0) curves.s26Lookup.push({ x: carat, y: pLookup.upc });
  }

  const cleanScatter = [];
  for (const row of cleanRows) {
    if (!matchesSpec(row, spec, { fromClean: true })) continue;
    const pt = actualPoint(row, true);
    if (pt) cleanScatter.push(pt);
  }

  const starsgemScatter = [];
  for (const row of starsgemRecords) {
    if (!matchesSpec(row, spec)) continue;
    const pt = actualPoint(row, false);
    if (pt && pt.x <= maxCt + 0.5) starsgemScatter.push(pt);
  }

  return {
    id: chartSpec.id,
    title: chartSpec.title,
    subtitle: chartSpec.subtitle,
    spec,
    maxCt,
    counts: {
      clean: cleanScatter.length,
      starsgem: starsgemScatter.length,
    },
    curves,
    scatter: {
      clean: samplePoints(cleanScatter),
      starsgem: samplePoints(starsgemScatter),
    },
    medianCurves: {
      clean: binnedMedian(cleanScatter),
      starsgem: binnedMedian(starsgemScatter),
    },
  };
}

console.log('Loading data and building charts…');
const charts = CHART_SPECS.map(buildChart);

const payload = {
  generatedAt: new Date().toISOString(),
  description:
    'Continuous ML $/ct curves vs StarGem actuals. S26 hybrid = lookup + S22/S23 (no live comps). Actuals: clean training set + raw starsgem-index records.',
  models: {
    s26: 'S26 champion hybrid (lookup + monotone ML, offline — no comp engine)',
    s26Lookup: 'S26 lookup reconstruction only (4.8% benchmark anchor)',
    s28: 'S28 monotone parametric surface (extrapolation prototype)',
    s22: 'S22 + S21 fallback (tree ML)',
  },
  sources: {
    clean: 'research/data/dataset-clean-training.json',
    starsgem: 'research/data/starsgem-index.json → records',
  },
  charts,
};

writeFileSync(OUT, JSON.stringify(payload));
console.log(`Wrote ${OUT}`);
console.log(`Charts: ${charts.length}`);
for (const c of charts) {
  console.log(
    `  ${c.id}: clean n=${c.counts.clean} starsgem n=${c.counts.starsgem} · curves ${c.curves.s26.length} pts`,
  );
}
