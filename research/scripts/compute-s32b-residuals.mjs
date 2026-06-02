#!/usr/bin/env node
/**
 * Compute OOF (out-of-fold) residual targets for S32-B CatBoost training.
 *
 * Uses cross-fitted S32-A predictions to compute leakage-safe residuals.
 * Only rows with n_full >= r_min are included (warm cells only).
 *
 * Output: research/data/s32b-residual-targets.json
 *
 * Usage:
 *   node research/scripts/compute-s32b-residuals.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { starsgemNorm } from './starsgem-ml-predict.mjs';
import { predictS28 } from './s28-predict.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DATA = path.join(ROOT, 'research/data');
const OUT = path.join(DATA, 's32b-residual-targets.json');

// ─── Config ──────────────────────────────────────────────────────────────────

const N_FOLDS = 5;
const R_MIN = 10;  // minimum full-cell support for residual training
const CARAT_BANDS = [
  { lo: 1.0, hi: 1.49, label: '1.00-1.49' },
  { lo: 1.5, hi: 1.99, label: '1.50-1.99' },
  { lo: 2.0, hi: 2.99, label: '2.00-2.99' },
  { lo: 3.0, hi: 3.99, label: '3.00-3.99' },
  { lo: 4.0, hi: 4.99, label: '4.00-4.99' },
  { lo: 5.0, hi: 9.99, label: '5.00-9.99' },
  { lo: 10.0, hi: 99.99, label: '10.00+' },
];

const COLORS = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];
const CLARITIES = ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadJson(name) {
  return JSON.parse(readFileSync(path.join(DATA, name), 'utf8'));
}

function reportHash(row) {
  const text = String(row.reportNo ?? row.reportno ?? row.rowNo ?? '');
  let total = 0;
  for (const ch of text) total = (total * 131 + ch.charCodeAt(0)) % 1_000_003;
  return total;
}

function caratBand(carat) {
  for (const band of CARAT_BANDS) {
    if (carat >= band.lo && carat <= band.hi) return band.label;
  }
  return carat < 1 ? '<1.00' : '10.00+';
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

// ─── Row normalization ───────────────────────────────────────────────────────

function benchmarkCellKey(row) {
  return [
    String(row.shape_style || 'round_standard').trim().toLowerCase(),
    starsgemNorm(row.color),
    starsgemNorm(row.clarity),
    caratBand(Number(row.carat)),
  ].join('||');
}

function parent1Key(row) {
  return [
    String(row.shape_style || 'round_standard').trim().toLowerCase(),
    starsgemNorm(row.color),
    starsgemNorm(row.clarity),
  ].join('||');
}

function parent2Key(row) {
  return [
    String(row.shape_style || 'round_standard').trim().toLowerCase(),
    starsgemNorm(row.color),
  ].join('||');
}

function parent3Key(row) {
  return String(row.shape_style || 'round_standard').trim().toLowerCase();
}

function normalizeRow(row, s28Model) {
  const carat = Number(row.carat);
  const price = Number(row.price);
  if (!Number.isFinite(carat) || carat <= 0 || !Number.isFinite(price) || price <= 0) return null;
  const color = starsgemNorm(row.color);
  const clarity = starsgemNorm(row.clarity);
  if (!COLORS.includes(color) || !CLARITIES.includes(clarity)) return null;

  const s28Input = {
    carat, Carat: carat,
    shape_style: row.shape_style, Shape_Style: row.shape_style,
    color: row.color, Color: row.color,
    clarity: row.clarity, Clarity: row.clarity,
    cut_raw: row.cut_raw, Cut: row.cut_raw,
    polish: row.polish, symmetry: row.symmetry,
    typeName: row.typeName, TypeName: row.typeName,
    lw_ratio: row.lw_ratio, table_pct: row.table_pct, depth_pct: row.depth_pct,
  };
  const s28 = predictS28(s28Input, s28Model);
  if (!s28?.upc || s28.upc <= 0) return null;

  const logActualUpc = Math.log(price / carat);
  const logS28Upc = Math.log(s28.upc);
  const residual = logActualUpc - logS28Upc;

  return {
    carat, price, upc: price / carat,
    shape_style: String(row.shape_style || 'round_standard').trim().toLowerCase(),
    color, clarity,
    band: caratBand(carat),
    cellKey: benchmarkCellKey(row),
    parent1Key: parent1Key(row),
    parent2Key: parent2Key(row),
    parent3Key: parent3Key(row),
    s28Upc: s28.upc, s28LogUpc: logS28Upc,
    logActualUpc, residual,
    reportHashVal: reportHash(row),
    // Features for CatBoost
    cut_raw: row.cut_raw,
    typeName: row.typeName || 'CVD',
    lw_ratio: row.lw_ratio,
    table_pct: row.table_pct,
    depth_pct: row.depth_pct,
    polish: row.polish,
    symmetry: row.symmetry,
  };
}

// ─── Anchor computation (same as S32-A trainer) ──────────────────────────────

function computeAnchorStats(rows) {
  const collector = new Map();
  for (const row of rows) {
    addToCollector(collector, row.cellKey, row.residual);
    addToCollector(collector, row.parent1Key, row.residual);
    addToCollector(collector, row.parent2Key, row.residual);
    addToCollector(collector, row.parent3Key, row.residual);
    addToCollector(collector, '__global__', row.residual);
  }
  const stats = new Map();
  for (const [key, residuals] of collector) {
    stats.set(key, { n: residuals.length, delta: median(residuals) });
  }
  return stats;
}

function addToCollector(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function s32aPredict(row, stats, K_anchor, level_cap, A_cap) {
  const levelKeys = [
    { level: 1, key: row.cellKey },
    { level: 2, key: row.parent1Key },
    { level: 3, key: row.parent2Key },
    { level: 4, key: row.parent3Key },
    { level: 5, key: '__global__' },
  ];

  let anchorOffset = 0;
  let usedLevel = null;
  let anchorN = 0;

  for (const lk of levelKeys) {
    const hit = stats.get(lk.key);
    if (hit && hit.n > 0 && hit.delta != null) {
      const cap = level_cap[lk.level - 1] ?? 1.0;
      const K = K_anchor[lk.level - 1] ?? 10;
      const wAnchor = Math.min(cap, hit.n / (hit.n + K));
      anchorOffset = clamp(wAnchor * hit.delta, -A_cap, A_cap);
      usedLevel = lk.level;
      anchorN = hit.n;
      break;
    }
  }

  const s32aLogUpc = row.s28LogUpc + anchorOffset;
  return { s32aLogUpc, anchorOffset, anchorLevel: usedLevel, anchorN };
}

// ─── Cross-fitted residual computation ───────────────────────────────────────

function computeOofResiduals(allRows, s28Model) {
  const rows = allRows.map((r) => normalizeRow(r, s28Model)).filter(Boolean);

  // Use best params from S32-A
  const K_anchor = [8, 12, 18, 28, 50];
  const level_cap = [1, 0.65, 0.4, 0.2, 0.08];
  const A_cap = 0.1;

  // Shuffle deterministically
  const shuffled = [...rows].sort((a, b) => a.reportHashVal - b.reportHashVal);
  const foldSize = Math.ceil(shuffled.length / N_FOLDS);

  // Compute full support counts for r_min filtering
  const fullSupport = new Map();
  for (const row of rows) {
    fullSupport.set(row.cellKey, (fullSupport.get(row.cellKey) || 0) + 1);
  }

  const results = [];

  for (let fold = 0; fold < N_FOLDS; fold++) {
    const foldStart = fold * foldSize;
    const foldEnd = Math.min(foldStart + foldSize, shuffled.length);
    const heldOut = shuffled.slice(foldStart, foldEnd);
    const trainFolds = [...shuffled.slice(0, foldStart), ...shuffled.slice(foldEnd)];

    const stats = computeAnchorStats(trainFolds);

    for (const row of heldOut) {
      const pred = s32aPredict(row, stats, K_anchor, level_cap, A_cap);
      const nFull = fullSupport.get(row.cellKey) || 0;

      // Only include warm cells for CatBoost training
      if (nFull < R_MIN) continue;

      // Residual = log(actual) - S32-A prediction
      const yResid = row.logActualUpc - pred.s32aLogUpc;

      results.push({
        // Keys for identification
        rowNo: row.rowNo || null,
        carat: row.carat,
        shape_style: row.shape_style,
        color: row.color,
        clarity: row.clarity,
        band: row.band,
        cellKey: row.cellKey,

        // Target
        yResid: +yResid.toFixed(8),

        // Context
        logActualUpc: +row.logActualUpc.toFixed(8),
        s28LogUpc: +row.s28LogUpc.toFixed(8),
        s32aLogUpc: +pred.s32aLogUpc.toFixed(8),
        anchorOffset: +pred.anchorOffset.toFixed(8),
        anchorLevel: pred.anchorLevel,
        anchorN: pred.anchorN,
        nFull,

        // Features for CatBoost
        cut_raw: row.cut_raw || '-',
        typeName: row.typeName || 'CVD',
        lw_ratio: row.lw_ratio,
        table_pct: row.table_pct,
        depth_pct: row.depth_pct,
        polish: row.polish || 'EX',
        symmetry: row.symmetry || 'EX',
      });
    }
  }

  return results;
}

// ─── Main ────────────────────────────────────────────────────────────────────

const allRows = loadJson('dataset-clean-training.json');
const s28Model = loadJson('starsgem-ml-model-s28-monotone-parametric.json');

console.log(`Loaded ${allRows.length} rows`);
const residuals = computeOofResiduals(allRows, s28Model);
console.log(`Computed ${residuals.length} OOF residuals (n_full >= ${R_MIN})`);

// Stats
const absResid = residuals.map((r) => Math.abs(r.yResid));
absResid.sort((a, b) => a - b);
console.log(`Residual stats: mean(abs)=${(absResid.reduce((a,b)=>a+b,0)/absResid.length).toFixed(4)} median(abs)=${absResid[Math.floor(absResid.length/2)].toFixed(4)} p90(abs)=${absResid[Math.floor(absResid.length*0.9)].toFixed(4)}`);

writeFileSync(OUT, `${JSON.stringify(residuals, null, 2)}\n`);
console.log(`Wrote ${path.relative(ROOT, OUT)}`);
