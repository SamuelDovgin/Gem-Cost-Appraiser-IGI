# IGI full enrichment progress

_Updated: **2026-05-24 02:02 UTC** — `python3 research/scripts/igi-enrich-all.py`_

Machine store: `research/data/igi-report-enrichment.json`

Each **complete** OK entry includes: shape (raw + mapped), measurements, L/W,
4Cs, cut/polish/symmetry, fluorescence, table/depth %, girdle/culet, inscription,
report date, Type IIa, growth method, treatment, comments.

## Summary

| Scope | Reports | not_started | ok | complete | not_found | rate_limited |
|-------|---------|-------------|-----|----------|-----------|--------------|
| Starsgem | 22541 | 2396 | 16460 | 16421 | 3685 | 0 |
| Messi | 18090 | 3462 | 13411 | 13387 | 1217 | 0 |
| **Total** | 34457 | 5149 | 25607 | 25562 | 3701 | 0 |

**Portuguese on cert:** 2
- `780651720` — Round Modified Brilliant
- `797668056` — Round Modified Brilliant

## Top IGI shapeMapped (ok PDFs)

### All
- `round`: 9311
- `oval`: 4797
- `pear`: 2372
- `emerald`: 2173
- `princess`: 1595
- `radiant`: 1198
- `marquise`: 1131
- `heart`: 999
- `square_cushion`: 792
- `asscher`: 688
- `cushion`: 134
- `cushion_brilliant`: 27
- `sq_radiant`: 11
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
