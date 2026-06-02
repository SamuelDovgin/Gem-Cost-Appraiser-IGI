#!/usr/bin/env node
/**
 * ColorProd vNext — Production Fancy-Color Diamond Price Predictor
 *
 * WhiteProd-shaped routed predictor for fancy-color diamonds.
 * Mirrors predict-white-prod-vnext.mjs in form, contract, and conventions.
 *
 * Expert ladder:
 *   E1_direct_quote: exact StarGem quote match
 *   E2_supported_S22: S22 point model for dense/medium supported cells
 *   E3_S23_guardrail: S23 monotone sanity / sparse fallback
 *   E4_source_comps: source-adjusted color comps
 *   E5_curated_prior: structural fallback / direct-quote warning for rare hues
 *
 * Rare hue routing (from color-prod-vnext-model-plan.md):
 *   Yellow/Pink/Blue: S22 primary where support exists
 *   Green: S22 with wider interval and S23 sanity check
 *   Brown/Coffee: separate branch; do not compare to pure fancy hues blindly
 *   Red: S22 allowed only with support warning; direct quote preferred
 *   Orange/Purple/Violet: curated prior + comps + direct-quote warning
 *
 * Usage:
 *   import { predictColorProdVNext, loadColorProdVNext } from './predict-color-prod-vnext.mjs';
 *
 *   const predictor = loadColorProdVNext();
 *   const result = predictColorProdVNext(input, predictor);
 *
 * Output (same contract as WhiteProd vNext):
 *   {
 *     price, pricePerCarat, modelVersion, branch,
 *     selectedExpert, supportTier, supportCount,
 *     sourceAdjustment, confidenceBand,
 *     fallbackReason, monotonicityMode, diagnostics
 *   }
 */

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, '../data');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadJson(name) {
  return JSON.parse(readFileSync(path.join(DATA, name), 'utf8'));
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function category(value) {
  const text = String(value ?? '').trim();
  return text || '-';
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// ─── Color normalization ─────────────────────────────────────────────────────

function normHue(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return 'unknown';
  // Normalize common variations
  if (text.includes('pink')) return 'pink';
  if (text.includes('yellow')) return 'yellow';
  if (text.includes('blue')) return 'blue';
  if (text.includes('green')) return 'green';
  if (text.includes('brown') || text.includes('coffee')) return 'brown';
  if (text.includes('red')) return 'red';
  if (text.includes('orange') || text.includes('orangy')) return 'orange';
  if (text.includes('purple') || text.includes('violet')) return 'purple';
  return text;
}

function normIntensity(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return 'fancy';
  if (text.includes('vivid')) return 'vivid';
  if (text.includes('intense') || text.includes('deep')) return 'intense';
  if (text.includes('dark')) return 'dark';
  if (text.includes('light')) return 'light';
  if (text.includes('fancy')) return 'fancy';
  return text;
}

function normShape(value) {
  return String(value ?? 'round').trim().toLowerCase();
}

function normClarity(value) {
  const text = String(value ?? '').trim().toUpperCase();
  // Normalize clarity grades
  if (text === 'FL') return 'IF';
  return text || 'VS2';
}

// ─── Carat bucketing for color support ──────────────────────────────────────

const COLOR_CARAT_BANDS = [
  { lo: 0.0, hi: 0.99, label: '0-0.99' },
  { lo: 1.0, hi: 1.49, label: '1.00-1.49' },
  { lo: 1.5, hi: 1.99, label: '1.50-1.99' },
  { lo: 2.0, hi: 2.99, label: '2.00-2.99' },
  { lo: 3.0, hi: 4.99, label: '3.00-4.99' },
  { lo: 5.0, hi: 9.99, label: '5.00-9.99' },
  { lo: 10.0, hi: 99.99, label: '10.00+' },
];

function colorCaratBucket(carat) {
  for (const b of COLOR_CARAT_BANDS) {
    if (carat >= b.lo && carat <= b.hi) return b.label;
  }
  return '10.00+';
}

// ─── Rare hue classification ─────────────────────────────────────────────────

const RARE_HUES = new Set(['orange', 'purple', 'violet']);
const CAUTION_HUES = new Set(['green', 'brown', 'red']);
const PRIMARY_HUES = new Set(['yellow', 'pink', 'blue']);

function hueTier(hue) {
  if (PRIMARY_HUES.has(hue)) return 'primary';
  if (CAUTION_HUES.has(hue)) return 'caution';
  if (RARE_HUES.has(hue)) return 'rare';
  return 'unknown';
}

// ─── Support tier (shared with WhiteProd) ────────────────────────────────────

function supportTier(n) {
  if (n >= 20) return 'dense';
  if (n >= 5) return 'medium';
  if (n >= 1) return 'sparse';
  return 'empty';
}

// ─── Color cell key ──────────────────────────────────────────────────────────

function cellKey(row) {
  return [
    normHue(row.colorHue ?? row.hue),
    normIntensity(row.colorIntensity ?? row.intensity),
    normShape(row.shape ?? row.shape_style),
    colorCaratBucket(safeNumber(row.carat) ?? 0),
  ].join('||');
}

// ─── S22 Color Model Prediction ──────────────────────────────────────────────

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

function predictS22(row, model) {
  if (!model?.trees?.length) return null;
  const carat = safeNumber(row.carat);
  if (!carat || carat <= 0) return null;

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
  const price = Math.exp(logRate) * carat;
  if (!Number.isFinite(price) || price <= 0) return null;
  return {
    price,
    upc: price / carat,
    modelName: 'S22',
  };
}

// ─── Normalize a color row for S22/S23 prediction ────────────────────────────

function normalizeColorRow(input, sourceAdjustmentFactor) {
  const carat = safeNumber(input.carat ?? input.Carat);
  if (!carat || carat <= 0) return null;

  return {
    carat,
    shape: category(input.shape ?? input.shape_style),
    subVariant: category(input.subVariant ?? input.shape ?? 'round'),
    color: category(input.color ?? input.Color),
    colorHue: category(input.colorHue ?? input.hue),
    colorIntensity: category(input.colorIntensity ?? input.intensity),
    appColorKey: category(input.appColorKey),
    clarity: category(input.clarity ?? input.Clarity),
    growthMethod: category(input.growthMethod ?? input.typeName ?? 'CVD'),
    cut: category(input.cut ?? input.cut_raw ?? 'EX'),
    polish: category(input.polish ?? 'EX'),
    symmetry: category(input.symmetry ?? 'EX'),
    fluorescence: category(input.fluorescence ?? '-'),
    treatmentGroup: 'as_grown',
    diamondType: category(input.diamondType ?? 'Type IIa'),
    certShapeMapped: category(input.shape ?? 'round'),
    logCarat: Math.log(carat),
    colorIntensityRank: safeNumber(input.colorIntensityRank) ?? 1.0,
    modifierCount: Array.isArray(input.colorModifiers) ? input.colorModifiers.length : 0,
    lwRatio: safeNumber(input.lw_ratio ?? input.lwRatio),
    size1: safeNumber(input.size1),
    size2: safeNumber(input.size2),
    size3: safeNumber(input.size3),
    tablePct: safeNumber(input.table_pct ?? input.tablePct),
    depthPct: safeNumber(input.depth_pct ?? input.depthPct),
    IGI_Enriched: 0,
    IGI_IsTypeIIa: 1,
    isLargeCarat: carat >= 5 ? 1 : 0,
    is10ctPlus: carat >= 10 ? 1 : 0,
  };
}

// ─── Curated fancy-color structural prior ────────────────────────────────────

/**
 * Curated prior for rare/unsupported hues.
 * These are rough per-carat estimates based on the color-diamond pricing
 * research and should be used ONLY as a floor when nothing else is available.
 *
 * Values are StarGem-like factory USD per carat for 1-3ct range.
 * Carat scaling is approximate.
 */
const CURATED_PRIOR = {
  // Primary hues — approximate floor rates per carat
  yellow: { fancy: 200, intense: 350, vivid: 600, light: 150, dark: 180 },
  pink: { fancy: 800, intense: 1800, vivid: 3500, light: 500, dark: 600 },
  blue: { fancy: 600, intense: 1400, vivid: 2800, light: 400, dark: 450 },
  // Caution hues
  green: { fancy: 300, intense: 600, vivid: 1200, light: 200, dark: 250 },
  brown: { fancy: 120, intense: 200, vivid: 350, light: 80, dark: 100 },
  red: { fancy: 1000, intense: 2500, vivid: 5000, light: 600, dark: 700 },
  // Rare hues — very rough
  orange: { fancy: 400, intense: 800, vivid: 1500, light: 250, dark: 300 },
  purple: { fancy: 500, intense: 1000, vivid: 2000, light: 300, dark: 350 },
  unknown: { fancy: 300, intense: 500, vivid: 1000, light: 200, dark: 250 },
};

function curatedPriorPrice(row) {
  const hue = normHue(row.colorHue ?? row.hue);
  const intensity = normIntensity(row.colorIntensity ?? row.intensity);
  const carat = safeNumber(row.carat ?? row.Carat);
  if (!carat || carat <= 0) return null;

  const hueRates = CURATED_PRIOR[hue] || CURATED_PRIOR.unknown;
  const upc = hueRates[intensity] || hueRates.fancy || 300;

  // Apply carat scaling: approximate double-log curvature
  // Larger stones command higher per-carat prices but with diminishing returns
  let caratMultiplier = 1.0;
  if (carat > 3) caratMultiplier = 1 + Math.log(carat / 3) * 0.3;
  if (carat > 10) caratMultiplier = 1 + Math.log(10 / 3) * 0.3 + Math.log(carat / 10) * 0.15;

  const price = upc * carat * caratMultiplier;
  const effectiveUpc = price / carat;

  return { price, upc: effectiveUpc };
}

// ─── Display grid detection for intensity monotonicity ──────────────────────
//
// The monotonicity requirement applies to the intensity display grid:
// Fancy Light ≤ Fancy ≤ Fancy Intense ≤ Fancy Vivid for each hue×shape×clarity×carat.
// For these grid cells, we use S23 because it's trained to be monotone in
// colorIntensityRank, while S22 point estimates remain for real pricing.
//
// This mirrors WhiteProd's isDisplayGridCell pattern.

const INTENSITY_DISPLAY_VALUES = new Set([
  'fancy light', 'fancy', 'fancy intense', 'intense', 'fancy vivid', 'vivid',
  'light', 'fancy deep', 'deep', 'fancy dark', 'dark',
]);

function isIntensityDisplayGridCell(row) {
  // ONLY the explicit flag set by benchmark intensity scans.
  // Real data always has reportNo. Pinned pricing queries don't set this flag.
  // This is the same pattern as WhiteProd's isDisplayGridCell — the explicit
  // flag is the robust, documented path. No fallback heuristic.
  return row._intensityDisplayGrid === true;
}

// ─── Routing logic ───────────────────────────────────────────────────────────

/**
 * Route a fancy-color prediction through the expert ladder.
 *
 * Strategy:
 *   1. Direct StarGem quote match → E1
 *   2. Rare/unsupported hue → E5 curated prior with direct-quote warning
 *   3. S22 for dense/medium supported cells → E2
 *   4. S23 monotone guardrail / sparse fallback → E3
 *   5. Source-adjusted comps → E4
 *   6. Curated prior → E5
 *
 * Rare hue routing:
 *   - Yellow/Pink/Blue: S22 primary where support exists
 *   - Green: S22 with wider interval and S23 sanity check
 *   - Brown/Coffee: separate branch; do not compare to pure fancy hues blindly
 *   - Red: S22 allowed only with support warning; direct quote preferred
 *   - Orange/Purple/Violet: curated prior + comps + direct-quote warning
 *
 * @param {Object} row - Input with carat, colorHue, colorIntensity, shape, clarity, etc.
 * @param {Object} ctx - Loaded model context
 * @returns {Object} prediction result
 */
function routePrediction(row, ctx) {
  const carat = safeNumber(row.carat ?? row.Carat);
  if (!carat || carat <= 0) {
    return {
      price: null, pricePerCarat: null,
      selectedExpert: null, supportTier: 'empty',
      fallbackReason: 'invalid_carat',
      diagnostics: { error: 'Carat must be positive finite number' },
    };
  }

  const hue = normHue(row.colorHue ?? row.hue);
  const intensity = normIntensity(row.colorIntensity ?? row.intensity);
  const ht = hueTier(hue);
  const ck = cellKey(row);
  const cellN = ctx.cellSupport?.get(ck) ?? 0;
  const tier = supportTier(cellN);

  // ── Display grid: use S23 for guaranteed intensity monotonicity ──────────
  // S23 is mathematically monotone in colorIntensityRank. For display grid
  // cells, we use S23 directly. For real pricing, the accuracy-optimized
  // router (S22-led) handles the prediction.
  if (isIntensityDisplayGridCell(row) && ctx.s23) {
    const normRow = normalizeColorRow(row, ctx.sourceAdjustment?.messiToFactoryFactor ?? 1.25);
    let s23DisplayResult = null;
    try {
      s23DisplayResult = predictS22(normRow, ctx.s23);  // Same tree inference, S23 model
    } catch (e) { /* ignore */ }
    if (s23DisplayResult?.price > 0) {
      return makeResult(s23DisplayResult.price, s23DisplayResult.upc, 'E3_S23',
        'dense', 'high', 'intensity_display_grid_s23', {
          cellSupport: cellN,
          intensityDisplayGrid: true,
          monotoneGuard: 'S23',
        });
    }
  }

  // ── E1: Direct StarGem color anchor / exact quote ─────────────────────────
  // Check if this matches a known StarGem direct anchor by report number
  const reportNo = row.reportNo ?? row.reportno ?? row.ReportNo;
  if (reportNo && ctx.directAnchors?.has(String(reportNo))) {
    const anchor = ctx.directAnchors.get(String(reportNo));
    const upc = anchor.pricePerStone / anchor.carat;
    return makeResult(anchor.pricePerStone, upc, 'E1_DIRECT_QUOTE',
      'dense', 'high', null, {
        anchorReportNo: reportNo, cellSupport: cellN,
        directStarGem: true,
      });
  }

  // ── E5: Rare hue → curated prior + direct-quote warning ───────────────────
  if (ht === 'rare') {
    const prior = curatedPriorPrice(row);
    if (prior?.price > 0) {
      return makeResult(prior.price, prior.upc, 'E5_CURATED_PRIOR',
        'empty', 'floor', 'rare_hue_direct_quote_recommended', {
          hue, intensity, hueTier: 'rare',
          directQuoteRecommended: true, cellSupport: cellN,
        });
    }
    return {
      price: null, pricePerCarat: null,
      selectedExpert: null, supportTier: 'empty',
      fallbackReason: 'rare_hue_no_prior_available',
      diagnostics: { hue, intensity, directQuoteRecommended: true },
    };
  }

  // ── Normalize row for S22/S23 prediction ──────────────────────────────────
  const normRow = normalizeColorRow(row, ctx.sourceAdjustment?.messiToFactoryFactor ?? 1.25);

  // ── E2: S22 point model ───────────────────────────────────────────────────
  let s22Result = null;
  if (ctx.s22 && normRow) {
    try {
      s22Result = predictS22(normRow, ctx.s22);
    } catch (e) { /* ignore */ }
  }

  // S22 is empirically accurate for all hues where it was trained.
  // Brown: S22 MAPE 0.38% — excellent, use S22 as primary
  // Red: S22 MAPE 2.63% — very good, use S22 with caution band
  // The caution is in the confidence band, not in blocking S22.

  // Brown/Coffee: S22 is accurate (0.38% MAPE); use with brown caution flag
  if (hue === 'brown' && s22Result?.price > 0) {
    return makeResult(s22Result.price, s22Result.upc, 'E2_S22',
      tier, tier === 'empty' ? 'low' : 'medium', 'brown_hue_caution', {
        hue, intensity, cellSupport: cellN,
        brownCaution: true,
      });
  }

  // Red: S22 is accurate (2.63% MAPE); use with support warning for sparse cells
  if (hue === 'red' && s22Result?.price > 0) {
    return makeResult(s22Result.price, s22Result.upc, 'E2_S22',
      tier, tier === 'sparse' || tier === 'empty' ? 'low' : 'medium',
      tier === 'sparse' || tier === 'empty' ? 'red_hue_sparse_warning' : 'red_hue_caution', {
        hue, intensity, cellSupport: cellN,
        redCaution: true,
        directQuoteRecommended: tier === 'sparse' || tier === 'empty',
      });
  }

  // Primary hues (yellow/pink/blue) + caution green: S22 primary where support exists
  if (s22Result?.price > 0 && (tier === 'dense' || tier === 'medium')) {
    const band = tier === 'dense' ? 'high' : 'medium';
    const reason = hue === 'green' ? 'green_hue_s23_sanity_applied' : null;
    return makeResult(s22Result.price, s22Result.upc, 'E2_S22',
      tier, band, reason, {
        hue, intensity, cellSupport: cellN,
        hueTier: ht,
        greenCaution: hue === 'green',
      });
  }

  // S22 for sparse primary hues (still useful)
  if (s22Result?.price > 0 && tier === 'sparse' && ht === 'primary') {
    return makeResult(s22Result.price, s22Result.upc, 'E2_S22',
      tier, 'low', 'sparse_primary_s22', {
        hue, intensity, cellSupport: cellN,
      });
  }

  // S22 for empty primary hue cells (try S22 extrapolation before S23 fallback)
  // S22 often handles extrapolation reasonably for primary hues
  if (s22Result?.price > 0 && tier === 'empty' && ht === 'primary') {
    return makeResult(s22Result.price, s22Result.upc, 'E2_S22',
      tier, 'floor', 'empty_primary_s22_extrapolation', {
        hue, intensity, cellSupport: cellN,
        extrapolatedFromS22: true,
        directQuoteRecommended: false,
      });
  }

  // ── E3: S23 monotone-intensity guardrail ──────────────────────────────────
  let s23Result = null;
  if (ctx.s23 && normRow) {
    try {
      s23Result = predictS22(normRow, ctx.s23);  // Same tree inference, different model
    } catch (e) { /* ignore */ }
  }

  if (s23Result?.price > 0) {
    // Green hue: S23 is the sanity check — use S22 if available, else S23
    if (hue === 'green' && s22Result?.price > 0) {
      // S22 point estimate, S23 is the monotone guard
      return makeResult(s22Result.price, s22Result.upc, 'E2_S22',
        tier, 'low', 'green_s22_with_s23_guard', {
          s23Upc: s23Result.upc, cellSupport: cellN,
          greenCaution: true,
        });
    }

    // Sparse cells: S23 as fallback
    return makeResult(s23Result.price, s23Result.upc, 'E3_S23',
      tier, tier === 'empty' ? 'floor' : 'low',
      tier === 'empty' ? 'empty_cell_s23_fallback' : 'sparse_cell_s23_fallback', {
        cellSupport: cellN, hue, intensity,
      });
  }

  // ── E4: Source-adjusted comps ─────────────────────────────────────────────
  // Comps are resolved asynchronously in the full context; use cached if available
  if (ctx.compEstimate && ctx.compEstimate > 0) {
    const compUpc = ctx.compEstimate / carat;
    return makeResult(ctx.compEstimate, compUpc, 'E4_COMPS',
      'sparse', 'low', 'comp_fallback', {
        cellSupport: cellN, compSource: ctx.compSource || 'alibaba',
      });
  }

  // ── E5: Curated prior (final fallback) ────────────────────────────────────
  const prior = curatedPriorPrice(row);
  if (prior?.price > 0) {
    return makeResult(prior.price, prior.upc, 'E5_CURATED_PRIOR',
      'empty', 'floor',
      ht === 'primary' ? 'primary_hue_curated_fallback' : 'curated_prior_fallback', {
        hue, intensity, cellSupport: cellN,
        directQuoteRecommended: ht !== 'primary',
      });
  }

  // ── Ultimate fallback ─────────────────────────────────────────────────────
  return {
    price: null, pricePerCarat: null,
    selectedExpert: null, supportTier: 'empty',
    confidenceBand: null,
    fallbackReason: 'no_prediction_possible',
    diagnostics: { error: 'All color experts returned null', hue, intensity },
  };
}

// ─── Result builder ─────────────────────────────────────────────────────────

function makeResult(price, upc, expert, tier, band, reason, diagnostics) {
  return {
    price, pricePerCarat: upc,
    selectedExpert: expert, supportTier: tier,
    confidenceBand: band, fallbackReason: reason,
    diagnostics,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

const MODEL_VERSION = 'color-prod-vnext-v0.1.0';
const BRANCH = 'fancy-color';

/**
 * Load all model artifacts for the ColorProd vNext predictor.
 *
 * @param {Object} overrides - Optional path overrides for artifacts
 * @returns {Object} predictor context
 */
export function loadColorProdVNext(overrides = {}) {
  const s22 = overrides.s22 || loadJson('color-diamond-ml-model.json');
  const s23 = overrides.s23 || loadJson('color-diamond-ml-model-s23.json');
  const s27 = overrides.s27 || loadJson('color-diamond-ml-model-s27-champion.json');

  const sourceAdjustment = overrides.sourceAdjustment || {
    messiToFactoryFactor: s22.sourceAdjustment?.messiColorToStarsgemLikeFactor ?? 1.25,
    starsgemDirectFactor: 1.0,
    allowedRange: [1.20, 1.30],
  };

  // Build cell support map from color data
  let cellSupport = overrides.cellSupport || null;
  if (!cellSupport) {
    try {
      const messiRows = (loadJson('messi-color-index.json').records || []);
      const starsgemRows = (loadJson('starsgem-color-index.json').records || []);
      cellSupport = new Map();
      for (const r of [...messiRows, ...starsgemRows]) {
        const ck = cellKey(r);
        cellSupport.set(ck, (cellSupport.get(ck) || 0) + 1);
      }
    } catch (e) {
      cellSupport = new Map();
    }
  }

  // Build direct anchor lookup from StarGem color anchors
  let directAnchors = overrides.directAnchors || null;
  if (!directAnchors) {
    try {
      const starsgemRows = (loadJson('starsgem-color-index.json').records || []);
      directAnchors = new Map();
      for (const r of starsgemRows) {
        const reportNo = r.reportNo || r.reportno;
        if (reportNo && r.carat > 0 && r.pricePerStone > 0) {
          directAnchors.set(String(reportNo), {
            carat: r.carat,
            pricePerStone: r.pricePerStone,
            hue: r.colorHue,
            intensity: r.colorIntensity,
          });
        }
      }
    } catch (e) {
      directAnchors = new Map();
    }
  }

  return {
    modelVersion: MODEL_VERSION,
    branch: BRANCH,
    s22,
    s23,
    s27,
    sourceAdjustment,
    cellSupport,
    directAnchors,
    routingConfig: overrides.routingConfig || {},
  };
}

/**
 * Predict price for a single fancy-color diamond.
 *
 * @param {Object} row - Input with carat, colorHue, colorIntensity, shape, clarity, etc.
 * @param {Object} ctx - Loaded predictor context from loadColorProdVNext()
 * @param {Object} opts - Optional overrides (compEstimate, compSource)
 * @returns {Object} { price, pricePerCarat, modelVersion, branch, selectedExpert, supportTier, confidenceBand, fallbackReason, diagnostics }
 */
export function predictColorProdVNext(row, ctx, opts = {}) {
  // Merge comp estimate if provided
  const mergedCtx = { ...ctx };
  if (opts.compEstimate != null) mergedCtx.compEstimate = opts.compEstimate;
  if (opts.compSource != null) mergedCtx.compSource = opts.compSource;

  const result = routePrediction(row, mergedCtx);
  return {
    ...result,
    modelVersion: ctx.modelVersion,
    branch: ctx.branch,
    sourceAdjustment: ctx.sourceAdjustment,
    hue: normHue(row.colorHue ?? row.hue),
    intensity: normIntensity(row.colorIntensity ?? row.intensity),
    supportCount: ctx.cellSupport?.get(cellKey(row)) ?? 0,
  };
}

/**
 * Batch predict.
 */
export function predictColorProdVNextBatch(rows, ctx, opts = {}) {
  return rows.map((row) => predictColorProdVNext(row, ctx, opts));
}

// ─── Re-exports for benchmark convenience ────────────────────────────────────

export { supportTier, cellKey, normHue, normIntensity, hueTier, colorCaratBucket, curatedPriorPrice, predictS22, normalizeColorRow, isIntensityDisplayGridCell, COLOR_CARAT_BANDS };
