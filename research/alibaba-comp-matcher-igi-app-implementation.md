# Alibaba Comp Matcher — IGI App Implementation Spec

**Created:** 2026-05-21  
**Audience:** Engineers or agents implementing the comp-matching component in `index.html` (Gem Cost Appraiser IGI).  
**Goal:** When a user sets stone specs, show a **buyable Alibaba listing link** and **price** — exact SKU when possible, otherwise the closest promoted comp with **transparent modifier math**.

**Related files:**

| File | Role |
|------|------|
| `index.html` | App UI, pricing model, current `getAlibabaCeiling()` |
| `research/data/alibaba-comps-index.json` | Machine-readable promoted rows (472 as of 2026-05-21) |
| `research/alibaba-clean-source-of-truth.md` | Human audit trail + evidence |
| `research/alibaba-listing-confidence-gaps.md` | Known holes; drives “no comp” messaging |
| `research/scripts/regenerate-comps-index.py` | Rebuild index after SOT updates |
| `research/alibaba-llm-agent-intake-guide.md` | Data maintenance workflow |

---

## 1. Problem statement

Today the app does three different things that should become one component:

1. **Exact Messi round only** — `getMessiExactComp()` + inlined `messiDWhiteRoundLadder` for white round.
2. **Broad showroom ceilings** — `alibabaComps[]` with 14 entries, mostly `showroom/` URLs, not product-detail pages.
3. **Model estimate** — `compute()` wholesale/fair/retail, which does not return a purchasable link.

**Target behavior:** One function, `resolveAlibabaComp(ct)`, returns:

```ts
// Conceptual shape (implement as plain objects in JS)
{
  matchType: 'exact' | 'nearest' | 'model_fallback' | 'none',
  url: string | null,
  listingPriceUsd: number | null,      // captured SKU price (unadjusted)
  estimatedPriceUsd: number | null,    // after modifiers when nearest
  productId: string | null,
  label: string,                       // supplier / section short name
  confidence: 'high' | 'medium-high' | 'medium' | null,
  deltas: string[],                    // human-readable: "2.01ct vs comp 2.00ct", "F vs D", etc.
  modifiers: { combined: number, parts: string[] } | null,
  source: 'comps-index' | 'messi-ladder' | 'legacy-showroom' | null,
}
```

The **market bar** (`#market-bar` / `updateMarketBar`) becomes the primary UI for this object. Optionally add a dedicated “Alibaba comp” row under results later.

---

## 2. Scope

### In scope

- Loose lab-grown diamonds with **IGI** (same as app today).
- White and fancy color families already in `state.colorFamily` / `state.whiteGrade`.
- Shapes in the app dropdown that appear in `alibaba-comps-index.json`.
- Exact match and nearest-match with modifier explanation.
- Link opens Alibaba product-detail page in a new tab.

### Out of scope (v1)

- Negotiated quote, shipping, MOQ, promotions, or “50% off” live price scraping.
- Auto-refreshing prices from Alibaba (static index only).
- GIA-only stones (no Alibaba IGI comp path unless user toggles GIA for retail only).
- Mounted/ring listings (excluded from index by research rules).
- Multi-stone parcels or melee.

---

## 3. Architecture

### 3.1 Recommended layout

Keep `index.html` single-file for GitHub Pages, but **isolate comp logic** in a clearly marked block (or eventually `alibaba-comp-matcher.js` loaded via `<script src>` if you split files).

```
┌─────────────────────────────────────────────────────────┐
│  state (carat, shape, color, clarity, toggles)          │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │  normalizeStoneQuery() │  ← maps UI → index keys
              └────────────┬───────────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
  findExactComp()   findNearestComp()   getMessiRoundExact()
  (comps-index)     (comps-index)       (optional fast path)
         │                 │
         └────────┬────────┘
                  ▼
       applyCompModifiers(compRow, query)
                  │
                  ▼
         resolveAlibabaComp() → updateMarketBar()
```

### 3.2 Data loading (GitHub Pages)

**Assumption:** Site is published from repo root; `research/data/alibaba-comps-index.json` is reachable at:

`https://samueldovgin.github.io/Gem-Cost-Appraiser-IGI/research/data/alibaba-comps-index.json`

**Implementation:**

```javascript
let alibabaCompsIndex = null; // { comps: [...] }

async function loadAlibabaCompsIndex() {
  if (alibabaCompsIndex) return alibabaCompsIndex;
  const res = await fetch('research/data/alibaba-comps-index.json');
  if (!res.ok) throw new Error('comps index failed to load');
  alibabaCompsIndex = await res.json();
  return alibabaCompsIndex;
}
```

- Call once on `DOMContentLoaded`; set `compsIndexReady` flag.
- Until loaded, `getAlibabaCeiling()` keeps current behavior (Messi round + legacy `alibabaComps`).
- On load failure, log once and continue with legacy paths only; show subtle “comp index unavailable” in market bar.

**Alternative (no fetch):** Run `regenerate-comps-index.py` and paste minified `const ALIBABA_COMPS_INDEX = {...}` into `index.html`. Pros: works on `file://`; cons: large diff, manual regen.

**Recommendation:** `fetch` for maintainability; document that local `python3 -m http.server` is required for comp index during dev.

### 3.3 Deprecation plan

| Current | v1 behavior |
|---------|-------------|
| `getMessiExactComp()` | Keep as optimization OR merge into index (index already has all Messi round rows). Prefer **single path** via index to avoid dual maintenance. |
| `alibabaComps[]` showroom entries | Use only when `matchType === 'none'` **and** `colorCompGroup()` has a legacy row (optional fallback). Prefer advertising gap + Messi round benchmark instead of misleading showroom URL. |
| `getAlibabaCeiling()` | Thin wrapper: `return resolveAlibabaComp(ct)` mapped to old `{ totalLo, totalHi, url, label, exact }` for minimal `updateMarketBar` churn, or rewrite `updateMarketBar` to consume new shape. |

---

## 4. Normalization — UI state → index query

### 4.1 Shape mapping

App `state.shape` must map to index `shape`:

| App key | Index `shape` | Notes |
|---------|---------------|--------|
| `round` | `round` | |
| `oval` | `oval` | |
| `pear` | `pear` | |
| `radiant`, `sq_radiant` | `radiant` | Index has no `sq_radiant`; nearest = radiant |
| `cushion`, `cushion_brilliant`, `square_cushion` | `cushion` | Elongated cushion rows use `elongated_cushion` — see §4.5 |
| `princess` | `princess` | |
| `emerald` | `emerald` | |
| `asscher` | `asscher` | |
| `heart` | `heart` | |
| `marquise` | `marquise` | |
| Specialty (`moval`, `portuguese`, …) | **no index row** | Fall through to nearest mainstream shape or `model_fallback` |

### 4.2 White color

Index white rows often say `D`, `DE`, `DEF`, `E`, or `null` (ladder implied D).

**Assumption:** Promoted white ladders without explicit color are **D color** listings.

Map user grade → compare to comp color:

| Comp color field | Treat as |
|------------------|----------|
| `null`, `D`, `White D` | D |
| `DE`, `DE White` | DE (mid of D and E) |
| `DEF` | DEF (use band logic, not single grade) |
| `E` | E |

For **exact match** on white:

- User `D` matches comp `D` or `null`.
- User `E` matches comp `E` only, or DE/DEF with documented band (see nearest).

For **nearest match**, apply `whiteGradeMult[user] / whiteGradeMult[compColor]` where `compColor` is resolved to a single letter (DEF → use `E` as conservative anchor, or reject exact and force nearest).

### 4.3 Fancy color / intensity

App uses `state.colorFamily` keys like `pink_fv`, `yellow_fi`.

Index uses free-text `color` like `Fancy Vivid Pink`, `Fancy Intense Blue`.

**Mapping table (required):**

```javascript
const FANCY_INTENSITY_MAP = {
  pink_fl:  { match: ['fancy light pink', 'light pink'], rank: 1 },
  pink_f:   { match: ['fancy pink', 'pink'], rank: 2 },
  pink_fi:  { match: ['fancy intense pink', 'intense pink'], rank: 3 },
  pink_fv:  { match: ['fancy vivid pink', 'vivid pink'], rank: 4 },
  // ... yellow_*, blue_*, green_*, etc.
};
```

**Assumption:** Intensity rank difference uses **ratio of `fancyColorBase` ws1** between user family and comp family at 1ct, not shape mult:

```javascript
function fancyIntensityMult(userFamily, compColorLabel, ct) {
  const userBase = fancyColorBase[userFamily];
  const compFamily = inferFancyFamilyFromLabel(compColorLabel); // e.g. pink_fi
  const compBase = fancyColorBase[compFamily];
  if (!userBase || !compBase) return 1.0;
  const userWs = userBase.ws1 * Math.pow(ct, userBase.scale - 1);
  const compWs = compBase.ws1 * Math.pow(ct, compBase.scale - 1);
  return userWs / compWs;
}
```

**Assumption:** Do not match `pink_fv` user to a comp labeled only `Fancy Pink` as **exact** — allow **nearest** with intensity mult.

**Brownish / modifier hues:** Comp `Fancy Intense Brownish Pink` only matches user if you add explicit brownish options or treat as nearest with −10–15% penalty (see `fancy-color-diamond-pricing.md`).

### 4.4 Clarity

| Index clarity | App clarity | Exact? |
|---------------|-------------|--------|
| `VS1`, `VS2`, `VVS1`, `VVS2` | same | Yes |
| `VVS-VS` | map to VS1 for distance rank 0, or nearest only | No exact unless user accepts band |

**Assumption:** For nearest match, clarity adjustment uses existing `getClarityMult(clarity, ct)` ratio:

```javascript
clarityMult = getClarityMult(userClarity, ct) / getClarityMult(compClarity, ct);
// Fancy: use clarityMultColor instead (compressed)
```

### 4.5 Carat tolerance (exact match)

Reuse Messi ladder tolerances (already validated in app):

```javascript
function caratTolerance(ladderCarat) {
  if (ladderCarat <= 2) return 0.08;
  if (ladderCarat <= 6) return 0.18;
  return 0.25;
}

function isExactCarat(userCt, compCt) {
  return Math.abs(userCt - compCt) <= caratTolerance(compCt);
}
```

**Assumption:** Carat **bands** in index (e.g. `1.0-1.1`) are stored as numeric `1.05` or min band `1.0` during index regeneration — **today some rows use first number in label only**. Regenerator should set `caratMin` / `caratMax` for bands; until then, treat band rows as **nearest only**, not exact.

### 4.6 Cut grade

Index rows sometimes include Excellent in section title; few rows store cut grade per SKU.

**Assumption (v1):** Ignore cut grade for comp matching. Do not adjust price for Ideal vs VG on Alibaba comp (factory listings are overwhelmingly EX/2EX). Show a note if user selects `good` cut: “Alibaba DEF stock is typically Excellent; cut discount not applied to comp price.”

---

## 5. Matching algorithm

### 5.1 Candidate filter

```javascript
function filterCandidates(query, comps) {
  return comps.filter(row => {
    if (row.colorFamily !== query.colorFamily) return false;
    if (!shapeMatches(query.shape, row.shape)) return false;
    if (query.colorFamily === 'white' && !whiteColorCompatible(query, row)) return false;
    if (query.colorFamily === 'fancy' && !fancyColorCompatible(query, row)) return false;
    return true;
  });
}
```

### 5.2 Exact match

```javascript
function findExactComp(query, comps) {
  return comps.find(row =>
    isExactCarat(query.carat, row.carat) &&
    row.clarity === query.clarity &&
    colorExact(query, row) &&
    shapeMatches(query.shape, row.shape)
  ) ?? null;
}
```

If multiple exact rows (different suppliers), pick:

1. Highest `confidence` (high > medium-high > medium).
2. Lowest `priceUsd` (factory floor intent).
3. Stable tie-break: lowest `productId`.

### 5.3 Nearest match (weighted score)

When no exact row, score each candidate:

```javascript
function scoreCandidate(query, row) {
  const caratDist = Math.abs(query.carat - row.carat);
  const clarityDist = Math.abs(CLARITY_RANK[query.clarity] - CLARITY_RANK[row.clarity]);
  const colorDist = whiteColorDistance(query, row); // or fancy intensity rank delta
  const shapeDist = query.shape === row.shape ? 0 : 1;

  return (
    caratDist * 4.0 +
    clarityDist * 1.5 +
    colorDist * 1.0 +
    shapeDist * 3.0
  );
}
```

Pick minimum score if `score < NEAREST_THRESHOLD` (suggested: `2.5` — tune with fixtures).

**Assumption:** Prefer same `productId` ladder (multiple rows per listing) so URL stays consistent when adjusting clarity/carat — optional second pass: if best row is VS1 2ct, prefer same `productId` for VS2 2ct when score within ε.

### 5.4 No match

Return `matchType: 'none'` when:

- No row after filter, or best score above threshold.
- User shape is specialty with no mainstream alias.
- User fancy family is orange/purple and index has zero rows (per gaps doc).

**UI copy:** Point to `research/alibaba-listing-confidence-gaps.md` capture targets; show Messi round benchmark for white non-round (existing behavior).

### 5.5 Model fallback (optional v1.1)

If `none` but white and carat 0.3–6:

- Use `lookupMessiRoundLadder(ct, clarity, whiteGrade)` × `getShapeMultForPricing(shape)` as **estimated** factory price.
- `matchType: 'model_fallback'`, `url: MESSI_D_ROUND_URL`, label explains “no shape comp; estimated from round × shape mult”.

**Assumption:** This is less accurate than a real SKU row but better than a showroom URL. Flag clearly as **estimated**, not captured.

---

## 6. Price adjustment (modifiers)

Apply only when `matchType === 'nearest'` or when comp color/clarity/carat differs within “exact” band rules.

### 6.1 White diamonds

```javascript
function applyWhiteModifiers(query, compRow) {
  const ct = query.carat;
  const compColor = resolveWhiteColor(compRow.color); // default D
  const colorMult = (whiteGradeMult[query.whiteGrade] ?? 0.7) /
                    (whiteGradeMult[compColor] ?? whiteGradeMult.D);
  const clarityMult = getClarityMult(query.clarity, ct) /
                      getClarityMult(compRow.clarity, ct);
  const shapeMult = getShapeMultForPricing(query.shape) /
                    getShapeMultForPricing(compRow.shape);
  const combined = colorMult * clarityMult * shapeMult;
  return {
    combined,
    estimated: Math.round(compRow.priceUsd * combined),
    parts: [
      `color ×${colorMult.toFixed(2)} (${query.whiteGrade} vs ${compColor})`,
      `clarity ×${clarityMult.toFixed(2)} (${query.clarity} vs ${compRow.clarity})`,
      `shape ×${shapeMult.toFixed(2)} (${query.shape} vs ${compRow.shape})`,
    ],
  };
}
```

**Assumptions:**

- Multipliers are **independent** (multiply). This mirrors `compute()` structure but uses **comp SKU price** as base, not `baseWhitePerCt`.
- Do **not** apply China/TikTok/CVD toggles to Alibaba listing price — those are buyer-channel adjustments on wholesale model, not factory SKU list price.
- DEF comp row vs D user: use `colorMult` toward E (DEF ≈ treat comp as E for discount purposes) or exclude from nearest set — document choice in code comment.

### 6.2 Fancy diamonds

```javascript
function applyFancyModifiers(query, compRow) {
  const ct = query.carat;
  const intensityMult = fancyIntensityMult(query.colorFamily, compRow.color, ct);
  const clarityMult = (clarityMultColor[query.clarity] ?? 1) /
                      (clarityMultColor[compRow.clarity] ?? 1);
  const shapeMult = (shapeMultColor[query.shape] ?? 1) /
                      (shapeMultColor[compRow.shape] ?? 1);
  const combined = intensityMult * clarityMult * shapeMult;
  return { combined, estimated: Math.round(compRow.priceUsd * combined), parts: [...] };
}
```

**Assumptions:**

- Fancy comp `$` is **total stone price**, not per-carat (index stores total from capture).
- If comp row is clearly `$X/ct` in section title only, index generator should set `priceUnit: 'piece' | 'ct'` — **v1 index lacks this field; assume piece/total**.

### 6.3 Exact match

`estimatedPriceUsd = listingPriceUsd` (no modifiers). Still show deltas if carat diff > 0 but within tolerance (e.g. user 2.01ct vs comp 2.00ct).

---

## 7. UI integration

### 7.1 `updateMarketBar(m)` changes

Replace `m.alibabaMatch` usage with `m.alibabaComp` from `resolveAlibabaComp(state.carat)`.

| matchType | Market bar content |
|-----------|-------------------|
| `exact` | “**Alibaba exact SKU:** $X at {carat} {clarity} — {label}” + link |
| `nearest` | “**Closest Alibaba listing:** captured $Y → **~$Z** after {modifier parts}” + link + deltas |
| `model_fallback` | “**No SKU comp** — estimated $Z from round ladder × shape” + link |
| `none` | Existing copy + link to gaps / Messi round bench |

Always include `confidence` when present: “Medium-high comp — verify SKU on page.”

### 7.2 Optional results card (v1.1)

Add under fair-price column:

- **Listing:** `$121` (VS1, 1.00ct D oval)
- **Link:** Open on Alibaba ↗
- **Match quality:** Exact / Nearest (+modifiers)

### 7.3 Compare to model wholesale

Show side-by-side when helpful:

- `compute().ws` = model trade estimate
- `estimatedPriceUsd` = Alibaba-based estimate

If they diverge >40%, add caution: “Model and Alibaba comp disagree — verify video/cert.”

---

## 8. Critical assumptions (checklist)

These must be accepted or explicitly changed before shipping.

| # | Assumption | Risk if wrong |
|---|------------|----------------|
| A1 | Index prices are **USD FOB-ish piece prices** from May 2026 captures, MOQ 1, before negotiation. | User overpays if promos ended. |
| A2 | White index ladders without color are **D color**. | E user shown D price without adjustment. |
| A3 | **DEF / DE** comps are not exact for single-grade D/E without nearest modifiers. | Wrong exact match badge. |
| A4 | Carat bands in markdown are not fully modeled in JSON until regen adds `caratMin/Max`. | False exact matches on band rows. |
| A5 | Fancy color string matching is **fuzzy** on index `color` text. | Wrong intensity mult. |
| A6 | Shape mult applies to **white** nearest comps across shapes (oval comp for pear user). | Cross-shape estimate error; prefer same-shape candidates first (shapeDist penalty). |
| A7 | **No live scrape** — stale prices until index regen. | TikTok-calibration drift. |
| A8 | **IGI only** — GIA toggle does not change comp URL. | User confusion on cert type. |
| A9 | Pendant/ring listings excluded from index; some heart rows may still be mounting context. | Loose price not isolated. |
| A10 | Flat-price suspicious listings are excluded from index but may exist in raw JSON. | Bad anchor if promoted by mistake. |
| A11 | `fetch` index works on GitHub Pages; `file://` fails without embedded fallback. | Local open broken. |
| A12 | Modifier stack is **multiplicative** and separate from `compute()` toggles (China, CVD, etc.). | Double-counting if applied twice. |
| A13 | Specialty shapes (`moval`, `portuguese`, …) get **no** comp or model_fallback only. | Expected gap. |
| A14 | Orange/purple fancy have **no index rows** → `none`. | Must show “limited data” not fake link. |
| A15 | VVS-VS band clarity rows are nearest-only. | Exact match mislabel. |

---

## 9. Implementation steps (ordered)

### Phase 0 — Data prep

1. Extend `regenerate-comps-index.py` to emit:
   - `priceUnit: 'piece' | 'ct'`
   - `caratMin`, `caratMax` when band detected
   - `colorNormalized` (enum for matching)
2. Re-run script; commit updated `alibaba-comps-index.json`.

### Phase 1 — Loader + normalize

1. Add `loadAlibabaCompsIndex()`.
2. Implement `buildCompQueryFromState(state)`.
3. Unit-test normalization with 10 fixtures (table in §11).

### Phase 2 — Matcher

1. `findExactComp`, `findNearestComp`, `resolveAlibabaComp`.
2. Wire `compute()` → `alibabaComp: resolveAlibabaComp(ct)`.

### Phase 3 — UI

1. Refactor `updateMarketBar` to new object shape.
2. Keep `getMessiRoundBenchmarkHtml` for white non-round with no comp.

### Phase 4 — Cleanup

1. Mark `alibabaComps[]` deprecated; remove after parity testing.
2. Optionally remove duplicate `messiDWhiteRoundLadder` if index covers all sizes (keep 7–8ct extrapolation note).

---

## 10. Pseudocode — `resolveAlibabaComp`

```javascript
async function resolveAlibabaComp(ct) {
  const query = buildCompQueryFromState(state, ct);

  try {
    const { comps } = await loadAlibabaCompsIndex();
    const exact = findExactComp(query, comps);
    if (exact) {
      return {
        matchType: 'exact',
        url: exact.url,
        listingPriceUsd: exact.priceUsd,
        estimatedPriceUsd: exact.priceUsd,
        productId: exact.productId,
        label: shortLabel(exact),
        confidence: exact.confidence,
        deltas: buildDeltas(query, exact),
        modifiers: null,
        source: 'comps-index',
      };
    }

    const nearest = findNearestComp(query, comps);
    if (nearest) {
      const mod = query.colorFamily === 'white'
        ? applyWhiteModifiers(query, nearest)
        : applyFancyModifiers(query, nearest);
      return {
        matchType: 'nearest',
        url: nearest.url,
        listingPriceUsd: nearest.priceUsd,
        estimatedPriceUsd: mod.estimated,
        productId: nearest.productId,
        label: shortLabel(nearest),
        confidence: nearest.confidence,
        deltas: buildDeltas(query, nearest),
        modifiers: mod,
        source: 'comps-index',
      };
    }
  } catch (e) {
    console.warn('Alibaba comps index unavailable', e);
  }

  // Legacy / fallback paths
  if (isWhite() && state.shape === 'round') {
    const legacy = getMessiExactComp(ct);
    if (legacy) return mapLegacyMessi(legacy);
  }

  if (isWhite()) {
    const bench = lookupMessiRoundLadder(ct, state.clarity, state.whiteGrade);
    if (bench && getShapeMultForPricing(state.shape) !== 1) {
      return modelFallbackFromRound(bench, ct);
    }
  }

  const legacyShowroom = getLegacyShowroomComp(ct); // old getAlibabaCeiling tail
  if (legacyShowroom) return mapLegacyShowroom(legacyShowroom);

  return { matchType: 'none', url: null, /* ... */ };
}
```

---

## 11. Test fixtures (manual QA)

| # | Input | Expected matchType | Notes |
|---|--------|-------------------|--------|
| T1 | White D VS1 1ct round | exact | Messi `1600612782670` $121.50 area |
| T2 | White E VS1 1ct round | nearest | From D ladder × color mult |
| T3 | White D VS1 2.01ct pear | nearest/exact | Pear Messi ladder; carat tol |
| T4 | White F SI1 2ct pear | nearest | Off-catalog; modifiers + LG563297279 sanity |
| T5 | White D VS1 3ct princess | exact | `1601764885212` |
| T6 | Fancy vivid pink 2ct heart | exact/nearest | `10000038791251` carat ladder |
| T7 | Fancy intense pink 1.5ct pear | nearest | One pear row in mixed listing |
| T8 | Fancy vivid yellow 2ct princess | none | Gap — flat-price listings excluded |
| T9 | Fancy vivid orange 1ct | none | No index rows |
| T10 | White G VS1 1ct oval | nearest | Off-catalog color mult |

---

## 12. Maintenance

1. Capture → `research/data/*.json`
2. Promote → `alibaba-clean-source-of-truth.md`
3. Regenerate → `python3 research/scripts/regenerate-comps-index.py`
4. Deploy → GitHub Pages picks up new JSON on push
5. Update gaps doc when coverage changes

Version the index: add `indexVersion: "2026-05-21"` to JSON header; show in market bar footer for debugging.

---

## 13. Open decisions (product owner)

| Decision | Options | Recommendation |
|----------|---------|----------------|
| Messi ladder duplicate | Keep inlined ladder vs index-only | Index-only after Phase 4 |
| Showroom fallback | Keep `alibabaComps[]` vs remove | Remove; show gap message |
| Cross-shape nearest | Allow vs same-shape only | Same-shape only in v1 |
| DEF exact match | Allow exact for D user | Nearest + color mult only |
| Compare ws vs comp | Show delta in UI | Yes when both exist |

---

## 14. Summary

Implement **`resolveAlibabaComp()`** against **`research/data/alibaba-comps-index.json`**, with explicit **normalization**, **exact → nearest → fallback → none** matching, and **modifier transparency** using existing `index.html` multiplier tables. The component is **data-ready**; the app is **not wired yet**. Biggest engineering risks are **fancy intensity parsing**, **DEF/DE color bands**, and **GitHub Pages fetch vs file://** — address in Phase 0 index schema improvements and a documented local preview workflow.
