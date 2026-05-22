# Wuzhou Messi Gems — IGI Lab Diamond Source of Truth

**Supplier:** Wuzhou Messi Gems Co., Ltd.  
**Location:** Guangxi, China  
**Source file:** `IGI Lab Grown Diamond List.2026.05.18xls.xlsx`  
**Source date:** 2026-05-18  
**Document date:** 2026-05-21  
**Scope:** IGI-certified, loose, lab-grown diamonds **≥ 1.00 ct** only  
**Purpose:** Independent secondary source of truth — isolated from Alibaba comps to avoid double-counting from the same supplier  

> ⚠️ **DO NOT MERGE with alibaba-comps-index.json.** Messi Gems is a primary supplier in both datasets. This index is analyzed and queried separately via `messi-gems-index.json`.

---

## Supplier Overview

| Field | Value |
|-------|-------|
| Company | Wuzhou Messi Gems Co., Ltd. |
| Experience | 12 years |
| Region | Guangxi, China |
| Main products | Lab Grown Diamond, Moissanite, 14K/18K Gold Jewelry, Created Emerald, Synthetic Stones |
| Certification | IGI (all stones in this list) |
| Growth methods | CVD (80.4%) and HPHT (19.6%) |
| Warehouses | 梧州仓 (Wuzhou), 中山仓 (Zhongshan) |
| Price format | USD per stone + USD per carat |

---

## Dataset Statistics (≥ 1 ct)

| Metric | Value |
|--------|-------|
| Total stone records | 18,090 |
| Priced records | 16,191 (89.5%) |
| Unique canonical shapes | 20 |
| Carat range | 1.00 – 40.81 ct |
| Price range | $115 – $2,158 per stone |
| Moval stones detected | 5 |

---

## Column Reference

| Column | Chinese / Code | Description |
|--------|---------------|-------------|
| NO | — | Row number |
| Lab | — | Certificate lab (all IGI here) |
| Report No | — | IGI certificate number |
| shape | — | Shape code (see §Shape Mapping below) |
| CT | — | Carat weight |
| Col | — | Color grade (D/E/F/G/H for white) |
| Cla | — | Clarity grade |
| Cut | — | Cut grade (EX = Excellent, ID = Ideal, VG = Very Good) |
| POL | — | Polish grade |
| SYM | — | Symmetry grade |
| flu | — | Fluorescence (N = None) |
| size1 | — | Length in mm |
| size2 | — | Width in mm |
| size3 | — | Depth in mm |
| Way | — | Growth method: CVD or HPHT |
| USD/STONE(美金/PCS) | 美金/PCS | Price per stone in USD |
| 单价CT | — | Price per carat in USD |
| 仓库 | — | Warehouse location |

---

## §1 Shape Code Mapping

All 20 canonical shapes derived from this file. Codes are the raw values from the `shape` column.

### Primary Shapes (priced, high volume)

| Raw Code | Canonical Name | Count (≥1ct) | Notes |
|----------|---------------|-------------|-------|
| `RD` | `round` | 7,083 | Round Brilliant |
| `OV` | `oval` | 2,442 | Standard oval. **See §2 for moval detection.** |
| `PS` | `pear` | 1,680 | Pear Shape (Brilliant) |
| `EM` | `emerald` | 1,680 | Emerald Cut (step cut rectangle) |
| `RA` | `radiant` | 933 | Radiant (brilliant-faceted rectangle/square) |
| `MQ` | `marquise` | 854 | Marquise (pointed ends, L/W 1.80–2.20+) |
| `PR` | `princess` | 756 | Princess (square brilliant) |
| `HT` | `heart` | 633 | Heart Shape |
| `CU` | `cushion` | 608 | Cushion (rounded-corner square/rectangle) |
| `ICE OV` | `ice_oval` | 522 | Ice/rough-polished oval — NOT standard grading |
| `AS` | `asscher` | 330 | Asscher (step-cut square) |
| `ICE PS` | `ice_pear` | 307 | Ice/rough-polished pear — NOT standard grading |

### Detected Derived Shape

| Canonical Name | Detection Rule | Count | Notes |
|---------------|---------------|-------|-------|
| `moval` | OV stones with L/W ratio ≥ 1.75 | 5 | See §2 |

### Specialty / Unpriced Shapes

These shapes exist in the inventory but have **no USD price listed**. They are likely quoted on request.

| Raw Code | Canonical Name | Count | Carat Range | Notes |
|----------|---------------|-------|------------|-------|
| `LV` | `lavender` | 202 | 1.00–15.90 ct | Near-circular L/W ≈ 1.0; proprietary cut, no prices. NOT round. |
| `阿育王` | `ashoka` | 24 | 7.36–15.55 ct | Ashoka cut: elongated cushion/oval hybrid. Large stones only. |
| `老矿切` | `old_mine` | 20 | 3.01–10.20 ct | Old Mine Cut (antique style, high crown, small table) |
| `阶梯切` | `step_cut` | 6 | 3.08–5.05 ct | Step Cut (trapezoidal / baguette-adjacent) |
| `肥三角` | `trilliant` | 3 | 1.46–2.10 ct | Fat Triangle / Trilliant |
| `自由形式 （唇形）` | `freeform_lip` | 1 | 1.87 ct | Free-form lip-shaped outline |
| `老欧切` | `old_european` | 1 | 8.06 ct | Old European Cut |

---

## §2 Moval Detection

A **moval** is a very elongated oval that occupies the visual space between a standard oval and a marquise — rounded ends (no points) but an extreme length-to-width ratio. The name is a portmanteau of "marquise" + "oval."

### Detection Rule

> Any stone coded `OV` (oval) with a **length/width ratio ≥ 1.75** is reclassified as `moval`.

This threshold is justified by the bimodal gap in the OV size-ratio distribution:

| L/W Ratio Bucket | OV Stone Count | Interpretation |
|-----------------|---------------|----------------|
| 1.20 – 1.40 | 195 | Short oval (slightly chunky) |
| 1.40 – 1.50 | 1,814 | **Standard oval** (mainstream) |
| 1.50 – 1.60 | 429 | Elongated oval |
| 1.60 – 1.70 | 2 | Very elongated |
| 1.70 – 1.75 | 0 | ← gap |
| 1.75 – 2.00+ | 7 | **Moval territory** — distinct cluster |

### Confirmed Moval Stones in This Dataset

All 5 confirmed movals are ~1ct, D/VVS2, CVD:

| Carat | L/W Ratio | Dimensions (mm) | Color | Clarity | Price/Stone |
|-------|----------|----------------|-------|---------|------------|
| 1.04 ct | 2.000 | 10.26 × 5.13 × 3.20 | D | VVS2 | $166.40 |
| 1.03 ct | 1.982 | 10.21 × 5.15 × 3.26 | D | VVS2 | $164.80 |
| 1.06 ct | 1.926 | 10.11 × 5.25 × 3.29 | D | VVS2 | $169.60 |
| 1.05 ct | 1.904 | 9.96 × 5.23 × 3.29 | D | VVS2 | $168.00 |
| 1.07 ct | 1.895 | 10.06 × 5.31 × 3.32 | D | VVS2 | $171.20 |

**Key observation:** Movals in this dataset are priced similarly to standard ovals at the same carat weight. At 1ct D/VVS2, standard OV runs ~$164. Movals cluster at $165–$171 — essentially no premium over standard oval from this supplier.

### Marquise vs. Moval Distinction

| Feature | Marquise (MQ) | Moval |
|---------|--------------|-------|
| End profile | Pointed (culet-to-point) | Rounded (oval ends) |
| Typical L/W | 1.80 – 2.20 | 1.75 – 2.00 |
| In this dataset | 854 stones (coded MQ) | 5 stones (coded OV, auto-detected) |
| MQ L/W range (this data) | 1.45 – 2.29 | — |

---

## §3 Color & Clarity Distribution

### Color Grades

This supplier focuses almost exclusively on **top-color** white diamonds:

| Grade | Count | % |
|-------|-------|---|
| D | 9,359 | 51.7% |
| E | 6,900 | 38.1% |
| F | 1,647 | 9.1% |
| G | 183 | 1.0% |
| H | 1 | <0.1% |

> **No fancy color diamonds** in this list. All stones are colorFamily = `white`.

### Clarity Grades

| Grade | Count | % |
|-------|-------|---|
| VVS2 | 8,471 | 46.8% |
| VS1 | 6,285 | 34.7% |
| VVS1 | 2,546 | 14.1% |
| VS2 | 760 | 4.2% |
| IF | 24 | 0.1% |
| SI1 | 4 | <0.1% |

> Core inventory is **VVS2 / VS1** — the standard IGI lab-grown commodity tier.

### Growth Method

| Method | Count | % |
|--------|-------|---|
| CVD | 14,550 | 80.4% |
| HPHT | 3,540 | 19.6% |

---

## §4 Price Reference Tables

All prices are USD per stone, IGI-certified, single-piece quotes.  
Source: `USD/STONE(美金/PCS)` column. Values shown are median of matching stones ± 0.05 ct.

### Table 4A — Round (RD), D Color

| Clarity | 1.0 ct | 1.5 ct | 2.0 ct | 3.0 ct | 4.0 ct | 5.0 ct |
|---------|--------|--------|--------|--------|--------|--------|
| VVS1 | $158 | $319 | $612 | $1,057 | n/a | n/a |
| VVS2 | $142 | $241 | $363 | $575 | n/a | $1,411 |
| VS1 | $132 | $225 | $323 | $549 | $842 | $1,305 |
| VS2 | $127 | $210 | $301 | $516 | n/a | n/a |

### Table 4B — Round (RD), E Color

| Clarity | 1.0 ct | 1.5 ct | 2.0 ct | 3.0 ct | 4.0 ct | 5.0 ct |
|---------|--------|--------|--------|--------|--------|--------|
| VVS1 | $146 | $290 | n/a | n/a | n/a | $1,106 |
| VVS2 | $139 | $225 | $313 | $468 | $663 | $853 |
| VS1 | $126 | $212 | $291 | $436 | $621 | $801 |
| VS2 | $122 | $203 | $280 | $425 | $604 | $776 |

### Table 4C — Round (RD), F Color

| Clarity | 1.0 ct | 1.5 ct | 2.0 ct | 3.0 ct | 4.0 ct | 5.0 ct |
|---------|--------|--------|--------|--------|--------|--------|
| VVS1 | $142 | $275 | $326 | $501 | n/a | $905 |
| VVS2 | $133 | n/a | $295 | $439 | $643 | $803 |
| VS1 | $121 | $203 | $281 | $422 | $601 | $754 |
| VS2 | $115 | $196 | $270 | n/a | n/a | $732 |

### Table 4D — Oval (OV), D Color (standard ovals, L/W < 1.75)

| Clarity | 1.0 ct | 1.5 ct | 2.0 ct | 3.0 ct | 4.0 ct | 5.0 ct |
|---------|--------|--------|--------|--------|--------|--------|
| VVS1 | $178 | $332 | $527 | $848 | n/a | $1,512 |
| VVS2 | $164 | $228 | $345 | $729 | $882 | $1,360 |
| VS1 | $155 | $220 | $311 | $498 | $683 | $1,252 |
| VS2 | $153 | $210 | $294 | $468 | n/a | n/a |

### Table 4E — Oval (OV), E Color

| Clarity | 1.0 ct | 1.5 ct | 2.0 ct | 3.0 ct | 4.0 ct | 5.0 ct |
|---------|--------|--------|--------|--------|--------|--------|
| VVS2 | $158 | $217 | $313 | $499 | $663 | $828 |
| VS1 | $153 | $211 | $292 | $437 | $623 | $779 |
| VS2 | $145 | n/a | $281 | $424 | $600 | $753 |

### Table 4F — D / VS1 Price Summary by Shape

| Shape | 1.0 ct | 1.5 ct | 2.0 ct | 3.0 ct | 4.0 ct | 5.0 ct |
|-------|--------|--------|--------|--------|--------|--------|
| round | $132 | $225 | $323 | $549 | $842 | $1,305 |
| oval | $155 | $220 | $311 | $498 | $683 | $1,252 |
| pear | $157 | $219 | $316 | $500 | n/a | n/a |
| emerald | $136 | $190 | $282 | $484 | $747 | $928 |
| radiant | $135 | $192 | $284 | $484 | n/a | n/a |
| marquise | $173 | $257 | $335 | $497 | $806 | $1,010 |
| princess | $136 | $203 | $323 | $516 | $808 | n/a |
| heart | $171 | $256 | $334 | $499 | $810 | $1,006 |
| cushion | $137 | $205 | $324 | $513 | $810 | $1,054 |
| asscher | $135 | $205 | $328 | $579 | n/a | $1,056 |

### Table 4G — Moval (detected OV, L/W ≥ 1.75), D/VVS2

| Carat | Price/Stone | Price/Ct | L/W Ratio |
|-------|------------|---------|----------|
| 1.03 ct | $164.80 | $160/ct | 1.982 |
| 1.04 ct | $166.40 | $160/ct | 2.000 |
| 1.05 ct | $168.00 | $160/ct | 1.904 |
| 1.06 ct | $169.60 | $160/ct | 1.926 |
| 1.07 ct | $171.20 | $160/ct | 1.895 |

**Observed moval/oval price ratio at 1ct D/VVS2:** movals price at ~$160–161/ct vs. ovals at ~$158–164/ct → **essentially parity** from this supplier.

---

## §5 Shape Geometry Reference (size1 × size2 × size3)

Size measurements are in millimeters. `size1` = length, `size2` = width, `size3` = depth.

### Typical Dimensions by Shape (1.00 ct, D/VS1)

| Shape | size1 | size2 | size3 | L/W Ratio | Notes |
|-------|-------|-------|-------|-----------|-------|
| round | ~6.40 | ~6.40 | ~3.95 | ~1.00 | Circular; size1 ≈ size2 |
| oval (standard) | ~7.70 | ~5.50 | ~3.45 | ~1.40–1.50 | |
| moval | ~10.1 | ~5.2 | ~3.3 | 1.90–2.00 | Very long, rounded ends |
| marquise | ~10.5 | ~5.2 | ~3.3 | ~2.00–2.10 | Pointed ends |
| pear | ~8.0 | ~5.3 | ~3.4 | ~1.50–1.60 | One rounded + one point |
| emerald | ~6.8 | ~5.0 | ~3.3 | ~1.35 | Step cut rectangle |
| radiant | ~6.4 | ~5.6 | ~3.9 | ~1.15 | Square-ish brilliant |
| princess | ~5.5 | ~5.5 | ~3.7 | ~1.00 | Square |
| cushion | ~5.9 | ~5.8 | ~3.8 | ~1.02 | Rounded corners |
| heart | ~6.4 | ~6.4 | ~3.9 | ~1.00 | Symmetric lobes |
| asscher | ~5.5 | ~5.5 | ~3.7 | ~1.00 | Step cut square |
| lavender (LV) | ~5.8 | ~5.8 | ~3.6 | ~1.00–1.04 | Near-circular; unknown cut style |
| ashoka (阿育王) | varies | varies | varies | ~1.45–1.55 | Elongated cushion hybrid, 7+ ct |

### The LV Shape (Lavender Cut)

The `LV` code designates a near-perfectly round stone by size ratio (L/W ≈ 1.00–1.04 across all 202 samples), yet it is listed separately from `RD`. Possible explanations:

- A proprietary branded cut with a distinctive facet pattern
- A "lotus" or "lavender" marketed cut with subtle outline differences from standard round
- An internal classification for non-brilliant rounds

**Practical impact:** 202 stones (1.00–15.90 ct), all CVD, **no prices listed** — quoted on request. Do not substitute LV for RD in any pricing model.

### Ashoka Cut (阿育王)

The Ashoka is an elongated cushion/oval hybrid, historically associated with Tiffany & Co.'s proprietary Ashoka® diamond. This supplier uses the term for a similar elongated fancy shape. Characteristics:

- Only appears at **7.36–15.55 ct** in this dataset
- L/W ratio approximately 1.45–1.55 (confirmed: 13.63 × 9.09 = 1.50 at 7.36 ct)
- All CVD, no prices listed
- Treat as `cushion` in pricing models for conservative estimate

---

## §6 Growth Method Notes

### CVD vs. HPHT in This Dataset

| Method | Count | % | Typical shapes |
|--------|-------|---|----------------|
| CVD | 14,550 | 80.4% | All shapes; dominant for OV, PS, EM, specialty |
| HPHT | 3,540 | 19.6% | RD, OV, MQ, PR, CU — mainstream commercial shapes |

Both methods receive identical IGI certifications for color/clarity. In this supplier's pricing, **no observable price difference** between CVD and HPHT at matched grade/carat.

### Ice Shapes (ICE OV, ICE PS)

- `ICE OV` (522 stones, $464–$1,899) and `ICE PS` (307 stones, $369–$1,518) are salt-and-pepper / rough-polished styles.
- These are **NOT standard IGI clarity-graded** stones — their appearance is deliberately raw and included in the IGI certificate for identification, not quality grading.
- Priced significantly higher per carat than standard stones due to artistic/design premium.
- **Exclude from standard white diamond pricing models.**

---

## §7 Indexing & Tooling

### Machine-Readable Index

`research/data/messi-gems-index.json`

Structure:
```json
{
  "supplier": "Wuzhou Messi Gems Co., Ltd.",
  "sourceFile": "IGI Lab Grown Diamond List.2026.05.18xls.xlsx",
  "sourceDate": "2026-05-18",
  "movalThreshold": 1.75,
  "shapeCodeMap": { "RD": "round", "OV": "oval", ... },
  "summary": { ... },
  "movals": [ ... ],
  "records": [ ... ]
}
```

Each record in `records`:
```json
{
  "rowNo": 1234,
  "lab": "IGI",
  "reportNo": 658486697,
  "rawShapeCode": "OV",
  "shape": "oval",
  "isMoval": false,
  "carat": 2.01,
  "color": "D",
  "colorFamily": "white",
  "clarity": "VVS2",
  "cut": "EX",
  "polish": "EX",
  "symmetry": "EX",
  "fluorescence": "N",
  "growthMethod": "CVD",
  "size1": 10.47,
  "size2": 6.49,
  "size3": 4.43,
  "lwRatio": 1.6133,
  "pricePerStone": 313.1,
  "pricePerCarat": 155.77,
  "warehouse": "梧州仓"
}
```

### Analysis Script

`research/scripts/analyze-messi-gems.py`

Regenerates the index from the Excel file. Run from project root:

```bash
python3 research/scripts/analyze-messi-gems.py
```

Requires: `openpyxl` (`pip3 install openpyxl`)

---

## §8 Isolation Policy

This dataset must remain **isolated** from `alibaba-comps-index.json` in comp resolution because:

1. Messi Gems appears in both datasets — merging would double-weight this single supplier
2. The Messi list has per-stone IGI report numbers, enabling duplicate detection
3. This list covers specialty/unpriced shapes (LV, Ashoka, Old Mine) not in the Alibaba comp index
4. Price points here may differ from captured Alibaba listing prices due to time-of-capture differences

**Query pattern:** Use `alibaba-comps-index.json` for general Alibaba market comp matching. Query `messi-gems-index.json` separately when you want Messi-specific stone-level lookup (e.g., confirming a specific IGI report number, or getting the per-stone price for a specialty shape).

---

## §9 Known Gaps & Caveats

| Gap | Detail |
|-----|--------|
| LV shape pricing | 202 stones, no price — on-request only |
| Specialty shape pricing | Ashoka, Old Mine, Step Cut, Trilliant, Freeform — all unpriced |
| 4ct+ data sparsity | Fewer stones at large carats; some grade combos show n/a |
| No fancy color | This list is 100% white (D/E/F/G/H) — use Alibaba comps for fancy color |
| Moval sample size | Only 5 movals detected — insufficient for independent moval pricing curve |
| F color VVS2 1.5ct | Sparse; interpolate between VVS1 and VS1 |
| Ice shape pricing | ICE OV/PS pricing is artistic-market, not graded-quality pricing |
| Currency | USD, single-piece. Volume discounts likely negotiable. |
