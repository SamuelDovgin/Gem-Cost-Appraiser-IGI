# S28 — Monotone Parametric Trend Surface

**Status:** Re-fit as v0.4 grade-premium monotone surface  
**Date:** 2026-06-01  
**Artifact:** `research/data/starsgem-ml-model-s28-monotone-parametric.json`  
**Training source:** `research/data/dataset-clean-training.json` per [`ml-training-data-policy.md`](ml-training-data-policy.md)

---

## Goal

S28 is the opposite of the S26 champion hybrid. It does not blend lookup, ML, and
comp estimates. It trains one price surface that learns from supplier data while
respecting domain rules that should not invert:

```text
log($/ct) =
  intercept
  + monotone carat scarcity curve
  + monotone magic-weight ramps and steps
  + monotone clarity grade effect
  + monotone color grade effect
  + monotone size × grade interactions
  + monotone HPHT growth effect
  + learned shape modifiers
  + learned cut modifiers
  + supported shape/cut carat interactions
  + learned dimension penalties
```

Version 0.4 intentionally removes the old row/vintage term. The v0.2 live path
set vintage to the current sheet edge while Python holdout metrics used each
row's own vintage value, which created a large live-vs-Python parity failure.
The current artifact keeps the single surface focused on carat, grade, shape,
cut, growth, and dimension behavior.

---

## Hard Constraints

S28 treats these as structural rules, not suggestions:

| Attribute | Constraint |
|---|---|
| Carat | Higher carat cannot reduce predicted `$ / ct` for the same spec. |
| Magic weights | 1/1.5/2/3/4/5/10/20ct can have learned pre-threshold ramps and at-threshold steps. |
| Clarity | Better clarity cannot price below worse clarity. |
| White color | Better white color cannot price below worse white color. |
| Size × grade | Color and clarity premiums can grow with carat, but cannot reverse. |
| Fancy intensity | Future color S28 should enforce more vivid/intense color above weaker color, holding hue/spec fixed. |
| Growth method | HPHT cannot price below CVD for the same spec. |
| Shape/cut carat behavior | Supported shapes and cuts can receive extra nonnegative carat/magic terms. |
| Dimensions | Larger deviation from the learned shape norm cannot create a premium unless a shape-specific feature explicitly earns it. |

The model can learn that a rule has a small market premium, but it cannot learn
the wrong sign. Carat also has a tiny strict lower-bound slope so a larger stone
does not merely tie a smaller one when the sheet is locally flat.

Magic-weight behavior is represented with monotone features, not a single smooth
curve:

```text
approach_4ct = 0 below the 4ct window, ramps upward approaching 4ct, then stays 1
step_4ct     = 0 below 4ct, then 1 at 4ct and above
```

Both coefficients must be nonnegative. This lets the model learn that 3.9ct is
worth more than 3ct, while still allowing a steeper jump at 4.0ct.

---

## Shape Philosophy

Shape is not a separate model family. Shapes share the same carat, clarity,
color, growth, and dimension rules, then receive a learned modifier relative to
the common surface.

This supports both market interpretations:

- less popular shapes may price lower because demand is lower;
- highly popular shapes may also price lower when supply is deeper and options
  are more abundant;
- specialty or scarce shapes can price higher only if the data earns that
  modifier.

The shape coefficient is learned, but shrunk by ridge regularization so sparse
shapes do not invent giant premiums from a handful of rows.

S28 also learns cut modifiers and supported cut/shape-style carat interactions.
This matters because a universal carat curve is too blunt: `ROUND_STANDARD`,
`PEAR_MODIFIED`, `PEAR_ICE_FLOWER`, `OVAL_MODIFIED`, and cut-missing fancy
shapes can have different carat scarcity behavior. The interaction terms are
still constrained to be nonnegative extras, so they can make the curve steeper
for supported cuts/shapes without making larger stones cheaper per carat.

---

## Temporal / Rate-Card Handling

The StarGem sheet contains multiple rate-card eras, but v0.4 does not include a
vintage feature. That is deliberate: S28 is being judged as a single pricing
surface, and the deployed predictor must match the artifact's reported metrics.

Current S28 training uses only clean Segment A from
`dataset-clean-training.json`. If future work reintroduces temporal handling, it
must include a live-vs-Python parity gate and should report both row-vintage and
current-vintage metrics explicitly.

---

## Why Not Pure Trees

Tree models can win dense-cell MAPE, but they can still invert sparse ordered
attributes because leaves do not know that `IF > VVS1 > VVS2` or `D > E > F`.

S28 uses ordered numeric features and sign-constrained coefficients, so the
relationship transfers:

```text
If the model learns an IF premium at 1ct, that premium is available at 3ct and
30ct even when the exact 30ct IF cell is missing.
```

---

## Acceptance Gates

Before S28 can replace a display panel, it must pass:

1. Zero clarity inversions on a fixed grid.
2. Zero white-color inversions on a fixed grid.
3. Zero HPHT-vs-CVD inversions on a fixed grid.
4. Zero carat `$ / ct` inversions on a fixed grid.
5. Segment metrics by carat band and shape, not only aggregate MAPE.
6. Pinned large-stone cases above the S25 underpricing floor.
7. Metadata proves the model trained from `dataset-clean-training.json`.

Accuracy should be judged against the current-surface target, not against stale
old-rate rows treated as equally current.

The clean training set now includes IGI-enriched large stones through `41.72ct`.
Large-carat outputs are learned where the relevant style bucket has support, and
should be treated as extrapolation only when the queried style/carat region is
unsupported.
