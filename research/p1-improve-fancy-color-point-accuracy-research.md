# P1 — Improve Fancy Color Point Accuracy

**Research date:** 2026-05-22 (updated with LOO segment breakdown + edge-case catalog)  
**Status:** Deep research / implementation plan (no engine changes in this pass)  
**Related:** `fancy-color-diamond-pricing.md`, `alibaba-listing-confidence-gaps.md`, `comp-engine-v3-remaining-work.md` P1, `p1b-source-independence-signals-research.md`, `comp-engine-v2-proposal.md`, `comp-engine-v3.js` §2/§5/§7  
**Repro:** `node research/scripts/backtest-comp-engine.mjs --segment fancy` and `node research/scripts/fancy-backtest-breakdown.mjs` (hue/intensity strata, `min-support=3`)

---

## Executive Summary

Fancy color is the **largest model-quality gap** in comp engine v3:

| Metric | Fancy | White (comparison) |
|--------|------:|-------------------:|
| MdAPE | **37.6%** | 15.4% |
| Bias | **+20.7%** | +6.1% |
| P80 coverage | 78.6% | 85.0% |

Intervals are **honest enough** after sigma inflation (P80 ≈ 79%), but the **median point estimate is systematically high** on the segments that dominate the backtest — especially `pink_fv` and `best_available` (**~42% MdAPE**, **+26% bias**). Bias is **not uniform**: brown/champagne and many asscher rows are **severely under-estimated** (−60% to −70%), while large vivid pink pears/ovals are **over-estimated** by 100%+ in worst cases.

**Root causes (evidence-based):**

1. **Sparse comps** — many hues/shapes have one row; ensemble collapses to a single adjusted comp.
2. **Transfer via `FANCY_COLOR_BASE` power-law** — cross-intensity and cross-hue adjustments use hand-tuned `ws1`/`scale` tables that are not calibrated to Alibaba comp levels.
3. **Weak transfer penalties** — `fancyIntensityPerLevel: 0.25` in scoring; adjustment does not add asymmetric penalty for risky transfers (e.g. `pink_f` comp → `pink_fv` query).
4. **Modifier handling is symmetric in sigma, partial in adjustment** — brownish discount exists but brownish→pink hue comp can still enter via label map (`pink_fi`).
5. **Shape cross-family** — fancy shape mults differ from white; cross-shape comps broadened when sparse.
6. **`isExactMatch` ignores intensity for fancy** — same hue + near carat + same clarity/shape can be labeled `exact` even when intensity differs (see §5.6).
7. **Yellow vivid is a separate failure mode** — `yellow_fv` rows blow up when support exists; most yellow SKUs fail `min-support` and never enter the 565-row headline metric (see §2.6).
8. **No fancy local carat curve** — white uses `fitLocalCaratSlope`; fancy always uses `FANCY_COLOR_BASE.scale` per family, missing ladder signal on pink cushion / vivid heart products (see §7.6).

**Proposed direction:** Calibrate fancy **per hue** (at minimum pink / blue / brown / yellow-vivid), not one global fancy pass:

- Segment-specific **transfer penalty matrix** (hue × intensity × modifier × shape);
- **Asymmetric** adjustment caps for upward transfers;
- **Bias correction layer** on sparse segments (shrink toward weighted median of comps, not model table);
- **Worst-miss attribution** flags in backtest output;
- **Per-hue calibration** (pink_fv / brown_f / yellow_fv), fancy-local carat slope on ladders, ceiling clamps, brown `none` policy.

---

## Table of Contents

1. [Current fancy pipeline](#1-current-fancy-pipeline)
2. [Error anatomy from backtests](#2-error-anatomy-from-backtests)
3. [Market evidence from fancy-color-diamond-pricing.md](#3-market-evidence-from-fancy-color-diamond-pricingmd)
4. [Data sparsity from listing-confidence-gaps](#4-data-sparsity-from-listing-confidence-gaps)
5. [Known failure modes and edge-case catalog](#5-known-failure-modes-and-edge-case-catalog)
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

### 2.4 Segment breakdown (LOO, May 2026 — `min-support=3`)

Headline (565 covered fancy holdouts):

| Slice | n | MdAPE | Bias | Notes |
|-------|--:|------:|-----:|-------|
| **All fancy** | 565 | 37.6% | +20.7% | Target ≤30% MdAPE |
| `best_available` | 435 | 42.2% | +26.0% | 77% of covered rows |
| `nearest` | 130 | 28.3% | +2.7% | Still not “solved” |
| `exact` | ~45 | ~3.5% | +8.7% | Rare; see §5.6 for fancy exact definition gap |

**By carat band** (overall backtest):

| Band | n | MdAPE | Bias |
|------|--:|------:|-----:|
| 1–2ct | 255 | 41.4% | +17.8% |
| **2–3ct** | 112 | **43.1%** | **+40.8%** |
| 3–5ct | 85 | 35.2% | +23.2% |
| 5ct+ | 111 | 29.4% | +5.2% |

Large stones look better on MdAPE partly because brown/champagne ladders (under-estimated) cluster at 5ct+.

**By hue × intensity** (same LOO protocol; reproduced via `fancy-backtest-breakdown.mjs`):

| Segment | n | MdAPE | Bias | Priority |
|---------|--:|------:|-----:|----------|
| **pink_fv** | 139 | **61.6%** | **+56.4%** | P0 within P1 |
| pink_f | 101 | 24.5% | +18.1% | Medium |
| pink_fi | 81 | 15.1% | +9.6% | Best pink slice |
| blue_f | 106 | 42.4% | +31.9% | Medium-high |
| blue_fi | 75 | 22.1% | +23.1% | Medium |
| **brown_f** | 55 | **66.4%** | **−66.0%** | Separate model branch |
| blue_fv / fl | ≤5 | — | — | Too few for stable metrics |

**By shape** (headline backtest):

| Shape | n | MdAPE | Bias |
|-------|--:|------:|-----:|
| pear / oval / radiant | 86–100 each | 42–44% | **+36% to +42%** |
| asscher | 43 | 62.5% | **−31.3%** |
| heart / emerald | 32–40 | 23–28% | +13% to +20% |
| square_cushion / cushion | 21–51 | 29–30% | ~+2% to +6% |

**Interpretation:** Global “fancy bias +20.7%” hides **pink_fv over-estimation** and **brown_f under-estimation**. Tuning one global upward cap fixes pink but worsens brown unless segments are split.

### 2.5 Worst-miss archetypes (from `--worst 5`)

| Archetype | Example | Primary comp | Dominant adjustment | Tags |
|-----------|---------|--------------|---------------------|------|
| **A — Vivid pink, large elongated** | 9.2ct oval FVP | 6ct cushion Fancy Pink | `intensity+carat ×2.05` (pink_fv vs pink_f) + shape | `pink_fv`, `best_available`, `intensity_upward_transfer`, `shape_transfer`, `large_carat` |
| **B — Intense blue step-up** | 1.75ct heart FIB | 2.19ct heart Fancy Blue | `intensity+carat ×1.40` (blue_fi vs blue_f) | `blue_fi`, `best_available`, `intensity_gap_1` |
| **C — Brown/champagne ladder** | 1.2–9.2ct asscher “Coffee” | Non-brown fancy comps | Model table + wrong hue pool | `brown_f`, `wrong_hue_pool`, `under_estimate` |
| **D — Pink cushion carat extrapolation** | 6ct cushion Fancy Pink | Lower-carat pink comps | Carat + intensity on sparse ladder | `nearest`, `carat_extrapolation`, `supplier_concentration` |
| **E — Fancy light pink under** | 1.5ct emerald FLP | Intense/vivid comps | Downward intensity transfer too aggressive | `pink_fl`, `best_available`, `intensity_downward_transfer` |

Archetypes A and B drive the **positive** headline bias; C drives **negative** tail on asscher; D/E are mixed-direction within pink.

### 2.6 Yellow segment and the `min-support` blind spot

With `min-support=3` (backtest default), **only one yellow row** qualifies in the 565 covered set (66.7% MdAPE, −66.7% bias). Messi’s yellow inventory is large in the merged pool, but sparse per-SKU support causes most yellow holdouts to be **dropped from metrics**, not scored as `none`.

Relaxing support (diagnostic only) shows a different story:

| Segment | n (diag.) | MdAPE | Bias |
|---------|----------:|------:|-----:|
| yellow_fv | 249 | **106.8%** | **+94.6%** |
| yellow_fi | 164 | 30.4% | +29.2% |

**Action:** Report fancy metrics **by hue** with explicit “excluded (low support)” counts. Do not ship yellow-vivid calibration from the 565-row headline alone. Recapture yellow princess / per-SKU ladders (`alibaba-listing-confidence-gaps.md` priority 5–6) before trusting yellow MdAPE.

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

### 3.4 Documented $/ct ceilings (clamp rails)

Use as **upper bounds** when model transfer overshoots verified direct listings:

| Grade | Size / shape | Ceiling $/ct | Source |
|-------|----------------|-------------:|--------|
| Fancy Vivid Pink | 2ct heart VVS2 | $370 | `fancy-color-diamond-pricing.md` |
| Fancy Intense Pink | ~1–1.5ct | $312–$344 | emerald / pear anchors |
| Fancy Intense Brownish Pink | 0.89ct radiant | $294 | T16 adjacent row |
| Fancy Pink 4ct cushion | anomalous max | $356 | treat as outlier ceiling |

Ceilings are **not** typical wholesale — they prevent archetype A misses above documented market maxima when comps are weaker intensity.

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

## 5. Known failure modes and edge-case catalog

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

### 5.5 `pink_f` comp → `pink_fv` query (dominant over-estimate)

When no vivid comp remains in the held-out pool, the engine scales a **Fancy Pink** cushion comp to a **Fancy Vivid Pink** pear/oval 8–10ct query:

```text
parts: intensity+carat ×2.02–2.06 (pink_fv vs pink_f), shape ×1.03–1.05
eColor = 0.500  (= 2 intensity levels × 0.25, no upward penalty)
```

At 1ct, table ratio `pink_fv.ws1 / pink_f.ws1 = 500/220 ≈ 2.27×` — close to observed ×2.05 adjustment. At 8–10ct the same relative jump is applied on top of carat extrapolation from a 6ct comp, producing **120%+ error** on held-out Messi pears/ovals.

**Fix class:** (1) asymmetric cap §7.2; (2) `fancyTransferSigma` upward penalty; (3) comp-median shrink §7.3; (4) optional **per-hue** cap: `pink_f → pink_fv` max log delta 0.35 unless `cRank >= fi`.

### 5.6 Fancy `isExactMatch` is intensity-blind

```724:725:research/comp-engine-v3.js
  // Fancy: hue already matched above; same-shape/same-clarity/near-carat is exact.
  return true;
```

Two stones with the same shape, clarity, carat, and hue family but **different intensity** (e.g. Fancy Pink vs Fancy Vivid Pink) are treated as exact observations. That can:

- Skip blend warnings meant for transfers;
- Use exact-path intervals (`±13%`) instead of model-adjusted bands;
- Under-report transfer risk in the UI.

**Fix class:** Require `parseFancyColorLabel(query.colorFamily_key).intensityKey === parseFancyColorLabel(row.color).intensityKey` for fancy exact (modifiers may still differ with σ penalty).

### 5.7 Brown / champagne / coffee — wrong comp pool

Held-out rows labeled `Fancy Brown / Coffee` map to `brown_f` (`ws1: 60`). When Messi is held out, remaining comps are often **pink or yellow**, not brown. The engine still adjusts via `FANCY_COLOR_BASE` cross-family keys that share no wholesale ladder, producing **−60% to −70%** systematic under-estimation across 55 asscher rows (see §2.4).

**Fix class:**

- Hard gate: **do not use non-brown comps** for `brown_f` / `black` queries (return `none` or wide interval).
- Do not fold brown into pink transfer paths.
- Capture dedicated brown/champagne IGI ladders before bias correction.

### 5.8 `FANCY_LABEL_MAP` modifier inconsistency

```147:148:research/comp-engine-v3.js
  'fancy intense brownish pink': 'pink_fi',
  'brownish pink': 'pink_f',
```

Same modifier family maps to **different base keys** depending on phrase order. `inferFancyFamilyKey` prefers the map before parsed intensity, so brownish can land on `pink_f` (lower `ws1`) while still receiving a −18% modifier adjustment — inconsistent with intense brownish market positioning (`fancy-color-diamond-pricing.md`: brownish intense ≈ $294/ct vs pure intense $310–340/ct).

**Fix class:** `marketFamilyKey` = hue + intensity without modifiers; `modifierTerms[]` applied only via `MODIFIER_LOG_DELTA`; remove brownish entries from `FANCY_LABEL_MAP` remapping.

### 5.9 Modifier scoring uses term *count*, not term *identity*

```760:761:research/comp-engine-v3.js
    const modifierDiff = Math.abs(compParsed.modifierTerms.length - userParsed.modifierTerms.length);
    eColor = intensityGap * ... + modifierDiff * AXIS_SIGMA.fancyModifierPerTerm;
```

A comp with `brownish` vs a clean vivid query gets `modifierDiff = 1` (+0.12 σ) whether or not the modifier is economically material. A comp with `greyish green` on a green query may get **zero** modifier penalty if both sides parse one modifier term.

**Fix class:** Sum `TRANSFER_SIGMA.modifier[m]` for every modifier present on comp but not on query (and vice versa for downward adjustment), not `|len(comp) − len(query)|`.

### 5.10 Deep / Dark / Faint not in `INTENSITY_RANK`

`INTENSITY_RANK = { fl, f, fi, fv }` only. IGI grades **Fancy Deep** and **Fancy Dark** parse as `f` (no token match). **Faint / Very Light** may parse as `f` or mis-rank vs `fl`. Any comp using these grades transfers as “base fancy” with wrong σ and wrong `FANCY_COLOR_BASE` row.

**Fix class (P2 schema):** Normalize at index time; until then, treat unknown intensity as explicit `intensityKey: 'unknown'` with high σ and no upward transfer.

### 5.11 `yellow_fi.scale = 1.00` and vivid yellow table skew

```101:102:research/comp-engine-v3.js
  yellow_fi: { ws1: 255, scale: 1.00, label: 'Fancy Intense Yellow' },
  yellow_fv: { ws1: 375, scale: 0.87, label: 'Fancy Vivid Yellow' },
```

Diagnostic LOO (low `min-support`) shows **yellow_fv** as the worst hue×intensity cell (MdAPE 106.8%, bias +94.6%). Yellow is cheap in wholesale ($105–$230/ct anchors in `fancy-color-diamond-pricing.md`) but the vivid table may still be high vs Alibaba when comps are **`yellow_f` / `yellow_fi`** transferred upward.

**Fix class:** Hue-specific calibration pass for yellow; consider capping `yellow_* → yellow_fv` separately from pink; exclude flat-price yellow princess SKUs at index time (`flat_fancy` in P1b).

### 5.12 Clarity still moves fancy point estimates

`CLARITY_MULT_COLOR` and clarity steps apply even though market docs say clarity matters less. For **pink heart ladder** rows with flat VS1/VS2 pricing (`alibaba-listing-confidence-gaps.md`), clarity adjustment invents spread that does not exist in the source.

**Fix class:** When `clarityBand` or heart-ladder flat-clarity flag is set on comps, zero out `deltaClarity` and `eClarity` for fancy.

### 5.13 Carat threshold warnings without fancy premium model

`nearCaratThreshold()` fires for 0.5 / 1.5 / 2 / 3 / 5ct on fancy queries (e.g. pink cushion 5ct+ misses) but no **fancy-specific threshold premium** is applied — only a warning. White-local slope is disabled for fancy (§7.6).

### 5.14 Specialty shapes + broadening → forced `none`

```1309:1311:research/comp-engine-v3.js
  if (SPECIALTY_SHAPE_KEYS.has(query.shape) && broadened) {
    matchType = 'none';
  }
```

Correct for trilliant / portuguese, but many fancy queries are on standard shapes that **broaden** to cross-shape comps first, then over-adjust. Specialty handling should not mask that the main volume is pear/oval/radiant cross-shape pink.

### 5.15 T16 regression status (May 2026)

Full-pool T16 check **passes** brownish-primary guard and estimate band, but:

- `matchType: nearest` (not exact) — 4.05ct FVP radiant primary;
- Source concentration: Messi 95% raw weight, capped to 65%;
- Estimate ~$1,594 vs case-study band — acceptable but still model-heavy.

T16 proves the **worst brownish primary** is avoided; it does **not** prove vivid pink accuracy at 3.8ct is tight.

### 5.16 Interaction with P1b (source row quality)

| Issue | Fancy impact | P1b lever |
|-------|--------------|-----------|
| Flat-price yellow princess | False yellow comps | `flat_fancy` reject at index |
| Pink heart VS1/VS2 same price | Clarity adjustment noise | `clarity_unpriced` flag |
| `caratBand` rows | False carat precision | `carat_band` σ + no exact |
| Single-product pink multi-shape | Shape transfer + concentration | `sourceRowType`, independence weight |
| Corroboration PID confidence inflation | Over-tight σ on weak rows | Decouple corroboration from `confidence` |

Implement P1 transfer fixes **together with** P1b row typing so sparse/false comps are not “fixed” only by wider σ.

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

Fit buckets with **minimum n ≥ 15** per cell; ridge-shrink toward 0; never apply correction when `matchType === 'exact'`.

### 7.6 Fancy-local carat slope (pink / yellow ladders)

White diamonds use `fitLocalCaratSlope` on same-shape, non-band comps. Fancy disables this entirely:

```1223:1226:research/comp-engine-v3.js
  // Only for white diamonds right now; fancy uses the model-based scale param.
  const localCaratCurve = nq.colorFamily === 'white'
    ? fitLocalCaratSlope(candidates, nq, /* prior */ 0.8)
    : null;
```

Products with **A-tier** pink ladders (vivid heart 1–4ct, pink cushion 0.5–6ct) should prefer ladder slope over `FANCY_COLOR_BASE.scale` when:

- `sourceCount ≥ 2` and carat span ≥ 1.0ct within same `colorFamily_key` + shape family;
- `fitLocalCaratSlope` prior **0.5** for fancy (flatter $/ct than white per `fancy-color-diamond-pricing.md` large-stone discounts).

Blend: `logDpc += α * deltaLocalCarat + (1−α) * deltaModelIntensityCarat` with `α = 0.6` when local curve confidence is high.

### 7.7 Ceiling-aware transfer caps (documented max $/ct)

`fancy-color-diamond-pricing.md` documents **hard ceilings** (e.g. 2ct vivid pink heart $370/ct, intense pink ~$312–344/ct). After comp adjustment, clamp implied `$/ct` to `min(ceiling(hue, intensity, caratBand), ceiling * 1.08)` when no exact vivid comp is in the ensemble.

Use ceilings as **safety rails**, not typical price — log a warning `ceiling_clamp_applied`.

### 7.8 Hue-split bias correction and brown `none` policy

`FANCY_BIAS_CORRECTION_LOG` keys should be **`hue|intensity|matchType`**, not global fancy:

```javascript
// Examples — fit offline, ridge-shrink
'pink|fv|best_available': Math.log(0.78),
'blue|f|best_available':  Math.log(0.85),
'brown|f|*': null,  // do not correct — return none until brown comps exist
```

For `brown_f` / `black`: if no same-hue comp in pool, return `matchType: 'none'` with explanation — **do not borrow pink/yellow**.

### 7.9 `marketFamilyKey` vs `query.colorFamily_key`

Split parsing outputs:

| Field | Purpose |
|-------|---------|
| `colorFamily_key` | Query input (e.g. `pink_fv`) |
| `marketFamilyKey` | `FANCY_COLOR_BASE` lookup — modifiers stripped |
| `intensityRank` / `modifierTerms[]` | Gates + σ + `MODIFIER_LOG_DELTA` |

Prevents `FANCY_LABEL_MAP` from downgrading brownish intense pink to `pink_f` for table lookup while applying a partial modifier discount.

### 7.10 Match-type-specific shrink α

Extend §7.3:

| matchType | α toward model (max) | Rationale |
|-----------|----------------------|-----------|
| `exact` | 0.0 | Use comp price |
| `nearest` | 0.35 | Light transfer |
| `best_available` | 0.55–0.75 | Model-heavy today — shrink harder |

When `bestScore > 0.45`, cap α at 0.40 even if `best_available`.

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

**Global:**

| Metric | Baseline | Target |
|--------|----------|--------|
| Fancy MdAPE | 37.6% | **≤ 32%** (stretch ≤ 30%) |
| Fancy bias | +20.7% | **+5% to +10%** (abs mean bias, not signed — see below) |
| Fancy P80 | 78.6% | **≥ 75%** |
| best_available MdAPE | ~42% | **≤ 36%** |

**Per-hue (must not regress):**

| Segment | Baseline MdAPE | Baseline bias | Target MdAPE | Target bias |
|---------|---------------:|--------------:|-------------:|------------:|
| pink_fv | 61.6% | +56.4% | **≤ 45%** | **+10% to +20%** |
| pink_fi | 15.1% | +9.6% | ≤ 18% | ±8% |
| blue_f | 42.4% | +31.9% | ≤ 35% | +5% to +15% |
| brown_f | 66.4% | −66.0% | n/a until comps | **`none` or wide band** |
| yellow_fv | (n≈1 in strict LOO) | — | recapture first | — |

**Signed bias guardrail:** After fixes, **no hue** with n ≥ 30 should have |bias| > 25% unless `matchType` is predominantly `none`.

### 9.4 Reporting additions

Extend backtest output:

```bash
node research/scripts/backtest-comp-engine.mjs --segment fancy --worst 20
node research/scripts/fancy-backtest-breakdown.mjs   # hue × intensity table
# PROPOSED:
node research/scripts/backtest-comp-engine.mjs --segment fancy --attribute-errors --export-csv research/data/fancy-backtest-attributed.csv
```

CSV columns: `hue`, `intensity`, `shape`, `caratBand`, `matchType`, `signedPct`, `tags[]`, `primaryCompColor`, `maxIntensityGap`, `upwardTransfer`, `ceilingClamp`, `brownPoolPollution`.

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
| T20 | 8ct oval `pink_fv`, pool has only `pink_f` cushion | `intensity+carat` ≤ ×1.45; MdAPE vs uncapped baseline improves |
| T21 | 1.5ct asscher `brown_f`, pool has no brown | `matchType: none`, not pink comp |
| T22 | Fancy Pink vs Fancy Vivid Pink same carat/shape | **not** `isExactMatch` |
| T23 | `yellow_fv` 2ct oval, `yellow_fi` comp only | Hue-specific cap; implied $/ct below documented ceiling |
| T24 | pink cushion 6ct holdout (messi) | Under-estimate reduced vs baseline −55% miss |
| T25 | brownish pink label variants | Same `marketFamilyKey` + modifier delta regardless of map phrase |

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

6. **Brown `none` stops wrong-direction bias:** Removing asscher brown misses from forced pink transfer improves **signed** bias more than MdAPE alone suggests.

---

## 12. Risks

| Risk | Mitigation |
|------|------------|
| Over-penalize → `none` too often | Soft penalties first; hard gate only gap ≥ 3; brown is exception (prefer `none`) |
| Bias correction overfits LOO | Ridge shrink; minimum cell count ≥ 15; hue×intensity buckets |
| Caps hide true vivid premium | Disable caps when exact same-intensity comp exists; ceiling only when `best_available` |
| Tables drift from index.html | P0 parity on fancy queries |
| Global cap fixes pink, breaks brown | Hue-split caps + brown pool gate §7.8 |
| Yellow metrics invisible in strict LOO | Report support-excluded counts; do not claim yellow fixed until recapture |
| Fancy local slope overfits one supplier | Require `sourceCount ≥ 2`; shrink toward `scale` prior |
| T16 passes while large FVP still fails | Add T20 + worst-miss archetype A to release checklist |

---

## 13. Implementation phases

### Phase 0 — Instrumentation (0.5 day)

- Land `fancy-backtest-breakdown.mjs` in CI optional step
- Add `--attribute-errors` stub + worst-miss tags (no model change)

### Phase 1 — Transfer sigma + hard gates (2 days)

- `fancyTransferSigma`, `fancyTransferAllowed`
- `marketFamilyKey` split; fix `FANCY_LABEL_MAP` brownish paths
- Fancy `isExactMatch` requires intensity match
- Tests T16–T19, T21–T22

### Phase 2 — Adjustment caps + comp shrink (1 day)

- Asymmetric caps (+45% / −30%) with hue override for `pink_fv`
- Match-type-specific shrink §7.10
- Tests T20, T18

### Phase 3 — Fancy local slope + ceilings (1 day)

- `fitLocalCaratSlope` for fancy ladders (pink cushion / vivid heart)
- Ceiling clamp §7.7
- Test T24

### Phase 4 — Bias calibration table (1 day)

- Offline fit script → `research/data/fancy-bias-corrections.json`
- Hue×intensity×matchType buckets; skip brown until data exists

### Phase 5 — Backtest attribution export (0.5 day)

- `--export-csv` with tags from §8.3
- Manual review checklist tied to archetypes §2.5

**Out of scope for P1 (but blocked on accuracy):** yellow princess recapture, orange/purple rows, P2 normalized intensity for Deep/Dark.

---

## Definition of done (P1 fancy)

- [ ] Global fancy MdAPE ≤ 32% and |mean bias| ≤ 12% on covered rows (565 strict LOO)
- [ ] `pink_fv` MdAPE ≤ 45% and bias ≤ +20% (n ≥ 130)
- [ ] `brown_f` returns `none` or wide band without pink/yellow borrowing — no −50% asscher tail
- [ ] Cross-intensity / cross-shape show higher σ and visible warnings
- [ ] Brownish→vivid and light→vivid rejected or heavily discounted
- [ ] Worst-miss export tags map to archetypes A–E
- [ ] T16, T20–T22 regression-tested; T16 documented as nearest-not-exact
- [ ] `fancy-backtest-breakdown.mjs` reproduced in PR test notes
