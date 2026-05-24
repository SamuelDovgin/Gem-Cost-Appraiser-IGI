# Color Diamond 30-Stone High-Information Ask

Document date: 2026-05-24  
Status: Plan only, no implementation yet  
Goal: If StarGem will only quote about 30 colored diamonds, choose the combinations that reveal the most about the fancy-color multiplier on top of the existing model.

## Principle

With only 30 stones, do not spread the ask thinly across every shape, clarity, and rare color. The most valuable data comes from controlled pairs:

- Hold shape constant.
- Hold clarity constant.
- Hold report lab constant.
- Vary hue, intensity, and carat.

That lets us estimate the multiplier caused by fancy color itself, instead of mixing color effects with shape, clarity, or seller quirks.

Preferred controlled baseline:

```text
IGI, VS1, Radiant, exact per-stone USD price
```

If radiant is unavailable for a cell, use cushion as the first fallback and clearly mark it as fallback. Do not silently swap shapes.

## The 30 Stones

### Block A: Core Color Multiplier Grid

Ask for these 24 stones first. This is the core of the experiment.

| # | Hue | Intensity | Carat | Shape | Clarity | Why it matters |
|---:|---|---|---:|---|---|---|
| 1 | Yellow | Fancy | 1.00 | Radiant | VS1 | Low color premium anchor |
| 2 | Yellow | Fancy | 3.00 | Radiant | VS1 | Yellow carat scaling |
| 3 | Yellow | Fancy Intense | 1.00 | Radiant | VS1 | Intensity step |
| 4 | Yellow | Fancy Intense | 3.00 | Radiant | VS1 | Intense scaling |
| 5 | Yellow | Fancy Vivid | 1.00 | Radiant | VS1 | Vivid premium |
| 6 | Yellow | Fancy Vivid | 3.00 | Radiant | VS1 | Vivid scaling |
| 7 | Pink | Fancy | 1.00 | Radiant | VS1 | Low/mid pink anchor |
| 8 | Pink | Fancy | 3.00 | Radiant | VS1 | Pink carat scaling |
| 9 | Pink | Fancy Intense | 1.00 | Radiant | VS1 | Main pink intensity step |
| 10 | Pink | Fancy Intense | 3.00 | Radiant | VS1 | High-value pink scaling |
| 11 | Pink | Fancy Vivid | 1.00 | Radiant | VS1 | Vivid pink premium |
| 12 | Pink | Fancy Vivid | 3.00 | Radiant | VS1 | Vivid pink large-stone premium |
| 13 | Blue | Fancy | 1.00 | Radiant | VS1 | Base blue anchor |
| 14 | Blue | Fancy | 3.00 | Radiant | VS1 | Blue carat scaling |
| 15 | Blue | Fancy Intense | 1.00 | Radiant | VS1 | Main blue intensity step |
| 16 | Blue | Fancy Intense | 3.00 | Radiant | VS1 | Blue larger-stone premium |
| 17 | Blue | Fancy Vivid | 1.00 | Radiant | VS1 | Vivid blue premium |
| 18 | Blue | Fancy Vivid | 3.00 | Radiant | VS1 | Vivid blue scaling |
| 19 | Green | Fancy | 1.00 | Radiant | VS1 | Base green anchor |
| 20 | Green | Fancy | 3.00 | Radiant | VS1 | Green carat scaling |
| 21 | Green | Fancy Intense | 1.00 | Radiant | VS1 | Main green intensity step |
| 22 | Green | Fancy Intense | 3.00 | Radiant | VS1 | Green larger-stone premium |
| 23 | Green | Fancy Vivid | 1.00 | Radiant | VS1 | Vivid green premium |
| 24 | Green | Fancy Vivid | 3.00 | Radiant | VS1 | Vivid green scaling |

Why 1ct and 3ct:

- 1ct gives a clean common-price anchor.
- 3ct shows whether the fancy-color premium scales up, flattens, or discounts with size.
- Using 2ct instead would be okay, but 3ct tells us more about expensive appraisal mistakes.

### Block B: Shape Multiplier Bridges

Use 4 stones to test whether color-retaining shapes behave differently than the white-diamond shape table.

| # | Hue | Intensity | Carat | Shape | Clarity | Paired against |
|---:|---|---|---:|---|---|---|
| 25 | Yellow | Fancy Intense | 2.00 | Cushion | VS1 | Radiant yellow intensity curve |
| 26 | Yellow | Fancy Intense | 2.00 | Oval | VS1 | Radiant yellow intensity curve |
| 27 | Pink | Fancy Intense | 2.00 | Cushion | VS1 | Radiant pink intensity curve |
| 28 | Pink | Fancy Intense | 2.00 | Oval | VS1 | Radiant pink intensity curve |

Why these:

- Yellow and pink have the best existing Messi coverage.
- Fancy Intense is common enough to quote and meaningful enough to price.
- Cushion vs radiant tests color-concentration cuts.
- Oval tests a popular retail shape that may price differently from white-diamond oval.

### Block C: Clarity Multiplier Bridges

Use the final 2 stones to test whether the current compressed fancy-color clarity multiplier is right.

| # | Hue | Intensity | Carat | Shape | Clarity | Paired against |
|---:|---|---|---:|---|---|---|
| 29 | Yellow | Fancy Intense | 2.00 | Radiant | VS2 | VS1 yellow curve |
| 30 | Yellow | Fancy Intense | 2.00 | Radiant | VVS2 | VS1 yellow curve |

Why yellow:

- Yellow is usually easiest for suppliers to quote.
- If the VS2/VS1/VVS2 spread is small in yellow, that supports using a global compressed clarity table for color diamonds.
- If the spread is large even in yellow, we should not trust the existing clarity prior for colored stones.

## What This 30-Stone Ask Can Teach

This ask can estimate:

| Question | Data used |
|---|---|
| Fancy vs Fancy Intense vs Fancy Vivid multiplier | Block A within each hue |
| Yellow vs pink vs blue vs green hue premium | Block A at matching intensity/carat |
| Carat scaling for colored stones | 1ct vs 3ct pairs in Block A |
| Whether color-retaining shapes need a separate table | Block B |
| Whether clarity is compressed for color diamonds | Block C |
| Whether Messi markup is stable vs StarGem | Compare all 30 against Messi matched comps |

## What This Ask Cannot Teach

With only 30 stones, do not try to learn:

- Red, purple, orange, blue-green, or coffee/brown as trained surfaces.
- Modifier penalties like brownish pink or greyish green.
- Full shape table across every hue.
- IF/VVS1 premiums.
- 4ct and 5ct behavior.
- Separate HPHT vs CVD effects.

Those should stay comp-based until a second data round.

## Supplier Instructions

Send this exact wording:

```text
We only need a compact pricing sample, not your full catalog.

Please quote the 30 lab-grown fancy-color diamond combinations below. Exact matches are ideal. If an exact match is not available, please send the closest available stone and keep the row in the same position, with exact carat, shape, color grade, clarity, report lab, report number, measurements, growth method, and USD price per stone.

Please use IGI-certified stones where possible. Please avoid broad price ranges; we need exact per-stone prices or exact quote prices.
```

## If They Push Back Further

If they can only send 15 stones, keep:

- Yellow, pink, blue, green
- Fancy Intense and Fancy Vivid only
- 1ct and 3ct only
- Radiant VS1 only

That is 16 possible cells; drop Fancy Vivid Green 3ct if needed. The 15-stone version sacrifices clarity and shape learning, but still estimates the most important color/intensity/carat multipliers.
