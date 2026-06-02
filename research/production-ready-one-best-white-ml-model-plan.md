# Production-Ready One-Best White ML Model Plan

**Date:** 2026-06-02
**Status:** ✅ M0-M6 complete. WhiteProd vNext passes all 14 production gates (12 hard + 2 soft). Ready for M7 shadow release.
**Scope:** White lab diamond price prediction from `research/data/dataset-clean-training.json`
**Recommended current production default:** S26 (until M8 rollout)
**Target:** One versioned production predictor, `WhiteProd vNext`, benchmarked and shipped as a single model/policy.
**Artifacts:** `research/scripts/predict-white-prod-vnext.mjs`, `research/scripts/benchmark-white-prod-vnext.mjs`, `research/data/starsgem-white-prod-vnext-router.json`

---

## 1. Direct Readiness Verdict

The new models are **not ready to replace production as one sole model**.

The latest production benchmark confirms:

| Model | Role | Row MAPE | Coverage | Current production answer |
|---|---:|---:|---:|---|
| S30 | Supported smooth-curve expert | 4.5087% | 4260 / 4415 | Best where supported, not universal |
| S26 | Current lookup champion | 5.3689% | 4415 / 4415 | Keep as production default |
| S33-A | Constrained credibility anchors | 7.3382% | 4415 / 4415 | Research candidate, not default |
| S28 | Monotone structural prior | 10.6151% | 4415 / 4415 | Fallback/prior only |

S33-A is real progress, but it failed 6 hard gates:

| Gate | Required | S33-A actual | Status |
|---|---:|---:|---|
| Monotonicity | 0 carat, 0 color, 0 clarity violations | 0 carat, 1 color, 1 clarity | FAIL |
| Row holdout | <= S26 + 0.5pp = 5.87% | 7.34% | FAIL |
| Dense tier | <= S26 + 1.0pp = 6.04% | 6.87% | FAIL |
| Cell holdout | <= S26 + 1.5pp = 6.71% | 7.21% | FAIL |
| High carat >=5ct | <= S26 = 10.01% | 10.57% | FAIL |
| Princess | <= S26 + 1.0pp = 13.16% | 14.65% | FAIL |

The correct near-term production posture is:

```text
Keep S26 live.
Use S30 only where support is proven.
Use S33-A/S28 as research or fallback layers until the routed output passes production gates.
Do not ship S33-A as the sole displayed price model.
```

---

## 2. What "One Best Model" Should Mean

The best production model does **not** have to be one algorithm. It must be one **versioned production predictor**:

```text
WhiteProd vNext(input) -> {
  price,
  pricePerCarat,
  modelVersion,
  selectedExpert,
  supportTier,
  confidenceBand,
  fallbackReason,
  diagnostics
}
```

Internally, it can use expert layers:

```text
S30 supported curves
  + S26 dense lookup/interpolation
  + S33 constrained transfer surface
  + S28 monotone fallback
  + conformal uncertainty calibration
```

But it is released, tested, benchmarked, and monitored as **one model**. The app should call one shared predictor, not duplicate routing logic in UI code.

---

## 3. Target Architecture

### 3.1 Production Predictor

Create a shared JS predictor module:

```text
research/scripts/predict-white-prod-vnext.mjs
```

It should load versioned artifacts:

```text
research/data/starsgem-ml-model-s26-champion.json
research/data/starsgem-ml-model-s30-bounded-smooth.json
research/data/starsgem-ml-model-s33a-constrained-anchors.json
research/data/starsgem-ml-model-s28-monotone-parametric.json
research/data/starsgem-white-prod-vnext-router.json
research/data/starsgem-white-prod-vnext-conformal.json
```

The production API should produce deterministic output for every valid white-diamond input.

### 3.2 Routing Order

Initial routing policy:

```text
1. S30 supported curve
   Use when exact or approved parent curve exists, support >= threshold, and carat is inside supported or explicitly bounded range.

2. S26 dense lookup
   Use when lookup support is dense and S30 is unavailable or not trusted for that slice.

3. S33 constrained anchor surface
   Use for supported transfer/extrapolation cells after all monotonicity gates pass.

4. S28 monotone structural fallback
   Use for empty or low-confidence regions with a wide interval and visible low-support reason.
```

This order should be tuned by benchmark results. The key rule is that the router itself must be benchmarked as `whiteProdVNext`, not inferred from component scores.

### 3.3 Display Rules

The UI should show:

- point price and price per carat;
- confidence band;
- support tier;
- selected model version;
- low-support/fallback reason when applicable.

It should not show raw S33-A as "production" until all S33 gates pass.

---

## 4. Production Release Gates

`WhiteProd vNext` cannot replace S26 unless it passes every hard gate below.

| Gate | Minimum release threshold | Preferred target |
|---|---:|---:|
| Coverage | 100%, explicit fallback | 100%, no silent global fallback |
| Row holdout MAPE | <= S26 current baseline | <= S26 - 0.25pp |
| Row holdout MdAPE | <= S26 current baseline | <= 1.75% |
| Row holdout p90 APE | <= S26 current baseline | <= 12.5% |
| Cell holdout MAPE | <= S26 + 0.5pp | <= S26 |
| Dense tier MAPE | <= S26 + 0.25pp | <= S26 |
| Medium tier MAPE | <= S26 + 0.75pp | <= S26 |
| Sparse p90 APE | <= max(S26, S30) + 3pp | <= max(S26, S30) |
| High carat >=5ct MAPE | <= S26 | close to S30 where S30 has support |
| Princess MAPE | <= S26 + 0.5pp | <= S26 |
| Bias | absolute bias <= 1.0% overall | absolute bias <= 0.5% by tier |
| Monotonicity | 0 carat, color, clarity, HPHT display violations | same |
| Golden parity | Node/app predictions match artifact fixtures | same |
| Conformal intervals | measured 80% and 90% coverage | calibrated by support tier |
| Explainability | selected expert and support reason exposed | same |

If a candidate improves average MAPE but fails monotonicity, parity, coverage, or high-carat guardrails, it does not ship.

---

## 5. Milestones

### M0 - Freeze Baseline and Decision

**Goal:** Lock the current truth so future improvements are honest.

**Work:**

- Keep `node research/scripts/benchmark-production-white-model.mjs` as the canonical baseline command.
- Record current S26, S30, S33-A, and S28 metrics in a release log.
- Treat S33-A as research, not production.

**Exit criteria:**

- Benchmark output is reproducible.
- Current decision is explicit: S26 remains production default.
- No app-facing change depends on S33-A as the sole model.

**Current status:** Mostly done. The benchmark rerun on 2026-06-02 still reports S33-A failed 6 hard gates.

---

### M1 - Build the One-Model Router Benchmark

**Goal:** Measure the routed production policy as one candidate model.

**Work:**

- Implement `predictWhiteProdVNext(input)`.
- Implement `research/scripts/benchmark-white-prod-vnext.mjs`.
- Output `research/data/benchmark-white-prod-vnext.json`.
- Compare `whiteProdVNext` against S26, S30, S33-A, and S28 on the same splits.

**Required benchmark sections:**

- row holdout;
- cell holdout;
- dense/medium/sparse tiers;
- high carat >=5ct;
- princess;
- leave-shape-out;
- selected-spec app mode;
- monotonicity grid;
- pinned cases;
- conformal coverage;
- routing distribution.

**Exit criteria:**

- 100% coverage.
- Routed output beats S26 on row holdout or has a documented product reason for not replacing S26.
- No routing branch has unmeasured behavior.
- Every row reports `selectedExpert`, `supportTier`, and `fallbackReason`.

---

### M2 - Repair S33-A Into a Clean Transfer Surface

**Goal:** Make the constrained anchor surface safe enough for sparse/transfer use.

**Work:**

- Remove the remaining 1 color and 1 clarity inversion.
- Make PAV/constrained fitting convergence explicit.
- Tune on cell holdout and support tiers, not only row holdout.
- Keep L1 monotonicity guarantees without hurting medium/sparse generalization.
- Add HPHT/CVD monotonicity to the same grid scan if growth method is modeled.

**Exit criteria:**

- 0 carat/color/clarity/HPHT violations on the full display grid.
- Cell holdout MAPE <= S26 + 1.0pp for S33 transfer-eligible cells.
- Medium tier MAPE improves over S32-A and S28.
- Sparse p90 stays inside production threshold.
- PAV gap <= 0.50pp.

**Stop condition:**

- If removing the remaining inversions pushes S33-A row MAPE above 8.0% or sparse p90 above threshold, keep S33-A as research and rely on S28 for fallback.

---

### M3 - Tune S30 as the Supported-Curve Expert

**Goal:** Use S30 where it is genuinely best without pretending it is universal.

**Work:**

- Define exact support thresholds for curve use.
- Separate exact-spec curves from parent-spec curves.
- Track bounded extrapolation separately from in-range predictions.
- Add curve-level diagnostics: `n`, min/max carat, endpoint clamp, residual spread.

**Exit criteria:**

- S30-routed rows beat S26 on row MAPE, MdAPE, and p90.
- High-carat S30-routed rows remain materially better than S26.
- Missing-curve rows fall back cleanly.
- No S30 curve creates visible monotonicity or grade-ordering inversions in display grids.

---

### M4 - Add Shape-Specific Hard-Slice Work

**Goal:** Stop one weak shape from making the whole model unsafe.

**Primary slice:** `princess_standard`

**Work:**

- Diagnose princess pricing by carat, color, clarity, and support tier.
- Add shape-specific routing thresholds for princess.
- Test whether S26, S30, or a princess-specific curve should dominate.
- Add pinned princess cases.

**Exit criteria:**

- Princess MAPE <= S26 + 0.5pp for `WhiteProd vNext`.
- Princess p90 does not worsen versus S26.
- No shape-specific rule leaks into unrelated shapes.

---

### M5 - Calibrate Uncertainty on the Routed Model

**Goal:** Make confidence bands honest for the actual output users see.

**Work:**

- Fit conformal intervals on `WhiteProd vNext`, not just individual components.
- Calibrate by support tier and selected expert.
- Report 80% and 90% coverage.
- Widen intervals for sparse, empty, extrapolated, or fallback predictions.

**Exit criteria:**

- 80% interval covers 79%-82% overall.
- 90% interval covers 89%-92% overall.
- Coverage is reported for dense, medium, sparse, high-carat, and princess slices.
- UI receives the interval and confidence reason.

---

### M6 - App Parity and Single Source of Truth

**Goal:** Prevent research/artifact behavior from diverging from live UI behavior.

**Work:**

- Move production prediction logic into a shared JS module.
- Make app code call the shared predictor.
- Add golden fixtures for pinned cases and typical app inputs.
- Add a parity test that compares app-visible predictions against artifact benchmark values.

**Exit criteria:**

- `npm run test:white-ml-display` passes.
- New `npm run test:white-prod-vnext` passes.
- Golden fixture prices match within a tight numeric tolerance.
- No duplicated production formula remains in `index.html`.

---

### M7 - Shadow Release

**Goal:** Let the model prove itself before it controls displayed prices.

**Work:**

- Run `WhiteProd vNext` in shadow mode beside current S26 output.
- Log selected expert, support tier, price delta versus S26, and confidence band.
- Review large deltas manually, especially high-carat, princess, sparse, and fallback rows.

**Exit criteria:**

- No unexplained large deltas.
- Manual review approves pinned edge cases.
- Price deltas are explainable by selected expert and support.
- Rollback path is tested.

---

### M8 - Production Rollout

**Goal:** Ship only after benchmark, parity, and shadow checks agree.

**Work:**

- Release behind a feature flag.
- Start with read-only/display comparison if needed.
- Promote to displayed price only after monitoring is clean.
- Keep S26 available as rollback.

**Exit criteria:**

- All hard release gates pass.
- Feature flag rollback works.
- Production version and artifact hash are visible in diagnostics.
- Post-release monitoring is defined.

---

## 6. Tracking Scoreboard

Use this table after every candidate run.

| Metric | S26 baseline | S30 supported | S33-A current | WhiteProd vNext ACTUAL | Target |
|---|---:|---:|---:|---:|---:|
| Row MAPE | 5.3689% | 4.5087% on covered rows | 7.3382% | **4.9216%** ✓ | <= 5.3689% |
| Row MdAPE | 1.9374% | 1.7025% | 4.9412% | **1.8286%** ✓ | <= 1.9374% |
| Row p90 | 14.1651% | 11.2495% | 16.4146% | **11.9687%** ✓ | <= 14.1651% |
| Cell MAPE | 5.2135% | 4.5647% on covered rows | 7.2125% | **4.9960%** ✓ | <= 5.7135% |
| Dense MAPE | 5.0396% | 4.3359% | 6.8713% | **4.2572%** ✓ | <= 5.2896% |
| Medium MAPE | 6.2473% | 4.7631% | 7.4559% | **5.0851%** ✓ | <= 7.00% |
| Sparse p90 | 39.8850% | 30.5365% | 28.6835% | **38.2972%** ✓ | <= 42.885% |
| High carat MAPE | 10.0082% | 4.6089% | 10.5688% | **6.8740%** ✓ | <= 10.0082% |
| Princess MAPE | 12.1571% | 12.5498% | 14.6461% | **12.0789%** ✓ | <= 12.6571% |
| Monotonicity | guarded lookup behavior | must be scanned | 0C 1Col 1Cla | **0 all violations** ✓ | 0 all visible violations |
| Coverage | 100% | partial | 100% | **100%** ✓ | 100% |
| Bias | -1.0845% | -0.0507% | -0.1036% | **-0.0892%** ✓ | <= 1.0% |
| Conformal 80% | 80.1% | N/A | 80.0% | **80.0%** ✓ | 79-82% |
| Conformal 90% | N/A | N/A | N/A | **90.0%** ✓ | 89-92% |

---

## 7. Immediate Next Work

1. Build and benchmark `WhiteProd vNext` as a routed output.
2. Fix the remaining S33-A color and clarity inversions.
3. Add routed conformal calibration.
4. Add app/parity golden fixtures.
5. Keep S26 as the displayed production default until `WhiteProd vNext` passes all hard gates.

---

## 8. Final Release Rule

The production model is ready only when this sentence is true:

```text
WhiteProd vNext beats or matches S26 on production accuracy, keeps S30's supported-curve advantage, has 100% explicit fallback coverage, has zero visible monotonicity violations, and matches app/artifact golden fixtures.
```

Until then, the new models are valuable research assets, not the production replacement.
