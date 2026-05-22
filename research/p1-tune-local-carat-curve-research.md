# P1 — Tune Local Carat Curve Usage

**Research date:** 2026-05-22  
**Status:** Deep research / implementation plan (no code changes in this pass)  
**Related:** `comp-engine-v3-p0-p1-p1b-implementation.md` § P1b, `comp-engine-v3-gap-fixes-implementation.md` Fix 3, `comp-engine-v3-remaining-work.md` P1, `white-diamond-igi-wholesale-pricing.md`

---

## Executive Summary

White diamond comp pricing uses a **data-driven local carat slope** (`fitLocalCaratSlope`) for the log-space adjustment `deltaCarat = slope × log(q_ct / c_ct)`, with prior slope **0.8** (equivalent to per-carat exponent 1.8 in total price). The May 2026 normalized knot fit is **statistically cleaner** but **backtest-neutral-to-worse**:

| Metric | Before normalized slope | After normalized slope |
|--------|------------------------:|-----------------------:|
| White MdAPE | 15.2% | **15.4%** |
| White bias | +5.1% | +6.1% |
| White P80 | 83.7% | 85.0% |

Large-carat segments remain the pain point: **5ct+ MdAPE ~17.8%**, **+14.6% bias** (leave-one-supplier-out).

**Core hypothesis:** The slope layer is no longer dominated by color/clarity leakage, but it is still **too aggressive** when:

- query carat is **outside** the fitted knot range (`queryIsExtrapolated`);
- knots come from **one supplier ladder** (`sourceCount === 1`);
- confidence is `low` but slope still replaces the 0.8 prior;
- **5ct+** market dynamics differ from 1–3ct (flatter $/ct, threshold premiums).

**Proposed direction:** Treat local slope as a **conditional, shrunk, reportable** layer — not a default upgrade over the prior.

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
12. [Implementation phases](#12-implementation-phases)

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

test('fitLocalCaratSlope returns null with only 2 knots', () => {
  // synthetic candidate pool with 2 bins only
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
| 5ct prior 0.65 too low for some shapes | Shape-specific priors in phase 2 |
| Fancy left behind | Out of scope; document clearly |
| Slower `resolveAlibabaComp` | Fit once per query — negligible |

---

## 12. Implementation phases

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

- [ ] White MdAPE improves from 15.4% without P80 &lt; 82% or bias &gt; +8%
- [ ] 5ct+ worst misses materially reduced
- [ ] `localCaratCurve.mode` populated on every white result
- [ ] Documented policy constants with grid-search evidence in this repo
