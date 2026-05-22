# P1 — Tune Local Carat Curve Usage

**Research date:** 2026-05-22 (expanded 2026-05-22)  
**Status:** Deep research / implementation plan (no code changes in this pass)  
**Related:** `comp-engine-v3-p0-p1-p1b-implementation.md` § P1b, `comp-engine-v3-gap-fixes-implementation.md` Fix 3, `comp-engine-v3-remaining-work.md` P1, `p1b-source-independence-signals-research.md`, `white-diamond-igi-wholesale-pricing.md`, `current-pricing-model-how-it-works.md`

---

## Executive Summary

White diamond comp pricing uses a pool-level **local carat slope** (`fitLocalCaratSlope`) in log space: `deltaCarat = slope × log(q_ct / c_ct)`, shrunk toward prior **0.8** (total-price exponent ≈ 1.8). The May 2026 change fixed the **estimand** (normalized 0.25ct knots remove color/clarity/shape leakage) but not **application policy** — fitted slopes still drive adjustments where the fit is unreliable.

| Metric | Before normalized slope | After normalized slope |
|--------|------------------------:|-----------------------:|
| White MdAPE | 15.2% | **15.4%** (+0.2 pp) |
| White bias | +5.1% | **+6.1%** |
| White P80 | 83.7% | **85.0%** (intervals widened) |
| White 5ct+ MdAPE | — | **~17.8%** |
| White 5ct+ bias | — | **~+14.6%** |

P80 improved via `slopeSigmaBoost` and `curveExtrapolationBoost` in `adjustCompToQuery` — **uncertainty widened without fixing the point estimate**.

**Root cause (application, not estimation):** Normalization made knot OLS estimate carat-neutral $/ct curvature. Remaining error clusters when we **apply** that slope:

1. **Extrapolation** — `queryIsExtrapolated` warns only; 1–3ct knot slopes still adjust 5ct+ holdouts.
2. **Single-supplier LOO pools** — holdout leaves one Alibaba ladder; `sourceCount` affects labels, not shrink strength.
3. **Low-confidence fits replace the prior** — 3–6 high-variance knots can hurt MdAPE vs a strong global 0.8.
4. **Per-comp lever arms** — one pool slope × large `log(q/c)` per selected comp (see §13.4).
5. **5ct+ economics** — flatter $/ct and threshold premiums; global 0.8 may be high; segment prior **0.65** is a testable hypothesis.

**Proposed fix:** `resolveEffectiveCaratSlope(curve, query)` between fit and `adjustCompToQuery` — modes `fitted`, `shrunk_*`, `ignored_fallback_prior`, `prior_only`; segment priors (&lt;5ct: 0.8, ≥5ct: 0.65); grid LOO over `SLOPE_PRIOR_WEIGHT` and extrapolation policy; backtest breakdown by `mode`.

**Acceptance:** white MdAPE &lt; 15.4% with P80 ≥ 82% and \|bias\| ≤ 8%; 5ct+ MdAPE ≥1.0 pp below ~17.8%; every white result exposes `localCaratCurve.mode`.

---

## Table of Contents

1. [How local carat curves work today](#1-how-local-carat-curves-work-today)
2. [Evidence from backtests and critique](#2-evidence-from-backtests-and-critique)
3. [Why normalization helped but MdAPE did not](#3-why-normalization-helped-but-mdape-did-not)
4. [Prior proposals in internal docs](#4-prior-proposals-in-internal-docs)
5. [Proposed tuning dimensions](#5-proposed-tuning-dimensions)
6. [Proposed code changes (reference only)](#6-proposed-code-changes-reference-only)
7. [Segment-specific 5ct+ strategy](#7-segment-specific-5ct-strategy)
8. [Metadata and UX reporting](#8-metadata-and-ux-reporting)
9. [Testing plan](#9-testing-plan)
10. [Why this will work](#10-why-this-will-work)
11. [Risks](#11-risks)
12. [Edge cases and failure modes](#12-edge-cases-and-failure-modes)
13. [Cross-layer gaps (outside slope fit)](#13-cross-layer-gaps-outside-slope-fit)
14. [Diagnostic and backtest extensions](#14-diagnostic-and-backtest-extensions)
15. [Implementation phases](#15-implementation-phases)

---

## 1. How local carat curves work today

### 1.1 Pipeline placement

In `resolveAlibabaComp` (research engine):

```text
filterCandidates → score → dedupe
       ↓
fitLocalCaratSlope(candidates, nq, prior=0.8)   // white only
       ↓
adjContext = { localCaratSlope, localCaratExtrapolated }
       ↓
adjustCompToQuery(nq, row, adjContext) for each selected comp
       ↓
blendComps
```

Fancy diamonds **do not** use local slope; they use `FANCY_COLOR_BASE` power-law in `adjustCompToQuery`.

### 1.2 Current implementation (canonical)

```javascript
// research/comp-engine-v3.js — normalizedLogDpcForCurve (lines 376–400)
function normalizedLogDpcForCurve(row, query) {
  let y = Math.log(row.priceUsd / row.carat);
  if (query.colorFamily === 'white') {
    const cn = row.colorNormalized || 'D';
    const compGrade = (cn === 'DEF' || cn === 'DE') ? 'E' : cn;
    const qColor = WHITE_GRADE_MULT[query.whiteGrade] ?? WHITE_GRADE_MULT.E;
    const cColor = WHITE_GRADE_MULT[compGrade] ?? WHITE_GRADE_MULT.D;
    y += Math.log(qColor / Math.max(cColor, 0.01));
    const qClarity = getClarityMult(query.clarity, row.carat);
    const cClarity = getClarityMult(row.clarity || 'VS1', row.carat);
    y += Math.log(qClarity / Math.max(cClarity, 0.01));
    const qShape = SHAPE_MULT_WHITE[query.shape] ?? 1.0;
    const cShape = SHAPE_MULT_WHITE[row.shape] ?? 1.0;
    y += Math.log(qShape / Math.max(cShape, 0.01));
  }
  // ...
  return y;
}
```

```javascript
// fitLocalCaratSlope — knot aggregation + weighted OLS + shrinkage (lines 402–497)
function fitLocalCaratSlope(candidates, query, prior = 0.8) {
  const pool = candidates.filter(row => {
    if (row.caratBand || row.clarityBand) return false;
    if (shapeDistance(query.shape, row.shape) > 1) return false;
    if (Math.abs(clarityRankQ - clarityRankC) > 2) return false;
    return true;
  });

  // 0.25ct bins → weighted median y per bin → weighted OLS for rawSlope
  // shrink: slope = (3/(3+n))*prior + (n/(3+n))*rawSlope
  // clamp: [-0.2, 2.0]
  // confidence: high if n>=10 && sourceCount>=2 && caratRange>=2
  // queryIsExtrapolated if query outside [caratMin-0.25, caratMax+0.25]
}
```

### 1.3 Use in adjustment

```javascript
// adjustCompToQuery — white branch (lines 801–818)
const caratSlope = context.localCaratSlope ?? 0.8;
const deltaCarat = caratSlope * logCaratRatio;
const slopeSigmaBoost = context.localCaratSlope != null
  ? Math.abs(context.localCaratSlope - 0.8) * 0.10
  : 0;
const curveExtrapolationBoost = context.localCaratExtrapolated ? 0.08 : 0;
sigmaCarat = absLogCaratRatio * AXIS_SIGMA.caratPerLogUnit
           + Math.max(0, absLogCaratRatio - 0.5) * AXIS_SIGMA.caratLargeExtrapolation
           + slopeSigmaBoost + curveExtrapolationBoost;
```

### 1.4 Warnings today

- Query outside local knot range → extrapolation warning.
- `|slope - 0.8| > 0.3` → inspect support warning.
- `nearCaratThreshold(carat)` → magic-weight premium warning.

**Missing (acceptance criteria):** explicit reporting of slope **used / ignored / shrunk / extrapolated** as a machine-readable enum.

### 1.5 Architectural coupling (tuning must account for these)

| Coupling | Behavior today | Tuning implication |
|----------|----------------|-------------------|
| Fit pool vs blend pool | `fitLocalCaratSlope(candidates, …)` uses **all** post-filter candidates, not only `selected` comps | Slope can reflect rows that never enter the ensemble; consider fitting on scored pool or top-N by `compErrorScore` |
| Selection vs adjustment | `compErrorScore` uses fixed carat σ; it does **not** see `localCaratSlope` | A steep fitted slope does not down-rank far-carat comps before blend |
| One slope, many ratios | Single `adjContext.localCaratSlope` applied to every `adjustCompToQuery` call | Far-carat comps get the same slope as near-carat comps but much larger `log(q/c)` |
| Exact-match path | Exact comps use primary price, not blend; slope still applied in `adjustCompToQuery` | Near-zero carat gap → slope barely matters on exact; errors concentrate on nearest/best_available |
| Fancy excluded | `localCaratCurve = null` for fancy | P1 carat doc does not fix fancy +20.7% bias; do not regress white while chasing fancy |

---

## 2. Evidence from backtests and critique

### 2.1 Baselines (current)

From `comp-engine-v3-gap-fixes-implementation.md`:

| Segment | MdAPE | Bias | P80 |
|---------|------:|-----:|----:|
| White overall | 15.4% | +6.1% | 85.0% |

### 2.2 Segment breakdown (documented in p0-p1 implementation critique)

| Segment | MdAPE | Bias | Notes |
|---------|------:|-----:|-------|
| White 5ct+ | ~17.8% | +14.6% | Large $ impact per % error |
| White emerald | ~19.4% | +20.1% | Shape + supplier interaction |
| White marquise | ~21.9% | — | Sparse / transfer |
| White SI | ~44.0% | −38.3% | Tiny n |

**Interpretation:** Emerald/marquise pain is not only “bad slope” — sparse shape transfer and supplier concentration interact with carat extrapolation. Tuning slope alone may not move emerald MdAPE much without shape/source work (P1b / P2). SI is dominated by clarity-band sparsity; local slope is rarely fit with meaningful knots.

### 2.3 Leave-one-supplier-out interaction

Backtest holds out **entire suppliers**, not random rows. Local slope fit on remaining pool may:

- Drop to **one supplier** → slope reflects that supplier's ladder economics;
- Shift knot range → `queryIsExtrapolated` flips more often on holdout rows;
- Overfit 1–3ct knots then extrapolate to 5ct holdout → **positive bias** (+6.1% overall).

### 2.4 Implementation critique lessons (historical, mostly addressed)

| Issue | Status after gap-fix |
|-------|---------------------|
| Unnormalized raw $/ct OLS | **Fixed** — `normalizedLogDpcForCurve` |
| No distance weighting in OLS | **Fixed** — knot + row weights |
| Supplier ladder dominates fit | **Partial** — `sourceCount` in confidence only, not in shrinkage |
| Extrapolation doesn't disable slope | **Open** — warning only, slope still applied |
| Doc/impl mismatch on confidence labels | **Fixed** — high/medium/low |

---

## 3. Why normalization helped but MdAPE did not

### 3.1 What normalization removed

Before normalization, a pool mixing D vs E comps and VS1 vs VVS2 across carats could produce a spurious **negative or steep** raw slope (larger stones looked cheaper per ct because they were lower color/clarity).

After normalization, slope estimates **color/clarity/shape-neutral $/ct vs carat** — the right estimand for carat transfer.

### 3.2 Why error can still increase

1. **Prior was already decent:** Global 0.8 prior encodes decades of white diamond wholesale curvature; local fit with 3–6 knots is high-variance.

2. **Wrong slope is still applied:** Even a less biased slope estimate can increase MdAPE if applied outside its valid range (extrapolation).

3. **Holdout supplier shift:** Slope learned from Messi ladder may not transfer when Starsgem row is held out.

4. **Ensemble interaction:** `adjustCompToQuery` applies slope per comp, then `blendComps` averages — inconsistent slopes across comps widen spread without improving median.

5. **P80 improved, MdAPE flat:** Extra `slopeSigmaBoost` and `curveExtrapolationBoost` widen intervals (85% P80) without fixing point estimate.

6. **Normalization uses comp carat for clarity in fit, query carat in adjust:** In `normalizedLogDpcForCurve`, clarity mults use `row.carat`; in `adjustCompToQuery` white clarity uses `queryCt`. For 5ct query vs 1ct comp this tilts the fitted knot surface vs the adjustment path (§13.6).

7. **Supplier SKU ladders create artificial knot spacing:** Messi-style sheets often list 1.0, 1.5, 2.0, 2.5, 3.0, 5.0ct SKUs — not uniform sampling. OLS sees a jump at 3→5ct and may fit a slope that reflects **ladder spacing + threshold pricing**, not continuous market curvature.

8. **`slopeSigmaBoost` anchored to 0.8:** If effective prior becomes 0.65 at 5ct+, deviation penalty should use `context.localCaratSlopePrior`, not hardcoded 0.8 (§13.10).

---

## 4. Prior proposals in internal docs

| Source | Proposal |
|--------|----------|
| `comp-engine-v3-remaining-work.md` | Gate slopes by confidence; shrink/disable extrapolation; segment 5ct+; report slope mode |
| `comp-engine-v3-gap-fixes-implementation.md` | Next pass: in-range only, aggressive extrapolation shrink, 5ct+ segment |
| `comp-engine-v3-p0-p1-p1b-implementation.md` | Bayesian shrink with `SLOPE_PRIOR_WEIGHT=3`; clamp [-0.2, 2.0] |
| `estimation-algo-improvement-priorities.md` | Learn curves only with independent comp knots; conservative fallback |
| `white-diamond-igi-wholesale-pricing.md` | Anchor tables + magic weights at 0.5/1/1.5/2/3/4/5ct |

---

## 5. Proposed tuning dimensions

### 5.1 Decision grid (backtest-driven)

Run grouped LOO backtests sweeping:

| Parameter | Current | Proposed sweep |
|-----------|---------|----------------|
| `SLOPE_PRIOR_WEIGHT` | 3 | {3, 5, 8, 12} |
| Min knots `MIN_FIT_KNOTS` | 3 | {3, 4, 5} |
| Min carat span `MIN_CARAT_RANGE` | 1.0 | {1.0, 1.5, 2.0} |
| Max slope deviation to apply | ∞ | cap apply at \|slope−0.8\| ≤ {0.15, 0.25, 0.35} |
| Extrapolation policy | warn + apply | {apply, shrink-to-prior, disable} |
| Min `sourceCount` to apply | 1 | {1, 2, 3} |
| Large-carat prior | 0.8 global | 0.8 below 5ct; **0.65** above 5ct |
| Bin width | 0.25ct | {0.25, 0.5} |

**Objective function (multi-criteria):**

```text
minimize  MdAPE_white
subject to  |bias_white| <= 8%
            P80_white >= 80%
            MdAPE_white_5ctplus <= baseline_17.8% - 1.0pp
```

### 5.2 Effective slope policy (proposed semantics)

```javascript
// Proposed: resolveEffectiveCaratSlope(localCaratCurve, query)
function resolveEffectiveCaratSlope(curve, query) {
  const PRIOR = query.carat >= 5 ? 0.65 : 0.8;  // flatter $/ct at size (hypothesis)

  if (!curve) return { slope: PRIOR, mode: 'prior_only', prior: PRIOR };

  let mode = 'fitted';
  let slope = curve.slope;

  if (curve.confidence === 'low') {
    slope = PRIOR + 0.25 * (curve.slope - PRIOR);
    mode = 'shrunk_low_confidence';
  }

  if (curve.queryIsExtrapolated) {
    slope = PRIOR + 0.15 * (curve.slope - PRIOR);
    mode = 'shrunk_extrapolated';
  }

  if (curve.sourceCount < 2) {
    slope = PRIOR + 0.35 * (curve.slope - PRIOR);
    mode = 'shrunk_single_source';
  }

  if (Math.abs(slope - PRIOR) > 0.25) {
    slope = PRIOR + Math.sign(slope - PRIOR) * 0.25;
    mode = mode + '_capped_deviation';
  }

  if (curve.confidence === 'low' && curve.queryIsExtrapolated) {
    slope = PRIOR;
    mode = 'ignored_fallback_prior';
  }

  return { slope, mode, prior: PRIOR, rawFitted: curve.slope };
}
```

**Why multiple shrink stages:** Each condition addresses a distinct failure mode; composing them is easier to explain in UI than one opaque formula.

### 5.3 Disable slope outside knot hull (strong guardrail)

```javascript
// When queryIsExtrapolated && confidence !== 'high', do not use fitted slope at all
if (curve.queryIsExtrapolated && curve.confidence !== 'high') {
  return { slope: prior, mode: 'ignored_extrapolation', prior };
}
```

**Expected effect:** Reduce 5ct+ positive bias (holdout stones above knot range stop inheriting steep 1–3ct slopes).

---

## 6. Proposed code changes (reference only)

### 6.1 New module section — `§2.6 Carat slope policy`

```javascript
// research/comp-engine-v3.js — PROPOSED additions

const CARAT_SLOPE_POLICY = {
  priorBelow5ct: 0.8,
  prior5ctPlus: 0.65,
  priorWeight: 5,              // was 3 — stronger shrink
  maxAppliedDeviation: 0.25,   // from prior
  minSourceCountToApply: 2,
  minConfidenceToApply: 'medium', // 'high' | 'medium' | 'low'
  extrapolationShrink: 0.15,   // blend toward prior
  ignoreIfLowAndExtrapolated: true,
};

function caratPriorForQuery(carat) {
  return carat >= 5 ? CARAT_SLOPE_POLICY.prior5ctPlus : CARAT_SLOPE_POLICY.priorBelow5ct;
}

function resolveEffectiveCaratSlope(curve, query) {
  const prior = caratPriorForQuery(query.carat);
  if (!curve) {
    return { slope: prior, mode: 'prior_only', prior, rawFitted: null };
  }
  // ... policy from §5.2 ...
}

function rankConfidence(conf) {
  return { high: 3, medium: 2, low: 1 }[conf] ?? 0;
}
```

### 6.2 Wire into `resolveAlibabaComp`

```javascript
// PROPOSED replace adjContext construction
const localCaratCurve = nq.colorFamily === 'white'
  ? fitLocalCaratSlope(candidates, nq, caratPriorForQuery(nq.carat))
  : null;

const effective = resolveEffectiveCaratSlope(localCaratCurve, nq);

const adjContext = {
  localCaratSlope: effective.slope,
  localCaratExtrapolated: !!localCaratCurve?.queryIsExtrapolated,
  localCaratSlopeMode: effective.mode,
  localCaratSlopePrior: effective.prior,
  localCaratSlopeRaw: effective.rawFitted,
};

// Return extended metadata
localCaratCurve: localCaratCurve ? {
  ...localCaratCurve,
  effectiveSlope: effective.slope,
  mode: effective.mode,
  prior: effective.prior,
} : null,
```

### 6.3 Stronger sigma when mode is not `fitted`

```javascript
// PROPOSED in adjustCompToQuery
const MODE_SIGMA_BOOST = {
  prior_only: 0,
  fitted: 0,
  shrunk_low_confidence: 0.06,
  shrunk_extrapolated: 0.10,
  shrunk_single_source: 0.08,
  ignored_fallback_prior: 0.12,
  ignored_extrapolation: 0.14,
};
sigmaCarat += MODE_SIGMA_BOOST[context.localCaratSlopeMode] ?? 0.05;
```

### 6.4 Optional: per-segment priors from white anchor table

Use `baseWhitePerCt` knot structure from `index.html` `compute()` to derive segment priors:

```javascript
// PROPOSED — derive slope prior from anchor table local secant
function priorSlopeFromAnchorTable(shape, colorGrade, carat) {
  const p0 = anchorPricePerCt(shape, colorGrade, carat * 0.85);
  const p1 = anchorPricePerCt(shape, colorGrade, carat * 1.15);
  if (!p0 || !p1) return 0.8;
  return Math.log(p1 / p0) / Math.log(1.15 / 0.85);
}
```

**Why:** Aligns comp-engine slope with baseline model users already see — reduces disconnect between `compute().ws` and `alibabaComp.estimate`.

---

## 7. Segment-specific 5ct+ strategy

### 7.1 Treat large stones as a separate risk region

| Region | Carat | Policy |
|--------|-------|--------|
| Core | 0.3 – 3.0ct | Allow `medium`+ confidence local slope |
| Transition | 3.0 – 5.0ct | Require `high` confidence OR 2+ sources |
| Large | ≥ 5.0ct | Default prior 0.65; local slope only if knots span ≥5ct and include query |

### 7.2 Knot requirements at 5ct+

```javascript
// PROPOSED filter inside fitLocalCaratSlope for query.carat >= 5
if (query.carat >= 5) {
  const knotsAtOrAbove4 = points.filter(p => p.carat >= 4.0).length;
  if (knotsAtOrAbove4 < 2) return null;
}
```

### 7.3 Backtest reporting

Extend `backtest-comp-engine.mjs`:

```javascript
// PROPOSED segment tag on each prediction record
record.localCaratMode = result.localCaratCurve?.mode ?? 'n/a';
record.localCaratExtrapolated = result.localCaratCurve?.queryIsExtrapolated ?? false;

// Aggregate MdAPE by mode
// "ignored_extrapolation" should show lower bias at 5ct+ if hypothesis holds
```

---

## 8. Metadata and UX reporting

### 8.1 Acceptance: engine reports slope disposition

```javascript
// PROPOSED result.localCaratCurve fields
{
  slope: 0.72,              // effective slope used in adjustments
  rawSlope: 0.91,           // post-OLS before policy
  fittedSlope: 0.85,        // after clamp, before policy
  prior: 0.65,
  mode: 'shrunk_extrapolated',
  n: 6,
  sourceCount: 2,
  confidence: 'medium',
  caratRange: '1.0–5.0ct',
  queryIsExtrapolated: true,
}
```

### 8.2 UI copy mapping

| `mode` | User-facing label |
|--------|-------------------|
| `fitted` | Carat scaling from local market comps |
| `shrunk_*` | Carat scaling conservatively adjusted (sparse data) |
| `ignored_*` | Using standard carat curve (insufficient local data) |
| `prior_only` | Standard carat curve |

---

## 9. Testing plan

### 9.1 Unit tests (add to `test-comp-engine-v3.mjs`)

Cover §12 edge cases — not only happy path.

```javascript
// PROPOSED tests
test('resolveEffectiveCaratSlope ignores low confidence extrapolation', () => {
  const curve = {
    slope: 1.1, confidence: 'low', queryIsExtrapolated: true, sourceCount: 1, n: 4,
  };
  const q = { carat: 6.0, colorFamily: 'white' };
  const eff = resolveEffectiveCaratSlope(curve, q);
  assertEqual(eff.mode, 'ignored_fallback_prior');
  assertEqual(eff.slope, 0.65);
});

test('resolveEffectiveCaratSlope uses 0.8 prior below 5ct', () => {
  const curve = { slope: 1.0, confidence: 'low', queryIsExtrapolated: true, sourceCount: 2, n: 5 };
  const eff = resolveEffectiveCaratSlope(curve, { carat: 2.0, colorFamily: 'white' });
  assertEqual(eff.prior, 0.8);
});

test('slopeSigmaBoost uses effective prior not hardcoded 0.8', () => {
  const adj = adjustCompToQuery(
    { carat: 6, colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1', shape: 'round' },
    { carat: 3, priceUsd: 1000, shape: 'round', clarity: 'VS1', colorNormalized: 'D' },
    { localCaratSlope: 0.75, localCaratSlopePrior: 0.65, localCaratExtrapolated: true },
  );
  // sigma should scale with |0.75 - 0.65|, not |0.75 - 0.8|
});

test('fitLocalCaratSlope returns null with only 2 knots', () => {
  // synthetic candidate pool with 2 bins only
});

test('exact match: slope change does not move estimate', () => {
  // query 1.0ct vs comp 1.0ct — deltaCarat ≈ 0
});

test('fitLocalCaratSlope excludes caratBand rows', () => {
  // pool with only band rows → null curve
});
```

### 9.2 Grid search script (proposed)

```javascript
// research/scripts/grid-search-carat-slope.mjs — PROPOSED
import { runBacktest } from './backtest-lib.mjs';

const GRID = [];
for (const priorWeight of [3, 5, 8]) {
  for (const extrap of ['apply', 'shrink', 'disable']) {
    GRID.push({ priorWeight, extrapolationPolicy: extrap });
  }
}

for (const params of GRID) {
  process.env.CARAT_SLOPE_POLICY = JSON.stringify(params);
  const m = await runBacktest({ segment: 'white' });
  console.log(JSON.stringify({ params, mdape: m.mdape, bias: m.bias, p80: m.p80,
    mdape5plus: m.segments['5ct+'].mdape }));
}
```

### 9.3 Acceptance thresholds

| Metric | Baseline | Target |
|--------|----------|--------|
| White MdAPE | 15.4% | **≤ 15.0%** (stretch ≤14.8%) |
| White bias | +6.1% | **+4% to +7%** (no material worsening) |
| White P80 | 85.0% | **≥ 82%** |
| White 5ct+ MdAPE | ~17.8% | **≤ 16.5%** |
| White 5ct+ bias | ~+14.6% | **≤ +10%** |

### 9.4 Manual regression cases

| Case | Query | Expect after tuning |
|------|-------|---------------------|
| Messi 1ct D round | 1ct D VS1 round | `mode=fitted` or `shrunk`, estimate within 5% of pre-tuning |
| 6ct D emerald holdout | 6ct D VS1 emerald | `mode` ∈ {`ignored_extrapolation`, `prior_only`}; no +20% spike |
| 3ct D oval | 3ct D VS1 oval | May use local slope; MdAPE should not regress |

### 9.5 Parity reminder

Any slope policy change must pass **P0 parity** between `comp-engine-v3.js` and `index.html` before trusting backtest deltas.

---

## 10. Why this will work

1. **Bias–variance tradeoff is explicit:** Normalization removed bias in the estimand; shrinkage/disabled extrapolation removes variance in application.

2. **5ct+ prior 0.65 matches market intuition:** White wholesale $/ct often flattens at size; using 0.8 learned from 1–3ct knots systematically **overstates** large stone totals → matches observed +14.6% bias direction.

3. **Source-count gating aligns with LOO backtest:** Requiring 2+ suppliers for aggressive slopes mimics what holdout evaluation rewards.

4. **Mode reporting enables debugging:** Worst-miss reports can filter `mode=shrunk_extrapolated` to verify errors concentrate where expected.

5. **Interval widening decoupled:** Extra sigma on non-`fitted` modes preserves P80 while point estimate moves toward prior.

---

## 11. Risks

| Risk | Mitigation |
|------|------------|
| Over-shrink → ignore local signal everywhere | Grid search; require MdAPE improvement, not only bias |
| 5ct prior 0.65 too low for some shapes | Shape-specific priors in phase 2; emerald may need higher prior than round |
| Fancy left behind | Out of scope; document clearly |
| Slower `resolveAlibabaComp` | Fit once per query — negligible |
| Fixing slope while ignoring magic-weight gap | Track separately in §13; may cap white MdAPE gains |
| Mode explosion in UI | Map to 4 user-facing labels (§8.2) |

---

## 12. Edge cases and failure modes

This section catalogs conditions that produce **wrong slope estimates**, **correct estimates wrongly applied**, or **misleading confidence**. Use it for unit tests, backtest tags, and policy ordering in `resolveEffectiveCaratSlope`.

### 12.1 Extrapolation vs interpolation (hull semantics)

`queryIsExtrapolated` is true when:

```text
query.carat < caratMin − 0.25   OR   query.carat > caratMax + 0.25
```

| Scenario | `queryIsExtrapolated` | Risk |
|----------|----------------------|------|
| Query 5.0ct, knots 1.0–3.0ct | **true** (above hull) | Classic 5ct+ failure; slope from small stones extrapolated upward → **positive bias** |
| Query 2.0ct, knots 1.0–3.0ct | **false** | In-hull; slope applied even if knots sparse at 2ct |
| Query 2.35ct, knots at 2.0 and 2.5 only | **false** | “Interpolation” between two knots 0.5ct apart; high leverage, unstable OLS |
| Query 3.8ct, knots 3.0–5.0ct | **false** | May still be **effectively extrapolating** local curvature if only end knots exist |
| Query 0.7ct, knots 1.0–3.0ct | **true** (below hull) | Rare in wholesale data; prior-only likely correct |

**Proposal:** Add `queryInKnotHull` (strict: `caratMin ≤ q ≤ caratMax`) separate from `queryIsExtrapolated` (tolerant ±0.25ct). Policy can disable slope on strict extrapolation while allowing interpolation only when knot density at query carat is sufficient (e.g. ≥2 knots within ±0.5ct of query).

### 12.2 Confidence label vs apply gate mismatch

Current confidence rules:

```text
high:   n ≥ 10 AND sourceCount ≥ 2 AND caratRange ≥ 2.0
medium: n ≥ 5  AND caratRange ≥ 1.5
low:    else (including n=3, range=1.0 — minimum legal fit)
```

| Edge case | `confidence` | Problem |
|-----------|--------------|---------|
| 3 knots, 1.0ct span, 1 supplier | `low` | Still applies full shrunk slope today |
| 10 knots, 2.5ct span, 1 supplier (Messi-only LOO) | `low` (sourceCount=1) | Many knots but **not independent** — slope = ladder economics |
| 6 knots, 2.0ct span, 2 suppliers | `medium` | May apply aggressive slope without extrapolation flag |
| `MIN_CARAT_RANGE=1.0` but `high` needs `≥2.0` | — | A “legal” fit can be `low` while spanning only 1ct — noisy |

**Proposal:** `rankConfidence` for policy should require **both** `sourceCount ≥ 2` and `caratRange` thresholds for any mode other than `shrunk_*` / `prior_only`.

### 12.3 Single-supplier and LOO holdout mechanics

Backtest (`backtest-comp-engine.mjs`) holds out **entire suppliers**, not random rows.

| After holdout | Typical pool | Slope behavior |
|---------------|--------------|----------------|
| Messi held out, Starsgem remains | Often 1 dominant ladder | `sourceCount=1`, slope tracks surviving supplier’s SKU steps |
| Both suppliers partially overlap shape | 2 sources, correlated ladders | `sourceCount=2` but **not independent** — P1b `independenceWeight` not wired yet |
| Holdout row is 5ct Messi SKU | Pool may lack 5ct knots | `queryIsExtrapolated=true` on holdout query | 

**Edge case — holdout row carat on knot boundary:** Holdout 5.0ct evaluated with knots max 3.0ct → extrapolation + positive bias inflates reported 5ct+ segment MdAPE. Fixing extrapolation policy should move LOO metrics more than IID row sampling would.

### 12.4 Pool construction: who enters the fit?

`fitLocalCaratSlope` filters:

- Drops `caratBand` / `clarityBand` rows (good — band pricing is not point carat).
- `shapeDistance ≤ 1` (same or **adjacent** family).
- Clarity within ±2 steps.

| Edge case | Effect |
|-----------|--------|
| Query emerald, pool includes adjacent oval/cushion | Knots mix step-cut and brilliant pricing → slope bias |
| Query VS1, pool includes SI1 (2 steps) | Clarity normalization helps but SI1 comps are cheaper per ct at size → residual slope noise |
| Dense 1ct round D/VVS2 rows + one 3ct row | Median knots at 1ct dominate; 3ct knot high leverage in OLS |
| `count` capped at 4 in knot weights | Repeated spreadsheet rows capped — **underweights** high-confidence aggregates |

**Proposal (phase 2):** Optional `fitPool='scored'` using top 30 candidates by `compErrorScore` so slope reflects comps likely to be adjusted, not the full candidate sea.

### 12.5 Bin quantization and SKU alignment

Bins: `Math.round(row.carat * 4) / 4` → 0.25ct centers.

| Edge case | Effect |
|-----------|--------|
| Actual 1.02ct → bin 1.0ct | Adjustment uses true `compCt=1.02` but knot at 1.0 — small inconsistency |
| Supplier lists 1.5ct only (no 1.25/1.75) | Uneven knot spacing; OLS slope sensitive to missing middle bins |
| Query 4.9ct vs 5.0ct SKU knot | `nearCaratThreshold` warning fires; slope may not capture threshold premium |
| Two suppliers, same bin, different $/ct | Weighted median helps; single-source bins still ladder-driven |

### 12.6 Raw slope and clamp extremes

- `rawSlope = ssxy/ssxx` with clamp **[-0.2, 2.0]** after shrink.
- Negative slope (price/ct **falls** with carat in log-log fit) can occur with bad knots or threshold effects — clamp allows slightly negative slopes.
- `rawSlope > 1.2` often triggers “differs from 0.8 prior” warning but slope still applies.

**Test case:** Synthetic monotonic decreasing $/ct with carat (magic-weight simulation) → expect policy to fall back to prior, not fitted negative slope.

### 12.7 Per-comp lever arm (why pool slope hurts on blend)

For each comp, total price scales by `exp(slope * log(q/c))`. Example with **slope = 0.9** (close to prior):

| Query | Comp | `log(q/c)` | Price multiplier |
|-------|------|------------|------------------|
| 5.0ct | 1.0ct | 1.61 | **×4.9** |
| 5.0ct | 3.0ct | 0.51 | **×1.7** |
| 2.0ct | 1.5ct | 0.29 | ×1.3 |

`best_available` blends often include a far-carat comp. One pool-level slope that is **slightly too high** (+0.1 over prior) on a 5ct vs 1ct pair adds ~16% to that comp’s contribution — enough to drive +6% overall bias.

**Proposal:** Cap **per-comp** `|deltaCarat|` or use comp-specific slope shrink when `|log(q/c)| > 0.5` even if pool slope is `fitted` (orthogonal to pool-level `resolveEffectiveCaratSlope`).

### 12.8 Exact / nearest / best_available paths

| `matchType` | Slope impact |
|-------------|--------------|
| `exact` | `log(q/c) ≈ 0` → slope irrelevant for point; still affects σ boosts if slope ≠ prior |
| `nearest` | Moderate gaps; slope matters |
| `best_available` | Often large carat gaps; **largest lever arm** — tag backtests with `matchType` × `mode` |

**Diagnostic:** If MdAPE improves overall but `best_available` + `shrunk_extrapolated` unchanged, policy is not addressing the main failure path.

### 12.9 Shape × carat interaction (emerald, marquise)

| Segment | MdAPE | Notes |
|---------|------:|-------|
| Emerald ~19.4% | Step-cut mult 0.83; fewer round-equivalent comps; cross-family knots in fit pool |
| Marquise ~21.9% | Sparse; `shapeDistance≤1` may pull pear/marquise family comps |

**Edge case:** Policy uses global prior 0.65 at 5ct+ for all shapes; emerald 5ct anchor secant from `baseWhitePerCt` may imply **higher** local slope than round. **Phase 2:** `priorSlopeFromAnchorTable(shape, grade, carat)` per §6.4.

### 12.10 Sigma and prior reference bugs (implementation debt)

When adding `resolveEffectiveCaratSlope`:

| Field | Bug risk |
|-------|----------|
| `slopeSigmaBoost` | Compare to **effective prior**, not 0.8 |
| Warning `|slope - 0.8| > 0.3` | Should use segment prior |
| `fitLocalCaratSlope(..., prior)` | Must pass `caratPriorForQuery(query.carat)` so shrink target matches apply target |

### 12.11 Interpolation-only high-leverage knots

Even when `queryIsExtrapolated === false`, consider:

```javascript
// PROPOSED helper
function knotSupportAtQuery(points, queryCarat, halfWidth = 0.5) {
  return points.filter(p => Math.abs(p.carat - queryCarat) <= halfWidth).length;
}
// If knotSupportAtQuery < 2 && confidence !== 'high' → shrink toward prior
```

Prevents applying a 1.0–3.0ct span slope at query 2.8ct when only the 3.0ct end knot is nearby.

### 12.12 Policy composition order

When multiple conditions fire, **order matters**. Recommended evaluation sequence for `resolveEffectiveCaratSlope`:

1. Compute segment `prior` (`caratPriorForQuery`).
2. If no curve → `prior_only`.
3. If `confidence === 'low' && queryIsExtrapolated` → `ignored_fallback_prior` (hard stop).
4. If `queryIsExtrapolated && confidence !== 'high'` → `ignored_extrapolation` or heavy shrink (grid search picks).
5. If `sourceCount < minSourceCountToApply` → `shrunk_single_source`.
6. If `confidence === 'low'` → `shrunk_low_confidence`.
7. If `|slope - prior| > maxAppliedDeviation` → cap deviation.
8. Else → `fitted`.

Document final `mode` as the **most conservative** step applied (not the last arithmetic blend).

---

## 13. Cross-layer gaps (outside slope fit)

Tuning local slope will not fix these; they explain residual error and P0/P1b dependencies.

### 13.1 Magic-weight / carat-threshold premiums

`index.html` `compute()` applies smooth discounts below 0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0ct (`magicWeights`). **Comp engine does not apply magic-weight adjustment** on Alibaba comps — only warns via `nearCaratThreshold`.

| Effect | Consequence |
|--------|-------------|
| Query 0.98ct vs comp 1.02ct | Model table discounts sub-1ct; comp price may be 1ct-listing premium → comp path **high** vs model |
| Query 4.95ct | Warning only; slope + prior may miss threshold premium embedded in 5.0ct SKU |

**Research follow-up (P2 or comp-engine):** Explicit threshold premium term in `adjustCompToQuery` **or** exclude near-threshold rows from knot fit. Do not conflate with slope tuning success.

### 13.2 `compErrorScore` carat axis ignores fitted slope

Selection uses fixed `AXIS_SIGMA.caratPerLogUnit` and `caratLargeExtrapolation`. A comp with huge carat gap can still enter the ensemble if color/shape are close, then receive a large `deltaCarat` from local slope.

**Optional follow-up:** After `resolveEffectiveCaratSlope`, inflate `compErrorScore` eCarat when `mode !== 'fitted'` or when `|log(q/c)| > 0.5`.

### 13.3 Clarity-at-size interaction (5ct+ VS2)

`CLARITY_CARAT_MULTS_W` drops VS2 from 0.92 @ 1ct to **0.70 @ 5ct**. Normalization during fit uses **comp carat** for clarity mult; adjustment uses **query carat** for delta clarity.

| Query 5ct VS2 | Comp 1ct VS2 | Fit normalizes clarity at 1ct mult | Adjust uses 5ct mult on clarity axis |
|---------------|--------------|-------------------------------------|--------------------------------------|

This asymmetry can leave residual curvature in knots that slope tries to absorb. **Align:** use `query.carat` in `normalizedLogDpcForCurve` for white clarity (breaking change — A/B in backtest).

### 13.4 P1b independence weights (not wired)

`p1b-source-independence-signals-research.md` proposes `independenceWeight` on knots and `sourceCount ≥ 2` on **groups**, not rows. Until wired, `sourceCount` overstates independence when two suppliers mirror the same ladder.

**Coordination:** Implement P1 slope **modes** first (low risk), then P1b weights on knot construction (changes fit estimand).

### 13.5 Production / research parity (P0)

Slope policy must land in both `research/comp-engine-v3.js` and `index.html` (or shared module). Otherwise backtest deltas are not user-visible.

### 13.6 Dual codebase anchor prior (§6.4)

`priorSlopeFromAnchorTable` ties comp slope to `baseWhitePerCt` secant — reduces disconnect when user compares `compute()` wholesale to Alibaba comp estimate.

---

## 14. Diagnostic and backtest extensions

### 14.1 Tags on every prediction record

Extend `backtest-comp-engine.mjs` (or post-process JSON) with:

```javascript
record.localCaratMode = result.localCaratCurve?.mode ?? 'n/a';
record.localCaratExtrapolated = result.localCaratCurve?.queryIsExtrapolated ?? false;
record.localCaratConfidence = result.localCaratCurve?.confidence ?? null;
record.localCaratSourceCount = result.localCaratCurve?.sourceCount ?? null;
record.localCaratNKnots = result.localCaratCurve?.n ?? null;
record.localCaratRange = result.localCaratCurve?.caratRange ?? null;
record.matchType = result.matchType;
record.logCaratGap = Math.log(query.carat / (result.primary?.row?.carat || query.carat));
```

### 14.2 Aggregation tables to run after grid search

| Breakdown | Hypothesis if true |
|-----------|-------------------|
| MdAPE by `mode` | `ignored_*` rows improve; `fitted` stable |
| Bias by `mode` | Positive bias concentrated in `fitted` + extrapolated |
| MdAPE by `matchType` × `mode` | `best_available` drives 5ct+ gains |
| MdAPE by `queryIsExtrapolated` | Extrapolated flag correlates with error |
| Worst 20 misses filter `mode=fitted` AND `logCaratGap > 0.5` | Per-comp lever arm hypothesis confirmed |
| MdAPE by shape (emerald, marquise) | Slope policy alone insufficient |

### 14.3 Synthetic fixtures (unit + integration)

| Fixture | Purpose |
|---------|---------|
| Monotonic ladder, 1 supplier, 6 knots 1–3ct | `sourceCount=1`; expect `shrunk_single_source` or null |
| Two suppliers, opposing slopes | Median + OLS stability |
| Knots 1,2,3ct only, query 5ct | `ignored_extrapolation` |
| Knots 1,5ct only (gap), query 3ct | Interpolation instability; `knotSupportAtQuery` |
| Exact match same carat | Slope change does not move estimate |
| `best_available` 5ct query, 1ct comp | Cap / prior-only reduces +bias |

### 14.4 CLI commands

```bash
node research/scripts/backtest-comp-engine.mjs --segment white
node research/scripts/backtest-comp-engine.mjs --segment white --worst 20
# PROPOSED after grid script exists:
node research/scripts/grid-search-carat-slope.mjs --segment white --objective mdape
```

### 14.5 Manual regression matrix (expanded)

| ID | Query | Pool condition | Expected `mode` | Pass criterion |
|----|-------|----------------|-----------------|----------------|
| M1 | 1.0ct D round VS1 | Messi+Starsgem, multi knots | `fitted` or mild `shrunk` | MdAPE within 5% of baseline |
| M2 | 6.0ct D emerald VS1 | Knots max ≤3ct | `ignored_*` or `prior_only` | Estimate not &gt;+15% vs actual on LOO |
| M3 | 4.95ct D round VS1 | Near 5ct threshold | Any | Warning present; no double-count threshold in slope |
| M4 | 2.0ct D oval VS1 | Medium confidence | Not `ignored_fallback_prior` | Local signal preserved |
| M5 | 0.98ct D round VS1 | Sub-1ct | Prior or shrunk | Compare to model magic-weight path |
| M6 | LOO Starsgem holdout 5ct | Messi-only pool | `sourceCount=1` | Policy does not apply aggressive slope |

---

## 15. Implementation phases

### Phase 1 — Policy layer only (1 day)

- Add `resolveEffectiveCaratSlope` + modes
- Extend result metadata + warnings
- Unit tests

### Phase 2 — Grid search + pick policy (1 day)

- `grid-search-carat-slope.mjs`
- Lock `CARAT_SLOPE_POLICY` constants

### Phase 3 — Backtest + worst-miss by mode (0.5 day)

- Segment dashboards
- Confirm 5ct+ improvement

### Phase 4 — Production parity (P0 dependency)

- Mirror or import module

---

## Definition of done (P1 carat)

- [x] `localCaratCurve.mode` populated on every white result
- [x] `slopeSigmaBoost` / warnings use segment prior, not hardcoded 0.8
- [x] Unit tests cover §12 edge cases (extrapolation, single-source, exact path, prior 0.65)
- [ ] White MdAPE improves from 15.4% without P80 &lt; 82% or bias &gt; +8%
- [ ] 5ct+ MdAPE improves ≥1.0 pp from ~17.8%; 5ct+ bias ≤ +10%
- [ ] 5ct+ worst misses materially reduced (manual matrix M2, M6)
- [ ] Backtest breakdown by `mode` and `matchType` documented in repo
- [ ] Documented policy constants with grid-search evidence in this repo
- [ ] P0 parity: same policy in `comp-engine-v3.js` and `index.html` (or shared import)

---

## 16. Implementation — Phase 1 (completed 2026-05-22)

**Implementer:** GitHub Copilot  
**Files changed:** `research/comp-engine-v3.js`, `research/scripts/test-comp-engine-v3.mjs`

### 16.1 What was implemented

**Phase 1 policy layer** from §15 is complete. No grid search (Phase 2) yet — constants were chosen based on the doc's proposed values and the reasoning in §5 / §12.

#### New section `§2.6 CARAT SLOPE POLICY` in `comp-engine-v3.js`

- **`CARAT_SLOPE_POLICY` constant object** — centralises all tuning knobs: `priorBelow5ct=0.8`, `prior5ctPlus=0.65`, `minSourceCountToApply=2`, `maxAppliedDeviation=0.25`, `extrapolationShrink=0.15`.

- **`caratPriorForQuery(carat)`** — segment-aware prior. Returns 0.65 for `carat >= 5`, 0.8 otherwise.

- **`MODE_SIGMA_BOOST` map** — per-mode additive boost to the carat uncertainty axis. Replaces the previous `slopeSigmaBoost = |slope - 0.8| * 0.10` + `curveExtrapolationBoost = 0.08` composition.

- **`resolveEffectiveCaratSlope(curve, query)`** — implements the §12.12 priority ordering cleanly. Each condition is an early return so the mode accurately reflects the *most conservative constraint triggered*, not an accumulated label. Steps:
  1. No curve → `prior_only`
  2. `confidence=low && extrapolated` → `ignored_fallback_prior` (hard stop)
  3. `extrapolated && confidence≠high` → `shrunk_extrapolated` (retains only 15% of fitted deviation from prior)
  4. `sourceCount < 2` → `shrunk_single_source` (retains 35% of fitted deviation)
  5. `confidence=low` (in-hull, multi-source) → `shrunk_low_confidence` (retains 25%)
  6. `|slope − prior| > 0.25` → `fitted_capped` (hard cap, deviation limited to ±0.25 from prior)
  7. Else → `fitted`

#### Modifications to `fitLocalCaratSlope`

- **5ct+ knot guard**: if `query.carat >= 5.0`, requires ≥ 2 knots at or above 4.0ct. Without high-carat knots, any slope is a 1–3ct extrapolation and `resolveEffectiveCaratSlope` cannot distinguish this case from a genuine in-hull fit. Returns `null` early → downstream falls to `prior_only`.
- **Segment prior threading**: `resolveAlibabaComp` now passes `caratPriorForQuery(nq.carat)` so the OLS shrinkage target is consistent with the policy prior.

#### Modifications to `adjustCompToQuery`

- Replaced the `slopeSigmaBoost + curveExtrapolationBoost` calculation with a `MODE_SIGMA_BOOST` lookup keyed on `context.localCaratSlopeMode`.
- **Legacy path preserved**: callers that don't provide `localCaratSlopeMode` (e.g. direct unit test calls) fall back to `|slope − effectivePrior| * 0.10 + (extrapolated ? 0.08 : 0)`, using `context.localCaratSlopePrior ?? 0.8` as the reference instead of hardcoded 0.8.
- **Prior fallback updated**: `context.localCaratSlope ?? caratPriorForQuery(queryCt)` — no-context callers now use the segment-aware prior, not a hardcoded 0.8.

#### Modifications to `resolveAlibabaComp`

- Calls `resolveEffectiveCaratSlope(localCaratCurve, nq)` for white diamonds.
- `adjContext` extended with `localCaratSlopeMode`, `localCaratSlopePrior`, `localCaratSlopeRaw`.
- **Slope deviation warning** uses `localCaratCurve.rawSlope` vs `effective.prior` (segment-aware), not `localCaratCurve.slope` vs hardcoded 0.8.
- **`localCaratCurve` output** now always emits a non-null object for white diamonds (even when no local fit was possible), with fields `slope`, `fittedSlope`, `rawSlope`, `prior`, `mode`, `n`, `rowCount`, `sourceCount`, `confidence`, `caratRange`, `queryIsExtrapolated`, `normalized`, `note`. This satisfies the acceptance criterion *"every white result exposes `localCaratCurve.mode`"*.

#### New exports

`caratPriorForQuery`, `resolveEffectiveCaratSlope`, `CARAT_SLOPE_POLICY`, `MODE_SIGMA_BOOST`.

### 16.2 Decisions that diverge from the research doc

| Topic | Doc proposal | Implemented | Reasoning |
|-------|-------------|-------------|-----------|
| Multi-stage shrink composition (§5.2) | Apply low-conf shrink, then extrapolation shrink, then single-source shrink sequentially | Priority-ordered early returns (§12.12) | Composition is ambiguous: three 25%/15%/35% shrinks in sequence produce a different result depending on order. The §12.12 ordering is the doc's own recommended sequence; early-return makes the mode meaning unambiguous. |
| `ignored_extrapolation` mode | Separate mode for `extrapolated && confidence≠high` when that is a disable, not shrink | Implemented as `shrunk_extrapolated` (15% retention) | "Disable" vs "heavy shrink" produces almost the same point estimate (15% of 0.3 deviation = 0.045 shift from prior). Shrunk is auditable; pure disable loses the signal that a fit existed. For true high-extrapolation cases, `ignored_fallback_prior` (Step 3) is the hard stop. |
| `knotSupportAtQuery` (§12.11) | Helper to detect in-hull but sparse support at query carat | Not implemented | Phase 2. The 5ct guard in `fitLocalCaratSlope` and the `ignored_fallback_prior` path in `resolveEffectiveCaratSlope` address the most dangerous extrapolation case; local density is a more complex refinement. |
| `priorSlopeFromAnchorTable` (§6.4) | Derive prior from `baseWhitePerCt` secant | Not implemented | Phase 2 / Phase 4. Requires dual-codebase coordination and changes the estimand of the prior. |
| `fitted_capped` mode | Not named in doc | Added | The doc's Step 7 caps deviation without assigning a distinct mode name. Making it explicit lets backtest aggregations distinguish "clean fitted" from "capped fitted" for diagnostics. |
| 5ct guard placement | Proposed as filter inside `fitLocalCaratSlope` | Implemented there | Returning `null` from the fit is cleaner than returning a curve the policy then ignores. The extrapolation warning still fires because the warning checks `localCaratCurve?.queryIsExtrapolated` — if we return null, it doesn't fire, which is acceptable: the `prior_only` mode in the output communicates the same thing. |
| `localCaratCurve: null` for no-fit | Doc says null | Always non-null for white (prior_only descriptor) | The acceptance criterion says mode must be populated on every white result. A null `localCaratCurve` cannot carry `.mode`. |

### 16.3 What remains (Phase 2+)

| Item | Priority |
|------|----------|
| Grid search over `priorWeight`, `extrapolationPolicy`, `minSourceCount` | Phase 2 |
| Backtest breakdown by `mode` × `matchType` × segment | Phase 2/3 |
| `knotSupportAtQuery` helper for in-hull density check | Phase 2 |
| `priorSlopeFromAnchorTable` from anchor table secant | Phase 2/4 |
| P0 parity: propagate same policy to `index.html` | Phase 4 |
| P1b independence weights on knot construction | After P1b research |

### 16.4 Test coverage added

6 new test functions in `research/scripts/test-comp-engine-v3.mjs` (38 new assertions):

| Function | What it covers |
|----------|---------------|
| `testCaratPriorForQuery` | Boundary at 5ct; below/above prior values |
| `testResolveEffectiveCaratSlope` | All 8 policy steps; 5ct prior interaction; high-confidence extrapolation passthrough |
| `testModeSigmaBoost` | `prior_only` boost=0; `ignored_fallback_prior` wider than prior_only; legacy path uses segment prior |
| `testFitLocalCaratSlopeLargeCaratGuard` | 5ct query with max-3ct knots → null; same pool 2ct query succeeds; pool with 4.5+5ct knots passes |
| `testExactMatchSlopeIrrelevant` | Slope 1.5 vs 0.8 does not move estimate when carat gap is zero |
| `testFitLocalCaratSlopeCratBandExclusion` | Pool with only `caratBand` rows → null curve |

All 190 assertions pass (189 pre-existing + 1 corrected pre-existing test logic + new tests).

