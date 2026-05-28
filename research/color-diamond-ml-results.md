# Color Diamond ML Results

Document date: 2026-05-27

## Summary

- Training rows total: 1,657
- Messi color source-adjusted rows: 1,652
- Direct StarGem color anchor rows: 5
- Messi source adjustment: divide by 1.25
- Validation rows: 161
- Validation MAPE: 3.12%
- Validation MdAPE: 0.77%

## Coverage By Hue

| Hue | Rows |
|---|---:|
| yellow | 638 |
| pink | 438 |
| blue | 282 |
| green | 114 |
| brown | 111 |
| red | 73 |
| orange | 1 |

## Direct StarGem Anchors

| Report | Spec | Actual | Predicted | Error |
|---|---|---:|---:|---:|
| 790602324 | 1.04ct round Fancy Vivid Yellow VVS2 | $310 | $310 | +0.0% |
| 733572027 | 2.04ct oval Fancy Vivid Blue VS2 | $410 | $410 | +0.0% |
| 781650451 | 2.10ct marquise Fancy Vivid Pink VS1 | $525 | $525 | +0.0% |
| 774635289 | 4.16ct cushion Fancy Intense Yellow VS1 | $1,265 | $1,265 | +0.0% |
| 795666166 | 10.17ct round Fancy Intense Blue VS1 | $5,330 | $5,330 | -0.0% |

## Files

- Model: `research/data/color-diamond-ml-model.json`
- Metrics: `research/data/color-diamond-ml-results.json`
- Messi enriched color index: `research/data/messi-color-index.json`
- StarGem color anchors: `research/data/starsgem-color-index.json`

## Interpretation

This model estimates a StarGem-like fancy-color factory surface. It does not overwrite raw Messi prices; it divides Messi rows by the measured temporary supplier factor and leaves direct StarGem anchors at face value.

Use this as an overlay/fallback until a larger StarGem color quote sheet exists. Large rare-color stones should still carry a direct-quote warning.
