# DiamondProd vNext Remaining Work

**Date:** 2026-06-02
**Status:** Research-layer implementation exists; app production rollout is not complete
**Model:** `diamond-prod-vnext-v0.1.0`

---

## 1. Current Implementation Status

`DiamondProd vNext` is implemented in the research scripts layer.

Implemented files:

| File | Status |
|---|---|
| `research/scripts/predict-color-prod-vnext.mjs` | implemented |
| `research/scripts/predict-diamond-prod-vnext.mjs` | implemented |
| `research/scripts/benchmark-diamond-prod-vnext.mjs` | implemented |
| `research/scripts/test-color-prod-vnext.mjs` | implemented |
| `research/scripts/test-diamond-prod-vnext.mjs` | implemented |
| `research/data/diamond-prod-vnext-router.json` | implemented |
| `research/data/benchmark-diamond-prod-vnext.json` | implemented |
| `package.json` scripts | added |

Verified commands:

```bash
npm run test:color-prod-vnext
npm run test:diamond-prod-vnext
npm run benchmark:diamond-prod-vnext
npm run test:white-prod-vnext
npm run test:s27-color
npm run test:color-model
```

All of those commands ran successfully.

---

## 2. What Is Done

### Unified Predictor

`predict-diamond-prod-vnext.mjs` now routes:

```text
white diamond input       -> WhiteProd vNext
fancy-color diamond input -> ColorProd vNext
```

It exposes one app-facing contract:

```text
price
pricePerCarat
modelVersion
branch
selectedExpert
supportTier
supportCount
sourceAdjustment
confidenceBand
fallbackReason
monotonicityMode
diagnostics
```

### WhiteProd-Shaped Color Branch

`predict-color-prod-vnext.mjs` mirrors the WhiteProd pattern:

```text
loadColorProdVNext()
predictColorProdVNext(row, ctx)
predictColorProdVNextBatch(rows, ctx)
supportTier(n)
cellKey(row)
makeResult(...)
```

Color expert ladder:

```text
E1_DIRECT_QUOTE
E2_S22
E3_S23
E4_COMPS
E5_CURATED_PRIOR
```

### Current Benchmark Result

Latest unified benchmark:

| Area | Result |
|---|---:|
| Branch classification | 100.00% |
| White branch row MAPE | 4.7927% |
| Color branch row MAPE | 6.7254% |
| Color coverage | 100.00% |
| Direct StarGem color anchors | 0.00% MAPE |
| Intensity monotonicity | clean, 0 inversions |
| Color conformal 80% | 80.1% |
| Color conformal 90% | 90.2% |

The benchmark recommends proceeding to golden fixtures and shadow release, but there are still important gaps below.

---

## 3. Remaining Fixes Before It Is Usable In The App

### Fix 1 - Wire DiamondProd Into The App

Current status:

```text
No app integration found for predictDiamondProdVNext / DiamondProd in index.html.
```

Required work:

- Import or browser-bundle the unified predictor.
- Replace current split white/color pricing calls with one `DiamondProd vNext` call.
- Show branch, selected expert, support tier, and fallback reason in diagnostics.
- Keep feature-flagged fallback to current app behavior.

Exit criteria:

- app displays DiamondProd output for both white and fancy-color diamonds;
- no duplicated production routing logic in `index.html`;
- app parity fixtures pass.

### Fix 2 - Add Browser/App-Compatible Bundle

Current status:

- White has `predict-white-prod-vnext-browser.mjs`.
- DiamondProd does not yet have a browser/app bundle.

Required work:

- Create browser-safe bundle or import path for:

```text
predict-diamond-prod-vnext-browser.mjs
```

- Make sure model JSON artifacts load in the browser context.
- Avoid Node-only `fs` reads in app runtime.

Exit criteria:

- app can call DiamondProd without Node-only imports;
- local browser test confirms both branches return prices.

### Fix 3 - Add Golden Fixtures For Unified Model

Current status:

- WhiteProd has golden fixtures.
- DiamondProd has tests, but no saved combined golden fixture artifact.

Required work:

Create:

```text
research/data/diamond-prod-vnext-golden-fixtures.json
research/scripts/test-diamond-prod-vnext-golden-fixtures.mjs
```

Fixture groups:

- existing WhiteProd pinned cases;
- direct StarGem color anchors;
- common yellow, pink, blue cases;
- green, brown, red caution cases;
- orange/purple unsupported rare-hue cases;
- high-carat colored stones;
- ambiguous/unknown color classification cases.

Exit criteria:

- fixture outputs are stable;
- app-visible predictions match fixtures;
- white branch still matches `WhiteProd vNext`.

### Fix 4 - Fix Benchmark Gate Accounting

Current issue:

The benchmark prints:

```text
[INFO] S27 baseline: FAIL
Passed: 14/14
```

That is inconsistent. The S27 baseline gate is currently soft, but failed soft gates should still be counted honestly.

Required work:

- Fix gate summary accounting.
- Report hard passes, hard fails, soft passes, and soft fails separately.
- Decide whether S27 baseline should be a hard gate or a tracked warning.

Recommended decision:

Keep it soft for now, but do not print `14/14` if one soft gate fails.

Exit criteria:

- benchmark summary is mathematically honest;
- release verdict clearly distinguishes "hard-gate pass" from "all-gate pass."

### Fix 5 - Improve Color Branch Versus Raw S22

Current issue:

ColorProd is slightly worse than raw S22 on row holdout:

| Model | MAPE | MdAPE | p90 |
|---|---:|---:|---:|
| ColorProd vNext | 6.7254% | 2.7905% | 16.4274% |
| S22 | 6.5573% | 2.6380% | 16.4373% |

Also, the S27 validation benchmark is 3.12%, while this unified color holdout is 6.73%. These are not directly identical protocols, but the gap needs explanation.

Required work:

- Align color holdout protocol with S27 validation or document why it differs.
- Identify rows where S23 fallback worsens S22.
- Tune E3 S23 fallback thresholds.
- Review blue vivid, blue intense, yellow vivid, and emerald color slices.

High-risk slices:

| Slice | Current issue |
|---|---|
| blue / vivid | 23.5% MAPE, p90 65.5% |
| blue / intense | 14.2% MAPE, p90 37.0% |
| yellow / vivid | 10.4% MAPE |
| emerald shape | 14.3% MAPE, p90 35.5% |

Exit criteria:

- ColorProd no worse than raw S22 on the same holdout, or accepted as a structural tradeoff;
- failing/worse slices documented;
- routing changes are covered by tests.

### Fix 6 - Add Source-Adjustment Sensitivity For Direct StarGem Anchors

Current issue:

Benchmark source sensitivity reports:

```text
StarGem anchor MAPE=N/A
```

Required work:

- Include direct StarGem anchors in factor sensitivity reporting.
- Confirm `Messi / 1.20`, `Messi / 1.25`, and `Messi / 1.30` do not distort direct anchors.
- Report best factor by color holdout and direct StarGem anchor rows.

Exit criteria:

- sensitivity output includes direct StarGem anchors;
- default `1.25` is justified or adjusted.

### Fix 7 - Add App Feature Flag And Rollback

Required feature flag:

```text
diamond_current
diamond_prod_vnext_shadow
diamond_prod_vnext_display
```

Exit criteria:

- current app pricing can be restored without code changes;
- DiamondProd can run in shadow mode;
- displayed mode can be enabled after review.

### Fix 8 - Add Shadow Release Report

WhiteProd has a shadow release script. DiamondProd does not yet.

Required work:

Create:

```text
research/scripts/shadow-release-diamond-prod-vnext.mjs
research/data/shadow-release-diamond-prod-vnext.json
```

Report:

- branch;
- selected expert;
- current app price;
- DiamondProd price;
- percent delta;
- high-delta rows;
- direct-quote warnings;
- rare hue warnings;
- weak support rows.

Exit criteria:

- large deltas are reviewed;
- rare/high-carat/fancy-color outliers are manually inspected;
- rollout recommendation is documented.

### Fix 9 - Add Full Test Suite Integration

Current status:

New scripts exist:

```text
npm run test:color-prod-vnext
npm run test:diamond-prod-vnext
npm run benchmark:diamond-prod-vnext
```

But they are not yet included in the top-level `npm test` chain.

Required work:

- Add `test:color-prod-vnext` and `test:diamond-prod-vnext` to `npm test`.
- Decide whether `benchmark:diamond-prod-vnext` should run in CI or remain a manual release check.

Exit criteria:

- normal test suite catches regressions in DiamondProd.

---

## 4. Readiness Verdict

Current state:

```text
Implemented in research layer: yes.
Tested as research predictor: yes.
Ready for app production display: no.
Ready for app integration and shadow release work: yes.
```

The most important remaining work is app integration, golden fixtures, benchmark accounting cleanup, color branch tuning, and shadow release.

---

## 5. Recommended Next Order

1. Fix benchmark gate accounting.
2. Add unified golden fixtures.
3. Create browser/app-safe DiamondProd predictor.
4. Wire DiamondProd into the app behind a feature flag.
5. Add DiamondProd tests to `npm test`.
6. Tune color branch where it loses to raw S22.
7. Run DiamondProd shadow release.
8. Only then consider displayed production rollout.
