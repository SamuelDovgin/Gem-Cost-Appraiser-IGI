# S22 Follow-Up — Implementation Plan

**Date:** 2026-05-29
**Status:** proposal / ready to execute
**Predecessor:** [`s22-and-color-monotonicity-plan.md`](s22-and-color-monotonicity-plan.md) (S22 analysis + findings)

This plan turns the S22 evaluation findings into sequenced, shippable work. The S22 analysis proved three things:

1. **S20 + Layer-4 PAV = 0 inversions, no retrain** (matches S21 exactly).
2. **PAV applied to point pricing costs +5.34 pp MAPE** (4.63 % → 9.97 %) because PAV is a *monotonicity corrector*, not a pricing model — it changed 78.7 % of stones and worsened 83.6 % of those.
3. **A production bug was fixed**: 4 features (`Dim_Volume`, `Dim_Surface`, `LW_Ratio_refined`, `Table_Depth_Ratio`) were missing from JS inference in both `index.html` and `starsgem-ml-predict.mjs`.

The single highest-value action is **P0: decouple PAV from point pricing** — it recovers full accuracy *and* keeps zero inversions, with no retraining.

---

## Priority overview

| Priority | Work | Effort | Payoff | Retrain? |
|---|---|---|---|---|
| **P0** | Decouple PAV: raw S20 for price card, PAV for ladders only | XS (1 line + guard) | 9.97 % → **4.63 %** MAPE, keeps 0 inversions | No |
| **P1** | Verify + ship the 4-feature JS fix (cert-loaded parity) | S | Correct cert-loaded prices; closes silent prod bug | No |
| **P2** | CI regression gate (parity + monotonicity + MAPE) | S | Prevents silent regressions like the 4-feature bug | No |
| **P3** | Track A — S23 structural monotonicity (clarity-agnostic anchor) | L | Removes PAV plateaus/lifts; guarantee no longer 100 % PAV-dependent | Yes |
| **P4** | Track B — fancy-color intensity monotonicity | L | Same guarantee for color diamonds (intensity + modifier axes) | Yes |

P0–P2 are no-retrain, ship-this-week items. P3–P4 are the larger modeling tracks.

---

## P0 — Decouple PAV from point pricing (do first)

**Finding:** the production price card currently calls `predictStarsgemMlMonotone` (PAV) for a *single stone*, which applies the ladder-averaging projection to point pricing and adds +5.34 pp MAPE.

**Call sites in `index.html`:**

- `2508`: `const mlPred = colorMlPred || predictStarsgemMlMonotone(row);` — **the main price card.** This is the one to change.
- `2656`: `const pred = predictStarsgemMlMonotone(row);` — ladder-context display; **keep monotone.**

### Change

| Purpose | Use | Result |
|---|---|---|
| Main price card (one stone) | `predictStarsgemMl(row)` — **raw S20** | 4.63 % MAPE |
| Clarity ladder display | `predictStarsgemMlMonotone(row)` | 0 inversions ✅ |
| Color ladder display | `predictStarsgemMlMonotone(row)` | 0 inversions ✅ |

Mirror the same split anywhere `starsgem-ml-predict.mjs` is consumed by analysis/serving code.

### Why this is correct, not a hack

PAV pools adjacent clarity cells into a flat block; that average is the right value for a *ladder* (it enforces IF ≥ VVS1 ≥ … ≥ SI2) but systematically biases an *individual* high-clarity stone downward, because the pool includes lower-clarity cells. The price card should show the model's best point estimate; the ladder should show a monotone sequence. They are different questions and should call different functions.

### Guard against regressions

- Add an assertion/comment at each call site stating which function is intentional and why (point vs ladder).
- Add a tiny unit check: for a known dense cell (e.g. 1 ct ROUND E VS1), `predictStarsgemMl` and `predictStarsgemMlMonotone` should agree within tolerance (dense cells rarely sit in a PAV block); for a known sparse inversion cell (Heart 3 ct E VVS1), they should differ (PAV active). This locks in the intended behavior.

### Acceptance

- Selected-spec point-pricing MAPE back to **≈4.63 %**.
- Clarity + color ladders still **0 inversions**.
- No model files change.

---

## P1 — Verify and ship the 4-feature JS fix

The S22 work fixed `Dim_Volume`, `Dim_Surface`, `LW_Ratio_refined`, `Table_Depth_Ratio` in `starsgemNumericFeatureValue` (both `index.html` and `starsgem-ml-predict.mjs`). The selected-spec MAPE numbers are unaffected (all four fall back to the training median when dimensions are absent), but **cert-loaded mode** prices were silently wrong before the fix.

### Tasks

1. **JS↔Python parity test** (new, small): for a set of cert-loaded fixtures with real IGI dimensions, assert `predictStarsgemMl` (JS) matches the Python `s20_predict_prices` / `s21_predict_prices` output within a tight tolerance (e.g. ≤0.5 %). This is the test that would have caught the missing features.
2. **Confirm fallback behavior** in selected-spec mode (no dimensions) still resolves all four to the documented training medians.
3. **Cache-bust** the deployed page so browsers pick up the corrected inference (`?v=20260529-s22-featfix` or similar).
4. Verify the feature *order* in the JS vector exactly matches the model's `features.numeric` array (off-by-one in feature order produces exactly this "systematically wrong" signature).

### Acceptance

- Cert-loaded JS prices match Python within tolerance on all fixtures.
- Selected-spec numbers unchanged.

---

## P2 — CI regression gate

The 4-feature bug was silent because nothing compared JS inference to Python or flagged the MAPE blow-up. Add a gate so this class of bug cannot ship again.

### Gate contents (wire into `npm run research:compare-s20-s21` or a new `npm run research:gate`)

| Check | Threshold | Fails build if |
|---|---|---|
| Clarity inversions (ladder/PAV path) | 0 | > 0 |
| Color inversions (ladder/PAV path) | 0 | > 0 |
| Point-pricing MAPE (raw, selected-spec) | ≤ baseline + 0.5 pp | exceeds |
| JS↔Python parity (cert-loaded fixtures) | ≤ 0.5 % | exceeds |
| Feature-vector length = `features.numeric.length + onehot width` | exact | mismatch |

Make the runner **exit non-zero** on any failure. Use the corrected inversion-direction check (`cur.perCt > prev.perCt × 1.001`) noted in the S21 evaluation.

---

## P3 — Track A: S23 structural monotonicity (retrain)

Only pursue if the **PAV plateaus/lifts in the ladder display** become a UX problem (IF = VVS1 same price; top-of-ladder cells lifted +90–100 %). P0 already solves the *accuracy* problem, so S23 is about ladder *quality*, not point accuracy.

### Levers (from the S22 analysis §12 + prior plan)

1. **Clarity-agnostic base anchor** — strip `Clarity`/`Color` out of the lookup key used for `base_rate`; anchor on `Shape × carat_bucket` (with `Shape × Color × carat_bucket` fallback) and move the full grade premium into monotone-constrained `Clarity_Rank` / `Color_Rank` features. This removes the "jumping anchor" root cause, shrinks PAV blocks, and reduces the top-of-ladder lifts.
   - Files: `research/scripts/starsgem-mrpe-v2.py` (new base-anchor builder), `starsgem-ml-predict.mjs` + `index.html` (matching anchor logic).
2. **Large-carat accuracy** — align the tail anchor bucket boundary so 4–5 ct stones don't hit the 4→5 ct cliff (`LARGE_CARAT_TAIL_START_CT`, `tail_anchor_lookup_row`).
3. **Soft PAV** — permit a small premium for the better grade when lookup support `n ≥ 30`; pool only genuinely sparse cells. Keeps strict non-increasing while reducing plateau ties.

### Acceptance

- Raw (pre-PAV) clarity inversions **< 100** (down from 1,127 S20 / 934 S21) — proves monotonicity is becoming structural.
- Ladder PAV blocks smaller (fewer/narrower plateaus); max top-of-ladder lift **< 25 %**.
- Point-pricing MAPE not worse than S20 raw (P0 baseline).

---

## P4 — Track B: fancy-color intensity monotonicity

The color model (`color-diamond-ml-model.json`, ExtraTrees) has received **none** of the monotonicity work and its dominant axes differ from white.

### Axis priorities (color ≠ white)

| Axis | Required ordering |
|---|---|
| **Color intensity** (primary) | `Faint < Very Light < Light < Fancy Light < Fancy < Fancy Intense < Fancy Vivid` → non-decreasing per hue/shape/carat |
| **Modifiers** (primary) | Greyish/Brownish/Yellowish must price **below** the pure hue (−20 % to −50 %) |
| Carat | non-decreasing within hue × intensity |
| Clarity | weak (color masks inclusions); not the focus |

### Sequence

1. **Measure first (prerequisite):** build `research/scripts/analyze-color-intensity-monotonicity.mjs` (**does not exist yet**) — analog of `analyze-ml-grade-monotonicity.mjs`, sweeping `hue × intensity × carat × shape` with/without modifiers. Run on the current color model to quantify hidden intensity/modifier inversions.
2. **Apply the S22/S21 pattern on the intensity axis:** isotonic intensity anchor → `colorIntensityRank` + `modifierPenaltyRank` features → LightGBM monotone constraints (`+1 carat`, `+1 colorIntensityRank`, `−1 modifierPenaltyRank`) → Layer-4 projection over the per-hue intensity ladder (`predictColorDiamondMlMonotone`).
3. **Decouple PAV from point pricing here too** — same lesson as P0: ladder display uses projection, the color price card uses the raw color model.
4. **Don't ML the data-starved hues:** orange (n=1), purple (n=0), red (73) → fall back to the curated ladders in `fancy-color-diamond-pricing.md` and flag "specialty — limited comp data."
5. **Sanity gate** against the curated multiplier bands; block Vivid < Intense or modifier-above-pure-hue.

### Acceptance

- Intensity inversions (dense hues, projected) = 0; modifier-premium violations = 0.
- Rare hues routed to curated ladder, flagged (not ML).
- Color point-pricing MAPE ≤ current 3.12 % + 1.0 pp.

---

## Sequencing

1. **P0** (decouple PAV) — ship immediately; it is the headline win and is nearly free.
2. **P1** (feature-fix parity) + **P2** (CI gate) — same PR or fast-follow; they protect P0.
3. **P4 step 1** (color sweep) in parallel — read-only measurement, sizes the color problem.
4. **P3** (S23 retrain) and **P4 steps 2–5** (color retrain) — independent modeling tracks, only after P0–P2 are stable.

## Files touched

| Priority | File | Change |
|---|---|---|
| P0 | `index.html` | line 2508 → `predictStarsgemMl` for the price card; keep `predictStarsgemMlMonotone` on the ladder (2656); add guard comments/asserts |
| P0 | `research/scripts/starsgem-ml-predict.mjs` | document point-vs-ladder usage for downstream callers |
| P1 | `index.html`, `starsgem-ml-predict.mjs` | confirm 4-feature fix + vector order; cache-bust |
| P1/P2 | `research/scripts/` (new parity + gate script) | JS↔Python parity fixtures; non-zero-exit gate |
| P3 | `starsgem-mrpe-v2.py`, `starsgem-ml-predict.mjs`, `index.html` | clarity-agnostic anchor, tail bridge, soft PAV; new S23 artifact |
| P4 | `train-color-diamond-model.py`, new `analyze-color-intensity-monotonicity.mjs`, color inference path | intensity/modifier monotonicity + projection; new color artifact |
