# Comp Engine v2 — Unified Design Proposal

**Problem areas addressed:**
1. Comparable-stone selection is broken for fancy color (and for large/rare sizes of white stones)
2. Price extrapolation math compounds errors geometrically when stretching across carat/intensity/clarity gaps
3. No formal shape taxonomy → cross-shape broadening can surface nonsensical comps
4. White diamond carat scaling has the same power-law problem as fancy color
5. Single-comp estimates give no indication of confidence or spread

This document fully specifies a drop-in replacement for `§3 filterCandidates`, `§4 scoreCandidate`, `§6 findNearestComps`, `§7 findAbsoluteBestComps`, and `§8 applyFancyModifiers`/`applyWhiteModifiers` that fixes all of the above in a way that generalizes to any stone.

---

## Part 0 — Shape Taxonomy

Before scoring, we need a formal grammar for "how similar are two shapes?" The current engine treats shape as binary (same = 0, different = 3.0 penalty). This misses that a radiant is far closer to an emerald than to a round, or that a marquise and pear are in the same pointed-fancy family.

### Shape families

```js
const SHAPE_FAMILIES = {
  ROUND_FAMILY:  new Set(['round', 'oval', 'cushion', 'cushion_brilliant', 'square_cushion',
                          'elongated_cushion', 'moval']),
  STEP_ADJACENT: new Set(['radiant', 'sq_radiant', 'emerald', 'asscher', 'flanders',
                          'portuguese', 'baguette', 'carre']),
  POINTED_FANCY: new Set(['pear', 'marquise', 'heart', 'trilliant']),
  SPECIALTY:     new Set(['hexagonal', 'hexagonal_dutch', 'half_moon', 'shield',
                          'rose', 'briolette', 'old_european', 'old_mine']),
};

/** shapeGroupOf — returns the family key for a normalized shape, or null for uncategorized. */
function shapeGroupOf(shape) {
  for (const [key, set] of Object.entries(SHAPE_FAMILIES)) {
    if (set.has(shape)) return key;
  }
  return null;
}

/** shapeDistance — 0 = same, 0.4 = same family, 1.0 = different family. */
function shapeDistance(a, b) {
  const na = normalizeShapeForComp(a);
  const nb = normalizeShapeForComp(b);
  if (na === nb) return 0;
  const ga = shapeGroupOf(na);
  const gb = shapeGroupOf(nb);
  if (ga && gb && ga === gb) return 0.4;
  return 1.0;
}
```

### "Cut Cornered Rectangular Modified Brilliant" handling

IGI and GIA use this label for what is effectively a **radiant with trimmed corners** — brilliant faceting, elongated, step-adjacent but not step-cut. It maps to the `STEP_ADJACENT` family alongside emerald and radiant.

```js
// Add to SHAPE_NORMALIZE (maps app shape key → index shape key)
'cut_cornered_rectangular':        'radiant',
'cut_cornered_square':             'sq_radiant',
'rectangular_modified_brilliant':  'radiant',
'square_modified_brilliant':       'sq_radiant',
```

The IGI PDF notes "~13% below round comps" for this cut — consistent with `SHAPE_MULT_COLOR['radiant'] = 1.02` (fancy, cushion-baseline) and `SHAPE_MULT_WHITE['radiant'] = 0.87` (white, round-baseline ≈ 13% below). No new multiplier needed; the existing table is correct.

---

## Part 1 — Better Comp Selection

### What's broken today

For the **3.80ct Fancy Vivid Pink VVS2 cut-cornered rectangular** stone, this surfaces the 0.89ct Fancy Intense Brownish Pink Radiant VS2 at $262 as the nearest comp. The actual best candidates from the data:

| Shape | Color | Carat | Clarity | Price | $/ct | Why better |
|---|---|---|---|---:|---:|---|
| Heart | Fancy Vivid Pink | 2.08 | VVS2 | $770 | $370 | Same intensity + same clarity, 1.72ct gap |
| Cushion | Fancy Pink | 4.13 | VS1 | $1,471 | $356 | Closest carat (0.33ct gap), one clarity step |
| Pear | Fancy Intense Pink | 1.55 | VS1 | $534 | $345 | One intensity step, 2.25ct gap |
| Emerald | Fancy Intense Pink | 1.06 | VS1 | $331 | $312 | Same shape family (STEP_ADJACENT), one intensity step |
| Princess | Fancy Light Pink | 3.03 | VS1 | $1,126 | $372 | Close carat, three intensity steps |
| Radiant | Fancy Intense Brownish Pink | 0.89 | VS2 | $262 | $294 | **Currently chosen — wrong** |

The heart at 2.08ct is the correct anchor: same intensity, same clarity, 1.72ct gap, and it has a corroborating vivid-pink heart ladder (`10000038791251`).

### Root causes

**1. Intensity is not scored — only the hue is checked.**
`fancyColorCompatible()` returns `true` for any pink regardless of intensity tier. Jumping from vivid to brownish-intense is a different market tier with no penalty in the current scorer.

**2. `colorDist` is hardcoded to 0 for fancy stones.**
`scoreCandidate` sets `colorDist = query.colorFamily === 'white' ? whiteColorDistance(...) : 0`. Fancy color gets zero color distance no matter the intensity gap.

**3. Shape distance is binary — and actually helps the wrong comp.**
The brownish-pink radiant is in the same `STEP_ADJACENT` family as the query shape (cut-cornered rectangular → radiant), so it gets `shapePenalty = 0`. Meanwhile the heart (POINTED_FANCY) gets `shapePenalty = 3.0`. The binary penalty reverses the correct ranking.

**4. Carat distance is absolute, not relative.**
A 1ct gap scores the same at 0.5ct (200% off) as at 5ct (20% off). For sparse fancy markets the tie-breaker is lowest price, which surfaces tiny cheap stones.

**5. No $/ct plausibility check.**
A 0.89ct stone at $294/ct extrapolated to 3.8ct via `(3.8/0.89)^1.5 ≈ 8.82×` is implausible and unchecked.

### Solution: unified normalized composite score

Replace `scoreCandidate` with a fully normalized composite that works for both white and fancy, bidirectionally for any size gap:

```js
/**
 * INTENSITY_RANK — ordinal rank for fancy color intensity tiers.
 * Lower = more saturated. Distance between ranks = market-tier steps.
 */
const INTENSITY_RANK = {
  // Pink
  pink_fv: 0, pink_fi: 1, pink_f: 2, pink_fl: 3,
  // Yellow
  yellow_fv: 0, yellow_fi: 1, yellow_f: 2, yellow_fl: 3,
  // Blue
  blue_fv: 0, blue_fi: 1, blue_f: 2, blue_fl: 3,
  // Green
  green_fv: 0, green_fi: 1, green_f: 2, green_fl: 3,
  // Orange
  orange_fv: 0, orange_fi: 1, orange_f: 2, orange_fl: 3,
  // Red (compressed — vivid and non-vivid only)
  red_fv: 0, red_f: 1, red_purp: 2,
  // Purple/Violet
  purple_fi: 0, purple_f: 1, purple_fl: 2,
  // Brown / Black (no vivid tier)
  brown_f: 0, black: 0,
};

/**
 * computeCompScore — normalized composite distance.
 *
 * All axes normalized to [0, 1] before weighting so weights are intuitive fractions:
 *
 *   Axis             Weight  Notes
 *   ──────────────── ──────  ───────────────────────────────────────────────────────
 *   Relative carat    0.40   |query.ct − comp.ct| / query.ct — capped at 1.0
 *   Color/intensity   0.30   intensity steps/3 for fancy; grade steps/8 for white
 *   Clarity           0.15   step difference / 5
 *   Shape family      0.15   0 same, 0.4 same family, 1.0 different family
 *
 * Confidence bonus: high=−0.02, medium-high=−0.01, low=+0.05
 * Modifier penalty: brownish/greyish/blackish adds 0.5 to intensity distance (pre-norm, capped at 1)
 *
 * Score ≤ 0.35 = direct comp (small modifiers expected)
 * Score 0.35–0.65 = extrapolated (flag modifier chain to user)
 * Score > 0.65 = poor comp (last-resort only, wide uncertainty band)
 */
function computeCompScore(query, row) {
  // 1. Relative carat distance
  let caratDist;
  if (row.caratBand && row.caratMin != null && row.caratMax != null) {
    caratDist = Math.max(0, row.caratMin - query.carat, query.carat - row.caratMax);
  } else {
    caratDist = Math.abs(query.carat - (row.carat || 0));
  }
  const relCaratDist = Math.min(1.0, caratDist / query.carat);

  // 2. Color / intensity distance (normalized)
  let colorRaw;
  if (query.colorFamily === 'white') {
    const uR = WHITE_COLOR_GRADE_NUM[query.whiteGrade] ?? 2;
    const cR = WHITE_COLOR_GRADE_NUM[row.colorNormalized || 'D'] ?? 0;
    colorRaw = Math.abs(uR - cR) / 8.0;
  } else {
    const userRank = INTENSITY_RANK[query.colorFamily_key] ?? 2;
    const compKey  = inferFancyFamilyKey(row.color);
    const compRank = INTENSITY_RANK[compKey] ?? 2;
    let d = Math.abs(userRank - compRank);
    if (row.color?.toLowerCase().match(/brownish|greyish|blackish/)) d += 0.5;
    colorRaw = Math.min(1.0, d / 3.0);
  }

  // 3. Clarity distance
  const clarU = CLARITY_RANK_NUM[query.clarity] ?? 2;
  const clarC = CLARITY_RANK_NUM[row.clarity ?? ''] ?? 2;
  const clarDist = Math.min(1.0, Math.abs(clarU - clarC) / 5.0);

  // 4. Shape distance (uses shape taxonomy from Part 0)
  const shapeDist = shapeDistance(query.shape, row.shape);

  // 5. Band penalties (uncertainty surcharge for imprecise rows)
  const bandSurcharge = (row.caratBand ? 0.02 : 0) + (row.clarityBand ? 0.03 : 0);

  // 6. Weighted sum
  const score = (
    relCaratDist * 0.40 +
    colorRaw     * 0.30 +
    clarDist     * 0.15 +
    shapeDist    * 0.15 +
    bandSurcharge
  );

  // 7. Confidence adjustment
  const confBonus = { high: -0.02, 'medium-high': -0.01, medium: 0, low: 0.05 };
  return Math.max(0, score + (confBonus[row.confidence] ?? 0));
}
```

### Scoring the 3.80ct vivid pink VVS2 query

Query shape = `radiant` (cut-cornered rectangular maps to radiant via `SHAPE_NORMALIZE`).

| Comp | relCarat×0.4 | color×0.3 | clarity×0.15 | shape×0.15 | **Score** |
|---|---|---|---|---|---|
| Heart FVP 2.08ct VVS2 | 1.72/3.8=0.45→**0.18** | 0 steps→**0.00** | 0 steps→**0.00** | POINTED≠STEP→1.0→**0.15** | **0.33** ✓ |
| Cushion FP 4.13ct VS1 | 0.33/3.8=0.09→**0.04** | 2 steps→**0.20** | 1 step→**0.03** | diff fam→**0.15** | **0.42** |
| Emerald FIP 1.06ct VS1 | 2.74/3.8=0.72→**0.29** | 1 step→**0.10** | 1 step→**0.03** | STEP_ADJ same→0.4→**0.06** | **0.48** |
| Pear FIP 1.55ct VS1 | 2.25/3.8=0.59→**0.24** | 1 step→**0.10** | 1 step→**0.03** | diff fam→**0.15** | **0.52** |
| Princess FLP 3.03ct VS1 | 0.77/3.8=0.20→**0.08** | 3 steps=1.0→**0.30** | 1 step→**0.03** | diff fam→**0.15** | **0.56** |
| Radiant FIBrownishP 0.89ct VS2 | 2.91/3.8=0.77→**0.31** | 1+0.5brn=1.0→**0.30** | 1→**0.03** | STEP same→0.4→**0.06** | **0.70** ✗ |

**Heart wins with score 0.33.** Brownish-pink radiant is correctly last at 0.70.

### Updated score tiers and thresholds

```js
const COMP_SCORE_TIERS = {
  DIRECT:      0.35, // near-exact — tiny modifiers, high confidence
  EXTRAPOLATE: 0.65, // reliable extrapolation — show modifier chain
  FALLBACK:    1.00, // poor comp — show wide uncertainty band
  // > 1.00: reject
};
```

### Updated candidate filter

Keep the existing hue-family filter, add an intensity-gate for fancy:

```js
function filterCandidates(query, comps) {
  return comps.filter(row => {
    if (row.colorFamily !== query.colorFamily) return false;
    if (query.colorFamily === 'white' && !whiteColorCompatible(query, row)) return false;
    if (query.colorFamily === 'fancy') {
      if (!fancyColorCompatible(query, row)) return false;
      // NEW: reject if intensity gap > 3.5 steps (vivid→light=3; brownish penalty adds 0.5)
      const userRank = INTENSITY_RANK[query.colorFamily_key] ?? 2;
      const compKey  = inferFancyFamilyKey(row.color);
      const compRank = INTENSITY_RANK[compKey] ?? 2;
      let d = Math.abs(userRank - compRank);
      if (row.color?.toLowerCase().match(/brownish|greyish|blackish/)) d += 0.5;
      if (d > 3.5) return false;
    }
    return true;
  });
}
```

### Cross-shape broadening for findAbsoluteBestComps

When same-shape candidates are exhausted, broaden by shape family before opening to any shape:

```js
function broadenCandidates(query, comps) {
  const myFamily = shapeGroupOf(normalizeShapeForComp(query.shape));
  // Phase 1: same color + same shape family
  let candidates = comps.filter(row => {
    if (row.colorFamily !== query.colorFamily) return false;
    if (query.colorFamily === 'fancy' && !fancyColorCompatible(query, row)) return false;
    return myFamily && shapeGroupOf(row.shape) === myFamily;
  });
  if (candidates.length >= 2) return candidates;
  // Phase 2: same color + any shape (still hue-filtered for fancy)
  return comps.filter(row => {
    if (row.colorFamily !== query.colorFamily) return false;
    if (query.colorFamily === 'fancy' && !fancyColorCompatible(query, row)) return false;
    return true;
  });
}
```

---

## Part 2 — Better Pricing Math

### What's broken today

The modifier stack multiplies independent ratios:

```
price = comp.price × intensityMult × clarityMult × shapeMult × caratMult
```

For the 3.80ct stone using the 0.89ct brownish-pink comp:
- `caratMult = (3.80/0.89)^1.5 ≈ 8.82` ← 8× lever arm
- `intensityMult = 1.48`
- `clarityMult = 1.09`
- **result = $262 × 8.82 × 1.48 × 1.09 ≈ $3,733**

Three compounding errors: wrong comp, wrong carat exponent, wrong intensity evaluation. Multiplied together they blow up geometrically.

### 2a. Log-space additive model (works in $/ct, not total price)

The natural variable is **price per carat**, not total price. Every correction is a ratio in $/ct space. Adding log-ratios is equivalent to multiplying ratios, but in log space errors are additive so uncertainty can be tracked:

```js
function applyModifiersV2(query, compRow) {
  const userCt = query.carat;
  const compCt  = compRow.carat || 1;
  const compDpc = compRow.priceUsd / compCt;   // start from $/ct, not total price

  const logIntensity = logIntensityCorrection(query, compRow, userCt, compCt);
  const logClarity   = logClarityCorrection(query, compRow, userCt);
  const logShape     = logShapeCorrection(query, compRow);
  const logCarat     = logCaratCorrection(query, compRow);

  const adjDpc       = compDpc * Math.exp(logIntensity + logClarity + logShape + logCarat);
  const estimatedTotal = Math.round(adjDpc * userCt);

  const { sigmaLog, label } = estimateUncertainty(
    query, compRow, logIntensity, logClarity, logShape, logCarat);
  const band = Math.exp(sigmaLog);

  return {
    estimated:     estimatedTotal,
    estimatedLow:  Math.round(estimatedTotal / band),
    estimatedHigh: Math.round(estimatedTotal * band),
    adjDpc:        Math.round(adjDpc),
    parts:         buildPartsArray(logIntensity, logClarity, logShape, logCarat, query, compRow),
    bandLabel:     label,   // e.g. '±22%'
  };
}
```

### 2b. Intensity correction: evaluate at respective carats (not both at query.carat)

**Current bug:** `fancyIntensityMult()` evaluates both the user and comp family at `query.carat`:

```js
// CURRENT (wrong):
const uWs = ub.ws1 * Math.pow(ct, ub.scale - 1);  // ct = query.carat
const cWs = cb.ws1 * Math.pow(ct, cb.scale - 1);  // same ct for both sides
```

This conflates "how much more does vivid cost than intense at 3.8ct" with "what did the 0.89ct comp actually represent at its own size." Fix: evaluate each family at its own carat:

```js
function logIntensityCorrection(query, compRow, userCt, compCt) {
  if (query.colorFamily === 'white') return 0;
  const ub = FANCY_COLOR_BASE[query.colorFamily_key];
  const compKey = inferFancyFamilyKey(compRow.color);
  const cb = compKey ? FANCY_COLOR_BASE[compKey] : null;
  if (!ub || !cb) return 0;
  // Evaluate each family at its own stone's carat
  const uDpc = ub.ws1 * Math.pow(userCt, ub.scale - 1);   // user family $/ct at user size
  const cDpc = cb.ws1 * Math.pow(compCt, cb.scale - 1);   // comp family $/ct at comp size
  return cDpc > 0 ? Math.log(uDpc / cDpc) : 0;
}
```

For vivid pink 3.8ct vs intense brownish-pink 0.89ct:
- `uDpc = 500 × 3.8^{−0.12} ≈ $428/ct`
- `cDpc = 330 × 0.89^{−0.10} ≈ $342/ct`
- `ratio = 428/342 ≈ 1.25` vs the current inflated 1.48

### 2c. Carat scaling: family-specific exponent, not a flat power law

The `FANCY_COLOR_BASE.scale` encodes how total price grows with carat:

$$\text{price}(ct) = ws_1 \cdot ct^{\,\text{scale}}, \quad \frac{\text{price}}{ct} = ws_1 \cdot ct^{\,(\text{scale}-1)}$$

The log–log slope of $/ct vs carat is $(\text{scale} - 1)$:

| Family | scale | $/ct slope | Meaning |
|---|---|---|---|
| `pink_fv` | 0.88 | −0.12 | $/ct **decreases** as stone gets larger |
| `yellow_fi` | 1.00 | 0.00 | $/ct is **flat** with carat |
| `red_f` | 1.20 | +0.20 | $/ct **increases** — rarity premium grows fast |

Current code uses `ct^1.5` — that implies a $/ct slope of +0.5, which is wrong for every family. Replace:

```js
function logCaratCorrection(query, compRow) {
  const userCt = query.carat, compCt = compRow.carat || 1;
  if (Math.abs(userCt - compCt) < 0.05) return 0;

  // 1. Family spline if available (most accurate)
  const spline = getFamilySpline(query.colorFamily_key ?? 'white');
  if (spline) {
    return spline(Math.log(userCt)) - spline(Math.log(compCt));
  }

  // 2. Family-specific exponent from FANCY_COLOR_BASE
  if (query.colorFamily === 'fancy') {
    const base  = FANCY_COLOR_BASE[query.colorFamily_key];
    const slope = base ? (base.scale - 1) : -0.10;
    return slope * Math.log(userCt / compCt);
  }

  // 3. White: use per-clarity carat knots (getClarityMult evaluated at two carats)
  const mUser = getClarityMult(query.clarity, userCt);
  const mComp = getClarityMult(query.clarity, compCt);
  return mComp > 0 ? Math.log(mUser / mComp) : 0;
}
```

#### White diamond fix: use clarity knot tables, not `ct^1.8`

The `CLARITY_CARAT_MULTS_W` table already encodes the empirical $/ct-vs-carat curve per clarity grade. For a VVS1 stone going from 1ct to 3ct the ratio `mults_W['VVS1'][idx_3ct] / mults_W['VVS1'][idx_1ct]` is a far better estimate than `(3/1)^1.8 = 3.48×`. Using `logCaratCorrection` above (case 3) does this correctly without touching the existing table.

### 2d. Monotone cubic spline for $/ct vs carat

When multiple anchor points exist for a family, fit a spline in log-log space to capture non-linear $/ct curves:

```js
/**
 * monotoneCubicSpline — Fritsch-Carlson method.
 * Input/output in log space (pass log(carat), receive log($/ct)).
 */
function monotoneCubicSpline(xs, ys) {
  const n = xs.length;
  const d = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i+1] - ys[i]) / (xs[i+1] - xs[i]);
  const m = new Array(n);
  m[0] = d[0]; m[n-1] = d[n-2];
  for (let i = 1; i < n-1; i++) {
    if (d[i-1] * d[i] <= 0) { m[i] = 0; continue; }
    const h0 = xs[i]-xs[i-1], h1 = xs[i+1]-xs[i];
    m[i] = (3*(h0+h1)) / ((2*h1+h0)/d[i-1] + (h0+2*h1)/d[i]);
  }
  return function(x) {
    if (x <= xs[0])    return ys[0]    + m[0]    * (x - xs[0]);     // linear extrapolation
    if (x >= xs[n-1])  return ys[n-1]  + m[n-1]  * (x - xs[n-1]);
    let lo = 0, hi = n-1;
    while (hi-lo > 1) { const mid=(lo+hi)>>1; xs[mid]<=x ? lo=mid : hi=mid; }
    const h = xs[hi]-xs[lo], t = (x-xs[lo])/h, t2=t*t, t3=t2*t;
    return (2*t3-3*t2+1)*ys[lo] + (t3-2*t2+t)*h*m[lo]
         + (-2*t3+3*t2)*ys[hi]  + (t3-t2)*h*m[hi];
  };
}
```

#### Seeding splines from existing comp data

The comp index already has multiple price points per family. These seed the splines immediately:

```js
const FAMILY_SPLINE_KNOTS = {
  // Pink vivid — heart ladder (10000038791251) + mixed-shapes comps
  pink_fv: { carats: [1.00, 2.08, 3.00, 4.00], dollarPerCt: [200, 370, 257, 255] },
  // Pink intense — pear/emerald comps
  pink_fi: { carats: [0.89, 1.06, 1.55, 3.00], dollarPerCt: [294, 312, 345, 290] },
  // Pink (base) — cushion 4.13ct (single knot → falls back to FANCY_COLOR_BASE exponent)
  pink_f:  { carats: [4.13], dollarPerCt: [356] },
  // Pink light — princess 3.03ct
  pink_fl: { carats: [3.03], dollarPerCt: [372] },
};

const _splineCache = {};
function getFamilySpline(familyKey) {
  if (_splineCache[familyKey]) return _splineCache[familyKey];
  const knots = FAMILY_SPLINE_KNOTS[familyKey];
  if (!knots || knots.carats.length < 2) return null;  // need ≥ 2 points
  const xs = knots.carats.map(Math.log);
  const ys = knots.dollarPerCt.map(Math.log);
  _splineCache[familyKey] = monotoneCubicSpline(xs, ys);
  return _splineCache[familyKey];
}
```

For the pink_fv spline, the 3.80ct point falls between the 3ct ($257/ct) and 4ct ($255/ct) knots → spline returns ≈ **$256/ct → $972 total**. Far more defensible than $3,733.

### 2e. Uncertainty quantification

Track propagated uncertainty from each modifier axis in log space (additive = quadrature sum):

```js
function estimateUncertainty(query, compRow, logInt, logClar, logShape, logCarat) {
  const userCt = query.carat, compCt = compRow.carat || 1;
  const caratRatio = Math.max(userCt, compCt) / Math.min(userCt, compCt);
  const isWhite = query.colorFamily === 'white';

  // Fractional uncertainty per axis (in log space ≈ fractional error)
  const sigmaInt    = isWhite ? 0 : Math.abs(logInt)  * 0.20;   // 20% of intensity adj
  const sigmaClarity = Math.abs(logClar) * 0.15;                // 15% of clarity adj
  const sigmaShape  = Math.abs(logShape) * 0.10;                // 10% of shape adj
  const sigmaCarat  = (isWhite ? 0.05 : 0.08) + Math.log(caratRatio) * 0.12; // grows with gap

  const sigmaTotal  = Math.sqrt(sigmaInt**2 + sigmaClarity**2 + sigmaShape**2 + sigmaCarat**2);
  const bandPct     = Math.round((Math.exp(sigmaTotal) - 1) * 100);
  return { sigmaLog: sigmaTotal, label: `±${bandPct}%` };
}
```

---

## Part 3 — Generalizable Pipeline

### Unified findBestComps

Replaces both `findNearestComps` and `findAbsoluteBestComps` with a single tiered function:

```js
/**
 * findBestComps — generalized ranked comp selection.
 * Works for white and fancy, any carat direction, any shape.
 *
 * @param {object} query
 * @param {Array}  comps
 * @param {number} maxN     — number of comps to return (default 4)
 * @param {number} cutoff   — max acceptable score (default FALLBACK = 1.00)
 */
function findBestComps(query, comps, maxN = 4, cutoff = COMP_SCORE_TIERS.FALLBACK) {
  let candidates = filterCandidates(query, comps);
  if (candidates.length < 2) candidates = broadenCandidates(query, comps);

  const scored = candidates
    .map(row => ({ row, score: computeCompScore(query, row) }))
    .filter(c => c.score <= cutoff)
    .sort((a, b) => a.score - b.score || a.row.priceUsd - b.row.priceUsd);

  const seenPid = new Set();
  const result  = [];
  for (const c of scored) {
    if (!seenPid.has(c.row.productId)) {
      seenPid.add(c.row.productId);
      const tier =
        c.score <= COMP_SCORE_TIERS.DIRECT      ? 'direct' :
        c.score <= COMP_SCORE_TIERS.EXTRAPOLATE ? 'extrapolated' : 'fallback';
      result.push({ ...c, tier });
      if (result.length >= maxN) break;
    }
  }
  return result;
}
```

### Multi-comp blending

Rather than picking one comp and stacking all modifiers on it, derive an independent estimate from each comp and then blend. This is more robust because:
- Single-comp estimates have a lever-arm problem: one bad modifier on the anchor propagates fully
- Multiple estimates from different anchor points give an empirical spread = a natural confidence band
- When comps agree → tight band; when they disagree → wide band, which is the honest signal

```js
/**
 * blendEstimates — exponentially-weighted blend of independent per-comp estimates.
 *
 * Weight = exp(−5 × score): score 0.0 → weight 1.00, score 0.5 → weight 0.08.
 * The exponential decay ensures the best comp dominates while secondary comps
 * trim extreme outliers and contribute to the uncertainty band.
 */
function blendEstimates(query, bestComps) {
  if (!bestComps.length) return null;

  const withMods = bestComps.map(({ row, score, tier }) => {
    const mods   = applyModifiersV2(query, row);
    const weight = Math.exp(-5 * score);
    return { row, score, tier, mods, weight };
  });

  const totalW     = withMods.reduce((s, c) => s + c.weight, 0);
  const blendedEst = Math.round(
    withMods.reduce((s, c) => s + c.mods.estimated * c.weight, 0) / totalW
  );

  // Uncertainty: max of (primary modifier sigma) and (inter-comp spread × 0.5)
  const primary  = withMods[0];
  const allEsts  = withMods.map(c => c.mods.estimated);
  const spread   = allEsts.length > 1
    ? (Math.max(...allEsts) - Math.min(...allEsts)) / blendedEst
    : 0;
  const modBand  = Math.exp(primary.mods.sigmaLog ?? 0.20) - 1;
  const finalBand = Math.max(modBand, spread * 0.5);

  return {
    estimate:      blendedEst,
    estimatedLow:  Math.round(blendedEst * (1 - finalBand)),
    estimatedHigh: Math.round(blendedEst * (1 + finalBand)),
    primaryComp:   primary,
    supportComps:  withMods.slice(1),
    compCount:     withMods.length,
    bandPct:       Math.round(finalBand * 100),
  };
}
```

### Updated resolveAlibabaComp pipeline

```
1. Exact match (carat ± tolerance, same clarity, exact color)
        ↓ miss
2. findBestComps(cutoff=DIRECT=0.35) + blendEstimates → matchType 'nearest'
        ↓ miss
3. findBestComps(cutoff=EXTRAPOLATE=0.65) + blendEstimates → matchType 'extrapolated'
        ↓ miss
4. findBestComps(cutoff=FALLBACK=1.00) + blendEstimates → matchType 'best_available'
   └─ specialty shapes with no real index rows skip step 4 → matchType 'none'
        ↓ miss
5. matchType 'none'
```

`SPECIALTY_SHAPE_KEYS` guard moves: shapes with actual index rows (portuguese, moval) can still hit exact/nearest; the guard only prevents the catch-all fallback from pulling cross-shape comps for shapes that genuinely have no meaningful comps.

---

## Part 4 — Case Study: 3.80ct Fancy Vivid Pink VVS2

### Current result
Comp: 0.89ct Fancy Intense Brownish Pink Radiant VS2 @ $262  
Modifiers: carat ×8.82, intensity ×1.48, clarity ×1.09  
**Estimated: $3,733** — wrong

### New result

**filterCandidates**: hue=pink + intensity ≤ 3.5 steps. All 6 pink rows pass.

**computeCompScore** (query shape = `radiant`, normalized from cut-cornered rectangular):

Top 3 selected: Heart (0.33), Cushion (0.42), Emerald (0.48).

**applyModifiersV2 — Heart (2.08ct FVP VVS2, $770 = $370/ct)**

$$\log(\$/ct_{\text{adj}}) = \log(370) + \underbrace{0}_{\text{intensity}} + \underbrace{0}_{\text{clarity}} + \underbrace{\log(1.02/0.96)}_{\text{shape}\;+0.061} + \underbrace{\text{spline}(\log 3.80) - \text{spline}(\log 2.08)}_{\text{carat}\approx -0.370}$$

Adjusted $/ct ≈ 370 × exp(−0.309) ≈ **$272/ct → $1,034 total**  
Uncertainty: carat gap 1.72ct → σ_carat ≈ 0.18; σ_shape ≈ 0.006; total σ ≈ **±19%**

**applyModifiersV2 — Cushion (4.13ct FP VS1, $1,471 = $356/ct)**

- Carat: near-same size, minimal correction ≈ 0
- Intensity: FP(rank 2) → FVP(rank 0) = 2 steps → log(428/356) ≈ +0.184
- Clarity: VVS2 vs VS1 → CLARITY_MULT_COLOR ratio log(1.04/1.00) ≈ +0.039
- Shape: cushion→radiant = 1.02/1.00 → +0.020

Adjusted $/ct ≈ 356 × exp(0.243) ≈ **$452/ct → $1,718 total** | σ ≈ **±16%**

**Blend** (weights: heart 0.192, cushion 0.122, emerald ~0.091):

$$\text{blend} \approx \frac{1034 \times 0.192 + 1718 \times 0.122 + 940 \times 0.091}{0.405} \approx \mathbf{\$1{,}280}$$

Inter-comp spread = (1718 − 940)/1280 = 61%; band = max(19%, 61%×0.5=30%) = **±30%**

**Final: $1,280 ($896 – $1,664)** — a defensible wholesale range for a 3.80ct FVP VVS2 lab-grown diamond.

---

## Part 5 — Summary of Changes

| Component | Current | Proposed |
|---|---|---|
| Shape distance | Binary (same=0, other=3) | Three-level: same=0, same-family=0.4, other=1.0 |
| Shape taxonomy | None | ROUND_FAMILY / STEP_ADJACENT / POINTED_FANCY / SPECIALTY |
| "Cut cornered rectangular" | Not mapped | → `radiant` via SHAPE_NORMALIZE |
| Fancy colorDist in scorer | Hardcoded 0 | Normalized intensity-tier distance × 0.30 weight |
| Carat distance | Absolute | Relative (÷ query.carat), capped at 1.0 |
| Score threshold | Single hard cutoff (5.0) | Three tiered thresholds: DIRECT/EXTRAPOLATE/FALLBACK |
| Intensity rank table | 4 pink entries only | Full table: pink/yellow/blue/green/orange/red/purple/brown |
| Fancy caratMult | `ct^1.5` (flat) | Family-specific `(scale−1)` exponent; or spline where data exists |
| White caratMult | `ct^1.8` (flat) | `getClarityMult` ratio at user vs comp carat |
| Intensity multiplier | Both sides at `query.carat` | User side at `userCt`, comp side at `compCt` |
| Price output | Single point | Point + low/high band from propagated modifier σ |
| Multi-comp | Score-weighted blend | Exponential decay blend of independently adjusted estimates |
| Broadening strategy | Filter → any-shape dump | Filter → same-family → any-shape (still hue-gated for fancy) |
| Uncertainty display | None | `±N%` band on all extrapolated estimates |

---

## Part 6 — Implementation Roadmap

### Immediate (2–4 hours, fixes the pink stone problem)

1. **Add `INTENSITY_RANK` table** (full table from §1 above).
2. **Add `SHAPE_FAMILIES`, `shapeGroupOf`, `shapeDistance`** (from Part 0).
3. **Add `cut_cornered_rectangular` → `radiant` to `SHAPE_NORMALIZE`**.
4. **Replace `scoreCandidate` with `computeCompScore`** — same call signature, drop-in.
5. **Replace `NEAREST_THRESHOLD` / hard cutoff with `COMP_SCORE_TIERS`** in `findNearestComps` and `resolveAlibabaComp`.
6. **Fix `fancyIntensityMult`**: pass `compRow.carat` as second argument; evaluate comp family at comp carat, not query carat.

### Medium (1–2 days)

7. **Implement `applyModifiersV2`** in log-space with the four `log*Correction` helpers.
8. **Implement `monotoneCubicSpline`** and seed `FAMILY_SPLINE_KNOTS` from existing index.
9. **Replace `findNearestComps` + `findAbsoluteBestComps` with `findBestComps`** + update `resolveAlibabaComp` pipeline.
10. **Implement `blendEstimates`** and wire into `resolveAlibabaComp`.
11. **Fix white diamond carat correction** to use `getClarityMult(clarity, userCt) / getClarityMult(clarity, compCt)` instead of `^1.8`.

### Longer term

12. Add knots to `FAMILY_SPLINE_KNOTS` as more Alibaba listings are captured — target 6+ anchor points per family for a well-conditioned spline.
13. Track predicted vs actual prices to empirically calibrate the uncertainty sigmas in `estimateUncertainty`.
14. Surface the `estimatedLow`/`estimatedHigh` band in the UI so buyers see a range, not a false-precision point.
15. Build a 2D $/ct surface (carat × intensity) for yellow and pink once 8+ data points per family are available.

