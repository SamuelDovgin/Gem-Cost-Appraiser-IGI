# ML grade monotonicity — S20 Extra Trees

Generated **2026-05-29** from `S20 — Specialty cut + monotonic large-carat tail` (`log_tail_lookup_residual`, 160 trees).

Open the interactive charts: `research/ml-grade-monotonicity-diagnostics.html` (run `npm run serve` from repo root, then visit `/research/ml-grade-monotonicity-diagnostics.html`).

## Why this matters

Wholesale buyers expect **higher clarity ⇒ higher $/ct** and **better color (D) ⇒ higher $/ct** holding other attributes fixed. The comp engine and StarGem sheet formula encode that ordering. The S20 model is trained as a **residual on lookup tables**, so when adjacent grades hit **different lookup buckets** (sparse training rows), the tree ensemble can invert the ladder.

## Headline counts

| Metric | Value |
| --- | --- |
| Grid predictions | 3,465 |
| Clarity step inversions (IF→…→SI2) | **1297** (43.7% of adjacent clarity steps) |
| Color step inversions (D→…→H) | **869** |
| Clarity inversions with lookup rate jump >15% log | **458** |

## Pinned case — Marquise 4.08ct E (your IGI example)

Cert shows **VVS2**; UI may show **SI1** for pricing. ML uses whatever clarity is in the form.

| Clarity | ML $/ct | Total | Lookup n | Lookup $/ct | Residual × |
| --- | --- | --- | --- | --- | --- |
| IF | $140/ct | $572 | 496 | $139/ct | 1.012 |
| VVS1 | $140/ct | $572 | 496 | $139/ct | 1.011 |
| VVS2 | $194/ct | $790 | 8 | $192/ct | 1.011 |
| VS1 | $154/ct | $629 | 17 | $155/ct | 0.996 |
| VS2 | $129/ct | $525 | 3 | $129/ct | 0.999 |
| SI1 | $176/ct | $717 | 1 | $176/ct | 1.001 |
| SI2 | $140/ct | $572 | 496 | $139/ct | 1.011 |

**Violations on this ladder:** VVS2→VS1 (−20.3%), VS1→VS2 (−16.5%), SI1→SI2 (−20.3%)

Notable pattern here:

- **VVS1 and IF** share a **high-count lookup** (~496 rows) with a **low** internal rate (~$140/ct), anchoring ML down.
- **VVS2** hits a **different bucket** (n=8, lookup ~$192/ct) so total ML **jumps above VVS1**.
- **SI1** has **n=1** lookup — residual blows up to ~$176/ct, **above VS1** despite being lower clarity.

That is why “higher clarity” in the cert does not always mean “higher ML price” until lookup tables are smoothed or post-hoc monotonic correction is applied.

## Worst clarity inversions (top 15)

| Shape | ct | Color | Step | $/ct drop | Lookup n |
| --- | --- | --- | --- | --- | --- |
| HEART | 3 | E | VVS1→VVS2 | −64.7% | 1→29 |
| HEART | 0.5 | D | VS1→VS2 | −61.6% | 9→20 |
| HEART | 3 | D | VVS1→VVS2 | −60.0% | 63→63 |
| PEAR | 0.5 | D | VS1→VS2 | −57.3% | 14→20 |
| HEART | 0.5 | E | VS1→VS2 | −55.2% | 2→15 |
| PEAR | 0.5 | E | VS1→VS2 | −55.1% | 10→15 |
| HEART | 3 | F | VVS1→VVS2 | −55.0% | 1→4 |
| OVAL | 4.08 | F | VVS1→VVS2 | −55.0% | 1→1 |
| RADIANT | 3 | D | VVS1→VVS2 | −53.5% | 63→29 |
| CUSHION | 0.5 | D | VVS2→VS1 | −53.0% | 1→1703 |
| ROUND | 4.08 | F | VVS1→VVS2 | −52.5% | 1→12 |
| HEART | 4.08 | F | VVS1→VVS2 | −52.5% | 1→19 |
| PEAR | 4.08 | F | VVS1→VVS2 | −52.4% | 1→19 |
| PRINCESS | 0.5 | D | VS1→VS2 | −52.4% | 3→20 |
| PRINCESS | 4.08 | F | VVS1→VVS2 | −52.2% | 1→19 |

## Root causes (research notes)

1. **Lookup-first architecture** — Price = `lookupRate × tail × exp(treeResidual) × carat`. Monotonicity in clarity is **not** a training constraint.
2. **Sparse / aliased buckets** — Off-catalog grades (SI1 on white lab) often have **n=1** or fall through to **global** rates shared with unrelated grades (e.g. SI2 and IF both at n=496).
3. **VVS1 vs VVS2 cliff** — Largest single-step drops (~50–64%) cluster on **VVS1→VVS2** where lookup keys change and residual trees disagree.
4. **HEART and MARQUISE** — Specialty shapes with **cut='-'** show more inversions (thin training slices per clarity).
5. **Large carat tail** — 4ct+ uses `log_tail_lookup_residual`; tail anchor re-buckets to 5–9.99ct lookup, amplifying bucket mismatch at 4.08ct.
6. **Comp engine vs ML** — Comps apply explicit `CLARITY_MULT_COLOR` adjustments; ML does not. Reconciler blends both, so UI can look “more sane” on comps while ML card shows inversions.

## Recommended fixes (ordered)

1. **Isotonic post-process** on clarity (and color) per (shape, carat_bucket) after ML prediction.
2. **Lookup smoothing** — blend sparse clarity cells toward VS1 within shape×color×bucket.
3. **Monotonic constraints in training** — penalize inversions on holdout ladders.
4. **UI** — when cert clarity ≠ selected clarity, show both ladders; flag ML inversion in `warnings`.

## Regenerate

```bash
node research/scripts/analyze-ml-grade-monotonicity.mjs
```
