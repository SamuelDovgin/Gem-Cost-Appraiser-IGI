#!/usr/bin/env node
/**
 * R0.2 conformal calibration fitter.
 *
 * Fits split-conformal log residual widths from the frozen supplier split.
 * Default mode is a deterministic smoke-sized fit so CI stays quick. Pass
 * `--full --write` to refit the committed artifact from all eligible rows.
 */

import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  inferFancyFamilyKey,
  loadIndex,
  resolveAlibabaComp,
  supplierKey,
} from '../comp-engine-v3.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const args = new Set(process.argv.slice(2));
const FULL = args.has('--full');
const WRITE = args.has('--write');
const MAX_ROWS_PER_SEGMENT = FULL ? Infinity : 80;

function loadJson(rel) {
  return JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
}

function saveJson(rel, value) {
  writeFileSync(path.join(ROOT, rel), `${JSON.stringify(value, null, 2)}\n`);
}

function whiteGrade(row) {
  const raw = String(row.colorNormalized || row.color || 'E').toUpperCase();
  if (raw === 'DEF' || raw === 'DE') return 'E';
  if (/^[D-Z]$/.test(raw)) return raw;
  return 'E';
}

function queryFromRow(row) {
  const carat = Number(row.carat);
  if (!Number.isFinite(carat) || carat <= 0 || !row.shape || !row.clarity) return null;
  if (row.colorFamily === 'fancy') {
    const key = inferFancyFamilyKey(row.color || row.appColorKey || row.colorHue);
    if (!key) return null;
    return {
      carat,
      shape: row.shape,
      colorFamily: 'fancy',
      colorFamily_key: key,
      clarity: row.clarity,
    };
  }
  return {
    carat,
    shape: row.shape,
    colorFamily: 'white',
    whiteGrade: whiteGrade(row),
    clarity: row.clarity,
  };
}

function segmentOf(row) {
  return row.colorFamily === 'fancy' ? 'fancy' : 'white';
}

function quantileConformal(scores, alpha) {
  if (!scores.length) return null;
  const sorted = [...scores].sort((a, b) => a - b);
  const n = sorted.length;
  const rank = Math.min(n, Math.ceil((n + 1) * (1 - alpha)));
  return sorted[rank - 1];
}

function deterministicSample(rows, maxRows) {
  if (rows.length <= maxRows) return rows;
  const step = rows.length / maxRows;
  const out = [];
  for (let i = 0; i < maxRows; i++) out.push(rows[Math.floor(i * step)]);
  return out;
}

function sampleBySegment(rows, maxRowsPerSegment) {
  return [
    ...deterministicSample(rows.filter(row => segmentOf(row) === 'white'), maxRowsPerSegment),
    ...deterministicSample(rows.filter(row => segmentOf(row) === 'fancy'), maxRowsPerSegment),
  ];
}

function loadMergedIndex() {
  const base = loadJson('research/data/alibaba-comps-index.json');
  for (const rel of [
    'research/data/messi-comps.json',
    'research/data/starsgem-comps.json',
    'research/data/messi-color-comps.json',
    'research/data/starsgem-color-comps.json',
  ]) {
    try {
      const data = loadJson(rel);
      base.comps.push(...(data.comps || []));
    } catch (_) {
      // Optional supplemental source.
    }
  }
  return base;
}

async function scoreRows(allRows, targetRows) {
  const bySupplier = new Map();
  for (const row of allRows) {
    const sk = supplierKey(row);
    if (!bySupplier.has(sk)) bySupplier.set(sk, []);
    bySupplier.get(sk).push(row);
  }

  const scores = { white: [], fancy: [] };
  const counts = { white: 0, fancy: 0, failed: 0 };

  for (const row of targetRows) {
    const query = queryFromRow(row);
    const actual = Number(row.priceUsd);
    if (!query || !Number.isFinite(actual) || actual <= 0) continue;
    const sk = supplierKey(row);
    const trainRows = allRows.filter(candidate => supplierKey(candidate) !== sk);
    if (!trainRows.length) continue;
    await loadIndex({ comps: trainRows });
    let pred = null;
    try {
      pred = resolveAlibabaComp(query);
    } catch (_) {
      pred = null;
    }
    if (!pred?.estimate || pred.matchType === 'none') {
      counts.failed++;
      continue;
    }
    const score = Math.abs(Math.log(actual) - Math.log(pred.estimate));
    const segment = segmentOf(row);
    scores[segment].push(score);
    counts[segment]++;
  }

  return { scores, counts };
}

function coverage(scores, qLog) {
  if (!scores.length || !Number.isFinite(qLog)) return null;
  return scores.filter(score => score <= qLog).length / scores.length;
}

function rowsForSuppliers(rows, suppliers) {
  const wanted = new Set(suppliers);
  return rows.filter(row => wanted.has(supplierKey(row)));
}

const split = loadJson('research/data/conformal-holdout-split-v1.json');
const existing = loadJson('research/data/conformal-calibration-v1.json');
const index = loadMergedIndex();

console.log(`R0.2 conformal calibration fit (${FULL ? 'full' : 'smoke'} mode)`);

const calibrationRows = sampleBySegment(rowsForSuppliers(index.comps, split.calibrationSuppliers), MAX_ROWS_PER_SEGMENT);
const reportingRows = sampleBySegment(rowsForSuppliers(index.comps, split.reportingSuppliers), MAX_ROWS_PER_SEGMENT);

const cal = await scoreRows(index.comps, calibrationRows);
const report = await scoreRows(index.comps, reportingRows);

const artifact = {
  ...existing,
  version: 'conformal-v1',
  createdAt: new Date().toISOString(),
  runId: `r0.2-comp-conformal-v1-${new Date().toISOString().slice(0, 10)}${FULL ? '-full' : '-smoke'}`,
  status: FULL ? 'active' : 'smoke_fit',
  targetCoverage: split.targetCoverage,
  alpha: split.quantile.alpha,
  method: 'split_conformal_log_residual',
  holdoutProtocol: split.protocol,
  truthDefinition: split.truthDefinition,
  segments: {},
};

for (const segment of ['white', 'fancy']) {
  const fallbackQ = existing.segments?.[segment]?.qLog || existing.fallback?.qLog;
  const calQ = quantileConformal(cal.scores[segment], split.quantile.alpha);
  const reportQ = report.scores[segment].length >= 20
    ? quantileConformal(report.scores[segment], split.quantile.alpha)
    : null;
  const fittedQ = Math.max(calQ || 0, reportQ || 0);
  const qLog = fittedQ || fallbackQ;
  artifact.segments[segment] = {
    qLog: Number(qLog.toFixed(4)),
    nCal: cal.scores[segment].length,
    reportingCoverage: Number((coverage(report.scores[segment], qLog) ?? 0).toFixed(4)),
    nReport: report.scores[segment].length,
    reportingSupport: report.scores[segment].length >= 20 ? 'standard' : 'low',
  };
}

const allCal = [...cal.scores.white, ...cal.scores.fancy];
const allReport = [...report.scores.white, ...report.scores.fancy];
const fallbackQ = Math.max(
  quantileConformal(allCal, split.quantile.alpha) || 0,
  quantileConformal(allReport, split.quantile.alpha) || 0
) || existing.fallback?.qLog;
artifact.fallback = {
  qLog: Number(fallbackQ.toFixed(4)),
  nCal: allCal.length,
  reportingCoverage: Number((coverage(allReport, fallbackQ) ?? 0).toFixed(4)),
  nReport: allReport.length,
  reportingSupport: allReport.length >= 20 ? 'standard' : 'low',
};

artifact.copy = existing.copy;

console.log(JSON.stringify({
  calibrationRows: cal.counts,
  reportingRows: report.counts,
  segments: artifact.segments,
  fallback: artifact.fallback,
}, null, 2));

if (WRITE) {
  if (!FULL) throw new Error('Refusing to write smoke-mode calibration. Use --full --write.');
  saveJson('research/data/conformal-calibration-v1.json', artifact);
  console.log('Wrote research/data/conformal-calibration-v1.json');
}

for (const segment of ['white', 'fancy']) {
  if (artifact.segments[segment].nCal < 1) {
    throw new Error(`No calibration scores for ${segment}`);
  }
}
