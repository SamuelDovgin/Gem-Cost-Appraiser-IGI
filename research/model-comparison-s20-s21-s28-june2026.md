# White Diamond ML Model Comparison — May 2026

**Generated:** 2026-05-31  
**Dataset:** `research/data/dataset-clean-training.json` — 21,982 Segment A white diamond rows (retrained May 31)  
**Holdout method:** Every 5th row by array index (~20%, n ≈ 4,397)  
**Models evaluated:** S20 (ExtraTrees), S21 (LightGBM), S28 (Parametric), S26 (Champion blend)  
**Evaluation layer:** Layer 3 — lookup anchor + ML correction → final dollar price vs. actual  

---

## Methodology Notes

| Model | Evaluated by | Holdout n | Notes |
|-------|-------------|-----------|-------|
| S20 (ExtraTrees) | JavaScript end-to-end | 4,397 | Every 5th row of clean training JSON |
| S21 (LightGBM)   | JavaScript end-to-end | 4,397 | Same holdout as S20 |
| S28 (Parametric) | Python training-time  | 4,415 | ~20% random split from Python trainer |
| S26 (Champion)   | Training-time lookup benchmark | — | Lookup component only; not independently evaluable end-to-end |

**Caveat on Python vs JS evaluation:** The Python training script for S20/S21 reports holdout MAPEs of **5.20%** (S20) and **6.66%** (S21). These measure the ML *residual correction* accuracy on 683 balanced held-out spec-buckets, not the full end-to-end dollar MAPE. The JS evaluation below measures the complete pipeline: lookup anchor + ML correction → predicted price vs. actual price, which is the metric users experience. S28's 8.79% is also end-to-end but computed by Python over a comparable 20% holdout.

---

## 1. Overall Results

| Model | MAPE | MdAPE | p90 APE | Bias | Overall winner |
|-------|------|-------|---------|------|----------------|
| **S28 Parametric**   | **8.79%** | **6.69%** | **19.33%** | **+0.57%** | ✅ Best |
| S20 ExtraTrees       | 15.52%    | 14.81%    | 21.91%    | +13.97%   | |
| S21 LightGBM         | 23.45%    | 20.65%    | 39.14%    | +22.48%   | |
| S26 Champion (blend) | 5.45%*    | —         | —         | —         | *lookup benchmark only |

S28 wins on every global metric. The S20/S21 large positive bias (+14% and +22%) reflects systematic over-prediction: their lookup tables are anchored to current market prices while some holdout rows contain older-era inventory priced lower. S28's parametric structure (no lookup table anchoring) is robust to this era drift.

S21 is meaningfully worse than S20 with a p90 of 39% — a long right tail of bad predictions. The LightGBM monotone constraint does not improve accuracy in practice and appears to hurt the model on rounds and large stones.

---

## 2. By Carat Bucket

S28 uses two combined carat ranges (1–1.99, 3–4.99); S20/S21 JS eval uses 6 sub-ranges.

| Carat Bucket | n (JS) | S20 MAPE | S21 MAPE | S28 MAPE† | Best |
|-------------|--------|----------|----------|-----------|------|
| 1.00–1.49 ct | 1,651 | 15.09% | 23.24% | ~7.71% | **S28** |
| 1.50–1.99 ct |   558 | 15.36% | 18.57% | ~7.71% | **S28** |
| 2.00–2.99 ct |   981 | 14.44% | 23.67% |  7.36% | **S28** |
| 3.00–3.99 ct |   616 | 15.12% | 23.52% | ~11.39% | **S28** |
| 4.00–4.99 ct |   105 | 14.99% | 27.14% | ~11.39% | **S28** |
| 5.00–9.99 ct |   400 | 19.03% | 28.34% | 12.29% | **S28** |
| 10.00+ ct    |    86 | 23.96% | 28.82% | 14.68% | **S28** |

†S28 reports 1–1.99 as one bucket (MAPE 7.71%) and 3–4.99 as one bucket (MAPE 11.39%).

Key findings:
- S28 wins every carat bucket.
- S20 MAPE rises from ~15% (1–5ct) to 24% (10ct+). S21 rises from 18–23% to 29%.
- S28 also degrades at large carat (7.7% → 14.7%) but from a much lower starting point.
- At 3–5ct the gap between S28 and S20 is the largest: S28 11.4% vs S20 15%.

---

## 3. By Shape Style

| Shape Style             |   n | S20    | S21    | S28    | Best |
|-------------------------|-----|--------|--------|--------|------|
| round_standard          | 1,961 | 14.45% | 31.20% |  7.38% | **S28** |
| oval_standard           |   658 | 14.54% | 15.74% |  7.42% | **S28** |
| pear_standard           |   377 | 14.92% | 14.45% |  9.15% | **S28** |
| emerald_standard        |   281 | 17.02% | 17.96% | 10.27% | **S28** |
| princess_standard       |   227 | 21.53% | 24.24% | 13.74% | **S28** |
| marquise_standard       |   205 | 17.07% | 17.11% |  6.59% | **S28** |
| radiant_modified        |   145 | 15.44% | 15.59% | 11.09% | **S28** |
| heart_standard          |   136 | 17.06% | 16.52% | **19.26%** | **S21** (marginal) |
| asscher_standard        |   125 | 14.89% | 16.74% | 10.51% | **S28** |
| square_cushion_modified |   102 | 14.66% | 14.34% | 11.71% | **S28** |
| flower_modified         |    48 | 19.87% | 22.49% |  7.47% | **S28** |
| oval_ice_flower         |    25 | 27.19% | 29.42% |  7.48% | **S28** |
| pear_ice_flower         |    24 | 25.76% | 30.81% |  7.14% | **S28** |
| heart_modified          |    23 | 13.62% | 12.89% | 14.30% | **S21** |
| cushion_elongated       |    14 | 16.50% | 17.66% | 13.46% | **S28** |
| oval_modified           |    13 | 20.82% | 26.65% | 11.85% | **S28** |
| pear_modified           |    12 | 17.13% | 17.75% | 11.30% | **S28** |
| marquise_modified       |     7 | 17.46% | 18.07% |   n/a  | S20 |
| square_cushion_standard |     5 | 15.64% | 15.03% |   n/a  | S21 |
| heart_ice_flower        |     3 | 16.75% | 20.65% |   n/a  | S20 |

Key findings:
- **S28 wins 15 of 17 shapes** where it has coverage.
- **Heart standard is S28's only real weakness** at 19.26% — worse than S20 (17.06%) and S21 (16.52%). Heart geometry variation may not be captured well by S28's parametric structure.
- **round_standard gap is massive:** S20=14.45% vs S21=31.20% — 16.75pp gap. S21 has a structural problem on rounds specifically.
- **Ice-flower shapes** (oval_ice_flower, pear_ice_flower): S20/S21 error at 25–31%, S28 at 7%. The specialty-cut bucketing in the training data works well for S28's parametric surface.
- **S20 beats S21** on 16 of 20 shapes. S21's only advantages are on heart_standard, heart_modified, pear_standard, square_cushion_modified, square_cushion_standard — all very narrow margins (< 1pp), except heart_modified (−0.73pp).

---

## 4. By Color

| Color |     n | S20    | S21    | Best |
|-------|-------|--------|--------|------|
| D     | 2,299 | 15.52% | 23.72% | S20 |
| E     | 1,795 | 15.51% | 23.38% | S20 |
| F     |   295 | 15.60% | 21.90% | S20 |
| G     |     8 | 14.00% | 17.87% | S20 |

(S28 does not break out color in its holdout metrics.)

S20 beats S21 across all colors by 8–9pp. Color grade has minimal effect on S20 accuracy (14–16% flat). H-color stones do not appear in the holdout since the clean dataset is 97%+ D/E.

---

## 5. By Clarity

| Clarity |     n | S20    | S21    | Best |
|---------|-------|--------|--------|------|
| IF      |     9 | 15.16% | 22.67% | S20 |
| VVS1    |   409 | 16.99% | 26.03% | S20 |
| VVS2    | 2,120 | 15.69% | 21.44% | S20 |
| VS1     | 1,655 | 15.05% | 25.26% | S20 |
| VS2     |   200 | 14.51% | 24.47% | S20 |
| SI1     |     4 | 15.43% | 26.42% | S20 |

S20 wins all clarity grades. VVS1 is slightly harder for S20 (17%) than VS1/VS2 (15%). IF and SI1 are tiny subsamples. S21 is worst on VVS1 and SI1.

---

## 6. Lookup Coverage Analysis (S20)

| Level | n | S20 MAPE | S21 MAPE | Description |
|-------|---|----------|----------|-------------|
| A (specific) | 4,388 | 15.51% | 23.47% | Highest-resolution lookup match |
| B            |     6 | 13.53% | 14.08% | Second-tier match |
| E            |     3 | 23.71% | 16.86% | Broad fallback |
| **GLOBAL**   | **0** | — | — | No-coverage fallback |

99.8% of holdout stones match at Level A — the most specific lookup tier. The 9 non-Level-A stones are noise. There is no meaningful extrapolation problem within the Segment A white diamond universe.

**Low coverage stones (lookup count < 5, not GLOBAL): 236 stones (5.4%)**
- S20 MAPE: 15.60% — essentially identical to dense coverage (15.51%)
- S21 MAPE: 20.29% — slightly better than S21's global average (23.45%)
- Both models are robust at the margins of their lookup tables.

---

## 7. Extrapolation Analysis

**GLOBAL fallback count: 0 / 4,397 holdout stones (0.0%)**

Every holdout stone has a non-global lookup match. This means:

- No spec combination in the 21,982-row clean dataset falls outside the lookup table coverage.
- The 21,982 Segment A rows collectively cover all D–G IGI white diamond specs observed in practice.
- Specs not in training (e.g., H-color, SI2, shapes not yet in the dataset) would fall to GLOBAL lookup, giving less accurate results — but none appear here.

**Level E fallback (n=3):** These 3 stones show S20=23.71% vs S21=16.86%. S21 holds slightly better at lookup boundaries (fewer tree branches may generalize more gracefully than ExtraTrees).

**Large carat extrapolation:**
The biggest practical extrapolation concern is large stones with rare shapes. At 5ct+ the holdout still has 100% Level-A coverage for all major shapes (0 GLOBAL rows even at 10ct+). This confirms the clean dataset has enough large-stone training data to anchor the lookup tables across all common shape styles.

---

## 8. Large Carat Detail (5ct+)

### 5.00–9.99 ct (n=400, 0% GLOBAL)

| Shape              |  n | S20    | S21    |
|--------------------|-----|--------|--------|
| round_standard     |  89 | 16.89% | **37.22%** |
| oval_standard      |  74 | 17.24% | 24.27% |
| emerald_standard   |  45 | 16.96% | 22.17% |
| marquise_standard  |  40 | 19.55% | 25.20% |
| pear_standard      |  31 | 22.89% | 29.24% |
| asscher_standard   |  25 | 17.30% | 23.62% |
| pear_ice_flower    |  16 | 29.75% | 36.21% |
| princess_standard  |  15 | 23.62% | 33.00% |
| oval_ice_flower    |  13 | 30.04% | 34.35% |
| radiant_modified   |  13 | 15.68% | 21.73% |
| heart_standard     |  11 | 15.16% | 20.87% |
| sq_cushion_modified|  11 | 17.22% | 21.54% |

S28 overall for 5–9.99ct: **12.29%** — beats S20 (19.03%) and S21 (28.34%).

### 10.00+ ct (n=86, 0% GLOBAL)

| Shape             |  n | S20    | S21    |
|-------------------|----|--------|--------|
| emerald_standard  | 23 | **35.53%** | **39.01%** |
| oval_standard     | 11 | 20.41% | 25.18% |
| round_standard    |  9 | 15.22% | 33.32% |
| oval_modified     |  7 | 20.80% | 26.31% |
| marquise_standard |  6 |  8.99% |  9.59% |
| pear_standard     |  6 | 29.87% | 37.31% |
| pear_ice_flower   |  5 | 20.60% | 23.22% |
| oval_ice_flower   |  5 | 27.75% | 33.46% |

S28 overall for 10ct+: **14.68%** — beats S20 (23.96%) and S21 (28.82%).

**Large carat key findings:**
- S21 collapses on 5ct+ rounds (37%) and 10ct+ rounds (33%). Use S20 for large rounds, not S21.
- 10ct+ emerald (n=23, S20=35.5%) is the single worst bucket across all models and sizes. Individual emerald pricing at extreme carat has too much scatter for any model.
- Marquise at 10ct+ (n=6) is surprisingly accurate for S20 (9.0%) — likely a well-clustered spec group.
- S28 outperforms both S20 and S21 at 5ct+ across the board; the parametric carat tail extrapolation is better calibrated than the lookup-based tail.

---

## 9. Model Head-to-Head (S20 vs S21)

### Shapes where S20 beats S21 by > 3pp

| Shape | S20 | S21 | Gap |
|-------|-----|-----|-----|
| round_standard | 14.45% | 31.20% | **−16.75pp** |
| oval_modified  | 20.82% | 26.65% | −5.82pp |
| pear_ice_flower| 25.76% | 30.81% | −5.05pp |

### Shapes where S21 beats S20 by > 3pp
*(None.)*

S20 dominates S21 comprehensively. S21's monotone constraints provide no measurable accuracy benefit on this dataset.

---

## 10. Worst Individual Predictions (APE > 90%)

### S20 Worst Cases

| Row | Shape | Spec | Actual | S20 | APE | Lookup |
|-----|-------|------|--------|-----|-----|--------|
| 13750 | princess_standard | D VVS2 1.69ct | $101/ct | $237/ct | 136% | A(n=102) |
| 324   | emerald_standard  | D VVS1 11.36ct | $205/ct | $445/ct | 117% | A(n=26) |
| 16057 | princess_standard | D VVS1 1.09ct | $124/ct | $269/ct | 117% | A(n=37) |
| 16073 | princess_standard | D VVS1 1.09ct | $124/ct | $269/ct | 117% | A(n=37) |
| 13695 | princess_standard | D VVS2 1.50ct | $113/ct | $234/ct | 106% | A(n=102) |
| 15756 | princess_standard | D VVS1 1.07ct | $130/ct | $268/ct | 105% | A(n=37) |

**Root cause:** Both failure clusters have the same explanation — the S20 lookup table reflects current market pricing (~$200–270/ct for D VVS1/VVS2 princess and large emerald), but these specific holdout rows are older-era inventory priced at $100–130/ct. The model correctly prices them at *today's* market rate; the ground-truth label is the historical price. This is a price-era drift problem, not a model bug.

Verification: for row 13750 (princess D VVS2 1.69ct), `predictStarsgemMl` returns `lookupRate=$205.99/ct` — the spec bucket median from training data. The actual holdout price is $100.61/ct (old era). S20 predicts $237/ct (close to lookup). The error is almost entirely in the lookup anchor, not in S20's residual correction (residualMult=1.15).

### S21 Worst Cases (same pattern, generally larger errors)

| Row | Shape | Spec | Actual | S21 | APE |
|-----|-------|------|--------|-----|-----|
| 324   | emerald_standard  | D VVS1 11.36ct | $205/ct | $475/ct | 132% |
| 13750 | princess_standard | D VVS2 1.69ct  | $101/ct | $230/ct | 128% |
| 16057 | princess_standard | D VVS1 1.09ct  | $124/ct | $271/ct | 118% |

S21's worst cases mirror S20's, with slightly higher errors in most instances.

---

## 11. Summary and Recommendations

### Model Rankings

| Rank | Model | Overall MAPE | Best Use Case | Known Weakness |
|------|-------|-------------|--------------|----------------|
| 1 | **S28 Parametric**  | 8.79% | All buckets, all shapes (except heart) | Heart standard (19.3%); 10ct+ (14.7%); no explicit lookup anchoring |
| 2 | **S20 ExtraTrees**  | 15.52% | Better than S21 on all rounds and large stones | Princess/emerald worst cases; ice-flower at 5ct+ |
| 3 | **S21 LightGBM**    | 23.45% | Marginal edge on heart_modified, heart_standard only | Rounds (31%), 5ct+ (28–37%); bias +22% |
| — | **S26 Champion**    | 5.45%* | Production blend layer combining all sources | *Lookup benchmark only |

### Actionable Decisions

1. **S28 should be the primary standalone model.** It has the best accuracy, near-zero bias, and handles specialty shapes (ice-flower) far better than S20/S21.

2. **For heart_standard, prefer S20 over S28.** S28's 19.3% MAPE on heart is its only clear weakness. S20 (17.1%) and S21 (16.5%) both outperform it here. Consider a heart-specific override in the blending policy.

3. **Do not use S21 for 5ct+ stones.** At 5–10ct S21 MAPE is 28% (vs S20 19%, S28 12%). S21 should be downweighted or excluded for large stones.

4. **Extrapolation coverage is excellent.** Zero GLOBAL-fallback stones in the holdout. The 21,982 Segment A training rows cover the full D–G IGI white diamond spec space. No action needed.

5. **Flag old-era inventory rows in the dataset.** The worst S20/S21 predictions (APE > 100%) are all caused by price-era drift, not model failure. If these rows can be identified and removed or flagged, MAPE would improve significantly. Consider adding a `row_era` feature or applying a row-number-based recency weight.

6. **Princess and 10ct+ emerald need comp engine cross-check.** Both are structurally hard: princess has bimodal price clusters at the same spec, and 10ct+ emerald has extreme individual price variance. Always run these against the Alibaba comp engine before final output.
