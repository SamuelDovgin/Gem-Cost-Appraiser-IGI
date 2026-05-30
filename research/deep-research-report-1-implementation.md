# Deep Research Report (1) — Implementation Log

**Source report**: `research/deep-research-report (1).md`  
**Training script**: `research/scripts/starsgem-mrpe-v2.py`  
**Model artifact**: `research/data/starsgem-ml-extra-trees-model-s23-grade-agnostic-anchor.json`  
**Implementation date**: 2026-05-20

---

## Report Summary

The deep-research report performed a peer review of the S23 architecture. It validated the grade-agnostic anchor direction and the use of LightGBM monotone constraints, but identified three structural gaps that could allow grade ordering inversions despite the constraints appearing correct in isolation.

---

## Finding 1: Monotone Constraints Are Marginal, Not Interaction-Aware

### What the report said
LightGBM's `monotone_constraints_method="advanced"` guarantees:

> *"Holding all other features fixed, increasing `Clarity_Rank` does not increase predicted price."*

This is a **marginal** guarantee. It does **not** guarantee:

> *"Increasing `Clarity_Rank` by 1 (i.e., changing grade from VS1 to VS2) does not increase price, when all other features are allowed to change as they naturally would with grade."*

When grade changes in the real world, unconstrained features that co-vary with grade can override the constraint's effect on the joint distribution.

### Unconstrained features identified in S23 (initial version)

| Feature | Why it co-varies with grade |
|---------|----------------------------|
| `Log_Carat_x_ClarityRank` | Direct product of Carat and Clarity_Rank — changes whenever Clarity changes |
| `Log_Carat_x_ColorRank` | Direct product of Carat and Color_Rank — changes whenever Color changes |
| `Category_RatePerCt` | Grade-aware prior (keyed on Color+Clarity); VS1 and VS2 cells have different values |
| `Log_Category_RatePerCt` | Log transform of above |
| `Large_Carat_Tail_Multiplier` (5ct+) | Tail slope fitted with Color+Clarity in grouping keys; VS1/VS2 can have different slopes |

### Fixes implemented

**Fix 1a — Remove interaction terms**

`Log_Carat_x_ClarityRank` and `Log_Carat_x_ColorRank` were removed from both `as_model_frame_s23()` and `feats_num` in `strategy_s23_grade_agnostic_anchor()`.

LightGBM learns size-dependent grade effects internally through joint splits on `Log_Carat` and `Clarity_Rank` — no explicit interaction term is required for expressiveness, and the constraint on `Clarity_Rank` alone remains sufficient.

**Fix 1b — Remove Category_RatePerCt**

`Category_RatePerCt` and `Log_Category_RatePerCt` were removed from both `as_model_frame_s23()` and `feats_num`. The grade-agnostic `Lookup_RatePerCt` (from `build_s23_lookup`) provides the dominant market-rate signal without any grade information in its key.

`build_category_prior()` remains in the codebase for other strategies (S19, S20, S21) that don't require strict grade-agnostic monotonicity.

**Fix 1c — Grade-agnostic large-carat tail model (`S23_TAIL_LEVELS`)**

The global `LARGE_CARAT_TAIL_LEVELS` was:
```python
("SCCT", ["Shape", "Color", "Clarity", "Cut_Style_Group", "TypeName"]),
("SCCG", ["Shape", "Color", "Clarity", "Cut_Style_Group"]),
("SCC",  ["Shape", "Color", "Clarity"]),
...
```

The tail multiplier appears in the prediction formula:
```
price = base_lookup_rate × tail_mult × exp(GBDT_residual) × Carat
```

When `tail_mult` is keyed on Color/Clarity, it changes when grade changes, directly causing price inversions at 7-10ct independent of the GBDT residual.

A new constant `S23_TAIL_LEVELS` was added (grade-agnostic grouping only):
```python
S23_TAIL_LEVELS = [
    ("SGT", ["Shape", "Cut_Style_Group", "TypeName"]),
    ("SG",  ["Shape", "Cut_Style_Group"]),
    ("S",   ["Shape"]),
    ("G",   ["Cut_Style_Group"]),
]
```

`build_large_carat_tail_model()` was updated to accept an optional `levels` parameter (defaults to `LARGE_CARAT_TAIL_LEVELS`). `strategy_s23` passes `levels=S23_TAIL_LEVELS`.

### Training run evidence

| Run | Changes | Clarity violations | Color violations |
|-----|---------|-------------------|-----------------|
| Run 1 (initial S23) | Interaction terms + Category_RatePerCt present | ~4 pinned-case violations | n/a (4-case check only) |
| Run 2 | Interaction terms removed, Category_RatePerCt present | 146 (at 0.5ct, 1.0ct) | 0 |
| Run 3 | Category_RatePerCt removed, tail still grade-aware | 16 (at 7.0ct, 10.0ct ROUND VS1→VS2) | 0 |
| **Run 4 (final)** | **All grade-aware features removed, S23_TAIL_LEVELS** | **0** | **0** |

---

## Finding 2: Monotonicity Check Was Insufficient (4 Pinned Cases)

### What the report said
The initial monotonicity check verified only 4 handpicked cases:
- MARQUISE 4.08ct E, HEART 3.0ct E, ROUND 2.0ct E ID, ROUND 3.0ct E ID

This is insufficient to catch inversions at untested shape×carat combinations. The report recommended a full grid sweep.

### Fix implemented

The 4-case check was replaced with a full grid sweep in `strategy_s23_grade_agnostic_anchor()`:

```
8 shapes × 9 carats × 2 cuts × (6 clarity steps + 6 color steps) = 1728 checks
```

**Sweep parameters:**
- Shapes: ROUND, OVAL, CUSHION, EMERALD, PEAR, MARQUISE, HEART, RADIANT
- Carats: 0.50, 1.00, 1.50, 2.00, 3.00, 4.08, 5.00, 7.00, 10.00
- Cuts: `-` (standard/no cut specified), `ID` (Ideal)
- Clarity axis: IF→VVS1→VVS2→VS1→VS2→SI1→SI2 (6 adjacent-pair checks, pinned Color=D)
- Color axis: D→E→F→G→H→I→J (6 adjacent-pair checks, pinned Clarity=IF)

Tolerance: 0.1% (prices within 0.1% are treated as equal, not a violation).

Results are stored in `clarityLadderCases._sweepSummary` in the returned dict and persisted to `mrpe-v2-results.json`.

**Final sweep result**: 1728 checks, 0 clarity violations, 0 color violations ✅

---

## Finding 3: Training Date Mismatch

### What the report said
The dataset filename is `STARS Diamonds Stock2026.5.20.xls` (May 2026), but `s23-implementation-decisions.md` stated "Training date: 2025-05-24".

### Fix implemented
`s23-implementation-decisions.md` corrected to "Training date: 2026-05-20".

---

## Finding 4: GIA Lab-Grown Schema Drift (Monitoring Note)

### What the report said
GIA changed its lab-grown diamond grading report format in October 2025, replacing color/clarity grades with "Premium" / "Standard" quality tiers. If GIA lab-grown data enters the pipeline, the ingestion code must map these tiers to ordinal ranks before they reach the model.

### Action taken
No code changes in this session — all current training data is IGI-certified. This finding is logged here as a required pre-condition for adding GIA lab-grown data to future training sets.

If GIA lab-grown data is ingested:
1. Add a normalization step in `load_data()` that maps `"Premium"` → `Clarity=VS1` / `Color=F` (or equivalent IGI-comparable tiers)
2. Verify that the new records are included in the monotonicity sweep
3. Re-run `--only-s23` to confirm zero violations

---

## Remaining Report Recommendations (Not Yet Implemented)

### XGBoost challenger with interaction constraints
The report suggested an XGBoost model using `interaction_constraints` to block specific feature interactions at the tree-building level. This would provide a formal, non-marginal alternative to the current approach of removing unconstrained co-variates.

**Status**: Not implemented. The current approach (removing all grade-aware unconstrained features) achieves the same guarantee empirically. An XGBoost challenger remains a valuable second opinion for a future experiment.

### Shape-Constrained GAM challenger
The report suggested a shape-constrained Generalized Additive Model (e.g., `pygam` with monotone spline terms) as a white-box monotone baseline. GAMs would give formal, globally-monotone predictions with interpretable partial effects.

**Status**: Not implemented. Requires evaluating whether `pygam` or a similar library can match S23 MAPE on this dataset. Low priority since S23 already achieves formal monotonicity through feature removal.

---

## Final Metrics (Run 4)

| Metric | Value |
|--------|-------|
| Selected-spec MAPE | 7.5997% |
| Cert-loaded MAPE | 6.6426% |
| Monotonicity sweep | 1728 checks, 0 violations ✅ |
| IF 3ct ROUND E | $675.29 |
| VVS1 3ct ROUND E | $618.10 |
| IF > VVS1 | ✅ |
| Model size | 1.3 MB, 400 trees |

---

## Code Changes Summary

| File | Change |
|------|--------|
| `research/scripts/starsgem-mrpe-v2.py` | Added `S23_TAIL_LEVELS` constant |
| `research/scripts/starsgem-mrpe-v2.py` | `build_large_carat_tail_model()`: added optional `levels` param |
| `research/scripts/starsgem-mrpe-v2.py` | `as_model_frame_s23()`: removed interaction terms + `Category_RatePerCt` block; updated docstring |
| `research/scripts/starsgem-mrpe-v2.py` | `strategy_s23_grade_agnostic_anchor()`: removed `Log_Carat_x_ClarityRank`, `Log_Carat_x_ColorRank`, `Category_RatePerCt`, `Log_Category_RatePerCt` from `feats_num`; replaced 4-case pinned check with 1728-cell grid sweep; passes `levels=S23_TAIL_LEVELS` to tail model builder |
| `research/data/starsgem-ml-extra-trees-model-s23-grade-agnostic-anchor.json` | Regenerated (1.3 MB, 400 trees, grade-agnostic throughout) |
| `research/s23-implementation-decisions.md` | Updated Decision 4 (interaction terms removed), added Decision 7 (Category_RatePerCt removed), added Decision 8 (S23_TAIL_LEVELS), corrected MAPE figures and training date |
