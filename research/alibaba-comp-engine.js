/**
 * alibaba-comp-engine.js
 * ──────────────────────────────────────────────────────────────────────────
 * STANDALONE ALIBABA COMP MATCHING + MODIFIER ENGINE
 *
 * Extracted from index.html for independent analysis and debugging.
 * This file is self-contained: load it in a browser console or Node.js,
 * call runTests() or resolveAlibabaComp(query) directly.
 *
 * Usage (browser console with http-server running on port 8765):
 *   const m = await import('/research/alibaba-comp-engine.js');
 *   await m.loadIndex();
 *   console.log(m.resolveAlibabaComp({ carat:2.0, shape:'oval', colorFamily:'white', whiteGrade:'H', clarity:'VS1' }));
 *   m.runTests();
 *
 * Usage (Node.js):
 *   node --input-type=module <<'EOF'
 *   import { loadIndex, resolveAlibabaComp, runTests } from './research/alibaba-comp-engine.js';
 *   await loadIndex('./research/data/alibaba-comps-index.json');
 *   runTests();
 *   EOF
 *
 * ──────────────────────────────────────────────────────────────────────────
 * SECTIONS (Ctrl+F to jump):
 *   §1  REFERENCE DATA     — multiplier tables copied from index.html
 *   §2  NORMALIZATION      — shape/color/clarity mapping
 *   §3  CANDIDATE FILTER   — who is eligible for matching
 *   §4  SCORING            — weighted distance function
 *   §5  EXACT MATCH        — strict matcher
 *   §6  NEAREST MATCH      — scored/thresholded matcher
 *   §7  ABSOLUTE BEST      — no-threshold fallback
 *   §8  MODIFIERS          — white + fancy price adjustment
 *   §9  RESOLVE            — full pipeline: exact → nearest → fallback → none
 *   §10 INDEX LOADER       — fetch/require the JSON
 *   §11 TEST FIXTURES      — runTests() with expected outcomes
 * ──────────────────────────────────────────────────────────────────────────
 */

// ══════════════════════════════════════════════════════════════════════════
// §1  REFERENCE DATA
// ══════════════════════════════════════════════════════════════════════════

// --- Clarity ranks (lower = better) ---
const CLARITY_RANK_NUM = { VVS1: 0, VVS2: 1, 'VVS-VS': 1.5, VS1: 2, VS2: 3, SI1: 4, SI2: 5 };

// --- White color grade ranks (lower = better) ---
const WHITE_COLOR_GRADE_NUM = { D: 0, DE: 0.5, DEF: 1, E: 1, F: 2, G: 3, H: 4, I: 5, J: 6, K: 7, L: 8 };

// --- White color multipliers (vs E = 1.00, the Alibaba commodity floor) ---
// Copied verbatim from index.html; E is the floor because Alibaba factory stock is DEF/VS+.
const WHITE_GRADE_MULT = {
  D: 1.08, E: 1.00, F: 0.92, G: 0.88, H: 0.82, I: 0.71, J: 0.60,
  K: 0.50, L: 0.42, M: 0.35, 'N-P': 0.28, 'Q-R': 0.21, 'S-Z': 0.16,
};

// --- Clarity multipliers (white), carat-interpolated ---
// These are the knot points for getClarityMult().
// KNOWN ISSUES TO INVESTIGATE:
//   - VS2 discount widens steeply at 5ct+ (0.80→0.70); verify against Alibaba SKU data.
//   - SI1/SI2 fall off sharply at 2ct; step-cut (emerald/asscher) shapes add ELONGATED_SI penalty.
const CLARITY_CARAT_KNOTS_W = [0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 7.0, 10.0];
const CLARITY_CARAT_MULTS_W = {
  IF:   [1.14, 1.18, 1.22, 1.28, 1.42, 1.50, 1.58, 1.68, 1.88],
  VVS1: [1.10, 1.14, 1.16, 1.20, 1.36, 1.44, 1.52, 1.62, 1.78],
  VVS2: [1.05, 1.08, 1.09, 1.12, 1.14, 1.16, 1.18, 1.21, 1.24],
  VS1:  [1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00],  // ← baseline
  VS2:  [0.92, 0.88, 0.87, 0.86, 0.84, 0.82, 0.80, 0.76, 0.70],
  SI1:  [0.84, 0.72, 0.60, 0.44, 0.38, 0.34, 0.30, 0.26, 0.22],
  SI2:  [0.72, 0.58, 0.46, 0.34, 0.28, 0.24, 0.20, 0.16, 0.12],
};

// --- Clarity multipliers (fancy color) — compressed because color masks inclusions ---
const CLARITY_MULT_COLOR = { IF: 1.12, VVS1: 1.08, VVS2: 1.04, VS1: 1.00, VS2: 0.95, SI1: 0.89, SI2: 0.77 };

// --- Shape multipliers (white) — vs round = 1.00 ---
// KNOWN ISSUES TO INVESTIGATE:
//   - Marquise (0.87) and radiant (0.87) are equal; Alibaba data shows marquise running
//     ~29% above the Messi family at 1ct. Check whether shapeMult needs a shape-specific override.
//   - Asscher (0.84) and princess (0.86) are close. Messi factory prices them identically at
//     1ct; mult difference only matters at 2ct+.
const SHAPE_MULT_WHITE = {
  round: 1.00, oval: 1.08, moval: 0.94, pear: 1.05, marquise: 0.87, heart: 0.86,
  trilliant: 0.82, old_european: 0.92, old_mine: 0.88,
  cushion: 0.90, cushion_brilliant: 0.91, square_cushion: 0.90,
  radiant: 0.87, sq_radiant: 0.88, princess: 0.86,
  half_moon: 0.80, shield: 0.78, hexagonal: 0.79, hexagonal_dutch: 0.82,
  emerald: 0.83, asscher: 0.84,
  baguette: 0.76, tapered_baguette: 0.74, carre: 0.80,
  rose: 0.72, briolette: 0.70, portuguese: 0.85, flanders: 0.83,
};

// --- Shape multipliers (fancy color) — vs cushion = 1.00 ---
// KNOWN ISSUES TO INVESTIGATE:
//   - Heart (0.96) should probably be higher for vivid pink/blue based on comp data
//     showing OM GEMS moval premium. Cross-check against §8 FANCY modifier behavior.
const SHAPE_MULT_COLOR = {
  round: 0.90, oval: 1.05, moval: 0.99, pear: 1.03, marquise: 0.93, heart: 0.96,
  trilliant: 0.84, old_european: 0.88, old_mine: 0.86,
  cushion: 1.00, cushion_brilliant: 1.00, square_cushion: 1.00,
  radiant: 1.02, sq_radiant: 1.00, princess: 0.90,
  half_moon: 0.82, shield: 0.80, hexagonal: 0.81, hexagonal_dutch: 0.85,
  emerald: 0.96, asscher: 1.02,
  baguette: 0.78, tapered_baguette: 0.76, carre: 0.86,
  rose: 0.75, briolette: 0.72, portuguese: 0.88, flanders: 0.85,
};

// --- Fancy color base (ws1 = $/ct at 1ct; scale = carat exponent) ---
// KNOWN ISSUES TO INVESTIGATE:
//   - fancyIntensityMult() divides userWs/compWs using per-ct values. At sizes where
//     compRow.carat ≠ 1ct this can be inaccurate because the scale exponents differ
//     between intensity tiers. Consider computing at the actual comp carat instead of 1ct.
const FANCY_COLOR_BASE = {
  yellow_fl: { ws1:  95, scale: 0.91, label: 'Fancy Light Yellow' },
  yellow_f:  { ws1: 140, scale: 0.91, label: 'Fancy Yellow' },
  yellow_fi: { ws1: 255, scale: 1.00, label: 'Fancy Intense Yellow' },
  yellow_fv: { ws1: 375, scale: 0.87, label: 'Fancy Vivid Yellow' },
  pink_fl:   { ws1: 150, scale: 0.91, label: 'Fancy Light Pink' },
  pink_f:    { ws1: 220, scale: 0.91, label: 'Fancy Pink' },
  pink_fi:   { ws1: 330, scale: 0.90, label: 'Fancy Intense Pink' },
  pink_fv:   { ws1: 500, scale: 0.88, label: 'Fancy Vivid Pink' },
  blue_fl:   { ws1: 175, scale: 0.92, label: 'Fancy Light Blue' },
  blue_f:    { ws1: 240, scale: 0.92, label: 'Fancy Blue' },
  blue_fi:   { ws1: 330, scale: 0.92, label: 'Fancy Intense Blue' },
  blue_fv:   { ws1: 450, scale: 0.90, label: 'Fancy Vivid Blue' },
  green_fl:  { ws1: 155, scale: 0.90, label: 'Fancy Light / Greyish Green' },
  green_f:   { ws1: 220, scale: 0.92, label: 'Fancy Green' },
  green_fi:  { ws1: 400, scale: 0.92, label: 'Fancy Intense Green' },
  green_fv:  { ws1: 525, scale: 0.90, label: 'Fancy Vivid Green' },
  orange_fl: { ws1: 140, scale: 0.95, label: 'Fancy Light Orange' },
  orange_f:  { ws1: 275, scale: 1.00, label: 'Fancy Orange' },
  orange_fi: { ws1: 475, scale: 1.02, label: 'Fancy Intense Orange' },
  orange_fv: { ws1: 700, scale: 1.00, label: 'Fancy Vivid Orange' },
  purple_fl: { ws1: 225, scale: 1.02, label: 'Fancy Light Purple/Violet' },
  purple_f:  { ws1: 450, scale: 1.05, label: 'Fancy Purple/Violet' },
  purple_fi: { ws1: 900, scale: 1.08, label: 'Fancy Intense Purple/Violet' },
  brown_f:   { ws1:  60, scale: 0.95, label: 'Fancy Brown / Champagne' },
  black:     { ws1:  45, scale: 1.00, label: 'Black Diamond' },
  red_purp:  { ws1: 390, scale: 1.10, label: 'Fancy Purplish / Brownish Red' },
  red_f:     { ws1: 625, scale: 1.20, label: 'Fancy Red' },
  red_fv:    { ws1: 950, scale: 1.25, label: 'Fancy Vivid Red' },
};

// --- Fancy color label → fancyColorBase key ---
// KNOWN ISSUES TO INVESTIGATE:
//   - 'brownish pink' maps to pink_f (not pink_fi). The source-of-truth treats
//     "Fancy Intense Brownish Pink" as intensity-penalized pink_fi with a modifier penalty.
//     This mapping currently misses that nuance.
//   - Many green/orange/red variants not mapped; inferFancyFamilyKey() returns null for them.
const FANCY_LABEL_MAP = {
  'fancy vivid pink': 'pink_fv', 'vivid pink': 'pink_fv',
  'fancy intense pink': 'pink_fi', 'intense pink': 'pink_fi',
  'fancy light pink': 'pink_fl', 'light pink': 'pink_fl',
  'fancy pink': 'pink_f', 'pink': 'pink_f',
  'fancy vivid yellow': 'yellow_fv', 'vivid yellow': 'yellow_fv',
  'fancy intense yellow': 'yellow_fi', 'intense yellow': 'yellow_fi',
  'fancy light yellow': 'yellow_fl', 'light yellow': 'yellow_fl',
  'fancy yellow': 'yellow_f', 'yellow': 'yellow_f',
  'fancy vivid blue': 'blue_fv', 'vivid blue': 'blue_fv',
  'fancy intense blue': 'blue_fi', 'intense blue': 'blue_fi',
  'fancy light blue': 'blue_fl', 'light blue': 'blue_fl',
  'fancy blue': 'blue_f', 'blue': 'blue_f',
  'fancy intense green': 'green_fi',
  'fancy vivid green': 'green_fv',
  'fancy intense greyish green': 'green_fi',
  'fancy green': 'green_f',
  'fancy red': 'red_f',
  'fancy intense brownish pink': 'pink_fi',   // ← NOTE: no brownish modifier applied
  'brownish pink': 'pink_f',
};

// Specialty shapes that never get a cross-shape "best_available" comp
const SPECIALTY_SHAPE_KEYS = new Set([
  'moval', 'trilliant', 'half_moon', 'shield', 'hexagonal', 'hexagonal_dutch',
  'old_european', 'old_mine', 'rose', 'briolette', 'portuguese', 'flanders',
  'baguette', 'tapered_baguette', 'carre',
]);

// Score threshold: candidates scoring above this are not "nearest" — they fall to
// best_available or model_fallback.
// KNOWN ISSUES TO INVESTIGATE:
//   - Raised from 3.5 to 5.0 to catch 4ct+ marquise (caratDist*4 alone = 4 for 1ct gap).
//   - At 5.0, a D comp for an H user scores colorDist*1 = 4 which passes. That may be
//     too lenient; the modifier will then apply a ×0.76 factor, but the comp URL is D.
const NEAREST_THRESHOLD = 5.0;

// ══════════════════════════════════════════════════════════════════════════
// §2  NORMALIZATION
// ══════════════════════════════════════════════════════════════════════════

// Aliases: multiple app shapes → single index shape
// KNOWN ISSUES TO INVESTIGATE:
//   - 'elongated_cushion' is an index shape; it maps to cushion for user queries but
//     is kept as its own shape in the index. shapeMatches() handles both directions.
//   - 'moval' has no alias; it falls through to the specialty-shape no-comp path.
const SHAPE_NORMALIZE = {
  sq_radiant: 'radiant',
  cushion_brilliant: 'cushion',
  square_cushion: 'cushion',
  elongated_cushion: 'cushion',
  trilliant: 'marquise',
  old_european: 'round',
  old_mine: 'round',
};

function normalizeShapeForComp(s) {
  return SHAPE_NORMALIZE[s] || s;
}

function shapeMatches(userShape, compShape) {
  return (
    normalizeShapeForComp(userShape) === compShape ||
    // A user querying cushion also matches elongated_cushion rows
    (compShape === 'elongated_cushion' && normalizeShapeForComp(userShape) === 'cushion')
  );
}

function inferFancyFamilyKey(colorLabel) {
  if (!colorLabel) return null;
  return FANCY_LABEL_MAP[colorLabel.toLowerCase().trim()] || null;
}

function getClarityMult(clarity, ct) {
  const vals = CLARITY_CARAT_MULTS_W[clarity];
  if (!vals) return 1.00;
  const knots = CLARITY_CARAT_KNOTS_W;
  if (ct <= knots[0]) return vals[0];
  if (ct >= knots[knots.length - 1]) return vals[vals.length - 1];
  for (let i = 0; i < knots.length - 1; i++) {
    if (ct <= knots[i + 1]) {
      const t = (ct - knots[i]) / (knots[i + 1] - knots[i]);
      return vals[i] + (vals[i + 1] - vals[i]) * t;
    }
  }
  return 1.00;
}

function getShapeMultForPricing(shapeKey, colorFamily) {
  if (colorFamily === 'white') return SHAPE_MULT_WHITE[shapeKey] ?? 1.0;
  return SHAPE_MULT_COLOR[shapeKey] ?? 1.0;
}

// ══════════════════════════════════════════════════════════════════════════
// §3  CANDIDATE FILTER
// ══════════════════════════════════════════════════════════════════════════

function whiteColorDistance(query, row) {
  const uR = WHITE_COLOR_GRADE_NUM[query.whiteGrade] ?? 2;
  const cR = WHITE_COLOR_GRADE_NUM[row.colorNormalized || 'D'] ?? 0;
  return Math.abs(uR - cR);
}
function whiteColorCompatible(query, row) {
  // Allow if within 5 steps on the grade-number scale.
  // KNOWN ISSUES: H user (rank 4) vs D comp (rank 0) = distance 4 → compatible.
  // This means an H user can match a D comp and receive a modifier. Intentional but
  // produces uncertain estimates at wide color gaps.
  return whiteColorDistance(query, row) <= 5;
}

function fancyColorCompatible(query, row) {
  // Check that the comp row color label mentions the same hue family as the user's colorFamily_key.
  if (!row.color) return false;
  const rl = row.color.toLowerCase();
  const uf = query.colorFamily_key || '';
  if (uf.includes('pink')   && !rl.includes('pink'))   return false;
  if (uf.includes('yellow') && !rl.includes('yellow')) return false;
  if (uf.includes('blue')   && !rl.includes('blue'))   return false;
  if (uf.includes('green')  && !rl.includes('green'))  return false;
  if (uf.includes('orange') && !rl.includes('orange')) return false;
  if (uf.includes('red')    && !rl.includes('red'))    return false;
  return true;
}

/**
 * filterCandidates — returns all index rows that are color/shape compatible with the query.
 * Does NOT filter on carat or clarity (those are handled in scoring/exact).
 *
 * @param {object} query  - { colorFamily, shape, whiteGrade?, colorFamily_key?, clarity, carat }
 * @param {Array}  comps  - raw rows from alibaba-comps-index.json
 */
function filterCandidates(query, comps) {
  return comps.filter(row => {
    if (row.colorFamily !== query.colorFamily) return false;
    if (!shapeMatches(query.shape, row.shape)) return false;
    if (query.colorFamily === 'white' && !whiteColorCompatible(query, row)) return false;
    if (query.colorFamily === 'fancy' && !fancyColorCompatible(query, row)) return false;
    return true;
  });
}

// ══════════════════════════════════════════════════════════════════════════
// §4  SCORING
// ══════════════════════════════════════════════════════════════════════════

/**
 * scoreCandidate — weighted distance between query and a comp row.
 * Lower is better; NEAREST_THRESHOLD is the cutoff for "close enough".
 *
 * Weight breakdown:
 *   carat   × 4.0  (dominant: a 0.5ct gap alone = score 2.0; 1ct gap = 4.0)
 *   clarity × 1.5  (e.g. VS1→VVS2 = 1 step = 1.5)
 *   color   × 1.0  (e.g. D→H = 4 steps = 4.0; this alone can hit threshold)
 *   shape         3.0 flat penalty for cross-shape match
 *   caratBand     0.3 penalty (band rows are less precise than exact-carat rows)
 *   clarityBand   0.5 penalty (VVS-VS band rows)
 *
 * KNOWN ISSUES TO INVESTIGATE:
 *   - Color weight (1.0) may be too low: H vs D color costs 4.0 points, which is less
 *     than a 1ct carat gap (4.0). An H user matching a D comp at same carat/clarity
 *     will score 4.0 total — right at the edge of NEAREST_THRESHOLD=5.0.
 *     This feels correct but the modifier then applies ×0.76 — verify vs real Alibaba data.
 *   - No penalty for band-clarity rows when user requests exact clarity (e.g. VVS1 vs VVS-VS band).
 *     Currently clarityBand adds 0.5 but doesn't prevent an exact match on clarity.
 *
 * @param {object} query
 * @param {object} row
 * @returns {number}
 */
function scoreCandidate(query, row) {
  // For carat-band rows use distance to nearest band edge, not center
  const caratDist = (row.caratBand && row.caratMin != null && row.caratMax != null)
    ? Math.max(0, row.caratMin - query.carat, query.carat - row.caratMax)
    : Math.abs(query.carat - (row.carat || 0));

  const clarU = CLARITY_RANK_NUM[query.clarity] ?? 2;
  const clarC = CLARITY_RANK_NUM[row.clarity] ?? 2;
  const clarDist = Math.abs(clarU - clarC);

  const colorDist = query.colorFamily === 'white' ? whiteColorDistance(query, row) : 0;
  const shapePenalty = shapeMatches(query.shape, row.shape) ? 0 : 3.0;
  const bandPenalty = (row.caratBand ? 0.3 : 0) + (row.clarityBand ? 0.5 : 0);

  return caratDist * 4.0 + clarDist * 1.5 + colorDist * 1.0 + shapePenalty + bandPenalty;
}

function confidenceRank(conf) {
  return { high: 3, 'medium-high': 2, medium: 1, 'low-medium': 0, low: 0 }[conf] ?? -1;
}

// ══════════════════════════════════════════════════════════════════════════
// §5  EXACT MATCH
// ══════════════════════════════════════════════════════════════════════════

function caratTolerance(ct) {
  // KNOWN ISSUES: tolerance is generous (±0.18ct up to 6ct). A 4.10ct query matches a 4.00ct comp.
  // Intentional — Alibaba ladders have discrete carat steps.
  if (ct <= 2) return 0.08;
  if (ct <= 6) return 0.18;
  return 0.25;
}

function isExactCarat(userCt, row) {
  if (row.caratBand) return false;            // band rows are never exact
  return Math.abs(userCt - (row.carat || 0)) <= caratTolerance(row.carat);
}

/**
 * findExactComp — returns best exact match or null.
 * Exact = carat within tolerance, same clarity, color exact or within band definition.
 *
 * Color exact rules for white:
 *   D comp  → user must be D
 *   E comp  → user must be E
 *   F comp  → user must be F
 *   DE comp → user D or E
 *   DEF comp → user D, E, or F
 *   null comp → treated as D
 *
 * KNOWN ISSUES TO INVESTIGATE:
 *   - A DEF comp at VS1 and a D comp at VS1 both exactly match a D user. The tie-break
 *     picks highest confidence → lowest price → lowest productId. This may surface the
 *     DEF comp (which is arguably a looser match) if it has higher confidence or lower price.
 *
 * @param {object} query
 * @param {Array}  comps
 */
function findExactComp(query, comps) {
  const candidates = filterCandidates(query, comps).filter(row => {
    if (!isExactCarat(query.carat, row)) return false;
    if (row.clarityBand) return false;
    if (row.clarity !== query.clarity) return false;
    if (query.colorFamily === 'white') {
      const cn = row.colorNormalized || 'D';
      if (cn === 'D' || cn === null) return query.whiteGrade === 'D';
      if (cn === 'E')                return query.whiteGrade === 'E';
      if (cn === 'F')                return query.whiteGrade === 'F';
      if (cn === 'DE')               return query.whiteGrade === 'D' || query.whiteGrade === 'E';
      if (cn === 'DEF')              return ['D', 'E', 'F'].includes(query.whiteGrade);
      return false;
    }
    return true; // fancy: color already filtered by filterCandidates
  });

  if (!candidates.length) return null;

  candidates.sort((a, b) =>
    confidenceRank(b.confidence) - confidenceRank(a.confidence) ||
    a.priceUsd - b.priceUsd ||
    (a.productId > b.productId ? 1 : -1)
  );
  return candidates[0];
}

function shortLabel(row) {
  if (!row || !row.section) return 'Alibaba';
  const dashIdx = row.section.lastIndexOf(' - ');
  return dashIdx >= 0 ? row.section.slice(dashIdx + 3).trim() : row.section.split(',')[0].trim();
}

// ══════════════════════════════════════════════════════════════════════════
// §6  NEAREST MATCH
// ══════════════════════════════════════════════════════════════════════════

/**
 * findNearestComps — returns up to maxN distinct-productId rows within NEAREST_THRESHOLD.
 * Sorted by score ascending (best first).
 *
 * KNOWN ISSUES TO INVESTIGATE:
 *   - One comp per productId may hide a better-clarity row from the same listing.
 *     E.g. the Messi oval ladder has VS2/VS1/VVS2/VVS1 as separate rows; the best-scoring
 *     row from that listing wins, even if the user's clarity is VVS2 and the VS1 row
 *     scored marginally lower.
 *   - Scores at 4ct+ for marquise tend to be exactly 4.0 (1ct carat gap × 4), which is
 *     at the lower end of threshold. This works but leaves no room for a shape penalty.
 *
 * @param {object} query
 * @param {Array}  comps
 * @param {number} maxN    defaults to 3
 */
function findNearestComps(query, comps, maxN = 3) {
  const scored = filterCandidates(query, comps)
    .map(row => ({ row, score: scoreCandidate(query, row) }))
    .filter(c => c.score <= NEAREST_THRESHOLD)
    .sort((a, b) => a.score - b.score || a.row.priceUsd - b.row.priceUsd);

  const seenPid = new Set();
  const result = [];
  for (const c of scored) {
    if (!seenPid.has(c.row.productId)) {
      seenPid.add(c.row.productId);
      result.push(c.row);
      if (result.length >= maxN) break;
    }
  }
  return result;
}

// ══════════════════════════════════════════════════════════════════════════
// §7  ABSOLUTE BEST (no threshold fallback)
// ══════════════════════════════════════════════════════════════════════════

/**
 * findAbsoluteBestComps — like findNearestComps but no score cutoff.
 * Used when exact + nearest both fail but SPECIALTY_SHAPE_KEYS is not triggered.
 * Returns a blended estimate from the top-N closest comps.
 *
 * KNOWN ISSUES TO INVESTIGATE:
 *   - For shapes with zero exact-carat rows in the index (e.g. 4ct marquise, 6ct oval),
 *     this is the only path. Verify the weighted blend produces reasonable estimates.
 *   - Broadens to "same color family, any shape" if no shape-matched candidates exist.
 *     This means a user asking for a 6ct vivid pink emerald gets yellow comps if no pink
 *     emerald exists — check fancyColorCompatible() before broadening.
 *
 * @param {object} query
 * @param {Array}  comps
 * @param {number} maxN  defaults to 3
 */
function findAbsoluteBestComps(query, comps, maxN = 3) {
  let candidates = filterCandidates(query, comps);
  if (!candidates.length) {
    // Broaden: same color family, any shape — but still respect hue family for fancy
    // (do NOT cross hue families: orange should not match red/pink/yellow/etc.)
    candidates = comps.filter(row => {
      if (row.colorFamily !== query.colorFamily) return false;
      if (query.colorFamily === 'fancy' && !fancyColorCompatible(query, row)) return false;
      return true;
    });
  }
  if (!candidates.length) return [];

  const scored = candidates
    .map(row => ({ row, score: scoreCandidate(query, row) }))
    .sort((a, b) => a.score - b.score || a.row.priceUsd - b.row.priceUsd);

  const seenPid = new Set();
  const result = [];
  for (const c of scored) {
    if (!seenPid.has(c.row.productId)) {
      seenPid.add(c.row.productId);
      result.push(c.row);
      if (result.length >= maxN) break;
    }
  }
  return result;
}

// ══════════════════════════════════════════════════════════════════════════
// §8  MODIFIERS
// ══════════════════════════════════════════════════════════════════════════

/**
 * applyWhiteModifiers — adjusts comp price for differences in color, clarity, shape, carat.
 *
 * Modifier stack (all multiplicative):
 *   colorMult   = WHITE_GRADE_MULT[userGrade] / WHITE_GRADE_MULT[compGrade]
 *   clarityMult = getClarityMult(userClarity, ct) / getClarityMult(compClarity, ct)
 *   shapeMult   = SHAPE_MULT_WHITE[userShape] / SHAPE_MULT_WHITE[compShape]
 *   caratMult   = (userCt / compCt)^1.8  (only when diff > 0.05ct)
 *
 * KNOWN ISSUES TO INVESTIGATE:
 *   - DEF and DE comps are mapped to 'E' for colorMult purposes (conservative).
 *     A D user vs a DEF comp therefore gets colorMult ≈ 1.08/1.00 = 1.08 (+8%).
 *     This is intentional but may overstate cost if the listing is truly D-priced.
 *   - caratMult exponent 1.8 is empirical. At large carat gaps (2ct user vs 1ct comp),
 *     this multiplies by 2^1.8 = 3.48. Verify this makes sense vs actual ladder prices.
 *   - No modifier is applied for cut grade (Alibaba factory = Excellent assumed).
 *
 * @param {object} query    - { carat, shape, colorFamily, whiteGrade, clarity }
 * @param {object} compRow  - single row from the comps index
 * @returns {{ combined, estimated, parts[] }}
 */
function applyWhiteModifiers(query, compRow) {
  const ct = query.carat;
  const cn = compRow.colorNormalized || 'D';
  // DEF/DE are treated as 'E' (conservative midpoint) for color mult
  const compGrade = (cn === 'DEF' || cn === 'DE') ? 'E' : (cn || 'D');

  const colorMult =
    (WHITE_GRADE_MULT[query.whiteGrade] ?? 0.70) /
    (WHITE_GRADE_MULT[compGrade] ?? WHITE_GRADE_MULT.D);

  const clarU = CLARITY_RANK_NUM[query.clarity] ?? 2;
  const clarC = CLARITY_RANK_NUM[compRow.clarity] ?? 2;
  const clarityMult = (clarU !== clarC)
    ? getClarityMult(query.clarity, ct) /
      Math.max(getClarityMult(compRow.clarity || 'VS1', ct), 0.01)
    : 1;

  const userSh = SHAPE_MULT_WHITE[query.shape] ?? 1.0;
  const compSh = SHAPE_MULT_WHITE[compRow.shape] ?? 1.0;
  const shapeMult = compSh > 0 ? userSh / compSh : 1;

  const caratDiff = Math.abs(query.carat - (compRow.carat || 0));
  const caratMult = caratDiff > 0.05
    ? Math.pow(query.carat / (compRow.carat || 1), 1.8)
    : 1;

  const combined = colorMult * clarityMult * shapeMult * caratMult;
  const parts = [];
  if (Math.abs(colorMult - 1) > 0.02)
    parts.push(`color ×${colorMult.toFixed(2)} (${query.whiteGrade} vs ${cn})`);
  if (Math.abs(clarityMult - 1) > 0.02)
    parts.push(`clarity ×${clarityMult.toFixed(2)} (${query.clarity} vs ${compRow.clarity})`);
  if (Math.abs(shapeMult - 1) > 0.02)
    parts.push(`shape ×${shapeMult.toFixed(2)} (${query.shape} vs ${compRow.shape})`);
  if (Math.abs(caratMult - 1) > 0.05)
    parts.push(`carat ×${caratMult.toFixed(2)} (${query.carat}ct vs ${compRow.carat}ct)`);

  return { combined, estimated: Math.round(compRow.priceUsd * combined), parts };
}

/**
 * fancyIntensityMult — ratio of user fancy family $/ct to comp fancy family $/ct.
 *
 * Formula: uses per-ct ws at the QUERY carat (not 1ct) to account for scaling exponents.
 *   userWsPerCt = ws1 * ct^(scale-1)
 *   compWsPerCt = ws1 * ct^(scale-1)   (using comp family's parameters)
 *   mult = userWsPerCt / compWsPerCt
 *
 * KNOWN ISSUES TO INVESTIGATE:
 *   - Uses query.carat for both sides. If the comp row is 2ct and the user is 4ct,
 *     both sides are evaluated at 4ct, which may not reflect the comp's actual pricing.
 *     Consider evaluating at compRow.carat or a midpoint.
 *   - Returns 1.0 if either family is unknown — silently no-ops.
 *
 * @param {string} userFamilyKey   - e.g. 'pink_fv'
 * @param {string} compColorLabel  - e.g. 'Fancy Intense Pink'
 * @param {number} ct              - carat (query carat used for both sides)
 */
function fancyIntensityMult(userFamilyKey, compColorLabel, ct) {
  const ub = FANCY_COLOR_BASE[userFamilyKey];
  const compKey = inferFancyFamilyKey(compColorLabel);
  const cb = compKey ? FANCY_COLOR_BASE[compKey] : null;
  if (!ub || !cb) return 1.0;
  const uWs = ub.ws1 * Math.pow(ct, ub.scale - 1);
  const cWs = cb.ws1 * Math.pow(ct, cb.scale - 1);
  return cWs > 0 ? uWs / cWs : 1.0;
}

/**
 * applyFancyModifiers — adjusts comp price for fancy color differences.
 *
 * Modifier stack:
 *   intensityMult = fancyIntensityMult(userFamily, compColorLabel, ct)
 *   clarityMult   = CLARITY_MULT_COLOR[userClarity] / CLARITY_MULT_COLOR[compClarity]
 *   shapeMult     = SHAPE_MULT_COLOR[userShape] / SHAPE_MULT_COLOR[compShape]
 *   caratMult     = (userCt / compCt)^1.5  (when diff > 0.05ct)
 *
 * KNOWN ISSUES TO INVESTIGATE:
 *   - Fancy caratMult exponent is 1.5 (vs 1.8 for white). This reflects lower growth
 *     exponents in fancy color pricing but is not directly derived from FANCY_COLOR_BASE scales.
 *     Could be computed dynamically from the scale value instead.
 *
 * @param {object} query    - { carat, shape, colorFamily, colorFamily_key, clarity }
 * @param {object} compRow
 * @returns {{ combined, estimated, parts[] }}
 */
function applyFancyModifiers(query, compRow) {
  const ct = query.carat;
  const intensityMult = fancyIntensityMult(query.colorFamily_key, compRow.color, ct);

  const clarC = CLARITY_MULT_COLOR[compRow.clarity] ?? 1;
  const clarU = CLARITY_MULT_COLOR[query.clarity] ?? 1;
  const clarityMult = clarC > 0 ? clarU / clarC : 1;

  const userSh = SHAPE_MULT_COLOR[query.shape] ?? 1;
  const compSh = SHAPE_MULT_COLOR[compRow.shape] ?? 1;
  const shapeMult = compSh > 0 ? userSh / compSh : 1;

  const caratDiff = Math.abs(query.carat - (compRow.carat || 0));
  const caratMult = caratDiff > 0.05
    ? Math.pow(query.carat / (compRow.carat || 1), 1.5)
    : 1;

  const combined = intensityMult * clarityMult * shapeMult * caratMult;
  const compKey = inferFancyFamilyKey(compRow.color);
  const parts = [];
  if (Math.abs(intensityMult - 1) > 0.05)
    parts.push(`intensity ×${intensityMult.toFixed(2)} (${query.colorFamily_key} vs ${compKey || '?'})`);
  if (Math.abs(clarityMult - 1) > 0.02)
    parts.push(`clarity ×${clarityMult.toFixed(2)}`);
  if (Math.abs(shapeMult - 1) > 0.02)
    parts.push(`shape ×${shapeMult.toFixed(2)}`);
  if (Math.abs(caratMult - 1) > 0.05)
    parts.push(`carat ×${caratMult.toFixed(2)} (${query.carat}ct vs ${compRow.carat}ct)`);

  return { combined, estimated: Math.round(compRow.priceUsd * combined), parts };
}

// ══════════════════════════════════════════════════════════════════════════
// §9  RESOLVE — full pipeline
// ══════════════════════════════════════════════════════════════════════════

let _compsIndex = null;  // { comps: [...], indexVersion, rowCount }

/**
 * resolveAlibabaComp — main entry point.
 *
 * Pipeline:
 *   1. Exact match          → matchType: 'exact'
 *   2. Nearest match        → matchType: 'nearest'      (score ≤ NEAREST_THRESHOLD)
 *   3. Best available       → matchType: 'best_available' (no threshold; blended estimate)
 *      └─ skipped for SPECIALTY_SHAPE_KEYS (returns 'none' instead)
 *   4. No match             → matchType: 'none'
 *
 * NOTE: The model_fallback (Messi round ladder × shape mult) from index.html is NOT
 * included here because it requires the full baseWhitePerCt() model. If you need it,
 * add the Messi ladder lookup here and call it between steps 2 and 3.
 *
 * @param {object} query - {
 *   carat: number,
 *   shape: string,           // app shape key, e.g. 'oval', 'marquise', 'cushion_brilliant'
 *   colorFamily: 'white' | 'fancy',
 *   whiteGrade?: string,     // 'D'–'Z' (required when colorFamily === 'white')
 *   colorFamily_key?: string, // e.g. 'pink_fv' (required when colorFamily === 'fancy')
 *   clarity: string,         // 'VS1', 'VVS2', etc.
 * }
 * @returns {object} result
 */
function resolveAlibabaComp(query) {
  if (!_compsIndex) {
    throw new Error('Index not loaded. Call loadIndex() first.');
  }
  const comps = _compsIndex.comps;

  // Normalize query shape for the index
  const normalizedQuery = {
    ...query,
    shape: normalizeShapeForComp(query.shape),
  };

  const applyMods = r =>
    normalizedQuery.colorFamily === 'white'
      ? applyWhiteModifiers(normalizedQuery, r)
      : applyFancyModifiers(normalizedQuery, r);

  // ── 1. Exact match ─────────────────────────────────────────────────
  const exact = findExactComp(normalizedQuery, comps);
  if (exact) {
    return {
      matchType: 'exact',
      primary: {
        row: exact,
        listingPrice: exact.priceUsd,
        estimatedPrice: exact.priceUsd,
        url: exact.url,
        label: shortLabel(exact),
        modifiers: null,
      },
      confidence: exact.confidence || 'high',
      source: 'comps-index',
    };
  }

  // ── 2. Nearest match ───────────────────────────────────────────────
  const nearestRows = findNearestComps(normalizedQuery, comps, 3);
  if (nearestRows.length) {
    const pRow = nearestRows[0];
    const pMod = applyMods(pRow);
    return {
      matchType: 'nearest',
      primary: {
        row: pRow,
        listingPrice: pRow.priceUsd,
        estimatedPrice: pMod.estimated,
        url: pRow.url,
        label: shortLabel(pRow),
        modifiers: pMod,
      },
      alternatives: nearestRows.slice(1).map(r => {
        const mod = applyMods(r);
        return { row: r, listingPrice: r.priceUsd, estimatedPrice: mod.estimated, url: r.url, label: shortLabel(r), modifiers: mod };
      }),
      confidence: pRow.confidence,
      source: 'comps-index',
    };
  }

  // ── 3. Best available (no threshold) — skipped for specialty shapes ─
  if (SPECIALTY_SHAPE_KEYS.has(query.shape)) {
    return { matchType: 'none', primary: null, alternatives: [], confidence: null, source: null };
  }

  const bestRows = findAbsoluteBestComps(normalizedQuery, comps, 3);
  if (bestRows.length) {
    const mods = bestRows.map(r => {
      const mod = applyMods(r);
      return { row: r, listingPrice: r.priceUsd, estimatedPrice: mod.estimated, url: r.url, label: shortLabel(r), modifiers: mod };
    });
    // Weighted blend: closer comps get higher weight
    const scores = bestRows.map(r => scoreCandidate(normalizedQuery, r));
    const weights = scores.map(s => 1 / (s + 0.5));
    const totalW = weights.reduce((a, b) => a + b, 0);
    const blendedEst = Math.round(
      mods.reduce((sum, m, i) => sum + m.estimatedPrice * weights[i], 0) / totalW
    );
    return {
      matchType: 'best_available',
      primary: { ...mods[0], estimatedPrice: blendedEst, blendedFrom: mods.length },
      alternatives: mods.slice(1),
      confidence: null,
      source: 'comps-index-extrapolated',
    };
  }

  return { matchType: 'none', primary: null, alternatives: [], confidence: null, source: null };
}

// ══════════════════════════════════════════════════════════════════════════
// §10  INDEX LOADER
// ══════════════════════════════════════════════════════════════════════════

/**
 * loadIndex — loads alibaba-comps-index.json.
 * Browser: pass a URL (or omit to use default relative path).
 * Node.js: pass a file path (string) to read synchronously via fs.readFileSync,
 *          or pass a parsed object directly.
 *
 * @param {string|object} [src]  URL, file path, or pre-parsed object
 */
async function loadIndex(src) {
  if (typeof src === 'object' && src !== null) {
    _compsIndex = src;
    return;
  }
  const url = src || 'research/data/alibaba-comps-index.json';

  // Node.js path
  if (typeof process !== 'undefined' && process.versions?.node) {
    const { readFileSync } = await import('fs');
    _compsIndex = JSON.parse(readFileSync(url, 'utf8'));
    return;
  }

  // Browser fetch path
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load comps index: HTTP ${res.status}`);
  _compsIndex = await res.json();
}

// ══════════════════════════════════════════════════════════════════════════
// §11  TEST FIXTURES
// ══════════════════════════════════════════════════════════════════════════

/**
 * runTests — runs a suite of fixtures and prints results.
 * Expected matchTypes are indicative; update them as you fix issues.
 *
 * Add your own cases at the bottom of the FIXTURES array.
 */
function runTests() {
  if (!_compsIndex) { console.error('runTests: index not loaded'); return; }

  const FIXTURES = [
    // ── Exact / near-exact white ───────────────────────────────────────
    {
      desc: 'T01 — 1ct D VS1 round (Messi primary)',
      q: { carat: 1.0, shape: 'round', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' },
      expectMatch: ['exact'],
    },
    {
      desc: 'T02 — 1ct D VS1 oval (Messi primary)',
      q: { carat: 1.0, shape: 'oval', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' },
      expectMatch: ['exact'],
    },
    {
      desc: 'T03 — 2ct D VS1 marquise (primary ladder)',
      q: { carat: 2.0, shape: 'marquise', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' },
      expectMatch: ['exact'],
    },
    {
      desc: 'T04 — 3ct D VS1 princess (Messi primary)',
      q: { carat: 3.0, shape: 'princess', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' },
      expectMatch: ['exact'],
    },
    // ── Nearest white — color offset ──────────────────────────────────
    {
      desc: 'T05 — 2ct H VS1 round (H vs D comp → color modifier)',
      q: { carat: 2.0, shape: 'round', colorFamily: 'white', whiteGrade: 'H', clarity: 'VS1' },
      expectMatch: ['exact', 'nearest'],
      note: 'Should get color modifier ×0.76 (H/D). If exact, the index has an H row.',
    },
    {
      desc: 'T06 — 2ct G VS1 round',
      q: { carat: 2.0, shape: 'round', colorFamily: 'white', whiteGrade: 'G', clarity: 'VS1' },
      expectMatch: ['exact', 'nearest'],
    },
    // ── Nearest white — size gaps ──────────────────────────────────────
    {
      desc: 'T07 — 4ct D VS1 marquise (no 4ct row in ladder → nearest from 3ct)',
      q: { carat: 4.0, shape: 'marquise', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' },
      expectMatch: ['nearest', 'best_available'],
      note: 'caratDist = 1ct → score = 4.0 (just under threshold=5.0). Should pass.',
    },
    {
      desc: 'T08 — 4.5ct D VS1 marquise',
      q: { carat: 4.5, shape: 'marquise', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' },
      expectMatch: ['nearest', 'best_available'],
      note: 'caratDist = 1.5ct from 3ct row → score = 6.0 → may exceed threshold → best_available.',
    },
    {
      desc: 'T09 — 6ct D VS1 oval (only 5ct rows in index)',
      q: { carat: 6.0, shape: 'oval', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' },
      expectMatch: ['exact', 'nearest', 'best_available'],
      note: 'Index has 6ct oval row (Messi $1,500 VS1). Should be exact.',
    },
    // ── Cross-shape nearest ────────────────────────────────────────────
    {
      desc: 'T10 — 2ct D VS1 cushion_brilliant (normalizes to cushion)',
      q: { carat: 2.0, shape: 'cushion_brilliant', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' },
      expectMatch: ['exact'],
      note: 'cushion_brilliant → cushion in SHAPE_NORMALIZE. Should hit Messi cushion row.',
    },
    // ── Specialty shapes — expect none ────────────────────────────────
    {
      desc: 'T11 — 2ct D VS1 portuguese (has real index rows → exact/nearest)',
      q: { carat: 2.0, shape: 'portuguese', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' },
      expectMatch: ['exact', 'nearest'],
      note: 'SPECIALTY_SHAPE_KEYS only skips best_available; real portuguese rows in index return exact/nearest.',
    },
    {
      desc: 'T12 — 2ct D VS1 moval (has real index rows → exact/nearest)',
      q: { carat: 2.0, shape: 'moval', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' },
      expectMatch: ['exact', 'nearest'],
      note: 'OM GEMS moval ladder 1-3ct exists in index.',
    },
    // ── Fancy color ────────────────────────────────────────────────────
    {
      desc: 'T13 — 2ct Fancy Vivid Pink VS1 heart',
      q: { carat: 2.0, shape: 'heart', colorFamily: 'fancy', colorFamily_key: 'pink_fv', clarity: 'VS1' },
      expectMatch: ['exact', 'nearest'],
    },
    {
      desc: 'T14 — 1ct Fancy Intense Pink VS1 pear',
      q: { carat: 1.0, shape: 'pear', colorFamily: 'fancy', colorFamily_key: 'pink_fi', clarity: 'VS1' },
      expectMatch: ['nearest', 'best_available'],
      note: 'Only one pear pink row in index (1.55ct). Should get nearest + carat modifier.',
    },
    {
      desc: 'T15 — 1ct Fancy Vivid Orange VS1 oval (no orange rows in index → none)',
      q: { carat: 1.0, shape: 'oval', colorFamily: 'fancy', colorFamily_key: 'orange_fv', clarity: 'VS1' },
      expectMatch: ['none'],
      note: 'fancyColorCompatible must reject non-orange comps. Fixed: added orange check.',
    },
    // ── Edge cases ─────────────────────────────────────────────────────
    {
      desc: 'T16 — 0.5ct D VS1 round (small stone)',
      q: { carat: 0.5, shape: 'round', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' },
      expectMatch: ['exact'],
    },
    {
      desc: 'T17 — 2ct D VVS1 oval (VVS1 premium row)',
      q: { carat: 2.0, shape: 'oval', colorFamily: 'white', whiteGrade: 'D', clarity: 'VVS1' },
      expectMatch: ['exact'],
    },
    {
      desc: 'T18 — 1ct E VS1 oval (index has E-color oval rows → exact)',
      q: { carat: 1.0, shape: 'oval', colorFamily: 'white', whiteGrade: 'E', clarity: 'VS1' },
      expectMatch: ['exact', 'nearest'],
      note: 'Starsgem/Mishang oval ladders include explicit E rows; exact match is correct.',
    },
    {
      desc: 'T19 — 3.5ct D VS1 oval (between 3ct and 4ct rows)',
      q: { carat: 3.5, shape: 'oval', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' },
      expectMatch: ['nearest'],
      note: 'caratDist = 0.5ct from 3ct → score 2.0. Should be nearest; modifier applies caratMult.',
    },
    {
      desc: 'T20 — 5ct D VS2 marquise (large + off-clarity)',
      q: { carat: 5.0, shape: 'marquise', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS2' },
      expectMatch: ['nearest', 'best_available'],
      note: 'Check if 3ct D VS2 marquise row exists. caratDist = 2ct → score = 8.0 > threshold → best_available.',
    },
  ];

  let passed = 0, failed = 0;
  console.log(`\n${'='.repeat(70)}`);
  console.log('ALIBABA COMP ENGINE — TEST RUN');
  console.log(`${'='.repeat(70)}\n`);

  for (const fx of FIXTURES) {
    let result;
    try {
      result = resolveAlibabaComp(fx.q);
    } catch (e) {
      console.error(`  [ERROR] ${fx.desc}\n    ${e.message}`);
      failed++;
      continue;
    }

    const mt = result.matchType;
    const ok = fx.expectMatch.includes(mt);
    const status = ok ? 'PASS' : 'FAIL';
    if (ok) passed++; else failed++;

    const p = result.primary;
    const modParts = p?.modifiers?.parts?.join(' | ') || '—';
    const listPrice = p?.listingPrice != null ? `$${p.listingPrice}` : '—';
    const estPrice  = p?.estimatedPrice != null ? `→ $${p.estimatedPrice}` : '';
    const compLabel = p?.row
      ? `${p.row.carat}ct ${p.row.colorNormalized || p.row.color || '?'} ${p.row.clarity || '?'} ${p.row.shape}`
      : '—';

    console.log(`[${status}] ${fx.desc}`);
    console.log(`        matchType: ${mt}   (expected: ${fx.expectMatch.join('|')})`);
    console.log(`        comp:      ${compLabel}`);
    console.log(`        price:     ${listPrice} ${estPrice}`);
    if (modParts !== '—') console.log(`        modifiers: ${modParts}`);
    if (!ok && fx.note) console.log(`        NOTE:      ${fx.note}`);
    if (!ok && !fx.note) console.log(`        ← FIX NEEDED`);
    console.log();
  }

  console.log(`${'='.repeat(70)}`);
  console.log(`Results: ${passed} passed, ${failed} failed of ${FIXTURES.length} total`);
  console.log(`${'='.repeat(70)}\n`);
}

// ══════════════════════════════════════════════════════════════════════════
// EXPORTS — works as ES module in browser or Node.js
// ══════════════════════════════════════════════════════════════════════════
export {
  // Pipeline
  loadIndex,
  resolveAlibabaComp,
  runTests,

  // Individual stages (useful for debugging a specific step)
  normalizeShapeForComp,
  filterCandidates,
  scoreCandidate,
  findExactComp,
  findNearestComps,
  findAbsoluteBestComps,
  applyWhiteModifiers,
  applyFancyModifiers,
  fancyIntensityMult,
  inferFancyFamilyKey,

  // Reference data (in case you want to inspect or override)
  CLARITY_RANK_NUM,
  WHITE_COLOR_GRADE_NUM,
  WHITE_GRADE_MULT,
  CLARITY_CARAT_MULTS_W,
  CLARITY_MULT_COLOR,
  SHAPE_MULT_WHITE,
  SHAPE_MULT_COLOR,
  FANCY_COLOR_BASE,
  FANCY_LABEL_MAP,
  NEAREST_THRESHOLD,
  SPECIALTY_SHAPE_KEYS,
};
