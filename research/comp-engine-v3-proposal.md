# Comp Engine v3 - Generalizable Adjusted-Comps Plan

**Status:** recommended implementation target.  
**Replaces:** `research/comp-engine-v2-proposal.md`.

## Executive Decision

Do not implement v2 exactly. It correctly identifies the current bugs, especially
the bad 0.89ct brownish-pink radiant fallback, but it still solves the example
too directly. The right general solution is a local adjusted-comps engine:

1. Build a hard-gated candidate universe from normalized stone features.
2. Score comps by expected prediction error after adjustment, not raw visual
   similarity.
3. Estimate from several independently adjusted comps in log price-per-carat
   space.
4. Learn carat, color, clarity, shape, treatment, and source adjustments from
   the comp index whenever enough data exists.
5. Fall back to conservative priors only when data is sparse, and always return
   an uncertainty range.

For the 3.80ct Fancy Vivid Pink VVS2 cut-cornered rectangular stone, the engine
should not pick only the 2.08ct heart or only the 4.13ct cushion. The cushion is
the best carat anchor. The heart is the best intensity/clarity anchor. The
0.89ct brownish radiant should be low-weight or rejected because it requires a
large carat extrapolation plus a color-modifier correction.

## What Was Wrong In v2

### 1. It still over-relies on "the best comp"

v2 says the heart wins with score 0.33 and is the correct anchor. That is not
general enough. In sparse gem markets, the most useful estimate is usually an
ensemble of partially good comps:

| Comp | What it teaches | Main weakness |
| --- | --- | --- |
| 4.13ct cushion Fancy Pink VS1 | Near-size market price around the target carat | Needs intensity and clarity adjustment |
| 2.08ct heart Fancy Vivid Pink VVS2 | Same intensity and clarity | Needs large carat and shape adjustment |
| 1.06ct emerald / 1.55ct pear Fancy Intense Pink VS1 | Corroborates pink-intense pricing | Too small |
| 0.89ct brownish radiant VS2 | Same broad shape family | Too small and color modifier is dirty |

The displayed primary comp can be the lowest-error row, but the price should be
based on a weighted, robust blend.

### 2. Fixed scoring weights are not enough

Weights like carat 0.40, color 0.30, clarity 0.15, shape 0.15 are a good first
patch, but a reusable engine needs dynamic weights. A 0.7ct carat gap is a small
problem for a 5ct white round if there are many nearby ladder rows. It can be a
big problem for a rare 1ct colored stone if there is only one source. The score
should represent expected error after adjustment, learned from backtests and
data density.

### 3. Hard-coded spline knots will overfit

The v2 pink spline is useful as a thought experiment, but the implementation
should never hard-code knots like `pink_fv: [1.00, 2.08, 3.00, 4.00]` by hand.
Knots must be derived from the current comp index, de-duplicated by product and
supplier, outlier-filtered, and tagged with source confidence.

### 4. Independent multipliers miss interactions

Color, carat, clarity, cut, shape, growth, treatment, and certificate are all
factors, but they are not cleanly independent. Examples:

- Clarity premiums grow with carat for white diamonds.
- Clarity matters less in saturated fancy color than in white diamonds.
- Shape premiums differ by color family.
- Step cuts and elongated shapes expose inclusions differently.
- CVD post-growth treatment and "as grown" status affect marketability beyond
  a simple growth label.

The engine should support interactions, even if phase one starts with priors.

### 5. The uncertainty math must be calibrated

v2's uncertainty formulas are reasonable placeholders, but they are arbitrary.
Prediction ranges should be calibrated with grouped backtests so an 80% interval
actually contains roughly 80% of held-out comp rows.

## General Model

Use log price per carat as the modeling target:

```text
logDpc(comp) = log(priceUsd / comp.carat)

logDpc(query from comp) =
  logDpc(comp)
  + deltaCarat
  + deltaColor
  + deltaClarity
  + deltaShapeCut
  + deltaGrowthTreatment
  + deltaCertMarket
```

Then:

```text
estimatedTotal = exp(logDpcEstimate) * query.carat
```

This works whether the comp is bigger or smaller than the query because all
carat moves use `log(query.carat / comp.carat)`.

## Canonical Stone Schema

Every comp row and query should be normalized before matching.

### Hard gates

These should usually not be crossed. If the engine has no valid comps after
these gates, return no comp or a clearly labeled model-only estimate.

| Field | Why |
| --- | --- |
| `gemSpecies` | Diamond, sapphire, ruby, emerald, etc. are separate markets |
| `originType` | Natural vs lab-grown is a hard market split |
| `growthMethod` | CVD vs HPHT can matter for lab diamonds |
| `majorTreatment` | Untreated, heated, irradiated, filled, post-growth treated, etc. |
| `certificateLab` | IGI, GIA, GCAL, uncertified, and seller-only claims differ |
| `marketChannel` | Alibaba wholesale, US retail, auction, memo, estate, etc. |

### Comparable axes

These are adjusted instead of hard-rejected, subject to caps:

| Axis | Representation |
| --- | --- |
| Carat | `log(carat)` and carat band metadata |
| Shape | normalized shape, outline family, faceting family, aspect ratio |
| Cut quality | cut grade when available, polish, symmetry, make notes |
| White color | ordinal rank D-Z |
| Fancy color | hue, intensity, modifier terms like brownish/greyish, saturation proxy |
| Colored-gem color | hue, tone, saturation, origin-specific color descriptors |
| Clarity | ordinal rank plus eye-clean/inclusion notes when available |
| Measurements | length, width, depth, ratio, spread/depth sanity flags |
| Fluorescence | ordinal strength and color when available |
| Source quality | confidence, product id, supplier, capture date, MOQ/range flags |

## Candidate Selection

Selection should answer: "Which comps are expected to produce the lowest
post-adjustment error?"

### Broadening tiers

1. **Exact/near-exact:** same hard gates, same shape or alias, same color family,
   same clarity or one adjacent step, carat within tolerance.
2. **Local same-market:** same hard gates, same hue/family, same shape family,
   reasonable log-carat gap.
3. **Local cross-shape:** same hard gates and color family, different shape but
   known transform exists.
4. **Fallback:** same hard gates and color family, wide carat or shape gap.
   Use only with a wide range and a warning.
5. **No comp:** do not cross species, natural/lab, major treatment, or fancy hue
   just to force an answer.

### Expected-error score

Replace the fixed v2 score with a score that approximates log prediction error:

```js
function compErrorScore(query, row, calibration) {
  const axes = compareAxes(query, row);
  return Math.sqrt(
    axes.caratError ** 2 +
    axes.colorError ** 2 +
    axes.clarityError ** 2 +
    axes.shapeCutError ** 2 +
    axes.treatmentError ** 2 +
    axes.sourceError ** 2 +
    axes.dataDensityError ** 2
  );
}
```

The first version can use seeded defaults, but the names should already match
what they mean:

| Axis | Default behavior |
| --- | --- |
| `caratError` | `abs(log(queryCt / compCt)) * caratSigma(segment)` |
| `colorError` | ordinal grade/intensity gap plus brownish/greyish modifier penalty |
| `clarityError` | clarity gap, with carat and shape interaction |
| `shapeCutError` | same shape low, same family medium, cross-family high, ratio mismatch added |
| `treatmentError` | zero for same, high or hard-reject for major treatment mismatch |
| `sourceError` | confidence, age, MOQ/range, and product-level ambiguity |
| `dataDensityError` | grows when there are few independent rows near the query |

The "most comparable" comp is the row with the lowest expected error. The final
price still comes from the ensemble.

## Adjustment Functions

### Carat transform

Fit a local function for `log($/ct)` against `log(carat)` within the closest
market segment.

Use this priority:

1. **Dynamic local curve:** if there are at least 5 independent knots spanning
   or nearly spanning the query carat, fit robust LOESS or shape-preserving cubic
   interpolation in log-log space.
2. **Segment prior plus shrinkage:** if there are 2-4 independent knots, fit a
   local slope and shrink toward the prior for that species/color/shape segment.
3. **Conservative prior only:** if there is one knot, use a prior exponent and
   large uncertainty.

Do not force monotonicity blindly. Wholesale rows can be noisy and $/ct can dip
or flatten. Use monotonic constraints only for known ordinal quality effects,
not for every observed carat curve.

### Color transform

For white diamonds, use grade-rank deltas and `WHITE_GRADE_MULT` priors, then
learn residual adjustments from held-out comp data.

For fancy color diamonds, separate:

- hue: pink, yellow, blue, green, orange, red, purple, brown, black
- intensity: light, fancy, intense, vivid
- modifiers: brownish, greyish, orangy, purplish, etc.

Do not treat "Fancy Intense Brownish Pink" as simply one step away from "Fancy
Vivid Pink." It is an intensity gap plus a modifier penalty.

For colored gemstones beyond diamonds, use hue/tone/saturation fields rather
than diamond-specific intensity names.

### Clarity transform

Use existing carat-dependent white clarity curves as priors. For fancy color,
compress clarity effects because saturation masks inclusions, but let the
compression vary by color intensity and shape.

Important interaction:

```text
clarityEffect = f(clarity, carat, shapeFamily, colorSaturation)
```

### Shape and cut transform

Shape should not be a single multiplier forever. Split it into:

- outline family: round/oval/cushion, rectangular/step-adjacent, pointed fancy,
  specialty
- faceting style: brilliant, step, modified brilliant, mixed
- aspect ratio: especially for elongated cushions, radiants, ovals, emeralds,
  pears, marquise
- cut quality fields: cut grade, polish, symmetry, depth/spread sanity

`Cut Cornered Rectangular Modified Brilliant` should normalize to radiant-like
for matching, with faceting style `modified_brilliant` and outline
`rectangular_cut_cornered`.

### Growth, treatment, cert, and market transform

These should be explicit, not buried inside source confidence:

- lab-grown CVD post-growth treatment discount
- HPHT vs CVD differences where supported
- as-grown premium where supported
- certificate lab confidence
- Alibaba wholesale vs US importer vs retail channel

## Multi-Comp Pricing

For each selected comp:

```js
const adjusted = {
  row,
  score,
  logEstimate,
  sigmaLog,
  parts
};
```

Blend in log space, not raw dollars:

1. Compute `logEstimate` for each comp.
2. Reject extreme outliers if they disagree with the local group by more than
   the calibrated tolerance.
3. Weight by inverse variance, source confidence, and product-level caps.
4. Use a weighted median or Huber mean so one bad comp cannot dominate.
5. Convert back to total price and return low/median/high.

Recommended output:

```js
{
  matchType: "exact" | "nearest" | "extrapolated" | "fallback" | "none",
  estimate: 1280,
  low: 900,
  high: 1650,
  confidence: "medium",
  primaryComp: "...",
  supportComps: [...],
  rejectedComps: [...],
  warnings: [...],
  explanationParts: [...]
}
```

## Source De-Duping And Weight Caps

The index contains many ladder rows from the same listing. That is useful, but
one product should not pretend to be ten independent market observations.

Rules:

- Cap total weight from one `productId`.
- Cap total weight from one supplier when supplier identity is known.
- Give exact SKU rows more weight than page-level ranges.
- Penalize rows with carat bands, clarity bands, MOQ-only pricing, or conflicting
  page/row attributes.
- Keep source date so old captures can decay if the market moves.

## Pink Stone Case Study

Query:

```text
3.80ct Cut Cornered Rectangular Modified Brilliant
Fancy Vivid Pink, VVS2, CVD, IGI
```

Expected v3 behavior:

| Comp | Role |
| --- | --- |
| 4.13ct cushion Fancy Pink VS1 at $1,471 | High-weight near-carat anchor |
| 2.08ct heart Fancy Vivid Pink VVS2 at $770 | High-weight color/clarity anchor |
| 1.06ct emerald and 1.55ct pear Fancy Intense Pink VS1 | Secondary pink-intensity support |
| 3.03ct princess Fancy Light Pink VS1 | Secondary near-carat but large intensity gap |
| 0.89ct radiant Fancy Intense Brownish Pink VS2 | Low-weight fallback or rejected |

The engine should land in a low-to-mid-thousands wholesale range unless the
learned market curves say otherwise. It should not return a false-precision
single point like `$3,733` from the 0.89ct row.

## Implementation Plan

### Phase 1 - Normalize and expose features

Files:

- `research/scripts/regenerate-comps-index.py`
- `research/alibaba-comp-engine.js`
- eventually the mirrored production logic in `index.html`

Tasks:

1. Add normalized fields to index rows: `gemSpecies`, `originType`,
   `growthMethod`, `majorTreatment`, `certificateLab`, `hue`, `intensityRank`,
   `colorModifierTerms`, `shapeFamily`, `facetingFamily`, `outlineFamily`,
   `aspectRatio`, `sourceGroup`, and `sourceFlags`.
2. Add shape aliases for cut-cornered rectangular/square modified brilliant.
3. Add a color parser that preserves both intensity and modifier terms.
4. Keep the existing raw fields for traceability.

Acceptance criteria:

- Existing exact matches still work.
- Fancy pink rows produce distinct keys for `pink_fv`, `pink_fi`, `pink_f`,
  `pink_fl`, and `brownish pink`.

### Phase 2 - Replace filtering and scoring

Tasks:

1. Replace `filterCandidates` with hard-gate filtering plus broadening tiers.
2. Replace `scoreCandidate` with `compErrorScore`.
3. Return score components so the UI can explain why a comp was chosen or
   rejected.
4. De-duplicate and cap rows by product and supplier.

Acceptance criteria:

- The 0.89ct brownish radiant is not the top comp for the 3.80ct vivid pink
  query.
- The 4.13ct cushion and 2.08ct heart both appear as major support comps.
- No fallback crosses natural/lab, species, major treatment, or fancy hue.

### Phase 3 - Implement log-space adjusted estimates

Tasks:

1. Add `adjustCompToQuery(query, row, calibration)` returning `logEstimate`,
   `sigmaLog`, and adjustment parts.
2. Replace `applyWhiteModifiers` and `applyFancyModifiers` with shared log-space
   helpers.
3. Keep white and fancy priors, but express them as additive log deltas.
4. Evaluate color and carat at each stone's own carat when needed.

Acceptance criteria:

- Bigger-to-smaller and smaller-to-bigger adjustments are symmetric in log
  space.
- Current bad carat multipliers like `(3.8 / 0.89)^1.5` disappear.

### Phase 4 - Dynamic curves and priors

Tasks:

1. Build grouped knot sets from the index at runtime or build time.
2. Fit local log-log carat curves when enough independent rows exist.
3. Use priors with shrinkage when data is sparse.
4. Calibrate default axis sigmas with leave-one-product-out backtests.

Acceptance criteria:

- No hand-authored per-family spline knots are required.
- A same-product ladder can shape the curve but cannot become the entire market
  by itself.

### Phase 5 - Robust blend and uncertainty range

Tasks:

1. Implement weighted median or Huber mean in log space.
2. Add outlier rejection on adjusted estimates.
3. Compute low/high from adjusted-estimate spread plus calibrated model sigma.
4. Return `primaryComp`, `supportComps`, `rejectedComps`, and warnings.

Acceptance criteria:

- One bad comp cannot dominate the final price.
- Sparse estimates show wide ranges.
- Exact/near-exact estimates show tighter ranges.

### Phase 6 - Backtest before UI rollout

Create `research/scripts/backtest-comp-engine.mjs`.

Backtest method:

1. Hold out one product or supplier group at a time.
2. Predict each held-out row from the remaining rows.
3. Track median absolute percentage error by segment.
4. Track interval calibration: 80% bands should contain about 80% of held-out
   prices.
5. Print the worst misses with score components and source rows.

Acceptance criteria:

- White commodity segments beat the old engine.
- Fancy sparse segments produce honest wide ranges instead of overconfident
  points.
- The supplied 3.80ct pink case does not select the 0.89ct brownish radiant as
  primary support.

## Final Recommendation

Implement v3 as a small modeling layer, not as a bigger pile of multipliers.
The important shift is:

```text
old: choose one closest comp -> multiply factors -> single price
new: find local market evidence -> adjust each comp -> robust blend -> price range
```

That is the reusable method. It can start with diamonds and Alibaba wholesale,
but the schema and scoring model are broad enough to add other gemstones,
markets, and certificate/treatment rules without rewriting the engine each time.
