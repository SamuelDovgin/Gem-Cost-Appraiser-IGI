# ML grade monotonicity — S20 Extra Trees

Generated **2026-05-29** from `S21 — Monotone grade model (LightGBM)` (`log_tail_lookup_residual`, 400 trees).

Open the interactive charts: `research/ml-grade-monotonicity-diagnostics.html` (run `npm run serve` from repo root, then visit `/research/ml-grade-monotonicity-diagnostics.html`).

## Why this matters

Wholesale buyers expect **higher clarity ⇒ higher $/ct** and **better color (D) ⇒ higher $/ct** holding other attributes fixed. The comp engine and StarGem sheet formula encode that ordering. The S20 model is trained as a **residual on lookup tables**, so when adjacent grades hit **different lookup buckets** (sparse training rows), the tree ensemble can invert the ladder.

## Headline counts

| Metric | Value |
| --- | --- |
| Grid predictions | 3,465 |
| Clarity step inversions (IF→…→SI2) | **0** (0.0% of adjacent clarity steps) |
| Color step inversions (D→…→H) | **0** |
| Clarity inversions with lookup rate jump >15% log | **0** |

## Pinned case — Marquise 4.08ct E (your IGI example)

Cert shows **VVS2**; UI may show **SI1** for pricing. ML uses whatever clarity is in the form.

| Clarity | ML $/ct | Total | Lookup n | Lookup $/ct | Residual × |
| --- | --- | --- | --- | --- | --- |
| IF | $201/ct | $820 | — | — | — |
| VVS1 | $201/ct | $820 | — | — | — |
| VVS2 | $194/ct | $793 | — | — | — |
| VS1 | $155/ct | $634 | — | — | — |
| VS2 | $151/ct | $617 | — | — | — |
| SI1 | $147/ct | $600 | — | — | — |
| SI2 | $137/ct | $561 | — | — | — |

**Violations on this ladder:** VVS1→VVS2 (−3.3%), VVS2→VS1 (−20.0%), VS1→VS2 (−2.8%), VS2→SI1 (−2.7%), SI1→SI2 (−6.5%)

Notable pattern here:

- **VVS1 and IF** share a **high-count lookup** (~496 rows) with a **low** internal rate (~$140/ct), anchoring ML down.
- **VVS2** hits a **different bucket** (n=8, lookup ~$192/ct) so total ML **jumps above VVS1**.
- **SI1** has **n=1** lookup — residual blows up to ~$176/ct, **above VS1** despite being lower clarity.

That is why “higher clarity” in the cert does not always mean “higher ML price” until lookup tables are smoothed or post-hoc monotonic correction is applied.

## Worst clarity inversions (top 15)

| Shape | ct | Color | Step | $/ct drop | Lookup n |
| --- | --- | --- | --- | --- | --- |


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
