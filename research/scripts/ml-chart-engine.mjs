/**
 * Shared StarGem ML prediction helpers for chart generators.
 */

import { readFileSync } from 'fs';
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
const DATA = path.resolve(__dirname, '../data');

export const CLARITY_LADDER = ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2'];
export const COLOR_LADDER = ['D', 'E', 'F', 'G', 'H', 'I', 'J'];
export const SHAPE_FAN = ['ROUND', 'PEAR', 'OVAL', 'MARQUISE', 'EMERALD', 'PRINCESS', 'HEART', 'RADIANT'];
export const CARAT_BUCKET_EDGES = [0.3, 0.5, 0.7, 0.9, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 10.0];
export const MAGIC_WEIGHT_LINES = [1, 1.5, 2, 3, 4, 5, 10, 20];

let _cache = null;

export function loadChartEngine() {
  if (_cache) return _cache;
  const loadJson = rel => JSON.parse(readFileSync(path.join(DATA, rel), 'utf8'));
  _cache = {
    s20: loadJson('starsgem-ml-extra-trees-model-s20-specialty-tail.json'),
    s21: loadJson('starsgem-ml-extra-trees-model-s21-monotone.json'),
    s23: loadJson('starsgem-ml-extra-trees-model-s23-grade-agnostic-anchor.json'),
    s26: loadJson('starsgem-ml-model-s26-champion.json'),
    s28: loadJson('starsgem-ml-model-s28-monotone-parametric.json'),
    intel: loadJson('starsgem-pricing-intelligence.json'),
    cleanRows: loadJson('dataset-clean-training.json'),
    starsgemRecords: loadJson('starsgem-index.json').records || [],
  };
  return _cache;
}

export function normShape(value) {
  return String(value ?? '').trim().toUpperCase();
}

export function recordShape(row) {
  return normShape(row.rawShapeCode ?? row.shape ?? row.Shape);
}

export function normCut(row) {
  const raw = row.cut_raw ?? row.Cut ?? row.cut ?? '';
  const text = starsgemNorm(raw);
  if (text === 'ID' || text === 'IDEAL') return 'ID';
  if (text === 'EX' || text === 'EXCELLENT') return 'EX';
  if (!text || text === '-') return '-';
  return text;
}

export function normType(row) {
  return starsgemNorm(row.typeName ?? row.TypeName ?? row.growthMethod ?? 'CVD');
}

export function matchesSpec(row, spec, opts = {}) {
  const shape = opts?.fromClean ? normShape(row.shape) : recordShape(row);
  if (shape !== spec.shape) return false;
  if (starsgemNorm(row.color ?? row.Color) !== spec.color) return false;
  if (starsgemNorm(row.clarity ?? row.Clarity) !== spec.clarity) return false;
  if (spec.cut && spec.cut !== '*' && normCut(row) !== spec.cut) return false;
  if (spec.typeName && spec.typeName !== '*' && normType(row) !== spec.typeName) return false;
  if (spec.shapeStyle && opts?.fromClean) {
    const style = String(row.shape_style || '').toUpperCase();
    if (spec.shapeStyle !== style) return false;
  }
  return true;
}

export function actualPoint(row) {
  const carat = Number(row.carat ?? row.Carat);
  const upc = Number(
    row.upc ??
      row.pricePerCarat ??
      (row.price && carat ? row.price / carat : NaN) ??
      (row.pricePerStone && carat ? row.pricePerStone / carat : NaN),
  );
  if (!Number.isFinite(carat) || carat <= 0 || !Number.isFinite(upc) || upc <= 0) return null;
  return { x: carat, y: upc, price: upc * carat };
}

export function rowSpec(spec, carat) {
  const shapeStyle = (spec.shapeStyle || `${spec.shape}_STANDARD`).toLowerCase();
  const cutForTree = spec.cut === '-' || spec.cut === '*' ? 'EX' : spec.cut;
  return {
    ...buildStarsgemRow({
      carat,
      shape: spec.shape,
      color: spec.color,
      clarity: spec.clarity,
      cut: cutForTree,
      typeName: spec.typeName === '*' ? 'CVD' : spec.typeName || 'CVD',
    }),
    shape_style: shapeStyle,
    Shape_Style: shapeStyle,
  };
}

export function rawSpec(spec, carat) {
  return {
    carat,
    shape: spec.shape,
    color: spec.color,
    clarity: spec.clarity,
    cut_raw: spec.cut === 'ID' ? 'ID' : spec.cut === 'EX' ? 'EX' : '-',
    typeName: spec.typeName === '*' ? 'CVD' : spec.typeName || 'CVD',
    shape_style: spec.shapeStyle || `${spec.shape}_STANDARD`,
  };
}

export function createPredictors(engine) {
  const { s20, s21, s23, s26, s28, intel } = engine;

  function s26LookupPrediction(raw, row) {
    const carat = Number(raw.carat);
    if (!carat || carat <= 0) return null;
    const normalized = {
      carat_bucket: starsgemCaratBucket(carat),
      Shape: normShape(raw.shape),
      Color: starsgemNorm(raw.color),
      Clarity: starsgemNorm(raw.clarity),
      TypeName: starsgemNorm(raw.typeName ?? 'CVD'),
      Report: 'IGI',
      Cut: starsgemNorm(raw.cut_raw ?? '-'),
      Polish: starsgemNorm(raw.polish ?? 'EX'),
      Symmetry: starsgemNorm(raw.symmetry ?? 'EX'),
    };
    for (const table of intel.lookup?.tables || []) {
      const key = table.fields.map(field => normalized[field] ?? '-').join('||');
      const hit = table.groups?.[key];
      if (hit) {
        const price = (carat * hit.rate) / 170;
        return {
          price,
          upc: price / carat,
          level: table.level,
          count: hit.count,
          fields: table.fields,
          bucket: normalized.carat_bucket,
        };
      }
    }
    const rate = Number(intel.lookup?.globalMedianInternalRatePerCt) / 170;
    return rate > 0
      ? {
          price: carat * rate,
          upc: rate,
          level: 'GLOBAL',
          count: 0,
          fields: [],
          bucket: normalized.carat_bucket,
        }
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
    const add = (kind, price, sigma) => {
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(sigma) || sigma <= 0) return;
      sources.push({ kind, price, sigma, rawWeight: 1 / (sigma * sigma) });
    };

    const lookupPred = s26LookupPrediction(raw, row);
    if (lookupPred?.price > 0) add('lookup', lookupPred.price, s26LookupSigma(lookupPred));

    const mlSigma = s26.policy?.mlSigma ?? 0.22;
    const globalSigma = s26.policy?.mlGlobalFallbackSigma ?? 1.5;
    const p22 = s22Prediction(row);
    const p23 = s23Prediction(row);
    if (p22?.price > 0) add('ml', p22.price, p22.tail?.level === 'GLOBAL' ? globalSigma : mlSigma);
    if (p23?.price > 0) add('ml', p23.price, p23.tail?.level === 'GLOBAL' ? globalSigma : mlSigma);

    if (!sources.length) return null;
    const weights = s26CappedWeights(sources, s26.policy?.sourceCaps || {});
    let logPrice = 0;
    for (let i = 0; i < sources.length; i++) {
      logPrice += weights[i] * Math.log(sources[i].price);
    }
    const price = Math.exp(logPrice);
    return {
      price,
      upc: price / carat,
      sources: sources.map((s, i) => ({ ...s, weight: weights[i] })),
    };
  }

  function predictAll(spec, overrides = {}) {
    const merged = { ...spec, ...overrides };
    const carat = Number(merged.carat ?? overrides.carat);
    if (!carat || carat <= 0) return null;
    const row = rowSpec(merged, carat);
    const raw = rawSpec(merged, carat);
    if (overrides.color) {
      row.Color = overrides.color;
      raw.color = overrides.color;
    }
    if (overrides.clarity) {
      row.Clarity = overrides.clarity;
      raw.clarity = overrides.clarity;
    }
    if (overrides.shape) {
      row.Shape = overrides.shape;
      raw.shape = overrides.shape;
      const style = overrides.shapeStyle || `${overrides.shape}_STANDARD`;
      row.shape_style = style.toLowerCase();
      row.Shape_Style = style.toLowerCase();
      raw.shape_style = style;
    }

    const lookup = s26LookupPrediction(raw, row);
    const s26h = predictS26Hybrid(row, raw);
    const s28p = predictS28({ ...row, shape_style: merged.shapeStyle?.toLowerCase() }, s28);
    const s22p = s22Prediction(row);
    const s23p = s23Prediction(row);

    return {
      carat,
      bucket: starsgemCaratBucket(carat),
      lookup,
      s26: s26h,
      s28: s28p,
      s22: s22p,
      s23: s23p,
    };
  }

  function curveUpc(spec, carats) {
    const curves = { s26: [], s28: [], s22: [], s23: [], s26Lookup: [] };
    const meta = [];
    for (const carat of carats) {
      const p = predictAll({ ...spec, carat });
      if (!p) continue;
      if (p.s26?.upc > 0) curves.s26.push({ x: carat, y: p.s26.upc });
      if (p.s28?.upc > 0) curves.s28.push({ x: carat, y: p.s28.upc });
      if (p.s22?.price > 0) curves.s22.push({ x: carat, y: p.s22.price / carat });
      if (p.s23?.price > 0) curves.s23.push({ x: carat, y: p.s23.price / carat });
      if (p.lookup?.upc > 0) {
        curves.s26Lookup.push({ x: carat, y: p.lookup.upc });
        meta.push({
          x: carat,
          bucket: p.bucket,
          lookupLevel: p.lookup.level,
          lookupCount: p.lookup.count,
        });
      }
    }
    return { curves, meta };
  }

  function curveTotalPrice(spec, carats) {
    const curves = { s26: [], s28: [], s26Lookup: [] };
    for (const carat of carats) {
      const p = predictAll({ ...spec, carat });
      if (p.s26?.price > 0) curves.s26.push({ x: carat, y: p.s26.price });
      if (p.s28?.price > 0) curves.s28.push({ x: carat, y: p.s28.price });
      if (p.lookup?.price > 0) curves.s26Lookup.push({ x: carat, y: p.lookup.price });
    }
    return curves;
  }

  return {
    predictAll,
    curveUpc,
    curveTotalPrice,
    s26LookupPrediction,
  };
}

export function caratRange(min, max, step) {
  const pts = [];
  for (let c = min; c <= max + step / 2; c += step) {
    pts.push(Number(c.toFixed(4)));
  }
  return pts;
}

export function binnedMedian(points, binWidth = 0.08) {
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

/** Simple rolling median for smoother “actual” display lines */
export function rollingMedian(points, windowCt = 0.2) {
  if (points.length < 3) return points;
  const sorted = [...points].sort((a, b) => a.x - b.x);
  return sorted.map((p, i) => {
    const neighbors = sorted.filter(o => Math.abs(o.x - p.x) <= windowCt);
    const ys = neighbors.map(o => o.y).sort((a, b) => a - b);
    return { x: p.x, y: ys[Math.floor(ys.length / 2)], n: neighbors.length };
  });
}

export function collectActuals(engine, spec, maxCt, { fromClean = true, fromIndex = true } = {}) {
  const clean = [];
  const starsgem = [];
  if (fromClean) {
    for (const row of engine.cleanRows) {
      if (!matchesSpec(row, spec, { fromClean: true })) continue;
      const pt = actualPoint(row);
      if (pt && pt.x <= maxCt + 0.5) clean.push(pt);
    }
  }
  if (fromIndex) {
    for (const row of engine.starsgemRecords) {
      if (!matchesSpec(row, spec)) continue;
      const pt = actualPoint(row);
      if (pt && pt.x <= maxCt + 0.5) starsgem.push(pt);
    }
  }
  return { clean, starsgem };
}

export function samplePoints(points, max = 1000) {
  if (points.length <= max) return points;
  const step = Math.ceil(points.length / max);
  return points.filter((_, i) => i % step === 0);
}
