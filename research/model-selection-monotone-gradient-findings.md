# Model Selection — Which Single Model Builds the Right Gradients for Sparse Data

**Date:** 2026-06-01
**Question:** Setting aside the mixed-model champion, which one trained model is the most promising and *correct* surface for this data — i.e. the one most capable of producing the right price gradients and pricing sparse/empty cells in a way that respects what we already know about how gem pricing behaves?

> ## Re-fit correction (2026-06-01)
>
> The first version of this document recommended **S28 v0.2** based on its
> embedded self-reported metrics (8.79% MAPE, +0.57% bias) and its
> monotonicity-PASS flags. Running the live `predictS28` against the holdout
> invalidated those numbers. The old deployed S28:
>
> - underprices **97.9% of all stones**, overall bias **−26.8%** (not +0.57%);
> - gets worse with carat: **−14% at 1ct → −38% at 3–5ct → −54% at 10ct+**;
> - actually **violates the "never cheaper per carat" rule** for any stone that
>   is not D-color / IF-clarity (see §3.4).
>
> Root cause: the size×grade interaction terms (`colorRank_size`,
> `clarityRank_size`) imposed a grade penalty that grew with `log(carat)` faster
> than the carat scarcity premium grew. D/IF stones have rank 0 so the penalty
> vanished — which was the only spec the artifact's monotonicity gate sampled,
> so the bug passed review.
>
> **Current status:** S28 has been re-fit as
> `s28-monotone-parametric-v0.4-grade-premium-no-vintage`. The fix replaces the
> grade-size penalty with better-grade premiums, adds a full color×clarity carat
> monotonicity gate, disables the vintage live/parity mismatch, and fixes the JS
> magic-weight feature labels. Current live S28 is **10.69% MAPE, +1.02% bias,
> and 0/56 full-grid carat inversions**. On the report-hash holdout, live Node
> matches Python artifact metrics: **10.6151% vs 10.6149% MAPE**.
>
> **Revised conclusion:** S28 v0.4 is the best current *single-model* monotone
> surface for the sparse-gradient requirement. S26 is still more accurate on
> dense cells, but it is the mixed lookup/ML/comp champion you explicitly set
> aside.

**Short answer:** **S28 v0.4 — the monotone parametric trend surface.** It is the only single model in the family that encodes the domain laws as *structural constraints* rather than learning them by luck, and it is the only one that can transfer those laws into cells where we have little or no data. The other candidates are either mixed/blended (S26, S29, S27) or accurate only where data is dense and fundamentally unable to reason about sparse regions (S30).

---

## 1. What "correct" means for this data

You already stated the binding domain rules, and the data confirms them:

1. **Price-per-carat rises with carat.** A bigger stone of the same spec is never cheaper per carat.
2. **The rise is super-linear but not explosive.** It behaves like a smooth parabola/scarcity curve with step-ups at the magic weights (1, 1.5, 2, 3, 4, 5, 10, 20 ct), not an exponential blow-up.
3. **Grade order is fixed.** Better clarity ≥ worse clarity, better white color ≥ worse white color, HPHT ≥ CVD — holding everything else equal.
4. **Sparse cells must inherit the laws.** A 30 ct IF cell with two rows (or zero rows) must still price *above* a 10 ct IF cell, and an IF must price above a VVS1, even when that exact cell was never observed.

A model is "correct" for this data only if it cannot violate 1–3 and can still do 4. That is the lens for the whole comparison below.

---

## 2. The candidates and why most of them are disqualified

### S26 champion hybrid — disqualified by your own constraint
This is the live production model and it has the best held-out point accuracy (5.23% MAPE, 4.89% on dense cells). But it is exactly the **mixed model you said you don't want**: it dispatches between a multi-level lookup table, an ML model, and a comp engine. Its accuracy comes from fine-grained `(shape, color, clarity, carat-band)` lookup tables, which means:

- It produces **stair-steps, not gradients** — the curve jumps at bucket boundaries instead of flowing.
- In **sparse or empty cells it falls back** to coarser table levels and loses the grade relationships. The S29 work confirmed this: when a cell is genuinely held out, the lookup degrades from ~5% to ~9.5% MAPE, and the bounded-extrapolation segment shows S26 at 11.3% vs a constrained curve at 1.5%.
- It has **no structural guarantee** of monotonic $/ct — it is correct only because the tables happen to be populated.

It is the most *accurate* model, but it is not the most *correct* model in the gradient/sparse sense, and it is the blended architecture you explicitly rejected.

### S29 hybrid — disqualified: mixed, and it failed its own bar
S29 = S28 surface + per-cell empirical-Bayes offsets + a support-shrunk monotone LightGBM residual. This is a mixed model too, and after the audit fixes it **passes only 1 of 4 core decision rules**:

- It does **not** match S26 on dense held-out cells (9.42% vs 4.89%).
- It still has a **clarity-ladder inversion** introduced by the per-cell offsets (VVS2 < VS1 < SI1 > VS2 on the full-hybrid curve).
- On held-out cells it collapses back to pure S28 by design, so it **does not improve sparse extrapolation at all** (sparse held-out MAPE 290%, identical to S28).

S29's lesson is important and feeds the recommendation: the per-cell anchors are what *break* monotonicity and what *fail* to generalize. The part of S29 that actually behaves well is the S28 surface underneath it.

### S27 color champion — different problem, not in scope
S27 is a source-aware **dispatch policy** for fancy-color / colored lab diamonds (use Color S22, fall back to S23, then comps). It's excellent for colored stones (3.12% MAPE) but it is (a) a dispatch/mixed policy, and (b) scoped to the color problem, not the white-diamond carat/grade surface this question is about. Keep it for color; it isn't a candidate for the general gradient surface.

### S30 bounded smooth median — the seductive trap
S30 is the prettiest line on the explainer charts and has the best in-support accuracy of any single model (4.54% held-out MAPE on cells it covers, 1.47% on the bounded segment). That is why it *feels* trustworthy. But it is structurally unfit for the actual requirement:

- It is **per-spec**: it groups rows by `shape||color||clarity||type||cutTier` and fits an independent smoothed median curve per group. It has **no mechanism to transfer a grade premium into an empty spec** — if a cell has no rows, S30 has no curve and returns nothing (the benchmark's `missingCurve` segment is literally `n:0` for S30).
- It **clamps extrapolation** to the observed min/max and endpoint values. Outside the observed carat range it returns a flat line. That is "safe-looking" but it is the *opposite* of identifying sparse tails — it refuses to extend the gradient into the scarce region where you most need a defensible number.
- It has **no monotone grade constraints**: it can and does inherit local median inversions across color/clarity (documented as a known limitation), because medians of noisy supplier rows are not ordered.

So S30 is accurate precisely *because* it only answers where data is dense, and it is silent or flat exactly where the question — "accurately identify even sparse data areas" — is asked. It is a good **display-smoothing layer**, not a correct model.

---

## 3. Why S28 is the right answer

S28 is the only single model that treats the domain laws as **hard structural constraints baked into the functional form**, then learns the magnitudes from data. Its form is:

```text
log($/ct) =
  intercept
  + monotone carat scarcity curve            (slope projected >= 0.02, strictly increasing)
  + monotone magic-weight ramps + steps       (1/1.5/2/3/4/5/10/20 ct, all coeffs >= 0)
  + monotone clarity effect                    (better clarity cannot price below worse)
  + monotone white-color effect                (better color cannot price below worse)
  + monotone size x grade interactions         (premiums can grow with carat, never reverse)
  + monotone HPHT growth effect                (HPHT >= CVD)
  + learned shape / cut modifiers (ridge-shrunk)
  + supported shape/cut carat interactions     (nonnegative extras only)
  + no vintage term in v0.4, so live and training metrics share the same surface
```

### 3.1 It satisfies every rule you stated — by construction, not by accident
From the S28 artifact's own monotonicity checks (`starsgem-ml-model-s28-monotone-parametric.json`):

```text
caratPerCtNondecreasing : true
clarityBetterIsHigher   : true
colorBetterIsHigher     : true
hphtAtLeastCvd          : true
```

And the sampled ROUND / D / IF carat ladder is exactly the "parabola, not exponential" shape you described:

| Carat | $/ct |
|---|---|
| 0.5 | 148.18 |
| 1.0 | 150.24 |
| 2.0 | 175.65 |
| 3.0 | 177.09 |
| 3.9 | 183.26 |
| **4.0** | **191.96** ← magic-weight step |
| 5.0 | 192.82 |
| 10.0 | 509.35 |
| 30.0 | 1103.14 |

It rises monotonically, accelerates into the scarce large-stone tail, and shows
a discrete bump at the 4 ct magic weight. The clarity ladder (IF 150.24 → SI2
83.94) and color ladder (D 150.24 → J 82.03) are strictly ordered, and HPHT
(155.03) sits above CVD (150.24) at 1 ct.

### 3.2 It is the only model that genuinely handles sparse cells
Because the carat, grade, and growth effects are **ordered numeric features with sign-constrained coefficients**, a premium learned anywhere transfers everywhere:

> If S28 learns an IF premium at 1 ct, that premium is available at 3 ct and 30 ct even when the exact 30 ct IF cell has zero rows.

This is the precise capability you asked for — "create the right gradients to accurately identify even sparse data areas." A tree, a lookup table, or a per-spec median cannot do this because none of them know that `IF > VVS1 > VVS2` or `D > E > F`; they only know cells they have seen. S28 knows the *order* and is forbidden from inverting it, so its gradient extends correctly into thin and empty regions.

### 3.3 Its weakness is accuracy, and it is the right kind of weakness
S28 v0.4's held-out MAPE is 10.61% (vs S26's 5.23%, S30's ~4.5% in-support). It is meaningfully behind on **dense** cells. But note the shape of that gap:

- On dense, well-populated cells, S28 loses to the lookup/median models — this is the region where being "correct" matters least and raw memorization wins.
- On the **bounded-extrapolation** and **sparse** segments — the region this whole question is about — S28's constrained surface is the *only* one producing a defensible, monotone number. S30 either has no curve or clamps flat; S26 degrades to coarse fallback.

So S28 trades dense-cell sharpness for global correctness and sparse-cell competence. That is the right trade for the model you described wanting.

### 3.4 Empirical re-test and v0.4 correction

The old v0.2 artifact did not behave like the S28 architecture promised. When the
deployed `predictS28` was run against the row-index holdout, it showed a
systematic carat-growing underprice:

| Carat band | Mean bias | % priced below actual |
|---|---|---|
| 1.00–1.49 | −14.5% | 95.6% |
| 1.50–1.99 | −18.7% | 96.4% |
| 2.00–2.99 | −31.9% | 100% |
| 3.00–4.99 | −38.2% | 100% |
| 5.00–9.99 | −49.6% | 100% |
| 10.00+ | −54.0% | 100% |
| **Overall** | **−26.8%** | **97.9%** |

The reason was the old feature form:

```text
colorRank_size   = colorRank   * log1p(carat), coefficient <= 0
clarityRank_size = clarityRank * log1p(carat), coefficient <= 0
```

D/IF has rank 0, so the penalty vanished on the only spec the monotonicity gate
sampled. For a typical mid-grade stone the old curve inverted:

| Carat | $/ct |
|---|---|
| 1ct | $80.72 |
| 2ct | **$65.63** ← cheaper per carat |
| 5ct | **$45.82** ← cheaper still |
| 10ct | $54.98 |

S28 v0.4 fixes this with grade premiums:

```text
colorPremium   = (maxColorRank   - colorRank)   * log1p(carat), coefficient >= 0
clarityPremium = (maxClarityRank - clarityRank) * log1p(carat), coefficient >= 0
```

It also adds a full ROUND `{D..K} × {IF..SI2}` carat grid gate and fixes live
predictor parity. Current live diagnostic:

| Metric | S28 v0.4 |
|---|---:|
| Live row-index holdout MAPE | 10.69% |
| Live row-index signed bias | +1.02% |
| Live row-index % underpriced | 41.7% |
| Full-grid carat inversions | 0 / 56 |
| Report-hash Python holdout MAPE | 10.6149% |
| Report-hash live Node MAPE | 10.6151% |

So the original intuition was correct for v0.2, but the current v0.4 artifact now
meets the diagnostic's required fix: nonnegative net carat slope on the full
grade grid and live-vs-Python parity.

---

## 4. Recommendation

**The right architecture is a single monotone constrained surface, and S28 v0.4
is now the best current implementation of that idea.** It satisfies all four
requirements:

1. never price a bigger stone cheaper per carat,
2. produce a smooth super-linear (parabola-like) carat curve with magic steps,
3. keep clarity, color, and growth strictly ordered, and
4. transfer those laws into sparse and empty cells where every other model goes blind.

S26 remains the most accurate display model today because it is a blended
lookup/ML/comp system. But for your stated goal — one trained model that builds
the right gradients and can price sparse cells without losing the domain laws —
S28 v0.4 is the model to build on.

Use S30 only as a display/smoothing layer, never as the source number.

---

## 5. Evidence index

| Claim | Source |
|---|---|
| Old S28 v0.2 underpriced 97.9%, −26.8% bias, worsening with carat | historical empirical holdout re-test of `research/scripts/s28-predict.mjs` (see §3.4) |
| Old S28 ROUND G VS2 $/ct decreased 1→5ct (rule violation) | historical empirical probe of `predictS28`; old grade×size terms `colorRank_size`/`clarityRank_size` |
| Current S28 v0.4 has 0/56 full-grid carat inversions | `research/data/starsgem-ml-model-s28-monotone-parametric.json`; `research/data/s28-diagnostic.json` |
| Current S28 v0.4 live Node matches Python artifact metrics | `research/data/starsgem-ml-model-s28-monotone-parametric.json`; live report-hash parity check |
| S28 hard-constraint architecture and shape philosophy | `research/s28-monotone-parametric-trend-surface.md` |
| S30 in-support 4.54% MAPE, `missingCurve` n:0, bounded clamp | `research/data/benchmark-s30.json`; `research/scripts/s30-predict.mjs` |
| S30 per-spec limits, clamps tails, inherits inversions | `research/S30-bounded-smooth-median-prototype.md` (Limitations) |
| S29 passes 1/4 rules, clarity inversion, = S28 on held-out | `research/data/benchmark-s29-vs-s26-s28.json`; `research/S29-implementation-report.md` |
| S29 surface is the binding constraint | `research/S29-implementation-report.md` (§6) |
| S26 held-out 5.23% but mixed lookup, degrades held-out | `research/data/benchmark-s29-vs-s26-s28.json`; `research/S29-implementation-audit.md` (§1) |
| S27 is a color dispatch policy, out of scope | `research/s27-color-champion-hybrid-model.md` |
