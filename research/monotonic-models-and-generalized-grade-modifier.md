# Which Models Can *Learn* That Better Grades Cost More — and a Generalized "Grade Modifier" for Any Gem

**Date:** 2026-05-29
**Status:** reference / design note
**Related:** [`s22-followup-implementation-plan.md`](s22-followup-implementation-plan.md) · [`s21-monotonic-grade-model-training-plan.md`](s21-monotonic-grade-model-training-plan.md) · [`ml-grade-monotonicity-analysis.md`](ml-grade-monotonicity-analysis.md)

This note answers two questions:

1. **Which model families can actually *learn* an ordinal "better grade ⇒ higher value" rule** (clarity, color, intensity), versus which ones can't and need a post-process?
2. **How do we make that a single reusable "modifier" that applies to every gem** — white diamonds, fancy-color diamonds, and any future colored stone — instead of re-solving it per model?

---

## 1. The thing we are trying to encode: ordinal monotonicity

For most gem value drivers there is a *known, fixed order* and a *known direction*:

| Gem family | Ordered attribute | Direction (holding all else fixed) |
|---|---|---|
| White diamond | Clarity `IF>VVS1>VVS2>VS1>VS2>SI1>SI2>I1` | better clarity ⇒ **higher** $/ct |
| White diamond | Color `D>E>F>…>Z` | better color ⇒ **higher** $/ct |
| White diamond | Cut `Ideal>Excellent>VG>Good` | better cut ⇒ **higher** $/ct |
| Any diamond | Carat (within a spec family) | larger ⇒ **higher** $/ct (scarcity) |
| Fancy-color diamond | Intensity `Faint<…<Fancy<Intense<Vivid` | higher intensity ⇒ **higher** $/ct |
| Fancy-color diamond | Modifier (Greyish/Brownish/Yellowish) | more modified ⇒ **lower** $/ct |
| Colored gemstone (future) | Saturation / clarity / origin tier | better ⇒ **higher** |

These are **monotonic constraints**: the price must be non-decreasing (or non-increasing) as you move along the ordered axis. The model does **not** need to learn the *order* — we already know it. It only needs to (a) respect it and (b) learn the *magnitude* of each step. That distinction is what determines which models are suitable.

The codebase already encodes some of these orders: `Clarity_Rank`/`Color_Rank` in `starsgem-mrpe-v2.py`, and `INTENSITY_RANK = {"light":0,"fancy":1,"deep":1,"dark":1,"intense":2,"vivid":3}` in `build-starsgem-color-anchors.py`.

---

## 2. Model families — can they learn/enforce monotonicity?

| Model family | Native monotone support? | How | Browser-deployable? | Verdict for gems |
|---|---|---|---|---|
| **LightGBM** (GBDT) | ✅ **Yes** | `monotone_constraints=[+1/-1/0,…]` per feature, `monotone_constraints_method="advanced"` | ✅ tree-walk JSON | **Primary choice.** Already used in S21. |
| **XGBoost** (GBDT) | ✅ Yes | `monotone_constraints` per feature | ✅ tree-walk JSON | Equivalent to LightGBM; fine alternative. |
| **CatBoost** (GBDT) | ✅ Yes | `monotone_constraints` | ✅ (export) | Good if categorical handling matters. |
| **Isotonic regression / PAV** | ✅ Guarantees it (1-D) | Pool-Adjacent-Violators along one ordered axis | ✅ trivial | **The "modifier" itself.** Use as calibration or post-process (Layer-4), not a full model. |
| **Sign-constrained GLM** (log-linear on ranks) | ✅ Yes | constrain coefficient sign: `β_clarity_rank ≤ 0` | ✅ trivial | Great interpretable baseline / floor; limited flexibility for interactions. |
| **TensorFlow Lattice / Deep Lattice Nets** | ✅ Yes | per-feature monotonicity flags on a lattice | ⚠️ heavier | Powerful for complex monotone surfaces; overkill + heavy for browser today. |
| **Monotonic MLP** (constrained weights) | ✅ Yes | non-negative weights + monotone activations | ⚠️ custom | Possible but more work to deploy/verify than GBDT. |
| **ExtraTrees / RandomForest** | ❌ **No** | — | ✅ | **This is the S20 bug.** Averages leaves; cannot constrain ordering. Only fixable by post-process (PAV). |
| **Plain MLP / kNN / SVR** | ❌ No | — | varies | No ordering guarantee; avoid for graded value. |
| **Ordinal regression** (e.g. `mord`) | n/a | predicts ordinal *labels* | — | Wrong tool: we predict a price that is monotone *in* an ordinal feature, not an ordinal label. |

### The practical takeaway

- **To learn monotonicity *inside* the model:** use a **GBDT with monotone constraints** (LightGBM/XGBoost/CatBoost). This is the only family that combines (a) native per-feature monotonicity, (b) enough flexibility to learn step magnitudes and interactions, and (c) a small browser-deployable tree-walk format.
- **To *guarantee* monotonicity unconditionally:** add **isotonic/PAV** as a thin projection layer (the existing `predictStarsgemMlMonotone`). This is model-agnostic — it works on ExtraTrees, GBDT, anything.
- **ExtraTrees/RandomForest can never do it themselves** — which is exactly why S20 had 1,127 clarity inversions and needed Layer-4 PAV.

Best-practice stack (what S21/S22 converged on, generalized): **GBDT monotone constraints (learn the magnitudes correctly) + isotonic projection on the ladder display (guarantee + handle sparse cells).** Belt and suspenders.

---

## 3. A generalized "grade modifier" that applies to ANY gem

The mistake to avoid is hand-coding clarity logic in one model, intensity logic in another, etc. Instead, define the ordinal structure **once as data**, and have both training and inference consume it. This is the reusable "modifier."

### 3.1 One config per gem family (the registry)

```jsonc
// monotone-axes.json — single source of truth for ordinal value structure
{
  "white_diamond": [
    { "feature": "Clarity_Rank", "order": ["IF","VVS1","VVS2","VS1","VS2","SI1","SI2","I1"], "direction": -1 },
    { "feature": "Color_Rank",   "order": ["D","E","F","G","H","I","J"],                      "direction": -1 },
    { "feature": "Cut_Rank",     "order": ["ID","EX","VG","GD"],                              "direction": -1 },
    { "feature": "Carat",                                                                     "direction": +1 }
  ],
  "fancy_color_diamond": [
    { "feature": "colorIntensityRank", "order": ["faint","light","fancy","intense","vivid"], "direction": +1 },
    { "feature": "modifierPenaltyRank",                                                       "direction": -1 },
    { "feature": "carat",                                                                     "direction": +1 }
  ],
  "colored_gemstone": [ /* saturation_rank: +1, clarity_rank: -1, … when that model exists */ ]
}
```

`direction` semantics: `+1` = price non-decreasing as the rank increases; `-1` = non-increasing. (Note clarity uses `-1` because rank 0 = IF = best; intensity uses `+1` because rank grows toward Vivid = best. The registry hides this per-feature so callers don't have to reason about it.)

### 3.2 Two consumers of the registry

**(A) Training-time constraint builder** — turns the registry into the GBDT `monotone_constraints` vector, in the exact (one-hot-expanded) feature order the model sees:

```python
def build_monotone_vector(feature_names, axes):
    by_feat = {a["feature"]: a["direction"] for a in axes}
    return [by_feat.get(f, 0) for f in feature_names]   # +1 / -1 / 0 per column
```

**(B) Inference-time projection** — PAV along each ordered axis, generalized so it works for clarity, color, intensity, or any future axis:

```js
// project a price grid to be monotone along one ranked axis, given direction
function projectMonotone(values, direction) {
  return direction >= 0 ? pavNonDecreasing(values) : pavNonIncreasing(values);
}
```

The existing `predictStarsgemMlMonotone` is the white-diamond special case of this (clarity then color, both `-1`). The generalized version loops over `axes` for the active gem family.

### 3.3 The reusable rule, stated once

> For each gem family, every value-ordered attribute is registered with an order and a direction. Training applies it as a GBDT monotone constraint; the ladder display applies it as an isotonic projection. **Point pricing uses the raw constrained model; ladder display uses the projection** (per the S22 finding — PAV is a ladder tool, not a point-pricing tool).

Adding a new gem (sapphire, moissanite, colored gemstone) = **add one registry entry**, no new monotonicity code.

---

## 4. How this maps onto current models

| Model | Today | With the generalized modifier |
|---|---|---|
| White diamond (S20 ExtraTrees) | no constraint; PAV bolted on | keep PAV for ladder; migrate residual learner to LightGBM with constraints from `white_diamond` axes (S23) |
| White diamond (S21 LightGBM) | constraints hand-set in `starsgem-mrpe-v2.py` | constraints generated from registry → no drift between training and inference |
| Fancy-color (ExtraTrees) | **no constraints, no projection** | LightGBM with `fancy_color_diamond` axes (intensity `+1`, modifier `-1`) + intensity-ladder projection (Track B / P4) |
| Future colored gemstone | n/a | register axes; reuse the same training + projection code |

---

## 5. Recommendation

1. **Standardize on LightGBM (monotone constraints) as the residual learner for any graded-value gem model.** It is the only family that learns step magnitudes *and* respects the order *and* deploys as a small browser tree-walk. (XGBoost/CatBoost are acceptable equivalents.)
2. **Keep isotonic/PAV as the universal guarantee layer on ladder displays** — model-agnostic, handles sparse cells, unconditional.
3. **Never use ExtraTrees/RandomForest alone for graded value** — they cannot encode ordering; they are the root cause of the inversions documented in `ml-grade-monotonicity-analysis.md`.
4. **Drive both training and inference from one `monotone-axes.json` registry** so "clarity is most valuable" (and intensity, color, cut, carat) is defined once and applied to every gem — including ones we add later — without rewriting monotonicity logic each time.
