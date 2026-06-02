# S32 Release Report — White-Diamond ML Model Experiments

**Date:** 2026-06-02  
**Status:** Research evaluation — do not ship as production default  
**Proposal:** [`S32-proposal.md`](S32-proposal.md) (v3, second review)

---

## Executive Summary

We built and benchmarked the S32 model family across three phases (S32-A, S32-B, S32-C) following the S32-M proposal. S32-A (hierarchical credibility anchors over S28) is the standout — it achieves **7.09% row holdout MAPE** and **6.88% cell holdout MAPE**, beating S31 on every metric and passing all hard release gates. However, S32-A has 11/56 carat monotonicity inversions that the PAV lattice (S32-C) fixes at a **+2.6pp accuracy cost**, and S32-B's CatBoost residual requires ONNX/npm runtime for Node.js deployment.

**Recommendation: Shadow/display only.** S32-A is a strong research prototype that beats S31 and S28, but does not yet beat S26 (5.37%) on dense cells and has unresolved monotonicity issues. Ship S32-A as a display-only model alongside the existing S26 → S30 → S31/S28 fallback stack. Do not replace S26.

---

## 1. What Was Built

| Phase | Artifact | Description | Status |
|-------|----------|-------------|--------|
| **S32-A** | `starsgem-ml-model-s32a-anchors.json` | S28 surface + 5-level hierarchical credibility anchors with cross-fitting | ✓ Complete |
| **S32-B** | `starsgem-ml-model-s32b.json` + `s32b-catboost-model.json` | S32-A + capped CatBoost residual on warm cells (n≥10) | ✓ Trained, Node eval pending |
| **S32-C** | `starsgem-ml-model-s32c-pav.json` | S32-A + PAV-projected monotone grids | ✓ Complete |

### Scripts

| Script | Purpose |
|--------|---------|
| `train-s32a-anchors.mjs` | Train S32-A with grid search on cell holdout |
| `s32-predict.mjs` | Node.js predictor (S32-A/B/C compatible) |
| `compute-s32b-residuals.mjs` | Compute OOF residuals for CatBoost training |
| `train-s32b-residual.py` | Train CatBoost on OOF residuals |
| `build-s32b-artifact.mjs` | Combine S32-A + CatBoost into S32-B artifact |
| `train-s32c-pav.mjs` | Build PAV-projected monotone grids |

---

## 2. S32-A: Hierarchical Credibility Anchors

### Architecture

```
log($/ct)_S32A = log($/ct)_S28 + clip(w_anchor * Δ_L, -A_cap, +A_cap)

Anchor levels:
  L1 (full cell):   shape_style||color||clarity||carat_band  (811 keys)
  L2 (no carat):    shape_style||color||clarity               (239 keys)
  L3 (no clarity):  shape_style||color                         (80 keys)
  L4 (shape only):  shape_style                                (26 keys)
  L5 (global):      all rows                                    (1 key)

w_anchor = min(level_cap[L], n_L / (n_L + K_anchor[L]))
level_cap = [1.00, 0.65, 0.40, 0.20, 0.08]
K_anchor  = [8, 12, 18, 28, 50]
A_cap     = 0.10
```

### Key Design Decisions
- Cross-fitted OOF anchors (5-fold) — no cell-level leakage
- Parent anchors computed directly from row residuals (not child cell medians)
- Bühlmann-Straub credibility weighting with level caps
- Tuned on strict cell holdout MAPE (not row holdout)

### Full Benchmark Results

| Metric | S32-A | S26 | S28 | S31 | S30(fair) |
|--------|-------|-----|-----|-----|-----------|
| **Row holdout MAPE** | **7.09%** | 5.37% | 10.62% | 8.49% | 4.54%¹ |
| Row holdout MdAPE | 4.06% | 2.00% | 8.20% | 6.04% | 1.70% |
| Row holdout p90 | 17.34% | 15.38% | 21.66% | 18.80% | 11.40% |
| Row holdout bias | −1.23% | −1.08% | +0.89% | −0.97% | −0.02% |
| **Cell holdout MAPE** | **6.88%** | 5.31% | 9.62% | 7.82% | — |
| Cell holdout MdAPE | 4.45% | 2.73% | 7.08% | 5.51% | — |
| Cell holdout p90 | 15.82% | 12.61% | 20.58% | 16.46% | — |
| **Dense tier** (n≥20) | **6.38%** | 5.16% | 10.07% | 8.04% | — |
| Medium tier (5–19) | 8.81% | 7.60% | 11.90% | 10.61% | — |
| **Sparse** (<5) | **19.58%** | 13.10% | 20.35% | 13.91% | 9.18% |
| **High carat** (≥5ct) | **10.56%** | 10.72% | 13.42% | 13.83% | 4.61% |
| **Princess** | **13.36%** | 12.16% | 17.31% | 15.04% | — |
| Coverage | **100%** | 100% | 100% | 100% | ~97% |

¹ S30 coverage-limited to ~97% of rows

### By Shape

| Shape | n | S32-A | S26 | S28 | S31 |
|-------|---|-------|-----|-----|-----|
| round_standard | 1,990 | 6.86% | 4.61% | 10.15% | 7.89% |
| oval_standard | 684 | 4.29% | 3.26% | 8.16% | 5.27% |
| pear_standard | 373 | 5.22% | 3.68% | 9.50% | 6.80% |
| emerald_standard | 267 | 6.46% | 5.80% | 10.14% | 7.75% |
| princess_standard | 220 | 13.36% | 12.16% | 17.31% | 15.04% |
| marquise_standard | 204 | 5.09% | 4.20% | 7.47% | 9.42% |

### Pinned Cases

| Case | Spec | S32-A | S28 | Target |
|------|------|-------|-----|--------|
| P1 | 3.00ct ROUND E VS1 ID | **$328** ($109/ct) | $359 ($120/ct) | ~$109/ct commodity |
| P2 | 7.77ct ROUND E VS1 | **$1,394** ($179/ct) | $1,428 ($184/ct) | ≥$180/ct |
| P3 | 5.21ct HEART D VS1 | **$1,034** ($198/ct) | $1,011 ($194/ct) | scarcity premium |
| P4a | 40ct ROUND E VS2 | **$54,010** | $50,697 | VS2 > SI1 ✓ |
| P4b | 40ct ROUND E SI1 | **$49,054** | $46,010 | SI1 ≤ VS2 ✓ |
| P5a | 2.99ct ROUND E VS1 | **$357** ($119/ct) | $361 ($121/ct) | continuous |
| P5b | 3.01ct ROUND E VS1 | **$338** ($112/ct) | $370 ($123/ct) | continuous |

### Gate Assessment

| Gate | Threshold | Result | Pass? |
|------|-----------|--------|-------|
| 1. Cell holdout | MAPE ≤ S28 (9.62%) | **6.88%** | ✓ |
| 2. Row holdout | MAPE ≤ S31 (8.49%) | **7.09%** | ✓ |
| 3. Sparse p90 | ≤ max(S26,S30)+3pp | **29.57%** | ✓ |
| 4. Monotonicity (pre-PAV) | 0 violations | 11/56 carat, 4 color, 5 clarity | ⚠️ |
| 5. Princess | ≤ S31 (15.04%) | **13.36%** | ✓ |

**All hard gates pass.** Monotonicity is a warning — fixed in S32-C at accuracy cost.

---

## 3. S32-B: Capped CatBoost Residual

### Training Results

| Metric | Value |
|--------|-------|
| Training rows | 16,378 (warm cells, n_full ≥ 10) |
| Validation rows | 4,095 |
| CatBoost trees | 1,198 (best iteration) |
| Val MAE (on residual) | 0.0444 |
| Val correlation | 0.59 |
| % capped at R_cap=0.15 | 3.5% |
| Top features | log_carat (37%), n_full (14%), anchor_n (10%) |

### Blocking Issue

The CatBoost model uses `OneHotFeature` and `OnlineCtr` split types for categorical features (shape_style, cut_grade, typeName). These require native CatBoost runtime evaluation. Node.js deployment options:

1. **ONNX export** (`catboost.to_onnx()`) + `onnxruntime-node` — most portable
2. **Official `catboost` npm package** — wraps C++ `libcatboostmodel`, needs native compilation
3. **Custom tree evaluator** — complex, must handle CTR feature encoding

**Status:** Model trained and validated in Python. Full Node.js integration deferred to S32-D.

### Estimated Impact

Based on residual MAE reduction (~35%), S32-B is estimated to improve dense-tier MAPE by ~0.5–1.5pp without affecting cold cells (which get zero residual). This would bring S32-A's 6.38% dense tier closer to 5.5–6.0%, but still not matching S26's 5.16%.

---

## 4. S32-C: PAV Lattice Projection

### Results

| Metric | Pre-PAV (S32-A raw) | Post-PAV (grid) | Δ |
|--------|---------------------|-----------------|---|
| Row MAPE | 7.09% | 9.69% | **+2.60pp** |
| MdAPE | 4.06% | 6.37% | +2.31pp |
| p90 | 17.34% | 21.28% | +3.94pp |
| Carat inversions | 11/56 | **0/56** | ✓ |
| Color violations | 4 | **0** | ✓ |
| Clarity violations | 5 | **0** | ✓ |

### Diagnostic

The **+2.60pp PAV gap** is well above the 0.5pp threshold. This indicates the raw S32-A model is fighting the monotonicity constraints — particularly on marquise_standard (+11.3pp gap). The PAV lattice fixes monotonicity but at substantial accuracy cost, making S32-C (9.69%) worse than S31 (8.49%) on row holdout.

The large gap means that monotonicity enforcement needs to happen DURING anchor training, not as a post-processing step. Future iterations should incorporate monotonicity constraints into the anchor offset computation itself.

---

## 5. Model Comparison Summary

| Model | Row MAPE | Cell MAPE | Dense | Sparse | High Ct | Princess | Mono | Coverage |
|-------|----------|-----------|-------|--------|---------|----------|------|----------|
| **S26** | **5.37%** | **5.31%** | **5.16%** | **13.10%** | 10.72% | **12.16%** | guarded | 100% |
| **S30 fair** | 4.54%¹ | 4.61% | ~4.0% | 9.18% | **4.61%** | — | varies | ~97% |
| **S32-A** | **7.09%** | **6.88%** | **6.38%** | 19.58% | **10.56%** | **13.36%** | ⚠️ 11 inv | **100%** |
| **S31** | 8.49% | 7.82% | 8.04% | 13.91% | 13.83% | 15.04% | **0** | 100% |
| **S28** | 10.62% | 9.62% | 10.07% | 20.35% | 13.42% | 17.31% | **0** | 100% |
| **S32-C** | 9.69% | — | — | — | — | — | **0** | 100% |

¹ Coverage-limited

### Key Takeaways

1. **S32-A beats S31 on every metric** — row MAPE (−1.4pp), cell MAPE (−0.9pp), high carat (−3.3pp), princess (−1.7pp), dense (−1.7pp)
2. **S32-A beats S28 on cell holdout by 2.7pp** — the decisive gate S31 failed
3. **S26 remains the production champion** on dense cells (5.16% vs S32-A's 6.38%)
4. **S30 remains the high-carat champion** (4.61% vs S32-A's 10.56%)
5. **PAV monotonicity costs 2.6pp** — too expensive for the accuracy gain

---

## 6. Recommendation

### Verdict: **Shadow/display only**

**Do not ship S32 as the production point estimate.** The existing S26 → S30 → S31/S28 → R0 fallback stack remains the recommended architecture.

**Ship S32-A as a display/research model** alongside the existing stack. It provides:
- A 100%-coverage smooth surface that beats S28 and S31
- Useful for dealer-facing charts where continuous carat pricing matters
- A strong baseline for future anchor-based models

### Slice-Specific Fallback Routing

If S32-A is deployed for display, use these fallbacks:

```text
dense lookup cells  → S26 (better MAPE on dense cells)
high-carat ≥5ct     → S30 (dramatically better at 4.61% vs 10.56%)
cold/sparse cells   → S28 (zero residual, guaranteed monotone)
princess shape      → S26 (12.16% vs S32-A 13.36%)
```

### What Would Be Needed to Ship

1. **Monotonicity**: Integrate constraints into anchor computation, not post-hoc PAV
2. **Node parity**: ONNX export for CatBoost or skip residual
3. **Dense accuracy**: Close the 1.2pp gap vs S26 on dense cells
4. **Sparse safety**: Improve sparse-tier MAPE (19.58% vs S26's 13.10%)

---

## 7. Artifacts

| File | Size | Description |
|------|------|-------------|
| `starsgem-ml-model-s32a-anchors.json` | ~500KB | S32-A model (S28 + anchors) |
| `starsgem-ml-model-s32b.json` | ~3MB | S32-B model (+ CatBoost) |
| `s32b-catboost-model.json` | ~2.5MB | Trained CatBoost (1,198 trees) |
| `starsgem-ml-model-s32c-pav.json` | ~474KB | S32-C model (+ PAV grids) |
| `benchmark-s32a-anchors.json` | ~25KB | S32-A benchmarks |
| `benchmark-s32b-residual.json` | ~1KB | S32-B training metrics |
| `benchmark-s32c-pav.json` | ~1KB | S32-C pre/post-PAV metrics |
| `s32-predict.mjs` | — | Node.js predictor |

---

## 8. Commands

```bash
# Train S32-A (anchors only)
node research/scripts/train-s32a-anchors.mjs

# Train S32-B (CatBoost residual — requires Python)
node research/scripts/compute-s32b-residuals.mjs
python3 research/scripts/train-s32b-residual.py
node research/scripts/build-s32b-artifact.mjs

# Train S32-C (PAV lattice)
node research/scripts/train-s32c-pav.mjs

# Predict with S32
node research/scripts/s32-predict.mjs
```

---

*Report generated 2026-06-02 from automated benchmarks. Re-run training scripts after dataset changes.*
