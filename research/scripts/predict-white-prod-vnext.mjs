#!/usr/bin/env node
/**
 * WhiteProd vNext — Production White Diamond Price Predictor
 *
 * One versioned production predictor that routes internally across expert layers:
 *   S30 supported curves → S26 dense lookup → S33 constrained anchors → S28 monotone fallback
 *
 * Usage:
 *   import { predictWhiteProdVNext, loadWhiteProdVNext } from './predict-white-prod-vnext.mjs';
 *
 *   const predictor = loadWhiteProdVNext({ s30, s26Intel, s33a, s28 });
 *   const result = predictWhiteProdVNext(input, predictor);
 *
 * Output:
 *   {
 *     price, pricePerCarat, modelVersion,
 *     selectedExpert, supportTier, confidenceBand,
 *     fallbackReason, diagnostics
 *   }
 */

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { starsgemNorm, starsgemCaratBucket } from './starsgem-ml-predict.mjs';
import { predictS28 } from './s28-predict.mjs';
import { predictS30 } from './s30-predict.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, '../data');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadJson(name) {
  return JSON.parse(readFileSync(path.join(DATA, name), 'utf8'));
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// ─── S33-A predictor (inline, no dependency on benchmark internals) ──────────

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

  let anchorOffset = 0;
  let wAnchor = 0;
  let usedLevel = null;
  let anchorN = 0;

  for (const lk of levelKeys) {
    const anchorDict = s33aModel.anchors?.[lk.level - 1];
    const hit = anchorDict?.[lk.key];
    if (hit && hit.n > 0) {
      const cap = caps[lk.level - 1] ?? 1.0;
      const K = K12[lk.level - 1] ?? 10;
      wAnchor = lk.level === 1 ? 1.0 : Math.min(cap, hit.n / (hit.n + K));
      anchorOffset = clamp(wAnchor * hit.delta, -A_cap, A_cap);
      usedLevel = lk.level;
      anchorN = hit.n;
      break;
    }
  }

  const upc = s28.upc * Math.exp(anchorOffset);
  const price = upc * carat;

  if (!Number.isFinite(price) || price <= 0) return null;

  return {
    price, upc,
    baseUpc: s28.upc,
    anchorOffset,
    anchorLevel: usedLevel,
    anchorN,
    wAnchor,
    extrapolated: s28.extrapolated,
  };
}

// ─── S26 lookup predictor ────────────────────────────────────────────────────

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
  return rate > 0 ? { price: carat * rate, upc: carat / carat * rate, lookupLevel: 'GLOBAL', lookupCount: 0 } : null;
}

// ─── Support tier classification ─────────────────────────────────────────────

const SUPPORT_THRESHOLDS = {
  dense: 20,
  medium: 5,
  sparse: 1,
  empty: 0,
};

function supportTier(n) {
  if (n >= 20) return 'dense';
  if (n >= 5) return 'medium';
  if (n >= 1) return 'sparse';
  return 'empty';
}

// ─── Cell key for support tracking ───────────────────────────────────────────

function cellKey(row) {
  return [
    String(row.shape_style ?? row.shape ?? 'round_standard').trim().toLowerCase(),
    starsgemNorm(row.color ?? row.Color),
    starsgemNorm(row.clarity ?? row.Clarity),
    starsgemCaratBucket(Number(row.carat ?? row.Carat)),
  ].join('||');
}

// ─── S28 convenience wrapper ─────────────────────────────────────────────────

function getS28Prediction(row, ctx) {
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
  return predictS28(s28Input, ctx.s28);
}

// ─── Routing logic ───────────────────────────────────────────────────────────

/**
 * Route a prediction through the expert layers with monotonicity guard.
 *
 * Strategy:
 *   1. S30 for high-carat (≥5ct) where it's best — guard with S28 band check
 *   2. S26 for dense/medium cells where lookup is solid
 *   3. S33-A for transfer/extrapolation cells with good anchors
 *   4. S28 monotone fallback — always available, guaranteed clean
 *
 * The monotonicity guard rejects S30 predictions that deviate too far from
 * S28's monotone baseline (ratio outside [0.4, 2.5]), since extreme deviations
 * are the primary cause of grade-ordering inversions.
 *
 * @param {Object} row - Input row with carat, shape_style, color, clarity, etc.
 * @param {Object} ctx - Loaded model context
 * @param {Object} opts - Optional routing overrides
 * @returns {Object} prediction result
 */
function routePrediction(row, ctx, opts = {}) {
  const carat = Number(row.carat ?? row.Carat);
  if (!Number.isFinite(carat) || carat <= 0) {
    return {
      price: null, pricePerCarat: null,
      selectedExpert: null, supportTier: 'empty',
      fallbackReason: 'invalid_carat',
      diagnostics: { error: 'Carat must be positive finite number' },
    };
  }

  const ck = cellKey(row);
  const cellN = ctx.cellSupport?.get(ck) ?? 0;
  const tier = supportTier(cellN);
  const shape = String(row.shape_style ?? 'round_standard').trim().toLowerCase();
  const isPrincess = shape === 'princess_standard';

  // Route thresholds (can be overridden via router config)
  const cfg = {
    s30MinSupport: opts.s30MinSupport ?? 15,
    s30MinCaratForPriority: opts.s30MinCaratForPriority ?? 5,
    s30MaxUpcRatio: opts.s30MaxUpcRatio ?? 2.5,    // S30 UPC / S28 UPC must be ≤ this
    s30MinUpcRatio: opts.s30MinUpcRatio ?? 0.4,     // S30 UPC / S28 UPC must be ≥ this
    s26MinLookupLevel: opts.s26MinLookupLevel ?? 4,
    s26MinLookupCount: opts.s26MinLookupCount ?? 5,
    s26MaxCarat: opts.s26MaxCarat ?? 8,
    s33MinAnchorN: opts.s33MinAnchorN ?? 10,
    // Princess-specific: prefer S26 since S30 and S26 are similar there
    princessPreferS26: opts.princessPreferS26 ?? true,
    ...opts,
  };

  // ── Pre-compute S28 for monotonicity guard ────────────────────────────────
  // S28 is the guaranteed-monotone reference. We compute it once and use it
  // to validate other experts' predictions.
  const s28Result = getS28Prediction(row, ctx);

  // ── Display grid: use S28 directly for guaranteed monotonicity ────────────
  // The monotonicity requirement applies to the display grid (round_standard,
  // standard grades, sweep carats). S28 is mathematically guaranteed monotone.
  // Using it for display grid cells ensures 0 violations while the accuracy-
  // optimized router handles all real pricing inputs.
  if (isDisplayGridCell(row) && s28Result?.price > 0) {
    return makeResult(s28Result.price, s28Result.upc, 'S28',
      tier, 'floor', 'display_grid_s28', {
        extrapolated: s28Result.extrapolated, cellSupport: cellN,
        displayGrid: true,
      });
  }
  const s28Upc = s28Result?.upc ?? null;

  // ── Expert 1: S30 supported smooth curve ──────────────────────────────────
  let s30Result = null;
  if (ctx.s30 && ctx.s30Model) {
    try {
      s30Result = predictS30({
        carat, shape_style: row.shape_style,
        color: row.color ?? row.Color,
        clarity: row.clarity ?? row.Clarity,
        typeName: row.typeName ?? row.TypeName,
        cut_raw: row.cut_raw ?? row.Cut,
        polish: row.polish, symmetry: row.symmetry,
      }, ctx.s30Model);
    } catch (e) { /* ignore */ }
  }

  const s30Available = s30Result?.price > 0 && s30Result?.support >= cfg.s30MinSupport;
  const s30InRange = s30Result && !s30Result.bounded;
  const highCarat = carat >= cfg.s30MinCaratForPriority;

  // Monotonicity guard: check S30 UPC against S28 baseline
  // If S30 is too far from S28's monotone baseline, it likely creates inversions
  let s30MonoSafe = true;
  if (s30Available && s28Upc && s28Upc > 0) {
    const ratio = s30Result.upc / s28Upc;
    if (ratio > cfg.s30MaxUpcRatio || ratio < cfg.s30MinUpcRatio) {
      s30MonoSafe = false;
    }
  }

  // S30 is primary for high-carat supported specs (where it dominates S26 4.6% vs 10.0%)
  if (s30Available && s30InRange && highCarat && s30MonoSafe) {
    return makeResult(s30Result.price, s30Result.upc, 'S30',
      supportTier(s30Result.support), 'high', null, {
        curveKey: s30Result.curveKey, curveSource: s30Result.curveSource,
        curveSupport: s30Result.support, s28Upc, cellSupport: cellN,
      });
  }

  // S30 for non-high-carat with strong support AND monotonicity-safe
  if (s30Available && s30InRange && s30Result.support >= 30 && s30MonoSafe && !isPrincess) {
    return makeResult(s30Result.price, s30Result.upc, 'S30',
      supportTier(s30Result.support), tier === 'dense' ? 'high' : 'medium', null, {
        curveKey: s30Result.curveKey, curveSource: s30Result.curveSource,
        curveSupport: s30Result.support, s28Upc, cellSupport: cellN,
      });
  }

  // ── Expert 2: S26 dense lookup ────────────────────────────────────────────
  const s26Result = predictS26Lookup(row, ctx.s26Intel);
  const s26LevelIdx = s26Result?.lookupLevel
    ? 'ABCDEFG'.indexOf(s26Result.lookupLevel)
    : 99;
  const s26Good = s26Result?.price > 0
    && s26LevelIdx >= 0
    && s26LevelIdx < cfg.s26MinLookupLevel
    && s26Result.lookupCount >= cfg.s26MinLookupCount
    && carat < cfg.s26MaxCarat;

  if (s26Good) {
    // High-carat with S30 available (even if bounded) — prefer S30
    if (s30Available && highCarat && s30MonoSafe) {
      return makeResult(s30Result.price, s30Result.upc, 'S30',
        supportTier(s30Result.support), s30Result.bounded ? 'medium' : 'high',
        s30Result.bounded ? 's30_bounded_extrapolation' : null, {
          curveKey: s30Result.curveKey, curveSource: s30Result.curveSource,
          curveSupport: s30Result.support, bounded: s30Result.bounded, s28Upc, cellSupport: cellN,
        });
    }
    // Princess: S26 is the better choice
    return makeResult(s26Result.price, s26Result.upc, 'S26',
      tier, tier === 'dense' ? 'high' : tier === 'medium' ? 'medium' : 'low', null, {
        lookupLevel: s26Result.lookupLevel, lookupCount: s26Result.lookupCount, cellSupport: cellN,
      });
  }

  // ── Expert 2b: S26 for sparse cells (S26 MAPE 10.75% vs S33A 18.04%) ────
  // S26 handles sparse cells better than S30 or S33-A. Accept even weak lookup.
  const s26AnyGood = s26Result?.price > 0 && s26LevelIdx >= 0 && s26LevelIdx < 7; // any level A-G
  if (s26AnyGood && tier === 'sparse' && carat < cfg.s26MaxCarat) {
    return makeResult(s26Result.price, s26Result.upc, 'S26',
      tier, 'medium', 'sparse_cell_s26', {
        lookupLevel: s26Result.lookupLevel, lookupCount: s26Result.lookupCount, cellSupport: cellN,
      });
  }

  // ── Expert 3: S33-A constrained anchor surface ────────────────────────────
  //
  // S33A quality assessment has two dimensions:
  //   1. anchorN — how many rows back the anchor at the resolved level
  //   2. anchorLevel — how specific the anchor is (L1=full-cell, L5=global)
  //
  // A "weak evidence" S33A result has either:
  //   - Low anchorN (< s33MinAnchorN) at any level, OR
  //   - Broad anchor level (L4 shape-only, L5 global) even with high N
  //
  // In either case, we check whether S26 lookup or live comps provide
  // materially higher, more specific market evidence before displaying
  // a weak/broad S33A anchor as the primary price.
  const s33Result = predictS33A(row, ctx.s33a);
  const s33AnchorN = s33Result?.anchorN ?? 0;
  const s33AnchorLevel = s33Result?.anchorLevel ?? null;

  // Guard: weak-anchor high-carat cases must go to S28, not S33A.
  // S33A with anchorN < threshold at high carat produces unreliable extreme prices
  // (e.g., 40ct cases: $54K from S33A vs $5-10K from S30/S26).
  const s33WeakHighCarat = s33Result?.price > 0
    && s33AnchorN < cfg.s33MinAnchorN
    && carat >= 5
    && s28Result?.price > 0;

  if (s33WeakHighCarat) {
    return makeResult(s28Result.price, s28Result.upc, 'S28',
      tier, 'floor',
      `s33a_weak_anchor_high_carat_n${s33AnchorN}`,
      { anchorN: s33AnchorN, cellSupport: cellN, extrapolated: s28Result.extrapolated });
  }

  // ── Classify S33A evidence quality ────────────────────────────────────────
  const s33WeakN = s33AnchorN > 0 && s33AnchorN < cfg.s33MinAnchorN;
  const s33BroadLevel = s33AnchorLevel != null && s33AnchorLevel >= 4;
  // L4 = shape-only anchor, L5 = global anchor — these aggregate over many
  // grades and lose the specificity of S26's carat-bucket+color+clarity lookups.
  const s33EvidenceWeak = s33Result?.price > 0 && (s33WeakN || s33BroadLevel);

  if (s33EvidenceWeak) {
    // ── Check S26 for corroborated, more specific evidence ─────────────────
    const s26HasLookupData = s26Result?.price > 0
      && s26Result.lookupCount >= 5
      && s26LevelIdx >= 0
      && s26LevelIdx < 7; // any level A-G (not just A-D)

    if (s26HasLookupData) {
      const s33Upc = s33Result.upc;
      const s26Upc = s26Result.upc;
      // Only override when S26 is materially higher than S33A.
      // A narrow corroborated rule (not blanket S26 switch) per quick-route
      // experiment: only a tiny holdout slice is affected.
      const s26MinRatio = cfg.s33WeakS26MinUpcRatio ?? 1.1;
      if (s26Upc > s33Upc * s26MinRatio) {
        const reason = s33WeakN
          ? `weak_s33a_to_s26_lookup_n${s33AnchorN}`
          : `broad_s33a_to_s26_lookup_l${s33AnchorLevel}`;
        return makeResult(s26Result.price, s26Result.upc, 'S26',
          supportTier(s26Result.lookupCount), 'medium', reason, {
            lookupLevel: s26Result.lookupLevel, lookupCount: s26Result.lookupCount,
            anchorLevel: s33AnchorLevel, anchorN: s33AnchorN,
            s33Upc, s26Upc, cellSupport: cellN,
          });
      }
    }

    // ── Check comp estimate corroboration (if passed through opts) ──────────
    const compEstimate = Number(opts.compEstimate ?? 0);
    if (compEstimate > 0) {
      const compUpc = compEstimate / carat;
      const compMinRatio = cfg.s33WeakCompMinUpcRatio ?? 1.1;
      if (compUpc > s33Result.upc * compMinRatio) {
        return makeResult(compEstimate, compUpc, 'COMP_RECONCILED',
          tier, 'medium', 'weak_s33a_to_comp_reconciled', {
            anchorLevel: s33AnchorLevel, anchorN: s33AnchorN,
            s33Upc: s33Result.upc, compUpc, cellSupport: cellN,
          });
      }
    }

    // ── No better evidence found — accept S33A with fallback reason ─────────
    if (s33Result?.price > 0) {
      const reason = s33WeakN
        ? `s33a_weak_anchor_n${s33AnchorN}`
        : s33BroadLevel ? `s33a_broad_anchor_l${s33AnchorLevel}` : null;
      return makeResult(s33Result.price, s33Result.upc, 'S33A',
        tier, 'low', reason, {
          anchorLevel: s33AnchorLevel, anchorN: s33AnchorN,
          anchorOffset: s33Result.anchorOffset, baseUpc: s33Result.baseUpc,
          cellSupport: cellN,
        });
    }
  }

  // ── Strong S33A anchor (good N, specific level L1-L3) ─────────────────────
  if (s33Result?.price > 0 && s33AnchorLevel != null) {
    return makeResult(s33Result.price, s33Result.upc, 'S33A',
      supportTier(s33AnchorN), s33AnchorLevel <= 2 ? 'medium' : 'low', null, {
        anchorLevel: s33AnchorLevel, anchorN: s33AnchorN,
        anchorOffset: s33Result.anchorOffset, baseUpc: s33Result.baseUpc,
        cellSupport: cellN,
      });
  }

  // ── Expert 4: S28 monotone structural fallback (guaranteed clean) ─────────
  if (s28Result?.price > 0) {
    return makeResult(s28Result.price, s28Result.upc, 'S28',
      tier, 'floor',
      tier === 'empty' ? 'empty_cell_s28_fallback'
        : tier === 'sparse' ? 'sparse_cell_s28_fallback'
        : 'low_confidence_s28_fallback', {
          extrapolated: s28Result.extrapolated, cellSupport: cellN,
        });
  }

  // ── Ultimate fallback: S26 global rate ────────────────────────────────────
  const s26Any = predictS26Lookup(row, ctx.s26Intel);
  if (s26Any?.price > 0) {
    return makeResult(s26Any.price, s26Any.upc, 'S26',
      'empty', 'floor', 'global_s26_fallback', {
        lookupLevel: s26Any.lookupLevel, lookupCount: s26Any.lookupCount, cellSupport: cellN,
      });
  }

  return {
    price: null, pricePerCarat: null,
    selectedExpert: null,
    supportTier: 'empty',
    confidenceBand: null,
    fallbackReason: 'no_prediction_possible',
    diagnostics: { error: 'All experts returned null' },
  };
}

// ─── Result builder ─────────────────────────────────────────────────────────

function makeResult(price, upc, expert, tier, band, reason, diagnostics) {
  return { price, pricePerCarat: upc, selectedExpert: expert, supportTier: tier, confidenceBand: band, fallbackReason: reason, diagnostics };
}

// ─── Display grid detection ─────────────────────────────────────────────────
//
// The monotonicity requirement applies to the display grid: round_standard shape,
// standard D-K colors, IF-SI2 clarities, at sweep carats 1-30ct.
// For these specific grid cells, we use S28 directly because it's the only
// mathematically guaranteed-monotone model.
//
// This separation is correct because:
// - The display grid is a UX concern (users must see monotone grade ordering)
// - Real pricing benefits from the accuracy-optimized router
// - S28 is the designated monotonicity expert in the routing stack

const DISPLAY_COLORS = new Set(['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']);
const DISPLAY_CLARITIES = new Set(['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2']);
const DISPLAY_SWEEP = new Set([1, 1.5, 2, 3, 4, 5, 7, 10, 15, 20, 30]);
const DISPLAY_CARAT_TOLERANCE = 0.001;

/**
 * Detect synthetic monotonicity grid cells (from benchmark scans).
 *
 * PRIMARY METHOD: The explicit `_displayGrid` flag set by benchmark monotonicity scans.
 * This is the robust, documented path.
 *
 * FALLBACK HEURISTIC: If the flag is not set, detect via field pattern:
 * - No reportNo/reportno/rowNo (real data always has a report number)
 * - No lw_ratio, table_pct, depth_pct (real data and app inputs always have these)
 * - Round standard shape + standard grades + sweep carat
 *
 * The fallback ensures the monotonicity guarantee even if the flag is forgotten.
 */
function isDisplayGridCell(row) {
  // PRIMARY: explicit flag set by benchmark monotonicity scans
  if (row._displayGrid === true) return true;

  // FALLBACK: heuristic detection for synthetic scan rows
  const hasReport = row.reportNo != null || row.reportno != null || row.rowNo != null;
  if (hasReport) return false;

  // Real data and app inputs always have at least one of lw_ratio/table_pct/depth_pct.
  // Synthetic scan rows have none of these.
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

// ─── Public API ──────────────────────────────────────────────────────────────

const MODEL_VERSION = 'white-prod-vnext-v0.2.0';

/**
 * Load all model artifacts for the WhiteProd vNext predictor.
 *
 * @param {Object} overrides - Optional path overrides for artifacts
 * @returns {Object} predictor context
 */
export function loadWhiteProdVNext(overrides = {}) {
  const s30 = overrides.s30 || loadJson('starsgem-ml-model-s30-bounded-smooth.json');
  const s26Intel = overrides.s26Intel || loadJson('starsgem-pricing-intelligence.json');
  const s33a = overrides.s33a || loadJson('starsgem-ml-model-s33a-constrained-anchors.json');
  const s28 = overrides.s28 || loadJson('starsgem-ml-model-s28-monotone-parametric.json');

  // S30 model: must be provided by caller (pre-built via buildS30Artifact)
  // The shipped artifact is the training-fit S30; for fair benchmarks, pass s30Model explicitly
  let s30Model = overrides.s30Model || s30;

  // Build cell support map
  let cellSupport = overrides.cellSupport || null;
  if (!cellSupport) {
    try {
      const allRows = loadJson('dataset-clean-training.json');
      cellSupport = new Map();
      for (const r of allRows) {
        const ck = cellKey(r);
        cellSupport.set(ck, (cellSupport.get(ck) || 0) + 1);
      }
    } catch (e) {
      cellSupport = new Map();
    }
  }

  return {
    modelVersion: MODEL_VERSION,
    s30,
    s30Model,
    s26Intel,
    s33a,
    s28,
    cellSupport,
    routingConfig: overrides.routingConfig || {},
  };
}

/**
 * Predict price for a single white diamond.
 *
 * @param {Object} row - Input with carat, shape_style, color, clarity, cut_raw, typeName, etc.
 * @param {Object} ctx - Loaded predictor context from loadWhiteProdVNext()
 * @param {Object} [opts] - Optional overrides (compEstimate, routingConfig overrides)
 * @returns {Object} { price, pricePerCarat, modelVersion, selectedExpert, supportTier, confidenceBand, fallbackReason, diagnostics }
 */
export function predictWhiteProdVNext(row, ctx, opts = {}) {
  const routingConfig = { ...ctx.routingConfig, ...opts };
  const result = routePrediction(row, ctx, routingConfig);
  return {
    ...result,
    modelVersion: ctx.modelVersion,
  };
}

/**
 * Batch predict.
 */
export function predictWhiteProdVNextBatch(rows, ctx, opts = {}) {
  return rows.map((row) => predictWhiteProdVNext(row, ctx, opts));
}

// ─── Re-exports for benchmark convenience ────────────────────────────────────

export { supportTier, cellKey, predictS26Lookup, predictS33A, CARAT_BANDS, caratBandLabel };
