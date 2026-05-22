#!/usr/bin/env node
/** One-off breakdown for P1 fancy research doc — LOO by hue/intensity. */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = join(ROOT, 'research/data');
const { loadIndex, resolveAlibabaComp, supplierKey, inferFancyFamilyKey, parseFancyColorLabel } =
  await import(join(ROOT, 'research/comp-engine-v3.js'));

function rowIdentity(row) {
  return [
    row.productId || '',
    row.shape, row.color, row.clarity, row.carat, row.priceUsd, row.section,
  ].map(v => String(v ?? '').toLowerCase().trim()).join('|');
}

const base = JSON.parse(readFileSync(join(DATA, 'alibaba-comps-index.json'), 'utf8'));
const supp = ['messi-comps.json', 'starsgem-comps.json', 'messi-color-comps.json']
  .map(f => { try { return JSON.parse(readFileSync(join(DATA, f), 'utf8')); } catch { return null; } })
  .filter(Boolean);
const merged = [...(base.comps || []), ...supp.flatMap(s => s.comps || [])].map(r => ({ ...r, _sk: supplierKey(r) }));
const seen = new Map();
for (const r of merged) {
  const id = rowIdentity(r);
  if (!seen.has(id)) seen.set(id, r);
}
const allComps = [...seen.values()];

function isQueryable(row) {
  return !row.caratBand && !row.clarityBand && row.priceUsd > 0 && row.carat > 0 &&
    row.clarity && row.shape && row.colorFamily;
}
function rowToQuery(row) {
  const q = { carat: row.carat, shape: row.shape, colorFamily: row.colorFamily, clarity: row.clarity };
  if (row.colorFamily === 'fancy') {
    q.colorFamily_key = inferFancyFamilyKey(row.color);
    if (!q.colorFamily_key) return null;
  }
  return q;
}
function median(arr) {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

const results = [];
for (const row of allComps.filter(isQueryable).filter(r => r.colorFamily === 'fancy')) {
  loadIndex({ comps: allComps.filter(r => r._sk !== row._sk) });
  const q = rowToQuery(row);
  if (!q) continue;
  const res = resolveAlibabaComp(q);
  if (res.estimate == null) continue;
  if ((res.supportComps?.length || 0) < 3) continue; // match backtest min-support
  const signedPct = 100 * (res.estimate - row.priceUsd) / row.priceUsd;
  const parsed = parseFancyColorLabel(q.colorFamily_key);
  const colorLower = (row.color || '').toLowerCase();
  results.push({
    hue: parsed.hue,
    inten: parsed.intensityKey,
    matchType: res.matchType,
    absPct: Math.abs(signedPct),
    signedPct,
    shape: row.shape,
    brownish: colorLower.includes('brownish'),
    brown: parsed.hue === 'brown',
    blue: parsed.hue === 'blue',
    pinkFv: q.colorFamily_key === 'pink_fv',
  });
}

function report(groupFn, label) {
  const g = {};
  for (const r of results) {
    const k = groupFn(r);
    (g[k] = g[k] || []).push(r);
  }
  console.log(`By ${label}:`);
  for (const [k, arr] of Object.entries(g).sort((a, b) => b[1].length - a[1].length)) {
    const mdape = median(arr.map(x => x.absPct));
    const bias = arr.reduce((s, x) => s + x.signedPct, 0) / arr.length;
    const sign = bias >= 0 ? '+' : '';
    console.log(`  ${String(k).padEnd(18)} n=${String(arr.length).padStart(4)}  MdAPE=${mdape.toFixed(1).padStart(5)}%  bias=${sign}${bias.toFixed(1)}%`);
  }
  console.log('');
}

console.log(`Total fancy holdout predictions: ${results.length}\n`);
report(r => r.hue, 'hue');
report(r => r.inten, 'intensity');
report(r => `${r.hue}_${r.inten}`, 'hue × intensity');
report(r => r.matchType, 'matchType');
report(r => r.brownish ? 'brownish_label' : 'clean_label', 'held-out modifier');
report(r => r.shape, 'shape');

const baPinkFv = results.filter(r => r.matchType === 'best_available' && r.pinkFv);
console.log(`pink_fv + best_available: n=${baPinkFv.length} MdAPE=${median(baPinkFv.map(x => x.absPct)).toFixed(1)}% bias=+${(baPinkFv.reduce((s,x)=>s+x.signedPct,0)/baPinkFv.length).toFixed(1)}%`);
