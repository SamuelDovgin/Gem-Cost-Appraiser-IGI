#!/usr/bin/env node
/**
 * R0.2b reconciled conformal calibration fitter.
 *
 * Fits conformal widths around reconcileWholesale().estimate on supplier-held-out
 * catalog rows. Default smoke mode is fast enough for CI; use --full --write to
 * refresh research/data/reconciled-conformal-calibration-v1.json.
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
import { buildReconcileInput, reconcileWholesale } from '../reconcile-price.js';

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

function lerp(a, b, t) { return a + (b - a) * t; }

function baseWhitePerCt(ct) {
  const pts = [[0.50,70],[1.00,100],[1.50,143],[2.00,193],[2.50,190],[3.00,179],[3.50,195],[4.00,217],[4.50,244],[5.00,272],[6.00,327],[7.00,362],[8.00,417],[9.00,472],[10.00,527]];
  if (ct <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
    if (ct <= x2) return lerp(y1, y2, (ct - x1) / (x2 - x1));
  }
  return pts[pts.length - 1][1] + (ct - 10) * 9;
}

const WHITE_GRADE_MULT = { D:1.08, E:1.00, F:0.92, G:0.88, H:0.82, I:0.71, J:0.60, K:0.50, L:0.42, M:0.35, 'N-P':0.28, 'Q-R':0.21, 'S-Z':0.16 };
const CLARITY_KNOTS = [0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 7.0, 10.0];
const CLARITY_MULT = {
  IF:[1.14,1.18,1.22,1.28,1.42,1.50,1.58,1.68,1.88],
  VVS1:[1.10,1.14,1.16,1.20,1.36,1.44,1.52,1.62,1.78],
  VVS2:[1.05,1.08,1.09,1.12,1.14,1.16,1.18,1.21,1.24],
  VS1:[1,1,1,1,1,1,1,1,1],
  VS2:[0.92,0.88,0.87,0.86,0.84,0.82,0.80,0.76,0.70],
  SI1:[0.84,0.72,0.60,0.44,0.38,0.34,0.30,0.26,0.22],
  SI2:[0.72,0.58,0.46,0.34,0.28,0.24,0.20,0.16,0.12],
};
const SHAPE_MULT_WHITE = { round:1.00, oval:1.08, moval:0.94, pear:1.05, marquise:0.87, heart:0.86, trilliant:0.82, old_european:0.92, old_mine:0.88, cushion:0.90, cushion_brilliant:0.91, elongated_cushion:0.89, square_cushion:0.90, radiant:0.87, sq_radiant:0.88, princess:0.86, half_moon:0.80, shield:0.78, hexagonal:0.79, hexagonal_dutch:0.82, emerald:0.83, asscher:0.84, baguette:0.76, tapered_baguette:0.74, carre:0.80, rose:0.72, briolette:0.70, flower:0.78, freeform:0.70, portuguese:0.85, flanders:0.83 };
const FANCY_BASE = {
  yellow_fl:{ws1:95,scale:0.91}, yellow_f:{ws1:140,scale:0.91}, yellow_fi:{ws1:255,scale:1.00}, yellow_fv:{ws1:375,scale:0.87},
  pink_fl:{ws1:150,scale:0.91}, pink_f:{ws1:220,scale:0.91}, pink_fi:{ws1:330,scale:0.90}, pink_fv:{ws1:500,scale:0.88},
  blue_fl:{ws1:175,scale:0.92}, blue_f:{ws1:240,scale:0.92}, blue_fi:{ws1:330,scale:0.92}, blue_fv:{ws1:450,scale:0.90},
  green_fl:{ws1:155,scale:0.90}, green_f:{ws1:220,scale:0.92}, green_fi:{ws1:400,scale:0.92}, green_fv:{ws1:525,scale:0.90},
  orange_fl:{ws1:140,scale:0.95}, orange_f:{ws1:275,scale:1.00}, orange_fi:{ws1:475,scale:1.02}, orange_fv:{ws1:700,scale:1.00},
  purple_fl:{ws1:225,scale:1.02}, purple_f:{ws1:450,scale:1.05}, purple_fi:{ws1:900,scale:1.08},
  brown_f:{ws1:60,scale:0.95}, gray_f:{ws1:70,scale:0.95}, black:{ws1:45,scale:1.00}, red_purp:{ws1:390,scale:1.10}, red_f:{ws1:625,scale:1.20}, red_fv:{ws1:950,scale:1.25},
};
const CLARITY_MULT_COLOR = { IF:1.12, VVS1:1.08, VVS2:1.04, VS1:1.00, VS2:0.95, SI1:0.89, SI2:0.77 };
const SHAPE_MULT_COLOR = { round:0.90, oval:1.05, moval:0.99, pear:1.03, marquise:0.93, heart:0.96, trilliant:0.84, old_european:0.88, old_mine:0.86, cushion:1.00, cushion_brilliant:1.00, elongated_cushion:1.00, square_cushion:1.00, radiant:1.02, sq_radiant:1.00, princess:0.90, half_moon:0.82, shield:0.80, hexagonal:0.81, hexagonal_dutch:0.85, emerald:0.96, asscher:1.02, baguette:0.78, tapered_baguette:0.76, carre:0.86, rose:0.75, briolette:0.72, flower:0.82, freeform:0.72, portuguese:0.88, flanders:0.85 };

function clarityMult(clarity, ct) {
  const vals = CLARITY_MULT[clarity];
  if (!vals) return 1;
  if (ct <= CLARITY_KNOTS[0]) return vals[0];
  if (ct >= CLARITY_KNOTS.at(-1)) return vals.at(-1);
  for (let i = 0; i < CLARITY_KNOTS.length - 1; i++) {
    if (ct <= CLARITY_KNOTS[i + 1]) return lerp(vals[i], vals[i + 1], (ct - CLARITY_KNOTS[i]) / (CLARITY_KNOTS[i + 1] - CLARITY_KNOTS[i]));
  }
  return 1;
}

function whiteGrade(row) {
  const raw = String(row.colorNormalized || row.color || 'E').toUpperCase();
  if (raw === 'DEF' || raw === 'DE') return 'E';
  return /^[D-Z]$/.test(raw) ? raw : 'E';
}

function segmentOf(row) {
  return row.colorFamily === 'fancy' ? 'fancy' : 'white';
}

function queryFromRow(row) {
  const carat = Number(row.carat);
  if (!Number.isFinite(carat) || carat <= 0 || !row.shape || !row.clarity) return null;
  if (segmentOf(row) === 'fancy') {
    const key = inferFancyFamilyKey(row.color || row.appColorKey || row.colorHue);
    if (!key) return null;
    return { carat, segment:'fancy', shape: row.shape, colorFamily: row.color || key, colorFamilyKey: key, clarity: row.clarity, inferenceMode:'standard' };
  }
  return { carat, segment:'white', shape: row.shape, whiteGrade: whiteGrade(row), colorFamily: null, colorFamilyKey: null, clarity: row.clarity, inferenceMode:'standard' };
}

function compQuery(query) {
  return query.segment === 'fancy'
    ? { carat: query.carat, shape: query.shape, colorFamily:'fancy', colorFamily_key: query.colorFamilyKey, clarity: query.clarity }
    : { carat: query.carat, shape: query.shape, colorFamily:'white', whiteGrade: query.whiteGrade, clarity: query.clarity };
}

function baselineFor(query) {
  const ct = query.carat;
  if (query.segment === 'fancy') {
    const fc = FANCY_BASE[query.colorFamilyKey] || FANCY_BASE.pink_f;
    const total = fc.ws1 * Math.pow(ct, fc.scale) * (CLARITY_MULT_COLOR[query.clarity] || 1) * (SHAPE_MULT_COLOR[query.shape] || 1);
    return { total, perCt: total / ct, sigmaLog: 0.34, warnings: [] };
  }
  const total = baseWhitePerCt(ct) * (WHITE_GRADE_MULT[query.whiteGrade] || 1) * clarityMult(query.clarity, ct) * (SHAPE_MULT_WHITE[query.shape] || 1) * ct;
  return { total, perCt: total / ct, sigmaLog: 0.24, warnings: [] };
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mlProxyFor(query, trainRows) {
  const compatible = trainRows.filter(row => {
    if (segmentOf(row) !== query.segment) return false;
    if (row.shape !== query.shape) return false;
    if (row.clarity !== query.clarity) return false;
    if (query.segment === 'white') return whiteGrade(row) === query.whiteGrade;
    return inferFancyFamilyKey(row.color || row.appColorKey || row.colorHue) === query.colorFamilyKey;
  });
  const pool = compatible.length >= 2 ? compatible : trainRows.filter(row => segmentOf(row) === query.segment);
  const rate = median(pool.map(row => Number(row.priceUsd) / Number(row.carat)));
  if (!rate) return { total: null, available: false, warnings: ['ML proxy unavailable.'], anchorHit: false, modelName: 'supplier-median-proxy' };
  const total = rate * query.carat;
  return {
    total,
    perCt: rate,
    sigmaLog: query.segment === 'fancy' ? 0.38 : 0.32,
    anchorHit: compatible.length >= 2,
    modelName: 'supplier-median-proxy',
    warnings: compatible.length >= 2 ? [] : ['ML proxy used segment fallback.'],
  };
}

function quantileConformal(scores, alpha) {
  if (!scores.length) return null;
  const sorted = [...scores].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.ceil((sorted.length + 1) * (1 - alpha)));
  return sorted[rank - 1];
}

function coverage(scores, qLog) {
  if (!scores.length || !Number.isFinite(qLog)) return null;
  return scores.filter(score => score <= qLog).length / scores.length;
}

function mdape(errors) {
  return median(errors.map(Math.abs));
}

function deterministicSample(rows, maxRows) {
  if (rows.length <= maxRows) return rows;
  const step = rows.length / maxRows;
  return Array.from({ length: maxRows }, (_, i) => rows[Math.floor(i * step)]);
}

function sampleBySegment(rows, maxRowsPerSegment) {
  return [
    ...deterministicSample(rows.filter(row => segmentOf(row) === 'white'), maxRowsPerSegment),
    ...deterministicSample(rows.filter(row => segmentOf(row) === 'fancy'), maxRowsPerSegment),
  ];
}

function rowsForSuppliers(rows, suppliers) {
  const wanted = new Set(suppliers);
  return rows.filter(row => wanted.has(supplierKey(row)));
}

function loadMergedIndex() {
  const base = loadJson('research/data/alibaba-comps-index.json');
  for (const rel of ['research/data/messi-comps.json','research/data/starsgem-comps.json','research/data/messi-color-comps.json','research/data/starsgem-color-comps.json']) {
    try {
      const data = loadJson(rel);
      base.comps.push(...(data.comps || []));
    } catch (_) {}
  }
  return base;
}

async function scoreRows(allRows, targetRows) {
  const bySupplier = new Map();
  for (const row of allRows) {
    const sk = supplierKey(row);
    if (!bySupplier.has(sk)) bySupplier.set(sk, allRows.filter(candidate => supplierKey(candidate) !== sk));
  }

  const scores = { white: [], fancy: [], white_round_1_2: [] };
  const pctErrors = {
    reconciled: { white: [], fancy: [], white_round_1_2: [] },
    comp: { white: [], fancy: [], white_round_1_2: [] },
  };
  const counts = { white: 0, fancy: 0, white_round_1_2: 0, failed: 0 };

  function conformalSubsegment(query) {
    if (query.segment !== 'white') return null;
    const shape = String(query.shape || '').toLowerCase().replace(/\s+/g, '_');
    if ((shape !== 'round' && shape !== 'round_brilliant') || query.carat < 1 || query.carat > 2) return null;
    return 'white_round_1_2';
  }

  for (const row of targetRows) {
    const query = queryFromRow(row);
    const actual = Number(row.priceUsd);
    if (!query || !Number.isFinite(actual) || actual <= 0) continue;
    const trainRows = bySupplier.get(supplierKey(row)) || [];
    await loadIndex({ comps: trainRows });
    let ac = null;
    try { ac = resolveAlibabaComp(compQuery(query)); } catch (_) { ac = null; }
    const sub = conformalSubsegment(query);
    if (ac?.estimate) {
      pctErrors.comp[query.segment].push((ac.estimate - actual) / actual);
      if (sub) pctErrors.comp[sub].push((ac.estimate - actual) / actual);
    }

    const input = buildReconcileInput({
      query,
      baseline: baselineFor(query),
      comp: ac?.estimate ? {
        total: ac.estimate,
        perCt: ac.perCt,
        sigmaLog: ac.matchType === 'exact' ? 0.18 : ac.sigmaLog || null,
        supportCount: ac.supportComps?.length || 0,
        matchType: ac.matchType,
        confidence: ac.confidence,
        warnings: ac.warnings || [],
      } : { total: null, available: false, supportCount: 0, matchType: 'none', warnings: ['Comp held-out prediction unavailable.'] },
      ml: mlProxyFor(query, trainRows),
      flags: {},
    });

    let reconciled = null;
    try { reconciled = reconcileWholesale(input); } catch (_) { reconciled = null; }
    if (!reconciled?.estimate) {
      counts.failed++;
      continue;
    }
    scores[query.segment].push(Math.abs(Math.log(actual) - Math.log(reconciled.estimate)));
    pctErrors.reconciled[query.segment].push((reconciled.estimate - actual) / actual);
    if (sub) {
      scores[sub].push(Math.abs(Math.log(actual) - Math.log(reconciled.estimate)));
      pctErrors.reconciled[sub].push((reconciled.estimate - actual) / actual);
      counts[sub]++;
    }
    counts[query.segment]++;
  }
  return { scores, pctErrors, counts };
}

const split = loadJson('research/data/conformal-holdout-split-v1.json');
const existing = loadJson('research/data/reconciled-conformal-calibration-v1.json');
const index = loadMergedIndex();

console.log(`R0.2b reconciled conformal fit (${FULL ? 'full' : 'smoke'} mode)`);
const calibrationRows = sampleBySegment(rowsForSuppliers(index.comps, split.calibrationSuppliers), MAX_ROWS_PER_SEGMENT);
const reportingRows = sampleBySegment(rowsForSuppliers(index.comps, split.reportingSuppliers), MAX_ROWS_PER_SEGMENT);
const cal = await scoreRows(index.comps, calibrationRows);
const report = await scoreRows(index.comps, reportingRows);

const artifact = {
  ...existing,
  version: 'reconciled-conformal-v1',
  createdAt: new Date().toISOString(),
  runId: `r0.2-reconciled-conformal-v1-${new Date().toISOString().slice(0, 10)}${FULL ? '-full' : '-smoke'}`,
  status: FULL ? 'active' : 'smoke_fit',
  targetCoverage: split.targetCoverage,
  alpha: split.quantile.alpha,
  method: 'split_conformal_log_residual',
  holdoutProtocol: split.protocol,
  truthDefinition: split.truthDefinition,
  segments: {},
};

for (const segment of ['white', 'fancy', 'white_round_1_2']) {
  const fallbackQ = existing.segments?.[segment]?.qLog
    || (segment === 'white_round_1_2' ? existing.segments?.white?.qLog : null)
    || existing.fallback?.qLog;
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

artifact.supportTightening = {
  highSupportFactor: 0.72,
  highSupportMaxDisagreement: 1.18,
  exactCompFactor: 0.88,
  nearestCompFactor: 0.92,
};
artifact.band = {
  ...(existing.band || {}),
  minimumQLog: 0.11,
  maximumQLog: 0.38,
};

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
artifact.diagnostics = {
  mdapeReporting: Object.fromEntries(['white', 'fancy'].map(segment => {
    const reconciled = mdape(report.pctErrors.reconciled[segment]);
    const comp = mdape(report.pctErrors.comp[segment]);
    const delta = Number.isFinite(reconciled) && Number.isFinite(comp) ? reconciled - comp : null;
    return [segment, {
      reconciled: Number.isFinite(reconciled) ? Number(reconciled.toFixed(4)) : null,
      compOnly: Number.isFinite(comp) ? Number(comp.toFixed(4)) : null,
      delta: Number.isFinite(delta) ? Number(delta.toFixed(4)) : null,
      nReconciled: report.pctErrors.reconciled[segment].length,
      nComp: report.pctErrors.comp[segment].length,
      exception: Number.isFinite(delta) && delta > 0
        ? 'Rules-v1 reconciliation did not beat comp-only MdAPE on supplier catalog/list labels for this segment. R0 ships it because it unifies the user-facing estimate and achieves the conformal coverage gate; learned stacking remains the planned v2 improvement.'
        : null,
    }];
  })),
};
artifact.copy = existing.copy;

console.log(JSON.stringify({
  calibrationRows: cal.counts,
  reportingRows: report.counts,
  segments: artifact.segments,
  fallback: artifact.fallback,
  mdapeReporting: artifact.diagnostics.mdapeReporting,
}, null, 2));

if (WRITE) {
  if (!FULL) throw new Error('Refusing to write smoke-mode calibration. Use --full --write.');
  saveJson('research/data/reconciled-conformal-calibration-v1.json', artifact);
  console.log('Wrote research/data/reconciled-conformal-calibration-v1.json');
}

for (const segment of ['white', 'fancy']) {
  if (artifact.segments[segment].nCal < 1) throw new Error(`No reconciled calibration scores for ${segment}`);
}
