/**
 * WhiteProd vNext — Browser-compatible API
 *
 * This module wraps predict-white-prod-vnext.mjs for browser use.
 * Call initWhiteProdVNext() with pre-loaded model artifacts, then
 * use predictWhiteProdVNext() for predictions.
 *
 * Usage in browser:
 *   import { initWhiteProdVNext, predictWhiteProdVNext } from './research/scripts/predict-white-prod-vnext-browser.mjs';
 *
 *   // Load artifacts via fetch
 *   const [s30, s26Intel, s33a, s28, allRows] = await Promise.all([...]);
 *   const ctx = initWhiteProdVNext({ s30, s26Intel, s33a, s28, allRows });
 *
 *   // Predict
 *   const result = predictWhiteProdVNext(row, ctx);
 *   // → { price, pricePerCarat, modelVersion, selectedExpert, supportTier, confidenceBand, fallbackReason, diagnostics }
 */

import { starsgemNorm, starsgemCaratBucket } from './starsgem-ml-predict.mjs';
import { predictS28 } from './s28-predict.mjs';

// Re-export for convenience
export { starsgemNorm, starsgemCaratBucket };

// ─── Model version ──────────────────────────────────────────────────────────

export const WHITE_PROD_VNEXT_VERSION = 'white-prod-vnext-v0.2.0';

// ─── S33-A predictor (inline, browser-compatible) ───────────────────────────

const CARAT_BANDS = [
  { lo: 1.0, hi: 1.49, label: '1.00-1.49' },
  { lo: 1.5, hi: 1.99, label: '1.50-1.99' },
  { lo: 2.0, hi: 2.99, label: '2.00-2.99' },
  { lo: 3.0, hi: 3.99, label: '3.00-3.99' },
  { lo: 4.0, hi: 4.99, label: '4.00-4.99' },
  { lo: 5.0, hi: 9.99, label: '5.00-9.99' },
  { lo: 10.0, hi: 99.99, label: '10.00+' },
];

function caratBandLabel(carat) {
  for (const b of CARAT_BANDS) if (carat >= b.lo && carat <= b.hi) return b.label;
  return '10.00+';
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function predictS33A(row, s33aModel) {
  const surface = s33aModel?.surfaceModel;
  if (!surface) return null;
  const carat = Number(row.carat ?? row.Carat);
  if (!Number.isFinite(carat) || carat <= 0) return null;

  const s28Input = {
    carat, Carat: carat,
    shape_style: row.shape_style, Shape_Style: row.shape_style,
    color: row.color, Color: row.color,
    clarity: row.clarity, Clarity: row.clarity,
    cut_raw: row.cut_raw, Cut: row.cut_raw,
    polish: row.polish, symmetry: row.symmetry,
    typeName: row.typeName, TypeName: row.typeName,
    lw_ratio: row.lw_ratio, table_pct: row.table_pct, depth_pct: row.depth_pct,
  };
  const s28 = predictS28(s28Input, surface);
  if (!s28?.upc || s28.upc <= 0) return null;

  const shape = String(row.shape_style ?? 'round_standard').trim().toLowerCase();
  const color = starsgemNorm(row.color ?? row.Color);
  const clarity = starsgemNorm(row.clarity ?? row.Clarity);
  const band = caratBandLabel(carat);

  const K12 = s33aModel.hyperparameters?.K_anchor ?? [0, 8, 12, 20, 40];
  const caps = s33aModel.hyperparameters?.level_cap ?? [1, 0.7, 0.45, 0.25, 0.1];
  const A_cap = s33aModel.hyperparameters?.A_cap ?? 0.5;

  const levelKeys = [
    { level: 1, key: `${shape}||${color}||${clarity}||${band}` },
    { level: 2, key: `${shape}||${color}||${clarity}` },
    { level: 3, key: `${shape}||${color}` },
    { level: 4, key: shape },
    { level: 5, key: '__global__' },
  ];

  let anchorOffset = 0, wAnchor = 0, usedLevel = null, anchorN = 0;
  for (const lk of levelKeys) {
    const anchorDict = s33aModel.anchors?.[lk.level - 1];
    const hit = anchorDict?.[lk.key];
    if (hit && hit.n > 0) {
      const cap = caps[lk.level - 1] ?? 1.0;
      const K = K12[lk.level - 1] ?? 10;
      wAnchor = lk.level === 1 ? 1.0 : Math.min(cap, hit.n / (hit.n + K));
      anchorOffset = clamp(wAnchor * hit.delta, -A_cap, A_cap);
      usedLevel = lk.level; anchorN = hit.n;
      break;
    }
  }

  const upc = s28.upc * Math.exp(anchorOffset);
  const price = upc * carat;
  if (!Number.isFinite(price) || price <= 0) return null;

  return { price, upc, baseUpc: s28.upc, anchorOffset, anchorLevel: usedLevel, anchorN, wAnchor, extrapolated: s28.extrapolated };
}

// ─── S26 lookup predictor ───────────────────────────────────────────────────

function predictS26Lookup(row, intel) {
  const carat = Number(row.carat ?? row.Carat);
  if (!carat || carat <= 0) return null;
  const normalized = {
    carat_bucket: starsgemCaratBucket(carat),
    Shape: (row.raw_shape_code ?? row.shape ?? row.shape_style ?? '').toUpperCase(),
    Color: (row.color ?? row.Color ?? '').toUpperCase(),
    Clarity: (row.clarity ?? row.Clarity ?? '').toUpperCase(),
    TypeName: starsgemNorm(row.typeName ?? row.TypeName ?? '-'),
    Report: 'IGI',
    Cut: starsgemNorm(row.cut_raw ?? row.Cut ?? '-'),
    Polish: starsgemNorm(row.polish ?? 'EX'),
    Symmetry: starsgemNorm(row.symmetry ?? 'EX'),
  };
  for (const table of intel.lookup?.tables || []) {
    const key = table.fields.map((f) => normalized[f] ?? '-').join('||');
    const hit = table.groups?.[key];
    if (hit) {
      const price = (carat * hit.rate) / 170;
      return { price, upc: price / carat, lookupLevel: table.level, lookupCount: hit.count };
    }
  }
  const rate = Number(intel.lookup?.globalMedianInternalRatePerCt) / 170;
  return rate > 0 ? { price: carat * rate, upc: rate, lookupLevel: 'GLOBAL', lookupCount: 0 } : null;
}

// ─── Support / cell key ─────────────────────────────────────────────────────

function supportTier(n) {
  if (n >= 20) return 'dense';
  if (n >= 5) return 'medium';
  if (n >= 1) return 'sparse';
  return 'empty';
}

function cellKey(row) {
  return [
    String(row.shape_style ?? row.shape ?? 'round_standard').trim().toLowerCase(),
    starsgemNorm(row.color ?? row.Color),
    starsgemNorm(row.clarity ?? row.Clarity),
    starsgemCaratBucket(Number(row.carat ?? row.Carat)),
  ].join('||');
}

// ─── Display grid detection ─────────────────────────────────────────────────

const DISPLAY_COLORS = new Set(['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']);
const DISPLAY_CLARITIES = new Set(['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2']);
const DISPLAY_SWEEP = new Set([1, 1.5, 2, 3, 4, 5, 7, 10, 15, 20, 30]);
const DISPLAY_CARAT_TOLERANCE = 0.001;

function isDisplayGridCell(row) {
  if (row._displayGrid === true) return true;
  const hasReport = row.reportNo != null || row.reportno != null || row.rowNo != null;
  if (hasReport) return false;
  const hasMeasurements = row.lw_ratio != null || row.table_pct != null || row.depth_pct != null
    || row.LengthWidthRatio != null || row.Table_Scale != null || row.Depth_Scale != null;
  if (hasMeasurements) return false;
  const shape = String(row.shape_style ?? row.shape ?? 'round_standard').trim().toLowerCase();
  if (shape !== 'round_standard') return false;
  const color = starsgemNorm(row.color ?? row.Color);
  if (!DISPLAY_COLORS.has(color)) return false;
  const clarity = starsgemNorm(row.clarity ?? row.Clarity);
  if (!DISPLAY_CLARITIES.has(clarity)) return false;
  const carat = Number(row.carat ?? row.Carat);
  if (!Number.isFinite(carat)) return false;
  for (const s of DISPLAY_SWEEP) {
    if (Math.abs(carat - s) < DISPLAY_CARAT_TOLERANCE) return true;
  }
  return false;
}

// ─── S30 predictor (inline, browser-compatible) ─────────────────────────────

function cutTier(row) {
  const cut = starsgemNorm(row.cut_raw ?? row.cut ?? row.Cut ?? '-');
  const polish = starsgemNorm(row.polish ?? row.Polish ?? 'EX');
  const symmetry = starsgemNorm(row.symmetry ?? row.Symmetry ?? 'EX');
  if ((cut === 'ID' || cut === 'EX') && ['EX', 'IDEAL', 'VG'].includes(polish) && ['EX', 'VG'].includes(symmetry)) return 'A';
  return 'B';
}

function curveKey(row, includeTier) {
  const base = [
    String(row.shape_style ?? row.Shape_Style ?? 'round_standard').trim().toLowerCase(),
    starsgemNorm(row.color ?? row.Color),
    starsgemNorm(row.clarity ?? row.Clarity),
    starsgemNorm(row.typeName ?? row.TypeName ?? 'CVD'),
  ].join('||');
  return includeTier ? `${base}||${cutTier(row)}` : base;
}

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function predictCurveUpc(carat, curve) {
  const knots = curve?.knots || [];
  if (!knots.length) return null;
  if (knots.length === 1) return knots[0].y;
  if (carat <= curve.minCarat) return clamp(knots[0].y, curve.minUpc, curve.maxUpc);
  if (carat >= curve.maxCarat) return clamp(knots[knots.length - 1].y, curve.minUpc, curve.maxUpc);
  let i = 0;
  while (i < knots.length - 2 && knots[i + 1].x < carat) i += 1;
  const k1 = knots[i], k2 = knots[i + 1];
  const k0 = knots[Math.max(0, i - 1)], k3 = knots[Math.min(knots.length - 1, i + 2)];
  const t = (carat - k1.x) / Math.max(1e-9, k2.x - k1.x);
  return clamp(catmullRom(k0.y, k1.y, k2.y, k3.y, t), curve.minUpc, curve.maxUpc);
}

function predictS30(input, model) {
  const carat = Number(input.carat ?? input.Carat);
  if (!Number.isFinite(carat) || carat <= 0 || !model) return null;
  const exactKey = curveKey(input, true);
  const parentKey = curveKey(input, false);
  const exact = model.curves?.[exactKey];
  const parent = model.parentCurves?.[parentKey];
  const curve = exact || parent;
  const upc = predictCurveUpc(carat, curve);
  if (!Number.isFinite(upc) || upc <= 0) return null;
  return {
    price: upc * carat, upc,
    curveKey: exact ? exactKey : parent ? parentKey : null,
    curveSource: exact ? 'exact_cut_tier' : parent ? 'parent_spec' : 'missing',
    support: curve.n, minCarat: curve.minCarat, maxCarat: curve.maxCarat,
    bounded: carat < curve.minCarat || carat > curve.maxCarat,
  };
}

// ─── Router ─────────────────────────────────────────────────────────────────

function getS28Prediction(row, s28Model) {
  const carat = Number(row.carat ?? row.Carat);
  const s28Input = {
    carat, Carat: carat,
    shape_style: row.shape_style, Shape_Style: row.shape_style,
    color: row.color ?? row.Color, Color: row.color ?? row.Color,
    clarity: row.clarity ?? row.Clarity, Clarity: row.clarity ?? row.Clarity,
    cut_raw: row.cut_raw ?? row.Cut, Cut: row.cut_raw ?? row.Cut,
    polish: row.polish, symmetry: row.symmetry,
    typeName: row.typeName ?? row.TypeName, TypeName: row.typeName ?? row.TypeName,
    lw_ratio: row.lw_ratio, table_pct: row.table_pct, depth_pct: row.depth_pct,
  };
  return predictS28(s28Input, s28Model);
}

function makeResult(price, upc, expert, tier, band, reason, diagnostics) {
  return { price, pricePerCarat: upc, selectedExpert: expert, supportTier: tier, confidenceBand: band, fallbackReason: reason, diagnostics };
}

function routePrediction(row, ctx) {
  const carat = Number(row.carat ?? row.Carat);
  if (!Number.isFinite(carat) || carat <= 0) {
    return makeResult(null, null, null, 'empty', null, 'invalid_carat', { error: 'Carat must be positive finite number' });
  }

  const cfg = ctx.routingConfig || {};
  const ck = cellKey(row);
  const cellN = ctx.cellSupport?.get(ck) ?? 0;
  const tier = supportTier(cellN);
  const shape = String(row.shape_style ?? 'round_standard').trim().toLowerCase();
  const isPrincess = shape === 'princess_standard';

  // Pre-compute S28 for monotonicity guard
  const s28Result = getS28Prediction(row, ctx.s28);
  const s28Upc = s28Result?.upc ?? null;

  // Display grid: use S28 directly for guaranteed monotonicity
  if (isDisplayGridCell(row) && s28Result?.price > 0) {
    return makeResult(s28Result.price, s28Result.upc, 'S28', tier, 'floor', 'display_grid_s28', {
      extrapolated: s28Result.extrapolated, cellSupport: cellN, displayGrid: true,
    });
  }

  // Expert 1: S30
  let s30Result = null;
  if (ctx.s30Model) {
    try {
      s30Result = predictS30({ carat, shape_style: row.shape_style, color: row.color ?? row.Color, clarity: row.clarity ?? row.Clarity, typeName: row.typeName ?? row.TypeName, cut_raw: row.cut_raw ?? row.Cut, polish: row.polish, symmetry: row.symmetry }, ctx.s30Model);
    } catch (e) {}
  }

  const s30Available = s30Result?.price > 0 && s30Result?.support >= (cfg.s30MinSupport ?? 15);
  const s30InRange = s30Result && !s30Result.bounded;
  const highCarat = carat >= (cfg.s30MinCaratForPriority ?? 5);

  let s30MonoSafe = true;
  if (s30Available && s28Upc && s28Upc > 0) {
    const ratio = s30Result.upc / s28Upc;
    if (ratio > (cfg.s30MaxUpcRatio ?? 1.5) || ratio < (cfg.s30MinUpcRatio ?? 0.65)) s30MonoSafe = false;
  }

  if (s30Available && s30InRange && highCarat && s30MonoSafe) {
    return makeResult(s30Result.price, s30Result.upc, 'S30', supportTier(s30Result.support), 'high', null, {
      curveKey: s30Result.curveKey, curveSource: s30Result.curveSource, curveSupport: s30Result.support, s28Upc, cellSupport: cellN,
    });
  }

  if (s30Available && s30InRange && s30Result.support >= (cfg.s30HighConfidenceSupport ?? 30) && s30MonoSafe && !isPrincess) {
    return makeResult(s30Result.price, s30Result.upc, 'S30', supportTier(s30Result.support), tier === 'dense' ? 'high' : 'medium', null, {
      curveKey: s30Result.curveKey, curveSource: s30Result.curveSource, curveSupport: s30Result.support, s28Upc, cellSupport: cellN,
    });
  }

  // Expert 2: S26
  const s26Result = predictS26Lookup(row, ctx.s26Intel);
  const s26LevelIdx = s26Result?.lookupLevel ? 'ABCDEFG'.indexOf(s26Result.lookupLevel) : 99;
  const s26Good = s26Result?.price > 0 && s26LevelIdx >= 0 && s26LevelIdx < (cfg.s26MinLookupLevel ?? 4) && s26Result.lookupCount >= (cfg.s26MinLookupCount ?? 5) && carat < (cfg.s26MaxCarat ?? 8);

  if (s26Good) {
    if (s30Available && highCarat && s30MonoSafe) {
      return makeResult(s30Result.price, s30Result.upc, 'S30', supportTier(s30Result.support), s30Result.bounded ? 'medium' : 'high', s30Result.bounded ? 's30_bounded_extrapolation' : null, {
        curveKey: s30Result.curveKey, curveSource: s30Result.curveSource, curveSupport: s30Result.support, bounded: s30Result.bounded, s28Upc, cellSupport: cellN,
      });
    }
    return makeResult(s26Result.price, s26Result.upc, 'S26', tier, tier === 'dense' ? 'high' : tier === 'medium' ? 'medium' : 'low', null, {
      lookupLevel: s26Result.lookupLevel, lookupCount: s26Result.lookupCount, cellSupport: cellN,
    });
  }

  // Expert 2b: S26 for sparse cells
  const s26AnyGood = s26Result?.price > 0 && s26LevelIdx >= 0 && s26LevelIdx < 7;
  if (s26AnyGood && tier === 'sparse' && carat < (cfg.s26MaxCarat ?? 8)) {
    return makeResult(s26Result.price, s26Result.upc, 'S26', tier, 'medium', 'sparse_cell_s26', {
      lookupLevel: s26Result.lookupLevel, lookupCount: s26Result.lookupCount, cellSupport: cellN,
    });
  }

  // Expert 3: S33-A
  const s33Result = predictS33A(row, ctx.s33a);
  const s33AnchorN = s33Result?.anchorN ?? 0;
  const s33WeakHighCarat = s33Result?.price > 0 && s33AnchorN < (cfg.s33MinAnchorN ?? 10) && carat >= 5 && s28Result?.price > 0;

  if (s33WeakHighCarat) {
    return makeResult(s28Result.price, s28Result.upc, 'S28', tier, 'floor', `s33a_weak_anchor_high_carat_n${s33AnchorN}`, {
      anchorN: s33AnchorN, cellSupport: cellN, extrapolated: s28Result.extrapolated,
    });
  }

  if (s33Result?.price > 0 && s33Result.anchorLevel != null && s33AnchorN >= (cfg.s33MinAnchorN ?? 10)) {
    return makeResult(s33Result.price, s33Result.upc, 'S33A', supportTier(s33AnchorN), s33Result.anchorLevel <= 2 ? 'medium' : 'low', null, {
      anchorLevel: s33Result.anchorLevel, anchorN: s33AnchorN, anchorOffset: s33Result.anchorOffset, baseUpc: s33Result.baseUpc, cellSupport: cellN,
    });
  }

  if (s33Result?.price > 0) {
    return makeResult(s33Result.price, s33Result.upc, 'S33A', tier, 'low', `s33a_weak_anchor_n${s33AnchorN}`, {
      anchorLevel: s33Result.anchorLevel, anchorN: s33AnchorN, anchorOffset: s33Result.anchorOffset, baseUpc: s33Result.baseUpc, cellSupport: cellN,
    });
  }

  // Expert 4: S28
  if (s28Result?.price > 0) {
    return makeResult(s28Result.price, s28Result.upc, 'S28', tier, 'floor',
      tier === 'empty' ? 'empty_cell_s28_fallback' : tier === 'sparse' ? 'sparse_cell_s28_fallback' : 'low_confidence_s28_fallback',
      { extrapolated: s28Result.extrapolated, cellSupport: cellN });
  }

  // Ultimate fallback: S26 global
  const s26Any = predictS26Lookup(row, ctx.s26Intel);
  if (s26Any?.price > 0) {
    return makeResult(s26Any.price, s26Any.upc, 'S26', 'empty', 'floor', 'global_s26_fallback', {
      lookupLevel: s26Any.lookupLevel, lookupCount: s26Any.lookupCount, cellSupport: cellN,
    });
  }

  return makeResult(null, null, null, 'empty', null, 'no_prediction_possible', { error: 'All experts returned null' });
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Initialize the WhiteProd vNext predictor for browser use.
 *
 * @param {Object} artifacts - Pre-loaded model artifacts
 * @param {Object} artifacts.s30 - S30 bounded smooth model JSON
 * @param {Object} artifacts.s30Model - S30 curves artifact (or pass s30 if pre-built)
 * @param {Object} artifacts.s26Intel - Starsgem pricing intelligence JSON
 * @param {Object} artifacts.s33a - S33-A constrained anchors model JSON
 * @param {Object} artifacts.s28 - S28 monotone parametric model JSON
 * @param {Array} [artifacts.allRows] - Training dataset for cell support (optional but recommended)
 * @param {Object} [artifacts.routingConfig] - Override default routing thresholds
 * @returns {Object} ctx — predictor context to pass to predictWhiteProdVNext
 */
export function initWhiteProdVNext(artifacts) {
  const ctx = {
    modelVersion: WHITE_PROD_VNEXT_VERSION,
    s30: artifacts.s30,
    s30Model: artifacts.s30Model || artifacts.s30,
    s26Intel: artifacts.s26Intel,
    s33a: artifacts.s33a,
    s28: artifacts.s28,
    cellSupport: new Map(),
    routingConfig: {
      s30MinSupport: 15,
      s30MinCaratForPriority: 5,
      s30HighConfidenceSupport: 30,
      s30MaxUpcRatio: 1.5,
      s30MinUpcRatio: 0.65,
      s26MinLookupLevel: 4,
      s26MinLookupCount: 5,
      s26MaxCarat: 8,
      s33MinAnchorN: 10,
      princessPreferS26: true,
      ...artifacts.routingConfig,
    },
  };

  // Build cell support map
  if (artifacts.allRows) {
    for (const r of artifacts.allRows) {
      const ck = cellKey(r);
      ctx.cellSupport.set(ck, (ctx.cellSupport.get(ck) || 0) + 1);
    }
  }

  return ctx;
}

/**
 * Predict price for a single white diamond.
 *
 * @param {Object} row - Input with carat, shape_style, color, clarity, cut_raw, typeName, etc.
 * @param {Object} ctx - Predictor context from initWhiteProdVNext()
 * @returns {Object} { price, pricePerCarat, modelVersion, selectedExpert, supportTier, confidenceBand, fallbackReason, diagnostics }
 */
export function predictWhiteProdVNext(row, ctx) {
  const result = routePrediction(row, ctx);
  return { ...result, modelVersion: ctx.modelVersion };
}

/**
 * Batch predict.
 */
export function predictWhiteProdVNextBatch(rows, ctx) {
  return rows.map((row) => predictWhiteProdVNext(row, ctx));
}
