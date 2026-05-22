# P1 — Improve Fancy Color Point Accuracy

**Research date:** 2026-05-22  
**Status:** Deep research / implementation plan (no code changes in this pass)  
**Related:** `fancy-color-diamond-pricing.md`, `alibaba-listing-confidence-gaps.md`, `comp-engine-v3-remaining-work.md` P1, `comp-engine-v2-proposal.md`, `comp-engine-v3.js` §2/§7

---

## Executive Summary

Fancy color is the **largest model-quality gap** in comp engine v3:

| Metric | Fancy | White (comparison) |
|--------|------:|-------------------:|
| MdAPE | **37.6%** | 15.4% |
| Bias | **+20.7%** | +6.1% |
| P80 coverage | 78.6% | 85.0% |

Intervals are **honest enough** after sigma inflation (P80 ≈ 79%), but the **median point estimate is systematically high**, especially for `best_available` matches (**~42% MdAPE**, **+26% bias**).

**Root causes (evidence-based):**

1. **Sparse comps** — many hues/shapes have one row; ensemble collapses to a single adjusted comp.
2. **Transfer via `FANCY_COLOR_BASE` power-law** — cross-intensity and cross-hue adjustments use hand-tuned `ws1`/`scale` tables that are not calibrated to Alibaba comp levels.
3. **Weak transfer penalties** — `fancyIntensityPerLevel: 0.25` in scoring; adjustment does not add asymmetric penalty for risky transfers (e.g. `pink_f` comp → `pink_fv` query).
4. **Modifier handling is symmetric in sigma, partial in adjustment** — brownish discount exists but brownish→pink hue comp can still enter via label map (`pink_fi`).
5. **Shape cross-family** — fancy shape mults differ from white; cross-shape comps broadened when sparse.

**Proposed direction:** Calibrate fancy **separately** from white with:

- Segment-specific **transfer penalty matrix** (hue × intensity × modifier × shape);
- **Asymmetric** adjustment caps for upward transfers;
- **Bias correction layer** on sparse segments (shrink toward weighted median of comps, not model table);
- **Worst-miss attribution** flags in backtest output.

---

## Table of Contents

1. [Current fancy pipeline](#1-current-fancy-pipeline)
2. [Error anatomy from backtests](#2-error-anatomy-from-backtests)
3. [Market evidence from fancy-color-diamond-pricing.md](#3-market-evidence-from-fancy-color-diamond-pricingmd)
4. [Data sparsity from listing-confidence-gaps](#4-data-sparsity-from-listing-confidence-gaps)
5. [Known failure modes with examples](#5-known-failure-modes-with-examples)
6. [Prior proposals and v2 lessons](#6-prior-proposals-and-v2-lessons)
7. [Proposed model changes](#7-proposed-model-changes)
8. [Proposed code (reference only)](#8-proposed-code-reference-only)
9. [Calibration methodology](#9-calibration-methodology)
10. [Testing plan](#10-testing-plan)
11. [Why this will work](#11-why-this-will-work)
12. [Risks](#12-risks)
13. [Implementation phases](#13-implementation-phases)

---

## 1. Current fancy pipeline

### 1.1 Query construction (backtest)

```javascript
// backtest-comp-engine.mjs — rowToQuery for fancy
q.colorFamily_key = inferFancyFamilyKey(row.color);
```

### 1.2 Hard gate: hue only

```javascript
// comp-engine-v3.js — fancyHueCompatible (lines 629–642)
function fancyHueCompatible(queryKey, compColorLabel) {
  const rl = compColorLabel.toLowerCase();
  const uf = (queryKey || '').toLowerCase();
  if (uf.includes('pink')   && !rl.includes('pink'))   return false;
  if (uf.includes('yellow') && !rl.includes('yellow')) return false;
  // ... blue, green, orange, red, purple ...
  return true;
}
```

**Gap:** Does not block **intensity** mismatch or **modifier** mismatch — only hue substring.

### 1.3 Scoring (fancy color axis)

```javascript
// compErrorScore — fancy branch (lines 728–735)
const userParsed = parseFancyColorLabel(query.colorFamily_key || '');
const compParsed = parseFancyColorLabel(row.color || '');
const uInt = INTENSITY_RANK[userParsed.intensityKey] ?? 1;
const cInt = INTENSITY_RANK[compParsed.intensityKey] ?? 1;
const intensityGap = Math.abs(uInt - cInt);
const modifierDiff = Math.abs(compParsed.modifierTerms.length - userParsed.modifierTerms.length);
eColor = intensityGap * AXIS_SIGMA.fancyIntensityPerLevel + modifierDiff * AXIS_SIGMA.fancyModifierPerTerm;
```

`INTENSITY_RANK`: `{ fl:0, f:1, fi:2, fv:3 }`

### 1.4 Adjustment (fancy branch)

```javascript
// adjustCompToQuery — fancy (lines 831–883)
const ub = FANCY_COLOR_BASE[query.colorFamily_key];
const compKey = inferFancyFamilyKey(row.color);
const cb = compKey ? FANCY_COLOR_BASE[compKey] : null;

if (ub && cb) {
  const logModelQ = Math.log(ub.ws1) + (ub.scale - 1) * Math.log(queryCt);
  const logModelC = Math.log(cb.ws1) + (cb.scale - 1) * Math.log(compCt);
  const deltaIntensityCarat = logModelQ - logModelC;
  logDpcAdj += deltaIntensityCarat;
}
// Modifier deltas via MODIFIER_LOG_DELTA (brownish ≈ −18%)
```

### 1.5 `FANCY_COLOR_BASE` table (excerpt)

```javascript
const FANCY_COLOR_BASE = {
  pink_fl: { ws1: 150, scale: 0.91, label: 'Fancy Light Pink' },
  pink_f:  { ws1: 220, scale: 0.91, label: 'Fancy Pink' },
  pink_fi: { ws1: 330, scale: 0.90, label: 'Fancy Intense Pink' },
  pink_fv: { ws1: 500, scale: 0.88, label: 'Fancy Vivid Pink' },
  yellow_fi: { ws1: 255, scale: 1.00, label: 'Fancy Intense Yellow' },
  // ...
};
```

These values come from `index.html` / `fancy-color-diamond-pricing.md` ladders — **retail-oriented anchors**, not Alibaba comp medians.

### 1.6 Blend

Same `blendComps` as white — inverse-variance mean with outlier rejection. Sparse fancy → 1–2 comps → model-heavy estimate.

---

## 2. Error anatomy from backtests

### 2.1 Match type concentration

| matchType | Fancy MdAPE (approx) | Bias |
|-----------|---------------------:|-----:|
| exact | Lower | Lower |
| nearest | Moderate | Moderate |
| **best_available** | **~42%** | **~+26%** |

**Interpretation:** When no close comp exists, model transfer **over-shoots** actual held-out price.

### 2.2 Positive bias mechanism

For a held-out **vivid** row, remaining pool may contain only **intense** or **fancy** comps. Model delta:

```text
logModel(pink_fv, q_ct) - logModel(pink_fi, c_ct) > 0
```

If `ws1` ratios overstate vivid premium vs real Alibaba spreads, estimate **> actual** → positive bias (+20.7% mean).

### 2.3 P80 vs MdAPE decoupling

Sigma inflation (`SIGMA_CALIBRATION_FACTOR = 2`) widens intervals so actual falls in band, but **median** remains high — exactly the failure mode acceptance criteria warn against.

---

## 3. Market evidence from fancy-color-diamond-pricing.md

### 3.1 Intensity dominates price

Document states Fancy Vivid can be **3–10×** Fancy base at same size. Engine table ratio at 1ct pink:

```text
pink_fv.ws1 / pink_f.ws1 = 500 / 220 ≈ 2.27×
```

Alibaba vivid pink comps often show **higher** spreads for sparse shapes — table may be **too low** for vivid, but holdout bias is **positive**, suggesting comps used are **lower intensity than query** while adjustment **over-corrects upward**.

### 3.2 Modifier discounts (documented)

| Modifier | Documented discount |
|----------|---------------------|
| Brownish pink | ~10–15% vs pure intense pink |
| Example | 0.89ct brownish radiant $262 vs pure intense |

Engine:

```javascript
const MODIFIER_LOG_DELTA = {
  brownish: Math.log(0.82),  // ~−18%
};
```

### 3.3 Shape premiums (yellow asscher example)

Asscher +14% vs radiant at 4ct intense yellow — shape transfer must be shape-aware in fancy, not only `SHAPE_MULT_COLOR`.

---

## 4. Data sparsity from listing-confidence-gaps

| Segment | Tier | Implication for model |
|---------|------|----------------------|
| Fancy vivid pink heart | A | Carat ladder; clarity flat |
| Fancy pink pear/oval/radiant | B–C | Often **one row** per shape |
| Fancy round (any color) | **D** | No clean comps |
| Orange / purple | **D** | `matchType: none` expected |
| Yellow princess | C (flat-price excluded) | Broken ladders |

**Consequence:** `best_available` is not an edge case — it is **central** for fancy.

---

## 5. Known failure modes with examples

### 5.1 T16 — brownish pink comp for vivid pink query

Built-in test:

```javascript
// comp-engine-v3.js runTests — T16
{
  desc: 'T16 — 3.8ct FVP radiant must not use 0.89ct brownish as primary',
  q: { carat: 3.8, shape: 'radiant', colorFamily: 'fancy', colorFamily_key: 'pink_fv', clarity: 'VVS2' },
  expectPrimaryNotBrownish: true,
  estimateBetween: [500, 8000],
}
```

**Fix class:** Reject or down-rank comps where `inferFancyFamilyKey(comp) !== query.key` AND intensity rank gap ≥ 2 AND modifier present.

### 5.2 Cross-intensity upward transfer

Query `pink_fv`, comp `pink_f` at similar carat:

- Model scales up aggressively;
- Real market spread may be non-linear and **listing-specific**.

**Fix class:** Cap upward `deltaIntensityCarat` at e.g. +40% unless comp is within 1 intensity level.

### 5.3 Cross-shape broadening

Warning: `No shape-compatible comps — broadened to any shape in same color family.`

Radiant query borrowing **oval** comp → shape mult adjustment + low sigma may still leave estimate biased.

**Fix class:** Fancy-specific `shapeCross` penalty multiplier (e.g. 1.5× white sigma).

### 5.4 `inferFancyFamilyKey` maps brownish to `pink_fi`

```javascript
// FANCY_LABEL_MAP
'fancy intense brownish pink': 'pink_fi',
```

Comp labeled brownish pink may score as intense family — modifier penalty applied but **intensity table still high**.

**Fix class:** Separate `intensityKey` from `marketFamilyKey`; brownish uses `pink_fi` for hue gate only, not for `FANCY_COLOR_BASE` lookup without extra discount.

---

## 6. Prior proposals and v2 lessons

| Source | Lesson / proposal |
|--------|-------------------|
| `comp-engine-v2-proposal.md` | v2 had `fancy color distance = 0` bug — never repeat zero penalty |
| `comp-engine-v3-proposal.md` | Log-space ensemble + per-axis σ; fancy needs own calibration pass |
| `comp-engine-v3-remaining-work.md` | Segment transfer penalties; worst-miss attribution |
| `alibaba-comp-matcher-igi-app-implementation.md` | Intensity mult from `fancyColorBase` ratio; brownish −10–15% |
| `estimation-algo-improvement-priorities.md` | Normalize hue/intensity at index time (P2) — supports this P1 |

---

## 7. Proposed model changes

### 7.1 Fancy transfer penalty matrix (scoring + sigma)

Define ordinal scales:

```javascript
// PROPOSED — research/comp-engine-v3-fancy-transfer.js
const INTENSITY_RANK = { fl: 0, f: 1, deep: 1, dark: 1, fi: 2, fv: 3 };

const TRANSFER_SIGMA = {
  intensity: {
    // gap = |rank(query) - rank(comp)|
    0: 0.05,
    1: 0.18,
    2: 0.35,
    3: 0.55,
  },
  direction: {
    // comp weaker than query (upward transfer) extra penalty
    upward: 0.12,
    downward: 0.04,
  },
  modifier: {
    brownish: 0.22,
    greyish: 0.15,
    crossHueModifier: 0.30,
  },
  shape: {
    same: 0.05,
    family: 0.14,
    adjacent: 0.22,
    cross: 0.45,
  },
  hue: {
    same: 0,
    // cross-hue already hard-gated
  },
};
```

**Scoring integration:**

```javascript
function fancyTransferSigma(queryKey, compLabel, queryShape, compShape) {
  const q = parseFancyColorLabel(queryKey);
  const c = parseFancyColorLabel(compLabel);
  const gap = Math.abs((INTENSITY_RANK[q.intensityKey] ?? 1) - (INTENSITY_RANK[c.intensityKey] ?? 1));
  let sigma = TRANSFER_SIGMA.intensity[Math.min(gap, 3)] ?? 0.55;

  const qRank = INTENSITY_RANK[q.intensityKey] ?? 1;
  const cRank = INTENSITY_RANK[c.intensityKey] ?? 1;
  if (cRank < qRank) sigma += TRANSFER_SIGMA.direction.upward;
  else if (cRank > qRank) sigma += TRANSFER_SIGMA.direction.downward;

  for (const m of c.modifierTerms) {
    if (!q.modifierTerms.includes(m)) sigma += TRANSFER_SIGMA.modifier[m] ?? 0.12;
  }

  sigma += shapeSigma(queryShape, compShape) * 1.25; // fancy shape boost
  return sigma;
}
```

### 7.2 Asymmetric adjustment cap (point estimate)

```javascript
// PROPOSED — cap model transfer in adjustCompToQuery fancy branch
let deltaIntensityCarat = logModelQ - logModelC;

const MAX_UPWARD_LOG = Math.log(1.45);   // +45% max from model transfer
const MAX_DOWNWARD_LOG = Math.log(0.70); // -30% max

if (deltaIntensityCarat > MAX_UPWARD_LOG) {
  deltaIntensityCarat = MAX_UPWARD_LOG;
  parts.push('intensity transfer capped (+45%)');
}
if (deltaIntensityCarat < MAX_DOWNWARD_LOG) {
  deltaIntensityCarat = MAX_DOWNWARD_LOG;
}
```

**Why asymmetric:** Positive bias (+20.7%) implies upward corrections are too large; downward caps are looser.

### 7.3 Comp-anchored blend for sparse fancy

When `matchType === 'best_available'` OR `bestScore > 0.35`:

```javascript
// PROPOSED — after per-comp adjustments, blend with comp-median anchor
const compOnlyLogEsts = adjustedList.map(a => Math.log(a.row.priceUsd) + logShapeClarityAdjustments);
const compMedianLog = medianOf(compOnlyLogEsts);
const modelLog = blend.logEstimate;

const alpha = Math.min(0.75, bestScore / 0.60); // more model when score good
const shrunkLog = alpha * modelLog + (1 - alpha) * compMedianLog;
```

**Why:** Alibaba comps are ground truth for wholesale; `FANCY_COLOR_BASE` is prior literature. Shrinking toward comp median **pulls bias down** when model overshoots.

### 7.4 Reject risky comps (hard gate)

```javascript
// PROPOSED filterCandidates addition for fancy
function fancyTransferAllowed(queryKey, compColor) {
  const q = parseFancyColorLabel(queryKey);
  const c = parseFancyColorLabel(compColor);
  const gap = Math.abs((INTENSITY_RANK[q.intensityKey] ?? 1) - (INTENSITY_RANK[c.intensityKey] ?? 1));
  if (gap >= 3) return false; // e.g. light → vivid
  if (c.modifierTerms.includes('brownish') && q.intensityKey === 'fv') return false;
  if (q.hue !== c.hue) return false; // stricter than substring
  return true;
}
```

### 7.5 Bias calibration layer (segment offsets)

From holdout backtest, estimate mean signed error by `(hue, intensity_bucket, matchType)`:

```javascript
// PROPOSED static correction table (fitted offline)
const FANCY_BIAS_CORRECTION_LOG = {
  'pink_fv|best_available': Math.log(0.82),  // multiply estimate by 0.82
  'pink_fi|best_available': Math.log(0.88),
  'yellow_fi|nearest': Math.log(0.95),
  // ...
};

function applyFancyBiasCorrection(queryKey, matchType, logEstimate) {
  const bucket = `${queryKey}|${matchType}`;
  const corr = FANCY_BIAS_CORRECTION_LOG[bucket];
  return corr != null ? logEstimate + corr : logEstimate;
}
```

**Recalibrate quarterly** as index grows — not hand-tuned forever.

---

## 8. Proposed code (reference only)

### 8.1 Extend `compErrorScore` fancy branch

```javascript
// PROPOSED replacement for eColor fancy section
const transferSigma = fancyTransferSigma(
  query.colorFamily_key,
  row.color,
  query.shape,
  row.shape
);
eColor = transferSigma; // or combine: Math.hypot(oldEColor, transferSigma)
```

### 8.2 Extend `resolveAlibabaComp` return — attribution

```javascript
// PROPOSED result fields
fancyTransfer: {
  maxIntensityGap: 2,
  dominantCompKey: 'pink_fi',
  queryKey: 'pink_fv',
  upwardTransfer: true,
  modifierMismatch: ['brownish'],
  shapeDistance: 1,
  biasCorrectionApplied: 'pink_fv|best_available',
},
```

### 8.3 Worst-miss reporting in backtest

```javascript
// PROPOSED — backtest-comp-engine.mjs record on each miss
function attributeFancyError(query, result, heldOutRow) {
  const tags = [];
  const q = parseFancyColorLabel(query.colorFamily_key);
  const c = parseFancyColorLabel(heldOutRow.color);
  if (INTENSITY_RANK[q.intensityKey] > INTENSITY_RANK[c.intensityKey]) tags.push('intensity_upward_transfer');
  if (shapeDistance(query.shape, heldOutRow.shape) >= 2) tags.push('shape_transfer');
  if (result.localCaratCurve?.queryIsExtrapolated) tags.push('carat_extrapolation');
  if (result.sourceConcentration?.finalDominantFrac > 0.7) tags.push('supplier_concentration');
  if (result.matchType === 'best_available') tags.push('sparse_best_available');
  return tags;
}
```

---

## 9. Calibration methodology

### 9.1 Holdout design (keep LOO supplier)

Fancy rows: **565** queryable holdouts (current run). Stratify metrics by:

- hue (pink, yellow, blue, green, red, brown)
- intensity key (fl, f, fi, fv)
- shape family
- carat band (1–2, 2–3, 3–5, 5+)
- matchType

### 9.2 Calibration steps

1. **Freeze** index version.
2. Sweep `TRANSFER_SIGMA` and cap constants on training suppliers (nested CV optional).
3. Fit `FANCY_BIAS_CORRECTION_LOG` on held-out errors **per segment** (ridge toward 0 to avoid overfit).
4. Validate on full LOO — report MdAPE, bias, P80.
5. **Do not** widen intervals to hit MdAPE — acceptance requires point accuracy.

### 9.3 Targets

| Metric | Baseline | Target |
|--------|----------|--------|
| Fancy MdAPE | 37.6% | **≤ 32%** (stretch ≤ 30%) |
| Fancy bias | +20.7% | **+5% to +10%** |
| Fancy P80 | 78.6% | **≥ 75%** |
| best_available MdAPE | ~42% | **≤ 36%** |

---

## 10. Testing plan

### 10.1 Unit tests

```javascript
// PROPOSED
assert(fancyTransferAllowed('pink_fv', 'Fancy Light Pink') === false);
assert(fancyTransferAllowed('pink_fv', 'Fancy Intense Brownish Pink') === false);
assert(fancyTransferSigma('pink_fv', 'Fancy Pink', 'radiant', 'radiant') > 0.15);
```

### 10.2 Integration fixtures (extend runTests)

| ID | Query | Assertion |
|----|-------|-----------|
| T16 | 3.8ct pink_fv radiant | No brownish primary; estimate band |
| T17 | 2ct yellow_fv princess | matchType none or wide interval if no comps |
| T18 | pink_fi query, only pink_f comps | Estimate ≤ 1.35× comp median |
| T19 | cross-shape broadened | warning present; sigma ≥ threshold |

### 10.3 Backtest commands

```bash
node research/scripts/backtest-comp-engine.mjs --segment fancy --worst 20
node research/scripts/backtest-comp-engine.mjs --segment fancy --verbose
# PROPOSED
node research/scripts/backtest-comp-engine.mjs --segment fancy --attribute-errors
```

### 10.4 Manual review checklist

For each worst miss:

- [ ] Primary comp intensity/modifier/shape vs held-out
- [ ] Was `FANCY_COLOR_BASE` delta > comp-only delta?
- [ ] Supplier concentration?
- [ ] Would hard gate have rejected comp?

---

## 11. Why this will work

1. **Targets documented failure mode:** `best_available` + upward intensity transfer + positive bias — penalties and caps directly attenuate this.

2. **Comp-anchored shrink preserves data:** When comps exist, they are authoritative; model table is fallback, not dominant.

3. **Asymmetric caps address bias sign:** +20.7% mean error is not fixed by widening intervals — caps attack median.

4. **Segment bias corrections absorb residual:** Small multiplicative corrections per hue/matchType are standard recalibration after structural fixes.

5. **Attribution enables iteration:** Worst-miss tags prevent tuning the wrong axis (e.g. shape when intensity is culprit).

---

## 12. Risks

| Risk | Mitigation |
|------|------------|
| Over-penalize → `none` too often | Soft penalties first; hard gate only gap ≥ 3 |
| Bias correction overfits LOO | Ridge shrink; minimum cell count ≥ 15 |
| Caps hide true vivid premium | Allow cap lift when exact vivid comp exists |
| Tables drift from index.html | P0 parity on fancy queries |

---

## 13. Implementation phases

### Phase 1 — Transfer sigma + hard gates (2 days)

- `fancyTransferSigma`, `fancyTransferAllowed`
- Tests T16–T19

### Phase 2 — Adjustment caps + comp shrink (1 day)

- Asymmetric caps
- `best_available` shrink

### Phase 3 — Bias calibration table (1 day)

- Offline fit script
- Document fitted table in `research/data/fancy-bias-corrections.json`

### Phase 4 — Backtest attribution (0.5 day)

- `--attribute-errors` CSV output

---

## Definition of done (P1 fancy)

- [ ] Fancy MdAPE materially below 37.6%; bias near neutral without P80 collapse
- [ ] Cross-intensity / cross-shape show higher σ and visible warnings
- [ ] Brownish→vivid and weak→vivid rejected or heavily discounted
- [ ] Worst-miss export tags transfer causes
- [ ] T16 and pink sparse cases regression-tested
