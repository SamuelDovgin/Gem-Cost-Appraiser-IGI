# Alibaba Capture Intake Guide For Future LLM Agents

Created: 2026-05-21  
Raw capture folder: `data/`  
Promoted comp document: `alibaba-clean-source-of-truth.md`  
Machine-readable comp index: `data/alibaba-comps-index.json` (regenerate after promoting new rows)  
Confidence gap document: `alibaba-listing-confidence-gaps.md`  
Human maintenance guide: `alibaba-source-of-truth-maintenance.md`

## Mission

When new Alibaba capture JSON arrives, preserve the raw file, promote only defensible SKU-level rows into the clean source of truth, and update the confidence gaps so the next capture session knows what is still weak.

Do not silently overwrite older comps. The research corpus is append-first. If a new capture disagrees with prior rows, keep both and explain the conflict, supplier spread, promo timing, or data-quality issue.

## Intake Order

1. Run `git status --short` first and avoid disturbing unrelated user changes.
2. Identify new or changed files under `research/data/`.
3. Inspect the JSON shape before summarizing it. Most capture files are arrays of product/SKU snapshots.
4. Extract row-level prices and selected options with `jq`.
5. Decide which rows are clean exact comps, broad guardrails, suspicious/excluded, or too incomplete.
6. Add promoted raw filenames to the `Source files:` line in `alibaba-clean-source-of-truth.md`.
7. Retain the source page URL for every promoted product. Strip obvious tracking parameters when easy, but keep the captured URL if cleanup is uncertain.
8. Append new evidence sections or rows to `alibaba-clean-source-of-truth.md`.
9. Update `alibaba-listing-confidence-gaps.md` only after deciding how the new evidence changes coverage.

## JSON Fields To Read

Use these fields in this order of authority:

| Purpose | Preferred Field | Fallbacks / Notes |
|---|---|---|
| Product identity | `productId` | Use with canonical `url` when available. |
| Capture timing | `capturedAt` | Useful for promo-price timing and duplicate rows. |
| Listing title | `title` or `sourceContext.metaTitle` | Title is supporting evidence, not row authority. |
| Selected SKU options | `selectedOptions` | Usually the best source for selected carat/color/clarity when `priceRows` has one generic row. |
| Row prices | `priceRows[]` | Use only rows with a numeric `priceValue`. |
| Page attributes | `sourceContext.keyAttributes[]` | Confirms shape, color, certificate, lab-grown status, supplier, and model. |
| Normalized extraction | `normalized.*` | Good quick summary, but verify against selected options and row labels. |
| Available selector choices | `availableOptions` | Helps detect whether a capture is a full ladder or only one selected SKU. |
| Broad page range | `priceRange` | Guardrail only; never promote as an exact row by itself. |
| Lab/cert flags | `flags.igiMentioned`, `flags.labDiamondMentioned` | Supporting evidence, not enough alone. |

## Useful `jq` Probes

Count capture snapshots:

```sh
jq 'length' research/data/<file>.json
```

List products, selected options, and row counts:

```sh
jq -r '.[] | [.productId, .capturedAt, (.title // .sourceContext.metaTitle // ""), (.selectedOptions | tostring), (.priceRows | length)] | @tsv' research/data/<file>.json
```

Show only snapshots with numeric price rows:

```sh
jq -r '.[] | select((.priceRows // [] | map(.priceValue // empty) | length) > 0) | [.productId, (.normalized.shape.value // ""), (.normalized.color.value // ""), (.normalized.clarity.value // ""), (.selectedOptions | tostring), (.priceRows[] | select(.priceValue != null) | "\(.carat // "")=\(.price)")] | @tsv' research/data/<file>.json
```

Check page-level attributes:

```sh
jq '.[] | {productId, title, selectedOptions, normalized, keyAttributes: [.sourceContext.keyAttributes[]? | select(.name | test("Shape|Color|Clarity|Certificate|Diamond Type|Brand Name|Model Number"))]}' research/data/<file>.json
```

## Field Precedence Rules

Use row-level SKU text over page-level attributes when they conflict. Alibaba pages can reuse one global `Diamond Shape` or `White Diamond Color` across mixed rows.

For a single selected SKU with `priceRows[0].carat` equal to a generic value such as `Excellent`, use `selectedOptions` for carat/color/clarity if the selected option is explicit.

Use `normalized` as a fast map, not as unquestioned truth. If `normalized.certificate.type` and page attributes disagree, document the disagreement and lower confidence.

Do not infer a specific grade from a range. `DEF` stays `DEF`; `DE White` stays `DE` unless the row itself says D or E. `VVS` stays `VVS` unless the row or option says VVS1/VVS2.

Do not treat `Diamond Cut` as shape unless the values are shape names. Do not treat it as cut grade unless it says a real grade such as Excellent, Ideal, 2EX, or 3EX.

## Acceptance Checklist

Promote to `Clean Exact Comps` only when the row has:

- a numeric `priceRows[].priceValue`
- row-level or selected-option carat, carat band, or millimeter size
- row-level or selected-option shape/cut style
- row-level or selected-option color or color range
- row-level or selected-option clarity or clarity range
- lab-grown status from title, flags, normalized fields, or key attributes
- certificate evidence when the comp is labeled IGI/GIA
- no obvious same-price anomaly across incompatible SKUs
- no mounted/ring context unless the loose stone price is clearly isolated

If any core field is missing but the row is still informative, keep it in `Clean But Broad Or Specialty` or `Excluded Or Suspicious`, not in clean exact comps.

## Confidence Assignment

Use the confidence label in the promoted section and mirror the aggregate impact in the gap file.

High:
Exact SKU row, numeric price, complete selected/row labels, and matching page attributes for shape/color/lab/cert.

Medium-high:
Exact SKU row and numeric price, but page attributes are broad, a certificate field is messy, the row is a color/carat band, or the product family has mild conflicts.

Medium:
Usable row-level price with a broad range such as DEF/DE/VVS, size bands, specialty cuts, or incomplete certificate evidence.

Low / provisional:
Page range only, missing core row fields, mixed product family, mounted listing, supplier quote without SKU tie, or repeated prices across incompatible rows.

## Updating `alibaba-clean-source-of-truth.md`

For each promoted product or product group, add:

- heading with shape, color/range, certificate, and supplier when useful
- product ID or product IDs
- canonical Alibaba URL without tracking parameters when practical; if only a tracked capture URL is available, keep that URL so the page remains traceable
- source JSON filename
- supplier name if reliable
- evidence summary naming the fields used
- intended use, such as primary ladder, corroboration, guardrail, or anomaly
- confidence statement
- table preserving the underlying rows, not just averages

If rows are related but differ in confidence, keep confidence at row level inside the table.

Never omit source URLs from clean promoted comps when a URL exists in the raw capture. URLs are provenance, not decoration; future verification depends on being able to reopen the original Alibaba product page.

## Updating `alibaba-listing-confidence-gaps.md`

Also update the **Cut And Style Data Tier List** when a shape moves between S/A/B/C/D tiers. Two or more independent clean products usually move a cut up one tier; a full ladder with corroboration can move white shapes to **S**.

Update this file when new evidence does at least one of these:

- closes or improves a named gap
- lowers confidence because a new conflict or anomaly appears
- adds a new shape/color/clarity area not represented before
- shows a recurring data-quality problem, such as missing price rows
- changes what the next capture targets should be

Do not raise an area to High from one product alone unless it is a complete ladder and there is already independent corroboration. Two or more independent clean products can usually move a gap up one level.

When a gap improves:

1. Update `Current Coverage Snapshot`.
2. Update `Shape-Specific Gaps` or `Color-Specific Gaps` if applicable.
3. Remove or rewrite stale capture targets.
4. Add a dated row under `Closed Or Improving Gaps`.
5. If a new problem appears, add it under `Data Quality Gaps` instead of hiding it.

## Reject Or Quarantine Rows When

- `priceRows` is empty or all `priceValue` fields are missing
- the only price is `priceRange.text`
- a ring/mounted listing does not isolate loose-stone price
- one flat price repeats across incompatible carats, colors, clarities, or shapes
- row labels are generic and selected options do not identify the SKU
- certificate evidence is contradicted by page attributes
- product title and rows describe different product families without row-level clarity

Quarantined rows still matter. Add them to `Clean But Broad Or Specialty`, `Excluded Or Suspicious`, or `Data Quality Gaps` with a short reason.

## Bot Matching Workflow (stone search → Alibaba link)

When a user or bot searches for a stone spec, use this order:

1. **Exact match** in `data/alibaba-comps-index.json`: same `colorFamily`, normalized shape, color (or fancy intensity bucket), clarity, and carat within ±0.08ct (≤2ct) or ±0.18ct (≤6ct). Return `url`, `priceUsd`, `productId`, `confidence`, `matchType: "exact"`.
2. **Nearest comp** if no exact row: same shape + color family, minimize weighted distance on carat, clarity rank, and color grade. Return best row with `matchType: "nearest"` and list which fields differ.
3. **Adjusted estimate** when nearest differs: multiply comp `priceUsd` by modifiers from `index.html` (documented in the index `modifierDocs` field): white uses `whiteGradeMult`, carat-aware `clarityBreakpoints`, and `shapeMult` vs round; fancy uses `shapeMultColor` and `fancyColorBase` intensity curves. Never apply shape/clarity modifiers across different fancy intensities without an intensity step from `fancy-color-diamond-pricing.md`.
4. **No comp** for D-tier gaps (fancy round, orange, purple, G/H/I/J white): return `matchType: "none"` and point to `alibaba-listing-confidence-gaps.md` capture targets.

Regenerate the index after promoting rows:

```sh
python3 research/scripts/regenerate-comps-index.py
```

If that script is missing, re-run the table extraction used on 2026-05-21 or ask the agent to rebuild from `alibaba-clean-source-of-truth.md`.

## Output Standard

A good intake update should let a future agent answer:

- Which raw file did this come from?
- Which product IDs and suppliers were promoted?
- What exact SKU rows support the update?
- What confidence changed, and why?
- What still needs capture next?

If that chain is not clear, the row is not ready to anchor model logic.
