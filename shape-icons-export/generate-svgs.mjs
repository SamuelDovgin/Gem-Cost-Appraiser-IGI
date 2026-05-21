#!/usr/bin/env node
/**
 * Writes one .svg per shape into ./svgs/
 * Run: node generate-svgs.mjs
 */
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const icons = require('./shape-icons.js');

const outDir = join(__dirname, 'svgs');
mkdirSync(outDir, { recursive: true });

const manifest = [];

for (const key of icons.ALL_SHAPE_KEYS) {
  const svg = icons.shapeIconSvgFile(key, 64, null);
  const filename = `${key}.svg`;
  writeFileSync(join(outDir, filename), svg, 'utf8');
  manifest.push({ key, file: `svgs/${filename}`, label: icons.shapeNames[key] || key, color: icons.SHAPE_ICON_COLORS[key] });
}

writeFileSync(
  join(__dirname, 'manifest.json'),
  JSON.stringify({ generated: new Date().toISOString(), count: manifest.length, shapes: manifest }, null, 2),
  'utf8'
);

console.log(`Wrote ${manifest.length} SVGs to ${outDir}`);
