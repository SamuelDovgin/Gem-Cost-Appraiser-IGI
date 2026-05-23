# IGI full enrichment progress

_Updated: **2026-05-23 22:24 UTC** — `python3 research/scripts/igi-enrich-all.py`_

Machine store: `research/data/igi-report-enrichment.json`

Each **complete** OK entry includes: shape (raw + mapped), measurements, L/W,
4Cs, cut/polish/symmetry, fluorescence, table/depth %, girdle/culet, inscription,
report date, Type IIa, growth method, treatment, comments.

## Summary

| Scope | Reports | not_started | ok | complete | not_found | rate_limited |
|-------|---------|-------------|-----|----------|-----------|--------------|
| Starsgem | 22541 | 8906 | 9952 | 9799 | 3683 | 0 |
| Messi | 18090 | 9438 | 7440 | 7392 | 1212 | 0 |
| **Total** | 34457 | 15461 | 15300 | 15117 | 3696 | 0 |

**Portuguese on cert:** 1
- `797668056` — Round Modified Brilliant

## Top IGI shapeMapped (ok PDFs)

### All
- `round`: 7596
- `oval`: 1332
- `pear`: 1189
- `emerald`: 1181
- `princess`: 1047
- `radiant`: 738
- `heart`: 687
- `marquise`: 518
- `asscher`: 412
- `square_cushion`: 363
- `cushion`: 57
- `cushion_brilliant`: 21
- `sq_radiant`: 11
- `portuguese`: 1

## Commands

```bash
python3 research/scripts/igi-enrich-all.py --run-all --limit 200 --delay 0.35 --workers 4
# --limit = batch size per loop (not total). --run-all loops until done. --limit 0 = no cap.
python3 research/scripts/igi-enrich-all.py --apply-only
```

Speed: **FDR-first** (3 slug tries max), **4 workers** with ~0.35s stagger.
Stop if 5× 429 in a row; resume later. Use `--full-retry` for bare-digit slugs on not_found.
