# DiamondProd vNext Case Analysis

_Unified-vs-comp divergence for LG617442564 and LG758549300 | Prepared June 4, 2026_

> Bottom line: yes, these observations expose a real routing gap. In both cases, the unified primary accepts a one-row S33A weak anchor even though the comp engine and S26/StarGem lookup corroborate a materially higher wholesale price. The issue is not that comps are obviously too high; it is that weak ML support is allowed to outrank better market evidence.

## Executive Summary

The two reported stones are both white lab-diamond cases where DiamondProd vNext routes to the white branch, selects S33A, marks support as empty/low, and still displays the result as the primary unified number.

- Observed divergence: the 1.92ct cushion shows $149 unified versus a $211 weighted comp blend, $206 S26 rollback, and $219 StarGem lookup. The 3.07ct rectangular radiant shows $246 unified versus a $347 comp blend, $360 S26 rollback, and $346 StarGem lookup.

- Root cause: S30 has no supported curve, S26 lookup support exists but is gated out as a broad lookup level, and S33A weak-anchor fallback is allowed for normal-carat rows. The existing weak-anchor guard only protects high-carat rows at 5ct and above.

- Recommended fix: when S33A anchor support is below the production threshold, do not allow it to become the displayed primary if S26 lookup and/or live comps corroborate a different price. Route to S26/comp reconciliation or show a direct review warning.

- Testing gap: the current benchmark has no empty-tier holdout rows and no pinned normal-carat s33a_weak_anchor_n1 case, so it can pass while missing this exact failure mode.

## Case Evidence

| Observed case | Unified primary | Market/support anchors | Interpretation |
| --- | --- | --- | --- |
| LG617442564<br>1.92ct Cushion Brilliant G VS2 | $149 unified<br>$78/ct<br>S33A, tier=empty, band=low<br>s33a_weak_anchor_n1 | Comp blend: $211<br>S26 rollback: $206<br>StarGem lookup: $219, n=2238<br>80% comp range: $160-$277 | Unified is about 29% below comp and about 32% below StarGem lookup. The low output is driven by a weak S33A anchor, not by a lack of comp evidence. |
| LG758549300<br>3.07ct Cut Cornered Rectangular Modified Brilliant F VS2 | $246 unified<br>$80/ct<br>S33A, tier=empty, band=low<br>s33a_weak_anchor_n1 | Comp blend: $347<br>S26 rollback: $360<br>StarGem lookup: $346, n=13<br>80% comp range: $264-$457 | Unified is about 29% below comp and below the low end of the comp range. Comp, S26, and StarGem all cluster in the mid-$300s. |

Reproduction note: local Node reproduction of the cushion path with report dimensions returned S33A at about $155, S26 lookup at $219, and direct cell support of zero. The radiant absolute value depends on the exact shape-style normalization, but the UI diagnostics and local model path agree on the important failure mode: empty direct support plus S33A anchorN=1 while S26/comp support is materially higher.

## How The Current White Branch Routes

DiamondProd vNext routes white diamonds through WhiteProd vNext. The intended expert order is S30 supported curves, then S26 lookup, then S33A constrained anchors, then S28 monotone fallback.

| Router step | Expected role | What happened in these cases |
| --- | --- | --- |
| S30 supported curves | Use smooth curves when the exact or parent curve has enough support and passes the S28 monotonicity guard. | No usable supported curve for these off-catalog shape/color/clarity cells, so S30 is skipped. |
| S26 lookup | Use dense supplier lookup cells where the StarGem reconstruction is trusted. | A lookup exists and agrees with comps, but the router rejects the broad F/G lookup levels and the exact support tier is empty. |
| S33A constrained anchors | Transfer/extrapolation fallback when stronger support is unavailable. | A one-row L1 anchor is accepted as primary even though confidence is low and market evidence points higher. |
| S28 fallback | Monotone floor when no better expert is safe. | Not reached because S33A returns a positive price. |

## Findings

### 1. Weak S33A anchors can become primary at normal carat weights

The code protects high-carat weak anchors by falling back when carat is at least 5ct and anchorN is below the S33 threshold. These two examples are 1.92ct and 3.07ct, so they bypass that guard. The result is a displayed primary with fallbackReason=s33a_weak_anchor_n1.

Why this matters: S33A level-1 anchors use full anchor weight to preserve monotonicity. That is a reasonable mathematical constraint, but it means a one-row anchor can materially steer the price unless the router blocks low-support anchors from becoming final display prices.

### 2. S26 lookup is too narrowly gated for comp-corroborated empty cells

For the cushion, S26 lookup reconstructs about $219 with lookupCount=2238. For the radiant, S26 lookup reconstructs about $346 with lookupCount=13. Both agree with the live comp engine, but the router only treats early lookup levels as S26-good and only accepts broad sparse-cell S26 fallback when the direct cell tier is sparse. These cases are tier=empty, so S26 is skipped.

This is the central routing mismatch: direct ML support is empty, but supplier/comp support is not empty. The router currently treats empty direct training support as a reason to move deeper into S33A instead of asking whether S26 or comps are better-supported market evidence.

### 3. The benchmark misses this slice

Current WhiteProd benchmark metrics look strong overall: row-holdout MAPE is 4.79% versus S26 at 5.35%, and cell-holdout MAPE is 4.88%. But the benchmark has no empty-tier holdout rows and no pinned normal-carat anchorN=1 cases. Its weak-anchor reason counts include high-carat n1 rows and normal n2-n9 rows, but not the exact normal-carat n1 pattern observed here.

### 4. Shape-style normalization deserves a dedicated regression check

The rectangular radiant case is especially sensitive to shape-style normalization. The UI says Cut Cornered Rectangular Modified Brilliant, but the observed $80/ct output is consistent with a low-support radiant/square-radiant style path. The shape mapping should be pinned so rectangular cut-cornered reports cannot silently drift into the wrong S33A anchor family.

## Recommended Fix Plan

| Priority | Change | Why it fixes this issue | Acceptance gate |
| --- | --- | --- | --- |
| P0 | Add a weak-anchor production guard for all carat weights: if S33A anchorN < 10, do not return it as the primary when S26 lookup has support or the comp engine has a nearest-match blend. | Prevents anchorN=1 from outranking corroborated market evidence. | The two observed cases no longer return S33A weak-anchor primary. |
| P0 | Create a corroborated fallback rule: use S26 lookup when lookupCount >= 5 and comp/S26 are within a calibrated agreement band, or use comp-reconciled output when the live comp engine is stronger. | Avoids a blind S26 switch while still using S26 when comps confirm it. | Cushion resolves near the $205-$220 cluster; radiant resolves near the $340-$360 cluster or into a review band. |
| P0 | Expose a fallbackReason such as weak_s33a_to_s26_lookup or weak_s33a_to_comp_reconciled. | Makes future UI/debugging obvious instead of showing a generic low-band S33A result. | Regression tests assert the fallback reason. |
| P1 | Pass white compEstimate into DiamondProd or run DiamondProd through the existing reconciler before displaying it as unified. | A value called unified should not ignore live comps when ML support is weak. | When ML and comp disagree by more than 15%-20% under weak support, displayed output uses reconciled comp-aware pricing. |
| P1 | Add a weak-anchor audit report to shadow release. | Turns this into a monitored release risk instead of an anecdotal catch. | CI/report fails on unreviewed anchorN < 5 outputs with large S26/comp deltas. |
| P2 | Add real training/comp rows for off-catalog white G/VS2 cushions and F/VS2 radiants, including shape-style variants. | Improves the underlying model, but this is secondary because the app already has enough market evidence to avoid the bad displayed value. | Direct cell support no longer empty for common report-derived cases. |

## Testing Plan

### Pinned regression cases

| Test case | Input | Expected behavior |
| --- | --- | --- |
| LG617442564 cushion | 1.92ct Cushion Brilliant G VS2, CVD, no cut grade, ratio 1.39 | Does not return S33A weak-anchor primary. Price should route to S26/comp-reconciled support, or at minimum not sit below 85% of the $211 comp blend when comp support is available. |
| LG758549300 radiant | 3.07ct Cut Cornered Rectangular Modified Brilliant F VS2, CVD, no cut grade, ratio 1.45 | Does not return S33A weak-anchor primary. Price should route to S26/comp-reconciled support, or at minimum not sit below 85% of the $347 comp blend when comp support is available. |
| Shape mapping guard | IGI shape text: Cut Cornered Rectangular Modified Brilliant | Maps to rectangular radiant style consistently, not square radiant or an unknown raw-label style. |

### Automated checks to add

- Unit tests in research/scripts/test-white-prod-vnext.mjs for anchorN < 10 plus S26 lookup fallback.

- Golden fixtures in research/scripts/test-diamond-prod-vnext-golden-fixtures.mjs for both observed cert cases.

- Browser/app parity test that sends starsgemLookupRowFromState through predictDiamondProdVNextLocal, because the app uses a browser-local predictor copy.

- Benchmark slice for empty direct cells and selected-spec rows, since the current row/cell holdouts have no empty-tier examples.

- Shadow-release weak-anchor audit: list every anchorN < 5 result, S26 lookup price, comp estimate, percent delta, and final route.

### Commands For Verification

| Command | Purpose |
| --- | --- |
| npm run test:white-prod-vnext | Verify white router behavior and new weak-anchor fallback tests. |
| npm run test:diamond-prod-vnext | Verify unified white/fancy branch contract still holds. |
| npm run test:diamond-prod-vnext-golden | Verify pinned case fixtures and branch routing. |
| npm run benchmark:white-prod-vnext | Confirm row, cell, sparse, high-carat, and monotonicity gates after the route change. |
| npm run shadow:diamond-prod-vnext | Inspect live-like large deltas and weak-anchor cases before display cutover. |

## Appendix: Evidence Used

Observed UI case data came from the two pasted text captures supplied with the request. Code and artifact evidence came from the local repository files listed below.

| Evidence | Location or artifact | Relevant detail |
| --- | --- | --- |
| White router | research/scripts/predict-white-prod-vnext.mjs and index.html browser copy | S30 -> S26 -> S33A -> S28 routing; high-carat-only weak-anchor guard; s26MinLookupLevel=4. |
| S33A release notes | research/S33-release-report.md | S33A was not recommended as a sole production model; it was intended as one routed expert. |
| Weak-anchor follow-up | research/white-prod-vnext-remaining-production-changes.md | Prior work already flagged weak-anchor review, but focused mainly on high-carat rows. |
| Benchmark artifact | research/data/benchmark-white-prod-vnext.json | Overall gates pass, but empty-tier holdout coverage is zero. |
| Local reproduction | Node predictor inspection, June 4, 2026 | Cushion: direct cell support 0, S26 lookup $219, S33A anchorN=1 near $155. Radiant: direct cell support 0, S26 lookup $346, S33A anchorN=1. |
| Quick route experiment | Temporary benchmark simulation, June 4, 2026 | A broad weak-S33A-to-S26 rule moved only 4/4415 row-holdout rows and 1/5225 cell-holdout rows, with row MAPE 4.79% -> 4.82%; this supports a narrow corroborated rule rather than a blanket switch. |

## Implementation Record — June 4, 2026

### Changes Applied

| File | Change | Status |
| --- | --- | --- |
| `research/scripts/predict-white-prod-vnext.mjs` | P0: Added weak-anchor S26 corroboration guard for all carat weights. S33A anchors with anchorN < 10 OR anchorLevel >= 4 now check S26 lookup (any level A-G, count >= 5) before display. When S26 is >20% higher, routes to S26 with fallback reason `weak_s33a_to_s26_lookup_n*` or `broad_s33a_to_s26_lookup_l*`. Also added compEstimate pass-through for P1 comp reconciliation. Version bumped to v0.2.0. | ✅ Applied |
| `research/scripts/predict-diamond-prod-vnext.mjs` | P1: Pass opts (including compEstimate) through to WhiteProd branch. Version bumped to v0.2.0. | ✅ Applied |
| `research/scripts/test-white-prod-vnext.mjs` | Added 4 regression fixtures: LG617442564 cushion, LG758549300 radiant, 2 empty-tier holdout cases. Extended test evaluation with priceMin/priceMax and expectReasonPrefix checks. | ✅ Applied |
| `research/scripts/test-diamond-prod-vnext-golden-fixtures.mjs` | Added 2 regression fixtures for the unified predictor. Extended test evaluation with priceMin/priceMax checks. | ✅ Applied |
| `research/scripts/audit-weak-anchors.mjs` | P1: New dedicated weak-anchor audit report. Lists every weak/broad S33A anchor, compares vs S26, flags large deltas, tracks which cases the router rescued. | ✅ Created |
| `package.json` | Added `npm run audit:weak-anchors` script. | ✅ Applied |

### Verification Results

| Check | Result |
| --- | --- |
| `npm run test:white-prod-vnext` | 19/19 fixtures pass, 224/224 display grid S28-routed |
| `npm run test:diamond-prod-vnext-golden` | 42/42 fixtures pass, 16/16 white parity, 224/224 grid, 162/162 monotonicity |
| `npm run benchmark:white-prod-vnext` | 14/14 gates pass, row MAPE 4.79% (unchanged), cell MAPE 4.88% (unchanged) |
| `npm run benchmark:diamond-prod-vnext` | 10/10 hard gates pass (S27 soft gate pre-existing) |
| `npm run test:parity` | 46/46 pass |
| `npm run audit:weak-anchors` | 405 weak/broad anchors found, 68 large deltas, 62 already handled by existing rules, 6 remaining overpricing cases (FLOWER_MODIFIED/ASSCHER specialty shapes — separate issue) |

### Observed Cases — Post-Fix

| Case | Before | After | Expert | Fallback Reason |
| --- | --- | --- | --- | --- |
| LG617442564 1.92ct Cushion G VS2 | $149 unified (S33A weak) | $219 S26 | S26 | `weak_s33a_to_s26_lookup_n1` |
| LG758549300 3.07ct Radiant F VS2 | $246 unified (S33A broad) | $346 S26 | S26 | `broad_s33a_to_s26_lookup_l5` |

Both cases now cluster with comp/S26/StarGem evidence ($205-$220 for cushion, $340-$360 for radiant).

### Remaining Known Gaps

- **Overpricing guard**: 6 specialty-shape cases (FLOWER_MODIFIED, ASSCHER) still route weak S33A anchors when S33A is >20% HIGHER than S26. The current guard only catches underpricing (S33A too LOW vs S26). These shapes may need separate S30 curve support or training data.
- **Shape mapping**: Rectangular radiant shape-style normalization needs a dedicated regression pin (P2 from plan).
