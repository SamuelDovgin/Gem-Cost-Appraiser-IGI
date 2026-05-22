#!/usr/bin/env node
/**
 * backtest-comp-engine.mjs — Leave-one-supplier-out backtest for comp-engine-v3.
 *
 * Usage:
 *   node research/scripts/backtest-comp-engine.mjs
 *   node research/scripts/backtest-comp-engine.mjs --segment white --verbose
 *   node research/scripts/backtest-comp-engine.mjs --worst 10
 *
 * Flags:
 *   --segment white|fancy    Run only that color family.
 *   --supplier <name>        Hold out only that supplier.
 *   --verbose                Print every prediction, not just misses.
 *   --worst <N>              Print the N worst misses (default 5).
 *   --min-support <N>        Skip holdout rows where the remaining pool has
 *                            fewer than N candidates (default 3).
 *
 * Algorithm:
 *   For each unique supplier group in the merged pool:
 *     1. Hold out all rows from that supplier.
 *     2. Load the remaining rows as the comp index.
 *     3. For each held-out row that has a well-defined spec (no caratBand,
 *        no clarityBand, priceUsd defined), query the engine.
 *     4. Record the prediction error (log-space: log(predicted/actual)).
 *
 * Metrics reported per segment:
 *   - MdAPE: median absolute percentage error.
 *   - P80 calibration: fraction of held-out rows where actual is within
 *     the engine's 80% interval [low, high].
 *   - Coverage: fraction of rows where the engine returned a non-null estimate.
 *
 * Acceptance targets:
 *   - White MdAPE ≤ 15%.
 *   - Fancy MdAPE ≤ 30% (sparser data).
 *   - P80 calibration ≥ 60% (not expecting perfect calibration with seeded sigmas).
 *   - Pink-case T16 regression: 3.80ct FVP VVS2 radiant estimate must be
 *     between $500 and $8 000 and primary comp must not be the 0.89ct brownish.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

// ── Resolve paths ──────────────────────────────────────────────────────────────
const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = resolve(__dir, '../..');
const DATA  = join(ROOT, 'research/data');

// Dynamic import so we can call loadIndex() directly with an object.
const { loadIndex, resolveAlibabaComp, supplierKey, inferFancyFamilyKey } = await import(join(ROOT, 'research/comp-engine-v3.js'));

// ── Parse flags ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function flag(name)    { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i+1] : null; }
function hasFlag(name) { return argv.includes(`--${name}`); }

const FILTER_SEGMENT  = flag('segment');     // 'white' | 'fancy' | null
const FILTER_SUPPLIER = flag('supplier');    // supplier name fragment | null
const VERBOSE         = hasFlag('verbose');
const WORST_N         = parseInt(flag('worst') || '5', 10);
const MIN_SUPPORT     = parseInt(flag('min-support') || '3', 10);

// ── Load all data ──────────────────────────────────────────────────────────────
const SUPPLEMENTAL_FILES = ['messi-comps.json', 'starsgem-comps.json', 'messi-color-comps.json'];

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const baseIndex = loadJson(join(DATA, 'alibaba-comps-index.json'));
const supplementalIndexes = SUPPLEMENTAL_FILES.map(f => {
  try { return loadJson(join(DATA, f)); } catch { return null; }
}).filter(Boolean);

// Merge all comps into a flat pool with a .supplierKey tag on each row.
// supplierKey() is imported from the engine — no local duplicate needed.
const allComps = [
  ...(baseIndex.comps || []),
  ...supplementalIndexes.flatMap(s => s.comps || []),
].map(row => ({ ...row, _supplierKey: supplierKey(row) }));

// Unique supplier groups
const allSuppliers = [...new Set(allComps.map(r => r._supplierKey))].sort();

// ── Helpers ────────────────────────────────────────────────────────────────────

function isQueryable(row) {
  // Row must be a concrete price observation, not a band/aggregate.
  if (row.caratBand || row.clarityBand) return false;
  if (!row.priceUsd || row.priceUsd <= 0) return false;
  if (!row.carat    || row.carat <= 0)    return false;
  if (!row.clarity)                        return false;
  if (!row.shape)                          return false;
  if (!row.colorFamily)                    return false;
  return true;
}

function rowToQuery(row) {
  const q = {
    carat:       row.carat,
    shape:       row.shape,
    colorFamily: row.colorFamily,
    clarity:     row.clarity,
  };
  if (row.colorFamily === 'white') {
    q.whiteGrade = row.colorNormalized || 'D';
    // Normalize composite grades to single letter for the query.
    if (q.whiteGrade === 'DEF') q.whiteGrade = 'E';
    if (q.whiteGrade === 'DE')  q.whiteGrade = 'D';
  } else {
    // Fancy: infer colorFamily_key from the comp's color field.
    q.colorFamily_key = inferFancyFamilyKey(row.color);
    if (!q.colorFamily_key) return null; // can't build query without a key
  }
  return q;
}

// inferFancyFamilyKey and supplierKey are imported from the engine.

function pctError(predicted, actual) {
  return (predicted - actual) / actual * 100;
}

function logError(predicted, actual) {
  return Math.log(predicted / actual);
}

function medianOf(arr) {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function pct(n, total) {
  return total ? (100 * n / total).toFixed(1) + '%' : 'n/a';
}

function fmt(n) {
  return n == null ? '—' : '$' + Math.round(n).toLocaleString();
}

function fmtPct(x) {
  return (x >= 0 ? '+' : '') + x.toFixed(1) + '%';
}

// ── Per-row result accumulator ─────────────────────────────────────────────────
const allResults = [];

// ── Main holdout loop ──────────────────────────────────────────────────────────

const targetSuppliers = FILTER_SUPPLIER
  ? allSuppliers.filter(s => s.includes(FILTER_SUPPLIER.toLowerCase()))
  : allSuppliers;

if (!targetSuppliers.length) {
  console.error(`No suppliers match --supplier "${FILTER_SUPPLIER}". Available: ${allSuppliers.join(', ')}`);
  process.exit(1);
}

console.log('\n════════════════════════════════════════════════════════════════════════');
console.log('COMP ENGINE v3 — LEAVE-ONE-SUPPLIER-OUT BACKTEST');
console.log('════════════════════════════════════════════════════════════════════════');
if (FILTER_SEGMENT)  console.log(`Segment filter:  ${FILTER_SEGMENT}`);
if (FILTER_SUPPLIER) console.log(`Supplier filter: ${FILTER_SUPPLIER}`);
console.log(`Suppliers to hold out: ${targetSuppliers.length} of ${allSuppliers.length}`);
console.log(`Total pool size: ${allComps.length} rows\n`);

for (const holdoutSupplier of targetSuppliers) {
  const holdoutRows   = allComps.filter(r => r._supplierKey === holdoutSupplier);
  const remainingRows = allComps.filter(r => r._supplierKey !== holdoutSupplier);

  // Only test queryable rows (no bands, has price/carat/clarity/shape).
  let testRows = holdoutRows.filter(isQueryable);

  if (FILTER_SEGMENT) testRows = testRows.filter(r => r.colorFamily === FILTER_SEGMENT);
  if (!testRows.length) continue;

  // Build a stripped index object (strip the _supplierKey tag to avoid engine confusion).
  const remainingStripped = remainingRows.map(({ _supplierKey: _sk, ...r }) => r);
  const holdoutIndex = { comps: remainingStripped };
  await loadIndex(holdoutIndex);

  console.log(`\n── Holding out: ${holdoutSupplier} (${holdoutRows.length} rows, ${testRows.length} queryable) ──`);

  let tested = 0, covered = 0, inBand = 0;
  const logErrors = [], pctErrors = [];
  const missRows = [];

  for (const row of testRows) {
    const q = rowToQuery(row);
    if (!q) continue;

    const actual = row.priceUsd;
    let result;
    try {
      result = resolveAlibabaComp(q);
    } catch (e) {
      continue;
    }

    tested++;

    if (!result || result.estimate == null) continue;

    // Check minimum support — skip if not enough candidates to trust.
    if ((result.supportComps?.length || 0) < MIN_SUPPORT) continue;

    covered++;
    const predicted = result.estimate;
    const le = logError(predicted, actual);
    const pe = pctError(predicted, actual);
    logErrors.push(le);
    pctErrors.push(pe);

    const withinBand = result.low != null && result.high != null
      && actual >= result.low && actual <= result.high;
    if (withinBand) inBand++;

    const absPct = Math.abs(pe);
    const isMiss = absPct > 30;

    missRows.push({
      row, q, result, le, pe, signedPct: pe, absPct, withinBand, actual, predicted,
      supplierKey: holdoutSupplier,
    });

    if (VERBOSE || isMiss) {
      const tag = isMiss ? '[MISS]' : '[ok]  ';
      console.log(
        `  ${tag} ${row.carat}ct ${row.shape} ${row.clarity} ${row.colorNormalized || row.color || ''} ` +
        `actual=${fmt(actual)} predicted=${fmt(predicted)} err=${fmtPct(pe)} ` +
        `[${fmt(result.low)}–${fmt(result.high)}] ` +
        `matchType=${result.matchType} support=${result.supportComps?.length}`
      );
      if (isMiss && result.warnings?.length) {
        console.log(`         warnings: ${result.warnings.join('; ')}`);
      }
    }

    allResults.push({ ...missRows[missRows.length - 1] });
  }

  // Per-supplier summary
  const mdape = medianOf(pctErrors.map(Math.abs));
  const calibration = covered ? (100 * inBand / covered).toFixed(1) + '%' : 'n/a';
  console.log(`  Tested=${tested}  Covered=${covered} (${pct(covered, tested)})  ` +
              `MdAPE=${isNaN(mdape) ? 'n/a' : mdape.toFixed(1) + '%'}  ` +
              `P80cal=${calibration}`);
}

// ── Overall summary ────────────────────────────────────────────────────────────

console.log('\n\n════════════════════════════════════════════════════════════════════════');
console.log('OVERALL RESULTS');
console.log('════════════════════════════════════════════════════════════════════════\n');

for (const segment of ['white', 'fancy']) {
  if (FILTER_SEGMENT && FILTER_SEGMENT !== segment) continue;
  const rows = allResults.filter(r => r.row.colorFamily === segment);
  if (!rows.length) { console.log(`${segment}: no results`); continue; }

  const mdape = medianOf(rows.map(r => r.absPct));
  const inBand = rows.filter(r => r.withinBand).length;
  const cal = (100 * inBand / rows.length).toFixed(1);
  const targetMdAPE = segment === 'white' ? 15 : 30;
  const targetCal   = 60;
  const mdapePass   = mdape <= targetMdAPE ? '✓' : '✗';
  const calPass     = parseFloat(cal) >= targetCal ? '✓' : '✗';

  console.log(`${segment.toUpperCase()} SEGMENT`);
  console.log(`  Rows:        ${rows.length}`);
  console.log(`  MdAPE:       ${mdape.toFixed(1)}%  (target ≤${targetMdAPE}%)  ${mdapePass}`);
  console.log(`  Bias:        ${meanBias(rows)}`);
  console.log(`  P80 cal:     ${cal}%  (target ≥${targetCal}%)  ${calPass}`);
  console.log('');
}

// ── Segment breakdown helpers ──────────────────────────────────────────────────

function meanBias(rows) {
  if (!rows.length) return 'n/a';
  const mean = rows.reduce((s, r) => s + r.signedPct, 0) / rows.length;
  const dir = mean >= 0 ? 'over' : 'under';
  return `${mean >= 0 ? '+' : ''}${mean.toFixed(1)}% (${dir}estimates on avg)`;
}

function segmentReport(rows, groupFn, groupName) {
  const groups = {};
  for (const r of rows) {
    const key = groupFn(r) || '_unknown';
    (groups[key] = groups[key] || []).push(r);
  }
  const sorted = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  console.log(`  By ${groupName}:`);
  for (const [key, g] of sorted) {
    const mdape = medianOf(g.map(r => r.absPct));
    const bias = g.reduce((s, r) => s + r.signedPct, 0) / g.length;
    const inBand = g.filter(r => r.withinBand).length;
    const p80 = (100 * inBand / g.length).toFixed(0);
    const biasSign = bias >= 0 ? '+' : '';
    console.log(`    ${String(key).padEnd(20)} n=${String(g.length).padStart(4)}  MdAPE=${mdape.toFixed(1).padStart(5)}%  bias=${biasSign}${bias.toFixed(1).padStart(5)}%  P80=${p80.padStart(3)}%`);
  }
  console.log('');
}

function caratBandLabel(row) {
  const ct = row.row.carat;
  if (ct < 1) return 'sub-1ct';
  if (ct < 2) return '1–2ct';
  if (ct < 3) return '2–3ct';
  if (ct < 5) return '3–5ct';
  return '5ct+';
}

function shapeFamilyLabel(row) {
  const s = (row.row.shape || '').toLowerCase();
  if (s === 'round') return 'round';
  if (s === 'oval') return 'oval';
  if (s === 'cushion') return 'cushion';
  if (s === 'radiant') return 'radiant';
  if (s === 'pear') return 'pear';
  if (s === 'marquise') return 'marquise';
  if (s === 'emerald') return 'emerald';
  if (s === 'asscher') return 'asscher';
  if (s === 'princess') return 'princess';
  if (s === 'heart') return 'heart';
  return s || '_unknown';
}

function clarityBandLabel(row) {
  const c = (row.row.clarity || '').toUpperCase();
  if (c.startsWith('VVS')) return 'VVS';
  if (c.startsWith('VS'))  return 'VS';
  if (c.startsWith('SI'))  return 'SI';
  if (c === 'IF' || c === 'FL') return 'IF/FL';
  return c || '_unknown';
}

console.log('SEGMENT BREAKDOWNS\n');
for (const segment of ['white', 'fancy']) {
  if (FILTER_SEGMENT && FILTER_SEGMENT !== segment) continue;
  const rows = allResults.filter(r => r.row.colorFamily === segment);
  if (!rows.length) continue;
  console.log(`── ${segment.toUpperCase()} ──`);
  segmentReport(rows, caratBandLabel, 'carat band');
  segmentReport(rows, shapeFamilyLabel, 'shape');
  segmentReport(rows, clarityBandLabel, 'clarity');
  segmentReport(rows, r => r.result.matchType, 'match type');
}

// ── Worst misses ───────────────────────────────────────────────────────────────

console.log(`WORST ${WORST_N} MISSES (by absolute % error)\n`);
const sorted = [...allResults].sort((a, b) => b.absPct - a.absPct);
for (const m of sorted.slice(0, WORST_N)) {
  console.log(
    `  ${m.absPct.toFixed(1)}% err | ${m.row.carat}ct ${m.row.shape} ${m.row.clarity} ` +
    `${m.row.colorNormalized || m.row.color || ''} | ` +
    `actual=${fmt(m.actual)} predicted=${fmt(m.predicted)} ` +
    `[${fmt(m.result.low)}–${fmt(m.result.high)}]`
  );
  console.log(`    held-out supplier: ${m.supplierKey}  matchType: ${m.result.matchType}  support: ${m.result.supportComps?.length}`);
  if (m.result.supportComps?.length) {
    const sc = m.result.supportComps[0];
    console.log(
      `    primary comp: ${sc.row.carat}ct ${sc.row.shape} ${sc.row.clarity} ` +
      `${sc.row.colorNormalized || sc.row.color || ''} ` +
      `score=${sc.score?.toFixed(3)} ` +
      (sc.scoreComponents
        ? `[eCarat=${sc.scoreComponents.eCarat?.toFixed(3)} eColor=${sc.scoreComponents.eColor?.toFixed(3)} eClarity=${sc.scoreComponents.eClarity?.toFixed(3)} eShape=${sc.scoreComponents.eShape?.toFixed(3)}]`
        : '') +
      ` parts: ${sc.parts?.join(', ') || '—'}`
    );
  }
  if (m.result.warnings?.length) {
    console.log(`    warnings: ${m.result.warnings.join('; ')}`);
  }
}

// ── T16 pink-case regression ───────────────────────────────────────────────────

console.log('\n\nT16 PINK CASE REGRESSION (3.80ct FVP VVS2 radiant)');
console.log('  (using full merged pool, no holdout)\n');

const fullIndex = {
  comps: allComps.map(({ _supplierKey: _sk, ...r }) => r),
};
await loadIndex(fullIndex);

const pinkCase = resolveAlibabaComp({
  carat: 3.8, shape: 'radiant', colorFamily: 'fancy',
  colorFamily_key: 'pink_fv', clarity: 'VVS2',
});

const pinkPrimary = pinkCase.primary?.row;
const isBrownish = pinkPrimary && Math.abs((pinkPrimary.carat || 0) - 0.89) < 0.05
  && (pinkPrimary.color || '').toLowerCase().includes('brownish');
const inRange = pinkCase.estimate >= 500 && pinkCase.estimate <= 8000;

console.log(`  matchType:  ${pinkCase.matchType}`);
console.log(`  estimate:   ${fmt(pinkCase.estimate)} [${fmt(pinkCase.low)}–${fmt(pinkCase.high)}]`);
if (pinkPrimary) {
  console.log(`  primary comp: ${pinkPrimary.carat}ct ${pinkPrimary.shape} ${pinkPrimary.clarity} ${pinkPrimary.color}`);
}
console.log(`  brownish primary: ${isBrownish ? '✗ FAIL — 0.89ct brownish is primary' : '✓ OK'}`);
console.log(`  estimate in range: ${inRange ? '✓ OK' : `✗ FAIL — ${fmt(pinkCase.estimate)} outside $500–$8000`}`);
if (pinkCase.warnings?.length) console.log(`  warnings: ${pinkCase.warnings.join('; ')}`);

console.log('\n════════════════════════════════════════════════════════════════════════');
console.log('Backtest complete.');
console.log('════════════════════════════════════════════════════════════════════════\n');
