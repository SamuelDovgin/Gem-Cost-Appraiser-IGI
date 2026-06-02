# Latest White-Diamond ML Models — Comprehensive Evaluation Report

**Date:** 2026-06-02  
**Status:** Research evaluation (not a production release decision)  
**Dataset:** [`data/dataset-clean-training.json`](data/dataset-clean-training.json) — 21,982 Segment A white-diamond rows  
**Models evaluated:** S26 (lookup champion), S28 (monotone parametric), S29 (hybrid), S30 (bounded smooth median), S31 (guarded anchor over S28)  
**Machine-readable results:** [`data/benchmark-comprehensive-latest.json`](data/benchmark-comprehensive-latest.json)  
**Evaluation harness:** [`scripts/benchmark-comprehensive-latest.mjs`](scripts/benchmark-comprehensive-latest.mjs)

---

## Executive summary

We ran each latest model through **multiple holdout protocols** appropriate for wholesale inventory pricing (row holdout, cell holdout, support tiers, high-carat slices, leave-shape-out, and fair vs optimistic training for S30). End-to-end dollar MAPE vs actual `price` is the primary metric users experience.

**Production champion remains S26** (~5.4% MAPE on row holdout, best MdAPE). **S30 (fair train-only curves)** is the strongest research prototype on row holdout (**4.5%** MAPE where curves exist) but covers only **~97%** of holdout rows and is not a single global law.

**S31** improves on S28 by ~2.1pp on row holdout (**8.5%** vs **10.6%**) with full monotonicity on grid scans, but still trails S26 on dense cells.

**S29** is **not ready for Node-based benchmarking**: the embedded surface inside the S29 artifact does not match the standalone S28 scorer (see §5). Use Python cell-holdout metrics from [`data/benchmark-s29-vs-s26-s28.json`](data/benchmark-s29-vs-s26-s28.json) until parity is fixed.

**Recommended near-term architecture:** S26 for dense lookup cells → S30 where curves exist → S31/S28 for extrapolation → R0 reconcile + conformal bands (already in app).

---

## 1. Methodology

### 1.1 Why multiple splits?

Wholesale diamond sheets are **grouped inventory**: rows share `(shape_style, color, clarity, carat_band)` cells with multiple price modes (rate-card era, cut tier, specialty faceting). A single random row split underestimates leakage when the model memorizes cell medians.

| Protocol | Definition | What it measures |
|----------|------------|------------------|
| **Row holdout** | `reportHash(row) % 5 === 0` (~4,415 rows) | Same split as S28 Python trainer; row-level generalization |
| **S29 cell holdout** | `md5(cellKey) / 1000 < 0.2` (~5,225 rows) | Cold **benchmark cells** (shape × color × clarity × carat_band); no anchor training in that cell |
| **S29 cell train** | `md5(cellKey) / 1000 ≥ 0.2` (~16,757 rows) | Warm cells where S29 anchors/residual were fit |
| **S31 cell holdout** | `cellHash(benchmarkCellKey) % 5 === 0` (~3,626 rows) | Whole cells held out for S31 anchor training (see [`data/benchmark-s31-guarded-anchor.json`](data/benchmark-s31-guarded-anchor.json)) |
| **High carat** | Row holdout, `carat ≥ 5` | Tail / extrapolation behavior |
| **Sparse support** | Row holdout, `< 5` train rows in benchmark cell | Thin-data failure mode |
| **Leave-shape-out** | All rows per `shape_style` | OOD shape generalization (top 6 shapes by volume) |
| **Selected spec** | Predict without lw/table/depth | App inference mode (S28/S29 unchanged in this run) |
| **S30 fair vs shipped** | Curves from train-only vs all rows | Optimistic bias from holdout leakage in medians |

### 1.2 Metrics

- **MAPE** — mean absolute percentage error on total `price`
- **MdAPE** — median APE (robust to outliers)
- **p90 APE** — 90th percentile error (tail risk)
- **Bias %** — mean `(pred − actual) / actual × 100` (systematic over/under)

### 1.3 Model roles (short)

| Model | Family | Trains on data? |
|-------|--------|-----------------|
| **S26** | Lookup reconstruction from `starsgem-pricing-intelligence.json` | No |
| **S28** | Monotone parametric log($/ct) ridge surface | Yes (train rows only in artifact) |
| **S29** | S28 surface + EB cell offsets + cut-tier offsets + monotone LightGBM residual | Yes (cell holdout in trainer) |
| **S30** | Per-spec median → smooth → Catmull-Rom, clamped to observed range | Yes |
| **S31** | S28 + support-shrunk monotone-projected anchor grid | Yes (row + cell splits in trainer) |

### 1.4 How to reproduce

```bash
node research/scripts/benchmark-comprehensive-latest.mjs
node research/scripts/benchmark-s30.mjs
node research/scripts/test-s29-parity.mjs
python3 research/scripts/train-s29-hybrid.py      # refreshes benchmark-s29-vs-s26-s28.json
node research/scripts/train-s31-guarded-anchor.mjs  # refreshes benchmark-s31-guarded-anchor.json
```

---

## 2. Overall results — row holdout (n = 4,415)

Canonical ~20% row holdout (`reportHash % 5`). S30 uses **fair** curves rebuilt from train rows only unless noted.

| Model | MAPE | MdAPE | p90 APE | Bias % | n |
|-------|------|-------|---------|--------|---|
| **S30** (fair) | **4.54** | 1.70 | 11.40 | −0.02 | 4,264 |
| **S26** | 5.37 | 1.94 | 14.17 | −1.08 | 4,415 |
| **S31** | 8.49 | 6.04 | 18.80 | −0.97 | 4,415 |
| **S28** | 10.62 | 8.20 | 21.66 | +0.89 | 4,415 |
| **S29** (Node) | 22.88 | 14.51 | 31.25 | −8.54 | 4,415 |

**S30 shipped artifact** (trained on all rows, optimistic): MAPE **3.93%**, MdAPE **1.43%**, n = 4,323 — ~**0.6pp** better than fair on the same holdout.

**Row-holdout ranking (fair S30):** S30 → S26 → S31 → S28 → S29 (Node).

---

## 3. Results by split

### 3.1 S29 cold cells (cell holdout, n = 5,225)

Cells with `md5(cellKey)/1000 < 0.2`. S29 should behave like pure surface on these rows when gated correctly.

| Model | MAPE | MdAPE | p90 APE | Bias % |
|-------|------|-------|---------|--------|
| S26 | 5.21 | 2.01 | 13.98 | −1.09 |
| S28 | 11.18 | 9.10 | 23.64 | +1.32 |
| S31 | 8.36 | 5.73 | 18.72 | −1.75 |
| S30 (fair) | 4.61 | 1.76 | 12.32 | −0.80 |
| S29 (Node) | 21.24 | 12.33 | 34.58 | −7.06 |

**Python authoritative S29 cell holdout** ([`benchmark-s29-vs-s26-s28.json`](data/benchmark-s29-vs-s26-s28.json), trainer protocol):

| Model | MAPE | Notes |
|-------|------|-------|
| S26 | 5.23 | |
| S28 | 17.80 | |
| S29 | 17.80 | Equals S28 on held-out cells (by design) |

The gap between Python (**17.8%**) and Node cold-cell S28 (**11.2%**) vs Node S29 surface (**21.2%**) indicates **S29’s embedded surface ≠ live S28 artifact** — not a modeling conclusion.

### 3.2 S29 warm cells (cell train, n = 16,757)

| Model | MAPE | MdAPE | Bias % |
|-------|------|-------|--------|
| S26 | 5.56 | 1.94 | −1.06 |
| S28 | 10.35 | 8.00 | +0.90 |
| S31 | 8.50 | 6.07 | −0.72 |
| S30 (fair) | 4.03 | 1.34 | +0.31 |
| S29 (Node) | 16.53 | 15.27 | −15.64 |

**S29 dense in-cell (Python, support ≥ 20):** S29 **9.42%**, S26 **4.89%**, S28 **9.42%** (same tier breakdown in benchmark-s29 JSON).

### 3.3 High carat (row holdout, carat ≥ 5, n = 463)

| Model | MAPE | MdAPE | p90 APE |
|-------|------|-------|---------|
| S30 (fair) | **4.61** | 1.38 | 13.13 |
| S26 | 10.01 | 3.98 | 30.24 |
| S28 | 13.42 | 9.55 | 23.94 |
| S31 | 13.83 | 10.85 | 30.06 |
| S29 (Node) | 88.47 | 25.19 | 39.47 |

S30’s bounded endpoint extrapolation helps large stones; S29 Node is unusable on this slice until surface parity is fixed.

### 3.4 Sparse support (row holdout, &lt; 5 train rows/cell, n = 226)

| Model | MAPE | MdAPE | p90 APE |
|-------|------|-------|---------|
| S26 | **9.37** | 1.86 | 35.75 |
| S30 (fair) | 9.18 | 2.96 | 28.00 |
| S31 | 13.74 | 9.34 | 29.16 |
| S28 | 17.60 | 11.28 | 31.20 |
| S29 (Node) | 150.32 | 23.22 | 39.38 |

**S29 sparse tier (Python cell holdout):** MAPE **290%** on n = 147 — a few catastrophic errors; must cap residual/offset in production.

### 3.5 Leave-shape-out (full dataset per shape, fair S30)

| shape_style | n | S26 MAPE | S31 MAPE |
|-------------|---|----------|----------|
| round_standard | 9,810 | 4.79 | 7.77 |
| oval_standard | 3,331 | 3.30 | 5.39 |
| pear_standard | 1,905 | 3.21 | 6.50 |
| emerald_standard | 1,429 | 5.50 | 7.96 |
| princess_standard | 1,157 | **13.63** | **15.53** |
| marquise_standard | 1,030 | 3.75 | 9.47 |

Princess remains the hardest shape for both lookup and smooth layers.

### 3.6 S31 held-out cells (trainer benchmark, n = 3,626)

From [`benchmark-s31-guarded-anchor.json`](data/benchmark-s31-guarded-anchor.json):

| Model | MAPE | MdAPE |
|-------|------|-------|
| S26 | 5.31 | 2.73 |
| S28 | 9.62 | 7.08 |
| S31 | 9.89 | 6.82 |

S31 slightly trails S28 on this strict cell holdout but beats S28 on row holdout — anchor helps level, not yet cold-cell generalization.

### 3.7 S30 segments (row holdout)

From [`benchmark-s30.json`](data/benchmark-s30.json):

| Segment | n | S30 fair MAPE | S26 MAPE | Winner |
|---------|---|---------------|----------|--------|
| Has curve | 4,264 | 4.54 | 5.60 | S30 |
| Missing curve | 151 | — | 7.68 | S26 |
| Bounded extrap | 64 | 8.03 | 9.76 | S30 |

---

## 4. Per-model findings and improvement recommendations

### 4.1 S26 — Lookup champion

**Role today:** Production policy core; best MdAPE on dense sheet cells.

**Evidence:** Row holdout 5.37%; dense tier ~4.9% (Python S29 benchmark); wins most shapes except princess (~13.6% leave-shape-out).

**Recommendations:**

1. Keep as **interpolation anchor** in any hybrid stack.
2. Add **vintage / list-era** handling — older inventory caused +14–22% bias in unconstrained tree models (see [`model-comparison-s20-s21-s28-june2026.md`](model-comparison-s20-s21-s28-june2026.md)).
3. Shape-specific lookup tiers for **princess** and other high-MAPE styles.
4. Use existing **R0 conformal calibration** for intervals; MAPE alone hides tail risk (p90 ~14% on row holdout).

**External parallels:** Actuarial relativity tables + GLM; modern **EBM/NAM** with monotone shape functions ([insurance-gam](https://github.com/burning-cost/insurance-gam)).

---

### 4.2 S28 — Monotone parametric surface

**Role today:** Extrapolation law; right shape, weak level on commodity specs.

**Evidence:** Row holdout 10.62%; aligns with embedded Python holdout in artifact (~10.6%).

**Recommendations:**

1. **Level calibration** — multiplicative cell anchors (S31) or EB offsets (S29) with shrinkage.
2. Fix **grade × carat** interaction (documented E VS1 carat-ladder bug in consolidated report).
3. **Vintage hinges** tied to report/list metadata, not only magic-weight carat ramps.
4. Optional **EBM** with monotonic constraints on carat/color/clarity ([XGBoost](https://xgboost.readthedocs.io/en/latest/tutorials/monotonic.html), [sklearn HGBR](https://scikit-learn.org/stable/auto_examples/ensemble/plot_monotonic_constraints.html)) — expect MAPE vs monotonicity tradeoff (seen in S21).

**External parallels:** Log-linear 4C models ([jewelry manufacturing study](https://engj.org/index.php/ej/article/view/3320/897)); RF on 4C features ([Nature Sci Reports 2023](https://www.nature.com/articles/s41598-023-44326-w)).

---

### 4.3 S29 — Hybrid (surface + offsets + residual)

**Role today:** Research scaffold; **not release-ready**.

**Evidence (Python):**

- Cell holdout: **17.8%** MAPE (S29 = S28)
- Dense in-cell: **9.4%** vs S26 **4.9%**
- Sparse tier: **290%** MAPE
- Decision rules: **1/4** passed ([`benchmark-s29-vs-s26-s28.json`](data/benchmark-s29-vs-s26-s28.json))
- Node parity test: PASS for artifact structure; held-out cells force `surface_held_out`

**Blocking issue:** Node `predictS29` embedded surface ≠ `predictS28` on identical rows (cold cells: S28 11.2% vs S29 surface 21.2% MAPE). **Do not ship or benchmark S29 in Node until coefficients match S28 v0.4.**

**Recommendations:**

1. **Sync embedded surface** with `starsgem-ml-model-s28-monotone-parametric.json`.
2. **Zero residual** when support &lt; 5 or when anchor shrinks to pure surface.
3. **Mixture-of-experts** by support tier: lookup-led dense, surface-only sparse ([MoE pricing heterogeneity](https://www.anserpress.org/journal/jea/4/3/119)).
4. Gate on **cell holdout**, not row holdout only.
5. Keep deterministic **md5** cell hashing for reproducibility.

**Further reading:** [`S29-implementation-report.md`](S29-implementation-report.md), [`S29-implementation-audit.md`](S29-implementation-audit.md).

---

### 4.4 S30 — Bounded smooth median curves

**Role today:** Research prototype matching chart rolling medians.

**Evidence:** Best fair row-holdout MAPE (4.54%); beats S26 on has-curve segment; strong on high carat (4.61%).

**Limitations:**

- 174 curves; **~3%** of holdout rows lack a curve
- Per-spec; no cross-grade transfer
- Shipped artifact **overstates** accuracy by ~0.6pp vs train-only curves

**Recommendations:**

1. Always report **train-only curve** metrics in gates.
2. Fallback chain: **S30 → S31 → S26 → S28**.
3. Pool curves across related `shape_style` families.
4. Add **conformalized quantile bands** around the curve ([CQR overview](https://valeman.medium.com/conformalized-quantile-regression-smarter-uncertainty-prediction-for-data-scientists-6389bea7a7c4)).

**Further reading:** [`S30-bounded-smooth-median-prototype.md`](S30-bounded-smooth-median-prototype.md).

---

### 4.5 S31 — Guarded monotone anchor over S28

**Role today:** Research bridge between S28 level error and S26 accuracy.

**Evidence:** Row holdout 8.49% (−2.1pp vs S28); monotonicity grid **0** violations; held-out cell benchmark 9.89% vs S28 9.62%.

**Recommendations:**

1. Target **≤ 6%** MAPE on dense tier before production (currently ~8% vs S26 ~5%).
2. Optional small **capped residual** on warm cells only (S29-style).
3. Use as **smooth display layer**; keep S26 for billing on covered cells.

---

## 5. Known issues and data quality gates

| Issue | Impact | Action |
|-------|--------|--------|
| S29 Node surface ≠ S28 | Invalid Node MAPE for S29 | Re-export surface block from S28 trainer |
| S30 holdout leakage in shipped JSON | ~0.6pp optimistic MAPE | Use `buildS30Artifact(trainRows)` in gates |
| Multi-modal prices per cell | MAPE floor ~4–5% on dense cells | Era segmentation or mixture experts |
| Princess / specialty shapes | 13–16% MAPE | Shape-specific layers |
| S29 sparse tier explosions | 290% MAPE | Hard cap offsets + residual |

---

## 6. Literature and analogous solutions

| Domain pattern | Typical ML approach | Relevance |
|----------------|---------------------|-----------|
| Sheet / list pricing | Lookup + residual trees (S19–S20, S26) | Best in-sample fidelity |
| Smooth carat law | GAM, EBM, shape-constrained splines (S28, S30, S31) | Extrapolation + charts |
| 4C monotonicity | Constrained boosting, isotonic post-process (S21, S23) | Grade ladders safe; MAPE cost |
| Heterogeneous segments | Mixture of experts, random coefficient logit | Multi-modal wholesale cells |
| User-facing uncertainty | Split conformal, CQR | Extend R0 to ML layer |
| Classic retail 4C datasets | RF, XGB after heavy cleaning ([Nature 2023](https://www.nature.com/articles/s41598-023-44326-w)) | Less applicable than lookup-first |

**GAM / interpretable pricing toolkits:** [insurance-gam](https://github.com/burning-cost/insurance-gam) (EBM, NAM, PIN with monotone enforcement and relativity tables).

---

## 7. Recommended production architecture

```text
User query
  → S26 lookup (if dense cell hit)
  → else S30 curve (if spec group has fair-trained curve)
  → else S31 guarded anchor / S28 surface
  → R0 reconcileWholesale + conformal band
```

**Do not** replace S26 with S28/S29 alone on commodity ROUND cells. **Do** pilot S30 on explainer charts and dense specs where fair MAPE beats S26.

**Release gates (suggested):**

1. Row holdout MAPE ≤ S26 + 0.5pp **and** MdAPE ≤ S26 on dense tier  
2. Cell holdout MAPE ≤ S28 on cold cells (or within 1pp of S31)  
3. Zero monotonicity violations on standard ladders  
4. p90 APE not worse than S26 by &gt; 3pp  
5. Parity test PASS between trainer and Node scorer  

---

## 8. Related documents

| Document | Content |
|----------|---------|
| [`white-diamond-ml-pricing-research-report.md`](white-diamond-ml-pricing-research-report.md) | Full S7–S28 history and constraints |
| [`white-diamond-ml-pricing-improvement-plan.md`](white-diamond-ml-pricing-improvement-plan.md) | Implementation order for hybrid stack |
| [`S29-implementation-report.md`](S29-implementation-report.md) | S29 architecture and audit fixes |
| [`S30-bounded-smooth-median-prototype.md`](S30-bounded-smooth-median-prototype.md) | S30 design |
| [`data/benchmark-comprehensive-latest.json`](data/benchmark-comprehensive-latest.json) | Full numeric tables |
| [`data/benchmark-s29-vs-s26-s28.json`](data/benchmark-s29-vs-s26-s28.json) | Authoritative S29 Python benchmarks |
| [`data/benchmark-s30.json`](data/benchmark-s30.json) | S30 fair vs shipped segments |
| [`data/benchmark-s31-guarded-anchor.json`](data/benchmark-s31-guarded-anchor.json) | S31 cell holdout |
| [`S32-proposal.md`](S32-proposal.md) | S32-M: Leakage-Safe Credibility Anchored CatBoost over S28 (revised proposal) |

---

## 9. Literature review — similar problems, shared constraints, and best models

This section surveys the external evidence on pricing problems that share the structural constraints encountered in white-diamond wholesale inventory sheets. The goal is not an exhaustive academic survey but a **practitioner-oriented map** of which model families have proven effective under each constraint, and what the consensus says about multi-model fallback architectures like the one recommended in §7.

### 9.1 Domains with isomorphic constraints

Four pricing domains share the same structural pattern as wholesale diamond sheets: **tabular features with known monotone partial orderings, grouped inventory with sparse segments, multi-modal price distributions within the same product cell, and a requirement for auditable, non-black-box predictions.**

#### 9.1.1 Real estate automated valuation models (AVMs)

Real estate AVMs are the most thoroughly benchmarked analogue. Like diamond sheets, they operate on tabular data (bedrooms, bathrooms, sqft, location, year built) with a known **monotone partial order** — all else equal, more square footage should never decrease price. The literature consistently finds that **tree-based gradient boosting dominates neural networks** on this problem class.

**Key benchmarks:**

| Study | Dataset size | Best model | MAPE / MdAPE | Key finding |
|-------|-------------|------------|--------------|-------------|
| Jafary et al. (2024) — *Cities* | Land parcels, Melbourne | XGBoost | MAPE 13.9%, R² 0.862 | XGBoost beat DNN, RF, SVR |
| Stang et al. (2022) — *Z Immobilienökonomie* | 1.2M residential, Germany | XGBoost | Best overall accuracy | Struggles in data-sparse rural areas |
| Oust et al. (2025) — *J Real Estate Finance Econ* | 164,619 apartments, Oslo | XGBoost | MdAPE 5.24% | Stacked generalization only +0.07pp over XGBoost alone |
| Birkeland et al. (2021) — Oslo AVM | Oslo transactions | Stacked ensemble (XGB + RF + Bagging + Extra Trees) | — | XGBoost best individual; stacking marginal gain |
| Németh (2023) — U. Amsterdam | Amsterdam residential | XGBoost / RF | — | MLP and CNN performed significantly worse than tree models |

**Consensus:** XGBoost is the default best model for tabular pricing data at the scale of tens of thousands to low millions of rows. Deep neural networks **do not** beat gradient boosting on structured, heterogeneous feature spaces. Stacking multiple tree models yields marginal gains (~0.1pp) that rarely justify the operational complexity. The **main failure mode is data-sparse segments** — exactly the cold-start problem that motivates the S26 lookup → S30 curve → S31/S28 fallback chain.

The best Oslo AVM MdAPE (~5.2%) closely matches the S26 dense-tier MAPE (~4.9%) seen in this report, suggesting a natural **MAPE floor of 4–5%** for any model operating on cells with multiple price modes — the residual is irreducible heterogeneity, not model error.

#### 9.1.2 Insurance ratemaking and actuarial pricing

Insurance pricing shares three critical constraints with wholesale diamond inventory:

1. **Monotonicity by law** — premiums must be non-decreasing in risk factors (analogous to carat/color/clarity ladders for diamonds).
2. **Sparse segments** — thin cells with few claims (analogous to rare shape × grade combinations).
3. **Regulatory auditability** — every rate must be explainable (analogous to dealer-facing pricing transparency).

The actuarial literature has converged on a **GLM → GAM → EBM hierarchy**, where:

- **GLMs** (Generalized Linear Models) serve as the auditable baseline — analogous to S28's parametric log($/ct) surface.
- **GAMs** (Generalized Additive Models) add smooth univariate shape functions while preserving additivity — analogous to S30's per-spec carat curves.
- **EBMs** (Explainable Boosting Machines) extend GAMs with pairwise interactions and monotonicity enforcement, bridging the gap between pure GAMs and black-box gradient boosting.

The **insurance-gam** toolkit ([github.com/burning-cost/insurance-gam](https://github.com/burning-cost/insurance-gam)) implements exactly this stack — EBM, NAM (Neural Additive Models), and PIN (Proxy Interaction Networks) with monotone shape function enforcement and actuarial relativity tables. This is the closest open-source parallel to the S26 lookup + monotone surface architecture.

**Key insight from actuarial practice:** Credibility theory (Bühlmann-Straub, hierarchical Bayesian shrinkage) directly addresses the same sparse-cell problem seen in S29's 290% MAPE on low-support tiers. When a cell has few observations, the prediction should **shrink toward the broader-segment mean** rather than trusting the noisy cell-level estimate. This is precisely what S31's support-shrunk anchor grid does, and what S29's Empirical Bayes cell offsets attempt — but S29's sparse-tier explosions suggest its shrinkage is too weak.

#### 9.1.3 Diamond pricing — the academic ML literature

The academic diamond pricing literature has focused overwhelmingly on the classic Kaggle diamonds dataset (~54K retail listings with carat, cut, color, clarity, and dimensions). This dataset differs from wholesale inventory sheets in two critical ways: (a) it lacks the **grouped-cell inventory structure** (no repeated `shape × color × clarity × carat_band` cells with multiple price modes), and (b) it represents **retail asking prices**, not wholesale list prices.

**Benchmark consensus across major studies:**

| Study | Dataset | Models tested | Best model | R² / MAPE |
|-------|---------|---------------|------------|-----------|
| Basha & Oveis (2024) — *Int J Syst Assur Eng Manag* | 53,940 diamonds | 23 models | CatBoost, XGBoost | Best accuracy + speed |
| Kigo et al. (2023) — *Scientific Reports* | 53,940 diamonds | RF, XGB, MLP, KNN, SVR, Linear | Random Forest | R² 0.985, RMSE 523 |
| Xiao (2024) — *TCSISR* | 53,940 diamonds | RF, KNN, XGB, MLP | XGBoost | R² 0.982 |
| April et al. (2025) — *Springer* | Diamond Financial Index | BART, RF, XGB, LightGBM, GBM | BART | R² 0.981–0.984 |

**Critical caveat:** These R² values (0.98+) are **not comparable** to the 4–10% MAPE figures in this report. The Kaggle dataset has a single price per row, no grouped-cell structure, and no multi-modal distributions within cells. The high R² is driven almost entirely by carat weight (which alone explains ~85% of price variance in retail listings). In wholesale inventory, the challenge is not predicting price from carat — it is predicting the **correct price mode** within a carat band where legitimate prices can vary ±30% depending on cut tier, vintage, and market era.

**OpenFacet (2025)** is the closest external effort to the problem in this report. It uses a two-stage approach — **log-linear regression + low-rank residual correction (Alternating Least Squares)** — to reconstruct full price matrices per carat band from public retail listings, with monotonicity enforcement and daily updates. OpenFacet also models behavioral biases (anchoring at round carat weights, Veblen premiums for top-grade combos) that are analogous to the vintage/list-era and multi-modal price effects seen in Starsgem inventory sheets. Its design — a smooth parametric surface with residual correction — is architecturally similar to S28 + S29/S31 anchor offsets, though OpenFacet uses matrix factorization rather than gradient-boosted trees for the residual.

#### 9.1.4 Cold-start and sparse-segment pricing

The cold-start problem — predicting price for a product with few or no observations — appears across e-commerce, wholesale, and B2B pricing. The 2024 paper *"Forecast Model of the Price of a Product with a Cold Start"* (Örebro University, Springer) identifies the same structural pattern: **hierarchical shrinkage toward category-level priors** is the dominant solution.

In practice, sparse-segment pricing converges on one of three strategies:

| Strategy | Example | When it works | Failure mode |
|----------|---------|---------------|--------------|
| **Hierarchical shrinkage** | S31 anchor grid, EB offsets | ≥ 3–5 obs per cell | S29's 290% MAPE when shrinkage too weak |
| **Lookup fallback** | S26 on dense cells → S28 on sparse | Reliable lookup table exists | 151 rows (~3%) lack curve in S30 |
| **Pure parametric extrapolation** | S28 monotone surface | No lookup exists | 10.6% MAPE on row holdout (2× S26) |

The evidence from this report and the external literature converges on the same conclusion: **no single model handles all support tiers well.** The optimal architecture is a support-aware mixture — which is exactly the §7 fallback chain (S26 → S30 → S31/S28).

### 9.2 Constraint-by-constraint model ranking

Rather than asking "which model is best overall," the evidence supports asking "which model is best under each binding constraint." The table below synthesizes findings from real estate AVMs, insurance ratemaking, diamond pricing literature, and this report's internal benchmarks.

#### 9.2.1 Monotonicity

**Constraint:** Price must be non-decreasing in carat, color grade, and clarity grade. Violations are unacceptable for dealer trust and regulatory compliance.

| Approach | Monotonicity guarantee | MAPE cost vs unconstrained | Best for |
|----------|----------------------|---------------------------|----------|
| **Parametric log-linear surface** (S28) | By construction (ridge coefficients on monotone spline basis) | Baseline (10.6% row holdout) | Extrapolation, audit |
| **Isotonic post-processing** (S21, S23 constrained boosting) | Enforced after training | +1–3pp vs unconstrained | When base model is good |
| **XGBoost/LightGBM monotone constraints** (`monotone_constraints` param) | Built into split finding | +0.5–2pp vs unconstrained | Dense cells with enough data |
| **EBM with monotone shape functions** | Per-feature shape constraints | +0.3–1pp vs unconstrained GBM | Insurance-grade auditability |
| **Unconstrained RF/GBM** | None | Best raw MAPE | Research; not production-safe |

**Recommendation from the literature:** EBM with monotone shape functions is the gold standard when interpretability and monotonicity are both hard requirements. For diamond sheets, S28's parametric surface already provides the monotone backbone; the constrained-boosting literature suggests that adding a small monotone-constrained LightGBM residual on warm cells only (S29-style but gated) could recover some of the 5pp gap between S28 (10.6%) and S26 (5.4%).

#### 9.2.2 Sparse segments and cold start

**Constraint:** Cells with < 5 training rows produce catastrophic errors (S29 sparse tier: 290% MAPE). The model must degrade gracefully as support thins.

| Approach | Sparse-tier MAPE | Coverage | Best for |
|----------|-----------------|----------|----------|
| **Lookup table on dense cells** (S26) | 9.4% (n=226, row holdout) | ~95% of rows | Interpolation anchor |
| **Per-spec median curves** (S30) | 9.2% (n=226) | ~97% of rows | Chart display, has-curve specs |
| **Support-shrunk anchor** (S31) | 13.7% (n=226) | 100% of rows | Full-coverage fallback |
| **Pure parametric surface** (S28) | 17.6% (n=226) | 100% of rows | Last-resort extrapolation |
| **Uncapped residual model** (S29) | 290% (n=147, Python) | — | Do not use on sparse cells |

**Recommendation from the literature:** Hierarchical Bayesian shrinkage (credibility theory) is the principled solution. The S31 anchor grid is a pragmatic approximation. The fallback chain in §7 already implements the right ordering — lookup-first on dense cells, curve-based on medium-support specs, parametric surface as the universal floor.

#### 9.2.3 Multi-modal price distributions within cells

**Constraint:** A single `shape × color × clarity × carat_band` cell can contain prices that vary ±30% due to unobserved factors (cut tier, vintage, rate-card era, specialty faceting). A model that predicts the cell mean will have a MAPE floor equal to the within-cell coefficient of variation.

| Approach | Handles multi-modality? | MAPE floor |
|----------|------------------------|------------|
| **Cell median/lookup** (S26) | No — predicts single value per cell | ~5% (irreducible within-cell variance) |
| **Per-spec carat curve** (S30) | No — smooths through medians | ~4.5% |
| **Residual model on observables** (S29) | Partially — LightGBM can split on cut/lw/table | ~9.4% on dense cells (worse than S26!) |
| **Mixture of experts / latent class** | Yes — fits separate pricing functions per latent segment | Unknown; not yet prototyped |
| **Era/mode segmentation** | Yes — cluster cells by price mode, fit per-mode model | Unknown; requires vintage metadata |

**This is the hardest unsolved problem.** The evidence from both the external AVM literature and this report's benchmarks suggests that **within-cell multi-modality sets a MAPE floor of ~4–5%** that no single-point model can break without access to the latent variables (cut tier, vintage, list era) that generate the multiple modes.

The real estate AVM literature faces the same issue — two identical apartments in the same building can sell for different prices due to unobserved quality differences. The solution there is **conformal prediction intervals** (producing a range rather than a point estimate), which this project already implements via R0 conformal bands. The 2024 conformal prediction literature (option pricing, electricity markets, CAT bonds) confirms that distribution-free conformal intervals provide valid coverage even under multi-modal conditional distributions.

#### 9.2.4 Interpretability and audit

**Constraint:** Dealer-facing prices must be explainable. A black-box prediction that undercuts a dealer's expectation by 15% without explanation erodes trust.

| Approach | Interpretability | Best for |
|----------|-----------------|----------|
| **Lookup table** (S26) | Full — every prediction is traceable to cell statistics | Billing, disputes |
| **Parametric surface** (S28) | Full — log($/ct) = Σ βᵢ · basis(carat, color, clarity) | Chart display, extrapolation rationale |
| **GAM / EBM** | Per-feature shape function plots | Actuarial sign-off |
| **XGBoost + SHAP** | Post-hoc feature attribution | Internal diagnostics |
| **Deep neural network** | None without surrogate model | Not recommended for production pricing |

**Recommendation:** The current architecture (S26 for billing → S30/S28 for display → R0 for intervals) already provides tiered interpretability. EBM would add per-feature shape function plots that are directly auditable by domain experts, but the incremental benefit over S28's already-parametric surface is modest.

### 9.3 What the external evidence says about the multi-model fallback architecture

The recommended architecture in §7 — **S26 (dense lookup) → S30 (curve) → S31/S28 (parametric extrapolation) → R0 (reconcile + conformal)** — is an instance of a broader pattern that the literature calls **mixture of experts by support tier**. This pattern appears across domains:

| Domain | Dense tier | Medium tier | Sparse tier |
|--------|-----------|-------------|-------------|
| **This project** | S26 lookup | S30 curves | S31/S28 surface |
| **Insurance** | GLM with full credibility | Bühlmann-Straub shrinkage | Manual rate (domain expert) |
| **Real estate AVMs** | XGBoost | Comparable sales | Tax assessment baseline |
| **E-commerce pricing** | Gradient boosting on history | Category-level median | Cost-plus floor |
| **OpenFacet (diamonds)** | Log-linear fit | ALS residual correction | Monotonicity-projected extrapolation |

The consistent pattern is: **specialized models for different data regimes, with a universal fallback that is simple enough to never be catastrophically wrong.** This is the opposite of the "one model to rule them all" approach that dominates Kaggle-style ML competitions — and the evidence from both this report and the external literature strongly supports the multi-model design.

**Three principles from the literature that validate the current architecture:**

1. **Don't let the best model block the safest model.** S26 has worse MAPE than S30 on has-curve rows (5.6% vs 4.5%) but is the safer choice on dense cells where it has been validated over years of production use. The real estate AVM literature makes the same point — XGBoost outperforms comparable-sales in aggregate but can produce wildly wrong predictions on outlier properties, so hybrid systems gate XGBoost predictions against a comparable-sales sanity check.

2. **The fallback must be monotone and bounded.** S28's parametric surface has higher MAPE (10.6%) than any other model on dense cells, but it extrapolates safely — no negative prices, no non-monotone grade ladders. The electricity price forecasting literature (2024 conformal prediction papers) makes the same argument: when the base model is uncertain, fall back to a simple, shape-constrained model rather than a complex one with unknown extrapolation behavior.

3. **Report train-only metrics; shipped artifacts are always optimistic.** The S30 "shipped" artifact scores 3.93% MAPE vs 4.54% for fair (train-only) curves — a 0.6pp gap from holdout leakage. This is a well-known phenomenon in the AVM literature: any model that uses holdout data in preprocessing (e.g., computing per-spec medians across all rows) will overstate its accuracy. The 2024 conformal prediction literature emphasizes that **all preprocessing must be fit on train rows only** for valid holdout evaluation — exactly the "fair" protocol used in this report.

### 9.4 What model families are worth prototyping next

Based on the external evidence, four model families are worth evaluating against the S26/S30/S31 baseline:

| Priority | Model family | Rationale | Expected gain |
|----------|-------------|-----------|---------------|
| **High** | EBM (Explainable Boosting Machine) with monotone shape functions | Combines S28's monotonicity with S26's fidelity; per-feature audit trails; used in production insurance pricing at scale | Could close 40–60% of the S28→S26 gap on dense cells while preserving monotonicity |
| **High** | CatBoost with `monotone_constraints` on carat/color/clarity and `cat_features` for shape_style/cut | Basha & Oveis (2024) found CatBoost beat XGBoost on diamond data; built-in categorical handling removes need for one-hot encoding of ~200 cut tiers | Could match or beat S26 on dense cells with monotonicity guarantees |
| **Medium** | BART (Bayesian Additive Regression Trees) | April et al. (2025) found BART (R² 0.981–0.984) beat RF/XGB/LightGBM on diamond pricing; provides full posterior uncertainty | Uncertainty estimates could replace/reinforce conformal bands |
| **Medium** | Hierarchical Bayesian shrinkage (full credibility model) | Principled solution to the sparse-cell problem; would replace the heuristic support thresholds in S29/S31 | Expected to eliminate S29's 290% sparse-tier MAPE |
| **Low** | Deep neural network (MLP / TabNet / FT-Transformer) | Németh (2023) and Jafary et al. (2024) both found DNNs underperform tree-based models on tabular pricing data; no monotonicity guarantees; poor extrapolation | Unlikely to beat S26 on dense cells; likely worse on sparse cells |

**CatBoost with monotone constraints** is the single most promising next experiment. It is the only model that simultaneously offers: (a) top-tier accuracy on diamond pricing benchmarks (Basha & Oveis 2024), (b) built-in monotonicity enforcement for carat/color/clarity ladders, (c) native categorical feature support for the ~200 shape × cut × grade combinations, and (d) GPU-accelerated training. The main risk is that CatBoost, like all tree-based models, may extrapolate poorly on carat values outside the training range — which is why S28's parametric surface must remain the sparse-tier fallback regardless.

**Update (2026-06-02):** This recommendation has been formalized as the **S32-M proposal** — see [`S32-proposal.md`](S32-proposal.md) for the full architecture, training protocol, release gates, and phased implementation plan (S32-A → S32-B → S32-C → S32-D). The proposal incorporates cross-fitted hierarchical credibility anchors, a capped CatBoost residual on warm cells only, and PAV lattice projection at artifact build time. Key external verifications for the proposal are documented in §10 below.

### 9.5 Key open questions

The external literature does not resolve several questions that are specific to wholesale diamond inventory sheets:

1. **Can latent-mode clustering (cut tier, vintage, list era) be inferred from price residuals alone?** If a cell has a bimodal price distribution, can we recover the two latent price modes without labeled vintage/era metadata? The insurance literature on latent class modeling and the OpenFacet behavioral-bias corrections suggest this is feasible but unvalidated on wholesale data.

2. **What is the true irreducible MAPE floor for this problem?** S26 achieves ~5% MAPE on dense cells; S30 achieves ~4.5% where curves exist. The within-cell coefficient of variation (std/mean) for dense cells sets a theoretical floor — if within-cell CV is ~8–10%, then no point-prediction model can go below ~4–5% MAPE without access to the latent mode variables.

3. **Does monotonicity enforcement cost more accuracy on wholesale sheets than on retail datasets?** The constrained boosting literature consistently reports a ~0.5–2pp accuracy cost for monotonicity constraints. But those studies are on datasets without multi-modal cells. The cost may be higher (or lower) when the target distribution within each cell is multi-modal — this is an empirical question that only a direct A/B test can answer.

4. **Can conformal prediction intervals be made conditional on support tier?** The 2024 conformal prediction literature (Mondrian conformal prediction, decision-focused CP) shows that coverage can be conditioned on discrete strata. If conformal bands were wider on sparse cells and tighter on dense cells, the user-facing uncertainty display would be more informative than uniform-width bands.

---

## 10. S32-M proposal — key findings from external verification

The S32-M architecture (leakage-safe credibility anchored CatBoost over S28) was audited against external sources to verify its modeling claims. This section documents the findings. Full proposal at [`S32-proposal.md`](S32-proposal.md).

### 10.1 CatBoost monotone_constraints — sign direction confirmed

The original S32 proposal used `color_rank` (D=0, E=1, …, M=12) and `clarity_rank` (IF=0, VVS1=1, …, I3=11) with `monotone_constraints = [+1, +1, +1]`. **This was backwards.** CatBoost official documentation ([catboost.ai](https://catboost.ai/en/docs/references/training-parameters/common#monotone_constraints)) states:

- **+1** = non-decreasing constraint: "forces the model to be a non-decreasing function of this feature"
- **-1** = non-increasing constraint: "forces the model to be a non-increasing function of this feature"

If higher numeric rank means worse grade, a +1 constraint tells the model that worse color/clarity should **increase** price — the opposite of the intended behavior.

**Correction:** Use `color_goodness = max_color_rank - color_rank` and `clarity_goodness = max_clarity_rank - clarity_rank` (higher = better → +1 constraint is correct), OR keep ranks with `monotone_constraints = [+1, -1, -1]`.

### 10.2 Bühlmann-Straub credibility formula — confirmed

The proposal's credibility weight `w = n / (n + K)` is the classic Bühlmann-Straub credibility formula from actuarial science. This was confirmed against the open textbook *Loss Data Analytics* (Chapter 12, "Experience Rating Using Credibility Theory") and Bühlmann & Gisler (2005).

**Key properties:**
- Large n → Z → 1 (more data → trust individual experience)
- Small n → Z → 0 (little data → shrink toward collective mean)
- K = EPV/VHM (Expected Value of Process Variance / Variance of Hypothetical Means)

This is the actuarial gold standard for handling sparse segments — exactly the problem that caused S29's 290% MAPE on low-support cells.

### 10.3 CatBoost categorical features — do not one-hot encode

CatBoost official parameter tuning documentation explicitly warns: *"Do not use one-hot encoding during preprocessing. This affects both the training speed and the resulting quality."*

This validates S29's architectural weakness: LightGBM with one-hot-encoded categoricals for ~200 cut grades created a sparse, high-dimensional feature space. CatBoost's built-in ordered target statistics provide a leakage-safe, efficient alternative.

### 10.4 CatBoost ordered boosting — leakage prevention confirmed

Prokhorenkova et al. (2018, NeurIPS) — *"CatBoost: unbiased boosting with categorical features"* — formally proves (Theorem 1) that standard gradient boosting suffers from prediction shift due to using the same data for gradient computation and model updates. CatBoost's ordered boosting eliminates this via permutation-driven training.

The S32-M proposal extends this principle to anchor computation: cross-fitted OOF anchors prevent cell-level information from leaking into the residual target, using the same permutation-based logic.

### 10.5 CatBoost diamond benchmark — Basha & Oveis (2024)

**Paper:** *"Predictive modeling and benchmarking for diamond price estimation: integrating classification, regression, hyperparameter tuning and execution time analysis"*, Int J Syst Assur Eng Manag, 15(11), 5279–5313 (November 2024).

**Key findings:**
- 23 models benchmarked on diamond pricing data
- CatBoost Regressor achieved R² of 0.9872 with training/testing accuracies of 98.74%/98.72%
- CatBoost and XGBoost maintained high accuracy after hyperparameter tuning
- For classification tasks, CatBoost Classifier and LightGBM Classifier achieved best accuracy and efficiency

**Caveat:** This study uses the Kaggle retail diamonds dataset (~54K single-price listings), not wholesale inventory sheets with grouped-cell structure. The R² values (0.98+) are not comparable to the 4–10% MAPE figures in this report — carat alone explains ~85% of price variance in retail listings.

### 10.6 CatBoost Node.js deployment — feasible but not automatic

CatBoost provides an official npm package (`catboost`) that loads native `.cbm` models via the C++ `libcatboostmodel` library. JSON export is supported via `model.save_model("model.json", format="json")`. See [catboost.ai/en/docs/concepts/apply-node-js](https://catboost.ai/en/docs/concepts/apply-node-js).

**Parity is feasible but must be verified.** The S32-M proposal requires a frozen 1,000-row fixture with max absolute log prediction diff < 1e-6 between Python and Node.

### 10.7 S32-M architecture summary (v3 — second review)

```text
log($/ct)_S32M =
    log($/ct)_S28                                                     (S28 surface: always on)
  + clip(w_anchor * Δ_L, -A_cap, +A_cap)                             (credibility anchor, level-capped)
  + w_resid * clip(CatBoost_residual, -R_cap, +R_cap)                (capped residual, warm cells only)

where:
  L = deepest anchor level with n_L > 0
  Δ_L = median_oof(log(actual/S28)) at level L (cross-fitted, computed directly
        from row residuals — NOT from unweighted child cell medians)
  w_anchor = min(level_cap[L], n_L / (n_L + K_anchor[L]))
  level_cap[L]: 1.00 (full cell) → 0.70 → 0.45 → 0.25 → 0.10 (global)
  w_resid = 0 if n_full < r_min, else n_full / (n_full + K_resid)
  log_carat monotone constraint: 0 (do NOT force $/ct monotone in carat;
    total price monotonicity enforced via PAV lattice, not residual model)
```

**Key differences from S29/S31 (v3 additions in bold):**
- Cross-fitted OOF anchors (no cell-level leakage into residual)
- Separate anchor and residual weights (independent gates)
- Hierarchical anchor fallback (5 levels, not just full-cell or nothing)
- **Level caps on anchor weights** — prevents global level (22K rows) from getting ~1.0 weight even with K=50
- **Parent anchors computed directly from rows**, not from unweighted child medians (prevents 1-row cells from overweighting parent medians)
- Capped residuals (hard bounds prevent catastrophic errors)
- Cell-holdout tuning (not row-holdout — the lesson from S31)
- Corrected monotone sign (goodness scores with +1 constraints)
- **log_carat constraint = 0** — lab-grown commodity $/ct can be higher at 1ct than 3ct
- r_min ≥ 10 (not 5 — S29's sparse failures show learned residuals are much riskier than median anchors)
- **PAV lattice with post-interpolation edge scan** — independent carat/color/clarity PAV can break one ladder while fixing another

**Phased implementation (hardened S32-A gate):**
- **S32-A: S28 + leakage-safe hierarchical credibility anchors only** ← **THE REAL EXPERIMENT.** Do not train CatBoost until S32-A passes: cell holdout ≤ S28, row holdout ≤ S31, sparse p90 OK, zero monotonicity violations, Princess not worse.
- S32-B: add capped CatBoost residual on warm cells only ← **ONLY IF S32-A PASSES.** If S32-A fails, CatBoost probably just hides the failure on row holdout.
- S32-C: add PAV/projected lattice + post-interpolation edge scan
- S32-D: Node parity + release gates

**Release gates (8 total, v4):**
1. Dense row holdout: MAPE ≤ S26 + 0.5pp and MdAPE ≤ S26 + 0.5pp
2. Strict cell holdout: MAPE ≤ S28 (not merely ≤ S31)
3. Monotonicity: **Post-PAV zero violations required (mandatory). Pre-PAV violations are diagnostic** — report count and magnitude. If pre-PAV → post-PAV MAPE gap > 0.5pp, fail or investigate. The lattice exists to correct minor violations; raw model violations that PAV fixes cheaply are not a blocker.
4. Sparse support (<5): p90 APE not worse than S26/S30 by >3pp
5. High carat (≥5ct): p90 APE not worse than S26; MAPE ≤ 8–9%; also compare against S30 fair (4.61% MAPE)
6. Princess: **S32-A warning gate** (not worse than S31, 15.53%). **S32-D hard gate** (not worse than S26, 13.63%, or route to S26/S30 fallback). Anchors alone can't be expected to solve the hardest shape.
7. Python-Node parity: max |Δ log pred| < 1e-6 on 1,000-row fixture
8. Pinned cases P1–P5 all pass

**Slice-specific fallback overrides:** If S32-M fails a slice gate but wins globally, route that slice to the incumbent: dense → S26, high-carat has-curve → S30, cold/sparse → S28, princess → S26/shape-specific. Makes release decisions less all-or-nothing and enables progressive rollout.

**Target convention:** Training target = `log($/ct)`. Evaluation target = `total price = exp(log($/ct)_pred) × carat`. All MAPE/MdAPE/p90 figures are on total price.

**Adjusted performance projections (first pass):**

| Slice | S26 | S28 | S30 fair | S31 | S32-M (adj.) |
|-------|-----|-----|----------|-----|--------------|
| Row holdout | 5.37% | 10.62% | 4.54%¹ | 8.49% | 6.5–8.0% |
| Cell holdout (strict) | 5.31% | 9.62% | — | 9.89% | 9.0–10.5% |
| High carat (≥5ct) | 10.01% | 13.42% | **4.61%** | 13.83% | 7.0–11.0% |
| Sparse (<5) | 9.37% | 17.60% | 9.18% | 13.74% | 10.0–16.0% |
| Princess | 13.63% | — | — | 15.53% | 12.0–15.0% |

¹ S30 coverage-limited to ~97% of rows.

**Positioning:** S32-M is a **candidate unified smooth/extrapolating display model** that may eventually replace parts of the S26/S30/S31 fallback stack if it clears strict cell-holdout and sparse-tier gates. It is **not** positioned as a likely near-term replacement for S26.

---


*Report generated from automated benchmarks on 2026-06-02. Re-run `benchmark-comprehensive-latest.mjs` after model or dataset changes.*
