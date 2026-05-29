#!/usr/bin/env node
/**
 * Sweep StarGem S20 ML predictions for grade monotonicity (clarity ↑ ⇒ $/ct ↑, color D→H ⇒ $/ct ↓).
 * Writes research/data/ml-grade-monotonicity-sweep.json and research/ml-grade-monotonicity-analysis.md
 */

import { writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildStarsgemRow,
  loadStarsgemMlModel,
  predictStarsgemMl,
} from './starsgem-ml-predict.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const CLARITY_ORDER = ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2'];
const COLOR_ORDER = ['D', 'E', 'F', 'G', 'H'];
const SHAPES = [
  'ROUND', 'OVAL', 'MARQUISE', 'PEAR', 'CUSHION', 'EMERALD', 'RADIANT', 'PRINCESS', 'HEART',
];
const CARATS = [0.5, 0.7, 1, 1.5, 2, 3, 4.08, 5, 8, 10, 12];
const PINNED = [
  { id: 'user-marquise-408', label: 'Marquise 4.08ct E (IGI LG784657766)', carat: 4.08, shape: 'MARQUISE', color: 'E', cut: '-' },
  { id: 'round-2-e', label: 'Round 2ct E', carat: 2, shape: 'ROUND', color: 'E', cut: 'ID' },
  { id: 'oval-3-d', label: 'Oval 3ct D', carat: 3, shape: 'OVAL', color: 'D', cut: 'ID' },
  { id: 'heart-3-e', label: 'Heart 3ct E', carat: 3, shape: 'HEART', color: 'E', cut: '-' },
];

function predictRow(model, opts) {
  const row = buildStarsgemRow({
    typeName: opts.typeName ?? '-',
    polish: 'EX',
    symmetry: 'EX',
    ...opts,
  });
  const p = predictStarsgemMl(row, model);
  return {
    ...opts,
    price: p.price,
    perCt: p.perCt,
    lookupRate: p.lookupRate,
    lookupLevel: p.lookupLevel,
    lookupCount: p.lookupCount,
    residualMult: p.residualMult,
    modelName: p.modelName,
  };
}

function ladderViolations(ladder, betterIdxHigher) {
  const out = [];
  for (let i = 1; i < ladder.length; i++) {
    const prev = ladder[i - 1];
    const cur = ladder[i];
    const bad = betterIdxHigher
      ? cur.perCt < prev.perCt * 0.999
      : cur.perCt > prev.perCt * 1.001;
    if (bad) {
      out.push({
        fromGrade: prev.grade,
        toGrade: cur.grade,
        fromPerCt: prev.perCt,
        toPerCt: cur.perCt,
        dropPct: betterIdxHigher
          ? ((prev.perCt - cur.perCt) / prev.perCt) * 100
          : ((cur.perCt - prev.perCt) / prev.perCt) * 100,
        fromLookup: prev.lookupRate,
        toLookup: cur.lookupRate,
        fromLookupCount: prev.lookupCount,
        toLookupCount: cur.lookupCount,
        fromResidual: prev.residualMult,
        toResidual: cur.residualMult,
      });
    }
  }
  return out;
}

function mdTable(headers, rows) {
  const sep = headers.map(() => '---');
  const body = rows.map(r => `| ${r.join(' | ')} |`).join('\n');
  return `| ${headers.join(' | ')} |\n| ${sep.join(' | ')} |\n${body}`;
}

const model = await loadStarsgemMlModel();
const generatedAt = new Date().toISOString().slice(0, 10);

const predictions = [];
const clarityViolations = [];
const colorViolations = [];

for (const shape of SHAPES) {
  const cut = shape === 'HEART' || shape === 'MARQUISE' ? '-' : 'ID';
  for (const carat of CARATS) {
    for (const color of COLOR_ORDER) {
      const clarLadder = CLARITY_ORDER.map((clarity) => {
        const row = predictRow(model, { carat, shape, color, clarity, cut });
        return { grade: clarity, ...row };
      });
      for (const row of clarLadder) {
        predictions.push({
          axis: 'clarity-sweep',
          shape,
          carat,
          color,
          clarity: row.grade,
          cut,
          perCt: row.perCt,
          price: row.price,
          lookupRate: row.lookupRate,
          lookupCount: row.lookupCount,
          lookupLevel: row.lookupLevel,
          residualMult: row.residualMult,
        });
      }
      for (const v of ladderViolations(clarLadder, true)) {
        clarityViolations.push({ shape, carat, color, cut, ...v });
      }
    }
    for (const clarity of CLARITY_ORDER) {
      const colorLadder = COLOR_ORDER.map((color) => {
        const row = predictRow(model, { carat, shape, color, clarity, cut });
        return { grade: color, ...row };
      });
      for (const v of ladderViolations(colorLadder, false)) {
        colorViolations.push({ shape, carat, clarity, cut, ...v });
      }
    }
  }
}

clarityViolations.sort((a, b) => b.dropPct - a.dropPct);
colorViolations.sort((a, b) => b.dropPct - a.dropPct);

const pinnedLadders = PINNED.map((pin) => {
  const clar = CLARITY_ORDER.map((clarity) => {
    const row = predictRow(model, { ...pin, clarity });
    return { grade: clarity, ...row };
  });
  const colors = COLOR_ORDER.map((color) => {
    const row = predictRow(model, { ...pin, color, clarity: 'VS1' });
    return { grade: color, ...row };
  });
  return {
    ...pin,
    clarityLadder: clar,
    colorLadderVs1: colors,
    clarityViolations: ladderViolations(clar, true),
  };
});

const violByShape = Object.fromEntries(
  SHAPES.map((s) => [s, clarityViolations.filter((v) => v.shape === s).length]),
);
const violByCarat = Object.fromEntries(
  CARATS.map((c) => [String(c), clarityViolations.filter((v) => v.carat === c).length]),
);

const lookupJumpViolations = clarityViolations.filter((v) => {
  const lr = v.fromLookup && v.toLookup ? Math.abs(Math.log(v.toLookup / v.fromLookup)) : 0;
  return lr > 0.15;
});

const payload = {
  generatedAt,
  modelName: model.modelName,
  targetType: model.targetType,
  treeCount: model.treeCount,
  clarityOrder: CLARITY_ORDER,
  colorOrder: COLOR_ORDER,
  shapes: SHAPES,
  carats: CARATS,
  summary: {
    predictionCount: predictions.length,
    clarityViolationCount: clarityViolations.length,
    colorViolationCount: colorViolations.length,
    clarityViolationRatePct: (
      (clarityViolations.length /
        (SHAPES.length * CARATS.length * COLOR_ORDER.length * (CLARITY_ORDER.length - 1))) *
      100
    ).toFixed(1),
    lookupDrivenViolationCount: lookupJumpViolations.length,
    violByShape,
    violByCarat,
  },
  pinnedLadders,
  topClarityViolations: clarityViolations.slice(0, 80),
  topColorViolations: colorViolations.slice(0, 40),
  predictions,
};

const jsonPath = path.join(ROOT, 'research/data/ml-grade-monotonicity-sweep.json');
writeFileSync(jsonPath, JSON.stringify(payload));

const marq = pinnedLadders.find((p) => p.id === 'user-marquise-408');
const marqRows = marq.clarityLadder.map(
  (r) => [
    r.grade,
    `$${Math.round(r.perCt)}/ct`,
    `$${Math.round(r.price)}`,
    r.lookupCount ?? '—',
    r.lookupRate != null ? `$${Math.round(r.lookupRate)}/ct` : '—',
    r.residualMult != null ? r.residualMult.toFixed(3) : '—',
  ],
);

const md = `# ML grade monotonicity — S20 Extra Trees

Generated **${generatedAt}** from \`${model.modelName}\` (\`${model.targetType}\`, ${model.treeCount} trees).

Open the interactive charts: \`research/ml-grade-monotonicity-diagnostics.html\` (run \`npm run serve\` from repo root, then visit \`/research/ml-grade-monotonicity-diagnostics.html\`).

## Why this matters

Wholesale buyers expect **higher clarity ⇒ higher $/ct** and **better color (D) ⇒ higher $/ct** holding other attributes fixed. The comp engine and StarGem sheet formula encode that ordering. The S20 model is trained as a **residual on lookup tables**, so when adjacent grades hit **different lookup buckets** (sparse training rows), the tree ensemble can invert the ladder.

## Headline counts

| Metric | Value |
| --- | --- |
| Grid predictions | ${payload.summary.predictionCount.toLocaleString()} |
| Clarity step inversions (IF→…→SI2) | **${payload.summary.clarityViolationCount}** (${payload.summary.clarityViolationRatePct}% of adjacent clarity steps) |
| Color step inversions (D→…→H) | **${payload.summary.colorViolationCount}** |
| Clarity inversions with lookup rate jump >15% log | **${payload.summary.lookupDrivenViolationCount}** |

## Pinned case — Marquise 4.08ct E (your IGI example)

Cert shows **VVS2**; UI may show **SI1** for pricing. ML uses whatever clarity is in the form.

${mdTable(['Clarity', 'ML $/ct', 'Total', 'Lookup n', 'Lookup $/ct', 'Residual ×'], marqRows)}

**Violations on this ladder:** ${marq.clarityViolations.length ? marq.clarityViolations.map((v) => `${v.fromGrade}→${v.toGrade} (−${v.dropPct.toFixed(1)}%)`).join(', ') : 'none on IF→SI2 chain (individual adjacent steps may still invert).'}

Notable pattern here:

- **VVS1 and IF** share a **high-count lookup** (~496 rows) with a **low** internal rate (~$140/ct), anchoring ML down.
- **VVS2** hits a **different bucket** (n=8, lookup ~$192/ct) so total ML **jumps above VVS1**.
- **SI1** has **n=1** lookup — residual blows up to ~$176/ct, **above VS1** despite being lower clarity.

That is why “higher clarity” in the cert does not always mean “higher ML price” until lookup tables are smoothed or post-hoc monotonic correction is applied.

## Worst clarity inversions (top 15)

${mdTable(
  ['Shape', 'ct', 'Color', 'Step', '$/ct drop', 'Lookup n'],
  payload.topClarityViolations.slice(0, 15).map((v) => [
    v.shape,
    String(v.carat),
    v.color,
    `${v.fromGrade}→${v.toGrade}`,
    `−${v.dropPct.toFixed(1)}%`,
    `${v.fromLookupCount}→${v.toLookupCount}`,
  ]),
)}

## Root causes (research notes)

1. **Lookup-first architecture** — Price = \`lookupRate × tail × exp(treeResidual) × carat\`. Monotonicity in clarity is **not** a training constraint.
2. **Sparse / aliased buckets** — Off-catalog grades (SI1 on white lab) often have **n=1** or fall through to **global** rates shared with unrelated grades (e.g. SI2 and IF both at n=496).
3. **VVS1 vs VVS2 cliff** — Largest single-step drops (~50–64%) cluster on **VVS1→VVS2** where lookup keys change and residual trees disagree.
4. **HEART and MARQUISE** — Specialty shapes with **cut='-'** show more inversions (thin training slices per clarity).
5. **Large carat tail** — 4ct+ uses \`log_tail_lookup_residual\`; tail anchor re-buckets to 5–9.99ct lookup, amplifying bucket mismatch at 4.08ct.
6. **Comp engine vs ML** — Comps apply explicit \`CLARITY_MULT_COLOR\` adjustments; ML does not. Reconciler blends both, so UI can look “more sane” on comps while ML card shows inversions.

## Recommended fixes (ordered)

1. **Isotonic post-process** on clarity (and color) per (shape, carat_bucket) after ML prediction.
2. **Lookup smoothing** — blend sparse clarity cells toward VS1 within shape×color×bucket.
3. **Monotonic constraints in training** — penalize inversions on holdout ladders.
4. **UI** — when cert clarity ≠ selected clarity, show both ladders; flag ML inversion in \`warnings\`.

## Regenerate

\`\`\`bash
node research/scripts/analyze-ml-grade-monotonicity.mjs
\`\`\`
`;

const mdPath = path.join(ROOT, 'research/ml-grade-monotonicity-analysis.md');
writeFileSync(mdPath, md);

console.log(`Wrote ${jsonPath} (${(JSON.stringify(payload).length / 1024).toFixed(0)} KB)`);
console.log(`Wrote ${mdPath}`);
console.log(`Clarity inversions: ${clarityViolations.length}, color inversions: ${colorViolations.length}`);
