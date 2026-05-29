# R0 Staged Implementation Plan

**Created:** 2026-05-28  
**Status:** Stage 0 implemented in this pass  
**Primary inputs reviewed:** `r0-master-implementation-roadmap.md`, `roadmap-expansion-r0.1-reconciliation-layer.md`, `roadmap-r0.2-conformal-calibration-plan.md`, `roadmap-expansion-r0.2-conformal-calibration.md`, `roadmap-r0.3-explainability-waterfall-expansion.md`

## Goal

Ship R0 as one coherent pricing trust program:

1. One reconciled wholesale estimate.
2. One honestly labeled range.
3. One expandable explanation of how the estimate was built.

The first implementation stage should freeze contracts before UI or model changes. That keeps R0.1, R0.2, and R0.3 from inventing incompatible shapes.

## Stage 0 - Contract Baseline

**Implemented now.**

Deliverables:

- `research/schemas/reconcile-input.schema.json`
- `research/schemas/reconcile-result.schema.json`
- `research/data/conformal-holdout-split-v1.json`
- `research/fixtures/reconciler-pinned.json`
- `research/r0-decision-log.md`

Decisions locked for v1:

- Channel toggles stay after reconciliation.
- Retail remains legacy baseline-derived until R0.1 backtests prove a better replacement.
- Lookup reconstruction is diagnostic only, not a v1 reconciler input.
- R0.2 starts as comp-only conformal calibration, then wraps reconciled residuals after R0.1 is stable.
- R0.3 v1 is explicitly comp-scoped until `ReconcileResult.weights` is wired into production.

Acceptance:

- Schemas validate the public contract shape for R0.1/R0.2/R0.3.
- Holdout manifest names frozen calibration and reporting supplier groups.
- Pinned fixture gives coding agents a concrete target object and vocabulary.
- Decision log resolves the blockers called out in the master roadmap.

## Stage 1 - R0.1 Rules Reconciler

Implement a pure, testable reconciler without UI churn first.

Files:

- `research/reconcile-price.js`
- `research/data/reconciler-config-v1.json`
- `research/scripts/reconcile-price.test.mjs`

Core behavior:

- Build a `ReconcileInput` from baseline, comp, and ML outputs.
- Blend available source totals in log space.
- Weight by source quality, source-specific sigma, comp support, ML anchor hit, segment, and disagreement.
- Emit `ReconcileResult` with `bandKind: "heuristic"` and no conformal claims.
- Warn on thin comps, missing ML, missing baseline, or source disagreement above threshold.

Acceptance:

- Works when one or two source inputs are null.
- Weights over available sources sum to approximately 1.
- `low < estimate < high`.
- `bandKind` is `heuristic`.
- No user-facing or code string claims "80% confidence" for heuristic bands.

## Stage 2 - R0.1 UI Wiring

Wire the result into the app after the pure function is stable.

Files:

- `index.html`
- Reconciler import path from Stage 1

Core behavior:

- Rename the first price panel to "Estimated wholesale".
- Show reconciled range and confidence chip.
- Move comp, ML, and lookup details into "How this estimate was built."
- Preserve existing comp market bar while labels make clear it explains the comp path.

Acceptance:

- Hero renders with and without comp data.
- Existing retail and comp bars continue to work.
- No calibrated copy appears unless `bandKind === "conformal"` and `calibration` exists.

## Stage 3 - R0.3 Comp Waterfall

Use existing comp-engine output to add visible math.

Files:

- `research/comp-waterfall.js` or in-HTML MVP if keeping scope tiny
- `research/scripts/comp-waterfall.test.mjs`
- `index.html`

Core behavior:

- Convert `primary.parts`, `supportComps`, and `rejectedComps` into a waterfall data model.
- Render collapsed comp explanation in `#market-bar`.
- Label confidence as match quality, not interval coverage.

Acceptance:

- Panel only renders when `matchType !== "none"` and a primary comp exists.
- Rejected comps are visible with reasons.
- Multipliers are shown as multiplicative steps.

## Stage 4 - R0.2 Comp Conformal Calibration

Calibrate comp intervals using the frozen split manifest.

Files:

- `research/scripts/fit-conformal-calibration.mjs`
- `research/data/conformal-calibration-v1.json`
- `research/comp-engine-v3.js`

Core behavior:

- Fit fixed segment `qLog` values on calibration suppliers.
- Report coverage on reporting suppliers only.
- Emit calibration metadata from `resolveAlibabaComp`.
- Replace uncalibrated interval copy in comp context.

Acceptance:

- Reporting P80 lands in the agreed tolerance or the artifact records why not.
- UI reads calibration metadata from the engine, not duplicated constants.

## Stage 5 - Integrated R0

Wrap the reconciled point estimate with calibrated residual intervals and connect the final explanation.

Core behavior:

- Fit conformal residuals around `reconcileWholesale().estimate`.
- Switch hero result to `bandKind: "conformal"` when artifact exists.
- Add reconciled source-weight section to the explanation panel.

Acceptance:

- Hero estimate, band, and "show the math" all describe the same object.
- Methodology copy states that calibration is against supplier catalog/list prices.

## Stage 6 - Optional R0.1 v2 Stacking

Only after Stage 1 backtest output exists, train a ridge meta-model on out-of-fold predictions.

Core behavior:

- OOF predictions only.
- Feature flag for stacking.
- Keep `ReconcileResult` contract unchanged.

Acceptance:

- Reconciled MdAPE beats or ties comp-only by segment, or exception cases are documented.
