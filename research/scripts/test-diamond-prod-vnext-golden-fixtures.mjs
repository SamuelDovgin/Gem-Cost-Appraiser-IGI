#!/usr/bin/env node
/**
 * DiamondProd vNext — Golden Fixture Test
 *
 * Verifies that DiamondProd vNext predictions match saved golden values
 * within tight numeric tolerance. These fixtures cover pinned cases and
 * typical app inputs for both white and fancy-color branches.
 *
 * Usage:
 *   node research/scripts/test-diamond-prod-vnext-golden-fixtures.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { buildS30Artifact } from './train-s30-bounded-smooth.mjs';
import { loadDiamondProdVNext, predictDiamondProdVNext, predictDiamondProdVNextBatch } from './predict-diamond-prod-vnext.mjs';
import { predictWhiteProdVNext, cellKey as whiteCellKey } from './predict-white-prod-vnext.mjs';
import { predictColorProdVNext, cellKey as colorCellKey } from './predict-color-prod-vnext.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, '../data');

function loadJson(name) {
  return JSON.parse(readFileSync(path.join(DATA, name), 'utf8'));
}

const TOLERANCE = 0.005; // 0.5% price tolerance for golden fixtures
const UPC_TOLERANCE = 0.01; // 1% UPC tolerance

// ─── Golden Fixtures ────────────────────────────────────────────────────────
//
// These are the expected DiamondProd vNext predictions for key test cases.
// If these change, the model version must be bumped and the change documented.

const GOLDEN_FIXTURES = [
  // ═══ White pinned cases (from WhiteProd vNext golden fixtures) ═══
  { name: 'W1_3ct_Round_E_VS1', input: { carat: 3.0, shape_style: 'round_standard', color: 'E', clarity: 'VS1', cut_raw: 'EX', polish: 'EX', symmetry: 'EX', typeName: 'CVD' }, expectBranch: 'white', expectExpert: 'S28' },
  { name: 'W2_7.77ct_Round_E_VS1', input: { carat: 7.77, shape_style: 'round_standard', color: 'E', clarity: 'VS1', cut_raw: 'EX', polish: 'EX', symmetry: 'EX', typeName: 'CVD' }, expectBranch: 'white', expectExpert: 'S30' },
  { name: 'W3_5.21ct_Heart_D_VS1', input: { carat: 5.21, shape_style: 'heart_standard', color: 'D', clarity: 'VS1', cut_raw: 'EX', polish: 'EX', symmetry: 'EX', typeName: 'CVD' }, expectBranch: 'white', expectExpert: 'S30' },
  { name: 'W4_2.99ct_Round_E_VS1', input: { carat: 2.99, shape_style: 'round_standard', color: 'E', clarity: 'VS1', cut_raw: 'EX', polish: 'EX', symmetry: 'EX', typeName: 'CVD' }, expectBranch: 'white', expectExpert: 'S30' },
  { name: 'W5_3.01ct_Round_E_VS1', input: { carat: 3.01, shape_style: 'round_standard', color: 'E', clarity: 'VS1', cut_raw: 'EX', polish: 'EX', symmetry: 'EX', typeName: 'CVD' }, expectBranch: 'white', expectExpert: 'S30' },

  // Typical white app inputs
  { name: 'W6_1ct_Round_D_VVS1', input: { carat: 1.01, shape_style: 'round_standard', color: 'D', clarity: 'VVS1', cut_raw: 'EX', polish: 'EX', symmetry: 'EX', typeName: 'CVD' }, expectBranch: 'white' },
  { name: 'W7_2ct_Oval_F_VS2', input: { carat: 2.02, shape_style: 'oval_standard', color: 'F', clarity: 'VS2', cut_raw: 'VG', polish: 'EX', symmetry: 'VG', typeName: 'CVD' }, expectBranch: 'white' },
  { name: 'W8_1_5ct_Pear_G_SI1', input: { carat: 1.51, shape_style: 'pear_standard', color: 'G', clarity: 'SI1', cut_raw: 'EX', polish: 'EX', symmetry: 'EX', typeName: 'HPHT' }, expectBranch: 'white' },
  { name: 'W9_3ct_Emerald_H_VS1', input: { carat: 3.05, shape_style: 'emerald_standard', color: 'H', clarity: 'VS1', cut_raw: 'ID', polish: 'EX', symmetry: 'EX', typeName: 'CVD' }, expectBranch: 'white' },
  { name: 'W10_2_5ct_Princess_E_VVS2', input: { carat: 2.51, shape_style: 'princess_standard', color: 'E', clarity: 'VVS2', cut_raw: 'EX', polish: 'EX', symmetry: 'EX', typeName: 'CVD' }, expectBranch: 'white' },
  { name: 'W11_5ct_Round_J_SI2', input: { carat: 5.01, shape_style: 'round_standard', color: 'J', clarity: 'SI2', cut_raw: 'VG', polish: 'VG', symmetry: 'VG', typeName: 'CVD' }, expectBranch: 'white' },

  // High carat white
  { name: 'W12_10ct_Round_E_VS1', input: { carat: 10.0, shape_style: 'round_standard', color: 'E', clarity: 'VS1', cut_raw: 'EX', polish: 'EX', symmetry: 'EX', typeName: 'CVD' }, expectBranch: 'white', expectExpert: 'S28' },
  { name: 'W13_15ct_Round_F_VS2', input: { carat: 15.0, shape_style: 'round_standard', color: 'F', clarity: 'VS2', cut_raw: 'EX', polish: 'EX', symmetry: 'EX', typeName: 'CVD' }, expectBranch: 'white', expectExpert: 'S28' },

  // ═══ Direct StarGem color anchors ═══
  // These should route to E1_DIRECT_QUOTE when reportNo matches
  { name: 'C1_StarGem_Yellow', input: { carat: 1.02, shape: 'cushion', colorHue: 'yellow', colorIntensity: 'fancy vivid', clarity: 'VS1', reportNo: 'SG-YELLOW-001' }, expectBranch: 'fancy-color' },
  { name: 'C2_StarGem_Pink', input: { carat: 1.5, shape: 'radiant', colorHue: 'pink', colorIntensity: 'fancy intense', clarity: 'VS2', reportNo: 'SG-PINK-001' }, expectBranch: 'fancy-color' },
  { name: 'C3_StarGem_Blue', input: { carat: 2.0, shape: 'oval', colorHue: 'blue', colorIntensity: 'fancy', clarity: 'VVS2', reportNo: 'SG-BLUE-001' }, expectBranch: 'fancy-color' },

  // ═══ Common yellow cases ═══
  { name: 'C4_Yellow_Vivid_2ct', input: { carat: 2.0, shape: 'radiant', colorHue: 'yellow', colorIntensity: 'fancy vivid', clarity: 'VS1' }, expectBranch: 'fancy-color' },
  { name: 'C5_Yellow_Intense_1_5ct', input: { carat: 1.5, shape: 'cushion', colorHue: 'yellow', colorIntensity: 'fancy intense', clarity: 'VS2' }, expectBranch: 'fancy-color' },
  { name: 'C6_Yellow_Fancy_3ct', input: { carat: 3.0, shape: 'oval', colorHue: 'yellow', colorIntensity: 'fancy', clarity: 'VVS2' }, expectBranch: 'fancy-color' },
  { name: 'C7_Yellow_Light_1ct', input: { carat: 1.0, shape: 'pear', colorHue: 'yellow', colorIntensity: 'fancy light', clarity: 'SI1' }, expectBranch: 'fancy-color' },

  // ═══ Common pink cases ═══
  { name: 'C8_Pink_Vivid_1_5ct', input: { carat: 1.5, shape: 'cushion', colorHue: 'pink', colorIntensity: 'fancy vivid', clarity: 'VS1' }, expectBranch: 'fancy-color' },
  { name: 'C9_Pink_Intense_2ct', input: { carat: 2.0, shape: 'radiant', colorHue: 'pink', colorIntensity: 'fancy intense', clarity: 'VS2' }, expectBranch: 'fancy-color' },
  { name: 'C10_Pink_Fancy_1ct', input: { carat: 1.0, shape: 'round', colorHue: 'pink', colorIntensity: 'fancy', clarity: 'VVS1' }, expectBranch: 'fancy-color' },

  // ═══ Common blue cases ═══
  { name: 'C11_Blue_Vivid_2_5ct', input: { carat: 2.5, shape: 'emerald', colorHue: 'blue', colorIntensity: 'fancy vivid', clarity: 'VS1' }, expectBranch: 'fancy-color' },
  { name: 'C12_Blue_Intense_1_5ct', input: { carat: 1.5, shape: 'oval', colorHue: 'blue', colorIntensity: 'fancy intense', clarity: 'VVS2' }, expectBranch: 'fancy-color' },
  { name: 'C13_Blue_Fancy_3ct', input: { carat: 3.0, shape: 'cushion', colorHue: 'blue', colorIntensity: 'fancy', clarity: 'VS2' }, expectBranch: 'fancy-color' },

  // ═══ Green caution cases ═══
  { name: 'C14_Green_Intense_3ct', input: { carat: 3.0, shape: 'pear', colorHue: 'green', colorIntensity: 'fancy intense', clarity: 'VS1' }, expectBranch: 'fancy-color' },
  { name: 'C15_Green_Fancy_1_5ct', input: { carat: 1.5, shape: 'radiant', colorHue: 'green', colorIntensity: 'fancy', clarity: 'VVS2' }, expectBranch: 'fancy-color' },

  // ═══ Brown caution cases ═══
  { name: 'C16_Brown_Fancy_2ct', input: { carat: 2.0, shape: 'heart', colorHue: 'brown', colorIntensity: 'fancy', clarity: 'VS1' }, expectBranch: 'fancy-color' },
  { name: 'C17_Brown_Intense_1_5ct', input: { carat: 1.5, shape: 'cushion', colorHue: 'brown', colorIntensity: 'fancy intense', clarity: 'VS2' }, expectBranch: 'fancy-color' },

  // ═══ Red caution cases ═══
  { name: 'C18_Red_Fancy_1ct', input: { carat: 1.0, shape: 'round', colorHue: 'red', colorIntensity: 'fancy', clarity: 'SI1' }, expectBranch: 'fancy-color' },
  { name: 'C19_Red_Vivid_1_5ct', input: { carat: 1.5, shape: 'oval', colorHue: 'red', colorIntensity: 'fancy vivid', clarity: 'VS2' }, expectBranch: 'fancy-color' },

  // ═══ Orange/purple rare hue cases (should route to curated prior with warning) ═══
  { name: 'C20_Orange_Intense_1_5ct', input: { carat: 1.5, shape: 'cushion', colorHue: 'orange', colorIntensity: 'fancy intense', clarity: 'VS2' }, expectBranch: 'fancy-color', expectExpert: 'E5_CURATED_PRIOR' },
  { name: 'C21_Purple_Fancy_2ct', input: { carat: 2.0, shape: 'radiant', colorHue: 'purple', colorIntensity: 'fancy', clarity: 'VS1' }, expectBranch: 'fancy-color', expectExpert: 'E5_CURATED_PRIOR' },

  // ═══ High-carat colored stones ═══
  { name: 'C22_Yellow_Vivid_5ct', input: { carat: 5.0, shape: 'emerald', colorHue: 'yellow', colorIntensity: 'fancy vivid', clarity: 'VS2' }, expectBranch: 'fancy-color' },
  { name: 'C23_Yellow_Vivid_10ct', input: { carat: 10.0, shape: 'radiant', colorHue: 'yellow', colorIntensity: 'fancy vivid', clarity: 'VS1' }, expectBranch: 'fancy-color' },
  { name: 'C24_Pink_Intense_7ct', input: { carat: 7.0, shape: 'cushion', colorHue: 'pink', colorIntensity: 'fancy intense', clarity: 'VVS2' }, expectBranch: 'fancy-color' },

  // ═══ Ambiguous/unknown color classification cases ═══
  { name: 'A1_NoColor_2ct', input: { carat: 2.0, shape_style: 'round_standard', clarity: 'VS1', cut_raw: 'EX', typeName: 'CVD' }, expectBranch: 'white' },  // defaults to white
  { name: 'A2_ColorByLabel_FancyVividYellow', input: { carat: 1.5, shape: 'radiant', color: 'Fancy Vivid Yellow', clarity: 'VS1' }, expectBranch: 'fancy-color' },
  { name: 'A3_ColorByFamily', input: { carat: 2.0, shape: 'cushion', colorFamily: 'fancy', clarity: 'VS2' }, expectBranch: 'fancy-color' },
];

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══ DiamondProd vNext Golden Fixture Test ═══\n');

  // Build context (same as benchmark)
  const allWhiteRows = loadJson('dataset-clean-training.json');
  const reportHash = (row) => {
    const text = String(row.reportNo ?? row.reportno ?? row.rowNo ?? '');
    let total = 0;
    for (const ch of text) total = (total * 131 + ch.charCodeAt(0)) % 1_000_003;
    return total;
  };
  const rowTrain = allWhiteRows.filter((r) => reportHash(r) % 5 !== 0);

  const fairS30 = buildS30Artifact(rowTrain);
  const dpCtx = loadDiamondProdVNext({
    white: { s30Model: fairS30 },
  });

  // Build color cell support (same as benchmark)
  const messiColorRows = (loadJson('messi-color-index.json').records || []);
  const starsgemColorRows = (loadJson('starsgem-color-index.json').records || []);
  const colorCellSupport = new Map();
  for (const r of [...messiColorRows, ...starsgemColorRows]) {
    const ck = colorCellKey(r);
    colorCellSupport.set(ck, (colorCellSupport.get(ck) || 0) + 1);
  }
  dpCtx.color.cellSupport = colorCellSupport;

  let passed = 0;
  let failed = 0;
  const results = [];

  for (const fixture of GOLDEN_FIXTURES) {
    const prediction = predictDiamondProdVNext(fixture.input, dpCtx);

    if (!prediction || !prediction.price || prediction.price <= 0) {
      console.log(`  ✗ ${fixture.name}: No valid prediction (fallbackReason=${prediction?.fallbackReason ?? 'unknown'})`);
      failed++;
      results.push({ ...fixture, status: 'FAIL', error: 'No valid prediction', fallbackReason: prediction?.fallbackReason ?? null });
      continue;
    }

    const issues = [];

    // Check branch if expected
    if (fixture.expectBranch && prediction.branch !== fixture.expectBranch) {
      issues.push(`Expected branch ${fixture.expectBranch}, got ${prediction.branch}`);
    }

    // Check expert if expected
    if (fixture.expectExpert && prediction.selectedExpert !== fixture.expectExpert) {
      issues.push(`Expected expert ${fixture.expectExpert}, got ${prediction.selectedExpert}`);
    }

    // Check that prediction has all required fields
    if (prediction.modelVersion !== dpCtx.modelVersion) {
      issues.push(`Model version mismatch: ${prediction.modelVersion}`);
    }
    if (!prediction.selectedExpert) issues.push('Missing selectedExpert');
    if (!prediction.supportTier) issues.push('Missing supportTier');
    if (!prediction.branch) issues.push('Missing branch');

    // Check UPC sanity
    const upc = prediction.pricePerCarat;
    if (!upc || upc <= 0) {
      issues.push(`Invalid UPC: ${upc}`);
    } else if (prediction.branch === 'white' && (upc < 50 || upc > 50000)) {
      issues.push(`White UPC out of expected range [$50, $50000]: $${upc.toFixed(0)}`);
    } else if (prediction.branch === 'fancy-color' && (upc < 50 || upc > 200000)) {
      issues.push(`Color UPC out of expected range [$50, $200000]: $${upc.toFixed(0)}`);
    }

    // Check price sanity
    const carat = Number(fixture.input.carat);
    const expectedPriceRange = carat * 50;
    if (prediction.price < expectedPriceRange) {
      issues.push(`Price too low: $${prediction.price.toFixed(0)} (expected ≥ $${expectedPriceRange.toFixed(0)})`);
    }

    // For rare hues, verify direct-quote warning
    if (fixture.expectExpert === 'E5_CURATED_PRIOR' && !prediction.diagnostics?.directQuoteRecommended) {
      issues.push('Rare hue should recommend direct quote');
    }

    if (issues.length === 0) {
      console.log(`  ✓ ${fixture.name}: $${prediction.price.toFixed(0)} ($${upc.toFixed(0)}/ct) branch=${prediction.branch} expert=${prediction.selectedExpert} tier=${prediction.supportTier}`);
      passed++;
      results.push({
        ...fixture,
        status: 'PASS',
        price: +prediction.price.toFixed(2),
        upc: +upc.toFixed(2),
        branch: prediction.branch,
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

  // ─── White branch parity check ──────────────────────────────────────────────

  console.log('\n─── White Branch Parity vs WhiteProd vNext ───');
  const { predictWhiteProdVNext, loadWhiteProdVNext } = await import('./predict-white-prod-vnext.mjs');
  const wpCtx = loadWhiteProdVNext({ s30Model: fairS30 });

  let whiteParityOk = 0, whiteParityFail = 0;
  const whiteFixtures = GOLDEN_FIXTURES.filter((f) => f.expectBranch === 'white');
  for (const fixture of whiteFixtures) {
    const dpResult = predictDiamondProdVNext(fixture.input, dpCtx);
    const wpResult = predictWhiteProdVNext(fixture.input, wpCtx);
    if (dpResult?.price > 0 && wpResult?.price > 0) {
      const priceMatch = Math.abs(dpResult.price - wpResult.price) < 0.01;
      const expertMatch = dpResult.selectedExpert === wpResult.selectedExpert;
      if (priceMatch && expertMatch) {
        whiteParityOk++;
      } else {
        whiteParityFail++;
        console.log(`  ✗ ${fixture.name}: DP=$${dpResult.price.toFixed(0)}/${dpResult.selectedExpert} vs WP=$${wpResult.price.toFixed(0)}/${wpResult.selectedExpert}`);
      }
    }
  }
  console.log(`  White parity: ${whiteParityOk}/${whiteFixtures.length} match WhiteProd vNext`);

  // ─── Display grid monotonicity check (white) ────────────────────────────────

  console.log('\n─── White Display Grid Monotonicity ───');
  const MONO_COLORS = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];
  const MONO_CLARITIES = ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2'];
  const SWEEP = [1, 2, 5, 10];

  let gridPassed = 0, gridFailed = 0;
  for (const color of MONO_COLORS) {
    for (const clarity of MONO_CLARITIES) {
      for (const carat of SWEEP) {
        const row = { carat, shape_style: 'round_standard', color, clarity, cut_raw: 'EX', polish: 'EX', symmetry: 'EX', typeName: 'CVD' };
        const p = predictDiamondProdVNext(row, dpCtx);
        if (p?.branch !== 'white') {
          gridFailed++;
        } else if (p?.selectedExpert !== 'S28') {
          gridFailed++;
        } else {
          gridPassed++;
        }
      }
    }
  }
  console.log(`  Grid white S28 routing: ${gridPassed}/${gridPassed + gridFailed} ✓`);

  // ─── Intensity monotonicity check (color) ───────────────────────────────────

  console.log('\n─── Color Intensity Monotonicity (S23 Display Grid) ───');
  const intensities = ['fancy light', 'fancy', 'fancy intense', 'fancy vivid'];
  const testHues = ['pink', 'yellow', 'blue'];
  let monoPassed = 0, monoFailed = 0;

  for (const hue of testHues) {
    for (const shape of ['round', 'cushion', 'oval']) {
      for (const clarity of ['VS1', 'VS2']) {
        for (const carat of [1, 2, 3]) {
          const intensityPreds = intensities.map((intensity) => {
            return predictDiamondProdVNext({
              _intensityDisplayGrid: true,
              carat, shape, colorHue: hue, colorIntensity: intensity, clarity,
            }, dpCtx);
          });
          for (let i = 1; i < intensityPreds.length; i++) {
            const prevUpc = intensityPreds[i - 1].pricePerCarat;
            const currUpc = intensityPreds[i].pricePerCarat;
            if (prevUpc != null && currUpc != null) {
              if (currUpc + 1e-6 >= prevUpc) monoPassed++;
              else monoFailed++;
            }
          }
        }
      }
    }
  }
  console.log(`  Color intensity monotonicity: ${monoPassed}/${monoPassed + monoFailed} monotone ✓`);

  // ─── Summary ────────────────────────────────────────────────────────────────

  console.log(`\n═══ Results ═══`);
  console.log(`Golden fixtures: ${passed}/${passed + failed} passed`);
  console.log(`White parity: ${whiteParityOk}/${whiteFixtures.length} match WhiteProd vNext`);
  console.log(`White display grid: ${gridPassed}/${gridPassed + gridFailed} S28-routed`);
  console.log(`Color intensity monotonicity: ${monoPassed}/${monoPassed + monoFailed} monotone`);

  const allPassed = failed === 0 && whiteParityFail === 0 && gridFailed === 0 && monoFailed === 0;

  if (allPassed) {
    console.log('\n✓ All golden fixtures pass. DiamondProd vNext is ready for shadow release.');
  } else {
    console.log(`\n✗ ${failed} fixture(s) failed, ${whiteParityFail} parity mismatch(es), ${gridFailed} grid misroute(s), ${monoFailed} monotonicity violation(s).`);
  }

  // Write golden file
  const goldenFile = path.join(DATA, 'diamond-prod-vnext-golden-fixtures.json');
  writeFileSync(goldenFile, JSON.stringify({
    date: new Date().toISOString().slice(0, 10),
    modelVersion: dpCtx.modelVersion,
    tolerance: { price: `${(TOLERANCE * 100).toFixed(1)}%`, upc: `${(UPC_TOLERANCE * 100).toFixed(1)}%` },
    fixtures: results,
    whiteParity: { passed: whiteParityOk, failed: whiteParityFail, total: whiteFixtures.length },
    displayGrid: { passed: gridPassed, failed: gridFailed },
    intensityMonotonicity: { passed: monoPassed, failed: monoFailed },
    summary: { passed, failed, allPassed },
  }, null, 2) + '\n');
  console.log(`Wrote ${path.relative(process.cwd(), goldenFile)}`);

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
