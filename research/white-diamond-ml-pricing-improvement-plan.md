# White-Diamond ML Pricing Improvement Plan

**Status:** Implementation planning note  
**Date:** 2026-06-01  
**Source report:** [`white-diamond-ml-pricing-research-report.md`](white-diamond-ml-pricing-research-report.md)  
**Audience:** Engineering and product decision-makers choosing the next white-diamond pricing model work.

---

## Executive Summary

The highest-value direction is the §8.1 hybrid from the consolidated report:

```text
empirical-Bayes spec anchor
  + fixed monotone S28-style pricing surface
  + support-shrunk monotone residual
```

This should not be judged by row-level MAPE alone. Row-level `reportHash % 5`
splits are lookup-leaky when an anchor can reconstruct dense cells. The first
non-negotiable evaluation upgrade is a held-out cell benchmark so we can tell
whether a candidate is learning a transferable pricing structure or just
memorizing bucket centroids in a smoother disguise.

The practical next model should preserve what S26 does well on dense cells,
repair S28's extrapolation behavior, and handle commodity-vs-premium spread
with cut-aware anchoring before attempting a full two-mode mixture model.

## Data Assumptions

All model work in this plan uses the cleaned master dataset:

```text
research/data/dataset-clean-training.json
```

The raw `starsgem-index.json` remains useful for diagnostics and chart scatter,
but anchors, residuals, support tiers, and held-out benchmarks should be built
from the cleaned `A_standard_recent` training rows unless a phase explicitly says
otherwise.

This matters because "cleaned" does not mean "one price per spec." The master
dataset removes unexplained stale/high clusters, but it still preserves real
within-cell variance, including commodity-vs-premium spread when cut/style
features do not cleanly separate the modes.

---

## Highest-Value Work

| Priority | Work | Why it matters | Expected value |
|----------|------|----------------|----------------|
| P0 | Build held-out cell benchmark | Prevents false wins from row-level lookup leakage | Required before declaring any model better than S26 |
| P1 | Fix S28 grade x size monotonicity | Current S28 can reduce $/ct from 1ct to 5ct for common grades | Makes S28 usable as the structural surface |
| P2 | Add empirical-Bayes spec anchor | Corrects S28's dense-cell under-leveling without hard lookup cliffs | Biggest accuracy lift with controlled extrapolation |
| P3 | Add cut-stratified anchors | Addresses commodity vs premium modes using existing cut signals | Solves most bimodality without mixture-model complexity |
| P4 | Add support-shrunk monotone residual | Captures local structure only where data supports it | Improves fit while protecting sparse-cell behavior |
| P5 | Compare against S26 using §9.4 rule | Keeps production decision tied to interpolation, extrapolation, and monotonicity | Converts research into a release gate |

---

## Target Architecture

### 1. Empirical-Bayes Spec Anchor

Use a shrinkage anchor in log-space instead of raw lookup medians:

```text
anchor_cell =
  (n_cell * mean_log_cell + k * prior_log_surface) / (n_cell + k)
```

Where:

- `n_cell` is the support for the current cell.
- `mean_log_cell` is the cell's observed log $/ct, preferably after current-list
  cleaning.
- `prior_log_surface` is the fixed monotone S28-style surface prediction or a
  broader parent-cell estimate.
- `k` is a tuned prior strength.

This turns lookup support into a continuum:

| Support | Behavior |
|---------|----------|
| Dense cell | Mostly raw cell behavior |
| Thin cell | Partly shrunk toward the surface |
| Empty cell | Fully surface-driven |

This is higher value than a binary "lookup exists / lookup missing" anchor
because it avoids abrupt behavior at zero support while keeping dense-cell
accuracy.

### 2. Fixed S28 Monotone Surface

Keep the S28 premise: a constrained, continuous log($/ct) law that can price
unseen specs. The fix is mostly reparameterization, not a new architecture.

The current failure is that `colorRank_size` / `clarityRank_size` interactions
can make common grades like ROUND E VS1 fall in $/ct as carat increases. Replace
that interaction with:

```text
grade_effect(carat) =
  grade_base_effect
  + positive_grade_premium(carat)
```

The grade premium term should be constrained nonnegative and tested across
common grades, not only ROUND D IF. Minimum gates:

- ROUND D IF
- ROUND E VS1
- ROUND F VS2
- Common non-round shapes with enough support

This keeps the surface structurally useful while removing the specific
grade-by-size sign bug documented in S28 v0.2.

### 3. Cut-Stratified Anchor

The report's hardest unresolved issue is commodity vs premium bimodality inside
the same nominal cell. Example: 3ct ROUND E VS1 contains a commodity cluster near
~$109/ct and a premium cluster near ~$169/ct.

Before building a full two-mode mixture, make `cut_raw`, `polish`, and
`symmetry` first-class anchor features where support allows:

```text
anchor_key_base = shape_style + color + clarity + carat_band
anchor_key_cut  = shape_style + color + clarity + carat_band + cut_tier
```

Start with a deliberately simple two-tier split:

| Tier | Definition | Intended meaning |
|------|------------|------------------|
| A | `cut_raw` is ID or EX, and polish/symmetry are VG or EX when present | Premium / well-finished mode |
| B | Everything else | Commodity / base mode |

Use the cut-stratified anchor only when support is strong enough; otherwise
shrink back to the base anchor and then to the monotone surface.

This should capture much of the premium ID/EX tail without adding latent-mode
inference, UI mode selection, or mixture-model training complexity.

### 4. Support-Shrunk Monotone Residual

Train the residual on:

```text
target_residual = log(actual / anchored_surface_prediction)
```

A monotone LightGBM residual is acceptable, but the shrinkage policy matters more
than the exact algorithm. The residual should taper toward zero when local
support is thin:

```text
residual_weight = min(1, n_cell / n_threshold)
prediction =
  anchored_surface * exp(residual_weight * residual_model_output)
```

Start with:

```text
n_threshold = 10
```

Then validate by support-tier reporting before tuning further. This threshold is
one of the most consequential controls in the residual layer: lower values let
the residual fire in thin cells, while higher values force more shrinkage back to
the anchor and monotone surface.

This prevents the residual layer from hallucinating sparse-region structure and
undermining the surface's extrapolation behavior.

### 5. Display Layer Boundary

This plan changes the point-estimate layer only. User-facing display ladders may
still apply PAV / isotonic projection on top of the point model to guarantee
ordered color, clarity, and carat displays.

Do not train or tune the point model to satisfy display-only smoothing goals.
Keep PAV out of point-estimate evaluation unless the metric explicitly measures a
display ladder.

---

## Evaluation Requirements

### Required Benchmark

Build `research/scripts/benchmark-held-out-cells.mjs` before declaring a
candidate better than S26.

The split should hold out whole cells, not individual rows:

```text
(shape_style, color, clarity, carat_band)
```

Optional secondary keys:

- `cut_tier`, for cut-stratified anchor validation.
- support tier, to report dense / medium / sparse behavior separately.

### Metrics To Report

Every candidate should report:

- global MAPE, MdAPE, and bias;
- MAPE by carat bucket, shape_style, and support tier;
- dense-cell error versus S26;
- held-out-cell error versus S28 and S26;
- monotonicity violations across carat, color, and clarity grids;
- pinned-case absolute error;
- residual contribution by support tier.

### Decision Rule

Do not replace S26 unless the candidate:

1. matches S26 within 1 percentage point on dense held-out cells;
2. has zero grade-grid monotonicity violations on common specs;
3. is continuous in carat except at documented magic-weight behavior;
4. passes pinned cases from §9.3 of the consolidated report;
5. beats S28 v0.2 on no-lookup / sparse extrapolation cases.

The goal is not sub-5% MAPE at any cost. The clean data already has an
approximately 3% within-spec noise floor, and S26's ~4.8% comes largely from
reconstructing the supplier lookup sheet rather than learning a general pricing
law.

---

## Implementation Order

### Phase 1: Evaluation Before Model Churn

1. Add held-out cell benchmark.
2. Add support-tier reporting.
3. Add pinned cases and monotonicity grids for E/VS1 and F/VS2, not only D/IF.
4. Run S26, S28 v0.2, and current lookup baselines through the benchmark.

### Phase 2: Make S28 Safe Enough To Anchor

1. Reparameterize grade x size interactions.
2. Extend monotonicity gates to common grades and supported shapes.
3. Confirm ROUND E VS1 no longer falls in $/ct from 1ct to 5ct.
4. Re-run held-out cell benchmark and pinned cases.

### Phase 3: Add Empirical-Bayes Anchor

1. Implement log-space cell shrinkage.
2. Tune prior strength `k` by support tier.
3. Compare against raw lookup median and pure S28.
4. Report dense, medium, sparse, and empty-cell behavior separately.
5. Check whether S28 `vintage01` terms remain useful once dense current-window
   anchors are live; they may matter most for sparse / empty cells and become
   partly redundant for dense anchored cells.

### Phase 4: Add Cut-Stratified Anchor

1. Implement Tier A / Tier B cut stratification from `cut_raw`, `polish`, and
   `symmetry`.
2. Add cut-aware anchors only above a support threshold.
3. Shrink unsupported cut tiers back to base cell anchor.
4. Validate commodity and premium cases separately where labels support it.

### Phase 5: Add Shrunk Residual

1. Train monotone residual on `log(actual / anchored_surface)`.
2. Weight residual contribution by local support.
3. Force residual to zero out-of-distribution.
4. Confirm residual improves dense / supported cells without damaging sparse
   extrapolation.

---

## Defer For Now

| Idea | Reason to defer |
|------|-----------------|
| Full two-mode mixture model | Correct diagnosis, but too complex before cut-stratified anchors are validated |
| Train only last-N-days | High value later, but depends on reliable timestamps or row-vintage interpretation |
| PAV on point estimates | Can hurt point MAPE; reserve for display ladders and UI guarantees |
| Pure S28 replacement | Structurally attractive, but wrong level without anchors |
| Pure lookup interpolation | Good interpolation, weak support story for sparse and unseen specs |

---

## Practical Definition Of Success

The operative success criterion is the decision rule above. In short: preserve
S26's dense-cell strength, repair S28's sparse-cell extrapolation role, and make
the model explainable as anchor + surface + residual with explicit support
levels for each layer.
