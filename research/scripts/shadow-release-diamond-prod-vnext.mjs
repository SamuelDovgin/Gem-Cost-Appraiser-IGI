#!/usr/bin/env node
/**
 * DiamondProd vNext — Shadow Release Report
 *
 * Runs DiamondProd vNext beside current production pricing across both
 * white and fancy-color branches. Logs every prediction with detailed
 * diagnostics for manual review.
 *
 * Outputs:
 *   1. Console summary with routing distribution and large-delta highlights
 *   2. JSON report with every row's prediction for review
 *   3. Large-delta CSV for spreadsheet review (deltas > 20% or > $5000)
 *
 * Usage:
 *   node research/scripts/shadow-release-diamond-prod-vnext.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { buildS30Artifact } from './train-s30-bounded-smooth.mjs';
import { predictDiamondProdVNext, loadDiamondProdVNext, classifyColorFamily } from './predict-diamond-prod-vnext.mjs';
import { predictS26Lookup, cellKey as whiteCellKey } from './predict-white-prod-vnext.mjs';
import { predictS22, normalizeColorRow, normHue, normIntensity, hueTier, cellKey as colorCellKey, supportTier } from './predict-color-prod-vnext.mjs';
import { starsgemNorm, starsgemCaratBucket } from './starsgem-ml-predict.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, '../data');

function loadJson(name) {
  return JSON.parse(readFileSync(path.join(DATA, name), 'utf8'));
}

// ─── Configuration ──────────────────────────────────────────────────────────

const LARGE_DELTA_PCT = 0.20;   // Flag deltas > 20%
const LARGE_DELTA_ABS = 5000;   // Flag absolute deltas > $5,000
const HIGH_CARAT_THRESHOLD = 5; // High-carat review threshold
const SPARSE_THRESHOLD = 5;     // Sparse cell threshold

// ─── Helpers ────────────────────────────────────────────────────────────────

function reportHash(row) {
  const text = String(row.reportNo ?? row.reportno ?? row.rowNo ?? '');
  let total = 0;
  for (const ch of text) total = (total * 131 + ch.charCodeAt(0)) % 1_000_003;
  return total;
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function category(value) {
  return String(value ?? '').trim() || '-';
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══ DiamondProd vNext — Shadow Release Report ═══\n');

  // ── Load white data ───────────────────────────────────────────────────────
  const allWhiteRows = loadJson('dataset-clean-training.json');
  const whiteHoldout = allWhiteRows.filter((r) => reportHash(r) % 5 === 0);
  const whiteTrain = allWhiteRows.filter((r) => reportHash(r) % 5 !== 0);
  console.log(`White dataset: ${allWhiteRows.length} rows, holdout: ${whiteHoldout.length}`);

  // ── Load color data ───────────────────────────────────────────────────────
  const messiColorRows = loadJson('messi-color-index.json').records || [];
  const starsgemColorRows = loadJson('starsgem-color-index.json').records || [];
  const s22Model = loadJson('color-diamond-ml-model.json');
  const adjustment = s22Model.sourceAdjustment?.messiColorToStarsgemLikeFactor ?? 1.25;

  function normColorRow(row, source) {
    const carat = safeNumber(row.carat);
    const rawPrice = safeNumber(row.pricePerStone);
    if (!carat || carat <= 0 || !rawPrice || rawPrice <= 0) return null;
    const isStarsgem = source === 'starsgem_color';
    return {
      ...row,
      source,
      carat,
      price: rawPrice / (isStarsgem ? 1.0 : adjustment),
      rawPrice,
      sourceAdjustmentFactor: isStarsgem ? 1.0 : adjustment,
      shape: category(row.shape),
      colorHue: category(row.colorHue),
      colorIntensity: category(row.colorIntensity),
      clarity: category(row.clarity),
    };
  }

  const allColorRows = [
    ...messiColorRows.map((r) => normColorRow(r, 'messi_color')),
    ...starsgemColorRows.map((r) => normColorRow(r, 'starsgem_color')),
  ].filter(Boolean);

  const colorHoldout = allColorRows.filter((r) => reportHash(r) % 5 === 0);
  const colorTrain = allColorRows.filter((r) => reportHash(r) % 5 !== 0);
  console.log(`Color dataset: ${allColorRows.length} rows, holdout: ${colorHoldout.length}`);

  // ── Build unified predictor context ───────────────────────────────────────
  const fairS30 = buildS30Artifact(whiteTrain);
  const dpCtx = loadDiamondProdVNext({
    white: { s30Model: fairS30 },
    sourceAdjustment: { messiToFactoryFactor: adjustment, starsgemDirectFactor: 1.0 },
  });

  // Build color cell support
  const colorCellSupportMap = new Map();
  for (const r of colorTrain) {
    const ck = colorCellKey(r);
    colorCellSupportMap.set(ck, (colorCellSupportMap.get(ck) || 0) + 1);
  }
  dpCtx.color.cellSupport = colorCellSupportMap;

  // Load S26 for white baseline comparison
  const s26Intel = loadJson('starsgem-pricing-intelligence.json');

  console.log(`\nEvaluating ${whiteHoldout.length + colorHoldout.length} holdout rows...\n`);

  // ─── White branch shadow ──────────────────────────────────────────────────

  console.log('─── White Branch Shadow ───\n');

  const whiteResults = [];
  const whiteRoutingCounts = { S30: 0, S26: 0, S33A: 0, S28: 0 };
  const whiteTierCounts = { dense: 0, medium: 0, sparse: 0, empty: 0 };
  const whiteBandCounts = {};
  const whiteReasonCounts = {};

  for (const row of whiteHoldout) {
    const carat = Number(row.carat);
    const actual = Number(row.price);
    const shape = String(row.shape_style || '').toLowerCase();
    const ck = whiteCellKey(row);
    const cellN = dpCtx.white.cellSupport?.get(ck) ?? 0;
    const isHighCarat = carat >= HIGH_CARAT_THRESHOLD;
    const isSparse = cellN < SPARSE_THRESHOLD;
    const isPrincess = shape === 'princess_standard';

    // Current production (S26)
    const s26 = predictS26Lookup(row, s26Intel);
    const baselinePrice = s26?.price ?? null;

    // DiamondProd vNext
    const dp = predictDiamondProdVNext(row, dpCtx);
    const dpPrice = dp?.price ?? null;

    // Compute deltas vs baseline
    let deltaAbs = null, deltaPct = null;
    if (dpPrice != null && baselinePrice != null && baselinePrice > 0) {
      deltaAbs = dpPrice - baselinePrice;
      deltaPct = (dpPrice - baselinePrice) / baselinePrice;
    }

    const isLargeDelta = (deltaPct != null && Math.abs(deltaPct) > LARGE_DELTA_PCT)
      || (deltaAbs != null && Math.abs(deltaAbs) > LARGE_DELTA_ABS);

    // Track routing
    whiteRoutingCounts[dp?.selectedExpert ?? 'S28']++;
    whiteTierCounts[dp?.supportTier ?? 'empty']++;
    const band = dp?.confidenceBand ?? 'null';
    whiteBandCounts[band] = (whiteBandCounts[band] || 0) + 1;
    const reason = dp?.fallbackReason ?? 'none';
    whiteReasonCounts[reason] = (whiteReasonCounts[reason] || 0) + 1;

    whiteResults.push({
      branch: 'white',
      spec: `${carat}ct ${shape} ${row.color}/${row.clarity} ${row.cut_raw ?? '-'} ${row.typeName ?? '-'}`,
      reportNo: row.reportNo ?? row.reportno ?? 'N/A',
      actualPrice: actual,
      baselinePrice,
      dpPrice,
      dpUpc: dp?.pricePerCarat ?? null,
      dpExpert: dp?.selectedExpert ?? null,
      dpTier: dp?.supportTier ?? null,
      dpBand: dp?.confidenceBand ?? null,
      dpReason: dp?.fallbackReason ?? null,
      deltaAbs: deltaAbs != null ? +deltaAbs.toFixed(2) : null,
      deltaPct: deltaPct != null ? +(deltaPct * 100).toFixed(2) : null,
      flags: { highCarat: isHighCarat, sparse: isSparse, princess: isPrincess },
    });
  }

  // White branch summary
  console.log('White Routing Distribution:');
  for (const [expert, count] of Object.entries(whiteRoutingCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${expert.padEnd(6)} ${String(count).padStart(5)} (${(count / whiteHoldout.length * 100).toFixed(1)}%)`);
  }

  // ─── Color branch shadow ──────────────────────────────────────────────────

  console.log('\n─── Color Branch Shadow ───\n');

  const colorResults = [];
  const colorRoutingCounts = {};
  const colorTierCounts = { dense: 0, medium: 0, sparse: 0, empty: 0 };
  const colorBandCounts = {};
  const colorReasonCounts = {};
  const hueResults = {};
  let dirQuoteRec = 0;
  let rareHueCount = 0;

  for (const row of colorHoldout) {
    const carat = safeNumber(row.carat);
    const actual = safeNumber(row.price);  // Already Messi-adjusted
    const isHighCarat = carat >= HIGH_CARAT_THRESHOLD;
    const hue = normHue(row.colorHue);
    const intensity = normIntensity(row.colorIntensity);
    const ht = hueTier(hue);
    const ck = colorCellKey(row);
    const cellN = colorCellSupportMap.get(ck) ?? 0;
    const isSparse = cellN < SPARSE_THRESHOLD;
    const isRareHue = ht === 'rare';
    const isDirectStarGem = row.source === 'starsgem_color';

    // Current baseline (S22 for color)
    const normRow = normalizeColorRow(row, adjustment);
    const s22Baseline = normRow ? predictS22(normRow, s22Model) : null;
    const baselinePrice = s22Baseline?.price ?? null;

    // DiamondProd vNext
    const dp = predictDiamondProdVNext(row, dpCtx);
    const dpPrice = dp?.price ?? null;

    // Compute deltas vs baseline
    let deltaAbs = null, deltaPct = null;
    if (dpPrice != null && baselinePrice != null && baselinePrice > 0) {
      deltaAbs = dpPrice - baselinePrice;
      deltaPct = (dpPrice - baselinePrice) / baselinePrice;
    }

    // Track routing
    colorRoutingCounts[dp?.selectedExpert ?? 'null'] = (colorRoutingCounts[dp?.selectedExpert ?? 'null'] || 0) + 1;
    colorTierCounts[dp?.supportTier ?? 'empty']++;
    const band = dp?.confidenceBand ?? 'null';
    colorBandCounts[band] = (colorBandCounts[band] || 0) + 1;
    const reason = dp?.fallbackReason ?? 'none';
    colorReasonCounts[reason] = (colorReasonCounts[reason] || 0) + 1;

    if (dp?.diagnostics?.directQuoteRecommended) dirQuoteRec++;
    if (isRareHue) rareHueCount++;

    // Track by hue
    if (!hueResults[hue]) hueResults[hue] = { count: 0, routing: {}, largeDeltas: 0, warnings: 0 };
    hueResults[hue].count++;
    hueResults[hue].routing[dp?.selectedExpert ?? 'null'] = (hueResults[hue].routing[dp?.selectedExpert ?? 'null'] || 0) + 1;

    const isLargeDelta = (deltaPct != null && Math.abs(deltaPct) > LARGE_DELTA_PCT)
      || (deltaAbs != null && Math.abs(deltaAbs) > LARGE_DELTA_ABS);
    if (isLargeDelta) hueResults[hue].largeDeltas++;
    if (dp?.diagnostics?.directQuoteRecommended) hueResults[hue].warnings++;

    colorResults.push({
      branch: 'fancy-color',
      spec: `${carat}ct ${row.shape ?? 'round'} ${hue}/${intensity} ${row.clarity ?? 'VS2'}`,
      reportNo: row.reportNo ?? row.reportno ?? 'N/A',
      source: row.source,
      actualPrice: actual,
      baselinePrice: baselinePrice ? +baselinePrice.toFixed(2) : null,
      dpPrice: dpPrice ? +dpPrice.toFixed(2) : null,
      dpUpc: dp?.pricePerCarat ? +dp.pricePerCarat.toFixed(2) : null,
      dpExpert: dp?.selectedExpert ?? null,
      dpTier: dp?.supportTier ?? null,
      dpBand: dp?.confidenceBand ?? null,
      dpReason: dp?.fallbackReason ?? null,
      hue, intensity,
      directQuoteRecommended: dp?.diagnostics?.directQuoteRecommended ?? false,
      deltaAbs: deltaAbs != null ? +deltaAbs.toFixed(2) : null,
      deltaPct: deltaPct != null ? +(deltaPct * 100).toFixed(2) : null,
      flags: {
        highCarat: isHighCarat,
        sparse: isSparse,
        rareHue: isRareHue,
        directStarGem: isDirectStarGem,
        directQuoteRecommended: dp?.diagnostics?.directQuoteRecommended ?? false,
      },
    });
  }

  // Color branch summary
  console.log('Color Routing Distribution:');
  for (const [expert, count] of Object.entries(colorRoutingCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${expert.padEnd(20)} ${String(count).padStart(5)} (${(count / colorHoldout.length * 100).toFixed(1)}%)`);
  }

  console.log('\nColor Support Tiers:');
  for (const [tier, count] of Object.entries(colorTierCounts)) {
    console.log(`  ${tier.padEnd(8)} ${String(count).padStart(5)}`);
  }

  console.log('\nColor Fallback Reasons:');
  for (const [reason, count] of Object.entries(colorReasonCounts).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${reason.padEnd(40)} ${String(count).padStart(5)}`);
  }

  console.log(`\nDirect-quote recommended: ${dirQuoteRec}/${colorHoldout.length}`);
  console.log(`Rare hue rows: ${rareHueCount}`);

  // ─── Large Delta Review ───────────────────────────────────────────────────

  const allLargeDeltas = [
    ...whiteResults.filter((r) => {
      if (r.deltaAbs == null || r.deltaPct == null) return false;
      return Math.abs(r.deltaPct) > LARGE_DELTA_PCT * 100 || Math.abs(r.deltaAbs) > LARGE_DELTA_ABS;
    }),
    ...colorResults.filter((r) => {
      if (r.deltaAbs == null || r.deltaPct == null) return false;
      return Math.abs(r.deltaPct) > LARGE_DELTA_PCT * 100 || Math.abs(r.deltaAbs) > LARGE_DELTA_ABS;
    }),
  ].sort((a, b) => Math.abs(b.deltaAbs ?? 0) - Math.abs(a.deltaAbs ?? 0));

  console.log(`\n─── Large Delta Review (${allLargeDeltas.length} rows) ───`);
  if (allLargeDeltas.length > 0) {
    for (const d of allLargeDeltas.slice(0, 20)) {
      console.log(`  ${d.branch} ${d.spec}`);
      console.log(`    Actual: $${d.actualPrice?.toFixed(0) ?? 'N/A'}  Baseline: $${(d.baselinePrice ?? 0).toFixed(0)}  DP: $${(d.dpPrice ?? 0).toFixed(0)}`);
      console.log(`    Delta: $${(d.deltaAbs ?? 0).toFixed(0)} (${(d.deltaPct ?? 0).toFixed(1)}%)  Expert: ${d.dpExpert}  Reason: ${d.dpReason}`);
      const flags = Object.entries(d.flags).filter(([, v]) => v).map(([k]) => k);
      if (flags.length) console.log(`    Flags: ${flags.join(', ')}`);
    }
  }

  // ─── Hue-level Summary ────────────────────────────────────────────────────

  console.log('\n─── Hue-Level Shadow Summary ───');
  for (const [hue, info] of Object.entries(hueResults).sort((a, b) => b[1].count - a[1].count)) {
    const ht = hueTier(hue);
    const tag = ht === 'rare' ? ' [RARE]' : ht === 'caution' ? ' [CAUTION]' : '';
    console.log(`  ${hue.padEnd(12)} n=${String(info.count).padStart(4)}${tag}  largeDeltas=${info.largeDeltas}  warnings=${info.warnings}`);
    const routing = Object.entries(info.routing).sort((a, b) => b[1] - a[1]).slice(0, 3);
    console.log(`    ${routing.map(([k, v]) => `${k}=${v}`).join(' ')}`);
  }

  // ─── Direct StarGem Anchor Review ─────────────────────────────────────────

  const starGemResults = colorResults.filter((r) => r.flags.directStarGem);
  console.log(`\n─── Direct StarGem Anchor Review (${starGemResults.length} anchors) ───`);
  for (const r of starGemResults) {
    console.log(`  ${r.spec}: DP=$${(r.dpPrice ?? 0).toFixed(0)} Baseline=$${(r.baselinePrice ?? 0).toFixed(0)} Expert=${r.dpExpert} Δ=${(r.deltaPct ?? 0).toFixed(1)}%`);
  }

  // ─── Write outputs ─────────────────────────────────────────────────────────

  const shadowReport = {
    date: new Date().toISOString().slice(0, 10),
    modelVersion: 'diamond-prod-vnext-v0.1.0',
    sourceAdjustment: { messiToFactoryFactor: adjustment, starsgemDirectFactor: 1.0 },
    whiteTotalRows: whiteHoldout.length,
    colorTotalRows: colorHoldout.length,
    whiteBranch: {
      routing: whiteRoutingCounts,
      tiers: whiteTierCounts,
      bands: whiteBandCounts,
      reasons: whiteReasonCounts,
      largeDeltas: whiteResults.filter((r) => {
        if (r.deltaAbs == null || r.deltaPct == null) return false;
        return Math.abs(r.deltaPct) > LARGE_DELTA_PCT * 100 || Math.abs(r.deltaAbs) > LARGE_DELTA_ABS;
      }).length,
    },
    colorBranch: {
      routing: colorRoutingCounts,
      tiers: colorTierCounts,
      bands: colorBandCounts,
      reasons: colorReasonCounts,
      directQuoteRecommended: dirQuoteRec,
      rareHueCount,
      largeDeltas: colorResults.filter((r) => {
        if (r.deltaAbs == null || r.deltaPct == null) return false;
        return Math.abs(r.deltaPct) > LARGE_DELTA_PCT * 100 || Math.abs(r.deltaAbs) > LARGE_DELTA_ABS;
      }).length,
    },
    hueSummary: hueResults,
    starGemAnchors: starGemResults.map((r) => ({
      spec: r.spec,
      dpPrice: r.dpPrice,
      baselinePrice: r.baselinePrice,
      dpExpert: r.dpExpert,
      deltaPct: r.deltaPct,
    })),
    largeDeltas: allLargeDeltas.slice(0, 50),
    reviewChecklist: {
      whiteLargeDeltasReviewed: false,
      colorLargeDeltasReviewed: false,
      rareHueWarningsReviewed: false,
      starGemAnchorsReviewed: false,
      highCaratReviewed: false,
      sparseReviewed: false,
      princessReviewed: false,
      rollbackVerified: false,
      featureFlagImplemented: false,
    },
  };

  const outFile = path.join(DATA, 'shadow-release-diamond-prod-vnext.json');
  writeFileSync(outFile, JSON.stringify(shadowReport, null, 2) + '\n');
  console.log(`\nWrote ${path.relative(process.cwd(), outFile)}`);

  // Write large-delta CSV
  if (allLargeDeltas.length > 0) {
    const csvHeader = 'branch,spec,actualPrice,baselinePrice,dpPrice,deltaAbs,deltaPct,expert,tier,band,reason,flags';
    const csvRows = allLargeDeltas.map((d) =>
      `"${d.branch}","${d.spec}",${d.actualPrice},${d.baselinePrice},${d.dpPrice},${d.deltaAbs},${d.deltaPct},"${d.dpExpert}","${d.dpTier}","${d.dpBand}","${d.dpReason}","${Object.entries(d.flags).filter(([, v]) => v).map(([k]) => k).join(';')}"`
    );
    const csvFile = path.join(DATA, 'shadow-release-diamond-prod-vnext-large-deltas.csv');
    writeFileSync(csvFile, [csvHeader, ...csvRows].join('\n') + '\n');
    console.log(`Wrote ${path.relative(process.cwd(), csvFile)}`);
  }

  // ─── Rollout Recommendation ────────────────────────────────────────────────

  console.log('\n─── Rollout Checklist ───');
  console.log('Before cutover to DiamondProd vNext:');
  console.log('  [ ] White large deltas reviewed and explained');
  console.log('  [ ] Color large deltas reviewed and explained');
  console.log('  [ ] Rare hue warnings manually inspected');
  console.log('  [ ] Direct StarGem anchors verified');
  console.log('  [ ] High-carat rows reviewed (≥5ct)');
  console.log('  [ ] Sparse/empty support rows reviewed');
  console.log('  [ ] Princess shape rows reviewed');
  console.log('  [ ] Rollback path verified (S26 for white, S22 for color)');
  console.log('  [ ] Feature flag implemented (diamond_prod_vnext_shadow / diamond_prod_vnext_display)');

  const whiteLargeDeltas = whiteResults.filter((r) => {
    if (r.deltaAbs == null || r.deltaPct == null) return false;
    return Math.abs(r.deltaPct) > LARGE_DELTA_PCT * 100 || Math.abs(r.deltaAbs) > LARGE_DELTA_ABS;
  }).length;
  const colorLargeDeltas = colorResults.filter((r) => {
    if (r.deltaAbs == null || r.deltaPct == null) return false;
    return Math.abs(r.deltaPct) > LARGE_DELTA_PCT * 100 || Math.abs(r.deltaAbs) > LARGE_DELTA_ABS;
  }).length;

  console.log(`\n═══ Shadow Release Complete ═══`);
  console.log(`Summary: ${whiteHoldout.length + colorHoldout.length} rows evaluated`);
  console.log(`  White: ${whiteHoldout.length} rows, ${whiteLargeDeltas} large deltas`);
  console.log(`  Color: ${colorHoldout.length} rows, ${colorLargeDeltas} large deltas, ${dirQuoteRec} direct-quote warnings, ${rareHueCount} rare hue rows`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
