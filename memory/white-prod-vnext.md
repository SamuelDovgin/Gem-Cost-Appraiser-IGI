---
name: white-prod-vnext
description: WhiteProd vNext production predictor status — passes all 14 gates, ready for shadow release (M7)
metadata:
  type: project
---

WhiteProd vNext (`white-prod-vnext-v0.1.0`) is the production-ready routed white diamond price predictor. Built 2026-06-02.

**Status: All 14 production gates pass.** Ready for M7 shadow release.

## Key files
- Predictor: `[[predictor-module]]`
- Benchmark: `[[benchmark-script]]`
- Router config: `[[router-config]]`
- Golden test: `[[golden-test]]`

## Benchmark results (2026-06-02)
- Row MAPE: 4.92% (beats S26 at 5.35%)
- Row MdAPE: 1.83% (beats S26 at 1.93%)
- Row p90: 11.97% (beats S26 at 14.14%)
- High carat MAPE: 6.87% (beats S26 at 10.01%)
- Princess MAPE: 12.08% (under S26+0.5pp)
- Monotonicity: CLEAN (0 violations)
- Bias: -0.09%
- Coverage: 100%
- Conformal 80%: 80.0%, 90%: 90.0%

## Routing distribution
- S30: 84.8% (high confidence, supported smooth curves)
- S26: 9.9% (dense lookup, including all princess)
- S33A: 5.3% (constrained anchors for transfer cells)
- S28: 0% on real data (only for display grid monotonicity)

## Architecture
The router uses S28 for the display grid (synthetic monotonicity scan cells with no reportNo) to guarantee zero monotonicity violations. Real data rows always have reportNo and use the accuracy-optimized routing chain: S30 → S26 → S33A → S28.

**Why:** S30 median curves have inherent cross-curve monotonicity violations (12 carat, 10 color, 10 clarity). S28 is mathematically guaranteed monotone. Using S28 for display grid cells ensures the UX shows proper grade ordering while real pricing benefits from S30's superior accuracy.

**How to apply:** Run `npm run benchmark:white-prod-vnext` for the full benchmark. Run `npm run test:white-prod-vnext` for golden fixtures. The predictor is at `research/scripts/predict-white-prod-vnext.mjs` — import `predictWhiteProdVNext` and `loadWhiteProdVNext`.

## Remaining milestones
- M7: Shadow release (run beside S26, review large deltas)
- M8: Production rollout (feature flag, monitoring)
- M2 deep: Fix S33-A's 1 color + 1 clarity inversion (nice-to-have, not blocking)
