/**
 * Train S30 — bounded smooth median curves.
 *
 * Research-only model: fit per-spec smooth median $/ct curves from the cleaned
 * master dataset. Interpolation is smooth inside observed support; extrapolation
 * clamps to endpoint/min/max support so the curve cannot run beyond observed
 * clean medians.
 */

import { writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, '../data');
const INPUT = path.join(DATA, 'dataset-clean-training.json');
const OUT = path.join(DATA, 'starsgem-ml-model-s30-bounded-smooth.json');

const COLOR_RANK = { D: 0, E: 1, F: 2, G: 3, H: 4, I: 5, J: 6, K: 7 };
const CLARITY_RANK = { IF: 0, VVS1: 1, VVS: 1.5, VVS2: 2, VS1: 3, VS: 3.5, VS2: 4, SI1: 5, SI2: 6 };

function norm(value) {
  return String(value ?? '').trim().toUpperCase();
}

function cutTier(row) {
  const cut = norm(row.cut_raw);
  const polish = norm(row.polish);
  const symmetry = norm(row.symmetry);
  if ((cut === 'ID' || cut === 'EX') && ['EX', 'IDEAL', 'VG'].includes(polish) && ['EX', 'VG'].includes(symmetry)) {
    return 'A';
  }
  return 'B';
}

function keyFor(row, { includeTier = true } = {}) {
  const shapeStyle = String(row.shape_style || row.shape || '').trim().toLowerCase();
  const color = norm(row.color);
  const clarity = norm(row.clarity);
  const typeName = norm(row.typeName || 'CVD');
  const tier = includeTier ? `||${cutTier(row)}` : '';
  return `${shapeStyle}||${color}||${clarity}||${typeName}${tier}`;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function binWidth(carat) {
  if (carat < 5) return 0.1;
  if (carat < 10) return 0.25;
  return 1.0;
}

function binCenter(carat) {
  const w = binWidth(carat);
  return Number((Math.round(carat / w) * w).toFixed(2));
}

function smoothKnots(rawKnots) {
  if (rawKnots.length <= 2) return rawKnots;
  return rawKnots.map((k, i) => {
    const neighbors = rawKnots.filter(o => Math.abs(o.x - k.x) <= Math.max(0.2, binWidth(k.x) * 2.5));
    const weighted = [];
    for (const n of neighbors) {
      const dist = Math.abs(n.x - k.x);
      const w = Math.max(1, Math.round(n.n / (1 + dist * 8)));
      for (let j = 0; j < w; j++) weighted.push(n.y);
    }
    return { ...k, y: Number(median(weighted).toFixed(4)) };
  });
}

function buildCurve(rows) {
  const bins = new Map();
  for (const row of rows) {
    const carat = Number(row.carat);
    const upc = Number(row.upc);
    if (!Number.isFinite(carat) || carat <= 0 || !Number.isFinite(upc) || upc <= 0) continue;
    const x = binCenter(carat);
    if (!bins.has(x)) bins.set(x, []);
    bins.get(x).push(upc);
  }
  const rawKnots = [...bins.entries()]
    .map(([x, ys]) => ({ x: Number(x), y: median(ys), n: ys.length }))
    .sort((a, b) => a.x - b.x);
  if (rawKnots.length < 2) return null;
  const knots = smoothKnots(rawKnots);
  const ys = knots.map(k => k.y);
  return {
    n: rows.length,
    minCarat: knots[0].x,
    maxCarat: knots[knots.length - 1].x,
    minUpc: Number(Math.min(...ys).toFixed(4)),
    maxUpc: Number(Math.max(...ys).toFixed(4)),
    knots: knots.map(k => ({ x: k.x, y: Number(k.y.toFixed(4)), n: k.n })),
  };
}

export function buildS30Artifact(rows, { minRowsPerCurve = 8 } = {}) {
  const filtered = rows.filter(
    (row) => COLOR_RANK[norm(row.color)] != null && CLARITY_RANK[norm(row.clarity)] != null,
  );

  const grouped = new Map();
  const parentGrouped = new Map();
  for (const row of filtered) {
    const key = keyFor(row);
    const parentKey = keyFor(row, { includeTier: false });
    if (!grouped.has(key)) grouped.set(key, []);
    if (!parentGrouped.has(parentKey)) parentGrouped.set(parentKey, []);
    grouped.get(key).push(row);
    parentGrouped.get(parentKey).push(row);
  }

  const curves = {};
  for (const [key, group] of grouped.entries()) {
    if (group.length < minRowsPerCurve) continue;
    const curve = buildCurve(group);
    if (curve) curves[key] = curve;
  }

  const parentCurves = {};
  for (const [key, group] of parentGrouped.entries()) {
    if (group.length < minRowsPerCurve) continue;
    const curve = buildCurve(group);
    if (curve) parentCurves[key] = curve;
  }

  return {
    modelName: 'S30 — bounded smooth median curves',
    modelVersion: 's30-bounded-smooth-v0.1',
    targetType: 'bounded_smooth_clean_median',
    configuration: {
      minRowsPerCurve,
      extrapolation: 'clamp_to_nearest_endpoint_and_curve_min_max',
      keys: {
        curve: 'shape_style||color||clarity||typeName||cutTier',
        fallback: 'shape_style||color||clarity||typeName',
      },
    },
    curves,
    parentCurves,
    metrics: {
      curveCount: Object.keys(curves).length,
      parentCurveCount: Object.keys(parentCurves).length,
      trainRows: filtered.length,
    },
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const rows = JSON.parse(readFileSync(INPUT, 'utf8'));
  const artifact = {
    generatedDate: new Date().toISOString().slice(0, 10),
    ...buildS30Artifact(rows),
    prediction:
      'Per-spec clean-data median curve, smoothed by local rolling median and clamped to observed curve min/max and endpoint levels for extrapolation.',
    data: {
      source: 'research/data/dataset-clean-training.json',
      totalRows: rows.length,
    },
  };

  writeFileSync(OUT, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`Wrote ${OUT}`);
  console.log(`Curves: ${artifact.metrics.curveCount}; parent curves: ${artifact.metrics.parentCurveCount}`);
}
