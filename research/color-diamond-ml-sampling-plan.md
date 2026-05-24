# Color Diamond ML Sampling And Markup Plan

Document date: 2026-05-24  
Status: Plan only, no implementation yet  
Goal: Extend the current lab-diamond pricing model to fancy color diamonds by collecting a deliberately stratified StarGem quote sample, comparing it against Messi Gems color stock pricing, and training only the model surfaces where we have enough source-independent data.

## Current Starting Point

The app already has three useful pieces:

1. A hand-authored fancy-color pricing prior in the live pricing model.
2. A Messi Gems fancy-color stock index from `research/data/2026.05.11MESSIGEMS COLORS LAB DIAMONDS LIST.xlsx`.
3. A StarGem white-diamond ML and lookup workflow built around rate-per-carat prediction.

The Messi color index currently has 1,652 priced stones >= 1ct and 1,243 comp bins. Its strongest coverage is:

| Dimension | Current Messi coverage |
|---|---:|
| Yellow | 636 stones |
| Pink | 437 stones |
| Blue | 280 stones |
| Green | 114 stones |
| Brown / coffee | 111 stones |
| Red | 73 stones |
| Vivid | 639 stones |
| Fancy | 580 stones |
| Intense | 415 stones |
| VS1 | 1,058 stones |
| VVS2 | 355 stones |
| VS2 | 149 stones |

This is useful, but Messi appears to price with a higher markup in general. We should therefore treat Messi as:

- A rich observed market/stock source.
- A markup comparison layer.
- A secondary training signal only after estimating a supplier markup factor.

StarGem is still the preferred direct-factory baseline, but the supplier has said they cannot provide the whole color catalog. So the right move is not to ask for everything. The right move is to ask for a compact, balanced quote sheet that samples the price surface.

## Main Strategy

Use a staged stratified sampling plan:

1. Ask StarGem for exact available stock or quote rows across a controlled spread of hue, intensity, carat, clarity, and shape.
2. Normalize those rows into the same schema as `messi-color-index.json`.
3. Compare StarGem vs Messi on matched cells to estimate Messi markup.
4. Train a color-diamond overlay model on top of the existing fancy-color prior.
5. Only promote trained behavior where coverage is strong; otherwise keep the current hand-authored prior plus nearest comps.

The model should learn a source-adjusted direct-factory wholesale price, not accidentally learn Messi's markup as the wholesale baseline.

## Supplier Ask: Required Columns

Ask StarGem for rows with these fields. The key requirement is exact per-stone or exact quote price, not broad marketing ranges.

| Field | Why it matters |
|---|---|
| Supplier stock ID | Stable row identity |
| Report number | Deduping and IGI lookup |
| Report lab | IGI preferred; note GIA/GRC/SGL/etc. |
| Cert image/link if available | Verification |
| Shape | Primary model feature |
| Carat | Primary model feature |
| Exact fancy color grade | Preserve raw text, e.g. Fancy Intense Pink |
| Hue | Can be derived, but useful for QA |
| Intensity | Fancy Light / Fancy / Intense / Vivid / Deep / Dark |
| Modifier | Brownish, orangy, greyish, greenish, etc. |
| Clarity | VS2, VS1, VVS2, etc. |
| Cut, polish, symmetry | Feature parity with current model |
| Growth method | HPHT / CVD / treated if known |
| Measurements | L x W x D and L/W ratio |
| Price per stone USD | Training target |
| Price date | Needed because color stock moves quickly |
| MOQ / quote condition | Avoid mixing sample price vs volume price |
| Video/photo URL | Quality review and later manual QA |

## Supplier Message Draft

Use language like this:

```text
We do not need your full catalog. We are building a pricing model and only need a balanced sample of exact current stock or quote rows.

Please send exact per-stone USD prices, not broad ranges, for the attached spread of lab-grown fancy color diamonds. IGI-certified rows are preferred. If a requested exact combination is not available, please send the closest available stone and include the exact carat, shape, color grade, clarity, report lab, measurements, and price.

For each requested cell, 1 available stone is acceptable; 2-3 alternatives are ideal where you have stock.
```

## Round 1 Ask: Minimum Useful Sample

Round 1 should be small enough that the supplier will actually answer, but broad enough to estimate the core surface. Target 100-150 exact rows.

### A. Core Color Intensity Curve

Ask for VS1, IGI if available, in radiant or cushion. If both shapes are available, prefer radiant for yellow/blue/green and cushion for pink.

| Hue | Intensities | Carats |
|---|---|---|
| Yellow | Fancy, Fancy Intense, Fancy Vivid | 1.00, 1.50, 2.00, 3.00, 5.00 |
| Pink | Fancy, Fancy Intense, Fancy Vivid | 1.00, 1.50, 2.00, 3.00, 5.00 |
| Blue | Fancy, Fancy Intense, Fancy Vivid | 1.00, 1.50, 2.00, 3.00, 5.00 |
| Green | Fancy, Fancy Intense, Fancy Vivid | 1.00, 1.50, 2.00, 3.00, 5.00 |

Expected rows: 4 hues x 3 intensities x 5 carats = 60 rows.

Purpose:

- Learn the carat curve by hue and intensity.
- Test whether vivid pricing scales flatter or steeper than the current hand-authored model.
- Create direct comparisons against Messi's best-covered colors.

### B. Clarity Calibration

Ask for these as exact matches where possible:

| Hue / intensity | Shape | Carats | Clarities |
|---|---|---|---|
| Fancy Intense Yellow | Radiant | 1.00, 2.00, 3.00 | VS2, VS1, VVS2 |
| Fancy Vivid Yellow | Radiant | 1.00, 2.00, 3.00 | VS2, VS1, VVS2 |
| Fancy Intense Pink | Cushion | 1.00, 2.00, 3.00 | VS2, VS1, VVS2 |
| Fancy Vivid Pink | Cushion | 1.00, 2.00, 3.00 | VS2, VS1, VVS2 |
| Fancy Intense Blue | Radiant | 1.00, 2.00, 3.00 | VS2, VS1, VVS2 |
| Fancy Intense Green | Radiant | 1.00, 2.00, 3.00 | VS2, VS1, VVS2 |

Expected additional rows: up to 36 if VS1 rows overlap the core curve and only VS2/VVS2 need to be added.

Purpose:

- Validate whether the current compressed fancy clarity table is directionally right.
- Avoid over-weighting VVS1/IF, which are sparse and less important for color diamonds.
- Decide whether clarity effects are hue-specific or global.

### C. Shape Calibration

Ask for VS1 at 2.00ct and 3.00ct:

| Hue / intensity | Shapes |
|---|---|
| Fancy Intense Yellow | radiant, cushion, oval, pear, emerald |
| Fancy Vivid Yellow | radiant, cushion, oval, pear, emerald |
| Fancy Intense Pink | radiant, cushion, oval, pear, heart |
| Fancy Vivid Pink | radiant, cushion, oval, pear, heart |
| Fancy Intense Blue | radiant, cushion, oval, pear, emerald |
| Fancy Intense Green | radiant, cushion, oval, pear, emerald |

Expected rows: up to 60, but acceptable as 30-40 if availability is thin.

Purpose:

- Separate fancy-color shape behavior from the white-diamond `shapeMult`.
- Check whether color-retaining shapes like radiant/cushion deserve smaller discounts or premiums.
- Compare heart premiums against Messi's blue and pink stock, where heart can spike.

### D. Sparse Color Anchors

Ask only for VS1, one preferred color-retaining shape, at 1.00ct, 2.00ct, and 3.00ct:

| Color | Preferred shape | Notes |
|---|---|---|
| Fancy Brown / Coffee | cushion or radiant | Use for discount calibration |
| Fancy Red | radiant or heart | Sparse, do not overfit |
| Fancy Orange / Orangy Pink | radiant or cushion | Modifier test |
| Purple / Violet / Lavender | cushion or oval | If they carry it |
| Blue Green / Greenish Blue | radiant | Modifier test |

Expected rows: 9-15.

Purpose:

- Anchor rare colors without pretending we have enough data for a full model.
- Use as comp evidence and residual tests, not primary training surfaces.

## Round 2 Ask: Expand Only After Round 1

If StarGem responds well, Round 2 should fill gaps rather than repeat the same cells.

Prioritize:

1. Missing hue/intensity/carat cells from Round 1.
2. Duplicate stones per important cell, aiming for 2-3 rows per cell.
3. 4.00ct and 5.00ct coverage for pink, blue, and green.
4. Modifier coverage: brownish pink, orangy pink, greenish blue, greyish green.
5. Exact report numbers and cert photos for high-priced outliers.

Do not ask for every combination. Ask for the cells that improve the model's weak spots.

## Normalization Plan

Create a StarGem color index parallel to the Messi color index:

```text
research/data/starsgem-color-index.json
research/data/starsgem-color-comps.json
```

Use the same normalized fields already used by `analyze-messi-colors.py`:

- `shape`
- `subVariant`
- `carat`
- `color`
- `rawColor`
- `colorHue`
- `colorIntensity`
- `colorIntensityRank`
- `colorModifiers`
- `appColorKey`
- `clarity`
- `growthMethod`
- `measurement`
- `lwRatio`
- `pricePerStone`
- `pricePerCarat`
- `sourceType`
- `supplier`

Keep raw supplier text beside normalized fields. Fancy color labels are easy to damage with over-normalization.

## Messi Markup Measurement

For every StarGem quote row, find comparable Messi rows using:

| Field | Match rule |
|---|---|
| Hue | Exact |
| Intensity | Exact first; adjacent intensity only for diagnostics |
| Modifier | Exact if present; otherwise modifier-free only |
| Shape | Exact canonical shape |
| Clarity | Exact first; adjacent clarity for diagnostics |
| Carat | +/- 0.05ct for 1-2ct, +/- 0.10ct for 3ct+, or same 0.05ct bin where possible |
| Report lab | Prefer IGI vs IGI |

Compute markup in log space:

```text
messi_markup = exp(median(log(messi_price_per_ct)) - median(log(starsgem_price_per_ct))) - 1
```

Output markup by:

- Global Messi color markup.
- Hue-level markup.
- Hue + intensity markup.
- Shape-level markup.
- Cell-level markup where sample size allows.

Do not train on a cell-level markup unless both sides have enough comps. Suggested gates:

| Level | Minimum matched rows |
|---|---:|
| Global source markup | 30 |
| Hue markup | 15 |
| Hue + intensity markup | 8 |
| Exact cell markup | 3 per side |

## ML Plan

Use the current fancy-color model as the prior, then train an overlay. The target should be source-adjusted factory price:

```text
target = log(pricePerStone / carat)
or
target = log(pricePerStone)
```

Preferred target:

```text
log(pricePerCarat)
```

because the existing StarGem work already showed rate-per-carat is a cleaner supplier signal.

Candidate features:

| Feature group | Fields |
|---|---|
| Size | carat, carat bucket, distance to magic carat |
| Color | hue, intensity, intensity rank, modifiers, appColorKey |
| Grade | clarity, report lab, growth method |
| Shape | shape, subVariant, lwRatio |
| Finish | cut, polish, symmetry |
| Prior | current hand-authored fancy model price per ct |
| Source | supplier/sourceType, but not as a shortcut for wholesale unless source-adjusted |

Recommended model approach:

1. Start with a transparent residual model:
   `log(actual_price_per_ct) - log(current_fancy_prior_per_ct)`.
2. Train a small ExtraTrees or gradient boosting model only after enough rows exist.
3. Keep source as a diagnostic feature, not the final wholesale answer.
4. Export confidence by coverage bucket.
5. Route sparse cells back to the hand-authored prior and nearest comps.

## Coverage Gates

Promote trained predictions only when coverage is sufficient:

| Surface | Gate |
|---|---|
| Yellow / pink / blue core curve | >= 40 direct StarGem rows per hue, or >= 25 plus strong Alibaba support |
| Green core curve | >= 20 direct StarGem rows |
| Clarity multiplier | >= 6 matched VS2/VS1/VVS2 triplets |
| Shape multiplier | >= 5 matched shape rows per hue/intensity, or use global fancy-color shape table |
| Rare colors | Document/comps only until >= 20 direct rows per hue |
| Modifier penalties | Document/comps only until >= 10 direct rows per modifier |

The model should answer "I have enough data here" before overriding the current baseline.

## Validation Plan

Use three validation views:

1. Source holdout: train on StarGem + Alibaba, test on source-adjusted Messi.
2. Cell holdout: hold out entire hue/intensity/carat cells to test interpolation.
3. High-value holdout: separately test 3ct+ pink, blue, and green stones.

Track:

- MAPE.
- Median absolute percent error.
- Error by hue.
- Error by intensity.
- Error by carat bucket.
- Error by shape.
- Over/under bias vs Messi before and after markup adjustment.

Do not accept a lower aggregate MAPE if the model gets sparse/high-value cells worse.

## Deliverables

Once data is collected, the implementation work should produce:

| Artifact | Purpose |
|---|---|
| `research/data/starsgem-color-index.json` | Full normalized StarGem color quote index |
| `research/data/starsgem-color-comps.json` | Compact app comp pool |
| `research/data/color-source-markups.json` | Messi vs StarGem markup estimates |
| `research/data/color-ml-results.json` | Training and validation metrics |
| `research/data/color-ml-model.json` | Exported overlay model if it beats baseline |
| `research/color-diamond-ml-results.md` | Human-readable analysis |

## Decision Rules

1. If StarGem and Messi agree after a stable markup adjustment, train the overlay.
2. If Messi is consistently higher but stable, use Messi for comps and customer-facing market comparison, not direct factory wholesale.
3. If markup varies wildly by hue/intensity, keep separate markup tables and avoid global source adjustment.
4. If StarGem samples are too sparse, expand comp engine coverage first and leave the hand-authored prior in place.
5. If a rare color has fewer than 20 direct rows, do not train it as a learned surface. Use anchored comps plus a documented confidence warning.

## Practical First Ask To Send

Start with this compact list:

```text
Please quote exact available IGI lab-grown fancy color diamonds for:

Core hues:
- Yellow, Pink, Blue, Green

Core intensities:
- Fancy
- Fancy Intense
- Fancy Vivid

Core carats:
- 1.00ct
- 1.50ct
- 2.00ct
- 3.00ct
- 5.00ct

Core clarity:
- VS1 for every hue/intensity/carat cell
- Add VS2 and VVS2 for Fancy Intense Yellow, Fancy Vivid Yellow, Fancy Intense Pink, Fancy Vivid Pink, Fancy Intense Blue, Fancy Intense Green at 1ct, 2ct, and 3ct

Core shapes:
- Radiant or cushion for every core cell
- Add oval, pear, emerald/heart at 2ct and 3ct for selected intense/vivid colors where available

Sparse color anchors:
- Brown/Coffee, Red, Orange/Orangy Pink, Purple/Violet, Blue Green/Greenish Blue at 1ct, 2ct, and 3ct VS1

For unavailable exact cells, send the closest available stone and include exact carat, shape, color grade, clarity, report lab, report number, measurements, growth method, price per stone USD, and date.
```

This gives enough spread to train the important color surfaces without asking StarGem for a full catalog.
