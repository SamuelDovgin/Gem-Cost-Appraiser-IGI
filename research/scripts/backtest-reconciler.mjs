#!/usr/bin/env node
/**
 * R0.1/R0.2b reconciler backtest entry point.
 *
 * The heavy lifting lives in fit-reconciled-conformal-calibration.mjs so the
 * same supplier-held-out protocol drives both the calibration artifact and this
 * backtest command. Use --full for all eligible rows; default is smoke mode.
 */

import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2).filter(arg => arg !== '--write');
const script = path.join(__dirname, 'fit-reconciled-conformal-calibration.mjs');

console.log('R0 reconciler backtest');
console.log('Metric focus: supplier-held-out MdAPE and conformal residual coverage around reconcileWholesale().estimate.');
console.log('The emitted mdapeReporting table compares reconciled rules-v1 against comp-only on the same reporting supplier rows; positive deltas include an exception note.');

execFileSync(process.execPath, [script, ...args], {
  cwd: path.resolve(__dirname, '../..'),
  stdio: 'inherit',
});
