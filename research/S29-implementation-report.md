# S29 Hybrid Pricing Model — Implementation Report (Revised)

**Date:** 2026-06-01
**Status:** Research prototype scaffold — not release-ready.
**Audit reference:** [`S29-implementation-audit.md`](S29-implementation-audit.md)
**Training script:** [`research/scripts/train-s29-hybrid.py`](scripts/train-s29-hybrid.py)
**Artifact parity test:** [`research/scripts/test-s29-parity.mjs`](scripts/test-s29-parity.mjs) — PASS
**Model artifact:** [`research/data/starsgem-ml-model-s29-hybrid.json`](../data/starsgem-ml-model-s29-hybrid.json)

---

## Post-Audit Status

The initial implementation report claimed S29 beat S26 by 5.7pp on dense in-cell rows. This claim was **invalid**: the S26 baseline used incorrect field normalization (`shape_style` instead of supplier `raw_shape_code`, hardcoded `"CVD"` instead of actual `typeName`). Six blocking issues were identified; fixes were attempted for all six. After correction, **S29 does not beat S26 and fails the improvement plan's decision rule (1/4)**. The prototype is a useful scaffold but remains research-only.

---

## Executive Summary

S29 implements the offset-based hybrid architecture:

```text
S28 monotone surface (always active)
  + per-spec cell offset (empirical-Bayes, shrunk toward zero)
  + cut-stratified offset (Tier A premium vs Tier B commodity)
  + support-shrunk monotone LightGBM residual (zeroed for held-out cells)
```

**Corrected results:** S29 achieves 7.86% MAPE on dense in-cell rows vs S26's 4.92%. On held-out cells, S29 correctly falls back to pure S28 (17.80%). Full-hybrid carat monotonicity (9/9 ladders) and color monotonicity (1/1) pass; one clarity ladder inversion persists from anchor offsets. The JSON artifact passes a standalone Node artifact test with the LightGBM residual active.

---

## 1. Audit Fixes Applied

| # | Issue | Fix | Result |
|---|-------|-----|--------|
| 1 | S26 used wrong field normalization | Use `rawShape` (supplier shape), actual `typeName`, original `cut_raw` | S26 in-cell MAPE: 11.33% → **5.24%** |
| 2 | Anchors replaced surface instead of offsetting it | `surface(row) + cell_offset + shrink*residual` | Carat-continuous predictions |
| 3 | Artifact not deployable | Include `featureMeans`, `featureStds`, anchor tables, LightGBM dump | Parity test PASS (Node) |
| 4 | Only surface monotonicity tested | `evaluate_full_hybrid_monotonicity()` testing `predict_s29()` | 9/9 carat, 1/1 color pass; 1 clarity inversion |
| 5 | k-tuning had no effect | Within-cell row-split validation with deterministic md5 hash | Meaningful variation: k=1→8.42%, k=30→8.59% |
| 6 | Rule 5 passed on equality | Requires S29 < S28 by ≥1pp, or < 50% absolute bound | FAILS — S29 equals S28 at 290% |

### Additional fixes beyond the first audit

| # | Issue | Fix | Result |
|---|-------|-----|--------|
| 7 | Held-out cells leaked same-spec anchors from other carat bands | `predict_s29` checks `train_benchmark_cells`; held-out cells get pure surface | S29 = S28 on all held-out cells (17.80%) |
| 8 | k-tuning used Python's randomized `hash()` | Replaced with deterministic `hashlib.md5` | Reproducible across processes |
| 9 | No independent scorer proving artifact works | `test-s29-parity.mjs` loads JSON, builds `trainBenchmarkCells`, predicts with residual active | Structure and behavior checks PASS |

---

## 2. Architecture

### 2.1 Surface-relative offsets

Anchors are **additive offsets** from the S28 surface:

```text
cell_offset = (n * mean(log_actual - log_surface) + k * 0) / (n + k)
prediction = exp(surface(row) + cell_offset + shrink_weight * residual(row))
```

The surface is always active. Offsets shrink toward zero as support thins. Held-out benchmark cells (carat_band not in training set) receive **pure surface predictions** — no anchor offset, no residual.

### 2.2 Two cell key functions

| Purpose | Key | Cells |
|---------|-----|-------|
| Anchor offset | `(shape_style, color, clarity)` | 233 |
| Benchmark split | `(shape_style, color, clarity, carat_band)` | 858 |

Separating these prevents same-spec leakage: a held-out cell like `round_standard||E||VS1||5.00-9.99` does not receive the anchor offset trained on `round_standard||E||VS1` rows from other carat bands.

### 2.3 Fixed S28 surface

Grade-premium reparameterization replaces buggy `colorRank_size`/`clarityRank_size`:

```text
color_premium  = (7 - colorRank) * log1p(carat)   [projected >= 0]
clarity_premium = (6 - clarityRank) * log1p(carat) [projected >= 0]
```

All surface monotonicity checks pass with canonical `round_standard` shape.

---

## 3. Corrected Evaluation

### 3.1 In-cell performance (training benchmark cells, n=5,000 sample)

| Model | MAPE | MdAPE | Bias |
|-------|------|-------|------|
| S29 | 8.16% | 6.41% | +0.27% |
| S28 | 10.43% | 7.86% | +0.29% |
| **S26** | **5.24%** | **1.39%** | **−1.42%** |

**By support tier (in-cell):**

| Tier | n | S29 MAPE | S26 MAPE |
|------|---|----------|----------|
| Dense | 4,141 | 7.86% | **4.92%** |
| Medium | 600 | 8.91% | 5.52% |
| Sparse | 259 | 11.07% | 9.60% |

S29 improves over S28 (+2.3pp in-cell) but trails S26 on every tier.

### 3.2 Held-out cell performance (n=5,225 rows, 170 benchmark cells)

| Model | MAPE | MdAPE | Bias |
|-------|------|-------|------|
| S29 | 17.80% | 7.76% | +8.04% |
| S28 | 17.80% | 7.76% | +8.04% |
| **S26** | **5.23%** | **2.01%** | **−1.08%** |

S29 = S28 on all held-out cells. The held-out check prevents anchor offsets and residuals from leaking across carat bands. S26's full-dataset lookup dominates.

**By carat bucket (held-out):**

| Carat Bucket | n | S29/S28 MAPE | S26 MAPE |
|-------------|---|-------------|----------|
| 1.00–1.49 | 2,744 | 8.44% | 4.33% |
| 1.50–1.99 | 643 | 14.12% | 4.25% |
| 2.00–2.99 | 1,063 | 11.55% | 4.21% |
| 3.00–3.99 | 179 | 10.82% | 9.58% |
| 4.00–4.99 | 138 | 6.48% | 3.10% |
| 5.00–9.99 | 359 | 12.13% | 11.92% |
| 10.00+ | 99 | 417.15% | 18.71% |

### 3.3 Full-hybrid monotonicity (structural, without held-out check)

| Ladder | Result |
|--------|--------|
| Carat: ROUND D IF (Tier A × 2, Tier B) | **3/3 PASS** |
| Carat: ROUND E VS1 (Tier A × 2, Tier B) | **3/3 PASS** |
| Carat: ROUND F VS2 (Tier A × 2, Tier B) | **3/3 PASS** |
| Color: ROUND 1ct VS1 Tier A (D→H) | **PASS** |
| Clarity: ROUND 1ct E Tier A (IF→SI1) | **FAIL** |

The clarity ladder has a local inversion: VVS2 ($95.55) < VS1 ($97.28) < SI1 ($100.03) > VS2 ($92.77). Cell-level anchor offsets differ across clarity grades due to real market noise in the training data. The improvement plan recommends PAV/isotonic projection at the display layer for this reason.

### 3.4 Pinned cases

| Case | S29 $/ct | Anchor Source | Support | Shrink |
|------|----------|---------------|---------|--------|
| 7.77ct ROUND E VS1 | $130 | surface_held_out | 0 | 0.00 |
| 3.0ct ROUND E VS1 | $99 | cut_stratified | 1,061 | 1.00 |
| 3.0ct ROUND E VS2 | $95 | cut_stratified | 70 | 1.00 |
| 1.0ct ROUND D IF | $172 | cut_stratified | 32 | 1.00 |

7.77ct correctly identified as held-out (carat band not in training). E/VS2 ($95) < E/VS1 ($99) — correct clarity ordering on pinned cases.

---

## 4. Decision Rule Assessment

| Rule | Criterion | Result | Status |
|------|-----------|--------|--------|
| 1 | Match S26 within 1pp on dense held-out cells | S29=9.42%, S26=4.89%, diff=4.53pp | **FAIL** |
| 2 | Zero grade-grid monotonicity violations | 1 clarity inversion (anchor offsets) | **FAIL** |
| 3 | Continuous in carat | 9/9 carat ladders nondecreasing | **PASS** |
| 5 | Improve over S28 on sparse held-out (≥1pp or <50% bound) | S29=S28=290% | **FAIL** |

**1/4 core rules pass.** S29 does not meet the bar for replacing S26.

---

## 5. What Was Built Correctly

- **Held-out cell benchmark** with carat_band in the key and same-spec leakage prevention
- **Surface-relative offsets** preserving carat-continuous predictions
- **Grade-premium surface** with zero carat/color/clarity violations
- **Cut-stratified offsets** (Tier A/B, 144 cells with sufficient support)
- **Support-shrunk residual** (n_threshold=10, monotone-constrained LightGBM with carat-nondecreasing constraint)
- **Full-hybrid monotonicity testing** on actual `predict_s29()` output
- **Deployable JSON artifact** with all prediction state (parity-tested in Node)
- **Deterministic k-tuning** with within-cell row-split validation and md5 hashing
- **Correct S26 baseline** using supplier field normalization

---

## 6. Why S29 Doesn't Beat S26

1. **Anchor granularity (233 cells vs S26's multi-level tables):** Removing carat_band from the anchor key preserves carat-continuity but loses the fine bucket-level resolution that drives S26's accuracy.
2. **Surface is the bottleneck:** At 17.80% held-out MAPE (9.42% on dense), even perfect anchors can't close the gap to S26's 5.23%.
3. **Clarity inversions from real market noise:** Within-spec variance where worse-clarity stones sell for more than better-clarity ones is preserved by cell-level offsets. Display-layer PAV is the intended fix.
4. **Held-out cells get no benefit from anchors:** By design, held-out benchmark cells receive pure surface predictions. Making the surface better is the only way to improve held-out performance.

---

## 7. Recommendations

### For production: Keep S26

S26's 5.23% held-out MAPE with monotonicity-capped display behavior remains the benchmark.

### For continued S29 development

1. **Return carat_band to anchor keys** for accuracy, accepting band-boundary steps that display-layer PAV smooths out.
2. **Improve surface extrapolation** — the surface's 9.42% dense held-out MAPE is the binding constraint.
3. **Apply PAV at display layer** for clarity/color ladder guarantees rather than trying to enforce them in the point model.

---

## 8. Reproducibility

```bash
# Train
python3 research/scripts/train-s29-hybrid.py

# Parity test
node research/scripts/test-s29-parity.mjs
```

Requires: Python 3.11+ (numpy, lightgbm, scikit-learn), Node 20+
Input: `research/data/dataset-clean-training.json` (21,982 rows)
Output:
- `research/data/starsgem-ml-model-s29-hybrid.json` — Deployable model artifact (parity-tested)
- `research/data/benchmark-s29-vs-s26-s28.json` — Benchmark comparison
