# Current Stone Setting Standard Logic

Generated from the current implementation in `index.html` on 2026-05-26.

This note documents how the app decides whether the selected stone can use a standard/premade setting size. It is intended as a research checklist: compare the assumptions here against real setting supplier tolerances and calibrated size charts.

## Where It Lives

- UI rendering: `updateSettingFitBar()` in `index.html:2260`.
- Measurement parsing: `parseMeasurementTriplet()` in `index.html:1843`.
- Setting fit logic: `normalizeShapeForSetting()`, `STD_SETTINGS`, `CARAT_TO_MM_TABLE`, `estimateMMFromCarat()`, `findNearestStdSetting()`, and `assessSettingFit()` in `index.html:3998`.

## High-Level Flow

1. Normalize the app shape into a setting shape family.
2. Prefer actual IGI/report measurements if available.
3. If no measurements are available, estimate length x width from carat using a built-in shape table.
4. If a user-entered ratio exists, adjust estimated length x width to that ratio while preserving estimated face-up area.
5. For symmetric shapes, force width to equal length.
6. Find the nearest calibrated stock setting size for that shape.
7. Score fit by the largest absolute length/width difference from the nearest stock size.
8. Show one of five fit bands in the Standard setting bar.

## Shape Normalization

The app maps some non-standard or subtype shapes into a setting family before lookup:

| App shape | Setting family |
|---|---|
| `old_mine` | `round` |
| `old_european` | `round` |
| `moval` | `oval` |
| `cushion_brilliant` | `cushion` |
| `elongated_cushion` | `cushion` |
| `square_cushion` | `cushion` |
| `asscher` | `emerald` |
| `trilliant` | `trillion` |
| `sq_radiant` | `radiant` |

All other shapes use their own shape key. If the final shape has no `STD_SETTINGS` entry, the bar does not render a setting fit result.

## Measurement Source

The logic first parses `state.reportMeasurements` by extracting the first three numbers:

- First number: length.
- Second number: width.
- Third number: height.
- Ratio: larger of first two numbers divided by smaller of first two numbers.

If length and width exist and are positive, the setting fit uses the measured long side and short side:

```text
l = max(length, width)
w = min(length, width)
isEstimated = false
```

If measurements are unavailable, the app estimates length x width from `state.carat` and the normalized shape family.

## Carat-To-MM Estimation

When the app lacks measured dimensions, it linearly interpolates in a hardcoded carat-to-mm table per shape family. If carat is below the first row, it clamps to the first row. If carat is above the last row, it clamps to the last row rather than extrapolating.

Shape families with carat-to-mm tables:

- `round`
- `oval`
- `pear`
- `marquise`
- `heart`
- `cushion`
- `princess`
- `emerald`
- `radiant`
- `trillion`

If a shape has no matching table, the app falls back to the `round` table.

### Ratio Adjustment On Estimated Dimensions

If `state.ratio` is set and positive, the app adjusts the estimated dimensions to match that ratio while keeping the same estimated face-up area:

```text
area = estimated_length * estimated_width
new_length = sqrt(area * ratio)
new_width = sqrt(area / ratio)
```

This adjustment applies to estimated dimensions only, and it is skipped for:

- `round`
- `princess`
- `heart`

It is not skipped for `trillion`.

## Symmetric Shape Override

After measurement/estimation, the app treats these shape families as symmetric by forcing width equal to length:

- `round`
- `princess`
- `heart`
- `trillion`

That means measured princess, heart, and trillion stones are reduced to a single side dimension for setting lookup.

## Nearest Standard Setting Size

For each available calibrated size in `STD_SETTINGS`, the app computes:

```text
distance = max(abs(stone_length - setting_length), abs(stone_width - setting_width))
```

The nearest standard size is the one with the smallest `distance`.

Each stock size also has a popularity score:

| Score | Meaning in code |
|---:|---|
| 3 | Very common / very widely stocked |
| 2 | Common / commonly stocked |
| 1 | Specialty stock |

Popularity affects only the explanatory copy. It does not affect the selected nearest size or fit band.

## Fit Bands

The `distance` value is the maximum mm mismatch on either length or width.

| Distance to nearest calibrated size | Internal level | User label | UI color |
|---:|---|---|---|
| `<= 0.10mm` | `exact` | Fits standard setting | Green |
| `> 0.10mm` and `<= 0.20mm` | `safe` | Likely fits standard setting | Green |
| `> 0.20mm` and `<= 0.35mm` | `workable` | May fit with prong adjustment | Accent/gold |
| `> 0.35mm` and `<= 0.60mm` | `borderline` | Borderline - jeweler must verify | Orange |
| `> 0.60mm` | `custom` | Likely needs custom setting | Muted |

The copy for `borderline` says the stone is outside the standard approximately +/-0.20mm prong tolerance. The copy for `workable` says it is within typical prong-head adjustment range, while bezels and halos need tighter matching.

## Current Calibrated Stock Size Table

Format: `length x width (popularity)`.

### Round

`2x2 (1)`, `3x3 (1)`, `3.5x3.5 (1)`, `4x4 (2)`, `4.5x4.5 (2)`, `5x5 (3)`, `5.5x5.5 (2)`, `6x6 (3)`, `6.5x6.5 (3)`, `7x7 (3)`, `7.5x7.5 (2)`, `8x8 (3)`, `8.5x8.5 (2)`, `9x9 (3)`, `9.5x9.5 (2)`, `10x10 (3)`, `11x11 (2)`, `12x12 (2)`, `13x13 (1)`, `14x14 (1)`, `15x15 (1)`.

### Oval

`5x3 (1)`, `6x4 (2)`, `7x5 (3)`, `8x6 (3)`, `9x7 (3)`, `10x8 (3)`, `11x9 (2)`, `12x10 (2)`, `14x10 (2)`, `14x12 (1)`, `16x12 (1)`, `18x13 (1)`, `20x15 (1)`.

### Pear

`5x3 (1)`, `6x4 (2)`, `7x5 (3)`, `8x5 (2)`, `8x6 (2)`, `9x6 (3)`, `10x7 (3)`, `12x8 (2)`, `13x9 (1)`, `14x9 (1)`, `15x10 (1)`, `16x12 (1)`, `18x13 (1)`, `20x15 (1)`.

### Marquise

`4x2 (1)`, `5x3 (1)`, `6x3 (2)`, `7x3.5 (2)`, `8x4 (3)`, `9x4.5 (2)`, `10x5 (3)`, `12x6 (2)`, `14x7 (2)`, `16x8 (1)`, `18x9 (1)`, `20x10 (1)`.

### Heart

`5x5 (1)`, `6x6 (2)`, `7x7 (3)`, `8x8 (3)`, `9x9 (2)`, `10x10 (2)`, `11x11 (1)`, `12x12 (1)`.

### Cushion

`4x4 (2)`, `5x5 (2)`, `6x4 (2)`, `6x6 (3)`, `7x5 (2)`, `7x7 (2)`, `8x6 (3)`, `8x8 (2)`, `9x7 (2)`, `9x9 (2)`, `10x8 (2)`, `10x10 (2)`, `11x9 (1)`, `12x10 (2)`, `14x10 (1)`, `14x12 (1)`.

### Princess

`4x4 (2)`, `5x5 (3)`, `6x6 (3)`, `7x7 (3)`, `8x8 (3)`, `9x9 (2)`, `10x10 (2)`, `11x11 (1)`, `12x12 (1)`.

### Emerald

`5x3 (1)`, `6x4 (2)`, `7x5 (3)`, `8x6 (3)`, `9x7 (3)`, `10x8 (3)`, `11x9 (2)`, `12x10 (2)`, `14x12 (2)`, `16x12 (1)`, `18x13 (1)`, `20x15 (1)`, `25x18 (1)`, `27x20 (1)`.

### Radiant

`5x4 (1)`, `6x4.5 (1)`, `6x6 (2)`, `7x5 (2)`, `7x7 (2)`, `8x6 (3)`, `8x8 (2)`, `9x7 (2)`, `9x9 (2)`, `10x7 (2)`, `10x8 (2)`, `10x10 (2)`, `11x9 (1)`, `12x10 (1)`, `14x10 (1)`, `14x12 (1)`.

### Trillion

`4x4 (1)`, `5x5 (2)`, `6x6 (2)`, `7x7 (3)`, `8x8 (2)`, `9x9 (2)`, `10x10 (1)`, `11x11 (1)`, `12x12 (1)`.

## User-Facing Output

The bar always starts with `Standard setting`, followed by the fit label pill.

If dimensions were estimated, it shows:

```text
est. ~LxWmm from Xct (load IGI report for exact fit)
```

If dimensions came from report measurements, it shows:

```text
LxWmm measured
```

The detailed message then names the nearest calibrated size and gives guidance:

- `exact` / `safe`: standard prong head or bezel should seat the stone without modification.
- `workable`: may work with prong-head adjustment; bezel/halo needs tighter matching.
- `borderline`: jeweler must verify; semi-custom or adjustable peg head is safer; bezel/halo custom.
- `custom`: fully custom setting head needed.

## Research Questions / Things To Verify

- Is `+/-0.20mm` the right general tolerance for standard prong heads across common supplier catalogs?
- Should bezel and halo tolerance be modeled separately rather than only mentioned in copy?
- Should `workable` really extend to `0.35mm`, or should that be shape/setting-type dependent?
- Should `borderline` extend to `0.60mm`, or is that too optimistic for standard heads?
- Should measured princess, heart, and trillion stones be forced to square/equal sides, or should actual length/width mismatch affect fit?
- Should `asscher` map to `emerald`, or should square step-cut settings be handled separately?
- Should `old_mine` map to `round`, or should it map closer to cushion/specialty depending on outline?
- Should `moval` map to `oval`, or does the point/shoulder geometry make standard oval settings unreliable?
- Should specialty shapes with no stock table explicitly show "custom likely" instead of hiding the setting bar?
- Should popularity affect the score when two sizes are almost tied?
- Should carat-to-mm estimates extrapolate for very large stones instead of clamping to the largest table row?
- Should ratio adjustment apply before or after choosing the stock table for elongated/square subtype shapes?
