# Alibaba Listing Confidence Gaps

Created: 2026-05-21  
Update cadence: update whenever rows are added to `alibaba-clean-source-of-truth.md` or new raw captures land in `data/`.  
Purpose: show where Alibaba comps are strong, thin, suspicious, or missing so future capture sessions can target the weak spots.

## Current Coverage Snapshot

| Area | Current Confidence | Why |
|---|---|---|
| White round D/DE, VS/VVS, IGI, 0.3-6ct | High | Multiple exact ladders, including Messi and corroborating round listings. |
| White pear D, VS/VVS, IGI, 1-5ct | High | Two independent exact row sets with usable 1-5ct coverage. |
| White marquise D/DE, VS1/VVS2, IGI, 1-3ct | Medium-high | Exact row sets exist, but some rows are DE range rather than single color. |
| White radiant D/E/F, VS1, IGI, 1-6ct | Medium-high | Exact rows exist, but coverage is mostly VS1 and a couple of products. |
| White oval DEF, VS1/VVS2, IGI | Medium | Useful size-band rows, but fewer exact single-carat rows and mostly DEF range. |
| Fancy pink mixed shapes, IGI | Medium-high | One clean product has six row-level pink comps, but each shape/color intensity only has one row. |
| Fancy color non-pink | Low | Existing source-of-truth has no clean exact blue/yellow/green/purple/orange/red rows yet. |
| Specialty cuts, Portuguese/Dutch/antique | Low-medium | Some listings exist, but they are specialty and often missing clean row-level carat mapping. |
| Ring/mounted listings | Excluded | Not valid loose-stone comps unless the loose stone is isolated. |

## Highest-Priority Gaps

| Priority | Gap | What We Need | Why It Matters |
|---:|---|---|---|
| 1 | Fancy vivid/intense pink by shape | More exact rows for pear, oval, radiant, cushion, heart, emerald at 1ct, 2ct, 3ct, 4ct+ | Current pink data is promising but one-row-per-shape; model needs confidence bands. |
| 2 | Fancy light pink vs fancy pink vs fancy intense/vivid pink | Multiple exact rows by intensity, same shape and similar carat | Intensity may move price more than shape; current rows mix both variables. |
| 3 | Oval white IGI exact rows | Exact D/E/F or DEF oval rows at 1ct, 2ct, 3ct, 5ct with clarity | Current oval data is mostly size-band and less robust than pear/round. |
| 4 | Radiant white IGI clarity spread | Radiant rows for VS2, VS1, VVS2, VVS1 at 1ct, 2ct, 3ct, 5ct | Current radiant rows are mainly VS1, so clarity multipliers are under-supported. |
| 5 | Fancy yellow exact rows | IGI rows for fancy yellow/intense/vivid yellow by shape and carat | Yellow is common enough to model, but clean exact Alibaba rows are not in source-of-truth yet. |
| 6 | Fancy blue exact rows | IGI rows for blue/vivid blue by shape and carat | Needed to avoid relying on broad showroom/page ranges. |
| 7 | Green, orange, purple, red fancy colors | Any clean IGI exact rows with row-level shape/carat/clarity | Sparse markets; even low/anomalous rows should be preserved with wide bands. |
| 8 | Low-price anomalies with cert evidence | Exact rows that look unusually cheap, plus IGI number/video context if possible | These may be real deal-finding signals, but should not become model anchors too early. |

## Shape-Specific Gaps

| Shape | White Data Confidence | Fancy Pink Data Confidence | Main Gap |
|---|---|---|---|
| Round | High | Missing | Need clean fancy-color round rows, especially pink/yellow/blue. |
| Oval | Medium | Missing in current source-of-truth | Need exact oval rows; current white oval is banded, pink oval exists only in broad/specialty sources. |
| Pear | High | Medium-high | Need more pink pear rows across 1-5ct and more intensity separation. |
| Radiant | Medium-high | Medium-high | Need white clarity spread and more fancy-color radiants by intensity. |
| Cushion | Low in white source-of-truth | Medium-high | Need white cushion rows and more pink cushion rows; cushion is important for fancy colors. |
| Princess | Low | Medium-high | Need more princess rows; current pink princess row is one 3.03ct Fancy Light Pink comp. |
| Emerald | Low | Medium-high | Need more step-cut comps; clarity visibility makes this important. |
| Heart | Low | Medium-high | Need clean heart rows; previous pink heart flat-price listing was suspicious, but new 2.08ct row is usable. |
| Marquise | Medium-high | Missing | Need fancy pink/yellow/blue marquise rows; white data is decent. |
| Asscher | Low | Missing | Need clean rows or keep as specialty low-confidence. |

## Color-Specific Gaps

| Color Group | Current Status | Need |
|---|---|---|
| D/DE/DEF white | Strong for round/pear/marquise; moderate for oval/radiant | More exact oval and cushion rows, plus single-grade E/F where possible. |
| G/H/I/J white | Weak | Alibaba rarely lists these as standard SKUs; if found, treat as off-catalog and preserve exact evidence. |
| Fancy Pink | Emerging | More rows by intensity and shape; current exact pink rows are all from one product. |
| Fancy Light Pink | Thin | More comps like the 3.03ct princess row, especially 1-2ct. |
| Fancy Intense Pink | Thin | More rows by shape; current pear/emerald/radiant-brownish rows are useful but sparse. |
| Fancy Vivid Pink | Thin | More rows; current clean exact is one 2.08ct heart row. |
| Brownish Pink | Very thin | More rows to quantify discount vs pure pink. |
| Yellow | Missing exact source-of-truth rows | Capture exact IGI yellow/intense/vivid yellow listings. |
| Blue | Missing exact source-of-truth rows | Capture exact IGI blue/vivid blue listings. |
| Green | Missing | Capture any exact IGI rows, even anomalous. |
| Orange | Missing | Capture any exact IGI rows, even anomalous. |
| Purple | Missing | Capture any exact IGI rows, even anomalous. |
| Red | Missing | Capture any exact IGI rows, even anomalous. |

## Data Quality Gaps

| Issue | Current Example | Needed Fix |
|---|---|---|
| Page-level shape conflicts with row-level shape | `1601561025630` says page-level Radiant, but rows include Cushion/Princess/Heart/Pear/Emerald/Radiant | Keep using row labels as authority; capture source snippets and note conflicts. |
| Same price across incompatible rows | `1601663842022` repeated $480 across different pink heart combinations | Keep broad/suspicious; do not promote as exact until recaptured or quoted. |
| Missing price rows | `1601651233708`, `1601763180772`, `1601675586306` | Recapture with SKU panel open and confirm visible last-SKU rows. |
| Mounted/ring context | `1601706050088`, `1601763180772` | Exclude unless loose-stone price is isolated. |
| Banded carat sizes | `1600331442768` oval 1.0-1.1ct, 1.5-1.59ct, etc. | Use as medium confidence; capture exact single carat rows where possible. |
| Specialty cuts without row mapping | Portuguese/Dutch/antique rows | Keep specialty section separate; avoid blending into standard shape multipliers. |

## Next Capture Targets

Search/capture targets to close the highest-value gaps:

- `IGI fancy vivid pink lab diamond pear 1ct 2ct 3ct Alibaba`
- `IGI fancy intense pink lab diamond radiant VS1 Alibaba`
- `IGI fancy pink cushion lab grown diamond VS1 VVS2 Alibaba`
- `IGI fancy yellow oval lab grown diamond 1ct 2ct 3ct Alibaba`
- `IGI fancy vivid yellow radiant lab grown diamond Alibaba`
- `IGI fancy blue lab grown diamond radiant oval pear Alibaba`
- `IGI oval lab grown diamond D VS1 3ct Alibaba`
- `IGI cushion lab grown diamond DEF VS1 VVS2 Alibaba`
- `IGI emerald lab grown diamond D VS1 VVS2 Alibaba`

## Update Instructions

When new data comes in:

1. Put raw JSON in `data/`.
2. Promote only clean rows into `alibaba-clean-source-of-truth.md`.
3. Add or update rows in this gap file.
4. If a gap is closed by two or more independent clean products, move its confidence up one level.
5. If a new anomaly appears, add it under `Data Quality Gaps` instead of deleting prior rows.
6. Keep low-price anomalies visible, but label them broad/anomalous until cert/video/supplier evidence confirms them.

## Closed Or Improving Gaps

| Date | Gap | Update |
|---|---|---|
| 2026-05-21 | Fancy pink mixed shapes | Added six exact row-level pink IGI comps from `1601561025630`: Cushion, Princess, Heart, Pear, Emerald, Radiant. Still needs independent corroboration. |
