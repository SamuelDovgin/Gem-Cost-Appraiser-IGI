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
  assert(scoreHeart < scoreBrownish, 'same-intensity vivid heart scores better than tiny brownish radiant');

  const perfect = { carat: 1, shape: 'round', colorFamily: 'white', colorNormalized: 'D', clarity: 'VS1', priceUsd: 100, confidence: 'high' };
  const crossShape = { ...perfect, shape: 'emerald' };
  const qWhite = { carat: 1, shape: 'round', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' };
  assert(compErrorScore(qWhite, perfect) < compErrorScore(qWhite, crossShape), 'same-shape white comp scores better than cross-shape comp');

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
    assertBetween(r.estimate / qD.estimate, 0.50, 0.90,
      'T02: H is 50–90% of D price (sanity check)');
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
    assert(strictlyDecreasing, 'T08: VVS1 > VS1 > VS2 > SI1');
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
    assertBetween(scoreExact, 0, 0.15, 'T11: perfect match has score ≤ 0.15');

    // Far carat gap: 3.8ct vs 0.89ct → high score
    const brownishRow = {
      carat: 0.89, shape: 'radiant', colorFamily: 'fancy', color: 'Fancy Intense Brownish Pink',
      clarity: 'VS2', priceUsd: 262, confidence: 'medium', caratBand: null, clarityBand: null,
    };
    const pinkQuery = { carat: 3.8, shape: 'radiant', colorFamily: 'fancy', colorFamily_key: 'pink_fv', clarity: 'VVS2' };
    const scoreBrownish = compErrorScore(pinkQuery, brownishRow);
    console.log(`  3.80ct FVP vs 0.89ct brownish: score=${scoreBrownish.toFixed(4)}`);
    assert(scoreBrownish > 0.35, 'T11: 0.89ct brownish gets high score vs 3.8ct FVP');

    // Close match (different clarity but same shape/color) → moderate score
    const closeRow = {
      carat: 1.0, shape: 'oval', colorNormalized: 'D', clarity: 'VVS1',
      colorFamily: 'white', priceUsd: 500, confidence: 'medium', caratBand: null, clarityBand: null,
    };
    const closeQuery = { carat: 1.0, shape: 'oval', whiteGrade: 'D', clarity: 'VS1', colorFamily: 'white' };
    const scoreClose = compErrorScore(closeQuery, closeRow);
    assertBetween(scoreClose, 0.05, 0.30, 'T11: VVS1 vs VS1 → moderate score');
    console.log(`  1ct D oval, VVS1 vs VS1 comp: score=${scoreClose.toFixed(4)}`);
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
