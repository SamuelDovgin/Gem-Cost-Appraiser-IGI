# IGI full enrichment progress

_Updated: **2026-05-24 04:01 UTC** — `python3 research/scripts/igi-enrich-all.py`_

Machine store: `research/data/igi-report-enrichment.json`

Each **complete** OK entry includes: shape (raw + mapped), measurements, L/W,
4Cs, cut/polish/symmetry, fluorescence, table/depth %, girdle/culet, inscription,
report date, Type IIa, growth method, treatment, comments.

## Summary

| Scope | Reports | not_started | ok | complete | not_found | rate_limited |
|-------|---------|-------------|-----|----------|-----------|--------------|
| Starsgem | 22541 | 711 | 18135 | 18096 | 3685 | 10 |
| Messi | 18090 | 539 | 16334 | 16310 | 1217 | 0 |
| **Total** | 34457 | 1149 | 29597 | 29552 | 3701 | 10 |

**Portuguese on cert:** 2
- `780651720` — Round Modified Brilliant
- `797668056` — Round Modified Brilliant

## Top IGI shapeMapped (ok PDFs)

### All
- `round`: 10734
- `oval`: 5297
- `pear`: 3227
- `emerald`: 2451
- `princess`: 1745
- `marquise`: 1407
- `radiant`: 1327
- `heart`: 1135
- `square_cushion`: 863
- `asscher`: 762
- `cushion`: 171
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
