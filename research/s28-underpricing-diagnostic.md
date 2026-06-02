# S28 Underpricing Diagnostic and Re-Fit

**Date:** 2026-06-01  
**Status:** Fixed in S28 v0.4 (`s28-monotone-parametric-v0.4-grade-premium-no-vintage`)  
**Predictor under test:** [`scripts/s28-predict.mjs`](scripts/s28-predict.mjs)  
**Artifact:** [`data/starsgem-ml-model-s28-monotone-parametric.json`](data/starsgem-ml-model-s28-monotone-parametric.json)  
**Reproduce:** `node research/scripts/diagnose-s28.mjs` → writes [`data/s28-diagnostic.json`](data/s28-diagnostic.json)

---

## TL;DR

The original live S28 artifact was not safe to display: it underpriced 97.9% of
holdout stones and violated the "$/ct never decreases with carat" rule for 55 of
56 color×clarity grids.

The v0.4 re-fit fixes the structural bug and the live-vs-Python mismatch:

| Metric | Old live S28 | Re-fit live S28 v0.4 |
|---|---:|---:|
| Live MAPE | 26.86% | **10.69%** |
| Live signed bias | -26.75% | **+1.02%** |
| Stones priced below actual | 97.9% | **41.7%** |
| Full-grid carat inversions | 55 / 56 | **0 / 56** |
| Python holdout MAPE | 8.79% | **10.61%** |
| Live-vs-Python parity | failed | **passes** |

S28 is still behind S26 on dense-cell raw accuracy, but it is now the best
single monotone surface candidate: one model, no champion blend, full-grid
monotonicity, and live predictor parity.

---

## 1. Root Cause in the Old Artifact

The old feature form was:

```text
colorRank_size   = colorRank   * log1p(carat), coefficient <= 0
clarityRank_size = clarityRank * log1p(carat), coefficient <= 0
```

Because worse grades have higher ranks, the penalty grew as carat increased.
That penalty overwhelmed the carat scarcity premium for almost every non-D/IF
stone. The old monotonicity gate missed the bug because it sampled only ROUND D
IF, where both rank terms are zero.

The original live diagnostic showed:

| Carat band | Old mean bias | Old % underpriced |
|---|---:|---:|
| 1.00-1.49 | -14.4% | 95.6% |
| 2.00-2.99 | -31.9% | 100% |
| 5.00-9.99 | -49.6% | 100% |
| 10.00+ | -54.0% | 100% |

Concrete old failure: ROUND G VS2 fell from about $80.72/ct at 1ct to $65.63/ct
at 2ct and $45.82/ct at 5ct.

---

## 2. Re-Fit Changes

### Grade-size reparameterization

S28 v0.4 replaces unbounded worse-grade size penalties with better-grade
premiums:

```text
colorPremium   = (maxColorRank   - colorRank)   * log1p(carat), coefficient >= 0
clarityPremium = (maxClarityRank - clarityRank) * log1p(carat), coefficient >= 0
```

That lets higher grades earn more large-stone premium without making lower
grades cheaper per carat as carat rises.

### Full-grid monotonicity gate

The trainer now checks the entire ROUND `{D..K} × {IF..SI2}` grid across the
carat ladder, not only ROUND D IF. Current result:

```text
0 of 56 specs have a decreasing $/ct segment.
```

### Live-vs-Python parity fix

Two parity issues were corrected:

- S28 v0.4 disables vintage terms so live predictions and training metrics use
  the same surface.
- The JS predictor now formats magic-weight feature names the same way Python
  does (`1_0ct`, `2_0ct`, etc.), so deployed prediction no longer skips integer
  magic-weight features.

On the report-hash holdout, live Node now matches the artifact:

| Evaluator | n | MAPE | Bias |
|---|---:|---:|---:|
| Python artifact holdout | 4,415 | 10.6149% | +0.8928% |
| Live `predictS28` holdout | 4,415 | 10.6151% | +0.8929% |

---

## 3. Current Live Diagnostic

`node research/scripts/diagnose-s28.mjs` uses the row-index holdout (`i % 5 === 0`)
and the live JS predictor.

| Metric | Re-fit live S28 v0.4 |
|---|---:|
| Evaluated rows | 4,397 |
| MAPE | **10.69%** |
| Median APE | **8.48%** |
| Signed bias | **+1.02%** |
| % underpriced | **41.7%** |
| Full-grid carat inversions | **0 / 56** |

### Bias by carat band

| Carat band | n | Mean bias | MAPE | % underpriced |
|---|---:|---:|---:|---:|
| 1.00-1.49 | 1,651 | -0.7% | 9.01% | 49.2% |
| 1.50-1.99 | 558 | +6.0% | 14.32% | 31.7% |
| 2.00-2.99 | 981 | +0.1% | 9.72% | 38.3% |
| 3.00-4.99 | 721 | +2.1% | 12.44% | 39.0% |
| 5.00-9.99 | 400 | +1.7% | 11.58% | 38.5% |
| 10.00+ | 86 | +0.6% | 11.48% | 40.7% |

The old carat-growing underpricing pattern is gone.

---

## 4. Remaining Limitations

- S26 remains the dense-cell accuracy champion because it is a lookup/ML/comp
  blend.
- S28 v0.4 is the better single-surface candidate, but it still has weak pockets
  in very high-grade sparse groups (`IF`, `VVS1`) where the dataset is thin.
- The next improvement should be a single-surface calibration or richer monotone
  basis, not a per-cell anchor that breaks sparse-cell transfer.

---

## 5. Artifacts

- `research/scripts/train-s28-monotone-parametric.py` — re-fit trainer
- `research/scripts/s28-predict.mjs` — live Node predictor with parity fixes
- `index.html` — browser predictor with the same feature map
- `research/scripts/diagnose-s28.mjs` — reproducible live diagnostic
- `research/data/starsgem-ml-model-s28-monotone-parametric.json` — S28 v0.4 artifact
- `research/data/s28-diagnostic.json` — current live diagnostic output
