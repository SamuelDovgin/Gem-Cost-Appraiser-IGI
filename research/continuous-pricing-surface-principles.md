# Continuous Pricing Surface — Design Principles

**Status:** Active design target  
**Date:** 2026-05-31  
**Related:** [`s28-monotone-parametric-trend-surface.md`](s28-monotone-parametric-trend-surface.md) · [`ml-extrapolation-vs-in-sample-accuracy.md`](ml-extrapolation-vs-in-sample-accuracy.md) · [`master-dataset-construction.md`](master-dataset-construction.md) · [`same-spec-price-spread-examples.md`](same-spec-price-spread-examples.md) · [`s26-champion-hybrid-model.md`](s26-champion-hybrid-model.md)

---

## Summary

The correct wholesale pricing model for lab-grown diamonds is **not** a piecewise lookup table indexed by carat bucket. It is a **continuous function of carat** (and other ordered attributes) that:

- moves **upward** as carat increases for a fixed spec (nondecreasing $/ct, with a small strict scarcity floor);
- can change **slope** across the carat range (different scarcity regimes);
- may have **intentional jumps** only at **market-meaningful thresholds** (magic weights: 1, 1.5, 2, 3, 4, 5, 10, 20 ct, etc.);
- must **not** jump because an internal bucket label changed (e.g. `2.99ct` vs `3.01ct` must not behave like unrelated cells).

**Carat buckets are a training and support tool.** They help estimate local density, detect bimodal clusters, and build lookup anchors. They must **not** define the shape of the price curve the user or the ML layer sees.

---

## What “correct” looks like

For a fixed white-diamond spec (shape/style, color, clarity, cut class, growth method), plot **$/ct vs carat**. The production curve should look like:

```text
$/ct
  │                                    ╱  (steeper tail, 5ct+)
  │                               ╱╱╱
  │                          ╱╱╱
  │                     ╱╱╱
  │                ╱╱╱
  │           ╱╱╱
  │      ╱╱╱
  │ ╱╱╱
  └────────────────────────────────────── carat
      1ct    2ct   3ct   4ct   5ct   10ct
                  ↑ optional step/ramp at magic weights
```

**Allowed:**

- Smooth segments with different slopes (log-carat hinges, scarcity tail, shape-specific carat interactions).
- A **ramp** approaching a magic weight (e.g. 3.9ct priced above 3.0ct).
- A **step or steeper segment** at/above a magic weight (e.g. 4.0ct ≥ 3.9ct, with a possible extra jump at exactly 4.0ct).

**Not allowed:**

- Flat $/ct between 2.8ct and 3.1ct, then a cliff because the row moved from bucket `2.00–2.99` to `3.00–3.99`.
- A chart where the “model” is visibly a staircase aligned to `starsgemCaratBucket()` boundaries.
- Blending commodity and premium modes into a jagged median that zigzags bin-to-bin.

The only jumps that are **product-real** are thresholds buyers recognize (just under / at / just over 1ct, 2ct, 3ct, 4ct, etc.). A jump from **2.99ct → 3.00ct** at a magic boundary is understandable. A jump from **2.99 → 3.01** driven only by spreadsheet bucketing is a modeling bug.

---

## Buckets vs surface

| Concept | Role | Must not |
|--------|------|----------|
| **Carat bucket** (`0.50–0.69`, `3.00–3.99`, …) | Count support; cluster prices; build coarse lookup anchors; segment MAPE in evaluation | Become the x-axis of the final price function |
| **Lookup table** | Strong prior where the sheet is dense; audit “what did the supplier charge in this cell?” | Be the entire champion estimate without interpolation |
| **Parametric / constrained surface (S28)** | Define the **continuous** law: log($/ct) = f(carat, grades, shape, …) with monotone constraints | Memorize every outlier row |
| **Tree residual (S22/S23)** | Small adjustments **on top of** a continuous anchor where data supports it | Replace the surface with leaf-wise constants across carat |
| **Champion blend (S26)** | Weight lookup, ML, comps by confidence | Present bucket lookup as a smooth “answer” without saying it is stepped |

**Rule:** If you remove bucket labels from the API and only pass `carat` as a float, the returned **$/ct must vary continuously** except at documented magic-weight features.

---

## Monotone carat (always upward)

For the same spec (holding shape/style, color, clarity, cut class, growth method fixed):

```text
carat₁ < carat₂  ⇒  $/ct(carat₁) ≤ $/ct(carat₂)
```

Prefer a **strict floor** on raw log-carat slope so larger stones are not merely tied when the sheet is flat in a bucket.

Total price still rises with carat because `price = $/ct × carat`. The curve may bend (slope changes) but must not **fall** as carat increases. Negative global carat beta (S25 v1) violated this in extrapolation and is explicitly out of scope.

---

## Magic weights: the only deliberate discontinuities

StarGem (and buyers) treat certain carat lines as scarcity thresholds. The model should represent them with **explicit features**, not accidental bucket walls:

```text
approach_4ct : ramps from 0 below the approach window to 1 at 4ct
step_4ct     : 0 below 4ct, 1 at/above 4ct
```

Both use **nonnegative** coefficients so:

- 3.9ct can cost more than 3.0ct (ramp),
- 4.0ct can jump above 3.9ct (step),
- the curve between 3.0 and 3.9 remains **connected and mostly smooth**, not a flat plateau until a bucket boundary.

Same pattern for 1, 1.5, 2, 3, 5, 10, 20 ct where data support exists. Where support is thin, shrink ramps/steps toward zero rather than inventing giant steps from one row.

---

## Data layer: why charts look “jagged” today

Raw `starsgem-index` rows for one nominal spec often form **two (or more) price modes**:

- current-rate commodity block (~$109/ct),
- older rate card or premium tail (~$169/ct),
- specialty cut styles at 2–6× standard (see [`same-spec-price-spread-examples.md`](same-spec-price-spread-examples.md)).

Plotting **all** points or **bin medians** on that mix produces zigzags. That is not a failure of “smooth plotting”; it is **bimodal data**.

**Training policy** ([`master-dataset-construction.md`](master-dataset-construction.md)) already moves toward a **single competitive surface**:

- group by `round(carat,2) + shape_style + color + clarity`;
- when an unexplained high cluster exists (≥30% gap, both sides meaningful), **quarantine the high cluster**, keep the lower/base cluster;
- quarantine lone points ≥40% above the style/spec median.

That is closer to “teach the floor,” not “teach every row.” It does **not** yet guarantee one number per spec; the **model** must still be continuous in carat.

Optional future tightening (document only; not required for this principle):

- **P25 or lower-cluster median** per spec group as training target for floor models;
- never train the champion surface on raw index without style-aware cluster cleanup.

---

## Model family alignment

| Approach | Continuous in carat? | Verdict |
|----------|----------------------|---------|
| Lookup keyed by `carat_bucket` only | **No** — steps at bucket edges | Support / audit layer only |
| S26 champion with lookup-heavy blend | **Mostly no** on dense cells — follows lookup steps | Production policy today; **not** the long-term shape of the law |
| ExtraTrees / bucket-balanced trees | **No** — piecewise constant leaves | Residual on top of anchor only |
| S25 unconstrained log-carat | Continuous but wrong tail (negative β) | Retired as champion |
| **S28 monotone parametric surface** | **Yes** — log surface + hinges + magic ramps/steps | **Target architecture** for the continuous law |
| S28 + monotone LightGBM residual | Continuous base + local corrections | Recommended production direction |

**Target stack:**

```text
continuous_surface(carat, spec)     ← S28-style, always defined
  × exp(residual_ml)                ← optional, shrunk when support weak
  blend(comp, lookup)               ← confidence-weighted, not a staircase substitute
```

Display and “best estimate” APIs should expose **surface(carat)** for sliders and charts. Lookup can be shown as **support dots** or a dashed “cell median,” not as the only line.

---

## Evaluation: how to know we met this bar

1. **Carat grid test** — Fix spec; evaluate $/ct at 0.05ct steps from 0.5ct to max. Assert:
   - nondecreasing $/ct;
   - no jump &gt; X% between adjacent steps **unless** the step crosses a declared magic-weight boundary;
   - document allowed jumps at 1 / 1.5 / 2 / 3 / 4 / 5 / 10 / 20 ct.

2. **Bucket boundary test** — Compare `$/ct(2.99)` vs `$/ct(3.01)` for ROUND E VS1 (and pinned cases). Difference must come from magic-weight features, not from bucket reassignment alone.

3. **Chart review** — Model line overlays on **clean** training actuals should be visually smooth; scatter may remain noisy. Median of raw index may remain jagged and should be labeled “raw supplier mix,” not “model.”

4. **Segment metrics** — Still report MAPE by bucket for diagnostics, but **do not** optimize a model because bucket MAPE looks good while the continuous curve steps.

---

## Implementation checklist (going forward)

- [ ] **Champion API** returns `predictContinuous(carat)` from S28 (or successor), not only bucket lookup.
- [ ] **Lookup** interpolated or used as a **prior** at bucket centroids, not as literal price for all carats in the bucket.
- [ ] **S26** relabeled in UI: “hybrid policy” with explicit note when lookup dominates (stepped) vs surface (smooth).
- [ ] **Training** uses `dataset-clean-training.json` only; residual ML targets `log(actual / surface)`.
- [ ] **Charts** ([`ml-model-explainer.html`](ml-model-explainer.html), [`ml-actual-vs-model-charts.html`](ml-actual-vs-model-charts.html)): primary line = continuous surface; optional smoothed clean median; raw index toggle off by default.
- [ ] **Docs / tests** add `continuous-pricing-surface.test` for grid monotonicity and magic-weight-only jumps.

---

## One-sentence policy

> **Buckets count stones; carat as a real number prices stones.** The shipped curve is continuous and upward in carat, with slopes that may change and jumps only at magic weights—not at spreadsheet bucket walls.

---

*This document is the design bar for replacing stepped lookup-led pricing with a continuous surface. S28 is the current prototype; S26 remains the interim champion until a surface+residual stack beats it on held-out specs **and** passes the continuity tests above.*
