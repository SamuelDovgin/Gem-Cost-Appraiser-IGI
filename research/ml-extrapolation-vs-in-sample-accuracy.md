# ML Extrapolation vs In-Sample Accuracy

**Status:** Reference / decision note  
**Date:** 2026-05-31  
**Related:** [`s28-monotone-parametric-trend-surface.md`](s28-monotone-parametric-trend-surface.md) · [`model-comparison-s22-s23-s25-may2026.md`](model-comparison-s22-s23-s25-may2026.md) · [`s26-champion-hybrid-model.md`](s26-champion-hybrid-model.md) · [`monotonic-models-and-generalized-grade-modifier.md`](monotonic-models-and-generalized-grade-modifier.md) · [`ml-training-data-policy.md`](ml-training-data-policy.md)

This note answers:

1. Which model family is best for **extrapolating** to gems we have not seen?
2. Why **low in-sample MAPE** and **safe extrapolation** are different goals — and why one unconstrained model usually cannot win both.
3. What to try moving forward.

---

## Short answer

For **extrapolation**, the **S28 monotone parametric trend surface** is the right model family. The trained `s28-monotone-parametric-v0.2-clean-segment-a` artifact already proves the architecture works: it is the only model in the stack **designed** to price unseen specs correctly instead of falling back to a weak global anchor.

The catch: a **pure** parametric surface loses to the **S26** lookup-led hybrid on dense, already-seen cells. The best production direction is **not** “pick S26 or S28.” It is:

```text
S28 monotone surface (backbone / extrapolation floor)
  + monotone-constrained LightGBM residual (dense-cell accuracy)
  + isotonic projection on ladder displays (unconditional guarantee)
```

Colored gems stay on **S27 / Color S22**, with the same *pattern* applied later — not the white weights.

---

## Why one model usually cannot get low MAPE *and* extrapolate well

These sound like the same problem (“learn prices from data”) but they optimize different things.

| Goal | What “good” means | What the model is allowed to do |
|---|---|---|
| **Low in-sample MAPE** | Match every row in the sheet as closely as possible | Memorize cells, use lookup reconstruction, fit wiggles and outliers, bend rules locally |
| **Safe extrapolation** | Price unseen carat/grade/shape combos without inverting known order or collapsing the tail | Use a **smooth, constrained** surface; transfer premiums across empty cells; refuse to copy noise |

### 1. The sheet is not one smooth law of nature

StarGem rows mix:

- commodity CVD rounds at ~$109/ct and premium ID/EX tails at ~$169/ct in the **same** `3ct ROUND E VS1` bucket;
- Chinese specialty cuts (`传统切`, `冰花切`) at 2–6× standard cut prices in the same nominal shape/color/clarity;
- multiple rate-card eras (same spec can differ ~2× by row age).

A model that chases **lowest MAPE** will fit those modes separately — lookup tables, tree leaves, or unconstrained interactions. That is correct for **interpolation** (“what did this supplier charge for stones like this?”). It is wrong for **extrapolation** (“what should a 30ct IF cost if we have almost no 30ct IF rows?”) because the fitted wiggles do not generalize.

### 2. Constraints that help extrapolation hurt MAPE

S28 **forbids** the model from learning wrong signs:

- larger carat cannot lower $/ct;
- better clarity/color cannot price below worse;
- HPHT cannot price below CVD for the same spec.

Those rules remove degrees of freedom. Any row that *violates* market noise or mixed-era pricing cannot be fit perfectly. **Holdout MAPE ~8.8%** is partly the price of that discipline. S26’s **~4.8%** is partly because it **reconstructs the lookup surface** for dense cells — it is not trying to be a single global law.

### 3. Lookup and trees are interpolation machines

- **S26** blends StarGem lookup reconstruction, ML, and comps. Where the sheet is dense, lookup *is* the answer — hence low MAPE. Where the sheet is empty, lookup has nothing to reconstruct; the policy leans on comps and caps. That is **by design**, not a failure to “learn harder.”
- **S22 ExtraTrees** can hit good MAPE in covered cells but **cannot enforce grade order** (documented clarity inversions). Trees average leaves; they do not transfer “IF premium at 1ct” to “IF premium at 30ct” unless both cells exist.
- **S25** got **8.26%** in-sample but **negative global carat beta** — great on the training grid, broken at 7.77ct+.

So when someone asks “why can’t one model just learn everything and get 4% MAPE everywhere?” — the honest answer is: **you are asking for memorization and generalization in the same object.** The codebase already split those jobs (S26 for dense policy, S28 for constrained surface).

### 4. What “learn” should mean for unseen gems

For unseen specs we want the model to apply **known structure**:

- scarcity rises with carat (with magic-weight steps);
- better grades cost more;
- shape/cut modifiers are learned but shrunk.

That is **S28**. It will not match every historical row as tightly as S26. It will not invent a price from a single outlier leaf. It will produce a **defensible** number on an empty cell — which is what “gems we haven’t seen” requires.

---

## Model comparison: interpolation vs extrapolation

Dataset reference: white diamonds from `dataset-clean-training.json` unless noted.

| Model | In-sample / benchmark MAPE | Extrapolation behavior | Verdict for unseen gems |
|---|---|---|---|
| S22 ExtraTrees | 11.36% | Cannot extrapolate past training range; cannot enforce grade order (root cause of clarity inversions) | **No** |
| S23 LightGBM | 13.56% | Monotone-capable, but trees flatten outside observed carat range | **Partial** |
| S25 parametric v1.2 | 8.26% (in-sample) | Negative global carat β → underprices large stones (e.g. 7.77ct round ~$92/ct vs ~$223 market) | **No** — broken tail |
| S26 champion hybrid | **4.80%** (lookup-led benchmark) | Lookup-led; strong where sheet is dense; not a single extrapolating surface | **No** — by design |
| **S28 monotone parametric** | **8.79% holdout** (v0.2) | Positive carat scarcity slope; sign-constrained grades; premiums transfer to empty cells | **Yes** |

S26’s 4.8% is the better **interpolation** number. It is in-sample to the StarGem lookup reconstruction and has little to say about specs the sheet does not cover. S28’s 8.8% holdout is the better **extrapolation** number because the surface stays monotone and does not collapse at the tail.

---

## Why S28 wins for extrapolation (evidence)

Structural properties (see [`s28-monotone-parametric-trend-surface.md`](s28-monotone-parametric-trend-surface.md) and `starsgem-ml-model-s28-monotone-parametric.json`):

1. **Hard constraints pass on trained v0.2:** `caratPerCtNondecreasing`, `clarityBetterIsHigher`, `colorBetterIsHigher`, `hphtAtLeastCvd` all `true`.
2. **Fixed S25’s fatal carat flaw.** Sample round D IF $/ct: `117.24` (1ct) → `130.41` (4ct step) → `184.95` (10ct) → `273.40` (30ct) — rises with size instead of decaying.
3. **Premiums transfer across the grid.** Clarity/color are ordered numeric features with sign-projected coefficients, not independent one-hot leaves. An IF premium learned at 1ct is available at 30ct even when the 30ct IF cell is empty.
4. **Trains on clean Segment A through 41.72ct** (21,982 rows). Large-carat behavior is learned where the `shape_style` bucket has support; outputs should be labeled extrapolation when support is thin (see [`ml-training-data-policy.md`](ml-training-data-policy.md)).

Failures that motivated this work (5ct+ heart ~$96, 7.77ct round ~$92/ct) were **carat-extrapolation collapses**, not “the model forgot to train.”

### S28 v0.2 holdout snapshot (2026-05-31)

```text
Holdout MAPE:  8.79%   (n = 4,415)
Holdout MdAPE: 6.69%
```

Weakest segments (coverage-limited, not fixable by architecture alone):

| Segment | Holdout MAPE |
|---|---:|
| `heart_standard` | 19.3% |
| `princess_standard` | 13.7% |
| Carat bucket `10+` | 14.7% (+7.9% bias) |

---

## Recommended architecture (what to ship)

Do not pick a single winner. Use a **two-layer** design already implied across S21/S22/S26/S28 docs:

```text
┌─────────────────────────────────────────────────────────┐
│  Layer 1: S28 monotone parametric surface (backbone)     │
│  - Always returns a price                                │
│  - Extrapolation floor + audit baseline                  │
│  - Never inverts clarity/color/carat/HPHT                │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│  Layer 2: Monotone LightGBM residual (where supported)   │
│  - Target: log(actual $/ct / S28 $/ct)                   │
│  - Constraints from monotone-axes registry               │
│  - Shrinks toward 0 residual in dense selected-spec mode │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│  Layer 3: Isotonic / PAV on ladder displays only         │
│  - Guarantees grade ladders even in sparse cells         │
└─────────────────────────────────────────────────────────┘

Production policy (white): keep S26-style lookup/comp blend as champion
until S28+residual beats it on a TRUE held-out benchmark; use S28 alone
where support is weak or spec is out of lookup range.
```

Supporting pieces:

- **`monotone-axes.json` registry** ([`monotonic-models-and-generalized-grade-modifier.md`](monotonic-models-and-generalized-grade-modifier.md)): one config per gem family; training builds LightGBM constraint vectors; inference runs PAV on ladders.
- **Colored gems:** S27 / Color S22 for point estimate; Color S23 for intensity guardrail. Later: **color S28-style surface**, not white S28 weights.

---

## Honest caveats

1. **S28 v0.2 is a linear ridge prototype**, not the full hybrid. Metadata says so. Residual LightGBM is how dense cells recover S26-class accuracy without giving up the backbone.
2. **Sparse shapes and 10ct+** need more training rows (3ct+ non-round white, especially heart/princess). No model invents reliable scarcity premiums from 13 heart rows.
3. **S26 benchmark is not a fair extrapolation test** until we add held-out specs that never appear in the lookup grid.
4. **Colored gems:** do not route through white S28. Reuse the architecture, retrain weights.

---

## What to try moving forward

Prioritized experiments. Each should report **holdout MAPE**, **segment MAPE**, **monotonicity gates**, and **pinned extrapolation cases** (not global MAPE alone).

### P0 — Measure the right thing

1. **True held-out white benchmark** — hold out entire `(shape_style, color, clarity, carat_band)` cells or report IDs, not random rows the lookup can reconstruct. Compare S26, S28, and S28+residual on that split.
2. **Pinned extrapolation smoke cases** (must not regress):
   - 7.77ct ROUND E VS1
   - 5.21ct HEART D VS1
   - 40ct ROUND E VS2 vs SI1 (clarity order)
   - 3.00ct ROUND E VS1 selected-spec-only (commodity vs EX tail)

### P1 — Train S28 + monotone residual (main bet)

1. Export S28 predictions on every training row.
2. Train LightGBM on `log(actual_upc / s28_upc)` with monotone constraints from the registry (clarity, color, carat, HPHT, cut style groups).
3. Selected-spec augmentation (mask growth, dimensions, cut) per [`starsgem-ml-training-diagnosis-and-retrain-plan.md`](starsgem-ml-training-diagnosis-and-retrain-plan.md).
4. Acceptance: holdout MAPE ≤ S28 alone; dense-cell MAPE approaches S26; zero clarity/color inversions on grid; pinned cases pass.

### P2 — Production dispatch rules

1. **High support:** `final = S28 * exp(residual)` with residual shrunk toward 0 when lookup support ≥ N.
2. **Low support / out of range:** `final = S28` (or S28 + comp blend like S26 tail policy).
3. UI: show support tier (`lookup`, `ml_residual`, `extrapolation`, `comp_assisted`) — same discipline as S26 source caps.

### P3 — Data and segments

1. More 3ct+ non-round white rows; IGI-enriched large stones already in clean set — keep `shape_style` buckets distinct.
2. Specialty cut features (`Is_Specialty_Cut`, `Cut_Style_Group`) on residual layer per S20 diagnosis.
3. Expand direct StarGem color anchors; prototype **color monotone surface** when anchor count justifies it.

### P4 — Do not pursue (for this goal)

- Single unconstrained ExtraTrees as the only production model.
- S25 unconstrained color gradient.
- Judging extrapolation models only by in-sample MAPE against the full sheet.

---

## Summary table

| Question | Answer |
|---|---|
| Best model for **unseen** white specs? | **S28** monotone parametric surface |
| Best model for **dense sheet** specs today? | **S26** champion hybrid |
| Can one model do both at ~4% MAPE? | **Not realistically** without blending layers or lookup; constraints and noise forbid it |
| What to build next? | **S28 backbone + monotone LightGBM residual + true held-out benchmark** |

---

*Artifact: `research/data/starsgem-ml-model-s28-monotone-parametric.json` · Trainer: `research/scripts/train-s28-monotone-parametric.py`*
