# P1b — Add Better Source Independence Signals

**Research date:** 2026-05-22  
**Status:** Deep research / implementation plan (no code changes in this pass)  
**Related:** `alibaba-listing-confidence-gaps.md`, `alibaba-clean-source-of-truth.md`, `messi-gems-source-of-truth.md`, `comp-engine-v3-gap-fixes-implementation.md` Fix 1, `estimation-algo-improvement-priorities.md` P1, `regenerate-comps-index.py`

---

## Executive Summary

Comp engine v3 already limits **selection diversity** (`MAX_PER_SUPPLIER = 2`) and **blend-weight concentration** (`MAX_SUPPLIER_WEIGHT_FRAC = 0.65` with corrected final-weight math). When **all** accepted comps share one supplier, the engine flags `capPossible: false` but cannot invent independent market evidence.

What is still missing is **source-quality semantics** at the row level:

| Concept | Today | Needed |
|---------|-------|--------|
| Supplier count | Implicit in `sourceConcentration` | Explicit in result metadata |
| Product count | Not reported | Distinct `productId` in support set |
| Source-group count | Not defined | Ladder / page / SKU group deduping |
| Row/sample count | Partial (`localCaratCurve.rowCount`) | Per-estimate observation weight |
| SKU vs band vs MOQ | `caratBand`, `clarityBand` flags only | Trust tier + σ penalty |
| Product ladder independence | `compIdentity` by `productId` | Down-weight same-ladder rows |
| Stale capture | Not modeled | `capturedAt` / index version |

**Proposed direction:** Enrich index generation → propagate `sourceQuality` into scoring/blending → expose transparent penalties (widen σ or range) rather than silent hard drops, except for clearly invalid rows.

---

## Table of Contents

1. [Current source handling](#1-current-source-handling)
2. [Why independence matters for pricing trust](#2-why-independence-matters-for-pricing-trust)
3. [Taxonomy of comp row types](#3-taxonomy-of-comp-row-types)
4. [Index schema proposals](#4-index-schema-proposals)
5. [Engine scoring and blend proposals](#5-engine-scoring-and-blend-proposals)
6. [Result metadata contract](#6-result-metadata-contract)
7. [Single-source and weak-source penalties](#7-single-source-and-weak-source-penalties)
8. [Interaction with P1 carat and fancy work](#8-interaction-with-p1-carat-and-fancy-work)
9. [Testing plan](#9-testing-plan)
10. [Why this will work](#10-why-this-will-work)
11. [Risks](#11-risks)
12. [Implementation phases](#12-implementation-phases)

---

## 1. Current source handling

### 1.1 Supplier key (runtime inference)

```javascript
// research/comp-engine-v3.js — supplierKey (lines 158–171)
function supplierKey(row) {
  const section = row.section || '';
  const lastHyphen = section.lastIndexOf(' - ');
  const lastEm     = section.lastIndexOf(' — ');
  const lastDash   = Math.max(lastHyphen, lastEm);
  const raw = lastDash >= 0 ? section.slice(lastDash + 3).trim() : section.split(',')[0].trim();
  const norm = raw.replace(/\s*\([^)]+\)\s*$/, '').trim().toLowerCase();
  if (norm.includes('messi') || norm.includes('wuzhou')) return 'messi';
  if (norm.includes('starsgem') || norm.includes('stargem')) return 'starsgem';
  if (norm.includes('mishang')) return 'mishang';
  if (norm.includes('goldleaf')) return 'goldleaf';
  return norm || '_unknown';
}
```

**Problems:**

- Parsed from free-text `section` on every scoring call.
- Messi / Starsgem aliasing is hand-coded.
- Not stable across index regenerations if section titles change.

### 1.2 Selection cap

```javascript
const MAX_PER_SUPPLIER = 2;

function applySupplierCap(scored) {
  const counts = {};
  const result = [];
  for (const c of scored) {
    const sk = supplierKey(c.row);
    const n = (counts[sk] || 0) + 1;
    counts[sk] = n;
    if (n <= MAX_PER_SUPPLIER) result.push(c);
  }
  return result;
}
```

Exact-match pool bypasses cap on fallback pool only (see `resolveAlibabaComp` §3).

### 1.3 Blend cap (post gap-fix)

```javascript
// blendComps — solves cappedW / (cappedW + otherW) = MAX_SUPPLIER_WEIGHT_FRAC
const cappedW = (MAX_SUPPLIER_WEIGHT_FRAC * otherW) / (1 - MAX_SUPPLIER_WEIGHT_FRAC);
const scale = Math.min(1, cappedW / dominantW);
```

`sourceConcentration` reports `rawDominantFrac`, `finalDominantFrac`, `capApplied`, `capPossible`, `supplierFracs`.

### 1.4 Listing confidence → σ only

```javascript
function sourceErrorSigma(confidence) {
  return ({
    high: 0.03,
    'medium-high': 0.06,
    medium: 0.10,
    'low-medium': 0.18,
    low: 0.25,
  })[confidence] ?? 0.10;
}
```

Index rows include `confidence` from SoT tables (`regenerate-comps-index.py`), but **not** row-type trust (SKU vs band vs page-level).

### 1.5 Comp deduplication identity

```javascript
function compIdentity(row) {
  if (row.productId) return `pid:${row.productId}`;
  const bits = [ /* supplier, shape, color, clarity, carat, price, section */ ];
  return bits.join('|');
}
```

**Gap:** All rows from same `productId` collapse to **one** ensemble slot — good for duplicate SKUs, bad if we need **multiple carat knots from same ladder** for local slope but should not count as independent suppliers.

### 1.6 Index generation today

`regenerate-comps-index.py` emits:

```python
comps.append({
    "section": title,
    "productId": pid,
    "url": url,
    "caratBand": is_band,
    "clarityBand": clarity == "VVS-VS",
    "confidence": conf,  # high | medium-high | medium | low-medium | low | null
    # no sourceType, sourceGroup, moq, captureDate
})
```

Messi supplemental JSON (`messi-comps.json`) may include richer fields — engine should consume uniformly after normalization pass.

---

## 2. Why independence matters for pricing trust

### 2.1 Mathematical vs economic independence

Inverse-variance blending assumes observations are **conditionally independent** given the query. Supplier product ladders violate this: ten rows are one pricing policy, not ten market draws.

### 2.2 Leave-one-supplier-out backtest

`backtest-comp-engine.mjs` holds out **all rows** from supplier S, then predicts rows that may have been priced using S's ladder in the training pool. Without independence signals:

- MdAPE looks acceptable when training pool is Messi-heavy;
- Production query with only Messi comps reports **high** confidence.

### 2.3 Segments most exposed

| Segment | Risk |
|---------|------|
| Fancy pink sparse | Single product `1601561025630` six shapes |
| White 5ct+ | Few ladders; one supplier |
| Specialty moval | OM GEMS only |
| Flat-price / band rows | Same price across grades — false precision |

Documented in `alibaba-listing-confidence-gaps.md` **Data Quality Gaps** table.

---

## 3. Taxonomy of comp row types

### 3.1 Proposed `sourceRowType` enum

| Type | Description | Trust tier | Example |
|------|-------------|------------|---------|
| `sku_exact` | Single carat + clarity + price from SKU panel | **A** | Messi round D VS1 1.02ct |
| `sku_ladder` | Multiple carats, same productId, distinct prices | **A−** | 1–5ct D VS1 ladder |
| `clarity_band` | `VVS-VS` combined column | **B** | `clarityBand: true` |
| `carat_band` | `1.0-1.1ct` band row | **B** | `caratBand: true` |
| `page_range` | Page says range; weak row mapping | **C** | Title 1–5ct, one price |
| `moq_only` | MOQ pricing, not unit loose | **C** | "MOQ 2 pcs" |
| `flat_fancy` | Same price across incompatible combos | **D (exclude)** | Pink heart flat VS1/VS2 |
| `corroboration` | Secondary listing confirming primary | **A** (not independent) | Starsgem vs Messi |
| `aggregated_supplier` | Messi sheet aggregate without pid | **B** | `compIdentity` without productId |

### 3.2 Proposed `sourceGroup` key

```javascript
// PROPOSED — stable group for independence counting
function sourceGroupKey(row) {
  return [
    row.supplierKey ?? supplierKey(row),
    row.productId ?? 'nopid',
    row.sourceRowType ?? 'unknown',
  ].join(':');
}
```

**Independent market evidence** ≈ distinct `supplierKey` with at least one `sku_exact` or uncorrelated `productId`.

### 3.3 Proposed `independenceWeight` for blending

```javascript
// PROPOSED — effective sample size weight
function independenceWeight(row, sameGroupCount) {
  const tier = SOURCE_TRUST_TIER[row.sourceRowType] ?? 0.5;
  const ladderPenalty = sameGroupCount > 1 ? 1 / Math.sqrt(sameGroupCount) : 1;
  return tier * ladderPenalty;
}
```

---

## 4. Index schema proposals

### 4.1 Fields to add at generation time

```python
# regenerate-comps-index.py — PROPOSED extensions

def classify_row_type(comp):
    if comp.get("excluded"):
        return "flat_fancy"
    if comp.get("caratBand"):
        return "carat_band"
    if comp.get("clarityBand"):
        return "clarity_band"
    if comp.get("moq") and comp.get("moq") > 1:
        return "moq_only"
    if comp.get("priceUnit") == "page_range":
        return "page_range"
    # ladder detection: same pid appears in >=3 carat knots in index
    return "sku_exact"  # or sku_ladder via post-pass

def enrich_comp(comp, ladder_counts_by_pid):
    pid = comp["productId"]
    comp["supplierKey"] = normalize_supplier(comp["section"])
    comp["sourceRowType"] = classify_row_type(comp)
    comp["sourceGroup"] = f"{comp['supplierKey']}:{pid}:{comp['sourceRowType']}"
    comp["ladderRowCount"] = ladder_counts_by_pid.get(pid, 1)
    comp["capturedAt"] = comp.get("capturedAt") or INDEX_VERSION_DATE
    return comp
```

### 4.2 Normalized supplier table (JSON)

```json
// research/data/supplier-normalization.json — PROPOSED
{
  "messi": { "aliases": ["wuzhou messi gems", "messi jewelry"], "defaultTrust": 0.9 },
  "starsgem": { "aliases": ["starsgem co.,ltd"], "defaultTrust": 0.9 },
  "mishang": { "aliases": ["changlai mishang"], "defaultTrust": 0.85 }
}
```

### 4.3 Capture metadata from raw JSON

Raw captures in `research/data/*-sku-prices.json` often include:

- `captureSession`, `url`, `priceRows[]`, `selectorShape`

**Proposed ingest pass:**

```python
# scripts/enrich-comps-from-raw-captures.py — PROPOSED
for raw_row in capture["priceRows"]:
    emit = {
        **comp,
        "captureId": capture["sessionId"],
        "selectorLabel": raw_row.get("label"),
        "moq": raw_row.get("moq"),
        "priceVisibility": raw_row.get("priceVisible", True),
    }
```

---

## 5. Engine scoring and blend proposals

### 5.1 Extended `sourceErrorSigma`

```javascript
// PROPOSED
const SOURCE_ROW_TYPE_SIGMA = {
  sku_exact: 0.00,
  sku_ladder: 0.04,
  carat_band: 0.08,
  clarity_band: 0.06,
  page_range: 0.14,
  moq_only: 0.12,
  corroboration: 0.02,
  aggregated_supplier: 0.10,
};

function sourceErrorSigma(row) {
  const conf = sourceErrorSigmaFromConfidence(row.confidence);
  const type = SOURCE_ROW_TYPE_SIGMA[row.sourceRowType] ?? 0.10;
  const stale = row.capturedAt && ageDays(row.capturedAt) > 180 ? 0.06 : 0;
  return Math.hypot(conf, type, stale);
}
```

### 5.2 Ladder correlation in `compErrorScore`

```javascript
// PROPOSED eSource augmentation
const group = sourceGroupKey(row);
const ladderCount = context.ladderCounts?.[group] ?? 1;
const eIndependence = Math.log1p(ladderCount) * 0.04; // more rows in group → higher σ
```

Pass `ladderCounts` from `resolveAlibabaComp` pre-scan of candidates.

### 5.3 Blend weight: independence-aware

```javascript
// PROPOSED — modify rawWeights in blendComps
const rawWeights = accepted.map(adj => {
  const w = 1 / (adj.sigmaLog ** 2 + EPS);
  const indep = independenceWeight(adj.row, ladderCounts[sourceGroupKey(adj.row)] ?? 1);
  return w * indep;
});
```

Then apply existing supplier cap on **adjusted** weights.

### 5.4 Single-source penalty on interval (not blend cap)

When `uniqueSuppliers(supportComps).length === 1`:

```javascript
// PROPOSED after blendComps
const SINGLE_SOURCE_SIGMA_BUMP = 0.12;
if (independenceStats.supplierCount === 1) {
  sigmaLog = Math.hypot(sigmaLog, SINGLE_SOURCE_SIGMA_BUMP);
  warnings.push('Single-supplier estimate — range widened; not independent market confirmation.');
}
```

**Why bump σ instead of estimate:** Avoid double-penalizing price level; widen uncertainty honestly.

---

## 6. Result metadata contract

### 6.1 Proposed `sourceIndependence` object

```javascript
// PROPOSED — resolveAlibabaComp return value
sourceIndependence: {
  supplierCount: 2,
  productCount: 4,
  sourceGroupCount: 3,
  rowCount: 5,               // accepted support comps
  observationWeight: 2.7,    // sum of independenceWeight
  dominantSupplier: 'messi',
  dominantSupplierFrac: 0.62,
  singleSourceOnly: false,
  weakSourceTypes: ['carat_band'],  // types present in support
  trustTier: 'B',              // A | B | C derived from worst type
},
sourceConcentration: { /* existing blend cap fields */ },
```

### 6.2 Acceptance mapping

| Criterion | Implementation |
|-----------|----------------|
| Separate supplier/product/group/row counts | `sourceIndependence` |
| Single-source visible penalty | `singleSourceOnly` + σ bump + warning |
| Page/MOQ/band lower trust | `sourceRowType` σ table |
| Ladders not fully independent | `independenceWeight` + `sourceGroupCount` |
| Backtest shows concentration | `--flag-source-stats` on backtest |

---

## 7. Single-source and weak-source penalties

### 7.1 Decision matrix

| Condition | Point estimate | Interval | UI |
|-----------|----------------|----------|-----|
| 1 supplier, 1 product, 3 ladder rows | unchanged | +12% σ | "One supplier ladder" |
| 1 supplier, `sku_exact` | unchanged | +8% σ | "Single-source" |
| 2 suppliers, one `page_range` | unchanged | type σ on weak row | List weak types |
| `flat_fancy` in pool | **reject row** | — | — |
| All rows `carat_band` | shrink toward prior / widen | +15% σ | "Band pricing only" |

### 7.2 Confidence label interaction

```javascript
// PROPOSED confidence downgrade
function resolveConfidence(bestScore, indep) {
  let c = bestScore <= 0.10 ? 'high' : bestScore <= 0.25 ? 'medium' : 'low';
  if (indep.singleSourceOnly) c = downgrade(c);
  if (indep.trustTier === 'C') c = downgrade(c);
  return c;
}
function downgrade(c) {
  return c === 'high' ? 'medium' : 'low';
}
```

---

## 8. Interaction with P1 carat and fancy work

| Other P1 | Interaction |
|----------|-------------|
| **Local carat slope** | `fitLocalCaratSlope` should use `independenceWeight` on knots, not raw row count; require `sourceCount >= 2` on **groups** not rows |
| **Fancy transfer** | Single-source pink product → comp-anchored shrink + bias correction |
| **P0 parity** | New metadata fields must appear in both engines |

```javascript
// PROPOSED — fitLocalCaratSlope knot loop
weights.push(independenceWeight(row, ladderCounts[sourceGroupKey(row)]));
```

---

## 9. Testing plan

### 9.1 Index generation tests

```python
# tests/test_regenerate_comps_index.py — PROPOSED
def test_messi_round_row_is_sku_exact():
    row = find_row(pid="1600612782670", carat=1.0, clarity="VS1")
    assert row["sourceRowType"] == "sku_exact"
    assert row["supplierKey"] == "messi"

def test_band_row_classified():
    row = find_row(caratBand=True)
    assert row["sourceRowType"] == "carat_band"
```

### 9.2 Engine unit tests

```javascript
// test-comp-engine-v3.mjs — PROPOSED
test('single source widens sigma and sets singleSourceOnly', () => {
  const result = resolveWithFixtureIndex('single-supplier-round.json');
  assert(result.sourceIndependence.singleSourceOnly === true);
  assert(result.high - result.low > baselineWidth * 1.05);
});

test('two suppliers same productId different groups', () => {
  // productCount=1, supplierCount=2, sourceGroupCount=2
});
```

### 9.3 Backtest extensions

```javascript
// backtest-comp-engine.mjs — PROPOSED flags
// --report-source-concentration
// Output CSV: supplierCount, singleSourceOnly, MdAPE, bias per bucket

record.sourceIndependence = result.sourceIndependence;
record.sourceConcentration = result.sourceConcentration;
```

**Hypothesis to validate:** MdAPE may not improve much, but **worst-case overconfidence** drops (P80 for single-source stays ≥ target while intervals widen).

### 9.4 Acceptance metrics

| Metric | Baseline | Target |
|--------|----------|--------|
| Single-source cases with warning | partial | **100%** |
| `sourceIndependence` populated | no | **100%** |
| False "high" confidence on single-source | unknown | **0%** after downgrade |
| White MdAPE | 15.4% | no worse than +0.2pp |
| Fancy bias | +20.7% | optional ↓ if combined with fancy P1 |

---

## 10. Why this will work

1. **Separates row count from evidence count:** Users and backtests see `supplierCount: 1` vs `rowCount: 5` — stops over-trusting ladders.

2. **Index-time classification is stable:** `sourceRowType` does not depend on parsing `section` strings at runtime.

3. **Transparent penalties:** σ widening and confidence downgrade align with P0 calibration philosophy — honest uncertainty without hiding bias.

4. **Composes with supplier cap:** Selection cap + blend cap + independence weight attack different layers of the same problem.

5. **Data-quality doc alignment:** Implements tiers already described in `alibaba-listing-confidence-gaps.md` (flat-price excluded, bands medium, exact high).

---

## 11. Risks

| Risk | Mitigation |
|------|------------|
| Over-penalize → all fancy `low` | Tune `SOURCE_ROW_TYPE_SIGMA`; only downgrade one level |
| Index regen breaks URLs | Version `indexVersion`; regression on row counts |
| Messi sheet aggregates lack pid | Fallback `sourceGroup` uses `section` hash |
| Historical captures lack MOQ | Default `moq: 1`; infer from raw when present |

---

## 12. Implementation phases

### Phase 1 — Index schema (1–2 days)

- Extend `regenerate-comps-index.py` + post-pass ladder classifier
- `supplier-normalization.json`
- Rebuild `alibaba-comps-index.json`

### Phase 2 — Engine σ + metadata (1 day)

- `sourceErrorSigma(row)` extended
- `sourceIndependence` builder in `resolveAlibabaComp`
- Single-source σ bump

### Phase 3 — Blend independence weights (1 day)

- `independenceWeight` in `blendComps`
- Wire into `fitLocalCaratSlope`

### Phase 4 — Backtest + UI (1 day)

- CSV concentration report
- UI labels: supplier/product/group counts
- P0 parity for new fields

---

## Appendix — Current vs proposed row example

**Today:**

```json
{
  "productId": "1600612782670",
  "carat": 1.0,
  "clarity": "VS1",
  "priceUsd": 135,
  "confidence": "high",
  "caratBand": false,
  "section": "Round Brilliant, D/White, IGI - Wuzhou Messi Gems"
}
```

**Proposed:**

```json
{
  "productId": "1600612782670",
  "supplierKey": "messi",
  "sourceRowType": "sku_ladder",
  "sourceGroup": "messi:1600612782670:sku_ladder",
  "ladderRowCount": 24,
  "confidence": "high",
  "capturedAt": "2026-05-21",
  "moq": 1,
  "carat": 1.0,
  "clarity": "VS1",
  "priceUsd": 135
}
```

---

## Definition of done (P1b)

- [ ] Result metadata includes supplier, product, source-group, and row counts
- [ ] Single-source estimates show penalty + warning + confidence downgrade
- [ ] Band/MOQ/page-range rows have higher σ than SKU-exact rows
- [ ] Ladder rows do not count as fully independent in blend and slope fit
- [ ] Backtest can report error by `singleSourceOnly` and `trustTier`
- [ ] Documented in `alibaba-clean-source-of-truth.md` maintenance instructions
