# White round 1.00–2.00ct: ML vs comp divergence

**Generated:** 2026-05-29  
**Model:** `S20 — Specialty cut + monotonic large-carat tail` (browser artifact)  
**Truth (catalog rows):** supplier list/piece USD from merged Alibaba + Messi + StarGem comp indexes  
**Comp path:** `comp-engine-v3` leave-one-supplier-out scoring per row  

## Executive summary

1. **Comp and ML answer different questions.** Comp returns the **cheapest adjusted Alibaba/Messi/StarGem floor** for your spec. ML + lookup return **StarGem sheet list economics** (internal rate ÷ 170), closer to typical list rows—not the floor winner.
2. **On 331 real catalog rows (1–2ct round white), comp is systematically low** vs the listing price (median **−12%**, MdAPE **12.6%**). ML/lookup are closer to the listed number (ML MdAPE **7.2%**, median **−5.5%**).
3. **In the UI you still see “ML too high”** because you compare ML to the **comp floor** (~$173–199), not to the listing. On a **252-cell synthetic grid** (E–G, VS, 1.00–2.00ct), **61%** of cells have ML **>8% above comp**; E color median **ML÷comp = 1.12**.
4. **Reconciler pulls the headline toward ML** when both exist (e.g. 1.75ct E VS1: comp $199, ML $204 → reconciled **$201**, ~70% comp / ~30% ML before toggles).
5. **Training a “naive baseline” on the same sheets would not help**—it would sit between lookup and ML and still miss the floor. The right split is: **comp = floor**, **ML = list-model cross-check**, not three peers in one blend.

**Example (grid, no IGI dims):** 1.75ct E VS1 — comp **$199**, lookup **$200**, ML **$204**, reconciled **$201**.

## Catalog holdout accuracy (truth = listing price)

| Source | N | MdAPE | Median bias | Median ratio | >+5% vs truth | <−5% vs truth |
|--------|---|-------|-------------|--------------|---------------|---------------|
| Comp (LOO floor) | 331 | 12.6% | **−12.0%** | 0.880 | 5.1% | 76.4% |
| Lookup /170 | 331 | 7.4% | −4.8% | 0.952 | 12.1% | 49.8% |
| ML (S20) | 331 | **7.2%** | −5.5% | 0.945 | 9.4% | 51.1% |

**Read this carefully:** Comp looks “wrong” vs truth because it is engineered as a **floor**, not a median list price. ML is not “wrong vs truth” on average—it is **high vs comp** because comp is low.

## By carat bucket (catalog rows)

| Bucket | N | Comp MdAPE | ML MdAPE | ML median bias vs truth | Median ML÷comp |
|--------|---|------------|----------|-------------------------|----------------|
| 1.00-1.49 | 167 | 12.0% | 6.1% | −4.6% | **1.084** |
| 1.50-1.99 | 131 | 13.0% | 8.9% | −8.4% | **1.036** |
| 2.00-2.99 | 33 | 15.8% | 8.8% | −4.4% | **1.088** |

Bridal **1.50–1.99ct** is the core range. ML is only ~4% above comp on median in-catalog, but the **grid** (imputed 3EX, no CVD flag) widens ML÷comp for E–G.

## Synthetic grid: ML ÷ comp by color grade

Round white, VS1/VVS2/VS2, carat 1.00–2.00 step 0.05, default EX/ID (matches pricer before IGI load).

| Grade | Cells | Median ML÷comp | ML > +8% vs comp |
|-------|-------|----------------|------------------|
| D | 63 | 1.071 | 39.7% |
| E | 63 | **1.115** | **68.3%** |
| F | 63 | 1.143 | 63.5% |
| G | 63 | 1.120 | 73.0% |

Across **252** cells: **154** (61.1%) have ML **>8%** above comp.

## Highest ML vs comp (grid)

| ct | Spec | match | Comp | Lookup | ML | ML vs comp |
|----|------|-------|------|--------|-----|------------|
| 1.05 | G VS2 | nearest | $91 | $124 | $126 | +38.1% |
| 1.5 | F VVS2 | exact | $166 | $229 | $228 | +37.3% |
| 1 | G VS2 | nearest | $88 | $118 | $121 | +37.3% |
| 1.95 | F VVS2 | exact | $217 | $298 | $292 | +34.5% |
| 1.65 | F VVS2 | exact | $183 | $252 | $240 | +31.3% |
| 1.75 | E VS1 | nearest | $199 | $200 | $204 | +2.5% |

**E VS1 1.65–1.75ct** (your use case) is a **mild** ML premium (+2–5% vs comp) when comp has strong nearest/exact support. Divergence explodes for **G/VS2** and **F/VVS2** where lookup tables are sparse and comp floor is far below sheet.

## Why ML looks high in the product (mechanism)

1. **Different estimands:** Comp = **min adjusted listing** (+ blend). ML = **sheet rate × residual** (category median behavior).
2. **Training label:** StarGem internal/170, not “winning Alibaba quote.”
3. **Imputed spec mode:** Before IGI load, Polish/Sym = EX, Cut = ID, TypeName = `-` → sheet “commodity” row; comp still picks **cheapest** comp.
4. **Carat adjustment:** Comp uses local slope from listings (your UI warning: 0.22 vs 0.8 prior). ML uses bucket + smooth features—1.75ct from 1.65ct row can diverge from comp scaling.
5. **CVD / 3EX post-multiply:** Applied after reconcile; comp does not encode growth method; ML uses `TypeName` when cert sets CVD.

## When ML is still useful

- No comp or `matchType: none` / thin `best_available`
- Sanity-check that sheet list and floor are in the same ballpark
- Fancy / specialty (out of scope here)

## When comp should drive the headline

- White round **1–2ct** with **nearest/exact** match and **≥3** support comps
- You care about **factory floor before negotiation**, not median list

## Changes shipped 2026-05-29

| Change | Effect |
|--------|--------|
| **Baseline omitted** when comp or ML exists | Stops ~$265 ladder from blending in |
| **`white_round_1_2` conformal segment** (`qLog ≈ 0.205`) | Narrower than all-white ~0.29 |
| **Support tightening** (high confidence ×0.72, nearest comp ×0.92) | Example 1.75ct E VS1 band **~$175–$229** on ~$200 estimate (~31% width vs ~43% before) |
| **ML weight cap 18%** for liquid 1–2ct round when comp exact/nearest+support | Comp ~70% / ML ~30% → more comp-led |

## Recommended next (ML / training)

1. **S21 target:** predict **comp-floor USD** or Messi-normalized floor, not internal/170 alone—evaluate MdAPE vs listings **and** vs comp.
2. **UI copy:** When `ML/comp > 1.08`, show: “Sheet model above Alibaba floor—use comp as ceiling.”
3. **Optional:** Comp-only hero toggle for exact match (ML panel stays diagnostic).
4. **Do not** add a fourth “trained baseline” on the same StarGem rows—it duplicates ML.

## Band tightening note

Reconciled bands use segment `white_round_1_2` plus support tightening. Exact-match stones get an extra ×0.88 on `qLog`. Reload the app to pick up artifacts in `research/data/reconciled-conformal-calibration-v1.json` and `conformal-calibration-v1.json`.

---

*Run: `node research/scripts/analyze-round-1-2ct-ml-divergence.mjs`*
