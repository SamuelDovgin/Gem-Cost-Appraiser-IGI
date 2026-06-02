#!/usr/bin/env node
/**
 * Build the combined S32-B artifact: S32-A anchors + CatBoost residual model.
 *
 * Usage:
 *   node research/scripts/build-s32b-artifact.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DATA = path.join(ROOT, 'research/data');

const OUT_MODEL = path.join(DATA, 'starsgem-ml-model-s32b.json');
const OUT_BENCH = path.join(DATA, 'benchmark-s32b.json');

function loadJson(name) {
  return JSON.parse(readFileSync(path.join(DATA, name), 'utf8'));
}

// Load S32-A artifact and S32-B residual config
const s32a = loadJson('starsgem-ml-model-s32a-anchors.json');
const s32bConfig = loadJson('starsgem-ml-model-s32b-residual.json');
const catboostModel = loadJson('s32b-catboost-model.json');

// Build combined artifact
const artifact = {
  generatedDate: new Date().toISOString().slice(0, 10),
  modelName: 'S32-B — S28 surface + hierarchical credibility anchors + capped CatBoost residual',
  modelVersion: 's32b-v0.1',
  targetType: 'surface_plus_anchors_plus_residual',

  // S28 surface (from S32-A)
  surfaceModel: s32a.surfaceModel,

  // Hierarchical anchors (from S32-A)
  anchors: s32a.anchors,
  anchorLevels: s32a.anchorLevels,
  colors: s32a.colors,
  clarities: s32a.clarities,
  caratBands: s32a.caratBands,

  // Hyperparameters
  hyperparameters: {
    // S32-A params
    K_anchor: s32a.hyperparameters.K_anchor,
    level_cap: s32a.hyperparameters.level_cap,
    A_cap: s32a.hyperparameters.A_cap,
    nFolds: s32a.hyperparameters.nFolds,
    // S32-B params
    r_min: s32bConfig.hyperparameters.r_min,
    K_resid: s32bConfig.hyperparameters.K_resid,
    R_cap: s32bConfig.hyperparameters.R_cap,
    cb_iterations: s32bConfig.hyperparameters.cb_iterations,
    cb_learning_rate: s32bConfig.hyperparameters.cb_learning_rate,
    cb_depth: s32bConfig.hyperparameters.cb_depth,
    cb_l2_leaf_reg: s32bConfig.hyperparameters.cb_l2_leaf_reg,
  },

  // CatBoost residual model (JSON format)
  residualModel: catboostModel,
  residualFeatures: s32bConfig.features,
  residualMetrics: s32bConfig.metrics,
};

writeFileSync(OUT_MODEL, JSON.stringify(artifact, null, 2) + '\n');
console.log(`S32-B artifact written (${(JSON.stringify(artifact).length / 1024 / 1024).toFixed(1)} MB)`);

// Write benchmark summary
const benchmark = {
  date: new Date().toISOString().slice(0, 10),
  model: artifact.modelVersion,
  phase: 'S32-B',
  hyperparameters: artifact.hyperparameters,
  s32a_metrics: s32a.metrics,
  residual_metrics: s32bConfig.metrics,
};

writeFileSync(OUT_BENCH, JSON.stringify(benchmark, null, 2) + '\n');
console.log(`S32-B benchmark written`);
