/**
 * S28 monotone parametric surface — Node/browser-compatible predictor.
 * Mirrors index.html predictS28 / s28FeatureValue.
 */

import { starsgemNorm } from './starsgem-ml-predict.mjs';

const S28_COLOR_RANK = { D: 0, E: 1, F: 2, G: 3, H: 4, I: 5, J: 6, K: 7 };
const S28_CLARITY_RANK = { IF: 0, VVS1: 1, VVS: 1.5, VVS2: 2, VS1: 3, VS: 3.5, VS2: 4, SI1: 5, SI2: 6 };
const S28_MAX_COLOR_RANK = 7;
const S28_MAX_CLARITY_RANK = 6;
const S28_MAGIC_THRESHOLDS = [1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 10.0, 20.0];
const S28_VINTAGE_KNOTS = [0.2, 0.4, 0.6, 0.8];

function s28Shape(row) {
  return String(row?.Shape_Style ?? row?.shape_style ?? row?.Shape ?? row?.shape ?? 'round')
    .trim()
    .toLowerCase() || 'round';
}

function s28Cut(row) {
  const text = starsgemNorm(row?.Cut ?? row?.cut ?? row?.cut_raw ?? '-');
  if (text === 'ID' || text === 'IDEAL') return 'ID';
  if (text === 'EX' || text === 'EXCELLENT') return 'EX';
  if (text === 'VG' || text === 'VERY GOOD') return 'VG';
  if (text === 'G' || text === 'GD' || text === 'GOOD') return 'G';
  return '-';
}

function s28FeatureKey(value) {
  return String(value).replace(/-/g, 'minus').replace(/\./g, '_');
}

function s28ThresholdLabel(value) {
  return Number.isInteger(value) ? value.toFixed(1).replace('.', '_') : String(value).replace('.', '_');
}

function s28CaratBasis(carat) {
  const logCt = Math.log(carat);
  return {
    carat_log: logCt,
    carat_hinge_1ct: Math.max(0, Math.log(carat / 1.0)),
    carat_hinge_2ct: Math.max(0, Math.log(carat / 2.0)),
    carat_hinge_5ct: Math.max(0, Math.log(carat / 5.0)),
    carat_hinge_10ct: Math.max(0, Math.log(carat / 10.0)),
  };
}

function s28MagicBasis(carat) {
  const out = {};
  for (const threshold of S28_MAGIC_THRESHOLDS) {
    const label = s28ThresholdLabel(threshold);
    const window = Math.min(0.25, threshold * 0.12);
    const rampStart = Math.max(0, threshold - window);
    let approach = 0;
    if (carat > rampStart && carat < threshold) {
      approach = (carat - rampStart) / Math.max(1e-9, threshold - rampStart);
    } else if (carat >= threshold) {
      approach = 1;
    }
    out[`magic_approach_${label}ct`] = approach;
    out[`magic_step_${label}ct`] = carat >= threshold ? 1 : 0;
  }
  return out;
}

export function s28FeatureValue(name, row, model) {
  if (name === 'intercept') return 1;
  const carat = Number(row?.Carat ?? row?.carat);
  if (!Number.isFinite(carat) || carat <= 0) return 0;
  const shape = s28Shape(row);
  const cut = s28Cut(row);
  const color = starsgemNorm(row?.Color ?? row?.color);
  const clarity = starsgemNorm(row?.Clarity ?? row?.clarity);
  const gradeSize = Math.log1p(carat);
  const colorRank = S28_COLOR_RANK[color] ?? 3;
  const clarityRank = S28_CLARITY_RANK[clarity] ?? 3.5;
  const caratBasis = s28CaratBasis(carat);
  const magicBasis = s28MagicBasis(carat);
  const baseValue = caratBasis[name] ?? magicBasis[name];
  if (Number.isFinite(baseValue)) return baseValue;
  if (name === 'colorRank') return colorRank;
  if (name === 'clarityRank') return clarityRank;
  if (name === 'colorPremium') return (S28_MAX_COLOR_RANK - colorRank) * gradeSize;
  if (name === 'clarityPremium') return (S28_MAX_CLARITY_RANK - clarityRank) * gradeSize;
  if (name === 'colorRank_size') return colorRank * gradeSize;
  if (name === 'clarityRank_size') return clarityRank * gradeSize;
  if (name === 'isHpht') return starsgemNorm(row?.TypeName ?? row?.typeName ?? row?.growthMethod) === 'HPHT' ? 1 : 0;
  if (name.startsWith('shape_') && !name.includes('_carat_') && !name.includes('_magic_')) {
    return name === `shape_${shape}` ? 1 : 0;
  }
  if (name.startsWith('cut_') && !name.includes('_carat_') && !name.includes('_magic_')) {
    return name === `cut_${cut}` ? 1 : 0;
  }
  for (const featureName of Object.keys(caratBasis)) {
    if (name.endsWith(`_${featureName}`)) {
      if (name.startsWith(`shape_${shape}_`)) return caratBasis[featureName];
      if (name.startsWith(`cut_${s28FeatureKey(cut)}_`)) return caratBasis[featureName];
      return 0;
    }
  }
  for (const featureName of Object.keys(magicBasis)) {
    if (name.endsWith(`_${featureName}`)) {
      if (name.startsWith(`shape_${shape}_`)) return magicBasis[featureName];
      if (name.startsWith(`cut_${s28FeatureKey(cut)}_`)) return magicBasis[featureName];
      return 0;
    }
  }
  if (name === 'lwDev' || name === 'tableDev' || name === 'depthDev') {
    const norms = model?.shapeNorms || {};
    const shapeNorm = norms[shape] || norms._global || {};
    if (name === 'lwDev') {
      const ratio = Number(row?.LengthWidthRatio ?? row?.lw_ratio ?? row?.lwRatio);
      const ref = Number(shapeNorm.lwRatio ?? norms._global?.lwRatio);
      return Number.isFinite(ratio) && ratio > 0 && Number.isFinite(ref) && ref > 0
        ? Math.abs(Math.log(ratio / ref))
        : 0;
    }
    if (name === 'tableDev') {
      const table = Number(row?.Table_Scale ?? row?.table_pct ?? row?.tablePct);
      const ref = Number(shapeNorm.tablePct ?? norms._global?.tablePct);
      return Number.isFinite(table) && Number.isFinite(ref) ? Math.abs(table - ref) / 10 : 0;
    }
    const depth = Number(row?.Depth_Scale ?? row?.depth_pct ?? row?.depthPct);
    const ref = Number(shapeNorm.depthPct ?? norms._global?.depthPct);
    return Number.isFinite(depth) && Number.isFinite(ref) ? Math.abs(depth - ref) / 10 : 0;
  }
  if (name === 'vintage01') return 1;
  for (const knot of S28_VINTAGE_KNOTS) {
    if (name === `vintage_hinge_${String(knot).replace('.', '_')}`) return Math.max(0, 1 - knot);
  }
  return 0;
}

export function predictS28(row, model) {
  if (!model?.featureNames || !model?.coefficients || !model?.featureMeans || !model?.featureStds) {
    return null;
  }
  const carat = Number(row?.Carat ?? row?.carat);
  if (!Number.isFinite(carat) || carat <= 0) return null;
  let logUpc = 0;
  for (let i = 0; i < model.featureNames.length; i++) {
    const name = model.featureNames[i];
    const coeff = Number(model.coefficients[name]);
    if (!Number.isFinite(coeff)) continue;
    const mean = Number(model.featureMeans[i] ?? 0);
    const std = Number(model.featureStds[i] ?? 1) || 1;
    const raw = s28FeatureValue(name, row, model);
    logUpc += coeff * ((raw - mean) / std);
  }
  const upc = Math.exp(logUpc);
  if (!Number.isFinite(upc) || upc <= 0) return null;
  const maxCarat = Number(model.trainingData?.caratMax);
  const minCarat = Number(model.trainingData?.caratMin);
  const extrapolated =
    (Number.isFinite(maxCarat) && carat > maxCarat) ||
    (Number.isFinite(minCarat) && carat < minCarat);
  return {
    price: upc * carat,
    upc,
    extrapolated,
  };
}
