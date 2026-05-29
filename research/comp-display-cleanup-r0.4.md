# Comp Display Cleanup (R0.4) — Prioritized Comps + Adjustment Ladder

**Version:** 2026-05-29 · **Scope:** `index.html` → `updateMarketBar` rendering only
**Related:** `research/roadmap-r0.3-explainability-waterfall-expansion.md`, `research/comp-waterfall.js`, `research/comp-compare-chart.js`

---

## 1. The problem

The "Closest Alibaba comps" block in the market bar is the most information-dense
panel in the app, and right now it dumps almost everything at once:

- The **primary** comp, then **alternatives**, then a **blend-math** disclosure,
  then an **"Other supplier checks"** list, then a footer paragraph of warnings.
- Every comp's adjustments are rendered as one long middot-separated string:

  > `source adjust ÷1.25 (Messi color → StarGem-like factory) · intensity+carat ×1.002 (pink_fv vs pink_fv) · shape ×0.903 (marquise vs pear)`

Two concrete failures fall out of this:

1. **No prioritization.** Five-plus comps are shown flat, with equal weight,
   even though for any given stone only one or two are the *right* reference.
   The reader has to mentally rank them.
2. **The adjustment math is opaque.** The modifier string tells you *that* a
   `×0.903` was applied for shape, but not in a way that reads as
   "the comp is a pear, you want a marquise, so knock the price down ~10%."
   You can't see the running price walk from listing → adjusted.

## 2. What we keep (explicit constraints from the user)

- **All the deep links stay.** `listing ↗`, `company ↗`, `source row … ↗`,
  `xlsx ↗`, and `IGI <report> ↗` are how the appraiser verifies a comp's stats
  directly at the source. They are a feature, not clutter.
- **Source preference is real domain knowledge:**
  - **Colorless / white** stones → the **StarGem** sheet is usually the best comp.
  - **Fancy color** stones → the **Messi** color database is usually the best comp.
  The UI should surface the preferred source first instead of burying it.

## 3. Design principles

1. **One hero, the rest on demand.** Show a single best-reference comp expanded,
   collapse everything else behind labeled disclosures. Progressive disclosure,
   not a wall.
2. **Lead with the trustworthy source.** Pick the hero by *(a)* preferred source
   for the stone's color family, then *(b)* match quality. Badge it so the reason
   is visible ("Best colorless reference").
3. **Make the math walk.** Replace the modifier string with a vertical
   **adjustment ladder**: start at the supplier listing price, apply one labeled
   step per stat, show the multiplier, the ± dollar delta, and the running total,
   ending at the adjusted comp price. Each step reads `comp <value> → you <value>`.
4. **Separate evidence from cross-checks.** Comps that feed the blended estimate
   are grouped apart from cross-source checks (which are sanity checks, never
   averaged in). This matches the engine's own contract.
5. **No engine changes.** This is a pure rendering refactor over the existing
   `resolveAlibabaComp` output (`primary`, `alternatives`, `supportComps`,
   `supplierComparisons`, `otherFactoryExact`, `estimate`, `low/high`, `warnings`).

## 4. New layout

```
Closest Alibaba comps — weighted blend  $539      [nearest match]
Showing StarGem first — best reference for colorless.   ← only when a preferred-source comp exists

┌─ HERO CARD ───────────────────────────────────────────────┐
│ ~$507   $714   [nearest] [Best color reference]            │
│ 2.05ct pear VS1 Fancy Vivid Pink · Messi Gems              │
│ company ↗  source row … ↗  xlsx ↗  IGI 750565357 +2 ↗      │
│                                                            │
│ Supplier listing                              $714         │
│ Source   Messi color → StarGem-like factory  ÷1.25  −$143  $571
│ Color    comp FV Pink → you FV Pink           ×1.002 +$1   $572
│ Shape    comp pear → you marquise             ×0.903 −$56  $516
│ Adjusted to your stone                       ~$507         │
└────────────────────────────────────────────────────────────┘

▸ Other comps in this estimate (3)        ← collapsed compact rows w/ mini-ladders
▸ Cross-source checks (1)                 ← collapsed; "not averaged into the floor"
▸ Show blend math                         ← existing weight breakdown, kept

Estimate is a weighted blend of 5 adjusted comps… 80% range $343–$848. <warnings>
```

The hero's ladder is open by default; every other comp keeps a `▸ show adjustments`
mini-ladder so no detail is lost — it's just not all on screen at once.

## 5. The adjustment ladder (the core clarity win)

Each comp already carries a `modifiers.parts[]` array of strings like
`shape ×0.903 (marquise vs pear)`. We parse each part into:

| Field | From the string | Example |
|---|---|---|
| `key`/`label` | leading token | `shape` → **Shape** |
| `multiplier` | `×n` or `÷n` | `0.903` (÷ becomes `1/n`) |
| `you` / `comp` | the `(A vs B)` detail, A = your stone | you `marquise`, comp `pear` |
| `pct` | `(multiplier − 1) × 100` | `−9.7%` |

Rendering rules:

- Phrase reads in the direction the multiplier is applied: **`comp <comp> → you <you>`**
  (the comp's price is what gets multiplied to reach your stone's value).
- `÷` is shown as the equivalent `×` plus the dollar delta so the running total stays additive.
- Fancy color keys (`pink_fv`) are humanized (`Fancy Vivid Pink`). When the bundled
  `intensity+carat` step has equal colors, it's relabeled **Carat/size** so it doesn't
  read as a meaningless "FV → FV".
- Up steps are green, down steps are red; the running total column makes the walk obvious.

This is the same data the dormant `buildCompWaterfall` (`research/comp-waterfall.js`)
produces; R0.4 renders it inline per comp rather than as one global panel.

## 6. Source prioritization logic

```
preferredKey   = isWhite() ? 'starsgem' : 'messi'
heroEntry      = first blend comp whose supplierKey === preferredKey,
                 else engine primary
rank(candidate): preferred source first → exact/nearest before extrapolated →
                 known source (starsgem/messi) before unknown
```

The headline blended `estimate` is **unchanged** — we only reorder which comp is
shown as the hero and badge it. The estimate remains the engine's weighted blend.

## 7. Scope / non-goals

- No change to comp selection, blending, weighting, or calibration.
- `model_fallback` (no real comp row) keeps its simple single-line estimate.
- The big cross-comp spreadsheet view in `comp-compare-chart.js` stays as a
  separate experiment; R0.4 favors per-comp cards because they keep each comp's
  links and provenance attached to the comp.

## 8. Acceptance checks

- [ ] Colorless stone surfaces a StarGem comp as hero when one exists; fancy color surfaces Messi.
- [ ] All existing links render identically (listing/company/source row/xlsx/IGI).
- [ ] Hero ladder sums from listing to within $2 of the adjusted comp price.
- [ ] At most one hero + two collapsed disclosures visible by default.
- [ ] `npm run test:r0-waterfall` and `test:comp-compare-chart` still pass (no engine/module changes).
