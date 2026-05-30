/**
 * benchmark-all-models.mjs
 *
 * Runs S22 (ExtraTrees + S21 fallback), S23 (LightGBM + S21 fallback),
 * and S25 (Hierarchical Parametric) on the full 12,843-row clean training
 * dataset and reports MAPE by model and by shape.
 *
 * Usage:
 *   node --input-type=module research/scripts/benchmark-all-models.mjs
 */

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildStarsgemRow,
  predictStarsgemMl,
  starsgemNorm,
  starsgemCaratBucket,
} from './starsgem-ml-predict.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '../..');
const DATA      = path.join(ROOT, 'research', 'data');

// ─── Load models ────────────────────────────────────────────────────────────
function loadJson(rel) {
  return JSON.parse(readFileSync(path.join(DATA, rel), 'utf8'));
}

const s20 = loadJson('starsgem-ml-extra-trees-model-s20-specialty-tail.json');
const s21 = loadJson('starsgem-ml-extra-trees-model-s21-monotone.json');
const s23 = loadJson('starsgem-ml-extra-trees-model-s23-grade-agnostic-anchor.json');
const s25 = loadJson('starsgem-ml-model-s25-parametric.json');

// ─── Helper: is a prediction hitting the global fallback? ────────────────────
function isEffectivelyGlobal(pred) {
  return !pred || pred.lookupLevel === 'GLOBAL' || (pred.lookupCount ?? 0) <= 3;
}

// ─── S21 fallback logic (same as index.html) ──────────────────────────────
function s22Prediction(row) {
  const pred = predictStarsgemMl(row, s20);
  if (pred && isEffectivelyGlobal(pred)) {
    const fallback = predictStarsgemMl(row, s21);
    if (fallback && (fallback.lookupCount ?? 0) > (pred.lookupCount ?? 0) && fallback.price > pred.price) {
      return { ...fallback, usedS21Fallback: true };
    }
  }
  return { ...pred, usedS21Fallback: false };
}

function s23Prediction(row) {
  const pred = predictStarsgemMl(row, s23);
  if (pred && isEffectivelyGlobal(pred)) {
    const fallback = predictStarsgemMl(row, s21);
    if (fallback && (fallback.lookupCount ?? 0) > (pred.lookupCount ?? 0) && fallback.price > pred.price) {
      return { ...fallback, usedS21Fallback: true };
    }
  }
  return { ...pred, usedS21Fallback: false };
}

// ─── S25 parametric prediction (mirrors index.html predictS25) ───────────────
const CLARITY_NORM = {
  'IF':1,'VVS1':1,'VVS2':1,'VS1':1,'VS2':1,'SI1':1,'SI2':1,'VVS':1,'VS':1,
};

function s25Prediction(row, model) {
  const shape   = (row.Shape || '').toUpperCase();
  const color   = (row.Color || '').toUpperCase();
  const clarity = starsgemNorm(row.Clarity);
  const carat   = Number(row.Carat);
  const cutRaw  = (row.Cut || '-').toUpperCase();
  if (!carat || carat <= 0) return null;

  const colorRankMap   = model.colorRank   || {};
  const clarityRankMap = model.clarityRank || {};
  const colorRank   = colorRankMap[color]   ?? 3;
  const clarityRank = clarityRankMap[clarity] ?? 3.5;

  let cutKey = '-';
  if (/^(ID|IDEAL)$/.test(cutRaw))          cutKey = 'ID';
  else if (/^(EX|EXCELLENT)$/.test(cutRaw)) cutKey = 'EX';
  else if (/^(VG|VERY.GOOD)$/.test(cutRaw)) cutKey = 'VG';
  else if (/^(G|GD|GOOD)$/.test(cutRaw))    cutKey = 'G';
  else if (/^FAIR$/.test(cutRaw))            cutKey = 'FAIR';

  const beta      = model.betaGlobal ?? -0.12;
  const dColor    = model.deltaColor   ?? 0;
  const dClarity  = model.deltaClarity ?? -0.06;
  const specKey   = `${shape}||${color}||${clarity}`;
  const shapeBl   = model.shapeBaseline?.[shape] ?? model.shapeBaseline?.['_global'] ?? 4.88;
  const specEps   = model.specEps?.[specKey] ?? 0;
  const cutAdj    = model.cutAdj?.[cutKey] ?? 0;
  const specCount = model.specCount?.[specKey] ?? 0;
  const hasSpec   = specEps !== 0 || specCount > 0;

  const logUpc  = shapeBl + specEps + beta * Math.log(carat)
                + dColor * colorRank + dClarity * clarityRank + cutAdj;
  const upc     = Math.exp(logUpc);
  const price   = upc * carat;

  return {
    price,
    upc,
    specKey,
    specCount,
    coverage: hasSpec ? 'spec' : 'gradient',
  };
}

// ─── Load test data ───────────────────────────────────────────────────────────
const rawData   = JSON.parse(readFileSync(path.join(DATA, 'dataset-clean-training.json'), 'utf8'));
const allRows   = Array.isArray(rawData) ? rawData : rawData.rows ?? rawData.data ?? [];

console.log(`\nLoaded ${allRows.length} training rows.\n`);

// ─── Run predictions ──────────────────────────────────────────────────────────
const SHAPES = new Set(['ROUND','PEAR','OVAL','MARQUISE','RADIANT','PRINCESS','EMERALD','CUSHION','HEART','ASSCHER','SQUARE']);

// Accumulators: { n, sumApe, s21Fallbacks, globalHits, specHits, gradientHits }
const totals = {
  s22: { n:0, sumApe:0, s21:0, global:0 },
  s23: { n:0, sumApe:0, s21:0, global:0 },
  s25: { n:0, sumApe:0, spec:0, gradient:0 },
};
const byShape = {};

let processed = 0;
let skipped   = 0;

for (const raw of allRows) {
  const carat   = Number(raw.carat);
  const actual  = Number(raw.price);  // total USD
  const shape   = (raw.shape || '').toUpperCase();
  const color   = (raw.color || '').toUpperCase();
  const clarity = (raw.clarity || '').toUpperCase();
  const cut     = (raw.cut_raw || '-');

  if (!carat || !actual || carat <= 0 || actual <= 0) { skipped++; continue; }

  const row = buildStarsgemRow({
    carat,
    shape,
    color,
    clarity,
    cut: cut === '-' ? 'EX' : cut,  // default EX when ungraded (matches training)
    typeName: 'CVD',
  });

  // S22
  const p22 = s22Prediction(row);
  if (p22?.price > 0) {
    const ape = Math.abs(p22.price - actual) / actual * 100;
    totals.s22.n++;
    totals.s22.sumApe += ape;
    if (p22.usedS21Fallback) totals.s22.s21++;
    if (isEffectivelyGlobal(p22)) totals.s22.global++;
  }

  // S23
  const p23 = s23Prediction(row);
  if (p23?.price > 0) {
    const ape = Math.abs(p23.price - actual) / actual * 100;
    totals.s23.n++;
    totals.s23.sumApe += ape;
    if (p23.usedS21Fallback) totals.s23.s21++;
    if (isEffectivelyGlobal(p23)) totals.s23.global++;
  }

  // S25
  const p25 = s25Prediction(row, s25);
  if (p25?.price > 0) {
    const ape = Math.abs(p25.price - actual) / actual * 100;
    totals.s25.n++;
    totals.s25.sumApe += ape;
    if (p25.coverage === 'spec') totals.s25.spec++;
    else totals.s25.gradient++;
  }

  // Per-shape
  if (!byShape[shape]) {
    byShape[shape] = {
      s22: { n:0, sumApe:0 }, s23: { n:0, sumApe:0 }, s25: { n:0, sumApe:0 },
      n: 0,
    };
  }
  const sh = byShape[shape];
  sh.n++;
  if (p22?.price > 0) { sh.s22.n++; sh.s22.sumApe += Math.abs(p22.price - actual) / actual * 100; }
  if (p23?.price > 0) { sh.s23.n++; sh.s23.sumApe += Math.abs(p23.price - actual) / actual * 100; }
  if (p25?.price > 0) { sh.s25.n++; sh.s25.sumApe += Math.abs(p25.price - actual) / actual * 100; }

  processed++;
}

// ─── Report ───────────────────────────────────────────────────────────────────
function mape(acc) { return acc.n > 0 ? (acc.sumApe / acc.n).toFixed(2) : 'N/A'; }
function pct(a, b) { return b > 0 ? (100*a/b).toFixed(1)+'%' : '—'; }

console.log('══════════════════════════════════════════════════════════════════');
console.log('OVERALL MAPE');
console.log('══════════════════════════════════════════════════════════════════');
console.log(`  S22 (ExtraTrees + S21 fallback):   ${mape(totals.s22)}%`);
console.log(`    └─ S21 fallback triggered:        ${totals.s22.s21} / ${totals.s22.n} rows (${pct(totals.s22.s21, totals.s22.n)})`);
console.log(`    └─ Remaining global hits:         ${totals.s22.global} / ${totals.s22.n} rows (${pct(totals.s22.global, totals.s22.n)})`);
console.log();
console.log(`  S23 (LightGBM + S21 fallback):     ${mape(totals.s23)}%`);
console.log(`    └─ S21 fallback triggered:        ${totals.s23.s21} / ${totals.s23.n} rows (${pct(totals.s23.s21, totals.s23.n)})`);
console.log(`    └─ Remaining global hits:         ${totals.s23.global} / ${totals.s23.n} rows (${pct(totals.s23.global, totals.s23.n)})`);
console.log();
console.log(`  S25 (Parametric, 100% coverage):   ${mape(totals.s25)}%`);
console.log(`    └─ Spec-anchored rows:            ${totals.s25.spec} / ${totals.s25.n} rows (${pct(totals.s25.spec, totals.s25.n)})`);
console.log(`    └─ Gradient-only rows:            ${totals.s25.gradient} / ${totals.s25.n} rows (${pct(totals.s25.gradient, totals.s25.n)})`);
console.log();
console.log(`  Skipped: ${skipped} rows (missing carat or price)`);

console.log('\n══════════════════════════════════════════════════════════════════');
console.log('MAPE BY SHAPE');
console.log('══════════════════════════════════════════════════════════════════');
console.log(`${'Shape'.padEnd(12)} ${'n'.padStart(5)}  ${'S22'.padStart(8)}  ${'S23'.padStart(8)}  ${'S25'.padStart(8)}  Winner`);
console.log('─'.repeat(65));

// Sort by stone count descending
const shapeEntries = Object.entries(byShape).sort((a, b) => b[1].n - a[1].n);
for (const [shape, sh] of shapeEntries) {
  const m22 = sh.s22.n > 0 ? sh.s22.sumApe / sh.s22.n : Infinity;
  const m23 = sh.s23.n > 0 ? sh.s23.sumApe / sh.s23.n : Infinity;
  const m25 = sh.s25.n > 0 ? sh.s25.sumApe / sh.s25.n : Infinity;
  const best = Math.min(m22, m23, m25);
  const winner = best === m22 ? 'S22' : best === m23 ? 'S23' : 'S25';
  const fmt = v => isFinite(v) ? v.toFixed(2)+'%' : 'N/A';
  console.log(`${shape.padEnd(12)} ${String(sh.n).padStart(5)}  ${fmt(m22).padStart(8)}  ${fmt(m23).padStart(8)}  ${fmt(m25).padStart(8)}  ${winner}`);
}

// ─── S25 Monotonicity Check ──────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════════');
console.log('S25 MONOTONICITY CHECK — 1ct ROUND');
console.log('══════════════════════════════════════════════════════════════════');
const testRow1ct = buildStarsgemRow({ carat: 1.0, shape: 'ROUND', color: 'D', clarity: 'VS1', cut: 'EX' });

// Clarity sweep (D fixed)
console.log('\nClarity ladder (D color):');
const clarityOrder = ['IF','VVS1','VVS2','VS1','VS2','SI1','SI2'];
let prevCl = Infinity;
let clOk = true;
for (const cl of clarityOrder) {
  const r = { ...testRow1ct, Clarity: cl };
  const p = s25Prediction(r, s25);
  const ok = p.price <= prevCl + 0.01;
  if (!ok) clOk = false;
  console.log(`  ${cl.padEnd(5)} $${p.price.toFixed(2)}  $${p.upc.toFixed(2)}/ct  ${ok ? '✓' : '✗ VIOLATION'}`);
  prevCl = p.price;
}
console.log(clOk ? '\n  ✓ Clarity monotone' : '\n  ✗ Clarity violations!');

// Color sweep (VS1 fixed)
console.log('\nColor ladder (VS1 clarity):');
const colorOrder = ['D','E','F','G','H','I','J'];
let prevCo = Infinity;
let coOk = true;
for (const co of colorOrder) {
  const r = { ...testRow1ct, Color: co };
  const p = s25Prediction(r, s25);
  const ok = p.price <= prevCo + 0.01;
  if (!ok) coOk = false;
  const sign = p.price <= prevCo + 0.01;
  // In lab diamonds, D should be highest (or comparable to E/F). deltaColor > 0 means D < G.
  console.log(`  ${co.padEnd(3)} $${p.price.toFixed(2)}  $${p.upc.toFixed(2)}/ct  ${sign ? '✓ non-increasing' : '✗ VIOLATION (D < G — color inverted!)'}`);
  prevCo = p.price;
}
// Note: color should be NON-INCREASING from D→J (D most expensive)
// But deltaColor > 0 makes D cheapest — flag this.
console.log('\n  NOTE: deltaColor = +' + s25.deltaColor.toFixed(4) + ' means D < G (inverted!)');
console.log('  Color gradient direction in S25 is WRONG. See doc for explanation and fix path.');

// Carat sweep (D VS1 fixed)
console.log('\nCarat extrapolation (D VS1, across 1ct → 10ct):');
for (const ct of [1, 1.5, 2, 3, 4, 5, 6, 8, 10]) {
  const r = buildStarsgemRow({ carat: ct, shape: 'ROUND', color: 'D', clarity: 'VS1', cut: 'EX' });
  const p = s25Prediction(r, s25);
  console.log(`  ${String(ct).padEnd(4)}ct  $${p.price.toFixed(0).padStart(6)} total  $${p.upc.toFixed(0).padStart(5)}/ct  cov=${p.coverage}`);
}

// Heart D VS1 extrapolation (the original problem case)
console.log('\nHeart D VS1 — extrapolation vs S21 lookup:');
for (const ct of [1, 2, 3, 4, 5, 5.21, 6, 8]) {
  const r = buildStarsgemRow({ carat: ct, shape: 'HEART', color: 'D', clarity: 'VS1', cut: '-' });
  const p25p = s25Prediction(r, s25);
  const s21p = predictStarsgemMl(r, s21);
  console.log(`  ${String(ct).padEnd(5)}ct  S25=$${(p25p?.price||0).toFixed(0).padStart(6)}  S21=$${(s21p?.price||0).toFixed(0).padStart(6)}  cov=${p25p?.coverage}`);
}

console.log('\n══════════════════════════════════════════════════════════════════\n');
