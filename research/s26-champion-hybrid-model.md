# S26 — Champion Hybrid Lookup/ML/Comp Policy

**Status:** Implemented and deployed in the former S25 comparison panel  
**Date:** 2026-05-30  
**Artifact:** `research/data/starsgem-ml-model-s26-champion.json`

---

## Why S26 Exists

S25 exposed the wrong abstraction. It always returned a number, but its negative global carat beta made high-carat predictions obviously wrong:

```text
7.77ct ROUND E VS1:
S25      $715
S21/S22  $1,416
StarGem  $993
Exact 8ct comp adjusted to 7.77ct: about $1,736
```

S26 does not try to rescue that curve. It uses the strongest existing evidence by support regime:

- dense StarGem lookup surface for sheet-covered white stones;
- monotone-capped S22/S23 ML for model signal;
- live Alibaba/StarGem comp engine for high-carat and out-of-range cases;
- S27 / Color S22 remains the colored-gem path; Color S23 and source-adjusted color comps are guardrails.

---

## Model Policy

S26 is a champion policy model, not a single smooth estimator.

```text
S26 price =
  log-space blend(
    StarGem lookup reconstruction,
    S22/S23 monotone-capped ML,
    live comp engine estimate when available
  )
```

Source weights are inverse-variance weighted and capped:

```text
lookup cap: 65%
ML cap:     35%
comp cap:   70%
```

This prevents any one source from dominating when it is known to be brittle.

S26 also has an ML/anchor disagreement guard. When at least two strong non-ML anchors agree
with each other, but S22/S23 is far outside that anchor center, the ML source sigma is widened
to 1.5 so the lookup and comp anchors dominate the point estimate.

---

## Benchmark

On the 12,843-row StarGem Segment-A white sheet, S26's lookup benchmark is:

```text
S26 MAPE: 4.794%
Global hits: 0 / 12,843
```

Compared with the previous model comparison:

```text
S22 + S21 fallback: 11.36%
S23 + S21 fallback: 13.56%
S25 v1.2:            8.26%
S26 v1:              4.80%
```

This is in-sample to the StarGem lookup reconstruction, so it should be read as a production policy benchmark, not an academic holdout claim.

---

## Shape Results

```text
Shape        n      S26 MAPE
ROUND     9,701      5.51%
PEAR        768      1.86%
OVAL        746      1.60%
MARQUISE    420      2.53%
RADIANT     370      2.76%
PRINCESS    352      6.67%
EMERALD     258      2.55%
CUSHION     137      2.02%
ASSCHER      47      1.58%
SQUARE       31      1.24%
HEART        13      5.53%
```

S26 wins most shapes in the current comparison. S23 still wins PRINCESS and HEART on the old benchmark, so those remain watch-list segments.

---

## 40ct Monotonicity Fix

The prior S22/S23 display path let the S21 fallback invert clarity:

```text
40ct ROUND E:
VS2 raw fallback ≈ $12.7k
SI1 raw fallback ≈ $31.1k
```

S26 consumes the monotone-capped display predictions, so worse clarity cannot show above better clarity for the same carat/color/shape.

---

## App Deployment

The former S25 panel now loads:

```text
research/data/starsgem-ml-model-s26-champion.json
```

and displays:

```text
S26 (Champion)
```

S25 is no longer loaded by the app. Its code remains in the repo as a research artifact.

---

## Verification

```text
node research/scripts/train-s26-champion.mjs
node research/scripts/benchmark-all-models.mjs
npm run test:s26
npm run test:white-ml-display
```
