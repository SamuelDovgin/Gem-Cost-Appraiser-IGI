# S25 — Hierarchical Parametric Power-Law Model

**Status:** Implemented as `s25-parametric-v1.2`  
**Date:** 2026-05-30  
**Scope:** White / colorless lab-grown diamonds only. Fancy-color diamonds use the separate Color S22 / Color S23 model family.

---

## 1. Core Problem

S20/S22 and S23 are mostly interpolation engines. They work well where lookup coverage is dense, but rare-spec or large-carat cells can fall through to weak global anchors.

Original motivating failure:

- 5ct+ HEART D VS1 could fall to a low-support/global lookup around `$18/ct`.
- That produced a total price near `$96` when the correct large-heart reference was closer to `$1,000+`.

S21 patched this with broader lookup coverage. S25 adds a different tool: a compact parametric baseline that can always price a white-diamond spec without using a global sentinel.

---

## 2. Model Formula

S25 predicts log price per carat:

```text
log($/ct) =
  shapeBaseline[shape]
  + specEps[shape||color||clarity]
  + betaGlobal * log(carat)
  + deltaColor * colorRank[color]
  + deltaClarity * clarityRank[clarity]
  + cutAdj[cut]
```

Then:

```text
price = exp(log($/ct)) * carat
```

Key implementation details:

- `betaGlobal` is fitted from ROUND rows only and applied globally.
- `shapeBaseline` pools the average level for each shape after removing carat, clarity, color, and cut effects.
- `specEps` captures observed `(shape, color, clarity)` excess after shrinkage toward zero.
- `deltaColor` is constrained to `<= 0` so gradient-only extrapolation cannot make lower color grades more expensive than D.
- `deltaClarity` is fitted from ROUND rows and remains negative, so clarity is monotone.
- `cutAdj` is fitted from ROUND residuals where possible and falls back to priors for sparse cut grades.

---

## 3. Data Reality Check

Training data: `research/data/dataset-clean-training.json`, Segment A only, 12,843 rows.

| Shape | n | Carat Range | S25 support note |
|---|---:|---|---|
| ROUND | 9,701 | 0.30-5.06ct | Strong beta source |
| PEAR | 768 | 0.50-1.38ct | Good intercept support, narrow carat range |
| OVAL | 746 | 0.50-1.18ct | Good intercept support, narrow carat range |
| MARQUISE | 420 | 0.51-1.29ct | Moderate support |
| RADIANT | 370 | 0.50-1.63ct | Moderate support, high residual error |
| PRINCESS | 352 | 0.51-1.59ct | Moderate support |
| EMERALD | 258 | 0.50-1.83ct | Moderate support |
| CUSHION | 137 | 0.56-1.55ct | Sparse but S25 performs well in-sample |
| ASSCHER | 47 | 1.00-1.03ct | Very sparse, benefits from pooling |
| SQUARE | 31 | 1.00-1.01ct | Very sparse |
| HEART | 13 | 1.01-1.35ct | Too sparse for large-carat extrapolation |

Critical limitation: every non-round shape tops out below 2ct in Segment A. S25 can extrapolate, but it cannot learn large-fancy-shape scarcity premiums that are absent from the training sheet.

---

## 4. v1.2 Training Changes

The old script could regenerate an inverted color gradient. v1.2 fixes that drift.

Current fitted values:

```text
betaGlobal     = -0.124622
deltaColorRaw  = +0.0089
deltaColor     = 0.0000
deltaClarity   = -0.059349
spec cells     = 105
training MAPE  = 8.26%
```

Why clamp `deltaColor`?

- The round sheet is heavily D-weighted and color differences are weak in current lab-grown wholesale data.
- Raw OLS estimated a positive color coefficient, which would make D cheaper than G for unseen specs.
- Observed cells still carry empirical color differences through `specEps`.
- Gradient-only fallback is now neutral rather than inverted.

The exported JSON also now includes:

- `deltaColorRaw`
- `shapeSupport`
- `hyperparameters.colorGradientConstraint`

---

## 5. Benchmark Results

In-sample on the 12,843 Segment-A white rows:

```text
S22 + S21 fallback: 11.36% MAPE
S23 + S21 fallback: 13.56% MAPE
S25 v1.2:            8.26% MAPE
```

By shape:

```text
ROUND       7.77%
PEAR       10.07%
OVAL        7.98%
MARQUISE    6.86%
RADIANT    18.53%
PRINCESS    8.21%
EMERALD    14.29%
CUSHION     3.28%
ASSCHER     2.29%
SQUARE      2.53%
HEART       4.38%
```

S25 wins ROUND, CUSHION, ASSCHER, and SQUARE in the current comparison. S22 remains better for dense common fancy shapes, and S23 remains better for PRINCESS, EMERALD, and HEART.

---

## 6. Monotonicity

Clarity is monotone:

```text
1ct ROUND D:
IF    $163.00/ct
VVS1  $150.09/ct
VVS2  $125.89/ct
VS1   $122.69/ct
VS2   $116.11/ct
SI1   $109.05/ct
SI2   $101.93/ct
```

Color handling:

- Observed specs can be non-monotone because `specEps` preserves sheet-specific residuals.
- Unseen specs are color-neutral from D through J because `deltaColor = 0`.
- This intentionally avoids the worse error of making lower color grades more expensive in extrapolated cells.

Carat:

- `betaGlobal` is negative in this sheet, so `$ / ct` gently decreases with carat.
- This reflects the observed 2025-2026 lab-grown supplier data more than a traditional natural-diamond scarcity curve.
- Total price still increases with carat.

---

## 7. Large-Carat Specialty Caveat

S25 still underprices large specialty hearts:

```text
Heart D VS1:
1ct      S25 $141    S21 $159
3ct      S25 $370    S21 $359
5.21ct   S25 $600    S21 $1,410
8ct      S25 $873    S21 $2,310
```

Interpretation:

- S25 is reasonable at 1-3ct.
- At 4ct+, S25 misses the specialty-heart premium because Segment A has only 13 hearts and none above 1.35ct.
- S21 remains the better fallback for 4ct+ specialty hearts when its lookup support is available.

---

## 8. Colored Gems Boundary

S25 is **not** a colored-gem model.

Fancy-color diamonds are handled by:

- `research/data/color-diamond-ml-model.json` — Color S22 ExtraTrees.
- `research/data/color-diamond-ml-model-s23.json` — Color S23 LightGBM with monotone intensity constraints.

Current colored-gem checkpoint:

```text
Rows: 1,657 fancy-color stones
Validation rows: 161
Direct StarGem anchors: 5

Color S22 validation MAPE: 3.12%
Color S23 validation MAPE: 3.86%
```

The app should keep hiding S25 for colored stones and use the color model family instead.

---

## 9. Recommended Use

Use S25 as:

- a 100%-coverage white-diamond audit baseline;
- the best current white ROUND estimator in this benchmark;
- a sparse-shape baseline for ASSCHER, CUSHION, and SQUARE;
- an explainable fallback when S22/S23 provide weak/global coverage.

Do not use S25 as:

- the primary dense fancy-shape model where S22 is clearly better;
- the large-specialty 4ct+ fallback when S21 has support;
- any colored-gem pricing model.

---

## 10. Future Work

1. Add held-out white validation so S25 can be measured out-of-sample.
2. Use `shapeSupport.maxCarat` in the UI to warn on extreme extrapolation.
3. Add L/W ratio once dimensions are reliably available for Segment-A rows.
4. Collect more 3ct+ non-round white stones, especially HEART and ASSCHER.
5. Expand direct StarGem colored anchors and keep them in the separate color model family.
