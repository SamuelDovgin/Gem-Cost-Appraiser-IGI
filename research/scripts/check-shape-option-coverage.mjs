/**
 * Ensure app-selectable shape options cover the canonical master dataset
 * shape/style buckets used by white-diamond ML training.
 *
 * Usage:
 *   node research/scripts/check-shape-option-coverage.mjs
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const trainingRows = JSON.parse(
  readFileSync(path.join(ROOT, 'research/data/dataset-clean-training.json'), 'utf8'),
);

const selectStart = html.indexOf('<select id="shape-select"');
const selectEnd = html.indexOf('</select>', selectStart);
if (selectStart < 0 || selectEnd < 0) {
  throw new Error('Could not find #shape-select in index.html');
}

const shapeSelectHtml = html.slice(selectStart, selectEnd);
const optionIds = new Set(
  [...shapeSelectHtml.matchAll(/<option value="([^"]+)"(?:\s+selected)?>([^<]+)<\/option>/g)]
    .map(match => match[1]),
);

function optionIdForShapeStyle(style) {
  const key = String(style || '').trim().toUpperCase();
  if (!key) return null;
  if (key === 'CUSHION_ELONGATED') return 'elongated_cushion';
  if (key === 'OLD_MINE') return 'old_mine';
  if (key === 'OLD_EUROPEAN') return 'old_european';
  if (key === 'PORTUGUESE') return 'portuguese';
  if (key.startsWith('SQUARE_CUSHION_')) return 'square_cushion';
  if (key.startsWith('SQ_RADIANT_')) return 'sq_radiant';
  if (key.startsWith('TAPERED_BAGUETTE_')) return 'tapered_baguette';
  if (key.startsWith('HALF_MOON_')) return 'half_moon';
  if (key.startsWith('HEXAGONAL_DUTCH_')) return 'hexagonal_dutch';

  const [base] = key.split('_');
  const baseMap = {
    ROUND: 'round',
    OVAL: 'oval',
    PEAR: 'pear',
    MARQUISE: 'marquise',
    HEART: 'heart',
    CUSHION: 'cushion',
    RADIANT: 'radiant',
    PRINCESS: 'princess',
    EMERALD: 'emerald',
    ASSCHER: 'asscher',
    FLOWER: 'flower',
    MOVAL: 'moval',
    TRILLIANT: 'trilliant',
    BAGUETTE: 'baguette',
    CARRE: 'carre',
    FLANDERS: 'flanders',
    HEXAGONAL: 'hexagonal',
    SHIELD: 'shield',
    ROSE: 'rose',
    BRIOLETTE: 'briolette',
    FREEFORM: 'freeform',
  };
  return baseMap[base] || key.toLowerCase();
}

const styleCounts = new Map();
for (const row of trainingRows) {
  const style = row.shape_style || row.shape;
  styleCounts.set(style, (styleCounts.get(style) || 0) + 1);
}

const missing = [];
for (const [style, count] of [...styleCounts.entries()].sort()) {
  const optionId = optionIdForShapeStyle(style);
  if (!optionId || !optionIds.has(optionId)) {
    missing.push({ style, optionId, count });
  }
}

if (missing.length) {
  console.error('Missing selectable shape options for master-dataset shape styles:');
  for (const item of missing) {
    console.error(`  ${item.style} -> ${item.optionId || '(none)'} (${item.count} rows)`);
  }
  process.exit(1);
}

console.log(`Shape option coverage passed: ${styleCounts.size} training shape/style buckets covered by ${optionIds.size} selectable options.`);
