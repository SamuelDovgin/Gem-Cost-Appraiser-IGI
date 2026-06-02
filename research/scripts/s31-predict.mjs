/**
 * S31 guarded anchor predictor.
 *
 * log($/ct) = S28 v0.4 surface + monotone-projected anchor offset.
 */

import { starsgemNorm } from './starsgem-ml-predict.mjs';
import { predictS28 } from './s28-predict.mjs';

export const S31_COLORS = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];
export const S31_CLARITIES = ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2'];

export function s31Shape(row) {
  return String(row?.shape_style ?? row?.Shape_Style ?? row?.shapeStyle ?? row?.shape ?? row?.Shape ?? 'round_standard')
    .trim()
    .toLowerCase() || 'round_standard';
}

export function s31CutTier(row) {
  const cut = starsgemNorm(row?.cut_raw ?? row?.cut ?? row?.Cut ?? '-');
  const polish = starsgemNorm(row?.polish ?? row?.Polish ?? 'EX');
  const symmetry = starsgemNorm(row?.symmetry ?? row?.Symmetry ?? 'EX');
  if ((cut === 'ID' || cut === 'EX') && ['EX', 'IDEAL', 'VG'].includes(polish) && ['EX', 'VG'].includes(symmetry)) {
    return 'A';
  }
  return 'B';
}

export function s31PredictionInput(row) {
  return {
    Carat: row?.Carat ?? row?.carat,
    carat: row?.carat ?? row?.Carat,
    Shape: row?.Shape ?? row?.shape,
    shape: row?.shape ?? row?.Shape,
    Shape_Style: row?.Shape_Style ?? row?.shape_style ?? row?.shapeStyle,
    shape_style: row?.shape_style ?? row?.Shape_Style ?? row?.shapeStyle,
    Color: row?.Color ?? row?.color,
    color: row?.color ?? row?.Color,
    Clarity: row?.Clarity ?? row?.clarity,
    clarity: row?.clarity ?? row?.Clarity,
    Cut: row?.Cut ?? row?.cut ?? row?.cut_raw,
    cut: row?.cut ?? row?.Cut ?? row?.cut_raw,
    cut_raw: row?.cut_raw ?? row?.Cut ?? row?.cut,
    TypeName: row?.TypeName ?? row?.typeName,
    typeName: row?.typeName ?? row?.TypeName,
    LengthWidthRatio: row?.LengthWidthRatio ?? row?.lw_ratio ?? row?.lwRatio,
    lw_ratio: row?.lw_ratio ?? row?.LengthWidthRatio ?? row?.lwRatio,
    Table_Scale: row?.Table_Scale ?? row?.table_pct ?? row?.tablePct,
    table_pct: row?.table_pct ?? row?.Table_Scale ?? row?.tablePct,
    Depth_Scale: row?.Depth_Scale ?? row?.depth_pct ?? row?.depthPct,
    depth_pct: row?.depth_pct ?? row?.Depth_Scale ?? row?.depthPct,
    polish: row?.polish ?? row?.Polish,
    symmetry: row?.symmetry ?? row?.Symmetry,
  };
}

function gridKey(shape, tier) {
  return `${shape}||${tier}`;
}

function gridSeries(grids, shape, tier, color, clarity) {
  const keys = [
    gridKey(shape, tier),
    gridKey(shape, 'ALL'),
    gridKey('_global', tier),
    gridKey('_global', 'ALL'),
  ];
  for (const key of keys) {
    const spec = grids[key]?.[color]?.[clarity];
    if (Array.isArray(spec)) return spec;
  }
  return null;
}

function offsetSeries(model, shape, tier, color, clarity) {
  return gridSeries(model?.anchorGrids || {}, shape, tier, color, clarity);
}

function logUpcSeries(model, shape, tier, color, clarity) {
  return gridSeries(model?.anchorLogUpcGrids || {}, shape, tier, color, clarity);
}

function interpolatedOffset(model, carat, shape, tier, color, clarity) {
  const series = offsetSeries(model, shape, tier, color, clarity);
  return interpolateSeries(model, series, carat, 0);
}

function interpolateSeries(model, series, carat, fallback = null) {
  const bands = model?.caratBands || [];
  if (!series || !bands.length) return fallback;
  const x = Math.log(Math.max(0.01, carat));
  const mids = bands.map((b) => Math.log(Number(b.mid)));
  if (x <= mids[0]) return Number(series[0]) || 0;
  if (x >= mids[mids.length - 1]) return Number(series[series.length - 1]) || 0;
  for (let i = 1; i < mids.length; i++) {
    if (x <= mids[i]) {
      const t = (x - mids[i - 1]) / Math.max(1e-9, mids[i] - mids[i - 1]);
      return (Number(series[i - 1]) || 0) * (1 - t) + (Number(series[i]) || 0) * t;
    }
  }
  return fallback;
}

export function predictS31(row, model) {
  const surface = model?.surfaceModel || model?.surface;
  if (!surface) return null;
  const input = s31PredictionInput(row);
  const carat = Number(input.carat ?? input.Carat);
  if (!Number.isFinite(carat) || carat <= 0) return null;
  const base = predictS28(input, surface);
  if (!base?.upc) return null;

  const shape = s31Shape(input);
  const tier = s31CutTier(input);
  const color = starsgemNorm(input.color ?? input.Color);
  const clarity = starsgemNorm(input.clarity ?? input.Clarity);
  const projectedLogSeries = logUpcSeries(model, shape, tier, color, clarity);
  if (projectedLogSeries) {
    const logUpc = interpolateSeries(model, projectedLogSeries, carat, null);
    const upc = Math.exp(logUpc);
    if (!Number.isFinite(upc) || upc <= 0) return null;
    return {
      price: upc * carat,
      upc,
      baseUpc: base.upc,
      anchorOffset: Math.log(upc / base.upc),
      anchorMultiplier: upc / base.upc,
      shape,
      cutTier: tier,
      extrapolated: base.extrapolated,
    };
  }
  const offset = interpolatedOffset(model, carat, shape, tier, color, clarity);
  const upc = base.upc * Math.exp(offset);
  if (!Number.isFinite(upc) || upc <= 0) return null;
  return {
    price: upc * carat,
    upc,
    baseUpc: base.upc,
    anchorOffset: offset,
    anchorMultiplier: Math.exp(offset),
    shape,
    cutTier: tier,
    extrapolated: base.extrapolated,
  };
}
