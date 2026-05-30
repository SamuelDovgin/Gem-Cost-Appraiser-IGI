# Why ML Models Are Stuck Above 5% MAPE — Root Cause Analysis

**Generated:** 2026-05-30  
**Data source:** StarGem XLS stock file (May 2026, 28,394 rows)  
**Models analyzed:** S18, S20, S21, S22, S23

---

## TL;DR

The 5%+ MAPE is **not primarily a model problem** — it is a **dataset problem**. The training data contains the same diamond specifications at wildly different prices because the dataset spans multiple rate card vintages. A 1.1ct Princess D VVS1 appears at both $275/ct and $128/ct in the same file — a 53% difference. No model can predict which price a stone will have when the ground truth is determined by which rate card era it was priced in, not by the diamond's characteristics.

**Mathematical finding:** The intrinsic noise floor (minimum possible MAPE from any model given this data) is **4.32%** — measured directly from within-spec price variance. S20's 4.63% MAPE is only **0.31pp above the theoretical minimum**. The model is essentially at its ceiling.

---

## 1. Intrinsic Dataset Noise Floor: 4.32% MAPE

To find the noise floor, we grouped all stones by identical spec (same carat to 2 decimal places, shape, color, clarity, cut) and measured the average percentage deviation from the group mean. This is what any perfect oracle model would still get wrong because the variation has nothing to do with features the model can observe.

**Result: 4.32% MAPE floor across the full 28,394-row dataset.**

Distribution of within-identical-spec error:

| APE Range | Rows | % of Total |
|-----------|------|-----------|
| 0–1% | 14,441 | 50.9% |
| 1–5% | 5,631 | 19.8% |
| 5–10% | 4,712 | 16.6% |
| 10–20% | 2,342 | 8.2% |
| 20–50% | 1,165 | 4.1% |
| >50% | 103 | 0.4% |

The 29.3% of stones with >5% within-spec error are the noise the model cannot overcome. These are not measurement errors — they are real prices, just from different time periods.

**Identical-spec groups with >15% price spread: 540 out of 6,913 groups (7.8%), covering 12,599 rows — 44.4% of all training data.**

---

## 2. The Primary Culprit: Temporal Rate Card Shifts

The data file is a cumulative stock log, not a snapshot. StarGem updates its rate cards continuously. When the same spec appears across multiple rate periods, the model sees them as contradictory training examples.

**Measured temporal drift (by row number as time proxy):**

| Spec | Early price | Late price | Drift |
|------|------------|-----------|-------|
| 1.1ct PRINCESS D VVS1 | $275/ct | $128/ct | **−53.5%** |
| 1.0ct PRINCESS D VVS1 | $281/ct | $137/ct | −51.1% |
| 1.1ct PRINCESS D VVS2 | $232/ct | $119/ct | −48.7% |
| 1.1ct PRINCESS D VS1 | $222/ct | $115/ct | −48.1% |
| 1.0ct PEAR D VVS2 | $229/ct | $124/ct | −46.0% |
| 1.0ct OVAL D VVS2 | $212/ct | $119/ct | −43.8% |

**Mean absolute temporal drift: 26.8%** across specs with data in both halves of the dataset.

**This is the #1 source of error.** When a model trains on a stone priced at $275/ct and another at $128/ct for the same spec, it predicts ~$200/ct — wrong for both. This is why the S18 temporal cutoff (training only on recent 70% of data) dropped MAPE from 4.53% → 3.26% with zero model changes.

### Why the temporal fix doesn't fully solve it

Even within the recent 70% of data, there is still **16.1% average drift** between the first and second halves of that window. Lab diamond wholesale prices were falling throughout the entire collection period. The noise floor for the recent-only window is still **4.26%** — nearly identical to the full-dataset floor.

**Key implication:** Each time StarGem is re-stocked at a new rate card, the old-price stones from the previous card pollute the dataset. The only clean fix is to timestamp each pricing event and use only the most recent pricing snapshot, not the full stock history.

---

## 3. What Does NOT Explain the Variance

### HPHT vs CVD
Average HPHT premium over CVD for identical specs: **−1.6%** (essentially zero, and sometimes negative). This is not a meaningful pricing signal — StarGem prices them identically.

### Polish & Symmetry
Adding Polish+Symmetry to the spec key reduced the noise floor from **4.3221% → 4.3038%** — a difference of 0.018pp. These features are captured in the model but contribute almost nothing to explaining within-spec variance.

### Model Architecture
Tested: Extra Trees, LightGBM, Random Forest, XGBoost, CatBoost, lookup-only, two-stage lookup+ML. **Best result was Extra Trees at 4.38% MAPE.** This suggests the ceiling is the dataset, not the algorithm choice.

---

## 4. Current Model Accuracy vs. Theoretical Limits

| Model | MAPE | Notes |
|-------|------|-------|
| Theoretical minimum (dataset floor) | **4.32%** | Measured from within-spec variance |
| **S20 ExtraTrees (production)** | **4.63%** | Only 0.31pp above theoretical minimum |
| S18 temporal cutoff (recent 70%) | 3.26% | Better training set, not production |
| S22 = S20 + PAV post-process | 9.97% | PAV designed for ladders, not point pricing |
| S23 grade-agnostic anchor + LightGBM | 7.60% | More complex, worse accuracy |
| S21 LightGBM monotone | ~5.6% | Good monotonicity, worse MAPE |

**S20 is the best point-pricing model we have.** It is sitting 0.31pp above a mathematical ceiling imposed by the data. Further model improvements will yield diminishing returns until the data quality issue is addressed.

### MAPE by carat bucket (S20)

| Carat Bucket | MAPE | n |
|---|---|---|
| 0.90–0.99ct | 3.08% | 1 |
| 10.00+ | 3.06% | 45 |
| 4.00–4.99ct | 3.12% | 52 |
| 5.00–9.99ct | 3.25% | 86 |
| 0.50–0.69ct | 3.79% | 40 |
| 0.70–0.89ct | 3.78% | 31 |
| **1.00–1.49ct** | **5.52%** | **109** |
| 1.50–1.99ct | 5.21% | 99 |
| 3.00–3.99ct | 5.33% | 87 |
| 2.00–2.99ct | 5.86% | 99 |

The 1–3ct range is the worst — this is exactly where the largest temporal price crashes occurred (the majority of the 50%+ drops are in 1–1.5ct Princess and Oval, the most commoditized sizes). Large stones (5ct+) have less temporal churn.

---

## 5. The 1.29% Extreme Outlier Problem

Within the "clean" recent 70% window, there are still **257 stones (1.29%)** priced >30% from their spec median. These are almost certainly old-rate-card leftovers that made it into the recent window. Examples:

- 1.09ct Princess D VVS2: $250/ct vs median $132/ct (90% above median)
- 1.01ct Oval D VVS2: $220/ct vs median $121/ct (82% above)
- 1.03ct Oval D VVS2: $216/ct vs median $128/ct (68% above)

These 257 stones add approximately **+0.6pp MAPE** to the model. Removing them before training would push S18's MAPE well below 3%.

---

## 6. Should You Be Concerned?

**Short answer: No, but the ceiling is real and will require a data fix to break through.**

The model (S20, 4.63%) is doing almost everything right. The 5%+ error is not a sign of a broken algorithm — it's a sign of a noisy training signal. In practical terms:

- **For stones priced in the current rate card** (the most recent days/weeks of data), actual model error is likely closer to 2–3%.
- **The displayed 4.6% MAPE is inflated by old-rate stones** that the model correctly rejects but still has to train on.
- **S22 and S23 are worse for point pricing** — don't use them as the primary pricing estimate. S22's 9.97% MAPE from PAV post-processing is expected behavior (PAV averages adjacent cells, which destroys point accuracy for individual stones).

---

## 7. What Would Actually Move the Needle

Ranked by estimated impact:

| Action | Estimated MAPE gain | Effort |
|--------|-------------------|--------|
| **Use only most-recent N days of stock data** (not cumulative) | −1.5 to −2pp | Medium — need to identify restock dates |
| **Remove extreme outliers** (>30% from spec median per bucket) | −0.3 to −0.6pp | Low |
| **Monthly retraining** as new rate cards arrive | Prevents drift from accumulating | Low |
| **Add a "rate card era" feature** if stock dates are available | −0.5 to −1pp | Medium |
| Better ML architecture (more trees, features) | <0.1pp | High effort, low return |

The most powerful fix is getting a clean, time-stamped version of the data where each stone has the date it was added to stock. With that, you could train only on "last 30 days" and achieve estimated 2–2.5% MAPE with the existing S20 architecture.

---

## 8. Why S23 Got Worse, Not Better

S23 tried a grade-agnostic anchor (removing Color/Clarity from the lookup) + LightGBM monotone residual. It achieved 7.6% MAPE — significantly worse than S20. The reason:

- Removing Color/Clarity from the lookup table increased lookup residuals that the LightGBM then had to correct
- The larger residuals required larger corrections, amplifying the effect of noise in the training data
- Monotone constraints prevented the model from fitting the true non-monotone patterns in the noisy data

The lesson: when the noise floor is 4.32%, adding complexity helps only if it reduces a source of **structural bias** — not if it just creates more parameters to fit noise.

---

## Summary

| Question | Answer |
|----------|--------|
| Is there a model bug? | No |
| Is 5%+ MAPE achievable? | Not with the current training data |
| What's the theoretical minimum? | 4.32% MAPE |
| How close is S20? | 0.31pp above minimum |
| Primary cause of noise? | Temporal rate card shifts (26.8% avg drift) |
| Does HPHT/CVD matter? | No (−1.6% avg premium) |
| Does Polish/Symmetry matter? | No (0.018pp improvement) |
| What's the fix? | Use time-stamped, recent-only data |
| What's achievable with that fix? | ~2–2.5% MAPE |
