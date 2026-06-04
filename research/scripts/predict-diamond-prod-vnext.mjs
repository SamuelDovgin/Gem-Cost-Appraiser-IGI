#!/usr/bin/env node
/**
 * DiamondProd vNext — Unified Production Diamond Price Predictor
 *
 * One app-facing predictor that routes internally:
 *   white branch → WhiteProd vNext (S30→S26→S33A→S28)
 *   fancy-color branch → ColorProd vNext (S22→S23→comps→prior)
 *
 * Output contract (shared across both branches):
 *   {
 *     price, pricePerCarat, modelVersion,
 *     branch, colorFamily,
 *     selectedExpert, supportTier, supportCount,
 *     sourceAdjustment,
 *     confidenceBand, fallbackReason,
 *     monotonicityMode, diagnostics
 *   }
 *
 * Usage:
 *   import { predictDiamondProdVNext, loadDiamondProdVNext } from './predict-diamond-prod-vnext.mjs';
 *
 *   const predictor = loadDiamondProdVNext();
 *   const result = predictDiamondProdVNext(input, predictor);
 */

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { loadWhiteProdVNext, predictWhiteProdVNext, cellKey as whiteCellKey } from './predict-white-prod-vnext.mjs';
import { loadColorProdVNext, predictColorProdVNext, normHue } from './predict-color-prod-vnext.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, '../data');

function loadJson(name) {
  return JSON.parse(readFileSync(path.join(DATA, name), 'utf8'));
}

// ─── White/fancy-color classification ───────────────────────────────────────

const WHITE_COLOR_GRADES = new Set(['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N']);
const FANCY_KEYWORDS = ['fancy', 'vivid', 'intense', 'deep', 'dark', 'light'];

function classifyColorFamily(row) {
  // Check for explicit fancy color fields
  const hue = (row.colorHue ?? row.hue ?? '').toString().trim();
  const intensity = (row.colorIntensity ?? row.intensity ?? '').toString().trim();
  const colorLabel = (row.color ?? row.Color ?? '').toString().trim();
  const colorFamily = (row.colorFamily ?? '').toString().trim().toLowerCase();

  // Explicit fancy color family
  if (colorFamily === 'fancy' || colorFamily === 'fancy_color' || colorFamily === 'fancy-color') {
    return 'fancy-color';
  }

  // Has hue or intensity → fancy
  if (hue || intensity) return 'fancy-color';

  // Color label contains fancy keywords
  const lowerColor = colorLabel.toLowerCase();
  for (const kw of FANCY_KEYWORDS) {
    if (lowerColor.includes(kw)) return 'fancy-color';
  }

  // White grade D-K (or L, M, N for completeness)
  const grade = colorLabel.toUpperCase().trim();
  if (WHITE_COLOR_GRADES.has(grade)) return 'white';

  // If color is empty/unset, default to white
  if (!grade || grade === '-' || grade === 'UNKNOWN') return 'white';

  // Any other color label → treat as fancy-color
  return 'fancy-color';
}

// ─── Router config ──────────────────────────────────────────────────────────

const ROUTER_VERSION = 'diamond-prod-vnext-v0.2.0';

/**
 * Load all model artifacts for the unified DiamondProd vNext predictor.
 *
 * Loads both white and fancy-color branches with their respective artifacts.
 *
 * @param {Object} overrides - Optional overrides for artifacts and config
 * @returns {Object} predictor context
 */
export function loadDiamondProdVNext(overrides = {}) {
  const whiteCtx = loadWhiteProdVNext(overrides.white || {});
  const colorCtx = loadColorProdVNext(overrides.color || {});

  // Build router config
  let routerConfig = {};
  try {
    routerConfig = loadJson('diamond-prod-vnext-router.json');
  } catch (e) { /* use defaults */ }

  return {
    modelVersion: ROUTER_VERSION,
    white: whiteCtx,
    color: colorCtx,
    routerConfig: {
      defaultBranch: routerConfig.defaultBranch || 'auto',
      sourceAdjustment: overrides.sourceAdjustment || {
        messiToFactoryFactor: colorCtx.sourceAdjustment?.messiToFactoryFactor ?? 1.25,
        starsgemDirectFactor: 1.0,
      },
      ...routerConfig,
    },
  };
}

/**
 * Predict price for any diamond (white or fancy-color).
 *
 * @param {Object} row - Input with carat, color, colorHue, colorIntensity, shape, clarity, etc.
 * @param {Object} ctx - Loaded predictor context from loadDiamondProdVNext()
 * @param {Object} opts - Optional overrides (compEstimate, compSource for color)
 * @returns {Object} prediction result
 */
export function predictDiamondProdVNext(row, ctx, opts = {}) {
  const colorFamily = classifyColorFamily(row);

  // Route to appropriate branch
  if (colorFamily === 'white') {
    const result = predictWhiteProdVNext(row, ctx.white, opts);
    // Compute supportCount from white cell support
    const wck = whiteCellKey(row);
    const whiteSupportCount = ctx.white.cellSupport?.get(wck) ?? 0;
    return {
      ...result,
      modelVersion: ctx.modelVersion,
      branch: 'white',
      colorFamily: 'white',
      sourceAdjustment: ctx.routerConfig.sourceAdjustment,
      supportCount: whiteSupportCount,
      diagnostics: {
        ...result.diagnostics,
        classifierColorFamily: colorFamily,
      },
    };
  }

  if (colorFamily === 'fancy-color') {
    const result = predictColorProdVNext(row, ctx.color, opts);
    return {
      ...result,
      modelVersion: ctx.modelVersion,
      branch: 'fancy-color',
      colorFamily: 'fancy-color',
      sourceAdjustment: ctx.routerConfig.sourceAdjustment,
      diagnostics: {
        ...result.diagnostics,
        classifierColorFamily: colorFamily,
      },
    };
  }

  // Unclassifiable
  return {
    price: null,
    pricePerCarat: null,
    modelVersion: ctx.modelVersion,
    branch: null,
    colorFamily: 'unknown',
    selectedExpert: null,
    supportTier: 'empty',
    supportCount: 0,
    sourceAdjustment: ctx.routerConfig.sourceAdjustment,
    confidenceBand: null,
    fallbackReason: 'needs_manual_color_classification',
    monotonicityMode: null,
    diagnostics: {
      error: 'Could not classify diamond as white or fancy-color',
      classifierColorFamily: colorFamily,
    },
  };
}

/**
 * Batch predict.
 */
export function predictDiamondProdVNextBatch(rows, ctx, opts = {}) {
  return rows.map((row) => predictDiamondProdVNext(row, ctx, opts));
}

// ─── Re-exports ──────────────────────────────────────────────────────────────

export { classifyColorFamily, WHITE_COLOR_GRADES };
