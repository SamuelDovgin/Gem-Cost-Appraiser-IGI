/**
 * comp-engine-v3.js — Alibaba Comp Engine, Version 3
 * ─────────────────────────────────────────────────────────────────────────────
 * Implements the v3 adjusted-comps model from research/comp-engine-v3-proposal.md.
 *
 * Key changes from v2:
 *  1. Log-space pricing: all adjustments are additive in log($/ct) space.
 *  2. Multi-comp ensemble with inverse-variance weighting and outlier rejection.
 *  3. RMSE-style compErrorScore replacing the linear scoreCandidate.
 *  4. Uncertainty ranges (low/high 80% interval) derived from log-space sigma.
 *  5. Fancy color: separates hue, intensity, and modifier terms properly.
 *  6. Source de-duplication with per-productId weight cap.
 *
 * Usage (Node.js):
 *   node --input-type=module << 'EOF'
 *   import { loadIndex, resolveAlibabaComp, runTests } from './research/comp-engine-v3.js';
 *   await loadIndex('./research/data/alibaba-comps-index.json');
 *   runTests();
 *   EOF
 *
 * Usage (browser console, http-server on port 8765):
 *   const m = await import('/research/comp-engine-v3.js');
 *   await m.loadIndex();
 *   console.log(m.resolveAlibabaComp({ carat:3.8, shape:'radiant', colorFamily:'fancy', colorFamily_key:'pink_fv', clarity:'VVS2' }));
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SECTIONS (Ctrl+F to jump):
 *   §1  REFERENCE DATA
 *   §2  FANCY COLOR PARSING
 *   §3  SHAPE FAMILIES & DISTANCE
 *   §4  NORMALIZATION
 *   §5  CANDIDATE FILTERING
 *   §6  ERROR SCORE
 *   §7  LOG-SPACE ADJUSTMENT (adjustCompToQuery)
 *   §8  ENSEMBLE BLEND (blendComps)
 *   §9  RESOLVE — full v3 pipeline
 *   §10 INDEX LOADER
 *   §11 TEST SUITE
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ══════════════════════════════════════════════════════════════════════════════
// §1  REFERENCE DATA
// ══════════════════════════════════════════════════════════════════════════════

// --- Clarity ordinal ranks (lower = better) ---
const CLARITY_RANK_NUM = { IF: -1, VVS1: 0, VVS2: 1, 'VVS-VS': 1.5, VS1: 2, VS2: 3, SI1: 4, SI2: 5 };

// --- White color grade ordinal ranks (lower = better) ---
const WHITE_COLOR_GRADE_NUM = { D: 0, DE: 0.5, DEF: 1, E: 1, F: 2, G: 3, H: 4, I: 5, J: 6, K: 7, L: 8 };

// --- White color multipliers (vs E = 1.00 baseline) ---
const WHITE_GRADE_MULT = {
  D: 1.08, E: 1.00, F: 0.92, G: 0.88, H: 0.82, I: 0.71, J: 0.60,
  K: 0.50, L: 0.42, M: 0.35, 'N-P': 0.28, 'Q-R': 0.21, 'S-Z': 0.16,
};

// --- Clarity multipliers (white diamonds), carat-interpolated ---
const CLARITY_CARAT_KNOTS_W = [0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 7.0, 10.0];
const CLARITY_CARAT_MULTS_W = {
  IF:   [1.14, 1.18, 1.22, 1.28, 1.42, 1.50, 1.58, 1.68, 1.88],
  VVS1: [1.10, 1.14, 1.16, 1.20, 1.36, 1.44, 1.52, 1.62, 1.78],
  VVS2: [1.05, 1.08, 1.09, 1.12, 1.14, 1.16, 1.18, 1.21, 1.24],
  VS1:  [1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00],
  VS2:  [0.92, 0.88, 0.87, 0.86, 0.84, 0.82, 0.80, 0.76, 0.70],
  SI1:  [0.84, 0.72, 0.60, 0.44, 0.38, 0.34, 0.30, 0.26, 0.22],
  SI2:  [0.72, 0.58, 0.46, 0.34, 0.28, 0.24, 0.20, 0.16, 0.12],
};

// --- Clarity multipliers (fancy color): compressed because saturation masks inclusions ---
const CLARITY_MULT_COLOR = { IF: 1.12, VVS1: 1.08, VVS2: 1.04, VS1: 1.00, VS2: 0.95, SI1: 0.89, SI2: 0.77 };

// --- Shape multipliers (white diamond), vs round = 1.00 ---
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

// --- Shape multipliers (fancy color), vs cushion = 1.00 ---
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

// --- Fancy color base pricing (ws1 = $/ct at 1ct; scale = carat exponent) ---
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

// --- Legacy fancy label → key mapping (used as fallback for comp rows that use label strings) ---
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
  'fancy intense green': 'green_fi', 'fancy vivid green': 'green_fv',
  'fancy intense greyish green': 'green_fi', 'fancy green': 'green_f',
  'fancy red': 'red_f',
  // Brownish and modifier variants — NOTE: modifier penalty applied separately, not via key remapping
  'fancy intense brownish pink': 'pink_fi',
  'brownish pink': 'pink_f',
  'fancy vivid orange': 'orange_fv',
  'fancy intense orange': 'orange_fi',
  'fancy orange': 'orange_f',
};

/**
 * supplierKey — extract a normalized supplier identifier from a comp row.
 * Used to prevent one supplier from filling all ensemble slots.
 */
function supplierKey(row) {
  const section = row.section || '';
  // Section strings use either ' - ' (hyphen) or ' — ' (em-dash) as the supplier separator.
  const lastHyphen = section.lastIndexOf(' - ');
  const lastEm     = section.lastIndexOf(' — ');
  const lastDash   = Math.max(lastHyphen, lastEm);
  const raw = lastDash >= 0 ? section.slice(lastDash + 3).trim() : section.split(',')[0].trim();
  const norm = raw.replace(/\s*\([^)]+\)\s*$/, '').trim().toLowerCase();
  if (norm.includes('messi') || norm.includes('wuzhou')) return 'messi';
  if (norm.includes('starsgem') || norm.includes('stargem')) return 'starsgem';
  if (norm.includes('mishang')) return 'mishang';
  if (norm.includes('goldleaf')) return 'goldleaf';
  return norm || '_unknown';
}

// Maximum rows any single supplier can contribute to the ensemble.
const MAX_PER_SUPPLIER = 2;

/**
 * applySupplierCap — limit each supplier to at most MAX_PER_SUPPLIER rows.
 * Called on the deduplicated, sorted candidate list before ensemble selection.
 * Rows are already sorted best-first, so we keep the highest-quality rows per supplier.
 */
function applySupplierCap(scored) {
  const counts = {};
  const result = [];
  for (const c of scored) {
    const sk = supplierKey(c.row);
    const n = (counts[sk] || 0) + 1;
    counts[sk] = n;
    if (n <= MAX_PER_SUPPLIER) result.push(c);
  }
  return result;
}

/**
 * buildOtherFactoryExactList — same-spec exact rows from suppliers other than the
 * floor (cheapest) supplier. Shown separately; never blended into the estimate.
 */
function buildOtherFactoryExactList(exactScored, floorSupplierKey) {
  return exactScored
    .filter(c => supplierKey(c.row) !== floorSupplierKey)
    .sort((a, b) => a.row.priceUsd - b.row.priceUsd || a.row.carat - b.row.carat)
    .map(c => ({
      row: c.row,
      listingPrice: c.row.priceUsd,
      url: c.row.url,
      label: shortLabel(c.row),
      supplierKey: supplierKey(c.row),
    }));
}

/**
 * selectCheapestExactEnsemble — price-sorted exact comps for blend/anchor only.
 */
function selectCheapestExactEnsemble(exactScored, maxN = MAX_ENSEMBLE) {
  return [...exactScored]
    .sort((a, b) => a.row.priceUsd - b.row.priceUsd || a.score - b.score)
    .slice(0, maxN);
}

// Specialty shapes that skip the best_available fallback (no cross-shape comp makes sense)
const SPECIALTY_SHAPE_KEYS = new Set([
  'moval', 'trilliant', 'half_moon', 'shield', 'hexagonal', 'hexagonal_dutch',
  'old_european', 'old_mine', 'rose', 'briolette', 'portuguese', 'flanders',
  'baguette', 'tapered_baguette', 'carre',
]);

// --- Log-space sigma defaults per axis ---
const AXIS_SIGMA = {
  caratPerLogUnit:          0.12,   // per |log(queryCt/compCt)|
  caratLargeExtrapolation:  0.28,   // additional per log unit beyond 0.5 (heavy-tail penalty)
  whiteColorPerStep:        0.07,   // per white grade ordinal step
  fancyIntensityPerLevel:   0.25,   // per intensity level gap (light→fancy→intense→vivid)
  fancyModifierPerTerm:     0.12,   // per modifier term (brownish, greyish, etc.)
  clarityWhitePerStep:      0.06,   // per clarity ordinal step (white)
  clarityFancyPerStep:      0.04,   // per clarity ordinal step (fancy color, compressed)
  shapeSame:                0.05,   // same shape
  shapeFamily:              0.12,   // same shape family (e.g., cushion ↔ cushion_brilliant)
  shapeAdjacent:            0.20,   // adjacent families (e.g., cushion ↔ radiant)
  shapeCross:               0.40,   // cross-family (e.g., round ↔ marquise) — increased to reflect real transfer risk
  sourceHigh:               0.03,
  sourceMediumHigh:         0.06,
  sourceMedium:             0.10,
  sourceLowMedium:          0.18,
  sourceLow:                0.25,
  caratBand:                0.05,
  clarityBand:              0.08,
};

// ── Interval calibration ──────────────────────────────────────────────────────
// Current P80 coverage is ~20% (white) and ~30% (fancy) vs the ≥60% target.
// These constants widen intervals toward more honest uncertainty representation
// and are labeled as uncalibrated until a proper empirical pass is done.
//
// Irreducible model uncertainty added in quadrature to the pooled blend sigma.
const SIGMA_SYSTEMATIC_FLOOR = 0.10;
// Empirical multiplier applied to the final sigma before computing low/high.
const SIGMA_CALIBRATION_FACTOR = 2.0;

// ── Supplier blend weight cap ─────────────────────────────────────────────────
// Maximum fraction of total blend weight any single supplier can contribute.
// This prevents a single supplier from dominating the blended estimate even
// when its comps happen to have lower per-axis sigma (i.e. are scored as better).
const MAX_SUPPLIER_WEIGHT_FRAC = 0.65;

// ── Carat threshold magic weights ────────────────────────────────────────────
// Market premium effects occur at these carat breakpoints (buyers prefer round numbers).
const CARAT_THRESHOLDS = [0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0];
function nearCaratThreshold(ct, tol = 0.05) {
  return CARAT_THRESHOLDS.some(t => Math.abs(ct - t) <= tol);
}

// Maximum compErrorScore to include a comp in the ensemble.
// Roughly: 0.60 log-error = expected ±60% log uncertainty BEFORE blending.
const SCORE_HARD_CUTOFF = 0.60;

// Maximum candidates in ensemble
const MAX_ENSEMBLE = 5;

// ══════════════════════════════════════════════════════════════════════════════
// §2  FANCY COLOR PARSING
// ══════════════════════════════════════════════════════════════════════════════

// Modifier terms and their log-price discount (negative = discount, meaning the
// stone is worth less than a clean stone of the same intensity).
const MODIFIER_TERMS = ['brownish', 'greyish', 'grayish', 'orangy', 'purplish', 'yellowish', 'pinkish', 'bluish'];
const MODIFIER_LOG_DELTA = {
  brownish:  Math.log(0.82),   // ~−20%
  greyish:   Math.log(0.87),   // ~−14%
  grayish:   Math.log(0.87),
  orangy:    Math.log(0.90),   // ~−10%
  purplish:  Math.log(0.88),   // ~−12%
  yellowish: Math.log(0.91),   // ~−9%
  pinkish:   Math.log(0.93),   // ~−7%
  bluish:    Math.log(0.93),
};

const INTENSITY_RANK = { fl: 0, f: 1, fi: 2, fv: 3 };

/**
 * parseFancyColorLabel — extract hue, intensity, and modifier terms from a
 * color string like "Fancy Intense Brownish Pink" or the key "pink_fv".
 *
 * Works on both full label strings (from comp row color field) and
 * colorFamily_key strings (e.g. "pink_fv").
 */
function parseFancyColorLabel(label) {
  if (!label) return { hue: null, intensityKey: null, modifierTerms: [], colorKey: null };
  const s = label.toLowerCase().trim();

  // Fast path: detect compact key format like "pink_fv", "yellow_fi", "blue_fl"
  // Must check before full-text parsing since compact keys don't contain 'vivid'/'intense' etc.
  const compactMatch = s.match(/^([a-z]+)_(fl|fi|fv|f)$/);
  if (compactMatch) {
    const hue = compactMatch[1];
    const intensityKey = compactMatch[2];
    const colorKey = `${hue}_${intensityKey}`;
    return {
      hue,
      intensityKey,
      modifierTerms: [],
      colorKey: FANCY_COLOR_BASE[colorKey] ? colorKey : null,
    };
  }

  const modifierTerms = MODIFIER_TERMS.filter(m => s.includes(m));

  // Hue detection — order matters: check 'red' after 'brownish' to avoid false match
  let hue = null;
  if (s.includes('pink'))                       hue = 'pink';
  else if (s.includes('yellow'))                hue = 'yellow';
  else if (s.includes('blue'))                  hue = 'blue';
  else if (s.includes('green'))                 hue = 'green';
  else if (s.includes('orange'))                hue = 'orange';
  else if (s.includes('purple') || s.includes('violet')) hue = 'purple';
  else if (s.includes('red'))                   hue = 'red';
  else if (s.includes('brown') || s.includes('champagne')) hue = 'brown';
  else if (s.includes('black'))                 hue = 'black';

  // Intensity detection
  let intensityKey = 'f';
  if (s.includes('vivid'))        intensityKey = 'fv';
  else if (s.includes('intense')) intensityKey = 'fi';
  else if (s.includes('light'))   intensityKey = 'fl';
  // 'fancy' alone → 'f' (already default)

  const colorKey = hue ? (`${hue}_${intensityKey}` in FANCY_COLOR_BASE ? `${hue}_${intensityKey}` : null) : null;

  return { hue, intensityKey, modifierTerms, colorKey };
}

/**
 * inferFancyFamilyKey — maps a color label string to a FANCY_COLOR_BASE key.
 * Returns null if unmapped.
 */
function inferFancyFamilyKey(colorLabel) {
  if (!colorLabel) return null;
  const cl = colorLabel.toLowerCase().trim();
  // Try legacy map first (exact phrases)
  if (FANCY_LABEL_MAP[cl]) return FANCY_LABEL_MAP[cl];
  // Fall through to parsed key
  const { colorKey } = parseFancyColorLabel(colorLabel);
  return colorKey && FANCY_COLOR_BASE[colorKey] ? colorKey : null;
}

// ══════════════════════════════════════════════════════════════════════════════
// §2.5  LOCAL CARAT CURVE ESTIMATION
// ══════════════════════════════════════════════════════════════════════════════

/**
 * fitLocalCaratSlope — OLS fit of log(price/ct) vs log(ct) from the candidate pool.
 *
 * The result is the "per-ct exponent": if price ∝ ct^n then slope = n − 1.
 * White diamond prior is slope = 0.8 (total exponent 1.8).
 *
 * Fits normalized, bin-level knots so dense supplier ladders do not dominate.
 * Shrinks the resulting slope toward the prior using pseudo-observation weight.
 * Only fits when there are ≥ 3 unique carat bins spanning ≥ 1.0 ct.
 *
 * @param {Array}  candidates — pre-filtered comp rows (same colorFamily, hue, etc.)
 * @param {object} query      — normalized query (shape, clarity, colorFamily, carat)
 * @param {number} prior      — prior slope (default 0.8 for white, 0.5 for fancy)
 * @returns {{ slope, n, confidence, caratRange, caratMin, caratMax,
 *             queryIsExtrapolated } | null}
 */
const MIN_FIT_KNOTS  = 3;
const MIN_CARAT_RANGE = 1.0;
const SLOPE_PRIOR_WEIGHT = 3;  // pseudo-observations toward the prior slope

function weightedMedian(values, weights) {
  const pairs = values.map((v, i) => ({ v, w: weights[i] ?? 1 }))
    .filter(p => Number.isFinite(p.v) && p.w > 0)
    .sort((a, b) => a.v - b.v);
  if (!pairs.length) return null;
  const total = pairs.reduce((s, p) => s + p.w, 0);
  let acc = 0;
  for (const p of pairs) {
    acc += p.w;
    if (acc >= total / 2) return p.v;
  }
  return pairs[pairs.length - 1].v;
}

function normalizedLogDpcForCurve(row, query) {
  let y = Math.log(row.priceUsd / row.carat);

  if (query.colorFamily === 'white') {
    const cn = row.colorNormalized || 'D';
    const compGrade = (cn === 'DEF' || cn === 'DE') ? 'E' : cn;
    const qColor = WHITE_GRADE_MULT[query.whiteGrade] ?? WHITE_GRADE_MULT.E;
    const cColor = WHITE_GRADE_MULT[compGrade] ?? WHITE_GRADE_MULT.D;
    y += Math.log(qColor / Math.max(cColor, 0.01));

    const qClarity = getClarityMult(query.clarity, row.carat);
    const cClarity = getClarityMult(row.clarity || 'VS1', row.carat);
    y += Math.log(qClarity / Math.max(cClarity, 0.01));

    const qShape = SHAPE_MULT_WHITE[query.shape] ?? 1.0;
    const cShape = SHAPE_MULT_WHITE[row.shape] ?? 1.0;
    y += Math.log(qShape / Math.max(cShape, 0.01));
  } else {
    const qShape = SHAPE_MULT_COLOR[query.shape] ?? 1.0;
    const cShape = SHAPE_MULT_COLOR[row.shape] ?? 1.0;
    y += Math.log(qShape / Math.max(cShape, 0.01));
  }

  return y;
}

function fitLocalCaratSlope(candidates, query, prior = 0.8) {
  if (!candidates || !candidates.length) return null;

  const clarityRankQ = CLARITY_RANK_NUM[query.clarity] ?? 2;

  // Only use same-shape-family, concrete (non-band) rows within ±2 clarity steps.
  const pool = candidates.filter(row => {
    if (row.caratBand || row.clarityBand) return false;
    if (!row.carat || !row.priceUsd || row.carat <= 0 || row.priceUsd <= 0) return false;
    if (shapeDistance(query.shape, row.shape) > 1) return false;
    const clarityRankC = CLARITY_RANK_NUM[row.clarity] ?? 2;
    if (Math.abs(clarityRankQ - clarityRankC) > 2) return false;
    return true;
  });

  const byBin = new Map();
  for (const row of pool) {
    const bin = Math.round(row.carat * 4) / 4;
    if (!byBin.has(bin)) byBin.set(bin, []);
    byBin.get(bin).push(row);
  }
  if (byBin.size < MIN_FIT_KNOTS) return null;

  const points = [];
  const sourceSet = new Set();
  for (const [bin, rows] of byBin.entries()) {
    const values = [];
    const weights = [];
    for (const row of rows) {
      const y = normalizedLogDpcForCurve(row, query);
      if (!Number.isFinite(y)) continue;
      values.push(y);
      weights.push(Math.min(row.count || 1, 4));
      sourceSet.add(supplierKey(row));
    }
    const y = weightedMedian(values, weights);
    if (y != null) {
      points.push({
        carat: bin,
        x: Math.log(bin),
        y,
        rowCount: rows.length,
        sourceCount: new Set(rows.map(supplierKey)).size,
      });
    }
  }
  points.sort((a, b) => a.carat - b.carat);
  if (points.length < MIN_FIT_KNOTS) return null;

  const caratMin = points[0].carat;
  const caratMax = points[points.length - 1].carat;
  const caratRange = caratMax - caratMin;
  if (caratRange < MIN_CARAT_RANGE) return null;

  // Weighted OLS: log(normalized $/ct) = alpha + rawSlope * log(ct)
  const weights = points.map(p => 1 / (0.25 + Math.abs(Math.log(query.carat / p.carat))));
  const totalW = weights.reduce((a, b) => a + b, 0);
  const xMean = points.reduce((s, p, i) => s + p.x * weights[i], 0) / totalW;
  const yMean = points.reduce((s, p, i) => s + p.y * weights[i], 0) / totalW;
  const ssxx = points.reduce((s, p, i) => s + weights[i] * (p.x - xMean) ** 2, 0);
  const ssxy = points.reduce((s, p, i) => s + weights[i] * (p.x - xMean) * (p.y - yMean), 0);

  if (ssxx < 1e-6) return null;

  const rawSlope = ssxy / ssxx;

  // Shrink the fitted slope toward the prior using bin-level support.
  const dataN = points.length;
  const shrinkFrac = SLOPE_PRIOR_WEIGHT / (SLOPE_PRIOR_WEIGHT + dataN);
  const slope = shrinkFrac * prior + (1 - shrinkFrac) * rawSlope;

  // Clamp to a plausible range for diamond markets
  const clampedSlope = Math.max(-0.2, Math.min(2.0, slope));

  const queryIsExtrapolated = query.carat < caratMin - 0.25 || query.carat > caratMax + 0.25;
  const sourceCount = sourceSet.size;
  const confidence = dataN >= 10 && sourceCount >= 2 && caratRange >= 2.0
    ? 'high'
    : dataN >= 5 && caratRange >= 1.5
      ? 'medium'
      : 'low';

  return {
    slope: clampedSlope,
    rawSlope,
    n: dataN,
    rowCount: pool.length,
    sourceCount,
    confidence,
    caratRange,
    caratMin,
    caratMax,
    queryIsExtrapolated,
    normalized: true,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// §3  SHAPE FAMILIES & DISTANCE
// ══════════════════════════════════════════════════════════════════════════════

// Map normalized shape → family name
const SHAPE_FAMILY_MAP = {
  round: 'ROUND', old_european: 'ROUND', old_mine: 'ROUND',
  oval: 'OVAL_CUSHION', cushion: 'OVAL_CUSHION', elongated_cushion: 'OVAL_CUSHION',
  moval: 'OVAL_CUSHION', cushion_brilliant: 'OVAL_CUSHION', square_cushion: 'OVAL_CUSHION',
  radiant: 'RADIANT', sq_radiant: 'RADIANT',
  pear: 'PEAR',
  marquise: 'MARQUISE', trilliant: 'MARQUISE',
  heart: 'HEART',
  emerald: 'STEP', asscher: 'STEP',
  baguette: 'STEP_BAGUETTE', tapered_baguette: 'STEP_BAGUETTE', carre: 'STEP_BAGUETTE',
  princess: 'PRINCESS',
  // Specialty shapes → SPECIALTY (no cross-shape adjustment)
  portuguese: 'SPECIALTY', hexagonal: 'SPECIALTY', hexagonal_dutch: 'SPECIALTY',
  half_moon: 'SPECIALTY', shield: 'SPECIALTY', rose: 'SPECIALTY',
  briolette: 'SPECIALTY', flanders: 'SPECIALTY',
};

// Which family pairs are "adjacent" — can produce moderate-sigma cross-adjustments
const ADJACENT_FAMILIES = {
  ROUND:        new Set(['OVAL_CUSHION']),
  OVAL_CUSHION: new Set(['ROUND', 'RADIANT', 'STEP']),
  RADIANT:      new Set(['OVAL_CUSHION', 'PRINCESS', 'STEP']),
  PEAR:         new Set(['MARQUISE', 'OVAL_CUSHION']),
  MARQUISE:     new Set(['PEAR', 'HEART']),
  HEART:        new Set(['MARQUISE', 'PEAR']),
  STEP:         new Set(['OVAL_CUSHION', 'RADIANT', 'PRINCESS', 'STEP_BAGUETTE']),
  PRINCESS:     new Set(['RADIANT', 'STEP']),
  STEP_BAGUETTE: new Set(['STEP']),
};

/**
 * shapeDistance — returns ordinal distance between two normalized shapes:
 *   0 = same shape (or alias)
 *   1 = same family
 *   2 = adjacent family
 *   3 = cross-family or unknown
 */
function shapeDistance(userShape, compShape) {
  if (userShape === compShape) return 0;
  const fU = SHAPE_FAMILY_MAP[userShape];
  const fC = SHAPE_FAMILY_MAP[compShape];
  if (!fU || !fC || fU === 'SPECIALTY' || fC === 'SPECIALTY') return 3;
  if (fU === fC) return 1;
  if (ADJACENT_FAMILIES[fU]?.has(fC)) return 2;
  return 3;
}

function shapeSigma(userShape, compShape) {
  return [AXIS_SIGMA.shapeSame, AXIS_SIGMA.shapeFamily, AXIS_SIGMA.shapeAdjacent, AXIS_SIGMA.shapeCross][
    shapeDistance(userShape, compShape)
  ];
}

// ══════════════════════════════════════════════════════════════════════════════
// §4  NORMALIZATION
// ══════════════════════════════════════════════════════════════════════════════

const SHAPE_NORMALIZE = {
  sq_radiant: 'radiant',
  cushion_brilliant: 'cushion',
  square_cushion: 'cushion',
  trilliant: 'marquise',
  old_european: 'round',
  old_mine: 'round',
};

function normalizeShapeForComp(s) {
  return SHAPE_NORMALIZE[s] || s;
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

function shortLabel(row) {
  if (!row || !row.section) return 'Alibaba';
  const dashIdx = Math.max(row.section.lastIndexOf(' - '), row.section.lastIndexOf(' — '));
  return dashIdx >= 0 ? row.section.slice(dashIdx + 3).trim() : row.section.split(',')[0].trim();
}

function compIdentity(row) {
  if (row.productId) return `pid:${row.productId}`;
  const bits = [
    row.sourceType || row.supplier || row.label || 'comp',
    row.shape || '',
    row.color || row.colorNormalized || row.appColorKey || '',
    row.clarity || '',
    row.carat ?? '',
    row.priceUsd ?? '',
    row.section || '',
  ];
  return bits.map(v => String(v).toLowerCase().trim()).join('|');
}

function sourceErrorSigma(confidence) {
  return ({
    high: AXIS_SIGMA.sourceHigh,
    'medium-high': AXIS_SIGMA.sourceMediumHigh,
    medium: AXIS_SIGMA.sourceMedium,
    'low-medium': AXIS_SIGMA.sourceLowMedium,
    low: AXIS_SIGMA.sourceLow,
  })[confidence] ?? AXIS_SIGMA.sourceMedium;
}

// ══════════════════════════════════════════════════════════════════════════════
// §5  CANDIDATE FILTERING
// ══════════════════════════════════════════════════════════════════════════════

function whiteColorDistance(queryGrade, compColorNormalized) {
  const uR = WHITE_COLOR_GRADE_NUM[queryGrade] ?? 2;
  const cR = WHITE_COLOR_GRADE_NUM[compColorNormalized || 'D'] ?? 0;
  return Math.abs(uR - cR);
}

function fancyHueCompatible(queryKey, compColorLabel) {
  // Hard gate: do not cross hue families.
  if (!compColorLabel) return false;
  const rl = compColorLabel.toLowerCase();
  const uf = (queryKey || '').toLowerCase();
  if (uf.includes('pink')   && !rl.includes('pink'))   return false;
  if (uf.includes('yellow') && !rl.includes('yellow')) return false;
  if (uf.includes('blue')   && !rl.includes('blue'))   return false;
  if (uf.includes('green')  && !rl.includes('green'))  return false;
  if (uf.includes('orange') && !rl.includes('orange')) return false;
  if (uf.includes('red')    && !rl.includes('red'))    return false;
  if (uf.includes('purple') && !rl.includes('purple') && !rl.includes('violet')) return false;
  return true;
}

/**
 * filterCandidates — gather all rows that pass hard gates for the query.
 *
 * Hard gates (must not be crossed):
 *   - colorFamily (white vs fancy)
 *   - hue for fancy color
 *   - white color within ±5 grade steps
 *   - (In future: gemSpecies, originType, majorTreatment, certificateLab)
 *
 * Shape is NOT a hard gate — cross-shape comps get a high-sigma penalty.
 * Carat is NOT a hard gate — large carat gaps are heavily penalized in scoring.
 */
function filterCandidates(query, comps) {
  return comps.filter(row => {
    // Hard gate: color family
    if (row.colorFamily !== query.colorFamily) return false;
    // Hard gate: hue (fancy color only)
    if (query.colorFamily === 'fancy' && !fancyHueCompatible(query.colorFamily_key, row.color)) return false;
    // Soft gate: white color grade — reject > 5 steps away
    if (query.colorFamily === 'white') {
      if (whiteColorDistance(query.whiteGrade, row.colorNormalized) > 5) return false;
    }
    return true;
  });
}

/**
 * caratTolerance — maximum carat gap for an exact match.
 */
function caratTolerance(ct) {
  if (ct <= 2) return 0.08;
  if (ct <= 6) return 0.18;
  return 0.25;
}

/**
 * isExactMatch — returns true if the comp row is a direct price observation
 * for the query spec (no adjustments required beyond minor carat tolerance).
 */
function isExactMatch(query, row) {
  if (row.caratBand) return false;
  if (Math.abs(query.carat - (row.carat || 0)) > caratTolerance(row.carat)) return false;
  if (row.clarityBand) return false;
  if (row.clarity !== query.clarity) return false;
  if (shapeDistance(query.shape, row.shape) !== 0) return false;
  if (query.colorFamily === 'white') {
    const cn = row.colorNormalized || 'D';
    if (cn === 'D' || cn === null) return query.whiteGrade === 'D';
    if (cn === 'E')                return query.whiteGrade === 'E';
    if (cn === 'F')                return query.whiteGrade === 'F';
    if (cn === 'DE')               return query.whiteGrade === 'D' || query.whiteGrade === 'E';
    if (cn === 'DEF')              return ['D', 'E', 'F'].includes(query.whiteGrade);
    return false;
  }
  // Fancy: hue already matched above; same-shape/same-clarity/near-carat is exact.
  return true;
}

// ══════════════════════════════════════════════════════════════════════════════
// §6  ERROR SCORE
// ══════════════════════════════════════════════════════════════════════════════

/**
 * compErrorScore — estimated log-space prediction error if we adjust this comp
 * to the query. Lower = better comp.
 *
 * Uses RMSE combination of per-axis error sigmas:
 *   total = sqrt(ε_carat² + ε_color² + ε_clarity² + ε_shape² + ε_source² + ε_band²)
 *
 * The result is in log-price units: 0.10 ≈ 10% log error; 0.30 ≈ 30% error.
 */
function compErrorScore(query, row) {
  const compCt = row.carat || 1;

  // Carat: linear base + extra penalty beyond 0.5 log units (heavy-tail extrapolation)
  const logCaratRatio = Math.abs(Math.log(query.carat / compCt));
  const eCarat = logCaratRatio * AXIS_SIGMA.caratPerLogUnit +
                 Math.max(0, logCaratRatio - 0.5) * AXIS_SIGMA.caratLargeExtrapolation;

  // Color / intensity
  let eColor;
  if (query.colorFamily === 'white') {
    const steps = whiteColorDistance(query.whiteGrade, row.colorNormalized);
    eColor = steps * AXIS_SIGMA.whiteColorPerStep;
  } else {
    const userParsed = parseFancyColorLabel(query.colorFamily_key || '');
    const compParsed = parseFancyColorLabel(row.color || '');
    const uInt = INTENSITY_RANK[userParsed.intensityKey] ?? 1;
    const cInt = INTENSITY_RANK[compParsed.intensityKey] ?? 1;
    const intensityGap = Math.abs(uInt - cInt);
    const modifierDiff = Math.abs(compParsed.modifierTerms.length - userParsed.modifierTerms.length);
    eColor = intensityGap * AXIS_SIGMA.fancyIntensityPerLevel + modifierDiff * AXIS_SIGMA.fancyModifierPerTerm;
  }

  // Clarity
  const clarU = CLARITY_RANK_NUM[query.clarity] ?? 2;
  const clarC = CLARITY_RANK_NUM[row.clarity] ?? 2;
  const clarityGap = Math.abs(clarU - clarC);
  const clarPerStep = query.colorFamily === 'white'
    ? AXIS_SIGMA.clarityWhitePerStep
    : AXIS_SIGMA.clarityFancyPerStep;
  const eClarity = clarityGap * clarPerStep;

  // Shape
  const eShape = shapeSigma(query.shape, row.shape);

  // Source confidence
  const eSource = sourceErrorSigma(row.confidence);

  // Data quality bands
  const eBand = (row.caratBand ? AXIS_SIGMA.caratBand : 0) +
                (row.clarityBand ? AXIS_SIGMA.clarityBand : 0);

  const total = Math.sqrt(eCarat**2 + eColor**2 + eClarity**2 + eShape**2 + eSource**2 + eBand**2);
  return { total, eCarat, eColor, eClarity, eShape, eSource, eBand };
}

// ══════════════════════════════════════════════════════════════════════════════
// §7  LOG-SPACE ADJUSTMENT
// ══════════════════════════════════════════════════════════════════════════════

/**
 * adjustCompToQuery — compute log-space estimate of query price from a single comp row.
 *
 * All adjustments are additive in log($/ct) space:
 *   logDpc_query = logDpc_comp + deltaColor + deltaClarity + deltaShape
 *
 * For white diamonds:
 *   deltaColor = log(WHITE_GRADE_MULT[user] / WHITE_GRADE_MULT[comp])
 *   deltaCarat = 0.8 * log(queryCt / compCt)   ← in per-ct space
 *   logDpc_query = logDpc_comp + deltaCarat + deltaColor + deltaClarity + deltaShape
 *
 * For fancy diamonds:
 *   delta_intensity+carat =
 *     log(ub.ws1 * queryCt^(ub.scale−1)) − log(cb.ws1 * compCt^(cb.scale−1))
 *   logDpc_query = logDpc_comp + delta_intensity+carat + deltaModifier + deltaClarity + deltaShape
 *
 * Returns: { logEstimate, sigmaLog, estimatedPrice, parts }
 *   - logEstimate: log(estimated total price) for the query
 *   - sigmaLog: estimated log-space standard deviation
 *   - estimatedPrice: exp(logEstimate), rounded
 *   - parts: human-readable adjustment explanations
 *
 * @param {object} context — optional { localCaratSlope } for data-driven carat scaling
 */
function adjustCompToQuery(query, row, context = {}) {
  const compCt = row.carat || 1;
  const queryCt = query.carat;
  const logDpcComp = Math.log(row.priceUsd / compCt);

  const parts = [];
  let logDpcAdj = logDpcComp;
  let sigmaCarat, sigmaColor, sigmaClarity, sigmaShape;

  const logCaratRatio = Math.log(queryCt / compCt);
  const absLogCaratRatio = Math.abs(logCaratRatio);

  if (query.colorFamily === 'white') {
    // ── White: separate carat slope + color grade ──────────────────────────
    // Use data-driven local slope when available; fall back to prior 0.8.
    const caratSlope = context.localCaratSlope ?? 0.8;
    const deltaCarat = caratSlope * logCaratRatio;
    // Extra sigma when local slope deviates from prior (slope uncertainty).
    const slopeSigmaBoost = context.localCaratSlope != null
      ? Math.abs(context.localCaratSlope - 0.8) * 0.10
      : 0;
    const curveExtrapolationBoost = context.localCaratExtrapolated ? 0.08 : 0;
    sigmaCarat = absLogCaratRatio * AXIS_SIGMA.caratPerLogUnit +
                 Math.max(0, absLogCaratRatio - 0.5) * AXIS_SIGMA.caratLargeExtrapolation +
                 slopeSigmaBoost +
                 curveExtrapolationBoost;
    logDpcAdj += deltaCarat;
    const slopeNote = context.localCaratSlope != null ? ` slope=${caratSlope.toFixed(2)}` : '';
    if (Math.abs(deltaCarat) > 0.015)
      parts.push(`carat ×${Math.exp(deltaCarat).toFixed(2)} (${queryCt}ct vs ${compCt}ct${slopeNote})`);

    const cn = row.colorNormalized || 'D';
    const compGrade = (cn === 'DEF' || cn === 'DE') ? 'E' : cn;
    const uMult = WHITE_GRADE_MULT[query.whiteGrade] ?? 0.70;
    const cMult = WHITE_GRADE_MULT[compGrade] ?? WHITE_GRADE_MULT.D;
    const deltaColor = Math.log(uMult / cMult);
    const gradeSteps = whiteColorDistance(query.whiteGrade, cn);
    sigmaColor = gradeSteps * AXIS_SIGMA.whiteColorPerStep;
    logDpcAdj += deltaColor;
    if (Math.abs(deltaColor) > 0.015)
      parts.push(`color ×${Math.exp(deltaColor).toFixed(2)} (${query.whiteGrade} vs ${cn})`);

  } else {
    // ── Fancy: combined intensity+carat model delta ────────────────────────
    const ub = FANCY_COLOR_BASE[query.colorFamily_key];
    const compKey = inferFancyFamilyKey(row.color);
    const cb = compKey ? FANCY_COLOR_BASE[compKey] : null;

    if (ub && cb) {
      // Model-based combined delta: evaluates each family at its OWN carat
      const logModelQ = Math.log(ub.ws1) + (ub.scale - 1) * Math.log(queryCt);
      const logModelC = Math.log(cb.ws1) + (cb.scale - 1) * Math.log(compCt);
      const deltaIntensityCarat = logModelQ - logModelC;
      logDpcAdj += deltaIntensityCarat;
      if (Math.abs(deltaIntensityCarat) > 0.015)
        parts.push(`intensity+carat ×${Math.exp(deltaIntensityCarat).toFixed(2)} (${query.colorFamily_key} vs ${compKey})`);
    } else {
      // Can't model comp color — fallback to carat-only slope
      const delta = 0.5 * logCaratRatio; // fancy carat slope prior
      logDpcAdj += delta;
      if (Math.abs(delta) > 0.015)
        parts.push(`carat ×${Math.exp(delta).toFixed(2)} (${queryCt}ct vs ${compCt}ct, model unknown)`);
    }

    // Modifier adjustment: comp modifiers vs query modifiers
    const userParsed = parseFancyColorLabel(query.colorFamily_key || '');
    const compParsed = parseFancyColorLabel(row.color || '');
    let deltaModifier = 0;
    // Comp has modifier that query doesn't → comp is discounted → adjust up
    for (const m of compParsed.modifierTerms) {
      if (!userParsed.modifierTerms.includes(m)) {
        deltaModifier -= (MODIFIER_LOG_DELTA[m] || 0);
      }
    }
    // Query has modifier that comp doesn't → query should be discounted → adjust down
    for (const m of userParsed.modifierTerms) {
      if (!compParsed.modifierTerms.includes(m)) {
        deltaModifier += (MODIFIER_LOG_DELTA[m] || 0);
      }
    }
    if (Math.abs(deltaModifier) > 0.015)
      parts.push(`modifier ×${Math.exp(deltaModifier).toFixed(2)}`);
    logDpcAdj += deltaModifier;

    // Compute color sigma from intensity/modifier gaps
    const uInt = INTENSITY_RANK[userParsed.intensityKey ?? 'f'] ?? 1;
    const cIntParsed = parseFancyColorLabel(row.color || '');
    const cInt = INTENSITY_RANK[cIntParsed.intensityKey ?? 'f'] ?? 1;
    const intensityGap = Math.abs(uInt - cInt);
    const modDiff = Math.abs(compParsed.modifierTerms.length - userParsed.modifierTerms.length);
    sigmaColor = intensityGap * AXIS_SIGMA.fancyIntensityPerLevel + modDiff * AXIS_SIGMA.fancyModifierPerTerm;
    // Apply large-extrapolation penalty for fancy carat gaps too.
    sigmaCarat = absLogCaratRatio * AXIS_SIGMA.caratPerLogUnit +
                 Math.max(0, absLogCaratRatio - 0.5) * AXIS_SIGMA.caratLargeExtrapolation;
  }

  // ── Clarity adjustment ────────────────────────────────────────────────────
  let deltaClarity;
  if (query.colorFamily === 'white') {
    const clarU = getClarityMult(query.clarity, queryCt);
    const clarC = getClarityMult(row.clarity || 'VS1', queryCt);
    deltaClarity = Math.log(clarU / Math.max(clarC, 0.01));
  } else {
    const clarU = CLARITY_MULT_COLOR[query.clarity] ?? 1;
    const clarC = CLARITY_MULT_COLOR[row.clarity] ?? 1;
    deltaClarity = Math.log(clarU / Math.max(clarC, 0.01));
  }
  if (Math.abs(deltaClarity) > 0.015)
    parts.push(`clarity ×${Math.exp(deltaClarity).toFixed(2)} (${query.clarity} vs ${row.clarity})`);
  const clarOrdinalGap = Math.abs((CLARITY_RANK_NUM[query.clarity] ?? 2) - (CLARITY_RANK_NUM[row.clarity] ?? 2));
  const clarPerStep = query.colorFamily === 'white'
    ? AXIS_SIGMA.clarityWhitePerStep
    : AXIS_SIGMA.clarityFancyPerStep;
  sigmaClarity = clarOrdinalGap * clarPerStep;
  logDpcAdj += deltaClarity;

  // ── Shape adjustment ──────────────────────────────────────────────────────
  const normShape = query.shape;  // already normalized at call site
  const shapeMultWhite = SHAPE_MULT_WHITE[normShape] ?? 1.0;
  const shapeMultCompWhite = SHAPE_MULT_WHITE[row.shape] ?? 1.0;
  const shapeMultColor = SHAPE_MULT_COLOR[normShape] ?? 1.0;
  const shapeMultCompColor = SHAPE_MULT_COLOR[row.shape] ?? 1.0;

  let deltaShape;
  if (query.colorFamily === 'white') {
    deltaShape = shapeMultCompWhite > 0 ? Math.log(shapeMultWhite / shapeMultCompWhite) : 0;
  } else {
    deltaShape = shapeMultCompColor > 0 ? Math.log(shapeMultColor / shapeMultCompColor) : 0;
  }
  if (Math.abs(deltaShape) > 0.015)
    parts.push(`shape ×${Math.exp(deltaShape).toFixed(2)} (${normShape} vs ${row.shape})`);
  sigmaShape = shapeSigma(query.shape, row.shape);
  logDpcAdj += deltaShape;

  // ── Final log estimate ─────────────────────────────────────────────────────
  const logEstimate = logDpcAdj + Math.log(queryCt);
  const estimatedPrice = Math.round(Math.exp(logEstimate));

  // ── Sigma aggregation ──────────────────────────────────────────────────────
  const sigmaSource = sourceErrorSigma(row.confidence);
  const sigmaBand = (row.caratBand ? AXIS_SIGMA.caratBand : 0) +
                    (row.clarityBand ? AXIS_SIGMA.clarityBand : 0);

  const sigmaLog = Math.sqrt(
    (sigmaCarat || 0)**2 + (sigmaColor || 0)**2 + sigmaClarity**2 +
    sigmaShape**2 + sigmaSource**2 + sigmaBand**2
  );

  return { logEstimate, sigmaLog, estimatedPrice, parts };
}

// ══════════════════════════════════════════════════════════════════════════════
// §8  ENSEMBLE BLEND
// ══════════════════════════════════════════════════════════════════════════════

function medianOf(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * blendComps — combine multiple adjusted comp estimates in log space.
 *
 * Algorithm:
 *  1. Compute median log estimate.
 *  2. Reject outliers: if |logEst − median| > 2.5 × sigmaLog, reject.
 *  3. Weight accepted comps by inverse variance: w_i = 1 / (σ_i² + ε).
 *  4. Weighted mean → point estimate.
 *  5. Blended sigma = 1 / sqrt(Σ 1/σ_i²), floored at 0.05.
 *  6. 80% interval = estimate × exp(±1.28 × sigmaBlend).
 *
 * @param {Array} adjustedList  — [{ logEstimate, sigmaLog, estimatedPrice, parts, row, score }]
 * @param {{ multiSupplierExact?: boolean }} options
 * @returns {{ logEstimate, sigmaLog, estimate, low, high, accepted, rejected }}
 */
function blendComps(adjustedList, options = {}) {
  if (!adjustedList.length) return null;

  const logEsts = adjustedList.map(a => a.logEstimate);
  const medianLogEst = medianOf(logEsts);
  const skipOutlierRejection = !!options.multiSupplierExact;

  const accepted = [];
  const rejected = [];

  for (const adj of adjustedList) {
    const deviation = Math.abs(adj.logEstimate - medianLogEst);
    if (!skipOutlierRejection && adjustedList.length > 1 && deviation > 2.5 * adj.sigmaLog) {
      rejected.push({ ...adj, rejectReason: `outlier: deviation ${deviation.toFixed(3)} > 2.5×σ(${adj.sigmaLog.toFixed(3)})` });
    } else {
      accepted.push(adj);
    }
  }

  // If all rejected (e.g. all have tiny sigma), use all
  if (!accepted.length) {
    accepted.push(...rejected);
    rejected.length = 0;
  }

  // ── Inverse-variance weighting ─────────────────────────────────────────────
  const EPS = 1e-4;
  const rawWeights = accepted.map(adj => 1 / (adj.sigmaLog ** 2 + EPS));

  // ── Supplier blend weight cap ──────────────────────────────────────────────
  // Prevent one supplier from dominating the weighted mean even if its rows
  // have lower per-axis sigma than others (a selection-cap alone doesn't prevent this).
  let weights = rawWeights;
  let sourceConcentration = {
    dominated: false,
    dominantSupplier: null,
    dominantFrac: null,
    rawDominantFrac: null,
    finalDominantFrac: null,
    capApplied: false,
    capPossible: true,
    supplierFracs: {},
  };

  const hasRowInfo = accepted.some(adj => adj.row != null);
  if (hasRowInfo) {
    const rawTotal = rawWeights.reduce((a, b) => a + b, 0);
    const supplierWeightSum = {};
    for (let i = 0; i < accepted.length; i++) {
      const sk = accepted[i].row ? supplierKey(accepted[i].row) : '_unknown';
      supplierWeightSum[sk] = (supplierWeightSum[sk] || 0) + rawWeights[i];
    }
    const entries = Object.entries(supplierWeightSum).sort((a, b) => b[1] - a[1]);
    const dominant = entries.find(([, w]) => rawTotal > 0 && w / rawTotal > MAX_SUPPLIER_WEIGHT_FRAC);
    if (dominant) {
      const [dominantSk, dominantW] = dominant;
      const otherW = rawTotal - dominantW;
      let capApplied = false;
      let capPossible = otherW > 0;
      if (capPossible) {
        // Solve cappedW / (cappedW + otherW) = MAX_SUPPLIER_WEIGHT_FRAC.
        const cappedW = (MAX_SUPPLIER_WEIGHT_FRAC * otherW) / (1 - MAX_SUPPLIER_WEIGHT_FRAC);
        const scale = Math.min(1, cappedW / dominantW);
        weights = rawWeights.map((w, i) => {
          const sk = accepted[i].row ? supplierKey(accepted[i].row) : '_unknown';
          return sk === dominantSk ? w * scale : w;
        });
        capApplied = scale < 0.999;
      }
      const finalTotal = weights.reduce((a, b) => a + b, 0);
      const supplierFinalSum = {};
      for (let i = 0; i < accepted.length; i++) {
        const sk = accepted[i].row ? supplierKey(accepted[i].row) : '_unknown';
        supplierFinalSum[sk] = (supplierFinalSum[sk] || 0) + weights[i];
      }
      const supplierFracs = Object.fromEntries(
        Object.entries(supplierFinalSum).map(([sk, w]) => [sk, finalTotal > 0 ? w / finalTotal : 0])
      );
      const finalDominantFrac = finalTotal > 0 ? (supplierFinalSum[dominantSk] || 0) / finalTotal : null;
      sourceConcentration = {
        dominated: true,
        dominantSupplier: dominantSk,
        dominantFrac: finalDominantFrac,
        rawDominantFrac: rawTotal > 0 ? dominantW / rawTotal : null,
        finalDominantFrac,
        capApplied,
        capPossible,
        supplierFracs,
      };
    }
  }

  const totalW = weights.reduce((a, b) => a + b, 0);
  const logEstimate = accepted.reduce((sum, adj, i) => sum + adj.logEstimate * weights[i], 0) / totalW;

  // ── Blended sigma with systematic floor and empirical calibration factor ───
  // The pooled inverse-variance sigma is often too narrow (P80 coverage ~20%).
  // SIGMA_SYSTEMATIC_FLOOR adds irreducible model uncertainty in quadrature.
  // SIGMA_CALIBRATION_FACTOR widens the final interval empirically.
  // Both are labeled uncalibrated; tune after a proper coverage measurement.
  const sigmaBlend = 1 / Math.sqrt(weights.reduce((sum, w) => sum + w, 0));
  const sigmaWithFloor = Math.sqrt(sigmaBlend ** 2 + SIGMA_SYSTEMATIC_FLOOR ** 2);
  const sigmaLog = sigmaWithFloor * SIGMA_CALIBRATION_FACTOR;

  const estimate = Math.round(Math.exp(logEstimate));
  // 80% interval label (z = 1.28), but sigmaLog is inflated, so effective coverage > 80%.
  const low  = Math.round(Math.exp(logEstimate - 1.28 * sigmaLog));
  const high = Math.round(Math.exp(logEstimate + 1.28 * sigmaLog));

  return { logEstimate, sigmaLog, estimate, low, high, accepted, rejected, sourceConcentration };
}

// ══════════════════════════════════════════════════════════════════════════════
// §9  RESOLVE — full v3 pipeline
// ══════════════════════════════════════════════════════════════════════════════

let _compsIndex = null;

const SUPPLEMENTAL_COMP_FILES = [
  'messi-comps.json',
  'starsgem-comps.json',
  'messi-color-comps.json',
];

function mergeSupplementalComps(index, supplementalIndexes) {
  const merged = {
    ...index,
    comps: [...(index.comps || [])],
  };
  for (const supp of supplementalIndexes) {
    if (supp?.comps?.length) merged.comps.push(...supp.comps);
  }
  return merged;
}

/**
 * resolveAlibabaComp — v3 main entry point.
 *
 * Pipeline:
 *  1. Filter candidates (hard gates: colorFamily, hue, white grade proximity).
 *  2. Score all unique-productId candidates with compErrorScore.
 *  3. Select top-N (≤ MAX_ENSEMBLE) within SCORE_HARD_CUTOFF.
 *  4. Adjust each to the query in log space (adjustCompToQuery).
 *  5. Blend with outlier rejection and inverse-variance weighting (blendComps).
 *  6. Determine matchType from best score.
 *  7. Return v3 result + legacy-compatible primary/alternatives fields.
 *
 * Query format:
 *   {
 *     carat: number,
 *     shape: string,               // app shape key, e.g. 'oval', 'radiant'
 *     colorFamily: 'white'|'fancy',
 *     whiteGrade?: string,         // 'D'–'Z', required when colorFamily='white'
 *     colorFamily_key?: string,    // e.g. 'pink_fv', required when colorFamily='fancy'
 *     clarity: string,             // 'VS1', 'VVS2', etc.
 *   }
 *
 * Returns:
 *   {
 *     matchType: 'exact'|'nearest'|'best_available'|'none',
 *     estimate: number,            // point estimate (weighted log-space mean)
 *     low: number,                 // 80% lower bound
 *     high: number,                // 80% upper bound
 *     perCt: number,               // estimate / query.carat
 *     confidence: 'high'|'medium'|'low',
 *     primary: { row, listingPrice, estimatedPrice, url, label, modifiers },  // legacy compat
 *     alternatives: [...],         // legacy compat
 *     supportComps: [...],         // v3: all accepted comps with their adjustments
 *     rejectedComps: [...],        // v3: outlier-rejected comps
 *     warnings: [string],
 *     source: string,
 *   }
 */
function resolveAlibabaComp(query) {
  if (!_compsIndex) throw new Error('Index not loaded. Call loadIndex() first.');
  const comps = _compsIndex.comps;

  // Normalize query shape for matching
  const normShape = normalizeShapeForComp(query.shape);
  const nq = { ...query, shape: normShape };

  const warnings = [];

  // ── 1. Filter candidates ──────────────────────────────────────────────────
  let candidates = filterCandidates(nq, comps);

  // If no shape-matched candidates, try broadening to any shape within color family
  // (only for non-specialty shapes, as specialty shapes have no good cross-shape comp)
  let broadened = false;
  if (!candidates.length || !candidates.some(r => shapeDistance(normShape, r.shape) <= 2)) {
    if (!SPECIALTY_SHAPE_KEYS.has(query.shape)) {
      const broadCandidates = comps.filter(r => {
        if (r.colorFamily !== nq.colorFamily) return false;
        if (nq.colorFamily === 'fancy' && !fancyHueCompatible(nq.colorFamily_key, r.color)) return false;
        if (nq.colorFamily === 'white' && whiteColorDistance(nq.whiteGrade, r.colorNormalized) > 5) return false;
        return true;
      });
      if (broadCandidates.length) {
        candidates = broadCandidates;
        broadened = true;
        warnings.push('No shape-compatible comps — broadened to any shape in same color family.');
      }
    }
  }

  if (!candidates.length) {
    return {
      matchType: 'none', estimate: null, low: null, high: null, perCt: null,
      confidence: null, primary: null, alternatives: [], supportComps: [],
      rejectedComps: [], warnings: ['No comps found for this spec.'], source: null,
    };
  }

  // ── 2. Score all candidates ───────────────────────────────────────────────
  const scored = candidates
    .map(row => { const sc = compErrorScore(nq, row); return { row, score: sc.total, scoreComponents: sc }; })
    .sort((a, b) => a.score - b.score || a.row.priceUsd - b.row.priceUsd);

  // De-duplicate by product identity: keep best-scoring row per listing/spec.
  // Supplier-sheet aggregates do not always have productId; do not collapse all
  // such rows into one undefined bucket.
  const seenPid = new Map();
  for (const c of scored) {
    const identity = compIdentity(c.row);
    if (!seenPid.has(identity)) seenPid.set(identity, c);
  }
  const uniqueScored = [...seenPid.values()].sort((a, b) => a.score - b.score);

  const bestScore = uniqueScored[0].score;

  // ── 2b. Fit local carat curve ─────────────────────────────────────────────
  // Only for white diamonds right now; fancy uses the model-based scale param.
  const localCaratCurve = nq.colorFamily === 'white'
    ? fitLocalCaratSlope(candidates, nq, /* prior */ 0.8)
    : null;
  if (localCaratCurve?.queryIsExtrapolated) {
    const dir = nq.carat > localCaratCurve.caratMax ? 'above' : 'below';
    warnings.push(`Carat ${nq.carat}ct is ${dir} the local comp range (${localCaratCurve.caratMin.toFixed(1)}–${localCaratCurve.caratMax.toFixed(1)}ct). Extrapolation uncertainty is high.`);
  }
  if (localCaratCurve && Math.abs(localCaratCurve.slope - 0.8) > 0.3) {
    warnings.push(`Local carat slope ${localCaratCurve.slope.toFixed(2)} differs materially from the 0.8 prior; inspect comp support.`);
  }
  if (nearCaratThreshold(nq.carat)) {
    warnings.push(`${nq.carat}ct is near a market carat threshold — spot price may carry a premium not reflected in nearby comps.`);
  }
  const adjContext = {
    localCaratSlope: localCaratCurve?.slope ?? null,
    localCaratExtrapolated: !!localCaratCurve?.queryIsExtrapolated,
  };

  // ── 3. Supplier cap: separate exact vs fallback paths ─────────────────────
  // Exact same-spec rows should not be discarded by the supplier cap — they are
  // the most reliable observations. The cap is applied more aggressively to
  // fallback (non-exact) comps where supplier pricing basis is a larger risk.
  const exactPool = uniqueScored.filter(c => isExactMatch(nq, c.row) && c.score < 0.10);
  const fallbackPool = uniqueScored.filter(c => !isExactMatch(nq, c.row) || c.score >= 0.10);
  const supplierCappedFallback = applySupplierCap(fallbackPool);
  const supplierCapped = exactPool.length
    ? [...exactPool, ...supplierCappedFallback].sort((a, b) => a.score - b.score)
    : supplierCappedFallback;

  // ── 4. Select top-N for ensemble ──────────────────────────────────────────
  // Exact observations should not be diluted or outlier-rejected by looser
  // cross-shape comps that happen to be cheaper.
  const exactScored = supplierCapped.filter(c => isExactMatch(nq, c.row) && c.score < 0.10);
  let selected = exactScored.length
    ? selectCheapestExactEnsemble(exactScored, MAX_ENSEMBLE)
    : supplierCapped.filter(c => c.score <= SCORE_HARD_CUTOFF).slice(0, MAX_ENSEMBLE);

  if (!selected.length) {
    // No comp within cutoff — use best available with a warning
    selected = supplierCapped.slice(0, Math.min(3, supplierCapped.length));
    warnings.push('No close comps found — estimate is highly extrapolated.');
  }

  // ── 5. Adjust each comp to query in log space ─────────────────────────────
  const adjustedList = selected.map(({ row, score, scoreComponents }) => {
    const adj = adjustCompToQuery(nq, row, adjContext);
    return { ...adj, row, score, scoreComponents };
  });

  // ── 6. Blend (cheapest-supplier comps only on exact path) ───────────────────
  const blend = blendComps(adjustedList);

  if (!blend) {
    return {
      matchType: 'none', estimate: null, low: null, high: null, perCt: null,
      confidence: null, primary: null, alternatives: [], supportComps: [],
      rejectedComps: [], warnings: [...warnings, 'Blending failed.'], source: null,
    };
  }

  if (blend.rejected.length) {
    warnings.push(`${blend.rejected.length} comp(s) rejected as outliers in log-space blend.`);
  }
  if (blend.accepted.length === 1) {
    warnings.push('Single comp in ensemble — estimate based on one data point.');
  }
  if (blend.sourceConcentration?.dominated) {
    const sc = blend.sourceConcentration;
    if (sc.capPossible && sc.capApplied) {
      warnings.push(`Source concentrated: ${sc.dominantSupplier} held ${(sc.rawDominantFrac * 100).toFixed(0)}% raw blend weight; capped to ${(sc.finalDominantFrac * 100).toFixed(0)}% final weight.`);
    } else if (!sc.capPossible) {
      warnings.push(`Source concentrated: all accepted blend weight came from ${sc.dominantSupplier}; no cross-source cap was possible.`);
    } else {
      warnings.push(`Source concentrated: ${sc.dominantSupplier} held ${(sc.finalDominantFrac * 100).toFixed(0)}% final blend weight.`);
    }
  }

  // ── 7. Determine matchType ────────────────────────────────────────────────
  // Check if best comp qualifies as an exact observation
  const hasExact = isExactMatch(nq, uniqueScored[0].row) && bestScore < 0.10;
  let matchType;
  if (hasExact)               matchType = 'exact';
  else if (bestScore <= 0.20) matchType = 'nearest';
  else                        matchType = 'best_available';

  if (SPECIALTY_SHAPE_KEYS.has(query.shape) && broadened) {
    matchType = 'none';
  }

  // ── 7. Build output ───────────────────────────────────────────────────────
  const exactAdjustedOrdered = matchType === 'exact'
    ? selected.map(({ row, score, scoreComponents }) => ({
        ...adjustCompToQuery(nq, row, adjContext),
        row,
        score,
        scoreComponents,
      })).sort((a, b) => (a.row?.priceUsd ?? 0) - (b.row?.priceUsd ?? 0) || a.score - b.score)
    : [];
  const acceptedOrdered = matchType === 'exact'
    ? exactAdjustedOrdered
    : blend.accepted;
  const primaryAdj = acceptedOrdered[0];
  const floorSupplierKey = primaryAdj?.row ? supplierKey(primaryAdj.row) : null;
  const otherFactoryExact = (matchType === 'exact' && floorSupplierKey)
    ? buildOtherFactoryExactList(exactScored, floorSupplierKey)
    : [];
  if (otherFactoryExact.length) {
    const names = [...new Set(otherFactoryExact.map(e => e.supplierKey))].join(', ');
    warnings.push(`Same-spec listings also at ${names} — shown below, not averaged into floor price.`);
  }
  const primaryEstPrice = matchType === 'exact'
    ? primaryAdj.row.priceUsd
    : blend.estimate;
  const pointEstimate = matchType === 'exact' ? primaryEstPrice : blend.estimate;

  // Legacy modifiers object (for UI compatibility)
  const legacyModifiers = (matchType === 'exact')
    ? null
    : {
        combined: Math.exp(primaryAdj.logEstimate - Math.log(primaryAdj.row.priceUsd)),
        estimated: blend.estimate,
        parts: primaryAdj.parts,
      };

  const primary = {
    row: primaryAdj.row,
    listingPrice: primaryAdj.row.priceUsd,
    estimatedPrice: primaryEstPrice,
    url: primaryAdj.row.url,
    label: shortLabel(primaryAdj.row),
    modifiers: legacyModifiers,
    blendedFrom: matchType === 'exact' ? exactAdjustedOrdered.length : blend.accepted.length,
  };

  // Near-carat variants from the floor supplier only (not other factories).
  const alternatives = (matchType === 'exact'
    ? acceptedOrdered.slice(1).filter(adj => supplierKey(adj.row) === floorSupplierKey)
    : acceptedOrdered.slice(1)
  ).map(adj => ({
    row: adj.row,
    listingPrice: adj.row.priceUsd,
    estimatedPrice: Math.round(Math.exp(adj.logEstimate)),
    url: adj.row.url,
    label: shortLabel(adj.row),
    modifiers: {
      combined: Math.exp(adj.logEstimate - Math.log(adj.row.priceUsd)),
      estimated: Math.round(Math.exp(adj.logEstimate)),
      parts: adj.parts,
    },
  }));

  const confidence = bestScore <= 0.10 ? 'high' : bestScore <= 0.25 ? 'medium' : 'low';

  return {
    matchType,
    estimate: pointEstimate,
    low: matchType === 'exact' ? Math.round(pointEstimate * 0.87) : blend.low,
    high: matchType === 'exact' ? Math.round(pointEstimate * 1.13) : blend.high,
    perCt: Math.round(pointEstimate / query.carat),
    confidence,
    primary,
    alternatives,
    otherFactoryExact,
    supportComps: acceptedOrdered.map(adj => ({
      row: adj.row,
      score: adj.score,
      scoreComponents: adj.scoreComponents,
      logEstimate: adj.logEstimate,
      sigmaLog: adj.sigmaLog,
      estimatedPrice: Math.round(Math.exp(adj.logEstimate)),
      parts: adj.parts,
    })),
    rejectedComps: blend.rejected.map(adj => ({
      row: adj.row,
      reason: adj.rejectReason,
      estimatedPrice: Math.round(Math.exp(adj.logEstimate)),
    })),
    warnings,
    source: 'comps-index-v3',
    // ── P1: source concentration ──────────────────────────────────────────
    sourceConcentration: blend.sourceConcentration,
    // ── P1b: local carat curve ────────────────────────────────────────────
    localCaratCurve: localCaratCurve ? {
      slope: localCaratCurve.slope,
      rawSlope: localCaratCurve.rawSlope,
      n: localCaratCurve.n,
      rowCount: localCaratCurve.rowCount,
      sourceCount: localCaratCurve.sourceCount,
      confidence: localCaratCurve.confidence,
      caratRange: `${localCaratCurve.caratMin.toFixed(1)}–${localCaratCurve.caratMax.toFixed(1)}ct`,
      queryIsExtrapolated: localCaratCurve.queryIsExtrapolated,
      normalized: localCaratCurve.normalized,
      note: `Normalized local carat slope ${localCaratCurve.slope.toFixed(2)} (prior 0.8), ${localCaratCurve.n} carat knots from ${localCaratCurve.rowCount} rows`,
    } : null,
    // ── P0: calibration label ─────────────────────────────────────────────
    calibrationNote: `intervals_sigma_inflated_${SIGMA_CALIBRATION_FACTOR}x_uncalibrated`,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// §10  INDEX LOADER
// ══════════════════════════════════════════════════════════════════════════════

async function loadIndex(src) {
  if (typeof src === 'object' && src !== null) {
    _compsIndex = src;
    return;
  }
  const url = src || 'research/data/alibaba-comps-index.json';
  const baseUrl = url.includes('/') ? url.slice(0, url.lastIndexOf('/') + 1) : '';

  if (typeof process !== 'undefined' && process.versions?.node) {
    const { readFileSync } = await import('fs');
    const index = JSON.parse(readFileSync(url, 'utf8'));
    const supplemental = [];
    for (const file of SUPPLEMENTAL_COMP_FILES) {
      try {
        supplemental.push(JSON.parse(readFileSync(baseUrl + file, 'utf8')));
      } catch {
        // Optional pool; keep standalone engine usable with only the base index.
      }
    }
    _compsIndex = mergeSupplementalComps(index, supplemental);
    return;
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load comps index: HTTP ${res.status}`);
  const index = await res.json();
  const supplemental = await Promise.all(SUPPLEMENTAL_COMP_FILES.map(async file => {
    try {
      const suppRes = await fetch(baseUrl + file);
      return suppRes.ok ? suppRes.json() : null;
    } catch {
      return null;
    }
  }));
  _compsIndex = mergeSupplementalComps(index, supplemental);
}

// ══════════════════════════════════════════════════════════════════════════════
// §11  TEST SUITE
// ══════════════════════════════════════════════════════════════════════════════

function runTests() {
  if (!_compsIndex) { console.error('runTests: index not loaded'); return; }

  const FIXTURES = [
    // ── White: exact / near-exact ──────────────────────────────────────────
    {
      desc: 'T01 — 1ct D VS1 round (Messi primary)',
      q: { carat: 1.0, shape: 'round', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' },
      expectMatch: ['exact'],
    },
    {
      desc: 'T02 — 1ct D VS1 oval',
      q: { carat: 1.0, shape: 'oval', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' },
      expectMatch: ['exact', 'nearest'],
    },
    {
      desc: 'T03 — 2ct D VS1 marquise',
      q: { carat: 2.0, shape: 'marquise', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' },
      expectMatch: ['exact', 'nearest'],
    },
    {
      desc: 'T04 — 3ct D VS1 princess',
      q: { carat: 3.0, shape: 'princess', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' },
      expectMatch: ['exact', 'nearest'],
    },
    // ── White: color offset ────────────────────────────────────────────────
    {
      desc: 'T05 — 2ct H VS1 round (color modifier)',
      q: { carat: 2.0, shape: 'round', colorFamily: 'white', whiteGrade: 'H', clarity: 'VS1' },
      expectMatch: ['exact', 'nearest', 'best_available'],
      note: 'H vs D comp → color downgrade modifier applied.',
    },
    {
      desc: 'T06 — 2ct G VS1 round',
      q: { carat: 2.0, shape: 'round', colorFamily: 'white', whiteGrade: 'G', clarity: 'VS1' },
      expectMatch: ['exact', 'nearest', 'best_available'],
    },
    // ── White: size gaps ───────────────────────────────────────────────────
    {
      desc: 'T07 — 4ct D VS1 marquise',
      q: { carat: 4.0, shape: 'marquise', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' },
      expectMatch: ['exact', 'nearest', 'best_available'],
      note: 'Merged supplier pools now include 4ct marquise rows.',
    },
    {
      desc: 'T08 — 4.5ct D VS1 marquise',
      q: { carat: 4.5, shape: 'marquise', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' },
      expectMatch: ['nearest', 'best_available'],
    },
    {
      desc: 'T09 — 6ct D VS1 oval',
      q: { carat: 6.0, shape: 'oval', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' },
      expectMatch: ['exact', 'nearest', 'best_available'],
    },
    // ── White: shape normalization ─────────────────────────────────────────
    {
      desc: 'T10 — 2ct D VS1 cushion_brilliant (→ cushion)',
      q: { carat: 2.0, shape: 'cushion_brilliant', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' },
      expectMatch: ['exact', 'nearest'],
    },
    // ── White: specialty shapes ────────────────────────────────────────────
    {
      desc: 'T11 — 2ct D VS1 portuguese (has real index rows)',
      q: { carat: 2.0, shape: 'portuguese', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' },
      expectMatch: ['exact', 'nearest', 'best_available'],
    },
    {
      desc: 'T12 — 2ct D VS1 moval (has real index rows)',
      q: { carat: 2.0, shape: 'moval', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' },
      expectMatch: ['exact', 'nearest', 'best_available'],
    },
    // ── Fancy: pink ────────────────────────────────────────────────────────
    {
      desc: 'T13 — 2ct Fancy Vivid Pink VVS2 heart',
      q: { carat: 2.0, shape: 'heart', colorFamily: 'fancy', colorFamily_key: 'pink_fv', clarity: 'VVS2' },
      expectMatch: ['exact', 'nearest', 'best_available'],
    },
    {
      desc: 'T14 — 1ct Fancy Intense Pink VS1 pear',
      q: { carat: 1.0, shape: 'pear', colorFamily: 'fancy', colorFamily_key: 'pink_fi', clarity: 'VS1' },
      expectMatch: ['nearest', 'best_available'],
    },
    {
      desc: 'T15 — 1ct Fancy Vivid Orange VS1 oval (no orange rows → none)',
      q: { carat: 1.0, shape: 'oval', colorFamily: 'fancy', colorFamily_key: 'orange_fv', clarity: 'VS1' },
      expectMatch: ['none'],
      note: 'fancyHueCompatible must reject non-orange comps.',
    },
    // ── Pink case study: v3 must not select 0.89ct brownish as primary ─────
    {
      desc: 'T16 — 3.80ct Fancy Vivid Pink VVS2 radiant (pink case study)',
      q: { carat: 3.8, shape: 'radiant', colorFamily: 'fancy', colorFamily_key: 'pink_fv', clarity: 'VVS2' },
      expectMatch: ['nearest', 'best_available'],
      checkFn: (result) => {
        // Primary comp must NOT be the 0.89ct brownish radiant
        const pRow = result.primary?.row;
        if (!pRow) return 'No primary comp found';
        if (Math.abs((pRow.carat||0) - 0.89) < 0.05 && (pRow.color || '').toLowerCase().includes('brownish')) {
          return 'FAIL: 0.89ct brownish radiant incorrectly selected as primary';
        }
        // Ensemble should contain a FVP or near-FVP comp (2.08ct heart FVP or higher-ct cushion)
        const supportColors = result.supportComps.map(sc => (sc.row.color||'').toLowerCase());
        const supportCarats = result.supportComps.map(sc => sc.row.carat);
        const hasFVP = supportColors.some(c => c.includes('vivid'));
        const has413 = supportCarats.some(c => Math.abs(c - 4.13) < 0.10);
        const has208 = supportCarats.some(c => Math.abs(c - 2.08) < 0.10);
        if (!hasFVP && !has413 && !has208) {
          return `FAIL: no vivid pink or large-carat comp in support. Colors: ${supportColors.join(', ')}  Carats: ${supportCarats.join(', ')}`;
        }
        // Estimate should be in a reasonable range
        if (result.estimate < 500 || result.estimate > 8000) {
          return `FAIL: estimate ${result.estimate} is outside expected range ($500–$8000)`;
        }
        return null; // pass
      },
      note: 'Primary must not be 0.89ct brownish; ensemble uses FVP comp or large-carat pink comps.',
    },
    // ── Brownish modifier ──────────────────────────────────────────────────
    {
      desc: 'T17 — 0.89ct Fancy Intense Brownish Pink VS2 radiant (self-match check)',
      q: { carat: 0.89, shape: 'radiant', colorFamily: 'fancy', colorFamily_key: 'pink_fi', clarity: 'VS2' },
      expectMatch: ['exact', 'nearest'],
      note: 'The comp IS the 0.89ct brownish row. Exact or near-exact match.',
    },
    // ── Edge cases ─────────────────────────────────────────────────────────
    {
      desc: 'T18 — 0.5ct D VS1 round (small stone)',
      q: { carat: 0.5, shape: 'round', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' },
      expectMatch: ['exact'],
    },
    {
      desc: 'T19 — 2ct D VVS1 oval (VVS1 premium)',
      q: { carat: 2.0, shape: 'oval', colorFamily: 'white', whiteGrade: 'D', clarity: 'VVS1' },
      expectMatch: ['exact', 'nearest', 'best_available'],
    },
    {
      desc: 'T20 — 3.5ct D VS1 oval',
      q: { carat: 3.5, shape: 'oval', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' },
      expectMatch: ['exact', 'nearest', 'best_available'],
    },
    // ── Ensemble blend check ───────────────────────────────────────────────
    {
      desc: 'T21 — 4ct Fancy Vivid Pink VS1 cushion',
      q: { carat: 4.0, shape: 'cushion', colorFamily: 'fancy', colorFamily_key: 'pink_fv', clarity: 'VS1' },
      expectMatch: ['exact', 'nearest', 'best_available'],  // 4ct cushion row exists
      checkFn: (result) => {
        const pRow = result.primary?.row;
        if (!pRow) return 'FAIL: missing primary comp';
        if (pRow.shape !== 'cushion') return `FAIL: expected cushion primary, got ${pRow.shape}`;
        if (!(pRow.color || '').toLowerCase().includes('vivid pink')) {
          return `FAIL: expected Fancy Vivid Pink primary, got ${pRow.color}`;
        }
        // Should have low/high range
        if (!result.low || !result.high || result.low >= result.high) {
          return `FAIL: invalid range low=${result.low} high=${result.high}`;
        }
        return null;
      },
    },
    {
      desc: 'T22 — 1ct Fancy Light Pink VS2 cushion (lower intensity)',
      q: { carat: 1.0, shape: 'cushion', colorFamily: 'fancy', colorFamily_key: 'pink_fl', clarity: 'VS2' },
      expectMatch: ['exact', 'nearest', 'best_available'],
    },
    {
      desc: 'T23 — 5ct D VS1 oval (large white, should have range)',
      q: { carat: 5.0, shape: 'oval', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' },
      expectMatch: ['exact', 'nearest', 'best_available'],
      checkFn: (result) => {
        if (!result.low || !result.high) return 'FAIL: missing low/high range';
        return null;
      },
    },
    // ── Multi-supplier exact (Messi sheet + StarGem) ─────────────────────────
    {
      desc: 'T24 — 3.01ct E VS1 pear (Messi + StarGem both in blend)',
      q: { carat: 3.01, shape: 'pear', colorFamily: 'white', whiteGrade: 'E', clarity: 'VS1' },
      expectMatch: ['exact'],
      checkFn: (result) => {
        if (supplierKey(result.primary?.row) !== 'starsgem') {
          return 'FAIL: floor primary should be cheapest StarGem';
        }
        const messi = (result.otherFactoryExact || []).filter(e => e.supplierKey === 'messi');
        if (!messi.length) return 'FAIL: Messi same-spec listings missing from otherFactoryExact';
        if (!messi.some(e => e.listingPrice >= 420 && e.listingPrice <= 460)) {
          return `FAIL: expected Messi ~$430–460, got ${messi.map(e => e.listingPrice).join(', ')}`;
        }
        if (result.estimate > 360) return `FAIL: estimate should be floor ~$348, got ${result.estimate}`;
        return null;
      },
    },
    {
      desc: 'T25 — 3ct E VS1 pear (Messi row 17673 / sheet PS)',
      q: { carat: 3.0, shape: 'pear', colorFamily: 'white', whiteGrade: 'E', clarity: 'VS1' },
      expectMatch: ['exact'],
      checkFn: (result) => {
        const messi = (result.otherFactoryExact || []).filter(e => e.supplierKey === 'messi');
        if (!messi.length) return 'FAIL: no Messi otherFactoryExact';
        const near438 = messi.some(e => e.listingPrice >= 430 && e.listingPrice <= 445);
        if (!near438) return `FAIL: expected ~$438 Messi 3ct, got ${messi.map(e => e.listingPrice).join(', ')}`;
        return null;
      },
    },
    {
      desc: 'T26 — 3.02ct E VVS2 pear (Messi ~$498 sheet)',
      q: { carat: 3.02, shape: 'pear', colorFamily: 'white', whiteGrade: 'E', clarity: 'VVS2' },
      expectMatch: ['exact', 'nearest'],
      checkFn: (result) => {
        const messi = (result.otherFactoryExact || []).filter(e => e.supplierKey === 'messi');
        if (!messi.length) return 'FAIL: Messi VVS2 pear missing from otherFactoryExact';
        if (!messi.some(e => e.row.clarity === 'VVS2' && e.listingPrice >= 480)) {
          return 'FAIL: expected Messi 3ct E VVS2 near $498';
        }
        return null;
      },
    },
    {
      desc: 'T27 — 3.02ct E VS2 pear (Messi ~$423 sheet)',
      q: { carat: 3.02, shape: 'pear', colorFamily: 'white', whiteGrade: 'E', clarity: 'VS2' },
      expectMatch: ['exact', 'nearest'],
      checkFn: (result) => {
        const messi = (result.otherFactoryExact || []).filter(e => e.supplierKey === 'messi');
        if (!messi.length) return 'FAIL: Messi VS2 pear missing from otherFactoryExact';
        if (!messi.some(e => e.row.clarity === 'VS2' && e.listingPrice >= 400 && e.listingPrice <= 440)) {
          return `FAIL: expected Messi VS2 ~$423, got ${messi.map(e => e.listingPrice).join(', ')}`;
        }
        return null;
      },
    },
    {
      desc: 'T28 — 1ct D VS1 pear (shape pear, not round)',
      q: { carat: 1.0, shape: 'pear', colorFamily: 'white', whiteGrade: 'D', clarity: 'VS1' },
      expectMatch: ['exact', 'nearest'],
      checkFn: (result) => {
        const shapes = new Set((result.supportComps || []).map(c => c.row.shape));
        if (!shapes.has('pear')) return `FAIL: support comps not pear: ${[...shapes].join(', ')}`;
        return null;
      },
    },
    {
      desc: 'T29 — 3.01ct E VS1 pear primary is cheapest exact (StarGem)',
      q: { carat: 3.01, shape: 'pear', colorFamily: 'white', whiteGrade: 'E', clarity: 'VS1' },
      expectMatch: ['exact'],
      checkFn: (result) => {
        const p = result.primary?.row;
        if (!p) return 'FAIL: no primary';
        if (p.shape !== 'pear') return `FAIL: primary shape ${p.shape}`;
        if (supplierKey(p) !== 'starsgem') return `FAIL: primary should be cheapest StarGem, got ${supplierKey(p)}`;
        const messiListed = (result.otherFactoryExact || []).some(e => e.supplierKey === 'messi');
        if (!messiListed) return 'FAIL: Messi should appear in otherFactoryExact, not alternatives';
        const altMessi = (result.alternatives || []).some(a => supplierKey(a.row) === 'messi');
        if (altMessi) return 'FAIL: Messi should not be in alternatives (floor supplier only)';
        return null;
      },
    },
  ];

  let passed = 0, failed = 0;
  console.log(`\n${'='.repeat(72)}`);
  console.log('ALIBABA COMP ENGINE v3 — TEST RUN');
  console.log(`${'='.repeat(72)}\n`);

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
    const mtOk = fx.expectMatch.includes(mt);
    let customErr = null;
    if (fx.checkFn && mtOk) customErr = fx.checkFn(result);

    const ok = mtOk && !customErr;
    if (ok) passed++; else failed++;

    const tag = ok ? '[PASS]' : '[FAIL]';
    const p = result.primary;
    const compSpec = p?.row
      ? `${p.row.carat}ct ${p.row.shape} ${p.row.clarity}${p.row.color ? ' ' + p.row.color : p.row.colorNormalized ? ' ' + p.row.colorNormalized : ''}`
      : '—';
    const priceStr = result.estimate != null
      ? `$${result.estimate} [$${result.low}–$${result.high}]`
      : '—';
    const nSupport = result.supportComps?.length || 0;
    const nReject  = result.rejectedComps?.length || 0;
    const warnings = result.warnings?.join(' | ') || '—';

    console.log(`${tag} ${fx.desc}`);
    console.log(`       matchType: ${mt}  (expected: ${fx.expectMatch.join('|')})`);
    console.log(`       primaryComp: ${compSpec}`);
    console.log(`       estimate: ${priceStr}  support=${nSupport}  rejected=${nReject}`);
    if (warnings !== '—') console.log(`       warnings: ${warnings}`);
    if (customErr) console.log(`       checkFn: ${customErr}`);
    if (!mtOk && fx.note) console.log(`       note: ${fx.note}`);
    console.log();
  }

  console.log(`${'='.repeat(72)}`);
  console.log(`Results: ${passed} passed, ${failed} failed of ${FIXTURES.length} total`);
  console.log(`${'='.repeat(72)}\n`);
}

// ══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════════════════════════
export {
  // Public API
  loadIndex,
  resolveAlibabaComp,
  runTests,

  // Core stages (useful for unit testing or debugging)
  parseFancyColorLabel,
  inferFancyFamilyKey,
  compErrorScore,
  adjustCompToQuery,
  blendComps,
  buildOtherFactoryExactList,
  selectCheapestExactEnsemble,
  filterCandidates,
  isExactMatch,
  normalizeShapeForComp,
  shapeDistance,
  shapeSigma,
  getClarityMult,
  medianOf,
  supplierKey,
  fitLocalCaratSlope,
  nearCaratThreshold,

  // Reference data
  AXIS_SIGMA,
  MODIFIER_LOG_DELTA,
  INTENSITY_RANK,
  SHAPE_FAMILY_MAP,
  FANCY_COLOR_BASE,
  FANCY_LABEL_MAP,
  WHITE_GRADE_MULT,
  WHITE_COLOR_GRADE_NUM,
  CLARITY_RANK_NUM,
  CLARITY_CARAT_KNOTS_W,
  CLARITY_CARAT_MULTS_W,
  CLARITY_MULT_COLOR,
  SHAPE_MULT_WHITE,
  SHAPE_MULT_COLOR,
  SPECIALTY_SHAPE_KEYS,
  SCORE_HARD_CUTOFF,
  MAX_ENSEMBLE,
  CARAT_THRESHOLDS,
  SIGMA_CALIBRATION_FACTOR,
  SIGMA_SYSTEMATIC_FLOOR,
  MAX_SUPPLIER_WEIGHT_FRAC,
};
