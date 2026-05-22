# Comp Engine v3 Gap Fixes Implementation

Last reviewed: 2026-05-22

This note documents the fixes made after reviewing the P0 / P1 / P1b implementation and the current working tree.

## Summary

The main gaps were:

1. The supplier blend weight cap did not actually cap final blend contribution.
2. `index.html` had only a partial mirror of the research engine changes.
3. Production and research intervals meant different things.
4. The local carat slope fit used raw, unnormalized prices and dense row-level data.
5. Source-row provenance links could imply complete provenance when they were only samples.
6. The spreadsheet viewer failed unclearly when opened directly from disk.

The fixes bring the research engine and production mirror much closer together, make source concentration reporting honest, and improve local slope fitting discipline.

## Files Changed

| File | Purpose |
|---|---|
| `research/comp-engine-v3.js` | Fixed supplier final-weight capping, normalized local carat slopes, better concentration fields, improved warnings, and exported behavior retained. |
| `index.html` | Mirrored the research engine's calibrated intervals, local carat slope, large-carat penalty, exact-match supplier handling, source concentration reporting, and support metadata. |
| `research/scripts/test-comp-engine-v3.mjs` | Added regression coverage for supplier final-weight caps and one-source-only cap impossibility. |
| `research/spreadsheet-viewer.html` | Added a clear `file://` fallback message for local browser fetch restrictions. |

## Fix 1: Supplier Final-Weight Cap

### Problem

The prior cap scaled the dominant supplier to 65% of the original raw total:

```text
dominant raw = 95
other raw = 5
old capped dominant = 65
final share = 65 / (65 + 5) = 92.9%
```

So the warning said "capped to 65%" while the final blended estimate could still be over 90% from one supplier.

### Fix

The cap now solves for the dominant supplier's post-cap weight:

```text
cappedDominant / (cappedDominant + otherWeight) = MAX_SUPPLIER_WEIGHT_FRAC
```

If there is no other source in the accepted blend, the cap is marked impossible instead of pretending it was applied.

### Result

`sourceConcentration` now reports:

- `rawDominantFrac`
- `finalDominantFrac`
- `capApplied`
- `capPossible`
- `supplierFracs`

Warnings now distinguish:

- final cap applied,
- one-source-only cap impossible,
- source concentration still present.

## Fix 2: Research / Production Parity

### Problem

The research engine had calibration and local-curve behavior that `index.html` did not. That meant the backtest was measuring one system while users saw another.

### Fix

The production mirror in `index.html` now includes:

- `caratLargeExtrapolation`
- `shapeCross = 0.40`
- systematic sigma floor
- 2x interval calibration factor
- supplier final-weight cap
- exact-match rows bypassing fallback supplier caps
- normalized local carat slope for white diamonds
- local carat extrapolation and slope-deviation warnings
- `sourceConcentration`, `localCaratCurve`, and `calibrationNote` fields

This is still a mirrored implementation, not a true shared module import. The operational risk is reduced, but not eliminated.

## Fix 3: Local Carat Curve Discipline

### Problem

The first local carat slope pass fit raw `log(price/ct)` against `log(carat)`. That allowed color, clarity, shape, and supplier basis to leak into the slope.

It also used every row directly, so dense supplier ladders could dominate the fit.

### Fix

The fit now:

- normalizes each candidate's `log(price/ct)` toward the query's color, clarity, and shape at that candidate's carat;
- groups rows into 0.25ct carat knots;
- uses a weighted median per knot instead of every row directly;
- fits weighted OLS over those knots;
- shrinks the slope toward the 0.8 prior after fitting;
- reports knot count, row count, source count, and confidence.

### Important Tradeoff

This is cleaner statistically, but it is not an automatic accuracy win yet. The current white backtest got slightly worse after the normalized slope change. That means the slope layer is now less contaminated, but it still needs model tuning.

## Fix 4: Honest Source Provenance Links

### Problem

Aggregated supplier comps can come from many spreadsheet rows, but the comp metadata stores only a small row/report sample. UI text like "sheet rows" could imply the listed rows fully explain the aggregate.

### Fix

The UI now labels multi-row provenance links as a source row sample.

This keeps the link useful for inspection without overstating completeness.

## Fix 5: Spreadsheet Viewer File Handling

### Problem

`spreadsheet-viewer.html` uses `fetch()` to load local JSON indexes. Browsers commonly block that when the file is opened directly via `file://`.

### Fix

The viewer now detects `file://` and shows a clear message explaining that it should be opened from the app or a local web server. It still provides direct spreadsheet/JSON links.

## Verification

Commands run:

```bash
node research/scripts/test-comp-engine-v3.mjs
node research/scripts/backtest-comp-engine.mjs --segment white
node research/scripts/backtest-comp-engine.mjs --segment fancy
```

Results:

| Check | Result |
|---|---|
| Engine unit/integration tests | 133/133 assertions passing |
| Built-in engine tests | 23/23 passing |
| White MdAPE | 15.4% |
| White bias | +6.1% |
| White P80 coverage | 85.0% |
| Fancy MdAPE | 37.6% |
| Fancy bias | +20.7% |
| Fancy P80 coverage | 78.6% |

Browser smoke test:

- Main calculator loaded from `http://127.0.0.1:8766/index.html`.
- Spreadsheet viewer loaded from `http://127.0.0.1:8766/research/spreadsheet-viewer.html`.
- Requested source rows highlighted correctly in the viewer.

## Remaining Risks

### Mirrored Code Still Exists

`index.html` now mirrors the research engine more closely, but it still duplicates model logic. The durable fix is to make production import a shared engine module or add golden parity tests that compare production and research outputs.

### Local Carat Slope Needs Tuning

The normalized slope fit is cleaner, but white MdAPE moved from 15.2% to 15.4% in the current backtest. The next pass should decide whether to:

- use local slopes only inside the observed carat range,
- shrink extrapolated slopes more aggressively,
- segment 5ct+ stones separately,
- or gate local slopes by confidence/source support.

### Fancy Accuracy Is Still The Largest Model Gap

Fancy P80 coverage is acceptable after interval widening, but point accuracy remains weak:

- Fancy MdAPE: 37.6%
- Fancy bias: +20.7%
- `best_available` fancy MdAPE: about 42%

This points to the next P2 work: fancy hue/intensity normalization, shape/style segmentation, and more conservative cross-intensity transfer.

### Source Concentration Is Now Honest, Not Solved

The cap now works when multiple sources exist. If all accepted comps come from one source, no mathematical cap is possible. Those cases are now marked honestly, but they still need wider uncertainty or a source-only confidence state.

## Bottom Line

The implementation now fixes the concrete correctness gaps from the critique: final supplier weights are actually capped when possible, production and research behavior are aligned much more closely, local carat fitting is normalized and knot-based, and provenance links are less misleading.

The remaining work is model quality, not plumbing correctness: improve fancy transfer behavior, tune local carat slope usage, and eventually remove the dual-codebase mirror.
