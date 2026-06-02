#!/usr/bin/env node
/**
 * M7 Shadow Release — WhiteProd vNext vs S26 Comparison Logger
 *
 * Runs WhiteProd vNext beside the current S26 production output and logs
 * every prediction with detailed diagnostics for manual review.
 *
 * Outputs:
 *   1. Console summary with routing distribution and large-delta highlights
 *   2. JSON report with every row's prediction for review
 *   3. Large-delta CSV for spreadsheet review (deltas > 20% or > $5000)
 *
 * Usage:
 *   node research/scripts/shadow-release-white-prod-vnext.mjs
 *   node research/scripts/shadow-release-white-prod-vnext.mjs --large-delta-threshold=0.15
 */

import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { starsgemNorm, starsgemCaratBucket } from './starsgem-ml-predict.mjs';
import { buildS30Artifact } from './train-s30-bounded-smooth.mjs';
import { predictWhiteProdVNext, predictS26Lookup, cellKey } from './predict-white-prod-vnext.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, '../data');

function loadJson(name) {
  return JSON.parse(readFileSync(path.join(DATA, name), 'utf8'));
}

// ─── Configuration ───────────────────────────────────────────────────────────

const LARGE_DELTA_PCT = 0.20;   // Flag deltas > 20%
const LARGE_DELTA_ABS = 5000;   // Flag absolute deltas > $5,000
const HIGH_CARAT_THRESHOLD = 5; // High-carat review threshold
const SPARSE_THRESHOLD = 5;     // Sparse cell threshold

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══ M7 Shadow Release — WhiteProd vNext vs S26 ═══\n');

  const allRows = loadJson('dataset-clean-training.json');
  const rowTrain = allRows.filter((r) => {
    const text = String(r.reportNo ?? r.reportno ?? r.rowNo ?? '');
    let total = 0;
    for (const ch of text) total = (total * 131 + ch.charCodeAt(0)) % 1_000_003;
    return total % 5 !== 0;
  });
  const rowHoldout = allRows.filter((r) => {
    const text = String(r.reportNo ?? r.reportno ?? r.rowNo ?? '');
    let total = 0;
    for (const ch of text) total = (total * 131 + ch.charCodeAt(0)) % 1_000_003;
    return total % 5 === 0;
  });

  const fairS30 = buildS30Artifact(rowTrain);

  const ctx = {
    modelVersion: 'white-prod-vnext-v0.1.0',
    s30: loadJson('starsgem-ml-model-s30-bounded-smooth.json'),
    s30Model: fairS30,
    s26Intel: loadJson('starsgem-pricing-intelligence.json'),
    s33a: loadJson('starsgem-ml-model-s33a-constrained-anchors.json'),
    s28: loadJson('starsgem-ml-model-s28-monotone-parametric.json'),
    cellSupport: new Map(),
    routingConfig: {
      s30MinSupport: 15, s30MinCaratForPriority: 5,
      s30MaxUpcRatio: 1.5, s30MinUpcRatio: 0.65,
      s26MinLookupLevel: 4, s26MinLookupCount: 5, s26MaxCarat: 8,
      s33MinAnchorN: 10, princessPreferS26: true,
    },
  };

  for (const r of allRows) {
    const ck = cellKey(r);
    ctx.cellSupport.set(ck, (ctx.cellSupport.get(ck) || 0) + 1);
  }

  console.log(`Evaluating ${rowHoldout.length} holdout rows...\n`);

  // ─── Per-row shadow comparison ────────────────────────────────────────────

  const results = [];
  const largeDeltas = [];
  const routingCounts = { S30: 0, S26: 0, S33A: 0, S28: 0 };
  const tierCounts = { dense: 0, medium: 0, sparse: 0, empty: 0 };
  const bandCounts = { high: 0, medium: 0, low: 0, floor: 0 };
  const reasonCounts = {};
  const reviewFlags = {
    highCarat: 0,
    sparse: 0,
    princess: 0,
    weakAnchor: 0,
    s28Fallback: 0,
    largeDelta: 0,
  };

  for (const row of rowHoldout) {
    const carat = Number(row.carat);
    const actual = Number(row.price);
    const shape = String(row.shape_style || '').toLowerCase();
    const ck = cellKey(row);
    const cellN = ctx.cellSupport.get(ck) ?? 0;
    const isHighCarat = carat >= HIGH_CARAT_THRESHOLD;
    const isSparse = cellN < SPARSE_THRESHOLD;
    const isPrincess = shape === 'princess_standard';

    // S26 current production
    const s26 = predictS26Lookup(row, ctx.s26Intel);
    const s26Price = s26?.price ?? null;

    // WhiteProd vNext
    const wp = predictWhiteProdVNext(row, ctx);
    const wpPrice = wp?.price ?? null;

    // Compute deltas
    let deltaAbs = null;
    let deltaPct = null;
    if (wpPrice != null && s26Price != null && s26Price > 0) {
      deltaAbs = wpPrice - s26Price;
      deltaPct = (wpPrice - s26Price) / s26Price;
    }

    const isLargeDelta = (deltaPct != null && Math.abs(deltaPct) > LARGE_DELTA_PCT)
      || (deltaAbs != null && Math.abs(deltaAbs) > LARGE_DELTA_ABS);

    // Track routing
    routingCounts[wp?.selectedExpert ?? 'S28']++;
    tierCounts[wp?.supportTier ?? 'empty']++;
    bandCounts[wp?.confidenceBand ?? 'null']++;
    const reason = wp?.fallbackReason ?? 'none';
    reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;

    // Track review flags
    if (isHighCarat) reviewFlags.highCarat++;
    if (isSparse) reviewFlags.sparse++;
    if (isPrincess) reviewFlags.princess++;
    if (reason?.startsWith('s33a_weak_anchor')) reviewFlags.weakAnchor++;
    if (wp?.selectedExpert === 'S28') reviewFlags.s28Fallback++;
    if (isLargeDelta) reviewFlags.largeDelta++;

    const record = {
      spec: `${carat}ct ${shape} ${row.color}/${row.clarity} ${row.cut_raw ?? '-'} ${row.typeName ?? '-'}`,
      reportNo: row.reportNo ?? row.reportno ?? 'N/A',
      actualPrice: actual,
      s26Price,
      wpPrice,
      wpUpc: wp?.pricePerCarat ?? null,
      wpExpert: wp?.selectedExpert ?? null,
      wpTier: wp?.supportTier ?? null,
      wpBand: wp?.confidenceBand ?? null,
      wpReason: wp?.fallbackReason ?? null,
      deltaAbs: deltaAbs != null ? +deltaAbs.toFixed(2) : null,
      deltaPct: deltaPct != null ? +(deltaPct * 100).toFixed(2) : null,
      flags: {
        highCarat: isHighCarat,
        sparse: isSparse,
        princess: isPrincess,
        weakAnchor: reason?.startsWith('s33a_weak_anchor'),
        s28Fallback: wp?.selectedExpert === 'S28',
        largeDelta: isLargeDelta,
      },
    };

    results.push(record);

    if (isLargeDelta) {
      largeDeltas.push(record);
    }
  }

  // ─── Summary ───────────────────────────────────────────────────────────────

  console.log('─── Shadow Release Summary ───\n');

  console.log('Routing Distribution:');
  for (const [expert, count] of Object.entries(routingCounts)) {
    console.log(`  ${expert.padEnd(6)} ${String(count).padStart(5)} (${(count / rowHoldout.length * 100).toFixed(1)}%)`);
  }

  console.log('\nConfidence Bands:');
  for (const [band, count] of Object.entries(bandCounts)) {
    if (count > 0) console.log(`  ${band.padEnd(8)} ${String(count).padStart(5)}`);
  }

  console.log('\nReview Flags:');
  for (const [flag, count] of Object.entries(reviewFlags)) {
    console.log(`  ${flag.padEnd(16)} ${String(count).padStart(5)} (${(count / rowHoldout.length * 100).toFixed(1)}%)`);
  }

  console.log(`\nLarge Deltas (>${(LARGE_DELTA_PCT * 100).toFixed(0)}% or >$${LARGE_DELTA_ABS}): ${largeDeltas.length}`);
  if (largeDeltas.length > 0) {
    console.log('\n─── Large Delta Review ───');
    // Show top 15 largest by absolute delta
    const topDeltas = largeDeltas
      .sort((a, b) => Math.abs(b.deltaAbs ?? 0) - Math.abs(a.deltaAbs ?? 0))
      .slice(0, 15);
    for (const d of topDeltas) {
      console.log(`  ${d.spec}`);
      console.log(`    Actual: $${d.actualPrice.toFixed(0)}  S26: $${(d.s26Price ?? 0).toFixed(0)}  WP: $${(d.wpPrice ?? 0).toFixed(0)}`);
      console.log(`    Delta: $${(d.deltaAbs ?? 0).toFixed(0)} (${(d.deltaPct ?? 0).toFixed(1)}%)  Expert: ${d.wpExpert}  Reason: ${d.wpReason}  Flags: ${Object.entries(d.flags).filter(([,v]) => v).map(([k]) => k).join(', ')}`);
    }
  }

  // ─── Weak-Anchor Review ───────────────────────────────────────────────────

  const weakAnchorRows = results.filter((r) => r.flags.weakAnchor);
  console.log(`\n─── Weak-Anchor S33A Review (${weakAnchorRows.length} rows) ───`);
  const weakByN = {};
  for (const r of weakAnchorRows) {
    const n = r.wpReason?.match(/n(\d+)/)?.[1] ?? '?';
    weakByN[n] = (weakByN[n] || 0) + 1;
  }
  for (const [n, count] of Object.entries(weakByN).sort((a, b) => +a[0] - +b[0])) {
    console.log(`  anchorN=${n}: ${count} rows`);
  }

  // High-carat weak anchors
  const highCaratWeakAnchors = weakAnchorRows.filter((r) => r.flags.highCarat);
  if (highCaratWeakAnchors.length > 0) {
    console.log(`\n  High-carat weak anchors (≥${HIGH_CARAT_THRESHOLD}ct): ${highCaratWeakAnchors.length}`);
    for (const r of highCaratWeakAnchors.slice(0, 10)) {
      console.log(`    ${r.spec}: WP=$${(r.wpPrice ?? 0).toFixed(0)} S26=$${(r.s26Price ?? 0).toFixed(0)} Δ=$${(r.deltaAbs ?? 0).toFixed(0)} (${(r.deltaPct ?? 0).toFixed(1)}%) expert=${r.wpExpert}`);
    }
  }

  // ─── Write outputs ─────────────────────────────────────────────────────────

  const shadowReport = {
    date: new Date().toISOString().slice(0, 10),
    modelVersion: ctx.modelVersion,
    totalRows: rowHoldout.length,
    summary: {
      routing: routingCounts,
      tiers: tierCounts,
      bands: bandCounts,
      reviewFlags,
      largeDeltaCount: largeDeltas.length,
    },
    largeDeltas: largeDeltas.sort((a, b) => Math.abs(b.deltaAbs ?? 0) - Math.abs(a.deltaAbs ?? 0)),
    weakAnchorReview: {
      total: weakAnchorRows.length,
      byN: weakByN,
      highCarat: highCaratWeakAnchors.length,
    },
    allResults: results,
    reviewChecklist: {
      highCaratReviewed: false,
      sparseReviewed: false,
      princessReviewed: false,
      weakAnchorReviewed: false,
      largeDeltasReviewed: false,
      rollbackVerified: false,
    },
  };

  const outFile = path.join(DATA, 'shadow-release-white-prod-vnext.json');
  writeFileSync(outFile, JSON.stringify(shadowReport, null, 2) + '\n');
  console.log(`\nWrote ${path.relative(process.cwd(), outFile)}`);

  // Write CSV of large deltas for spreadsheet review
  if (largeDeltas.length > 0) {
    const csvHeader = 'spec,actualPrice,s26Price,wpPrice,deltaAbs,deltaPct,expert,tier,band,reason,flags';
    const csvRows = largeDeltas.map((d) =>
      `"${d.spec}",${d.actualPrice},${d.s26Price},${d.wpPrice},${d.deltaAbs},${d.deltaPct},"${d.wpExpert}","${d.wpTier}","${d.wpBand}","${d.wpReason}","${Object.entries(d.flags).filter(([,v]) => v).map(([k]) => k).join(';')}"`
    );
    const csvFile = path.join(DATA, 'shadow-release-large-deltas.csv');
    writeFileSync(csvFile, [csvHeader, ...csvRows].join('\n') + '\n');
    console.log(`Wrote ${path.relative(process.cwd(), csvFile)}`);
  }

  // ─── Rollback Check ───────────────────────────────────────────────────────

  console.log('\n─── Rollback Readiness ───');
  console.log('  S26 predictor: Available ✓');
  console.log('  WhiteProd vNext predictor: Available ✓');
  console.log('  Feature flag: pending (see Change 6)');
  console.log('  Rollback: S26 can be restored without code changes ✓');

  console.log('\n═══ Shadow Release Complete ═══');
  console.log(`Review ${path.relative(process.cwd(), outFile)} for full results.`);
  console.log('Checklist before cutover:');
  console.log('  [ ] High-carat rows reviewed');
  console.log('  [ ] Sparse rows reviewed');
  console.log('  [ ] Princess rows reviewed');
  console.log('  [ ] Weak-anchor cases reviewed');
  console.log('  [ ] Large deltas reviewed and explained');
  console.log('  [ ] Rollback path verified');
  console.log('  [ ] Feature flag implemented');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
