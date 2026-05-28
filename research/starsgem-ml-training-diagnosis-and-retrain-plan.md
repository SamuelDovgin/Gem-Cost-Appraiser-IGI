# StarGem ML Training Diagnosis and Retrain Plan

## Case That Exposed The Problem

User-facing stone:

| Field | Value |
|---|---|
| Carat | 3.00 |
| Shape | ROUND |
| Color | E |
| Clarity | VS1 |
| Cut selected in app | Ideal, mapped to `ID` for StarGem |
| Growth method | unknown in app, mapped to `-` |
| Measurements | missing until IGI report parses |

Current browser ML card:

| Artifact | Trees used | Predicted rate | Predicted price |
|---|---:|---:|---:|
| `starsgem-ml-extra-trees-model-10-trees.json` | 10 | $159.31/ct | $477.93 |
| `starsgem-ml-extra-trees-model-20-trees.json` | 20 | $161.50/ct | $484.50 |
| `starsgem-ml-extra-trees-model-30-trees.json` | 30 | $155.18/ct | $465.53 |
| `starsgem-ml-extra-trees-model-50-trees.json` | 50 | $154.81/ct | $464.42 |
| `starsgem-ml-extra-trees-model.json` | 200 | $126.24/ct | $378.72 |

Direct StarGem sheet evidence for the same dense group:

| Slice | Count | Median rate |
|---|---:|---:|
| `3.00-3.99 ROUND E VS1` | 241 | $108.81/ct |
| `3.00-3.99 ROUND E VS1 ID` | 223 | $108.81/ct |
| `3.00-3.99 ROUND E VS1 EX` | 18 | $165.57/ct |
| `2.98-3.02 ROUND E VS1` | 138 | $108.81/ct |

So the suspicious card is not a comp issue. The raw ML path is overestimating a dense, mostly low-priced ID segment by acting too much like the smaller high-priced EX slice.

## Why This Happens At The ML Training Level

### 1. The deployed browser artifact is not the current best full model

`index.html` fetches:

```text
research/data/starsgem-ml-extra-trees-model-10-trees.json?v=20260524-optimized
```

That artifact says `S7 - Full combo` and contains only 10 serialized trees, although its `treeCount` metadata still says 200. The checked-in full model, `starsgem-ml-extra-trees-model.json`, is `S18 - Temporal cutoff, shallower trees` with 200 trees and predicts about $379 for this same stone instead of $478.

This means the browser card is currently showing a compact, stale S7 slice rather than the best trained S18 artifact.

### 2. The compact tree slice is biased for this specific cell

For the 10-tree deployed artifact, the leaf rates for this input are:

```text
169.82, 169.82, 169.82, 169.82, 169.82, 110.15, 169.82, 169.82, 169.82, 138.18
```

That averages to a high EX-like prediction. The full S18 model's 200 trees are more stable:

```text
median leaf rate: $124.04/ct
46 trees <= $120/ct
153 trees between $120 and $145/ct
1 tree between $145 and $175/ct
0 trees > $175/ct
```

If we need a compact browser model, it should not be "first N trees from a larger ensemble." We need either a representative tree subset or a smaller model trained/distilled directly for browser use.

### 3. `TypeName = "-"` is an out-of-distribution inference state

In the sheet, the 3ct ROUND E VS1 rows are all CVD in the inspected slice. In the app, before IGI parsing or explicit CVD/HPHT selection, the model row uses:

```text
TypeName = "-"
```

That is not equivalent to "unknown but probably CVD"; it is a categorical value. A tree model can split on it as if it were a real supplier segment. The lookup feature falls back to the broader `carat_bucket + Shape + Color + Clarity` level and correctly gives about $108.81/ct, but the tree ensemble is free to ignore or underweight that signal.

Training needs missingness augmentation: randomly mask known growth method to `-` during training so the model learns what inference-time unknown growth should mean.

### 4. Missing dimensions are also an inference-time distribution shift

The app tells the user "dimensions are imputed until an IGI report is loaded." In training, many rows have measurement, table, and depth data. For an unloaded report, the model sees median-imputed dimensions, which can move a stone into leaves that do not represent the real local spec.

This is especially risky for fancy shapes, but it also matters for round stones because table/depth and diameter-derived features are in S7.

Training needs feature dropout for:

- `Length`
- `Width`
- `Height`
- `LengthWidthRatio`
- `Table_Scale`
- `Depth_Scale`

Then validate two modes separately:

- cert-loaded mode
- selected-spec-only mode

### 5. Cut taxonomy is carrying two different meanings

The app maps `cut = ideal` to StarGem `ID`. The sheet has both `ID` and `EX`, and for this dense group:

```text
ID median: $108.81/ct, n=223
EX median: $165.57/ct, n=18
```

That is a huge segment split. A model that only one-hot encodes `Cut` can still confuse nearby high-price EX leaves with the ID majority when other features are missing or masked.

We need to separate:

- IGI cut grade shown to users (`Ideal`, `Excellent`, etc.)
- supplier sheet cut code (`ID`, `EX`, `VG`, Chinese specialty cut labels)
- app-derived cut fallback when the report has not been parsed

### 6. The current validation score hides this user-facing failure mode

The S7 artifact reports:

```text
count: 792
MAPE: 4.8878%
MAE: $61.49
R2: 0.955
```

That is a balanced validation score, not a guarantee that dense commodity cells are locally calibrated. This case is common and well-supported, but the deployed model misses it by about $150 because the validation suite does not include explicit user-facing smoke cases like "3ct ROUND E VS1 selected-spec-only."

## What We Should Train Next

### Goal

Keep the UI's raw ML estimate. Do not replace it with lookup output. Instead, train a model whose raw ML prediction is locally calibrated to dense StarGem cells and robust to unloaded IGI reports.

Target for this case:

```text
3.00ct ROUND E VS1 selected-spec-only ML estimate: $320-$380
```

Target global metrics:

| Metric | Acceptance target |
|---|---:|
| Balanced MAPE | <= current S18 |
| Dense commodity cell MdAPE | <= 5% |
| Selected-spec-only MAPE | separately reported |
| Cert-loaded MAPE | separately reported |
| Browser compact drift vs full model | <= 2% median, <= 8% P95 |

### Strategy A - Train the selected-spec model as a first-class mode

Create two training views from the same StarGem rows:

1. `cert_loaded_view`: all available dimensions, table, depth, growth method.
2. `selected_spec_view`: mask dimensions and randomly mask growth method/cut at rates matching the UI before IGI lookup succeeds.

Train either:

- one model with missingness flags, or
- two models: `starsgem-ml-selected-spec` and `starsgem-ml-cert-loaded`.

Recommended first pass: one model with flags, because the browser path is simpler.

New numeric flags:

```python
Has_Dimensions
Has_TableDepth
Has_GrowthMethod
Has_Report_Cut
Is_SelectedSpec_Mode
```

### Strategy B - Predict residual multiplier around the coarse StarGem rate

Do not use fine 0.01ct lookup as the target baseline; prior experiments showed that was too sparse and noisy. Use the coarse, regularized lookup level that works well here:

```text
carat_bucket + Shape + Color + Clarity [+ TypeName/Cut when support is strong]
```

Train the target as:

```text
log(actual_usd_per_ct / coarse_lookup_usd_per_ct)
```

Browser prediction:

```text
ml_rate = coarse_lookup_usd_per_ct * exp(predicted_log_multiplier)
price = carat * ml_rate
```

This is still an ML estimate. It just forces the model to learn "how much above or below the local StarGem surface" rather than relearning the entire price surface from scratch. For dense cells like ROUND E VS1, the natural prediction should stay close to 1.0x unless dimensions/cut/growth provide strong evidence.

Add shrinkage:

```text
if lookup support >= 50 and selected-spec-only:
  clamp training residual target influence or regularize predictions toward 1.0x
```

Do not hard-code this as a UI override. Make it part of the model family and validate it.

### Strategy C - Fix compact browser export

The current optimized artifacts are likely first-N-tree slices. For this case:

```text
10 trees: $478
50 trees: $464
full S18: $379
sheet median: $326
```

Export options:

1. Prefer full S18 if browser load time is acceptable.
2. Train a smaller forest directly, such as 32-64 trees with constrained depth.
3. Distill the 200-tree model into a compact model by fitting against full-model predictions plus actual prices.
4. Select a tree subset by minimizing prediction drift on a calibration grid, not by taking the first N trees.

Calibration grid must include:

```text
ROUND/E/VS1 at 1, 2, 3, 4, 5ct
ROUND/D-F/VS1-VVS2 at 3ct
OVAL/PEAR/EMERALD common grades
selected-spec-only rows
cert-loaded rows
```

### Strategy D - Add segment-level diagnostics before choosing a winner

For every candidate model, emit:

```text
global balanced MAPE
row-weighted MAPE
dense-cell MdAPE
selected-spec-only MAPE
cert-loaded MAPE
MAPE by carat bucket
MAPE by shape
MAPE by cut
MAPE by growth method known vs unknown
browser-compact drift vs full model
```

Add pinned regression cases:

| Case | Expected behavior |
|---|---|
| 3.00 ROUND E VS1 ID selected-spec-only | Should not price like EX outlier rows |
| 3.00 ROUND E VS1 EX selected-spec-only | May price above ID, but only if cut is truly EX |
| 3.00 ROUND E VS1 unknown cut | Should sit near dense local median, not EX tail |
| 3.00 ROUND E VS1 with report dimensions | Should move only if proportions justify it |
| 3.00 ROUND E VS1 CVD vs `-` growth | Unknown growth should not create a premium by itself |

### Strategy E - Preserve raw ML estimate in the UI

The UI should continue to display raw ML as a separate diagnostic estimate. The change should be upstream:

- retrain the model,
- export the right artifact,
- make browser compacting faithful,
- and label model/version accurately.

Do not silently replace the ML estimate with the StarGem lookup formula. The lookup formula remains a separate reconstruction panel.

## Implementation Plan

### Phase 1 - Repro and diagnostics

Add a script:

```text
research/scripts/diagnose-starsgem-ml-case.py
```

It should output:

- current deployed prediction for a provided spec
- full model prediction
- sheet group median
- feature lookup value
- tree leaf rate distribution
- nearest exact rows by report number/carat/cut/type

Use it for this exact case first:

```bash
python3 research/scripts/diagnose-starsgem-ml-case.py \
  --carat 3.00 --shape ROUND --color E --clarity VS1 --cut ID
```

### Phase 2 - Retrain residual-rate model

Add S19 to `research/scripts/starsgem-mrpe-v2.py`:

```text
S19 - Coarse lookup residual model with selected-spec augmentation
```

Core changes:

- build coarse lookup from train only
- target `log(actual_rate / lookup_rate)`
- add missingness flags
- randomly mask growth/dimensions/cut on training rows
- evaluate selected-spec and cert-loaded views

### Phase 3 - Compact export

Add export variants:

```text
starsgem-ml-selected-spec-full.json
starsgem-ml-selected-spec-compact.json
starsgem-ml-cert-loaded-full.json, optional
```

Compact acceptance:

```text
median drift <= 2%
P95 drift <= 8%
no pinned case changes by > 10%
```

### Phase 4 - Deploy only after pinned cases pass

Update `index.html` only after training artifacts pass:

```text
research/data/starsgem-ml-selected-spec-compact.json?v=YYYYMMDD-s19
```

The UI card can still say "Best ML price guess." The note should include the model id and whether it is in selected-spec or cert-loaded mode.

## Expected Outcome

For this stone, a better raw ML estimate should move from:

```text
current deployed S7 compact: $478
```

toward:

```text
coarse sheet surface: $326
full S18 directionally improved: $379
target S19 residual model: roughly $320-$380 before cert dimensions
```

The important part is not forcing equality with the lookup reconstruction. The important part is making the raw ML model learn that a dense, ordinary 3ct ROUND E VS1 ID selected-spec stone should not be priced like the small high-priced EX tail.

## Implementation Result - 2026-05-27

Implemented S19:

```text
S19 - Lookup residual + selected-spec augmentation
targetType: log_lookup_residual
trees: 96
max_depth: 20
min_samples_leaf: 2
```

Validation on the selected-spec view:

| Model | Selected-spec MAPE | MAE | R2 |
|---|---:|---:|---:|
| Current browser S7 10-tree artifact | 15.7231% | $130.14 | 0.925224 |
| Full S7 bucket-balanced 200-tree artifact | 14.9259% | $131.85 | 0.923594 |
| S19 selected-spec artifact | 7.1114% | $89.61 | 0.944156 |

Pinned case result:

| Case | Old S7 compact | New S19 |
|---|---:|---:|
| 3.00ct ROUND E VS1 ID, selected-spec-only | $477.93 | $327.56 |

Full S7 200-tree result for the same pinned case:

```text
S7 full balanced model: $469.81
S7 balanced validation MAPE: 4.8878%
```

That means the remembered ~5 MAPE model is real and still valuable, but it is a cert/training-row style metric. It does not solve the app's selected-spec-only inference state where growth method and dimensions are missing. S19 is intentionally a selected-spec model; it should be compared against selected-spec validation, not used as evidence that the full S7 balanced benchmark was wrong.

The new result is still the raw ML card: it is not replacing the display with the lookup reconstruction. The model target is the learned residual multiplier around the coarse StarGem lookup rate, so dense commodity cells stay anchored while the ensemble can still adjust for features when support exists.

---

## Real Bucket Analysis — May 2026

Full analysis run on the complete StarGem XLS (28,394 rows). Results below are based on actual `SaleDollorPrice` distributions, not model predictions.

### Price spread by carat bucket

| Carat bucket | n | Mean $/ct | CV | Range |
|---|---:|---:|---:|---|
| 0.30–0.49 | 981 | $153 | 21% | $108–$276 |
| 0.50–0.69 | 4,138 | $142 | 30% | $98–$352 |
| 0.70–0.89 | 728 | $150 | 26% | $109–$282 |
| 1.00–1.49 | 8,430 | $127 | 20% | $85–$324 |
| 1.50–1.99 | 2,801 | $130 | 28% | $82–$297 |
| 2.00–2.99 | 5,111 | $144 | 31% | $94–$418 |
| 3.00–3.99 | 3,227 | $148 | **38%** | $94–$440 |
| 4.00–4.99 | 552 | $153 | 22% | $107–$306 |
| 5.00–9.99 | 1,977 | $180 | **34%** | $19–$469 |
| 10.00+ | 443 | $335 | **61%** | $134–$1,220 |

10ct+ is the hardest bucket by a wide margin: 61% CV across $134–$1,220/ct. That does not mean the UI should turn ML off. It means a plain tree ensemble should not be the only source of truth in the tail. Large-stone pricing needs a structured extrapolation term: bigger lab diamonds are less available, and within comparable shape/color/clarity/cut groups the expected $/ct should generally rise with carat. The retrain should combine lookup anchors, a monotonic large-carat scarcity curve, and tree residuals rather than falling back to lookup-only.

### Worst high-spread spec cells (price CV within Shape × Color × Clarity × Carat-bucket, n ≥ 5)

| Spec | n | CV | Min | Max | Ratio |
|---|---:|---:|---:|---:|---:|
| EMERALD E VVS2 10ct+ | 24 | **78%** | $145/ct | $945/ct | 6.5× |
| EMERALD D VVS1 10ct+ | 27 | 51% | $205/ct | $727/ct | 3.5× |
| OVAL E VVS2 10ct+ | 36 | 50% | $198/ct | $840/ct | 4.2× |
| OVAL D VVS1 10ct+ | 29 | 48% | $328/ct | $1,220/ct | 3.7× |
| HEART D VVS2 2ct | 67 | **43%** | $120/ct | $353/ct | 3.0× |
| HEART E VVS2 1.5ct | 11 | 41% | $110/ct | $257/ct | 2.3× |
| HEART D VS1 3ct | 34 | 40% | $105/ct | $268/ct | 2.6× |
| PRINCESS D VVS1 1ct | 49 | 36% | $124/ct | $306/ct | 2.5× |
| PEAR D VVS1 10ct+ | 32 | 34% | $334/ct | $926/ct | 2.8× |
| ROUND E VS1 5ct+ | 70 | 27% | $114/ct | $310/ct | 2.7× |

### Root cause for every high-spread cell

There are two distinct sources of price spread:

**Source 1 — Chinese specialty cut labels mixed with standard cut stones**

The `Cut` column contains both IGI standard grades (`ID`, `EX`, `VG`) and Chinese supplier-specific styles: `传统切` (traditional/antique round), `冰花切` (ice flower/optical illusion), `长垫形` (elongated cushion), `老欧切` (old European), `老矿切` (old miner). These are fundamentally different products — different faceting, different buyers, different price logic.

Example, HEART D VVS2 2ct:

| Cut | n | Mean | Range |
|---|---:|---:|---|
| 传统切 (traditional) | 18 | $310/ct | $234–$353 |
| 冰花切 (ice flower) | 3 | $213/ct | $155–$243 |
| standard (`-`) | 46 | $157/ct | $120–$353 |

The traditional-cut hearts command **2× the standard price** for the same shape/color/clarity/carat. A model that one-hot encodes `Cut` with all Chinese labels grouped sees this signal, but the `传统切` cells have only ~300 rows total across the entire dataset, so the signal is sparse and the 10-tree model consistently misses the splits.

Example, OVAL D VVS1 10ct+:

| Cut | n | Mean | Range |
|---|---:|---:|---|
| `-` (no cut grade) | 12 | $643/ct | $328–$1,220 |
| `冰花切` | 15 | $405/ct | $334–$627 |
| `传统切` | 2 | $564/ct | — |

Even within cut style the 10ct+ range is extreme: a no-cut-grade oval at 10ct ranges $328–$1,220.

**Source 2 — The ROUND E VS1 3ct commodity/premium bimodal split**

All 241 rows in this bucket are either standard commodity CVD (`-` or `ID` cut, $327–$330) or premium-priced ID/EX stones ($476–$509). Breakdown:

| Price tier | n | Price per ct | Internal rate |
|---|---:|---:|---:|
| Commodity ($327–$330) | 157 | $109/ct | ~18,350 int/ct |
| Premium ($476–$509) | 84 | $158–$169/ct | ~26,900–28,800 int/ct |

The lookup aggregates all 241 rows and returns 18,498 int/ct ≈ $109/ct as the bucket median. The ML model needs to learn the +$60/ct premium for specific stone characteristics. With 10 trees, individual tree predictions span $109–$403/ct; the average ($159/ct) is between the two modes but correct for neither.

With 200 trees, the 3ct ROUND E VS1 result was $126.24/ct ($378.72 total) — closer to commodity but still over. The selected-spec model S19 gets it to $109/ct ($327) for the selected-spec case.

### Conclusion on worst buckets

1. **10ct+ stones across all shapes** — CV 50–78%, so unconstrained trees alone are not enough. ML should still be shown, but it must be anchor-first plus a monotonic parametric tail and a wider confidence band.
2. **Heart shape at 2ct+** — Consistently 30–43% CV, driven by 传统切/冰花切 specialty cuts mixed with standard. The model treats heart as one shape family but it should be at least two: standard and specialty cut.
3. **Large-carat fantasy shapes (OVAL/EMERALD/PEAR at 10ct+)** — Same issue: Chinese cut styles create a 3–6× price premium over standard in the same nominal bucket.
4. **Any shape at 3ct+ where commodity vs premium sub-segments exist** — The model cannot cleanly split them without more trees.

## Concrete Recommendations for Next Training Run (S20)

### P0 — Use the largest validated tree artifact that loads cleanly

The browser should use the largest, best validated tree artifact that still loads cleanly on the page. The old 50-tree artifact (`starsgem-ml-extra-trees-model-50-trees.json`, 72 MB) exists, but bigger file size is not automatically better: it is an old first-N-tree slice and is less calibrated for selected-spec inference than the current S19 selected-spec artifact (`starsgem-ml-extra-trees-model-s19-selected-spec.json`, 96 trees, about 15 MB).

**Action**: Keep S19 selected-spec as the browser default unless a newer S20 artifact beats it on validation and load tests. For S20, export the highest tree count that satisfies:

- page load remains acceptable on desktop and mobile,
- median compact drift vs the full model <= 2%,
- P95 compact drift <= 8%,
- pinned dense cells do not drift by > 10%,
- 5ct+ and 10ct+ bucket MAPE improves or remains neutral.

If a 128-, 160-, or 200-tree artifact loads properly and passes those checks, use it. If not, select a representative compact subset by calibration-grid drift. Do not take the first N trees from a larger ensemble.

### P1 — Add Chinese cut style as explicit group features

Current: `Cut` is one-hot with all values treated equally.

Proposed: Add binary and grouped features so the model can distinguish specialty products from standard cuts:

- `Is_Specialty_Cut` = 1 when `Cut ∈ {传统切, 冰花切, 长垫形, 老欧切, 老矿切}`.
- `Is_Traditional_Cut` = 1 specifically for `传统切`.
- `Is_IceFlower_Cut` = 1 specifically for `冰花切`.
- `Cut_Style_Group ∈ {standard_grade, traditional, ice_flower, elongated_cushion, old_european, old_miner, unknown}`.

These styles have separate price logic from standard faceting. The point is not to always add a premium; it is to stop specialty cuts from contaminating standard-cut estimates and stop standard-cut anchors from underpricing true specialty stones.

This is a low-cost improvement: it reuses existing training data and adds a small number of explicit style features to the vector.

### P1 — Add a per-spec cut-adjusted lookup rate

The current `Lookup_RatePerCt` feature aggregates all cut grades in a bucket. For cells where specialty cuts are present, this anchor is pulled too high (or too low). A secondary lookup that conditions on `Is_Specialty_Cut` would give the model a better anchor to regress against.

### P2 — Model 8ct+ and 10ct+ with a monotonic parametric tail

There are only 443 10ct+ stones, CV=61%, so the model needs structure in this range. Do not suppress the ML card above 8ct, and do not return lookup-only unless every model path fails. Instead, train the large-carat estimate as:

```text
log(rate_per_ct) =
  lookup_anchor(shape, color, clarity, cut_style, type)
  + f_shape_color_clarity(log(carat))
  + g_tail(max(0, log(carat / 5)))
  + specialty_cut_interactions
  + tree_residual
```

Requirements:

- `g_tail` should be monotonic non-decreasing for comparable specs above the large-stone threshold.
- Fit the tail on 5ct+ and 10ct+ rows, with shrinkage toward broader shape/color/clarity families when exact support is thin.
- Let specialty-cut interactions override the standard tail when the cut style is known.
- Show the ML estimate in the UI with a wider range/low-support note, not an "insufficient training data" replacement.
- Validate 8ct+, 10ct+, and 12ct+ smoke cases separately so the model neither flattens rare stones to commodity prices nor blindly overprices every large stone.

### P2 — Add per-carat-bucket MAPE to validation output

The current `mrpe-v2-results.json` only reports global MAPE. The training script should emit:

```
MAPE by carat bucket
MAPE by shape
MAPE by cut (standard vs specialty)
MAPE for stones with vs without dimensions
MAPE for 10ct+ separately
```

This makes it impossible to choose a model that looks good globally while being broken on specific segments.

### P3 — Clean up price outliers in 5ct+ bucket

The 5.00–9.99ct bucket has a $19/ct minimum, which is almost certainly a data entry error (should be $190/ct or $1,900). Before the next training run, audit and remove prices below $50/ct for stones above 3ct.

### P3 — Train separate models for specialty-cut and standard-cut diamonds

传统切/冰花切 stones are genuinely different products with different buyers. A joint model has to interpolate between their price logics. Two separate models (or a gating layer) would reduce their mutual contamination of each other's predictions.

## Implementation Result - S20

Implemented S20:

```text
S20 - Specialty cut + monotonic large-carat tail
targetType: log_tail_lookup_residual
trees: 160
max_depth: 20
min_samples_leaf: 2
```

Key changes:

- added `Cut_Style_Group`, `Is_Specialty_Cut`, `Is_Traditional_Cut`, and `Is_IceFlower_Cut`,
- mapped browser specialty shapes to StarGem Chinese cut labels where applicable,
- added a monotonic 5ct+ large-carat tail: `lookup_rate_at_5ct_surface * exp(slope * log(carat / 5))`,
- kept the ML card visible for 8ct+ and 10ct+ stones,
- exported `starsgem-ml-extra-trees-model-s20-specialty-tail.json`.

Validation:

| View | MAPE | MAE | R2 |
|---|---:|---:|---:|
| selected-spec | 6.0122% | $62.24 | 0.967953 |
| cert-loaded | 5.4058% | $58.43 | 0.968825 |
| selected-spec 8ct+ | 6.9368% | $433.34 | 0.942476 |
| selected-spec 10ct+ | 7.2130% | $540.31 | 0.935081 |

Pinned selected-spec cases:

| Case | S20 price | Tail multiplier |
|---|---:|---:|
| 3ct ROUND E VS1 ID | $326.75 | 1.00x |
| 8ct ROUND E VS1 ID | $1,730.03 | 1.44x |
| 10ct ROUND E VS1 ID | $3,082.97 | 1.72x |
| 12ct ROUND E VS1 ID | $4,078.49 | 1.98x |
