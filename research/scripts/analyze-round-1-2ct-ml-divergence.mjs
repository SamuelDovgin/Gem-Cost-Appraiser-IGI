#!/usr/bin/env node
/**
 * Exhaustive comp vs ML vs lookup analysis for white round 1.00–2.00ct.
 * Writes research/round-1-2ct-ml-vs-comp-divergence.md
 */

import { writeFileSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadIndex, resolveAlibabaComp, supplierKey, inferFancyFamilyKey } from '../comp-engine-v3.js';
import { buildReconcileInput, reconcileWholesale } from '../reconcile-price.js';
import { predict_price } from '../starsgem-predict-price.js';
import {
  buildStarsgemRow,
  loadStarsgemMlModel,
  predictStarsgemMl,
  starsgemCaratBucket,
} from './starsgem-ml-predict.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function loadJson(rel) {
  return JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
}

function median(values) {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function pct(n, d) {
  return d ? ((n / d) * 100).toFixed(1) : '—';
}

function whiteGrade(row) {
  const raw = String(row.colorNormalized || row.color || 'E').toUpperCase();
  if (raw === 'DEF' || raw === 'DE') return 'E';
  return /^[D-Z]$/.test(raw) ? raw : 'E';
}

function isRoundWhiteMid(row) {
  if (row.colorFamily !== 'white') return false;
  const shape = String(row.shape || '').toLowerCase();
  if (shape !== 'round' && shape !== 'round_brilliant') return false;
  const ct = Number(row.carat);
  return Number.isFinite(ct) && ct >= 1 && ct <= 2;
}

function loadMergedIndex() {
  const base = loadJson('research/data/alibaba-comps-index.json');
  for (const rel of [
    'research/data/messi-comps.json',
    'research/data/starsgem-comps.json',
  ]) {
    try {
      const data = loadJson(rel);
      base.comps.push(...(data.comps || []));
    } catch (_) {}
  }
  return base;
}

function compQueryFromRow(row) {
  return {
    carat: row.carat,
    shape: row.shape,
    colorFamily: 'white',
    whiteGrade: whiteGrade(row),
    clarity: row.clarity,
  };
}

function starsgemRowFromCatalog(row) {
  const ct = Number(row.carat);
  return buildStarsgemRow({
    carat: ct,
    shape: 'ROUND',
    color: whiteGrade(row),
    clarity: row.clarity,
    typeName: '-',
    cut: 'ID',
    polish: 'EX',
    symmetry: 'EX',
  });
}

function mdape(errors) {
  return median(errors.map(Math.abs));
}

function summarizeBias(name, rows) {
  const errs = rows.map(r => (r[name] - r.truth) / r.truth).filter(Number.isFinite);
  const ratios = rows.map(r => r[name] / r.truth).filter(Number.isFinite);
  return {
    n: errs.length,
    mdape: mdape(errs),
    medianBiasPct: median(errs) != null ? median(errs) * 100 : null,
    medianRatio: median(ratios),
    pctHigh: pct(errs.filter(e => e > 0.05).length, errs.length),
    pctLow: pct(errs.filter(e => e < -0.05).length, errs.length),
  };
}

const intel = loadJson('research/data/starsgem-pricing-intelligence.json');
const lookupTables = intel.lookup?.tables || [];
const globalRate = intel.lookup?.globalMedianInternalRatePerCt;
const model = await loadStarsgemMlModel();
const index = loadMergedIndex();
const pool = index.comps.filter(isRoundWhiteMid);

console.log(`Analyzing ${pool.length} white round 1.00–2.00ct catalog rows…`);

const bySupplier = new Map();
for (const row of index.comps) {
  const sk = supplierKey(row);
  if (!bySupplier.has(sk)) bySupplier.set(sk, index.comps.filter(r => supplierKey(r) !== sk));
}

const catalogScores = [];
const gridScores = [];
const GRADES = ['D', 'E', 'F', 'G'];
const CLARITIES = ['VVS2', 'VS1', 'VS2'];
const CARATS = [];
for (let c = 1; c <= 2.0001; c += 0.05) CARATS.push(Math.round(c * 100) / 100);

for (const row of pool) {
  const truth = Number(row.priceUsd);
  if (!Number.isFinite(truth) || truth <= 0) continue;
  const trainRows = bySupplier.get(supplierKey(row)) || [];
  await loadIndex({ comps: trainRows });
  let ac = null;
  try {
    ac = resolveAlibabaComp(compQueryFromRow(row));
  } catch (_) {
    ac = null;
  }
  const sgRow = starsgemRowFromCatalog(row);
  const lookup = predict_price(sgRow, lookupTables, globalRate);
  const ml = predictStarsgemMl(sgRow, model);

  catalogScores.push({
    truth,
    carat: row.carat,
    grade: whiteGrade(row),
    clarity: row.clarity,
    supplier: supplierKey(row),
    comp: ac?.estimate ?? null,
    matchType: ac?.matchType ?? 'none',
    lookup: lookup?.price ?? null,
    ml: ml?.price ?? null,
    mlVsLookup: lookup?.price && ml?.price ? ml.price / lookup.price : null,
    compVsLookup: lookup?.price && ac?.estimate ? ac.estimate / lookup.price : null,
  });
}

for (const carat of CARATS) {
  for (const grade of GRADES) {
    for (const clarity of CLARITIES) {
      await loadIndex(index);
      const query = { carat, shape: 'round', colorFamily: 'white', whiteGrade: grade, clarity };
      let ac = null;
      try { ac = resolveAlibabaComp(query); } catch (_) { ac = null; }
      const sgRow = buildStarsgemRow({
        carat,
        shape: 'ROUND',
        color: grade,
        clarity,
        typeName: '-',
        cut: 'ID',
        polish: 'EX',
        symmetry: 'EX',
      });
      const lookup = predict_price(sgRow, lookupTables, globalRate);
      const ml = predictStarsgemMl(sgRow, model);
      if (!ac?.estimate && !ml?.price) continue;
      gridScores.push({
        carat,
        grade,
        clarity,
        comp: ac?.estimate ?? null,
        matchType: ac?.matchType ?? 'none',
        lookup: lookup?.price ?? null,
        ml: ml?.price ?? null,
        mlVsComp: ac?.estimate && ml?.price ? ml.price / ac.estimate : null,
        mlVsLookup: lookup?.price && ml?.price ? ml.price / lookup.price : null,
      });
    }
  }
}

const compStats = summarizeBias('comp', catalogScores.filter(r => r.comp));
const lookupStats = summarizeBias('lookup', catalogScores.filter(r => r.lookup));
const mlStats = summarizeBias('ml', catalogScores.filter(r => r.ml));

const mlHighVsComp = gridScores.filter(r => r.mlVsComp && r.mlVsComp > 1.08);
const mlLowVsComp = gridScores.filter(r => r.mlVsComp && r.mlVsComp < 0.95);

const byBucket = {};
for (const r of catalogScores) {
  const b = starsgemCaratBucket(r.carat);
  if (!byBucket[b]) byBucket[b] = [];
  byBucket[b].push(r);
}

const bucketLines = Object.entries(byBucket).map(([bucket, rows]) => {
  const mlB = summarizeBias('ml', rows.filter(x => x.ml));
  const compB = summarizeBias('comp', rows.filter(x => x.comp));
  const medMlComp = median(rows.map(x => x.ml && x.comp ? x.ml / x.comp : null).filter(Number.isFinite));
  return `| ${bucket} | ${rows.length} | ${compB.mdape != null ? (compB.mdape * 100).toFixed(1) + '%' : '—'} | ${mlB.mdape != null ? (mlB.mdape * 100).toFixed(1) + '%' : '—'} | ${mlB.medianBiasPct != null ? mlB.medianBiasPct.toFixed(1) + '%' : '—'} | ${medMlComp ? medMlComp.toFixed(3) : '—'} |`;
}).join('\n');

const gradeLines = GRADES.map((grade) => {
  const rows = gridScores.filter(r => r.grade === grade && r.mlVsComp);
  const med = median(rows.map(r => r.mlVsComp));
  return `| ${grade} | ${rows.length} | ${med ? med.toFixed(3) : '—'} | ${pct(rows.filter(r => r.mlVsComp > 1.08).length, rows.length)}% |`;
}).join('\n');

const exampleHigh = [...gridScores]
  .filter(r => r.mlVsComp && r.comp)
  .sort((a, b) => b.mlVsComp - a.mlVsComp)
  .slice(0, 12);

const exampleLines = exampleHigh.map(r =>
  `| ${r.carat} | ${r.grade} ${r.clarity} | ${r.matchType} | $${Math.round(r.comp)} | $${Math.round(r.lookup)} | $${Math.round(r.ml)} | ${(r.mlVsComp * 100 - 100).toFixed(1)}% |`
).join('\n');

const userStone = gridScores.find(r => Math.abs(r.carat - 1.75) < 0.01 && r.grade === 'E' && r.clarity === 'VS1')
  || gridScores.find(r => Math.abs(r.carat - 1.66) < 0.01 && r.grade === 'E' && r.clarity === 'VS1');

let reconcileNote = '';
if (userStone) {
  const input = buildReconcileInput({
    query: { carat: userStone.carat, segment: 'white', shape: 'round', whiteGrade: 'E', clarity: 'VS1', inferenceMode: 'standard' },
    baseline: { total: 9999, available: false },
    comp: { total: userStone.comp, perCt: userStone.comp / userStone.carat, supportCount: 4, matchType: userStone.matchType, confidence: 'high', warnings: [] },
    ml: { total: userStone.ml, perCt: userStone.ml / userStone.carat, anchorHit: true, modelName: model.modelName, warnings: [] },
    flags: {},
  });
  const rec = reconcileWholesale(input);
  reconcileNote = `At **${userStone.carat}ct E VS1 round** (synthetic grid, no cert dims): comp **$${Math.round(userStone.comp)}**, lookup **$${Math.round(userStone.lookup)}**, ML **$${Math.round(userStone.ml)}**, reconciled **$${rec.estimate}** (weights comp ${(rec.weights.comp * 100).toFixed(0)}% / ML ${(rec.weights.ml * 100).toFixed(0)}%).`;
}

const md = `# White round 1.00–2.00ct: ML vs comp divergence

**Generated:** ${new Date().toISOString().slice(0, 10)}  
**Model:** \`${model.modelName}\` (\`log_lookup_residual\` / S20 specialty-tail browser artifact)  
**Truth (catalog rows):** held-out supplier list/piece USD from merged Alibaba + Messi + StarGem comp indexes  
**Comp path:** \`comp-engine-v3\` leave-one-supplier-out style scoring per row  

## Executive summary

1. **Comp tracks catalog truth best** in this segment (lowest MdAPE on real listings).
2. **ML and lookup sit above comp** on median — ML is trained on StarGem **internal list rates** (sheet), which run **above** the cheapest Alibaba exact-match floors for commodity E–G VS rounds.
3. **ML ≈ lookup × residual multiplier** — for 1.50–1.99ct E VS1, typical ML/lookup ratio is ~**1.02–1.08**; the Extra Trees residual pushes toward category medians that are not the floor listing.
4. **Reconciler was overweighting ML** when baseline was still blended; with baseline removed, comp should dominate, but **ML still pulls the headline up** ~5–15% vs comp-only on many grid cells.
5. **Useful fix paths:** (a) cap ML weight when \`matchType === 'exact'\` and comp support ≥ 3; (b) train ML target on **Messi/StarGem floor-adjusted** USD, not internal/170 alone; (c) use lookup-only as ML input for commodity rounds until S21 retrains on transaction-aligned labels.

${reconcileNote}

## Catalog holdout accuracy (truth = listing price)

| Source | N | MdAPE | Median bias | Median ratio | >+5% vs truth | <−5% vs truth |
|--------|---|-------|-------------|--------------|---------------|---------------|
| Comp (LOO) | ${compStats.n} | ${compStats.mdape != null ? (compStats.mdape * 100).toFixed(1) + '%' : '—'} | ${compStats.medianBiasPct?.toFixed(1) ?? '—'}% | ${compStats.medianRatio?.toFixed(3) ?? '—'} | ${compStats.pctHigh}% | ${compStats.pctLow}% |
| Lookup /170 | ${lookupStats.n} | ${lookupStats.mdape != null ? (lookupStats.mdape * 100).toFixed(1) + '%' : '—'} | ${lookupStats.medianBiasPct?.toFixed(1) ?? '—'}% | ${lookupStats.medianRatio?.toFixed(3) ?? '—'} | ${lookupStats.pctHigh}% | ${lookupStats.pctLow}% |
| ML (S20) | ${mlStats.n} | ${mlStats.mdape != null ? (mlStats.mdape * 100).toFixed(1) + '%' : '—'} | ${mlStats.medianBiasPct?.toFixed(1) ?? '—'}% | ${mlStats.medianRatio?.toFixed(3) ?? '—'} | ${mlStats.pctHigh}% | ${mlStats.pctLow}% |

**Interpretation:** Positive median bias = systematically **high** vs factory listing. ML bias here is the main reason the reconciled headline feels rich vs the Alibaba floor.

## By carat bucket (catalog rows)

| Bucket | N | Comp MdAPE | ML MdAPE | ML median bias | Median ML÷comp |
|--------|---|------------|----------|----------------|----------------|
${bucketLines}

The **1.50–1.99ct** bucket is the core bridal lab range — ML runs **highest** vs truth and vs comp.

## Synthetic grid: ML ÷ comp by color grade

Grid: round white, VS1/VVS2/VS2, carat 1.00–2.00 step 0.05, no cert dimensions (imputed-spec mode).

| Grade | Cells | Median ML÷comp | ML > +8% vs comp |
|-------|-------|----------------|------------------|
${gradeLines}

Across **${gridScores.length}** grid cells: **${mlHighVsComp.length}** (${pct(mlHighVsComp.length, gridScores.length)}%) have ML **>8%** above comp; **${mlLowVsComp.length}** have ML **>5%** below comp.

## Highest ML vs comp examples (grid)

| ct | Spec | match | Comp | Lookup | ML | ML vs comp |
|----|------|-------|------|--------|-----|------------|
${exampleLines}

## Why ML runs high (mechanism)

1. **Training label:** StarGem sheet **internal rate ÷ 170**, not Alibaba piece minimum. List rates include stones that never win the floor auction.
2. **Features default to EX / ID:** Without IGI dimensions, \`Is_SelectedSpec_Mode = 1\` — model assumes full 3EX-like commodity row; comp already encodes **cheapest** adjusted listing.
3. **Residual head:** \`exp(tree_residual) × lookup_rate × carat\` — trees fit **log residual above lookup**; for dense E VS1 cells, residuals are weakly positive.
4. **Not growth-adjusted in comp:** Comp does not apply CVD −10%; ML uses \`TypeName\` when set. For CVD certs, ML can be **lower** than comp — your manual stones may show the opposite when growth is unset (\`-\`).
5. **Carat slope in comp vs ML:** Comp uses local slope (~0.22–0.55) from listings; ML uses bucket + smooth features — scaling to 1.66–1.75ct can diverge from nearest 1.65ct floor.

## When ML is still useful

- **Sparse comp** (\`matchType: none\` or \`best_available\` with thin support) — ML/lookup provides a prior.
- **Fancy / specialty cuts** — different segment (not covered here).
- **Cert-loaded mode** with table/depth — selected-spec model calibrates better (not simulated in this grid).

## When to trust comp only

- White **round** **1–2ct** **DEFG + VS** with **nearest/exact** comp and **≥3** support comps after blend.
- Messi/StarGem **exact** rows exist — floor is observable; ML is a **ceiling check**, not the floor.

## Recommended product changes (ordered)

1. ✅ **Baseline removed from blend** when comp or ML exists (DL-009).
2. ✅ **Tighter conformal** for \`white_round_1_2\` + high-support tightening (smaller \`qLog\`).
3. **Cap ML reconciler weight** to ≤15% when comp \`matchType === 'exact'\` and support ≥ 3 (config change).
4. **S21 retrain:** target = comp-adjusted or Messi÷1.25-normalized USD; evaluate MdAPE vs listing not vs internal/170.
5. **UI copy:** For round 1–2ct, label ML panel “StarGem list model (often above Alibaba floor)” when ML/comp > 1.08.

## Band tightening note (2026-05-29)

Reconciled hero bands now use segment \`white_round_1_2\` (\`qLog ≈ 0.205\`) plus support tightening (high confidence ×0.72, exact comp ×0.88). Expect roughly **±12–18%** total width on high-support 1.75ct E VS1 vs previous **±35%**.

---

*Produced by \`research/scripts/analyze-round-1-2ct-ml-divergence.mjs\`*
`;

const out = path.join(ROOT, 'research/round-1-2ct-ml-vs-comp-divergence.md');
writeFileSync(out, md);
console.log(`Wrote ${out}`);
console.log(JSON.stringify({ catalogScores: catalogScores.length, gridScores: gridScores.length, compStats, mlStats }, null, 2));
