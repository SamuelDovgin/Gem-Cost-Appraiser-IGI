# IGI full enrichment progress

_Updated: **2026-05-24 16:32 UTC** — `python3 research/scripts/igi-enrich-all.py`_

Machine store: `research/data/igi-report-enrichment.json`

Each **complete** OK entry includes: shape (raw + mapped), measurements, L/W,
4Cs, cut/polish/symmetry, fluorescence, table/depth %, girdle/culet, inscription,
report date, Type IIa, growth method, treatment, comments.

## Summary

| Scope | Reports | not_started | ok | complete | not_found | rate_limited |
|-------|---------|-------------|-----|----------|-----------|--------------|
| Starsgem | 22541 | 0 | 22531 | 22531 | 10 | 0 |
| Messi | 18090 | 0 | 18065 | 18065 | 25 | 0 |
| **Total** | 34457 | 0 | 34431 | 34431 | 26 | 0 |

**Portuguese on cert:** 2
- `780651720` — Round Modified Brilliant
- `797668056` — Round Modified Brilliant

## Top IGI shapeMapped (ok PDFs)

### All
- `round`: 14672
- `oval`: 5498
- `pear`: 3429
- `emerald`: 2571
- `princess`: 1798
- `marquise`: 1513
- `radiant`: 1378
- `heart`: 1213
- `square_cushion`: 889
- `asscher`: 795
- `cushion`: 190
- `cushion_brilliant`: 46
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
