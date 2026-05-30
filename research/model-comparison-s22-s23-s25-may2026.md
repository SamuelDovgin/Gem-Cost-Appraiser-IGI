# Diamond ML Model Comparison — S22 vs S23 vs S25 + Fancy Color
### May 30, 2026 · Updated after S25 v1.2 and colored-gem regression checks

---

## 1. Executive Decision

There is no single best model for every stone.

| Segment | Best point estimate | Best guardrail | Production recommendation |
|---|---|---|---|
| White rounds | **S25** | S22/S23 sanity check | S25 is lowest error in-sample and interpretable; keep S22 visible because S25 is trained on this sheet. |
| White common fancy, 0.5-2ct | **S22** | S23 monotone | S22 wins most dense fancy shapes by MAPE. |
| White step cuts / hearts | **S23** | S21 fallback | S23 wins PRINCESS, EMERALD, HEART on this benchmark. |
| White sparse shapes | **S25** | S22/S23 if covered | S25 wins ASSCHER, CUSHION, SQUARE because parametric pooling helps sparse cells. |
| White large-carat specialty, 4ct+ | **S21 fallback** | S25 audit baseline | S25 underestimates 5ct+ HEART because the large-specialty premium is outside S25 training coverage. |
| Fancy-color / colored gems | **Color S22** | Color S23 monotone | Color S22 has lower validation MAPE; Color S23 is the intensity-monotone sanity check. |

Bottom line: **use S22/S23/S21 dispatch for the production white price card, keep S25 as the 100%-coverage parametric audit model, and use the dedicated color-diamond model family for colored gems. Do not route colored gems through S25.**

---

## 2. What Changed

Implemented:

- `research/scripts/train-s25-parametric.py` now exports `s25-parametric-v1.2`.
- S25 color gradient is constrained to `deltaColor <= 0`. The raw OLS fit still tries `+0.0089`, but the exported model clamps it to `0.0000`, preventing gradient-only D/E/F/G inversion.
- S25 export now includes `deltaColorRaw` and `shapeSupport` so extrapolation risk can be inspected by shape.
- `research/scripts/benchmark-all-models.mjs` now scores S25 with the raw dataset cut value. Ungraded fancy stones remain `-`; they are not coerced to `EX`.
- `research/scripts/benchmark-all-models.mjs` now reports the fancy-color model family.
- Added `research/scripts/color-diamond-model.test.mjs` and `npm run test:color-model` to verify colored-gem artifacts.

Verification:

```text
python3 research/scripts/train-s25-parametric.py
npm run test:color-model
node research/scripts/benchmark-all-models.mjs
```

---

## 3. White-Diamond Benchmark

Dataset: `research/data/dataset-clean-training.json`, 12,843 StarGem Segment-A rows.

Important caveat: S25 is trained on this same dataset, so its white-diamond MAPE is in-sample. S22 and S23 were trained from smaller/different artifacts and are effectively out-of-sample against these rows.

```text
Model                         MAPE      S21 fallbacks   Remaining globals
─────────────────────────────────────────────────────────────────────────
S22 (ExtraTrees + S21)        11.36%    186 / 12,843    786 / 12,843 (6.1%)
S23 (LightGBM + S21)          13.56%    422 / 12,843    209 / 12,843 (1.6%)
S25 v1.2 (Parametric)          8.26%    N/A             0 / 12,843   (0.0%)
```

S25 is best overall on this in-sample white benchmark, but that does not make it the safest single production model. Its biggest weakness is extrapolated large specialty shapes.

---

## 4. White MAPE by Shape

```text
Shape        n      S22       S23       S25 v1.2   Best model
──────────────────────────────────────────────────────────────
ROUND     9,701   13.85%    16.69%      7.77%     S25
PEAR        768    3.21%     3.58%     10.07%     S22
OVAL        746    3.88%     4.23%      7.98%     S22
MARQUISE    420    3.74%     4.08%      6.86%     S22
RADIANT     370    3.10%     3.41%     18.53%     S22
PRINCESS    352    2.94%     2.86%      8.21%     S23
EMERALD     258    4.13%     3.68%     14.29%     S23
CUSHION     137    5.35%     4.29%      3.28%     S25
ASSCHER      47    9.70%    15.75%      2.29%     S25
SQUARE       31    2.56%     2.93%      2.53%     S25
HEART        13    4.37%     2.27%      4.38%     S23
```

Pattern:

- S22 remains best for dense fancy shapes such as PEAR, OVAL, MARQUISE, and RADIANT.
- S23 remains useful where monotone grade behavior matters and wins PRINCESS, EMERALD, HEART.
- S25 is strongest on ROUND and sparse shapes where a pooled parametric baseline beats sparse lookup behavior.

---

## 5. S25 v1.2 Monotonicity and Extrapolation

S25 clarity remains monotone by construction:

```text
1ct ROUND D clarity ladder:
IF    $163.00/ct
VVS1  $150.09/ct
VVS2  $125.89/ct
VS1   $122.69/ct
VS2   $116.11/ct
SI1   $109.05/ct
SI2   $101.93/ct
```

Color handling is now split correctly:

- Observed specs may retain empirical `specEps` differences, so ROUND E VS1 can be higher than ROUND D VS1 in the sheet.
- Gradient-only fallback is monotone/neutral because `deltaColor = 0.0000`.
- This is safer than the old unconstrained fit, where `deltaColorRaw = +0.0089` would make lower colors more expensive in unseen specs.

Large-specialty warning:

```text
Heart D VS1 extrapolation:
1ct      S25 $141    S21 $159
3ct      S25 $370    S21 $359
5.21ct   S25 $600    S21 $1,410
8ct      S25 $873    S21 $2,310
```

S25 is a useful audit floor/shape baseline, but **S21 remains the better fallback for 4ct+ specialty hearts** because it contains real large-heart lookup support.

---

## 6. Colored Gems / Fancy-Color Diamonds

Colored gems are accounted for by a separate model family, not by S25.

Data:

- `research/data/messi-color-index.json`: 1,652 Messi colored diamond rows.
- `research/data/starsgem-color-index.json`: 5 direct StarGem colored anchors.
- Source adjustment: Messi rows are divided by `1.25` to estimate StarGem-like factory pricing.

Benchmark checkpoint:

```text
Rows: 1,657 fancy-color stones
Validation rows: 161
Direct StarGem anchors: 5

Color S22 ExtraTrees:
  Validation MAPE: 3.12%
  Validation MdAPE: 0.77%
  Direct StarGem anchor MAPE: 0.00%

Color S23 LightGBM monotone:
  Validation MAPE: 3.86%
  Validation MdAPE: 1.84%
  Direct StarGem anchor MAPE: 0.23%
```

Best colored-gem model:

- **Use Color S22 for point estimates** because it has the lower validation MAPE and exact direct-anchor fit.
- **Use Color S23 as the monotone intensity guardrail** because it formally constrains numeric intensity rank and carat upward.

The new `npm run test:color-model` check verifies:

- all 1,657 colored rows produce finite predictions;
- both colored models contain exported trees;
- S22 validation MAPE stays below 6%;
- S23 validation MAPE stays below 7%;
- all five direct StarGem colored anchors stay within 1% MAPE;
- S23 remains monotone in numeric color-intensity rank.

---

## 7. Current Best Architecture

Recommended dispatch:

```text
if fancy-color / colored:
  primary = Color S22 ExtraTrees
  guardrail = Color S23 monotone intensity
else if S22/S23 hits large-carat specialty coverage gap:
  fallback = S21 lookup/monotone model
  audit = S25 parametric
else:
  primary = S22 for dense fancy shapes
  monotone alternative = S23
  audit / sparse-shape baseline = S25
```

For the app, the user-facing answer should be model-family aware:

- White diamond: show S22, S23, and S25 where useful.
- Colored gem: show Color S22 and Color S23; hide white StarGem lookup and white S25 as already done in `index.html`.

---

## 8. Improvement Roadmap

Priority improvements:

1. Build a true held-out white benchmark so S25 is not judged in-sample against S22/S23.
2. Add an explicit dispatch test for large-specialty fallback cases such as 5.21ct HEART D VS1.
3. Add UI use of S25 `shapeSupport` to warn when carat exceeds a shape's observed range by 2x or more.
4. Expand direct StarGem colored anchors beyond 5 stones, especially vivid pink/blue/yellow at 3ct+.
5. Train separate white round and fancy models for S23 so the grade-agnostic anchor does not harm ROUND.
6. Add L/W ratio to the white S25 formula once reliable dimensions exist for Segment-A rows.

---

*Generated from `benchmark-all-models.mjs`, `train-s25-parametric.py`, and `color-diamond-model.test.mjs` on 2026-05-30.*
