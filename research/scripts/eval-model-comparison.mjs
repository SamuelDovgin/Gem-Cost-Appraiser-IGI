#!/usr/bin/env node
/**
 * eval-model-comparison.mjs
 * Comprehensive per-bucket evaluation of S20 / S21 / S28 on a 20% holdout.
 * Outputs a structured JSON result used to generate the markdown report.
 *
 * Usage:
 *   node research/scripts/eval-model-comparison.mjs
 */

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildStarsgemRow,
  predictStarsgemMl,
  starsgemCaratBucket,
} from './starsgem-ml-predict.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function loadJson(rel) {
  return JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
}

// ── Models ────────────────────────────────────────────────────────────────────
const s20 = loadJson('research/data/starsgem-ml-extra-trees-model-s20-specialty-tail.json');
const s21 = loadJson('research/data/starsgem-ml-extra-trees-model-s21-monotone.json');
const s28meta = loadJson('research/data/starsgem-ml-model-s28-monotone-parametric.json');

// ── Dataset ───────────────────────────────────────────────────────────────────
const allRows = loadJson('research/data/dataset-clean-training.json');

// 20% holdout: every 5th row by index (same modulus as S28 training)
const holdout = allRows.filter((_, i) => i % 5 === 0);
const train   = allRows.filter((_, i) => i % 5 !== 0);

console.error(`Dataset: ${allRows.length} total | Holdout: ${holdout.length} | Train: ${train.length}`);

// ── Helpers ───────────────────────────────────────────────────────────────────
function ape(pred, actual) {
  return Math.abs(pred - actual) / actual * 100;
}

function stats(apes) {
  if (!apes.length) return { n: 0, mape: null, mdape: null, p90ape: null, biasPct: null };
  const n = apes.length;
  const mape = apes.reduce((a, b) => a + b, 0) / n;
  const sorted = [...apes].sort((a, b) => a - b);
  const mdape = sorted[Math.floor(n / 2)];
  const p90ape = sorted[Math.floor(n * 0.9)];
  return { n, mape: +mape.toFixed(4), mdape: +mdape.toFixed(4), p90ape: +p90ape.toFixed(4) };
}

function biasStats(signedPcts) {
  if (!signedPcts.length) return null;
  return +(signedPcts.reduce((a, b) => a + b, 0) / signedPcts.length).toFixed(4);
}

// ── Predict all holdout rows ──────────────────────────────────────────────────
const results = [];
let nSkipped = 0;

for (const raw of holdout) {
  const carat = Number(raw.carat);
  const actualPrice = Number(raw.price);
  if (!carat || !actualPrice || carat <= 0 || actualPrice <= 0) { nSkipped++; continue; }

  const shape    = String(raw.shape || '').trim().toUpperCase();
  const color    = String(raw.color || '').trim().toUpperCase();
  const clarity  = String(raw.clarity || '').trim().toUpperCase();
  const cut      = String(raw.cut_raw || '-').trim();
  const typeName = String(raw.typeName || '-').trim().toUpperCase();
  const shapeStyle = String(raw.shape_style || raw.shape || '').trim().toLowerCase();
  const cb = starsgemCaratBucket(carat);
  const actualPerCt = actualPrice / carat;

  const row = buildStarsgemRow({ carat, shape, color, clarity, cut, typeName });

  const ps20 = predictStarsgemMl(row, s20);
  const ps21 = predictStarsgemMl(row, s21);

  if (!ps20?.price || !ps21?.price) { nSkipped++; continue; }

  results.push({
    // metadata
    rowNo:      raw.rowNo,
    shape,
    shapeStyle,
    color,
    clarity,
    cut,
    typeName,
    cb,
    carat,
    actualPerCt,
    // S20
    s20Price:       ps20.price,
    s20PerCt:       ps20.perCt,
    s20Ape:         ape(ps20.price, actualPrice),
    s20SignedPct:   (ps20.price - actualPrice) / actualPrice * 100,
    s20Lookup:      ps20.lookupLevel,
    s20LookupCount: ps20.lookupCount,
    // S21 (Layer 3 — same tree walking, different model)
    s21Price:       ps21.price,
    s21PerCt:       ps21.perCt,
    s21Ape:         ape(ps21.price, actualPrice),
    s21SignedPct:   (ps21.price - actualPrice) / actualPrice * 100,
    s21Lookup:      ps21.lookupLevel,
    s21LookupCount: ps21.lookupCount,
  });
}

console.error(`Evaluated: ${results.length} | Skipped: ${nSkipped}`);

// ── Breakdown helpers ─────────────────────────────────────────────────────────
function breakdownBy(key, rows) {
  const groups = {};
  for (const r of rows) {
    const k = r[key] || '(other)';
    if (!groups[k]) groups[k] = [];
    groups[k].push(r);
  }
  return groups;
}

function modelStats(rows) {
  return {
    s20: { ...stats(rows.map(r => r.s20Ape)), bias: biasStats(rows.map(r => r.s20SignedPct)) },
    s21: { ...stats(rows.map(r => r.s21Ape)), bias: biasStats(rows.map(r => r.s21SignedPct)) },
  };
}

function summaryRow(label, rows, winner) {
  const ms = modelStats(rows);
  return { label, n: rows.length, ...ms, winner };
}

// ── 1. Overall ────────────────────────────────────────────────────────────────
const overall = modelStats(results);
console.log('\n==============================');
console.log('OVERALL (holdout, Layer 3)');
console.log('==============================');
console.log(`n=${results.length}`);
console.log(`S20  MAPE=${overall.s20.mape}%  MdAPE=${overall.s20.mdape}%  p90=${overall.s20.p90ape}%  bias=${overall.s20.bias}%`);
console.log(`S21  MAPE=${overall.s21.mape}%  MdAPE=${overall.s21.mdape}%  p90=${overall.s21.p90ape}%  bias=${overall.s21.bias}%`);
console.log(`S28  MAPE=${s28meta.metrics.holdout.mape}%  MdAPE=${s28meta.metrics.holdout.mdape}%  p90=${s28meta.metrics.holdout.p90ape}%  bias=${s28meta.metrics.holdout.biasPct}%`);

// ── 2. By carat bucket ────────────────────────────────────────────────────────
console.log('\n==============================');
console.log('BY CARAT BUCKET');
console.log('==============================');
const CB_ORDER = ['1.00-1.49','1.50-1.99','2.00-2.99','3.00-3.99','4.00-4.99','5.00-9.99','10.00+'];
const byBucket = breakdownBy('cb', results);
for (const cb of CB_ORDER) {
  const rows = byBucket[cb] || [];
  if (!rows.length) continue;
  const ms = modelStats(rows);
  const s28b = (() => {
    // map bucket key to S28's key format
    const keyMap = { '1.00-1.49':'1-1.99','1.50-1.99':'1-1.99','2.00-2.99':'2-2.99','3.00-3.99':'3-4.99','4.00-4.99':'3-4.99','5.00-9.99':'5-9.99','10.00+':'10+' };
    const k = keyMap[cb];
    return s28meta.metrics.holdoutByCaratBucket?.[k] || null;
  })();
  const s28mape = s28b ? s28b.mape.toFixed(2) : 'n/a';
  const winner = ms.s20.mape <= ms.s21.mape ? 'S20' : 'S21';
  console.log(`  ${cb.padEnd(12)} n=${String(rows.length).padStart(5)}  S20=${ms.s20.mape.toFixed(2)}%  S21=${ms.s21.mape.toFixed(2)}%  S28≈${s28mape}%  best=${winner}`);
}

// ── 3. By shape_style ─────────────────────────────────────────────────────────
console.log('\n==============================');
console.log('BY SHAPE_STYLE');
console.log('==============================');
const byShape = breakdownBy('shapeStyle', results);
const shapeSorted = Object.entries(byShape).sort((a, b) => b[1].length - a[1].length);
for (const [shape, rows] of shapeSorted) {
  if (rows.length < 3) continue;
  const ms = modelStats(rows);
  const s28s = s28meta.metrics.holdoutByShape?.[shape] || null;
  const s28mape = s28s ? s28s.mape.toFixed(2) : 'n/a';
  const winner = ms.s20.mape <= ms.s21.mape ? 'S20' : 'S21';
  console.log(`  ${shape.padEnd(30)} n=${String(rows.length).padStart(5)}  S20=${ms.s20.mape.toFixed(2)}%  S21=${ms.s21.mape.toFixed(2)}%  S28≈${s28mape}%  best=${winner}`);
}

// ── 4. By color ───────────────────────────────────────────────────────────────
console.log('\n==============================');
console.log('BY COLOR');
console.log('==============================');
for (const color of ['D','E','F','G','H']) {
  const rows = results.filter(r => r.color === color);
  if (!rows.length) continue;
  const ms = modelStats(rows);
  const winner = ms.s20.mape <= ms.s21.mape ? 'S20' : 'S21';
  console.log(`  ${color}  n=${String(rows.length).padStart(5)}  S20=${ms.s20.mape.toFixed(2)}%  S21=${ms.s21.mape.toFixed(2)}%  best=${winner}`);
}

// ── 5. By clarity ─────────────────────────────────────────────────────────────
console.log('\n==============================');
console.log('BY CLARITY');
console.log('==============================');
for (const cl of ['IF','VVS1','VVS2','VS1','VS2','SI1']) {
  const rows = results.filter(r => r.clarity === cl);
  if (!rows.length) continue;
  const ms = modelStats(rows);
  const winner = ms.s20.mape <= ms.s21.mape ? 'S20' : 'S21';
  console.log(`  ${cl.padEnd(5)}  n=${String(rows.length).padStart(5)}  S20=${ms.s20.mape.toFixed(2)}%  S21=${ms.s21.mape.toFixed(2)}%  best=${winner}`);
}

// ── 6. By lookup level (coverage / extrapolation) ────────────────────────────
console.log('\n==============================');
console.log('BY LOOKUP COVERAGE (S20 lookup level)');
console.log('==============================');
const byLookup = breakdownBy('s20Lookup', results);
const lookupOrder = ['A','B','C','D','E','F','G','GLOBAL'];
for (const level of lookupOrder) {
  const rows = byLookup[level] || [];
  if (!rows.length) continue;
  const ms = modelStats(rows);
  const winner = ms.s20.mape <= ms.s21.mape ? 'S20' : 'S21';
  console.log(`  Level-${level}  n=${String(rows.length).padStart(5)}  S20=${ms.s20.mape.toFixed(2)}%  S21=${ms.s21.mape.toFixed(2)}%  best=${winner}`);
}

// ── 7. Extrapolation: GLOBAL lookup ──────────────────────────────────────────
console.log('\n==============================');
console.log('EXTRAPOLATION DETAIL (GLOBAL lookup)');
console.log('==============================');
const globalRows = results.filter(r => r.s20Lookup === 'GLOBAL');
console.log(`  GLOBAL lookup: ${globalRows.length} stones (${(100*globalRows.length/results.length).toFixed(1)}% of holdout)`);
if (globalRows.length) {
  const ms = modelStats(globalRows);
  console.log(`  S20 MAPE=${ms.s20.mape}%  bias=${ms.s20.bias}%`);
  console.log(`  S21 MAPE=${ms.s21.mape}%  bias=${ms.s21.bias}%`);

  // By shape for GLOBAL
  const gByShape = breakdownBy('shapeStyle', globalRows);
  for (const [sh, rows] of Object.entries(gByShape).sort((a,b) => b[1].length - a[1].length)) {
    const ms2 = modelStats(rows);
    console.log(`    ${sh.padEnd(30)} n=${rows.length}  S20=${ms2.s20.mape.toFixed(2)}%  S21=${ms2.s21.mape.toFixed(2)}%`);
  }

  // By carat bucket for GLOBAL
  const gByCb = breakdownBy('cb', globalRows);
  console.log('  Carat buckets with GLOBAL fallback:');
  for (const cb of CB_ORDER) {
    const rows = gByCb[cb] || [];
    if (!rows.length) continue;
    const ms2 = modelStats(rows);
    console.log(`    ${cb.padEnd(12)} n=${String(rows.length).padStart(4)}  S20=${ms2.s20.mape.toFixed(2)}%  S21=${ms2.s21.mape.toFixed(2)}%  med_carat=${(rows.reduce((a,r)=>a+r.carat,0)/rows.length).toFixed(2)}`);
  }
}

// ── 8. Low-coverage cells (count < 5) ────────────────────────────────────────
console.log('\n==============================');
console.log('LOW COVERAGE (lookup count < 5, not GLOBAL)');
console.log('==============================');
const lowCovRows = results.filter(r => r.s20LookupCount < 5 && r.s20Lookup !== 'GLOBAL');
console.log(`  Low coverage: ${lowCovRows.length} stones (${(100*lowCovRows.length/results.length).toFixed(1)}%)`);
if (lowCovRows.length) {
  const ms = modelStats(lowCovRows);
  console.log(`  S20 MAPE=${ms.s20.mape}%  bias=${ms.s20.bias}%`);
  console.log(`  S21 MAPE=${ms.s21.mape}%  bias=${ms.s21.bias}%`);
}

// ── 9. Large carat (5ct+) extrapolation ──────────────────────────────────────
console.log('\n==============================');
console.log('LARGE CARAT DETAIL (5ct+)');
console.log('==============================');
for (const cb of ['5.00-9.99', '10.00+']) {
  const rows = (byBucket[cb] || []);
  if (!rows.length) continue;
  const ms = modelStats(rows);
  const globalInBucket = rows.filter(r => r.s20Lookup === 'GLOBAL').length;
  console.log(`  ${cb}: n=${rows.length}  GLOBAL=${globalInBucket}(${(100*globalInBucket/rows.length).toFixed(0)}%)  S20=${ms.s20.mape.toFixed(2)}%  S21=${ms.s21.mape.toFixed(2)}%`);
  // by shape
  const byShp = breakdownBy('shapeStyle', rows);
  for (const [sh, srows] of Object.entries(byShp).sort((a,b)=>b[1].length-a[1].length)) {
    if (srows.length < 2) continue;
    const ms2 = modelStats(srows);
    console.log(`    ${sh.padEnd(30)} n=${srows.length}  S20=${ms2.s20.mape.toFixed(2)}%  S21=${ms2.s21.mape.toFixed(2)}%`);
  }
}

// ── 10. Where each model wins decisively ─────────────────────────────────────
console.log('\n==============================');
console.log('WHERE S20 BEATS S21 BY >3pp');
console.log('==============================');
const bucketComparison = {};
for (const [sh, rows] of Object.entries(breakdownBy('shapeStyle', results))) {
  if (rows.length < 5) continue;
  const ms = modelStats(rows);
  const delta = ms.s20.mape - ms.s21.mape;
  if (delta < -3) bucketComparison[sh] = { delta, ms };
}
for (const [sh, { delta, ms }] of Object.entries(bucketComparison).sort((a,b) => a[1].delta - b[1].delta)) {
  console.log(`  ${sh}: S20=${ms.s20.mape.toFixed(2)}% S21=${ms.s21.mape.toFixed(2)}% Δ=${delta.toFixed(2)}pp`);
}

console.log('\n==============================');
console.log('WHERE S21 BEATS S20 BY >3pp');
console.log('==============================');
const bucketComparison2 = {};
for (const [sh, rows] of Object.entries(breakdownBy('shapeStyle', results))) {
  if (rows.length < 5) continue;
  const ms = modelStats(rows);
  const delta = ms.s21.mape - ms.s20.mape;
  if (delta < -3) bucketComparison2[sh] = { delta, ms };
}
for (const [sh, { delta, ms }] of Object.entries(bucketComparison2).sort((a,b) => a[1].delta - b[1].delta)) {
  console.log(`  ${sh}: S21=${ms.s21.mape.toFixed(2)}% S20=${ms.s20.mape.toFixed(2)}% Δ=${delta.toFixed(2)}pp`);
}

// ── 11. Worst individual predictions ─────────────────────────────────────────
console.log('\n==============================');
console.log('WORST S20 PREDICTIONS (APE > 30%)');
console.log('==============================');
const worstS20 = results.filter(r => r.s20Ape > 30).sort((a,b) => b.s20Ape - a.s20Ape).slice(0,15);
for (const r of worstS20) {
  console.log(`  row=${r.rowNo}  ${r.shapeStyle} ${r.color} ${r.clarity} ${r.carat.toFixed(2)}ct  actual=${r.actualPerCt.toFixed(0)}/ct  S20=${r.s20PerCt.toFixed(0)}/ct  APE=${r.s20Ape.toFixed(1)}%  lookup=${r.s20Lookup}(${r.s20LookupCount})`);
}

console.log('\n==============================');
console.log('WORST S21 PREDICTIONS (APE > 30%)');
console.log('==============================');
const worstS21 = results.filter(r => r.s21Ape > 30).sort((a,b) => b.s21Ape - a.s21Ape).slice(0,15);
for (const r of worstS21) {
  console.log(`  row=${r.rowNo}  ${r.shapeStyle} ${r.color} ${r.clarity} ${r.carat.toFixed(2)}ct  actual=${r.actualPerCt.toFixed(0)}/ct  S21=${r.s21PerCt.toFixed(0)}/ct  APE=${r.s21Ape.toFixed(1)}%  lookup=${r.s21Lookup}(${r.s21LookupCount})`);
}

// ── 12. Spec combos with no training coverage (unseen) ───────────────────────
console.log('\n==============================');
console.log('UNSEEN SPECS IN HOLDOUT (GLOBAL lookup)');
console.log('==============================');
const globalBySpec = {};
for (const r of globalRows) {
  const k = `${r.shapeStyle}|${r.color}|${r.clarity}|${r.cb}`;
  if (!globalBySpec[k]) globalBySpec[k] = [];
  globalBySpec[k].push(r);
}
const specsSorted = Object.entries(globalBySpec).sort((a,b) => b[1].length - a[1].length);
console.log(`  ${specsSorted.length} distinct spec combos with GLOBAL fallback`);
for (const [spec, rows] of specsSorted.slice(0, 20)) {
  const ms = modelStats(rows);
  console.log(`  ${spec.padEnd(55)} n=${rows.length}  S20=${ms.s20.mape.toFixed(1)}%  S21=${ms.s21.mape.toFixed(1)}%`);
}

console.error('\nDone.');
