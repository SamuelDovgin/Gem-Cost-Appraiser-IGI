# IGI full enrichment progress

_Updated: **2026-05-23 20:52 UTC** — `python3 research/scripts/igi-enrich-all.py`_

Machine store: `research/data/igi-report-enrichment.json`

Each **complete** OK entry includes: shape (raw + mapped), measurements, L/W,
4Cs, cut/polish/symmetry, fluorescence, table/depth %, girdle/culet, inscription,
report date, Type IIa, growth method, treatment, comments.

## Summary

| Scope | Reports | not_started | ok | complete | not_found | rate_limited |
|-------|---------|-------------|-----|----------|-----------|--------------|
| Starsgem | 22541 | 9376 | 9482 | 9354 | 3683 | 0 |
| Messi | 18090 | 9697 | 7181 | 7152 | 1212 | 0 |
| **Total** | 34457 | 16161 | 14600 | 14461 | 3696 | 0 |

**Portuguese on cert:** 1
- `797668056` — Round Modified Brilliant

## Top IGI shapeMapped (ok PDFs)

### All
- `round`: 7492
- `oval`: 1124
- `pear`: 1119
- `emerald`: 1096
- `princess`: 993
- `radiant`: 724
- `heart`: 669
- `marquise`: 460
- `asscher`: 381
- `square_cushion`: 354
- `cushion`: 52
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
