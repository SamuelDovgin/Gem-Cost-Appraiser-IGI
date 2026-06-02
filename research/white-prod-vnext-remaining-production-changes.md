# WhiteProd vNext Remaining Production Changes

**Date:** 2026-06-02
**Status:** ✅ Changes 1-5 implemented. All 14 gates pass. 15/15 golden fixtures pass. Shadow report generated.
**Candidate:** `white-prod-vnext-v0.2.0`

---

## 1. Readiness Answer

`WhiteProd vNext` is **ready as a production candidate and shadow-release model**.

It is **not yet ready for an unguarded production cutover** until M7 shadow review and M8 rollout controls are complete.

Verified commands:

```bash
npm run test:white-prod-vnext
npm run benchmark:white-prod-vnext
```

Latest verified result:

| Gate group | Result |
|---|---:|
| Golden fixtures | 15 / 15 pass |
| Display-grid monotonicity | 224 / 224 S28-routed |
| Production gates | 14 / 14 pass |
| Hard gates | 12 / 12 pass |
| Soft gates | 2 / 2 pass |

Top-line benchmark:

| Metric | WhiteProd vNext | S26 baseline | Status |
|---|---:|---:|---|
| Row MAPE | 4.9216% | 5.3483% | PASS |
| Row MdAPE | 1.8286% | 1.9324% | PASS |
| Row p90 | 11.9687% | 14.1353% | PASS |
| Cell holdout MAPE | 4.9960% | 5.1993% | PASS |
| Dense MAPE | 4.2572% | 5.0271% | PASS |
| Medium MAPE | 5.0851% | 6.2424% | PASS |
| High carat MAPE | 6.8740% | 10.0105% | PASS |
| Princess MAPE | 12.0789% | 12.1571% | PASS |
| Bias | -0.0892% | -1.0653% | PASS |
| Monotonicity | 0 violations | required 0 | PASS |
| Coverage | 100% | required 100% | PASS |

---

## 2. Important Nuance

The model is not one raw estimator. It is one **versioned routed predictor**:

```text
S30 supported curves -> S26 dense lookup -> S33-A constrained anchors -> S28 fallback
```

On row holdout, routing distribution was:

| Expert | Rows | Share |
|---|---:|---:|
| S30 | 3745 | 84.8% |
| S26 | 437 | 9.9% |
| S33A | 233 | 5.3% |
| S28 | 0 | 0.0% |

Monotonicity passes because synthetic display-grid rows route to S28. Real benchmark rows route mostly to S30/S26/S33-A for accuracy. This is acceptable only if the product intentionally separates:

```text
display-grid / grade sweep behavior -> monotone S28
single-stone pricing behavior       -> routed WhiteProd vNext
```

That separation must be documented in the UI and tests. It should not be accidental.

---

## 3. What Still Needs To Change Before Full Production Cutover

### Change 1 - Complete M7 Shadow Release

Run `WhiteProd vNext` beside the current S26 production output without replacing the displayed production price.

Required logging for every prediction:

- input spec;
- current S26 price;
- `WhiteProd vNext` price;
- selected expert;
- support tier;
- confidence band;
- fallback reason;
- absolute and percent delta versus S26.

Exit criteria:

- no unexplained large deltas;
- every large delta has an expert/support explanation;
- high-carat, sparse, princess, and weak-anchor rows are manually reviewed;
- rollback remains one flag away.

### Change 2 - Review Weak-Anchor S33-A Cases

Some rows route to S33-A with weak anchors:

| Reason | Count |
|---|---:|
| `s33a_weak_anchor_n1` | 66 |
| `s33a_weak_anchor_n2` | 34 |
| `s33a_weak_anchor_n3` | 20 |
| `s33a_weak_anchor_n4+` | remaining low-support cases |

The pinned 40ct cases route to S33-A weak anchors and produce very large prices:

| Case | WhiteProd vNext | Expert | Concern |
|---|---:|---|---|
| 40ct round E VS2 | $54,717 | S33A weak anchor n1 | huge delta versus S26/S30 |
| 40ct round E SI1 | $54,404 | S33A weak anchor n1 | huge delta versus S26/S30 |

Required change:

- Add a weak-anchor review report.
- Consider forcing `anchorN < 5` or `anchorN < 10` high-carat cases to S28 with a wide interval, unless manually approved.
- Add pinned tests for 20ct, 30ct, and 40ct grade ladders.

Exit criteria:

- no unreviewed S33-A weak-anchor high-carat quote can become the displayed price;
- weak-anchor confidence band is visibly wide;
- large deltas are either approved or routed to fallback.

### Change 3 - Tighten Sparse-Tier Behavior

Sparse p90 passes, but sparse average MAPE is worse than S26:

| Sparse metric | WhiteProd vNext | S26 | Status |
|---|---:|---:|---|
| MAPE | 20.1540% | 10.7538% | Risk |
| p90 | 38.2972% | 39.8850% | Gate pass |

Required change:

- Add sparse MAPE as a monitored release metric, even if it is not a hard gate.
- Review sparse rows where WhiteProd vNext loses to S26 by more than 15%.
- Tune sparse routing between S26, S33-A, and S28.

Exit criteria:

- sparse underperformance is understood and accepted, or reduced;
- sparse rows have wider calibrated intervals;
- sparse fallback reason is visible in diagnostics.

### Change 4 - Confirm App Input Routing

The display-grid detector routes synthetic round-grid rows to S28 when there is no `reportNo`/`rowNo`.

Required change:

- Confirm actual app inputs include the fields needed to avoid accidental `display_grid_s28` routing for normal single-stone pricing.
- Add app-mode fixtures for common manually-entered inputs with no report number.
- Decide intentionally whether manual app inputs should use routed pricing or display-grid S28.

Exit criteria:

- selected expert in the app matches benchmark expectations;
- manual single-stone pricing does not silently fall into S28 unless intended;
- grid/sweep views intentionally use S28 and say so in diagnostics.

### Change 5 - Integrate Through One Shared Predictor

Required change:

- The app must call `research/scripts/predict-white-prod-vnext.mjs` or a production copy of the same module.
- Do not duplicate the routing formula in `index.html`.
- Add `modelVersion`, `selectedExpert`, and `fallbackReason` to app-visible diagnostics.

Exit criteria:

- app prediction equals golden fixtures;
- no duplicated production prediction code remains;
- `npm run test:white-prod-vnext` is included in the normal release test suite.

### Change 6 - Add Feature Flag and Rollback

Required change:

- Add a feature flag for displayed price source:

```text
s26_current
white_prod_vnext_shadow
white_prod_vnext_display
```

Exit criteria:

- S26 can be restored without code changes;
- the flag state is logged;
- fallback behavior is tested before launch.

### Change 7 - Production Monitoring

Required change:

- Track route distribution daily.
- Track percent delta versus S26 during shadow.
- Alert on unusual share changes, especially S33-A weak-anchor usage.
- Keep a watchlist for high-carat, sparse, and princess rows.

Exit criteria:

- monitoring dashboard or daily report exists;
- alert thresholds are documented;
- owner is assigned for launch review.

---

## 4. Release Recommendation

Proceed to:

```text
M7 shadow release
```

Do not proceed directly to:

```text
unguarded production cutover
```

until these are complete:

1. weak-anchor high-carat review;
2. sparse-tier review;
3. app input routing confirmation;
4. shared predictor integration;
5. feature flag and rollback;
6. production monitoring.

---

## 5. Final Approval Rule

`WhiteProd vNext` is production-cutover ready only when:

```text
It passes all benchmark gates, matches app golden fixtures, has completed shadow review,
has no unreviewed weak-anchor high-carat quotes, and can be rolled back to S26 by flag.
```

As of this report, it passes the model gates and should move to shadow release.
