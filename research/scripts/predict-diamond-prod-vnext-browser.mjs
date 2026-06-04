/**
 * DiamondProd vNext — Browser-compatible API
 *
 * This module wraps predict-diamond-prod-vnext.mjs for browser use.
 * Call initDiamondProdVNext() with pre-loaded model artifacts, then
 * use predictDiamondProdVNext() for predictions.
 *
 * Usage in browser:
 *   import { initDiamondProdVNext, predictDiamondProdVNext } from './research/scripts/predict-diamond-prod-vnext-browser.mjs';
 *
 *   // Load artifacts via fetch
 *   const [s30, s26Intel, s33a, s28, s22, s23, allWhiteRows, colorRows] = await Promise.all([...]);
 *   const ctx = initDiamondProdVNext({
 *     white: { s30, s26Intel, s33a, s28, allRows: allWhiteRows },
 *     color: { s22, s23, messiRows, starsgemRows },
 *   });
 *
 *   // Predict
 *   const result = predictDiamondProdVNext(row, ctx);
 *   // → { price, pricePerCarat, modelVersion, branch, selectedExpert, supportTier, confidenceBand, fallbackReason, diagnostics }
 */

import { starsgemNorm, starsgemCaratBucket } from './starsgem-ml-predict.mjs';
import { predictS28 } from './s28-predict.mjs';

// Re-export for convenience
export { starsgemNorm, starsgemCaratBucket };

// ─── Model version ──────────────────────────────────────────────────────────

export const DIAMOND_PROD_VNEXT_VERSION = 'diamond-prod-vnext-v0.2.0';

// ─── White branch (inlined from predict-white-prod-vnext-browser.mjs) ───────

// ── S30 helpers ─────────────────────────────────────────────────────────────

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

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

// ── S26 lookup ──────────────────────────────────────────────────────────────

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

// ── S33-A ───────────────────────────────────────────────────────────────────

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

// ── Support / cell key ─────────────────────────────────────────────────────

function supportTier(n) {
  if (n >= 20) return 'dense';
  if (n >= 5) return 'medium';
  if (n >= 1) return 'sparse';
  return 'empty';
}

function whiteCellKey(row) {
  return [
    String(row.shape_style ?? row.shape ?? 'round_standard').trim().toLowerCase(),
    starsgemNorm(row.color ?? row.Color),
    starsgemNorm(row.clarity ?? row.Clarity),
    starsgemCaratBucket(Number(row.carat ?? row.Carat)),
  ].join('||');
}

// ── Display grid detection ─────────────────────────────────────────────────

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

// ── White result builder ────────────────────────────────────────────────────

function makeWhiteResult(price, upc, expert, tier, band, reason, diagnostics) {
  return { price, pricePerCarat: upc, selectedExpert: expert, supportTier: tier, confidenceBand: band, fallbackReason: reason, diagnostics };
}

// ── White routing ───────────────────────────────────────────────────────────

function routeWhitePrediction(row, ctx, opts = {}) {
  const carat = Number(row.carat ?? row.Carat);
  if (!Number.isFinite(carat) || carat <= 0) {
    return makeWhiteResult(null, null, null, 'empty', null, 'invalid_carat', { error: 'Carat must be positive finite number' });
  }

  const cfg = { ...(ctx.routingConfig || {}), ...opts };
  const ck = whiteCellKey(row);
  const cellN = ctx.cellSupport?.get(ck) ?? 0;
  const tier = supportTier(cellN);
  const shape = String(row.shape_style ?? 'round_standard').trim().toLowerCase();
  const isPrincess = shape === 'princess_standard';

  const s28Result = getS28Prediction(row, ctx.s28);
  const s28Upc = s28Result?.upc ?? null;

  if (isDisplayGridCell(row) && s28Result?.price > 0) {
    return makeWhiteResult(s28Result.price, s28Result.upc, 'S28', tier, 'floor', 'display_grid_s28', {
      extrapolated: s28Result.extrapolated, cellSupport: cellN, displayGrid: true,
    });
  }

  let s30Result = null;
  if (ctx.s30Model) {
    try { s30Result = predictS30({ carat, shape_style: row.shape_style, color: row.color ?? row.Color, clarity: row.clarity ?? row.Clarity, typeName: row.typeName ?? row.TypeName, cut_raw: row.cut_raw ?? row.Cut, polish: row.polish, symmetry: row.symmetry }, ctx.s30Model); } catch (e) {}
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
    return makeWhiteResult(s30Result.price, s30Result.upc, 'S30', supportTier(s30Result.support), 'high', null, {
      curveKey: s30Result.curveKey, curveSource: s30Result.curveSource, curveSupport: s30Result.support, s28Upc, cellSupport: cellN,
    });
  }

  if (s30Available && s30InRange && s30Result.support >= (cfg.s30HighConfidenceSupport ?? 30) && s30MonoSafe && !isPrincess) {
    return makeWhiteResult(s30Result.price, s30Result.upc, 'S30', supportTier(s30Result.support), tier === 'dense' ? 'high' : 'medium', null, {
      curveKey: s30Result.curveKey, curveSource: s30Result.curveSource, curveSupport: s30Result.support, s28Upc, cellSupport: cellN,
    });
  }

  const s26Result = predictS26Lookup(row, ctx.s26Intel);
  const s26LevelIdx = s26Result?.lookupLevel ? 'ABCDEFG'.indexOf(s26Result.lookupLevel) : 99;
  const s26Good = s26Result?.price > 0 && s26LevelIdx >= 0 && s26LevelIdx < (cfg.s26MinLookupLevel ?? 4) && s26Result.lookupCount >= (cfg.s26MinLookupCount ?? 5) && carat < (cfg.s26MaxCarat ?? 8);

  if (s26Good) {
    if (s30Available && highCarat && s30MonoSafe) {
      return makeWhiteResult(s30Result.price, s30Result.upc, 'S30', supportTier(s30Result.support), s30Result.bounded ? 'medium' : 'high', s30Result.bounded ? 's30_bounded_extrapolation' : null, {
        curveKey: s30Result.curveKey, curveSource: s30Result.curveSource, curveSupport: s30Result.support, bounded: s30Result.bounded, s28Upc, cellSupport: cellN,
      });
    }
    return makeWhiteResult(s26Result.price, s26Result.upc, 'S26', tier, tier === 'dense' ? 'high' : tier === 'medium' ? 'medium' : 'low', null, {
      lookupLevel: s26Result.lookupLevel, lookupCount: s26Result.lookupCount, cellSupport: cellN,
    });
  }

  const s26AnyGood = s26Result?.price > 0 && s26LevelIdx >= 0 && s26LevelIdx < 7;
  if (s26AnyGood && tier === 'sparse' && carat < (cfg.s26MaxCarat ?? 8)) {
    return makeWhiteResult(s26Result.price, s26Result.upc, 'S26', tier, 'medium', 'sparse_cell_s26', {
      lookupLevel: s26Result.lookupLevel, lookupCount: s26Result.lookupCount, cellSupport: cellN,
    });
  }

  const s33Result = predictS33A(row, ctx.s33a);
  const s33AnchorN = s33Result?.anchorN ?? 0;
  const s33AnchorLevel = s33Result?.anchorLevel ?? null;
  const s33WeakHighCarat = s33Result?.price > 0 && s33AnchorN < (cfg.s33MinAnchorN ?? 10) && carat >= 5 && s28Result?.price > 0;

  if (s33WeakHighCarat) {
    return makeWhiteResult(s28Result.price, s28Result.upc, 'S28', tier, 'floor', `s33a_weak_anchor_high_carat_n${s33AnchorN}`, {
      anchorN: s33AnchorN, cellSupport: cellN, extrapolated: s28Result.extrapolated,
    });
  }

  const s33WeakN = s33AnchorN > 0 && s33AnchorN < (cfg.s33MinAnchorN ?? 10);
  const s33BroadLevel = s33AnchorLevel != null && s33AnchorLevel >= 4;
  const s33EvidenceWeak = s33Result?.price > 0 && (s33WeakN || s33BroadLevel);

  if (s33EvidenceWeak) {
    const s26HasLookupData = s26Result?.price > 0
      && s26Result.lookupCount >= (cfg.s26MinLookupCount ?? 5)
      && s26LevelIdx >= 0
      && s26LevelIdx < 7;

    if (s26HasLookupData) {
      const s26MinRatio = cfg.s33WeakS26MinUpcRatio ?? 1.1;
      if (s26Result.upc > s33Result.upc * s26MinRatio) {
        const reason = s33WeakN
          ? `weak_s33a_to_s26_lookup_n${s33AnchorN}`
          : `broad_s33a_to_s26_lookup_l${s33AnchorLevel}`;
        return makeWhiteResult(s26Result.price, s26Result.upc, 'S26',
          supportTier(s26Result.lookupCount), 'medium', reason, {
            lookupLevel: s26Result.lookupLevel, lookupCount: s26Result.lookupCount,
            anchorLevel: s33AnchorLevel, anchorN: s33AnchorN,
            s33Upc: s33Result.upc, s26Upc: s26Result.upc, cellSupport: cellN,
          });
      }
    }

    const compEstimate = Number(cfg.compEstimate ?? 0);
    if (compEstimate > 0) {
      const compUpc = compEstimate / carat;
      const compMinRatio = cfg.s33WeakCompMinUpcRatio ?? 1.1;
      if (compUpc > s33Result.upc * compMinRatio) {
        return makeWhiteResult(compEstimate, compUpc, 'COMP_RECONCILED',
          tier, 'medium', 'weak_s33a_to_comp_reconciled', {
            anchorLevel: s33AnchorLevel, anchorN: s33AnchorN,
            s33Upc: s33Result.upc, compUpc, cellSupport: cellN,
          });
      }
    }

    const reason = s33WeakN ? `s33a_weak_anchor_n${s33AnchorN}` : `s33a_broad_anchor_l${s33AnchorLevel}`;
    return makeWhiteResult(s33Result.price, s33Result.upc, 'S33A', tier, 'low', reason, {
      anchorLevel: s33AnchorLevel, anchorN: s33AnchorN,
      anchorOffset: s33Result.anchorOffset, baseUpc: s33Result.baseUpc, cellSupport: cellN,
    });
  }

  if (s33Result?.price > 0 && s33AnchorLevel != null) {
    return makeWhiteResult(s33Result.price, s33Result.upc, 'S33A', supportTier(s33AnchorN), s33AnchorLevel <= 2 ? 'medium' : 'low', null, {
      anchorLevel: s33AnchorLevel, anchorN: s33AnchorN, anchorOffset: s33Result.anchorOffset, baseUpc: s33Result.baseUpc, cellSupport: cellN,
    });
  }

  if (s28Result?.price > 0) {
    return makeWhiteResult(s28Result.price, s28Result.upc, 'S28', tier, 'floor',
      tier === 'empty' ? 'empty_cell_s28_fallback' : tier === 'sparse' ? 'sparse_cell_s28_fallback' : 'low_confidence_s28_fallback',
      { extrapolated: s28Result.extrapolated, cellSupport: cellN });
  }

  const s26Any = predictS26Lookup(row, ctx.s26Intel);
  if (s26Any?.price > 0) {
    return makeWhiteResult(s26Any.price, s26Any.upc, 'S26', 'empty', 'floor', 'global_s26_fallback', {
      lookupLevel: s26Any.lookupLevel, lookupCount: s26Any.lookupCount, cellSupport: cellN,
    });
  }

  return makeWhiteResult(null, null, null, 'empty', null, 'no_prediction_possible', { error: 'All experts returned null' });
}

// ─── Color branch (inlined from predict-color-prod-vnext.mjs) ───────────────

// ── Normalization ───────────────────────────────────────────────────────────

function normHue(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return 'unknown';
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

function category(value) {
  return String(value ?? '').trim() || '-';
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// ── Carat bucketing ─────────────────────────────────────────────────────────

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

// ── Hue classification ──────────────────────────────────────────────────────

const RARE_HUES = new Set(['orange', 'purple', 'violet']);
const CAUTION_HUES = new Set(['green', 'brown', 'red']);
const PRIMARY_HUES = new Set(['yellow', 'pink', 'blue']);

function hueTier(hue) {
  if (PRIMARY_HUES.has(hue)) return 'primary';
  if (CAUTION_HUES.has(hue)) return 'caution';
  if (RARE_HUES.has(hue)) return 'rare';
  return 'unknown';
}

// ── Color cell key ──────────────────────────────────────────────────────────

function colorCellKey(row) {
  return [
    normHue(row.colorHue ?? row.hue),
    normIntensity(row.colorIntensity ?? row.intensity),
    String(row.shape ?? row.shape_style ?? 'round').trim().toLowerCase(),
    colorCaratBucket(safeNumber(row.carat) ?? 0),
  ].join('||');
}

// ── S22 Color Model Prediction (tree inference) ─────────────────────────────

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
  return { price, upc: price / carat, modelName: 'S22' };
}

// ── Normalize a color row for S22/S23 prediction ────────────────────────────

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

// ── Curated prior ───────────────────────────────────────────────────────────

const CURATED_PRIOR = {
  yellow: { fancy: 200, intense: 350, vivid: 600, light: 150, dark: 180 },
  pink: { fancy: 800, intense: 1800, vivid: 3500, light: 500, dark: 600 },
  blue: { fancy: 600, intense: 1400, vivid: 2800, light: 400, dark: 450 },
  green: { fancy: 300, intense: 600, vivid: 1200, light: 200, dark: 250 },
  brown: { fancy: 120, intense: 200, vivid: 350, light: 80, dark: 100 },
  red: { fancy: 1000, intense: 2500, vivid: 5000, light: 600, dark: 700 },
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

  let caratMultiplier = 1.0;
  if (carat > 3) caratMultiplier = 1 + Math.log(carat / 3) * 0.3;
  if (carat > 10) caratMultiplier = 1 + Math.log(10 / 3) * 0.3 + Math.log(carat / 10) * 0.15;

  const price = upc * carat * caratMultiplier;
  const effectiveUpc = price / carat;
  return { price, upc: effectiveUpc };
}

// ── Display grid detection for intensity monotonicity ───────────────────────

function isIntensityDisplayGridCell(row) {
  return row._intensityDisplayGrid === true;
}

// ── Color result builder ────────────────────────────────────────────────────

function makeColorResult(price, upc, expert, tier, band, reason, diagnostics) {
  return { price, pricePerCarat: upc, selectedExpert: expert, supportTier: tier, confidenceBand: band, fallbackReason: reason, diagnostics };
}

// ── Color routing ───────────────────────────────────────────────────────────

function routeColorPrediction(row, ctx) {
  const carat = safeNumber(row.carat ?? row.Carat);
  if (!carat || carat <= 0) {
    return makeColorResult(null, null, null, 'empty', null, 'invalid_carat',
      { error: 'Carat must be positive finite number' });
  }

  const hue = normHue(row.colorHue ?? row.hue);
  const intensity = normIntensity(row.colorIntensity ?? row.intensity);
  const ht = hueTier(hue);
  const ck = colorCellKey(row);
  const cellN = ctx.colorCellSupport?.get(ck) ?? 0;
  const tier = supportTier(cellN);

  // Display grid: use S23 for guaranteed intensity monotonicity
  if (isIntensityDisplayGridCell(row) && ctx.s23) {
    const normRow = normalizeColorRow(row, ctx.sourceAdjustment?.messiToFactoryFactor ?? 1.25);
    let s23DisplayResult = null;
    try { s23DisplayResult = predictS22(normRow, ctx.s23); } catch (e) {}
    if (s23DisplayResult?.price > 0) {
      return makeColorResult(s23DisplayResult.price, s23DisplayResult.upc, 'E3_S23',
        'dense', 'high', 'intensity_display_grid_s23', {
          cellSupport: cellN, intensityDisplayGrid: true, monotoneGuard: 'S23',
        });
    }
  }

  // E1: Direct StarGem color anchor
  const reportNo = row.reportNo ?? row.reportno ?? row.ReportNo;
  if (reportNo && ctx.directAnchors?.has(String(reportNo))) {
    const anchor = ctx.directAnchors.get(String(reportNo));
    const upc = anchor.pricePerStone / anchor.carat;
    return makeColorResult(anchor.pricePerStone, upc, 'E1_DIRECT_QUOTE',
      'dense', 'high', null, {
        anchorReportNo: reportNo, cellSupport: cellN, directStarGem: true,
      });
  }

  // E5: Rare hue → curated prior + direct-quote warning
  if (ht === 'rare') {
    const prior = curatedPriorPrice(row);
    if (prior?.price > 0) {
      return makeColorResult(prior.price, prior.upc, 'E5_CURATED_PRIOR',
        'empty', 'floor', 'rare_hue_direct_quote_recommended', {
          hue, intensity, hueTier: 'rare', directQuoteRecommended: true, cellSupport: cellN,
        });
    }
    return makeColorResult(null, null, null, 'empty', null, 'rare_hue_no_prior_available',
      { hue, intensity, directQuoteRecommended: true });
  }

  const normRow = normalizeColorRow(row, ctx.sourceAdjustment?.messiToFactoryFactor ?? 1.25);

  // E2: S22 point model
  let s22Result = null;
  if (ctx.s22 && normRow) {
    try { s22Result = predictS22(normRow, ctx.s22); } catch (e) {}
  }

  if (hue === 'brown' && s22Result?.price > 0) {
    return makeColorResult(s22Result.price, s22Result.upc, 'E2_S22',
      tier, tier === 'empty' ? 'low' : 'medium', 'brown_hue_caution', {
        hue, intensity, cellSupport: cellN, brownCaution: true,
      });
  }

  if (hue === 'red' && s22Result?.price > 0) {
    return makeColorResult(s22Result.price, s22Result.upc, 'E2_S22',
      tier, tier === 'sparse' || tier === 'empty' ? 'low' : 'medium',
      tier === 'sparse' || tier === 'empty' ? 'red_hue_sparse_warning' : 'red_hue_caution', {
        hue, intensity, cellSupport: cellN, redCaution: true,
        directQuoteRecommended: tier === 'sparse' || tier === 'empty',
      });
  }

  if (s22Result?.price > 0 && (tier === 'dense' || tier === 'medium')) {
    const band = tier === 'dense' ? 'high' : 'medium';
    const reason = hue === 'green' ? 'green_hue_s23_sanity_applied' : null;
    return makeColorResult(s22Result.price, s22Result.upc, 'E2_S22',
      tier, band, reason, {
        hue, intensity, cellSupport: cellN, hueTier: ht, greenCaution: hue === 'green',
      });
  }

  if (s22Result?.price > 0 && tier === 'sparse' && ht === 'primary') {
    return makeColorResult(s22Result.price, s22Result.upc, 'E2_S22',
      tier, 'low', 'sparse_primary_s22', { hue, intensity, cellSupport: cellN });
  }

  // E3: S23 monotone-intensity guardrail
  let s23Result = null;
  if (ctx.s23 && normRow) {
    try { s23Result = predictS22(normRow, ctx.s23); } catch (e) {}
  }

  if (s23Result?.price > 0) {
    if (hue === 'green' && s22Result?.price > 0) {
      return makeColorResult(s22Result.price, s22Result.upc, 'E2_S22',
        tier, 'low', 'green_s22_with_s23_guard', {
          s23Upc: s23Result.upc, cellSupport: cellN, greenCaution: true,
        });
    }
    return makeColorResult(s23Result.price, s23Result.upc, 'E3_S23',
      tier, tier === 'empty' ? 'floor' : 'low',
      tier === 'empty' ? 'empty_cell_s23_fallback' : 'sparse_cell_s23_fallback', {
        cellSupport: cellN, hue, intensity,
      });
  }

  // E4: Comps (cached if available)
  if (ctx.compEstimate && ctx.compEstimate > 0) {
    const compUpc = ctx.compEstimate / carat;
    return makeColorResult(ctx.compEstimate, compUpc, 'E4_COMPS',
      'sparse', 'low', 'comp_fallback', {
        cellSupport: cellN, compSource: ctx.compSource || 'alibaba',
      });
  }

  // E5: Curated prior
  const prior = curatedPriorPrice(row);
  if (prior?.price > 0) {
    return makeColorResult(prior.price, prior.upc, 'E5_CURATED_PRIOR',
      'empty', 'floor',
      ht === 'primary' ? 'primary_hue_curated_fallback' : 'curated_prior_fallback', {
        hue, intensity, cellSupport: cellN,
        directQuoteRecommended: ht !== 'primary',
      });
  }

  return makeColorResult(null, null, null, 'empty', null, 'no_prediction_possible',
    { error: 'All color experts returned null', hue, intensity });
}

// ─── Branch classification ──────────────────────────────────────────────────

const WHITE_COLOR_GRADES = new Set(['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N']);
const FANCY_KEYWORDS = ['fancy', 'vivid', 'intense', 'deep', 'dark', 'light'];

function classifyColorFamily(row) {
  const hue = (row.colorHue ?? row.hue ?? '').toString().trim();
  const intensity = (row.colorIntensity ?? row.intensity ?? '').toString().trim();
  const colorLabel = (row.color ?? row.Color ?? '').toString().trim();
  const colorFamily = (row.colorFamily ?? '').toString().trim().toLowerCase();

  if (colorFamily === 'fancy' || colorFamily === 'fancy_color' || colorFamily === 'fancy-color') {
    return 'fancy-color';
  }
  if (hue || intensity) return 'fancy-color';

  const lowerColor = colorLabel.toLowerCase();
  for (const kw of FANCY_KEYWORDS) {
    if (lowerColor.includes(kw)) return 'fancy-color';
  }

  const grade = colorLabel.toUpperCase().trim();
  if (WHITE_COLOR_GRADES.has(grade)) return 'white';
  if (!grade || grade === '-' || grade === 'UNKNOWN') return 'white';

  return 'fancy-color';
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Initialize the DiamondProd vNext predictor for browser use.
 *
 * @param {Object} artifacts - Pre-loaded model artifacts
 * @param {Object} artifacts.white - White branch artifacts
 * @param {Object} artifacts.white.s30 - S30 bounded smooth model JSON (or s30Model)
 * @param {Object} artifacts.white.s26Intel - Starsgem pricing intelligence JSON
 * @param {Object} artifacts.white.s33a - S33-A constrained anchors model JSON
 * @param {Object} artifacts.white.s28 - S28 monotone parametric model JSON
 * @param {Array} [artifacts.white.allRows] - Training dataset for cell support
 * @param {Object} [artifacts.white.routingConfig] - Override routing thresholds
 * @param {Object} artifacts.color - Color branch artifacts
 * @param {Object} artifacts.color.s22 - S22 color ML model JSON
 * @param {Object} artifacts.color.s23 - S23 color ML model JSON
 * @param {Array} [artifacts.color.colorRows] - Color dataset for cell support
 * @param {Map} [artifacts.color.directAnchors] - Direct StarGem anchor lookup
 * @param {Object} [artifacts.sourceAdjustment] - Source adjustment config
 * @returns {Object} ctx — predictor context
 */
export function initDiamondProdVNext(artifacts = {}) {
  // Build white branch context
  const whiteArtifacts = artifacts.white || {};
  const whiteCtx = {
    modelVersion: 'white-prod-vnext-v0.2.0',
    s30: whiteArtifacts.s30,
    s30Model: whiteArtifacts.s30Model || whiteArtifacts.s30,
    s26Intel: whiteArtifacts.s26Intel,
    s33a: whiteArtifacts.s33a,
    s28: whiteArtifacts.s28,
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
      ...whiteArtifacts.routingConfig,
    },
  };

  if (whiteArtifacts.allRows) {
    for (const r of whiteArtifacts.allRows) {
      const ck = whiteCellKey(r);
      whiteCtx.cellSupport.set(ck, (whiteCtx.cellSupport.get(ck) || 0) + 1);
    }
  }

  // Build color branch context
  const colorArtifacts = artifacts.color || {};
  const sourceAdjustment = artifacts.sourceAdjustment || {
    messiToFactoryFactor: 1.25,
    starsgemDirectFactor: 1.0,
  };

  const colorCellSupport = new Map();
  if (colorArtifacts.colorRows) {
    for (const r of colorArtifacts.colorRows) {
      const ck = colorCellKey(r);
      colorCellSupport.set(ck, (colorCellSupport.get(ck) || 0) + 1);
    }
  }

  return {
    modelVersion: DIAMOND_PROD_VNEXT_VERSION,
    white: whiteCtx,
    color: {
      s22: colorArtifacts.s22,
      s23: colorArtifacts.s23,
      sourceAdjustment,
      colorCellSupport: colorArtifacts.colorCellSupport || colorCellSupport,
      directAnchors: colorArtifacts.directAnchors || new Map(),
    },
    sourceAdjustment,
  };
}

/**
 * Predict price for any diamond (white or fancy-color).
 *
 * @param {Object} row - Input with carat, color, colorHue, colorIntensity, shape, clarity, etc.
 * @param {Object} ctx - Predictor context from initDiamondProdVNext()
 * @param {Object} opts - Optional overrides (compEstimate, compSource for color)
 * @returns {Object} { price, pricePerCarat, modelVersion, branch, selectedExpert, supportTier, confidenceBand, fallbackReason, diagnostics }
 */
export function predictDiamondProdVNext(row, ctx, opts = {}) {
  const colorFamily = classifyColorFamily(row);

  if (colorFamily === 'white') {
    const result = routeWhitePrediction(row, ctx.white, opts);
    const wck = whiteCellKey(row);
    const whiteSupportCount = ctx.white.cellSupport?.get(wck) ?? 0;
    return {
      ...result,
      modelVersion: ctx.modelVersion,
      branch: 'white',
      colorFamily: 'white',
      sourceAdjustment: ctx.sourceAdjustment,
      supportCount: whiteSupportCount,
      diagnostics: {
        ...result.diagnostics,
        classifierColorFamily: colorFamily,
      },
    };
  }

  if (colorFamily === 'fancy-color') {
    // Merge comp estimate if provided
    const mergedColorCtx = { ...ctx.color };
    if (opts.compEstimate != null) mergedColorCtx.compEstimate = opts.compEstimate;
    if (opts.compSource != null) mergedColorCtx.compSource = opts.compSource;

    const result = routeColorPrediction(row, mergedColorCtx);
    return {
      ...result,
      modelVersion: ctx.modelVersion,
      branch: 'fancy-color',
      colorFamily: 'fancy-color',
      sourceAdjustment: ctx.sourceAdjustment,
      hue: normHue(row.colorHue ?? row.hue),
      intensity: normIntensity(row.colorIntensity ?? row.intensity),
      supportCount: ctx.color.colorCellSupport?.get(colorCellKey(row)) ?? 0,
      diagnostics: {
        ...result.diagnostics,
        classifierColorFamily: colorFamily,
      },
    };
  }

  // Unclassifiable
  return {
    price: null, pricePerCarat: null,
    modelVersion: ctx.modelVersion,
    branch: null, colorFamily: 'unknown',
    selectedExpert: null, supportTier: 'empty', supportCount: 0,
    sourceAdjustment: ctx.sourceAdjustment,
    confidenceBand: null,
    fallbackReason: 'needs_manual_color_classification',
    monotonicityMode: null,
    diagnostics: {
      error: 'Could not classify diamond as white or fancy-color',
      classifierColorFamily: colorFamily,
    },
  };
}

/**
 * Batch predict.
 */
export function predictDiamondProdVNextBatch(rows, ctx, opts = {}) {
  return rows.map((row) => predictDiamondProdVNext(row, ctx, opts));
}
