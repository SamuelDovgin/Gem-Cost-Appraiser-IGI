# Current Gem Pricing Model

Last reviewed: 2026-05-22

## Direct Answer

No, the app is not currently fitting a separate continuous function to each gem style from the available exact-value comps.

The current solution is a hybrid:

1. A hand-authored baseline model estimates wholesale cost from carat, color, clarity, shape, cut, and seller/cert modifiers.
2. White diamond carat pricing uses a fixed anchor table and linear interpolation between anchors.
3. Fancy color diamond pricing uses hand-authored 1ct baselines plus power-law carat exponents by color and intensity.
4. Alibaba/Messi/StarGem comps are used through a v3 nearest-comp engine that scores comparable rows, adjusts each comp in log price space, and blends several adjusted comps.
5. Stones just below major carat marks get a smooth "magic weight" approach discount, not a hard step.

So the app has continuous-ish interpolation in places, but it is not yet doing the function-fitting model you described: no per-style LOESS, spline, segmented regression, or automatically learned local curve per gem style.

## Production Entry Point

The live app logic is currently embedded in `index.html`.

The main calculation path is:

```text
state inputs
  -> compute(ct)
  -> base model wholesale / fair / retail
  -> resolveAlibabaComp(ct)
  -> UI display, charts, comp explanations
```

The standalone research version of the comp engine is in:

```text
research/comp-engine-v3.js
```

The current production implementation mirrors much of that v3 logic directly inside `index.html`.

## Base Wholesale Model

### White Diamonds

White diamonds use:

```text
E / VS1 / Round / Ideal as the baseline
```

The function `baseWhitePerCt(ct)` contains a fixed anchor ladder:

```text
0.50ct -> $70/ct
1.00ct -> $100/ct
1.50ct -> $143/ct
2.00ct -> $193/ct
2.50ct -> $190/ct
3.00ct -> $179/ct
3.50ct -> $195/ct
4.00ct -> $217/ct
4.50ct -> $244/ct
5.00ct -> $272/ct
6.00ct -> $327/ct
7.00ct -> $362/ct
8.00ct -> $417/ct
9.00ct -> $472/ct
10.00ct -> $527/ct
```

For carats between these points, the app uses straight linear interpolation.

For carats above 10ct, it extrapolates with a simple added per-carat slope.

That means the baseline white curve is not fitted dynamically from all current comps. It is a manually chosen anchor curve.

### Magic-Weight Discount

The app explicitly accounts for stones just below major carat marks.

Current thresholds:

```text
1.0ct, 1.5ct, 2.0ct, 3.0ct, 4.0ct, 5.0ct
```

Each threshold has:

```text
maximum discount
approach zone below the mark
```

Example from the current code:

```text
1.0ct: max 9% discount inside 0.20ct below
1.5ct: max 5% discount inside 0.15ct below
2.0ct: max 9% discount inside 0.20ct below
3.0ct: max 9% discount inside 0.22ct below
4.0ct: max 6% discount inside 0.20ct below
5.0ct: max 5% discount inside 0.18ct below
```

Important detail: this is currently smooth. The discount tapers to zero exactly at the threshold.

So a 2.90ct stone is discounted relative to the 3.00ct tier, but the current model does not create a hard price jump at 3.00ct. Your instinct about small steps near carat marks is directionally represented, but the implementation is more of a smooth ramp than a stepped price function.

### White Color, Clarity, Shape, And Cut

After the white baseline, the app multiplies by:

```text
white color multiplier
carat-dependent clarity multiplier
shape multiplier
cut multiplier
```

White color is a fixed lookup table versus E:

```text
D 1.08
E 1.00
F 0.92
G 0.88
H 0.82
I 0.71
J 0.60
K 0.50
L 0.42
M 0.35
N-P 0.28
Q-R 0.21
S-Z 0.16
```

White clarity is more sophisticated than color. It uses carat knots and linear interpolation, so the discount/premium changes with carat size.

Current clarity carat knots:

```text
0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 7.0, 10.0
```

Example behavior:

```text
SI1 gets much more heavily discounted at 2ct+ than at 0.5ct.
VVS1 and IF premiums grow with size.
VS1 is the baseline at every carat.
```

Shape is still a fixed multiplier table. It is not a curve fitted by style. For example:

```text
round 1.00
oval 1.08
pear 1.05
marquise 0.87
radiant 0.87
emerald 0.83
portuguese 0.85
rose 0.72
briolette 0.70
```

### Fancy Color Diamonds

Fancy color diamonds use a different baseline:

```text
wsPerCt = ws1 * carat^(scale - 1)
totalWholesale = ws1 * carat^scale
```

Each fancy color/intensity has a hand-authored:

```text
1ct wholesale baseline
carat scaling exponent
retail multiplier
label
```

Examples:

```text
Fancy Light Pink: ws1 $150/ct, scale 0.91
Fancy Pink: ws1 $220/ct, scale 0.91
Fancy Intense Pink: ws1 $330/ct, scale 0.90
Fancy Vivid Pink: ws1 $500/ct, scale 0.88
Fancy Vivid Yellow: ws1 $375/ct, scale 0.87
Fancy Vivid Red: ws1 $950/ct, scale 1.25
```

This is a continuous formula, but it is not fitted per style from the current comp table. It is a manually calibrated prior.

Fancy clarity uses a compressed fixed lookup:

```text
IF 1.12
VVS1 1.08
VVS2 1.04
VS1 1.00
VS2 0.95
SI1 0.89
SI2 0.77
```

Fancy shape uses a separate fixed multiplier table because fancy color pricing cares more about color saturation and preferred color-retaining cuts.

## Seller, Cert, And Treatment Modifiers

The base wholesale estimate can be modified by toggles and IGI-derived fields:

```text
Chinese factory direct: 0.78x wholesale
3EX: 1.06x wholesale when cut grade exists
HPHT: 1.08x wholesale
As-grown: 1.05x wholesale
CVD not as-grown: 0.90x wholesale
Post-growth treatment: 0.94x wholesale
Elongated SI1/SI2 white shapes: 0.90x wholesale
No cut grade: uses unset cut multiplier
```

Fair price then applies seller-channel markups and certification cost. Retail uses a separate retail multiplier range.

## Current Alibaba Comp Engine

The app also loads comp data from:

```text
research/data/alibaba-comps-index.json
research/data/messi-comps.json
research/data/starsgem-comps.json
research/data/messi-color-comps.json
```

The v3 comp engine does not simply choose the closest row by carat.

It:

1. Builds a query from the current stone.
2. Filters candidate comps by color family and hue compatibility.
3. Scores each candidate using expected log-error components:

```text
carat error
color error
clarity error
shape error
source confidence error
carat-band / clarity-band penalties
```

4. De-duplicates rows by product identity.
5. Caps support from any one supplier.
6. Selects exact comps when available, otherwise selects up to 5 nearby comps inside a score cutoff.
7. Adjusts each comp to the query in log price-per-carat space.
8. Rejects large outliers.
9. Blends accepted adjusted comps with inverse-variance weighting.
10. Returns an estimate, low/high range, confidence, primary comp, support comps, rejected comps, and warnings.

The current log-space adjustment includes:

```text
white carat transform: 0.8 * log(queryCt / compCt) on price-per-carat
white color multiplier delta
white clarity multiplier delta
white shape multiplier delta
fancy color/intensity model delta
fancy modifier delta for terms like brownish or greyish
fancy clarity multiplier delta
fancy shape multiplier delta
```

This is closer to a statistical model than the base calculator, but it still does not fit a fresh local function per style. The carat transform uses fixed priors and hand-authored fancy color exponents.

## Legacy Ceiling And Messi Ladder

There is still a legacy Alibaba showroom comp list in `index.html`. It is kept mostly as a fallback/floor/ceiling sanity check for uncovered areas.

There is also a Wuzhou Messi D/round/IGI ladder for white diamonds. It contains discrete prices by clarity and carat size.

The Messi ladder lookup chooses the nearest ladder size within a tolerance:

```text
<=2ct: within 0.08ct
<=6ct: within 0.18ct
>6ct: within 0.25ct
```

Then it adjusts D-color prices to the selected white grade using the white color multiplier ratio.

This is a nearest discrete ladder lookup, not curve fitting.

## What The Current Model Does Well

The current model already handles several things your desired direction needs:

- It prices missing exact values instead of requiring an exact comp.
- It adjusts comps for carat, color, clarity, shape, and source quality.
- It blends several comps instead of trusting one nearest row.
- It has carat-dependent clarity behavior.
- It recognizes below-carat-threshold discounting.
- It exposes exact, nearest, best-available, and fallback style match quality.

## What It Does Not Yet Do

The current model does not yet:

- Fit a continuous local curve per gem style.
- Learn a separate carat curve for each shape/color/clarity family from the current comp index.
- Use LOESS, spline interpolation, isotonic regression, segmented regression, or a similar fitted model.
- Create true market steps at carat marks.
- Learn the size of the magic-weight discounts from the data.
- Model shape as a multi-dimensional style object with outline, faceting, ratio, spread, and cut family beyond fixed multipliers and compatibility buckets.
- Calibrate uncertainty from enough historical holdout testing to say the range has a known coverage rate.

## Closest Existing Design To Your Idea

The closest written plan is `research/comp-engine-v3-proposal.md`, especially the "Carat transform" section.

That proposal calls for:

```text
Fit log($/ct) against log(carat) inside the closest market segment.
Use dynamic local curves when at least 5 independent knots are available.
Use local slope plus shrinkage when 2-4 knots are available.
Use conservative priors when only one knot is available.
```

That is much closer to the function-fitting model you described. It appears to be a proposed next phase, not the current production behavior.

## Practical Recommendation

If the goal is the model you had in mind, the next version should add a fitted carat curve layer between the comp index and the final estimate:

```text
normalized market segment
  -> independent comp knots
  -> fitted log($/ct) vs log(carat)
  -> magic-weight step/ramp adjustment near thresholds
  -> quality/style adjustments
  -> blended estimate with uncertainty
```

The most important design choice is whether magic-weight behavior should be:

```text
smooth ramp, like today
small discontinuous step at exact marks
hybrid: smooth market curve plus explicit threshold premium
```

For diamond pricing psychology, the hybrid is probably best: a mostly continuous fitted curve, plus explicit threshold premiums/discounts around 1ct, 1.5ct, 2ct, 3ct, 4ct, and 5ct.

