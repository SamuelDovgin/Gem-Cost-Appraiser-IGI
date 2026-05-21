# Comp Engine v2 — Design Proposal
**Problem areas addressed:** (1) comp selection scoring for fancy color stones, (2) price extrapolation math when stretching across carat/intensity/clarity gaps.

---

## Part 1 — Better Comp Selection

### What's broken today

The scorer in `§4 scoreCandidate` is a flat weighted-distance function:

```
score = caratDist × 4.0 + clarityDist × 1.5 + colorDist × 1.0 + shapePenalty + bandPenalty
```

For the **3.80ct Fancy Vivid Pink VVS2 cut-cornered rectangular** stone, this surfaces the 0.89ct Fancy Intense Brownish Pink Radiant VS2 at $262 as the nearest comp, because the hue-family filter passes anything labeled "pink" and the carat distance of ~2.9ct × 4 = 11.6 just barely loses to the heart, pear, cushion rows that are also in the pink family but much closer in carat.

The actual best candidates from your data are:

| Shape | Color | Carat | Clarity | Price | $/ct | Why better |
|---|---|---|---|---:|---:|---|
| Heart | Fancy Vivid Pink | 2.08 | VVS2 | $770 | $370 | Same intensity, same clarity, 1.72ct gap |
| Cushion | Fancy Pink | 4.13 | VS1 | $1,471 | $356 | Closest carat (0.33ct gap), one clarity step down |
| Pear | Fancy Intense Pink | 1.55 | VS1 | $534 | $345 | Two intensity steps down, 2.25ct gap |

The heart at 2.08ct VVS2 vivid pink is clearly the right anchor: **same intensity, same clarity, only 1.72ct gap**, and it has a corroborating vivid-pink heart ladder (`10000038791251`). Yet the engine currently picks the brownish-pink radiant at 0.89ct because nothing in the scorer penalizes intensity mismatch or rewards clarity match.

### Root causes

**1. Intensity is not scored — only the hue is checked.**
`fancyColorCompatible()` returns `true` for any pink regardless of intensity tier. There's no cost for jumping from vivid to brownish-intense.

**2. Clarity step cost is symmetric and underweighted.**
A clarity match earns 0 penalty vs VS2 mismatch at 0.5 — but for fancy color, VVS2 is a real spec that the buyer cares about. The score should reward same-clarity comps more aggressively.

**3. Carat distance is linear but the comp pool is sparse.**
When multiple candidates are all far in carat, the tie-breaker is price (lowest). That surfaces tiny cheap stones as "nearest."

**4. No concept of $/ct plausibility.**
A 0.89ct stone at $294/ct as a comp for a 3.8ct stone is not credible — the caratMult extrapolation then balloons the estimate unpredictably.

### Proposed scoring for fancy color

Replace the single flat score with a **two-tier priority system**:

```
Tier 1 (must-match preferred): same intensity tier + same clarity
Tier 2 (acceptable): one intensity step off OR one clarity step off
Tier 3 (fallback): two steps off in either dimension

Within each tier: sort by carat proximity, then $/ct plausibility
```

Concretely, define an **intensity rank** (lower = better match, 0 = vivid):

```js
const INTENSITY_RANK = {
  pink_fv: 0, pink_fi: 1, pink_f: 2, pink_fl: 3,
  yellow_fv: 0, yellow_fi: 1, yellow_f: 2, yellow_fl: 3,
  blue_fv: 0, blue_fi: 1, blue_f: 2, blue_fl: 3,
  // etc.
};

// modifier variants that are penalized one extra step
const BROWNISH_KEYS = new Set(['pink_fi_brownish']); // or inferred from label
```

Then replace `scoreCandidate` for fancy with:

```js
function scoreFancyCandidate(query, row) {
  const caratDist = Math.abs(query.carat - (row.carat || 0));

  // Intensity distance: 0 = same tier, 1 = one step (e.g. vivid→intense), 2 = two steps
  const userIntensity = INTENSITY_RANK[query.colorFamily_key] ?? 2;
  const compIntensity = INTENSITY_RANK[inferFancyFamilyKey(row.color)] ?? 2;
  let intensityDist = Math.abs(userIntensity - compIntensity);
  
  // Extra penalty for brownish/greyish modifiers on the comp (they're a different market tier)
  if (row.color?.toLowerCase().includes('brownish') || row.color?.toLowerCase().includes('greyish')) {
    intensityDist += 1.5;
  }

  // Clarity distance
  const clarU = CLARITY_RANK_NUM[query.clarity] ?? 2;
  const clarC = CLARITY_RANK_NUM[row.clarity] ?? 2;
  const clarDist = Math.abs(clarU - clarC);

  // Shape distance: 0 = same, else flat penalty
  const shapePenalty = shapeMatches(query.shape, row.shape) ? 0 : 2.5;

  // $/ct plausibility: penalize comps whose $/ct is far below query's expected range.
  // Prevents tiny cheap stones from anchoring large-stone estimates.
  const compDollarPerCt = row.priceUsd / (row.carat || 1);
  const queryExpectedDollarPerCt = estimateDollarPerCt(query); // see below
  const dollarPerCtRatio = compDollarPerCt / queryExpectedDollarPerCt;
  // Penalize if comp $/ct is less than 40% or more than 250% of expected
  const plausibilityPenalty = (dollarPerCtRatio < 0.4 || dollarPerCtRatio > 2.5) ? 3.0 : 0;

  return (
    caratDist * 3.5 +
    intensityDist * 3.0 +   // intensity is now a first-class axis
    clarDist * 2.0 +        // clarity matters more for fancy
    shapePenalty +
    plausibilityPenalty
  );
}
```

For the 3.80ct Fancy Vivid Pink VVS2 query, the heart at 2.08ct vivid VVS2 scores:
- `caratDist = 1.72 × 3.5 = 6.02`
- `intensityDist = 0 × 3.0 = 0`  ← same vivid tier
- `clarDist = 0 × 2.0 = 0`       ← both VVS2
- `shapePenalty = 2.5`            ← heart ≠ rectangular
- **total = 8.52**

The brownish-pink radiant at 0.89ct scores:
- `caratDist = 2.91 × 3.5 = 10.19`
- `intensityDist = (0 vivid vs 1 intense) + 1.5 brownish penalty = 2.5 × 3.0 = 7.5`
- `clarDist = 1 × 2.0 = 2.0`     ← VS2 vs VVS2
- `shapePenalty = 2.5`
- **total = 22.19** — correctly buried

With the new threshold raised or the tier system, the heart wins.

### $/ct plausibility estimate

Add a lightweight per-family $/ct model to gate implausible comps:

```js
function estimateDollarPerCt(query) {
  // Uses FANCY_COLOR_BASE ws1 and scale to get expected $/ct at query.carat
  const base = FANCY_COLOR_BASE[query.colorFamily_key];
  if (!base) return 300; // fallback
  // ws1 is $/ct at 1ct; total price at ct = ws1 * ct^scale, so $/ct = ws1 * ct^(scale-1)
  return base.ws1 * Math.pow(query.carat, base.scale - 1);
}
```

For pink_fv at 3.8ct: `ws1=500, scale=0.88` → `500 × 3.8^(-0.12) ≈ 500 × 0.856 ≈ $428/ct`.
The 0.89ct brownish-pink at $294/ct has ratio `294/428 = 0.69` — borderline plausible but the intensityDist penalty already demotes it. The cushion at 4.13ct $356/ct has ratio `0.83` — well within range.

### Also fix: cross-shape broadening for fancy

When `findAbsoluteBestComps` broadens to "any shape", it should still enforce the tier system above. Currently it drops all shape filtering and can pull a yellow stone (if somehow miscategorized) or a very distant intensity. The fix:

```js
// In findAbsoluteBestComps broadening step:
candidates = comps.filter(row => {
  if (row.colorFamily !== query.colorFamily) return false;
  if (!fancyColorCompatible(query, row)) return false;
  // NEW: also reject stones whose intensityDist > 2 (i.e., vivid user, light comp)
  const intensityDist = Math.abs(
    (INTENSITY_RANK[query.colorFamily_key] ?? 2) -
    (INTENSITY_RANK[inferFancyFamilyKey(row.color)] ?? 2)
  );
  return intensityDist <= 2;
});
```

---

## Part 2 — Better Pricing Math

### What's broken today

The modifier stacks in `applyFancyModifiers` multiply independent ratios together:

```
price = comp.price × intensityMult × clarityMult × shapeMult × caratMult
```

The **caratMult** is a simple power law: `(userCt / compCt)^1.5`.

For the 3.80ct stone using the 0.89ct comp:
- `caratMult = (3.80 / 0.89)^1.5 = 4.27^1.5 ≈ 8.82`  ← enormous lever arm
- `intensityMult = 1.48` (vivid vs intense)
- `clarityMult = 1.09`
- `result = $262 × 8.82 × 1.48 × 1.09 ≈ $3,733`

The problem isn't just the bad comp choice — it's that **multiplying independent modifiers compounds errors geometrically**. If each modifier has ±15% uncertainty, four multiplied together have ±60% uncertainty.

### Proposed math: log-space additive model with per-axis splines

The core insight is that **price per carat** is the natural variable, not total price. All modifiers should be computed in $/ct space and then scaled back.

#### 2a. Carat scaling: use the empirical ladder, not a power law

Instead of `(userCt / compCt)^1.5`, interpolate directly from the ladder data you already have.

For fancy pink you have these $/ct anchor points from the vivid-pink heart ladder:

| Carat | Price | $/ct |
|---|---|---|
| 1.00 | $200 | $200 |
| 2.00 | $420 | $210 |
| 2.08 | $770 | $370 | ← from mixed-shapes comp (different source, higher quality) |
| 3.00 | $770 | $257 |
| 4.00 | $1,020 | $255 |

Notice the $/ct curve is **not monotonic** and has a bump around 2ct. A power law can't capture this. Use **monotone cubic spline interpolation** (Fritsch-Carlson) on the log-carat vs log($/ct) axes:

```js
/**
 * Monotone cubic spline on (x[], y[]) — Fritsch-Carlson method.
 * Returns a function f(x) that interpolates the knots.
 */
function monotoneCubicSpline(xs, ys) {
  const n = xs.length;
  // slopes at each knot
  const d = new Array(n);
  for (let i = 0; i < n - 1; i++) {
    d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
  }
  // tangents (Fritsch-Carlson)
  const m = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) {
      m[i] = 0;
    } else {
      const h0 = xs[i] - xs[i - 1], h1 = xs[i + 1] - xs[i];
      m[i] = (3 * (h0 + h1)) / ((2 * h1 + h0) / d[i - 1] + (h0 + 2 * h1) / d[i]);
    }
  }
  return function (x) {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; xs[mid] <= x ? lo = mid : hi = mid; }
    const h = xs[hi] - xs[lo];
    const t = (x - xs[lo]) / h;
    const t2 = t * t, t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[lo] +
      (t3 - 2 * t2 + t) * h * m[lo] +
      (-2 * t3 + 3 * t2) * ys[hi] +
      (t3 - t2) * h * m[hi]
    );
  };
}
```

Build per-family $/ct splines from your comp data:

```js
const PINK_VIVID_HEART_KNOTS = {
  carats: [1.00, 2.08, 3.00, 4.00],
  dollarPerCt: [200, 370, 257, 255],
};

// Build in log-log space (more stable)
const logCarats = PINK_VIVID_HEART_KNOTS.carats.map(Math.log);
const logDollarPerCt = PINK_VIVID_HEART_KNOTS.dollarPerCt.map(Math.log);
const pinkVividHeartSpline = monotoneCubicSpline(logCarats, logDollarPerCt);

// Evaluate: what is the expected $/ct for a 3.80ct vivid pink?
const logDpc = pinkVividHeartSpline(Math.log(3.80));
const dpc = Math.exp(logDpc); // ≈ $256/ct
const estimatedPrice = dpc * 3.80; // ≈ $972
```

That $972 is a much more defensible estimate than $3,733 for a 3.80ct vivid pink, and it uses the actual shape of the market data rather than a power law extrapolation.

#### 2b. Intensity correction: use ratio at the COMP's carat, not the query's carat

Current code evaluates both the user's and comp's fancy family $/ct at `query.carat`:

```js
const uWs = ub.ws1 * Math.pow(ct, ub.scale - 1);  // ct = query.carat
const cWs = cb.ws1 * Math.pow(ct, cb.scale - 1);   // same ct — wrong for comp
```

This conflates "how much more does vivid cost than intense at 3.8ct" with "how much did the actual comp cost at 0.89ct." Fix: evaluate the comp-family at the comp's carat, evaluate the user-family at the user's carat, then take the ratio of $/ct:

```js
function fancyIntensityMultV2(userFamilyKey, compColorLabel, userCt, compCt) {
  const ub = FANCY_COLOR_BASE[userFamilyKey];
  const compKey = inferFancyFamilyKey(compColorLabel);
  const cb = compKey ? FANCY_COLOR_BASE[compKey] : null;
  if (!ub || !cb) return 1.0;
  
  // $/ct at the respective carats
  const uDpc = ub.ws1 * Math.pow(userCt, ub.scale - 1);   // user family at user size
  const cDpc = cb.ws1 * Math.pow(compCt, cb.scale - 1);   // comp family at comp size
  
  // Ratio: how much more (or less) should the user stone cost per carat vs the comp
  return cDpc > 0 ? uDpc / cDpc : 1.0;
}
```

For vivid pink at 3.8ct vs intense brownish-pink at 0.89ct:
- `uDpc = 500 × 3.8^(-0.12) ≈ $428/ct`
- `cDpc = 330 × 0.89^(-0.10) ≈ $342/ct`
- `ratio = 428 / 342 ≈ 1.25`

This is much more conservative than the current 1.48, because you're no longer extrapolating the comp family's pricing behavior out to 3.8ct.

#### 2c. Log-space stacking with uncertainty propagation

Instead of multiplying raw modifiers, work in log space so you can track uncertainty:

```js
function applyFancyModifiersV2(query, compRow) {
  const userCt = query.carat;
  const compCt = compRow.carat || 1;

  // 1. Start from comp $/ct (not total price — this is key)
  const compDollarPerCt = compRow.priceUsd / compCt;

  // 2. All corrections in log space
  const logBase = Math.log(compDollarPerCt);

  // Intensity: evaluated at respective carats
  const intensityMult = fancyIntensityMultV2(
    query.colorFamily_key, compRow.color, userCt, compCt
  );
  const logIntensity = Math.log(intensityMult);

  // Clarity: CLARITY_MULT_COLOR ratio — unchanged, but expressed as log
  const clarC = CLARITY_MULT_COLOR[compRow.clarity] ?? 1;
  const clarU = CLARITY_MULT_COLOR[query.clarity] ?? 1;
  const logClarity = Math.log(clarC > 0 ? clarU / clarC : 1);

  // Shape: SHAPE_MULT_COLOR ratio
  const userSh = SHAPE_MULT_COLOR[query.shape] ?? 1;
  const compSh = SHAPE_MULT_COLOR[compRow.shape] ?? 1;
  const logShape = Math.log(compSh > 0 ? userSh / compSh : 1);

  // Carat: use spline if available, else power-law fallback
  const logCarat = getCaratAdjustmentLog(query, compRow);

  // Sum in log space
  const logAdjustedDpc = logBase + logIntensity + logClarity + logShape + logCarat;
  const adjustedDpc = Math.exp(logAdjustedDpc);

  // Final price
  const estimatedTotal = Math.round(adjustedDpc * userCt);

  // Uncertainty estimate: each modifier has an associated sigma
  const sigmaPct = estimateModifierUncertainty(intensityMult, clarU / clarC, userSh / compSh, userCt / compCt);

  return {
    combined: Math.exp(logIntensity + logClarity + logShape + logCarat),
    estimated: estimatedTotal,
    estimatedLow: Math.round(estimatedTotal * (1 - sigmaPct)),
    estimatedHigh: Math.round(estimatedTotal * (1 + sigmaPct)),
    parts: buildPartsArray(intensityMult, clarU / clarC, userSh / compSh, Math.exp(logCarat), query, compRow),
  };
}

function getCaratAdjustmentLog(query, compRow) {
  // If we have a family spline, use it. Otherwise fall back to power law.
  const spline = getFamilySpline(query.colorFamily_key, query.shape);
  if (spline) {
    const targetDpc = Math.exp(spline(Math.log(query.carat)));
    const compDpc = Math.exp(spline(Math.log(compRow.carat || 1)));
    return compDpc > 0 ? Math.log(targetDpc / compDpc) : 0;
  }
  // Fallback: power law in log space
  const exponent = getFancyCaratExponent(query.colorFamily_key);
  return (exponent - 1) * Math.log(query.carat / (compRow.carat || 1));
}
```

#### 2d. Better carat exponent: derive it from FANCY_COLOR_BASE.scale

The `scale` property in `FANCY_COLOR_BASE` already encodes how fast total price grows with carat. Total price at ct = `ws1 × ct^scale`, so $/ct = `ws1 × ct^(scale-1)`. The log-carat to log($/ct) slope is `(scale - 1)`.

The current code uses a flat `1.5` exponent for total price. That corresponds to a `0.5` slope for $/ct. But your actual data shows:
- `pink_fv: scale = 0.88` → $/ct **decreases** with carat at slope `-0.12`
- `yellow_fi: scale = 1.00` → $/ct is flat with carat
- `red_f: scale = 1.20` → $/ct **increases** with carat at slope `+0.20`

Using `1.5` for all families is wrong for everything except near-`scale = 2.5`. Replace:

```js
function getFancyCaratExponent(familyKey) {
  const base = FANCY_COLOR_BASE[familyKey];
  // We want the $/ct slope: price = ws1 * ct^scale, $/ct = ws1 * ct^(scale-1)
  // Log-log slope of $/ct vs ct = (scale - 1)
  return base ? (base.scale - 1) : -0.10; // conservative default
}
```

---

## Part 3 — Generalizable Comp Selection Algorithm

Here's the unified approach that works for both white and fancy stones, bigger-to-smaller and smaller-to-bigger:

### Composite comparability score

```js
function computeCompScore(query, row) {
  // 1. Carat distance (normalized by query carat to be scale-invariant)
  const caratDist = Math.abs(query.carat - (row.carat || 0));
  const relCaratDist = caratDist / query.carat; // 0 = perfect, 1 = 100% off

  // 2. Clarity
  const clarU = CLARITY_RANK_NUM[query.clarity] ?? 2;
  const clarC = CLARITY_RANK_NUM[row.clarity] ?? 2;
  const clarDist = Math.abs(clarU - clarC);

  // 3. Color (different logic for white vs fancy)
  let colorDist = 0;
  if (query.colorFamily === 'white') {
    colorDist = whiteColorDistance(query, row) / 5; // normalize to 0–1
  } else {
    const userRank = INTENSITY_RANK[query.colorFamily_key] ?? 2;
    const compKey = inferFancyFamilyKey(row.color);
    const compRank = INTENSITY_RANK[compKey] ?? 2;
    let d = Math.abs(userRank - compRank);
    if (row.color?.toLowerCase().match(/brownish|greyish|purplish/)) d += 1.5;
    colorDist = d / 3; // normalize: vivid→light is 3 steps
  }

  // 4. Shape
  const sameShape = shapeMatches(query.shape, row.shape);
  // related shapes get half penalty (e.g. emerald ↔ radiant for step cuts)
  const relatedShape = isRelatedShape(query.shape, row.shape);
  const shapeDist = sameShape ? 0 : relatedShape ? 0.4 : 1.0;

  // 5. Weighted sum — tune these weights empirically
  const score = (
    relCaratDist * 0.40 +   // carat: 40% — relative distance, so 1ct vs 2ct = same as 2ct vs 4ct
    colorDist    * 0.30 +   // color/intensity: 30%
    clarDist     * 0.15 +   // clarity: 15% (steps 0–5)
    shapeDist    * 0.15     // shape family: 15%
  );

  // 6. Confidence bonus: high-confidence comps get a small advantage
  const confBonus = { high: -0.02, 'medium-high': -0.01, medium: 0, low: 0.05 };
  return score + (confBonus[row.confidence] ?? 0);
}

function isRelatedShape(a, b) {
  const STEP_CUTS = new Set(['emerald', 'asscher', 'radiant', 'sq_radiant']);
  const ROUND_FAMILY = new Set(['round', 'oval', 'cushion', 'moval']);
  const POINTED = new Set(['pear', 'marquise', 'heart', 'trilliant']);
  for (const group of [STEP_CUTS, ROUND_FAMILY, POINTED]) {
    if (group.has(a) && group.has(b)) return true;
  }
  return false;
}
```

**For the 3.80ct vivid pink VVS2 cut-cornered rectangular query**, here's how the pink comps from your data rank:

| Comp | relCarat | colorDist | clarDist | shapeDist | **Score** |
|---|---|---|---|---|---|
| Heart FVP 2.08ct VVS2 | (1.72/3.8)=0.45 ×0.4=**0.18** | 0 | 0 | 1.0 ×0.15=**0.15** | **0.33** |
| Cushion FP 4.13ct VS1 | (0.33/3.8)=0.09 ×0.4=**0.04** | (2→0 vivid)=0.67 ×0.30=**0.20** | 1 ×0.15=**0.15** | 1.0 ×0.15=**0.15** | **0.54** |
| Pear FIP 1.55ct VS1 | (2.25/3.8)=0.59 ×0.4=**0.24** | (1 step)=0.33 ×0.30=**0.10** | 1 ×0.15=**0.15** | 1.0 ×0.15=**0.15** | **0.64** |
| Radiant FIBrownishP 0.89ct VS2 | (2.91/3.8)=0.77 ×0.4=**0.31** | (0→1+1.5 brn)=0.83 ×0.30=**0.25** | 1 ×0.15=**0.15** | (related) 0.4 ×0.15=**0.06** | **0.77** |
| Princess FLP 3.03ct VS1 | (0.77/3.8)=0.20 ×0.4=**0.08** | (3 steps)=1.0 ×0.30=**0.30** | 1 ×0.15=**0.15** | 1.0 ×0.15=**0.15** | **0.68** |
| Emerald FIP 1.06ct VS1 | (2.74/3.8)=0.72 ×0.4=**0.29** | (1 step)=0.33 ×0.30=**0.10** | 1 ×0.15=**0.15** | (related) 0.4 ×0.15=**0.06** | **0.60** |

**Heart at 2.08ct VVS2 Fancy Vivid Pink wins with score 0.33** — correctly identified as the best comp.

---

## Part 4 — Multi-Comp Blending

Rather than picking one comp and applying all modifiers, blend multiple comps with weights based on comparability score:

```js
function blendComps(query, topComps) {
  if (!topComps.length) return null;

  const scored = topComps.map(row => {
    const score = computeCompScore(query, row);
    const modifiers = applyFancyModifiersV2(query, row); // or applyWhiteModifiersV2
    return { row, score, modifiers };
  });

  // Weights: exponential decay on score (closer = exponentially more weight)
  const weights = scored.map(c => Math.exp(-3 * c.score));
  const totalW = weights.reduce((a, b) => a + b, 0);

  const blendedEstimate = Math.round(
    scored.reduce((sum, c, i) => sum + c.modifiers.estimated * weights[i], 0) / totalW
  );

  // Uncertainty: weighted spread of estimates
  const estimates = scored.map(c => c.modifiers.estimated);
  const spread = Math.max(...estimates) - Math.min(...estimates);
  const spreadPct = blendedEstimate > 0 ? spread / blendedEstimate : 0;

  return {
    estimate: blendedEstimate,
    lowBound: Math.round(blendedEstimate * (1 - spreadPct * 0.5)),
    highBound: Math.round(blendedEstimate * (1 + spreadPct * 0.5)),
    primaryComp: scored[0], // highest-weight comp for display
    compCount: scored.length,
  };
}
```

For the 3.80ct stone, blending the heart ($770 × extrapolation) and cushion ($1,471 × corrections) gives a range that's defensible and shows the user the spread.

---

## Summary of Changes

| Component | Current | Proposed |
|---|---|---|
| Fancy comp filter | Hue-only family check | Intensity-ranked + brownish/modifier penalty |
| Scorer | Flat linear distance | Normalized relative distance, intensity-aware |
| Carat extrapolation | Power law `ct^1.5` | Family-specific exponent from `scale` field; monotone spline when knots exist |
| Intensity multiplier | Both sides at `query.carat` | User side at `userCt`, comp side at `compCt` |
| Price output | Single point estimate | Point + low/high band from modifier uncertainty |
| Multi-comp | Score-weighted average of already-adjusted prices | Exponentially-weighted blend of independently adjusted estimates |
| $/ct plausibility | Not checked | Gate on ratio vs expected family $/ct |

### Immediate wins (low effort, high impact)

1. **Add intensity rank to scorer** — 2-hour change, fixes the brownish-pink-radiant problem immediately.
2. **Fix `fancyIntensityMult` to use comp carat on comp side** — 10-line change, stops compounding carat/intensity error.
3. **Change caratMult exponent to use `FANCY_COLOR_BASE.scale - 1`** — 3-line change, correct for all families.
4. **Add $/ct plausibility gate** — filters out implausible comps without touching the rest of the pipeline.

### Medium effort

5. Build monotone spline infrastructure + per-family knot tables from your existing data.
6. Implement `computeCompScore` as a drop-in replacement for `scoreCandidate` for fancy queries.

### Longer term

7. Feed actual observed Alibaba $/ct data into spline knots as you capture more comps.
8. Track prediction accuracy to empirically tune the weights.
