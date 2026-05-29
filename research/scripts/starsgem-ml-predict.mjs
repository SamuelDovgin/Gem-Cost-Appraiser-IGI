/**
 * Minimal StarGem Extra Trees predictor for Node analysis scripts.
 * Mirrors index.html S19 log_lookup_residual inference.
 */

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

let _modelPromise = null;

export function loadStarsgemMlModel(rel = 'research/data/starsgem-ml-extra-trees-model-s20-specialty-tail.json') {
  if (!_modelPromise) {
    _modelPromise = Promise.resolve().then(() => {
      const raw = readFileSync(path.join(ROOT, rel), 'utf8');
      return JSON.parse(raw);
    });
  }
  return _modelPromise;
}

export function starsgemNorm(value) {
  const text = String(value ?? '-').trim().toUpperCase().replace(/\s+/g, ' ');
  return text && text !== 'N/A' && text !== 'NONE' && text !== 'NULL' ? text : '-';
}

export function starsgemCaratBucket(carat) {
  const c = Number(carat);
  if (c >= 0.30 && c <= 0.49) return '0.30-0.49';
  if (c >= 0.50 && c <= 0.69) return '0.50-0.69';
  if (c >= 0.70 && c <= 0.89) return '0.70-0.89';
  if (c >= 0.90 && c <= 0.99) return '0.90-0.99';
  if (c >= 1.00 && c <= 1.49) return '1.00-1.49';
  if (c >= 1.50 && c <= 1.99) return '1.50-1.99';
  if (c >= 2.00 && c <= 2.99) return '2.00-2.99';
  if (c >= 3.00 && c <= 3.99) return '3.00-3.99';
  if (c >= 4.00 && c <= 4.99) return '4.00-4.99';
  if (c >= 5.00 && c <= 9.99) return '5.00-9.99';
  if (c >= 10.00) return '10.00+';
  return '<0.30';
}

function starsgemCutStyleGroup(cut) {
  const map = {
    '传统切': 'traditional',
    '冰花切': 'ice_flower',
    '长垫形': 'elongated_cushion',
    '老欧切': 'old_european',
    '老矿切': 'old_miner',
  };
  const value = String(cut ?? '-').trim();
  if (map[value]) return map[value];
  const norm = starsgemNorm(value);
  if (norm === '-') return 'unknown';
  if (['ID', 'EX', 'VG', 'GD'].includes(norm)) return 'standard_grade';
  return 'unknown';
}

function starsgemCaratBucketPosition(carat) {
  if (!Number.isFinite(carat)) return 0.5;
  const bounds = [
    [0.30, 0.49], [0.50, 0.69], [0.70, 0.89], [0.90, 0.99],
    [1.00, 1.49], [1.50, 1.99], [2.00, 2.99], [3.00, 3.99],
    [4.00, 4.99], [5.00, 9.99],
  ];
  for (const [lo, hi] of bounds) {
    if (carat >= lo && carat <= hi) return (carat - lo) / (hi - lo);
  }
  return 0.5;
}

function starsgemLargeCaratTailStart(model) {
  return Number(model?.largeCaratTail?.startCarat) || 5;
}

function starsgemLargeCaratTailX(row, model) {
  const carat = Number(row?.Carat ?? row?.carat);
  const start = starsgemLargeCaratTailStart(model);
  return Number.isFinite(carat) && carat > start ? Math.log(carat / start) : 0;
}

function starsgemTailAnchorRow(row, model) {
  const carat = Number(row?.Carat ?? row?.carat);
  const start = starsgemLargeCaratTailStart(model);
  if (!Number.isFinite(carat) || carat <= start) return row;
  return { ...row, carat_bucket: '5.00-9.99' };
}

function starsgemModelLookupRate(row, model) {
  const featureLookups = model?.featureLookups || {};
  const tables = featureLookups.lookupTables || [];
  const normalized = { ...row };
  ['carat_bucket', 'Shape', 'Color', 'Clarity', 'TypeName', 'Report', 'Cut', 'Polish', 'Symmetry'].forEach((field) => {
    normalized[field] = starsgemNorm(normalized[field]);
  });
  for (const table of tables) {
    const key = (table.fields || []).map(field => normalized[field] ?? '-').join('||');
    const hit = table.groups?.[key];
    if (hit && Number.isFinite(Number(hit.usdPerCt))) {
      return { rate: Number(hit.usdPerCt), level: table.level, count: hit.count || 0 };
    }
  }
  const internalGlobal = Number(featureLookups.lookupGlobalRate);
  return {
    rate: Number.isFinite(internalGlobal) ? internalGlobal / 170 : null,
    level: 'GLOBAL',
    count: 0,
  };
}

function starsgemModelTailBaseLookupRate(row, model) {
  return starsgemModelLookupRate(starsgemTailAnchorRow(row, model), model);
}

function starsgemLargeCaratTailMultiplier(row, model) {
  const tail = model?.largeCaratTail;
  const x = starsgemLargeCaratTailX(row, model);
  if (!tail || x <= 0) return { multiplier: 1, level: 'NONE', count: 0, slope: 0 };
  const normalized = { ...row, Cut_Style_Group: row?.Cut_Style_Group || starsgemCutStyleGroup(row?.Cut) };
  for (const table of tail.levels || []) {
    const key = (table.fields || []).map((field) => {
      if (field === 'Cut_Style_Group') return normalized.Cut_Style_Group || 'unknown';
      return starsgemNorm(normalized[field]);
    }).join('||');
    const hit = table.groups?.[key];
    if (hit) {
      const slope = Number(hit.slope) || 0;
      return { multiplier: Math.exp(slope * x), level: table.level || 'TAIL', count: hit.count || 0, slope };
    }
  }
  const slope = Number(tail.globalSlope) || 0;
  return { multiplier: Math.exp(slope * x), level: 'GLOBAL', count: 0, slope };
}

function starsgemModelCategoryRate(row, model) {
  const featureLookups = model?.featureLookups || {};
  const tables = featureLookups.categoryTables || {};
  const levels = featureLookups.categoryLevels || [];
  for (const level of levels) {
    const name = level[0];
    const fields = level[1] || [];
    const key = fields.map(field => starsgemNorm(row[field])).join('||');
    const val = tables[name]?.[key];
    if (Number.isFinite(Number(val))) return Number(val);
  }
  const global = Number(featureLookups.categoryGlobalRate);
  return Number.isFinite(global) ? global : null;
}

function starsgemNumericFeatureValue(row, field, model) {
  const carat = Number(row?.Carat ?? row?.carat);
  if (field === 'Carat_sq') return Number.isFinite(carat) ? carat * carat : row?.[field];
  if (field === 'Carat_cube') return Number.isFinite(carat) ? carat * carat * carat : row?.[field];
  if (field === 'Log_Carat') return Number.isFinite(carat) && carat > 0 ? Math.log(carat) : row?.[field];
  if (field === 'Carat_bucket_pos') return starsgemCaratBucketPosition(carat);
  if (field === 'Dist_carat_threshold') return Number.isFinite(carat) ? Math.abs(carat - Math.round(carat * 2) / 2) : row?.[field];
  if (field === 'Is_Specialty_Cut') {
    const group = starsgemCutStyleGroup(row?.Cut);
    return group !== 'standard_grade' && group !== 'unknown' ? 1 : 0;
  }
  if (field === 'Is_Traditional_Cut') return starsgemCutStyleGroup(row?.Cut) === 'traditional' ? 1 : 0;
  if (field === 'Is_IceFlower_Cut') return starsgemCutStyleGroup(row?.Cut) === 'ice_flower' ? 1 : 0;
  if (field === 'Is_Large_Carat') return Number.isFinite(carat) && carat >= starsgemLargeCaratTailStart(model) ? 1 : 0;
  if (field === 'Is_10ct_Plus') return Number.isFinite(carat) && carat >= 10 ? 1 : 0;
  if (field === 'Large_Carat_Tail_X') return starsgemLargeCaratTailX(row, model);
  if (field === 'Large_Carat_Tail_X_sq') {
    const x = starsgemLargeCaratTailX(row, model);
    return x * x;
  }
  if (field === 'Tail_Base_Lookup_RatePerCt') return starsgemModelTailBaseLookupRate(row, model).rate;
  if (field === 'Log_Tail_Base_Lookup_RatePerCt') {
    const rate = starsgemModelTailBaseLookupRate(row, model).rate;
    return Number.isFinite(rate) && rate > 0 ? Math.log(rate) : row?.[field];
  }
  if (field === 'Tail_Base_Lookup_Count') return starsgemModelTailBaseLookupRate(row, model).count || 0;
  if (field === 'Large_Carat_Tail_Multiplier') return starsgemLargeCaratTailMultiplier(row, model).multiplier;
  if (field === 'Log_Large_Carat_Tail_Multiplier') return Math.log(Math.max(starsgemLargeCaratTailMultiplier(row, model).multiplier || 1, 0.000001));
  if (field === 'Large_Carat_Tail_Slope') return starsgemLargeCaratTailMultiplier(row, model).slope || 0;
  if (field === 'Large_Carat_Tail_Count') return starsgemLargeCaratTailMultiplier(row, model).count || 0;
  if (field === 'Lookup_RatePerCt') return starsgemModelLookupRate(row, model).rate;
  if (field === 'Lookup_IsGlobal') return starsgemModelLookupRate(row, model).level === 'GLOBAL' ? 1 : 0;
  if (field === 'Lookup_Count') return starsgemModelLookupRate(row, model).count || 0;
  if (field === 'Log_Lookup_Count') return Math.log1p(starsgemModelLookupRate(row, model).count || 0);
  if (field === 'Log_Lookup_RatePerCt') {
    const rate = starsgemModelLookupRate(row, model).rate;
    return Number.isFinite(rate) && rate > 0 ? Math.log(rate) : row?.[field];
  }
  if (field === 'Category_RatePerCt') return starsgemModelCategoryRate(row, model);
  if (field === 'Log_Category_RatePerCt') {
    const rate = starsgemModelCategoryRate(row, model);
    return Number.isFinite(rate) && rate > 0 ? Math.log(rate) : row?.[field];
  }
  if (field === 'Has_Dimensions') {
    const l = Number(row?.Length);
    const w = Number(row?.Width);
    const h = Number(row?.Height);
    return Number.isFinite(l) && Number.isFinite(w) && Number.isFinite(h) && l > 0 && w > 0 && h > 0 ? 1 : 0;
  }
  if (field === 'Has_TableDepth') {
    const table = Number(row?.Table_Scale);
    const depth = Number(row?.Depth_Scale);
    return Number.isFinite(table) && Number.isFinite(depth) && table > 0 && depth > 0 ? 1 : 0;
  }
  if (field === 'Has_GrowthMethod') return starsgemNorm(row?.TypeName) === '-' ? 0 : 1;
  if (field === 'Has_Report_Cut') return starsgemNorm(row?.Cut) === '-' ? 0 : 1;
  if (field === 'Is_SelectedSpec_Mode') {
    const l = Number(row?.Length);
    const w = Number(row?.Width);
    const h = Number(row?.Height);
    return Number.isFinite(l) && Number.isFinite(w) && Number.isFinite(h) && l > 0 && w > 0 && h > 0 ? 0 : 1;
  }
  return row?.[field];
}

function starsgemModelVector(row, model) {
  const features = model?.features;
  if (!features) return [];
  const vector = [];
  for (const field of features.categorical || []) {
    const value = starsgemNorm(row[field]);
    const cats = features.categories?.[field] || [];
    for (const cat of cats) vector.push(value === cat ? 1 : 0);
  }
  for (const field of features.numeric || []) {
    const rawValue = starsgemNumericFeatureValue(row, field, model);
    const raw = rawValue === null || rawValue === undefined || rawValue === '' ? NaN : Number(rawValue);
    const fallback = Number(features.numericMedians?.[field]);
    vector.push(Number.isFinite(raw) ? raw : Number.isFinite(fallback) ? fallback : 0);
  }
  return vector;
}

export function buildStarsgemRow({
  carat,
  shape = 'ROUND',
  color = 'E',
  clarity = 'VS1',
  typeName = '-',
  cut = 'ID',
  polish = 'EX',
  symmetry = 'EX',
  tablePct = null,
  depthPct = null,
  length = null,
  width = null,
  height = null,
}) {
  return {
    Carat: carat,
    carat_bucket: starsgemCaratBucket(carat),
    Shape: shape,
    Color: color,
    Clarity: clarity,
    TypeName: typeName,
    Report: 'IGI',
    Cut: cut,
    Cut_Style_Group: starsgemCutStyleGroup(cut),
    Polish: polish,
    Symmetry: symmetry,
    Fluorescence: '-',
    Table_Scale: tablePct,
    Depth_Scale: depthPct,
    Length: length,
    Width: width,
    Height: height,
    LengthWidthRatio: length && width ? Math.max(length, width) / Math.min(length, width) : null,
  };
}

export function predictStarsgemMl(row, model) {
  if (!model || !Array.isArray(model.trees) || !model.trees.length) return null;
  const vector = starsgemModelVector(row, model);
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
  const logVal = logSum / model.trees.length;
  const carat = Number(row.Carat ?? row.carat);
  const isTailResidual = model.targetType === 'log_tail_lookup_residual';
  const lookupRate = isTailResidual
    ? starsgemModelTailBaseLookupRate(row, model).rate
    : model.targetType === 'log_lookup_residual' ? starsgemModelLookupRate(row, model).rate : null;
  const tail = isTailResidual ? starsgemLargeCaratTailMultiplier(row, model) : { multiplier: 1 };
  const price = isTailResidual
    ? Math.max(0.01, Math.exp(logVal) * (Number.isFinite(lookupRate) && lookupRate > 0 ? lookupRate : 1) * tail.multiplier * carat)
    : model.targetType === 'log_lookup_residual'
      ? Math.max(0.01, Math.exp(logVal) * (Number.isFinite(lookupRate) && lookupRate > 0 ? lookupRate : 1) * carat)
      : model.targetType === 'log_rate'
        ? Math.max(0.01, Math.exp(logVal) * carat)
        : Math.max(0.01, Math.exp(logVal));
  const lookup = starsgemModelLookupRate(row, model);
  return {
    price,
    perCt: price / carat,
    modelName: model.modelName,
    lookupRate: lookup.rate,
    lookupLevel: lookup.level,
    lookupCount: lookup.count,
    residualMult: Number.isFinite(lookupRate) && lookupRate > 0 ? price / (lookupRate * carat) : null,
  };
}
