/**
 * Build chart data: StarGem actuals (raw index + clean dataset) vs ML estimates.
 *
 * Outputs: research/data/ml-actual-vs-model-charts-data.json
 * View:    research/ml-actual-vs-model-charts.html (via npm run serve)
 *
 * Usage:
 *   node research/scripts/generate-ml-actual-vs-model-charts.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  loadChartEngine,
  createPredictors,
  matchesSpec,
  actualPoint,
  samplePoints,
  binnedMedian,
  PRODUCTION_CURVE_KEYS,
  RESEARCH_CURVE_KEYS,
} from './ml-chart-engine.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DATA = path.join(ROOT, 'research', 'data');
const OUT = path.join(DATA, 'ml-actual-vs-model-charts-data.json');

function loadJson(rel) {
  return JSON.parse(readFileSync(path.join(DATA, rel), 'utf8'));
}

const engine = loadChartEngine();
const pred = createPredictors(engine);
const cleanRows = loadJson('dataset-clean-training.json');
const starsgemRecords = loadJson('starsgem-index.json').records || [];

function caratGrid(maxCt) {
  const pts = [];
  for (let c = 0.5; c <= maxCt + 0.001; c += c < 2 ? 0.05 : c < 5 ? 0.1 : 0.25) {
    pts.push(Number(c.toFixed(2)));
  }
  return pts;
}

const CHART_SPECS = [
  {
    id: 'round-e-vs1',
    title: 'ROUND · E · VS1 · ID · CVD',
    subtitle: 'Dense commodity cell (3ct diagnosis case)',
    spec: { shape: 'ROUND', color: 'E', clarity: 'VS1', cut: 'ID', typeName: 'CVD', shapeStyle: 'ROUND_STANDARD' },
    maxCt: 20,
  },
  {
    id: 'round-d-if',
    title: 'ROUND · D · IF · ID · HPHT',
    subtitle: 'Top white grade (clean Segment A is HPHT for this cell)',
    spec: { shape: 'ROUND', color: 'D', clarity: 'IF', cut: 'ID', typeName: 'HPHT', shapeStyle: 'ROUND_STANDARD' },
    maxCt: 20,
  },
  {
    id: 'round-d-vvs1',
    title: 'ROUND · D · VVS1 (all cuts & growth)',
    subtitle: 'High-volume round cell — CVD + HPHT, ID + EX',
    spec: { shape: 'ROUND', color: 'D', clarity: 'VVS1', cut: '*', typeName: '*', shapeStyle: 'ROUND_STANDARD' },
    maxCt: 20,
  },
  {
    id: 'pear-e-vs1',
    title: 'PEAR · E · VS1 · CVD',
    subtitle: 'Common fancy shape (clean training 0.5–1.4ct)',
    spec: { shape: 'PEAR', color: 'E', clarity: 'VS1', cut: '-', typeName: 'CVD', shapeStyle: 'PEAR_STANDARD' },
    maxCt: 5,
  },
  {
    id: 'heart-d-vs1',
    title: 'HEART · D · VS1 · CVD',
    subtitle: 'Sparse shape — large-carat extrapolation stress test',
    spec: { shape: 'HEART', color: 'D', clarity: 'VS1', cut: '-', typeName: 'CVD', shapeStyle: 'HEART_STANDARD' },
    maxCt: 12,
  },
  {
    id: 'oval-d-vvs1',
    title: 'OVAL · D · VVS1 · CVD',
    subtitle: 'Large-carat IGI-enriched range (to ~40ct in index)',
    spec: { shape: 'OVAL', color: 'D', clarity: 'VVS1', cut: '-', typeName: 'CVD', shapeStyle: 'OVAL_STANDARD' },
    maxCt: 42,
  },
  {
    id: 'marquise-e-vs1',
    title: 'MARQUISE · E · VS1 · CVD',
    subtitle: 'Mid fancy shape',
    spec: { shape: 'MARQUISE', color: 'E', clarity: 'VS1', cut: '-', typeName: 'CVD', shapeStyle: 'MARQUISE_STANDARD' },
    maxCt: 8,
  },
];

function buildChart(chartSpec) {
  const { spec, maxCt } = chartSpec;
  const { curves } = pred.curveUpc(spec, caratGrid(maxCt));

  const cleanScatter = [];
  for (const row of cleanRows) {
    if (!matchesSpec(row, spec, { fromClean: true })) continue;
    const pt = actualPoint(row);
    if (pt && pt.x <= maxCt + 0.5) cleanScatter.push(pt);
  }

  const starsgemScatter = [];
  for (const row of starsgemRecords) {
    if (!matchesSpec(row, spec)) continue;
    const pt = actualPoint(row);
    if (pt && pt.x <= maxCt + 0.5) starsgemScatter.push(pt);
  }

  return {
    id: chartSpec.id,
    title: chartSpec.title,
    subtitle: chartSpec.subtitle,
    spec,
    maxCt,
    counts: {
      clean: cleanScatter.length,
      starsgem: starsgemScatter.length,
    },
    curves,
    scatter: {
      clean: samplePoints(cleanScatter),
      starsgem: samplePoints(starsgemScatter),
    },
    medianCurves: {
      clean: binnedMedian(cleanScatter),
      starsgem: binnedMedian(starsgemScatter),
    },
  };
}

console.log('Loading data and building charts…');
const charts = CHART_SPECS.map(buildChart);

const payload = {
  generatedAt: new Date().toISOString(),
  description:
    'Continuous ML $/ct curves vs StarGem actuals. Production path: WhiteProd vNext (S30→S26→S33A→S28) plus component experts. S26 hybrid = lookup + S22/S23 (no live comps).',
  productionCurveKeys: PRODUCTION_CURVE_KEYS,
  researchCurveKeys: RESEARCH_CURVE_KEYS,
  models: {
    whiteProd: 'WhiteProd vNext — routed production predictor (S30 → S26 → S33A → S28)',
    s26: 'S26 champion hybrid (lookup + monotone ML, offline — no comp engine)',
    s30: 'S30 bounded smooth median curves (router expert)',
    s33a: 'S33A constrained anchors on S28 surface (router expert)',
    s32a: 'S32A S28 + hierarchical anchors (benchmark expert)',
    s28: 'S28 monotone parametric surface (router fallback)',
    s26Lookup: 'S26 lookup reconstruction only (4.8% benchmark anchor)',
    s29: 'S29 hybrid — S28 surface + EB cell anchor + shrunk LGBM residual',
    s22: 'S22 + S21 fallback (tree ML)',
  },
  sources: {
    clean: 'research/data/dataset-clean-training.json',
    starsgem: 'research/data/starsgem-index.json → records',
  },
  charts,
};

writeFileSync(OUT, JSON.stringify(payload));
console.log(`Wrote ${OUT}`);
console.log(`Charts: ${charts.length}`);
for (const c of charts) {
  console.log(
    `  ${c.id}: clean n=${c.counts.clean} starsgem n=${c.counts.starsgem} · whiteProd ${c.curves.whiteProd?.length ?? 0} pts`,
  );
}
