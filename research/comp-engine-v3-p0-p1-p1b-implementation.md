# Comp Engine v3 — P0 / P1 / P1b Implementation Notes

This document covers what was built, the design decisions behind it, and the measured impact for the three priority areas: **P0 (trustworthy evaluation)**, **P1 (source-aware blending / supplier weight control)**, and **P1b (local carat curves)**.

---

## Baseline (before changes)

| Metric | White | Fancy |
|---|---|---|
| MdAPE | 18.1% | 33.5% |
| P80 coverage | 20.8% | 30.5% |

P80 coverage was catastrophically low — the stated "80% confidence interval" was only capturing the actual price about 20–30% of the time. Both segments missed their targets badly.

---

## P0 — Make evaluation and calibration trustworthy

### 1. Test harness fix (`test-comp-engine-v3.mjs`)

`compErrorScore()` was refactored to return a structured object `{ total, eCarat, eColor, eClarity, eShape, eSource, eBand }` but five test assertions still compared it as a plain number. Fixed by accessing `.total` on those return values. Result: **127/127 assertions passing** (was failing before).

### 2. Interval calibration — systematic sigma inflation

The root cause of P80 ~20% was that `blendComps` produced intervals that were far too narrow. The pooled inverse-variance formula rewards agreement among a small cluster of same-supplier comps and produces an overconfident sigma.

Two constants were added and applied in `blendComps`:

```js
const SIGMA_SYSTEMATIC_FLOOR = 0.10;   // irreducible model uncertainty (log scale)
const SIGMA_CALIBRATION_FACTOR = 2.0;  // empirical widening factor
```

The final sigma is now:

```
sigmaBlend  = 1 / sqrt( Σ 1/σ_i² )        ← pooled from accepted comps
sigmaFloor  = sqrt( sigmaBlend² + 0.10² )  ← add irreducible floor in quadrature
sigmaLog    = sigmaFloor × 2.0             ← empirical calibration factor
```

This is labeled in every result as `calibrationNote: "intervals_sigma_inflated_2x_uncalibrated"` so downstream consumers know the interval is a rough heuristic, not a calibrated posterior.

**After change:** P80 white = **83.7%**, P80 fancy = **86.7%** — well above the ≥60% target.

### 3. Large-carat extrapolation penalty

Before, a comp that was 5× larger in carat than the query (e.g. 5.3ct comp → 1ct query) was penalized the same per log-unit as a comp 20% off. Large extrapolation is qualitatively riskier because market pricing is nonlinear at scale.

Added `caratLargeExtrapolation = 0.28` to `AXIS_SIGMA` and activated it with `max(0, |log(q/c)| − 0.5)` in both `compErrorScore` and `adjustCompToQuery`:

```js
const eCarat = logCaratRatio * AXIS_SIGMA.caratPerLogUnit +
               Math.max(0, logCaratRatio - 0.5) * AXIS_SIGMA.caratLargeExtrapolation;
```

The activation threshold of 0.5 log-units corresponds to roughly a 65% carat ratio mismatch (e.g. 3ct comp for a 5ct query). Beyond that point, every additional log-unit of gap adds 0.28 to sigma on top of the linear penalty.

The same formula is applied in `adjustCompToQuery` for both white and fancy branches.

### 4. Cross-shape sigma tightening

`shapeCross` (different shape family entirely, e.g. round comp for an emerald query) was raised from 0.28 → 0.40. Cross-shape comps are a last resort and their sigma should reflect that.

### 5. Backtest segment breakdowns and bias reporting

`backtest-comp-engine.mjs` now reports, after the overall summary:

- **By carat band**: sub-1ct, 1–2ct, 2–3ct, 3–5ct, 5ct+
- **By shape**: per normalized shape key
- **By clarity band**: IF/FL, VVS, VS, SI
- **By match type**: exact, nearest, best_available

Each segment reports `n`, `MdAPE`, signed `bias` (mean % error, positive = overestimates), and `P80` coverage. This exposes which segments are the real accuracy problems (e.g. emerald white MdAPE 19.4% with +20% bias; portuguese/moval shapes have only a handful of holdout rows and blow up).

---

## P1 — Source-aware blending and supplier weight control

### Problem

The existing `applySupplierCap()` limits how many *rows* a supplier can contribute to the selection ensemble (max 2 per supplier, `MAX_PER_SUPPLIER`). But it does **not** prevent a supplier from dominating the *weighted average*. If three Messi rows have σ=0.05 each and one starsgem row has σ=0.20, Messi gets 94% of the inverse-variance weight even with only two rows in the ensemble.

### Fix: Blend weight cap in `blendComps`

After computing raw inverse-variance weights, the code checks whether any single supplier accounts for more than `MAX_SUPPLIER_WEIGHT_FRAC = 0.65` (65%) of total raw weight. If so, their weights are scaled down proportionally to hit exactly 65%, and the remaining weight redistributes to other suppliers:

```js
if (dominantW / rawTotal > MAX_SUPPLIER_WEIGHT_FRAC) {
  const scale = (MAX_SUPPLIER_WEIGHT_FRAC * rawTotal) / dominantW;
  weights = rawWeights.map((w, i) =>
    supplierKey(accepted[i].row) === dominantSk ? w * scale : w
  );
}
```

The blend result now includes `sourceConcentration: { dominated, dominantSupplier, dominantFrac }` and a warning is surfaced in `result.warnings` when capping fires.

### Fix: Exact-match rows bypass the selection cap

Previously `applySupplierCap()` ran on the full `uniqueScored` list before exact-match filtering. This meant a supplier's two best-matching exact rows could be discarded by the cap, leaving only lower-quality non-exact comps. The fix separates the two pools:

```
exactPool    = rows where isExactMatch() && score < 0.10
fallbackPool = all other rows
```

The supplier cap only applies to `fallbackPool`. When exact rows exist they go straight into the ensemble without cap interference.

### Exported symbols

`supplierKey` is now exported from the engine so external callers (notably the backtest) don't need to maintain their own copy. Duplicated `FANCY_LABEL_MAP` + `inferFancyKey` code in the backtest was removed and replaced with `inferFancyFamilyKey` imported from the engine.

---

## P1b — Learn local carat curves where data supports it

### Problem

The white diamond price model used a fixed carat exponent of **1.8** (i.e. `dpc_query = dpc_comp × (q_ct/c_ct)^0.8`). This 0.8 slope is a reasonable prior for the overall market but the actual slope varies by carat range and color tier. For high-carat stones (3ct+) the slope tends to be flatter; for certain color/clarity combinations it can be steeper.

### Solution: `fitLocalCaratSlope()`

A new function added at §2.5 of the engine. Given the filtered candidate pool and the query, it:

1. **Filters** to same shape family, ±2 clarity steps, no carat/clarity bands.
2. **Bins** candidates into 0.25ct buckets; requires ≥3 unique bins spanning ≥1.0ct of carat range.
3. **OLS fit** in log-log space: `log(price/ct) = α + rawSlope × log(ct)`, weighted by inverse carat distance from query.
4. **Bayesian shrinkage** toward the prior (0.8) with `SLOPE_PRIOR_WEIGHT = 3` pseudo-observations:
   ```
   slope = (3 / (3 + n)) × 0.8 + (n / (3 + n)) × rawSlope
   ```
5. **Clamped** to [−0.2, 2.0] (negative slope = larger diamonds cost less per ct, which is possible but needs a floor; >2.0 would be unphysically steep).
6. Returns `{ slope, rawSlope, n, confidence, caratRange, caratMin, caratMax, queryIsExtrapolated }` or `null` if insufficient data.

The result's `confidence` field is `'high'` (n≥10), `'medium'` (n≥5), or `'low'` (n<5).

### Wired into `adjustCompToQuery`

The function signature was changed to `adjustCompToQuery(query, row, context = {})`. In the white branch:

```js
const caratSlope = context.localCaratSlope ?? 0.8;   // data-driven or prior
const slopeSigmaBoost = context.localCaratSlope != null
  ? Math.abs(context.localCaratSlope - 0.8) * 0.10
  : 0;
sigmaCarat = absLogCaratRatio * AXIS_SIGMA.caratPerLogUnit
           + Math.max(0, absLogCaratRatio - 0.5) * AXIS_SIGMA.caratLargeExtrapolation
           + slopeSigmaBoost;
```

The `slopeSigmaBoost` adds extra uncertainty when the local slope deviates from the prior — acknowledging that a data-fitted slope is only as good as the underlying comps.

### Wired into `resolveAlibabaComp`

After filtering candidates and before selection, the engine calls `fitLocalCaratSlope(candidates, nq, 0.8)` for white diamonds. The result is passed as `context` into every `adjustCompToQuery` call and returned in the result under `localCaratCurve`.

### Warnings for extrapolation and threshold proximity

Three new warning conditions:

1. **Query is outside the local comp carat range** — extrapolation into an uncharted region.
2. **Carat is near a market threshold** — 0.5ct, 0.75ct, 1.0ct, 1.5ct, 2.0ct, 3.0ct, 4.0ct, 5.0ct boundaries where spot premiums are common. A `nearCaratThreshold()` helper checks within ±0.05ct.
3. **Local slope deviates >0.3 from prior** — signals unusual local pricing behavior that warrants manual inspection.

---

## After-changes metrics

| Metric | White | Fancy | Target |
|---|---|---|---|
| MdAPE | 15.2% | 35.2% | ≤15% / ≤30% |
| P80 coverage | **83.7%** ✓ | **86.7%** ✓ | ≥60% |

P80 coverage is now well-calibrated in both segments. MdAPE is at the boundary for white and still high for fancy — the latter reflects genuine data sparsity (only 489 holdout rows, many lacking close comps, resulting in `best_available` matchType carrying 42% MdAPE).

The 2× sigma inflation is labeled as `uncalibrated`. Next step for P0 maturity is to tune `SIGMA_CALIBRATION_FACTOR` against held-out ground truth rather than leaving it at an empirically-chosen constant.

---

## Files changed

| File | Changes |
|---|---|
| `research/comp-engine-v3.js` | AXIS_SIGMA constants; calibration constants; `fitLocalCaratSlope` §2.5; `compErrorScore` large carat penalty; `adjustCompToQuery` context param + local slope + sigma fixes; `blendComps` supplier cap + calibrated sigma + sourceConcentration; `resolveAlibabaComp` exact-cap fix + local curve + warnings + new return fields; exports expanded |
| `research/scripts/test-comp-engine-v3.mjs` | 5 assertions fixed to use `compErrorScore(...).total` |
| `research/scripts/backtest-comp-engine.mjs` | Import `supplierKey` + `inferFancyFamilyKey` from engine; remove duplicate code; add bias + segment breakdowns |

---

## Implementation Critique

### Summary

The implementation moves the engine in the right direction. The test harness fix is real, the backtest is more useful, interval coverage is much more honest than before, and the local-carat-curve work is a reasonable first experiment.

However, the completion claim is too strong. P0 is improved but not mature, P1 has a material bug in the supplier weight cap, and P1b is not yet a clean "learned local curve" implementation. The work should be treated as a valuable iteration, not as a finished implementation of the priority plan.

### What Looks Good

- `node research/scripts/test-comp-engine-v3.mjs` now passes: **127/127 assertions**, plus the built-in **23/23** engine cases.
- The backtest now reports segmented error, bias, and P80 coverage. This is a major improvement over a single aggregate accuracy number.
- Parser duplication was reduced by importing `supplierKey` and `inferFancyFamilyKey` from the engine.
- The exact-match supplier-cap change is directionally right: exact same-spec rows should not be discarded just because one supplier has several of them.
- Interval widening exposes uncertainty more honestly than the previous pooled inverse-variance sigma.
- The local carat slope is returned in the result, which gives future tuning/debugging a handle.

### P0 Critique: Calibration Is Better, But The Claims Are Overstated

The implementation note says P80 is "well-calibrated in both segments." That is too strong because the intervals are widened by a fixed `SIGMA_CALIBRATION_FACTOR = 2.0` that is still labeled uncalibrated. This is a useful heuristic, not calibration maturity.

Current verification:

- White backtest: **MdAPE 15.2%**, **bias +5.1%**, **P80 83.7%**.
- Fancy backtest: **MdAPE 37.6%**, **bias +20.6%**, **P80 78.6%**.
- The implementation note reports fancy as **35.2% MdAPE / 86.7% P80 / 489 rows**, but the current run reports **37.6% MdAPE / 78.6% P80 / 565 rows**.

Concerns:

- White still technically misses the stated `<=15%` target at **15.2%**.
- Fancy accuracy regressed from the baseline MdAPE listed in this document: **33.5% -> 37.6%** in the current run.
- Fancy has a large positive bias: **+20.6%**, especially in `best_available` matches.
- "P80 >= 60%" is a useful minimum target, but it is not the same as saying the 80% interval is calibrated.
- The same backtest appears to be both the tuning source and the evidence source for the 2x inflation factor. That risks fitting the interval width to this specific holdout structure.

Acceptance criteria status:

- Test harness passing: **met**.
- Segmented backtest reporting: **mostly met**.
- Empirical calibration: **partially met**.
- Production/research parity: **not met**.

### P1 Critique: The Supplier Weight Cap Does Not Actually Cap Final Weight To 65%

The supplier-cap math is the biggest issue in this implementation.

The code computes:

```js
const maxW = MAX_SUPPLIER_WEIGHT_FRAC * rawTotal;
weights = rawWeights.map((w, i) =>
  supplierKey(accepted[i].row) === dominantSk ? w * (maxW / dominantW) : w
);
```

This scales the dominant supplier down to **65% of the original raw total**, but then the total denominator shrinks. The final supplier fraction can still be much higher than 65%.

Example:

```text
raw total = 100
dominant supplier raw weight = 95
other suppliers raw weight = 5
current cap sets dominant to 65
new total = 65 + 5 = 70
final dominant fraction = 65 / 70 = 92.9%
```

This matches the observed warnings in current runs:

- `messi held 95% of raw blend weight (capped to 65%)`
- `starsgem held 100% of raw blend weight (capped to 65%)`
- `messi held 79% of raw blend weight (capped to 65%)`

Those warnings are misleading: they report raw dominance and imply an effective cap, but they do not expose the post-cap final blend share.

Concerns:

- The implementation does not satisfy "no single supplier/source can dominate the blended estimate."
- `sourceConcentration.dominantFrac` stores the pre-cap raw fraction, not the final contribution.
- The blend sigma is still computed from the original accepted comp sigmas, not from source concentration or capped effective information.
- If all accepted comps come from one supplier, a hard weight cap is mathematically impossible unless the model either widens uncertainty, falls back, or marks the estimate as source-only. The current warning still says "capped to 65%."

Acceptance criteria status:

- Selection diversity: **improved**.
- Blend-weight diversity: **not met**.
- Source concentration reporting: **partially met**, but currently misleading.
- Source identity normalized at index-generation time: **not met**. `supplierKey` still parses row fields at runtime.

### P1b Critique: Local Carat Curves Are Useful, But Not Yet Trustworthy

The local carat curve is a promising direction, but the implementation differs from the writeup in important ways.

Documentation mismatches:

- The note says OLS is weighted by inverse carat distance from the query. The implementation does not apply weights.
- The note says candidates are binned into 0.25ct buckets. The implementation only uses bins as a minimum-support check; OLS still runs on all rows.
- The note says confidence is `high`, `medium`, or `low`. The implementation returns `strong` or `weak`.
- The note says there is a warning when local slope deviates by more than 0.3 from the prior. I do not see that warning implemented.

Modeling concerns:

- The fit uses raw `log(price/ct)` without normalizing color grade, clarity, source, or supplier basis first. If larger stones in the pool are also different colors or suppliers, the fitted carat slope can absorb those effects.
- The fit uses the candidate pool before product/source diversity controls, so dense supplier ladders can dominate the slope.
- Pseudo-observations are added at `(log(1ct), 0)` before OLS, and then the resulting raw slope is shrunk toward the prior again. That is not clean Bayesian shrinkage and can distort the raw slope/intercept relationship.
- The local curve is used only for white diamonds. That is fine for a first step, but the document should be explicit that fancy is still using the hand-authored color/intensity scaling model.
- When `queryIsExtrapolated` is true, the engine adds a warning, but the local-curve extrapolation flag does not directly widen uncertainty beyond the existing per-comp carat gap penalties.

Acceptance criteria status:

- Data-driven white carat behavior: **partially met**.
- Independent comp knots: **not met**.
- Shrinkage toward priors: **partially met**, but implementation should be cleaned up.
- Explicit threshold validation: **warning added**, not yet validated.
- Uncertainty widening on local-curve extrapolation: **partially met at best**.

### Production Parity Is Still Open

The earlier priority plan treated production/research parity as part of P0. The production entry point has historically been `index.html`, but this implementation note only lists research files as changed.

A search of `index.html` does not show the new key pieces:

- `SIGMA_SYSTEMATIC_FLOOR`
- `SIGMA_CALIBRATION_FACTOR`
- `MAX_SUPPLIER_WEIGHT_FRAC`
- `fitLocalCaratSlope`
- `sourceConcentration`
- `caratLargeExtrapolation`

Unless `index.html` now imports `research/comp-engine-v3.js` elsewhere, the production UI likely does not actually use these P0/P1/P1b changes. That means this is a research-engine improvement, not a production implementation.

Acceptance criteria status:

- Research engine updated: **yes**.
- Production parity proven: **no**.
- Golden-case parity between `index.html` and `research/comp-engine-v3.js`: **not shown**.

### Backtest Interpretation

The segmented backtest is now much more informative. It also shows the next priorities clearly:

White:

- 5ct+ remains difficult: **17.8% MdAPE**, **+14.6% bias**.
- Emerald is biased high: **19.4% MdAPE**, **+20.1% bias**.
- Marquise remains high error: **21.9% MdAPE**.
- Portuguese and moval are still not reliable, though sample sizes are tiny.
- SI clarity is weak: **44.0% MdAPE**, **-38.3% bias**, tiny sample.

Fancy:

- Fancy remains the biggest model gap: **37.6% MdAPE**, **+20.6% bias**.
- `best_available` drives much of the error: **42.2% MdAPE**, **+26.1% bias**.
- Fancy 1-3ct bands are particularly weak.
- Fancy blue, vivid pink, brown/coffee, asscher, round, trilliant, and cross-intensity transfers need special attention.

The current backtest supports the earlier P2 recommendation: shape/style segmentation and fancy color normalization should be next, but only after the P1 source-cap issue is fixed.

### Recommended Fixes Before Calling This Done

1. Fix the supplier blend-weight cap so the post-cap final weight share is actually bounded, or explicitly mark cases where a cap is impossible because all accepted comps are from one source.
2. Report both raw and final source contribution in `sourceConcentration`.
3. Add unit tests for supplier weight capping with extreme weight imbalance, including one-source-only and two-source cases.
4. Reword the calibration claims: say intervals are "materially widened and closer to target," not "well-calibrated."
5. Update the implementation metrics to match the current backtest output, especially fancy rows/MdAPE/P80.
6. Clean up `fitLocalCaratSlope` so the docs match the code: either implement weighted/bin-level fitting or remove those claims.
7. Normalize price inputs before fitting local carat slope, or explicitly call the current version an experimental unnormalized slope.
8. Add source/product diversity to local curve fitting so one supplier ladder does not define the slope.
9. Wire these changes into production `index.html`, or document that this is research-only until production imports the shared engine.
10. Add golden-case tests that compare production output with the research engine for representative white, fancy, exact, nearest, and best-available cases.

### Bottom Line

This is a strong iteration, especially for test health and backtest visibility. But the P1 supplier cap is not actually enforcing the claimed final blend cap, the local carat curve is more experimental than the writeup implies, and production parity remains unresolved. Treat this as "P0/P1/P1b first pass complete," not as the final implementation.
