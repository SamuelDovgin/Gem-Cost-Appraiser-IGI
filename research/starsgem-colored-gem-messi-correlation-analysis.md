# StarGem Colored Diamond Anchor Analysis vs Messi Gems

Document date: 2026-05-27  
Status: Small-sample analysis from 5 user-supplied StarGem color quotes plus the existing Messi color index  
Primary use: Estimate a temporary StarGem colored-diamond multiplier from Messi Gems colored stock until StarGem supplies a real color sheet.

## Short Answer

The best temporary assumption is:

```text
StarGem colored quote ~= Messi colored comp / 1.23 to 1.30
```

or:

```text
StarGem colored quote ~= 77% to 81% of comparable Messi color stock
```

This means StarGem is probably about **19-23% cheaper than Messi** on normal 1-4ct colored lab diamonds when the match is reasonably close.

That lines up with the existing white-diamond result in `research/messi-vs-starsgem-white-markup-analysis.md`, where Messi white matched bins were **1.187x StarGem** at median, meaning StarGem was about **15.8% cheaper**.

Use **1.25x Messi / StarGem** as the first working color-source markup, not as a final trained truth.

## Source Data

Existing repo data:

| Source | File |
|---|---|
| Messi color stock | `research/data/messi-color-index.json` |
| Messi color comp bins | `research/data/messi-color-comps.json` |
| StarGem white stock | `research/data/starsgem-index.json` |
| Messi vs StarGem white markup | `research/messi-vs-starsgem-white-markup-analysis.md` |
| Color ML plan | `research/color-diamond-ml-sampling-plan.md` |

User-supplied StarGem color quote anchors:

| Cert | StarGem price | Carat | Shape | Color | Clarity | Growth / treatment | $/ct |
|---|---:|---:|---|---|---|---|---:|
| LG790602324 | $310 | 1.04 | Round | Fancy Vivid Yellow | VVS2 | HPHT, as grown | $298.08 |
| LG733572027 | $410 | 2.04 | Oval | Fancy Vivid Blue | VS2 | CVD, may include treatment | $200.98 |
| LG781650451 | $525 | 2.10 | Marquise | Fancy Vivid Pink | VS1 | CVD, may include treatment | $250.00 |
| LG774635289 | $1,265 | 4.16 | Cushion Modified | Fancy Intense Yellow | VS1 | CVD | $304.09 |
| LG795666166 | $5,330 | 10.17 | Round | Fancy Intense Blue | VS1 | CVD, may include treatment | $524.09 |

The first four anchors are the usable small-sample extrapolation set. The 10.17ct round blue is valuable, but should be treated as a stress test because Messi has no close round 10ct blue match in the color index.

## Matching Method

For each StarGem quote, I compared against Messi color records by:

1. Exact color label first, e.g. `Fancy Vivid Blue`.
2. Exact shape where available.
3. Exact clarity first, adjacent clarity only as a diagnostic.
4. Closest carat neighborhood.
5. A shape/clarity adjusted nearest-neighbor estimate where exact shape was missing.

The comparison target is price per carat:

```text
Messi / StarGem ratio = comparable Messi $/ct / StarGem quote $/ct
```

Then:

```text
StarGem discount vs Messi = 1 - (1 / ratio)
```

## Anchor Results

| StarGem anchor | Best Messi evidence | Adjusted Messi $/ct | Messi / StarGem | Implied StarGem discount | Confidence |
|---|---|---:|---:|---:|---|
| 1.04ct round Fancy Vivid Yellow VVS2 | No Messi round match. Nearest same-color/carat stones are radiant, oval, and pear. | $243-$295 | 0.82-0.99x | StarGem not cheaper on this anchor | Low |
| 2.04ct oval Fancy Vivid Blue VS2 | Same-shape Messi oval blue vivid rows, nearest at 2.46-2.77ct. | ~$260 | 1.29x | 22.5% cheaper | Medium |
| 2.10ct marquise Fancy Vivid Pink VS1 | No Messi marquise match. Nearest same-color/carat stones are radiant, round, and oval; shape-adjusted to marquise. | ~$307 | 1.23x | 18.7% cheaper | Medium-low |
| 4.16ct cushion Fancy Intense Yellow VS1 | Cushion/square-cushion yellow intense rows near 4.15-5.04ct. Wide spread. | ~$404 | 1.33x | 24.8% cheaper | Medium-low |
| 10.17ct round Fancy Intense Blue VS1 | No close Messi round large-blue match. Nearest large blue rows are radiant, pear, cushion, elongated cushion. | ~$306 | 0.58x | StarGem higher | Low / outlier |

The four-anchor median, using the shape/clarity-adjusted nearest estimates, is about:

```text
median Messi / StarGem ~= 1.26x
StarGem ~= 79.4% of Messi
StarGem discount ~= 20.6%
```

The same four anchors with less adjustment and more raw nearest-neighbor comparison land closer to **1.30-1.33x**, or **23-25% cheaper**.

So a practical working range is:

| Use case | Temporary multiplier |
|---|---:|
| Conservative StarGem estimate from Messi color comp | `Messi / 1.20` |
| Best current working estimate | `Messi / 1.25` |
| Aggressive estimate where Messi match is strong and StarGem is likely factory-direct | `Messi / 1.30` |

## Correlations Found

### 1. Supplier Markup Is Real

The color anchors mostly agree with the white-diamond supplier markup already measured:

| Segment | Messi / StarGem ratio | StarGem discount |
|---|---:|---:|
| White matched bins, existing analysis | 1.187x median | 15.8% |
| Colored anchors, first-pass normal-size set | ~1.26x median | 20.6% |
| Colored anchors, raw/less adjusted view | ~1.30-1.33x | 23-25% |

This suggests the main factor is probably not only "colored diamonds are different." A large part is the same supplier/channel effect already visible in white diamonds: Messi generally prices higher than StarGem.

### 2. Color Needs Its Own Source Adjustment

The color markup appears slightly larger than the white markup, but the sample is too small to make that final.

Working interpretation:

```text
White:  divide Messi by ~1.19
Color:  divide Messi by ~1.25 until better StarGem color data exists
```

This should live as a source adjustment layer, not be baked permanently into hue pricing.

### 3. Blue And Pink Vivid Support The Discount

The strongest anchors are:

| Anchor | Signal |
|---|---|
| 2.04ct oval Fancy Vivid Blue VS2 | Messi comparable is about 1.29x StarGem |
| 2.10ct marquise Fancy Vivid Pink VS1 | Shape-adjusted Messi comparable is about 1.23x StarGem |

These are useful because blue and pink are important high-value colors and Messi has enough stock to compare nearby stones.

### 4. Yellow Is Noisier

Yellow gives mixed evidence:

- The 1.04ct round Fancy Vivid Yellow StarGem quote is higher than nearby non-round Messi rows after shape adjustment.
- The 4.16ct cushion Fancy Intense Yellow quote is lower than most nearby Messi cushion/square-cushion rows, but one close Messi row is nearly equal.

Likely causes:

- Round fancy-color yellow is not well represented in Messi's color sheet.
- Fancy yellow supply is deeper and flatter than pink/blue.
- Cushion vs square cushion vs elongated cushion creates real noise.
- Some Messi yellow rows cluster at formula-like price bands, while others spike.

Do not train a yellow-specific StarGem discount from these two anchors alone.

### 5. The 10ct Round Blue Is A Scarcity Interaction

The 10.17ct round Fancy Intense Blue StarGem quote is higher than the nearest Messi large-blue non-round rows. This should not be averaged into the global color multiplier because it is not a like-for-like comp.

It probably reflects a combined interaction:

```text
large carat x round shape x blue color x thin availability
```

This is exactly the kind of interaction that a model can miss if it only learns a global source multiplier.

## Recommended Model Decision

Do **not** build a fully separate colored-gem ML model yet from these anchors.

Instead:

1. Keep the current fancy-color prior.
2. Add a temporary source-adjustment layer:

```text
starsgem_like_color_price = messi_color_comp_price / 1.25
```

3. Add uncertainty based on match quality:

| Match quality | Suggested uncertainty |
|---|---:|
| Same hue, intensity, shape, clarity, close carat | +/- 10-12% |
| Same hue/intensity but shape or clarity adjusted | +/- 18-25% |
| Large stones above 5ct with no same-shape match | +/- 30%+ |
| Rare color or modifier with fewer than 10 comparable rows | Do not ML-train; comp-only |

4. Train an integrated color overlay only after StarGem supplies a balanced color quote sample.

The right architecture is:

```text
base fancy-color prior
+ supplier/source adjustment
+ residual ML overlay where coverage is strong
+ comp confidence and fallback rules
```

This avoids accidentally training the model to treat Messi's markup as factory wholesale.

## Practical Temporary Rule For The App

Until `starsgem-color-index.json` exists:

```text
if using Messi color comp as StarGem proxy:
  estimated_starsgem_color = messi_color_comp / 1.25
  confidence = low unless exact hue + intensity + shape + clarity + carat band match
```

For customer-facing explanation:

```text
StarGem color is estimated from Messi color stock with a temporary supplier adjustment. Current small-sample evidence suggests StarGem is roughly 15-25% cheaper than Messi on comparable colored lab diamonds, but large rare-color stones need direct quote confirmation.
```

## Data We Still Need From StarGem

The minimum useful next StarGem ask is not a whole catalog. It is a compact matched sample:

| Need | Why |
|---|---|
| 1-5ct yellow, pink, blue, green | Learn hue and carat curves |
| Fancy, Fancy Intense, Fancy Vivid | Learn intensity spread |
| VS2, VS1, VVS2 | Validate compressed clarity effects |
| Radiant/cushion plus oval/pear/marquise/round | Separate color-retaining shapes from white-diamond shape discounts |
| At least 3 large blue/pink/yellow stones above 5ct | Prevent 10ct outlier behavior from distorting the model |

Target: 30 high-information rows first, then 100-150 rows for a real training set.

## Final Recommendation

Use **Messi / 1.25** as the temporary StarGem colored-diamond proxy.

Do not integrate this as a hard global truth. Integrate it as a source-markup assumption with confidence warnings, then replace it with a StarGem color index once quote coverage exists.

The likely factor at play is:

```text
supplier/channel markup first
color hue/intensity second
shape x carat scarcity third
```

The 10ct round blue quote is the warning: for rare large colored stones, direct StarGem quote beats any multiplier.
