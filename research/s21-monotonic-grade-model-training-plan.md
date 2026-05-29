# S21 — Monotonic Grade Model: Training & Retrain Plan

**Goal in one sentence:** train and ship a StarGem ML model whose price output is *guaranteed* monotonic in clarity and color, so the card can **never** value a gem below VVS1 higher than a VVS1-or-better gem, and **always** values VVS1 above VVS2 (holding shape, carat, color, cut, and growth fixed).

This document does two things:

1. **Records the work already done** (S7 → S18 → S19 → S20) so the next person understands why the model is shaped the way it is.
2. **Specifies the S21 model** that adds hard monotonicity guarantees on top of the S20 residual architecture.

Companion docs:
- `research/ml-grade-monotonicity-analysis.md` — the diagnosis of the inversions.
- `research/ml-grade-monotonicity-diagnostics.html` — interactive ladder/heatmap viewer (run `npm run serve`, open `/research/ml-grade-monotonicity-diagnostics.html`).
- `research/starsgem-ml-training-diagnosis-and-retrain-plan.md` — the S19/S20 retrain history this builds on.

---

## 1. The hard requirements (acceptance contract)

These are non-negotiable invariants the S21 model must satisfy on **every** `(shape, carat, color, cut, growth)` slice:

| ID | Invariant | Clarity/color order |
|----|-----------|---------------------|
| **R1** | Higher clarity ⇒ price per ct **≥** lower clarity | `IF ≥ VVS1 ≥ VVS2 ≥ VS1 ≥ VS2 ≥ SI1 ≥ SI2` |
| **R2** | VVS1 is **always** valued **≥** VVS2 | special-cased emphasis of R1 |
| **R3** | Anything below VVS1 (VVS2, VS1, VS2, SI1, SI2…) is **never** valued above a VVS1-or-better grade | downstream of R1 |
| **R4** | Better color ⇒ price per ct **≥** worse color | `D ≥ E ≥ F ≥ G ≥ H` |
| **R5** | Larger carat ⇒ price per ct **≥** smaller carat within the same spec family | already partly handled by the S20 tail; keep it |

"`≥`" means **non-decreasing**: ties are allowed (two adjacent grades can price equally), but a *strict drop* moving to a better grade is a violation.

**Success metric:** the adjacent-step inversion rate on the full sweep grid drops from the current **43.7% (clarity) / 869 color steps** to **0 / 0**. Not "lower" — **zero**. Monotonicity is a structural guarantee in S21, not a learned tendency.

---

## 2. What we have built so far (history)

The browser ML card is a tree ensemble that predicts a **residual on top of a lookup surface**, not a raw price. Understanding that is the key to understanding the bug.

### Model lineage

| Strategy | Target | Trees | What it added | Status |
|----------|--------|------:|---------------|--------|
| **S7** | `log(price/ct)` | 200 | First "full combo" forest; balanced MAPE ≈ 4.9% | Stale; compact 10-tree slice was wrongly deployed |
| **S18** | `log(price/ct)` | 200 | Temporal cutoff, shallower trees | Superseded |
| **S19** | `log((price/ct)/lookup_rate)` | 96 | **Lookup-residual target** + selected-spec augmentation (missingness flags, masking). Fixed the "3ct ROUND E VS1 priced like EX outlier" case ($478 → $328) | Superseded by S20 |
| **S20** | `log((price/ct)/(lookup_rate × tail))` | 160 | Chinese specialty-cut features + a **monotonic large-carat tail** (`g_tail` for 5ct+) | **Currently deployed** (`starsgem-ml-extra-trees-model-s20-specialty-tail.json`) |

### S20 inference formula (the thing we are extending)

```
price = exp(mean(tree_log_residuals))
        × lookup_rate(shape, color, clarity, cut_style, type, carat_bucket)
        × large_carat_tail_multiplier(carat)
        × carat
```

Reference: `research/scripts/starsgem-ml-predict.mjs` (`predictStarsgemMl`) and `research/scripts/starsgem-mrpe-v2.py` (`export_model`, `strategy_s20_specialty_tail_selected_spec`, `target_type = "log_tail_lookup_residual"`).

### S20 features (current vector)

- **Categorical** (`CATEGORICAL_FEATURES`): `Shape, Color, Clarity, Cut, Polish, Symmetry, Fluorescence, Report, TypeName, carat_bucket, Cut_Style_Group`.
- **Numeric** (`NUMERIC_FEATURES` + derived): `Carat, Table_Scale, Depth_Scale, Length, Width, Height, LengthWidthRatio`, plus lookup/tail/specialty features (`Lookup_RatePerCt`, `Large_Carat_Tail_Multiplier`, `Is_Specialty_Cut`, …) and selected-spec flags (`Has_Dimensions`, `Has_GrowthMethod`, `Is_SelectedSpec_Mode`, …).

**Crucially: clarity and color are only ever one-hot categoricals.** The model has no ordinal "this grade is better than that grade" signal, and nothing in the ExtraTrees loss penalizes inversions.

### S20 validation (for reference)

| View | MAPE | MAE | R² |
|------|-----:|----:|---:|
| selected-spec | 6.01% | $62.24 | 0.968 |
| cert-loaded | 5.41% | $58.43 | 0.969 |
| selected-spec 8ct+ | 6.94% | $433.34 | 0.942 |
| selected-spec 10ct+ | 7.21% | $540.31 | 0.935 |

S20 is good on aggregate accuracy. **It is the grade-ordering that is broken**, and aggregate MAPE does not see it.

---

## 3. Why S20 violates the requirements (root cause)

The inversions are **not** tree noise in the usual sense — the tree residuals between adjacent grades are nearly identical (e.g. 1.011 × vs 1.011 ×). The price flips because the **lookup anchor jumps** between adjacent grades that land in different-density buckets.

Worked example — Marquise 4.08ct E (the IGI case):

| Clarity | Lookup n | Lookup $/ct | Residual × | **ML $/ct** |
|---------|---------:|------------:|-----------:|------------:|
| IF | 496 | $139 | 1.012 | $140 |
| VVS1 | 496 | $139 | 1.011 | $140 |
| VVS2 | 8 | $192 | 1.011 | **$194** ← jumps **above** VVS1 |
| VS1 | 17 | $155 | 0.996 | $154 |
| SI1 | 1 | $176 | 1.001 | $176 ← above VS1 |

So **R2 is violated**: VVS2 ($194) > VVS1 ($140). The cause is purely the lookup table: VVS1/IF fall through to a dense global-ish bucket ($139/ct), while VVS2 hits a sparse `n=8` specialty cell ($192/ct).

Three structural drivers, all confirmed in the analysis:

1. **Lookup-first architecture** — monotonicity in clarity/color is *not* a constraint anywhere in the pipeline. The lookup surface is built from raw medians and is itself non-monotonic.
2. **Sparse / aliased buckets** — off-catalog grades (SI1 on white lab, VVS2 on specialty cuts) get `n=1`–`n=8` cells or fall through to a global fallback shared with unrelated grades.
3. **One-hot grades** — the trees see `Clarity=VVS1` and `Clarity=VVS2` as unordered categories. There is no gradient that says "VVS1 must be ≥ VVS2".

**Conclusion:** we cannot fix this by "training better." We must (a) make the lookup surface monotonic, (b) give the model ordinal grade features, and (c) add a **guaranteed projection layer** that enforces the ladder at inference time. Defense in depth — any one layer failing must not break the contract.

---

## 4. S21 design — four layers of monotonicity defense

> Design principle: **R1–R5 must hold even if the ML model is arbitrarily wrong.** Layers 1–3 improve accuracy and reduce how much correction is needed; Layer 4 makes the guarantee unconditional.

### Layer 1 — Monotone lookup surface (fix the anchor, not just the model)

The biggest single driver is the non-monotonic lookup table. Before training, **isotonically regularize the lookup surface itself**.

- For each `(shape, color, cut_style, type, carat_bucket)` group, take the per-clarity lookup rates in order `IF → SI2` and apply **pool-adjacent-violators (PAV)** so the sequence is non-increasing as clarity worsens.
- Do the same across color `D → H` at fixed clarity.
- **Sparse-cell shrinkage:** before PAV, blend any cell with `n < MIN_SUPPORT` (start `MIN_SUPPORT = 15`) toward the better-supported neighbor / parent bucket using a count-weighted prior:
  `rate* = (n·rate_cell + k·rate_parent) / (n + k)`, with `k ≈ 10`.
  This removes the `n=1` SI1 / `n=8` VVS2 spikes that cause most inversions.
- Build the smoothed surface **from the training split only** (no leakage), persist it in the model JSON under `featureLookups`, and have the browser read the smoothed rates (the inference code in `starsgem-ml-predict.mjs` already reads `featureLookups.lookupTables`; we only change the values written, plus a `monotonic: true` flag).

Implementation: new helper in `starsgem-mrpe-v2.py`, e.g. `build_monotone_lookup_tables(rows)` wrapping the existing lookup builder + a PAV pass over the clarity/color axes.

### Layer 2 — Ordinal grade features (give the model the order)

Add explicit rank features so the learner can express "better grade ⇒ higher residual" directly:

```python
CLARITY_RANK = {"IF": 0, "VVS1": 1, "VVS2": 2, "VS1": 3, "VS2": 4, "SI1": 5, "SI2": 6}
COLOR_RANK   = {"D": 0, "E": 1, "F": 2, "G": 3, "H": 4, "I": 5, "J": 6}
```

New numeric features: `Clarity_Rank`, `Color_Rank` (lower rank = better = should price higher). Keep the one-hots too; the ranks are what the monotone constraint (Layer 3) attaches to.

### Layer 3 — A learner with native monotone constraints (LightGBM)

ExtraTrees has **no** mechanism to constrain monotonicity. Switch the residual learner to **LightGBM gradient-boosted trees**, which support per-feature `monotone_constraints`:

| Feature | Constraint | Meaning |
|---------|-----------:|---------|
| `Carat` | `+1` | bigger ⇒ residual non-decreasing |
| `Clarity_Rank` | `-1` | worse clarity (higher rank) ⇒ residual non-increasing |
| `Color_Rank` | `-1` | worse color (higher rank) ⇒ residual non-increasing |
| all others | `0` | unconstrained |

Notes:
- The target stays the **same** S20 residual: `log((price/ct) / (lookup_rate × tail))`. LightGBM predicts that residual; we keep the lookup × tail × carat reconstruction.
- Because Layer 1 already makes the *anchor* monotone and Layer 3 makes the *residual* monotone in the rank features, the product `anchor × exp(residual)` is monotone by construction in the common case — Layer 4 then closes any remaining gap.
- LightGBM exports trees in a node array (`split_feature`, `threshold`, `left_child`, `right_child`, `leaf_value`) that maps cleanly onto the existing browser tree-walker in `starsgem-ml-predict.mjs` (`predictStarsgemMl`). The walker change is small: support the LightGBM node schema and its `<=`/default-direction semantics.
- **Fallback if we keep ExtraTrees:** if switching learners is too large a change for one iteration, ship Layers 1 + 2 + 4 only. Layer 4 alone already *guarantees* the contract; LightGBM just reduces how much Layer 4 has to move predictions, which keeps accuracy higher.

### Layer 4 — Guaranteed isotonic projection at inference (the safety net)

This is the layer that makes R1–R4 **unconditional**. After the model produces prices for a spec, project them onto the monotone cone before display.

At prediction time, for the stone being priced, evaluate the model across the **full clarity ladder** at the stone's fixed `(shape, carat, color, cut, growth)` and apply **non-increasing PAV** over `IF→SI2`; then do the same across the color ladder. Return the projected value for the requested grade.

- This can run **per request in the browser** (7 clarity evals + 5 color evals is cheap) or be **precomputed at model-load** into a per-spec correction table.
- PAV guarantees the output ladder has **zero inversions**, regardless of what the trees did.
- Keep it stable: project clarity first, then color, then re-check the joint grid for the displayed cell (a single corner check) so we never reintroduce a cross-axis flip.

Recommended home: a new exported helper alongside `predictStarsgemMl`, e.g. `predictStarsgemMlMonotone(row, model)` that wraps the raw predictor with the projection. The card calls the monotone variant.

---

## 5. Concrete training changes in `starsgem-mrpe-v2.py`

Add `strategy_s21_monotone_grade_selected_spec(...)` modeled on `strategy_s20_specialty_tail_selected_spec`:

1. **Constants** (top of file, near `CATEGORICAL_FEATURES`):
   ```python
   CLARITY_RANK = {"IF":0,"VVS1":1,"VVS2":2,"VS1":3,"VS2":4,"SI1":5,"SI2":6}
   COLOR_RANK   = {"D":0,"E":1,"F":2,"G":3,"H":4,"I":5,"J":6}
   MONOTONE_LOOKUP_MIN_SUPPORT = 15
   MONOTONE_LOOKUP_SHRINK_K = 10
   ```
2. **Lookup builder**: wrap the existing lookup construction with `build_monotone_lookup_tables(...)` (shrink sparse cells, then PAV over clarity and color axes). Persist a `"monotonic": true` marker in the exported `featureLookups`.
3. **Frame builder** `as_model_frame_s21(...)`: start from `as_model_frame_s20(...)`, then add `Clarity_Rank` and `Color_Rank` numeric columns.
4. **Learner**: replace the ExtraTrees step with LightGBM:
   ```python
   import lightgbm as lgb
   monotone = [ +1 if f == "Carat" else -1 if f in ("Clarity_Rank","Color_Rank") else 0
                for f in feats_num_in_model_order ]
   model = lgb.LGBMRegressor(
       n_estimators=400, num_leaves=63, max_depth=-1,
       learning_rate=0.04, min_child_samples=20,
       monotone_constraints=monotone, monotone_constraints_method="advanced",
   )
   ```
   (Constraint vector must be in the **exact** feature order the model sees, including one-hot expansion — build it from the fitted `ColumnTransformer` output names.)
5. **Export**: extend `export_model(...)` to serialize LightGBM trees (`childrenLeft/Right`, `feature`, `threshold`, `value`) in the same JSON shape the browser already walks, plus `targetType` stays `log_tail_lookup_residual`, plus `"monotone": {...}` metadata describing the constraint vector.
6. **Inference**: add the Layer-4 projection wrapper in `starsgem-ml-predict.mjs` and call it from the card.

Add S21 to the strategy registry list (where `("S20 (specialty cut + large-carat tail)", strategy_s20_...)` is registered, ~line 2515/2548).

Dependency: add `lightgbm` to the research Python requirements (and confirm it builds on the training machine; it ships manylinux/macOS wheels).

---

## 6. Validation gates (must pass before deploy)

Extend the diagnostics so a model with *any* grade inversion **cannot** be selected.

1. **Monotonicity gate (hard, blocking):** run `research/scripts/analyze-ml-grade-monotonicity.mjs` against the candidate model over the full sweep grid (`research/data/ml-grade-monotonicity-sweep.json` shape × carat × color × clarity). Required result:
   - clarity adjacent-step inversions = **0**
   - color adjacent-step inversions = **0**
   - `clarityViolationRatePct = 0`
   The build script should **exit non-zero** if any inversion remains.
2. **Accuracy non-regression:** S21 selected-spec MAPE ≤ S20 + 0.5pp; cert-loaded MAPE ≤ S20 + 0.5pp. (We accept a tiny accuracy cost for a hard guarantee, but it should be small because Layers 1–3 keep predictions close.)
3. **Per-segment MAPE** (already emitted in the retrain plan): by carat bucket, by shape, by cut (standard vs specialty), 10ct+ separately. No segment may regress > 1pp.
4. **Pinned regression cases** (keep S19/S20 ones, add ladder cases):

   | Case | Expected |
   |------|----------|
   | Marquise 4.08 E, full clarity ladder | strictly non-decreasing IF→…→SI2 reading worse; VVS1 ≥ VVS2 |
   | Heart 3ct E, VVS1 vs VVS2 | VVS1 ≥ VVS2 (was −64.7%) |
   | Round 3ct E VS1 ID selected-spec | stays ≈ $327 (no accuracy regression) |
   | Round 8/10/12ct E VS1 | tail still monotone up in carat (R5 intact) |
   | Any spec, color D→H at fixed clarity | non-increasing |
5. **Compact-export drift** (if a compact browser artifact is produced): median drift ≤ 2%, P95 ≤ 8%, no pinned case moves > 10% — *and the compact artifact must independently pass the monotonicity gate.*

---

## 7. Implementation phases

**Phase 0 — Repro & baseline.** Run the monotonicity analyzer on the current S20 artifact, snapshot the 1297 clarity / 869 color counts as the "before."

**Phase 1 — Layer 1 (monotone lookup).** Add `build_monotone_lookup_tables`, re-export an S20-features model that *only* swaps in the smoothed lookup surface. Re-run the analyzer. Expect a large drop in inversions (the anchor jumps are the main driver) but probably not zero.

**Phase 2 — Layers 2+3 (ranks + LightGBM).** Add `Clarity_Rank`/`Color_Rank`, switch to LightGBM with `monotone_constraints`, extend `export_model`, update the browser tree-walker. Validate accuracy parity.

**Phase 3 — Layer 4 (projection net).** Add `predictStarsgemMlMonotone` and the build-time monotonicity gate. This is what drives the analyzer to **exactly zero**.

**Phase 4 — Deploy.** Only after all gates pass, point `index.html` at `research/data/starsgem-ml-extra-trees-model-s21-monotone.json?v=YYYYMMDD-s21` (keep the historical "Best ML price guess" label; add model id + "monotone-constrained" note). Keep S20 as rollback.

---

## 8. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| LightGBM JSON node schema differs from ExtraTrees | Normalize at export to the existing `childrenLeft/Right/feature/threshold/value` shape; unit-test browser vs Python parity on a fixed grid. |
| Monotone constraint hurts accuracy in sparse cells | Layer 1 shrinkage already de-noises sparse cells; accept ≤0.5pp MAPE for a hard guarantee. |
| Projection (Layer 4) flattens legitimate premiums (e.g. specialty cut at one clarity) | Project within **fixed cut/growth** only; specialty cut stays a separate axis, so premiums are preserved across cuts, just ordered within the clarity ladder. |
| Adding `lightgbm` dependency to the training env | Pin a version with prebuilt wheels; document install in research README. If blocked, ship Layers 1+2+4 with ExtraTrees — Layer 4 still guarantees the contract. |
| Color order beyond H (I, J, fancy) | Ranks include I/J; fancy-color stones are out of this surface's scope and routed elsewhere — exclude from the clarity/color gate or handle on a separate fancy ladder. |

---

## 9. TL;DR for the next engineer

- The card is a **residual-on-lookup** tree model. Inversions come from the **lookup anchor jumping** between sparse grade buckets, plus grades being **unordered one-hots**, plus **no monotone constraint** anywhere.
- S21 fixes it in four layers: **(1)** isotonic-smooth the lookup surface, **(2)** add `Clarity_Rank`/`Color_Rank`, **(3)** train **LightGBM with `monotone_constraints`** on those ranks + carat, **(4)** apply a **guaranteed PAV projection at inference** so the displayed ladder has **zero** inversions no matter what.
- Ship only when `analyze-ml-grade-monotonicity.mjs` reports **0 clarity and 0 color inversions** and MAPE has not regressed by more than 0.5pp.
- Layer 4 alone makes the contract unconditional; Layers 1–3 keep accuracy high so Layer 4 barely has to move anything.
