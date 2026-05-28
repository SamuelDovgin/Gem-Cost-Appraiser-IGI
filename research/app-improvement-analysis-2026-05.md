# Gem Appraise — Gap Analysis & Improvement Recommendations

Author: AI review pass
Date: 2026-05-28
Scope: pricing/ML methodology + UI/UX, for the lab-grown diamond seller-pricing use case
Reviewed sources: `index.html`, `research/comp-engine-v3.js`, `research/current-pricing-model-how-it-works.md`, `research/starsgem-ml-training-diagnosis-and-retrain-plan.md`, `research/color-diamond-ml-results.md`, `research/data/*`

---

## 1. What the app is today (one-paragraph recap)

Gem Appraise is a single-page calculator (`index.html`, ~5,500 lines of vanilla JS) that, for a lab-grown diamond, estimates: (a) wholesale cost — "what they paid", (b) a fair direct/auction ask, and (c) a retail ceiling range. The price is produced by a **hybrid** of four layers that mostly run in parallel rather than as one model:

1. **Hand-authored baseline** — a fixed E/VS1/Round/Ideal anchor ladder with linear interpolation for white, and power-law (`ws1 × carat^scale`) curves for fancy color, multiplied by fixed color/clarity/shape/cut tables and seller/treatment modifiers.
2. **Comp Engine v3** — scores live Alibaba/Messi/StarGem comps, adjusts each to the query in log-price space, rejects outliers, and inverse-variance-blends them into a market floor/sanity range.
3. **ML overlays** — Extra Trees models (StarGem white "S20", color-diamond model) shown as a separate "Best ML price guess" card, not folded into the wholesale number.
4. **Seller-channel markups** — fixed multiplier ranges (China 1.3–1.6×, auction 1.2–1.45×, standard 1.55–2.05×) plus cert cost.

The methodology is well-documented and the team has clearly thought hard about ML failure modes (the S7→S18→S19→S20 diagnosis trail is excellent). The gaps below are about **what would make it materially more accurate, trustworthy, and usable** — not basic correctness.

---

## 2. Gaps in the ML / predictive model

### 2.1 The four pricing layers are not reconciled into one number
This is the single biggest conceptual gap. The user is shown a baseline wholesale, a comp-engine floor, *and* a raw ML guess that can disagree by 30–50% (the documented 3ct ROUND E VS1 case: baseline vs comp vs S7 ML spanned ~$326–$478). There is no learned arbiter that says "given these three estimates and their confidences, the blended fair wholesale is X ± Y." The user is left to eyeball three numbers.

**Why it matters for sellers:** a jeweler pricing a stone wants *one defensible number with a band*, not a panel of competing estimates they have to reconcile by hand.

### 2.2 The baseline anchors are static and manually maintained
`baseWhitePerCt()` is a hand-chosen ladder (0.5ct→$70 … 10ct→$527) and fancy colors are hand-authored `ws1`/`scale` priors. The docs themselves note this is "not fitted dynamically from comps." Consequences:
- Anchors drift out of date as the lab-grown market keeps falling (prices have dropped ~70% in 3 years; a static ladder ages fast).
- There is no automated job that re-fits anchors when new supplier sheets land. Re-anchoring is a manual code edit (the v3.1 E/VS1 re-anchor was a hand change).

### 2.3 No honest, holdout-validated uncertainty on the *final* price
The comp engine produces an 80% interval via `exp(±1.28σ)` with a hard-coded `SIGMA_CALIBRATION_FACTOR = 2.0` — a fudge factor, not a measured coverage. The doc explicitly lists "calibrate uncertainty from enough historical holdout testing to say the range has a known coverage rate" as not-yet-done. The ML models report MAPE/MdAPE on validation, but those numbers are not surfaced as the band the *user* sees, and the baseline + channel-markup layers have **no** uncertainty at all.

### 2.4 ML is trained on supplier *list* prices, not transaction prices
StarGem/Messi sheets are asking/list prices on factory stock. The seller use case ("what did they pay", "what's a fair resale") depends on *realized transaction* prices, which are systematically below list and vary by negotiation, volume, and channel (the `jeweler-sourcing-ecosystem.md` doc itself notes a 15–40% spread). The model therefore predicts "factory list surface", and the 1.25× Messi→StarGem source factor is a single hand-measured constant papering over real source dispersion. There's no calibration against actual sold/paid data (eBay sold, auction results, TikTok live sale prices like the LG563297279 anchor — currently used as a single manual calibration point, not a dataset).

### 2.5 Known training-distribution problems are only partially fixed
The diagnosis doc is candid about these; they remain live risks:
- **Out-of-distribution inference state.** Before an IGI report is parsed, growth method is `"-"` and dimensions are median-imputed — a state the model wasn't naturally trained on. S19/S20 added missingness flags and selected-spec augmentation, which is the right fix, but it's still a two-mode hack rather than a principled missing-data model.
- **Specialty-cut contamination.** Chinese cut labels (传统切/冰花切 etc.) command up to 2× and are sparse (~300 rows total), so trees miss the splits. S20 added `Is_Specialty_Cut`/`Cut_Style_Group` features, but the doc's own recommendation of *separate models or a gating layer* for specialty vs standard products hasn't been done.
- **Large-carat tail (10ct+, CV up to 78%).** S20 added a monotonic parametric tail, which is good, but it's anchored on very thin data (443 stones) and rare fancy-shape × color × clarity cells can be 3–6× apart.
- **Data-quality outliers.** The doc flags a $19/ct entry in the 5ct+ bucket as a likely typo that should be scrubbed; there's no automated outlier-detection gate in the training pipeline.

### 2.6 Compact browser export is fragile
The deployed artifact has historically been a "first-N-trees slice" of a larger ensemble, which is biased (the 10-tree artifact averaged EX-like leaves and overpriced by ~$150). The fix (distill / drift-minimizing subset selection) is described but the export still ships large JSON trees to the browser. There's no model-versioning/registry discipline — `index.html` fetches a model by hard-coded filename + `?v=` query string, and a stale slice once shipped with `treeCount: 200` metadata that was actually 10 trees.

### 2.7 No feedback loop / no learning from corrections
The app is one-directional: inputs → price. There's no mechanism to capture "actual sale price" or "user-corrected this estimate", so the model never improves from real-world outcomes. Every improvement requires a manual capture → re-train → re-export cycle.

### 2.8 Coverage is thin in the dimensions that matter most for fancy color
The color model trains on 1,657 rows with only 5 direct StarGem anchors and 1 orange-hue example. Its 3.12% validation MAPE is impressive but almost certainly optimistic given the 1.25× source adjustment is applied to nearly all rows and rare hues/intensities are barely represented. Rare-color large stones are exactly where pricing errors are most expensive and the model is weakest.

---

## 3. Gaps in pricing methodology (seller-specific)

### 3.1 "What they paid" assumes catalog sourcing
The wholesale estimate is anchored to factory-direct (Alibaba/Messi/StarGem) list prices. But most jewelers selling lab-grown didn't buy factory-direct — they bought from a US/EU importer at +20–35% (per `jeweler-sourcing-ecosystem.md`). So "what they paid" is often understated for the actual seller population. The China toggle exists but the *default* assumption matters and isn't framed for the seller's real cost basis.

### 3.2 Seller-channel markups are fixed constants, not learned or contextual
1.55–2.05× standard, 1.2–1.45× auction, etc. are reasonable heuristics but don't flex with carat, shape desirability, or how saturated that segment is. A 0.5ct round and a 5ct fancy pink almost certainly carry different optimal resale multiples.

### 3.3 No demand/liquidity signal
Price ≠ sellability. A jeweler cares whether a stone will actually move at the suggested ask. The app has no liquidity/days-to-sell signal, no "how many comparable stones are currently listed" (which the captured Alibaba data could partly support), and no seasonality.

### 3.4 Magic-weight handling is a smooth ramp, not market-real
The doc notes real diamond pricing has *psychological steps* at 1/1.5/2/3ct, but the model uses a smooth taper to zero at the threshold. The doc's own recommendation (hybrid: continuous curve + explicit threshold premium/discount) hasn't been implemented.

### 3.5 Treatment/origin modifiers are coarse single multipliers
HPHT 1.08×, CVD 0.90×, post-treatment 0.94× are blunt. In reality these interact with color/clarity (post-growth HPHT treatment matters far more for certain color grades) and the multipliers are uniform across carat and grade.

---

## 4. Gaps in UI / UX

Observed from the markup: a polished dark luxury theme, but the HTML is almost entirely `<div>`-based — a content grep found only ~19 combined semantic/`<button>`/`aria`/`role` matches across the whole 5,500-line file. Specific gaps:

### 4.1 Competing numbers, no clear hierarchy
As noted in 2.1, the results panel shows wholesale, retail, "best ML guess", StarGem lookup reconstruction, and a comp floor bar. For a non-expert seller this is cognitively heavy. There's no single hero answer with a "show the math" disclosure.

### 4.2 Accessibility is weak
Pills/toggles appear to be clickable `<div>`s, not real `<button>`/`<input>` controls with ARIA, meaning keyboard navigation and screen-reader support are likely broken. No visible focus management strategy, and color is used as the primary signal (color-family pills) without text/pattern redundancy.

### 4.3 Uncertainty isn't communicated visually
The model has confidence tiers and ranges internally, but the UI leads with point estimates. Sellers should *see* the band and the basis ("estimated from 4 comps, low confidence") prominently, not buried.

### 4.4 No "why this price" explainability surface
The methodology footer explains tiers generically, but there's no per-result breakdown ("baseline $X, comps pulled it +8%, your color grade −12%, specialty cut +40%"). For a tool whose value is *trust*, this is a missed opportunity — and the data to build it already exists in the comp engine's returned `support`/`rejected`/`primaryComp` objects.

### 4.5 No persistence, comparison, or export
A jeweler pricing inventory can't save stones, compare several side by side, or export a price list / PDF appraisal-style sheet. Each calculation is ephemeral.

### 4.6 IGI lookup UX friction
The flow relies on pasting a report number and fetching a PDF; before that parse completes the model is in its weakest (selected-spec, imputed-dimensions) state — and the UI doesn't strongly signal "estimate will sharpen once the cert loads."

### 4.7 Single-file maintainability ceiling
5,500 lines of HTML+CSS+JS in one file with pricing logic duplicated from `comp-engine-v3.js` means the production calculator and the canonical engine can silently drift. This is a UI/eng-velocity gap that directly causes pricing bugs (the stale-model-slice incident is an example of the same class of problem).

---

## 5. Recommendations

Grouped by area, roughly ordered by impact-to-effort within each group.

### 5.1 ML & predictive — highest leverage

1. **Build a single reconciliation/ensemble layer (stacking).** Treat baseline, comp-engine estimate, and ML guess as three features and learn a meta-model (or even a transparent weighted blend whose weights depend on comp support and carat bucket) that outputs *one* fair-wholesale number with a band. This directly fixes 2.1 and 4.1 and is the most valuable single change.
2. **Calibrate uncertainty against a real holdout and report empirical coverage.** Replace the hard-coded `SIGMA_CALIBRATION_FACTOR = 2.0` with a measured calibration: split data, compute what interval width actually achieves 80% coverage, and publish "our 80% band contained the true price 80% of the time on N holdout stones." Show that band as the primary UI output.
3. **Acquire and train on realized transaction prices, not just list prices.** Stand up capture for eBay sold listings, auction house results, and TikTok-live sale prices (you already use one such anchor manually). Re-estimate the list→transaction discount as a *learned, segmented* factor rather than the single 1.25× constant.
4. **Automate the anchor re-fit.** Add a job that re-fits `baseWhitePerCt` anchors and fancy `ws1`/`scale` priors from the latest supplier sheets on a schedule, with a diff/PR for human review. Stops the static ladder from aging.
5. **Implement the documented specialty-cut gating model.** Split standard vs specialty (传统切/冰花切/…) into separate models or a gating layer, per the diagnosis doc's own P3 recommendation. This is the cleanest fix for the heart-shape and large-fancy-shape CV blowups.
6. **Add automated data-quality gates to training.** Outlier detection (e.g., scrub <$50/ct for >3ct stones), unit-error detection, and per-carat-bucket / per-shape / per-cut MAPE in the validation output (the doc's P2 ask) so a model can't pass on global MAPE while broken on a segment.
7. **Model registry + faithful compact export.** Version models properly (id, train date, metrics, tree count actually shipped), and use drift-minimizing subset selection or distillation for the browser artifact — never first-N-trees. Add a CI check that the deployed artifact's metadata matches its contents.
8. **Close the feedback loop.** Let users record "actual sale/paid price" or correct an estimate; store anonymized corrections as future training signal. Even a lightweight CSV/endpoint capture turns the tool into a self-improving dataset.
9. **Expand fancy-color coverage and flag low-support cells.** Prioritize capturing more rare-hue/large-stone color anchors; until then, programmatically widen the band and show a "direct-quote recommended" warning when support is below a threshold (partly noted in the color doc — make it enforced in the UI).

### 5.2 Pricing methodology — seller-specific

1. **Make cost-basis channel explicit and seller-default-aware.** Ask/infer how the seller likely sourced (factory-direct vs importer) and adjust the "what they paid" basis accordingly, rather than defaulting to factory list.
2. **Learn channel markups instead of fixing them.** Fit resale-multiple as a function of carat, shape desirability, and segment saturation from comp/transaction data.
3. **Add a liquidity / sellability signal.** Use the count of comparable current listings (you capture this) to surface "easy to sell / slow mover" and an estimated days-to-sell, so the seller can trade price vs speed.
4. **Implement the hybrid magic-weight model.** Continuous fitted carat curve + explicit, data-learned threshold premiums at 1/1.5/2/3ct, per the pricing doc's own recommendation.
5. **Refine treatment/origin modifiers into interactions.** Let HPHT/CVD/post-treatment multipliers vary by color grade and carat instead of single global constants.

### 5.3 Data pipeline

1. **Treat the comp index as a living, dated dataset** with freshness tracking, and decay/down-weight stale comps in the engine (lab prices move fast).
2. **Schema-validate and de-duplicate on ingest** so capture sessions can't introduce silent contradictions (a maintenance doc exists; enforce it in code/CI).

### 5.4 UI / UX

1. **Lead with one hero number + band, then disclose.** Single "Fair wholesale: $X (likely $Y–$Z)" headline, with the comp/ML/baseline breakdown behind a "show the math" expander. Fixes the competing-numbers problem.
2. **Build a per-result explainability panel.** "Baseline $X → comps +8% → your color −12% → specialty cut +40% → estimate." The comp engine already returns `primaryComp`/`support`/`rejected`; surface them as a waterfall.
3. **Show confidence visually and always.** Band width, comp count, and a confidence chip on the primary result; widen and warn on low support.
4. **Fix accessibility:** convert clickable `<div>`s to real `<button>`/`<input>` controls, add ARIA labels/roles, ensure keyboard nav and focus rings, and add text/icon redundancy alongside color coding for the color-family pills.
5. **Add inventory features:** save stones, side-by-side comparison, and export to a clean price-list / appraisal-style PDF for the jeweler's customer-facing use.
6. **Improve the IGI flow:** make report lookup a first-class, prominent step and clearly signal "estimate sharpens once the cert loads" so users understand the selected-spec vs cert-loaded accuracy difference.
7. **Refactor the calculator out of the single HTML file** so it imports the *same* `comp-engine-v3.js` the research/tests use — eliminating the production/engine drift that caused the stale-model incident. (Eng-velocity + correctness, even if not user-visible.)

---

## 6. Suggested priority roadmap

| Priority | Item | Area | Why now |
|---|---|---|---|
| P0 | Reconciliation/ensemble → one number + band (5.1.1) | ML | Fixes the core "three competing numbers" trust problem |
| P0 | Calibrate & surface real uncertainty (5.1.2, 5.4.3) | ML/UI | Makes the tool defensible; cheap once holdout exists |
| P0 | Hero-number UI with explainability waterfall (5.4.1, 5.4.2) | UI | Highest user-perceived value, reuses existing engine output |
| P1 | Transaction-price data + learned source factor (5.1.3) | ML/Data | Aligns model with the actual seller use case |
| P1 | Specialty-cut gating model (5.1.5) | ML | Removes largest documented error source |
| P1 | Automated anchor re-fit + data-quality gates (5.1.4, 5.1.6) | ML/Data | Stops silent staleness and segment regressions |
| P1 | Accessibility fixes (5.4.4) | UI | Correctness/inclusivity; relatively contained effort |
| P2 | Liquidity signal + learned channel markups (5.2.2, 5.2.3) | Pricing | Differentiating seller features |
| P2 | Feedback loop capture (5.1.8) | ML | Turns the app into a self-improving dataset |
| P2 | Model registry + faithful compact export (5.1.7) | ML/Eng | Prevents stale-artifact class of bugs |
| P2 | Refactor calculator to import shared engine (5.4.7) | Eng | Eliminates production/engine drift |
| P3 | Hybrid magic-weight, treatment interactions, inventory/export (5.2.4, 5.2.5, 5.4.5) | Pricing/UI | Polish once the core is solid |

---

## 7. Bottom line

The hardest, riskiest work — a defensible hybrid pricing methodology, a candid ML failure-mode diagnosis, and real comp data — is largely done and well-documented. The biggest remaining wins are **convergence and trust**, not raw modeling horsepower:

1. **Reconcile the competing estimates into one calibrated number with an honest band.**
2. **Anchor the model to realized transaction prices, not just factory list prices**, since the seller use case is fundamentally about real money paid and received.
3. **Make the UI lead with one answer + visible confidence + a "why" breakdown**, and fix accessibility/persistence.

Do those three and the app moves from "impressive internal pricing research tool" to "a tool a jeweler would trust to price their inventory."
