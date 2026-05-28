# Gem Appraise — ML Methodology Review, Gaps & Improvement Plan

Author: Claude (Opus 4.8) code-grounded review
Date: 2026-05-28
Scope: how the app trains/predicts wholesale cost for lab-grown diamonds, where the methodology and UI fall short, and what to do next.
Primary sources read: `index.html` (live calculator + browser inference), `research/comp-engine-v3.js`, `research/scripts/starsgem-mrpe-v2.py`, `research/scripts/train-color-diamond-model.py`, and the `research/*.md` methodology trail (`current-pricing-model-how-it-works.md`, `starsgem-ml-training-diagnosis-and-retrain-plan.md`, `estimation-algo-improvement-priorities.md`, `color-diamond-ml-*.md`, `IGI-ENRICHMENT-ML-INTEGRATION-IMPLEMENTATION.md`).

> Note: a parallel review (`app-improvement-analysis-2026-05.md`) was written the same day and reaches several of the same conclusions (one-number reconciliation, calibrated uncertainty, transaction-vs-list data, accessibility). This document is intentionally **code-grounded** — every gap below points at a specific function or constant — and goes deeper on the *how* of the ML fixes (calibration, stacking, monotonic tails, feedback). Treat the two as corroborating, not competing.

---

## 1. How pricing actually works today (verified in code)

The app produces, for one stone, four numbers that are computed by **four independent pipelines** and shown side by side:

| # | Pipeline | Where | What it returns |
|---|---|---|---|
| 1 | Hand-authored baseline | `index.html` (`baseWhitePerCt`, fancy `ws1·carat^scale`) | Wholesale / fair / retail point estimates |
| 2 | Comp Engine v3 | `research/comp-engine-v3.js`, mirrored in `index.html` | Market floor/sanity range from live Alibaba/Messi/StarGem comps |
| 3 | StarGem ML (Extra Trees) | `predictStarsgemMl()` + `starsgem-ml-extra-trees-model-s20-specialty-tail.json` | "Best ML price guess" card |
| 4 | StarGem lookup reconstruction | `predictStarsgemAnchor()` / lookup-rate functions | Sheet-median sanity check |

### The ML path, concretely
- **Model family:** scikit-learn ExtraTrees, serialized to JSON and walked in the browser. `predictStarsgemMl()` descends each tree to a leaf and averages `logSum / model.trees.length`, then exponentiates.
- **Target evolution (S1→S20):** the team moved from raw `log_rate` → `log_lookup_residual` (predict the multiplier around a coarse `carat_bucket × shape × color × clarity` sheet anchor) → `log_tail_lookup_residual` (add a monotonic large-carat tail). The deployed S20 model reaches **6.0% selected-spec MAPE / 5.4% cert-loaded MAPE**, and uses `Cut_Style_Group` / `Is_Specialty_Cut` features to stop Chinese specialty cuts (传统切/冰花切) from contaminating standard-cut prices.
- **Two inference regimes:** "selected-spec" (before an IGI report is parsed — growth method is the literal string `"-"`, dimensions median-imputed) and "cert-loaded" (after parse). S19/S20 train with missingness flags + masking so the model behaves on the out-of-distribution selected-spec state.
- **Color diamonds:** a separate ExtraTrees overlay (`color-diamond-ml-model.json`) trained on 1,657 rows — 1,652 of them Messi rows divided by a single hand-measured `1.25` source factor, plus **5** direct StarGem anchors. Reports 3.12% MAPE.

### The honest part
This is genuinely good engineering. The S7→S18→S19→S20 diagnosis trail is the kind of failure-mode honesty most pricing models never get. The comp engine already does what `current-pricing-model-how-it-works.md` said it *didn't* — `research/comp-engine-v3.js` now fits a **local log($/ct) vs log(carat) slope** with confidence tiers and shrinkage toward priors when support is thin (the `fitLocalCaratCurve` / `resolveCaratSlope` logic around lines 443–700). So the "no fitted carat curve" gap from the older doc is partly closed.

---

## 2. The core structural gap: four pipelines, no arbiter

This is the single most important finding and it is visible directly in the UI markup (`index.html` ~lines 667–711): the result panel renders **"What they paid"**, **"Retail range"**, **"Best ML price guess"**, and **"StarGem lookup reconstruction"** as four separate tiles. On the documented 3ct ROUND E VS1 case these disagreed across roughly **$326–$478** — a ~45% spread — and nothing in the code reconciles them.

**Why this is the root problem:** the four numbers don't just confuse the user (UI symptom); they mean the system has *no single object whose error can be measured and improved*. You can't calibrate "the price" because there is no "the price." Every other ML improvement is downstream of fixing this. The right unit of work is **one fair-wholesale estimate with a band**, produced by a learned arbiter that takes the baseline, the comp blend, and the ML guess as inputs.

---

## 3. Gaps in the ML model & predictive capability

### 3.1 Uncertainty is not calibrated — and the code admits it
`research/comp-engine-v3.js` line 311 contains the most damning self-assessment in the repo:

```
// Current P80 coverage is ~20% (white) and ~30% (fancy) vs the ≥60% target.
```

and line 318:

```js
const SIGMA_CALIBRATION_FACTOR = 2.0;
```

An 80% interval that actually contains the truth only 20–30% of the time is not an interval, it's decoration — and the `2.0` multiplier is a hand-tuned fudge, not a measured calibration. For a tool whose entire value proposition is *trust*, this is the highest-severity ML gap. The ML cards, meanwhile, show a point estimate with **no band at all**.

### 3.2 The model learns factory *list* prices, not *transaction* prices
Every training row (StarGem XLS, Messi XLSX) is an asking/stock price. The seller use case — "what did the jeweler pay" and "what's a fair resale" — is about **realized** prices, which run materially below list and vary by negotiation, volume, and channel (`jeweler-sourcing-ecosystem.md` itself cites a 15–40% spread). The whole color model leans on a **single `1.25` constant** to map Messi→StarGem. So the model is precise about the wrong surface: it predicts factory-list, then a constant tries to bend it toward wholesale. There is exactly one real transaction anchor in the system (the TikTok LG563297279 ~$100 sale) and it's used as a one-off code calibration, not as data.

### 3.3 The residual-anchor design is clever but quietly fragile
S20 predicts a multiplier around a coarse lookup rate, and the browser reconstructs price as `exp(logVal) · lookupRate · tailMultiplier · carat` (`predictStarsgemMl`). Two failure modes:
- **The lookup anchor must be byte-identical between Python training and JS inference.** `starsgemModelLookupRate` / `starsgemModelTailBaseLookupRate` reimplement in JS what the Python built. Any drift in bucket edges, normalization (`starsgemNorm`), or median logic silently multiplies into every prediction. This is the exact class of bug that already shipped once (the "treeCount: 200 but actually 10 trees" stale slice).
- **If the anchor is missing for a spec, the code falls back to `lookupRate = 1`**, turning a residual into a raw (and meaningless) number. There's no guard that surfaces "anchor missing → low confidence."

### 3.4 Extra Trees is the wrong tool for the monotonicity you actually need
Diamond price *should* be monotonic in carat within a comparable spec, and largely monotonic in color/clarity. The team had to bolt on a **separate parametric `g_tail`** (the S20 monotonic large-carat term) precisely because the forest wouldn't extrapolate monotonically past 5ct. Gradient-boosted trees with **monotonic constraints** (LightGBM/XGBoost both support per-feature monotone constraints) would give that behavior natively — across carat *and* color/clarity ordinals — instead of a hand-fitted tail glued onto a non-monotonic ensemble. It also tends to beat ExtraTrees on tabular MAPE at similar size.

### 3.5 Coverage is dangerously thin exactly where errors cost the most
- **Color:** 5 direct StarGem anchors, 1 orange row. The 3.12% MAPE is almost certainly optimistic — it's measured largely on Messi-derived rows that share the same `/1.25` adjustment, so the validation set isn't source-independent. Rare-hue large stones (where a single mistake is thousands of dollars) are where the model is weakest and least tested.
- **Large carat:** 443 stones above 10ct with CV up to 78% (per the diagnosis doc). The monotonic tail is the right instinct, but it's anchored on sand.

### 3.6 No feedback loop
The app is strictly input→price. There is no capture of "actual sold/paid price" or "user overrode this to $X." Every gain requires the manual capture→retrain→re-export cycle. A tool used daily by a jeweler is sitting on a free, perfectly-labeled training stream and throwing it away.

### 3.7 Validation can still pass while a segment is broken
S20 added per-view MAPE (selected-spec / cert-loaded / 8ct+ / 10ct+), which is good. But there is no **CI gate** that fails a model export when a pinned commodity cell (3ct ROUND E VS1) or a segment regresses, and no automated check that the deployed browser JSON's metadata matches its actual tree count/contents. The discipline lives in docs, not in the pipeline.

---

## 4. Gaps in pricing methodology (seller-specific)

1. **"What they paid" defaults to factory-direct.** Most jewelers buy from a US/EU importer at +20–35%, not from Alibaba. The China toggle exists, but the *default cost basis* understates the real seller population. Cost basis should be an explicit, seller-aware input, not a buried multiplier.
2. **Channel markups are fixed constants** (1.55–2.05× standard, 1.2–1.45× auction). They don't flex with carat, shape desirability, or segment saturation — a 0.5ct round and a 5ct fancy pink do not carry the same resale multiple.
3. **No liquidity / sellability signal.** Price ≠ sellability. The captured comp index already knows *how many comparable stones are currently listed*; that's a free "easy-to-sell vs slow-mover / days-to-sell" signal that a seller cares about as much as price.
4. **Magic-weight is a smooth ramp, not a market step.** Real diamond pricing has psychological discontinuities at 1/1.5/2/3ct. The model tapers to zero at the mark; the docs' own recommended hybrid (continuous curve + explicit learned threshold premium) is unbuilt.
5. **Treatment/origin modifiers are global scalars** (HPHT 1.08×, CVD 0.90×, post-treatment 0.94×) that don't interact with color/carat, where their real effect lives.

---

## 5. Gaps in UI / UX (verified against `index.html`)

1. **Four competing numbers, no hero answer.** Same root cause as §2. A non-expert seller is handed a panel of estimates to reconcile by hand. There should be one **"Fair wholesale: $X (likely $Y–$Z)"** headline with the breakdown behind a "show the math" disclosure.
2. **No visible confidence.** The engine computes confidence tiers and ranges internally, but the cards lead with point estimates and the ML cards have no band. The thing the seller most needs to see (how sure are we, based on how many comps) is the thing that's hidden.
3. **No "why this price" waterfall.** The comp engine already *returns* `primaryComp`, `support`, `rejected`, and per-axis score components — everything needed to render "baseline $X → comps +8% → your color −12% → specialty cut +40% → $Y." That data is computed and then dropped on the floor.
4. **Accessibility is thin.** A grep for `<button>/<input>/<label>/aria-/role=/<section>` across the entire ~5,500-line file returns ~35 matches; pills and toggles are clickable `<div>`s. Keyboard nav, focus management, and screen-reader support are effectively absent, and color-family pills use color as the sole signal.
5. **The "estimate sharpens after cert load" story isn't told.** Before IGI parse the model is in its weakest selected-spec state, but the UI doesn't strongly signal that pasting the report number will tighten the answer — so users see the worst estimate without knowing it's the worst.
6. **No persistence / comparison / export.** A jeweler pricing inventory can't save stones, compare side by side, or export a price list. Every calc is ephemeral.
7. **Single-file architecture causes pricing bugs.** Pricing logic is duplicated between `index.html` and `comp-engine-v3.js`; the residual-anchor reconstruction is reimplemented in JS from Python. This drift is not cosmetic — it is the *mechanism* behind the stale-model and anchor-mismatch bug classes.

---

## 6. Recommendations (ordered by impact-to-effort)

### Tier 0 — fixes that unblock everything else

**R0.1 Build one reconciliation layer → one number + band.**
Treat baseline, comp-engine estimate, and ML guess as three features of a small **stacking meta-model** (or, as a transparent v1, a confidence-weighted blend whose weights depend on comp support and carat bucket). Output a single fair-wholesale value. This is the keystone: it fixes §2, §3.1 (now there's one thing to calibrate), and §5.1 simultaneously.

**R0.2 Calibrate uncertainty for real, then show it.**
Replace `SIGMA_CALIBRATION_FACTOR = 2.0` with **split-conformal prediction**: on a held-out set, compute the residual quantile that yields true 80% coverage, and use that. Publish the honest sentence — "our 80% band held the true price 80% of the time on N holdout stones" — and make the band the *primary* UI element. This is cheap once a holdout exists and turns the tool from "looks confident" to "is trustworthy."

**R0.3 Surface the explainability waterfall.**
The comp engine already returns `primaryComp`/`support`/`rejected`/score components. Render them as a per-result waterfall. Near-zero modeling cost, very high trust payoff.

### Tier 1 — model correctness

**R1.1 Switch the core regressor to monotonic gradient boosting.** LightGBM/XGBoost with per-feature monotone constraints on carat and the color/clarity ordinals. Retires the hand-fitted `g_tail`, fixes large-carat extrapolation natively, and likely lowers MAPE. Keep exporting to the same JSON-tree browser format (both libraries export tree structure; the browser walker barely changes).

**R1.2 Acquire realized-transaction data and learn the list→transaction factor.** Stand up capture for eBay sold, auction results, and TikTok-live sale prices (you already trust one). Re-estimate the `1.25` Messi→StarGem and the list→paid discount as **learned, segmented** factors with their own uncertainty, not single constants. This is the change that most aligns the model with the actual seller question.

**R1.3 Implement the specialty-cut gating model.** The diagnosis doc's own P3: 传统切/冰花切 are different products with different buyers. Either two models behind a gate or a hard `Cut_Style_Group` routing, so standard and specialty stop interpolating into each other.

**R1.4 Harden the residual-anchor contract.** Generate the coarse lookup table **once** as a shipped artifact that both Python and JS consume (no reimplementation), add a CI test asserting JS and Python return identical anchors on a golden grid, and replace the silent `lookupRate = 1` fallback with an explicit low-confidence/no-anchor path.

### Tier 2 — pipeline & data discipline

**R2.1 Model registry + faithful compact export.** Version every model (id, train date, per-segment metrics, *actual* shipped tree count). Select the browser subset by drift-minimization or distillation — never first-N-trees. Add a CI check that deployed-JSON metadata matches its contents (this exact mismatch already shipped).

**R2.2 Per-segment validation gate + pinned regression cases.** Fail any export where a pinned commodity cell or a carat/shape/cut segment regresses, not just global MAPE. The pinned cases already exist in the docs — promote them into the pipeline.

**R2.3 Automated data-quality gates.** Scrub the documented $19/ct 5ct+ outlier and add unit-error/outlier detection on ingest. Treat the comp index as a dated, decaying dataset (lab prices fall fast) and down-weight stale comps.

**R2.4 Close the feedback loop.** Capture "actual paid/sold" and user overrides (even a lightweight CSV/endpoint). Feed anonymized corrections back as training signal. This is what turns the app into a self-improving asset.

### Tier 3 — pricing methodology & UI polish

- **R3.1** Make cost-basis channel explicit and seller-default-aware (importer vs factory).
- **R3.2** Learn channel markups as functions of carat/shape/saturation instead of fixed constants.
- **R3.3** Add a liquidity / days-to-sell signal from comparable-listing counts you already capture.
- **R3.4** Implement the hybrid magic-weight (continuous curve + learned threshold premium).
- **R3.5** Accessibility pass: real `<button>`/`<input>` controls, ARIA, focus rings, keyboard nav, text/icon redundancy on color pills.
- **R3.6** Inventory features: save, compare, export to price-list / appraisal PDF.
- **R3.7** Refactor the calculator to import the *same* `comp-engine-v3.js` the tests use, eliminating production/engine drift.

---

## 7. Suggested roadmap

| Priority | Item | Area | Rationale |
|---|---|---|---|
| **P0** | Reconciliation → one number + band (R0.1) | ML/UI | Keystone; everything downstream needs one estimate to calibrate |
| **P0** | Conformal calibration + show the band (R0.2) | ML/UI | Fixes the 20–30% vs 80% coverage lie; cheap once holdout exists |
| **P0** | Explainability waterfall (R0.3) | UI | Near-free trust win from data already returned |
| **P1** | Monotonic GBM core (R1.1) | ML | Retires hand-fit tail, fixes extrapolation, lowers MAPE |
| **P1** | Transaction data + learned source factor (R1.2) | ML/Data | Aligns model with the real seller question |
| **P1** | Residual-anchor contract hardening (R1.4) | Eng/ML | Kills the silent-multiplier bug class |
| **P1** | Specialty-cut gating (R1.3) | ML | Removes largest documented error source |
| **P2** | Model registry + per-segment gate + faithful export (R2.1, R2.2) | Eng | Prevents stale-artifact / segment-regression bugs |
| **P2** | Feedback loop + data-quality gates (R2.4, R2.3) | ML/Data | Self-improving dataset; stops typos training the model |
| **P2** | Accessibility (R3.5) | UI | Correctness/inclusivity, contained effort |
| **P3** | Liquidity signal, learned markups, hybrid magic-weight, inventory/export, engine refactor | Pricing/UI/Eng | Polish once the core is calibrated and trustworthy |

---

## 8. Bottom line

The hard, risky work is largely done: a real hybrid methodology, candid ML failure-mode diagnosis (S7→S20), live comp data, IGI enrichment, and a now-real local carat-curve fit in the comp engine. The model is *accurate on its training surface*. The gaps are about **convergence, calibration, and trust**, not raw horsepower:

1. **Collapse four competing numbers into one fair-wholesale estimate with a band** (no arbiter exists today).
2. **Calibrate that band honestly** — the code admits 20–30% coverage on an "80%" interval driven by a hard-coded `2.0` fudge; conformal prediction fixes this cheaply.
3. **Anchor the model to realized transaction prices**, since the seller's question is about real money paid and received, not factory list, and the current `1.25` constant is doing too much load-bearing work.
4. **Make the UI lead with one answer + visible confidence + a "why" waterfall**, and close the feedback loop so daily use makes the model better.

Do the three P0 items and the app moves from "impressive internal pricing research" to "a number a jeweler will stake a purchase on."
