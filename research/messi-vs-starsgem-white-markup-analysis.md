# Messi vs StarGem White Diamond Markup Analysis

Document date: 2026-05-24  
Status: Simple analysis from existing parsed comp pools  
Scope: White lab-grown diamonds only, priced supplier-sheet comps, exact matched comp bins.

## Source Files

| Supplier | Comp file | Raw/source file |
|---|---|---|
| Messi Gems | `research/data/messi-comps.json` | `research/data/IGI Lab Grown Diamond List.2026.05.18xls.xlsx` |
| StarGem | `research/data/starsgem-comps.json` | `research/data/STARS Diamonds Stock2026.5.20.xls` |

The comparison below uses exact matches on:

```text
shape + white color grade + clarity + 0.05ct carat bin
```

Then it compares:

```text
markup = (Messi price / StarGem price) - 1
```

This is a like-for-like comp-bin analysis, not a full regression. It is useful for estimating supplier markup, but it still inherits any quirks in each supplier's stock mix and price sheet.

## Top-Line Result

| Metric | Result |
|---|---:|
| Messi white comp bins inspected | 1,855 |
| StarGem white comp bins inspected | 2,640 |
| Exact matched white bins | 1,274 |
| Median Messi / StarGem ratio | 1.187x |
| Mean Messi / StarGem ratio | 1.181x |
| Median Messi markup | +18.7% |
| 25th percentile markup | +8.7% |
| 75th percentile markup | +28.0% |
| 90th percentile markup | +35.6% |

Simple read: on exact matched white-diamond comp bins, Messi is typically about 19% higher than StarGem.

When restricting to bins where both suppliers have at least 5 source rows, the median Messi markup increases to about +22.4%. That suggests the markup signal is not only coming from one-off noisy cells.

## Markup By Shape

Only shapes with at least 3 matched bins are shown.

| Shape | Matched bins | Median Messi markup | Median Messi $/ct | Median StarGem $/ct |
|---|---:|---:|---:|---:|
| Oval | 172 | +23.1% | $154.8 | $126.7 |
| Marquise | 100 | +22.6% | $163.7 | $138.0 |
| Pear | 159 | +21.9% | $150.5 | $122.2 |
| Square cushion | 73 | +20.4% | $155.5 | $123.6 |
| Emerald | 158 | +19.5% | $142.5 | $119.4 |
| Round | 231 | +18.6% | $150.3 | $125.5 |
| Heart | 105 | +15.8% | $165.6 | $144.2 |
| Radiant | 98 | +12.9% | $140.2 | $126.1 |
| Asscher | 70 | +12.9% | $154.9 | $143.3 |
| Princess | 98 | +10.2% | $155.4 | $141.4 |
| Cushion | 3 | +19.0% | $137.7 | $115.8 |
| Elongated cushion | 5 | +24.3% | $156.2 | $124.6 |

Notes:

- Ovals, pears, marquise, and square cushions show the highest broad markup.
- Princess, radiant, and asscher show lower median markup.
- The elongated cushion and cushion rows have small matched-bin counts, so they should be treated as directional only.

## Markup By Carat Band

| Carat band | Matched bins | Median Messi markup | Median Messi $/ct | Median StarGem $/ct |
|---|---:|---:|---:|---:|
| 1.00-1.49 | 272 | +17.8% | $142.4 | $118.8 |
| 1.50-1.99 | 227 | +25.1% | $139.2 | $111.5 |
| 2.00-2.99 | 320 | +19.6% | $154.3 | $126.9 |
| 3.00-3.99 | 236 | +13.3% | $159.2 | $141.8 |
| 4.00-4.99 | 78 | +13.8% | $169.8 | $154.7 |
| 5.00-9.99 | 141 | +17.0% | $175.0 | $145.1 |

The 1.50-1.99ct band has the largest median gap. The 3-5ct bands are still usually higher at Messi, but the gap is less consistent.

## Markup By Color And Clarity

| Color | Matched bins | Median Messi markup | Median Messi $/ct | Median StarGem $/ct |
|---|---:|---:|---:|---:|
| D | 525 | +17.3% | $165.6 | $142.6 |
| E | 528 | +19.8% | $151.1 | $124.6 |
| F | 221 | +20.2% | $145.6 | $120.9 |

| Clarity | Matched bins | Median Messi markup | Median Messi $/ct | Median StarGem $/ct |
|---|---:|---:|---:|---:|
| VS1 | 532 | +20.1% | $150.0 | $124.4 |
| VVS2 | 483 | +18.8% | $158.8 | $132.3 |
| VS2 | 150 | +17.8% | $140.5 | $116.1 |
| VVS1 | 109 | +12.9% | $207.4 | $186.1 |

Color and clarity do not appear to explain the markup by themselves. The markup is visible across D/E/F and across VS/VVS grades.

## Representative Exact Anchor Matches

### D VS1, 1.00ct

| Shape | Messi | StarGem | Messi markup | Messi rows | StarGem rows |
|---|---:|---:|---:|---:|---:|
| Round | $131.30 | $124.41 | +5.5% | 163 | 762 |
| Oval | $155.00 | $116.47 | +33.1% | 35 | 134 |
| Pear | $156.55 | $122.29 | +28.0% | 32 | 121 |
| Emerald | $136.35 | $116.52 | +17.0% | 22 | 28 |
| Radiant | $135.00 | $135.35 | -0.3% | 25 | 10 |
| Heart | $171.70 | $156.19 | +9.9% | 24 | 25 |
| Marquise | $171.70 | $141.26 | +21.5% | 45 | 34 |
| Asscher | $135.00 | $118.06 | +14.3% | 13 | 17 |

### D VS1, 2.00ct

| Shape | Messi | StarGem | Messi markup | Messi rows | StarGem rows |
|---|---:|---:|---:|---:|---:|
| Round | $323.20 | $249.88 | +29.3% | 138 | 335 |
| Oval | $311.55 | $263.17 | +18.4% | 64 | 86 |
| Pear | $312.33 | $265.89 | +17.5% | 4 | 5 |
| Emerald | $281.40 | $246.60 | +14.1% | 14 | 19 |
| Radiant | $280.70 | $295.38 | -5.0% | 2 | 4 |
| Princess | $321.60 | $254.61 | +26.3% | 20 | 14 |
| Heart | $333.30 | $287.74 | +15.8% | 4 | 4 |
| Asscher | $351.75 | $291.18 | +20.8% | 4 | 7 |

### D VS1, 3.00ct

| Shape | Messi | StarGem | Messi markup | Messi rows | StarGem rows |
|---|---:|---:|---:|---:|---:|
| Round | $540.90 | $461.28 | +17.3% | 10 | 19 |
| Oval | $497.48 | $459.35 | +8.3% | 4 | 34 |
| Pear | $496.65 | $494.75 | +0.4% | 9 | 13 |
| Emerald | $482.40 | $383.36 | +25.8% | 8 | 14 |
| Radiant | $483.20 | $394.16 | +22.6% | 8 | 14 |
| Heart | $498.30 | $330.88 | +50.6% | 6 | 10 |
| Marquise | $495.82 | $497.86 | -0.4% | 4 | 7 |
| Square cushion | $511.70 | $417.99 | +22.4% | 6 | 6 |

## Interpretation

The simple matched-bin evidence supports the working assumption that Messi's white-diamond list is usually marked up relative to StarGem. A reasonable first-pass source adjustment is:

```text
Messi white supplier-sheet price / 1.19 ~= StarGem-like factory baseline
```

For conservative modeling, use a range instead of one hard factor:

| Use case | Suggested Messi adjustment |
|---|---:|
| General white-diamond baseline | divide by 1.18 to 1.22 |
| Ovals / pears / marquise | divide by 1.21 to 1.23 |
| Radiant / princess / asscher | divide by 1.10 to 1.13 |
| Sparse specialty shapes | do not source-adjust blindly; use direct matched comps |

This matters for the color-diamond work because the Messi color stock should not be treated as direct StarGem-equivalent wholesale until we measure the same markup layer for fancy colors.

## Caveats

- Exact comp-bin matching is strict. It does not adjust for L/W ratio, table/depth, cut subtype, growth method, or IGI enrichment differences.
- Some matched cells have one supplier with many rows and the other with only a few rows.
- A few cells show StarGem higher than Messi, especially in larger stones or specific shapes. This is why the median is more useful than individual rows.
- The analysis is based on currently parsed files only. Re-run after either supplier sends a refreshed sheet.

## Next Step

For the color-diamond model, use the 30-stone StarGem ask to test whether a similar markup exists in fancy colors:

```text
matched Messi color comp / matched StarGem color quote
```

If the color markup is stable near the white-diamond +18-22% range, Messi color stock can become a strong comparison source after source adjustment. If it varies by hue or intensity, color needs a separate source-markup table.
