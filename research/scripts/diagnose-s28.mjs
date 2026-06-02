#!/usr/bin/env node
/**
 * diagnose-s28.mjs
 *
 * Diagnostic for the deployed S28 monotone-parametric surface. Runs the LIVE
 * predictS28 against the clean holdout and quantifies:
 *   1. signed bias overall and by carat band
 *   2. bias by color grade and by clarity grade
 *   3. the color x carat and clarity x carat bias interaction (the suspected bug)
 *   4. carat-monotonicity violations on a synthetic spec grid (does $/ct ever
 *      decrease as carat increases for a fixed spec?)
 *   5. worst individual underpriced rows
 *
 * Writes research/data/s28-diagnostic.json and prints a summary.
 *
 * Usage: node research/scripts/diagnose-s28.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { predictS28 } from './s28-predict.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const loadJson = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));

const model = loadJson('research/data/starsgem-ml-model-s28-monotone-parametric.json');
const allRows = loadJson('research/data/dataset-clean-training.json');
const holdout = allRows.filter((_, i) => i % 5 === 0);
const pythonHoldout = allRows.filter((r) => reportHash(r) % 5 === 0);

function reportHash(row) {
  const text = String(row.reportNo || row.reportno || row.rowNo || '');
  let total = 0;
  for (const ch of text) total = (total * 131 + ch.charCodeAt(0)) % 1_000_003;
  return total;
}

function caratBand(c) {
  if (c < 1.5) return '1.00-1.49';
  if (c < 2) return '1.50-1.99';
  if (c < 3) return '2.00-2.99';
  if (c < 5) return '3.00-4.99';
  if (c < 10) return '5.00-9.99';
  return '10.00+';
}

function s28(row) {
  return predictS28({
    Carat: row.carat, carat: row.carat,
    Shape: row.shape, shape: row.shape, Shape_Style: row.shape_style, shape_style: row.shape_style,
    Color: row.color, color: row.color, Clarity: row.clarity, clarity: row.clarity,
    Cut: row.cut_raw, cut: row.cut_raw, cut_raw: row.cut_raw,
    TypeName: row.typeName, typeName: row.typeName,
    LengthWidthRatio: row.lw_ratio, lw_ratio: row.lw_ratio,
    Table_Scale: row.table_pct, table_pct: row.table_pct,
    Depth_Scale: row.depth_pct, depth_pct: row.depth_pct,
  }, model);
}

// ── Evaluate holdout ──────────────────────────────────────────────────────────
function evaluateRows(sourceRows) {
  const evaluated = [];
  let skippedRows = 0;
  for (const r of sourceRows) {
    const carat = Number(r.carat), price = Number(r.price);
    if (!carat || !price || carat <= 0 || price <= 0) { skippedRows++; continue; }
    const out = s28(r);
    if (!out?.price) { skippedRows++; continue; }
    const signed = (out.price - price) / price * 100;
    evaluated.push({
      carat, band: caratBand(carat),
      color: String(r.color || '').toUpperCase(),
      clarity: String(r.clarity || '').toUpperCase(),
      shape: String(r.shape_style || r.shape || '').toLowerCase(),
      actualPerCt: price / carat, predPerCt: out.upc,
      signed, ape: Math.abs(signed), under: out.price < price,
    });
  }
  return { rows: evaluated, skipped: skippedRows };
}

const rowIndexEval = evaluateRows(holdout);
const rows = rowIndexEval.rows;
const skipped = rowIndexEval.skipped;
const pythonHoldoutEval = evaluateRows(pythonHoldout);

function agg(rs) {
  const n = rs.length;
  if (!n) return null;
  const sorted = rs.map(r => r.ape).sort((a, b) => a - b);
  return {
    n,
    mape: +(rs.reduce((a, b) => a + b.ape, 0) / n).toFixed(2),
    mdape: +sorted[Math.floor(n / 2)].toFixed(2),
    bias: +(rs.reduce((a, b) => a + b.signed, 0) / n).toFixed(2),
    underPct: +(rs.filter(r => r.under).length / n * 100).toFixed(1),
  };
}

function groupAgg(rs, keyFn) {
  const g = {};
  for (const r of rs) { (g[keyFn(r)] ||= []).push(r); }
  const out = {};
  for (const k of Object.keys(g)) out[k] = agg(g[k]);
  return out;
}

const BANDS = ['1.00-1.49', '1.50-1.99', '2.00-2.99', '3.00-4.99', '5.00-9.99', '10.00+'];
const COLORS = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];
const CLARITIES = ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2'];

// ── Interaction: bias by color x carat band ───────────────────────────────────
function interaction(dimVals, dimKey) {
  const out = {};
  for (const v of dimVals) {
    out[v] = {};
    for (const b of BANDS) {
      const rs = rows.filter(r => r[dimKey] === v && r.band === b);
      out[v][b] = rs.length ? agg(rs).bias : null;
    }
  }
  return out;
}

// ── Carat monotonicity violation scan on a synthetic spec grid ────────────────
// For each (shape round_standard, color, clarity), sweep carat and check whether
// predicted $/ct ever DECREASES as carat increases.
function monoScan() {
  const sweep = [1, 1.5, 2, 3, 4, 5, 7, 10, 15, 20, 30];
  const specs = [];
  for (const color of COLORS) {
    for (const clarity of CLARITIES) {
      specs.push({ color, clarity });
    }
  }
  let violating = 0;
  const examples = [];
  for (const s of specs) {
    const curve = sweep.map(c => ({
      c,
      upc: s28({ carat: c, shape: 'ROUND', shape_style: 'round_standard', color: s.color, clarity: s.clarity, cut_raw: '-', typeName: 'CVD' })?.upc ?? null,
    }));
    let viol = false;
    let worstDrop = 0;
    for (let i = 1; i < curve.length; i++) {
      if (curve[i].upc != null && curve[i - 1].upc != null && curve[i].upc < curve[i - 1].upc - 1e-6) {
        viol = true;
        worstDrop = Math.max(worstDrop, (curve[i - 1].upc - curve[i].upc) / curve[i - 1].upc * 100);
      }
    }
    if (viol) {
      violating++;
      examples.push({
        spec: `ROUND ${s.color} ${s.clarity}`,
        worstDropPct: +worstDrop.toFixed(1),
        curve: curve.map(p => ({ c: p.c, upc: p.upc == null ? null : +p.upc.toFixed(1) })),
      });
    }
  }
  examples.sort((a, b) => b.worstDropPct - a.worstDropPct);
  return { totalSpecs: specs.length, violatingSpecs: violating, violatingPct: +(violating / specs.length * 100).toFixed(1), examples: examples.slice(0, 8) };
}

const worst = [...rows].sort((a, b) => a.signed - b.signed).slice(0, 15).map(r => ({
  spec: `${r.shape} ${r.color} ${r.clarity} ${r.carat.toFixed(2)}ct`,
  actualPerCt: +r.actualPerCt.toFixed(0), predPerCt: +r.predPerCt.toFixed(0), signedPct: +r.signed.toFixed(1),
}));

const report = {
  date: new Date().toISOString().slice(0, 10),
  predictor: 'research/scripts/s28-predict.mjs (live)',
  artifact: 'research/data/starsgem-ml-model-s28-monotone-parametric.json',
  holdout: { evaluated: rows.length, skipped },
  overall: agg(rows),
  liveVsPythonParity: {
    holdout: 'reportHash(row) % 5 === 0',
    evaluated: pythonHoldoutEval.rows.length,
    skipped: pythonHoldoutEval.skipped,
    liveNode: agg(pythonHoldoutEval.rows),
    pythonArtifact: model.metrics?.holdout ?? null,
    delta: model.metrics?.holdout ? {
      mape: +(agg(pythonHoldoutEval.rows).mape - model.metrics.holdout.mape).toFixed(4),
      bias: +(agg(pythonHoldoutEval.rows).bias - model.metrics.holdout.biasPct).toFixed(4),
    } : null,
  },
  byCaratBand: Object.fromEntries(BANDS.map(b => [b, agg(rows.filter(r => r.band === b))]).filter(([, v]) => v)),
  byColor: groupAgg(rows.filter(r => COLORS.includes(r.color)), r => r.color),
  byClarity: groupAgg(rows.filter(r => CLARITIES.includes(r.clarity)), r => r.clarity),
  byShape: Object.fromEntries(Object.entries(groupAgg(rows, r => r.shape)).filter(([, v]) => v.n >= 20).sort((a, b) => b[1].n - a[1].n)),
  biasColorByCarat: interaction(COLORS, 'color'),
  biasClarityByCarat: interaction(CLARITIES, 'clarity'),
  caratMonotonicity: monoScan(),
  worstUnderpriced: worst,
};

writeFileSync(path.join(ROOT, 'research/data/s28-diagnostic.json'), JSON.stringify(report, null, 2));

// ── Print summary ─────────────────────────────────────────────────────────────
const pct = (v) => v == null ? '   n/a' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
console.log(`\nS28 LIVE DIAGNOSTIC  (holdout n=${rows.length}, skipped=${skipped})`);
console.log('OVERALL', JSON.stringify(report.overall));
console.log('LIVE/PYTHON PARITY', JSON.stringify(report.liveVsPythonParity));

console.log('\nBIAS BY CARAT BAND:');
for (const b of BANDS) if (report.byCaratBand[b]) console.log(`  ${b.padEnd(12)} bias=${pct(report.byCaratBand[b].bias)}  mape=${report.byCaratBand[b].mape}%  under=${report.byCaratBand[b].underPct}%  n=${report.byCaratBand[b].n}`);

console.log('\nBIAS BY COLOR (worse color -> more underpriced expected):');
for (const c of COLORS) if (report.byColor[c]) console.log(`  ${c}  bias=${pct(report.byColor[c].bias)}  mape=${report.byColor[c].mape}%  n=${report.byColor[c].n}`);

console.log('\nBIAS BY CLARITY:');
for (const c of CLARITIES) if (report.byClarity[c]) console.log(`  ${c.padEnd(5)} bias=${pct(report.byClarity[c].bias)}  mape=${report.byClarity[c].mape}%  n=${report.byClarity[c].n}`);

console.log('\nBIAS HEATMAP — color x carat band (the interaction bug):');
console.log('       ' + BANDS.map(b => b.padStart(9)).join(''));
for (const c of COLORS) {
  if (!report.byColor[c]) continue;
  console.log(`  ${c}   ` + BANDS.map(b => pct(report.biasColorByCarat[c][b]).padStart(9)).join(''));
}

console.log('\nBIAS HEATMAP — clarity x carat band:');
console.log('       ' + BANDS.map(b => b.padStart(9)).join(''));
for (const c of CLARITIES) {
  if (!report.byClarity[c]) continue;
  console.log(`  ${c.padEnd(4)}` + BANDS.map(b => pct(report.biasClarityByCarat[c][b]).padStart(9)).join(''));
}

console.log(`\nCARAT MONOTONICITY SCAN (ROUND, all color x clarity, swept 1->30ct):`);
console.log(`  ${report.caratMonotonicity.violatingSpecs}/${report.caratMonotonicity.totalSpecs} specs (${report.caratMonotonicity.violatingPct}%) have a DECREASING $/ct segment`);
for (const e of report.caratMonotonicity.examples) console.log(`    ${e.spec.padEnd(16)} worst per-step drop ${e.worstDropPct}%`);

console.log('\nWORST 8 UNDERPRICED HOLDOUT ROWS:');
for (const w of worst.slice(0, 8)) console.log(`  ${w.spec.padEnd(34)} actual=$${w.actualPerCt}/ct pred=$${w.predPerCt}/ct (${w.signedPct}%)`);

console.log('\nWrote research/data/s28-diagnostic.json');
