# S30 Bounded Smooth Median Prototype

**Date:** 2026-06-01  
**Status:** Research-only visual/model prototype  
**Trainer:** [`scripts/train-s30-bounded-smooth.mjs`](scripts/train-s30-bounded-smooth.mjs)  
**Predictor:** [`scripts/s30-predict.mjs`](scripts/s30-predict.mjs)  
**Artifact:** [`data/starsgem-ml-model-s30-bounded-smooth.json`](data/starsgem-ml-model-s30-bounded-smooth.json)

---

## Why This Exists

The explainer charts make the clean rolling median feel more trustworthy than
some parametric or hybrid candidates: it is smoother, follows the observed
commodity surface, and does not explode during extrapolation.

S30 is a small research prototype for that idea:

```text
clean spec medians
  -> local smoothing
  -> Catmull-Rom interpolation
  -> clamp to observed curve min/max and endpoint values outside support
```

It is not a replacement for S26. It is a candidate shape for a future smooth
surface layer.

---

## Model Behavior

S30 groups clean rows by:

```text
shape_style || color || clarity || typeName || cutTier
```

Fallback group:

```text
shape_style || color || clarity || typeName
```

For each supported group:

1. Bin rows by carat.
2. Use median $/ct per bin.
3. Smooth medians with a local rolling median.
4. Interpolate between knots.
5. Clamp predictions to the curve's observed min/max.
6. For carats outside observed support, return the nearest endpoint value,
   still clamped to observed min/max.

This directly encodes the intuition: do not extrapolate past the highest or
lowest observed smooth support for that spec.

---

## What It Fixes In The Charts

S30 gives the explainer a line that behaves more like the visible clean median:

- smoother than S26 lookup steps;
- less under-leveled than S28 on common dense specs;
- less aggressive than S26/S22 on high-carat extrapolation;
- bounded outside support.

It also helped reveal a charting bug: zoom charts were collecting actuals up to
`maxCt` but not filtering below `minCt`, so low-carat points affected zoomed
y-scales. The explainer now filters scatter and median curves to the visible
chart window.

---

## Limitations

S30 is intentionally simple and should not be live yet:

- It is per-spec and does not transfer grade premiums across empty specs.
- It can inherit local median inversions across color or clarity.
- It clamps extrapolation, which is safe-looking but may underprice true scarce
  tails.
- It has no held-out benchmark yet.
- It is trained from clean medians, not from a full constrained optimization.

The next serious version should combine this bounded-median target with
monotone grade constraints and held-out cell evaluation.

---

## Commands

```bash
npm run research:train-s30
npm run research:ml-explainer
```

The explainer displays S30 as **"S30 bounded smooth median"**.
