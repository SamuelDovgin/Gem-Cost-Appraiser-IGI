# S25 — Hierarchical Parametric Power-Law Model

**Status:** Research → Implementation  
**Date:** 2026-05-30  
**Motivation:** S20/S22's catastrophic failure on rare-spec × large-carat combinations (5.21ct Heart D VS1 → $96 total vs correct ~$1,090).

---

## 1. The Core Problem

S20 (and S23) are **interpolation engines**. They build a lookup table over `(carat_bucket × shape × color × clarity × cut)` cells and train trees to predict a multiplier on top of the lookup rate. This works extremely well where training coverage exists (MAPE 2.46% on the 198 training stones), but collapses at coverage gaps:

- 5ct+ Heart D VS1: Level-G fallback, `count=1`, `usdPerCt=$18.87` → $96 total (11× below reality)
- 2ct+ Round shapes: `GLOBAL` sentinel → similar collapse

The root cause: **the models cannot extrapolate across the carat dimension**. If you've only seen Hearts at 1–1.35ct, you have no principled way to price a 5ct Heart.

### The S21 Fallback Patch

We deployed S21 as a coverage fallback (substitutes when S20 hits `count≤3` lookups). This is a bandaid — S21 has better coverage but the same extrapolation limitation.

---

## 2. The Parametric Insight

Diamond pricing follows an approximate **power law in carat**:

$$\frac{\text{price}}{\text{ct}} = A_{\text{spec}} \cdot \text{carat}^{\beta_{\text{shape}}} \cdot e^{\gamma_{\text{cut}}}$$

Or equivalently in log space:

$$\log\!\left(\frac{\text{price}}{\text{ct}}\right) = \underbrace{\alpha_{\text{spec}}}_{\text{intercept at 1ct}} + \underbrace{\beta_{\text{shape}} \cdot \log(\text{carat})}_{\text{carat scaling}} + \underbrace{\gamma_{\text{cut}}}_{\text{cut adj}}$$

**The key insight:** $\beta_{\text{shape}}$ — the carat scaling exponent — is **transferable across color and clarity grades within a shape**. If we know that Rounds scale as $\text{carat}^{0.31}$, then a D VS1 Round and an H SI1 Round follow the same carat curve; only their intercept $\alpha_{\text{spec}}$ differs.

This means: **a spec with 5 observations at 1ct can price a 5ct stone** by applying $\beta_{\text{round}} \times \log(5)$ to scale the 1ct price up.

---

## 3. Data Reality Check

From StarGem segment A (12,843 standard stones, rows 15001–28394):

| Shape | n | Carat Range | β estimable? |
|---|---|---|---|
| ROUND | 9,701 | 0.30–5.06ct | ✅ Very precise (>8 octaves) |
| PEAR | 768 | 0.50–1.38ct | ⚠️ Narrow, ~1.5 octave |
| OVAL | 746 | 0.50–1.18ct | ⚠️ Very narrow |
| MARQUISE | 420 | 0.51–1.29ct | ⚠️ Very narrow |
| RADIANT | 370 | 0.50–1.63ct | ⚠️ Narrow |
| PRINCESS | 352 | 0.51–1.59ct | ⚠️ Narrow |
| EMERALD | 258 | 0.50–1.83ct | ⚠️ Narrow |
| CUSHION | 137 | 0.56–1.55ct | ⚠️ Narrow |
| HEART | 13 | 1.01–1.35ct | ❌ Unidentifiable from data alone |

**Critical finding:** Every fancy shape tops out below 2ct. StarGem's current stock doesn't include >2ct fancy shapes (or has almost none). This means β for fancy shapes cannot be identified from this data — it **must** be borrowed from rounds or from market priors.

This actually validates the parametric approach: it's not just nice to have — it's necessary. There is no other principled way to price a 5ct Pear or 5ct Heart from this dataset.

---

## 4. Model Architecture

### 4.1 Fitting β_shape (Carat Exponents)

**Step 1:** Fit a within-shape OLS for each shape with sufficient carat range:

```
log($/ct) ~ β_shape × log(carat) + δ_color × color_rank + δ_clarity × clarity_rank
```

Extract $\hat{\beta}_{\text{shape}}$ from the log(carat) coefficient.

**Step 2:** For shapes with narrow carat range or few observations, shrink toward $\hat{\beta}_{\text{round}}$:

$$\hat{\beta}_{\text{shape}}^{\text{final}} = w \cdot \hat{\beta}_{\text{shape}}^{\text{raw}} + (1-w) \cdot \hat{\beta}_{\text{round}}$$

where $w = \min(1, \text{carat\_range\_log} / 1.5)$. If carat range is only 0.5 log units (e.g., 0.5–1.5ct, i.e., $\log(1.5/0.5)=1.1$), weight $\approx 73\%$ toward round.

For HEART (carat range log = $\log(1.35/1.01) = 0.29$): $w = 0.19$ → almost entirely borrowing from rounds.

### 4.2 Fitting α_spec (Spec Intercepts)

**Step 3:** After extracting $\hat{\beta}_{\text{shape}}$, compute residuals for each row:

$$r_i = \log\!\left(\frac{p_i}{\text{ct}_i}\right) - \hat{\beta}_{\text{shape}} \cdot \log(\text{ct}_i)$$

**Step 4:** For each `(shape, color, clarity)` group, compute the shrunk mean:

$$\hat{\alpha}_{\text{spec}} = \frac{n_{\text{spec}} \cdot \bar{r}_{\text{spec}} + \lambda \cdot \bar{r}_{\text{shape}}}{n_{\text{spec}} + \lambda}$$

where $\lambda = 20$ (shrinkage strength). With $n=1$, weight $\approx 5\%$ toward observed, $95\%$ toward shape baseline. With $n=50$, weight $\approx 71\%$ toward observed.

### 4.3 Fitting γ_cut (Cut Adjustments)

Estimated from Round data only (rounds have EX/ID cut grades with large n). Fancy shapes mostly use `'-'` (no cut grade).

Since the dataset has almost exclusively ID/EX rounds (9,701 round rows: 7,931 ID + 1,769 EX, 1 VG), meaningful cut variation is minimal. γ_cut will be set conservatively based on industry priors: EX/ID ≈ 0.0, VG ≈ −0.05, G ≈ −0.10.

### 4.4 Prediction Function

```js
function predictS25(shape, color, clarity, carat, cut, model) {
  const key = `${shape}||${color}||${clarity}`;
  const beta  = model.shapeBeta[shape]    ?? model.shapeBeta._global;
  const alpha = model.specAlpha[key]      ?? model.shapeBaseline[shape]
                                          ?? model.shapeBaseline._global;
  const gamma = model.cutAdj[cut ?? '-']  ?? 0;
  const logUpc = alpha + beta * Math.log(carat) + gamma;
  const upc   = Math.exp(logUpc);
  return {
    price: upc * carat,
    upc,
    specCoverage: key in model.specAlpha ? 'spec' : 'shape_baseline',
  };
}
```

**Coverage: 100%.** Every (shape, color, clarity, carat) combination returns a principled estimate.

---

## 5. Expected Properties

### What this model does well
- **Extrapolates correctly to unseen carat ranges** — the entire point
- **No global sentinel fallback** — every spec has at least a shape baseline
- **Tiny footprint** — ~400 spec alphas + 9 beta values; browser JSON < 50KB
- **Interpretable** — β_round ≈ 0.3 means "$/ct increases by 30% per doubling of carat"
- **Monotone in carat** by construction (β > 0 → $/ct always increases with carat)

### Where it will underperform vs S20
- **MAPE on well-covered specs will be higher than S20's 2.46%** — S20 essentially memorizes its 198 training stones via the lookup table. S25 uses a global power law which will miss within-spec nonlinearity.
- **Expected S25 MAPE: 10–18%** on standard spec × carat combinations that S20 handles well.

### The right framing
S25 is not meant to replace S22 (S20's production deployment) — it's meant to replace the **global sentinel fallback**. The dispatch logic should be:

```
if (S22 hits GLOBAL or count ≤ 3):
  use S25 (parametric extrapolation)
else:
  use S22 (memorized lookup)
```

This is better than the current S21 fallback because S25 genuinely extrapolates rather than just having more lookup cells.

---

## 6. Model Card

| Property | Value |
|---|---|
| Model ID | S25 |
| Architecture | Hierarchical OLS power law |
| Parameters | ~450 (9 β values + ~430 α values + ~4 γ values) |
| Training data | StarGem segment A, 12,843 rows |
| Carat range | 0.30–5.06ct (round) |
| Extrapolation | Yes — via shared β |
| Coverage | 100% (no global sentinel) |
| Monotone in carat | Yes (β > 0 by construction) |
| Target MAPE | ~12% (vs S20's 2.46% on 198 samples) |
| Replacement for | S21 fallback in S22/S23 coverage gaps |

---

## 7. Limitations and Future Work

1. **β is round-dominated.** With 9,701 rounds vs 13 hearts, β is essentially estimated from rounds and imposed on all shapes. This is reasonable (carat scarcity premium is a market-wide force) but worth monitoring.

2. **Color/clarity coverage.** Only D/E/F/G colors and IF through SI1 clarity in training. Estimating prices for H, I, J color or SI2 requires extrapolating the color/clarity gradients.

3. **No source (CVD/HPHT) distinction.** All training data is from StarGem stock which is mixed CVD/HPHT. Currently not modeled as a feature.

4. **Cut data is almost all ID/EX.** γ_cut is nearly unidentifiable; set from priors.

5. **Future: add Messi data.** Messi color diamonds are a separate source but white prices could supplement training for non-round shapes at larger carats.
