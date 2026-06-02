# Unified DiamondProd vNext Model Plan

**Date:** 2026-06-02
**Status:** Implementation roadmap
**Scope:** Lab-grown white diamonds and lab-grown fancy-color diamonds in the current app data model. This does not cover non-diamond colored gemstones such as sapphire, ruby, emerald, or moissanite.
**Most promising current color branch:** S27 Color Champion
**Target:** One app-facing production predictor that handles both white and fancy-color diamonds using the **WhiteProd vNext architecture form** as the base pattern.

---

## 1. Direct Answer

Yes: the right product goal is **one model interface** that can handle both white and fancy-color diamonds, and the right base architecture is the `WhiteProd vNext` form.

The goal is **not** to bolt the old color model beside WhiteProd. The goal is to rebuild the color side into the same architectural shape:

```text
source-aware routed predictor
+ strongest supported local expert
+ dense/source quote expert
+ constrained transfer surface
+ structural fallback/prior
+ display monotonicity guard
+ conformal uncertainty
+ golden parity fixtures
+ shadow release gates
```

The honest architecture is not to force fancy-color diamonds through the white model weights. Instead, make `WhiteProd vNext` the template and keep branch-specific features/experts where the economics differ:

```text
DiamondProd vNext(input)
  -> classify color family
  -> white branch: WhiteProd vNext
  -> fancy-color branch: S27-led WhiteProd-shaped color methodology
  -> return one normalized prediction object
```

If the app naming must stay simple, this can be exposed as one `GemProd` or `DiamondProd` model. Internally it should still keep separate white and fancy-color expert branches because the economics and monotonicity rules are different.

The best current colored-diamond candidate is **S27 Color Champion**. It should become the fancy-color branch of the unified model.

`WhiteProd vNext` gives us the right production pattern:

```text
one versioned predictor
+ routed experts
+ source-aware calibration
+ monotonicity/display guardrails
+ uncertainty bands
+ app parity tests
+ shadow release
```

The fancy-color branch should use colored-diamond features and economics:

```text
Fancy-color branch =
  S27 / Color S22 point model
  + Color S23 monotone-intensity sanity layer
  + source-adjusted Messi/StarGem color comps
  + curated fallback prior for rare hues
  + configurable Messi discount policy
  + conformal uncertainty by hue/intensity/support
```

Do **not** route colored diamonds through white S26/S30/S33/S28 weights. White grade logic is not color-grade logic.

The shared methodology should be identical, and the color branch should be implemented as a **WhiteProd-shaped branch**, not as a loose wrapper around old color scripts:

| Methodology piece | White branch | Fancy-color branch |
|---|---|---|
| One public predictor | `DiamondProd vNext` | `DiamondProd vNext` |
| Branch classifier | white/fancy family detector | same detector |
| Supported local expert | S30 supported curves | color-supported local curves / exact color quote curves |
| Dense/source expert | S26 dense lookup | direct StarGem color anchors + high-support Messi-normalized cells |
| Constrained transfer surface | S33-A constrained anchors | S27/S22 rebuilt as constrained color transfer surface |
| Structural prior/fallback | S28 monotone prior | Color S23 / curated fancy-color prior |
| Source-aware calibration | support tiers and expert confidence | Messi-to-StarGem source factor and support tiers |
| Comp support | white comps/reconciler | source-adjusted color comps |
| Sparse fallback | S28 + wide band | structural color prior + direct-quote warning |
| Display monotonicity | carat/color/clarity grid | carat/intensity/modifier grid |
| Release discipline | gates, fixtures, shadow | same gates, fixtures, shadow |

---

## 2. WhiteProd-Shaped Architecture Contract

`DiamondProd vNext` should have one architecture contract, and both white and fancy-color branches must implement it.

### 2.1 Shared Predictor Contract

Every branch must return the same fields:

```text
{
  price,
  pricePerCarat,
  modelVersion,
  branch,
  selectedExpert,
  expertRank,
  supportTier,
  supportCount,
  sourceAdjustment,
  confidenceBand,
  fallbackReason,
  monotonicityMode,
  diagnostics
}
```

Branch-specific diagnostics are allowed, but the top-level app should not need different pricing code for white vs color.

### 2.2 Shared Expert Ladder

Both branches should be organized around the same expert slots:

| Slot | WhiteProd vNext implementation | Fancy-color implementation target |
|---|---|---|
| `E1_supported_curve` | S30 supported smooth curves | color local curves where hue/intensity/shape/carat support is strong |
| `E2_dense_source` | S26 dense lookup | direct StarGem color anchors and high-support Messi-normalized cells |
| `E3_constrained_transfer` | S33-A constrained anchors | S27/S22-derived constrained transfer surface |
| `E4_structural_prior` | S28 monotone prior | Color S23 monotone-intensity prior / curated fancy prior |
| `E5_comp_support` | reconciled white comps | source-adjusted color comps |
| `E6_fallback` | S28 or low-confidence global fallback | structural color prior + direct-quote warning |

The color branch can start by using the current S27 artifact inside `E3_constrained_transfer`, but the implementation target is to make that branch **look and behave like WhiteProd**:

```text
color structural prior
+ source-adjusted local/dense support
+ constrained color anchors
+ supported curves where enough rows exist
+ explicit fallback and interval
```

### 2.3 Shared Training Pattern

White and fancy-color training should follow the same stages:

```text
1. Normalize source rows into a factory-like target.
2. Build held-out splits and support tiers.
3. Fit a structural prior.
4. Add supported local curves where support is strong.
5. Add constrained transfer anchors for sparse/medium cells.
6. Preserve monotone display behavior separately from point-pricing accuracy.
7. Calibrate uncertainty on the routed output.
8. Benchmark the routed model as one production predictor.
```

The feature axes differ, but the training form should match:

| White axis | Fancy-color analog |
|---|---|
| carat | carat |
| shape | shape |
| color grade D-K | hue + intensity + modifier |
| clarity | clarity |
| growth method | growth/treatment |
| supplier/list source | supplier/list source |
| dense lookup support | source-normalized color cell support |

### 2.4 Shared Release Rule

The unified model is not production-ready if either branch is only "research-good." It is ready only when:

```text
White branch passes WhiteProd gates
AND
fancy-color branch passes the same style of gates
AND
the top-level classifier routes every golden fixture correctly.
```

This is how a real "one best model" can emerge: one production architecture, one public interface, branch-specific features, and branch-level gates.

---

## 3. Current Evidence

Verified commands:

```bash
npm run test:s27-color
npm run test:color-model
```

Current S27 scorecard:

| Metric | Result |
|---|---:|
| Training/evaluation rows | 1,657 |
| Messi source-adjusted rows | 1,652 |
| Direct StarGem color anchors | 5 |
| S22 validation MAPE | 3.12% |
| S22 validation MdAPE | 0.77% |
| S23 validation MAPE | 3.86% |
| S27 validation MAPE | 3.12% |
| All adjusted-row S27 MAPE | 1.754% |
| Direct StarGem anchor S27 MAPE | 0.00% |
| Color comp engine MAPE | 8.96% |

Coverage by hue:

| Hue | Rows | Current interpretation |
|---|---:|---|
| Yellow | 638 | strongest coverage |
| Pink | 438 | strong coverage |
| Blue | 282 | useful coverage |
| Green | 114 | medium, needs caution |
| Brown / coffee | 111 | needs separate handling |
| Red | 73 | sparse, direct-quote warning |
| Orange | 1 | do not ML-train as normal |

Current source adjustment:

```text
StarGem-like color price = Messi color price / 1.25
```

That is equivalent to:

```text
StarGem-like price ~= 80% of Messi
Messi / StarGem factor ~= 1.25x
```

This matches the existing color-anchor analysis, which estimated StarGem around **77%-81% of comparable Messi color stock** on normal 1-4ct colored diamonds.

---

## 4. Critical Design Principle: Separate Source Discount From Model Truth

The Messi discount should be a first-class configurable layer, not hidden inside the model.

There are two different discounts:

### 4.1 Source Normalization Discount

Used to convert Messi observed list/stock prices into StarGem-like factory prices:

```text
starsgem_like_price = messi_price / messiToFactoryFactor
```

Suggested defaults:

| Assumption | Factor | StarGem-like share of Messi | Discount vs Messi |
|---|---:|---:|---:|
| Conservative | 1.20 | 83.3% | 16.7% |
| Current best default | 1.25 | 80.0% | 20.0% |
| Aggressive | 1.30 | 76.9% | 23.1% |

This belongs in the artifact/config:

```json
{
  "sourceAdjustment": {
    "messiToFactoryFactor": 1.25,
    "starsgemDirectFactor": 1.0,
    "allowedRange": [1.20, 1.30]
  }
}
```

### 4.2 Offer / Purchase Discount Policy

If the app needs to recommend an offer below Messi or below the model estimate, keep that as a separate business policy:

```text
offer_price = color_prod_vnext_price * (1 - offerDiscountPct)
```

Do not train this into the ML target. A sourcing discount, a resale offer discount, and a model calibration factor are different things.

---

## 5. Target Architecture

Create one shared app-facing predictor:

```text
research/scripts/predict-diamond-prod-vnext.mjs
```

Output shape:

```text
DiamondProd vNext(input) -> {
  price,
  pricePerCarat,
  modelVersion,
  branch,
  selectedExpert,
  expertRank,
  supportTier,
  supportCount,
  colorFamily,
  hue,
  intensity,
  modifier,
  sourceAdjustment,
  messiDiscountPct,
  confidenceBand,
  fallbackReason,
  monotonicityMode,
  diagnostics
}
```

Top-level routing:

```text
1. Classify input as white or fancy-color.
2. If white, call the existing WhiteProd vNext branch.
3. If fancy-color, call the S27-led color branch.
4. Return one normalized prediction object with branch diagnostics.
```

White branch:

```text
WhiteProd vNext =
  S30 supported curves
  -> S26 dense lookup
  -> S33-A constrained anchors
  -> S28 fallback/display monotone guard
```

Fancy-color branch:

```text
1. Direct StarGem color anchor / exact quote
   Use exact supplier quote when report/spec matches.

2. S27 / Color S22
   Main point model for supported yellow, pink, blue, green, brown, red segments.

3. Color S23 monotone-intensity model
   Use as guardrail, sanity check, and fallback where S22 is unavailable or directionally suspect.

4. Source-adjusted color comps
   Use as support evidence and fallback, not as the default point estimate when S22/S27 is available.

5. Curated fancy-color prior
   Use for rare unsupported hue/modifier cells and direct-quote-needed cases.
```

`DiamondProd vNext` should be benchmarked as **one model** and also reported by branch. The release artifact should include:

```text
research/scripts/predict-white-prod-vnext.mjs
research/scripts/predict-color-prod-vnext.mjs
research/scripts/predict-diamond-prod-vnext.mjs
research/data/diamond-prod-vnext-router.json
research/data/benchmark-diamond-prod-vnext.json
```

This gives you one model for the app while preserving the right specialized logic inside it.

---

## 6. What Needs To Change

### Change 1 - Build a Canonical Unified Production Benchmark

Create:

```text
research/scripts/benchmark-diamond-prod-vnext.mjs
research/data/benchmark-diamond-prod-vnext.json
```

Benchmark sections:

- top-level branch classification accuracy;
- combined report across white + fancy-color rows;
- white branch report, reusing `WhiteProd vNext` gates;
- fancy-color branch report, reusing S27/color gates;
- row holdout;
- source split: Messi-adjusted vs direct StarGem;
- hue split;
- hue + intensity split;
- carat bands: 1-2ct, 2-3ct, 3-5ct, 5ct+;
- shape split;
- sparse hue/modifier warning report;
- monotonicity scan by intensity;
- source-adjustment sensitivity: factor 1.20 / 1.25 / 1.30;
- pinned high-value colored stones;
- pinned white stones from `WhiteProd vNext`;
- confidence coverage.

Exit criteria:

- command is reproducible;
- every candidate reports the same metrics;
- WhiteProd remains the white baseline;
- S27 remains the color baseline until the color branch beats it as a routed output;
- the combined model reports branch-level failures rather than hiding them in an aggregate score.

### Change 2 - Add Messi Discount Sensitivity

Train and benchmark the color model across:

```text
messiToFactoryFactor = 1.20
messiToFactoryFactor = 1.25
messiToFactoryFactor = 1.30
```

Report:

- global MAPE;
- direct StarGem anchor error;
- error by hue;
- error by carat;
- large-stone behavior;
- recommended default factor.

Exit criteria:

- chosen factor minimizes direct StarGem anchor error without damaging Messi holdout behavior;
- factor is stored in config and exposed in diagnostics;
- product can override the offer discount without retraining.

### Change 3 - Build The Unified Predictor

Create:

```text
research/scripts/predict-color-prod-vnext.mjs
research/scripts/predict-diamond-prod-vnext.mjs
research/data/color-prod-vnext-router.json
research/data/diamond-prod-vnext-router.json
```

`predict-color-prod-vnext.mjs` should mirror `predict-white-prod-vnext.mjs` in form:

```text
loadColorProdVNext()
predictColorProdVNext(row, ctx)
predictColorProdVNextBatch(rows, ctx)
supportTier(n)
cellKey(row)
```

It should use the same result-building conventions as WhiteProd:

```text
makeResult(price, upc, expert, tier, band, reason, diagnostics)
```

The important handoff requirement: **do not implement the color branch as a one-off scorer with different return fields.** It should be a WhiteProd-style routed predictor.

Top-level branch rules:

```text
if colorFamily is white or D-K white grade:
  route to WhiteProd vNext
else if fancy color label/hue/intensity exists:
  route to color branch
else:
  return needs_manual_color_classification
```

Initial color expert order:

```text
direct StarGem quote
-> S27 / S22
-> S23 monotone sanity fallback
-> source-adjusted comps
-> curated prior / direct-quote warning
```

Exit criteria:

- 100% prediction coverage for valid colored-diamond inputs;
- every prediction reports selected expert and support tier;
- no hidden fallback from fancy-color pricing to white-diamond pricing;
- white inputs continue matching `WhiteProd vNext` golden fixtures;
- source adjustment is visible in diagnostics.

### Change 4 - Add Intensity Monotonicity Guardrails

Colored diamonds need monotonicity across intensity, not white D/E/F color order.

Scan by:

```text
Fancy Light <= Fancy <= Fancy Intense <= Fancy Vivid
```

for each:

```text
hue x shape x clarity x carat sweep
```

Modifier rules:

```text
pure hue >= brownish/greyish/grey/coffee modifier
```

Exit criteria:

- no visible intensity inversions on display grids;
- modifier discounts are directionally sane;
- if S22 point estimate violates a display ladder, display uses S23 or a PAV-projected ladder while point pricing remains S27.

### Change 5 - Add Rare-Hue Routing Rules

Do not trust ML equally across every hue.

Initial policy:

| Segment | Policy |
|---|---|
| Yellow / pink / blue | S27 primary where support exists |
| Green | S27 with wider interval and S23 sanity check |
| Brown / coffee | separate branch; do not compare to pure fancy hues blindly |
| Red | S27 allowed only with support warning; direct quote preferred |
| Orange / purple / violet | curated prior + comps + direct-quote warning |

Exit criteria:

- rare hue rows never receive high-confidence output;
- `direct_quote_recommended` appears for low-support colors;
- no orange/purple model behavior is trained from one or zero rows as if it were normal.

### Change 6 - Add Colored Conformal Intervals

Calibrate intervals on the routed `DiamondProd vNext` output, with separate reporting for the fancy-color branch.

Recommended groups:

- overall;
- by hue;
- by intensity;
- by selected expert;
- by support tier;
- by carat band.

Exit criteria:

- 80% and 90% coverage are measured;
- sparse hue intervals are wider;
- high-value/large-carat intervals are not falsely tight.

### Change 7 - Expand Direct StarGem Color Anchors

The biggest current weakness is not S27 architecture; it is direct StarGem color data.

Current direct StarGem anchors: **5 rows**.

Minimum next target:

```text
30 high-information StarGem color quotes
```

Better target:

```text
100-150 stratified StarGem color quotes
```

Priority sample:

| Need | Examples |
|---|---|
| Hue curve | yellow, pink, blue, green |
| Intensity curve | Fancy, Intense, Vivid |
| Carat curve | 1, 1.5, 2, 3, 5ct |
| Clarity calibration | VS2, VS1, VVS2 |
| Shape calibration | radiant, cushion, oval, pear, emerald, heart |
| Sparse hue anchors | brown/coffee, red, orange, purple/violet |

Exit criteria:

- source factor can be learned by hue or hue+intensity, not only global;
- direct-anchor validation is meaningful beyond five memorized cases;
- large colored stones get direct support instead of pure extrapolation.

---

## 7. Production Release Gates

The unified model should not become the displayed diamond model until it passes both white and fancy-color gates.

| Gate | Minimum threshold |
|---|---:|
| Branch classification | 100% correct on golden white/fancy fixtures |
| White branch | passes `WhiteProd vNext` hard gates |
| Architecture parity | color branch exposes same predictor/load/batch/result contract as white branch |
| Coverage | 100% explicit prediction or direct-quote warning |
| S27 baseline | Fancy-color branch row MAPE <= S27 on comparable holdout |
| Direct StarGem anchors | MAPE <= 5% on current anchors; improve as sample grows |
| Messi source-adjusted validation | MAPE <= S27 + 0.5pp |
| Major hues | yellow/pink/blue MAPE <= S27 + 0.5pp |
| Green/brown/red | measured separately; no high-confidence silent output |
| Rare hues | orange/purple/violet route to warning/fallback |
| Intensity monotonicity | 0 display-grid inversions |
| Modifier sanity | pure hue priced >= brownish/greyish equivalent unless manually overridden |
| High carat | 5ct+ slice measured and manually reviewed |
| Source adjustment | Messi factor shown and sensitivity-tested |
| App parity | app predictions match golden fixtures |
| Uncertainty | 80% and 90% coverage measured |

Combined aggregate MAPE is not enough. A release fails if either branch fails its own gates.

---

## 8. Milestones

### C0 - Freeze Current S27 Baseline

Work:

- Preserve S27 artifact and tests.
- Record current metrics.
- Confirm `Messi / 1.25` is the current default source adjustment.

Exit:

- `npm run test:s27-color` passes.
- `npm run test:color-model` passes.

Current status: complete.

### C1 - Build Unified DiamondProd Benchmark

Work:

- Implement `benchmark-diamond-prod-vnext.mjs`.
- Include the existing `WhiteProd vNext` benchmark gates.
- Add source-factor sensitivity.
- Add hue/intensity/carat/shape splits.

Exit:

- One JSON benchmark report exists.
- WhiteProd and S27 are baseline comparators.

### C2 - Implement Unified Predictor

Work:

- Implement `predict-diamond-prod-vnext.mjs`.
- Implement `predict-color-prod-vnext.mjs` in the same form as `predict-white-prod-vnext.mjs`.
- Implement shared predictor output contract.
- Add router config.
- Add output diagnostics.

Exit:

- no colored input uses white model fallback;
- no white input loses current WhiteProd behavior;
- color branch has `load`, `predict`, `batch`, `supportTier`, and `cellKey` equivalents;
- every prediction reports expert/support/source factor.

### C3 - Add Monotone Display Layer

Work:

- Build intensity grid scans.
- Use S23 or PAV only for display ladders if needed.
- Keep S27 point estimate unless a routing gate fails.

Exit:

- 0 display-grid intensity inversions.

### C4 - Calibrate Messi Discount

Work:

- Benchmark factors 1.20, 1.25, 1.30.
- Add optional product offer discount.
- Keep source normalization and offer policy separate.

Exit:

- chosen factor is evidence-backed;
- factor is configurable without retraining.

### C5 - Add Conformal Bands

Work:

- Fit intervals on routed DiamondProd output and report color-branch coverage separately.
- Calibrate by hue/intensity/support.

Exit:

- 80% and 90% coverage measured.
- rare segments get wide bands.

### C6 - Add Golden Fixtures And App Parity

Work:

- Add combined fixtures:
  - existing WhiteProd pinned white cases;
  - direct StarGem anchors;
  - common yellow/pink/blue;
  - green/brown/red;
  - rare unsupported hue;
  - high-carat cases.
- Add app parity test.

Exit:

- fixture test passes;
- app output matches shared predictor.

### C7 - Shadow Release

Work:

- Run DiamondProd beside current app output.
- For white rows, compare to current `WhiteProd vNext` or S26 rollout state.
- For fancy-color rows, compare to current color price output.
- Log delta versus current app estimate and source-adjusted Messi comps.
- Review large deltas manually.

Exit:

- no unexplained large deltas;
- direct-quote warnings fire correctly.

### C8 - Production Rollout

Work:

- Add feature flag:

```text
diamond_current
diamond_prod_vnext_shadow
diamond_prod_vnext_display
```

Exit:

- rollback works;
- monitoring tracks route distribution, source factor, and high-delta cases.

---

## 9. Immediate Next Work

1. Build `benchmark-diamond-prod-vnext.mjs`.
2. Implement `predict-diamond-prod-vnext.mjs` as a wrapper around WhiteProd and fancy-color branches.
3. Implement `predict-color-prod-vnext.mjs` as a WhiteProd-shaped routed predictor, not a standalone legacy scorer.
4. Add Messi factor sensitivity and diagnostics.
5. Add intensity monotonicity scan.
6. Add colored conformal intervals.
7. Add golden fixtures and app parity.
8. Ask StarGem for 30 high-information color quote anchors.

---

## 10. Final Recommendation

Use **WhiteProd vNext** as the white branch and **S27 Color Champion** as the fancy-color branch of one unified app-facing model.

Use **Messi / 1.25** as the default StarGem-like source normalization for now, but keep it configurable and sensitivity-tested.

The key implementation requirement is architectural parity:

```text
color branch must mirror WhiteProd vNext in form
```

The production-ready model should be:

```text
DiamondProd vNext =
  if white:
    WhiteProd vNext
  if fancy-color:
    S27-led point estimate
    + S23 monotone display guard
    + source-adjusted Messi comps
    + curated rare-hue fallback
    + configurable Messi discount
    + calibrated uncertainty
```

This gives the app one model while keeping the math honest. It is not yet production-complete until the unified benchmark, branch classification, intensity scan, discount sensitivity, intervals, app parity, and shadow review are done.
