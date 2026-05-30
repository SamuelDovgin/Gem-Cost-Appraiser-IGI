# White Diamond ML Model Comparison — S22 vs S23 vs S25
### May 30, 2026 · Benchmark on 12,843 StarGem Segment-A rows

---

## 1. Overview

Three ML models are currently active for white lab-grown diamond pricing. This doc covers their architectures, benchmark MAPE numbers, monotonicity properties, best-fit use cases, and improvement roadmaps.

| Model | Architecture | Training set | Coverage |
|-------|-------------|--------------|---------|
| **S22** | ExtraTrees (S20 base) + S21 fallback | 198 / 792 samples (two-stage) | 93.9% (6.1% global hits remain) |
| **S23** | LightGBM monotone + S21 fallback | Grade-agnostic anchor + residual | 98.4% (1.6% global hits remain) |
| **S25** | Hierarchical parametric power-law | 12,843 Segment-A rows | **100%** (extrapolation-safe) |

---

## 2. Benchmark Methodology

**Dataset**: `research/data/dataset-clean-training.json` — 12,843 StarGem Segment-A rows.  
Shapes: ROUND (9,701), PEAR (768), OVAL (746), MARQUISE (420), RADIANT (370), PRINCESS (352), EMERALD (258), CUSHION (137), ASSCHER (47), SQUARE (31), HEART (13).

**Script**: `research/scripts/benchmark-all-models.mjs`

**Important caveat on fairness**: S25 was trained on this exact dataset, so its benchmark MAPE is **in-sample** (optimistic lower bound). S22 and S23 were trained on **different**, smaller datasets; their MAPE numbers here are effectively out-of-sample relative to this test set. The true apples-to-apples comparison would require a held-out test set not used for any model's training.

**S21 fallback rule** (applied consistently to S22 and S23): when a model hits an effectively-global lookup (level=GLOBAL or lookupCount ≤ 3), substitute S21 if S21 has a higher lookupCount AND higher price.

---

## 3. Overall MAPE Results

```
Model                         MAPE      S21 fallbacks   Remaining globals
─────────────────────────────────────────────────────────────────────────
S22 (ExtraTrees + S21)        11.36%    186 / 12,843    786 / 12,843 (6.1%)
S23 (LightGBM + S21)          13.56%    422 / 12,843    209 / 12,843 (1.6%)
S25 (Parametric, 100% cov.)    9.23%    N/A             0 / 12,843   (0.0%)
```

Key observations:
- **S25 leads overall** but this is in-sample — the true gap vs S22/S23 is smaller.
- **S22 is the workhorse for fancy shapes** (see per-shape table below).
- **S23 is the most conservative on coverage** — fewest remaining global hits after fallback.
- **S23's higher MAPE** largely comes from ROUND (16.69% — rounds are not well-anchored by its grade-agnostic mechanism since rounds are spec-homogeneous, not needing anchor).

---

## 4. MAPE by Shape

```
Shape        n      S22       S23       S25     Best model
──────────────────────────────────────────────────────────
ROUND     9,701   13.85%    16.69%     7.77%   S25 ✓
PEAR        768    3.21%     3.58%    14.59%   S22 ✓
OVAL        746    3.88%     4.23%    12.58%   S22 ✓
MARQUISE    420    3.74%     4.08%    10.96%   S22 ✓
RADIANT     370    3.10%     3.41%    19.89%   S22 ✓
PRINCESS    352    2.94%     2.86%    12.67%   S23 ✓
EMERALD     258    4.13%     3.68%    18.21%   S23 ✓
CUSHION     137    5.35%     4.29%     6.32%   S23 ✓
ASSCHER      47    9.70%    15.75%     5.42%   S25 ✓
SQUARE       31    2.56%     2.93%     5.40%   S22 ✓
HEART        13    4.37%     2.27%     6.43%   S23 ✓
```

**Pattern analysis:**

- **S22 dominates all common fancy shapes at 1-2ct** (PEAR, OVAL, MARQUISE, RADIANT, SQUARE: 3-4% MAPE). These shapes have dense lookup tables in S20's training data, so ExtraTrees interpolation is very accurate.
- **S23 wins for step cuts and hearts** (PRINCESS, EMERALD, CUSHION, HEART). These shapes benefit more from monotone LightGBM's grade-anchoring than from raw lookup density.
- **S25 dominates ROUND** (7.77% vs 13.85% S22). S25 was trained on 9,701 rounds with per-spec intercepts — it effectively memorizes the round spec table. This is somewhat trivial (in-sample), but suggests the parametric form is a good fit.
- **S25 also wins for ASSCHER** (5.42% vs 9.70% S22) despite only 47 training stones — the power-law fit handles this sparse shape better than ExtraTrees.
- **S25 fails badly for fancy shapes** (RADIANT 19.89%, EMERALD 18.21%) where it has only 250-370 training stones. The per-spec intercepts are noisier than S22's multi-level lookup tables.

---

## 5. Monotonicity Analysis

### 5.1 Clarity — ✅ Correct in all models

S25 clarity sweep (ROUND D VS1 → IF, 1ct):
```
IF    $162.82/ct  (rank 0, most expensive)
VVS1  $150.04/ct  ✓
VVS2  $125.85/ct  ✓
VS1   $115.38/ct  ✓
VS2   $107.28/ct  ✓
SI1   $100.51/ct  ✓
SI2    $93.89/ct  (rank 6, least expensive)
```
`deltaClarity = -0.0593` per rank → each clarity step lowers $/ct by ~6%. Monotone ✓.

### 5.2 Color — ⚠️ Fixed bug in S25 (v1.1)

**Original S25 (v1.0)**: `deltaColor = +0.0089` — **inverted**. D ($122/ct) < G ($124/ct) < J ($128/ct).  
**Root cause**: 87% of round training data is D color; OLS fitted a spurious positive gradient from noise/confounding between color and other features (carat distribution, spec density).

**Fix applied in S25 v1.1**: `deltaColor = 0.0` (no color adjustment for extrapolation).  
**Rationale**: `specEps` already encodes within-spec D/E/F price differences for *observed* combinations. For *extrapolated* combinations (e.g., HEART D VS1, where only HEART F VVS2 exists in training), a zero gradient (D = E = F = G in extrapolation) is safer than an inverted one. In the lab diamond market, the D-vs-G premium is small enough (~3-5%) that neutral is acceptable.

After fix, color sweep is flat for extrapolated specs (no violations). Observed specs retain their correct D/E/F pricing through `specEps`.

**S22 and S23 color monotonicity**: Both models guarantee monotonicity via Layer-4 PAV projection (isotonic non-increasing sweep applied at predict time for clarity; color handled within LightGBM monotone constraints for S23).

### 5.3 Carat (S25 power law)

`betaGlobal = -0.1246`. Negative: $/ct slightly decreases with carat. This reflects 2025-2026 lab diamond market pricing where larger stones were disproportionately discounted.

```
Carat   Total $   $/ct   note
─────────────────────────────────────────────────────────
1.0ct    $123    $123/ct
2.0ct    $225    $113/ct   -8.5%
3.0ct    $321    $107/ct   -5.3%
5.0ct    $502    $100/ct   -6.5%
8.0ct    $757     $95/ct   -5.4%
10.0ct   $921     $92/ct   -3.3%
```

**Important**: The carat curve is estimated from rounds (0.3–5.06ct). Extrapolating to 10ct+ is uncertain; this is a structural limitation of parametric models fitted on narrow carat ranges.

---

## 6. Coverage Deep-Dive: The Large-Carat Problem

The original motivation for this work was a 5.21ct Heart D VS1 being priced at $96 (vs ~$1,400 correct).

### Current predictions for 5.21ct Heart D VS1:
| Model | Price | $/ct | Note |
|-------|-------|------|------|
| S20 (raw) | ~$96 | $18/ct | Bug: count=1 global lookup at $18.87/ct |
| S21 (fallback) | ~$1,371 | $263/ct | Lookup n=13, Level-A 5ct+ heart key |
| S22 (S20 + S21 fallback) | ~$1,371 | $263/ct | S21 correctly activated |
| S23 (+ S21 fallback) | ~$1,371 | $263/ct | S21 activated |
| S25 | $591 | $113/ct | Gradient-only (no heart D in training) |

**S21 is the most reliable here** because it has actual lookup data for 5ct+ hearts. S25's $591 comes from the global carat power-law extrapolation — it doesn't know that large specialty hearts command a significant premium over the formula baseline.

### Heart extrapolation comparison (S25 vs S21 lookup):
```
Carat    S25      S21 lookup   S25/S21 ratio
────────────────────────────────────────────
1ct      $139      $159         87%
2ct      $256      $276         93%
3ct      $365      $359        102%
4ct      $469      $770         61%
5ct      $570     $1,092        52%
5.21ct   $591     $1,410        42%
6ct      $669     $1,569        43%
```

S25 and S21 agree reasonably at 1-3ct. At 4ct+ S25 diverges significantly downward — it doesn't capture the specialty-heart large-stone premium. **S21 fallback remains the correct mechanism for large specialty stones.**

---

## 7. When to Use Each Model

| Scenario | Recommended model | Rationale |
|----------|-------------------|-----------|
| Common fancy shapes, 0.5–2ct (PEAR, OVAL, MARQUISE, RADIANT) | **S22** | 3-4% MAPE, dense lookup coverage |
| Step cuts (EMERALD, PRINCESS, ASSCHER) | **S23** | Monotone constraint prevents grade inversions |
| Round brilliants, any carat | **S25** or **S22** | S25 in-sample 7.77%; production uses S22 |
| Cushion / Heart | **S23** | Best MAPE, monotonicity guaranteed |
| Large-carat specialty (4ct+ fancy shapes) | **S21 fallback** | Real lookup data from 792-sample dataset |
| Completely out-of-range / novel specs | **S25** | Only model with guaranteed answer |
| UI audit / sanity check | **S25** | Always shows a principled parametric baseline |

**Current production architecture**: S22 as primary → S21 activated when S22 hits global → S23 shown as monotone candidate. S25 is shown as a third column for transparency.

---

## 8. Improvement Roadmap

### 8.1 S22 (ExtraTrees)

**Problem areas:**
- ROUND: 13.85% MAPE. The lookup-table approach creates step artifacts at carat bucket boundaries.
- ASSCHER: 9.70% MAPE from only 47 training stones; lookup tables are sparse.
- 6.1% of stones still hit global sentinel (786 of 12,843), even after S21 fallback.

**Improvement paths:**

1. **Expand training data**: The S20 training set is only 198 stones. Retraining with the full 12,843-row Segment-A dataset would dramatically reduce global hits and improve MAPE. Target: bring MAPE below 8%.

2. **Add carat as continuous feature**: Currently uses carat buckets (discrete). Adding `log(carat)` as a continuous numeric feature would smooth bucket boundaries and help extrapolation.

3. **Add L/W ratio for fancy shapes**: Pear ratio (1.4 vs 1.8) and oval ratio affect pricing by 5-15%. Currently ignored.

4. **Sub-shape splitting for RADIANT**: Elongated radiant and square radiant have different market pricing. A `is_square_radiant` binary feature (L/W ratio < 1.1) would let the model learn separate price curves.

### 8.2 S23 (LightGBM Monotone)

**Problem areas:**
- ROUND: 16.69% MAPE — highest of all three models on rounds. The grade-agnostic anchor is unnecessary for rounds (spec distribution is tight and normal).
- High S21 fallback rate: 3.3% vs S22's 1.4%. S23's anchor lookup is stricter.

**Improvement paths:**

1. **Separate round and fancy models**: S23's grade-agnostic anchor adds useful signal for fancy shapes but harms rounds. Train two separate S23 models — one for ROUND (pure LightGBM monotone, no anchor), one for fancy shapes.

2. **Smooth anchor transitions**: The current grade-agnostic anchor creates step changes when switching between anchor-present and anchor-absent predictions. A weighted blend (e.g., 70% anchor + 30% global baseline when anchor coverage is low) would smooth this.

3. **Add carat continuous features**: Same as S22 — bucket boundaries create artifacts.

4. **Tune monotone constraints separately by feature**: Currently all monotone constraints are applied uniformly. Color monotonicity in lab diamonds is weaker than clarity. Relaxing color constraints would let the model learn realistic flat-color pricing.

### 8.3 S25 (Hierarchical Parametric)

**Problem areas:**
- Fancy shapes: 10-20% MAPE because only 250-770 training stones per shape, and specEps intercepts are noisier than S22's lookup tables.
- Heart: only 13 training stones (all 1.01–1.35ct, 87% F color). True generalization for hearts is untested.
- Color gradient is undetermined (fixed to 0 in v1.1). No reliable color signal in lab diamond data.

**Improvement paths:**

1. **Shape-specific carat curves (β_shape)**: Currently uses a single `betaGlobal = -0.125` from rounds for all shapes. Fancy shapes at 1-2ct likely have different carat elasticity. With more training data (1,000+ per shape), fit per-shape betas.

2. **L/W ratio as a continuous feature**: Add `lwRatio` as a covariate in the power-law formula for non-round shapes: `log($/ct) = ... + gamma_lw × log(lwRatio)`. This captures the elongation premium for ovals and pears.

3. **Constrained color gradient**: Rather than forcing 0, retrain with an OLS constraint `deltaColor ≤ 0` (D must be ≥ G). Collect G/H/I/J color lab diamond data from StarGem to identify the true gradient; currently training has D/E/F only.

4. **Carat shrinkage for fancy shapes**: The carat curve is extrapolated beyond the training range (max 1.8ct for most fancy shapes). Apply increasing prediction intervals for out-of-range extrapolation, and show a warning in the UI when carat is >2× the max training carat for that shape.

5. **Hierarchical Bayesian fit**: Use partial pooling across shapes instead of independent per-shape baselines. This would help ASSCHER and HEART which have only 13-47 training stones borrow strength from ROUND and OVAL.

6. **Include cut grade properly**: `cutAdj` is hand-coded (EX: +5.25%, ID: -1.17%). Fit this from data instead — cut adjustment varies by shape (EX matters more for RADIANT than EMERALD).

### 8.4 Training Data Priorities

The single biggest lever across all three models is **more training data**:

| Shape | Current n | Target for reliable β | Priority |
|-------|-----------|----------------------|---------|
| HEART | 13 | 200+ | **P0** — only 1.01–1.35ct, all F color |
| ASSCHER | 47 | 200+ | P1 — sparse, wide MAPE |
| CUSHION | 137 | 300+ | P1 |
| EMERALD | 258 | 500+ | P2 |
| All shapes 3ct+ | ~12 | 100+ per shape | **P0** — critical for large-stone pricing |

---

## 9. Summary Decision Matrix

```
                    S22 (ExtraTrees)   S23 (LightGBM)   S25 (Parametric)
─────────────────────────────────────────────────────────────────────────
Best overall MAPE         ✗ 11.4%         ✗ 13.6%         ✓ 9.2%*
Fancy shapes (0.5-2ct)   ✓ ~3-4%         ~ 3-4%          ✗ 11-20%
Rounds (any carat)        ~ 13.9%         ✗ 16.7%         ✓ 7.8%*
Step cuts (EMERALD, PRNCS)~ 3.5%         ✓ 3.3%          ✗ 13-18%
Large carat (4ct+)        ✓ S21 fallback  ✓ S21 fallback  ✗ underestimates
Monotone clarity          ✓ (Layer-4 PAV) ✓ (LightGBM)   ✓ (by design)
Monotone color            ✓ (PAV)         ✓ (LightGBM)   ~ (0, neutral v1.1)
Coverage guarantee        ✗ 6.1% global   ✗ 1.6% global  ✓ 100%
Interpretable             ✗ black box     ✗ black box     ✓ formula
Novel spec extrapolation  ✗ global fallbk  ~ anchor       ✓ parametric

*In-sample numbers — optimistic vs true holdout MAPE
```

**Conclusion**: Run all three in parallel. Use S22 for production price card on fancy shapes. Use S23 as the monotone alternative (monotonicity is the primary product benefit). Display S25 as a transparency column. When S22/S23 hit global sentinel at 4ct+ specialty, S21 fallback is the right choice over S25 for specialty shapes.

---

*Generated by benchmark-all-models.mjs on 2026-05-30. Models: S22 = starsgem-ml-extra-trees-model-s20-specialty-tail.json, S23 = starsgem-ml-extra-trees-model-s23-grade-agnostic-anchor.json, S25 = starsgem-ml-model-s25-parametric.json (v1.1).*
