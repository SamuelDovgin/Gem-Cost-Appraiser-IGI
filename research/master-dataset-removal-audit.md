# Master Dataset Removal Audit

**Status:** Active guardrail  
**Date:** 2026-05-31  
**Canonical training file:** `research/data/dataset-clean-training.json`  
**Full audit file:** `research/data/dataset-split-report.json`

---

## Short Answer

Yes, we now have a master white-diamond ML dataset:

```text
research/data/dataset-clean-training.json
```

This is the only dataset future white-diamond ML models should train on unless
the model is explicitly labeled diagnostic/research-only.

The current build starts from `22,541` IGI-enriched white rows and keeps
`21,982` rows for training. It quarantines `559` rows from ML training.

Quarantined does not mean deleted. Every source row remains inspectable in:

```text
research/data/dataset-split-report.json
```

Each quarantined row has a `segment_reason` explaining why it was excluded from
ML training.

---

## What Is Not Removed Anymore

The previous cleanup was too blunt because it removed early-row inventory and
specialty-looking labels before asking whether IGI could explain the difference.
That is no longer the rule.

These are not standalone removal reasons:

- supplier row number <= `15,000`
- `传统切`
- `冰花切`
- modified brilliant cuts
- old mine / old European labels
- large carat size
- a stone simply being more expensive than another shape

Instead, physical/style differences are routed into `shape_style` buckets such
as:

```text
PEAR_STANDARD
PEAR_MODIFIED
PEAR_ICE_FLOWER
OVAL_STANDARD
OVAL_MODIFIED
ROUND_STANDARD
RADIANT_MODIFIED
CUSHION_ELONGATED
OLD_MINE
OLD_EUROPEAN
```

That means a modified pear should not poison the normal pear surface, and a
normal pear should not cause the modified pear to be deleted. They are allowed
to be different products.

---

## Removal Philosophy

The model should learn real structure:

- carat scarcity and magic-weight behavior
- color and clarity ladders
- HPHT versus CVD differences
- style/cut bucket differences
- large-stone pricing when the data supports it

The model should not learn unexplained duplicate prices for the same gem spec.
If two same-style/spec clusters exist and no feature explains the higher one,
the higher cluster is treated as stale, promotional, manual, or otherwise
non-current pricing.

The default posture is keep, bucket, and explain. Removal is only allowed after
the row fails the style-aware same-spec price check.

---

## Current Quarantined Sets

Only two segments are excluded from ML training:

```text
F_extreme_outlier
H_high_price_cluster
```

Everything else is kept in:

```text
A_standard_recent
```

Current counts:

```text
A_standard_recent       21,982  kept for ML training
F_extreme_outlier          179  quarantined from ML
H_high_price_cluster       380  quarantined from ML
```

---

## Segment F: Lone Extreme Outliers

`F_extreme_outlier` means a row is a lone point priced at least `40%` above the
base median of otherwise same-style/spec stones.

The comparison key is:

```text
round(carat, 2) + shape_style + color + clarity
```

This segment exists to prevent a single stale or manual listing from bending the
surface upward.

Current count:

```text
179 rows
```

Observed range:

```text
carat: 1.00ct to 10.08ct
$/ct:  $145.81 to $902.42
```

Most common style buckets in this segment:

```text
ROUND_STANDARD       84
EMERALD_STANDARD     27
PRINCESS_STANDARD    17
HEART_STANDARD       14
PEAR_STANDARD        13
OVAL_STANDARD        12
```

Example row:

```text
IGI 754584929
10.08ct ROUND_STANDARD D VVS1 CVD
$902.42/ct
Reason: 66.7% above the base spec median of $541/ct.
```

This row is not removed because it is large. It is quarantined because it is a
lone same-style/spec price outlier far above the comparable base median.

Another example:

```text
IGI 735558340
10.03ct OVAL_MODIFIED E VVS2 CVD
$544.16/ct
Reason: 106.9% above the base spec median of $263/ct.
```

This row is not removed because it is modified. It is already in
`OVAL_MODIFIED`. It is quarantined only because it is a lone high point inside
that style-aware spec bucket.

---

## Segment H: High Price Clusters

`H_high_price_cluster` means a same-style/spec group split into two meaningful
price clusters and the higher cluster had no identifiable style/spec difference.

The split rule is:

- largest consecutive price jump >= `30%`
- low cluster size >= `2`
- high cluster size >= `2`
- low cluster size >= high cluster size

When that happens, the lower/base cluster is kept and the unexplained higher
cluster is quarantined.

Current count:

```text
380 rows
```

Observed range:

```text
carat: 1.00ct to 5.07ct
$/ct:  $145.24 to $349.89
```

Most common style buckets in this segment:

```text
ROUND_STANDARD       212
OVAL_STANDARD         73
PRINCESS_STANDARD     61
HEART_STANDARD        22
EMERALD_STANDARD       6
```

Example row:

```text
IGI 790637780
5.07ct ROUND_STANDARD E VVS2 CVD
$198.33/ct
Reason: high cluster is 53.5% above the base cluster median of $129/ct
for the same ROUND_STANDARD E VVS2 5.07ct group.
```

This row is quarantined because the same style/spec group has a lower current
cluster with more support, and no feature explains why this cluster should be
separate.

Another example:

```text
IGI 793619366
3.09ct PRINCESS_STANDARD D VVS2 CVD
$223.76/ct
Reason: high cluster is 53.8% above the base cluster median of $145/ct
for the same PRINCESS_STANDARD D VVS2 3.09ct group.
```

This is the specific guardrail for unexplained princess clusters: if IGI,
measurements, style bucket, or another real feature cannot explain the premium,
the higher cluster is quarantined rather than taught to the model.

---

## Why The Higher Cluster Is Removed

For same-style/spec duplicates, two prices cannot both be the learned current
market surface unless there is an explaining feature.

If we keep the higher unexplained cluster, the model learns that identical
stones can have two unrelated prices. That makes gradients noisier, bends local
fit upward, and can make large-carat extrapolation look falsely supported.

The current rule therefore chooses:

```text
keep the lower/base cluster
quarantine the higher unexplained cluster
```

This is intentionally conservative. The base cluster must be at least as large
as the high cluster, so the rule does not delete the majority side of a spec
group.

---

## Sensitivity Check

The builder writes a sensitivity sweep so we can see how aggressive the cleanup
is.

Current sweep:

```text
style buckets only                22,541 kept   noise floor 3.795%
F only                            22,027 kept   noise floor 2.824%
F + H gap 1.40 conservative       22,025 kept   noise floor 2.819%
F + H gap 1.30 recommended        21,982 kept   noise floor 2.768%
F + H gap 1.25 aggressive         21,968 kept   noise floor 2.752%
```

The recommended setting keeps `97.52%` of the enriched white dataset. The
aggressive setting only removes `14` more rows, so the current cleanup is not
trying to squeeze the dataset down for vanity metrics. It removes the obvious
unexplained price modes and keeps the rest.

---

## Required Review Before Adding A New Removal Rule

Do not add a new removal segment unless all of these are true:

- IGI/style bucketing cannot explain the price difference.
- The rule is based on same-style/spec comparisons, not broad shape averages.
- The rule preserves the lower/base cluster when the high cluster is unexplained.
- The removed rows remain in `dataset-split-report.json`.
- The new segment has a plain-English `segment_reason`.
- This markdown file and `master-dataset-construction.md` are updated.
- The dataset is regenerated with `npm run research:build-master-dataset`.
- At least one known row that should be preserved is checked explicitly.

Good cleanup should make the dataset more honest, not smaller for its own sake.

---

## How To Inspect A Quarantined Row

Use the full split report:

```text
research/data/dataset-split-report.json
```

Find by `reportno`, then read:

```text
segment
segment_reason
shape_style
carat
color
clarity
upc
```

If the `segment_reason` is not persuasive, the row should be reviewed and either
the style parser should be improved or the cleanup rule should be changed.

---

## Audit Agreement and Cut-Style Price Spread Analysis

**Date:** 2026-05-31  
**Verdict on current audit:** Agreed. The philosophy is sound. Routing specialty
cuts into style buckets before applying the outlier/cluster rules is correct.
The two quarantine segments (F and H) are narrow and defensible. The removal
rate of 2.48% is appropriate.

The following analysis documents per-cut-style price structure and flags anything
worth watching going forward.

---

### Cut Grade Inventory (n=28,394 total rows)

```text
ID          12,417   standard StarGem Ideal label
NONE/dash   12,225   blank or dash — mainly fancy shapes with no cut grade
EX           3,162   IGI Excellent
TRAD (传统切)    301   traditional cut style
ICE  (冰花切)    265   ice flower cut style
ELONGCUSH (长垫形) 20  elongated cushion style
VG               2   Very Good (negligible)
OLDEUR (老欧切)  1    old European
OLDMINE (老矿切) 1    old mine
```

---

### EX vs ID: Counterintuitive Premium, Mostly Epoch-Driven

EX (Excellent) commands a higher price than ID (Ideal) in 78.6% of same-spec
round groups. The global mean premium is +4.7%. Two buckets stand out:

```text
0.50-0.69ct rounds:  EX=$153.83/ct  ID=$118.94/ct  → EX>ID +29%
3.00-3.99ct rounds:  EX=$137.38/ct  ID=$110.79/ct  → EX>ID +24%
```

This looks alarming but is primarily an **inventory-era effect**. When comparing
stones from the same row band (same approximate pricing period):

```text
0.50-0.69ct, rows 20k-25k:  ID=$156.35  EX=$160.24  → EX>ID +2.5%
0.50-0.69ct, rows 25k+:     ID=$116.61  EX=$118.94  → EX>ID +2.0%
```

The large aggregate gaps disappear when epoch is controlled. EX stones in small
sizes are disproportionately from the older r20k-25k band while ID stones are
more recent r25k+ stock. Across the full dataset, EX commands a real but small
premium of roughly **2–3%** over ID within the same pricing era.

For 3.00-3.99ct rounds, the gap is similar: EX stones concentrate in rows
3,915-4,149 (old r0-5k era pricing) while most ID stones at that size are rows
6,825-7,641 (lower-era pricing). Same-band comparison brings the gap to under 5%.

**Model implication:** Both ID and EX land in `ROUND_STANDARD`. The 2-3% real
gap between them is well within normal ML noise. No action needed. The large
apparent EX>ID gaps in aggregate are not real cut-quality premiums; they are
inventory age effects already handled by training on recent rows.

---

### TRAD (传统切): Real Cut-Style Premium, Not Just Epoch

TRAD stones are concentrated in rows 8,350–12,342. Standard NONE cuts are in
rows 12,139–20,961. There is a row-band confound, but it does not explain the
entire premium.

```text
Shape       TRAD med    NONE med    TRAD/NONE   n(TRAD)   CV
OVAL        $206/ct     $126/ct     x1.63       143       21%
PEAR        $236/ct     $122/ct     x1.94        85       26%
HEART       $267/ct     $148/ct     x1.81        73       26%
```

In rows 8-12k, standard NONE stones in comparable shapes price around $120-130/ct
(similar to the overall NONE median). TRAD's $200-270/ct in the same era implies
a genuine **60–70% cut-style premium** over same-era standard cuts, not epoch
alone.

TRAD stones are a distinct product and their higher prices are appropriate. The
current audit correctly routes them into `_MODIFIED` style buckets (`OVAL_MODIFIED`,
`PEAR_MODIFIED`, `HEART_MODIFIED`), separating them from the standard surface.
This is the right call.

**No price clustering anomaly.** The TRAD premium is stable and explained by
cut style.

---

### ICE (冰花切): Highest Premium, High Spread is Carat-Driven

ICE stones command the largest overall premium:

```text
Shape       ICE med     NONE med    ICE/NONE    n(ICE)   CV
OVAL        $277/ct     $126/ct     x2.20       124      33%
PEAR        $287/ct     $122/ct     x2.36       115      52%
HEART       $396/ct     $148/ct     x2.68        26      45%
```

ICE PEAR has a 52% coefficient of variation. This looks like a bimodal cluster
problem, but it is almost entirely **carat-driven**. The cheapest ICE pears are
2.56–2.89ct (rows 4,633–9,132, $143–176/ct). The most expensive are 20–33ct
stones (rows 5–45, $773–926/ct). There is no unexplained cluster within a given
carat range — the spread is a natural carat price curve.

ICE OVAL premium is remarkably consistent across carat bands (x1.5–1.7) except
for very small sample sizes below 2ct.

**No cleanup needed.** High CV is appropriate for a wide-carat specialty cut.
The current audit correctly keeps ICE stones in their own `_ICE_FLOWER` style
buckets. The premium is real, stable, and explained by product type.

---

### ELONGCUSH (长垫形): Spec-Driven Premium, Not Cut-Driven Anomaly

All 20 ELONGCUSH stones are 3–9ct cushions, skewed heavily toward D/E VVS1:

```text
n=20   carat: 3.01–9.06ct   $/ct: $191–$340   med=$270/ct   CV=19.5%
CUSHION NONE median: $123/ct   →   ELONGCUSH/NONE ratio: x2.19
```

The 2.19x premium is largely **spec-driven, not purely cut-driven**. These are
all large-carat, high-color, high-clarity stones — a population that would be
more expensive than a mixed-spec cushion baseline regardless of cut label.
Additionally, they are older inventory (rows 236–3,175, r0-5k era) when prices
were higher.

There is no unexplained sub-cluster within ELONGCUSH. The 19.5% CV is modest
and consistent with carat variation across a 3-9ct range.

**Current handling is correct.** These route into `CUSHION_ELONGATED`. No
further cleanup is warranted.

---

### OLDMINE / OLDEUR: Effectively Zero Signal

```text
OLDMINE: 1 stone — CUSHION E VVS1 8.13ct  $313/ct  row=278  report=756586031
OLDEUR:  1 stone — ROUND E VS1 2.06ct     $177/ct  row=6007 report=797668056
```

Two total stones. No statistical analysis is possible. They are correctly
segregated into `OLD_MINE` and `OLD_EUROPEAN` buckets and will be kept out of
the main training surface until volume accumulates.

---

### Summary: What the Cut-Style Analysis Confirms

| Cut style   | Premium vs standard | Explained by    | Action needed |
|-------------|---------------------|-----------------|---------------|
| ID          | baseline            | n/a             | none          |
| EX          | +2–3% (real) / up to +29% apparent | epoch confound | none — already ROUND_STANDARD |
| TRAD        | +60–70%             | cut product type | none — correctly bucketed |
| ICE         | +120–170%           | cut product type | none — correctly bucketed |
| ELONGCUSH   | +100–120%           | spec + cut type | none — correctly bucketed |
| OLDMINE     | unknown (n=1)       | n/a             | keep segregated |
| OLDEUR      | unknown (n=1)       | n/a             | keep segregated |

There are no unexplained higher-priced clusters within any cut style that survive
the epoch and carat controls. The H-segment cluster removal already catches the
unexplained within-spec bimodal splits independent of cut label. No new removal
rule is needed based on this analysis.
