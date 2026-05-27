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
