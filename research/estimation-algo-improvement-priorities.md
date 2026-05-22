# Estimation Algorithm Improvement Priorities

Last reviewed: 2026-05-22

Source notes:

- `research/comp-engine-v3-implementation-critique.md`
- `research/current-pricing-model-how-it-works.md`

## Executive Summary

The highest-value path is not to immediately add a more complex pricing formula. The model first needs a trustworthy feedback loop, then better handling of source dominance, then data-driven carat behavior where the comp data can support it.

Recommended priority order:

1. P0: Make evaluation and calibration trustworthy.
2. P1: Add source-aware blending and supplier weight control.
3. P1: Learn local carat curves where data supports it.
4. P2: Improve shape and style segmentation.
5. P2: Normalize fancy color and derivable schema fields.
6. P3: Clean up legacy fallbacks and improve explainability.

The main reason for this order is that the current engine already has a meaningful nearest-comp system: it scores comps, adjusts them in log price space, rejects outliers, and blends multiple observations. The biggest current risk is that the model can look precise while being under-calibrated, source-skewed, or extrapolating from weak support.

## P0: Make Evaluation And Calibration Trustworthy

### Why This Is P0

Every later algorithm change needs a reliable way to prove whether it helped. The current backtest is the most valuable recent addition, but the critique shows it should be treated as a first draft rather than final proof.

Important issues from the source notes:

- The wrapper test script is currently broken because `compErrorScore` now returns an object instead of a number.
- The backtest exposes more than large-carat extrapolation. It also shows shape-family and supplier holdout risk.
- P80 coverage is materially under target, which means the displayed estimate intervals are too narrow.
- The backtest duplicates some inference logic instead of importing the same parser used by the engine.
- Production logic in `index.html` mirrors `research/comp-engine-v3.js`, which creates drift risk.

This is the top priority because inaccurate measurement can make the next model iteration look better while actually making production estimates worse.

### Acceptance Criteria

- The full engine test suite and wrapper test script pass.
- Backtest output reports error, bias, and interval coverage by white/fancy, carat band, shape family, clarity band, and supplier/source.
- Reported low/high ranges are empirically calibrated or explicitly labeled as uncalibrated.
- Production `index.html` and `research/comp-engine-v3.js` either share logic or are tested against the same golden cases.
- Any algorithm change can be compared against the previous version using the same repeatable evaluation command.
- The backtest clearly distinguishes interpolation, near-extrapolation, and unsupported extrapolation cases.

### General Instructions

Use the backtest as the model gate. Do not treat one aggregate accuracy number as sufficient. Track both point estimate error and confidence interval honesty. Prioritize eliminating test drift, parser drift, and research/production drift before judging deeper pricing changes.

## P1: Source-Aware Blending And Supplier Weight Control

### Why This Is P1

The current supplier cap is useful, but it is only a selection cap. It limits how many comps from one supplier can enter the ensemble, but it does not guarantee that supplier cannot dominate the final blended estimate once inverse-variance weighting is applied.

This matters because the backtest is leave-one-supplier-out. That means it is measuring cross-supplier generalization, not just product-level interpolation. If one supplier has a different pricing basis, the model can become overconfident when it transfers that supplier's price level to another supplier or to the broader market.

There is also an exact-match tradeoff. Applying a hard supplier cap before exact-match selection can discard useful exact support when one supplier has multiple same-spec rows.

### Acceptance Criteria

- No single supplier or source group can dominate the blended estimate unless the result is explicitly marked as source-concentrated.
- Exact same-spec observations are not unnecessarily discarded by broad fallback-comp caps.
- Estimate output exposes source concentration and its confidence impact.
- Supplier holdout backtests show reduced worst-case errors or clearer uncertainty widening for source-transfer cases.
- Source identity is normalized once during comp-index generation rather than repeatedly inferred in the engine, browser code, and backtest.

### General Instructions

Treat supplier/source as part of uncertainty, not just as a row-filtering concern. Separate selection diversity from blend-weight diversity. Preserve useful exact support while preventing weak fallback comps from overrepresenting one supplier's pricing basis.

## P1: Learn Local Carat Curves Where Data Supports It

### Why This Is P1

The current model has continuous-ish behavior, but it is not yet fitting a local pricing function per market segment. White diamond pricing still relies on a fixed anchor table and linear interpolation. Fancy color diamonds use hand-authored 1ct baselines and power-law exponents. The v3 comp engine adjusts comp prices using fixed carat priors rather than a learned local curve.

The critique shows large-carat extrapolation is a real problem, but not the only one. A 3.2ct pear VVS1 G was the worst listed miss, which suggests carat behavior, shape transfer, and supplier transfer interact.

This priority is high because carat is one of the largest price drivers, and the current simple extrapolation above anchor ranges can create very large misses.

### Acceptance Criteria

- Supported market segments can use data-driven local carat behavior instead of only fixed priors.
- Low-support segments shrink back toward conservative priors instead of pretending a local curve is well known.
- Large-carat, mid-carat, and threshold-adjacent cases are evaluated separately.
- Exact and near-exact comp cases do not regress.
- Magic-weight behavior around 1ct, 1.5ct, 2ct, 3ct, 4ct, and 5ct is explicitly validated.
- Estimates widen uncertainty when carat behavior is extrapolated from sparse or distant support.

### General Instructions

Add learned carat behavior only where there are enough independent comp knots. Prefer conservative fallback and uncertainty widening over aggressive curve fitting. Keep the existing hand-authored priors as shrinkage anchors rather than discarding them immediately.

## P2: Improve Shape And Style Segmentation

### Why This Is P2

Shape is currently represented mostly through fixed multiplier tables and compatibility buckets. That is useful, but it does not capture enough about how shape interacts with carat, color family, cut style, and supplier market segment.

The backtest critique specifically says the worst misses are not only a data gap above 7ct or 10ct. Shape-family transfer is also material. This suggests the engine sometimes borrows information across shapes too confidently.

This is P2 rather than P1 because better segmentation depends on the P0/P1 measurement work. Without trustworthy backtests and source controls, it is difficult to know whether a new style grouping is improving estimates or just overfitting.

### Acceptance Criteria

- Shape transfer error is measurable by shape family and carat band.
- Shape adjustments are not treated as equally reliable across all color, clarity, and carat contexts.
- White and fancy shape behavior can diverge where data supports it.
- The model can identify when a shape estimate is based on weak cross-shape support.
- Estimate output communicates when shape/style transfer is a major source of uncertainty.

### General Instructions

Do not start with a large style ontology. Begin with immediately useful groupings that the current data can support: shape family, faceting/cut family, elongated versus non-elongated, and fancy-color-retaining shapes. Let the backtest determine whether each grouping earns its complexity.

## P2: Normalize Fancy Color And Derivable Schema Fields

### Why This Is P2

A broad schema project would be low value if it adds many empty fields. But the current data already contains useful fields in places, such as `sourceKey`, `sourceRows`, `sourceType`, `supplier`, `reportNos`, `appColorKey`, `colorHue`, and `colorIntensity`.

Normalizing these fields would improve matching, source controls, fancy color parsing, and backtest consistency. This is valuable because the current system appears to repeat parsing and inference in multiple places.

This is P2 because it supports the model improvements above, but it is not by itself the biggest pricing accuracy unlock.

### Acceptance Criteria

- Supplier/source identity is available as normalized comp-index metadata.
- Fancy color rows have consistent hue and intensity keys where those values are derivable.
- Backtest, engine, and UI consume the same normalized fields.
- No speculative fields are added unless they affect scoring, blending, filtering, calibration, or reporting.
- Existing rows with partial color provenance retain that provenance through index generation.

### General Instructions

Only add normalized fields that are derivable now and useful immediately. Avoid hand-filling attributes the data does not contain. Prefer index-generation normalization over runtime reparsing.

## P3: Clean Up Legacy Fallbacks And Improve Explainability

### Why This Is P3

The model already exposes useful concepts like exact, nearest, best-available, fallback, support comps, rejected comps, and warnings. It also returns score components in the v3 engine. This is the right direction for transparency.

However, explainability should follow calibration. A clear explanation of an overconfident estimate can still mislead the user. Legacy fallback logic and UI labels should be cleaned up, but only after the model's uncertainty signals are more trustworthy.

This is P3 because it improves usability and debugging more than core estimate accuracy.

### Acceptance Criteria

- Estimate explanations show major drivers: comp quality, source concentration, carat extrapolation, shape/color adjustment, and interval confidence.
- Legacy fallback influence is visible and bounded.
- UI labels distinguish exact, nearest, fitted, extrapolated, and fallback estimates.
- Debug output helps diagnose misses without implying false precision.
- Score components are understandable enough to support review and tuning.

### General Instructions

Keep explanation work tied to real model signals. Do not make the UI sound more certain than the backtest supports. Prefer concise confidence language over detailed math in user-facing surfaces.

## Priority Rationale

### Why Calibration Comes Before Better Curves

A fitted curve can make estimates look smoother and more sophisticated while making holdout performance worse. The current model already blends comps and applies log-space adjustments, so the next accuracy win depends on knowing where it fails. Calibration turns model development into an evidence loop.

### Why Source Weight Comes Before More Schema

The available data is supplier-heavy. If the same supplier's pricing basis dominates the estimate, the model may confuse supplier policy with market price. Normalizing schema helps, but source-aware blending directly addresses a known failure mode from the critique.

### Why Carat Curves Come Before Shape Ontology

Carat is one of the largest price drivers and is currently handled with fixed priors. Learning local carat behavior has a clear target and clear backtest metrics. Shape/style modeling matters too, but it should be introduced incrementally after the evaluation framework can show whether new groupings are actually improving transfer behavior.

### Why Explainability Is Later

Explainability is important, especially for pricing trust. But the explanation should reflect calibrated model signals. Otherwise, the UI risks explaining an estimate with more confidence than the underlying model deserves.

## Suggested Roadmap

### Phase 1: Evaluation Foundation

- Fix the broken wrapper tests.
- Remove parser duplication from the backtest where practical.
- Add segmented backtest reporting.
- Establish golden cases for research and production parity.

### Phase 2: Source And Confidence Controls

- Normalize supplier/source identity at index-generation time.
- Add source concentration reporting.
- Distinguish supplier selection diversity from supplier blend-weight diversity.
- Recalibrate intervals with source-transfer risk included.

### Phase 3: Local Carat Behavior

- Add data-driven carat behavior only for sufficiently supported segments.
- Use conservative shrinkage for sparse segments.
- Validate threshold-adjacent behavior around major carat marks.
- Track large-carat and shape-transfer misses separately.

### Phase 4: Style Segmentation And Fancy Color Normalization

- Normalize fancy hue/intensity fields where derivable.
- Add measured shape-family transfer reporting.
- Introduce only the style groupings that improve holdout performance.

### Phase 5: Production Explainability

- Clarify fallback and extrapolation labels.
- Surface the most important uncertainty drivers.
- Keep confidence language aligned with measured calibration.

## Bottom Line

The best next work is to make the algorithm more measurable, less source-dominated, and more data-driven around carat behavior. Schema and explainability still matter, but they should serve those goals rather than become standalone projects.
