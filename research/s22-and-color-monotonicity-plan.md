# S22 — Isotonic Post-Process on S20 ExtraTrees: Analysis

Generated **2026-05-29** · Evaluation script: `research/scripts/evaluate-s22.mjs` · Data: `research/data/s22-evaluation.json`

Compare to: [S21 evaluation](s21-evaluation.md) · Baseline diagnosis: [ML grade monotonicity analysis](ml-grade-monotonicity-analysis.md)

---

## 1. Executive Summary

S22 applies recommendation #1 and #2 from `ml-grade-monotonicity-analysis.md` directly to the S20 ExtraTrees model **without retraining**:

1. **Isotonic post-process** — Layer-4 two-axis PAV (Pool-Adjacent-Violators) applied to the clarity and color ladders after ML prediction.
2. **Lookup smoothing** — inherited from S20's underlying lookup tables (no additional smoothing applied; see §8 for why this is deferred).

**Result:** S22 eliminates all 1,127 clarity inversions and 869 color inversions in S20, achieving 0 inversions on the full 3,465-cell sweep — identical to S21. The cost is a **+5.34 pp MAPE regression on individual stone pricing** when PAV is applied to every stone. This reveals an important architectural split: PAV is the right tool for *ladder display* but the wrong tool for *point pricing*.

**A production bug was also discovered and fixed during this work:** the S21 LightGBM model's JS inference was silently wrong because 4 feature computations were missing from both `index.html` and `starsgem-ml-predict.mjs`. See §6.

---

## 2. Background: What S20 Got Wrong

From `ml-grade-monotonicity-analysis.md`:

| Metric | S20 (ExtraTrees, no post-process) |
|---|---|
| Clarity inversions | **1,127** (37.9% of adjacent steps) |
| Color inversions | **869** |
| Largest single-step error | Heart 3ct E: VVS1 ($312) > IF ($127) — +146% |

Root causes identified:
- **Lookup-first architecture**: price = `lookup × tail × exp(tree_residual) × carat`. Tree has no monotone constraint on Clarity or Color.
- **Sparse / aliased buckets**: off-catalog grades (SI1 on white lab) land on `n=1` or fallback global buckets, and the residual trees blow up.
- **VVS1 vs VVS2 cliff**: the lookup key changes at VVS1→VVS2, often jumping to a different bucket with a completely different rate.

Recommended fixes (ordered):
1. Isotonic post-process on clarity (and color) after ML prediction ← *this is S22*
2. Lookup smoothing — blend sparse cells toward VS1
3. Monotonic constraints in training ← *this was S21's approach*
4. UI — show both ladders; flag inversion in warnings

---

## 3. S22 Design

**S22 = S20 ExtraTrees + Layer-4 two-axis PAV**

The implementation already exists in `research/scripts/starsgem-ml-predict.mjs` as `predictStarsgemMlMonotone`, originally written for S21. S22 simply applies it to the S20 model. No retraining, no lookup table changes.

```
User query (shape, carat, color, clarity)
         │
         ▼
   Build 5×7 grid           ← 35 calls to predictStarsgemMl(S20)
   [5 colors × 7 clarities]
         │
         ▼ Step 1
   PAV over clarity axis     ← non-increasing: IF ≥ VVS1 ≥ VVS2 ≥ ... ≥ SI2
   for each of 5 colors
         │
         ▼ Step 2
   PAV over color axis       ← non-increasing: D ≥ E ≥ F ≥ G ≥ H
   at requested clarity grade
         │
         ▼
   Return doubly-projected $/ct (S22)
```

**Total model calls per query: 35** (same as S21's Layer-4, same compute cost).

---

## 4. Monotonicity Results

Sweep: 9 shapes × 11 carats × 5 colors × 7 clarities = **3,465 cells** · Adjacent steps tested: 1,980 clarity, 2,772 color.

| Model | Clarity violations | % of steps | Color violations |
|---|---|---|---|
| S20 ExtraTrees (raw) | **1,127** | 37.9% | **869** |
| S21 LightGBM (raw, no PAV) | 934 | 31.5% | ~864 |
| **S22 = S20 + PAV** | **0** ✅ | **0%** | **0** ✅ |
| S21 LightGBM + PAV | **0** ✅ | **0%** | **0** ✅ |

S22 achieves identical monotonicity to S21. Both pass the zero-inversion gate.

**Breakdown by shape (S22 clarity violations: all 0)**

| Shape | S20 raw | S22 PAV |
|---|---|---|
| ROUND | 89 | **0** |
| OVAL | 123 | **0** |
| MARQUISE | 145 | **0** |
| PEAR | 116 | **0** |
| CUSHION | 81 | **0** |
| EMERALD | 111 | **0** |
| RADIANT | 90 | **0** |
| PRINCESS | 97 | **0** |
| HEART | 175 | **0** |

HEART and MARQUISE had the most inversions in S20 (specialty shapes with `cut='-'` and sparse training rows). Both are fully resolved by PAV.

---

## 5. Pinned Clarity Ladders

### 5.1 Marquise 4.08ct E — The Triggering Case

| Clarity | S20 raw | S22 PAV | S21 PAV |
|---|---|---|---|
| IF | $140/ct | $182/ct | $201/ct |
| VVS1 | $140/ct ←**viol** | $182/ct | $201/ct |
| VVS2 | **$194/ct** | $165/ct | $194/ct |
| VS1 | $154/ct ←**viol** | $154/ct | $155/ct |
| VS2 | $129/ct | $152/ct | $151/ct |
| SI1 | **$176/ct** | $146/ct | $147/ct |
| SI2 | $140/ct | $140/ct | $137/ct |

S20 violates at VVS2 > VVS1 and SI1 > VS2. S22 and S21 both produce strictly non-increasing ladders. IF and VVS1 share the same PAV-projected price ($182/ct) because the pool averaging merges the two cells (a small price to pay for guaranteed monotonicity).

### 5.2 Heart 3ct E — Worst S20 Single-Step Inversion

| Clarity | S20 raw | S22 PAV | S21 PAV |
|---|---|---|---|
| IF | $127/ct ←**viol** | $220/ct | $186/ct |
| VVS1 | **$312/ct** | $220/ct | $186/ct |
| VVS2 | $110/ct | $148/ct | $122/ct |
| VS1 | $109/ct ←**viol** | $148/ct | $122/ct |
| VS2 | **$224/ct** | $148/ct | $122/ct |
| SI1 | $127/ct | $127/ct | $122/ct |
| SI2 | $127/ct | $127/ct | $122/ct |

S20 had VVS1 at +146% above IF — a pricing error visible to any experienced buyer. S22 collapses VVS1 and IF into the same block ($220/ct), correctly reflecting that both are high-tier grades with thin liquidity at this carat weight.

### 5.3 Round 2ct E

| Clarity | S20 raw | S22 PAV | S21 PAV |
|---|---|---|---|
| IF | $125/ct ←**viol** | $151/ct | $171/ct |
| VVS1 | **$176/ct** | $151/ct | $171/ct |
| VVS2 | $121/ct | $126/ct | $125/ct |
| VS1 | $117/ct ←**viol** | $126/ct | $124/ct |
| VS2 | $118/ct ←**viol** | $125/ct | $122/ct |
| SI1 | **$130/ct** | $125/ct | $122/ct |
| SI2 | $126/ct | $125/ct | $122/ct |

3 inversions in S20 (VVS1, SI1 both above lower-clarity cells). S22 and S21 both fix all three.

### 5.4 Oval 3ct D

| Clarity | S20 raw | S22 PAV | S21 PAV |
|---|---|---|---|
| IF | $129/ct ←**viol** | $196/ct | $208/ct |
| VVS1 | **$262/ct** | $196/ct | $208/ct |
| VVS2 | $165/ct | $165/ct | $166/ct |
| VS1 | $154/ct | $154/ct | $152/ct |
| VS2 | $136/ct ←**viol** | $138/ct | $142/ct |
| SI1 | **$140/ct** | $138/ct | $142/ct |
| SI2 | $128/ct | $128/ct | $126/ct |

2 inversions resolved. S22's IF/VVS1 pool ($196/ct) vs S21's ($208/ct) reflects the different base-model anchors.

---

## 6. Production Bug Fix: Missing S21 JS Features

During evaluation, the S21 LightGBM model was found to be **systematically overestimating by ~50% for specialty shapes** (HEART, PRINCESS, etc.) in the JS inference. Root cause: the S21 model was trained with 4 new feature columns that were never implemented in the JavaScript predictor.

| Feature | Python formula | JS status before S22 |
|---|---|---|
| `Dim_Volume` | `L × W × H` | ❌ Missing — fell back to median (177.2 ct³) |
| `Dim_Surface` | `2(LW + WH + LH)` | ❌ Missing — fell back to median |
| `LW_Ratio_refined` | `max(L,W) / min(L,W)` | ❌ Missing — fell back to median |
| `Table_Depth_Ratio` | `Table_Scale / Depth_Scale` | ❌ Missing — fell back to median |

**Fix applied to:**
- `research/scripts/starsgem-ml-predict.mjs` — analysis scripts
- `index.html` — production browser predictor

The fix is now merged into the `starsgemNumericFeatureValue` function in both files. Stones with actual IGI dimensions (cert-loaded mode) will now compute these features correctly. In selected-spec mode (no dimensions), all four fall back to the training median, which was the intended fallback behaviour.

**Note:** The test set used for all MAPE evaluations in this document is selected-spec only (no dimensions), so the feature fix does not change the MAPE numbers below. The impact will be visible in cert-loaded mode once the browser is refreshed.

---

## 7. Accuracy Results (Selected-Spec Test Set)

Test set: n=658 stones, selected-spec mode, no IGI dimensions. Shapes: ROUND (106), OVAL (80), PEAR (74), EMERALD (69), PRINCESS (61), MARQUISE (53), HEART (50), CUSHION (43), RADIANT (43), SQUARE (42), ASSCHER (21), others (15).

### 7.1 Overall MAPE

| Mode | MAPE | Notes |
|---|---|---|
| S20 ExtraTrees (raw — **production baseline**) | **4.63 %** | No PAV applied |
| S20 ExtraTrees (raw → Python reported) | ~6.01 % | Python selected-spec evaluation, different test split |
| **S22 = S20 + PAV (point pricing)** | **9.97 %** | PAV applied to every individual stone |
| S21 LightGBM (raw) | 14.42 % | S21 JS inference uses same test set; see §6 for bug context |
| S21 LightGBM + PAV | 17.06 % | Additional PAV cost on top of S21 raw |
| S21 Python (cert-loaded, no PAV) | ~5.61 % | From s21-evaluation.md; different test set & no PAV |

> **Why S21 raw shows 14.42% on this test set:** The test set has specialty shapes (HEART, PRINCESS, SQUARE) with `cut='-'` in selected-spec mode. S21's LightGBM with monotone constraints doesn't generalise as well to this regime as S20's ExtraTrees. S21's Python evaluation used a different test split with different shape/cut distribution, giving 6.76% selected-spec MAPE. The JS test here is a stricter out-of-distribution test for S21.

### 7.2 MAPE by Carat Bucket

| Bucket | n | S20 raw | S22 PAV | S21 PAV |
|---|---|---|---|---|
| 0.30–0.49 ct | 9 | **4.05 %** | 6.54 % | 7.37 % |
| 0.50–0.69 ct | 40 | **3.79 %** | 10.72 % | 10.99 % |
| 0.70–0.89 ct | 31 | **3.78 %** | 11.34 % | 10.74 % |
| 0.90–0.99 ct | 1 | **3.08 %** | 4.57 % | 11.55 % |
| 1.00–1.49 ct | 109 | **5.52 %** | 6.77 % | 16.54 % |
| 1.50–1.99 ct | 99 | **5.21 %** | 10.80 % | 24.47 % ⚠️ |
| 2.00–2.99 ct | 99 | **5.86 %** | 11.81 % | 21.82 % ⚠️ |
| 3.00–3.99 ct | 87 | **5.33 %** | 11.68 % | 20.90 % ⚠️ |
| 4.00–4.99 ct | 52 | **3.12 %** | 8.44 % | 14.96 % ⚠️ |
| 5.00–9.99 ct | 86 | **3.25 %** | 10.32 % | 11.03 % |
| 10.00+ ct | 45 | **3.06 %** | 8.89 % | 9.90 % |

S22 PAV's MAPE cost is fairly consistent across carat buckets (+3 to +8 pp vs S20 raw). S21 PAV's cost is much larger in the 1.5–5 ct range, driven by the S21 model's own accuracy gap on specialty shapes at these weights.

---

## 8. PAV Cost Analysis

When PAV is applied to every individual stone query (current production behaviour), it modifies the prediction for the majority of stones:

| Metric | Value |
|---|---|
| Test stones evaluated | 658 |
| PAV changed prediction (>0.1% shift) | 518 / 658 = **78.7%** |
| Of changed: worsened APE | 433 / 518 = **83.6%** |
| S20 raw MAPE | 4.63 % |
| S22 PAV MAPE | 9.97 % |
| PAV MAPE cost (point pricing) | **+5.34 pp** |

### Why PAV hurts point pricing accuracy

PAV's job is to force a non-increasing sequence: `price(IF) ≥ price(VVS1) ≥ ... ≥ price(SI2)`. When two adjacent clarity grades have nearly the same underlying prediction, PAV averages them into a block. This averaging is correct for the *ladder display* but wrong for *individual stone pricing*:

- A VVS1 stone's actual price depends on the training rows for that specific (shape, carat, color, VVS1) cell.
- PAV replaces that individual cell's prediction with an average of `n` clarity cells (wherever the violating block extends).
- This average is systematically *lower* than the VVS1 raw prediction, because the pool includes VS1, VS2, SI1 cells that pull the average down.

In short: PAV is a monotonicity corrector, not a pricing model. Using it as a pricing model introduces systematic downward bias on higher-clarity stones.

---

## 9. Comparison to S21

S21's design goal was to build monotonicity into the model itself (Layers 1–3: isotonic lookup, ordinal rank features, monotone LightGBM constraints), with Layer-4 PAV as an unconditional backstop. S22 takes the opposite approach: keep S20 as-is and apply only Layer-4.

| Property | S20 | S22 | S21 |
|---|---|---|---|
| Algorithm | ExtraTrees | ExtraTrees | LightGBM |
| Training MAPE (Python, cert-loaded) | ~5.41 % | ~5.41 % (same model) | ~5.61 % |
| JS MAPE on this test set (raw) | **4.63 %** | **4.63 %** | 14.42 % |
| JS MAPE on this test set (with PAV) | — | 9.97 % | 17.06 % |
| Raw inversions (before PAV) | 1,127 | — | 934 |
| Inversions after PAV | — | **0** ✅ | **0** ✅ |
| Retrain needed? | — | **No** | Yes |
| JS inference cost per query | 1 tree call | 35 tree calls | 35 tree calls |
| Model file size | 27 MB | 27 MB | 1.8 MB |

**Key insight:** S21's LightGBM reduces raw inversions from 1,127 to 934 before PAV (Layer-4 still needed for 934 remaining). S22 starts from 1,127 inversions before PAV. Layer-4 PAV eliminates all inversions in both cases. The upstream monotone training (S21) is not strictly necessary if Layer-4 is applied — but it does reduce the magnitude of PAV corrections (smaller averaging blocks, less price distortion in the ladder display).

### Grid-level price shifts (from compare-s20-s21 script)

| | |
|---|---|
| Mean |Δ| S21 raw vs S20 | 7.1% of $/ct |
| Mean |Δ| S21 PAV vs S20 | 10.2% of $/ct |

S21's underlying model prices differ from S20 by an average of 7.1%. After PAV, the difference grows to 10.2%, confirming that PAV amplifies the divergence from the S20 anchor.

---

## 10. Architectural Recommendation: Decouple PAV from Point Pricing

The core finding is that **PAV should only be applied to the clarity/color ladder display, not to individual stone pricing**. The current production code calls `predictStarsgemMlMonotone` for both purposes (lines ~2488 and ~2636 in `index.html`), which needlessly degrades point-pricing accuracy.

### Proposed S22 deployment split:

| Purpose | Function to use | MAPE |
|---|---|---|
| Main price card (one stone) | `predictStarsgemMl(row, model)` — **raw S20** | **4.63 %** |
| Clarity ladder display | `predictStarsgemMlMonotone(row, model)` — **S20+PAV** | monotone ✅ |
| Color ladder display | `predictStarsgemMlMonotone(row, model)` — **S20+PAV** | monotone ✅ |

This split gives:
- Zero inversions in the clarity and color ladders ✅
- No MAPE regression on individual stone pricing ✅
- No model retraining needed ✅

### Lookup smoothing (recommendation #2 — deferred)

Recommendation #2 from `ml-grade-monotonicity-analysis.md` is to blend sparse clarity cells toward VS1. This would reduce the size of PAV averaging blocks and produce smoother ladders. It is deferred for two reasons:
1. PAV already guarantees 0 inversions without it.
2. Lookup smoothing requires rewriting the Python `build-browser-data.py` pipeline and regenerating the lookup tables — significant scope.

If IF/VVS1 PAV ties (same price for multiple grades) are a UX concern, lookup smoothing should be implemented as a follow-up. The expected benefit is fewer merged clarity blocks in the ladder.

---

## 11. Gate Summary vs S21

| Gate | Threshold | S22 | Pass? |
|---|---|---|---|
| Clarity inversions | = 0 | **0** | ✅ |
| Color inversions | = 0 | **0** | ✅ |
| Training MAPE regression | ≤ S20 + 0.5 pp | **0 pp** (same model) | ✅ |
| Point-pricing MAPE (with PAV) | — | +5.34 pp vs raw | ⚠️ (see §10) |
| Retrain required | No | **No** | ✅ |
| Marquise 4.08ct E ladder | strictly non-increasing | ✅ | ✅ |
| Heart 3ct E VVS1 ≥ VVS2 | ✅ | $220 ≥ $148 | ✅ |

S22 passes every monotonicity gate while requiring no model retraining and no training MAPE regression. The MAPE cost only materialises if PAV is applied to individual stone pricing (current behaviour) rather than being scoped to the ladder display (recommended).

---

## 12. Future Work

### Track A — S23 (structural monotonicity, no PAV dependence)

Goal: make Layers 1–3 themselves monotone so the guarantee is structural, not solely Layer-4 dependent. Key levers:

1. **Clarity-agnostic base anchor** — strip Clarity/Color from the lookup key used as the `base_rate`; move the full grade premium into monotone-constrained features (`Clarity_Rank`, `Color_Rank`). This eliminates the "jumping anchor" root cause.
2. **Large-carat accuracy** — 5–9.99 ct bucket has 12.28% MAPE in S21; align the tail anchor bucket boundary to avoid the 4→5 ct cliff.
3. **Soft PAV** — permit a small premium for the better grade when lookup support `n ≥ 30`, pooling only genuinely sparse cells. Avoids over-flattening the top of the ladder.

### Track B — Fancy-color monotonicity

Apply the same four-layer pattern to the color diamond model on the intensity and modifier axes. Key differences from white: monotone axis is intensity (not clarity), and modifier presence (Brownish/Greyish) must price strictly below the pure-hue equivalent.

Prerequisite: run `analyze-color-intensity-monotonicity.mjs` to quantify current intensity inversions before designing the retrain.

---

_Previous plan (proposal phase) archived. This document reflects the implemented S22 evaluation and its findings._
