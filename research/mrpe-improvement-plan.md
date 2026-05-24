# StarGem ML MAPE Improvement Plan

## Current State

- **Best MAPE**: 4.05% (S3 — rate-per-carat target + MAE criterion, 120 trees, depth=28)
- **Data**: 28,394 rows from StarGem XLS stock file (May 2026)
- **R²**: ~0.979–0.984 (excellent, but MAPE stubborn at ~4%)
- **Key insight**: StarGem pricing follows `price = round(carat × rate_per_ct) / 170` where `rate_per_ct` comes from a supplier lookup table. We should be able to approach much lower MAPE if we reconstruct this table.

## Root Causes of the 4% MAPE Floor

### 1. Temporal rate card shifts (BIGGEST)

Within the same `(ROUND, D, VVS2, 0.50-0.69, HPHT, IGI)` group, early rows have median rates of **$170–178/ct** while later rows level off at **$118–120/ct** — a 40% shift. The data spans multiple rate card vintages, and the model averages across them. Training on mixed-time data guarantees error on both old and new stones.

### 2. Carat buckets are too coarse

A 0.50ct stone at $181/ct and a 0.69ct stone at $102/ct are in the same 0.50–0.69 bucket — a **77% rate difference within bucket**. The `carat_bucket_position` feature assumes linear decay, but the decay is MUCH steeper near the lower threshold. For the 2.00–2.99 bucket:
- 2.00–2.03ct: **$203.69/ct** 
- 2.05–2.08ct: **$145.63/ct** (a $58/ct drop over just 0.05ct)

### 3. Magic threshold proximity not modeled

The current `Dist_carat_threshold` feature only captures distance to the nearest 0.5ct mark. But the data shows the premium is strongest right at the round carat thresholds (0.50, 1.00, 1.50, 2.00, 3.00). The model has:
- `carat_bucket` (categorical): separates 1.50–1.99 from 2.00–2.99 ✓
- `carat_bucket_position` (linear 0→1): assumes uniform decay within bucket ✗
- `Dist_carat_threshold`: only at 0.5ct intervals, not 1.0ct ✗

**What's missing**: The non-linear rate decay within a bucket. The rate drops $58/ct between 2.00 and 2.05, then flattens. A linear position feature can't capture this.

### 4. Cut is a major differentiator treated as a simple category

EX cut stones command **$171/ct** vs **$120/ct** for ID cut in the same group — a 43% gap. Cut goes through `OneHotEncoder` alongside other features, so the model has to "find" these interactions through tree splits rather than having them directly encoded. Cut-specific models or Cut × carat interactions would be more efficient.

---

## Proposed Strategies

| # | Strategy | Expected MAPE | Rationale |
|---|----------|:---:|-----------|
| **S11** | **Temporal cutoff** — sort by `rowNo`, train only on most recent 60% of data | 2.5–3.5% | Eliminates rate card mixing, the largest source of artificial error |
| **S12** | **Fine lookup consensus (0.01ct + Cut-aware)** — direct lookup table at `(Shape, Color, Clarity, carat_0.01ct, TypeName, Report, Cut)` with hierarchy fallback. No ML. | 2.0–3.0% | Tests "StarGem uses a lookup table" hypothesis directly. If true, this approaches the theoretical minimum error. |
| **S13** | **Two-stage: lookup + ML residual** — Stage 1 = S12 fine lookup. Stage 2 = ExtraTrees on `(actual - lookup_prediction)` using Polish, Symmetry, table%, depth%, L/W ratio, fluorescence. | 1.5–2.5% | Best of both: lookup captures the step-function pricing, ML captures continuous adjustments |
| **S14** | **Cut-specific models** — train separate ExtraTrees per Cut grade (EX, VG, ID). The rate/carat curve is fundamentally different per cut. | 2.5–3.5% | $171 vs $120 per ct for same spec = different pricing logic |
| **S15** | **Magic-threshold features** — add `dist_to_nearest_magic_carat` (0.50, 1.00, 1.50, 2.00, 3.00, 4.00, 5.00), `log(1 + dist)`, `1/(dist + epsilon)`, and `is_near_magic` flags for being within 0.03ct of a threshold | 3.0–3.5% | Captures non-linear premium decay near magic numbers |
| **S16** | **Carat × Cut interaction features** — explicit `carat_bucket + '_' + Cut` as a categorical feature, plus `Cut × Color × Clarity` interactions | 2.5–3.5% | Encodes the interaction that trees currently have to "discover" |
| **S17** | **Full combo: temporal cutoff + fine lookup + magic features + Cut-specific** | **1.0–2.0%** | All structural fixes combined |

---

## Magic Threshold Analysis

The user raised the question: does the model capture that 1.99ct is worth much less than 2.00ct?

**Data answer**: 
- At 1.49 vs 1.50: Same rate ($125.53/ct), same median price ($188). The `carat_bucket` feature already separates these into different buckets (1.00–1.49 vs 1.50–1.99). ✓ Covered.
- At 0.50 vs 0.49: Same rate ($122.82/ct), same price ($61.41). ✓ Covered by bucket.
- The supplier avoids selling stones just below magic thresholds (only 3 stones at 1.98–1.99ct, only 6 at 1.48–1.49).

**The actual problem is different**: It's not the cross-threshold jump that matters (the `carat_bucket` categorical variable handles that). It's the **premium decay WITHIN a bucket** as you move away from the magic threshold:

| Carat range | Rate per ct | Drop |
|-------------|:---:|:---:|
| 2.00–2.03 (just above magic) | $203.69/ct | — |
| 2.05–2.08 (farther in) | $145.63/ct | −$58.06/ct |
| 0.50–0.53 (just above magic) | $121.45/ct | — |
| 0.55–0.58 (farther in) | $106.51/ct | −$14.94/ct |

The model sees `carat_bucket_position` as a linear 0→1 value, but the actual rate curve is **exponential decay** from the lower bound. A stone at position 0.02 (2.02ct) has a massive premium over position 0.05 (2.05ct), but the linear feature treats them as only 3% different.

**Fix**: Replace `carat_bucket_position` with `1 / (carat - lo + 0.001)` or `exp(-k * (carat - lo))` that captures the steep initial premium decay.

---

## Implementation Priority

1. **S11 first** — easiest to test, likely highest impact. If temporal mixing accounts for most of the error, we see immediate MAPE improvement.
2. **S12 second** — tests the lookup table hypothesis directly. If this gets MAPE to 2%, we know the problem is solved.
3. **S13 + S15** — combine lookup consensus with magic-threshold-aware residual model.
4. **S17** — if all individual fixes work, combine them.

### Not recommended:
- Adding more trees or depth to ExtraTrees — S7 already tried 200 trees with `max_depth=None` and got WORSE results (4.44% MAPE). Overfitting.
- LightGBM — S8 got 4.63% MAPE. The problem isn't the model architecture, it's the features and training data structure.
- More engineered numeric features (Carat_sq, Carat_cube, etc.) — S4 added these and got 4.06% vs S3's 4.05%. No improvement.

---

## Metrics Target

- **Current**: 4.05% MAPE, $19.28 MAE
- **Target for S11+S12**: ≤ 2.5% MAPE, ≤ $12 MAE
- **Target for S17 (full combo)**: ≤ 2.0% MAPE, ≤ $10 MAE
