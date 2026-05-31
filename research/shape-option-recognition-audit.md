# Shape Option Recognition Audit

**Status:** Active guardrail  
**Date:** 2026-05-31  
**UI source:** `index.html#shape-select`  
**Dataset source:** `research/data/dataset-clean-training.json`

---

## Purpose

Every shape/style bucket used by the master training dataset should be
recognizable by the app and reachable from the shape selector when a user wants
to price that kind of stone manually.

The app has two related but different concepts:

- selectable shape option: what a user can choose in the UI
- recognizable shape/style bucket: what IGI enrichment and ML training use

Those must stay aligned. A shape can be bucketed more specifically in training
than it appears in the UI, but it must map back to a selectable option.

---

## Current Selectable Shape Options

The app currently exposes these shape IDs:

```text
round
oval
moval
pear
marquise
heart
cushion_brilliant
cushion
elongated_cushion
square_cushion
radiant
sq_radiant
princess
emerald
asscher
baguette
tapered_baguette
carre
trilliant
half_moon
shield
hexagonal
hexagonal_dutch
old_european
old_mine
rose
briolette
flower
freeform
portuguese
flanders
```

---

## Important Fix

The master dataset builder must prefer the IGI-enriched canonical shape over the
supplier `rawShapeCode`.

Why:

- supplier `SQUARE` can mean IGI `Square Emerald Cut`, which should train as
  `ASSCHER_STANDARD`
- supplier `ASHOKA` rows in the current enriched index are IGI
  `Cushion Modified Brilliant` with elongated ratios, which should train as
  `CUSHION_ELONGATED`

Using `rawShapeCode` first creates unselectable training buckets such as:

```text
SQUARE_STANDARD
ASHOKA_MODIFIED
```

Those are not user-facing shape choices and should not become separate ML
surfaces unless IGI or another physical feature proves they are distinct.

After the fix:

```text
supplier SQUARE + IGI Square Emerald Cut -> ASSCHER_STANDARD
supplier ASHOKA + IGI elongated Cushion Modified Brilliant -> CUSHION_ELONGATED
```

The current master dataset has no `SQUARE_*` or `ASHOKA_*` training buckets.

The dataset still preserves the supplier field as `raw_shape_code` for lookup
reconstruction diagnostics. That lets S26 benchmark the historical StarGem
lookup table using the supplier key while ML training uses the canonical
IGI-backed `shape` and `shape_style`.

---

## Guardrail Check

Run:

```bash
npm run research:check-shapes
```

The check parses `index.html#shape-select`, reads the master training dataset,
and fails if any training `shape_style` cannot map back to a selectable shape
option.

This should be run after:

- adding a shape to the dropdown
- changing IGI shape parsing
- rebuilding `starsgem-index.json`
- changing `dataset-split-outliers.py`
- regenerating `dataset-clean-training.json`

---

## Rule

If a new IGI shape appears:

1. first decide whether it is truly a physical/style product or a supplier label
2. if physical, add a selectable UI option or map it to the closest existing
   selectable option with an explicit reason
3. add pricing multipliers, market notes, icon support, and comp-engine support
   where applicable
4. regenerate the master dataset
5. run `npm run research:check-shapes`

Do not let unselectable shape buckets silently enter the training set.
