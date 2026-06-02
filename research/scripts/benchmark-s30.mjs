/**
 * benchmark-s30.mjs
 *
 * End-to-end MAPE for S30 vs S26 lookup and S28 (embedded Python holdout metrics).
 *
 * S30 is reported two ways:
 *   - inSampleArtifact: shipped JSON fit on all rows (optimistic on holdout)
 *   - trainOnlyHoldout: curves rebuilt from train split only (fairer)
 *
 * Usage:
 *   node research/scripts/benchmark-s30.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { starsgemNorm, starsgemCaratBucket } from './starsgem-ml-predict.mjs';
import { predictS30 } from './s30-predict.mjs';
import { buildS30Artifact } from './train-s30-bounded-smooth.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, '../data');
const OUT_JSON = path.join(DATA, 'benchmark-s30.json');

function loadJson(name) {
  return JSON.parse(readFileSync(path.join(DATA, name), 'utf8'));
}

const allRows = loadJson('dataset-clean-training.json');
const s30Artifact = loadJson('starsgem-ml-model-s30-bounded-smooth.json');
const s28Model = loadJson('starsgem-ml-model-s28-monotone-parametric.json');
const intel = loadJson('starsgem-pricing-intelligence.json');

const HOLDOUT_MOD = 5;

function reportHash(row) {
  const text = String(row.reportNo ?? row.reportno ?? row.rowNo ?? '');
  let total = 0;
  for (const ch of text) {
    total = (total * 131 + ch.charCodeAt(0)) % 1_000_003;
  }
  return total;
}

function isHoldout(row) {
  return reportHash(row) % HOLDOUT_MOD === 0;
}

function ape(pred, actual) {
  return Math.abs(pred - actual) / actual * 100;
}

function stats(apes, signedPcts = []) {
  if (!apes.length) {
    return { n: 0, mape: null, mdape: null, p90ape: null, biasPct: null };
  }
  const n = apes.length;
  const mape = apes.reduce((a, b) => a + b, 0) / n;
  const sorted = [...apes].sort((a, b) => a - b);
  const mdape = sorted[Math.floor(n / 2)];
  const p90ape = sorted[Math.floor(n * 0.9)];
  const biasPct = signedPcts.length
    ? signedPcts.reduce((a, b) => a + b, 0) / signedPcts.length
    : null;
  return {
    n,
    mape: +mape.toFixed(4),
    mdape: +mdape.toFixed(4),
    p90ape: +p90ape.toFixed(4),
    biasPct: biasPct == null ? null : +biasPct.toFixed(4),
  };
}

function s26LookupPrediction(raw) {
  const carat = Number(raw.carat);
  if (!carat || carat <= 0) return null;
  const normalized = {
    carat_bucket: starsgemCaratBucket(carat),
    Shape: (raw.shape || '').toUpperCase(),
    Color: (raw.color || '').toUpperCase(),
    Clarity: (raw.clarity || '').toUpperCase(),
    TypeName: starsgemNorm(raw.typeName || '-'),
    Report: 'IGI',
    Cut: starsgemNorm(raw.cut_raw || '-'),
    Polish: starsgemNorm(raw.polish || 'EX'),
    Symmetry: starsgemNorm(raw.symmetry || 'EX'),
  };
  for (const table of intel.lookup?.tables || []) {
    const key = table.fields.map((field) => normalized[field] ?? '-').join('||');
    const hit = table.groups?.[key];
    if (hit) {
      const price = (carat * hit.rate) / 170;
      return { price, upc: price / carat, lookupLevel: table.level };
    }
  }
  const rate = Number(intel.lookup?.globalMedianInternalRatePerCt) / 170;
  return rate > 0
    ? { price: carat * rate, upc: rate, lookupLevel: 'GLOBAL' }
    : null;
}

function s30Input(raw) {
  return {
    carat: Number(raw.carat),
    shape_style: String(raw.shape_style || `${raw.shape || 'ROUND'}_STANDARD`).toLowerCase(),
    color: raw.color,
    clarity: raw.clarity,
    cut_raw: raw.cut_raw,
    typeName: raw.typeName || 'CVD',
    polish: raw.polish || 'EX',
    symmetry: raw.symmetry || 'EX',
  };
}

function evaluateS30(rows, model) {
  const records = [];
  for (const raw of rows) {
    const carat = Number(raw.carat);
    const actual = Number(raw.price);
    if (!carat || !actual || carat <= 0 || actual <= 0) continue;

    const s30p = predictS30(s30Input(raw), model);
    const s26p = s26LookupPrediction(raw);
    records.push({
      shapeStyle: String(raw.shape_style || '').toLowerCase(),
      cb: starsgemCaratBucket(carat),
      hasS30: Boolean(s30p?.price > 0),
      s30Bounded: Boolean(s30p?.bounded),
      s30Source: s30p?.curveSource ?? 'missing',
      s30Ape: s30p?.price > 0 ? ape(s30p.price, actual) : null,
      s26Ape: s26p?.price > 0 ? ape(s26p.price, actual) : null,
      s30Signed: s30p?.price > 0 ? ((s30p.price - actual) / actual) * 100 : null,
      s26Signed: s26p?.price > 0 ? ((s26p.price - actual) / actual) * 100 : null,
    });
  }
  return records;
}

function summarize(records, filterFn = () => true) {
  const subset = records.filter(filterFn);
  const pick = (key) => {
    const apes = [];
    const signed = [];
    for (const r of subset) {
      const a = r[`${key}Ape`];
      if (a == null || !Number.isFinite(a)) continue;
      apes.push(a);
      signed.push(r[`${key}Signed`]);
    }
    return stats(apes, signed);
  };
  return {
    n: subset.length,
    s30: pick('s30'),
    s26: pick('s26'),
    s30Coverage: subset.filter((r) => r.hasS30).length,
    s30Bounded: subset.filter((r) => r.s30Bounded).length,
  };
}

function winner(s) {
  const candidates = [
    ['s30', s.s30.mape],
    ['s26', s.s26.mape],
  ].filter(([, m]) => m != null);
  if (!candidates.length) return null;
  candidates.sort((a, b) => a[1] - b[1]);
  return candidates[0][0];
}

const holdoutRows = allRows.filter(isHoldout);
const trainRows = allRows.filter((r) => !isHoldout(r));
const s30TrainOnly = buildS30Artifact(trainRows);

const inSampleHoldout = evaluateS30(holdoutRows, s30Artifact);
const trainOnlyHoldout = evaluateS30(holdoutRows, s30TrainOnly);
const inSampleFull = evaluateS30(allRows, s30Artifact);

const report = {
  date: new Date().toISOString().slice(0, 10),
  dataset: 'research/data/dataset-clean-training.json',
  totalRows: allRows.length,
  holdoutMethod: `reportHash(row) % ${HOLDOUT_MOD} === 0 (matches S28 trainer)`,
  holdoutRows: holdoutRows.length,
  trainRows: trainRows.length,
  comparators: {
    s28: {
      source: 'embedded Python holdout metrics in starsgem-ml-model-s28-monotone-parametric.json',
      note: 'S28 v0.4 live Node parity has been verified against the Python artifact metrics.',
      holdout: s28Model.metrics?.holdout ?? null,
      holdoutByCaratBucket: s28Model.metrics?.holdoutByCaratBucket ?? null,
    },
    s26: 'lookup-reconstruction from starsgem-pricing-intelligence.json',
  },
  s30: {
    inSampleArtifact: {
      description: 'Shipped artifact trained on all rows — holdout rows may appear in curve medians',
      curveCount: s30Artifact.metrics?.curveCount,
      ...summarize(inSampleHoldout),
      winner: null,
      segments: {
        hasCurve: summarize(inSampleHoldout, (r) => r.hasS30),
        missingCurve: summarize(inSampleHoldout, (r) => !r.hasS30),
        inSupport: summarize(inSampleHoldout, (r) => r.hasS30 && !r.s30Bounded),
        boundedExtrap: summarize(inSampleHoldout, (r) => r.hasS30 && r.s30Bounded),
      },
      fullDataset: summarize(inSampleFull),
    },
    trainOnlyHoldout: {
      description: 'Curves fit on train rows only, evaluated on holdout (fairer for S30)',
      curveCount: s30TrainOnly.metrics.curveCount,
      ...summarize(trainOnlyHoldout),
      winner: null,
      segments: {
        hasCurve: summarize(trainOnlyHoldout, (r) => r.hasS30),
        missingCurve: summarize(trainOnlyHoldout, (r) => !r.hasS30),
        inSupport: summarize(trainOnlyHoldout, (r) => r.hasS30 && !r.s30Bounded),
        boundedExtrap: summarize(trainOnlyHoldout, (r) => r.hasS30 && r.s30Bounded),
      },
    },
  },
};

report.s30.inSampleArtifact.winner = winner(report.s30.inSampleArtifact);
report.s30.trainOnlyHoldout.winner = winner(report.s30.trainOnlyHoldout);
for (const seg of Object.values(report.s30.inSampleArtifact.segments)) {
  seg.winner = winner(seg);
}
for (const seg of Object.values(report.s30.trainOnlyHoldout.segments)) {
  seg.winner = winner(seg);
}

writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`);

function printStats(label, s, s28Ref = null) {
  console.log(`\n${label}`);
  console.log(
    `  S30  MAPE=${s.s30.mape}%  MdAPE=${s.s30.mdape}%  p90=${s.s30.p90ape}%  bias=${s.s30.biasPct}%  coverage=${s.s30Coverage}/${s.n}`,
  );
  console.log(
    `  S26  MAPE=${s.s26.mape}%  MdAPE=${s.s26.mdape}%  p90=${s.s26.p90ape}%  bias=${s.s26.biasPct}%`,
  );
  if (s28Ref) {
    console.log(
      `  S28  MAPE=${s28Ref.mape}%  MdAPE=${s28Ref.mdape}%  p90=${s28Ref.p90ape}%  bias=${s28Ref.biasPct}%  (Python holdout, embedded)`,
    );
  }
  console.log(`  Winner (S30 vs S26): ${winner(s) ?? 'n/a'}`);
}

console.log('══════════════════════════════════════════════════════════════════');
console.log('S30 BENCHMARK');
console.log('══════════════════════════════════════════════════════════════════');
console.log(`Rows: ${allRows.length} | Holdout: ${holdoutRows.length} | Train: ${trainRows.length}`);
console.log(`Holdout split: reportHash % ${HOLDOUT_MOD} (same as S28 trainer)`);

const s28h = s28Model.metrics?.holdout;
printStats('S30 in-sample artifact → holdout (optimistic)', report.s30.inSampleArtifact, s28h);
printStats('S30 train-only curves → holdout (fairer)', report.s30.trainOnlyHoldout, s28h);

console.log('\n  In-sample S30 segments (holdout):');
for (const [name, seg] of Object.entries(report.s30.inSampleArtifact.segments)) {
  if (!seg.n) continue;
  console.log(
    `    ${name.padEnd(16)} n=${String(seg.n).padStart(5)}  S30=${seg.s30.mape}%  S26=${seg.s26.mape}%  winner=${seg.winner}`,
  );
}

console.log('\n  Train-only S30 segments (holdout):');
for (const [name, seg] of Object.entries(report.s30.trainOnlyHoldout.segments)) {
  if (!seg.n) continue;
  console.log(
    `    ${name.padEnd(16)} n=${String(seg.n).padStart(5)}  S30=${seg.s30.mape}%  S26=${seg.s26.mape}%  winner=${seg.winner}`,
  );
}

console.log(`\nWrote ${OUT_JSON}\n`);
