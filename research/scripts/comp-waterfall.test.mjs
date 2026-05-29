#!/usr/bin/env node

import { buildCompWaterfall } from '../comp-waterfall.js';

let passed = 0;
let failed = 0;

function assert(cond, label, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.error(`  bad ${label}${detail ? ': ' + detail : ''}`);
  }
}

console.log('R0.3 comp-waterfall tests');

const ac = {
  matchType: 'nearest',
  confidence: 'medium',
  estimate: 1320,
  low: 1100,
  high: 1500,
  primary: {
    label: '3ct round D VS1',
    listingPrice: 1000,
    estimatedPrice: 1188,
    supplierKey: 'starsgem',
    modifiers: {
      parts: ['carat total ×1.080', 'color ×0.960', 'clarity ×1.145'],
    },
  },
  supportComps: [
    { estimatedPrice: 1188, sigmaLog: 0.1, score: 0.08, row: { section: 'A — StarGem' } },
    { estimatedPrice: 1400, sigmaLog: 0.2, score: 0.15, row: { section: 'B — Messi Gems' } },
  ],
  rejectedComps: [
    { estimatedPrice: 3000, reason: 'high-side outlier', row: { section: 'C — Unknown' } },
  ],
  warnings: ['Sparse fancy color comps.'],
};

const wf = buildCompWaterfall(ac);
assert(wf.schemaVersion === 'comp-waterfall-v1', 'schema version');
assert(wf.scope === 'comp_market', 'scope is comp market');
assert(wf.steps.length === 5, 'start plus three adjustment steps plus blend final');
assert(wf.steps[1].label === 'carat total', 'step label parsed');
assert(wf.steps[1].multiplier === 1.08, 'step multiplier parsed');
assert(wf.steps[2].kind === 'decrease', 'decrease step classified');
assert(wf.support.length === 2, 'support comps carried through');
assert(wf.support[0].blendWeight > wf.support[1].blendWeight, 'lower sigma gets higher blend weight');
assert(Math.abs(wf.support.reduce((sum, row) => sum + row.blendWeight, 0) - 1) < 0.001, 'blend weights sum to 1');
assert(wf.rejected.length === 1 && wf.rejected[0].reason === 'high-side outlier', 'rejected comp reason carried through');
assert(buildCompWaterfall({ matchType: 'none' }) === null, 'none match produces null waterfall');

if (failed) {
  console.error(`\ncomp-waterfall tests failed: ${failed}`);
  process.exit(1);
}

console.log(`\ncomp-waterfall tests passed: ${passed}`);
