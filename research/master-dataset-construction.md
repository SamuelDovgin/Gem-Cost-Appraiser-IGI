# Master Training Dataset Construction

**Status:** Canonical for future white-diamond ML training  
**Date:** 2026-05-31  
**Builder:** `python3 research/scripts/dataset-split-outliers.py`  
**Training output:** `research/data/dataset-clean-training.json`

---

## Principle

The master dataset should keep as many real StarGem/IGI datapoints as possible,
including large stones and physically distinct cuts, while removing only price
clusters that appear to be stale/mispriced relative to otherwise identical
stones.

This dataset is the exclusive white-diamond ML training source going forward.
Do not train future white-diamond ML models directly from:

```text
research/data/STARS Diamonds Stock2026.5.20.xls
research/data/starsgem-index.json
```

Those are source/ingest artifacts. Always regenerate and train from:

```text
research/data/dataset-clean-training.json
```

---

## Source

The master dataset is built from:

```text
research/data/starsgem-index.json
```

That index already applies the thousands of pulled IGI reports from:

```text
research/data/igi-report-enrichment.json
```

The IGI enrichment is required because it supplies report-backed shape/style
signals such as:

- `Round Brilliant`
- `Pear Modified Brilliant`
- `Oval Modified Brilliant`
- `Cut Cornered Rectangular Modified Brilliant`
- `Square Emerald Cut`
- measurements, L/W ratio, table, depth, growth method, and report date

The raw supplier row number is not enough. Large current stones can appear early
in the supplier sheet, so row number alone must not delete a row.

---

## Style Buckets

Rows are grouped by `shape_style`, not just supplier `shape`.

Examples:

```text
ROUND_STANDARD
PEAR_STANDARD
PEAR_MODIFIED
PEAR_ICE_FLOWER
OVAL_STANDARD
OVAL_MODIFIED
RADIANT_MODIFIED
CUSHION_ELONGATED
OLD_MINE
OLD_EUROPEAN
```

This is the key fix for the old problem: do not throw away modified or
traditional-looking inventory just because it is expensive. First identify
whether the IGI report or source cut label says it belongs to a separate
physical/style bucket. If it does, keep it in that bucket.

`传统切` is treated as a data-entry/source label, not automatically as a separate
physical cut. If IGI says the stone is a normal brilliant, it goes into the
standard bucket. If IGI says modified, it goes into the modified bucket.

`冰花切` is routed into an ice-flower style bucket because it represents a
distinct visual/facet product and should not contaminate standard pear/oval/etc.

---

## Cluster Rule

For each exact style-aware spec group:

```text
round(carat, 2) + shape_style + color + clarity
```

sort stones by `$ / ct`.

If the largest consecutive price jump is at least `30%`, and both sides of the
jump are meaningful clusters:

- low cluster size >= 2
- high cluster size >= 2
- low cluster size >= high cluster size

then keep the lower/base cluster and quarantine the higher cluster as:

```text
H_high_price_cluster
```

If there is no significant cluster split, but a lone point is at least `40%`
above the base style/spec median, quarantine it as:

```text
F_extreme_outlier
```

Everything else stays in:

```text
A_standard_recent
```

`A_standard_recent` is the training set.

---

## Why Drop The Higher Cluster?

When two otherwise identical groups are both significant and we cannot identify
a physical/style difference, the higher-priced group is more likely to be stale
rate-card inventory or unexplained mispricing. Keeping it teaches the model that
the same gem has two unrelated prices.

The policy is therefore:

```text
If a meaningful high-price cluster exists and no style/spec difference explains
it, drop the higher cluster from ML training.
```

This preserves the current/base market surface without deleting the lower
cluster that reflects the more competitive price.

---

## Current Output

Current generated dataset:

```text
research/data/dataset-clean-training.json
```

Current shape:

```text
source rows:       22,541 enriched white rows
training rows:     21,982
excluded rows:        559
10ct+ rows kept:      441
30ct+ rows kept:       28
max carat kept:     41.72ct
```

Known checked row now included:

```text
IGI 797627033
13.14ct ROUND_STANDARD D VVS2 CVD
$456.90/ct
```

---

## Regeneration

Run:

```bash
npm run research:build-master-dataset
```

Then train white ML models from `dataset-clean-training.json`.

The builder also writes:

```text
research/data/dataset-split-report.json
research/data/dataset-split-summary.json
```

Use `dataset-split-report.json` to inspect why a row was kept or quarantined.
Use `dataset-split-summary.json` to monitor row counts, noise floor, cluster
counts, and shape/style sufficiency.

For the explanation of every quarantined segment and the review checklist before
adding future removal rules, see:

```text
research/master-dataset-removal-audit.md
```

For the selectable-shape and IGI-recognition coverage guardrail, see:

```text
research/shape-option-recognition-audit.md
```

---

## Future Iteration Rules

Do:

- add better IGI parsing and style buckets when a real physical difference is
  identifiable
- keep large stones if their style/spec bucket is valid
- keep modified cuts in their own bucket when IGI confirms the style
- drop unexplained higher price clusters when no feature explains them
- record every rule change in this doc and regenerate the dataset

Do not:

- use row number alone to delete stones
- merge `Pear Brilliant` and `Pear Modified Brilliant` if IGI can distinguish them
- train models from raw XLS or raw `starsgem-index.json`
- keep high-price clusters merely because they improve large-stone extrapolation
- delete lower/base clusters when they are the majority
