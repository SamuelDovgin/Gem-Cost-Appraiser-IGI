# Messi + StarsGem Shape Ratio & Multiplier Calibration Plan

**Document date:** 2026-05-22  
**Status:** Plan (not yet executed)  
**Goal:** Derive **empirical** shape multipliers and **L/W ratio price modifiers** from Wuzhou Messi Gems and Wuzhou StarGem wholesale inventories, then reconcile them with the hand-authored `shapeMult` and advisory `ratioGuides` in `index.html`.

---

## Why This Matters

Today the app uses two parallel systems that are **not fully connected**:

| Layer | What it does today | Source |
|-------|-------------------|--------|
| **Shape multiplier** (`shapeMult`) | Scales baseline E/VS1/round $/ct by cut | PriceScope / retail discount research (`diamond-cut-shape-reference.md`) |
| **Ratio guide** (`ratioGuides` + `assessRatio`) | UI badge: strong / neutral / weak outline | `shape_buckets.py` market sweet spots |
| **Comp engine v3** | Nearest Alibaba/Messi/StarGem comps in log space | `messi-comps.json`, `starsgem-comps.json`, `alibaba-comps-index.json` |

Messi and StarGem give us **~40k stones ≥1ct** with **measured L×W×D**, **IGI grades**, and **factory USD prices** — enough to answer:

1. At matched grade (e.g. D/VS1), what is the **observed price ratio vs round** for each canonical shape?
2. Within a shape, how does **$/ct change** as L/W moves away from the volume cluster (too short / too long)?
3. Where do **modified / sub-variant** cuts (elongated oval, moval, elongated cushion, sq_radiant) deserve a **separate multiplier** vs a **ratio modifier** on the parent shape?

Early Messi work already shows tension with the current model — e.g. **oval at 1ct D/VS1 is ~17% above round** in Messi Table 4F, while `shapeMult.oval = 1.08`; **moval at 1ct prices at parity with standard oval** despite `shapeMult.moval = 0.94` (retail-liquidity discount). This plan is how we resolve those gaps with data instead of intuition.

---

## Scope

### In scope

- White lab-grown, IGI, loose, **≥ 1.00 ct**, priced rows only
- Shapes with **≥ 30 priced comps** per source at anchor grades (relax for specialty)
- L/W sub-buckets already defined in `research/scripts/shape_buckets.py`
- Carat anchors: **1.0, 1.5, 2.0, 3.0, 4.0, 5.0 ct** (±0.05 ct window, same as `messi-gems-source-of-truth.md`)

### Out of scope (this pass)

- Fancy color (separate `shapeMultColor` track)
- Ice / specialty cuts (`ice_oval`, `ice_pear`, `lavender`, `ashoka`) — exclude from white ladder
- Alibaba listing capture (use as **validation**, not primary regression)
- Cut grade (EX/ID/VG) — hold constant or filter to EX+VG only after shape/ratio pass

---

## Data Sources & Artifacts

| Source | Raw file | Parser | Index output |
|--------|----------|--------|--------------|
| Messi Gems | `research/data/IGI Lab Grown Diamond List.2026.05.18xls.xlsx` | `research/scripts/analyze-messi-gems.py` | `messi-gems-index.json`, `messi-comps.json` |
| StarGem | `research/data/STARS Diamonds Stock2026.5.20.xls` | `research/scripts/analyze-starsgem.py` | `starsgem-index.json`, `starsgem-comps.json` |
| Shared bucketing | — | `research/scripts/shape_buckets.py` | `classify_shape_by_lw()`, `SHAPE_LW_BUCKETS` |

**Reference docs (read before analysis):**

- `research/messi-gems-source-of-truth.md` — shape codes, moval rule, Table 4F shape summary
- `research/white-diamond-igi-wholesale-pricing.md` — round baseline, oval Alibaba corroboration
- `research/diamond-cut-shape-reference.md` — current hand multipliers and L/W sweet spots

**Regenerate indexes before any analysis run:**

```bash
python3 research/scripts/analyze-messi-gems.py
python3 research/scripts/analyze-starsgem.py
```

---

## Definitions

### Normalized price unit

Use **$/ct** (`pricePerCarat` when present, else `pricePerStone / carat`). All ratios below are in **log space** unless noted:

```text
log_ratio_vs_round = ln($/ct_shape) − ln($/ct_round)
shape_multiplier_empirical = exp(median(log_ratio_vs_round))
```

### Matching cell (comparison bucket)

A stone is comparable to the round baseline when all of the following match within tolerance:

| Field | Anchor for primary ladder |
|-------|---------------------------|
| Color | D (secondary: E, F) |
| Clarity | VS1 (secondary: VVS2, VS2) |
| Carat | 1.0 / 1.5 / 2.0 / 3.0 / 4.0 / 5.0 ± 0.05 ct |
| Growth | Any (Messi shows no CVD/HPHT split at matched grade) |
| Cut | Not filtered initially |

### Canonical shape vs sub-variant

| Term | Field in index | Used for |
|------|----------------|----------|
| **Base shape** | Raw code → `MESSI_SHAPE_MAP` / `STARSGEM_SHAPE_MAP` | Parent family (oval, cushion, …) |
| **Canonical shape** | `classify_shape_by_lw()` → `shape` | Comp matching + multiplier key |
| **Sub-variant** | `subVariant` | Ratio bucket analysis only |

Examples: `oval` + L/W 1.65 → canonical `oval`, sub-variant `oval_elongated`; L/W 1.90 → canonical `moval`.

---

## Phase 1 — Inventory & Coverage Audit

**Objective:** Know what we can measure before fitting anything.

### 1.1 Per-source shape counts (priced, ≥1ct)

For Messi and StarGem separately, output a table:

| canonical_shape | n_priced | ct_min–max | has_LW_% | D_VS1_1ct_n | … |

Flag shapes below minimum sample (suggest **n < 30** at D/VS1/1ct → document-only).

### 1.2 L/W distribution histograms

For each **base shape** with L/W data, produce bucket counts aligned to `SHAPE_LW_BUCKETS`:

- oval: wide / standard / elongated / moval
- pear: wide / standard / elongated
- cushion: square / standard / modified / elongated
- radiant: sq_radiant / standard / elongated
- emerald, marquise, heart: per `shape_buckets.py`

**Deliverable:** `research/data/ratio-coverage-audit.json` + short markdown appendix in results doc.

### 1.3 Cross-supplier agreement check

For overlapping cells (D/VS1/1ct/2ct/3ct), compute:

```text
spread_pct = (max($/ct) − min($/ct)) / median($/ct)
```

If spread > **15%** for a shape, mark **low confidence** and widen comp-engine tolerance or keep generic `shapeMult` until Alibaba corroboration exists.

---

## Phase 2 — Empirical Shape Multipliers (vs Round)

**Objective:** Replace or validate each `shapeMult[shape]` entry with factory-observed medians.

### 2.1 Primary ratio table

For each **canonical shape** at each carat anchor and grade slice (D/VS1 first):

| shape | 1ct mult | 1.5ct | 2ct | 3ct | 4ct | 5ct | n | notes |
|-------|---------|-------|-----|-----|-----|-----|---|-------|

Where `mult = median($/ct_shape) / median($/ct_round)` in the same supplier and cell.

**Known Messi priors (D/VS1, from source-of-truth Table 4F — recompute to confirm):**

| Shape | ~1ct vs round | ~3ct vs round | Model today (`shapeMult`) |
|-------|---------------|---------------|---------------------------|
| oval | 1.17 | 0.91 | 1.08 |
| pear | 1.19 | 0.91 | 1.05 |
| marquise | 1.31 | 0.91 | 0.87 |
| heart | 1.30 | 0.91 | 0.86 |
| emerald | 1.03 | 0.88 | 0.83 |
| cushion | 1.04 | 0.93 | 0.90 |
| princess | 1.03 | 0.94 | 0.86 |
| radiant | 1.02 | 0.88 | 0.87 |

**Decision rule for “ideal” shape multiplier:**

1. Prefer **median across Messi + StarGem** when both have n ≥ 30.
2. If suppliers disagree >10%, use **lower of the two medians** for wholesale estimate (conservative jeweler cost).
3. If only one supplier has stock, use that median but tag confidence **medium**.
4. Allow **carat-dependent multiplier** where the table shows shape premium collapsing at 3ct+ (oval/pear/marquise vs round) — do not force a single constant if data rejects it.

### 2.2 Sub-variant shapes that may need their own multiplier

Evaluate separately (not folded into parent) when n allows:

| Shape key | Parent | Question |
|-----------|--------|----------|
| `moval` | oval | Does wholesale track oval or marquise? (Messi n=5 → document only; pool StarGem ovals L/W≥1.75) |
| `elongated_cushion` | cushion | Premium vs square cushion at 1ct? |
| `sq_radiant` | radiant | Discount vs rectangular radiant? |
| `oval_elongated` | oval | Premium for “hot” elongated oval vs standard? |

If sub-variant median is within **±3%** of parent, use **one parent multiplier + ratio modifier** (Phase 3). If **>5%** persistent gap, add a dedicated `shapeMult` key.

### 2.3 “Costs the most” shapes

Rank shapes by **median $/ct** at D/VS1/1ct and D/VS1/3ct:

- Identify top 3 **absolute $/ct** (likely round-adjacent + high-demand fancies at 1ct).
- Identify top 3 **premium vs round** (ratio > 1.10).
- Identify shapes where **retail multiplier < empirical wholesale ratio** (marquise, heart are candidates) → split into:
  - **Factory mult** (what Messi/StarGem charge)
  - **Resale discount** (optional second factor for fair/retail, not ws)

**Deliverable:** `research/data/empirical-shape-mults.json` with structure:

```json
{
  "anchor": { "color": "D", "clarity": "VS1", "carat": 1.0 },
  "shapes": {
    "oval": { "mult_messi": 1.17, "mult_starsgem": null, "mult_blended": 1.14, "n": 842, "confidence": "high" }
  }
}
```

---

## Phase 3 — L/W Ratio Price Modifiers (Within Shape)

**Objective:** Turn `assessRatio()` from advisory-only into optional **ws adjustment** for elongated/modified outlines.

### 3.1 Why ratio modifiers are separate from shape mult

Shape multiplier answers: “How does an **average** oval price vs round?”  
Ratio modifier answers: “Within ovals, how does a **1.25 wide oval** price vs a **1.45 standard oval**?”

Messi moval data suggests **ratio does not always move wholesale** even when retail dislikes the outline — modifiers must be **empirically fitted**, not copied from PriceScope retail discounts.

### 3.2 Method — ratio regression grid

For each base shape with ≥3 L/W buckets and ≥20 stones per bucket (at D/VS1/1ct):

1. Assign each stone to `subVariant` via `classify_shape_by_lw()`.
2. Compute median **$/ct** per bucket.
3. Choose **reference bucket** = highest count bucket (usually “standard” for oval/pear).
4. Define modifier:

```text
ratioMod(bucket) = median($/ct_bucket) / median($/ct_reference)
```

5. Cap modifiers to prevent outliers: clamp to **[0.85, 1.15]** at ws layer unless n > 100 and CI narrow.

### 3.3 Priority shapes (user focus)

#### Oval (+ moval / elongated)

| subVariant | L/W range (current) | Analysis question |
|------------|---------------------|-------------------|
| wide / round oval | < 1.30 | Discount vs standard? (looks round-ish) |
| standard | 1.30 – 1.54 | Reference bucket |
| elongated | 1.55 – 1.74 | Premium for trend elongation? |
| moval | ≥ 1.75 | Separate mult vs ratio mod on oval? |

**Hypothesis to test:** Standard oval carries **demand premium at 1ct**; moval may be **price-neutral at factory** but **resale-penalized** — consider `ratioMod_ws ≈ 1.0`, `ratioMod_fair < 1.0`.

#### Pear

| subVariant | L/W range | Analysis question |
|------------|-----------|-------------------|
| wide | < 1.45 | Stubby pear discount? |
| standard | 1.45 – 1.69 | Reference |
| elongated | ≥ 1.70 | Marquise-adjacent premium or discount? |

Pear tips and shoulder bowtie are not in spreadsheet data — modifier is **proxy via L/W only**; keep UI warnings from `assessRatio`.

#### Modified stones (cushion, radiant, emerald)

| Shape | Modifiers to test |
|-------|-------------------|
| cushion | `square_cushion` vs `cushion` vs `elongated_cushion` (+ explicit `长垫形` flag in StarGem) |
| radiant | `sq_radiant` vs elongated rectangular |
| emerald | wide vs standard vs elongated (step cuts: windowing risk may correlate with L/W) |

### 3.4 Functional form for “too short / too long”

After bucket medians, fit a simple curve for continuous ratio `r`:

**Option A — piecewise (recommended v1):**

Use existing `SHAPE_LW_BUCKETS` thresholds; store one multiplier per bucket.

**Option B — triangular kernel around ideal:**

```text
ideal = (idealLo + idealHi) / 2
ratioMod(r) = 1 − k * |r − ideal| / ideal   (k fitted from bucket slopes)
```

Only adopt Option B if bucket boundaries are noisy but monotonic trend is clear.

**Option C — no ws modifier:**

If bucket medians differ < 3% (moval case at 1ct), keep modifier at **1.00** and leave `assessRatio` as UI-only.

### 3.5 Interaction with comp engine

When exact Messi/StarGem comps exist at the stone’s ratio bucket, **comps win** — ratio modifier applies only to **baseline model path** (`baseWhitePerCt × shapeMult × …`), same pattern as “exact Alibaba comp beats generic oval mult” in `white-diamond-igi-wholesale-pricing.md`.

---

## Phase 4 — Reconciliation & Policy

### 4.1 Three-layer pricing model (target end state)

```text
ws_baseline = baseWhitePerCt(ct)
            × shapeMult_empirical[shape]      // Phase 2
            × ratioMod[shape][subVariant]     // Phase 3 (optional, ws)
            × clarityMult × colorMult × …
```

Comp engine v3 then **blends** toward nearest comp rows; ratio modifier should **attenuate** when comp confidence is high.

### 4.2 When factory data disagrees with retail liquidity

| Signal | Factory (Messi/StarGem) | Retail (PriceScope) | Policy |
|--------|-------------------------|---------------------|--------|
| marquise 1ct $/ct high | mult ~1.31 | shapeMult 0.87 | Use **factory mult for ws**; keep **resale note** in UI, not ws penalty |
| moval vs oval | ~parity | moval 0.94 | ws ratioMod ≈ 1.0; fair tier may use 0.94–0.97 |
| oval 3ct | near round | oval 1.08 | **Carat-dependent** shapeMult or comp-first |

Document each conflict in `research/data/shape-mult-policy-overrides.md` (generated after Phase 2).

### 4.3 Alibaba validation pass

For shapes with updated mults, spot-check against promoted rows in `alibaba-comps-index.json` (oval, pear, marquise ladders). Fail calibration if blended factory mult differs from Alibaba median by **>12%** at 1ct D/VS1 without documented reason (listing grade band mismatch, etc.).

---

## Phase 5 — Implementation Checklist

### 5.1 New analysis script (proposed)

`research/scripts/calibrate-shape-ratios.py`

- Loads `messi-gems-index.json` + `starsgem-index.json`
- Emits `empirical-shape-mults.json`, `ratio-modifiers.json`, console report
- Reuses `shape_buckets.classify_shape_by_lw` — **do not fork bucket logic**

### 5.2 App changes (`index.html`) — after data review

| Change | Risk |
|--------|------|
| Update `shapeMult` from empirical table | Medium — affects all white stones without comps |
| Add `ratioModWs` map keyed by `subVariant` or shape+bucket | Medium — must not double-penalize with `assessRatio` text |
| Extend `ratioGuides` for `oval_elongated`, `pear_wide`, etc. | Low — UI only |
| Carat-dependent `shapeMult` function | Higher complexity — only if Phase 2 table proves it |

### 5.3 Documentation updates

- Append empirical tables to `messi-gems-source-of-truth.md` (or new `shape-ratio-calibration-results.md`)
- Update `diamond-cut-shape-reference.md` wholesale multipliers with footnote: factory vs retail
- Note in `current-pricing-model-how-it-works.md` when ratio modifiers affect ws

### 5.4 Regression tests

- Re-run `research/scripts/parity-regression.mjs` fixtures
- Re-check calibration case LG563297279 (pear 1.55 ratio, SI1)
- Add fixture stones for: wide oval 1.25, moval 1.90, elongated cushion 1.40, squat pear 1.35

---

## Execution Order (Suggested Sprint)

| Step | Task | Owner output |
|------|------|--------------|
| 1 | Regenerate Messi + StarGem indexes | Fresh JSON |
| 2 | Phase 1 coverage audit | `ratio-coverage-audit.json` |
| 3 | Phase 2 shape mult table (D/VS1, all carats) | `empirical-shape-mults.json` |
| 4 | Phase 3 ratio modifiers (oval, pear, cushion, radiant, emerald first) | `ratio-modifiers.json` |
| 5 | Phase 4 policy overrides + Alibaba spot check | `shape-mult-policy-overrides.md` |
| 6 | Human review: approve ws changes vs UI-only | Sign-off |
| 7 | Implement script + wire into `index.html` | Code PR |
| 8 | Parity + calibration regression | Green fixtures |

---

## Open Questions (Resolve During Phase 2–3)

1. **Single global shapeMult vs carat curve** — oval premium at 1ct but parity at 3ct: constant 1.08 wrong?
2. **Moval** — separate shape key in comps vs ratio bucket on oval?
3. **StarGem `SQUARE` → princess mapping** — does it contaminate princess mult?
4. **ICE OV / ICE PS** — confirm exclusion from all white ratio work.
5. **Grade expansion** — after D/VS1 stable, repeat for E/VS1 and VVS2 with wider windows.
6. **Should `ratioMod` apply to fair/retail** or only ws? (Recommendation: ws only; fair keeps resale liquidity discount for exotic outlines.)

---

## Success Criteria

- Every mainstream white shape (round, oval, pear, cushion, radiant, emerald, princess, marquise, heart, asscher) has an **empirical mult** with documented n and supplier blend.
- Oval/pear/marquise have **bucket-level ratio modifiers** or a documented “no effect” with evidence.
- Discrepancies >10% between current `shapeMult` and factory data are **listed with a chosen policy** (change mult, comp-first, or UI-only).
- Calibration pear (LG563297279) and parity fixtures still pass after ws changes.
- `shape_buckets.py` thresholds updated only if bucket medians show **systematic misalignment** (e.g. moval threshold 1.75 validated or moved).

---

## Related Files

| File | Role |
|------|------|
| `research/scripts/shape_buckets.py` | L/W bucket definitions — single source of truth |
| `research/scripts/analyze-messi-gems.py` | Messi ingest |
| `research/scripts/analyze-starsgem.py` | StarGem ingest |
| `research/messi-gems-source-of-truth.md` | Published Messi tables & moval detection |
| `index.html` → `shapeMult`, `ratioGuides`, `assessRatio()` | Production targets for calibration |
| `research/white-diamond-igi-wholesale-pricing.md` | Round baseline & oval Alibaba corroboration |
| `research/diamond-cut-shape-reference.md` | Current multiplier reference |
