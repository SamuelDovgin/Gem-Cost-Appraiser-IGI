# S32-M Proposal — Leakage-Safe Credibility Anchored CatBoost over S28

**Status:** Revised architecture proposal (v3, second review)  
**Date:** 2026-06-02  
**Reviewers:** Two-round proposal audit against benchmark data, external literature, and CatBoost documentation  
**Positioning:** Candidate unified smooth/extrapolating display model that may eventually replace parts of the S26/S30/S31 fallback stack if it clears strict cell-holdout and sparse-tier gates. **Not** positioned as a likely near-term replacement for S26.  
**Based on:** [`latest-models-comprehensive-evaluation-report.md`](latest-models-comprehensive-evaluation-report.md), [`white-diamond-ml-pricing-research-report.md`](white-diamond-ml-pricing-research-report.md), [`production-white-ml-model-decision.md`](production-white-ml-model-decision.md), and external literature review (§9 of the comprehensive report)

---

## Executive summary

Every model in the S26–S31 family forces a tradeoff:

- **S26**: Best interpolation (5.4% row-holdout MAPE, 4.9% dense-tier) but piecewise constant in carat — no continuous pricing law, no extrapolation.
- **S28**: Best single-law extrapolation (safe, monotone, zero violations, 0/56 carat inversions) but ~5pp behind S26 on dense cells (10.6% row holdout).
- **S30**: Best fair MAPE where curves exist (4.5%) but ~3% coverage gap and no cross-grade transfer.
- **S29/S31**: Attempted to bridge the gap — S29 exploded on sparse cells (290% MAPE Python, 150% Node), S31 doesn't beat S28 on held-out cells (9.89% vs 9.62%).

**S32-M proposes a leakage-safe, credibility-anchored architecture** that uses S28 as the safe structural backbone, hierarchical credibility shrinkage for cell-level corrections, and a capped CatBoost residual applied only on warm cells. The architecture is designed to fail safe: every component degrades gracefully toward the S28 surface as support thins.

**This proposal has been revised** after review against benchmark data, CatBoost official documentation, the Bühlmann-Straub credibility literature, and the Basha & Oveis (2024) diamond pricing benchmark. The original proposal contained a monotonic-rank sign bug, a contradiction between cold-cell anchors and zero credibility weight, and optimistic performance projections — all corrected below.

---

## Reviewer's verdict on original proposal

> **"S32 is the right research direction, but I would not accept the proposal as written or treat the projected numbers as likely until a smaller ablation proves them."**

The internal evidence supports the motivation: S26 is still the production champion at 5.37% row-holdout MAPE, S30 fair is 4.54% but only where curves exist, S31 improves S28 on row holdout but loses to S28 on strict held-out cells, and S29 had catastrophic sparse-tier behavior plus Node parity problems. The consolidated report also says the current best near-term stack is still **S26 → S30 → S31/S28 → conformal band**, not a single replacement model yet.

**What was agreed with:**
- S28 as the backbone (only safe monotone structural surface with 0/56 carat inversions and Python/Node parity)
- Credibility shrinkage instead of S29-style hard thresholds (Bühlmann-Straub `n/(n+K)` form)
- CatBoost as a plausible residual learner, especially for shape_style, cut_grade, and typeName

**What was corrected (detailed below):**
1. Monotonic-rank sign bug (backwards +1 constraints)
2. Parent anchor contradiction with w_cell = 0
3. Missing leakage protection in anchor computation
4. Incorrect "differentiable/continuous" claims
5. PAV needs to be a grid/lattice step, not an afterthought
6. Overly optimistic performance projections
7. CatBoost hyperparameters too aggressive (depth 6, weak regularization)

---

## 1. Architecture

### 1.1 Corrected prediction formula

```text
Choose deepest available anchor level L based on training support:
  Level 1 (full cell):   (shape_style, color, clarity, carat_band)
  Level 2 (parent 1):    (shape_style, color, clarity)
  Level 3 (parent 2):    (shape_style, color)
  Level 4 (parent 3):    (shape_style)
  Level 5 (parent 4):    (global)

Δ_L  = median_oof(log(actual / S28)) at deepest available level L
n_L  = training support at that level

w_anchor = min(level_cap[L], n_L / (n_L + K_anchor[L]))

# level_cap[L] prevents coarser levels from getting near-1 weight.
# With ~22K rows, n_L/(n_L+K) at the global level → ~0.998 even with K=50,
# which contradicts the intent of shrinking coarse anchors. Caps fix this.
# Example caps (tuned on cell holdout):
#   full cell:             1.00
#   shape/color/clarity:   0.70
#   shape/color:           0.45
#   shape only:            0.25
#   global:                0.10

w_resid = 
  0                                      if n_full < r_min
  n_full / (n_full + K_resid)            otherwise

raw_resid = CatBoost_residual(features)
safe_resid = clip(raw_resid, -R_cap, +R_cap)

log($/ct)_S32M =
    log($/ct)_S28                                                         (1) parametric backbone
  + clip(w_anchor * Δ_L, -A_cap, +A_cap)                                 (2) credibility-weighted anchor offset
  + w_resid * safe_resid                                                  (3) credibility-weighted, capped residual
```

**When no parent anchor exists (truly cold cell):** w_anchor = 0 → prediction = pure S28 surface.  
**When n_full ≫ K_resid (dense cell):** w_resid → 1 → full CatBoost correction applied.  
**When n_full < r_min (sparse cell):** w_resid = 0 → no residual correction, anchor only.

This is **not** a heuristic routing system. It is a **single serialized scoring policy** with a smooth parametric backbone and bounded, credibility-shrunk local corrections. It is monotonicity-guarded, but **not mathematically differentiable** — CatBoost trees are piecewise constant, carat_band anchors create jumps, credibility weights can jump by band, and PAV projection is also piecewise.

**Target convention (explicit):**
- **Training target:** `log($/ct)` — all model components (S28 surface, anchor offsets, CatBoost residual) operate in log($/ct) space.
- **Evaluation target:** **total price** = `exp(log($/ct)_pred) × carat`. All MAPE, MdAPE, p90 APE, and bias figures in this document are computed on total price, not on $/ct. The `× carat` multiplication happens after exponentiation, so errors in log($/ct) are amplified for large stones.
- **Anchor offsets and residuals:** Also in log($/ct) space. An anchor offset of +0.10 means the cell is ~10.5% above the S28 surface in $/ct terms; the same +0.10 on a 5ct stone moves total price by ~10.5% × 5 = a larger absolute dollar amount than on a 1ct stone.

### 1.2 Why this architecture (design rationale, revised)

| Design choice | Problem it solves | Evidence |
|---------------|-------------------|----------|
| **S28 surface as backbone** | Extrapolation to unseen carat/grade combos | S28 is the only model with 0/56 carat inversions and full Node-Python parity |
| **Hierarchical credibility weighting** | S29's 290% MAPE on sparse tier from hard support thresholds | Bühlmann-Straub credibility theory: `Z = n/(n+K)` is the actuarial gold standard for sparse cells (see *Loss Data Analytics*, Ch. 12; Bühlmann & Gisler 2005) |
| **Separate anchor and residual weights** | S31's anchor helps level but doesn't improve cold-cell transfer | S31 held-out-cell MAPE 9.89% > S28 9.62%; anchoring and residual must be gated independently |
| **CatBoost over LightGBM/XGBoost** | ~200 categorical cut grades + shape_style levels | Basha & Oveis (2024): CatBoost beat XGBoost on 23-model diamond benchmark (R² 0.9872). Official CatBoost docs warn: "Do not use one-hot encoding during preprocessing. This affects both the training speed and the resulting quality." |
| **Monotone constraints on corrected grade ranks** | Grade ladder inversions (S22's original sin) | CatBoost docs: `+1` = non-decreasing, `-1` = non-increasing. If rank direction means worse grade = higher number, use `-1` constraint (or recode to goodness). Literature: +0.5–2pp MAPE cost vs unconstrained. |
| **Cross-fitted anchors (OOF)** | Anchor leakage into residual target | Prokhorenkova et al. (2018, NeurIPS): CatBoost's ordered boosting was specifically designed to prevent target leakage from target-statistic encodings. Cross-fitting extends this principle to anchor computation. |
| **Single artifact with embedded surface** | S29 Node parity failure (embedded surface ≠ S28) | S28 coefficients live inside the S32 artifact; Node predictS32 calls the same code path |
| **Capped residuals** | S29's catastrophic sparse-tier errors | S29 sparse-tier MAPE 290% (Python, n=147); hard caps prevent any single row from blowing up |

### 1.3 Visual architecture diagram (revised)

```text
                    ┌─────────────────────────────────────┐
                    │         S28 v0.4 Surface             │
                    │  log($/ct) = f(carat, color,         │
                    │    clarity, shape, type, dimensions)  │
                    │  Always on. Full monotonicity.        │
                    │  Handles all extrapolation.           │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────┐
                    │   Hierarchical Anchor Selection      │
                    │  Choose deepest level L with n_L > 0:│
                    │  full cell → parent1 → parent2 →     │
                    │  parent3 → global                    │
                    │  Δ_L = median(log(actual/S28))       │
                    │  [Computed OOF via cross-fitting]    │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────┐
                    │     Anchor Credibility Weight        │
                    │  w_anchor = min(cap[L], n/(n+K[L]))  │
                    │  Level caps prevent global from      │
                    │  getting full weight.                │
                    │  clipped to [-A_cap, +A_cap]          │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────┐
                    │     Residual Credibility Weight      │
                    │  w_resid = 0          if n_full < r_min│
                    │  w_resid = n/(n+K_r)  otherwise       │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────┐
                    │   Capped CatBoost Residual           │
                    │  ε = CatBoost(features, monotone)     │
                    │  safe_resid = clip(ε, -R_cap, +R_cap) │
                    │  Trained on OOF residual targets      │
                    │  (cross-fitted against anchor folds)  │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────┐
                    │        S32-M Final Prediction         │
                    │  price = exp(log($/ct)_S32M) × carat  │
                    │  + PAV lattice projection (pre-built) │
                    │  + monotonicity guard (runtime)       │
                    └─────────────────────────────────────┘
```

---

## 2. Component specification

### 2.1 Parametric backbone (S28 v0.4 surface)

**Source:** `starsgem-ml-model-s28-monotone-parametric.json`  
**Role:** Universal floor — always predicts, always monotone, always safe.  
**Features used:** carat, color_rank, clarity_rank, shape_style, typeName, magic_weight indicators, lw_ratio, table_pct, depth_pct.

The surface block is embedded directly into the S32 artifact at train time. No separate fetch, no version skew.

### 2.2 Hierarchical anchor offsets (cross-fitted)

**Definition:** For each anchor level L, the offset is the **OOF (out-of-fold) median** of `log(actual / S28_surface)` over training rows at that level.

**Cross-fitting protocol (leakage-safe):**

```text
Split training rows into K folds (K = 5 recommended).

For each fold i:
  a. Hold out fold i.
  b. Compute anchors Δ_L using only the other K-1 folds.
  c. For rows in fold i, compute:
       baseline_oof = log_s28 + w_anchor_oof × Δ_oof
       y_resid_oof = log_actual - baseline_oof
  d. These y_resid_oof values become the CatBoost training targets.

After cross-fitting:
  - Final anchors can be recomputed on all training rows for the shipping artifact.
  - The CatBoost residual model was trained against OOF targets — no cell-level leakage.
```

This is the same principle as CatBoost's own ordered boosting (Prokhorenkova et al., NeurIPS 2018), extended to the anchor computation: never train the residual on targets computed from the same rows.

**Hierarchical fallback levels:**

| Level | Key | n_L | Used when |
|-------|-----|-----|-----------|
| 1 (full cell) | `(shape_style, color, clarity, carat_band)` | cell training rows | n_full ≥ 1 |
| 2 (no carat) | `(shape_style, color, clarity)` | parent training rows | carat_band unseen |
| 3 (no clarity) | `(shape_style, color)` | grandparent rows | clarity unseen in shape |
| 4 (shape only) | `(shape_style)` | shape rows | color unseen in shape |
| 5 (global) | `()` | all training rows | shape entirely unseen |

**Important:** Compute every anchor level **directly from row residuals**, not from unweighted child medians:

```text
Δ(shape, color) = median over rows with that (shape, color) of log(actual / S28)
```

**Not:**
```text
Δ(shape, color) = median of child cell medians  ← wrong: overweights tiny cells
```

Computing parent anchors from unweighted child medians would give a 1-row cell the same influence as a 500-row cell. Every level aggregates raw row residuals directly, so each row contributes equally regardless of which cell it belongs to. `K_anchor[L]` should increase at higher levels. Suggested starting values: `K_anchor = [10, 15, 20, 30, 50]`.

### 2.3 Credibility weights (revised)

**Anchor weight (with level cap):**
```text
w_anchor = min(level_cap[L], n_L / (n_L + K_anchor[L]))
```
- Uses support at the **deepest available** level L, not necessarily the full cell.
- **K_anchor[L]** increases at coarser levels, but that alone is insufficient: with ~22K rows at the global level, `n/(n+K)` → 0.998 even with K=50. The `level_cap[L]` enforces an upper bound on how much any single anchor level can influence the prediction.
- **level_cap[L]** is a per-level maximum weight, tuned on cell-holdout MAPE. Suggested starting values:

| Level | level_cap | Rationale |
|-------|-----------|-----------|
| Full cell | 1.00 | No cap — if a cell has enough rows, trust it fully |
| shape/color/clarity | 0.70 | Parent-level anchors are coarser; cap prevents over-reliance |
| shape/color | 0.45 | Even coarser; mostly useful for level correction, not precise pricing |
| shape only | 0.25 | Very broad; small nudges only |
| Global | 0.10 | Universal offset; should move predictions only slightly |

- Anchors are clipped: `clip(w_anchor * Δ_L, -A_cap, +A_cap)` with `A_cap` ≈ 0.20 (∼±22% in price).

**Residual weight (independent gate):**
```text
w_resid = 0                                    if n_full < r_min
w_resid = n_full / (n_full + K_resid)          otherwise
```
- **r_min** = minimum full-cell support to apply any residual. Start with r_min = 10 or 20, **not** 5.
  - **Reason:** S29's binary gate at n=5 produced 290% MAPE on sparse cells. S31's heuristic shrinkage at low n still lost to S28 on held-out cells. Learned residuals are much riskier than median anchors — the bar for applying them must be higher.
  - The benchmark report confirms: sparse support <5 remains a major failure slice, and S29's Python sparse-tier MAPE hit 290% on 147 rows.
- **K_resid** tuned on cell-holdout MAPE. Expected range: 10–30.

**Truly cold cells (no parent support):**
```text
If no level has n_L > 0 (should not happen with ~22K rows):
  w_anchor = 0
  w_resid = 0
  → pure S28 surface prediction
```

### 2.4 Monotone CatBoost residual (revised)

#### Feature encoding — corrected monotone direction

The original proposal used `color_rank` (D=0, E=1, …, M=12) and `clarity_rank` (IF=0, VVS1=1, …, I3=11) with `monotone_constraints = [+1, +1, +1]`. **This is backwards.** If higher numeric rank means worse grade, a +1 constraint tells CatBoost that worse color/clarity should **increase** price.

CatBoost documentation ([catboost.ai](https://catboost.ai/en/docs/references/training-parameters/common#monotone_constraints)):
- **+1** = non-decreasing constraint (as feature increases, prediction does not go down)
- **-1** = non-increasing constraint (as feature increases, prediction does not go up)

**Corrected approach — use goodness scores:**

```text
color_goodness  = max_color_rank - color_rank      # higher = better
clarity_goodness = max_clarity_rank - clarity_rank  # higher = better

monotone_constraints = [+1, +1, +1]  # carat, color_goodness, clarity_goodness all non-decreasing
```

Alternatively, keep the old rank direction and use:
```text
monotone_constraints = [+1, -1, -1]  # carat up, color_rank down, clarity_rank down
```

**Recommendation:** Use goodness scores. The sign is unambiguous and matches intuition (higher number = better = higher price).

#### Full feature specification

| Feature | Type | Monotone constraint | Notes |
|---------|------|---------------------|-------|
| `log_carat` | numeric | **0** (no $/ct monotonicity constraint) | Log transform reduces skew. **Do not constrain $/ct monotone in carat.** Lab-grown commodity $/ct is often higher at 1ct than at 3ct even though total price rises. The product rule `price = exp(log_$/ct) × carat` may still be monotone in total price. Constrain total price monotonicity via PAV lattice (§2.5), not the residual model. |
| `color_goodness` | numeric | **+1** (better color → higher $/ct) | max_color_rank - color_rank. D → 12, M → 0. |
| `clarity_goodness` | numeric | **+1** (better clarity → higher $/ct) | max_clarity_rank - clarity_rank. IF → 11, I3 → 0. |
| `shape_style` | **categorical** | N/A | ~25 levels including modifiers |
| `cut_grade` | **categorical** | N/A | ID, EX, VG, GD, etc. |
| `typeName` | **categorical** | N/A | CVD, HPHT |
| `lw_ratio` | numeric | 0 | Length/width — non-monotone relationship |
| `table_pct` | numeric | 0 | Non-monotone |
| `depth_pct` | numeric | 0 | Non-monotone |
| `magic_weight_flags` | categorical/indicator | 0 | 1.0ct, 1.5ct, 2.0ct, 3.0ct, 4.0ct, 5.0ct, 10.0ct, 20.0ct |
| `support_features` | numeric | 0 | n_full, n_L, w_anchor — helps CatBoost learn when to be conservative |

#### Target variable

```text
y_resid_oof = log(actual $/ct)
            - log($/ct)_S28
            - clip(w_anchor_oof * Δ_oof, -A_cap, +A_cap)
```

This is the OOF residual after both the parametric surface and the cross-fitted anchor correction. CatBoost is trained to predict this residual, but its output is multiplied by `w_resid` and clipped before being added to the final prediction.

#### Why CatBoost specifically (verified against external sources)

1. **Native categorical features** — `shape_style`, `cut_grade`, and `typeName` are passed as `cat_features` without one-hot encoding. Official CatBoost documentation explicitly warns: *"Do not use one-hot encoding during preprocessing. This affects both the training speed and the resulting quality."* With ~200 distinct cut grades, manual one-hot encoding would create a sparse 200-column design matrix that gradient boosting handles poorly.

2. **Ordered boosting** — CatBoost's permutation-driven training (Prokhorenkova et al., NeurIPS 2018) reduces overfitting on small cells by using ordered target statistics and permutation-based gradient computation, which prevents the prediction shift that standard GBDT suffers from.

3. **Built-in monotone constraints** — same API as XGBoost/LightGBM (`monotone_constraints` parameter), but combined with ordered boosting for better constraint satisfaction in practice. Official docs confirm: `+1` = non-decreasing, `-1` = non-increasing.

4. **Benchmark record** — Basha & Oveis (2024), *Int J Syst Assur Eng Manag*, tested 23 models on diamond pricing data and CatBoost Regressor was the top performer (R² 0.9872) alongside XGBoost. The study reported CatBoost achieving training/testing accuracies of 98.74%/98.72%.

5. **Node.js deployment** — CatBoost provides an official npm package (`catboost`) that loads native `.cbm` models via the C++ `libcatboostmodel` library. JSON export is also supported via `model.save_model("model.json", format="json")`. See [catboost.ai/en/docs/concepts/apply-node-js](https://catboost.ai/en/docs/concepts/apply-node-js).

#### Hyperparameters (revised — more conservative)

The original proposal used `depth=6, l2_leaf_reg=3, iterations=500`. With ~22K rows and high-cardinality categorical interactions, depth 6 risks overfitting. Start shallower with stronger regularization:

```python
CatBoostRegressor(
    loss_function='MAE',
    eval_metric='MAPE',
    iterations=1200,              # more iterations with lower learning rate
    learning_rate=0.02,           # slower learning = better generalization
    depth=4,                      # shallower than original proposal (6)
    l2_leaf_reg=10,               # stronger regularization (was 3)
    random_strength=2,            # add randomness for robustness
    bootstrap_type='Bayesian',    # Bayesian bootstrap for uncertainty
    bagging_temperature=0.5,      # moderate bagging
    monotone_constraints=[+1, +1, +1, 0, 0, 0, 0, 0, 0, ...],
    cat_features=cat_feature_indices,
    random_seed=42,
    verbose=100
)
```

**Why depth 4 not 6:** S31's anchor-only approach already showed that transferring corrections across cells is hard. A deeper tree can memorize cell-specific interactions that don't generalize — exactly the failure mode that cell-holdout evaluation catches and row-holdout misses. Depth 4 limits interactions to at most 4 features, which is appropriate for a residual model over an already-good surface.

**Why l2_leaf_reg=10 not 3:** The S29 experience shows that uncapped residuals on sparse cells are catastrophic. Stronger L2 regularization shrinks leaf values toward zero, which is exactly what we want when the residual signal is weak relative to noise.

### 2.5 Monotonicity projection (revised — lattice step at build time)

The original proposal said "Apply PAV after prediction." For a single user query, there is no ladder to project unless you generate neighboring points.

**Corrected approach — artifact build time:**

```text
At artifact build time:
  1. Generate canonical grids over carat × color × clarity for each
     (shape_style, typeName, cut_grade) tier.
  2. Score raw S32-M on every grid point.
  3. Apply isotonic/PAV projection on carat, color, and clarity ladders
     independently.
  4. Store correction lattice (grid-point offsets from raw to projected).
  5. Store projected grid values for direct lookup.

At prediction time:
  1. If query point falls inside lattice: interpolate from projected lattice.
  2. If outside lattice (extrapolation): use raw S32-M prediction + monotonicity
     test flag (warn if violation detected).
  3. Fallback for extreme extrapolation: pure S28 surface.
```

**Report both pre-PAV and post-PAV MAPE.** Otherwise PAV can hide that the underlying model is fighting the constraints — the gap between them is a diagnostic of how much the model violates domain knowledge.

**Post-interpolation edge scan:** After lattice interpolation, run a final grid-edge monotonicity sweep:
- **Carat adjacent edges:** For each fixed (shape, color, clarity), verify $/ct at carat_{i+1} ≥ $/ct at carat_i.
- **Color adjacent edges:** For each fixed (shape, clarity, carat), verify $/ct at color_{j+1} ≤ $/ct at color_j (better color = higher price).
- **Clarity adjacent edges:** For each fixed (shape, color, carat), verify $/ct at clarity_{k+1} ≤ $/ct at clarity_k (better clarity = higher price).

Do not assume the projection guarantees runtime monotonicity unless the interpolation method is also monotone-preserving. Applying carat/color/clarity PAV independently can fix one ladder and slightly break another at crossing grid points. Record any edge violation and the interpolation method used. If edge violations > 0, either switch to a monotone-preserving interpolator (e.g., piecewise-linear with monotonicity enforcement) or flag the affected grid regions for pure S28 fallback.

---

## 3. Training protocol (revised)

### 3.1 Data splits

| Split | Rows | Used for |
|-------|------|----------|
| **Surface train** | `reportHash % 5 ≠ 0` (~17,567 rows) | S28 surface (pre-computed), anchor computation folds, CatBoost training folds |
| **Anchor held-out** | `cellHash(benchmarkCellKey) % 5 === 0` (whole cells) | Tuning K_anchor[L], K_resid, r_min, evaluating cold-cell behavior |
| **Row holdout** | `reportHash % 5 === 0` (~4,415 rows) | Final evaluation (same protocol as S28/S31) |

### 3.2 Training steps (leakage-safe)

```text
Step 1: Compute S28 surface predictions for ALL rows
        → log($/ct)_s28 for every row in dataset-clean-training.json

Step 2: Cross-fitted anchor computation (5-fold):
        For each fold:
          a. Hold out fold rows.
          b. Compute cell-level Δ = median(log(actual/S28)) from other 4 folds,
             aggregating row residuals directly at each anchor level (not from child medians).
          c. Compute parent-level Δ at levels 2–5 from same other folds,
             each computed directly as median(log(actual/S28)) over rows matching
             that level's key — not as median of child-level medians.
          d. For held-out fold rows, select deepest available level L.
          e. Record: Δ_oof[L], n_L, w_anchor_oof for each held-out row.

Step 3: Compute OOF residual targets for CatBoost:
        y_resid_oof = log(actual/S28) - clip(w_anchor_oof * Δ_oof, -A_cap, +A_cap)
        Only for rows where n_full ≥ r_min (sparse rows excluded from residual training).

Step 4: Train CatBoost on y_resid_oof using surface-train rows with n_full ≥ r_min.
        - Early stopping on anchor held-out cell MAPE.
        - Use eval_set from anchor held-out split.

Step 5: Tune hyperparameters on cell-holdout MAPE, not row holdout:
        - K_anchor[L]: grid search per level [5, 7, 10, 15, 20, 30, 50]
        - K_resid: grid search [5, 10, 15, 20, 30, 50]
        - r_min: test [5, 10, 15, 20]
        - A_cap: test [0.10, 0.15, 0.20, 0.25]
        - R_cap: test [0.10, 0.15, 0.20, 0.30]
        - CatBoost depth: test [3, 4, 5]
        - Metric: MAPE on anchor held-out cells (whole cells)

Step 6: Refit final anchors on all training rows for shipping artifact.
        CatBoost residual model is already trained on OOF targets — no leakage.

Step 7: Build PAV lattice from final artifact (pre-computed grids).

Step 8: Final evaluation on row holdout (reportHash % 5 === 0):
        - Full S32-M prediction: surface + clip(w×anchor) + w×clip(residual) + PAV lattice
        - Report: row holdout, cell holdout, high carat, sparse support,
          leave-shape-out, pinned cases, monotonicity grids (pre- and post-PAV)
        - Compare against S26, S28, S30 (fair), S31
```

### 3.3 Why tune on cell holdout

- Row holdout mixes dense and sparse cells → the average is dominated by dense cells → tunes toward aggressive corrections that hurt sparse cells.
- Cell holdout holds out entire cells → directly measures cold-cell generalization → tunes toward the right shrinkage strength.
- This is exactly the lesson from S31: row-holdout metrics improved (−2.1pp vs S28) but cell-holdout got worse (+0.27pp vs S28). S32-M's tuning on cell holdout should prevent that pattern.

---

## 4. Performance projections (revised — tempered)

The original proposal projected S32 at 5.5–7.0% row-holdout MAPE, 4.5–5.0% dense-tier, and 8.0–9.5% cell-holdout. Based on the reviewer's assessment and the benchmark data, these are revised downward:

**Why the original projections were optimistic:**

1. **S31 already captured some level error but still lost to S28 on strict held-out cells.** S31's row holdout 8.49% (−2.1pp vs S28) came mostly from dense cells where anchors exist; cell holdout 9.89% vs S28 9.62% shows anchors don't yet help cold cells. A CatBoost residual is not guaranteed to fix this.

2. **S30 is surprisingly strong on high-carat rows.** S30 fair MAPE for ≥5ct is 4.61%, while S26 is 10.01%, S28 is 13.42%, and S31 is 13.83%. A CatBoost residual over S28 (which is 13.4% on this slice) is not guaranteed to close that gap without essentially rediscovering S30-like per-spec curves.

3. **The within-cell MAPE floor is ~4–5%** due to multi-modal price distributions from unobserved cut tier, vintage, and list-era effects. No model without access to these latent variables can break below this floor.

### 4.1 Adjusted projections

| Slice | Original proposal | Adjusted expectation (first pass) | Rationale |
|-------|-------------------|-----------------------------------|-----------|
| Row holdout MAPE | 5.5–7.0% | **6.5–8.0%** | S31 achieved 8.49% with anchors only; adding CatBoost on warm cells helps but cold cells and high-carat limit gains |
| Dense-tier MAPE | 4.5–5.0% | **5.5–7.0%** | Unless anchors dominate (unlikely on first pass). S26 is 4.9% here — anchoring + residual over S28 surface is a harder way to get there than lookup. |
| Cell holdout MAPE | 8.0–9.5% | **9.0–10.5%** | S28 is 9.62%, S31 is 9.89%. S32-M should match S28 (w→0 on cold cells) and improve warm cells. |
| Sparse support (<5) | 12.0–15.0% | **10.0–16.0%** | Depends heavily on r_min and caps. If r_min=20, sparse cells get pure S28 (17.6%) or S28+anchor only. If caps are tight, worst-case MAPE is bounded. |
| High carat (≥5ct) | 6.0–8.0% | **7.0–11.0%** | S30 fair is 4.61%, S26 is 10.01%, S28 is 13.42%. CatBoost over S28 is unlikely to match S30 without per-spec curve fitting. |
| Princess leave-shape-out | 11.0–14.0% | **12.0–15.0%** | S26 is 13.6%, S31 is 15.5%. CatBoost with shape_style as categorical may help slightly, but princess is a data problem. |
| Coverage | 100% | 100% | Guaranteed by S28 backbone |
| Carat inversions | 0 | 0 | PAV lattice guarantees zero on grid; extrapolation may need runtime flags |

### 4.2 Comparison to existing models

| Benchmark | S26 | S28 | S30 (fair) | S31 | S32-M (adj. projection) |
|-----------|-----|-----|------------|-----|--------------------------|
| Row holdout MAPE | 5.37% | 10.62% | 4.54%¹ | 8.49% | **6.5–8.0%** |
| Dense-tier MAPE | ~4.9% | 9.42% | ~4.0% | ~8.0% | **5.5–7.0%** |
| Cell holdout MAPE | 5.21% | 11.18% | 4.61%² | 8.36%² | **9.0–10.5%³** |
| High carat (≥5ct) | 10.01% | 13.42% | 4.61% | 13.83% | **7.0–11.0%** |
| Sparse support (<5) | 9.37% | 17.60% | 9.18% | 13.74% | **10.0–16.0%** |
| Princess | 13.63% | — | — | 15.53% | **12.0–15.0%** |
| Coverage | 100% | 100% | ~97% | 100% | **100%** |
| Carat inversions | N/A (policy) | **0** | varies | **0** | **0** |
| Node parity | N/A | ✓ | ✓ | ✓ | **✓ (by construction)** |

¹ S30 coverage-limited: 4.54% on 97% of rows.  
² S30 fair on S29's cell holdout protocol; not the same as S31 cell holdout protocol.  
³ On S31's strict `cellHash % 5 === 0` protocol where S28 is 9.62% and S31 is 9.89%.

---

## 5. Release gates

Do not ship S32-M just because row MAPE improves. The benchmark data already warns that row holdout hid S31's cold-cell weakness. The following gates must all pass:

| Gate | Threshold | Rationale |
|------|-----------|-----------|
| **1. Dense row holdout** | MAPE ≤ S26 + 0.5pp **and** MdAPE ≤ S26 + 0.5pp | Must be competitive with current production |
| **2. Strict cell holdout** | MAPE ≤ S28 | Must not regress cold-cell behavior. "≤ S31" is not sufficient — S31 is worse than S28 on held-out cells. |
| **3. Monotonicity** | **Post-PAV:** zero violations required (mandatory). **Pre-PAV:** report violation count and magnitude — NOT an automatic fail, but if pre-PAV → post-PAV MAPE gap > 0.5pp, fail or investigate. The whole point of the lattice is to correct minor violations; if raw S32-B has tiny violations that PAV fixes with negligible MAPE cost, that is not a blocker. | Non-negotiable for dealer trust at display time; pre-PAV violations are a diagnostic of how much the raw model fights domain constraints |
| **4. Sparse support (<5)** | p90 APE not worse than S26/S30 by more than 3pp | Tail risk guardrail |
| **5. High carat (≥5ct)** | p90 APE not worse than S26; MAPE target ≤ 8–9%. **Also compare against S30 fair** — S30 is the current strongest high-carat performer (4.61% MAPE ≥5ct), far ahead of S26 (10.01%), S28 (13.42%), and S31 (13.83%). S32-M should at minimum improve on S26/S28/S31 on this slice even if it doesn't match S30. | Large-stone errors are dollar-material; S30 sets the high-carat state of the art |
| **6. Princess shape** | **S32-A (anchors only):** warning gate — Princess must not be worse than S31 (15.53%). S26 (13.63%) is lookup-led and princess is a weird data-shape problem; requiring anchors alone to beat S26 on princess is unrealistic. **S32-D (final):** hard gate — Princess must not be worse than S26, OR must route princess to S26/S30 fallback (§5.1). | Currently 13.6% MAPE — a known hard case. S31 is 15.53% on princess. Two-tier gate reflects that anchors alone can't solve princess. |
| **7. Python-Node parity** | Max absolute log prediction diff < 1e-6 on frozen 1,000-row fixture | Production requirement; CatBoost `.cbm` → Node via official `catboost` npm package |
| **8. Pinned cases** | P1–P5 all pass | Large-stone sanity checks |

**Gate 2 is the most important.** If S32-M doesn't beat S28 on held-out cells, the CatBoost residual is learning cell-specific noise, not transferable corrections — and the model should not ship.

### 5.1 Slice-specific fallback overrides

Since S32-M is a display model that may replace parts of the stack, it should allow slice-specific fallback rather than forcing an all-or-nothing release decision. If S32-M fails a slice gate but wins globally, route that slice to the incumbent model:

```text
If S32-M passes global gates but fails a specific slice:
  route that slice to the incumbent:
    dense lookup cells  → S26
    high-carat has-curve → S30
    cold/sparse failure   → pure S28
    princess failure      → S26 or shape-specific fallback
```

This makes the release decision less all-or-nothing. The model can ship as a display surface for the slices where it wins while deferring to the proven stack on its weak slices. The fallback routing is stored in the artifact as a slice-gate table keyed by `(shape_style, support_tier, carat_band)`.

**Fallback routing logic at prediction time:**

```text
1. Identify row's support tier and slice:
   - n_full ≥ dense_threshold  → dense tier
   - n_full < r_min            → sparse tier
   - carat ≥ 5                 → high-carat tier
   - shape = princess          → princess tier

2. Check slice-gate table:
   If slice marked as S32-M-pass:
     predict_s32(row)
   Else:
     route to slice_fallback[slice]:
       dense   → S26
       high_ct → S30 if has_curve, else S26
       sparse  → S28
       princess→ S26

3. Return prediction with routing metadata for logging.
```

This also enables progressive rollout: start with all slices on fallback, promote slices to S32-M as each passes its gate, revert individual slices if production monitoring shows regression.

---

## 6. Risk assessment (revised)

### 6.1 Technical risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| **CatBoost monotone constraints cost more accuracy than expected** | Medium | If MAPE cost > 2pp vs unconstrained, fall back to unconstrained CatBoost + post-hoc PAV. Literature suggests 0.5–2pp cost; diamond data may be at the low end since carat already dominates. |
| **Credibility parameters difficult to tune on limited cell-holdout data** | Medium | Use Bayesian optimization instead of grid search. If cell-holdout MAPE surface is flat, default to K_anchor=[10,15,20,30,50], K_resid=15, r_min=10. |
| **CatBoost residual overfits cell-specific patterns** | High | Cross-fitted OOF targets prevent the most direct form of leakage. Depth=4 + l2_leaf_reg=10 provides strong regularization. Cell-holdout gate (#2) catches overfitting if it occurs. |
| **CatBoost extrapolation on carat outside training range** | Low | The residual weight on cold carat bands will be near zero, so prediction defaults to S28 surface. The CatBoost residual is only applied where n_full ≥ r_min. |
| **Node deployment of CatBoost** | Medium | Official `catboost` npm package loads `.cbm` models. JSON export is also supported. **Parity is feasible but not automatic** — CatBoost does have official JSON export and a Node.js package, but the pipeline must be tested end-to-end. |
| **r_min = 10 or 20 leaves many cells without residual** | Low (by design) | This is intentional. S29's experience (290% MAPE on sparse cells) shows that learned residuals on thin cells are dangerous. The anchor offset already captures cell-level information safely. |

### 6.2 Modeling risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Multi-modal cells still limit MAPE floor** | Low (accepted) | This is a property of the data, not the model. S32-M won't break the ~4–5% irreducible floor without latent mode labels. |
| **S30 still beats S32-M on has-curve segments** | High | S30 fair MAPE 4.54% on has-curve rows is a strong baseline. S32-M should not be expected to beat S30 where curves exist. The value proposition is 100% coverage with competitive accuracy, not beating every model on every slice. |
| **Princess and specialty shapes** | Medium | Princess at 13.6% MAPE is the hardest shape for every model. CatBoost with `shape_style` as categorical should help marginally, but the underlying issue is data heterogeneity. |

### 6.3 Operational risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| **S26 is already in production and trusted** | High | S32-M must clear all 8 release gates before replacing S26. During research phase, run S32-M as a shadow model alongside S26. |
| **Model artifact size** | Low | CatBoost model (depth 4, ~1200 iterations) + anchors + S28 surface: expected ~2–5 MB JSON. Comparable to existing S29 artifact. |
| **CatBoost npm package native compilation** | Medium | The official `catboost` npm package wraps the C++ library. Test build in the app's Node environment early in Phase 3. |

---

## 7. Implementation plan (phased with ablations)

The safer implementation order is to build incrementally so each component's contribution can be measured:

### Phase 1 — S32-A: S28 + leakage-safe hierarchical credibility anchors only (1–2 days)

**Goal:** Determine if credibility-weighted anchors alone close most of the S28→S31 gap while **beating S28 on strict cell holdout** — the decisive gate that S31 failed.

**This is the real experiment.** The first decisive result is not CatBoost — it is whether S28 + leakage-safe hierarchical credibility anchors (with level caps and direct row-level parent computation) improves on S31's anchor grid without worsening cell holdout. Do not train CatBoost until S32-A clears all gates above.

```python
# research/scripts/train-s32a-anchors.py

1. Load dataset-clean-training.json
2. Three-way split: surface-train / anchor-heldout / row-holdout
3. Compute S28 surface predictions for all rows
4. Cross-fitted anchor computation (5-fold):
   - Compute Δ_L at all 5 levels from non-fold rows
   - Select deepest available level L for each held-out fold row
   - Record OOF anchor offsets
5. Grid search K_anchor[L] on cell-holdout MAPE
6. Evaluate: row holdout, cell holdout, sparse support, high carat, monotonicity
7. Output: benchmark-s32a-anchors.json
```

**Go / no-go criteria (HARD — do not proceed to S32-B until all pass):**
- Cell-holdout MAPE ≤ S28 (must not regress cold cells) ✓ ← **This is the decisive gate.**
- Row-holdout MAPE ≤ S31 (anchors alone should at least match S31's ~8.5%) ✓
- Sparse support p90 APE not worse than S26/S30 by > 3pp ✓
- Zero post-PAV monotonicity violations ✓
- Princess MAPE not worse than S31 (warning gate at S32-A; hard gate at S32-D) ⚠

**Decision rule:** If S32-A fails any hard gate, **CatBoost probably just hides the failure on row holdout.** Fix the anchor architecture before adding complexity. The Princess gate is a warning at this phase (anchors alone can't be expected to solve the hardest shape). If S32-A passes all hard gates and row holdout reaches ~7–8%, S32-A may be sufficient as a standalone model — CatBoost residual (S32-B) becomes optional, justified only if it improves dense-tier metrics without regressing cold cells.

**If S32-A already captures most of the gain** (row holdout ~7–8%, cell holdout ≤ S28): you may not need the CatBoost residual except for dense/explainer mode. Ship S32-A and make S32-B optional.

### Phase 2 — S32-B: Add capped CatBoost residual on warm cells only (1–2 days)

**Goal:** Determine if CatBoost residual improves dense cells without hurting cold cells.

```python
# research/scripts/train-s32b-residual.py

1. Start from S32-A anchors and weights.
2. Compute OOF residual targets: y_resid_oof = log(actual/S28) - clip(w×Δ)
3. Filter to rows where n_full ≥ r_min
4. Train CatBoostRegressor with the revised hyperparameters:
   - depth=4, l2_leaf_reg=10, learning_rate=0.02, iterations=1200
   - monotone_constraints on color_goodness, clarity_goodness, log_carat
   - cat_features for shape_style, cut_grade, typeName
5. Grid search r_min, K_resid, R_cap on cell-holdout MAPE
6. Full benchmark suite including pre-PAV and post-PAV MAPE
7. Output: benchmark-s32b-residual.json, starsgem-ml-model-s32b.json
```

**Go / no-go criteria:**
- Cell-holdout MAPE ≤ S28 (residual must not hurt cold cells) ✓ ← **Gate 2**
- Sparse-tier p90 APE not worse than S26/S30 by > 3pp ✓ ← **Gate 4**
- High-carat p90 APE not worse than S26 ✓ ← **Gate 5**
- **If S32-B improves row holdout but worsens cell holdout:** kill or heavily gate the residual. This is the S31 pattern — row metrics improve but cold cells regress.

### Phase 3 — S32-C: Add PAV/projected lattice (1 day)

**Goal:** Guarantee monotonicity and measure the pre-PAV vs post-PAV gap.

```python
# research/scripts/train-s32c-pav.py

1. Load S32-B artifact.
2. Generate canonical carat × color × clarity grids per shape/type/cut tier.
3. Score raw S32-B on every grid point.
4. Apply PAV on carat, color, clarity ladders.
5. Store correction lattice.
6. Re-benchmark with lattice interpolation.
7. Report pre-PAV and post-PAV MAPE separately.
8. Output: benchmark-s32c-pav.json, starsgem-ml-model-s32c.json
```

**Diagnostic:** If pre-PAV → post-PAV MAPE gap > 0.5pp, the CatBoost model is fighting the monotonicity constraints and either the constraints or the model need adjustment.

### Phase 4 — S32-D: Node parity + release gates (1–2 days)

**Goal:** Export to Node, verify parity, and run all 8 release gates.

```javascript
// research/scripts/s32-predict.mjs — Node scorer
// research/scripts/test-s32-parity.mjs — Python vs Node comparison

1. Export S32-C artifact as JSON:
   - S28 surface block (coefficients, basis knots, magic weight indicators)
   - Anchor offset dictionaries per level (keyed by cell hash)
   - K_anchor[L], K_resid, r_min, A_cap, R_cap values
   - CatBoost model: export as .cbm for official npm package, OR JSON via dump_model()
   - PAV lattice for grid interpolation

2. Implement predictS32 in Node matching Python output.
   - Option A: Use official `catboost` npm package (loads .cbm)
   - Option B: Parse CatBoost JSON tree export + custom tree evaluator (S29 pattern)
   - Option C: ONNX export + onnxruntime-node

3. Run parity test on frozen 1,000-row fixture.
   - Assert max |log(pred_python) - log(pred_node)| < 1e-6

4. Run all 8 release gates.
5. Output: benchmark-s32d-final.json
```

---

## 8. Comparison to previous approaches

| Aspect | S29 (hybrid) | S31 (anchor) | S32-M (this proposal) |
|--------|-------------|-------------|---------------------|
| Surface | Embedded (≠ S28 → parity bug) | S28 v0.4 reference | S28 v0.4 embedded at train time |
| Cell correction | EB offsets + cut offsets | Support-shrunk anchor grid | **Hierarchical credibility-weighted anchors (OOF)** |
| Shrinkage | Binary (support ≥ 5 gate) | Heuristic `tanh(n/K)` ~ S-curve | **Bühlmann-Straub `n/(n+K)` per level** |
| Residual model | LightGBM (monotone) | None | **CatBoost (monotone, cat_features, capped)** |
| Residual gate | Binary (support ≥ 5) | N/A | **Separate r_min + credibility weight** |
| Leakage protection | None (anchors computed on same rows as residual) | None | **Cross-fitted OOF anchors** |
| Tuned on | Row holdout | Row holdout | **Cell holdout** |
| Sparse cells | 290% MAPE (Python) | 13.7% MAPE | **10–16% MAPE (projected, capped)** |
| Cold-cell transfer | = S28 by gate (17.8%) | > S28 (9.89% vs 9.62%) | **≤ S28 by design (w→0 on cold cells)** |
| Node parity | Broken (≠ S28) | ✓ | **Must verify: CatBoost → Node** |
| Monotonicity | 1 inversion | 0 | **0 (PAV lattice guaranteed)** |
| Monotone sign | N/A | N/A | **Corrected: goodness scores with +1 constraints** |

---

## 9. What S32-M does NOT solve (known limitations)

1. **Multi-modal cells (irreducible MAPE floor ~4–5%).** S32-M predicts a single point estimate per cell. Without latent mode labels (cut tier, vintage, list era), it cannot distinguish between a commodity CVD stone and a premium HPHT stone in the same nominal cell. The within-cell coefficient of variation sets a theoretical floor — if within-cell CV is ~8–10%, no point-prediction model can go below ~4–5% MAPE.

2. **S30 may still win on has-curve segments.** S30 fair MAPE 4.54% on rows with curves is a strong baseline. S32-M's value proposition is 100% coverage with competitive accuracy, not beating every model on every slice.

3. **Princess and specialty shapes.** Princess at 13.6% MAPE is the hardest shape for every model. CatBoost with `shape_style` as categorical should help marginally, but the underlying issue — fewer rows, more heterogeneity in princess inventory — is a data problem, not a model problem.

4. **Temporal drift.** S32-M, like all current models, is trained on a static snapshot. If StarGem's pricing strategy shifts, the model will drift until retrained.

5. **Fancy-color diamonds.** S32-M is designed for white diamonds only (same scope as S28/S29/S30/S31).

6. **Not differentiable.** CatBoost trees are piecewise constant, carat_band anchors create jumps, credibility weights can jump by band, and PAV projection is also piecewise. If truly continuous pricing (C¹ in carat) is required, replace carat_band anchors with kernel-smoothed log-carat anchors and use EBM shape functions instead of CatBoost trees.

---

## 10. Why now (why this should work when S29 and S31 didn't)

**S29 failed because:**
- Hard support thresholds created a cliff at n=5 → sparse cells either got full correction (unstable) or zero correction (underfit)
- LightGBM with one-hot-encoded categoricals created a sparse, high-dimensional feature space
- Embedded surface fell out of sync with S28 → Node parity broken → Node MAPE 22.9% vs Python 10.6%
- **Anchors and residual trained on same rows** → cell-level information leaked into residual targets
- Tuned on row holdout, which is dominated by dense cells → no pressure to fix sparse behavior

**S31 failed to beat S28 on cold cells because:**
- Anchor grid with heuristic shrinkage doesn't learn interactions — it's a lookup table with smoothing
- Tuned on row holdout → looked better than S28 in aggregate, worse on the cells that matter for extrapolation
- No residual model to capture cut-tier × grade × dimension effects

**S32-M addresses all of these:**
- **Cross-fitted OOF anchors** → no cell-level leakage into residual target (same principle as CatBoost's own ordered boosting)
- **Separate anchor and residual weights** → anchors help level safely; residual only applied where n_full ≥ r_min
- **Continuous credibility shrinkage** → no cliff, no sparse explosion. Bühlmann-Straub `n/(n+K)` is the actuarial gold standard.
- **CatBoost native categoricals** → dense, efficient feature representation. Official docs warn against manual one-hot encoding.
- **Single artifact with surface block** → Node parity by construction (CatBoost `.cbm` → official npm package `catboost`)
- **Tuned on cell holdout** → the optimization target IS cold-cell generalization
- **Capped residuals** → no single row can explode; bounded by R_cap
- **PAV lattice at build time** → guaranteed monotonicity on-grid; pre-PAV vs post-PAV gap is a diagnostic
- **Corrected monotone sign** → color_goodness and clarity_goodness with +1 constraints are directionally correct

The architecture is not radically new — it combines patterns that work in production in other domains:
- Bühlmann-Straub credibility from insurance ratemaking (Bühlmann & Gisler, 2005)
- Ordered boosting from CatBoost (Prokhorenkova et al., NeurIPS 2018)
- CatBoost monotone constraints validated on diamond benchmarks (Basha & Oveis, 2024)

The novelty is applying them together to this specific problem with an evaluation protocol that doesn't let row-holdout averages hide cold-cell failures.

---

## 11. Key open questions for the prototype to answer

1. **Does CatBoost with monotone constraints + depth=4 actually beat S31's anchor-only approach on dense cells?** The constrained boosting literature suggests 0.5–2pp accuracy cost. If the cost is at the high end, S32-B may not beat S32-A by enough to justify the complexity.

2. **Does r_min = 10 or 20 leave enough rows for CatBoost to learn anything useful?** If 80% of rows have n_full < 20, the residual model has very few training examples — and those remaining rows are the densest, where S28+anchor may already be competitive.

3. **Can the official CatBoost npm package be built in the app's Node environment?** The `catboost` package is a native C++ addon. It must be tested in the production build environment early.

4. **What is the pre-PAV vs post-PAV MAPE gap?** If the gap is > 0.5pp, the CatBoost model is fighting the constraints and the architecture needs adjustment.

5. **Does the hierarchical anchor fallback actually help cold cells?** If parent-level anchors are too noisy (few rows per parent cell), the credibility weight will shrink them heavily anyway — and the gain over pure S28 on cold cells may be negligible.

---

## Appendix A: External references verified for this proposal

| Claim | Source | Verification |
|-------|--------|-------------|
| CatBoost `monotone_constraints`: +1 = non-decreasing, -1 = non-increasing | [CatBoost official docs](https://catboost.ai/en/docs/references/training-parameters/common#monotone_constraints) | Confirmed: "+1 imposes an increasing constraint — forces the model to be a non-decreasing function of this feature." |
| Bühlmann-Straub credibility weight: Z = n/(n+K) | *Loss Data Analytics*, Ch. 12; Bühlmann & Gisler (2005) | Confirmed: Standard actuarial formula. K = EPV/VHM. Z→0 for small n, Z→1 for large n. |
| CatBoost docs warn against manual one-hot encoding | [CatBoost parameter tuning docs](https://catboost.ai/docs/en/concepts/parameter-tuning) | Confirmed: "Do not use one-hot encoding during preprocessing. This affects both the training speed and the resulting quality." |
| CatBoost ordered boosting prevents prediction shift | Prokhorenkova et al. (2018), NeurIPS | Confirmed: Theorem 1 proves standard GBDT suffers from conditional distribution shift; ordered boosting eliminates it. |
| Basha & Oveis (2024): CatBoost top performer on 23-model diamond benchmark | *Int J Syst Assur Eng Manag*, 15(11), 5279–5313 | Confirmed: CatBoost R² 0.9872, training/testing accuracies 98.74%/98.72%. |
| CatBoost Node.js package exists | [catboost.ai](https://catboost.ai/en/docs/concepts/apply-node-js), npm: `catboost` | Confirmed: Official npm package wraps C++ `libcatboostmodel`. Also supports JSON export via `model.save_model("model.json", format="json")`. |
| S26 row-holdout MAPE 5.37% | `benchmark-comprehensive-latest.json` | Confirmed: fairS30.all.s26.mape = 5.3689 |
| S28 row-holdout MAPE 10.62% | `benchmark-comprehensive-latest.json` | Confirmed: fairS30.all.s28.mape = 10.6151 |
| S30 fair row-holdout MAPE 4.54% | `benchmark-comprehensive-latest.json` | Confirmed: fairS30.all.s30.mape = 4.5373 |
| S31 row-holdout MAPE 8.49% | `benchmark-comprehensive-latest.json` | Confirmed: fairS30.all.s31.mape = 8.4867 |
| S31 held-out-cell MAPE 9.89% vs S28 9.62% | `benchmark-s31-guarded-anchor.json` | Confirmed: S31 trails S28 by 0.27pp on strict cell holdout. |
| S29 sparse-tier MAPE 290% | `benchmark-s29-vs-s26-s28.json` | Confirmed: Python trainer cell-holdout, n=147. |
| S30 high-carat MAPE 4.61% vs S26 10.01% vs S28 13.42% vs S31 13.83% | `benchmark-comprehensive-latest.json` | Confirmed: highCaratHoldout metrics. |
| S30 shipped artifact optimistic by ~0.6pp | `benchmark-s30.json` | Confirmed: shipped 3.93% vs fair 4.54% on row holdout. |
| Princess shape hardest: S26 13.63%, S31 15.53% | `benchmark-comprehensive-latest.json` | Confirmed: leaveShapeOut.princess_standard metrics. |

---

## Appendix B: Errata — changes from original S32 proposal (v1)

| # | Issue in v1 | Correction in v2 (S32-M) |
|---|------------|--------------------------|
| 1 | `monotone_constraints = [+1, +1, +1]` on color_rank (D=0, M=12) and clarity_rank (IF=0, I3=11) — backwards sign | Use `color_goodness` and `clarity_goodness` (higher = better) with `[+1, +1, +1]`, OR keep ranks with `[+1, -1, -1]` |
| 2 | Cold cells get w_cell = 0 → pure S28, but also get parent anchors — contradictory | Use hierarchical anchor level selection: deepest level L with n_L > 0. Separate w_anchor and w_resid weights. Only if no parent support: w_anchor = 0 → pure S28. |
| 3 | Anchors computed from same rows used for residual training — leakage | Cross-fitted OOF anchors: 5-fold split, anchors from non-fold rows only, residual targets from held-out fold rows |
| 4 | "Single continuous function, differentiable in carat" | Removed. Replaced with: "single serialized scoring policy. Monotonicity-guarded, but not mathematically differentiable." |
| 5 | "Apply PAV after prediction" — ambiguous for single query | PAV lattice pre-computed at artifact build time on canonical grids. Query-time: interpolate from lattice or fall back to raw + flag. |
| 6 | Projected MAPE 5.5–7.0% row holdout, 4.5–5.0% dense | Adjusted to 6.5–8.0% row holdout, 5.5–7.0% dense (first pass). Justification: S31 lost to S28 on cell holdout; S30 strong on high carat; CatBoost over S28 ≠ S30 curves. |
| 7 | CatBoost depth=6, l2_leaf_reg=3, iterations=500 | Revised to depth=4, l2_leaf_reg=10, random_strength=2, iterations=1200, learning_rate=0.02. Stronger regularization; shallower trees. |
| 8 | Residual gate: w_cell applies to both anchor and residual together | Separate gates: w_resid = 0 if n_full < r_min. Start with r_min = 10 or 20, not 5. |
| 9 | Single-phase implementation | Phased with ablations: S32-A (anchors only) → S32-B (+residual) → S32-C (+PAV lattice) → S32-D (Node parity + gates) |
| 10 | 5 release gates | 8 release gates: added MdAPE, Princess, pinned cases, pre-PAV vs post-PAV MAPE reporting |
| 11 | No mention of S30's strength as a baseline | Acknowledged: S30 may still beat S32-M on has-curve segments. S32-M's value is 100% coverage with competitive accuracy. |
| 12 | No external reference verification | Appendix A with 16 verified claims against external sources and benchmark data |

## Appendix C: Errata — changes from S32-M v2 to v3 (second review)

| # | Issue in v2 | Correction in v3 |
|---|------------|------------------|
| 1 | `log_carat` monotone constraint as +1 (enforce $/ct monotone in carat) | Changed to **0** (no $/ct monotonicity constraint). Lab-grown commodity $/ct can be non-monotone (higher at 1ct than 3ct). Require total price monotonicity via PAV lattice, not residual model constraint. |
| 2 | `w_anchor = n_L/(n_L+K)` gives global level ~0.998 weight even with K=50 | Added **level_cap[L]**: `w_anchor = min(level_cap[L], n_L/(n_L+K))`. Caps range from 1.00 (full cell) down to 0.10 (global). Prevents coarse-level anchors from dominating. |
| 3 | Parent anchors computed as median of child cell medians | Changed to **direct row-level aggregation**: every anchor level is `median(log(actual/S28))` over rows matching that level's key. Prevents tiny child cells from overweighting parent medians. |
| 4 | S32-A go/no-go was advisory ("may not need CatBoost") | **Hardened**: do not train CatBoost (S32-B) until S32-A clears all 5 gates. If S32-A fails, CatBoost probably just hides the failure on row holdout. |
| 5 | PAV lattice assumed monotonicity-preserving after interpolation | Added **post-interpolation edge scan**: sweep all carat/color/clarity adjacent grid edges. Independent PAV can fix one ladder and break another. If violations > 0, use monotone-preserving interpolator or flag region for S28 fallback. |
| 6 | High-carat release gate compared only against S26 | **Also compare against S30 fair** (4.61% MAPE ≥5ct) — the current state of the art on high-carat. S32-M should improve on S26/S28/S31 even if it doesn't match S30. |
| 7 | Proposal positioned as potential S26 replacement | Repositioned as **candidate unified smooth/extrapolating display model** that may eventually replace parts of the S26/S30/S31 fallback stack if it clears strict cell-holdout and sparse-tier gates. |
| 8 | Phase 1 goal was "close the S28→S31 gap" | Refocused: **Beat S28 on strict cell holdout** — the decisive gate that S31 failed. Added explicit decision rule for S32-A. |

---

*Proposal revised 2026-06-02 after review against benchmark data, CatBoost official documentation, Bühlmann-Straub credibility literature, and Basha & Oveis (2024) diamond benchmark. Phase 1 (S32-A) Python prototype should take ~1 day to determine if credibility-weighted anchors alone close most of the S28→S31 gap.*
