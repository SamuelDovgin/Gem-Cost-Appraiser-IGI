#!/usr/bin/env node
/**
 * Weak-Anchor Audit Report — S33A Anchor Quality vs S26/Comp Corroboration
 *
 * Lists every row where S33A produces a weak (anchorN < 10) or broad
 * (anchorLevel >= 4) anchor, compares against S26 lookup and optional
 * comp estimate, and flags cases with large S33A-vs-market deltas.
 *
 * This audit catches the exact failure mode observed in LG617442564 and
 * LG758549300 before those prices reach the UI.
 *
 * Usage:
 *   node research/scripts/audit-weak-anchors.mjs
 *   node research/scripts/audit-weak-anchors.mjs --anchorN-max=5 --delta-pct=0.15
 *
 * Output:
 *   1. Console summary with flagged cases
 *   2. JSON report: research/data/audit-weak-anchors.json
 */

import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { starsgemNorm, starsgemCaratBucket } from './starsgem-ml-predict.mjs';
import { buildS30Artifact } from './train-s30-bounded-smooth.mjs';
import {
  predictWhiteProdVNext,
  predictS26Lookup,
  predictS33A,
  cellKey,
  supportTier,
} from './predict-white-prod-vnext.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, '../data');

function loadJson(name) {
  return JSON.parse(readFileSync(path.join(DATA, name), 'utf8'));
}

// ─── Configuration ───────────────────────────────────────────────────────────

const ANCHOR_N_MAX = parseInt(process.argv[2]?.replace(/[^0-9]/g, '') || '10', 10);
const DELTA_PCT_THRESHOLD = parseFloat(process.argv[3]?.replace(/[^0-9.]/g, '') || '0.20');
const BROAD_ANCHOR_LEVEL = 4; // L4=shape-only and above are considered broad

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══ Weak-Anchor Audit Report ═══\n');
  console.log(`AnchorN threshold: < ${ANCHOR_N_MAX}`);
  console.log(`Broad anchor level: >= L${BROAD_ANCHOR_LEVEL} (shape-only or global)`);
  console.log(`Delta threshold: > ${(DELTA_PCT_THRESHOLD * 100).toFixed(0)}%\n`);

  const allRows = loadJson('dataset-clean-training.json');
  const rowHoldout = allRows.filter((r) => {
    const text = String(r.reportNo ?? r.reportno ?? r.rowNo ?? '');
    let total = 0;
    for (const ch of text) total = (total * 131 + ch.charCodeAt(0)) % 1_000_003;
    return total % 5 === 0;
  });
  const rowTrain = allRows.filter((r) => {
    const text = String(r.reportNo ?? r.reportno ?? r.rowNo ?? '');
    let total = 0;
    for (const ch of text) total = (total * 131 + ch.charCodeAt(0)) % 1_000_003;
    return total % 5 !== 0;
  });

  const fairS30 = buildS30Artifact(rowTrain);

  const ctx = {
    modelVersion: 'white-prod-vnext-v0.2.0',
    s30: loadJson('starsgem-ml-model-s30-bounded-smooth.json'),
    s30Model: fairS30,
    s26Intel: loadJson('starsgem-pricing-intelligence.json'),
    s33a: loadJson('starsgem-ml-model-s33a-constrained-anchors.json'),
    s28: loadJson('starsgem-ml-model-s28-monotone-parametric.json'),
    cellSupport: new Map(),
    routingConfig: {
      s30MinSupport: 15,
      s30MinCaratForPriority: 5,
      s30MaxUpcRatio: 1.5,
      s30MinUpcRatio: 0.65,
      s26MinLookupLevel: 4,
      s26MinLookupCount: 5,
      s26MaxCarat: 8,
      s33MinAnchorN: 10,
      princessPreferS26: true,
    },
  };

  for (const r of allRows) {
    const ck = cellKey(r);
    ctx.cellSupport.set(ck, (ctx.cellSupport.get(ck) || 0) + 1);
  }

  // ── Audit every holdout row ──────────────────────────────────────────────
  const auditRows = [];
  let weakNCount = 0;
  let broadLevelCount = 0;
  let flaggedCount = 0;
  let mitigatedCount = 0;  // rows where weak raw S33A does not become display S33A

  for (const row of rowHoldout) {
    const carat = Number(row.carat ?? row.Carat);
    if (!Number.isFinite(carat) || carat <= 0) continue;

    // Get raw S33A prediction (without routing)
    const s33Raw = predictS33A(row, ctx.s33a);
    const s33AnchorN = s33Raw?.anchorN ?? 0;
    const s33AnchorLevel = s33Raw?.anchorLevel ?? null;

    const isWeakN = s33AnchorN > 0 && s33AnchorN < ANCHOR_N_MAX;
    const isBroadLevel = s33AnchorLevel != null && s33AnchorLevel >= BROAD_ANCHOR_LEVEL;

    if (!isWeakN && !isBroadLevel) continue;

    if (isWeakN) weakNCount++;
    if (isBroadLevel) broadLevelCount++;

    // Get the actual router result
    const routed = predictWhiteProdVNext(row, ctx);

    // Get S26 lookup for comparison
    const s26Lookup = predictS26Lookup(row, ctx.s26Intel);

    const s33Price = s33Raw?.price ?? null;
    const s33Upc = s33Raw?.upc ?? null;
    const s26Price = s26Lookup?.price ?? null;
    const s26Upc = s26Lookup?.upc ?? null;
    const routedPrice = routed?.price ?? null;
    const routedExpert = routed?.selectedExpert ?? null;
    const routedReason = routed?.fallbackReason ?? null;

    // Calculate deltas
    const s26VsS33Delta = (s33Upc && s26Upc) ? (s26Upc - s33Upc) / s33Upc : null;
    const isLargeDelta = s26VsS33Delta != null && Math.abs(s26VsS33Delta) > DELTA_PCT_THRESHOLD;
    const wasMitigated = routedExpert !== 'S33A';

    if (isLargeDelta) flaggedCount++;
    if (wasMitigated) mitigatedCount++;

    const entry = {
      reportNo: row.reportNo ?? row.reportno ?? 'N/A',
      carat: +carat.toFixed(2),
      shape: row.shape_style ?? row.shape ?? 'N/A',
      color: starsgemNorm(row.color ?? row.Color),
      clarity: starsgemNorm(row.clarity ?? row.Clarity),
      s33AnchorN,
      s33AnchorLevel,
      s33Price: s33Price ? +s33Price.toFixed(2) : null,
      s33Upc: s33Upc ? +s33Upc.toFixed(2) : null,
      s26Price: s26Price ? +s26Price.toFixed(2) : null,
      s26Upc: s26Upc ? +s26Upc.toFixed(2) : null,
      s26LookupLevel: s26Lookup?.lookupLevel ?? null,
      s26LookupCount: s26Lookup?.lookupCount ?? 0,
      s26VsS33DeltaPct: s26VsS33Delta != null ? +(s26VsS33Delta * 100).toFixed(1) : null,
      routedExpert,
      routedPrice: routedPrice ? +routedPrice.toFixed(2) : null,
      routedReason,
      flagged: isLargeDelta,
      mitigated: wasMitigated,
      issueType: isWeakN ? (isBroadLevel ? 'weak_n_and_broad' : 'weak_n') : 'broad_level',
    };

    auditRows.push(entry);
  }

  // ── Summary ──────────────────────────────────────────────────────────────

  console.log(`─── Audit Summary ───`);
  console.log(`Total holdout rows: ${rowHoldout.length}`);
  console.log(`Rows with weak/broad S33A anchor: ${auditRows.length}`);
  console.log(`  Weak anchorN (< ${ANCHOR_N_MAX}): ${weakNCount}`);
  console.log(`  Broad anchor level (>= L${BROAD_ANCHOR_LEVEL}): ${broadLevelCount}`);
  console.log(`  Large S26-vs-S33A deltas (> ${(DELTA_PCT_THRESHOLD * 100).toFixed(0)}%): ${flaggedCount}`);
  console.log(`  Mitigated by router (not displayed as S33A): ${mitigatedCount}\n`);

  // ── Flagged cases ────────────────────────────────────────────────────────

  const flagged = auditRows.filter((r) => r.flagged);
  if (flagged.length > 0) {
    console.log(`─── Flagged Cases (S26-vs-S33A delta > ${(DELTA_PCT_THRESHOLD * 100).toFixed(0)}%) ───`);
    // Sort by absolute delta descending
    flagged.sort((a, b) => Math.abs(b.s26VsS33DeltaPct || 0) - Math.abs(a.s26VsS33DeltaPct || 0));
    for (const r of flagged.slice(0, 20)) {
      const status = r.mitigated ? `✓ MITIGATED→${r.routedExpert}` : '⚠ STILL S33A';
      console.log(`  ${status} ${r.carat}ct ${r.shape} ${r.color}/${r.clarity}: S33A=$${r.s33Price?.toFixed(0) ?? 'N/A'} S26=$${r.s26Price?.toFixed(0) ?? 'N/A'} Δ=${r.s26VsS33DeltaPct?.toFixed(1) ?? '?'}% → ${r.routedExpert} (${r.routedReason ?? 'none'})`);
    }
    if (flagged.length > 20) console.log(`  ... and ${flagged.length - 20} more flagged cases`);
  }

  // ── Still-S33A weak anchors ──────────────────────────────────────────────

  const stillS33A = auditRows.filter((r) => r.routedExpert === 'S33A' && r.flagged);
  if (stillS33A.length > 0) {
    console.log(`\n─── ⚠ STILL S33A Despite Large Delta (${stillS33A.length} rows) ───`);
    for (const r of stillS33A.slice(0, 10)) {
      console.log(`  ⚠ ${r.carat}ct ${r.shape} ${r.color}/${r.clarity}: S33A=$${r.s33Price?.toFixed(0)} S26=$${r.s26Price?.toFixed(0)} Δ=${r.s26VsS33DeltaPct?.toFixed(1)}% anchorN=${r.s33AnchorN} L${r.s33AnchorLevel}`);
    }
  }

  // ── AnchorN distribution ─────────────────────────────────────────────────

  console.log(`\n─── AnchorN Distribution (weak/broad rows) ───`);
  const nDist = new Map();
  for (const r of auditRows) {
    const key = r.s33AnchorN;
    nDist.set(key, (nDist.get(key) || 0) + 1);
  }
  const sortedN = [...nDist.entries()].sort((a, b) => a[0] - b[0]);
  for (const [n, count] of sortedN) {
    const mitigated = auditRows.filter((r) => r.s33AnchorN === n && r.mitigated).length;
    const marker = mitigated > 0 ? ` (${mitigated} mitigated)` : '';
    console.log(`  anchorN=${n}: ${count} rows${marker}`);
  }

  // ── AnchorLevel distribution ─────────────────────────────────────────────

  console.log(`\n─── Anchor Level Distribution (weak/broad rows) ───`);
  const lDist = new Map();
  for (const r of auditRows) {
    const key = `L${r.s33AnchorLevel}`;
    lDist.set(key, (lDist.get(key) || 0) + 1);
  }
  const sortedL = [...lDist.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [level, count] of sortedL) {
    const mitigated = auditRows.filter((r) => `L${r.s33AnchorLevel}` === level && r.mitigated).length;
    const marker = mitigated > 0 ? ` (${mitigated} mitigated)` : '';
    console.log(`  ${level}: ${count} rows${marker}`);
  }

  // ── Issue type distribution ──────────────────────────────────────────────

  console.log(`\n─── Issue Type Distribution ───`);
  const issueDist = new Map();
  for (const r of auditRows) {
    issueDist.set(r.issueType, (issueDist.get(r.issueType) || 0) + 1);
  }
  for (const [type, count] of issueDist.entries()) {
    const mitigated = auditRows.filter((r) => r.issueType === type && r.mitigated).length;
    const marker = mitigated > 0 ? ` (${mitigated} mitigated by router)` : '';
    console.log(`  ${type}: ${count} rows${marker}`);
  }

  // ── Write report ─────────────────────────────────────────────────────────

  const report = {
    date: new Date().toISOString().slice(0, 10),
    modelVersion: ctx.modelVersion,
    config: {
      anchorNMax: ANCHOR_N_MAX,
      broadAnchorLevel: BROAD_ANCHOR_LEVEL,
      deltaPctThreshold: DELTA_PCT_THRESHOLD,
    },
    summary: {
      totalHoldoutRows: rowHoldout.length,
      weakOrBroadRows: auditRows.length,
      weakN: weakNCount,
      broadLevel: broadLevelCount,
      flaggedLargeDeltas: flaggedCount,
      mitigatedByRouter: mitigatedCount,
      stillS33ADespiteLargeDelta: stillS33A.length,
    },
    flaggedCases: flagged,
    stillS33ACases: stillS33A,
    allAuditRows: auditRows,
  };

  const outFile = path.join(DATA, 'audit-weak-anchors.json');
  writeFileSync(outFile, JSON.stringify(report, null, 2) + '\n');
  console.log(`\nWrote ${path.relative(process.cwd(), outFile)}`);

  // ─── Verdict ─────────────────────────────────────────────────────────────

  if (stillS33A.length === 0) {
    console.log('\n✓ All weak/broad S33A cases with large S26 deltas were mitigated by the router.');
    console.log('No cases require manual review.');
  } else {
    console.log(`\n⚠ ${stillS33A.length} weak/broad S33A case(s) with large S26 deltas still route to S33A.`);
    console.log('Review these cases — they may need additional router rules or manual pricing.');
  }

  console.log('\n═══ Audit Complete ═══');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
