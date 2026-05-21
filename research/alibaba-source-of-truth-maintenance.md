# Alibaba Source Of Truth Maintenance Guide

Created: 2026-05-21  
Primary document: `alibaba-clean-source-of-truth.md`  
Gap document: `alibaba-listing-confidence-gaps.md`  
Raw capture folder: `data/`

## Core Rule

The source of truth is append-first. Do not remove old rows just because a newer capture disagrees. If a row is later proven wrong, add a correction note or move it into `Excluded Or Suspicious` with the reason. This preserves the audit trail and prevents silent data drift.

## Raw Data Intake

1. Save every capture JSON in `data/`.
2. Keep the original filename when possible.
3. Add the filename to the `Source files` line in `alibaba-clean-source-of-truth.md` when rows from that file are promoted.
4. Preserve the Alibaba source URL for every promoted product. Prefer a canonical product-detail URL without `spm`, `priceId`, or other tracking parameters, but keep the captured URL if canonical cleanup is uncertain.
5. Update `alibaba-listing-confidence-gaps.md` when the new rows close a gap, expose a new gap, or reveal an anomaly. Update the **Cut And Style Data Tier List** when coverage meaningfully changes.
6. Do not edit raw capture JSON by hand. If a manual value was needed, recapture or document the manual override in the source-of-truth note.

## Promotion Checklist

Only add rows to `Clean Exact Comps` when the capture has:

- exact SKU row price, not just page range
- row-level shape or cutting style
- row-level color or color range
- row-level clarity or clarity range
- row-level carat, carat band, or millimeter size
- lab-grown status when relevant
- certificate type when IGI/GIA is claimed
- no obvious repeated-price anomaly across materially different rows

Use row-level SKU labels over page-level attributes when they conflict. Alibaba pages often show a single global `Diamond Shape` even when the SKU table contains multiple shapes.

## Confidence Levels

High:
Exact SKU row plus matching key attributes or page source. Example: D round IGI ladder with `Diamond Shape = Round Brilliant Cut`.

Medium-high:
Exact SKU row with complete row label, but page-level attributes are broad or partly conflicting. Example: mixed-shape pink listing where each row says Cushion/Princess/Heart/Pear/etc.

Medium:
Exact price row, but the row uses a size band, color range, or specialty/nonstandard cut. Example: DEF marquise millimeter sizes.

Low or provisional:
Page range only, missing shape/color/clarity/carat, mixed product family, mounted jewelry, or supplier quote not tied to a specific SKU.

## Anomaly Rules

Same price across multiple incompatible carats:
Do not promote as exact. Put it in `Excluded Or Suspicious` or `Clean But Broad Or Specialty` as a broad page quote.

Very low price anomaly:
Keep it, but make the band wide and label it as low/anomalous. Do not discard it automatically, because unusual low asks may be real deals. Use it as a floor/lead, not as the main model anchor, until verified by certificate, video, and supplier quote.

Very high price anomaly:
Keep only if the row has a reason, such as rare intensity, specialty cut, high carat, IF/VVS1, exceptional ratio, or branded/service context. Otherwise mark it broad or suspicious.

Global page attribute conflicts with SKU rows:
Use the SKU row for the promoted comp and mention the conflict in the note.

Mounted jewelry or ring listings:
Do not use as loose-stone exact comps unless the SKU row and page context clearly isolate the loose stone.

## Adding A New Section

For each promoted product, include:

- product ID
- canonical URL without tracking parameters when available; if only a tracked URL exists, retain it rather than omitting the page link
- source raw filename
- supplier if reliable
- evidence summary
- intended use
- confidence statement
- table with row-level shape, color, carat, clarity, cut grade if present, price, and $/ct for fancy-color stones

## What Not To Do

- Do not overwrite previous clean rows with newer promotional prices.
- Do not collapse different shapes into one average without keeping the underlying rows.
- Do not treat Alibaba's `Diamond Cut` option as cut grade unless the value is actually Excellent, Ideal, 2EX, 3EX, etc.
- Do not infer a specific color grade from `DEF` unless the row says D, E, or F.
- Do not infer a certificate number applies to every SKU unless the row or supplier explicitly ties it to that SKU.
- Do not drop product URLs from promoted comps. A comp without a way back to the source page is weaker evidence even if the raw JSON still exists.
