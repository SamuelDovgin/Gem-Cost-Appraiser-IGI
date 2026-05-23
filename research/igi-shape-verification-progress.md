# IGI shape verification progress (supplier rounds)

_Last generated: **2026-05-23 15:46 UTC** via `python3 research/scripts/generate-igi-progress-doc.py`_

Tracks which **IGI report numbers** from Starsgem / Messi stock lists have been
looked up on `pdf.igi.org`, so we can **resume without re-hitting** stones already
checked. Use the **slow verifier** (see [How to resume](#how-to-resume-safely)) —
not parallel bulk fetch (caused HTTP **429** in May 2026).

## Rules (do not skip)

1. **PDF slug order:** For bare numeric report numbers (supplier sheets), try
   **`FDR{digits}`** first, then `FRD`, `ID`, bare digits, `LG` — see
   `igi_shape_cache.build_igi_pdf_candidates()`.
2. **Example:** `797668056` → `https://pdf.igi.org/FDR797668056.pdf` →
   *Round Modified Brilliant* (Portuguese), not plain `797668056.pdf`.
3. **Portuguese label:** Only when IGI says **Round Modified Brilliant** (or
   Portuguese in text). Round Brilliant stays `round`.
4. **Rate limit:** ~1.0–1.5 s between reports; stop on 429; retry later with
   `igi-verify-slow.py --status rate_limited`.

## Summary

| Scope | Round reports | In cache | ok | not_found | rate_limited | not_started |
|-------|---------------|----------|-----|-----------|--------------|-------------|
| Starsgem (ROUND rows) | 10107 | 10107 | 6425 | 3682 | 0 | 0 |
| Messi (ROUND / RD rows) | 7083 | 2500 | 1301 | 1199 | 0 | 4583 |
| **Combined unique** | 14690 | 10107 | 6425 | 3682 | 0 | 4583 |

**Portuguese confirmed (IGI):** 1 — `797668056`

Machine-readable cache: `research/data/igi-shape-cache.json`

## Status meanings

| Status | Meaning | Resume? |
|--------|---------|---------|
| `not_started` | Never fetched | Yes — default queue |
| `ok` | PDF found; shape parsed | No — done |
| `not_found_final` | All slug candidates tried, no PDF | Only with `--force` |
| `not_found_maybe_retry` | Failed before FDR fix or mid-429 run | Yes — `--status not_found` |
| `rate_limited` | HTTP 429 on last attempt | Yes after cooldown (~30+ min) |

## How to resume safely

```bash
# From project root — polite pace (recommended)
python3 research/scripts/igi-verify-slow.py --limit 80 --delay 1.2

# Messi rounds not in cache yet (~4.5k)
python3 research/scripts/igi-verify-slow.py --supplier messi --limit 100 --delay 1.2

# Retry 429 failures only
python3 research/scripts/igi-verify-slow.py --status rate_limited --limit 50 --delay 2.0

# Regenerate this document
python3 research/scripts/generate-igi-progress-doc.py
```

After a batch, apply labels and rebuild comps:

```bash
python3 research/scripts/apply-igi-shape-labels.py
python3 research/scripts/analyze-starsgem.py
python3 research/scripts/analyze-messi-gems.py
```

## Portuguese / Round Modified (confirmed)

| Report | PDF slug | IGI shape | Notes |
|--------|----------|-----------|-------|
| `797668056` | `FDR797668056` | ROUND MODIFIED BRILLIANT |  |

## Queue: not started

Count: **4583** (showing first 80)

| Report | Supplier | Status | IGI shape | PDF slug | PT? | Checked |
|--------|----------|--------|-----------|----------|-----|---------|
| `502142785` | messi | not_started | — | — | — |
| `534265937` | messi | not_started | — | — | — |
| `549205252` | messi | not_started | — | — | — |
| `567375367` | messi | not_started | — | — | — |
| `569393925` | messi | not_started | — | — | — |
| `570348270` | messi | not_started | — | — | — |
| `570348272` | messi | not_started | — | — | — |
| `570351969` | messi | not_started | — | — | — |
| `571303697` | messi | not_started | — | — | — |
| `575312189` | messi | not_started | — | — | — |
| `575312254` | messi | not_started | — | — | — |
| `575390874` | messi | not_started | — | — | — |
| `576331783` | messi | not_started | — | — | — |
| `577364447` | messi | not_started | — | — | — |
| `581319469` | messi | not_started | — | — | — |
| `583342488` | messi | not_started | — | — | — |
| `583342497` | messi | not_started | — | — | — |
| `583342500` | messi | not_started | — | — | — |
| `583342503` | messi | not_started | — | — | — |
| `583342505` | messi | not_started | — | — | — |
| `583342506` | messi | not_started | — | — | — |
| `583342512` | messi | not_started | — | — | — |
| `583342517` | messi | not_started | — | — | — |
| `583342518` | messi | not_started | — | — | — |
| `583342523` | messi | not_started | — | — | — |
| `583342528` | messi | not_started | — | — | — |
| `583342536` | messi | not_started | — | — | — |
| `583342541` | messi | not_started | — | — | — |
| `583342546` | messi | not_started | — | — | — |
| `583342548` | messi | not_started | — | — | — |
| `583342555` | messi | not_started | — | — | — |
| `583342556` | messi | not_started | — | — | — |
| `583342558` | messi | not_started | — | — | — |
| `583342559` | messi | not_started | — | — | — |
| `583342565` | messi | not_started | — | — | — |
| `583342566` | messi | not_started | — | — | — |
| `583342570` | messi | not_started | — | — | — |
| `583342649` | messi | not_started | — | — | — |
| `583342652` | messi | not_started | — | — | — |
| `583342654` | messi | not_started | — | — | — |
| `585301474` | messi | not_started | — | — | — |
| `585301475` | messi | not_started | — | — | — |
| `585301480` | messi | not_started | — | — | — |
| `585301482` | messi | not_started | — | — | — |
| `586367313` | messi | not_started | — | — | — |
| `586367355` | messi | not_started | — | — | — |
| `586367360` | messi | not_started | — | — | — |
| `586367369` | messi | not_started | — | — | — |
| `586367419` | messi | not_started | — | — | — |
| `587306402` | messi | not_started | — | — | — |
| `587306404` | messi | not_started | — | — | — |
| `587306431` | messi | not_started | — | — | — |
| `587306465` | messi | not_started | — | — | — |
| `587306472` | messi | not_started | — | — | — |
| `587306491` | messi | not_started | — | — | — |
| `587306493` | messi | not_started | — | — | — |
| `587306523` | messi | not_started | — | — | — |
| `587306531` | messi | not_started | — | — | — |
| `587326798` | messi | not_started | — | — | — |
| `587326818` | messi | not_started | — | — | — |
| `587326823` | messi | not_started | — | — | — |
| `587326840` | messi | not_started | — | — | — |
| `587326991` | messi | not_started | — | — | — |
| `587387487` | messi | not_started | — | — | — |
| `587387502` | messi | not_started | — | — | — |
| `587387519` | messi | not_started | — | — | — |
| `587387542` | messi | not_started | — | — | — |
| `587387564` | messi | not_started | — | — | — |
| `587387569` | messi | not_started | — | — | — |
| `587387584` | messi | not_started | — | — | — |
| `588334537` | messi | not_started | — | — | — |
| `588356803` | messi | not_started | — | — | — |
| `589378241` | messi | not_started | — | — | — |
| `589378246` | messi | not_started | — | — | — |
| `589378248` | messi | not_started | — | — | — |
| `589398957` | messi | not_started | — | — | — |
| `589399023` | messi | not_started | — | — | — |
| `589399025` | messi | not_started | — | — | — |
| `591308780` | messi | not_started | — | — | — |
| `591309001` | messi | not_started | — | — | — |
| … | | | | | | _4503 more — see cache JSON_ |

## Queue: rate_limited (retry after cooldown)

Count: **0**

_Empty._

## Queue: not_found (incomplete / retry)

Count: **200** (showing first 80)

| Report | Supplier | Status | IGI shape | PDF slug | PT? | Checked |
|--------|----------|--------|-----------|----------|-----|---------|
| `644407540` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `657460792` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `657460813` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `657460828` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `657460903` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `657460904` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `657460948` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `657461011` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `669422504` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `669422522` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `669422531` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `669422537` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `669422541` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `680564004` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `680564005` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `680564007` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `680564014` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `680564019` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `710542532` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `710556299` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `710556301` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `710556305` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `710556306` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `713542749` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `713544051` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `713545807` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `713558646` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `713567397` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `713571261` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `713571288` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `713571349` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `715502945` | starsgem/messi | not_found_maybe_retry | — | `—` | — | — |
| `715532883` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `715554005` | starsgem/messi | not_found_maybe_retry | — | `—` | — | — |
| `715587399` | starsgem/messi | not_found_maybe_retry | — | `—` | — | — |
| `716502220` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `717507386` | starsgem/messi | not_found_maybe_retry | — | `—` | — | — |
| `717541303` | starsgem/messi | not_found_maybe_retry | — | `—` | — | — |
| `717554083` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `717554634` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `717559076` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `717565214` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `717565246` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `717568281` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `717568286` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `720508759` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `720516569` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `720516571` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `726539987` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `726560705` | starsgem/messi | not_found_maybe_retry | — | `—` | — | — |
| `727531345` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `728552921` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `728559658` | starsgem/messi | not_found_maybe_retry | — | `—` | — | — |
| `728571085` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `728573056` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `728583355` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `728583361` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `735511675` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `735513746` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `735514416` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `735515922` | starsgem/messi | not_found_maybe_retry | — | `—` | — | — |
| `735523588` | starsgem/messi | not_found_maybe_retry | — | `—` | — | — |
| `735524597` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `735524599` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `735524676` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `735524686` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `735524696` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `735528955` | starsgem/messi | not_found_maybe_retry | — | `—` | — | — |
| `735533378` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `735533494` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `735539824` | starsgem/messi | not_found_maybe_retry | — | `—` | — | — |
| `735539972` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `735539992` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `735540010` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `735542657` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `735542660` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `735542674` | starsgem | not_found_maybe_retry | — | `—` | — | — |
| `735542675` | starsgem/messi | not_found_maybe_retry | — | `—` | — | — |
| `735545899` | starsgem/messi | not_found_maybe_retry | — | `—` | — | — |
| `735568077` | starsgem/messi | not_found_maybe_retry | — | `—` | — | — |
| … | | | | | | _120 more — see cache JSON_ |

## Completed: not_found (all slugs tried)

Count: **0**

_Empty._

## History / lessons (May 2026)

- First pass used **digits-only** URLs → most 404s.
- Second pass added **FDR** → ~7.4k OK for Starsgem.
- Parallel workers (~8–16) triggered **429**; many false `not_found`.
- Aborted jobs: bulk `verify-portuguese-igi.py`, `retry-igi-not-found.py`,
  sequential expensive-round scan.
- Confirmed: **LG797668056** / `FDR797668056` = Round Modified (Portuguese).
