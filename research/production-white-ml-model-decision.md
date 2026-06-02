# Production White-Diamond ML Model Decision

**Date:** 2026-06-01  
**Decision:** Keep **S26** as the production displayed price model. Do **not** ship
S28 or S31 as the production point estimate yet.

---

## Why

S28 v0.4 fixed the dangerous structural bug in S28 v0.2, but it is still not
accurate enough for production display:

| Model | Row holdout MAPE | Bias | Monotone gates |
|---|---:|---:|---|
| S26 champion | **5.67%** | -1.36% | Display-guarded, lookup based |
| S28 v0.4 | 10.62% | +0.89% | Passes full-grid S28 gates |
| S31 guarded anchor | 8.53% | -1.24% | Passes carat/color/clarity grid |

S31 is the right *direction* but still not the production answer. It improves
S28 on ordinary row holdout, but the held-out-cell benchmark shows it does not
yet improve sparse transfer:

| Model | Held-out-cell MAPE | Bias |
|---|---:|---:|
| S26 champion | **5.31%** | -0.82% |
| S28 v0.4 | 9.62% | +0.27% |
| S31 guarded anchor | 9.89% | +0.64% |

That means the anchor helps where similar rows exist, but it does not yet beat
the pure monotone surface on cells withheld by `(shape_style, color, clarity,
carat_band)`. Shipping it would trade production accuracy for architectural
neatness. That is the wrong trade.

---

## What S31 Proved

S31 is a useful research scaffold:

```text
S28 v0.4 monotone surface
  + support-shrunk empirical anchor
  + monotone-projected total log($/ct) grid
```

It passes the core structural scan:

```text
carat violations:   0 / 56 specs
color violations:   0
clarity violations: 0
```

Artifacts:

- `research/scripts/train-s31-guarded-anchor.mjs`
- `research/scripts/s31-predict.mjs`
- `research/data/starsgem-ml-model-s31-guarded-anchor.json`
- `research/data/benchmark-s31-guarded-anchor.json`

---

## Production Fix

The production fix is not to force S28 into production. The fix is:

1. **Keep S26 live** for the displayed price.
2. **Use S28 v0.4 as the structural prior** for research and sparse-cell guardrails.
3. **Continue S31 only if it improves held-out cells**, not just row holdout.
4. **Do not add a residual layer until S31 beats S28 on held-out cells.**

The next useful S31 work is not a residual model. It is better anchor transfer:

- tune `kPrior` and `maxAbsOffset` against held-out cells, not row holdout;
- test anchors without `carat_band` leakage versus projected carat-band grids;
- add parent anchors such as `(shape_style, color, clarity)` and
  `(shape_family, color, clarity)` as explicit held-out-cell transfer priors;
- only then consider a support-shrunk residual.

Release gate remains:

```text
Do not replace S26 unless the candidate:
  1. is within 1pp of S26 on dense row holdout,
  2. beats S28 on held-out cells,
  3. has zero carat/color/clarity monotonicity violations,
  4. passes pinned large-stone cases,
  5. has live-vs-artifact parity.
```

S31 currently passes #3 only. It is not production-ready.
