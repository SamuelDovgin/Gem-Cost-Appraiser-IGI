# Production-Quality White-Diamond ML Roadmap

**Date:** 2026-06-02  
**Status:** Decision and implementation roadmap  
**Scope:** White lab diamond price prediction from `research/data/dataset-clean-training.json`  
**Bottom line:** Keep S26/S30-led production behavior for now. Build the production replacement as an S33 constrained credibility model, not as raw S28, S31, or S32-A.

---

## 1. Current State

The recent work produced a much clearer model ladder:

| Model | Role | Best current result | Production status |
|---|---|---:|---|
| S26 | Lookup champion / dense-cell interpolation | 5.37-5.67% row holdout MAPE | Keep live |
| S28 v0.4 | Monotone structural surface | 10.61% row holdout, 0 full-grid inversions | Use as prior, not displayed default |
| S30 fair | Per-spec smooth median curves | 4.54% row holdout where curves exist, ~97% coverage | Best display curve where supported |
| S31 | S28 + projected guarded anchor | 8.49-8.53% row holdout, 0 inversions | Research only |
| S32-A | S28 + hierarchical credibility anchors | 7.09% row, 6.88% cell holdout | Best research direction, not prod |
| S32-C | S32-A + PAV monotone grid | 9.69% row, 0 inversions | Too expensive accuracy trade |
| S32-B | S32-A + CatBoost residual | residual val MAE 0.0444 | Runtime/deployment unresolved |

The two most important facts:

1. **S32-A finally improves cell holdout** versus S28/S31, which means hierarchical credibility anchors are the right direction.
2. **S32-A still has monotonicity violations** (11/56 carat specs, 4 color, 5 clarity), and fixing them with post-hoc PAV increases row MAPE from 7.09% to 9.69%.

That PAV gap is the signal. The next production-quality model must enforce monotonicity during anchor training, not after prediction.

---

## 2. Production Decision

Do **not** ship S28, S31, S32-A, S32-B, or S32-C as the production point-price default yet.

Current production policy should be:

```text
dense supported cells         → S26
supported smooth curves       → S30 as display/secondary curve where coverage and support are good
sparse / unsupported regions  → S28 v0.4 as structural prior and guardrail
all outputs                   → R0 reconciliation + conformal uncertainty band
```

S32-A may be useful as a shadow/display model, but not as the final quoted price until the monotonicity issue is solved without giving up most of its accuracy gain.

---

## 3. Why Each Candidate Is Not Enough

### S26

S26 is still the safest production point estimate because it is closest to the supplier sheet in dense regions. It is not the best long-term model because it is lookup-driven and piecewise constant in carat.

Known gaps:

- weak continuous carat behavior;
- poorer large-carat behavior than S30;
- shape-specific weakness, especially princess;
- limited sparse-cell reasoning beyond lookup fallback.

### S28 v0.4

S28 v0.4 fixed the old underpricing bug:

- full-grid carat monotonicity passes;
- color/clarity/HPHT ordering passes;
- live Node parity matches Python artifact metrics.

But it is still too inaccurate as the displayed production price. It is the right **prior**, not the right **final estimator**.

### S30

S30 is the best row-holdout model where it has a curve, and it is especially strong on high-carat supported specs. It cannot be the universal model because it is per-spec, coverage-limited, and does not transfer laws into empty cells.

### S31

S31 proved monotone anchors can be added safely, but the anchor transfer was not strong enough:

- row holdout improves over S28;
- strict held-out cells do not improve over S28;
- it remains behind S26.

### S32-A

S32-A is the best research architecture so far:

- row holdout: 7.09%;
- cell holdout: 6.88%;
- dense tier: 6.38%;
- high carat: 10.56%;
- beats S28/S31 on the important cell-holdout gate.

It is not production-ready because raw anchors introduce monotonicity inversions.

### S32-B

The CatBoost residual learned useful signal, but it is not deployable yet:

- native categorical splits require ONNX or native CatBoost runtime;
- Node/browser parity is unresolved;
- residuals should not be added until anchor monotonicity is fixed.

### S32-C

S32-C fixes monotonicity but loses the point of S32-A:

- S32-A row MAPE: 7.09%;
- S32-C row MAPE: 9.69%;
- +2.60pp cost is too high.

This proves post-hoc PAV is the wrong place to enforce production constraints.

---

## 4. The Model To Build Next: S33

The next production-quality model should be:

```text
S33 constrained credibility surface

log($/ct) =
  S28 v0.4 monotone structural surface
  + hierarchical credibility anchor offsets
  + optional residual only after anchor gates pass
```

But unlike S32-A, the anchor offsets must be trained under monotonicity constraints.

### 4.1 S33-A: Monotone-Constrained Credibility Anchors

S33-A should keep S32-A's hierarchy:

```text
L1: shape_style + color + clarity + carat_band
L2: shape_style + color + clarity
L3: shape_style + color
L4: shape_style
L5: global
```

Use the same leakage-safe principles:

- anchors are computed from out-of-fold residuals;
- parent anchors are computed directly from row residuals, not child medians;
- credibility weight is `min(level_cap, n / (n + K))`;
- offsets are capped in log space.

The change: fit the final anchor lattice with a constrained objective:

```text
minimize:
  cell_holdout_loss(anchor offsets)
  + lambda_smooth * roughness_penalty
  + lambda_prior  * distance_from_S28_prior

subject to:
  predicted $/ct nondecreasing by carat for every color×clarity
  predicted $/ct nonincreasing as color worsens
  predicted $/ct nonincreasing as clarity worsens
  HPHT >= CVD where growth method is modeled
```

Do not project after the fact. The model should learn the closest accurate surface inside the valid monotone space.

### 4.2 S33-B: Support-Routed S30 Curve Layer

S30 should be used as a supported-curve expert, not as a universal model.

Use it only when all are true:

- a curve exists for the exact spec or approved parent spec;
- curve support is above threshold;
- the prediction is inside observed support or bounded extrapolation is explicitly allowed;
- local curve does not violate grade/carat display gates for the requested panel.

For high carat supported rows, S30 is currently much stronger than every other candidate. A production stack should exploit that, while falling back to S33-A/S28 in unsupported regions.

### 4.3 S33-C: Residual Layer, Deferred

Do not add CatBoost or LightGBM residuals until S33-A passes:

- row holdout;
- cell holdout;
- monotonicity;
- live parity.

When residuals are added:

- train on out-of-fold residuals after anchor application;
- apply only when full-cell support is high enough, likely `n_full >= 20`;
- cap residual contribution, start around `R_cap = 0.10-0.15`;
- shrink by support: `w_resid = n_full / (n_full + K_resid)`;
- require Node/browser parity before any app exposure.

For deployment, prefer a runtime that can be tested deterministically in Node. CatBoost is attractive for categorical features, but it needs ONNX or a native runtime. If that is too heavy for the app, use a simpler JSON-exported tree model or skip residuals entirely.

---

## 5. Production Release Gates

No model should replace S26 unless it passes all gates:

| Gate | Required threshold |
|---|---|
| Row holdout | MAPE <= S26 + 0.5pp, or clear product reason for exception |
| Dense tier | MAPE <= S26 + 1.0pp |
| Cell holdout | MAPE <= S26 + 1.5pp and better than S28/S31 |
| Sparse tier | p90 APE <= current S26/S30 sparse p90 + 3pp |
| High carat >=5ct | MAPE <= S26 and close to S30 where S30 has support |
| Princess | no worse than S26 by more than 1pp |
| Monotonicity | 0 carat, 0 color, 0 clarity, 0 HPHT violations on full grid |
| Live parity | app/Node prediction matches artifact benchmark on golden rows |
| Coverage | 100% through explicit fallback; no silent null/global fallback |
| Uncertainty | conformal interval coverage is measured and shown |

Current status:

| Model | Pass count | Blocking issues |
|---|---:|---|
| S26 | production baseline | lookup/continuity limitations |
| S30 | partial expert | coverage, no cross-grade transfer |
| S32-A | close research candidate | monotonicity, dense gap |
| S32-C | structurally safe | too much accuracy loss |
| S32-B | incomplete | runtime/parity, residual risk |

---

## 6. Implementation Plan

### Phase 0: Freeze Evaluation

Create one canonical command that every candidate must pass:

```bash
node research/scripts/benchmark-production-white-model.mjs
```

It should include:

- row holdout;
- strict cell holdout;
- support tiers;
- high-carat slice;
- princess slice;
- leave-shape-out;
- monotonicity grids;
- pinned cases;
- live parity golden rows;
- conformal interval coverage.

Do not compare models using one-off scripts with different splits.

### Phase 1: Build S33-A

Start from S32-A and change only anchor fitting:

1. Keep OOF hierarchical anchors.
2. Add constrained optimization for anchor offsets.
3. Tune on cell holdout, not row holdout.
4. Track the "PAV gap" as a metric:

```text
PAV gap = row MAPE after projection - row MAPE before projection
```

Target: PAV gap <= 0.5pp. Current S32 gap is 2.60pp.

### Phase 2: Add Production Router

The production model should be a policy artifact, not a hidden set of if-statements:

```json
{
  "version": "white-prod-vNext",
  "experts": ["S26", "S30", "S33A", "S28"],
  "routingRules": [...]
}
```

Expected routing:

```text
if dense S26 lookup support and not high-carat exception:
  use S26
else if S30 curve exists with enough support:
  use S30
else if S33-A passes monotone and support gate:
  use S33-A
else:
  use S28 v0.4 with low-confidence band
```

The app should display:

- selected model;
- support tier;
- confidence band;
- fallback reason.

### Phase 3: Calibrate Uncertainty

Use split conformal calibration on the same production routing output, not on isolated model components.

For each support tier:

```text
interval_width = quantile(abs(log(actual / pred)), 0.80 or 0.90)
```

Report actual coverage:

```text
"80% band covered 80.7% of row-holdout stones in dense cells."
```

Without calibrated intervals, a sub-6% MAPE model can still be misleading on rare shapes and large stones.

### Phase 4: Optional Residual

Only after S33-A + router passes gates:

1. Add residual model on warm cells only.
2. Compare with and without residual on cell holdout.
3. Require residual to improve dense rows without degrading sparse/high-carat/monotone gates.
4. Require deployable runtime and parity tests.

If residual fails any of those gates, skip it. A production model does not need a residual layer if the anchor/router stack already reaches the business target.

---

## 7. App Integration Requirements

Before putting the model in production UI:

1. **Single source of truth:** app should import shared predictor modules rather than duplicating formulas in `index.html`.
2. **Artifact version shown:** the UI should expose `modelVersion`.
3. **No silent fallback:** if a model falls back to S28/global prior, show "low support" in the confidence text.
4. **Golden parity test:** compare app/Node predictions on pinned rows for S26, S30, S33, S28.
5. **No raw S32-A display as final quote:** if shown, label it shadow/research until monotonicity is solved.

The previous S28 bug happened because artifact metrics and live JS behavior diverged. Production work must treat parity as a release blocker, not a nice-to-have.

---

## 8. Recommended Next Tasks

1. Build `benchmark-production-white-model.mjs`.
2. Implement S33-A constrained anchor training.
3. Add the PAV-gap metric to every monotone candidate benchmark.
4. Build a production router artifact using S26/S30/S33-A/S28.
5. Add conformal intervals for the routed output.
6. Refactor app prediction to shared JS modules.
7. Only then consider CatBoost/LightGBM residuals.

---

## 9. Production Readiness Answer

The best production-quality model is **not a single raw ML model** yet. It is a guarded pricing policy:

```text
S26 dense interpolation
  + S30 supported smooth curves
  + S33-A constrained credibility surface for transfer/extrapolation
  + S28 v0.4 as final monotone fallback
  + conformal uncertainty bands
```

The best next research model is **S33-A**, a monotone-constrained version of S32-A. S32-A showed the right accuracy direction; S32-C showed why post-hoc monotonicity is too expensive. S33-A should combine those lessons by fitting the anchors inside the monotone feasible space from the start.

Until S33-A passes the gates, **keep S26 as the production default**.
