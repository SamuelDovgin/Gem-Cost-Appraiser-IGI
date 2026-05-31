# ML Training Data Policy

**Status:** Active  
**Date:** 2026-05-31  

---

## Canonical Training Dataset

White-diamond ML and parametric model training must use this file exclusively:

```text
research/data/dataset-clean-training.json
```

This is the final cleaned master dataset generated from the IGI-enriched
StarGem index. It keeps physically distinct IGI style buckets, such as
`PEAR_STANDARD`, `PEAR_MODIFIED`, and `PEAR_ICE_FLOWER`, while removing only
same-style/spec high-price clusters and point outliers.

See `research/master-dataset-construction.md` for the full rulebook.

Do not train white-diamond models directly from:

```text
research/data/starsgem-index.json
research/data/STARS Diamonds Stock2026.5.20.xls
```

Those files are allowed for ingestion, diagnostics, atlas views, IGI enrichment,
manual research, and comp-index generation. Do not train directly from them:
regenerate `dataset-clean-training.json` first so style bucketing and same-spec
cluster quarantine are applied consistently.

---

## Required Model Metadata

Every white-diamond model artifact should record:

- `trainingData.source = "research/data/dataset-clean-training.json"`
- the number of rows used
- row number min/max
- holdout protocol
- any segment filters beyond Segment A
- whether large-carat or specialty-cut behavior is learned from training rows or
  only extrapolated

If a model intentionally trains on anything else, its doc must state why and must
label the result as a diagnostic or research-only artifact.

---

## What Clean Segment A Can And Cannot Learn

Clean Segment A is the right target for current white-stock price learning, but
it has known limits:

- It currently spans about `1.00ct` to `41.72ct`.
- It includes IGI-enriched large stones that row-number-only cleanup used to
  remove incorrectly.
- True just-below-threshold examples can still be thin by specific style bucket.
- Large-carat behavior is style-dependent; use `shape_style` where available.

Therefore, large-carat and unsupported magic-weight outputs should report their
style-bucket support, not only the global carat range.

---

## Current White Training Scripts

These scripts should use the canonical clean dataset:

- `research/scripts/train-s25-parametric.py`
- `research/scripts/train-s26-champion.mjs`
- `research/scripts/train-s28-monotone-parametric.py`
- `research/scripts/benchmark-all-models.mjs`

If new white-diamond model scripts are added, start from this policy. A script
that trains white-diamond ML from any other file should fail review unless it is
explicitly labeled as a diagnostic experiment.
