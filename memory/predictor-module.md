---
name: predictor-module
description: WhiteProd vNext predictor module location and API
metadata:
  type: reference
---

`research/scripts/predict-white-prod-vnext.mjs` — the shared JS production predictor.

API:
- `loadWhiteProdVNext(overrides?)` → ctx (load all model artifacts)
- `predictWhiteProdVNext(row, ctx)` → { price, pricePerCarat, modelVersion, selectedExpert, supportTier, confidenceBand, fallbackReason, diagnostics }
- `predictWhiteProdVNextBatch(rows, ctx)` → array of results

See [[white-prod-vnext]] for full status.
