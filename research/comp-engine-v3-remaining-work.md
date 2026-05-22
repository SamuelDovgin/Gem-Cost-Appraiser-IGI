# Comp Engine v3 - Remaining Work

Last reviewed: 2026-05-22

Related notes:

- `research/comp-engine-v3-gap-fixes-implementation.md`
- `research/estimation-algo-improvement-priorities.md`
- `research/comp-engine-v3-p0-p1-p1b-implementation.md`
- `research/comp-engine-v3-implementation-critique.md`

## Current State

Comp Engine v3 now has the main correctness and plumbing fixes from the P0/P1/P1b critique:

- supplier concentration caps are applied to final blend weight when multiple sources exist;
- one-source-only estimates are flagged honestly when no cap is mathematically possible;
- research and production behavior are much closer;
- local white-diamond carat curves are normalized before fitting;
- intervals are calibrated with a systematic floor and multiplier;
- source-row provenance labels no longer imply complete row coverage;
- the spreadsheet row viewer gives a clear message when opened directly from disk.

Current verification:

| Segment | MdAPE | Bias | P80 Coverage | Status |
|---|---:|---:|---:|---|
| White | 15.4% | +6.1% | 85.0% | Near target, slightly high error |
| Fancy | 37.6% | +20.7% | 78.6% | Still weak point accuracy |

The remaining work is less about obvious implementation bugs and more about model quality, calibration, and long-term maintainability.

## P0 - Remove Research/Production Drift Risk

**Full plan:** `research/p0-remove-research-production-drift-research.md` (tiered fixtures, warning normalization, micro-index strategy, false-positive playbook).

### What Is Left

`research/comp-engine-v3.js` and `index.html` still contain duplicated model logic (~1,825 vs ~808 mirrored lines). The May 2026 gap-fix pass aligned behavior (calibration, supplier cap, local carat curve, exact-floor semantics), but future edits can still land in one file only.

### Why This Matters

The backtest imports **only** the research module. The UI runs inline `v3*`. This is the highest operational risk for trusting any future P1/P2 tuning.

### Acceptance Criteria

- One shared source of truth **or** automated parity (minimum: Tier A + Tier C on every PR).
- **Tier A** (5): white exact, white 6ct extrapolation (T09 oval), fancy T16 pink, single-source synthetic, multi-source cap.
- **Tier B** (optional CI tier): `runTests()` T01–T29 queries on index slice or full index.
- Compare estimate, low/high, `supportComps`, `sourceConcentration`, `otherFactoryExact` (exact cases); warnings via normalized codes (raw strings differ today).
- `model_fallback` / legacy ceilings are production-only — not parity failures.
- PRs touching v3 logic fail CI if parity breaks.

### General Instructions

Prefer ES module import from `research/comp-engine-v3.js`. Otherwise: golden parity harness + sync markers (`// BEGIN V3 ENGINE SYNC`). See the full doc for entry-point mapping (`buildCompQueryFromState`), fixture JSON layout, and CI workflow sketch.

## P1 - Tune Local Carat Curve Usage

### What Is Left

The local carat slope fit is now cleaner because it normalizes color, clarity, and shape before fitting. However, the white backtest moved slightly in the wrong direction:

- before normalized slope fix: about 15.2% MdAPE;
- after normalized slope fix: 15.4% MdAPE.

This suggests the slope layer is less contaminated, but not yet well tuned.

### Why This Matters

Carat scaling drives many high-dollar errors. A small slope mistake at 5ct, 8ct, or 12ct can move the estimate by thousands of dollars. The current fit is more defensible statistically, but it needs stronger guardrails.

### Acceptance Criteria

- White MdAPE improves from the current 15.4% baseline without materially worsening bias or P80 coverage.
- Large-carat worst misses are reduced, especially above 5ct.
- Local slopes are used aggressively only when there is enough independent support.
- Extrapolated slopes are either heavily shrunk toward priors or disabled outside observed local carat support.
- The engine reports when local slope was used, ignored, shrunk, or treated as extrapolated.

### General Instructions

Run grouped backtests while varying slope confidence gates, shrinkage strength, carat binning, and extrapolation behavior. Treat large stones as their own risk area instead of assuming the same curve behavior that works from 1ct to 3ct also works above 5ct.

## P1 - Improve Fancy Color Point Accuracy

### What Is Left

Fancy color estimates remain the largest model-quality gap:

- Fancy MdAPE: 37.6%;
- Fancy bias: +20.7%;
- P80 coverage: 78.6%.

The widened ranges are close to honest, but the median estimate is still too noisy and biased high.

### Why This Matters

Fancy pricing is sparse, nonlinear, and highly sensitive to hue, intensity, modifier terms, and shape. A generic comp-distance model can avoid absurd matches, but it still needs better transfer logic to produce useful point estimates.

### Acceptance Criteria

- Fancy MdAPE improves materially from the current 37.6% baseline.
- Fancy bias moves closer to neutral without simply widening every range.
- Cross-intensity and cross-hue estimates show visible uncertainty penalties.
- Known risky transfers, such as brownish to pink or weak-intensity to vivid, are either rejected or heavily discounted.
- Worst-miss reporting identifies whether the error came from hue transfer, intensity transfer, shape transfer, carat extrapolation, supplier concentration, or sparse data.

### General Instructions

Calibrate fancy color separately from white diamonds. Add segment-specific transfer penalties for hue family, modifier terms, intensity rank, and shape/style. Keep sparse fancy ranges wide, but avoid allowing wide intervals to hide systematically biased median estimates.

## P1b - Add Better Source Independence Signals

### What Is Left

The engine now caps dominant supplier weight when there are multiple suppliers. But when every accepted comp comes from one supplier, it can only flag the concentration; it cannot create independent market evidence.

Also, source identity is still mostly supplier/product based. It does not fully distinguish:

- true single-SKU rows;
- repeated rows from the same product ladder;
- page-level range rows;
- MOQ-only rows;
- broad carat-band or clarity-band rows;
- stale source captures.

### Why This Matters

The model can be mathematically correct and still overtrust a supplier ladder that is not truly independent market evidence. Source independence is especially important in sparse fancy segments and large-carat white estimates.

### Acceptance Criteria

- Result metadata separates supplier count, product count, source-group count, and row/sample count.
- Single-source-only estimates receive a visible confidence penalty or range widening.
- Page-level ranges, MOQ-only rows, and broad band rows receive lower trust than SKU-specific rows.
- Product ladders from the same source cannot behave like fully independent market comps.
- Backtest output can show when an estimate was dominated by supplier concentration or weak source independence.

### General Instructions

Add source-quality fields during index generation and propagate them into scoring and blending. Avoid treating all rows as equal observations. Prefer transparent confidence penalties over hidden hard rejections unless a row is clearly invalid for the query.

## P2 - Calibrate Axis Sigmas And Score Cutoffs From Backtests

### What Is Left

Axis sigmas and score cutoffs are still partly seeded by judgment. The current tests validate behavior, but they do not fully prove that each axis penalty is numerically calibrated.

### Why This Matters

The scoring system controls both which comps are accepted and how much each comp influences the blend. If color, clarity, carat, shape, source, or fancy-intensity penalties are mis-sized, the engine can look reasonable in examples while failing by segment.

### Acceptance Criteria

- Backtests report error by score bucket and by major axis contribution.
- Accepted comp score bands correspond to observed prediction error.
- Hard cutoff and soft weighting choices are justified by held-out performance.
- P80 interval coverage stays near target by segment, not just overall.
- Calibration outputs make it clear which axes are over- or under-penalized.

### General Instructions

Use grouped holdouts, not random row holdouts that leak near-duplicate supplier ladders into both train and test. Tune white and fancy separately. Preserve readable score components so the UI can explain why a comp was accepted, down-weighted, or rejected.

## P2 - Upgrade Robust Blending

### What Is Left

The engine uses inverse-variance log-space blending with outlier handling and source caps. It does not yet use a robust estimator such as weighted median or Huber-style blending for all sparse/noisy cases.

### Why This Matters

Sparse marketplaces often have one or two bad-but-plausible comps. A robust estimator can reduce sensitivity to those comps without hard-rejecting useful evidence.

### Acceptance Criteria

- Blending is less sensitive to a single extreme accepted comp.
- Exact and near-exact matches remain tight when support is genuinely strong.
- Sparse estimates widen rather than overcommitting to one questionable row.
- Backtests show reduced worst-miss severity without worsening median accuracy.

### General Instructions

Compare current inverse-variance mean against weighted median and Huber variants on the same held-out queries. Keep the implementation understandable; the goal is not a complex optimizer, but a blend that fails more gracefully.

## P2 - Normalize Schema And Hard Gates More Fully

### What Is Left

Some normalized concepts exist implicitly or partially, but the engine still needs a more complete schema for:

- `gemSpecies`;
- `originType`;
- `growthMethod`;
- `majorTreatment`;
- `certificateLab`;
- `marketChannel`;
- `hue`;
- `intensityRank`;
- `colorModifierTerms`;
- `shapeFamily`;
- `facetingFamily`;
- `outlineFamily`;
- `aspectRatio`;
- `sourceGroup`;
- `sourceFlags`.

### Why This Matters

The more pricing logic depends on parsed strings, the easier it is to accidentally cross invalid market boundaries. Normalized fields make hard gates, scoring, backtesting, and UI explanations much more reliable.

### Acceptance Criteria

- Index generation emits normalized fields consistently for all supplier sources.
- Engine gates prevent invalid crosses such as natural vs lab-grown, major treatment mismatch, or incompatible market channel.
- Missing or low-confidence normalized fields are visible in result metadata.
- Tests cover both valid transfer cases and invalid hard-gate cases.

### General Instructions

Add schema fields at ingestion/index-generation time rather than repeatedly parsing in the estimator. Keep unknown values explicit. Use hard gates only for true market splits; use penalties for quality differences where transfer is possible but risky.

## P3 - Improve Reporting, Review Tools, And Regression Fixtures

### What Is Left

The backtest and row viewer are useful, but the review loop can still be faster.

Useful additions:

- persistent worst-miss reports;
- fixture snapshots for known hard cases;
- side-by-side old/new estimate diffs;
- compact query cards for manual review;
- segment dashboards for white vs fancy, shape, carat band, supplier, and source concentration.

### Why This Matters

The next improvements are tuning-heavy. Good review tools will make it easier to tell whether a change is genuinely better or merely moving errors between segments.

### Acceptance Criteria

- A model change can be reviewed by comparing before/after segment metrics.
- Worst misses include selected comps, rejected comps, score components, adjustment parts, warnings, and source links.
- Known regression cases are easy to rerun.
- Manual review does not require reading raw JSON unless debugging a deep issue.

### General Instructions

Keep tooling simple and local-first. Prefer deterministic reports that can be regenerated from the current data snapshot. Make the output useful for pricing judgment, not just engineering metrics.

## Recommended Order

1. Remove or test research/production drift.
2. Tune white local carat slope gating and extrapolation.
3. Improve fancy color transfer penalties and calibration.
4. Add stronger source independence metadata and penalties.
5. Calibrate axis sigmas and score cutoffs from grouped backtests.
6. Compare robust blending strategies.
7. Expand normalized schema and hard gates.
8. Improve reporting and regression review tools.

## Definition Of Done

Comp Engine v3 should be considered mature when:

- production and research outputs cannot silently diverge;
- white MdAPE is reliably at or below target with acceptable bias;
- fancy estimates have materially better point accuracy and honest intervals;
- large-carat extrapolation no longer dominates worst misses;
- source concentration and weak independence visibly affect confidence;
- hard market splits are enforced by normalized fields;
- backtests explain not just whether the model missed, but why it missed.
