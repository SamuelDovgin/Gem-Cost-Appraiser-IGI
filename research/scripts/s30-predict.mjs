/**
 * S30 bounded smooth median predictor.
 *
 * Research-only: interpolate a clean-data median curve and clamp extrapolation
 * to observed endpoint/min/max values.
 */

import { starsgemNorm } from './starsgem-ml-predict.mjs';

function cutTier(row) {
  const cut = starsgemNorm(row.cut_raw ?? row.cut ?? row.Cut ?? '-');
  const polish = starsgemNorm(row.polish ?? row.Polish ?? 'EX');
  const symmetry = starsgemNorm(row.symmetry ?? row.Symmetry ?? 'EX');
  if ((cut === 'ID' || cut === 'EX') && ['EX', 'IDEAL', 'VG'].includes(polish) && ['EX', 'VG'].includes(symmetry)) {
    return 'A';
  }
  return 'B';
}

function shapeStyle(row) {
  return String(row.shape_style ?? row.Shape_Style ?? row.shapeStyle ?? `${row.shape ?? row.Shape ?? 'ROUND'}_STANDARD`)
    .trim()
    .toLowerCase();
}

function curveKey(row, includeTier = true) {
  const base = [
    shapeStyle(row),
    starsgemNorm(row.color ?? row.Color),
    starsgemNorm(row.clarity ?? row.Clarity),
    starsgemNorm(row.typeName ?? row.TypeName ?? 'CVD'),
  ].join('||');
  return includeTier ? `${base}||${cutTier(row)}` : base;
}

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    2 * p1
    + (-p0 + p2) * t
    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
    + (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

function predictCurveUpc(carat, curve) {
  const knots = curve?.knots || [];
  if (!knots.length) return null;
  if (knots.length === 1) return knots[0].y;
  if (carat <= curve.minCarat) return clamp(knots[0].y, curve.minUpc, curve.maxUpc);
  if (carat >= curve.maxCarat) return clamp(knots[knots.length - 1].y, curve.minUpc, curve.maxUpc);

  let i = 0;
  while (i < knots.length - 2 && knots[i + 1].x < carat) i += 1;
  const k1 = knots[i];
  const k2 = knots[i + 1];
  const k0 = knots[Math.max(0, i - 1)];
  const k3 = knots[Math.min(knots.length - 1, i + 2)];
  const t = (carat - k1.x) / Math.max(1e-9, k2.x - k1.x);
  const y = catmullRom(k0.y, k1.y, k2.y, k3.y, t);
  return clamp(y, curve.minUpc, curve.maxUpc);
}

export function predictS30(input, model) {
  const carat = Number(input.carat ?? input.Carat);
  if (!Number.isFinite(carat) || carat <= 0 || !model) return null;
  const exactKey = curveKey(input, true);
  const parentKey = curveKey(input, false);
  const exact = model.curves?.[exactKey];
  const parent = model.parentCurves?.[parentKey];
  const curve = exact || parent;
  const upc = predictCurveUpc(carat, curve);
  if (!Number.isFinite(upc) || upc <= 0) return null;
  return {
    price: upc * carat,
    upc,
    curveKey: exact ? exactKey : parent ? parentKey : null,
    curveSource: exact ? 'exact_cut_tier' : parent ? 'parent_spec' : 'missing',
    support: curve.n,
    minCarat: curve.minCarat,
    maxCarat: curve.maxCarat,
    bounded: carat < curve.minCarat || carat > curve.maxCarat,
  };
}
