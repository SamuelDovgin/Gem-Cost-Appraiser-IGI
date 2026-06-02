# S33-A Release Report — Monotonicity-Constrained Credibility Anchors

**Date:** 2026-06-02  
**Status:** Research-phase release with production benchmark  
**Author:** Claude Code + Samuel Dovgin

---

## 1. Executive Summary

S33-A is a monotonicity-constrained credibility anchor model for white lab diamond price prediction, built from S32-A per the [Production-Quality White ML Roadmap](./production-quality-white-ml-roadmap.md). 

**Key achievement:** S33-A eliminates carat monotonicity violations (from 11→0) with a PAV gap of only **+0.25pp** MAPE increase vs S32-A, dramatically beating S32-C's **+2.60pp** gap. Color violations reduced from 4→1, clarity from 5→1.

| Metric | S32-A (pre-PAV) | S32-C (post-PAV) | **S33-A (constrained)** | S26 baseline |
|--------|-----|-----|-----|-----|
| Row holdout MAPE | 7.09% | 9.69% | **7.34%** | 5.37% |
| Cell holdout MAPE | 7.49% | — | **7.21%** | 5.21% |
| Carat violations | 11/56 | 0/56 | **0/56** | N/A |
| Color violations | 4 | 0 | **1** | N/A |
| Clarity violations | 5 | 0 | **1** | N/A |
| Dense tier MAPE | 6.38% | — | **6.87%** | 5.04% |
| Medium tier MAPE | 8.81% | — | **7.46%** ✓ | 6.25% |
| Sparse tier MAPE | 19.58% | — | **18.04%** ✓ | 11.00% |
| High carat MAPE | 10.56% | — | **10.57%** | 10.01% |

**S33-A outperforms S32-A on medium cells (7.46% vs 8.81%) and sparse cells (18.04% vs 19.58%),** demonstrating that the constrained fitting improves generalization outside dense regions.

---

## 2. Architecture

### Prediction formula
```
log($/ct)_S33A = log($/ct)_S28 + clip(w_L * Δ_L, -A_cap, +A_cap)
```

where:
- S28 = monotone parametric trend surface
- L = deepest anchor level with support (L1-L5 hierarchy)
- Δ_L = PAV-constrained anchor offset at level L
- w_L = 1.0 for L1 (monotonicity guarantee), credibility-weighted for L2-L5
- A_cap = 0.25 (anchor offset cap)

### Anchor levels (same as S32-A)
| Level | Key Pattern | w | Description |
|-------|-------------|---|-------------|
| L1 | shape||color||clarity||carat_band | 1.00 | Full cell, PAV-constrained |
| L2 | shape||color||clarity | credibility | No carat |
| L3 | shape||color | credibility | No clarity |
| L4 | shape | credibility | Shape only |
| L5 | global | credibility | All rows |

### Constrained Fitting Method

1. **Cross-fitted OOF residuals** (same as S32-A): 5-fold cross-fitting to compute raw residual deltas
2. **Sweep-carats PAV projection**: Build full 3D cube [color][clarity][sweep_carat] at monotonicity evaluation carats (1, 1.5, 2, 3, 4, 5, 7, 10, 15, 20, 30), apply iterative PAV across carat/color/clarity dimensions
3. **Delta back-calculation**: Set L1 delta = PAV_target_logUpc - S28_logUpc (at first sweep carat in each band)
4. **w=1 for L1**: By setting K_anchor[0]=0, all L1 cells use w=1, giving prediction = S28 + delta = PAV_target exactly at grid points
5. **Synthetic guard cells**: Cells with n=0 get synthetic L1 anchors (n=1) to prevent fallback to unconstrained L2+ during monotonicity evaluation

### Why w=1 for L1 is Critical

The credibility weight `w = n/(n+K)` varies from 0.5 to 1.0 across cells, breaking the convex combination monotonicity property. With w=1 uniform across L1 cells, the prediction equals the PAV target exactly, guaranteeing monotonicity. 

For L2-L5 fallback levels, credibility weighting is preserved since those cells are sparse by definition.

---

## 3. Production Gate Assessment

| Gate | Threshold | S33-A Actual | Status |
|------|-----------|-------------|--------|
| Monotonicity | 0 violations | 0C 1Col 1Cla | ✗ FAIL (close) |
| Row holdout | S26 + 0.5pp | 7.34% vs 5.87% | ✗ FAIL |
| Dense tier | S26 + 1.0pp | 6.87% vs 6.04% | ✗ FAIL |
| Cell holdout | S26 + 1.5pp | 7.21% vs 6.71% | ✗ FAIL |
| High carat | S26 MAPE | 10.57% vs 10.01% | ✗ FAIL |
| Princess | S26 + 1.0pp | 14.65% vs 13.16% | ✗ FAIL |
| Sparse p90 | max(S26,S30) + 3pp | 28.68% ✓ | ✓ PASS |
| PAV gap | ≤ 0.50pp | **+0.25pp** ✓ | ✓ PASS |
| Coverage | 100% | 100.0% ✓ | ✓ PASS |

**3 of 9 gates pass (2 hard + 1 soft).** S33-A does not yet beat S26 as a universal model, consistent with the roadmap's prediction. The roadmap recommends keeping S26 as production default and using S33-A in a routed policy with S30/S28.

---

## 4. S33-A vs S32-A Advantages

1. **Zero carat violations** (vs 11): PAV-constrained L1 deltas guarantee carat monotonicity
2. **Better medium cells**: 7.46% vs 8.81% (+1.35pp improvement)
3. **Better sparse cells**: 18.04% vs 19.58% (+1.54pp improvement)  
4. **Near-zero bias**: -0.10% vs -1.23% (much better calibration)
5. **PAV gap**: +0.25pp (vs S32-C's +2.60pp, 10x better)
6. **p90 APE**: 16.41% vs 17.34% (better tail behavior)

The improvements in medium and sparse cells suggest the constrained fitting generalizes better than raw anchors.

---

## 5. Conformal Intervals

80% prediction bands (row holdout):

| Tier | Log Width | Multiplier Range | Actual Coverage |
|------|-----------|-----------------|-----------------|
| All | 0.1073 | 0.898x - 1.113x | 80.0% |
| Dense | 0.1008 | 0.904x - 1.106x | 80.0% |
| Medium | 0.1287 | 0.879x - 1.137x | 80.2% |
| Sparse | 0.2185 | 0.804x - 1.244x | 80.5% |

---

## 6. Production Router

A routing policy artifact (`starsgem-ml-model-s33-production-router.json`) implements the roadmap's recommended production policy:

```
Priority 1: S26 where dense lookup support exists and carat < 8
Priority 2: S30 where supported curve exists for high-carat specs
Priority 3: S33-A where L1 anchor has ≥10 support rows
Priority 4: S28 as monotone structural fallback
```

---

## 7. Files Produced

| File | Purpose |
|------|---------|
| `research/scripts/train-s33a-constrained-anchors.mjs` | S33-A training pipeline |
| `research/data/starsgem-ml-model-s33a-constrained-anchors.json` | S33-A model artifact (w=1 L1, PAV-constrained) |
| `research/data/benchmark-s33a.json` | S33-A standalone benchmark |
| `research/scripts/benchmark-production-white-model.mjs` | Canonical production benchmark (Phase 0) |
| `research/data/benchmark-production-white-model.json` | Full production benchmark results |
| `research/data/starsgem-ml-model-s33-production-router.json` | Production routing policy artifact |

---

## 8. Remaining Work

1. **Resolve remaining 1 color + 1 clarity violation**: These are likely cross-dimensional PAV convergence edge cases. A few more PAV iterations or targeted coordinate descent should clear them.

2. **Improve dense-tier accuracy**: S33-A's 6.87% dense MAPE vs S26's 5.04% — the S28 backbone limits dense-cell accuracy. A dense-cell S26 blend could close this gap.

3. **Princess shape**: 14.65% MAPE needs dedicated shape-specific anchor tuning.

4. **S33-B residual layer**: Only after monotonicity is fully clean. Train a lightweight residual on warm cells (n_full ≥ 20), cap at `R_cap = 0.10-0.15`.

5. **Live parity test**: Compare app/Node predictions with golden rows for S33-A.

6. **App integration**: Import shared predictor modules rather than duplicating formulas.

---

## 9. Recommendation

**Do not ship S33-A as the sole production model yet.** The roadmap's production policy remains the right answer:

```
S26 dense interpolation
  + S30 supported smooth curves (especially high carat)
  + S33-A constrained credibility surface (for transfer/extrapolation)
  + S28 v0.4 monotone fallback
  + conformal uncertainty bands
```

S33-A represents the best monotonicity-constrained research model to date — it eliminates the PAV accuracy penalty that killed S32-C while achieving the cleanest monotonicity profile. The next iteration should resolve the 2 remaining grade inversions and add a supported S30 curve expert layer.
