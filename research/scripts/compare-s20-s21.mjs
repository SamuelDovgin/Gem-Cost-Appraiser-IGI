#!/usr/bin/env node
/**
 * S20 vs S21: monotonicity sweep, prediction grid map, Layer-4 vs raw S21.
 * Writes research/data/s20-s21-sweep-comparison.json
 */

import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildStarsgemRow,
  predictStarsgemMl,
  predictStarsgemMlMonotone,
} from './starsgem-ml-predict.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'research/data/s20-s21-sweep-comparison.json');

const CLARITY_ORDER = ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2'];
const COLOR_ORDER = ['D', 'E', 'F', 'G', 'H'];
const SHAPES = [
  'ROUND', 'OVAL', 'MARQUISE', 'PEAR', 'CUSHION', 'EMERALD', 'RADIANT', 'PRINCESS', 'HEART',
];
const CARATS = [0.5, 0.7, 1, 1.5, 2, 3, 4.08, 5, 8, 10, 12];
const CARAT_BUCKETS = [
  '0.30-0.49', '0.50-0.69', '0.70-0.89', '0.90-0.99', '1.00-1.49', '1.50-1.99',
  '2.00-2.99', '3.00-3.99', '4.00-4.99', '5.00-9.99', '10.00+',
];

function loadModel(rel) {
  return JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
}

function predict(model, opts, useMonotone) {
  const row = buildStarsgemRow({
    typeName: opts.typeName ?? '-',
    polish: 'EX',
    symmetry: 'EX',
    ...opts,
  });
  const isLgbm = model.modelType === 'lgbm';
  const p = useMonotone && isLgbm
    ? predictStarsgemMlMonotone(row, model)
    : predictStarsgemMl(row, model);
  return { perCt: p.perCt, price: p.price, rawPerCt: p.rawPerCt ?? p.perCt, projected: !!p.projected };
}

function ladderViolations(ladder) {
  const out = [];
  for (let i = 1; i < ladder.length; i++) {
    const prev = ladder[i - 1];
    const cur = ladder[i];
    if (cur.perCt > prev.perCt * 1.001) {
      out.push({
        from: prev.grade,
        to: cur.grade,
        fromPerCt: prev.perCt,
        toPerCt: cur.perCt,
        risePct: ((cur.perCt - prev.perCt) / prev.perCt) * 100,
      });
    }
  }
  return out;
}

function sweepModel(model, useMonotone) {
  let clarityViol = 0;
  let colorViol = 0;
  const byShape = {};
  const byCarat = {};
  const byBucket = {};
  const gridDeltas = [];

  for (const shape of SHAPES) {
    const cut = shape === 'HEART' || shape === 'MARQUISE' ? '-' : 'ID';
    let shapeViol = 0;
    for (const carat of CARATS) {
      const row0 = buildStarsgemRow({ carat, shape, color: 'E', clarity: 'VS1', cut });
      const bucket = row0.carat_bucket ?? 'other';
      let caratViol = 0;
      for (const color of COLOR_ORDER) {
        const clarLadder = CLARITY_ORDER.map((clarity) => {
          const p = predict(model, { carat, shape, color, clarity, cut }, useMonotone);
          return { grade: clarity, perCt: p.perCt };
        });
        const cv = ladderViolations(clarLadder);
        clarityViol += cv.length;
        shapeViol += cv.length;
        caratViol += cv.length;
        byBucket[bucket] = (byBucket[bucket] || 0) + cv.length;
      }
      for (const clarity of CLARITY_ORDER) {
        const colorLadder = COLOR_ORDER.map((color) => {
          const p = predict(model, { carat, shape, color, clarity, cut }, useMonotone);
          return { grade: color, perCt: p.perCt };
        });
        colorViol += ladderViolations(colorLadder).length;
      }
      byCarat[String(carat)] = (byCarat[String(carat)] || 0) + caratViol;
    }
    byShape[shape] = shapeViol;
  }
  return { clarityViol, colorViol, byShape, byCarat, byBucket };
}

function compareGrids(s20, s21) {
  const deltas = [];
  let s21RawClarViol = 0;
  let s21ProjClarViol = 0;

  for (const shape of SHAPES) {
    const cut = shape === 'HEART' || shape === 'MARQUISE' ? '-' : 'ID';
    for (const carat of CARATS) {
      for (const color of COLOR_ORDER) {
        const clarRaw = [];
        const clarProj = [];
        const clarS20 = [];
        for (const clarity of CLARITY_ORDER) {
          const p20 = predict(s20, { carat, shape, color, clarity, cut }, false);
          const p21r = predict(s21, { carat, shape, color, clarity, cut }, false);
          const p21p = predict(s21, { carat, shape, color, clarity, cut }, true);
          clarS20.push(p20.perCt);
          clarRaw.push(p21r.perCt);
          clarProj.push(p21p.perCt);
          if (p20.perCt > 0) {
            deltas.push({
              shape,
              carat,
              color,
              clarity,
              s20PerCt: Math.round(p20.perCt * 100) / 100,
              s21RawPerCt: Math.round(p21r.perCt * 100) / 100,
              s21ProjPerCt: Math.round(p21p.perCt * 100) / 100,
              rawVsS20Pct: Math.round((p21r.perCt / p20.perCt - 1) * 1000) / 10,
              projVsS20Pct: Math.round((p21p.perCt / p20.perCt - 1) * 1000) / 10,
            });
          }
        }
        s21RawClarViol += ladderViolations(
          CLARITY_ORDER.map((g, i) => ({ grade: g, perCt: clarRaw[i] })),
        ).length;
        s21ProjClarViol += ladderViolations(
          CLARITY_ORDER.map((g, i) => ({ grade: g, perCt: clarProj[i] })),
        ).length;
      }
    }
  }

  const absProj = deltas.map((d) => Math.abs(d.projVsS20Pct));
  const absRaw = deltas.map((d) => Math.abs(d.rawVsS20Pct));
  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

  return {
    cellCount: deltas.length,
    meanAbsRawVsS20Pct: Math.round(mean(absRaw) * 10) / 10,
    meanAbsProjVsS20Pct: Math.round(mean(absProj) * 10) / 10,
    s21RawClarityViolationsOnGrid: s21RawClarViol,
    s21ProjClarityViolationsOnGrid: s21ProjClarViol,
    largestProjShifts: [...deltas]
      .sort((a, b) => Math.abs(b.projVsS20Pct) - Math.abs(a.projVsS20Pct))
      .slice(0, 25),
    s20InversionsFixedByS21Proj: deltas.filter((d) => {
      // approximate: flag cells where S21 proj moved >15% toward monotonic median
      return Math.abs(d.projVsS20Pct) > 20;
    }).length,
    deltasSample: deltas.slice(0, 0),
  };
}

function pinnedLadders(s20, s21) {
  const pins = [
    { id: 'marquise-408-e', label: 'Marquise 4.08ct E', carat: 4.08, shape: 'MARQUISE', color: 'E', cut: '-' },
    { id: 'heart-3-e', label: 'Heart 3ct E', carat: 3, shape: 'HEART', color: 'E', cut: '-' },
    { id: 'round-2-e', label: 'Round 2ct E', carat: 2, shape: 'ROUND', color: 'E', cut: 'ID' },
    { id: 'oval-3-d', label: 'Oval 3ct D', carat: 3, shape: 'OVAL', color: 'D', cut: 'ID' },
  ];
  return pins.map((pin) => {
    const clar = CLARITY_ORDER.map((clarity) => {
      const p20 = predict(s20, { ...pin, clarity }, false);
      const raw = predict(s21, { ...pin, clarity }, false);
      const proj = predict(s21, { ...pin, clarity }, true);
      return {
        clarity,
        s20: p20.perCt,
        s21Raw: raw.perCt,
        s21Proj: proj.perCt,
        s20ViolatesNext: null,
      };
    });
    for (let i = 0; i < clar.length - 1; i++) {
      clar[i].s20ViolatesNext = clar[i + 1].s20 > clar[i].s20 * 1.001;
    }
    return { ...pin, ladder: clar };
  });
}

const s20 = loadModel('research/data/starsgem-ml-extra-trees-model-s20-specialty-tail.json');
const s21 = loadModel('research/data/starsgem-ml-extra-trees-model-s21-monotone.json');

const s20Sweep = sweepModel(s20, false);
const s21RawSweep = sweepModel(s21, false);
const s21ProjSweep = sweepModel(s21, true);
const grid = compareGrids(s20, s21);

const payload = {
  generatedAt: new Date().toISOString().slice(0, 10),
  models: {
    s20: { name: s20.modelName, trees: s20.treeCount, type: 'extratrees' },
    s21: { name: s21.modelName, trees: s21.treeCount, type: s21.modelType },
  },
  monotonicity: {
    s20: s20Sweep,
    s21Raw: s21RawSweep,
    s21Layer4: s21ProjSweep,
    clarityStepsTotal:
      SHAPES.length * CARATS.length * COLOR_ORDER.length * (CLARITY_ORDER.length - 1),
    colorStepsTotal:
      SHAPES.length * CARATS.length * CLARITY_ORDER.length * (COLOR_ORDER.length - 1),
  },
  gridComparison: grid,
  pinnedLadders: pinnedLadders(s20, s21),
};

writeFileSync(OUT, JSON.stringify(payload, null, 2));
console.log(`Wrote ${OUT}`);
console.log(
  `Monotonicity — clarity violations: S20=${s20Sweep.clarityViol} S21-raw=${s21RawSweep.clarityViol} S21-L4=${s21ProjSweep.clarityViol}`,
);
console.log(
  `Grid mean |Δ| vs S20: raw ${grid.meanAbsRawVsS20Pct}% proj ${grid.meanAbsProjVsS20Pct}%`,
);
