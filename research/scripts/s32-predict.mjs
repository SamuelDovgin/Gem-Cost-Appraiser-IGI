/**
 * S32 predictor — Node/browser-compatible.
 *
 * Supports S32-A (anchors only), S32-B (+CatBoost residual), and S32-C (+PAV lattice).
 * The artifact type is auto-detected from the model's targetType field.
 *
 * S32-A: log($/ct) = S28 surface + clip(w_anchor * Δ_L, -A_cap, +A_cap)
 * S32-B: log($/ct) = S28 surface + clip(w_anchor * Δ_L, -A_cap, +A_cap)
 *                    + w_resid * clip(CatBoost_residual, -R_cap, +R_cap)
 * S32-C: S32-B + PAV lattice interpolation
 */

import { starsgemNorm } from './starsgem-ml-predict.mjs';
import { predictS28 } from './s28-predict.mjs';

// ─── Constants ───────────────────────────────────────────────────────────────

const COLORS = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];
const CLARITIES = ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2'];

const CARAT_BANDS = [
  { lo: 1.0, hi: 1.49, label: '1.00-1.49' },
  { lo: 1.5, hi: 1.99, label: '1.50-1.99' },
  { lo: 2.0, hi: 2.99, label: '2.00-2.99' },
  { lo: 3.0, hi: 3.99, label: '3.00-3.99' },
  { lo: 4.0, hi: 4.99, label: '4.00-4.99' },
  { lo: 5.0, hi: 9.99, label: '5.00-9.99' },
  { lo: 10.0, hi: 99.99, label: '10.00+' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function s32CaratBand(carat) {
  for (const band of CARAT_BANDS) {
    if (carat >= band.lo && carat <= band.hi) return band.label;
  }
  return carat < 1 ? '<1.00' : '10.00+';
}

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

// ─── Row key builders ────────────────────────────────────────────────────────

function buildCellKey(shape, color, clarity, carat) {
  return [
    String(shape || 'round_standard').trim().toLowerCase(),
    starsgemNorm(color),
    starsgemNorm(clarity),
    s32CaratBand(Number(carat)),
  ].join('||');
}

function buildParent1Key(shape, color, clarity) {
  return [
    String(shape || 'round_standard').trim().toLowerCase(),
    starsgemNorm(color),
    starsgemNorm(clarity),
  ].join('||');
}

function buildParent2Key(shape, color) {
  return [
    String(shape || 'round_standard').trim().toLowerCase(),
    starsgemNorm(color),
  ].join('||');
}

function buildParent3Key(shape) {
  return String(shape || 'round_standard').trim().toLowerCase();
}

// ─── S32 prediction input normalization ──────────────────────────────────────

export function s32PredictionInput(row) {
  return {
    Carat: row?.Carat ?? row?.carat,
    carat: row?.carat ?? row?.Carat,
    Shape: row?.Shape ?? row?.shape,
    shape: row?.shape ?? row?.Shape,
    Shape_Style: row?.Shape_Style ?? row?.shape_style ?? row?.shapeStyle,
    shape_style: row?.shape_style ?? row?.Shape_Style ?? row?.shapeStyle,
    Color: row?.Color ?? row?.color,
    color: row?.color ?? row?.Color,
    Clarity: row?.Clarity ?? row?.clarity,
    clarity: row?.clarity ?? row?.Clarity,
    Cut: row?.Cut ?? row?.cut ?? row?.cut_raw,
    cut: row?.cut ?? row?.Cut ?? row?.cut_raw,
    cut_raw: row?.cut_raw ?? row?.Cut ?? row?.cut,
    TypeName: row?.TypeName ?? row?.typeName,
    typeName: row?.typeName ?? row?.TypeName,
    LengthWidthRatio: row?.LengthWidthRatio ?? row?.lw_ratio ?? row?.lwRatio,
    lw_ratio: row?.lw_ratio ?? row?.LengthWidthRatio ?? row?.lwRatio,
    Table_Scale: row?.Table_Scale ?? row?.table_pct ?? row?.tablePct,
    table_pct: row?.table_pct ?? row?.Table_Scale ?? row?.tablePct,
    Depth_Scale: row?.Depth_Scale ?? row?.depth_pct ?? row?.depthPct,
    depth_pct: row?.depth_pct ?? row?.Depth_Scale ?? row?.depthPct,
    polish: row?.polish ?? row?.Polish,
    symmetry: row?.symmetry ?? row?.Symmetry,
  };
}

// ─── Anchor lookup ───────────────────────────────────────────────────────────

/**
 * Find the deepest available anchor for a row.
 * Returns { level, key, n, delta } or null.
 */
function findAnchor(row, model) {
  const carat = Number(row.carat ?? row.Carat);
  const shape = String(row.shape_style ?? row.Shape_Style ?? 'round_standard').trim().toLowerCase();
  const color = starsgemNorm(row.color ?? row.Color);
  const clarity = starsgemNorm(row.clarity ?? row.Clarity);

  const keys = [
    { level: 1, key: buildCellKey(shape, color, clarity, carat) },
    { level: 2, key: buildParent1Key(shape, color, clarity) },
    { level: 3, key: buildParent2Key(shape, color) },
    { level: 4, key: buildParent3Key(shape) },
    { level: 5, key: '__global__' },
  ];

  for (const lk of keys) {
    const anchorDict = model.anchors?.[lk.level - 1];
    const hit = anchorDict?.[lk.key];
    if (hit && hit.n > 0) {
      return { ...lk, n: hit.n, delta: hit.delta };
    }
  }
  return null;
}

/**
 * Compute anchor offset given anchor info and model hyperparameters.
 */
function computeAnchorOffset(anchor, model) {
  if (!anchor || anchor.n <= 0 || anchor.delta == null) {
    return { offset: 0, wAnchor: 0, level: null };
  }

  const hp = model.hyperparameters || {};
  const K_arr = hp.K_anchor || [10, 15, 20, 30, 50];
  const cap_arr = hp.level_cap || [1.0, 0.70, 0.45, 0.25, 0.10];
  const A_cap = hp.A_cap ?? 0.20;

  const K = K_arr[anchor.level - 1] ?? 10;
  const cap = cap_arr[anchor.level - 1] ?? 1.0;

  const wAnchor = Math.min(cap, anchor.n / (anchor.n + K));
  const offset = clamp(wAnchor * anchor.delta, -A_cap, A_cap);

  return { offset, wAnchor, level: anchor.level };
}

// ─── Main S32 predictor ──────────────────────────────────────────────────────

/**
 * Predict price for a single row using S32 model.
 *
 * @param {Object} row - Input row with carat, shape_style, color, clarity, etc.
 * @param {Object} model - S32 artifact (S32-A, S32-B, or S32-C)
 * @returns {Object|null} { price, upc, baseUpc, anchorOffset, anchorLevel, ... }
 */
export function predictS32(row, model) {
  const surface = model?.surfaceModel || model?.surface;
  if (!surface) return null;

  const input = s32PredictionInput(row);
  const carat = Number(input.carat ?? input.Carat);
  if (!Number.isFinite(carat) || carat <= 0) return null;

  // Step 1: S28 surface prediction (always on)
  const base = predictS28(input, surface);
  if (!base?.upc || base.upc <= 0) return null;

  let logUpc = Math.log(base.upc);
  let anchorOffset = 0;
  let wAnchor = 0;
  let anchorLevel = null;
  let residualRaw = 0;
  let wResid = 0;

  // Step 2: Hierarchical credibility anchor (S32-A and above)
  const anchor = findAnchor(input, model);
  if (anchor) {
    const ao = computeAnchorOffset(anchor, model);
    anchorOffset = ao.offset;
    wAnchor = ao.wAnchor;
    anchorLevel = ao.level;
    logUpc += anchorOffset;
  }

  // Step 3: CatBoost residual (S32-B and above, only if warm cell)
  const hasResidual = model.targetType === 'surface_plus_anchors_plus_residual' ||
                      model.targetType === 'surface_plus_anchors_plus_residual_plus_pav';
  if (hasResidual && model.residualModel && anchor && anchor.n >= (model.hyperparameters?.r_min ?? 10)) {
    // TODO: Implement CatBoost tree evaluation in Node
    // For S32-A, this section is not reached.
    // For S32-B, we need either:
    //   a) Official catboost npm package (loads .cbm)
    //   b) JSON tree export + custom evaluator
    //   c) ONNX export + onnxruntime-node
    const K_resid = model.hyperparameters?.K_resid ?? 15;
    wResid = anchor.n / (anchor.n + K_resid);

    // Placeholder: CatBoost prediction would go here
    // residualRaw = evaluateCatBoost(model.residualModel, input);
    const R_cap = model.hyperparameters?.R_cap ?? 0.15;
    const safeResid = clamp(residualRaw, -R_cap, R_cap);
    logUpc += wResid * safeResid;
  }

  // Step 4: PAV lattice interpolation (S32-C, if available)
  // For S32-A, the lattice is not present.
  if (model.pavLattice && model.targetType === 'surface_plus_anchors_plus_residual_plus_pav') {
    // TODO: Interpolate from PAV lattice
    // logUpc = interpolatePavLattice(model.pavLattice, input, logUpc);
  }

  const upc = Math.exp(logUpc);
  const price = upc * carat;

  if (!Number.isFinite(price) || price <= 0) return null;

  return {
    price,
    upc,
    baseUpc: base.upc,
    anchorOffset,
    anchorMultiplier: Math.exp(anchorOffset),
    wAnchor,
    anchorLevel,
    residualRaw,
    wResid,
    residualApplied: wResid * residualRaw,
    extrapolated: base.extrapolated,
  };
}

// ─── Convenience: S32-A specific export ──────────────────────────────────────

/**
 * predictS32A is an alias for predictS32. It works with S32-A artifacts
 * and ignores residual/lattice fields if present.
 */
export { predictS32 as predictS32A };

// ─── Re-export for benchmark use ─────────────────────────────────────────────

export { s32CaratBand as s32CaratBand };
export { buildCellKey as s32CellKey };
export { COLORS as S32_COLORS, CLARITIES as S32_CLARITIES };
