# S27 — Color Champion S22-Led Policy

**Status:** Implemented for fancy-color / colored lab diamonds  
**Artifact:** `research/data/color-diamond-ml-model-s27-champion.json`  
**Trainer:** `research/scripts/train-s27-color-champion.mjs`

## Why S27 Exists

S26 fixed white diamonds by making the strongest supported source the champion and demoting weak extrapolation.

Fancy-color diamonds need the same discipline, but the source ranking is different:

- Color S22 already has the best held-out point error.
- Color S23 is useful because it constrains color-intensity direction.
- Color comps are valuable support, but current direct StarGem color coverage is only 5 stones.
- Messi color rows must be normalized before they can be treated as StarGem-like pricing.

S27 therefore uses a champion policy rather than another free-form curve.

## Source Adjustment

Messi color rows are adjusted to StarGem-like factory pricing:

```text
StarGem-like price = Messi color price / 1.25
Direct StarGem color quote = quoted price / 1.00
```

This same adjustment is used by Color S22, Color S23, the S27 benchmark, and the comp engine.

## Policy

S27 point estimate order:

```text
1. Color S22 ExtraTrees source-adjusted ML
2. Color S23 monotone-intensity ML, if S22 is unavailable
3. Source-adjusted color comps, if both ML models are unavailable
```

S27 does not let the current color comp surface drag the point estimate around, because comp-only color MAPE is materially worse than Color S22 after source normalization.

## Scorecard

Held-out validation:

```text
Color S22: 3.12% MAPE
Color S23: 3.86% MAPE
S27:       3.12% MAPE
```

All source-adjusted rows, production-policy benchmark:

```text
Rows: 1,657
S27 / Color S22:       1.75% MAPE
Color S23:             1.81% MAPE
Color comp engine:     8.96% MAPE
Comp coverage:         1,656 / 1,657 rows
```

Direct StarGem color anchors:

```text
Rows: 5
S27 / Color S22:       0.00% MAPE
Color S23:             0.23% MAPE
Color comp engine:    17.02% MAPE
```

## Interpretation

The best color model is not a new blend that averages every signal. The best color model is a source-aware dispatch:

- use Color S22 / S27 for the point estimate;
- keep Color S23 visible as the monotone intensity sanity check;
- show source-adjusted comps as support and warnings;
- do not route colored stones through white S26.

## Verification

```text
node research/scripts/train-s27-color-champion.mjs
npm run test:s27-color
node research/scripts/benchmark-all-models.mjs
```
