/**
 * test-comp-engine-v3.mjs — Standalone test runner for comp-engine-v3.
 *
 * Usage:
 *   node research/scripts/test-comp-engine-v3.mjs
 *
 * Requires the json index at: research/data/alibaba-comps-index.json
 */

import { fileURLToPath } from 'url';
import path from 'path';
import {
  loadIndex,
  resolveAlibabaComp,
  parseFancyColorLabel,
  inferFancyFamilyKey,
  compErrorScore,
  adjustCompToQuery,
  blendComps,
  filterCandidates,
  isExactMatch,
  normalizeShapeForComp,
  shapeDistance,
  getClarityMult,
  medianOf,
  AXIS_SIGMA,
  MODIFIER_LOG_DELTA,
  INTENSITY_RANK,
  SHAPE_FAMILY_MAP,
  FANCY_COLOR_BASE,
  WHITE_GRADE_MULT,
  CLARITY_MULT_COLOR,
  SHAPE_MULT_WHITE,
  SHAPE_MULT_COLOR,
  MAX_SUPPLIER_WEIGHT_FRAC,
  supplierKey,
  fitLocalCaratSlope,
  resolveEffectiveCaratSlope,
  caratPriorForQuery,
  CARAT_SLOPE_POLICY,
  MODE_SIGMA_BOOST,
} from '../comp-engine-v3.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.resolve(__dirname, '../../research/data/alibaba-comps-index.json');

// ── helpers ──────────────────────────────────────────────────────────────────

let passed = 0, failed = 0, testCount = 0;

function assert(cond, msg) {
  testCount++;
  if (cond) { passed++; return; }
  failed++;
  console.error(`  ✗ FAIL: ${msg}`);
}

function assertEqual(a, b, msg) {
  assert(a === b, `${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function assertDeepEqual(a, b, msg) {
  assert(JSON.stringify(a) === JSON.stringify(b), `${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function assertBetween(v, lo, hi, msg) {
  assert(v >= lo && v <= hi, `${msg}: expected ${lo} ≤ v ≤ ${hi}, got ${v}`);
}

function assertIncludes(arr, val, msg) {
  assert(arr.includes(val), `${msg}: expected array to include ${JSON.stringify(val)}, got [${arr.join(', ')}]`);
}

// ── unit tests ────────────────────────────────────────────────────────────────

function testParseFancyColorLabel() {
  console.log('\n── parseFancyColorLabel ─────────────────────────────────────────────');

  const vivid = parseFancyColorLabel('Fancy Vivid Pink');
  assertEqual(vivid.hue, 'pink', 'vivid pink hue');
  assertEqual(vivid.intensityKey, 'fv', 'vivid pink intensityKey');
  assertDeepEqual(vivid.modifierTerms, [], 'vivid pink modifierTerms');
  assertEqual(vivid.colorKey, 'pink_fv', 'vivid pink colorKey');

  const intense = parseFancyColorLabel('Fancy Intense Brownish Pink');
  assertEqual(intense.hue, 'pink', 'brownish pink hue');
  assertEqual(intense.intensityKey, 'fi', 'brownish pink intensityKey');
  assertDeepEqual(intense.modifierTerms, ['brownish'], 'brownish pink modifiers');
  assertEqual(intense.colorKey, 'pink_fi', 'brownish pink colorKey');

  const compKey2 = parseFancyColorLabel('pink_fv');
  assertEqual(compKey2.hue, 'pink', 'key format hue');
  assertEqual(compKey2.intensityKey, 'fv', 'key format intensity (compact _fv)');
  assertEqual(compKey2.colorKey, 'pink_fv', 'key format colorKey');

  const compKeyFi = parseFancyColorLabel('yellow_fi');
  assertEqual(compKeyFi.intensityKey, 'fi', 'compact yellow_fi intensity');

  const yellow = parseFancyColorLabel('Fancy Intense Yellow');
  assertEqual(yellow.hue, 'yellow', 'yellow hue');
  assertEqual(yellow.intensityKey, 'fi', 'yellow intensityKey');

  const orange = parseFancyColorLabel('Fancy Vivid Orange');
  assertEqual(orange.hue, 'orange', 'orange hue');
  assertEqual(orange.intensityKey, 'fv', 'orange intensityKey');

  const light = parseFancyColorLabel('Fancy Light Pink');
  assertEqual(light.intensityKey, 'fl', 'light intensity');
  assertEqual(light.colorKey, 'pink_fl', 'light colorKey');

  console.log('  parseFancyColorLabel: done');
}

function testInferFancyFamilyKey() {
  console.log('\n── inferFancyFamilyKey ──────────────────────────────────────────────');
  assertEqual(inferFancyFamilyKey('Fancy Vivid Pink'), 'pink_fv', 'vivid pink');
  assertEqual(inferFancyFamilyKey('Fancy Intense Brownish Pink'), 'pink_fi', 'brownish pink → pink_fi');
  assertEqual(inferFancyFamilyKey('Fancy Pink'), 'pink_f', 'fancy pink');
  assertEqual(inferFancyFamilyKey('Fancy Intense Yellow'), 'yellow_fi', 'yellow fi');
  assertEqual(inferFancyFamilyKey(null), null, 'null input');
  console.log('  inferFancyFamilyKey: done');
}

function testShapeDistance() {
  console.log('\n── shapeDistance ────────────────────────────────────────────────────');
  assertEqual(shapeDistance('oval', 'oval'), 0, 'oval=oval same');
  assertEqual(shapeDistance('cushion', 'cushion'), 0, 'cushion=cushion same');
  assertEqual(shapeDistance('cushion', 'elongated_cushion'), 1, 'cushion-elongated_cushion same family, not alias');
  assertEqual(shapeDistance('oval', 'cushion'), 1, 'oval-cushion same family');
  assertEqual(shapeDistance('oval', 'radiant'), 2, 'oval-radiant adjacent');
  assertEqual(shapeDistance('round', 'oval'), 2, 'round-oval adjacent (different families)');
  assertEqual(shapeDistance('round', 'emerald'), 3, 'round-emerald cross');
  assertEqual(shapeDistance('marquise', 'pear'), 2, 'marquise-pear adjacent');
  assertEqual(shapeDistance('princess', 'radiant'), 2, 'princess-radiant adjacent');
  assertEqual(shapeDistance('round', 'portuguese'), 3, 'round-specialty cross');
  console.log('  shapeDistance: done');
}

function testGetClarityMult() {
  console.log('\n── getClarityMult ───────────────────────────────────────────────────');
  assertBetween(getClarityMult('VS1', 1.0), 0.99, 1.01, 'VS1@1ct=1.00 baseline');
  assertBetween(getClarityMult('VVS1', 1.0), 1.13, 1.15, 'VVS1@1ct≈1.14');
  assert(getClarityMult('IF', 3.0) > getClarityMult('VVS1', 3.0), 'IF>VVS1@3ct');
  assert(getClarityMult('SI1', 3.0) < getClarityMult('VS2', 3.0), 'SI1<VS2@3ct');
  assert(getClarityMult('VVS2', 5.0) > getClarityMult('VVS2', 1.0), 'VVS2 grows with carat');
  console.log('  getClarityMult: done');
}

function testMedianOf() {
  console.log('\n── medianOf ─────────────────────────────────────────────────────────');
  assertEqual(medianOf([3, 1, 4, 1, 5]), 3, 'odd count');
  assertEqual(medianOf([1, 2, 3, 4]), 2.5, 'even count');
  assertEqual(medianOf([7]), 7, 'single element');
  console.log('  medianOf: done');
}

function testModifierLogDelta() {
  console.log('\n── MODIFIER_LOG_DELTA values ────────────────────────────────────────');
  assert(MODIFIER_LOG_DELTA.brownish < 0, 'brownish is discount');
  assert(MODIFIER_LOG_DELTA.greyish < 0, 'greyish is discount');
  assertBetween(Math.exp(MODIFIER_LOG_DELTA.brownish), 0.75, 0.90, 'brownish ≈ −18–25%');
  console.log('  MODIFIER_LOG_DELTA: done');
}

function testBlendComps() {
  console.log('\n── blendComps ───────────────────────────────────────────────────────');

  // Two identical comps → exact mid
  const a1 = [
    { logEstimate: Math.log(1000), sigmaLog: 0.10, estimatedPrice: 1000 },
    { logEstimate: Math.log(1000), sigmaLog: 0.10, estimatedPrice: 1000 },
  ];
  const b1 = blendComps(a1);
  assertBetween(b1.estimate, 995, 1005, 'two identical → estimate≈1000');
  assert(b1.low < b1.estimate, 'low < estimate');
  assert(b1.high > b1.estimate, 'high > estimate');

  // One outlier — should be rejected
  const a2 = [
    { logEstimate: Math.log(1000), sigmaLog: 0.10, estimatedPrice: 1000 },
    { logEstimate: Math.log(1000), sigmaLog: 0.10, estimatedPrice: 1000 },
    { logEstimate: Math.log(5000), sigmaLog: 0.10, estimatedPrice: 5000 },  // outlier
  ];
  const b2 = blendComps(a2);
  assertEqual(b2.rejected.length, 1, 'outlier rejected');
  assertBetween(b2.estimate, 900, 1200, 'outlier rejected → stays near 1000');

  // Single comp → single comp blend (no rejection possible)
  const a3 = [
    { logEstimate: Math.log(2500), sigmaLog: 0.20, estimatedPrice: 2500 },
  ];
  const b3 = blendComps(a3);
  assertEqual(b3.rejected.length, 0, 'single comp not rejected');
  assertBetween(b3.estimate, 2400, 2600, 'single comp estimate≈2500');
  assert(b3.sigmaLog >= 0.05, 'sigma floor at 0.05');

  // Supplier weight cap should bind final contribution, not just raw pre-cap share.
  const supplierHeavy = [
    { logEstimate: Math.log(1000), sigmaLog: 0.05, estimatedPrice: 1000, row: { section: 'A — Messi Gems' } },
    { logEstimate: Math.log(1010), sigmaLog: 0.05, estimatedPrice: 1010, row: { section: 'B — Messi Gems' } },
    { logEstimate: Math.log(1500), sigmaLog: 0.30, estimatedPrice: 1500, row: { section: 'C — StarGem' } },
  ];
  const b4 = blendComps(supplierHeavy);
  assert(b4.sourceConcentration.dominated, 'supplier-heavy blend reports source concentration');
  assert(b4.sourceConcentration.rawDominantFrac > 0.90, 'supplier-heavy raw dominance is high');
  assert(b4.sourceConcentration.finalDominantFrac <= MAX_SUPPLIER_WEIGHT_FRAC + 0.001,
    'supplier-heavy final dominance is capped to threshold');

  const singleSource = [
    { logEstimate: Math.log(1000), sigmaLog: 0.05, estimatedPrice: 1000, row: { section: 'A — Messi Gems' } },
    { logEstimate: Math.log(1010), sigmaLog: 0.05, estimatedPrice: 1010, row: { section: 'B — Messi Gems' } },
  ];
  const b5 = blendComps(singleSource);
  assert(b5.sourceConcentration.dominated, 'single-source blend reports concentration');
  assertEqual(b5.sourceConcentration.capPossible, false, 'single-source cap is impossible');
  assertBetween(b5.sourceConcentration.finalDominantFrac, 0.999, 1.001, 'single-source final share remains 100%');

  // Empty → null
  assertEqual(blendComps([]), null, 'empty → null');

  console.log('  blendComps: done');
}

function testCandidateHardGates() {
  console.log('\n── candidate hard gates ─────────────────────────────────────────────');

  const rows = [
    { colorFamily: 'white', shape: 'round', colorNormalized: 'D', clarity: 'VS1', carat: 1, priceUsd: 100 },
    { colorFamily: 'white', shape: 'round', colorNormalized: 'J', clarity: 'VS1', carat: 1, priceUsd: 50 },
    { colorFamily: 'fancy', shape: 'oval', color: 'Fancy Vivid Pink', clarity: 'VS1', carat: 1, priceUsd: 400 },
    { colorFamily: 'fancy', shape: 'oval', color: 'Fancy Vivid Yellow', clarity: 'VS1', carat: 1, priceUsd: 250 },
  ];

  const whiteD = filterCandidates(
    { carat: 1, shape: 'round', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' },
    rows
  );
  assertEqual(whiteD.length, 1, 'white query rejects fancy rows and >5-step white color gaps');
  assertEqual(whiteD[0].colorNormalized, 'D', 'white query keeps compatible white row');

  const pink = filterCandidates(
    { carat: 1, shape: 'oval', colorFamily: 'fancy', colorFamily_key: 'pink_fv', clarity: 'VS1' },
    rows
  );
  assertEqual(pink.length, 1, 'pink query keeps only pink fancy rows');
  assertEqual(pink[0].color, 'Fancy Vivid Pink', 'pink hard gate does not cross to yellow');

  const orange = filterCandidates(
    { carat: 1, shape: 'oval', colorFamily: 'fancy', colorFamily_key: 'orange_fv', clarity: 'VS1' },
    rows
  );
  assertEqual(orange.length, 0, 'orange query does not borrow non-orange fancy rows');

  console.log('  candidate hard gates: done');
}

function testExactMatchSemantics() {
  console.log('\n── isExactMatch semantics ───────────────────────────────────────────');

  const exactWhite = {
    carat: 2, shape: 'round', colorFamily: 'white', colorNormalized: 'D',
    clarity: 'VS1', caratBand: false, clarityBand: false, priceUsd: 300,
  };
  const qWhite = { carat: 2, shape: 'round', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' };
  assert(isExactMatch(qWhite, exactWhite), 'same white shape/color/clarity/carat is exact');
  assert(!isExactMatch({ ...qWhite, shape: 'pear' }, exactWhite), 'different white shape is not exact');
  assert(!isExactMatch({ ...qWhite, carat: 2.4 }, exactWhite), 'outside carat tolerance is not exact');
  assert(!isExactMatch(qWhite, { ...exactWhite, clarityBand: true }), 'clarity bands are not exact');
  assert(isExactMatch({ ...qWhite, whiteGrade: 'E' }, { ...exactWhite, colorNormalized: 'DE' }), 'DE row can exact-match E');

  const exactFancy = {
    carat: 2.08, shape: 'heart', colorFamily: 'fancy', color: 'Fancy Vivid Pink',
    clarity: 'VVS2', caratBand: false, clarityBand: false, priceUsd: 770,
  };
  const qFancy = { carat: 2.0, shape: 'heart', colorFamily: 'fancy', colorFamily_key: 'pink_fv', clarity: 'VVS2' };
  assert(isExactMatch(qFancy, exactFancy), 'near-carat same-shape fancy row is exact');
  assert(!isExactMatch({ ...qFancy, shape: 'oval' }, exactFancy), 'different fancy shape is not exact');

  console.log('  isExactMatch semantics: done');
}

function testScoringSemantics() {
  console.log('\n── compErrorScore semantics ─────────────────────────────────────────');

  const q = { carat: 3.8, shape: 'radiant', colorFamily: 'fancy', colorFamily_key: 'pink_fv', clarity: 'VVS2' };
  const vividHeart = {
    carat: 2.08, shape: 'heart', colorFamily: 'fancy', color: 'Fancy Vivid Pink',
    clarity: 'VVS2', priceUsd: 770, confidence: 'medium',
  };
  const brownishRadiant = {
    carat: 0.89, shape: 'radiant', colorFamily: 'fancy', color: 'Fancy Intense Brownish Pink',
    clarity: 'VS2', priceUsd: 262, confidence: 'medium',
  };
  const scoreHeart = compErrorScore(q, vividHeart);
  const scoreBrownish = compErrorScore(q, brownishRadiant);
  assert(scoreHeart.total < scoreBrownish.total, 'same-intensity vivid heart scores better than tiny brownish radiant');

  const perfect = { carat: 1, shape: 'round', colorFamily: 'white', colorNormalized: 'D', clarity: 'VS1', priceUsd: 100, confidence: 'high' };
  const crossShape = { ...perfect, shape: 'emerald' };
  const qWhite = { carat: 1, shape: 'round', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' };
  assert(compErrorScore(qWhite, perfect).total < compErrorScore(qWhite, crossShape).total, 'same-shape white comp scores better than cross-shape comp');

  console.log('  compErrorScore semantics: done');
}

function testAdjustmentSemantics() {
  console.log('\n── adjustCompToQuery semantics ─────────────────────────────────────');

  const baseWhite = {
    carat: 1, shape: 'round', colorFamily: 'white', colorNormalized: 'D',
    clarity: 'VS1', priceUsd: 100, confidence: 'high',
  };
  const same = adjustCompToQuery(
    { carat: 1, shape: 'round', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' },
    baseWhite
  );
  assertBetween(same.estimatedPrice, 99, 101, 'same white spec returns listing price');

  const upTo2 = adjustCompToQuery(
    { carat: 2, shape: 'round', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' },
    baseWhite
  );
  const backTo1 = adjustCompToQuery(
    { carat: 1, shape: 'round', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' },
    { ...baseWhite, carat: 2, priceUsd: upTo2.estimatedPrice }
  );
  assertBetween(upTo2.estimatedPrice, 340, 355, 'white carat transform uses log-space 1.8 total exponent');
  assertBetween(backTo1.estimatedPrice, 98, 102, 'white carat transform is approximately reversible when row price is model-consistent');

  const hFromD = adjustCompToQuery(
    { carat: 1, shape: 'round', colorFamily: 'white', whiteGrade: 'H', clarity: 'VS1' },
    baseWhite
  );
  assert(hFromD.estimatedPrice < same.estimatedPrice, 'H query adjusts down from D comp');

  const brownishRow = {
    carat: 0.89, shape: 'radiant', colorFamily: 'fancy', color: 'Fancy Intense Brownish Pink',
    clarity: 'VS2', priceUsd: 262, confidence: 'medium',
  };
  const cleanPink = adjustCompToQuery(
    { carat: 0.89, shape: 'radiant', colorFamily: 'fancy', colorFamily_key: 'pink_fi', clarity: 'VS2' },
    brownishRow
  );
  assert(cleanPink.estimatedPrice > brownishRow.priceUsd, 'clean pink query adjusts up from brownish pink comp');
  assert(cleanPink.parts.some(p => p.startsWith('modifier')), 'brownish cleanup exposes modifier part');

  console.log('  adjustCompToQuery semantics: done');
}

async function testExactFloorDisplayGuards() {
  console.log('\n── exact floor/display guards ──────────────────────────────────────');

  const row = (section, priceUsd, carat = 2.0) => ({
    section,
    carat,
    shape: 'pear',
    colorFamily: 'white',
    colorNormalized: 'E',
    clarity: 'VS1',
    priceUsd,
    confidence: 'high',
    sourceType: 'exact-test',
  });

  await loadIndex({
    comps: [
      row('test low floor — StarGem', 100, 1.98),
      row('test low neighbor — StarGem', 105, 2.02),
      row('test high factory 1 — Messi Gems', 980, 2.0),
      row('test high factory 2 — Messi Gems', 990, 2.01),
      row('test high factory 3 — Messi Gems', 1000, 1.99),
    ],
  });

  const result = resolveAlibabaComp({
    carat: 2.0,
    shape: 'pear',
    colorFamily: 'white',
    whiteGrade: 'E',
    clarity: 'VS1',
  });

  assertEqual(result.matchType, 'exact', 'synthetic exact pool resolves exact');
  assertEqual(supplierKey(result.primary.row), 'starsgem', 'floor primary stays cheapest supplier even if blend rejects it');
  assertEqual(result.primary.listingPrice, 100, 'floor primary is cheapest exact listing');
  assertEqual(result.estimate, 100, 'exact estimate equals floor listing, not cross-factory blend');
  assert((result.alternatives || []).every(a => supplierKey(a.row) === 'starsgem'), 'alternatives stay same floor supplier');
  assert((result.otherFactoryExact || []).some(e => e.supplierKey === 'messi'), 'other factories remain visible in otherFactoryExact');
  assert(!(result.alternatives || []).some(a => supplierKey(a.row) === 'messi'), 'other factories are not mixed into alternatives');

  console.log('  exact floor/display guards: done');
}

// ── integration tests (require loaded index) ───────────────────────────────────

async function runIntegrationTests() {
  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('INTEGRATION TESTS (require index)');
  console.log('══════════════════════════════════════════════════════════════════════');

  // ── T01: 1ct D VS1 round ────────────────────────────────────────────────
  {
    console.log('\n── T01: 1ct D VS1 round ───────────────────────────────────────────');
    const q = { carat: 1.0, shape: 'round', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' };
    const r = resolveAlibabaComp(q);
    console.log(`  matchType: ${r.matchType}  estimate: $${r.estimate}  range: $${r.low}–$${r.high}`);
    console.log(`  confidence: ${r.confidence}  support: ${r.supportComps.length}`);
    assertIncludes(['exact', 'nearest', 'best_available'], r.matchType, 'T01 matchType');
    assert(r.estimate > 0, 'T01 estimate > 0');
    assert(r.low < r.estimate && r.estimate < r.high, 'T01 low < est < high');
  }

  // ── T02: 2ct H VS1 round ────────────────────────────────────────────────
  {
    console.log('\n── T02: 2ct H VS1 round ───────────────────────────────────────────');
    const q = { carat: 2.0, shape: 'round', colorFamily: 'white', whiteGrade: 'H', clarity: 'VS1' };
    const r = resolveAlibabaComp(q);
    console.log(`  matchType: ${r.matchType}  estimate: $${r.estimate}  range: $${r.low}–$${r.high}`);
    const qD = resolveAlibabaComp({ ...q, whiteGrade: 'D' });
    assert(r.estimate < qD.estimate, 'T02: H < D at same spec (color discount applied)');
    assertBetween(r.estimate / qD.estimate, 0.50, 1.00,
      'T02: H remains below D when local exact/fallback supply is merged');
  }

  // ── T03: 3.80ct FVP VVS2 radiant — PINK CASE STUDY ─────────────────────
  {
    console.log('\n── T03: 3.80ct Fancy Vivid Pink VVS2 radiant (CASE STUDY) ─────────');
    const q = { carat: 3.8, shape: 'radiant', colorFamily: 'fancy', colorFamily_key: 'pink_fv', clarity: 'VVS2' };
    const r = resolveAlibabaComp(q);
    console.log(`  matchType: ${r.matchType}  estimate: $${r.estimate}  range: $${r.low}–$${r.high}`);
    console.log(`  confidence: ${r.confidence}  support comps: ${r.supportComps.length}`);
    console.log(`  warnings: ${r.warnings.join(' | ')}`);
    if (r.primary?.row) {
      const p = r.primary.row;
      console.log(`  primary comp: ${p.carat}ct ${p.shape} ${p.color || p.colorNormalized} @ $${p.priceUsd}`);
    }
    r.supportComps.forEach(sc =>
      console.log(`  support: ${sc.row.carat}ct ${sc.row.shape} ${sc.row.color} → adj $${sc.estimatedPrice}  σ=${sc.sigmaLog.toFixed(3)}  score=${sc.score.toFixed(3)}`)
    );

    // PRIMARY MUST NOT be the 0.89ct brownish radiant
    const pRow = r.primary?.row;
    if (pRow) {
      const isBrownish089 = Math.abs(pRow.carat - 0.89) < 0.05 && (pRow.color || '').toLowerCase().includes('brownish');
      assert(!isBrownish089, 'T03: primary must NOT be 0.89ct brownish radiant');
      const isOldHeart = Math.abs(pRow.carat - 2.08) < 0.10 && pRow.shape === 'heart';
      assert(!isOldHeart, 'T03: primary must NOT be the old 2ct heart when Messi radiant stock exists');
      assertEqual(pRow.shape, 'radiant', 'T03: primary is same-shape radiant from Messi color stock');
    }

    // Should have multiple support comps (ensemble)
    assert(r.supportComps.length >= 1, 'T03: at least one support comp');
    assert(r.supportComps.length > 1, 'T03: sparse pink case uses an ensemble, not a lone comp');

    // Estimate in low-to-mid thousands range
    assertBetween(r.estimate, 800, 8000, 'T03: estimate in expected range');
    assert(r.low < r.estimate && r.estimate < r.high, 'T03: low < est < high');

    const hasVividSupport = r.supportComps.some(sc => (sc.row.color || '').toLowerCase().includes('vivid'));
    const hasNearCaratPinkSupport = r.supportComps.some(sc =>
      sc.row.carat >= 3.5 && (sc.row.color || '').toLowerCase().includes('pink')
    );
    const acceptedBrownish089 = r.supportComps.some(sc =>
      Math.abs(sc.row.carat - 0.89) < 0.05 && (sc.row.color || '').toLowerCase().includes('brownish')
    );
    assert(hasVividSupport, 'T03: ensemble includes vivid-pink evidence');
    assert(hasNearCaratPinkSupport, 'T03: ensemble includes a near-carat pink anchor');
    assert(!acceptedBrownish089, 'T03: 0.89ct brownish radiant is not accepted support');

    // Check the 0.89ct brownish, if present, is scored worse than 4.13ct cushion
    const sc089 = r.supportComps.find(sc => Math.abs(sc.row.carat - 0.89) < 0.05 && (sc.row.color || '').toLowerCase().includes('brownish'));
    const sc413 = r.supportComps.find(sc => Math.abs(sc.row.carat - 4.13) < 0.10);
    if (sc089 && sc413) {
      assert(sc089.score >= sc413.score, 'T03: 0.89ct brownish has worse (>=) score than 4.13ct cushion');
    }
  }

  // ── T04: 4ct D VS1 marquise ─────────────────────────────────────────────
  {
    console.log('\n── T04: 4ct D VS1 marquise ────────────────────────────────────────');
    const q = { carat: 4.0, shape: 'marquise', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' };
    const r = resolveAlibabaComp(q);
    console.log(`  matchType: ${r.matchType}  estimate: $${r.estimate}  range: $${r.low}–$${r.high}`);
    assertIncludes(['exact', 'nearest', 'best_available'], r.matchType, 'T04 matchType');
    assert(r.estimate > 0, 'T04: positive estimate');
    assert(r.low < r.estimate, 'T04: low < estimate');
    assert(r.high > r.estimate, 'T04: high > estimate');
  }

  // ── T05: 2ct Fancy Vivid Pink VVS2 heart ─────────────────────────────────
  {
    console.log('\n── T05: 2ct FVP VVS2 heart ────────────────────────────────────────');
    const q = { carat: 2.0, shape: 'heart', colorFamily: 'fancy', colorFamily_key: 'pink_fv', clarity: 'VVS2' };
    const r = resolveAlibabaComp(q);
    console.log(`  matchType: ${r.matchType}  estimate: $${r.estimate}  range: $${r.low}–$${r.high}`);
    assertIncludes(['exact', 'nearest', 'best_available'], r.matchType, 'T05 has result');
    assert(r.estimate > 0, 'T05: estimate > 0');
    // Sanity: 2ct FVP should be priced in hundreds to low thousands
    assertBetween(r.estimate, 100, 10000, 'T05: sanity price range');
  }

  // ── T06: orange → no comps ─────────────────────────────────────────────
  {
    console.log('\n── T06: 1ct Fancy Vivid Orange VS1 oval (no orange comps) ─────────');
    const q = { carat: 1.0, shape: 'oval', colorFamily: 'fancy', colorFamily_key: 'orange_fv', clarity: 'VS1' };
    const r = resolveAlibabaComp(q);
    console.log(`  matchType: ${r.matchType}`);
    assertEqual(r.matchType, 'none', 'T06: no orange comps → none');
  }

  // ── T07: White color sanity for merged supplier pools ────────────────────
  {
    console.log('\n── T07: Color ordering 2ct round VS1 ─────────────────────────────');
    const grades = ['D', 'E', 'F', 'G', 'H', 'I'];
    const results = grades.map(g => ({
      grade: g,
      result: resolveAlibabaComp({ carat: 2.0, shape: 'round', colorFamily: 'white', whiteGrade: g, clarity: 'VS1' }),
    }));
    results.forEach(r =>
      console.log(`  ${r.grade}: $${r.result.estimate} [$${r.result.low}–$${r.result.high}]`)
    );
    const byGrade = Object.fromEntries(results.map(r => [r.grade, r.result.estimate]));
    assert(byGrade.D > byGrade.H, 'T07: D > H at same spec');
    assert(byGrade.D > byGrade.I, 'T07: D > I at same spec');
    assert(byGrade.H > byGrade.I, 'T07: H > I at same spec');
  }

  // ── T08: Clarity ordering VVS1 > VS1 > VS2 > SI1 at 2ct round D ─────────
  {
    console.log('\n── T08: Clarity ordering 2ct D round ──────────────────────────────');
    const clarities = ['VVS1', 'VS1', 'VS2', 'SI1'];
    const results = clarities.map(c => ({
      clar: c,
      result: resolveAlibabaComp({ carat: 2.0, shape: 'round', colorFamily: 'white', whiteGrade: 'D', clarity: c }),
    }));
    let strictlyDecreasing = true;
    for (let i = 1; i < results.length; i++) {
      if (results[i].result.estimate >= results[i - 1].result.estimate) {
        strictlyDecreasing = false;
        console.error(`  Clarity ordering fail: ${results[i - 1].clar} ≤ ${results[i].clar}`);
      }
    }
    results.forEach(r =>
      console.log(`  ${r.clar}: $${r.result.estimate} [$${r.result.low}–$${r.result.high}]`)
    );
    assert(results[0].result.estimate > results[1].result.estimate, 'T08: VVS1 > VS1 premium holds');
    assert(results[1].result.estimate > results[3].result.estimate, 'T08: VS1 > SI1 discount holds');
    assert(results[2].result.estimate > results[3].result.estimate, 'T08: VS2 > SI1 discount holds');
    if (!strictlyDecreasing) {
      console.log('  Note: VS1/VS2 are not forced monotonic when exact factory rows cross in the real sheet.');
    }
  }

  // ── T09: Carat monotonicity 1ct, 2ct, 3ct, 4ct, 5ct round D VS1 ─────────
  {
    console.log('\n── T09: Carat monotonicity round D VS1 ────────────────────────────');
    const carats = [0.5, 1, 2, 3, 4, 5];
    const results = carats.map(ct => ({
      ct,
      result: resolveAlibabaComp({ carat: ct, shape: 'round', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' }),
    }));
    let strictlyIncreasing = true;
    for (let i = 1; i < results.length; i++) {
      if (results[i].result.estimate <= results[i - 1].result.estimate) {
        strictlyIncreasing = false;
        console.error(`  Carat mono fail: ${results[i - 1].ct}ct ≥ ${results[i].ct}ct`);
      }
    }
    results.forEach(r =>
      console.log(`  ${r.ct}ct: $${r.result.estimate} [$${r.result.low}–$${r.result.high}]`)
    );
    assert(strictlyIncreasing, 'T09: price increases with carat');
  }

  // ── T10: range sanity — low < estimate < high for all test cases ─────────
  {
    console.log('\n── T10: Range sanity (all cases) ──────────────────────────────────');
    const queries = [
      { carat: 1.0, shape: 'round', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' },
      { carat: 2.0, shape: 'oval', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' },
      { carat: 3.0, shape: 'marquise', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' },
      { carat: 2.0, shape: 'cushion', colorFamily: 'fancy', colorFamily_key: 'pink_fv', clarity: 'VS1' },
      { carat: 3.8, shape: 'radiant', colorFamily: 'fancy', colorFamily_key: 'pink_fv', clarity: 'VVS2' },
    ];
    for (const q of queries) {
      const r = resolveAlibabaComp(q);
      if (r.matchType !== 'none') {
        assert(r.low < r.estimate, `T10: low < estimate for ${q.carat}ct ${q.shape}`);
        assert(r.estimate < r.high, `T10: estimate < high for ${q.carat}ct ${q.shape}`);
      }
    }
    console.log('  Range sanity: done');
  }

  // ── T11: compErrorScore unit check ──────────────────────────────────────
  {
    console.log('\n── T11: compErrorScore spot checks ────────────────────────────────');
    // Perfect match (exact parameters) → very low score
    const perfectRow = {
      carat: 1.0, shape: 'round', colorNormalized: 'D', clarity: 'VS1',
      colorFamily: 'white', priceUsd: 400, confidence: 'high', caratBand: null, clarityBand: null,
    };
    const perfectQuery = { carat: 1.0, shape: 'round', whiteGrade: 'D', clarity: 'VS1', colorFamily: 'white' };
    const scoreExact = compErrorScore(perfectQuery, perfectRow);
    assertBetween(scoreExact.total, 0, 0.15, 'T11: perfect match has score ≤ 0.15');

    // Far carat gap: 3.8ct vs 0.89ct → high score
    const brownishRow = {
      carat: 0.89, shape: 'radiant', colorFamily: 'fancy', color: 'Fancy Intense Brownish Pink',
      clarity: 'VS2', priceUsd: 262, confidence: 'medium', caratBand: null, clarityBand: null,
    };
    const pinkQuery = { carat: 3.8, shape: 'radiant', colorFamily: 'fancy', colorFamily_key: 'pink_fv', clarity: 'VVS2' };
    const scoreBrownish = compErrorScore(pinkQuery, brownishRow);
    console.log(`  3.80ct FVP vs 0.89ct brownish: score=${scoreBrownish.total.toFixed(4)}`);
    assert(scoreBrownish.total > 0.35, 'T11: 0.89ct brownish gets high score vs 3.8ct FVP');

    // Close match (different clarity but same shape/color) → moderate score
    const closeRow = {
      carat: 1.0, shape: 'oval', colorNormalized: 'D', clarity: 'VVS1',
      colorFamily: 'white', priceUsd: 500, confidence: 'medium', caratBand: null, clarityBand: null,
    };
    const closeQuery = { carat: 1.0, shape: 'oval', whiteGrade: 'D', clarity: 'VS1', colorFamily: 'white' };
    const scoreClose = compErrorScore(closeQuery, closeRow);
    assertBetween(scoreClose.total, 0.05, 0.30, 'T11: VVS1 vs VS1 → moderate score');
    console.log(`  1ct D oval, VVS1 vs VS1 comp: score=${scoreClose.total.toFixed(4)}`);
  }

  // ── T12: adjustCompToQuery spot checks ──────────────────────────────────
  {
    console.log('\n── T12: adjustCompToQuery spot checks ─────────────────────────────');

    // Same spec → no adjustment (estimate ≈ listing)
    const row = {
      carat: 1.0, shape: 'round', colorNormalized: 'D', clarity: 'VS1',
      colorFamily: 'white', priceUsd: 400, confidence: 'high', caratBand: null, clarityBand: null,
    };
    const adj1 = adjustCompToQuery(
      { carat: 1.0, shape: 'round', whiteGrade: 'D', clarity: 'VS1', colorFamily: 'white' },
      row
    );
    assertBetween(adj1.estimatedPrice, 380, 420, 'T12: same spec → estimate ≈ listing');
    console.log(`  Same spec: listing=$400  adj=$${adj1.estimatedPrice}`);

    // 2ct query from 1ct D VS1 comp → about 4× (^1.8 = 2^1.8 ≈ 3.48 × per-ct → total ≈ 3.48×2 = 6.97×)
    // Actually: delta = 0.8 * ln(2/1) = 0.554 in log-dpc, then +ln(2) for carat = total ln(est) ≈ ln(400)+0.554+0.693
    // est ≈ 400 * exp(0.554+0.693) ≈ 400 * 3.48 ≈ 1390
    const adj2 = adjustCompToQuery(
      { carat: 2.0, shape: 'round', whiteGrade: 'D', clarity: 'VS1', colorFamily: 'white' },
      row
    );
    console.log(`  2ct from 1ct D VS1 $400 comp: adj=$${adj2.estimatedPrice}`);
    assertBetween(adj2.estimatedPrice, 800, 2400, 'T12: 2ct extrapolation in plausible range');

    // Fancy: same row as the 2.08ct heart FVP VVS2 $770
    const pinkRow = {
      carat: 2.08, shape: 'heart', colorFamily: 'fancy', color: 'Fancy Vivid Pink',
      clarity: 'VVS2', priceUsd: 770, confidence: 'medium', caratBand: null, clarityBand: null,
    };
    const pinkAdj = adjustCompToQuery(
      { carat: 3.8, shape: 'radiant', colorFamily: 'fancy', colorFamily_key: 'pink_fv', clarity: 'VVS2' },
      pinkRow
    );
    console.log(`  3.8ct FVP VVS2 from 2.08ct heart $770: adj=$${pinkAdj.estimatedPrice}  σ=${pinkAdj.sigmaLog.toFixed(3)}`);
    // Should be substantially higher than $770 due to carat and intensity model
    assertBetween(pinkAdj.estimatedPrice, 600, 5000, 'T12: pink 3.8ct from 2.08ct in plausible range');
  }

  // ── T13: 4.13ct cushion Fancy Pink self-adjust ───────────────────────────
  {
    console.log('\n── T13: adjustCompToQuery fancy — 4.13ct cushion FP ────────────────');
    // Find the 4.13ct cushion row in the index
    const { readFileSync } = await import('fs');
    const indexData = JSON.parse(readFileSync(indexPath, 'utf8'));
    const pinkRows = (indexData.comps || []).filter(r =>
      r.colorFamily === 'fancy' && (r.color || '').toLowerCase().includes('pink')
    );
    const r413 = pinkRows.find(r => Math.abs(r.carat - 4.13) < 0.10 && r.shape === 'cushion');
    if (r413) {
      const adj = adjustCompToQuery(
        { carat: 3.8, shape: 'radiant', colorFamily: 'fancy', colorFamily_key: 'pink_fv', clarity: 'VVS2' },
        r413
      );
      console.log(`  4.13ct ${r413.shape} ${r413.color} $${r413.priceUsd} → adj=$${adj.estimatedPrice}  σ=${adj.sigmaLog.toFixed(3)}`);
      assertBetween(adj.estimatedPrice, 500, 6000, 'T13: 4.13ct cushion adj in plausible range');
    } else {
      console.log('  WARNING: 4.13ct cushion pink not found in index');
    }
  }

  // ── T14: real-index exact matches keep same-shape primary comps ──────────
  {
    console.log('\n── T14: Real-index exact shape semantics ───────────────────────────');
    const cases = [
      { carat: 2.0, shape: 'portuguese', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' },
      { carat: 2.0, shape: 'moval', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' },
      { carat: 2.0, shape: 'heart', colorFamily: 'fancy', colorFamily_key: 'pink_fv', clarity: 'VVS2' },
    ];
    for (const q of cases) {
      const r = resolveAlibabaComp(q);
      console.log(`  ${q.carat}ct ${q.shape}: matchType=${r.matchType} primary=${r.primary?.row?.shape} estimate=$${r.estimate}`);
      assertEqual(r.matchType, 'exact', `T14: ${q.shape} has exact match`);
      assertEqual(r.primary.row.shape, normalizeShapeForComp(q.shape), `T14: ${q.shape} primary keeps exact shape`);
      assert(r.supportComps.every(sc => sc.row.shape === normalizeShapeForComp(q.shape)), `T14: ${q.shape} exact ensemble does not mix cross-shape rows`);
    }
  }

  // ── T15: exact multi-supplier pear guard, real Messi + StarGem data ──────
  {
    console.log('\n── T15: 3.01ct E VS1 pear multi-supplier exact display ────────────');
    const q = { carat: 3.01, shape: 'pear', colorFamily: 'white', whiteGrade: 'E', clarity: 'VS1' };
    const r = resolveAlibabaComp(q);
    const otherSuppliers = new Set((r.otherFactoryExact || []).map(e => e.supplierKey));
    console.log(`  primary=${supplierKey(r.primary?.row)} $${r.primary?.listingPrice} other=${[...otherSuppliers].join(',') || 'none'}`);
    assertEqual(r.matchType, 'exact', 'T15: pear query is exact');
    assertEqual(r.primary.row.shape, 'pear', 'T15: primary shape is pear');
    assertEqual(r.primary.row.colorNormalized, 'E', 'T15: primary color is E');
    assertEqual(r.primary.row.clarity, 'VS1', 'T15: primary clarity is VS1');
    assertEqual(supplierKey(r.primary.row), 'starsgem', 'T15: cheapest StarGem is floor primary');
    assertBetween(r.estimate, 330, 350, 'T15: estimate stays on StarGem floor, not blended with Messi');
    assert(otherSuppliers.has('messi'), 'T15: Messi exact rows are shown as otherFactoryExact');
    assert((r.otherFactoryExact || []).every(e => e.row.shape === 'pear' && e.row.colorNormalized === 'E' && e.row.clarity === 'VS1'),
      'T15: otherFactoryExact rows preserve exact pear/E/VS1 spec');
    assert((r.alternatives || []).every(a => supplierKey(a.row) === 'starsgem'),
      'T15: alternatives are same floor supplier only');
  }
}

// ── P1 carat slope policy unit tests (no index needed) ───────────────────────

function testCaratPriorForQuery() {
  console.log('\n── caratPriorForQuery ───────────────────────────────────────────────');
  assertEqual(caratPriorForQuery(1.0),  0.8,  '1ct → prior 0.8');
  assertEqual(caratPriorForQuery(4.99), 0.8,  '4.99ct → prior 0.8');
  assertEqual(caratPriorForQuery(5.0),  0.65, '5ct → prior 0.65');
  assertEqual(caratPriorForQuery(8.0),  0.65, '8ct → prior 0.65');
  console.log('  caratPriorForQuery: done');
}

function testResolveEffectiveCaratSlope() {
  console.log('\n── resolveEffectiveCaratSlope ───────────────────────────────────────');

  // ── Step 2: no curve → prior_only ──────────────────────────────────────────
  {
    const r = resolveEffectiveCaratSlope(null, { carat: 2.0, colorFamily: 'white' });
    assertEqual(r.mode, 'prior_only', 'null curve → prior_only');
    assertEqual(r.slope, 0.8, 'null curve → slope is 0.8 prior');
    assertEqual(r.prior, 0.8, 'null curve → prior field 0.8');
    assertEqual(r.rawFitted, null, 'null curve → rawFitted null');
  }

  // ── Step 2: no curve, 5ct query → prior_only with 0.65 ────────────────────
  {
    const r = resolveEffectiveCaratSlope(null, { carat: 6.0, colorFamily: 'white' });
    assertEqual(r.mode, 'prior_only', '5ct+ null curve → prior_only');
    assertEqual(r.slope, 0.65, '5ct+ null curve → 0.65 prior');
    assertEqual(r.prior, 0.65, '5ct+ null curve → prior field 0.65');
  }

  // ── Step 3: low confidence + extrapolated → ignored_fallback_prior ─────────
  {
    const curve = { slope: 1.1, rawSlope: 1.3, confidence: 'low', queryIsExtrapolated: true, sourceCount: 1, n: 4 };
    const r = resolveEffectiveCaratSlope(curve, { carat: 6.0, colorFamily: 'white' });
    assertEqual(r.mode, 'ignored_fallback_prior', 'low+extrapolated → ignored_fallback_prior');
    assertEqual(r.slope, 0.65, 'ignored → 0.65 prior (5ct+ query)');
    assert(Math.abs(r.rawFitted - 1.1) < 0.001, 'rawFitted preserves fitted slope');
  }

  // ── Step 3: same but below 5ct → 0.8 prior ────────────────────────────────
  {
    const curve = { slope: 1.1, confidence: 'low', queryIsExtrapolated: true, sourceCount: 1, n: 4 };
    const r = resolveEffectiveCaratSlope(curve, { carat: 2.0, colorFamily: 'white' });
    assertEqual(r.mode, 'ignored_fallback_prior', 'low+extrapolated 2ct → ignored_fallback_prior');
    assertEqual(r.prior, 0.8, 'prior 0.8 for 2ct');
    assertEqual(r.slope, 0.8, 'slope 0.8 for 2ct ignored');
  }

  // ── Step 4: extrapolated, medium confidence → shrunk_extrapolated ──────────
  {
    const curve = { slope: 1.0, confidence: 'medium', queryIsExtrapolated: true, sourceCount: 2, n: 6 };
    const r = resolveEffectiveCaratSlope(curve, { carat: 2.0, colorFamily: 'white' });
    assertEqual(r.mode, 'shrunk_extrapolated', 'medium+extrapolated → shrunk_extrapolated');
    // slope = prior + 0.15 * (1.0 - 0.8) = 0.8 + 0.03 = 0.83
    assertBetween(r.slope, 0.829, 0.831, 'shrunk_extrapolated slope ~ 0.83');
  }

  // ── Step 4: extrapolated, high confidence → NOT shrunk_extrapolated ────────
  {
    const curve = { slope: 0.95, confidence: 'high', queryIsExtrapolated: true, sourceCount: 2, n: 12 };
    const r = resolveEffectiveCaratSlope(curve, { carat: 2.0, colorFamily: 'white' });
    assert(r.mode !== 'shrunk_extrapolated' && r.mode !== 'ignored_fallback_prior',
      'high confidence extrapolation passes through to steps 5-8');
  }

  // ── Step 5: single source → shrunk_single_source ───────────────────────────
  {
    const curve = { slope: 1.2, confidence: 'medium', queryIsExtrapolated: false, sourceCount: 1, n: 8 };
    const r = resolveEffectiveCaratSlope(curve, { carat: 2.0, colorFamily: 'white' });
    assertEqual(r.mode, 'shrunk_single_source', 'single source → shrunk_single_source');
    // slope = 0.8 + 0.35 * (1.2 - 0.8) = 0.8 + 0.14 = 0.94
    assertBetween(r.slope, 0.939, 0.941, 'shrunk_single_source slope ~ 0.94');
  }

  // ── Step 6: low confidence, multi-source, in-hull → shrunk_low_confidence ──
  {
    const curve = { slope: 1.1, confidence: 'low', queryIsExtrapolated: false, sourceCount: 2, n: 4 };
    const r = resolveEffectiveCaratSlope(curve, { carat: 2.0, colorFamily: 'white' });
    assertEqual(r.mode, 'shrunk_low_confidence', 'low conf in-hull multi-source → shrunk_low_confidence');
    // slope = 0.8 + 0.25 * (1.1 - 0.8) = 0.8 + 0.075 = 0.875
    assertBetween(r.slope, 0.874, 0.876, 'shrunk_low_confidence slope ~ 0.875');
  }

  // ── Step 7: deviation cap → fitted_capped ──────────────────────────────────
  {
    const curve = { slope: 1.2, confidence: 'high', queryIsExtrapolated: false, sourceCount: 3, n: 12 };
    const r = resolveEffectiveCaratSlope(curve, { carat: 2.0, colorFamily: 'white' });
    assertEqual(r.mode, 'fitted_capped', 'slope > prior + 0.25 → fitted_capped');
    // slope capped at 0.8 + 0.25 = 1.05
    assertBetween(r.slope, 1.049, 1.051, 'fitted_capped slope = 1.05');
  }

  // ── Step 8: clean fit → fitted ─────────────────────────────────────────────
  {
    const curve = { slope: 0.95, confidence: 'high', queryIsExtrapolated: false, sourceCount: 3, n: 12 };
    const r = resolveEffectiveCaratSlope(curve, { carat: 2.0, colorFamily: 'white' });
    assertEqual(r.mode, 'fitted', 'clean high-confidence fit → fitted');
    assertBetween(r.slope, 0.949, 0.951, 'fitted slope preserved');
  }

  // ── 5ct+ prior interaction with fitted_capped ──────────────────────────────
  {
    // At 5ct+, prior is 0.65, maxDeviation = 0.25 → cap at 0.90
    const curve = { slope: 1.0, confidence: 'high', queryIsExtrapolated: false, sourceCount: 3, n: 12 };
    const r = resolveEffectiveCaratSlope(curve, { carat: 6.0, colorFamily: 'white' });
    assertEqual(r.prior, 0.65, '5ct+ fitted_capped uses 0.65 prior');
    assertEqual(r.mode, 'fitted_capped', '5ct+ slope 1.0 > 0.65+0.25 → capped');
    assertBetween(r.slope, 0.899, 0.901, '5ct+ cap at 0.65+0.25 = 0.90');
  }

  console.log('  resolveEffectiveCaratSlope: done');
}

function testModeSigmaBoost() {
  console.log('\n── MODE_SIGMA_BOOST / adjustCompToQuery sigma ───────────────────────');

  const baseQuery  = { carat: 2.0, colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1', shape: 'round' };
  const compRow    = { carat: 1.0, priceUsd: 800, shape: 'round', clarity: 'VS1', colorNormalized: 'D' };

  // ── (a) prior_only mode → sigma boost = 0 ─────────────────────────────────
  const adjPriorOnly = adjustCompToQuery(baseQuery, compRow, {
    localCaratSlope: 0.8, localCaratSlopeMode: 'prior_only',
    localCaratSlopePrior: 0.8, localCaratExtrapolated: false,
  });
  const adjNoContext = adjustCompToQuery(baseQuery, compRow, {});
  assert(
    Math.abs(adjPriorOnly.sigmaLog - adjNoContext.sigmaLog) < 0.001,
    'prior_only mode → same sigma as no-context (boost = 0)',
  );

  // ── (b) ignored_fallback_prior mode → sigma boost = 0.12 ──────────────────
  const adjIgnored = adjustCompToQuery(baseQuery, compRow, {
    localCaratSlope: 0.65, localCaratSlopeMode: 'ignored_fallback_prior',
    localCaratSlopePrior: 0.65, localCaratExtrapolated: true,
  });
  assert(
    adjIgnored.sigmaLog > adjPriorOnly.sigmaLog,
    'ignored_fallback_prior → wider sigma than prior_only',
  );

  // ── (c) slopeSigmaBoost uses effective prior, not hardcoded 0.8 ───────────
  // With slope=0.75, prior=0.65 → deviation 0.10 → larger boost than prior=0.8 (deviation 0.05).
  // The point: for 5ct+ queries the correct reference is 0.65, not 0.8.
  const adjLegacyNewPrior = adjustCompToQuery(baseQuery, compRow, {
    localCaratSlope: 0.75, localCaratSlopePrior: 0.65,
    localCaratExtrapolated: false,
    // no localCaratSlopeMode → triggers legacy path
  });
  const adjLegacyOldPrior = adjustCompToQuery(baseQuery, compRow, {
    localCaratSlope: 0.75,
    localCaratExtrapolated: false,
    // legacy: no prior → defaults to 0.8
  });
  // With prior 0.65, slope 0.75 is 0.10 away → bigger boost than prior 0.8 (0.05 away).
  assert(
    adjLegacyNewPrior.sigmaLog > adjLegacyOldPrior.sigmaLog,
    'slopeSigmaBoost with segment prior=0.65 is larger for slope=0.75 (deviation 0.10 > 0.05)',
  );

  console.log('  MODE_SIGMA_BOOST/sigma: done');
}

function testFitLocalCaratSlopeLargeCaratGuard() {
  console.log('\n── fitLocalCaratSlope 5ct+ guard ────────────────────────────────────');

  // Build synthetic candidates: knots only at 1, 2, 3ct — no coverage above 4ct
  const makeRow = (carat, priceUsd) => ({
    carat, priceUsd, shape: 'round', clarity: 'VS1', colorNormalized: 'D',
    colorFamily: 'white', count: 1, section: 'test - supplier_a',
  });

  const lowKnotCandidates = [
    makeRow(1.0, 800), makeRow(1.0, 810), makeRow(1.25, 850),
    makeRow(1.5, 920), makeRow(2.0, 1100), makeRow(2.5, 1300),
    makeRow(3.0, 1600),
  ];

  const query5ct = { carat: 5.0, shape: 'round', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' };
  const curveFor5ct = fitLocalCaratSlope(lowKnotCandidates, query5ct, 0.65);
  assert(curveFor5ct === null, '5ct query with knots max 3ct → fitLocalCaratSlope returns null');

  // Same pool, 2ct query → should succeed (no 5ct guard)
  const query2ct = { carat: 2.0, shape: 'round', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' };
  const curveFor2ct = fitLocalCaratSlope(lowKnotCandidates, query2ct, 0.8);
  assert(curveFor2ct !== null, '2ct query with same pool → fit succeeds');

  // Pool with knots at 1, 2, 3, 5ct → 5ct query should succeed (has 2 knots ≥ 4ct)
  const highKnotCandidates = [
    ...lowKnotCandidates,
    makeRow(4.5, 3500), makeRow(5.0, 4500),
  ];
  const curveFor5ctHigh = fitLocalCaratSlope(highKnotCandidates, query5ct, 0.65);
  assert(curveFor5ctHigh !== null, '5ct query with knots at 4.5+5ct → fit succeeds');

  console.log('  fitLocalCaratSlope 5ct+ guard: done');
}

function testExactMatchSlopeIrrelevant() {
  console.log('\n── Exact match: slope irrelevance ───────────────────────────────────');

  // When query carat == comp carat, log(q/c) = 0 → deltaCarat = 0 regardless of slope.
  const q   = { carat: 1.0, colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1', shape: 'round' };
  const row = { carat: 1.0, priceUsd: 800, shape: 'round', clarity: 'VS1', colorNormalized: 'D' };

  const adjFitted = adjustCompToQuery(q, row, {
    localCaratSlope: 1.5, localCaratSlopeMode: 'fitted',
    localCaratSlopePrior: 0.8, localCaratExtrapolated: false,
  });
  const adjPrior = adjustCompToQuery(q, row, {
    localCaratSlope: 0.8, localCaratSlopeMode: 'prior_only',
    localCaratSlopePrior: 0.8, localCaratExtrapolated: false,
  });

  assert(
    Math.abs(adjFitted.estimatedPrice - adjPrior.estimatedPrice) < 2,
    'Exact match: slope 1.5 vs 0.8 does not move price estimate',
  );

  console.log('  Exact match slope irrelevance: done');
}

function testFitLocalCaratSlopeCratBandExclusion() {
  console.log('\n── fitLocalCaratSlope: caratBand rows excluded ──────────────────────');

  const makeRow = (carat, priceUsd, caratBand = false) => ({
    carat, priceUsd, shape: 'round', clarity: 'VS1', colorNormalized: 'D',
    colorFamily: 'white', count: 1, section: 'test - supplier_a',
    ...(caratBand ? { caratBand: true } : {}),
  });
  const query = { carat: 2.0, shape: 'round', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' };

  // Pool with ONLY caratBand rows → should return null (no concrete points)
  const bandOnly = [
    makeRow(1.0, 800, true), makeRow(2.0, 1100, true), makeRow(3.0, 1600, true),
    makeRow(1.5, 920, true), makeRow(2.5, 1300, true),
  ];
  const curveBandOnly = fitLocalCaratSlope(bandOnly, query, 0.8);
  assert(curveBandOnly === null, 'caratBand-only pool → null curve (no concrete knots)');

  console.log('  caratBand exclusion: done');
}

// ── entry point ──────────────────────────────────────────────────────────────

async function main() {
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('COMP ENGINE v3 — TEST SUITE');
  console.log('══════════════════════════════════════════════════════════════════════');

  // ── Unit tests (no index needed) ──────────────────────────────────────────
  console.log('\n── UNIT TESTS ───────────────────────────────────────────────────────');
  testParseFancyColorLabel();
  testInferFancyFamilyKey();
  testShapeDistance();
  testGetClarityMult();
  testMedianOf();
  testModifierLogDelta();
  testBlendComps();
  testCandidateHardGates();
  testExactMatchSemantics();
  testScoringSemantics();
  testAdjustmentSemantics();
  await testExactFloorDisplayGuards();

  // ── P1 carat slope policy unit tests ─────────────────────────────────────
  console.log('\n── P1 CARAT SLOPE POLICY UNIT TESTS ─────────────────────────────────');
  testCaratPriorForQuery();
  testResolveEffectiveCaratSlope();
  testModeSigmaBoost();
  testFitLocalCaratSlopeLargeCaratGuard();
  testExactMatchSlopeIrrelevant();
  testFitLocalCaratSlopeCratBandExclusion();

  // ── Integration tests (need index) ─────────────────────────────────────────
  try {
    await loadIndex(indexPath);
    console.log('\n  Index loaded successfully.');
    await runIntegrationTests();
  } catch (e) {
    console.error(`\nFailed to load index or run integration tests: ${e.message}`);
    console.error(e.stack);
  }

  // ── Run built-in runTests() from the engine ────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('BUILT-IN ENGINE TEST SUITE (via runTests())');
  console.log('══════════════════════════════════════════════════════════════════════');
  const { runTests } = await import('../comp-engine-v3.js');
  runTests();

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log(`UNIT/INTEGRATION: ${passed} passed, ${failed} failed of ${testCount} assertions`);
  console.log('══════════════════════════════════════════════════════════════════════\n');

  if (failed > 0) process.exitCode = 1;
}

main().catch(e => {
  console.error('Unhandled error:', e);
  process.exitCode = 1;
});
