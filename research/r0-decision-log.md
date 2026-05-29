# R0 Decision Log

**Created:** 2026-05-28  
**Scope:** Decisions needed to unblock Stage 0 and Stage 1 implementation.

## DL-001 - Channel Toggles

**Decision:** Apply seller/channel toggles after reconciliation in R0.1 v1.

**Reasoning:** The R0 estimand is factory-list-anchored fair wholesale before channel-specific adjustments. Existing `compute()` applies China, HPHT, CVD, as-grown, and related flags to the baseline wholesale path. Keeping these outside the reconciler makes the blended source contract cleaner and avoids training/calibrating one object while displaying another.

**Follow-up:** Stage 2 UI copy should avoid implying that the reconciled estimate already includes all seller-specific negotiation conditions unless the post-reconcile modifier is shown.

## DL-002 - Retail Range Source

**Decision:** Keep retail range derived from the legacy baseline path for R0.1 v1.

**Reasoning:** R0.1's first trust fix is the wholesale headline. Retail range changes affect a different user promise and should wait until the reconciler has a backtest and founder review.

## DL-003 - Lookup Reconstruction

**Decision:** Do not use lookup reconstruction as a v1 reconciler input.

**Reasoning:** The R0.1 source list is baseline, comp, and ML. Lookup reconstruction is correlated with ML/anchor behavior and would make weights look more independent than they are.

**Follow-up:** Keep lookup output as diagnostic/supporting context under the explanation section.

## DL-004 - R0.2 Calibration Order

**Decision:** R0.2 may calibrate comp-engine intervals first, but hero-calibrated bands wait for stable R0.1 residuals.

**Reasoning:** Comp-only calibration is valuable and can run in parallel, but a calibrated comp interval should not be presented as the band around a reconciled hero estimate.

## DL-005 - R0.3 Scope

**Decision:** R0.3 v1 is a comp market waterfall.

**Reasoning:** Existing engine output already has `primary`, `supportComps`, `rejectedComps`, and `parts`. A reconciled waterfall requires `ReconcileResult.weights`, so it belongs after Stage 1/2.

## DL-006 - Heuristic Band Language

**Decision:** `bandKind: "heuristic"` is labeled "Likely range" or "estimated spread"; it must not use "80% confidence" language.

**Reasoning:** The r0 docs repeatedly identify false interval confidence as the main trust risk. Only `bandKind: "conformal"` with a populated `calibration` block may use holdout coverage language.

## DL-007 - Parity Gate

**Decision:** Preserve the existing parity harness as the Stage 0 parity gate and add R0-specific fixtures before each implementation stage expands behavior.

**Reasoning:** `index.html` imports `research/comp-engine-v3.js` directly, and `research/scripts/parity-regression.mjs` already covers the shared comp engine. R0.1 needs new tests around the reconciler rather than a duplicate comp parity layer.

## DL-008 - Reconciler MdAPE Exception

**Decision:** Ship rules-v1 reconciliation even though the full supplier-reporting MdAPE table does not beat comp-only on every segment.

**Reasoning:** `backtest-reconciler.mjs --full` reports white MdAPE of 14.9% for reconciled rules-v1 versus 13.1% for comp-only, and fancy MdAPE of 38.3% versus 18.3% on only 5 reporting rows. R0's product goal is one user-facing estimate with calibrated band language; the reconciled conformal artifact meets the white reporting coverage gate at 80.04%. Learned stacking remains the planned v2 path for MdAPE improvement once out-of-fold features are formalized.

## DL-009 - Baseline Fallback Only

**Decision:** Do not blend the hand-tuned baseline curve into the reconciled wholesale headline when either comp or ML is usable. Baseline is a last-resort fallback only when both market sources fail.

**Reasoning:** For liquid white goods with exact comps, the anchor ladder systematically sits above verified supplier rows and was pulling the headline up while lowering confidence. ML and comp already encode supplier behavior; a parallel trained baseline would largely duplicate ML. The UI still shows the baseline ladder as a reference value when it is omitted from the blend.

## DL-010 - Liquid Round Conformal + ML Cap

**Decision:** Use conformal sub-segment `white_round_1_2` (1.00–2.00ct round white) with smaller `qLog`, apply support tightening when confidence is high, and cap ML reconciler weight to 18% when comp is exact or nearest with adequate support.

**Reasoning:** Holdout bands at `qLog ≈ 0.29` produced ~±35% widths on the most common SKUs. Sub-segment calibration and high-support tightening target ~±15–20% on liquid rounds without breaking the 80% coverage goal on reporting folds. ML is trained on StarGem list rates, not Alibaba floor; capping its blend weight when comp is strong keeps the headline aligned with the floor. See `research/round-1-2ct-ml-vs-comp-divergence.md`.
