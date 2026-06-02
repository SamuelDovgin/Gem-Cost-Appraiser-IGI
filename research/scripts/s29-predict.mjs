/**
 * S29 hybrid predictor — Node/browser compatible.
 * log($/ct) = surface + cell offset + shrink(n) * residual
 */

import { starsgemNorm } from './starsgem-ml-predict.mjs';
import { s28FeatureValue } from './s28-predict.mjs';

const COLOR_RANK = { D: 0, E: 1, F: 2, G: 3, H: 4, I: 5, J: 6, K: 7 };
const CLARITY_RANK = { IF: 0, VVS1: 1, VVS: 1.5, VVS2: 2, VS1: 3, VS: 3.5, VS2: 4, SI1: 5, SI2: 6 };
const MAX_COLOR_RANK = 7;
const MAX_CLARITY_RANK = 6;

const _residualTreesCache = new WeakMap();

function normCut(raw) {
  const text = starsgemNorm(raw);
  if (text === 'ID' || text === 'IDEAL') return 'ID';
  if (text === 'EX' || text === 'EXCELLENT') return 'EX';
  if (text === 'VG' || text === 'VERY GOOD') return 'VG';
  if (text === 'G' || text === 'GD' || text === 'GOOD') return 'G';
  return '-';
}

export function classifyCutTier(row) {
  const cut = starsgemNorm(row.cut_raw ?? row.cut ?? row.Cut ?? '-');
  const polish = starsgemNorm(row.polish ?? row.Polish ?? 'EX');
  const symmetry = starsgemNorm(row.symmetry ?? row.Symmetry ?? 'EX');
  if (cut === 'ID' || cut === 'EX') {
    if (['EX', 'IDEAL', 'VG'].includes(polish) && ['EX', 'VG'].includes(symmetry)) return 'A';
  }
  return 'B';
}

export function s29CellKey(row, cutTier = null) {
  const shape = String(row.shape_style ?? row.shape ?? row.Shape_Style ?? 'round')
    .trim()
    .toLowerCase();
  const color = starsgemNorm(row.color ?? row.Color);
  const clarity = starsgemNorm(row.clarity ?? row.Clarity);
  if (cutTier) return `${shape}||${color}||${clarity}||${cutTier}`;
  return `${shape}||${color}||${clarity}`;
}

export function s29CaratBand(carat) {
  const c = Number(carat);
  const bands = [
    [1.0, 1.49, '1.00-1.49'],
    [1.5, 1.99, '1.50-1.99'],
    [2.0, 2.99, '2.00-2.99'],
    [3.0, 3.99, '3.00-3.99'],
    [4.0, 4.99, '4.00-4.99'],
    [5.0, 9.99, '5.00-9.99'],
    [10.0, 99.99, '10.00+'],
  ];
  for (const [lo, hi, label] of bands) {
    if (c >= lo && c <= hi) return label;
  }
  return '<1.00';
}

export function s29BenchmarkCellKey(row) {
  const shape = String(row.shape_style ?? row.shape ?? row.Shape_Style ?? 'round')
    .trim()
    .toLowerCase();
  const color = starsgemNorm(row.color ?? row.Color);
  const clarity = starsgemNorm(row.clarity ?? row.Clarity);
  return `${shape}||${color}||${clarity}||${s29CaratBand(row.carat ?? row.Carat)}`;
}

export function buildS29Row(input) {
  const carat = Number(input.carat ?? input.Carat);
  const color = starsgemNorm(input.color ?? input.Color ?? 'E');
  const clarity = starsgemNorm(input.clarity ?? input.Clarity ?? 'VS1');
  const shapeStyle = String(
    input.shape_style ?? input.Shape_Style ?? input.shapeStyle ?? 'round_standard',
  )
    .trim()
    .toLowerCase();
  const cut = normCut(input.cut_raw ?? input.cut ?? input.Cut ?? '-');
  const typeName = starsgemNorm(input.typeName ?? input.TypeName ?? 'CVD');
  const polish = starsgemNorm(input.polish ?? input.Polish ?? 'EX');
  const symmetry = starsgemNorm(input.symmetry ?? input.Symmetry ?? 'EX');

  return {
    carat,
    shape: shapeStyle,
    shape_style: shapeStyle,
    color,
    clarity,
    colorRank: COLOR_RANK[color] ?? 3,
    clarityRank: CLARITY_RANK[clarity] ?? 3.5,
    cut,
    cut_raw: cut,
    cutTier: classifyCutTier({ cut_raw: cut, polish, symmetry }),
    isHpht: typeName === 'HPHT' ? 1 : 0,
    typeName,
    polish,
    symmetry,
    lwRatio: Number(input.lwRatio ?? input.lw_ratio ?? input.LengthWidthRatio) || null,
    tablePct: Number(input.tablePct ?? input.table_pct ?? input.Table_Scale) || null,
    depthPct: Number(input.depthPct ?? input.depth_pct ?? input.Depth_Scale) || null,
    vintage01: Number.isFinite(Number(input.vintage01)) ? Number(input.vintage01) : 1,
    Color: color,
    Clarity: clarity,
    Cut: cut,
    TypeName: typeName,
    Carat: carat,
    Shape_Style: shapeStyle,
  };
}

function s29SurfaceFeatureValue(name, row, surface) {
  const carat = Number(row.carat);
  if (!Number.isFinite(carat) || carat <= 0) return 0;
  if (name === 'colorPremium') {
    return (MAX_COLOR_RANK - (row.colorRank ?? 3)) * Math.log1p(carat);
  }
  if (name === 'clarityPremium') {
    return (MAX_CLARITY_RANK - (row.clarityRank ?? 3.5)) * Math.log1p(carat);
  }
  const wrapped = {
    ...row,
    shape_style: row.shape_style ?? row.shape,
    Shape_Style: row.shape_style ?? row.shape,
  };
  return s28FeatureValue(name, wrapped, { shapeNorms: surface.norms || surface.shapeNorms });
}

function predictSurfaceLog(row, surface) {
  if (!surface?.featureNames || !surface?.coefficients) return null;
  let logUpc = 0;
  for (let i = 0; i < surface.featureNames.length; i++) {
    const name = surface.featureNames[i];
    const coeff = Number(surface.coefficients[name]);
    if (!Number.isFinite(coeff)) continue;
    const mean = Number(surface.featureMeans?.[i] ?? 0);
    const std = Number(surface.featureStds?.[i] ?? 1) || 1;
    const raw = s29SurfaceFeatureValue(name, row, surface);
    logUpc += coeff * ((raw - mean) / std);
  }
  return logUpc;
}

function convertLgbmTreeToFlat(treeStruct) {
  const childrenLeft = [];
  const childrenRight = [];
  const feature = [];
  const threshold = [];
  const value = [];

  function visit(node) {
    const idx = childrenLeft.length;
    childrenLeft.push(-1);
    childrenRight.push(-1);
    feature.push(-2);
    threshold.push(-2);
    value.push(0);

    if (node.leaf_value != null) {
      value[idx] = Number(node.leaf_value);
    } else {
      feature[idx] = Number(node.split_feature);
      threshold[idx] = Number(node.threshold);
      childrenLeft[idx] = visit(node.left_child);
      childrenRight[idx] = visit(node.right_child);
    }
    return idx;
  }

  visit(treeStruct);
  return { childrenLeft, childrenRight, feature, threshold, value };
}

function getResidualTrees(model) {
  if (_residualTreesCache.has(model)) return _residualTreesCache.get(model);
  const dump = model.residualModel?.lightgbmDump;
  if (!dump?.tree_info?.length) {
    _residualTreesCache.set(model, null);
    return null;
  }
  const trees = dump.tree_info.map(ti => ({
    shrinkage: Number(ti.shrinkage ?? 1),
    ...convertLgbmTreeToFlat(ti.tree_structure),
  }));
  _residualTreesCache.set(model, trees);
  return trees;
}

function buildResidualVector(row) {
  const polish = starsgemNorm(row.polish ?? 'EX');
  const symmetry = starsgemNorm(row.symmetry ?? 'EX');
  return [
    Math.log(row.carat),
    row.colorRank ?? 3,
    row.clarityRank ?? 3.5,
    row.isHpht ?? 0,
    row.cut === 'ID' ? 1 : 0,
    row.cut === 'EX' ? 1 : 0,
    polish === 'EX' || polish === 'IDEAL' ? 1 : 0,
    symmetry === 'EX' ? 1 : 0,
    row.lwRatio && row.lwRatio > 0 ? row.lwRatio : 1,
    row.tablePct ?? 58,
    row.depthPct ?? 62,
  ];
}

function walkTree(tree, vector) {
  let node = 0;
  while (tree.childrenLeft[node] !== -1) {
    const feat = tree.feature[node];
    const thresh = tree.threshold[node];
    const val = vector[feat] ?? 0;
    node = val <= thresh ? tree.childrenLeft[node] : tree.childrenRight[node];
  }
  return tree.value[node];
}

function predictResidual(row, model) {
  const rm = model.residualModel;
  if (!rm) return 0;
  if (rm.type === 'cell_mean' && rm.means) {
    return Number(rm.means[s29CellKey(row)] ?? 0);
  }
  const trees = getResidualTrees(model);
  if (!trees?.length) return 0;
  const vector = buildResidualVector(row);
  let sum = 0;
  for (const tree of trees) {
    sum += tree.shrinkage * walkTree(tree, vector);
  }
  return sum;
}

function cellSupportN(row, model) {
  const anchors = model.anchors;
  if (!anchors) return 0;
  const cutTier = row.cutTier ?? classifyCutTier(row);
  const cutKey = s29CellKey(row, cutTier);
  const baseKey = s29CellKey(row);
  const minSupport = model.configuration?.cutTierMinSupport ?? 5;
  const cutA = anchors.cutStratifiedAnchors?.[cutKey];
  if (cutA && cutA.n >= minSupport) return cutA.n;
  const baseA = anchors.baseAnchors?.[baseKey];
  return baseA?.n ?? 0;
}

function predictAnchorLog(row, model, trainBenchmarkCells = null) {
  const surface = model.surfaceModel;
  const surfaceLog = predictSurfaceLog(row, surface);
  if (!Number.isFinite(surfaceLog)) return { anchorLog: null, anchorSource: 'surface' };

  if (trainBenchmarkCells && !trainBenchmarkCells.has(s29BenchmarkCellKey(row))) {
    return { anchorLog: surfaceLog, anchorSource: 'surface_held_out' };
  }

  const anchors = model.anchors;
  if (!anchors?.baseAnchors) return { anchorLog: surfaceLog, anchorSource: 'surface' };

  const minSupport = model.configuration?.cutTierMinSupport ?? 5;
  const cutTier = row.cutTier ?? classifyCutTier(row);
  const cutKey = s29CellKey(row, cutTier);
  const baseKey = s29CellKey(row);

  const cutA = anchors.cutStratifiedAnchors?.[cutKey];
  if (cutA && cutA.n >= minSupport) {
    return {
      anchorLog: surfaceLog + Number(cutA.offset),
      anchorSource: 'cut_stratified',
    };
  }
  const baseA = anchors.baseAnchors[baseKey];
  if (baseA) {
    return {
      anchorLog: surfaceLog + Number(baseA.offset),
      anchorSource: 'base_anchor',
    };
  }
  return { anchorLog: surfaceLog, anchorSource: 'surface' };
}

export function predictS29(input, model, options = {}) {
  if (!model?.surfaceModel) return null;
  const row = buildS29Row(input);
  if (!row.carat || row.carat <= 0) return null;

  const trainBenchmarkCells = options instanceof Set ? options : options.trainBenchmarkCells;
  const { anchorLog, anchorSource } = predictAnchorLog(row, model, trainBenchmarkCells);
  if (!Number.isFinite(anchorLog)) return null;

  if (anchorSource === 'surface_held_out') {
    const upc = Math.exp(anchorLog);
    return {
      price: upc * row.carat,
      upc,
      logUpc: anchorLog,
      anchorSource,
      shrinkWeight: 0,
      residual: 0,
      cellSupport: 0,
    };
  }

  const nThreshold = model.configuration?.nThreshold ?? 10;
  const n = cellSupportN(row, model);
  const shrinkWeight = Math.min(1, n / nThreshold);
  const residual = predictResidual(row, model);
  const logUpc = anchorLog + shrinkWeight * residual;
  const upc = Math.exp(logUpc);

  if (!Number.isFinite(upc) || upc <= 0) return null;

  return {
    price: upc * row.carat,
    upc,
    logUpc,
    anchorSource,
    shrinkWeight,
    residual,
    cellSupport: n,
  };
}
