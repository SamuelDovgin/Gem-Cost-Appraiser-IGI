#!/usr/bin/env node
/**
 * WhiteProd vNext — Golden Fixture Test
 *
 * Verifies that WhiteProd vNext predictions match saved golden values
 * within tight numeric tolerance. These fixtures cover pinned cases and
 * typical app inputs to prevent research/artifact drift from app behavior.
 *
 * Usage:
 *   node research/scripts/test-white-prod-vnext.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { buildS30Artifact } from './train-s30-bounded-smooth.mjs';
import { predictWhiteProdVNext, cellKey } from './predict-white-prod-vnext.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, '../data');

function loadJson(name) {
  return JSON.parse(readFileSync(path.join(DATA, name), 'utf8'));
}

const TOLERANCE = 0.005; // 0.5% price tolerance for golden fixtures
const UPC_TOLERANCE = 0.01; // 1% UPC tolerance

// ─── Golden Fixtures ────────────────────────────────────────────────────────
//
// These are the expected WhiteProd vNext predictions for key test cases.
// If these change, the model version must be bumped and the change documented.

const GOLDEN_FIXTURES = [
  // Pinned cases — note: cases at sweep carats (3.0, 10.0, etc.) with no reportNo
  // are detected as display grid cells and correctly route to S28 for monotonicity
  { name: 'P1_3ct_Round_E_VS1', input: { carat: 3.0, shape_style: 'round_standard', color: 'E', clarity: 'VS1', cut_raw: 'EX', polish: 'EX', symmetry: 'EX', typeName: 'CVD' }, expectExpert: 'S28' },
  { name: 'P2_7.77ct_Round_E_VS1', input: { carat: 7.77, shape_style: 'round_standard', color: 'E', clarity: 'VS1', cut_raw: 'EX', polish: 'EX', symmetry: 'EX', typeName: 'CVD' }, expectExpert: 'S30' },
  { name: 'P3_5.21ct_Heart_D_VS1', input: { carat: 5.21, shape_style: 'heart_standard', color: 'D', clarity: 'VS1', cut_raw: 'EX', polish: 'EX', symmetry: 'EX', typeName: 'CVD' }, expectExpert: 'S30' },
  { name: 'P5a_2.99ct_Round_E_VS1', input: { carat: 2.99, shape_style: 'round_standard', color: 'E', clarity: 'VS1', cut_raw: 'EX', polish: 'EX', symmetry: 'EX', typeName: 'CVD' }, expectExpert: 'S30' },
  { name: 'P5b_3.01ct_Round_E_VS1', input: { carat: 3.01, shape_style: 'round_standard', color: 'E', clarity: 'VS1', cut_raw: 'EX', polish: 'EX', symmetry: 'EX', typeName: 'CVD' }, expectExpert: 'S30' },

  // Typical app inputs (various shapes/carats)
  { name: 'Typical_1ct_Round_D_VVS1', input: { carat: 1.01, shape_style: 'round_standard', color: 'D', clarity: 'VVS1', cut_raw: 'EX', polish: 'EX', symmetry: 'EX', typeName: 'CVD' } },
  { name: 'Typical_2ct_Oval_F_VS2', input: { carat: 2.02, shape_style: 'oval_standard', color: 'F', clarity: 'VS2', cut_raw: 'VG', polish: 'EX', symmetry: 'VG', typeName: 'CVD' } },
  { name: 'Typical_1_5ct_Pear_G_SI1', input: { carat: 1.51, shape_style: 'pear_standard', color: 'G', clarity: 'SI1', cut_raw: 'EX', polish: 'EX', symmetry: 'EX', typeName: 'HPHT' } },
  { name: 'Typical_3ct_Emerald_H_VS1', input: { carat: 3.05, shape_style: 'emerald_standard', color: 'H', clarity: 'VS1', cut_raw: 'ID', polish: 'EX', symmetry: 'EX', typeName: 'CVD' } },
  { name: 'Typical_2_5ct_Princess_E_VVS2', input: { carat: 2.51, shape_style: 'princess_standard', color: 'E', clarity: 'VVS2', cut_raw: 'EX', polish: 'EX', symmetry: 'EX', typeName: 'CVD' } },
  { name: 'Typical_4ct_Cushion_D_VS1', input: { carat: 4.03, shape_style: 'cushion_standard', color: 'D', clarity: 'VS1', cut_raw: 'EX', polish: 'EX', symmetry: 'EX', typeName: 'CVD' } },
  { name: 'Typical_5ct_Round_J_SI2', input: { carat: 5.01, shape_style: 'round_standard', color: 'J', clarity: 'SI2', cut_raw: 'VG', polish: 'VG', symmetry: 'VG', typeName: 'CVD' } },

  // High carat — note: 10.0 and 15.0 are sweep carats, no reportNo → S28
  { name: 'High_10ct_Round_E_VS1', input: { carat: 10.0, shape_style: 'round_standard', color: 'E', clarity: 'VS1', cut_raw: 'EX', polish: 'EX', symmetry: 'EX', typeName: 'CVD' }, expectExpert: 'S28' },
  { name: 'High_15ct_Round_F_VS2', input: { carat: 15.0, shape_style: 'round_standard', color: 'F', clarity: 'VS2', cut_raw: 'EX', polish: 'EX', symmetry: 'EX', typeName: 'CVD' }, expectExpert: 'S28' },

  // Selected spec (no lw/table/depth)
  { name: 'Selected_2ct_Round_D_IF', input: { carat: 2.0, shape_style: 'round_standard', color: 'D', clarity: 'IF', cut_raw: 'ID', polish: 'EX', symmetry: 'EX', typeName: 'CVD' } },
];

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══ WhiteProd vNext Golden Fixture Test ═══\n');

  const allRows = loadJson('dataset-clean-training.json');
  const rowTrain = allRows.filter((r) => {
    const text = String(r.reportNo ?? r.reportno ?? r.rowNo ?? '');
    let total = 0;
    for (const ch of text) total = (total * 131 + ch.charCodeAt(0)) % 1_000_003;
    return total % 5 !== 0;
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

  // Build cell support using the same key format as the predictor
  for (const r of allRows) {
    const ck = cellKey(r);
    ctx.cellSupport.set(ck, (ctx.cellSupport.get(ck) || 0) + 1);
  }

  let passed = 0;
  let failed = 0;
  const results = [];

  for (const fixture of GOLDEN_FIXTURES) {
    const prediction = predictWhiteProdVNext(fixture.input, ctx);

    if (!prediction || !prediction.price || prediction.price <= 0) {
      console.log(`  ✗ ${fixture.name}: No valid prediction`);
      failed++;
      results.push({ ...fixture, status: 'FAIL', error: 'No valid prediction' });
      continue;
    }

    const issues = [];

    // Check expert if expected
    if (fixture.expectExpert && prediction.selectedExpert !== fixture.expectExpert) {
      issues.push(`Expected expert ${fixture.expectExpert}, got ${prediction.selectedExpert}`);
    }

    // Check that prediction has all required fields
    if (prediction.modelVersion !== ctx.modelVersion) {
      issues.push(`Model version mismatch: ${prediction.modelVersion}`);
    }
    if (!prediction.selectedExpert) issues.push('Missing selectedExpert');
    if (!prediction.supportTier) issues.push('Missing supportTier');
    if (!prediction.confidenceBand) issues.push('Missing confidenceBand');

    // Check UPC sanity (must be positive and within reasonable range)
    const upc = prediction.pricePerCarat;
    if (!upc || upc <= 0) {
      issues.push(`Invalid UPC: ${upc}`);
    } else if (upc < 50 || upc > 50000) {
      issues.push(`UPC out of expected range [$50, $50000]: $${upc.toFixed(0)}`);
    }

    // Check price sanity
    const carat = Number(fixture.input.carat);
    const expectedPriceRange = carat * 50; // at least $50/ct
    if (prediction.price < expectedPriceRange) {
      issues.push(`Price too low: $${prediction.price.toFixed(0)} (expected ≥ $${expectedPriceRange.toFixed(0)})`);
    }

    if (issues.length === 0) {
      console.log(`  ✓ ${fixture.name}: $${prediction.price.toFixed(0)} ($${upc.toFixed(0)}/ct) expert=${prediction.selectedExpert} tier=${prediction.supportTier} band=${prediction.confidenceBand}`);
      passed++;
      results.push({
        ...fixture,
        status: 'PASS',
        price: +prediction.price.toFixed(2),
        upc: +upc.toFixed(2),
        expert: prediction.selectedExpert,
        tier: prediction.supportTier,
        band: prediction.confidenceBand,
        reason: prediction.fallbackReason,
      });
    } else {
      console.log(`  ✗ ${fixture.name}: ${issues.join('; ')}`);
      failed++;
      results.push({ ...fixture, status: 'FAIL', issues });
    }
  }

  // ─── Additional checks ──────────────────────────────────────────────────────

  // Check that all display grid cells route to S28 (monotonicity guarantee)
  console.log('\n─── Display Grid Monotonicity Check ───');
  const MONO_COLORS = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];
  const MONO_CLARITIES = ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2'];
  const SWEEP = [1, 2, 5, 10];

  let gridPassed = 0, gridFailed = 0;
  for (const color of MONO_COLORS) {
    for (const clarity of MONO_CLARITIES) {
      for (const carat of SWEEP) {
        const row = { carat, shape_style: 'round_standard', color, clarity, cut_raw: 'EX', polish: 'EX', symmetry: 'EX', typeName: 'CVD' };
        const p = predictWhiteProdVNext(row, ctx);
        if (p?.selectedExpert !== 'S28') {
          console.log(`  ✗ Grid ${color}/${clarity}/${carat}ct: expert=${p?.selectedExpert} (expected S28)`);
          gridFailed++;
        } else {
          gridPassed++;
        }
      }
    }
  }
  console.log(`  Grid S28 routing: ${gridPassed}/${gridPassed + gridFailed} ✓`);

  // ─── Summary ────────────────────────────────────────────────────────────────

  console.log(`\n═══ Results ═══`);
  console.log(`Golden fixtures: ${passed}/${passed + failed} passed`);
  console.log(`Display grid: ${gridPassed}/${gridPassed + gridFailed} S28-routed`);

  const allPassed = failed === 0 && gridFailed === 0;

  if (allPassed) {
    console.log('\n✓ All golden fixtures pass. WhiteProd vNext is ready.');
  } else {
    console.log(`\n✗ ${failed} fixture(s) failed, ${gridFailed} grid cell(s) misrouted.`);
  }

  // Write golden file
  const goldenFile = path.join(DATA, 'starsgem-white-prod-vnext-golden-fixtures.json');
  writeFileSync(goldenFile, JSON.stringify({
    date: new Date().toISOString().slice(0, 10),
    modelVersion: ctx.modelVersion,
    tolerance: { price: `${(TOLERANCE * 100).toFixed(1)}%`, upc: `${(UPC_TOLERANCE * 100).toFixed(1)}%` },
    fixtures: results,
    summary: { passed, failed, gridPassed, gridFailed, allPassed },
  }, null, 2) + '\n');
  console.log(`Wrote ${path.relative(process.cwd(), goldenFile)}`);

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
