# DiamondProd vNext Cutover Follow-Up

**Date:** 2026-06-02
**Status:** Ready for controlled shadow review; not ready for blind production display
**Model:** `diamond-prod-vnext-v0.1.0`

---

## 1. Readiness Answer

`DiamondProd vNext` is **implemented and testable**, and it passes the model hard gates.

It is **not yet ready for unreviewed production display**.

It is ready for:

```text
diamond_prod_vnext_shadow
```

It is not yet ready for:

```text
diamond_prod_vnext_display
```

until the cutover blockers below are handled.

---

## 2. Verified Passing Checks

The following commands were run successfully:

```bash
npm run test:color-prod-vnext
npm run test:diamond-prod-vnext
npm run test:diamond-prod-vnext-golden
npm run benchmark:diamond-prod-vnext
npm run shadow:diamond-prod-vnext
npm test
```

Latest benchmark:

| Area | Result |
|---|---:|
| Hard gates | 10 / 10 pass |
| Soft gates | 3 / 4 pass |
| Failed soft gate | S27 baseline protocol comparison |
| White branch MAPE | 4.7927% |
| Color branch MAPE | 6.5573% |
| Color branch vs raw S22 | identical on same holdout |
| Branch classification | 100.00% |
| Color coverage | 100.00% |
| Direct StarGem anchors | 0.00% MAPE |
| Color intensity monotonicity | 0 inversions |
| Golden fixtures | 40 / 40 pass |
| Full `npm test` | pass |

HTTP sanity check:

```text
http://localhost:8765/index.html -> 200 OK
```

Browser bundle import sanity:

```bash
node -e "await import('./research/scripts/predict-diamond-prod-vnext-browser.mjs')"
```

Result:

```text
browser bundle import ok
```

---

## 3. Cutover Blockers

### Blocker 1 - Shadow Review Has 204 Large White Deltas

The shadow release report evaluated 4,752 rows:

| Branch | Rows | Large deltas |
|---|---:|---:|
| White | 4,415 | 204 |
| Color | 337 | 0 |

The largest white delta is too large to ignore:

```text
20.13ct heart_standard D/VVS1
Baseline: $11,908
DiamondProd: $128,004
Delta: +975.0%
Expert: S28
Reason: s33a_weak_anchor_high_carat_n1
Flags: highCarat, sparse
```

Required before display:

- Review `research/data/shadow-release-diamond-prod-vnext-large-deltas.csv`.
- Approve or reroute high-carat weak-anchor rows.
- Decide whether `s33a_weak_anchor_high_carat_*` should force S28/S26/S30 fallback or a direct-quote warning.

Exit criteria:

- No unreviewed high-carat sparse row can become displayed production output.
- Large deltas are either accepted, capped, rerouted, or flagged.

### Blocker 2 - Shadow Checklist Is Still Unreviewed

The shadow report has all checklist items still false:

```text
whiteLargeDeltasReviewed: false
colorLargeDeltasReviewed: false
rareHueWarningsReviewed: false
starGemAnchorsReviewed: false
highCaratReviewed: false
sparseReviewed: false
princessReviewed: false
rollbackVerified: false
featureFlagImplemented: false
```

Feature flags are present in `index.html`, so `featureFlagImplemented` may simply be stale in the generated report. The rest still need explicit review.

Required before display:

- Update the shadow script checklist logic or manually record review completion.
- Verify rollback from `diamond_prod_vnext_display` to `diamond_current`.

Exit criteria:

- Shadow checklist is true or has documented exceptions.

### Blocker 3 - App Path Does Not Use The Browser Bundle Yet

`predict-diamond-prod-vnext-browser.mjs` exists and imports successfully.

However, `index.html` currently uses an inline local predictor path:

```text
loadDiamondProdVNextModel()
predictDiamondProdVNextLocal()
```

The inline app path does not obviously call the browser bundle exports:

```text
initDiamondProdVNext()
predictDiamondProdVNext()
```

This matters because the research/browser bundle and the inline app predictor can drift.

Required before display:

- Either wire `index.html` to use `predict-diamond-prod-vnext-browser.mjs`, or
- Add an app-parity test proving the inline predictor matches the browser bundle and golden fixtures.

Exit criteria:

- One source of truth for app prediction, or a strong parity test between the two paths.

### Blocker 4 - App Color Prediction Path Is Simplified

The app inline color path currently builds the color row from global state:

```text
colorDiamondModelRowFromState(state.carat)
```

and then calls:

```text
predictColorDiamondMl(colorRow)
```

That is a simplified S22-style path, not visibly the full `ColorProd` expert ladder with:

```text
E1_DIRECT_QUOTE
E2_S22
E3_S23
E4_COMPS
E5_CURATED_PRIOR
```

This may be acceptable for the current app UI, but it is not yet proven equivalent to the full DiamondProd branch.

Required before display:

- Add app-mode golden fixtures for fancy-color rows.
- Confirm app output matches `predictDiamondProdVNext` for those fixtures.
- Confirm rare hue warnings and direct-quote warnings show in the UI path.

Exit criteria:

- App fancy-color outputs match the research predictor for golden fixtures.

### Blocker 5 - Direct StarGem Anchors Are Not Reviewed In Shadow

Benchmark direct StarGem anchors pass:

```text
0.00% MAPE on 5 anchors
```

But the shadow report says:

```text
Direct StarGem Anchor Review (0 anchors)
```

This is probably because no direct anchors are in the current holdout slice, but the launch review should still inspect them.

Required before display:

- Add direct StarGem anchors to the shadow review sample, or
- Run a separate direct-anchor launch report.

Exit criteria:

- The 5 direct anchors are explicitly reviewed in the launch packet.

### Blocker 6 - One Soft Gate Still Fails

Benchmark reports:

```text
S27 baseline soft gate: FAIL
ColorProd: 6.56%
S27 validation: 3.12%
```

The implementation report says this is a protocol difference, and the branch now matches raw S22 on the same holdout.

Required before display:

- Keep as a documented soft warning, or
- Align the S27 validation protocol and DiamondProd color holdout protocol.

Exit criteria:

- Launch report explains why this soft failure is accepted.

---

## 4. Recommended Next Steps

1. Switch only to `diamond_prod_vnext_shadow`, not display.
2. Review the 204 large white deltas from the CSV.
3. Decide high-carat weak-anchor fallback policy.
4. Prove app/browser parity for DiamondProd, especially fancy-color rows.
5. Include direct StarGem anchors in a launch review.
6. Verify rollback to `diamond_current`.
7. After those are done, consider `diamond_prod_vnext_display`.

---

## 5. Final Verdict

Current state:

```text
Research predictor: ready.
Benchmark hard gates: ready.
Golden fixtures: ready.
App shadow mode: ready to try.
Blind production display: not yet.
```

The model should move to controlled shadow review, not direct production display.
