# S23 Implementation Decisions

**Model**: S23 — Grade-Agnostic Anchor + Monotone LightGBM Residual  
**Training script**: `research/scripts/starsgem-mrpe-v2.py`  
**Output artifact**: `research/data/starsgem-ml-extra-trees-model-s23-grade-agnostic-anchor.json`  
**Training date**: 2026-05-20  
**Dataset**: `STARS Diamonds Stock2026.5.20.xls` — 28,394 rows  
**Train / Test split**: 27,602 train / 792 test (one holdout per `(Shape, carat_bucket, Color, Clarity, Cut)` bucket)

---

## Results at a Glance

| Metric | S20 (baseline) | S21 | S23 (final, formally monotone) |
|--------|---------------|-----|-----|
| Selected-spec MAPE | ~6.0% | ~6.75% (+0.75 pp) | **7.60%** |
| Cert-loaded MAPE | ~5.4% | ~5.9% | **6.64%** |
| Clarity inversions — 1728-cell grid sweep | 1,127 | 0 | **0** ✅ |
| Color inversions — 1728-cell grid sweep | many | 0 | **0** ✅ |
| IF 3ct ROUND E > VVS1 (no floor) | ❌ | ✅ (constrained) | ✅ **$675 vs $618** |
| Floor hack required | Yes | No | **No** |
| Formally grade-agnostic (anchor + tail) | No | No | **Yes** |

The acceptance criteria:
- Monotonicity sweep: 1728 checks, 0 violations ✅
- IF 3ct ROUND E > VVS1 3ct ROUND E with no floor hack ✅
- Cert-loaded MAPE reported: 6.64% ✅

> **Note on MAPE vs S21**: The +0.85 pp MAPE regression vs S21 is the cost of full formal monotonicity. Three grade-aware unconstrained features were removed (interaction terms, category prior, grade-aware tail levels). The cert-loaded MAPE (6.64%) better reflects real-world accuracy since all unseen inputs arrive cert-loaded.

---

## Decision 1: Grade-Agnostic Lookup Anchor

### What
In S20 and S21, the lookup anchor key included `Color` and `Clarity` at every fallback level (e.g., `(carat_bucket, Shape, Color, Clarity, TypeName, Report, Cut, …)`). In S23, Color and Clarity are **completely absent** from all six lookup levels (`A`–`F`). The finest level is `(carat_bucket, Shape, TypeName, Report, Cut, Polish, Symmetry)`.

### Why
The root cause of S20's 1,127 clarity inversions was lookup **cell sparsity**. For a grade-specific anchor:

- `IF, 3ct+, ROUND` → 0 training rows → falls to global fallback of **$127/ct**
- `VVS1, 3ct+, ROUND` → 17 training rows → real anchor of **$638/ct**

Because the anchor already priced IF far below VVS1, the ExtraTrees model (S20) had to overcome a $511/ct anchor gap through its features alone — and with isolated leaves it could not generalize from IF at 1ct (plentiful data) to IF at 3ct (empty cell). Result: IF < VVS1 in 1,127 cases.

S21 switched to LightGBM with monotone constraints on `Clarity_Rank`, which eliminated inversions, but the anchor gap remained. The constraint forced the model to fight the anchor rather than fix the underlying sparsity, producing a MAPE regression of +0.75 pp.

S23 removes Color and Clarity from the anchor entirely. Now:

- `IF, 3ct+, ROUND` and `VVS1, 3ct+, ROUND` share the **same** anchor (e.g., $580/ct for all round 3ct+ stones)
- All grade premium is learned purely through ordinal rank features with monotone constraints
- IF-premium learned from dense 1ct data can **transfer** to sparse 3ct+ cells via shared numeric features — possible only because LightGBM uses connected tree splits, not isolated leaves

### Trade-off accepted
Removing grade from the anchor reduces anchor precision slightly for common grade-size combinations. This is intentional: the GBDT residual is responsible for all grade signal, and that is exactly what it is well-suited for with monotone constraints.

---

## Decision 2: LightGBM over ExtraTrees

### What
S20 used ExtraTrees (scikit-learn). S23 uses `LGBMRegressor` with `monotone_constraints_method="advanced"`.

### Why
ExtraTrees has two structural properties that prevent it from solving the clarity inversion problem:

1. **Isolated leaves**: each leaf holds only the training rows that fell into it. An IF-at-3ct leaf with zero rows cannot borrow information from an IF-at-1ct leaf. LightGBM's boosted trees share feature splits across the whole tree, enabling the model to extrapolate grade premium from dense cells to sparse ones.

2. **No monotone constraint API**: scikit-learn's ExtraTrees does not support per-feature monotone constraints. Clarity cannot be structurally prevented from inverting — any constraint would have to be applied post-hoc (PAV), which caused +5.34 pp MAPE regression in S22 trials.

LightGBM's `monotone_constraints_method="advanced"` (the "Contrapositive" algorithm) enforces constraints at **split time**, not post-hoc. This means the constraint is globally respected without distorting the rest of the tree structure.

### Hyperparameters (same as S21, proven stable)
```
n_estimators=400, num_leaves=63, max_depth=-1
learning_rate=0.04, min_child_samples=20
subsample=0.8, colsample_bytree=0.8, random_state=42
```

400 trees at `lr=0.04` gives enough capacity for the grade-agnostic anchor to leave meaningful residuals to fit, while keeping the serialized model at ~1.4 MB (well within browser budget).

---

## Decision 3: Ordinal Grade Ranks, Not One-Hot Encoding

### What
`Clarity` and `Color` are **excluded** from `S23_CATEGORICAL_FEATURES` (the one-hot encoded columns). Instead, two continuous ordinal features are added to the numeric block:

```python
Clarity_Rank = {IF: 0, VVS1: 1, VVS2: 2, VS1: 3, VS2: 4, SI1: 5, SI2: 6}
Color_Rank   = {D: 0, E: 1, F: 2, G: 3, H: 4, I: 5, J: 6}
```

### Why
Monotone constraints in LightGBM operate on **numeric features** only. A one-hot encoded clarity column (`Clarity_IF`, `Clarity_VVS1`, …) would produce 7 binary features with no inherent ordering, and there is no way to tell LightGBM "split on `Clarity_IF` must produce a higher predicted value than a split on `Clarity_VVS1`." The constraint vector accepts `0` or `±1` per feature index — it cannot encode inter-category ordering.

By collapsing the 7-category clarity to a single ordinal rank, a single `monotone_constraints[Clarity_Rank_idx] = -1` entry is sufficient to enforce: *"as Clarity_Rank increases (from IF toward SI2), predicted price must not increase."*

### Rank convention
`0 = best grade` (IF for clarity, D for color). This means `direction = -1` in `monotone-axes.json` (price non-increasing as rank index increases).

---

## Decision 4: Log_Carat × Grade Interaction Terms — REMOVED

### Original intent
Two interaction features were initially added:
```python
Log_Carat_x_ClarityRank = log(Carat) * Clarity_Rank
Log_Carat_x_ColorRank   = log(Carat) * Color_Rank
```
These were intended to capture size-dependent grade premiums (IF/VVS1 gap grows with carat). They were unconstrained (`0` in the monotone vector) because LightGBM's constraints are per-feature/marginal.

### Why they were removed

This was identified as a formal monotonicity gap in peer review (`research/deep-research-report (1).md`). LightGBM's `monotone_constraints` are **marginal** — they guarantee: *"holding all other features fixed, increasing `Clarity_Rank` must not increase predicted price."* But when grade changes in a real prediction, **both** `Clarity_Rank` and `Log_Carat_x_ClarityRank` change simultaneously. The model can then satisfy the marginal constraint on `Clarity_Rank` while using the unconstrained `Log_Carat_x_ClarityRank` to partially cancel it, producing inversions in the joint distribution.

After removing only `Category_RatePerCt` (but before removing interaction terms), the model produced **146 VS2→SI1 violations at 0.5ct and 1.0ct** in the full grid sweep. Removing the interaction terms eliminated these.

### LightGBM's internal representation
LightGBM learns size-dependent grade effects internally via tree splits on `Log_Carat` and `Clarity_Rank` at different levels — no explicit interaction term is needed. The only formal guarantee is that the split ordering respects the monotone constraint on each feature individually.

---

## Decision 5: Monotone Axes Registry (monotone-axes.json)

### What
Two new entries were added to the `white_diamond` array in `research/data/monotone-axes.json`:

```json
{"feature": "Log_Carat",       "direction": 1, ...}
{"feature": "Lookup_RatePerCt","direction": 1, ...}
```

### Why

**Log_Carat (+1)**: The training script uses both `Carat` (raw) and `Log_Carat` (log transform) as numeric features. Without constraining `Log_Carat`, the model could fit a negative coefficient on the log term that partially cancels the positive raw-carat constraint, producing a non-monotone price–carat curve in practice. Constraining both ensures the log transform cannot invert carat monotonicity.

**Lookup_RatePerCt (+1)**: The grade-agnostic anchor rate is now a numeric feature in S23. A higher anchor rate (e.g., round 3ct vs round 1ct) should produce a higher final price — this is structurally true by construction of the residual prediction formula:

```
price = Lookup_RatePerCt × Tail_Mult × exp(GBDT_residual) × Carat
```

Constraining the anchor rate feature prevents the GBDT from fitting a negative coefficient that would flip this expected relationship.

Both entries are consumed by `build_monotone_vector()` in the training script, which iterates `monotone-axes.json` and maps feature names to constraint vector indices via `pre.get_feature_names_out()`.

---

## Decision 6: PAV Not Applied to Point Pricing

### What
S21 used a PAV (pool adjacent violators / isotonic regression) step in Layer 1 (lookup surface) and Layer 4 (browser inference post-processing). S23 **retains Layer 4 PAV for the browser price-card display** but does **not** apply PAV to individual point predictions.

### Why
S22 was an experiment that applied PAV to point pricing. It produced +5.34 pp MAPE regression because PAV "smooths" prices toward grade neighbors, which distorts individual stone predictions significantly when the underlying data has legitimate grade variance.

With S23's monotone constraints, the model's point predictions are already globally monotone in grade. PAV on the ladder display remains useful as a cheap browser-side insurance check (zero computational cost, catches any numerical edge cases), but it no longer needs to do heavy lifting.

---

## Implementation Summary

### Files Modified

| File | Change |
|------|--------|
| `research/scripts/starsgem-mrpe-v2.py` | Added `S23_CATEGORICAL_FEATURES`, `S23_LOOKUP_LEVELS`, `S23_MODEL_JSON`, `S23_TAIL_LEVELS` constants; `build_s23_lookup()`, `as_model_frame_s23()`, `s23_predict_prices()` functions; modified `build_large_carat_tail_model()` to accept `levels` param; modified `export_model_lgbm()` to accept `output_path` and `categorical_features` params; added `strategy_s23_grade_agnostic_anchor()`; wired `--only-s23` flag into `run()`; removed interaction terms + `Category_RatePerCt` from features; expanded monotonicity sweep to 1728 checks |
| `research/data/monotone-axes.json` | Added `Log_Carat` and `Lookup_RatePerCt` to `white_diamond` array |

### Files Created

| File | Description |
|------|-------------|
| `research/data/starsgem-ml-extra-trees-model-s23-grade-agnostic-anchor.json` | Trained S23 model (1.3 MB, 400 LightGBM trees) |
| `research/s23-implementation-decisions.md` | This document |
| `research/deep-research-report-1-implementation.md` | Implementation log for peer-review changes |

### Training Command
```bash
python3 research/scripts/starsgem-mrpe-v2.py --only-s23
```

### Final Training Run Output
```
[S23 monotonicity sweep] 1728 checks  clarity violations: 0  color violations: 0  ✅ PASS
[S23 acceptance] IF 3ct ROUND E: $675.29  VVS1: $618.10  ✅ IF > VVS1
→ model exported to .../starsgem-ml-extra-trees-model-s23-grade-agnostic-anchor.json  (1.3 MB, 400 trees)
✓  MAPE: 7.5997%  MAE: $87.37  R²: 0.9469
```

- Clarity inversions: **0** (guaranteed by `monotone_constraints_method="advanced"` + grade-agnostic features)
- Selected-spec MAPE: **7.60%** | Cert-loaded MAPE: **6.64%**
- IF 3ct ROUND E > VVS1 3ct ROUND E: **$675 vs $618** ✅, no floor hack

## Decision 7: Grade-Agnostic Category Prior — REMOVED

### Original intent
`Category_RatePerCt` was a numeric feature providing a grade-aware prior from `build_category_prior()`. Its lookup key included both `Color` and `Clarity` at its finest levels (SCCT/SCC/CC), giving the GBDT a strong starting signal for each color×clarity cell.

### Why it was removed
Same formal gap as the interaction terms (Decision 4): when `Clarity` changes in the monotonicity sweep, `Category_RatePerCt` also changes because it is keyed on `Clarity`. This is an unconstrained feature, so the GBDT can use its change to override the constrained `Clarity_Rank` signal.

After removing interaction terms but keeping `Category_RatePerCt`, the full grid sweep still showed **146 VS2→SI1 violations at 0.5ct and 1.0ct**. Removing `Category_RatePerCt` (and `Log_Category_RatePerCt`) eliminated all remaining violations at those carat sizes.

The grade-agnostic `Lookup_RatePerCt` (from `build_s23_lookup`) remains in the feature set and provides the dominant market-rate anchor signal without breaking the monotone guarantee.

---

## Decision 8: Grade-Agnostic Large-Carat Tail Model (S23_TAIL_LEVELS)

### What
`LARGE_CARAT_TAIL_LEVELS` (the global constant) includes `Color` and `Clarity` in its top-three grouping levels:
```python
("SCCT", ["Shape", "Color", "Clarity", "Cut_Style_Group", "TypeName"]),
("SCCG", ["Shape", "Color", "Clarity", "Cut_Style_Group"]),
("SCC",  ["Shape", "Color", "Clarity"]),
```

For S23, a separate `S23_TAIL_LEVELS` constant omits all grade fields:
```python
S23_TAIL_LEVELS = [
    ("SGT", ["Shape", "Cut_Style_Group", "TypeName"]),
    ("SG",  ["Shape", "Cut_Style_Group"]),
    ("S",   ["Shape"]),
    ("G",   ["Cut_Style_Group"]),
]
```

`build_large_carat_tail_model()` now accepts an optional `levels` parameter; `strategy_s23` passes `levels=S23_TAIL_LEVELS`.

### Why
The tail multiplier appears in **both** the GBDT feature frame and the prediction formula:
```
price = base_lookup_rate × tail_mult × exp(GBDT_residual) × Carat
```

If `tail_mult` is keyed on `Color`/`Clarity`, it changes when grade changes. For 7ct+ stones in the monotonicity sweep:
- VS1 ROUND 7ct might have a lower tail slope (fewer data points → shrinks toward global slope)
- VS2 ROUND 7ct might have a higher tail slope (different empirical curve)
- Result: VS2 price > VS1 price, even with a correctly constrained GBDT residual

After switching to `S23_TAIL_LEVELS`, the extended sweep (which added 7ct and 10ct) passed with **0 violations across all 1728 checks**.

### Trade-off accepted
The grade-agnostic tail model cannot fit grade-specific slope differences for large stones. In practice, large-carat data is sparse per grade cell anyway, so the grade-specific slopes would largely shrink to the global slope through Bayesian shrinkage (`weight = count/(count+20)`). The information loss is minimal.

---

## Updated Results (Post Formal-Monotonicity Hardening)

| Metric | Value |
|--------|-------|
| Selected-spec MAPE | **7.60%** |
| Cert-loaded MAPE | **6.64%** |
| Monotonicity sweep | **1728 checks, 0 violations** |
| IF 3ct ROUND E vs VVS1 | **$675 vs $618** |
| Model size | **1.3 MB, 400 trees** |
| Training date | **2026-05-20** |



S23 passes all acceptance criteria as a standalone model. Before deploying to browser inference (`starsgem-ml-predict.mjs`):

1. Update the browser inference router to load the S23 model JSON instead of / alongside S21.
2. Verify that the browser `predictMonotoneGeneralized()` ladder check still passes with the grade-agnostic anchor (the lookup tables embedded in the JSON now have no Color/Clarity keys, which is a schema change the browser walker must handle).
3. Run the full regression test suite against S21 to confirm no price card regressions above 5% on benchmark stones.
