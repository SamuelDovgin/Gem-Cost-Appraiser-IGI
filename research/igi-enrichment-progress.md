# IGI full enrichment progress

_Updated: **2026-05-24 04:01 UTC** — `python3 research/scripts/igi-enrich-all.py`_

Machine store: `research/data/igi-report-enrichment.json`

Each **complete** OK entry includes: shape (raw + mapped), measurements, L/W,
4Cs, cut/polish/symmetry, fluorescence, table/depth %, girdle/culet, inscription,
report date, Type IIa, growth method, treatment, comments.

## Summary

| Scope | Reports | not_started | ok | complete | not_found | rate_limited |
|-------|---------|-------------|-----|----------|-----------|--------------|
| Starsgem | 22541 | 690 | 18166 | 18127 | 3685 | 0 |
| Messi | 18090 | 511 | 16362 | 16338 | 1217 | 0 |
| **Total** | 34457 | 1104 | 29652 | 29607 | 3701 | 0 |

**Portuguese on cert:** 2
- `780651720` — Round Modified Brilliant
- `797668056` — Round Modified Brilliant

## Top IGI shapeMapped (ok PDFs)

### All
- `round`: 10749
- `oval`: 5302
- `pear`: 3239
- `emerald`: 2462
- `princess`: 1747
- `marquise`: 1413
- `radiant`: 1328
- `heart`: 1135
- `square_cushion`: 863
- `asscher`: 762
- `cushion`: 172
- `cushion_brilliant`: 44
- `sq_radiant`: 12
- `trilliant`: 3
- `portuguese`: 2

## Commands

```bash
python3 research/scripts/igi-enrich-all.py --run-all --limit 200 --delay 0.35 --workers 4
# --limit = batch size per loop (not total). --run-all loops until done. --limit 0 = no cap.
python3 research/scripts/igi-enrich-all.py --apply-only
```

Speed: **FDR-first** (3 slug tries max), **4 workers** with ~0.35s stagger.
Stop if 5× 429 in a row; resume later. Use `--full-retry` for bare-digit slugs on not_found.
