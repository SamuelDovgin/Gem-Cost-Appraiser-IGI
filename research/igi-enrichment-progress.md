# IGI full enrichment progress

_Updated: **2026-05-28 04:33 UTC** — `python3 research/scripts/igi-enrich-all.py`_

Machine store: `research/data/igi-report-enrichment.json`

Each **complete** OK entry includes: shape (raw + mapped), measurements, L/W,
4Cs, cut/polish/symmetry, fluorescence, table/depth %, girdle/culet, inscription,
report date, Type IIa, growth method, treatment, comments.

## Summary

| Scope | Reports | not_started | ok | complete | not_found | rate_limited |
|-------|---------|-------------|-----|----------|-----------|--------------|
| Starsgem | 22541 | 0 | 22531 | 22531 | 10 | 0 |
| Starsgem color | 5 | 0 | 5 | 5 | 0 | 0 |
| Messi | 18090 | 0 | 18065 | 18065 | 25 | 0 |
| Messi color | 1188 | 0 | 1185 | 1185 | 3 | 0 |
| **Total** | 35650 | 0 | 35621 | 35621 | 29 | 0 |

**Portuguese on cert:** 2
- `780651720` — Round Modified Brilliant
- `797668056` — Round Modified Brilliant

## Top IGI shapeMapped (ok PDFs)

### All
- `round`: 14708
- `oval`: 5665
- `pear`: 3661
- `emerald`: 2630
- `princess`: 1821
- `radiant`: 1611
- `marquise`: 1541
- `heart`: 1325
- `square_cushion`: 1079
- `asscher`: 824
- `flower`: 422
- `cushion`: 237
- `cushion_brilliant`: 51
- `sq_radiant`: 31
- `trilliant`: 7

## Commands

```bash
python3 research/scripts/igi-enrich-all.py --run-all --limit 200 --delay 0.35 --workers 4
# --limit = batch size per loop (not total). --run-all loops until done. --limit 0 = no cap.
python3 research/scripts/igi-enrich-all.py --apply-only
```

Speed: **FDR-first** (3 slug tries max), **4 workers** with ~0.35s stagger.
Stop if 5× 429 in a row; resume later. Use `--full-retry` for bare-digit slugs on not_found.
