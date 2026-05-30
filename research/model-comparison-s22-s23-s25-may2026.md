# Diamond ML Model Comparison — S22 vs S23 vs S25 vs S26 + Fancy Color
### May 30, 2026 · Updated after S26 champion hybrid deployment

---

## 1. Executive Decision

There is no single best model for every stone.

| Segment | Best point estimate | Best guardrail | Production recommendation |
|---|---|---|---|
| White rounds | **S26** | S22/S23 sanity check | S26 wins ROUND on the current production-policy benchmark while preserving visible ML comparison. |
| White common fancy, 0.5-2ct | **S26** | S23 monotone | S26 wins PEAR, OVAL, MARQUISE, RADIANT, EMERALD, CUSHION, ASSCHER, and SQUARE. |
| White step cuts / hearts | **S26 except PRINCESS/HEART watch list** | S23 monotone + S21 fallback | S23 still wins PRINCESS and HEART on this benchmark, so S26 should keep source caps and visible guardrails there. |
| White sparse shapes | **S26** | S22/S23 if covered | S26 beats S25 on ASSCHER, CUSHION, and SQUARE by anchoring to the deterministic StarGem lookup surface. |
| White large-carat specialty, 4ct+ | **S26 with live comps** | S21 fallback + source caps | S26 replaces the pure parametric extrapolator; high-carat output must lean on live comps and widen uncertainty when support is weak. |
| White overall champion panel | **S26** | source caps + monotone display | S26 replaces S25 in the app; it blends lookup, monotone-capped ML, and comp evidence. |
| Fancy-color / colored gems | **Color S22** | Color S23 monotone | Color S22 has lower validation MAPE; Color S23 is the intensity-monotone sanity check. |

Bottom line: **S26 replaces S25 in the app.** Use the dedicated color-diamond model family for colored gems. Do not route colored gems through S26.

---

## 2. What Changed

Implemented:

- `research/scripts/train-s25-parametric.py` now exports `s25-parametric-v1.2`.
- S25 color gradient is constrained to `deltaColor <= 0`. The raw OLS fit still tries `+0.0089`, but the exported model clamps it to `0.0000`, preventing gradient-only D/E/F/G inversion.
- S25 export now includes `deltaColorRaw` and `shapeSupport` so extrapolation risk can be inspected by shape.
- `research/scripts/benchmark-all-models.mjs` now scores S25 with the raw dataset cut value. Ungraded fancy stones remain `-`; they are not coerced to `EX`.
- `research/scripts/benchmark-all-models.mjs` now reports the fancy-color model family.
- Added `research/scripts/color-diamond-model.test.mjs` and `npm run test:color-model` to verify colored-gem artifacts.
- Added `research/scripts/white-ml-display-monotonicity.test.mjs` and `npm run test:white-ml-display` for the 40ct E VS2/SI1 fallback inversion.
- Added `research/scripts/train-s26-champion.mjs`, `research/data/starsgem-ml-model-s26-champion.json`, and `npm run test:s26`.
- Replaced the old S25 app panel with S26 champion hybrid output.

Verification:

```text
python3 research/scripts/train-s25-parametric.py
npm run test:color-model
npm run test:white-ml-display
npm run test:s26
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
S26 v1 (Champion hybrid)       4.80%    N/A             0 / 12,843   (0.0%)
```

S26 is best overall on this white benchmark. Caveat: S26's benchmark path uses the StarGem lookup reconstruction in-sample, so treat the number as a production-policy benchmark rather than a pure holdout claim.

---

## 4. White MAPE by Shape

```text
Shape        n      S22       S23       S25 v1.2   S26 v1   Best model
──────────────────────────────────────────────────────────────────────
ROUND     9,701   13.85%    16.69%      7.77%      5.51%    S26
PEAR        768    3.21%     3.58%     10.07%      1.86%    S26
OVAL        746    3.88%     4.23%      7.98%      1.60%    S26
MARQUISE    420    3.74%     4.08%      6.86%      2.53%    S26
RADIANT     370    3.10%     3.41%     18.53%      2.76%    S26
PRINCESS    352    2.94%     2.86%      8.21%      6.67%    S23
EMERALD     258    4.13%     3.68%     14.29%      2.55%    S26
CUSHION     137    5.35%     4.29%      3.28%      2.02%    S26
ASSCHER      47    9.70%    15.75%      2.29%      1.58%    S26
SQUARE       31    2.56%     2.93%      2.53%      1.24%    S26
HEART        13    4.37%     2.27%      4.38%      5.53%    S23
```

Pattern:

- S26 now wins most dense fancy shapes because it uses the deterministic StarGem lookup surface as the primary anchor.
- S23 remains useful where monotone grade behavior matters and wins PRINCESS and HEART.
- S25 is no longer the app champion; it remains a research baseline showing why pure parametric extrapolation is risky.

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

High-carat round warning:

```text
7.77ct ROUND E VS1:
S25      $715   ($92/ct)
S21/S22  $1,416 ($182/ct)
StarGem  $993   ($128/ct)
Exact comp adjusted from 8ct StarGem  $1,736 ($223/ct)
```

This is beyond S25's ROUND training max of 5.06ct. The issue is not lookup coverage for the spec (`ROUND||E||VS1` has observed rows); it is carat extrapolation past the observed range with a negative global beta. The app now labels S25 as an out-of-range baseline/floor in this situation instead of calling it "extrapolation-safe."

Large-carat fallback monotonicity warning:

```text
40ct ROUND E, raw S21 fallback used by both S22/S23 cards:
VS2 raw display candidate  about $12.7k
SI1 raw display candidate  about $31.1k  ← invalid
SI1 capped display         about $12.7k
```

The raw fallback inversion comes from sparse high-carat tail cells. The app now applies a final display-layer clarity ceiling after S21 fallback, so lower clarity can never show above a better clarity for the same carat/color/shape.

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
else:
  champion panel = S26 lookup/ML/comp hybrid
  production comparison = S22/S23 with S21 fallback and monotone display caps
  parametric baseline = S25 research only
```

For the app, the user-facing answer should be model-family aware:

- White diamond: show S22, S23, and S26.
- Colored gem: show Color S22 and Color S23; hide white StarGem lookup and white S26 as already done for white-only models.

---

## 8. Improvement Roadmap

Priority improvements:

1. Build a true held-out white benchmark so S26's lookup-led policy is not judged only against the StarGem sheet it reconstructs.
2. Add an explicit dispatch test for large-specialty fallback cases such as 5.21ct HEART D VS1.
3. Add app-level tests for S26 high-carat comp weighting, especially 7.77ct ROUND E VS1 and 40ct ROUND E VS2/SI1.
4. Expand direct StarGem colored anchors beyond 5 stones, especially vivid pink/blue/yellow at 3ct+.
5. Train separate white round and fancy models for S23 so the grade-agnostic anchor does not harm ROUND.
6. Add L/W ratio to the white S26 feature context once reliable dimensions exist for Segment-A rows.

---

*Generated from `benchmark-all-models.mjs`, `train-s25-parametric.py`, `train-s26-champion.mjs`, and `color-diamond-model.test.mjs` on 2026-05-30.*
