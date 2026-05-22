# Critique of the v3 Remaining-Work Implementation

I mostly agree with the implementation direction, but I do not agree with the writeup as a completion report. The supplier cap, score component reporting, and backtest script are the right high-value moves. The disagreement is that the current changes leave tests broken, overstate what the backtest proves, and still preserve a risky dual-codebase setup between `research/comp-engine-v3.js` and `index.html`.

## Main Disagreements

### 1. The test claim is false as written

The summary says all 23 tests pass. The built-in `runTests()` suite reports 23/23 passing, but `node research/scripts/test-comp-engine-v3.mjs` currently exits non-zero with 3 failing assertions.

The immediate cause is the API change to `compErrorScore`: it now returns an object:

```js
{ total, eCarat, eColor, eClarity, eShape, eSource, eBand }
```

but the wrapper tests still compare the return value directly as a number and call `.toFixed()` on it.

Affected assertions include:

- `scoreHeart < scoreBrownish`
- `compErrorScore(qWhite, perfect) < compErrorScore(qWhite, crossShape)`
- `assertBetween(scoreExact, 0, 0.15)`
- `scoreBrownish.toFixed(...)`

This is not a model bug, but it is a real integration break. Either update those tests to use `.total`, or preserve backward compatibility by returning a number with attached component fields. Until then, the implementation is not test-clean.

### 2. The backtest findings are directionally useful, but the interpretation is too narrow

The quoted summary says the worst misses are all 10+ ct extrapolation failures. In the current run, that is not true:

- Worst miss: `3.2ct pear VVS1 G`, +245.3%
- Second: `11.95ct emerald VVS1 E`, +239.0%
- Third: `10.25ct marquise VS1 E`, +220.1%

Large-carat extrapolation is clearly a problem, but the top miss shows that shape-family and supplier holdout effects are also material. The errors are not only a “data gap beyond 7ct”; they also point to supplier-specific pricing bases and shape multipliers being under-modeled.

The summary should say: the backtest exposes both extreme-carat extrapolation and cross-supplier/shape transfer risk.

### 3. The supplier cap is a good patch, but it is not a full source-weight cap

Capping each supplier at 2 selected comps prevents one supplier from filling all 5 ensemble slots. That is valuable.

But this is a selection cap, not a blend weight cap. Once selected, the remaining comps are still inverse-variance weighted. A single supplier can still dominate if its two rows have much lower sigma than the others. That may be acceptable for now, but it is narrower than “source de-duping and weight caps.”

Suggested wording: “Implemented a supplier selection cap; source-level blend weight caps remain open.”

### 4. The exact-match path may be weakened by supplier capping

The cap is applied before exact-match selection:

```js
const supplierCapped = applySupplierCap(uniqueScored);
const exactScored = supplierCapped.filter(c => isExactMatch(...));
```

That means if a supplier has many exact observations, only two can enter the ensemble even when they are truly independent sheet rows. This solves the dilution problem, but it may discard useful exact support. A more nuanced rule might cap non-exact fallback comps more aggressively than exact same-spec observations, or cap total supplier weight during blending rather than pre-dropping exact rows.

This is not necessarily a blocker, but it should be called out as a tradeoff.

### 5. The “schema work is dead weight” conclusion is too strong

I agree that adding 14 empty fields by hand to the current comp rows would be low value. The actual data mostly lacks those fields:

- Base Alibaba rows have only fields like `carat`, `shape`, `colorFamily`, `colorNormalized`, `clarity`, `priceUsd`, `productId`, `section`, and `url`.
- Supplier sheet rows add useful provenance like `sourceKey`, `sourceRows`, `sourceType`, `supplier`, and `reportNos`.
- Messi color rows already have partial color normalization via `appColorKey`, `colorHue`, and `colorIntensity`.

So a full normalized schema pass is not the next best engineering task. But the conclusion should not be “skip schema.” It should be “only add normalized fields that are derivable and immediately useful.”

High-value examples:

- Normalize supplier/source identity at index-generation time instead of reparsing `section`.
- Promote `sourceGroup`/`sourceKey` because the data already contains source provenance.
- Promote fancy color fields where already available (`colorHue`, `colorIntensity`, `appColorKey`) and derive them consistently for all fancy rows.

That would make the supplier cap and backtest cleaner without inventing unavailable market attributes.

### 6. The `index.html` mirroring risk is still unresolved

The writeup correctly identifies the dual-codebase risk, but the implementation continues the mirror pattern. The divergence is visible: `index.html` has broader fancy label and hue alias handling than `research/comp-engine-v3.js`.

If `index.html` cannot import the module yet, then mirroring is an operational discipline, not a fix. The critique should say this remains open, not completed.

### 7. The backtest itself is high-value but should be treated as a first draft

The backtest gives the project a feedback loop, which is the biggest improvement here. Still, its current results should be read carefully:

- It holds out suppliers, not individual products, so it tests cross-supplier generalization more than product-level interpolation.
- It skips rows with less than `--min-support`, so coverage and error metrics depend on that threshold.
- It reports P80 calibration around 20.8% for white and 30.5% for fancy, which means intervals are materially under-wide.
- It duplicates fancy color inference logic rather than importing the engine's parser, so future parser drift can affect test validity.

None of that makes the script bad. It just means the script is a calibration tool now, not final proof of calibration.

## What I Agree With

- Implementing the supplier cap before bigger schema work was pragmatic.
- Returning score components is the right shape for debugging and UI transparency.
- Adding a leave-one-supplier-out backtest is the most important improvement in the list.
- Skipping Huber/weighted median for now is reasonable; the backtest should guide that decision.
- Skipping dynamic local curves for now is defensible, but the backtest suggests carat behavior needs attention sooner than the original writeup implies.

## Recommended Next Fixes

1. Update `research/scripts/test-comp-engine-v3.mjs` for the new `compErrorScore(...).total` API.
2. Reword the completion summary to distinguish built-in 23-case tests from the full wrapper test script.
3. Record the supplier cap as a selection cap, not a full source weight cap.
4. Add `supplierKey` / `sourceGroup` during comp-index generation so runtime parsing is not repeated in engine, backtest, and browser code.
5. Treat interval widening/calibration as the next model task, because P80 coverage is currently far below target.
6. Decide whether `index.html` can import `research/comp-engine-v3.js`; if not, document a specific mirroring checklist and test both surfaces.

## Bottom Line

The chosen implementation scope is mostly right. The critique is that the report is too confident: tests are not fully passing, the backtest points to more than just large-carat data gaps, and the source-of-truth problem remains unresolved.
