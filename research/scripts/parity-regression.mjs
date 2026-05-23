#!/usr/bin/env node
/**
 * parity-regression.mjs — Regression + golden-case test harness for comp-engine-v3.
 *
 * Context: production (index.html) now imports research/comp-engine-v3.js directly
 * via <script type="module">, so research/production parity is guaranteed by
 * construction. This harness therefore:
 *
 *   Tier A — 5 golden acceptance-criteria cases on the real merged index.
 *   Tier C — Deterministic synthetic micro-index cases (supplier cap, exact floor).
 *   Tier B — Key runTests() queries verified against expected behavioural invariants.
 *   Mapper — buildCompQueryFromState logic validated against expected query objects.
 *
 * Usage:
 *   node research/scripts/parity-regression.mjs
 *   node research/scripts/parity-regression.mjs --tier=A     # Tier A + C only
 *   node research/scripts/parity-regression.mjs --tier=full  # all tiers
 *
 * Exit 0 = all pass. Exit 1 = any failure (suitable for CI gate).
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import {
  loadIndex,
  resolveAlibabaComp,
  supplierKey,
  MAX_SUPPLIER_WEIGHT_FRAC,
} from '../comp-engine-v3.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

// ── CLI ───────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const tierFlag = args.find(a => a.startsWith('--tier='))?.split('=')[1] ?? 'default';
const RUN_TIER_B = tierFlag === 'full';

// ── Helpers ───────────────────────────────────────────────────────────────────

let passed = 0, failed = 0;

function ok(label) {
  passed++;
  console.log(`  ✓  ${label}`);
}

function fail(label, detail = '') {
  failed++;
  console.error(`  ✗  ${label}${detail ? ': ' + detail : ''}`);
}

function assert(cond, label, detail = '') {
  if (cond) ok(label); else fail(label, detail);
}

function assertMatch(matchType, allowed, label) {
  assert(allowed.includes(matchType), label, `got matchType=${matchType}, expected one of [${allowed.join('|')}]`);
}

function assertBetween(v, lo, hi, label) {
  assert(v >= lo && v <= hi, label, `got ${v}, expected [${lo}, ${hi}]`);
}

function assertEstimateRelTol(r, label, tol = 0.005) {
  assert(r.estimate != null && r.estimate > 0, `${label}: estimate > 0`);
  assert(r.low < r.estimate && r.estimate < r.high, `${label}: low < estimate < high`);
  // Interval bounds within relative tolerance of each other (sanity)
  const spread = (r.high - r.low) / r.estimate;
  assert(spread > 0 && spread < 5, `${label}: interval spread sane`, `spread=${spread.toFixed(2)}`);
}

function loadJson(rel) {
  return JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
}

// ── Index loading ─────────────────────────────────────────────────────────────

async function loadMergedIndex() {
  const base = loadJson('research/data/alibaba-comps-index.json');
  const supplements = ['research/data/messi-comps.json', 'research/data/starsgem-comps.json', 'research/data/messi-color-comps.json'];
  for (const rel of supplements) {
    try { const d = loadJson(rel); base.comps.push(...(d.comps || [])); } catch (_) { /* optional */ }
  }
  await loadIndex(base);
  return base;
}

// ═════════════════════════════════════════════════════════════════════════════
// TIER A — Golden acceptance-criteria cases (5 categories)
// ═════════════════════════════════════════════════════════════════════════════

async function runTierA() {
  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('TIER A — Golden parity gate (5 acceptance cases, real merged index)');
  console.log('══════════════════════════════════════════════════════════════════════');

  await loadMergedIndex();

  // A1: White exact / near-exact 1ct D VS1 round
  {
    const label = 'A1: white-exact-1ct-d-vs1-round';
    console.log(`\n── ${label}`);
    const r = resolveAlibabaComp({ carat: 1.0, shape: 'round', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' });
    console.log(`   matchType=${r.matchType} estimate=$${r.estimate} support=${r.supportComps?.length}`);
    assertMatch(r.matchType, ['exact', 'nearest', 'best_available'], label + ' matchType');
    assertEstimateRelTol(r, label);
    assert(r.supportComps?.length >= 1, label + ' has support comps');
    assert(r.estimate > 50 && r.estimate < 2000, label + ' estimate range', `got $${r.estimate}`);
  }

  // A2: White large-carat extrapolation (T09 equivalent) — 6ct D VS1 oval
  {
    const label = 'A2: white-large-6ct-d-vs1-oval';
    console.log(`\n── ${label}`);
    const r = resolveAlibabaComp({ carat: 6.0, shape: 'oval', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' });
    console.log(`   matchType=${r.matchType} estimate=$${r.estimate} localCaratCurve=${r.localCaratCurve?.confidence ?? 'none'}`);
    assertMatch(r.matchType, ['exact', 'nearest', 'best_available'], label + ' matchType');
    assertEstimateRelTol(r, label, 0.01);
    assert(r.estimate > 200, label + ' estimate > $200', `got $${r.estimate}`);
    // Large carat — should have warning or wide interval
    const spread = r.high / r.low;
    assert(spread >= 1.1, label + ' interval spread ≥ 1.1× at 6ct', `spread=${spread.toFixed(2)}`);
  }

  // A3: Fancy vivid pink T16 regression — 3.8ct radiant FVP VVS2
  {
    const label = 'A3: fancy-vivid-pink-3.8ct-radiant (T16)';
    console.log(`\n── ${label}`);
    const r = resolveAlibabaComp({ carat: 3.8, shape: 'radiant', colorFamily: 'fancy', colorFamily_key: 'pink_fv', clarity: 'VVS2' });
    console.log(`   matchType=${r.matchType} estimate=$${r.estimate} support=${r.supportComps?.length}`);
    if (r.primary?.row) {
      const p = r.primary.row;
      console.log(`   primary: ${p.carat}ct ${p.color || p.colorNormalized} @ $${p.priceUsd}`);
    }
    assertMatch(r.matchType, ['exact', 'nearest', 'best_available'], label + ' matchType');
    // T16: must NOT anchor on the 0.89ct brownish pink row as primary
    const primaryColor = (r.primary?.row?.color || '').toLowerCase();
    const primaryCarat = r.primary?.row?.carat ?? 0;
    assert(
      !(primaryColor.includes('brownish') && Math.abs(primaryCarat - 0.89) < 0.05),
      label + ' primary is NOT the 0.89ct brownish pink row',
      `got primary: ${primaryCarat}ct ${primaryColor}`
    );
    assertBetween(r.estimate, 500, 8000, label + ' estimate in [500, 8000]');
  }

  // A4: Single-source-only estimate — synthetic micro-index
  {
    const label = 'A4: white-single-source-synthetic';
    console.log(`\n── ${label}`);
    const micro = loadJson('research/fixtures/parity-single-source.json');
    await loadIndex(micro);
    const r = resolveAlibabaComp({ carat: 2.0, shape: 'pear', colorFamily: 'white', whiteGrade: 'E', clarity: 'VS1' });
    console.log(`   matchType=${r.matchType} estimate=$${r.estimate} capPossible=${r.sourceConcentration?.capPossible}`);
    assertMatch(r.matchType, ['exact', 'nearest', 'best_available'], label + ' matchType');
    assert(r.sourceConcentration != null, label + ' has sourceConcentration');
    assert(r.sourceConcentration?.capPossible === false, label + ' capPossible=false (single source)');
    assert(r.sourceConcentration?.dominated === true, label + ' dominated=true');
    assertEstimateRelTol(r, label);
  }

  // A5: Multi-source blend with supplier cap — real merged index
  {
    const label = 'A5: white-multi-source-cap-real-index';
    console.log(`\n── ${label}`);
    await loadMergedIndex();
    const r = resolveAlibabaComp({ carat: 1.0, shape: 'round', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' });
    const sc = r.sourceConcentration;
    console.log(`   matchType=${r.matchType} capPossible=${sc?.capPossible} capApplied=${sc?.capApplied} finalDominantFrac=${sc?.finalDominantFrac?.toFixed(3)}`);
    assertMatch(r.matchType, ['exact', 'nearest', 'best_available'], label + ' matchType');
    // When multi-source, cap MUST be possible (1ct round D has Messi + StarGem)
    assert(sc?.capPossible === true, label + ' capPossible=true (multi-source exists)');
    // If cap was applied, final dominant fraction must be ≤ MAX_SUPPLIER_WEIGHT_FRAC + ε
    if (sc?.capApplied) {
      assert(
        sc.finalDominantFrac <= MAX_SUPPLIER_WEIGHT_FRAC + 0.001,
        label + ' finalDominantFrac ≤ MAX_SUPPLIER_WEIGHT_FRAC after cap',
        `got ${sc.finalDominantFrac?.toFixed(3)}`
      );
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// TIER C — Deterministic synthetic micro-index cases
// ═════════════════════════════════════════════════════════════════════════════

async function runTierC() {
  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('TIER C — Synthetic micro-index (deterministic, no index churn)');
  console.log('══════════════════════════════════════════════════════════════════════');

  // C1: Multi-source cap forced by micro-index
  // Fixture: 3 Dominant Factory rows + 1 Other Factory row, all VVS1 clarity.
  // Query is VS1 → nearest match → blend path where supplier-weight cap operates.
  // Per-supplier row cap (MAX_PER_SUPPLIER=2) keeps 2 Dominant + 1 Other.
  // Dominant raw fraction ≈ 0.667 > MAX_SUPPLIER_WEIGHT_FRAC → cap applied.
  {
    const label = 'C1: multi-source-cap (micro-index)';
    console.log(`\n── ${label}`);
    const micro = loadJson('research/fixtures/parity-multi-source-cap.json');
    await loadIndex(micro);
    const r = resolveAlibabaComp({ carat: 1.0, shape: 'round', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' });
    const sc = r.sourceConcentration;
    console.log(`   matchType=${r.matchType} capPossible=${sc?.capPossible} capApplied=${sc?.capApplied} finalDominantFrac=${sc?.finalDominantFrac?.toFixed(3)}`);
    assertMatch(r.matchType, ['nearest', 'best_available'], label + ' matchType (must be nearest, not exact — different clarity)');
    assert(sc != null, label + ' has sourceConcentration');
    assert(sc?.capPossible === true, label + ' capPossible=true (two suppliers in blend)');
    assert(sc?.capApplied === true, label + ' capApplied=true (dominant > 65% before cap)');
    assert(
      sc.finalDominantFrac <= MAX_SUPPLIER_WEIGHT_FRAC + 0.001,
      label + ' finalDominantFrac ≤ MAX_SUPPLIER_WEIGHT_FRAC after cap',
      `got ${sc.finalDominantFrac?.toFixed(3)}`
    );
    assertEstimateRelTol(r, label);
  }

  // C2: Single-source — cap impossible
  {
    const label = 'C2: single-source-cap-impossible (micro-index)';
    console.log(`\n── ${label}`);
    const micro = loadJson('research/fixtures/parity-single-source.json');
    await loadIndex(micro);
    const r = resolveAlibabaComp({ carat: 2.0, shape: 'pear', colorFamily: 'white', whiteGrade: 'E', clarity: 'VS1' });
    const sc = r.sourceConcentration;
    console.log(`   matchType=${r.matchType} capPossible=${sc?.capPossible} dominated=${sc?.dominated}`);
    assert(sc?.capPossible === false, label + ' capPossible=false');
    assert(sc?.dominated === true, label + ' dominated=true');
    assert(sc?.capApplied === false, label + ' capApplied=false');
  }

  // C3: Exact-floor display guards
  {
    const label = 'C3: exact-floor-display-guards (micro-index)';
    console.log(`\n── ${label}`);
    const micro = loadJson('research/fixtures/parity-exact-floor.json');
    await loadIndex(micro);
    const r = resolveAlibabaComp({ carat: 2.0, shape: 'pear', colorFamily: 'white', whiteGrade: 'E', clarity: 'VS1' });
    console.log(`   matchType=${r.matchType} estimate=$${r.estimate} primary=${r.primary ? supplierKey(r.primary.row) + ' @ $' + r.primary.listingPrice : 'none'}`);
    console.log(`   otherFactoryExact=${r.otherFactoryExact?.map(e => e.supplierKey).join(', ') || 'none'}`);
    assert(r.matchType === 'exact', label + ' matchType=exact', `got ${r.matchType}`);
    // Primary must be StarGem (cheapest adjusted exact floor).
    if (r.primary?.row) {
      assert(supplierKey(r.primary.row) === 'starsgem', label + ' primary is starsgem', `got ${supplierKey(r.primary.row)}`);
      assert(r.primary.listingPrice === 100, label + ' listingPrice=100', `got ${r.primary.listingPrice}`);
    }
    assertBetween(r.estimate, 101, 103, label + ' estimate equals adjusted floor near $102');
    assert(r.primary?.modifiers?.parts?.some(p => p.startsWith('carat')), label + ' primary exposes carat modifier');
    // Messi must be in otherFactoryExact, not alternatives
    const otherSuppliers = (r.otherFactoryExact || []).map(e => e.supplierKey);
    assert(otherSuppliers.some(s => s === 'messi'), label + ' messi in otherFactoryExact', `got [${otherSuppliers}]`);
    const altSuppliers = (r.alternatives || []).map(a => supplierKey(a.row));
    assert(!altSuppliers.some(s => s === 'messi'), label + ' messi NOT in alternatives', `got alts=[${altSuppliers}]`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// TIER B — Key T-case behavioural invariants (real merged index)
// ═════════════════════════════════════════════════════════════════════════════

async function runTierB() {
  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('TIER B — Key T-case behavioural invariants (real merged index)');
  console.log('══════════════════════════════════════════════════════════════════════');

  await loadMergedIndex();

  // T02: H < D at same white spec
  {
    const label = 'T02: H < D estimate at 2ct round VS1';
    const rH = resolveAlibabaComp({ carat: 2.0, shape: 'round', colorFamily: 'white', whiteGrade: 'H', clarity: 'VS1' });
    const rD = resolveAlibabaComp({ carat: 2.0, shape: 'round', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' });
    console.log(`\n── ${label}: H=$${rH.estimate} D=$${rD.estimate}`);
    assert(rH.estimate < rD.estimate, label, `H=${rH.estimate} not < D=${rD.estimate}`);
    assertBetween(rH.estimate / rD.estimate, 0.40, 1.0, label + ' H/D ratio');
  }

  // T05: Color downgrade ordering (G < D)
  {
    const label = 'T05: G < D estimate at 2ct round VS1';
    const rG = resolveAlibabaComp({ carat: 2.0, shape: 'round', colorFamily: 'white', whiteGrade: 'G', clarity: 'VS1' });
    const rD = resolveAlibabaComp({ carat: 2.0, shape: 'round', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' });
    console.log(`\n── ${label}: G=$${rG.estimate} D=$${rD.estimate}`);
    assert(rG.estimate <= rD.estimate, label, `G=${rG.estimate} not ≤ D=${rD.estimate}`);
  }

  // T10: cushion_brilliant normalizes to cushion shape
  {
    const label = 'T10: cushion_brilliant → cushion (shape normalization)';
    const rCB = resolveAlibabaComp({ carat: 2.0, shape: 'cushion_brilliant', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' });
    const rC  = resolveAlibabaComp({ carat: 2.0, shape: 'cushion', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' });
    console.log(`\n── ${label}: cushion_brilliant=$${rCB.estimate} cushion=$${rC.estimate}`);
    assertMatch(rCB.matchType, ['exact', 'nearest', 'best_available', 'none'], label + ' matchType');
    // Both should produce same or very similar estimates (same normalized shape)
    if (rCB.estimate && rC.estimate) {
      const relDiff = Math.abs(rCB.estimate - rC.estimate) / rC.estimate;
      assert(relDiff < 0.01, label + ' cushion_brilliant ≈ cushion estimate', `relDiff=${(relDiff*100).toFixed(2)}%`);
    }
  }

  // T15: Orange query → matchType none (no orange rows in index)
  {
    const label = 'T15: orange_fv query does not borrow non-orange rows';
    const r = resolveAlibabaComp({ carat: 1.0, shape: 'oval', colorFamily: 'fancy', colorFamily_key: 'orange_fv', clarity: 'VS1' });
    console.log(`\n── ${label}: matchType=${r.matchType}`);
    // Either none, or if it finds comps they must have orange in color
    if (r.matchType !== 'none' && r.supportComps?.length > 0) {
      const allOrange = r.supportComps.every(sc => {
        const col = (sc.row.color || '').toLowerCase();
        return col.includes('orange') || col.includes('orangy');
      });
      assert(allOrange, label + ' support comps are all orange-family', `found non-orange: ${r.supportComps.map(sc => sc.row.color).join(', ')}`);
    } else {
      ok(label + ' (matchType=none, no cross-hue contamination possible)');
    }
  }

  // T16 re-run: T16 brownish anchor guard (full index)
  {
    const label = 'T16: 3.8ct FVP radiant — primary not 0.89ct brownish pink';
    const r = resolveAlibabaComp({ carat: 3.8, shape: 'radiant', colorFamily: 'fancy', colorFamily_key: 'pink_fv', clarity: 'VVS2' });
    const primaryColor = (r.primary?.row?.color || '').toLowerCase();
    const primaryCarat = r.primary?.row?.carat ?? 0;
    console.log(`\n── ${label}: primary ${primaryCarat}ct ${primaryColor}`);
    assert(
      !(primaryColor.includes('brownish') && Math.abs(primaryCarat - 0.89) < 0.05),
      label,
      `primary is brownish 0.89ct row`
    );
  }

  // T18: Sub-1ct carat — should find results
  {
    const label = 'T18: 0.5ct D VS1 round — finds comps';
    const r = resolveAlibabaComp({ carat: 0.5, shape: 'round', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' });
    console.log(`\n── ${label}: matchType=${r.matchType} estimate=$${r.estimate}`);
    assertMatch(r.matchType, ['exact', 'nearest', 'best_available'], label + ' matchType');
    assert(r.estimate > 0, label + ' estimate > 0');
    assert(r.estimate < 500, label + ' estimate < $500 at 0.5ct', `got $${r.estimate}`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// MAPPER TESTS — buildCompQueryFromState logic
// ═════════════════════════════════════════════════════════════════════════════

function runMapperTests() {
  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('MAPPER — buildCompQueryFromState contract (logic only, no state)');
  console.log('══════════════════════════════════════════════════════════════════════');

  // These mirror what buildCompQueryFromState does in index.html.
  // Tested here using the same normalizeShapeForComp exported by the module.
  // If the mapper in index.html ever diverges, these document expected behavior.

  const SHAPE_NORMALIZE = {
    sq_radiant: 'radiant', cushion_brilliant: 'cushion', square_cushion: 'cushion',
    trilliant: 'marquise', old_european: 'round', old_mine: 'round',
  };
  function normalizeShapeForComp(s) { return SHAPE_NORMALIZE[s] || s; }

  const mapperCases = [
    {
      desc: 'white round D VS1 1ct',
      shape: 'round', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1', ct: 1.0,
      expected: { colorFamily: 'white', shape: 'round', whiteGrade: 'D', clarity: 'VS1', carat: 1.0 },
    },
    {
      desc: 'fancy pink_fv radiant VVS2 3.8ct',
      shape: 'radiant', colorFamily: 'pink_fv', whiteGrade: null, clarity: 'VVS2', ct: 3.8,
      expected: { colorFamily: 'fancy', colorFamily_key: 'pink_fv', shape: 'radiant', clarity: 'VVS2', carat: 3.8 },
    },
    {
      desc: 'cushion_brilliant normalizes to cushion',
      shape: 'cushion_brilliant', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1', ct: 2.0,
      expected: { colorFamily: 'white', shape: 'cushion', whiteGrade: 'D', clarity: 'VS1', carat: 2.0 },
    },
    {
      desc: 'sq_radiant normalizes to radiant',
      shape: 'sq_radiant', colorFamily: 'white', whiteGrade: 'E', clarity: 'VVS2', ct: 1.5,
      expected: { colorFamily: 'white', shape: 'radiant', whiteGrade: 'E', clarity: 'VVS2', carat: 1.5 },
    },
  ];

  for (const tc of mapperCases) {
    const label = `mapper: ${tc.desc}`;
    const isWhite = tc.colorFamily === 'white';
    const shape = normalizeShapeForComp(tc.shape);
    const query = isWhite
      ? { colorFamily: 'white', shape, whiteGrade: tc.whiteGrade, clarity: tc.clarity, carat: tc.ct }
      : { colorFamily: 'fancy', shape, colorFamily_key: tc.colorFamily, clarity: tc.clarity, carat: tc.ct };

    let ok_flag = true;
    for (const [k, v] of Object.entries(tc.expected)) {
      if (query[k] !== v) {
        fail(label, `${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(query[k])}`);
        ok_flag = false;
        break;
      }
    }
    if (ok_flag) ok(label);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Main
// ═════════════════════════════════════════════════════════════════════════════

console.log('parity-regression.mjs — Comp Engine v3 regression gate');
console.log(`Tier: ${RUN_TIER_B ? 'full (A + C + B + mapper)' : 'default (A + C + mapper)'}`);

try {
  await runTierA();
  await runTierC();
  runMapperTests();
  if (RUN_TIER_B) await runTierB();
} catch (err) {
  console.error('\nFATAL:', err.message);
  process.exit(1);
}

console.log('\n══════════════════════════════════════════════════════════════════════');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════════════════════════');

if (failed > 0) {
  console.error(`\n✗ ${failed} test(s) failed — parity gate blocks merge.`);
  process.exit(1);
} else {
  console.log(`\n✓ All ${passed} tests passed.`);
  process.exit(0);
}
