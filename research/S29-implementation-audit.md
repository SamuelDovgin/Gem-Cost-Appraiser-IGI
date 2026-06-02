# S29 Hybrid Pricing Model — Implementation Audit

**Date:** 2026-06-01  
**Status:** Not release-ready  
**Audited files:**

- [`scripts/train-s29-hybrid.py`](scripts/train-s29-hybrid.py)
- [`data/starsgem-ml-model-s29-hybrid.json`](data/starsgem-ml-model-s29-hybrid.json)
- [`data/benchmark-s29-vs-s26-s28.json`](data/benchmark-s29-vs-s26-s28.json)
- [`S29-implementation-report.md`](S29-implementation-report.md)

---

## Summary

**Latest post-fix review update:** The revised S29 implementation now fixes the
engineering issues from the original audit: S26 normalization is materially
correct, anchors are surface-relative offsets, the artifact includes the main
scoring state, full-hybrid monotonicity is measured, k-tuning uses deterministic
MD5 row splits, held-out benchmark cells force pure surface predictions, and
Rule 5 no longer passes on equality. `test-s29-parity.mjs` now exercises the
standalone Node predictor with the LightGBM residual active.

S29 still fails the model decision rule and remains research-only:

- S29 does not match S26 on dense held-out cells.
- S29 has a full-hybrid clarity ladder inversion from cell offsets.
- S29 only matches S28 on held-out extrapolation; it does not improve it.
- S26 remains the live production model.

The original audit findings below are retained for traceability. Some have been
fixed in the revised implementation; the remaining actionable items are listed
in the post-fix review update above.

The strongest conclusion remains:

```text
The S29 prototype is a useful scaffold, but the reported S29-vs-S26 win is not
valid yet, and the JSON artifact is not a deployable model.
```

---

## Blocking Issues

Historical original-audit findings. Check the post-fix review update before
treating any one item in this section as still current.

### 1. S26 comparison is not apples-to-apples

The S29 training script does not evaluate S26 using the same normalized fields
as the S26 trainer.

In `predict_s26_for_row`, the script passes:

```python
raw = {
    "carat": r["carat"],
    "shape": r["shape"],
    "color": r["color"],
    "clarity": r["clarity"],
    "cut_raw": r["cut"],
    "typeName": "CVD",
}
```

But S26 lookup reconstruction expects supplier shape and true growth fields:

```text
Shape    = raw_shape_code or shape, e.g. ROUND
TypeName = actual CVD / HPHT
Cut      = original cut_raw
```

Because S29 rows store `shape` as `shape_style` values like `round_standard`,
the S29 shim misses most high-specificity S26 lookup tables and falls back to
coarse levels.

Measured on the full cleaned dataset:

| S26 lookup path | MAPE | Lookup levels |
|-----------------|-----:|---------------|
| Correct S26 normalization | 5.453% | Level A: 21,661 rows |
| S29 script approximation | 9.477% | Level F: 21,977 rows |

This invalidates the reported claim that S29 beats S26 by 5+ percentage points
on in-cell dense rows. The benchmark is mostly comparing S29 against a degraded
S26 fallback, not the S26 champion policy.

**Required fix:** keep original fields in `load_rows()`:

- `raw_shape_code`
- supplier `shape`
- `shape_style`
- `typeName`
- original `cut_raw`
- original `report` / report default

Then reuse the S26 normalization from `train-s26-champion.mjs` or port it
exactly.

---

### 2. Full S29 monotonicity is not actually tested

The script checks monotonicity on the fixed surface only:

```python
mono_grid = evaluate_monotonicity_grid(surface, surface["norms"])
```

But the production prediction is:

```python
log_upc = anchor_log + shrink_w * residual
```

That means the tested model is not the model being evaluated in S29 predictions.
The report's own pinned cases show a likely full-model clarity inversion:

| Case | S29 $/ct |
|------|---------:|
| 3.0ct ROUND E VS1 | $116 |
| 3.0ct ROUND E VS2 | $121 |

VS2 is worse clarity than VS1, so it should not price above VS1 for the same
shape/color/carat/cut unless the point model explicitly allows local supplier
cell noise to override gem-order constraints. The improvement plan's decision
rule did not allow that.

**Required fix:** add full-hybrid monotonicity gates that call `predict_s29()`,
not only `surface["predictor"]`.

Minimum full-model gates:

- carat ladders for ROUND_STANDARD D/IF, E/VS1, F/VS2;
- color ladders at fixed shape/carat/clarity/cut tier;
- clarity ladders at fixed shape/carat/color/cut tier;
- both Tier A and Tier B where anchors exist;
- held-out / surface-only cases and anchored cases.

If anchors are allowed to preserve noisy local inversions for point accuracy,
then the report must say that clearly and the decision rule must fail the
point-model monotonicity requirement.

---

### 3. The model artifact is metadata, not a usable model

`starsgem-ml-model-s29-hybrid.json` does not include enough data to reproduce
S29 predictions.

Missing from the artifact:

- base anchor table values;
- cut-stratified anchor table values;
- surface standardization `means` and `stds`;
- residual LightGBM model dump;
- fallback behavior needed to score a new stone.

The script explicitly saves without the LightGBM binary:

```python
# Save the model (without LightGBM binary which can't be JSON-serialized)
```

The artifact only stores anchor counts and residual feature names, so it cannot
serve as the production or browser model.

**Required fix:** either:

1. make the JSON a true scoring artifact by serializing all prediction state, or
2. rename it as an evaluation metadata artifact and add a separate deployable
   model export.

For a true JSON artifact, include:

- `surfaceModel.means`;
- `surfaceModel.stds`;
- `anchors.baseAnchors`;
- `anchors.cutStratifiedAnchors`;
- LightGBM `booster_.dump_model()` or a repo-compatible tree export;
- versioned feature schema and normalization rules.

---

### 4. Anchor implementation does not match the intended hybrid formula

The improvement plan's target architecture was:

```text
log($/ct) = specAnchor + f_monotone(carat, magic, grade, cut, ...)
          + shrunk residual
```

The current implementation instead returns a scalar cell anchor and discards the
surface for supported cells:

```python
if cut_key in cut_anchors:
    return cut_anchors[cut_key]["anchorLogUpc"]
if base_key in base_anchors:
    return base_anchors[base_key]["anchorLogUpc"]
return surface["predictor"](row)
```

Then:

```python
log_upc = anchor_log + shrink_w * residual
```

For anchored cells, this is closer to:

```text
cell_median_log_upc + residual
```

It is not:

```text
surface(row) + shrunk cell offset + residual
```

Consequences:

- dense cells inherit bucket-level steps instead of a continuous S28 carat law;
- anchored predictions can violate grade/color order because anchors are raw
  cell means;
- S29 equals S28 on every held-out cell by design, so it does not improve sparse
  extrapolation yet;
- the "continuous in carat" rule is marked as passed without measuring the full
  hybrid curve.

**Required fix:** store anchors as offsets from the surface, not replacements
for the surface:

```text
cell_offset =
  (n * mean(log_actual - log_surface(row)) + k * 0) / (n + k)

prediction =
  surface(row) + cell_offset + support_weight * residual(row)
```

Cut-stratified anchors should be cut offsets with fallback to base offsets, not
standalone cell medians.

---

### 5. `k_prior` tuning is not meaningful

The k-tuning function splits whole cells into tuning train and validation. For
validation cells, no anchor exists, so every `k` falls back to the surface:

```python
anchor_log = predict_anchor_for_row(row, anchors, surface)
```

For unseen validation cells, `predict_anchor_for_row()` returns the surface, so
`k` has no effect. This explains why the report says all k values produce
identical validation MAPE.

**Required fix:** tune `k` on cells where the anchor exists but support varies.
Use one of:

- repeated within-cell row splits for cells with enough rows;
- leave-some-rows-per-cell validation by support tier;
- bootstrap validation that evaluates dense, medium, and sparse cells
  separately.

The held-out-cell benchmark is still required for final model assessment, but it
cannot tune a cell-anchor prior if the cell anchor is intentionally absent.

---

### 6. Rule 5 should not pass when S29 merely equals S28

The report marks "Beat S28 on sparse extrapolation" as pass because:

```text
S29 <= S28
```

But S29 and S28 are exactly equal on held-out cells by design. Equality is not an
improvement and the sparse held-out MAPE is extremely poor:

```text
S29 sparse held-out MAPE = 290.31%
S28 sparse held-out MAPE = 290.31%
```

**Required fix:** Rule 5 should require a meaningful improvement or at least a
bounded sparse/extrapolation error. For example:

```text
PASS only if S29 sparse held-out MAPE < S28 by >= 1pp
or sparse held-out MAPE is below an agreed absolute threshold.
```

---

## Non-Blocking Issues

### Surface gates should use canonical `shape_style`

The surface monotonicity gates use `"round"` as the shape, while the cleaned
dataset uses canonical values such as `round_standard`. A quick check showed
both `round` and `round_standard` were nondecreasing for E/VS1 in the current
run, so this is not the primary failure. Still, gates should use canonical
`shape_style` values so the tested spec matches the training schema.

### The report overstates production readiness

The implementation report says S29 "successfully implements the full
architecture" and recommends a short-term blend. That is premature until the
blocking issues above are fixed and the benchmark is rerun with a valid S26
baseline and full-hybrid monotonicity gates.

---

## What Was Implemented Correctly

- Uses `research/data/dataset-clean-training.json`.
- Builds a whole-cell holdout split.
- Adds empirical-Bayes shrinkage machinery.
- Implements Tier A / Tier B cut stratification with support fallback.
- Uses `n_threshold = 10` for residual shrinkage.
- Adds a fixed S28-style surface with grade-premium terms.
- Produces useful diagnostic metrics and pinned case output.

These pieces are worth keeping, but the scoring formula and benchmark need to be
tightened before S29 can be compared to S26.

---

## Recommended Fix Order

1. Fix S26 baseline normalization and rerun S26 benchmark.
2. Change anchors from replacement medians to surface offsets.
3. Serialize a real deployable S29 artifact.
4. Add full-hybrid monotonicity gates and make decision Rule 2 use them.
5. Retune `k_prior` using within-cell / support-tier validation.
6. Redefine Rule 5 so equality with S28 does not pass.
7. Rerun `benchmark-s29-vs-s26-s28.json` and update the implementation report.

Until those are done, S29 should be considered a prototype scaffold, not an
accepted implementation of the improvement plan.
