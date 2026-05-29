#!/usr/bin/env node
/**
 * S22 evaluation: apply Layer-4 PAV (isotonic post-process) to S20 ExtraTrees.
 *
 * Implements recommendation #1 from ml-grade-monotonicity-analysis.md:
 *   "Isotonic post-process on clarity (and color) per (shape, carat_bucket)
 *    after ML prediction."
 *
 * S22 = S20 ExtraTrees + predictStarsgemMlMonotone (Layer-4 PAV)
 * No retraining. No lookup smoothing. Just the post-process.
 *
 * Outputs: research/data/s22-evaluation.json
 */

import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildStarsgemRow,
  predictStarsgemMl,
  predictStarsgemMlMonotone,
  starsgemCaratBucket,
  starsgemNorm,
} from './starsgem-ml-predict.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

// ── Models ────────────────────────────────────────────────────────────────────
const s20 = JSON.parse(readFileSync(path.join(ROOT, 'research/data/starsgem-ml-extra-trees-model-s20-specialty-tail.json'), 'utf8'));
const s21 = JSON.parse(readFileSync(path.join(ROOT, 'research/data/starsgem-ml-extra-trees-model-s21-monotone.json'), 'utf8'));
const testRows = JSON.parse(readFileSync('/tmp/starsgem_test_rows.json', 'utf8'));

// ── Constants ─────────────────────────────────────────────────────────────────
const CLARITY_ORDER = ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2'];
const COLOR_ORDER   = ['D', 'E', 'F', 'G', 'H'];
const SHAPES = ['ROUND', 'OVAL', 'MARQUISE', 'PEAR', 'CUSHION', 'EMERALD', 'RADIANT', 'PRINCESS', 'HEART'];
const CARATS = [0.5, 0.7, 1, 1.5, 2, 3, 4.08, 5, 8, 10, 12];
const PINNED = [
  { id: 'marquise-408-e', label: 'Marquise 4.08ct E', carat: 4.08, shape: 'MARQUISE', color: 'E', cut: '-' },
  { id: 'heart-3-e',      label: 'Heart 3ct E',       carat: 3,    shape: 'HEART',    color: 'E', cut: '-' },
  { id: 'round-2-e',      label: 'Round 2ct E',       carat: 2,    shape: 'ROUND',    color: 'E', cut: 'ID' },
  { id: 'oval-3-d',       label: 'Oval 3ct D',        carat: 3,    shape: 'OVAL',     color: 'D', cut: 'ID' },
];

function round2(x) { return Math.round(x * 100) / 100; }
function round4(x) { return Math.round(x * 10000) / 10000; }

// ── Prediction helpers ────────────────────────────────────────────────────────
function predictRaw(model, opts) {
  const row = buildStarsgemRow({
    typeName: opts.typeName ?? '-',
    polish:   opts.polish   ?? 'EX',
    symmetry: opts.symmetry ?? 'EX',
    ...opts,
  });
  return predictStarsgemMl(row, model);
}

function predictPav(model, opts) {
  const row = buildStarsgemRow({
    typeName: opts.typeName ?? '-',
    polish:   opts.polish   ?? 'EX',
    symmetry: opts.symmetry ?? 'EX',
    ...opts,
  });
  return predictStarsgemMlMonotone(row, model);
}

// ── Violation counting ────────────────────────────────────────────────────────
function countClarityViolations(ladder) {
  // lower index = higher clarity = should have higher $/ct
  // violation: later entry has HIGHER price than earlier (price rises as quality drops)
  let n = 0;
  for (let i = 1; i < ladder.length; i++) {
    if (ladder[i] > ladder[i - 1] * 1.001) n++;
  }
  return n;
}

function countColorViolations(ladder) {
  // D < E < F < G < H — earlier in ORDER = better color = higher $/ct
  // violation: later color has HIGHER $/ct than earlier (same as clarity)
  let n = 0;
  for (let i = 1; i < ladder.length; i++) {
    if (ladder[i] > ladder[i - 1] * 1.001) n++;
  }
  return n;
}

// ── Monotonicity sweep ────────────────────────────────────────────────────────
function sweepMonotonicity(model, usePav) {
  let clarViol = 0;
  let colorViol = 0;
  const byShape  = {};
  const byCarat  = {};
  const byBucket = {};

  for (const shape of SHAPES) {
    const cut = (shape === 'HEART' || shape === 'MARQUISE') ? '-' : 'ID';
    let shapeViol = 0;
    for (const carat of CARATS) {
      const bucket = starsgemCaratBucket(carat);
      let caratViol = 0;

      for (const color of COLOR_ORDER) {
        const pred = usePav ? predictPav : predictRaw;
        const clarLadder = CLARITY_ORDER.map(clarity =>
          pred(model, { carat, shape, color, clarity, cut }).perCt
        );
        const cv = countClarityViolations(clarLadder);
        clarViol   += cv;
        shapeViol  += cv;
        caratViol  += cv;
        byBucket[bucket] = (byBucket[bucket] || 0) + cv;
      }

      for (const clarity of CLARITY_ORDER) {
        const pred = usePav ? predictPav : predictRaw;
        const colorLadder = COLOR_ORDER.map(color =>
          pred(model, { carat, shape, color, clarity, cut }).perCt
        );
        colorViol += countColorViolations(colorLadder);
      }

      byCarat[String(carat)] = (byCarat[String(carat)] || 0) + caratViol;
    }
    byShape[shape] = shapeViol;
  }

  const clarSteps  = SHAPES.length * CARATS.length * COLOR_ORDER.length * (CLARITY_ORDER.length - 1);
  const colorSteps = SHAPES.length * CARATS.length * CLARITY_ORDER.length * (COLOR_ORDER.length - 1);

  return {
    clarityViolations: clarViol,
    colorViolations:   colorViol,
    clarityInversionPct: round2(100 * clarViol / clarSteps),
    colorInversionPct:   round2(100 * colorViol / colorSteps),
    clarStepsTotal:  clarSteps,
    colorStepsTotal: colorSteps,
    byShape,
    byCarat,
    byBucket,
  };
}

// ── MAPE evaluation on held-out test set ──────────────────────────────────────
function evaluateMape(model, usePav) {
  const KNOWN_SHAPES = new Set((model.features?.categories?.Shape || []).map(s => String(s).trim().toUpperCase()));

  let sumApe = 0;
  let sumAe  = 0;
  let n      = 0;
  const byBucket = {};
  const errors   = [];

  for (const r of testRows) {
    const shape = starsgemNorm(r.Shape).toUpperCase();
    if (KNOWN_SHAPES.size > 0 && !KNOWN_SHAPES.has(shape) && shape !== '') continue;

    const opts = {
      carat:    r.Carat,
      shape,
      color:    starsgemNorm(r.Color),
      clarity:  starsgemNorm(r.Clarity),
      cut:      starsgemNorm(r.Cut),
      typeName: starsgemNorm(r.TypeName),
      polish:   starsgemNorm(r.Polish),
      symmetry: starsgemNorm(r.Symmetry),
      length:   r.Length   ?? null,
      width:    r.Width    ?? null,
      height:   r.Height   ?? null,
      tablePct: r.Table_Scale ?? null,
      depthPct: r.Depth_Scale ?? null,
    };

    const result = usePav ? predictPav(model, opts) : predictRaw(model, opts);
    if (!result?.price || !r.actualPrice) continue;

    const actual    = r.actualPrice;
    const predicted = result.price;
    const ape       = Math.abs(predicted - actual) / actual * 100;
    const ae        = Math.abs(predicted - actual);

    sumApe += ape;
    sumAe  += ae;
    n++;

    const bucket = r.carat_bucket || starsgemCaratBucket(r.Carat);
    if (!byBucket[bucket]) byBucket[bucket] = { sumApe: 0, sumAe: 0, n: 0 };
    byBucket[bucket].sumApe += ape;
    byBucket[bucket].sumAe  += ae;
    byBucket[bucket].n++;

    errors.push({ shape, carat: r.Carat, color: opts.color, clarity: opts.clarity, ape, predicted, actual });
  }

  const mape    = round4(sumApe / n);
  const mae     = round2(sumAe  / n);
  const byBucketOut = {};
  for (const [b, v] of Object.entries(byBucket)) {
    byBucketOut[b] = { mape: round4(v.sumApe / v.n), mae: round2(v.sumAe / v.n), n: v.n };
  }

  // Worst 10 cases
  errors.sort((a, b) => b.ape - a.ape);

  return { mape, mae, n, byBucket: byBucketOut, worst10: errors.slice(0, 10) };
}

// ── Pinned ladders ────────────────────────────────────────────────────────────
function evalPinnedLadders(s20, s21) {
  return PINNED.map(pin => {
    const s22ClarLadder = CLARITY_ORDER.map(clarity => {
      const p = predictPav(s20, { ...pin, clarity });
      return { clarity, perCt: round2(p.perCt), price: round2(p.price) };
    });
    const s21ClarLadder = CLARITY_ORDER.map(clarity => {
      const p = predictPav(s21, { ...pin, clarity });
      return { clarity, perCt: round2(p.perCt), price: round2(p.price) };
    });
    const s20ClarLadder = CLARITY_ORDER.map(clarity => {
      const p = predictRaw(s20, { ...pin, clarity });
      return { clarity, perCt: round2(p.perCt), price: round2(p.price) };
    });

    function violations(ladder) {
      const out = [];
      for (let i = 1; i < ladder.length; i++) {
        if (ladder[i].perCt > ladder[i-1].perCt * 1.001) {
          out.push(`${ladder[i-1].clarity}→${ladder[i].clarity} (+${round2((ladder[i].perCt/ladder[i-1].perCt-1)*100)}%)`);
        }
      }
      return out;
    }

    return {
      ...pin,
      s20Raw:  { ladder: s20ClarLadder, violations: violations(s20ClarLadder) },
      s22Pav:  { ladder: s22ClarLadder, violations: violations(s22ClarLadder) },
      s21Pav:  { ladder: s21ClarLadder, violations: violations(s21ClarLadder) },
    };
  });
}

// ── Color ladder analysis (per-shape headline) ───────────────────────────────
function evalColorLadder(s20, s21) {
  const results = [];
  for (const shape of SHAPES) {
    const cut  = (shape === 'HEART' || shape === 'MARQUISE') ? '-' : 'ID';
    const carat = 2;
    const clarity = 'VS1';
    const s22 = COLOR_ORDER.map(color => ({ color, perCt: round2(predictPav(s20, { carat, shape, color, clarity, cut }).perCt) }));
    const s21r = COLOR_ORDER.map(color => ({ color, perCt: round2(predictPav(s21, { carat, shape, color, clarity, cut }).perCt) }));
    const s20r = COLOR_ORDER.map(color => ({ color, perCt: round2(predictRaw(s20, { carat, shape, color, clarity, cut }).perCt) }));
    const s22Viol  = countColorViolations(s22.map(x => x.perCt));
    const s21Viol  = countColorViolations(s21r.map(x => x.perCt));
    const s20Viol  = countColorViolations(s20r.map(x => x.perCt));
    results.push({ shape, carat, clarity, cut, s20Raw: { ladder: s20r, viol: s20Viol }, s22Pav: { ladder: s22, viol: s22Viol }, s21Pav: { ladder: s21r, viol: s21Viol } });
  }
  return results;
}

// ── PAV cost analysis: how often does PAV change S20 predictions? ─────────────
function pavCostAnalysis() {
  let nChanged    = 0;
  let nWorse      = 0;
  let nTotal      = 0;
  let sumApeRaw   = 0;
  let sumApePav   = 0;

  const KNOWN_SHAPES = new Set((s20.features?.categories?.Shape || []).map(s => String(s).trim().toUpperCase()));

  for (const r of testRows) {
    const shape = starsgemNorm(r.Shape).toUpperCase();
    if (KNOWN_SHAPES.size > 0 && !KNOWN_SHAPES.has(shape) && shape !== '') continue;

    const opts = {
      carat:    r.Carat,
      shape,
      color:    starsgemNorm(r.Color),
      clarity:  starsgemNorm(r.Clarity),
      cut:      starsgemNorm(r.Cut),
      typeName: starsgemNorm(r.TypeName),
      polish:   starsgemNorm(r.Polish),
      symmetry: starsgemNorm(r.Symmetry),
      length:   r.Length   ?? null,
      width:    r.Width    ?? null,
      height:   r.Height   ?? null,
      tablePct: r.Table_Scale ?? null,
      depthPct: r.Depth_Scale ?? null,
    };

    const raw = predictRaw(s20, opts);
    const pav = predictPav(s20, opts);
    if (!raw?.price || !pav?.price || !r.actualPrice) continue;

    const actual   = r.actualPrice;
    const apeRaw   = Math.abs(raw.price - actual) / actual * 100;
    const apePav   = Math.abs(pav.price - actual) / actual * 100;
    const diffPct  = Math.abs(pav.price - raw.price) / raw.price * 100;

    sumApeRaw += apeRaw;
    sumApePav += apePav;
    nTotal++;
    if (diffPct > 0.1) {
      nChanged++;
      if (apePav > apeRaw) nWorse++;
    }
  }

  return {
    n: nTotal,
    nChanged,
    nChangedPct: round2(100 * nChanged / nTotal),
    nWorse,
    nWorsePct:   round2(100 * nWorse / nChanged),
    s20RawMape:  round4(sumApeRaw / nTotal),
    s22PavMape:  round4(sumApePav / nTotal),
    mapeDeltaPp: round4((sumApePav - sumApeRaw) / nTotal),
  };
}

// ── Run everything ────────────────────────────────────────────────────────────
console.log('Running monotonicity sweeps…');
const monoS20Raw = sweepMonotonicity(s20, false);
console.log(`  S20 raw: clarity=${monoS20Raw.clarityViolations} color=${monoS20Raw.colorViolations}`);
const monoS22Pav = sweepMonotonicity(s20, true);
console.log(`  S22 (S20+PAV): clarity=${monoS22Pav.clarityViolations} color=${monoS22Pav.colorViolations}`);
const monoS21Pav = sweepMonotonicity(s21, true);
console.log(`  S21 (LightGBM+PAV): clarity=${monoS21Pav.clarityViolations} color=${monoS21Pav.colorViolations}`);

console.log('Running MAPE evaluations…');
const mapeS20Raw = evaluateMape(s20, false);
console.log(`  S20 raw MAPE: ${mapeS20Raw.mape}% (n=${mapeS20Raw.n})`);
const mapeS22Pav = evaluateMape(s20, true);
console.log(`  S22 (S20+PAV) MAPE: ${mapeS22Pav.mape}% (n=${mapeS22Pav.n})`);
const mapeS21Raw = evaluateMape(s21, false);
console.log(`  S21 raw MAPE: ${mapeS21Raw.mape}% (n=${mapeS21Raw.n})`);
const mapeS21Pav = evaluateMape(s21, true);
console.log(`  S21 (LightGBM+PAV) MAPE: ${mapeS21Pav.mape}% (n=${mapeS21Pav.n})`);

console.log('Running PAV cost analysis…');
const pavCost = pavCostAnalysis();
console.log(`  PAV changed ${pavCost.nChanged}/${pavCost.n} rows, ${pavCost.nWorse} worsened`);
console.log(`  MAPE delta from PAV alone: ${pavCost.mapeDeltaPp > 0 ? '+' : ''}${pavCost.mapeDeltaPp} pp`);

console.log('Computing pinned ladders…');
const pinned = evalPinnedLadders(s20, s21);

console.log('Computing color ladders…');
const colorLadders = evalColorLadder(s20, s21);

const payload = {
  generatedAt: new Date().toISOString().slice(0, 10),
  models: {
    s20: { name: s20.modelName, type: 'extratrees', trees: s20.treeCount },
    s21: { name: s21.modelName, type: s21.modelType, trees: s21.treeCount },
    s22: { name: 'S22 — S20 ExtraTrees + Layer-4 PAV', type: 'extratrees+pav', trees: s20.treeCount },
  },
  monotonicity: {
    s20Raw:  monoS20Raw,
    s22Pav:  monoS22Pav,
    s21Pav:  monoS21Pav,
  },
  mape: {
    s20Raw:  mapeS20Raw,
    s21Raw:  mapeS21Raw,
    s22Pav:  mapeS22Pav,
    s21Pav:  mapeS21Pav,
  },
  pavCost,
  pinnedLadders: pinned,
  colorLadders,
};

const OUT = path.join(ROOT, 'research/data/s22-evaluation.json');
writeFileSync(OUT, JSON.stringify(payload, null, 2));
console.log(`\nWrote ${OUT}`);
console.log('\n=== SUMMARY ===');
const hdr = 'Model'.padEnd(25);
console.log(`${hdr} RawMAPE    PAV_MAPE   Clarity Viol  Color Viol`);
console.log(`${'S20 (ExtraTrees, raw)'.padEnd(25)} ${mapeS20Raw.mape.toFixed(4)}%  ${'-'.padEnd(9)}  ${monoS20Raw.clarityViolations} (${monoS20Raw.clarityInversionPct}%)  ${monoS20Raw.colorViolations}`);
console.log(`${'S22 (S20 + PAV)'.padEnd(25)} ${mapeS20Raw.mape.toFixed(4)}%  ${mapeS22Pav.mape.toFixed(4)}%  ${monoS22Pav.clarityViolations} (${monoS22Pav.clarityInversionPct}%)  ${monoS22Pav.colorViolations}`);
console.log(`${'S21 (LightGBM, raw)'.padEnd(25)} ${mapeS21Raw.mape.toFixed(4)}%  ${'-'.padEnd(9)}  ${'-'.padEnd(12)} -`);
console.log(`${'S21 (LightGBM + PAV)'.padEnd(25)} ${mapeS21Raw.mape.toFixed(4)}%  ${mapeS21Pav.mape.toFixed(4)}%  ${monoS21Pav.clarityViolations} (${monoS21Pav.clarityInversionPct}%)  ${monoS21Pav.colorViolations}`);
