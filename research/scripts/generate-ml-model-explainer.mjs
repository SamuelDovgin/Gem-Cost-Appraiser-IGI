/**
 * Build rich ML model explainer chart data.
 *
 * Output: research/data/ml-model-explainer-data.json
 * View:   research/ml-model-explainer.html
 *
 * Usage:
 *   node research/scripts/generate-ml-model-explainer.mjs
 */

import { writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  loadChartEngine,
  createPredictors,
  caratRange,
  collectActuals,
  samplePoints,
  binnedMedian,
  rollingMedian,
  CLARITY_LADDER,
  COLOR_LADDER,
  SHAPE_FAN,
  CARAT_BUCKET_EDGES,
  MAGIC_WEIGHT_LINES,
} from './ml-chart-engine.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../data/ml-model-explainer-data.json');

const BASE_SPEC = {
  shape: 'ROUND',
  color: 'E',
  clarity: 'VS1',
  cut: 'ID',
  typeName: 'CVD',
  shapeStyle: 'ROUND_STANDARD',
};

const engine = loadChartEngine();
const pred = createPredictors(engine);

function caratChart(id, title, subtitle, spec, minCt, maxCt, step, extras = {}) {
  const carats = caratRange(minCt, maxCt, step);
  const { curves, meta } = pred.curveUpc(spec, carats);
  const actuals = collectActuals(engine, spec, maxCt);
  const cleanMed = binnedMedian(actuals.clean);
  const cleanSmooth = rollingMedian(cleanMed, Math.max(step * 3, 0.15));

  return {
    type: 'carat',
    id,
    title,
    subtitle,
    spec,
    xLabel: 'carat',
    yLabel: extras.yLabel || '$/ct',
    xMin: minCt,
    xMax: maxCt,
    curves: extras.totalPrice ? pred.curveTotalPrice(spec, carats) : curves,
    lookupMeta: meta,
    vlines: extras.vlines || [],
    scatter: {
      clean: samplePoints(actuals.clean, 800),
      starsgem: samplePoints(actuals.starsgem, 800),
    },
    medianCurves: {
      clean: cleanMed,
      cleanSmooth,
      starsgem: binnedMedian(actuals.starsgem),
    },
    counts: {
      clean: actuals.clean.length,
      starsgem: actuals.starsgem.length,
    },
  };
}

function ladderChart(id, title, subtitle, spec, carat, axis, labels) {
  const curves = { s26: [], s28: [], s22: [], s26Lookup: [] };
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    const overrides = { carat };
    if (axis === 'clarity') overrides.clarity = label;
    else overrides.color = label;

    const p = pred.predictAll(spec, overrides);
    const x = i;
    if (p.s26?.upc > 0) curves.s26.push({ x, y: p.s26.upc, label });
    if (p.s28?.upc > 0) curves.s28.push({ x, y: p.s28.upc, label });
    if (p.s22?.price > 0) curves.s22.push({ x, y: p.s22.price / carat, label });
    if (p.lookup?.upc > 0) curves.s26Lookup.push({ x, y: p.lookup.upc, label });
  }
  return {
    type: 'ladder',
    id,
    title,
    subtitle,
    spec: { ...spec, carat },
    axis,
    labels,
    yLabel: '$/ct',
    curves,
  };
}

function shapeFanChart(id, title, carat, color, clarity) {
  const labels = SHAPE_FAN;
  const curves = { s26: [], s28: [], s26Lookup: [] };
  for (let i = 0; i < labels.length; i++) {
    const shape = labels[i];
    const spec = {
      shape,
      color,
      clarity,
      cut: '-',
      typeName: 'CVD',
      shapeStyle: `${shape}_STANDARD`,
      carat,
    };
    const p = pred.predictAll(spec, { shape, shapeStyle: `${shape}_STANDARD`, carat });
    if (p.s26?.upc > 0) curves.s26.push({ x: i, y: p.s26.upc, label: shape });
    if (p.s28?.upc > 0) curves.s28.push({ x: i, y: p.s28.upc, label: shape });
    if (p.lookup?.upc > 0) curves.s26Lookup.push({ x: i, y: p.lookup.upc, label: shape });
  }
  return {
    type: 'ladder',
    id,
    title,
    subtitle: `Fixed ${carat}ct · ${color} · ${clarity} · CVD — shape modifier comparison`,
    axis: 'shape',
    labels,
    yLabel: '$/ct',
    curves,
  };
}

function growthChart(id, carat) {
  const spec = { ...BASE_SPEC, carat };
  const types = ['CVD', 'HPHT'];
  const curves = { s28: [] };
  const labels = types;
  for (let i = 0; i < types.length; i++) {
    const p = pred.predictAll(spec, { typeName: types[i], carat });
    if (p.s28?.upc > 0) curves.s28.push({ x: i, y: p.s28.upc, label: types[i] });
  }
  return {
    type: 'ladder',
    id,
    title: `Growth method · ${carat}ct ROUND E VS1`,
    subtitle: 'S28 enforces HPHT ≥ CVD for the same spec',
    axis: 'growth',
    labels,
    yLabel: '$/ct',
    curves,
  };
}

const sections = [
  {
    type: 'intro',
    id: 'models',
    title: 'White-diamond ML models in this repo',
    body: [
      'S26 lookup — reconstructs StarGem sheet cells by carat_bucket + shape + color + clarity (+ cut when dense). Steps when the bucket label changes; this is why it looks like a staircase.',
      'S26 hybrid — log-space blend of lookup + S22 + S23 (offline charts omit live comps). Production champion for dense cells.',
      'S22 / S23 — ExtraTrees / LightGBM on lookup residuals + large-carat tail. Piecewise within leaves; good locally, not a global smooth law.',
      'S28 — single monotone log($/ct) surface in carat, grades, shape, magic weights. Target continuous pricing law (see continuous-pricing-surface-principles.md).',
    ],
  },

  caratChart(
    'carat-full',
    'Full carat sweep — ROUND E VS1 ID CVD',
    'All models vs clean training actuals (rose) and raw StarGem index (gray). Teal dashed = lookup steps.',
    BASE_SPEC,
    0.5,
    20,
    0.1,
  ),

  caratChart(
    'bucket-zoom',
    'Bucket boundary zoom (2.70–3.30ct)',
    'Same spec at 0.02ct steps. Vertical lines: spreadsheet carat_bucket edges and 3ct magic weight. Lookup should step; S28 should stay smooth except near 3ct ramp.',
    BASE_SPEC,
    2.7,
    3.3,
    0.02,
    {
      vlines: [
        { x: 3.0, label: '3ct bucket', kind: 'bucket' },
        { x: 2.99, label: '2.99ct', kind: 'fine' },
        { x: 3.01, label: '3.01ct', kind: 'fine' },
      ],
    },
  ),

  caratChart(
    'magic-4ct',
    'Magic weight zoom (3.50–4.50ct)',
    'S28 uses approach + step features at 4ct so 3.9ct can rise smoothly and 4.0ct can jump. Lookup may still step at 4.0 bucket.',
    BASE_SPEC,
    3.5,
    4.5,
    0.02,
    {
      vlines: [
        { x: 4.0, label: '4ct magic', kind: 'magic' },
        { x: 3.9, label: '3.9ct', kind: 'fine' },
      ],
    },
  ),

  caratChart(
    'large-carat',
    'Large carat (5–25ct) — ROUND E VS1',
    'Where S25 failed (negative carat beta) and S28 must carry scarcity. Gray index includes more large rows than clean set.',
    BASE_SPEC,
    5,
    25,
    0.25,
  ),

  caratChart(
    'total-price',
    'Total price vs carat (not $/ct)',
    'Same spec: total $ = $/ct × carat. Stepped lookup still visible; S28 total price curves upward.',
    BASE_SPEC,
    1,
    15,
    0.1,
    { totalPrice: true, yLabel: 'total $' },
  ),

  ladderChart(
    'clarity-1ct',
    'Clarity ladder @ 1ct — ROUND E · ID · CVD',
    'Better clarity should price higher (S28 constrained). Lookup may jump between cells.',
    BASE_SPEC,
    1,
    'clarity',
    CLARITY_LADDER,
  ),

  ladderChart(
    'clarity-3ct',
    'Clarity ladder @ 3ct — ROUND E · ID · CVD',
    'Pinned diagnosis cell carat.',
    BASE_SPEC,
    3,
    'clarity',
    CLARITY_LADDER,
  ),

  ladderChart(
    'clarity-10ct',
    'Clarity ladder @ 10ct — ROUND E · ID · CVD',
    'Sparse tail — trees may hit global fallback.',
    BASE_SPEC,
    10,
    'clarity',
    CLARITY_LADDER,
  ),

  ladderChart(
    'color-1ct',
    'White color ladder @ 1ct — ROUND IF · ID · CVD',
    'D through J at fixed 1ct.',
    { ...BASE_SPEC, clarity: 'IF' },
    1,
    'color',
    COLOR_LADDER,
  ),

  shapeFanChart('shape-2ct', 'Shape fan @ 2ct E VS1', 2, 'E', 'VS1'),

  growthChart('growth-3ct', 3),

  caratChart(
    'pear-e-vs1',
    'PEAR E VS1 — fancy shape (narrow carat in clean data)',
    'Compare smooth S28 vs stepped lookup on a non-round style bucket.',
    {
      shape: 'PEAR',
      color: 'E',
      clarity: 'VS1',
      cut: '-',
      typeName: 'CVD',
      shapeStyle: 'PEAR_STANDARD',
    },
    0.5,
    3,
    0.05,
  ),

  caratChart(
    'heart-d-vs1',
    'HEART D VS1 — sparse / extrapolation',
    'Few clean rows; index has more spread. Models diverge above training support.',
    {
      shape: 'HEART',
      color: 'D',
      clarity: 'VS1',
      cut: '-',
      typeName: 'CVD',
      shapeStyle: 'HEART_STANDARD',
    },
    0.5,
    12,
    0.1,
  ),

  {
    type: 'table',
    id: 'lookup-steps',
    title: 'Lookup $/ct at fine steps (2.90–3.10ct)',
    subtitle: 'Shows exact bucket assignment — same spec until bucket changes',
    rows: caratRange(2.9, 3.1, 0.02).map(carat => {
      const p = pred.predictAll(BASE_SPEC, { carat });
      return {
        carat,
        bucket: p.bucket,
        lookupUpc: p.lookup?.upc ? Math.round(p.lookup.upc * 100) / 100 : null,
        s28Upc: p.s28?.upc ? Math.round(p.s28.upc * 100) / 100 : null,
        s26Upc: p.s26?.upc ? Math.round(p.s26.upc * 100) / 100 : null,
      };
    }),
  },
];

const payload = {
  generatedAt: new Date().toISOString(),
  referenceSpec: BASE_SPEC,
  bucketEdges: CARAT_BUCKET_EDGES,
  magicWeights: MAGIC_WEIGHT_LINES,
  modelLegend: {
    s26: { label: 'S26 hybrid', color: '#176c7d', desc: 'Lookup + S22/S23 blend (no comps in offline chart)' },
    s26Lookup: { label: 'S26 lookup only', color: '#2f855a', dash: '6 4', desc: 'Carat-bucket table — piecewise constant' },
    s28: { label: 'S28 monotone surface', color: '#6d5bd0', desc: 'Continuous parametric $/ct' },
    s22: { label: 'S22 + S21', color: '#b45309', dash: '4 3', desc: 'Tree ensemble residual' },
    s23: { label: 'S23 + S21', color: '#c2410c', dash: '2 4', desc: 'Monotone LightGBM (shown on ladders when present)' },
    cleanSmooth: { label: 'Clean actual (smooth median)', color: '#be123c', desc: 'Rolling median of clean training $/ct' },
    cleanScatter: { label: 'Clean training rows', color: '#9f1239' },
    starsgemScatter: { label: 'Raw index rows', color: '#94a3b8' },
  },
  sections,
};

writeFileSync(OUT, JSON.stringify(payload));
console.log(`Wrote ${OUT} (${sections.length} sections)`);
