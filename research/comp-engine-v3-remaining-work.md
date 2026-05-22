# Comp Engine v3 - Remaining Work

**Status:** v3 is partially implemented.  
**Source proposal:** `research/comp-engine-v3-proposal.md`.  
**Current implementation:** `research/comp-engine-v3.js` and mirrored logic in
`index.html`.

## Already Implemented

The current engine implements the major v3 direction:

- Log-space adjusted comps.
- `compErrorScore` instead of the old fixed linear score.
- Multi-comp blending instead of a single-comp estimate.
- `supportComps` and `rejectedComps` in the result.
- Low/median/high uncertainty range.
- Product-level de-duping by `productId`.
- Fancy color parsing into hue, intensity, and modifier terms.
- Brownish/greyish/etc. modifier adjustment.
- Shape-family distance scoring.
- The 3.80ct Fancy Vivid Pink case no longer selects the 0.89ct brownish radiant as the primary comp.
- Expanded tests around hard gates, exact-match semantics, log-space adjustment, modifier handling, pink-case regression, and same-shape exact support.

## What Is Left

### 1. Full normalized schema and hard gates

Add normalized fields to comp rows and queries:

- `gemSpecies`
- `originType`
- `growthMethod`
- `majorTreatment`
- `certificateLab`
- `marketChannel`
- `hue`
- `intensityRank`
- `colorModifierTerms`
- `shapeFamily`
- `facetingFamily`
- `outlineFamily`
- `aspectRatio`
- `sourceGroup`
- `sourceFlags`

Then update candidate filtering so the engine does not cross hard market splits:

- diamond vs other gem species
- natural vs lab-grown
- CVD vs HPHT when relevant
- untreated vs major treatment
- IGI/GIA/uncertified when the market channel requires it
- Alibaba wholesale vs retail/importer/auction channels

### 2. Better source de-duping and weight caps

Current state: de-dupes by `productId`.

Remaining work:

- Cap total weight by supplier.
- Cap total weight by `sourceGroup`.
- Distinguish true SKU rows from page-level ranges.
- Penalize MOQ-only, carat-band, clarity-band, or conflicting rows.
- Add source age/date decay once capture dates are consistently available.

### 3. Dynamic local carat curves

Current state: uses seeded priors and fixed carat slopes.

Remaining work:

- Build independent knot sets from the current comp index.
- Fit local log-log carat curves when there are enough independent rows.
- Use shrinkage toward priors when data is sparse.
- Avoid hand-authored per-family spline knots.
- Prevent one product ladder from becoming the whole market by itself.

### 4. Calibrated scoring and uncertainty

Current state: axis sigmas are seeded defaults.

Remaining work:

- Run grouped backtests to calibrate axis sigmas.
- Tune `SCORE_HARD_CUTOFF` from observed prediction error.
- Verify that returned 80% intervals actually contain roughly 80% of held-out rows.
- Report score components so the UI can explain why a comp was accepted, down-weighted, or rejected.

### 5. Robust blend upgrade

Current state: inverse-variance weighted mean in log space with outlier rejection.

Remaining work:

- Implement weighted median or Huber mean in log space.
- Add product/supplier/source caps into the blend weights.
- Make sparse estimates visibly wider.
- Make exact/near-exact estimates tighter without becoming overconfident.

### 6. Backtest script

Create:

```text
research/scripts/backtest-comp-engine.mjs
```

Backtest requirements:

- Hold out one product or supplier group at a time.
- Predict each held-out row from the remaining rows.
- Track median absolute percentage error by segment.
- Track interval calibration for low/high bands.
- Print worst misses with query, selected comps, score components, adjustment parts, and source rows.

Acceptance targets:

- White commodity segments should beat the old engine.
- Fancy sparse segments should return honest wide ranges.
- The 3.80ct Fancy Vivid Pink case must not select the 0.89ct brownish radiant as primary support.

## Recommended Implementation Order

1. Add normalized schema fields during comp-index generation.
2. Enforce hard gates using those fields.
3. Return score components from `compErrorScore`.
4. Add supplier/source weight caps.
5. Create the backtest script.
6. Calibrate axis sigmas and uncertainty bands from backtest results.
7. Add dynamic carat curves with shrinkage.
8. Replace the weighted mean with weighted median or Huber blending.
9. Mirror any production changes from `research/comp-engine-v3.js` into `index.html`.
10. Expand tests after each phase so proposal acceptance criteria stay pinned.

## Definition Of Done

v3 should be considered complete when:

- Hard gates prevent invalid cross-market comps.
- The engine learns local carat behavior from the index when enough data exists.
- Sparse markets return wide, honest ranges.
- Exact and near-exact comps are not diluted by weak cross-shape evidence.
- One product, supplier, or bad row cannot dominate the estimate.
- Backtests show calibrated error bands and no regression on the pink case study.
