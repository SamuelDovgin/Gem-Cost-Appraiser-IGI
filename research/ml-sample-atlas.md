# StarGem sample atlas — training stock vs S20 ML

**Interactive document:** [`ml-sample-atlas.html`](ml-sample-atlas.html) (serve with `npm run serve` → `/research/ml-sample-atlas.html`)

**Data:** [`data/ml-sample-atlas.json`](data/ml-sample-atlas.json) · regenerate: `npm run research:ml-atlas`

## What this is

Every cell is built from **real Wuzhou StarGem sheet rows** in [`data/starsgem-index.json`](data/starsgem-index.json) (22,541 priced IGI stones, ≥1ct filter), grouped by:

- **Shape** (ROUND, OVAL, MARQUISE, …)
- **Carat bucket** (1.00–1.49ct through 10ct+)
- **Color** (D / E / F tables in the HTML)
- **Clarity** (IF → SI2)

For each cell you get:

| Field | Meaning |
| --- | --- |
| **n** | Count of actual stock rows in that bucket |
| **Train med** | Median $/ct from the sheet (what the model was trained on) |
| **p25–p75** | Spread of real prices |
| **ML** | S20 prediction at bucket midpoint carat |
| **Lookup n** | How many training rows fed the ML lookup anchor for that grade |
| **Samples** | Up to 8 spread picks (cheap → expensive) with row # and IGI PDF link |
| **all rows ↗** | Opens [`spreadsheet-viewer.html`](spreadsheet-viewer.html) filtered to those Excel rows |

Charts overlay **green = training median**, **purple = ML**, **amber = lookup anchor** across the clarity ladder.

## How to read gaps (higher clarity should cost more)

1. **Empty / sparse cells** (n=0 or n&lt;5) — ML falls back to coarser lookup keys; adjacent clarities can share unrelated global buckets.
2. **Training median already inverted** — Rare, but if the sheet has few stones, medians are noisy.
3. **Training monotonic, ML not** — Lookup + tree residual issue (see [`ml-grade-monotonicity-analysis.md`](ml-grade-monotonicity-analysis.md)).
4. **ML below training on VS+** — Residual trained to discount vs lookup on well-supported cells.
5. **ML above training on SI1** — Off-catalog grade with n=1 lookup; comp engine discounts SI much more than ML.

## Pinned cases (in HTML)

- Marquise ~4.08ct E **VVS2** and **SI1** — stones within ±0.35ct of reference carat listed with IGI links
- Round 2ct E VS1 — high-volume reference cell

## Source

- Supplier: Wuzhou StarGem Co., Ltd.
- File: `STARS Diamonds Stock2026.5.20.xls`
- Model: S20 specialty tail (`research/data/starsgem-ml-extra-trees-model-s20-specialty-tail.json`)

## Related

- [ML grade monotonicity charts](ml-grade-monotonicity-diagnostics.html)
- [Monotonicity write-up](ml-grade-monotonicity-analysis.md)
