var GemAppraiseV3Engine = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // research/comp-engine-v3.js
  var comp_engine_v3_exports = {};
  __export(comp_engine_v3_exports, {
    AXIS_SIGMA: () => AXIS_SIGMA,
    CARAT_SLOPE_POLICY: () => CARAT_SLOPE_POLICY,
    CARAT_THRESHOLDS: () => CARAT_THRESHOLDS,
    CLARITY_CARAT_KNOTS_W: () => CLARITY_CARAT_KNOTS_W,
    CLARITY_CARAT_MULTS_W: () => CLARITY_CARAT_MULTS_W,
    CLARITY_MULT_COLOR: () => CLARITY_MULT_COLOR,
    CLARITY_RANK_NUM: () => CLARITY_RANK_NUM,
    FANCY_COLOR_BASE: () => FANCY_COLOR_BASE,
    FANCY_LABEL_MAP: () => FANCY_LABEL_MAP,
    INTENSITY_RANK: () => INTENSITY_RANK,
    MAX_ENSEMBLE: () => MAX_ENSEMBLE,
    MAX_SUPPLIER_WEIGHT_FRAC: () => MAX_SUPPLIER_WEIGHT_FRAC,
    MODE_SIGMA_BOOST: () => MODE_SIGMA_BOOST,
    MODIFIER_LOG_DELTA: () => MODIFIER_LOG_DELTA,
    SCORE_HARD_CUTOFF: () => SCORE_HARD_CUTOFF,
    SHAPE_FAMILY_MAP: () => SHAPE_FAMILY_MAP,
    SHAPE_MULT_COLOR: () => SHAPE_MULT_COLOR,
    SHAPE_MULT_WHITE: () => SHAPE_MULT_WHITE,
    SIGMA_CALIBRATION_FACTOR: () => SIGMA_CALIBRATION_FACTOR,
    SIGMA_SYSTEMATIC_FLOOR: () => SIGMA_SYSTEMATIC_FLOOR,
    SPECIALTY_SHAPE_KEYS: () => SPECIALTY_SHAPE_KEYS,
    WHITE_COLOR_GRADE_NUM: () => WHITE_COLOR_GRADE_NUM,
    WHITE_GRADE_MULT: () => WHITE_GRADE_MULT,
    adjustCompToQuery: () => adjustCompToQuery,
    blendComps: () => blendComps,
    buildOtherFactoryExactList: () => buildOtherFactoryExactList,
    caratPriorForQuery: () => caratPriorForQuery,
    compErrorScore: () => compErrorScore,
    filterCandidates: () => filterCandidates,
    fitLocalCaratSlope: () => fitLocalCaratSlope,
    getClarityMult: () => getClarityMult,
    inferFancyFamilyKey: () => inferFancyFamilyKey,
    isExactMatch: () => isExactMatch,
    loadIndex: () => loadIndex,
    medianOf: () => medianOf,
    nearCaratThreshold: () => nearCaratThreshold,
    normalizeShapeForComp: () => normalizeShapeForComp,
    parseFancyColorLabel: () => parseFancyColorLabel,
    resolveAlibabaComp: () => resolveAlibabaComp,
    resolveEffectiveCaratSlope: () => resolveEffectiveCaratSlope,
    runTests: () => runTests,
    selectCheapestExactEnsemble: () => selectCheapestExactEnsemble,
    shapeDistance: () => shapeDistance,
    shapeSigma: () => shapeSigma,
    supplierKey: () => supplierKey
  });
  var CLARITY_RANK_NUM = { IF: -1, VVS1: 0, VVS2: 1, "VVS-VS": 1.5, VS1: 2, VS2: 3, SI1: 4, SI2: 5 };
  var WHITE_COLOR_GRADE_NUM = { D: 0, DE: 0.5, DEF: 1, E: 1, F: 2, G: 3, H: 4, I: 5, J: 6, K: 7, L: 8 };
  var WHITE_GRADE_MULT = {
    D: 1.08,
    E: 1,
    F: 0.92,
    G: 0.88,
    H: 0.82,
    I: 0.71,
    J: 0.6,
    K: 0.5,
    L: 0.42,
    M: 0.35,
    "N-P": 0.28,
    "Q-R": 0.21,
    "S-Z": 0.16
  };
  var CLARITY_CARAT_KNOTS_W = [0.5, 1, 1.5, 2, 3, 4, 5, 7, 10];
  var CLARITY_CARAT_MULTS_W = {
    IF: [1.14, 1.18, 1.22, 1.28, 1.42, 1.5, 1.58, 1.68, 1.88],
    VVS1: [1.1, 1.14, 1.16, 1.2, 1.36, 1.44, 1.52, 1.62, 1.78],
    VVS2: [1.05, 1.08, 1.09, 1.12, 1.14, 1.16, 1.18, 1.21, 1.24],
    VS1: [1, 1, 1, 1, 1, 1, 1, 1, 1],
    VS2: [0.92, 0.88, 0.87, 0.86, 0.84, 0.82, 0.8, 0.76, 0.7],
    SI1: [0.84, 0.72, 0.6, 0.44, 0.38, 0.34, 0.3, 0.26, 0.22],
    SI2: [0.72, 0.58, 0.46, 0.34, 0.28, 0.24, 0.2, 0.16, 0.12]
  };
  var CLARITY_MULT_COLOR = { IF: 1.12, VVS1: 1.08, VVS2: 1.04, VS1: 1, VS2: 0.95, SI1: 0.89, SI2: 0.77 };
  var SHAPE_MULT_WHITE = {
    round: 1,
    oval: 1.08,
    moval: 0.94,
    pear: 1.05,
    marquise: 0.87,
    heart: 0.86,
    trilliant: 0.82,
    old_european: 0.92,
    old_mine: 0.88,
    cushion: 0.9,
    cushion_brilliant: 0.91,
    square_cushion: 0.9,
    radiant: 0.87,
    sq_radiant: 0.88,
    princess: 0.86,
    half_moon: 0.8,
    shield: 0.78,
    hexagonal: 0.79,
    hexagonal_dutch: 0.82,
    emerald: 0.83,
    asscher: 0.84,
    baguette: 0.76,
    tapered_baguette: 0.74,
    carre: 0.8,
    rose: 0.72,
    briolette: 0.7,
    flower: 0.78,
    freeform: 0.7,
    portuguese: 0.85,
    flanders: 0.83
  };
  var SHAPE_MULT_COLOR = {
    round: 0.9,
    oval: 1.05,
    moval: 0.99,
    pear: 1.03,
    marquise: 0.93,
    heart: 0.96,
    trilliant: 0.84,
    old_european: 0.88,
    old_mine: 0.86,
    cushion: 1,
    cushion_brilliant: 1,
    square_cushion: 1,
    radiant: 1.02,
    sq_radiant: 1,
    princess: 0.9,
    half_moon: 0.82,
    shield: 0.8,
    hexagonal: 0.81,
    hexagonal_dutch: 0.85,
    emerald: 0.96,
    asscher: 1.02,
    baguette: 0.78,
    tapered_baguette: 0.76,
    carre: 0.86,
    rose: 0.75,
    briolette: 0.72,
    flower: 0.82,
    freeform: 0.72,
    portuguese: 0.88,
    flanders: 0.85
  };
  var FANCY_COLOR_BASE = {
    yellow_fl: { ws1: 95, scale: 0.91, label: "Fancy Light Yellow" },
    yellow_f: { ws1: 140, scale: 0.91, label: "Fancy Yellow" },
    yellow_fi: { ws1: 255, scale: 1, label: "Fancy Intense Yellow" },
    yellow_fv: { ws1: 375, scale: 0.87, label: "Fancy Vivid Yellow" },
    pink_fl: { ws1: 150, scale: 0.91, label: "Fancy Light Pink" },
    pink_f: { ws1: 220, scale: 0.91, label: "Fancy Pink" },
    pink_fi: { ws1: 330, scale: 0.9, label: "Fancy Intense Pink" },
    pink_fv: { ws1: 500, scale: 0.88, label: "Fancy Vivid Pink" },
    blue_fl: { ws1: 175, scale: 0.92, label: "Fancy Light Blue" },
    blue_f: { ws1: 240, scale: 0.92, label: "Fancy Blue" },
    blue_fi: { ws1: 330, scale: 0.92, label: "Fancy Intense Blue" },
    blue_fv: { ws1: 450, scale: 0.9, label: "Fancy Vivid Blue" },
    green_fl: { ws1: 155, scale: 0.9, label: "Fancy Light / Greyish Green" },
    green_f: { ws1: 220, scale: 0.92, label: "Fancy Green" },
    green_fi: { ws1: 400, scale: 0.92, label: "Fancy Intense Green" },
    green_fv: { ws1: 525, scale: 0.9, label: "Fancy Vivid Green" },
    orange_fl: { ws1: 140, scale: 0.95, label: "Fancy Light Orange" },
    orange_f: { ws1: 275, scale: 1, label: "Fancy Orange" },
    orange_fi: { ws1: 475, scale: 1.02, label: "Fancy Intense Orange" },
    orange_fv: { ws1: 700, scale: 1, label: "Fancy Vivid Orange" },
    purple_fl: { ws1: 225, scale: 1.02, label: "Fancy Light Purple/Violet" },
    purple_f: { ws1: 450, scale: 1.05, label: "Fancy Purple/Violet" },
    purple_fi: { ws1: 900, scale: 1.08, label: "Fancy Intense Purple/Violet" },
    brown_f: { ws1: 60, scale: 0.95, label: "Fancy Brown / Champagne" },
    black: { ws1: 45, scale: 1, label: "Black Diamond" },
    red_purp: { ws1: 390, scale: 1.1, label: "Fancy Purplish / Brownish Red" },
    red_f: { ws1: 625, scale: 1.2, label: "Fancy Red" },
    red_fv: { ws1: 950, scale: 1.25, label: "Fancy Vivid Red" }
  };
  var FANCY_LABEL_MAP = {
    "fancy vivid pink": "pink_fv",
    "vivid pink": "pink_fv",
    "fancy intense pink": "pink_fi",
    "intense pink": "pink_fi",
    "fancy light pink": "pink_fl",
    "light pink": "pink_fl",
    "fancy pink": "pink_f",
    "pink": "pink_f",
    "fancy vivid yellow": "yellow_fv",
    "vivid yellow": "yellow_fv",
    "fancy intense yellow": "yellow_fi",
    "intense yellow": "yellow_fi",
    "fancy light yellow": "yellow_fl",
    "light yellow": "yellow_fl",
    "fancy yellow": "yellow_f",
    "yellow": "yellow_f",
    "fancy vivid blue": "blue_fv",
    "vivid blue": "blue_fv",
    "fancy intense blue": "blue_fi",
    "intense blue": "blue_fi",
    "fancy light blue": "blue_fl",
    "light blue": "blue_fl",
    "fancy blue": "blue_f",
    "blue": "blue_f",
    "fancy intense green": "green_fi",
    "fancy vivid green": "green_fv",
    "fancy intense greyish green": "green_fi",
    "fancy green": "green_f",
    "fancy red": "red_f",
    // Brownish and modifier variants — NOTE: modifier penalty applied separately, not via key remapping
    "fancy intense brownish pink": "pink_fi",
    "brownish pink": "pink_f",
    "fancy vivid orange": "orange_fv",
    "fancy intense orange": "orange_fi",
    "fancy orange": "orange_f"
  };
  function supplierKey(row) {
    const section = row.section || "";
    const lastHyphen = section.lastIndexOf(" - ");
    const lastEm = section.lastIndexOf(" \u2014 ");
    const lastDash = Math.max(lastHyphen, lastEm);
    const raw = lastDash >= 0 ? section.slice(lastDash + 3).trim() : section.split(",")[0].trim();
    const norm = raw.replace(/\s*\([^)]+\)\s*$/, "").trim().toLowerCase();
    if (norm.includes("messi") || norm.includes("wuzhou")) return "messi";
    if (norm.includes("starsgem") || norm.includes("stargem")) return "starsgem";
    if (norm.includes("mishang")) return "mishang";
    if (norm.includes("goldleaf")) return "goldleaf";
    return norm || "_unknown";
  }
  var MAX_PER_SUPPLIER = 2;
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
  function buildOtherFactoryExactList(exactAdjustedOrdered, floorSupplierKey, queryCarat) {
    return exactAdjustedOrdered.filter((adj) => supplierKey(adj.row) !== floorSupplierKey).map((adj) => {
      const estimatedPrice = Math.round(Math.exp(adj.logEstimate));
      const hasModifier = caratGapNeedsExactAdjustment(queryCarat, adj.row?.carat) || adj.parts && adj.parts.length;
      return {
        row: adj.row,
        listingPrice: adj.row.priceUsd,
        estimatedPrice,
        url: adj.row.url,
        label: shortLabel(adj.row),
        supplierKey: supplierKey(adj.row),
        modifiers: hasModifier ? {
          combined: Math.exp(adj.logEstimate - Math.log(adj.row.priceUsd)),
          estimated: estimatedPrice,
          parts: adj.parts
        } : null
      };
    });
  }
  function selectCheapestExactEnsemble(exactScored, maxN = MAX_ENSEMBLE) {
    return [...exactScored].sort((a, b) => a.row.priceUsd - b.row.priceUsd || a.score - b.score).slice(0, maxN);
  }
  var SPECIALTY_SHAPE_KEYS = /* @__PURE__ */ new Set([
    "moval",
    "trilliant",
    "half_moon",
    "shield",
    "hexagonal",
    "hexagonal_dutch",
    "old_european",
    "old_mine",
    "rose",
    "briolette",
    "flower",
    "freeform",
    "portuguese",
    "flanders",
    "baguette",
    "tapered_baguette",
    "carre"
  ]);
  var AXIS_SIGMA = {
    caratPerLogUnit: 0.12,
    // per |log(queryCt/compCt)|
    caratLargeExtrapolation: 0.28,
    // additional per log unit beyond 0.5 (heavy-tail penalty)
    whiteColorPerStep: 0.07,
    // per white grade ordinal step
    fancyIntensityPerLevel: 0.25,
    // per intensity level gap (light→fancy→intense→vivid)
    fancyModifierPerTerm: 0.12,
    // per modifier term (brownish, greyish, etc.)
    clarityWhitePerStep: 0.06,
    // per clarity ordinal step (white)
    clarityFancyPerStep: 0.04,
    // per clarity ordinal step (fancy color, compressed)
    shapeSame: 0.05,
    // same shape
    shapeFamily: 0.12,
    // same shape family (e.g., cushion ↔ cushion_brilliant)
    shapeAdjacent: 0.2,
    // adjacent families (e.g., cushion ↔ radiant)
    shapeCross: 0.4,
    // cross-family (e.g., round ↔ marquise) — increased to reflect real transfer risk
    sourceHigh: 0.03,
    sourceMediumHigh: 0.06,
    sourceMedium: 0.1,
    sourceLowMedium: 0.18,
    sourceLow: 0.25,
    caratBand: 0.05,
    clarityBand: 0.08
  };
  var SIGMA_SYSTEMATIC_FLOOR = 0.1;
  var SIGMA_CALIBRATION_FACTOR = 2;
  var MAX_SUPPLIER_WEIGHT_FRAC = 0.65;
  var CARAT_THRESHOLDS = [0.5, 0.75, 1, 1.5, 2, 3, 4, 5];
  function nearCaratThreshold(ct, tol = 0.05) {
    return CARAT_THRESHOLDS.some((t) => Math.abs(ct - t) <= tol);
  }
  var SCORE_HARD_CUTOFF = 0.6;
  var MAX_ENSEMBLE = 5;
  var MODIFIER_TERMS = ["brownish", "greyish", "grayish", "orangy", "purplish", "yellowish", "pinkish", "bluish"];
  var MODIFIER_LOG_DELTA = {
    brownish: Math.log(0.82),
    // ~−20%
    greyish: Math.log(0.87),
    // ~−14%
    grayish: Math.log(0.87),
    orangy: Math.log(0.9),
    // ~−10%
    purplish: Math.log(0.88),
    // ~−12%
    yellowish: Math.log(0.91),
    // ~−9%
    pinkish: Math.log(0.93),
    // ~−7%
    bluish: Math.log(0.93)
  };
  var INTENSITY_RANK = { fl: 0, f: 1, fi: 2, fv: 3 };
  function parseFancyColorLabel(label) {
    if (!label) return { hue: null, intensityKey: null, modifierTerms: [], colorKey: null };
    const s = label.toLowerCase().trim();
    const compactMatch = s.match(/^([a-z]+)_(fl|fi|fv|f)$/);
    if (compactMatch) {
      const hue2 = compactMatch[1];
      const intensityKey2 = compactMatch[2];
      const colorKey2 = `${hue2}_${intensityKey2}`;
      return {
        hue: hue2,
        intensityKey: intensityKey2,
        modifierTerms: [],
        colorKey: FANCY_COLOR_BASE[colorKey2] ? colorKey2 : null
      };
    }
    const modifierTerms = MODIFIER_TERMS.filter((m) => s.includes(m));
    let hue = null;
    if (s.includes("pink")) hue = "pink";
    else if (s.includes("yellow")) hue = "yellow";
    else if (s.includes("blue")) hue = "blue";
    else if (s.includes("green")) hue = "green";
    else if (s.includes("orange")) hue = "orange";
    else if (s.includes("purple") || s.includes("violet")) hue = "purple";
    else if (s.includes("red")) hue = "red";
    else if (s.includes("brown") || s.includes("champagne")) hue = "brown";
    else if (s.includes("black")) hue = "black";
    let intensityKey = "f";
    if (s.includes("vivid")) intensityKey = "fv";
    else if (s.includes("intense")) intensityKey = "fi";
    else if (s.includes("light")) intensityKey = "fl";
    const colorKey = hue ? `${hue}_${intensityKey}` in FANCY_COLOR_BASE ? `${hue}_${intensityKey}` : null : null;
    return { hue, intensityKey, modifierTerms, colorKey };
  }
  function inferFancyFamilyKey(colorLabel) {
    if (!colorLabel) return null;
    const cl = colorLabel.toLowerCase().trim();
    if (FANCY_LABEL_MAP[cl]) return FANCY_LABEL_MAP[cl];
    const { colorKey } = parseFancyColorLabel(colorLabel);
    return colorKey && FANCY_COLOR_BASE[colorKey] ? colorKey : null;
  }
  var MIN_FIT_KNOTS = 3;
  var MIN_CARAT_RANGE = 1;
  var SLOPE_PRIOR_WEIGHT = 3;
  function weightedMedian(values, weights) {
    const pairs = values.map((v, i) => ({ v, w: weights[i] ?? 1 })).filter((p) => Number.isFinite(p.v) && p.w > 0).sort((a, b) => a.v - b.v);
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
    if (query.colorFamily === "white") {
      const cn = row.colorNormalized || "D";
      const compGrade = cn === "DEF" || cn === "DE" ? "E" : cn;
      const qColor = WHITE_GRADE_MULT[query.whiteGrade] ?? WHITE_GRADE_MULT.E;
      const cColor = WHITE_GRADE_MULT[compGrade] ?? WHITE_GRADE_MULT.D;
      y += Math.log(qColor / Math.max(cColor, 0.01));
      const qClarity = getClarityMult(query.clarity, row.carat);
      const cClarity = getClarityMult(row.clarity || "VS1", row.carat);
      y += Math.log(qClarity / Math.max(cClarity, 0.01));
      const qShape = SHAPE_MULT_WHITE[query.shape] ?? 1;
      const cShape = SHAPE_MULT_WHITE[row.shape] ?? 1;
      y += Math.log(qShape / Math.max(cShape, 0.01));
    } else {
      const qShape = SHAPE_MULT_COLOR[query.shape] ?? 1;
      const cShape = SHAPE_MULT_COLOR[row.shape] ?? 1;
      y += Math.log(qShape / Math.max(cShape, 0.01));
    }
    return y;
  }
  function fitLocalCaratSlope(candidates, query, prior = 0.8) {
    if (!candidates || !candidates.length) return null;
    const clarityRankQ = CLARITY_RANK_NUM[query.clarity] ?? 2;
    const pool = candidates.filter((row) => {
      if (row.caratBand || row.clarityBand) return false;
      if (!row.carat || !row.priceUsd || row.carat <= 0 || row.priceUsd <= 0) return false;
      if (shapeDistance(query.shape, row.shape) > 1) return false;
      const clarityRankC = CLARITY_RANK_NUM[row.clarity] ?? 2;
      if (Math.abs(clarityRankQ - clarityRankC) > 2) return false;
      return true;
    });
    const byBin = /* @__PURE__ */ new Map();
    for (const row of pool) {
      const bin = Math.round(row.carat * 4) / 4;
      if (!byBin.has(bin)) byBin.set(bin, []);
      byBin.get(bin).push(row);
    }
    if (byBin.size < MIN_FIT_KNOTS) return null;
    const points = [];
    const sourceSet = /* @__PURE__ */ new Set();
    for (const [bin, rows] of byBin.entries()) {
      const values = [];
      const weights2 = [];
      for (const row of rows) {
        const y2 = normalizedLogDpcForCurve(row, query);
        if (!Number.isFinite(y2)) continue;
        values.push(y2);
        weights2.push(Math.min(row.count || 1, 4));
        sourceSet.add(supplierKey(row));
      }
      const y = weightedMedian(values, weights2);
      if (y != null) {
        points.push({
          carat: bin,
          x: Math.log(bin),
          y,
          rowCount: rows.length,
          sourceCount: new Set(rows.map(supplierKey)).size
        });
      }
    }
    points.sort((a, b) => a.carat - b.carat);
    if (points.length < MIN_FIT_KNOTS) return null;
    const caratMin = points[0].carat;
    const caratMax = points[points.length - 1].carat;
    const caratRange = caratMax - caratMin;
    if (caratRange < MIN_CARAT_RANGE) return null;
    const weights = points.map((p) => 1 / (0.25 + Math.abs(Math.log(query.carat / p.carat))));
    const totalW = weights.reduce((a, b) => a + b, 0);
    const xMean = points.reduce((s, p, i) => s + p.x * weights[i], 0) / totalW;
    const yMean = points.reduce((s, p, i) => s + p.y * weights[i], 0) / totalW;
    const ssxx = points.reduce((s, p, i) => s + weights[i] * (p.x - xMean) ** 2, 0);
    const ssxy = points.reduce((s, p, i) => s + weights[i] * (p.x - xMean) * (p.y - yMean), 0);
    if (ssxx < 1e-6) return null;
    const rawSlope = ssxy / ssxx;
    const dataN = points.length;
    const shrinkFrac = SLOPE_PRIOR_WEIGHT / (SLOPE_PRIOR_WEIGHT + dataN);
    const slope = shrinkFrac * prior + (1 - shrinkFrac) * rawSlope;
    const clampedSlope = Math.max(-0.2, Math.min(2, slope));
    const queryIsExtrapolated = query.carat < caratMin - 0.25 || query.carat > caratMax + 0.25;
    const sourceCount = sourceSet.size;
    const confidence = dataN >= 10 && sourceCount >= 2 && caratRange >= 2 ? "high" : dataN >= 5 && caratRange >= 1.5 ? "medium" : "low";
    if (query.carat >= 5) {
      const highKnots = points.filter((p) => p.carat >= 4).length;
      if (highKnots < 2) return null;
    }
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
      normalized: true
    };
  }
  var CARAT_SLOPE_POLICY = {
    priorBelow5ct: 0.8,
    prior5ctPlus: 0.65,
    minSourceCountToApply: 2,
    maxAppliedDeviation: 0.25,
    extrapolationShrink: 0.15
  };
  function caratPriorForQuery(carat) {
    return carat >= 5 ? CARAT_SLOPE_POLICY.prior5ctPlus : CARAT_SLOPE_POLICY.priorBelow5ct;
  }
  var MODE_SIGMA_BOOST = {
    prior_only: 0,
    fitted: 0,
    fitted_capped: 0.04,
    shrunk_low_confidence: 0.06,
    shrunk_single_source: 0.08,
    shrunk_extrapolated: 0.1,
    ignored_fallback_prior: 0.12
  };
  function resolveEffectiveCaratSlope(curve, query) {
    const prior = caratPriorForQuery(query.carat);
    if (!curve) {
      return { slope: prior, mode: "prior_only", prior, rawFitted: null };
    }
    const raw = curve.slope;
    if (curve.confidence === "low" && curve.queryIsExtrapolated) {
      return { slope: prior, mode: "ignored_fallback_prior", prior, rawFitted: raw };
    }
    if (curve.queryIsExtrapolated && curve.confidence !== "high") {
      const slope2 = prior + CARAT_SLOPE_POLICY.extrapolationShrink * (raw - prior);
      return { slope: slope2, mode: "shrunk_extrapolated", prior, rawFitted: raw };
    }
    if (curve.sourceCount < CARAT_SLOPE_POLICY.minSourceCountToApply) {
      const slope2 = prior + 0.35 * (raw - prior);
      return { slope: slope2, mode: "shrunk_single_source", prior, rawFitted: raw };
    }
    if (curve.confidence === "low") {
      const slope2 = prior + 0.25 * (raw - prior);
      return { slope: slope2, mode: "shrunk_low_confidence", prior, rawFitted: raw };
    }
    let slope = raw;
    let mode = "fitted";
    if (Math.abs(slope - prior) > CARAT_SLOPE_POLICY.maxAppliedDeviation) {
      slope = prior + Math.sign(slope - prior) * CARAT_SLOPE_POLICY.maxAppliedDeviation;
      mode = "fitted_capped";
    }
    return { slope, mode, prior, rawFitted: raw };
  }
  var SHAPE_FAMILY_MAP = {
    round: "ROUND",
    old_european: "ROUND",
    old_mine: "ROUND",
    oval: "OVAL_CUSHION",
    cushion: "OVAL_CUSHION",
    elongated_cushion: "OVAL_CUSHION",
    moval: "OVAL_CUSHION",
    cushion_brilliant: "OVAL_CUSHION",
    square_cushion: "OVAL_CUSHION",
    radiant: "RADIANT",
    sq_radiant: "RADIANT",
    pear: "PEAR",
    marquise: "MARQUISE",
    trilliant: "MARQUISE",
    heart: "HEART",
    emerald: "STEP",
    asscher: "STEP",
    baguette: "STEP_BAGUETTE",
    tapered_baguette: "STEP_BAGUETTE",
    carre: "STEP_BAGUETTE",
    princess: "PRINCESS",
    // Specialty shapes → SPECIALTY (no cross-shape adjustment)
    portuguese: "SPECIALTY",
    hexagonal: "SPECIALTY",
    hexagonal_dutch: "SPECIALTY",
    half_moon: "SPECIALTY",
    shield: "SPECIALTY",
    rose: "SPECIALTY",
    flower: "SPECIALTY",
    freeform: "SPECIALTY",
    briolette: "SPECIALTY",
    flanders: "SPECIALTY"
  };
  var ADJACENT_FAMILIES = {
    ROUND: /* @__PURE__ */ new Set(["OVAL_CUSHION"]),
    OVAL_CUSHION: /* @__PURE__ */ new Set(["ROUND", "RADIANT", "STEP"]),
    RADIANT: /* @__PURE__ */ new Set(["OVAL_CUSHION", "PRINCESS", "STEP"]),
    PEAR: /* @__PURE__ */ new Set(["MARQUISE", "OVAL_CUSHION"]),
    MARQUISE: /* @__PURE__ */ new Set(["PEAR", "HEART"]),
    HEART: /* @__PURE__ */ new Set(["MARQUISE", "PEAR"]),
    STEP: /* @__PURE__ */ new Set(["OVAL_CUSHION", "RADIANT", "PRINCESS", "STEP_BAGUETTE"]),
    PRINCESS: /* @__PURE__ */ new Set(["RADIANT", "STEP"]),
    STEP_BAGUETTE: /* @__PURE__ */ new Set(["STEP"])
  };
  function shapeDistance(userShape, compShape) {
    if (userShape === compShape) return 0;
    const fU = SHAPE_FAMILY_MAP[userShape];
    const fC = SHAPE_FAMILY_MAP[compShape];
    if (!fU || !fC || fU === "SPECIALTY" || fC === "SPECIALTY") return 3;
    if (fU === fC) return 1;
    if (ADJACENT_FAMILIES[fU]?.has(fC)) return 2;
    return 3;
  }
  function shapeSigma(userShape, compShape) {
    return [AXIS_SIGMA.shapeSame, AXIS_SIGMA.shapeFamily, AXIS_SIGMA.shapeAdjacent, AXIS_SIGMA.shapeCross][shapeDistance(userShape, compShape)];
  }
  var SHAPE_NORMALIZE = {
    sq_radiant: "radiant",
    cushion_brilliant: "cushion",
    square_cushion: "cushion",
    trilliant: "marquise",
    old_european: "round",
    old_mine: "round"
  };
  function normalizeShapeForComp(s) {
    return SHAPE_NORMALIZE[s] || s;
  }
  function getClarityMult(clarity, ct) {
    const vals = CLARITY_CARAT_MULTS_W[clarity];
    if (!vals) return 1;
    const knots = CLARITY_CARAT_KNOTS_W;
    if (ct <= knots[0]) return vals[0];
    if (ct >= knots[knots.length - 1]) return vals[vals.length - 1];
    for (let i = 0; i < knots.length - 1; i++) {
      if (ct <= knots[i + 1]) {
        const t = (ct - knots[i]) / (knots[i + 1] - knots[i]);
        return vals[i] + (vals[i + 1] - vals[i]) * t;
      }
    }
    return 1;
  }
  function shortLabel(row) {
    if (!row || !row.section) return "Alibaba";
    const dashIdx = Math.max(row.section.lastIndexOf(" - "), row.section.lastIndexOf(" \u2014 "));
    return dashIdx >= 0 ? row.section.slice(dashIdx + 3).trim() : row.section.split(",")[0].trim();
  }
  function compIdentity(row) {
    if (row.productId) return `pid:${row.productId}`;
    const bits = [
      row.sourceType || row.supplier || row.label || "comp",
      row.shape || "",
      row.color || row.colorNormalized || row.appColorKey || "",
      row.clarity || "",
      row.carat ?? "",
      row.priceUsd ?? "",
      row.section || ""
    ];
    return bits.map((v) => String(v).toLowerCase().trim()).join("|");
  }
  function sourceErrorSigma(confidence) {
    return {
      high: AXIS_SIGMA.sourceHigh,
      "medium-high": AXIS_SIGMA.sourceMediumHigh,
      medium: AXIS_SIGMA.sourceMedium,
      "low-medium": AXIS_SIGMA.sourceLowMedium,
      low: AXIS_SIGMA.sourceLow
    }[confidence] ?? AXIS_SIGMA.sourceMedium;
  }
  function whiteColorDistance(queryGrade, compColorNormalized) {
    const uR = WHITE_COLOR_GRADE_NUM[queryGrade] ?? 2;
    const cR = WHITE_COLOR_GRADE_NUM[compColorNormalized || "D"] ?? 0;
    return Math.abs(uR - cR);
  }
  function fancyHueCompatible(queryKey, compColorLabel) {
    if (!compColorLabel) return false;
    const rl = compColorLabel.toLowerCase();
    const uf = (queryKey || "").toLowerCase();
    if (uf.includes("pink") && !rl.includes("pink")) return false;
    if (uf.includes("yellow") && !rl.includes("yellow")) return false;
    if (uf.includes("blue") && !rl.includes("blue")) return false;
    if (uf.includes("green") && !rl.includes("green")) return false;
    if (uf.includes("orange") && !rl.includes("orange")) return false;
    if (uf.includes("red") && !rl.includes("red")) return false;
    if (uf.includes("purple") && !rl.includes("purple") && !rl.includes("violet")) return false;
    return true;
  }
  function filterCandidates(query, comps) {
    return comps.filter((row) => {
      if (row.colorFamily !== query.colorFamily) return false;
      if (query.colorFamily === "fancy" && !fancyHueCompatible(query.colorFamily_key, row.color)) return false;
      if (query.colorFamily === "white") {
        if (whiteColorDistance(query.whiteGrade, row.colorNormalized) > 5) return false;
      }
      return true;
    });
  }
  var LOG_PART_MIN = 1e-3;
  var EXACT_CARAT_ADJ_EPSILON = 5e-3;
  function caratTolerance(queryCt, compCt) {
    const anchor = Math.max(queryCt || 0, compCt || 0);
    if (anchor <= 2) return 0.08;
    if (anchor <= 6) return 0.18;
    return 0.25;
  }
  function caratGapNeedsExactAdjustment(queryCt, compCt) {
    return Math.abs(queryCt - (compCt || 0)) >= EXACT_CARAT_ADJ_EPSILON;
  }
  function isExactMatch(query, row) {
    if (row.caratBand) return false;
    if (Math.abs(query.carat - (row.carat || 0)) > caratTolerance(query.carat, row.carat)) return false;
    if (row.clarityBand) return false;
    if (row.clarity !== query.clarity) return false;
    if (shapeDistance(query.shape, row.shape) !== 0) return false;
    if (query.colorFamily === "white") {
      const cn = row.colorNormalized || "D";
      if (cn === "D" || cn === null) return query.whiteGrade === "D";
      if (cn === "E") return query.whiteGrade === "E";
      if (cn === "F") return query.whiteGrade === "F";
      if (cn === "DE") return query.whiteGrade === "D" || query.whiteGrade === "E";
      if (cn === "DEF") return ["D", "E", "F"].includes(query.whiteGrade);
      return false;
    }
    return true;
  }
  function compErrorScore(query, row) {
    const compCt = row.carat || 1;
    const logCaratRatio = Math.abs(Math.log(query.carat / compCt));
    const eCarat = logCaratRatio * AXIS_SIGMA.caratPerLogUnit + Math.max(0, logCaratRatio - 0.5) * AXIS_SIGMA.caratLargeExtrapolation;
    let eColor;
    if (query.colorFamily === "white") {
      const steps = whiteColorDistance(query.whiteGrade, row.colorNormalized);
      eColor = steps * AXIS_SIGMA.whiteColorPerStep;
    } else {
      const userParsed = parseFancyColorLabel(query.colorFamily_key || "");
      const compParsed = parseFancyColorLabel(row.color || "");
      const uInt = INTENSITY_RANK[userParsed.intensityKey] ?? 1;
      const cInt = INTENSITY_RANK[compParsed.intensityKey] ?? 1;
      const intensityGap = Math.abs(uInt - cInt);
      const modifierDiff = Math.abs(compParsed.modifierTerms.length - userParsed.modifierTerms.length);
      eColor = intensityGap * AXIS_SIGMA.fancyIntensityPerLevel + modifierDiff * AXIS_SIGMA.fancyModifierPerTerm;
    }
    const clarU = CLARITY_RANK_NUM[query.clarity] ?? 2;
    const clarC = CLARITY_RANK_NUM[row.clarity] ?? 2;
    const clarityGap = Math.abs(clarU - clarC);
    const clarPerStep = query.colorFamily === "white" ? AXIS_SIGMA.clarityWhitePerStep : AXIS_SIGMA.clarityFancyPerStep;
    const eClarity = clarityGap * clarPerStep;
    const eShape = shapeSigma(query.shape, row.shape);
    const eSource = sourceErrorSigma(row.confidence);
    const eBand = (row.caratBand ? AXIS_SIGMA.caratBand : 0) + (row.clarityBand ? AXIS_SIGMA.clarityBand : 0);
    const total = Math.sqrt(eCarat ** 2 + eColor ** 2 + eClarity ** 2 + eShape ** 2 + eSource ** 2 + eBand ** 2);
    return { total, eCarat, eColor, eClarity, eShape, eSource, eBand };
  }
  function adjustCompToQuery(query, row, context = {}) {
    const compCt = row.carat || 1;
    const queryCt = query.carat;
    const logDpcComp = Math.log(row.priceUsd / compCt);
    const parts = [];
    let logDpcAdj = logDpcComp;
    let sigmaCarat, sigmaColor, sigmaClarity, sigmaShape;
    const logCaratRatio = Math.log(queryCt / compCt);
    const absLogCaratRatio = Math.abs(logCaratRatio);
    if (query.colorFamily === "white") {
      const fallbackPrior = caratPriorForQuery(queryCt);
      const caratSlope = context.localCaratSlope ?? fallbackPrior;
      const deltaCarat = caratSlope * logCaratRatio;
      let modeBoost;
      if (context.localCaratSlopeMode != null) {
        modeBoost = MODE_SIGMA_BOOST[context.localCaratSlopeMode] ?? 0.05;
      } else {
        const effectivePrior = context.localCaratSlopePrior ?? 0.8;
        modeBoost = context.localCaratSlope != null ? Math.abs(context.localCaratSlope - effectivePrior) * 0.1 : 0;
        modeBoost += context.localCaratExtrapolated ? 0.08 : 0;
      }
      sigmaCarat = absLogCaratRatio * AXIS_SIGMA.caratPerLogUnit + Math.max(0, absLogCaratRatio - 0.5) * AXIS_SIGMA.caratLargeExtrapolation + modeBoost;
      logDpcAdj += deltaCarat;
      const slopeNote = context.localCaratSlope != null ? ` slope=${caratSlope.toFixed(2)}` : "";
      const totalCaratFactor = Math.exp(logCaratRatio + deltaCarat);
      if (Math.abs(deltaCarat) > LOG_PART_MIN)
        parts.push(`carat total \xD7${totalCaratFactor.toFixed(3)} (price/ct \xD7${Math.exp(deltaCarat).toFixed(3)}; ${queryCt}ct vs ${compCt}ct${slopeNote})`);
      const cn = row.colorNormalized || "D";
      const compGrade = cn === "DEF" || cn === "DE" ? "E" : cn;
      const uMult = WHITE_GRADE_MULT[query.whiteGrade] ?? 0.7;
      const cMult = WHITE_GRADE_MULT[compGrade] ?? WHITE_GRADE_MULT.D;
      const deltaColor = Math.log(uMult / cMult);
      const gradeSteps = whiteColorDistance(query.whiteGrade, cn);
      sigmaColor = gradeSteps * AXIS_SIGMA.whiteColorPerStep;
      logDpcAdj += deltaColor;
      if (Math.abs(deltaColor) > LOG_PART_MIN)
        parts.push(`color \xD7${Math.exp(deltaColor).toFixed(3)} (${query.whiteGrade} vs ${cn})`);
    } else {
      const ub = FANCY_COLOR_BASE[query.colorFamily_key];
      const compKey = inferFancyFamilyKey(row.color);
      const cb = compKey ? FANCY_COLOR_BASE[compKey] : null;
      if (ub && cb) {
        const logModelQ = Math.log(ub.ws1) + (ub.scale - 1) * Math.log(queryCt);
        const logModelC = Math.log(cb.ws1) + (cb.scale - 1) * Math.log(compCt);
        const deltaIntensityCarat = logModelQ - logModelC;
        logDpcAdj += deltaIntensityCarat;
        if (Math.abs(deltaIntensityCarat) > LOG_PART_MIN)
          parts.push(`intensity+carat \xD7${Math.exp(deltaIntensityCarat).toFixed(3)} (${query.colorFamily_key} vs ${compKey})`);
      } else {
        const delta = 0.5 * logCaratRatio;
        logDpcAdj += delta;
        if (Math.abs(delta) > LOG_PART_MIN)
          parts.push(`carat \xD7${Math.exp(delta).toFixed(3)} (${queryCt}ct vs ${compCt}ct, model unknown)`);
      }
      const userParsed = parseFancyColorLabel(query.colorFamily_key || "");
      const compParsed = parseFancyColorLabel(row.color || "");
      let deltaModifier = 0;
      for (const m of compParsed.modifierTerms) {
        if (!userParsed.modifierTerms.includes(m)) {
          deltaModifier -= MODIFIER_LOG_DELTA[m] || 0;
        }
      }
      for (const m of userParsed.modifierTerms) {
        if (!compParsed.modifierTerms.includes(m)) {
          deltaModifier += MODIFIER_LOG_DELTA[m] || 0;
        }
      }
      if (Math.abs(deltaModifier) > LOG_PART_MIN)
        parts.push(`modifier \xD7${Math.exp(deltaModifier).toFixed(3)}`);
      logDpcAdj += deltaModifier;
      const uInt = INTENSITY_RANK[userParsed.intensityKey ?? "f"] ?? 1;
      const cIntParsed = parseFancyColorLabel(row.color || "");
      const cInt = INTENSITY_RANK[cIntParsed.intensityKey ?? "f"] ?? 1;
      const intensityGap = Math.abs(uInt - cInt);
      const modDiff = Math.abs(compParsed.modifierTerms.length - userParsed.modifierTerms.length);
      sigmaColor = intensityGap * AXIS_SIGMA.fancyIntensityPerLevel + modDiff * AXIS_SIGMA.fancyModifierPerTerm;
      sigmaCarat = absLogCaratRatio * AXIS_SIGMA.caratPerLogUnit + Math.max(0, absLogCaratRatio - 0.5) * AXIS_SIGMA.caratLargeExtrapolation;
    }
    let deltaClarity;
    if (query.colorFamily === "white") {
      const clarU = getClarityMult(query.clarity, queryCt);
      const clarC = getClarityMult(row.clarity || "VS1", queryCt);
      deltaClarity = Math.log(clarU / Math.max(clarC, 0.01));
    } else {
      const clarU = CLARITY_MULT_COLOR[query.clarity] ?? 1;
      const clarC = CLARITY_MULT_COLOR[row.clarity] ?? 1;
      deltaClarity = Math.log(clarU / Math.max(clarC, 0.01));
    }
    if (Math.abs(deltaClarity) > LOG_PART_MIN)
      parts.push(`clarity \xD7${Math.exp(deltaClarity).toFixed(3)} (selected ${query.clarity} vs comp ${row.clarity})`);
    const clarOrdinalGap = Math.abs((CLARITY_RANK_NUM[query.clarity] ?? 2) - (CLARITY_RANK_NUM[row.clarity] ?? 2));
    const clarPerStep = query.colorFamily === "white" ? AXIS_SIGMA.clarityWhitePerStep : AXIS_SIGMA.clarityFancyPerStep;
    sigmaClarity = clarOrdinalGap * clarPerStep;
    logDpcAdj += deltaClarity;
    const normShape = query.shape;
    const shapeMultWhite = SHAPE_MULT_WHITE[normShape] ?? 1;
    const shapeMultCompWhite = SHAPE_MULT_WHITE[row.shape] ?? 1;
    const shapeMultColor = SHAPE_MULT_COLOR[normShape] ?? 1;
    const shapeMultCompColor = SHAPE_MULT_COLOR[row.shape] ?? 1;
    let deltaShape;
    if (query.colorFamily === "white") {
      deltaShape = shapeMultCompWhite > 0 ? Math.log(shapeMultWhite / shapeMultCompWhite) : 0;
    } else {
      deltaShape = shapeMultCompColor > 0 ? Math.log(shapeMultColor / shapeMultCompColor) : 0;
    }
    if (Math.abs(deltaShape) > LOG_PART_MIN)
      parts.push(`shape \xD7${Math.exp(deltaShape).toFixed(3)} (${normShape} vs ${row.shape})`);
    sigmaShape = shapeSigma(query.shape, row.shape);
    logDpcAdj += deltaShape;
    const logEstimate = logDpcAdj + Math.log(queryCt);
    const estimatedPrice = Math.round(Math.exp(logEstimate));
    const sigmaSource = sourceErrorSigma(row.confidence);
    const sigmaBand = (row.caratBand ? AXIS_SIGMA.caratBand : 0) + (row.clarityBand ? AXIS_SIGMA.clarityBand : 0);
    const sigmaLog = Math.sqrt(
      (sigmaCarat || 0) ** 2 + (sigmaColor || 0) ** 2 + sigmaClarity ** 2 + sigmaShape ** 2 + sigmaSource ** 2 + sigmaBand ** 2
    );
    return { logEstimate, sigmaLog, estimatedPrice, parts };
  }
  function medianOf(arr) {
    if (!arr.length) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  function blendComps(adjustedList, options = {}) {
    if (!adjustedList.length) return null;
    const logEsts = adjustedList.map((a) => a.logEstimate);
    const medianLogEst = medianOf(logEsts);
    const skipOutlierRejection = !!options.multiSupplierExact;
    const accepted = [];
    const rejected = [];
    for (const adj of adjustedList) {
      const deviation = Math.abs(adj.logEstimate - medianLogEst);
      if (!skipOutlierRejection && adjustedList.length > 1 && deviation > 2.5 * adj.sigmaLog) {
        rejected.push({ ...adj, rejectReason: `outlier: deviation ${deviation.toFixed(3)} > 2.5\xD7\u03C3(${adj.sigmaLog.toFixed(3)})` });
      } else {
        accepted.push(adj);
      }
    }
    if (!accepted.length) {
      accepted.push(...rejected);
      rejected.length = 0;
    }
    const EPS = 1e-4;
    const rawWeights = accepted.map((adj) => 1 / (adj.sigmaLog ** 2 + EPS));
    let weights = rawWeights;
    let sourceConcentration = {
      dominated: false,
      dominantSupplier: null,
      dominantFrac: null,
      rawDominantFrac: null,
      finalDominantFrac: null,
      capApplied: false,
      capPossible: true,
      supplierFracs: {}
    };
    const hasRowInfo = accepted.some((adj) => adj.row != null);
    if (hasRowInfo) {
      const rawTotal = rawWeights.reduce((a, b) => a + b, 0);
      const supplierWeightSum = {};
      for (let i = 0; i < accepted.length; i++) {
        const sk = accepted[i].row ? supplierKey(accepted[i].row) : "_unknown";
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
          const cappedW = MAX_SUPPLIER_WEIGHT_FRAC * otherW / (1 - MAX_SUPPLIER_WEIGHT_FRAC);
          const scale = Math.min(1, cappedW / dominantW);
          weights = rawWeights.map((w, i) => {
            const sk = accepted[i].row ? supplierKey(accepted[i].row) : "_unknown";
            return sk === dominantSk ? w * scale : w;
          });
          capApplied = scale < 0.999;
        }
        const finalTotal = weights.reduce((a, b) => a + b, 0);
        const supplierFinalSum = {};
        for (let i = 0; i < accepted.length; i++) {
          const sk = accepted[i].row ? supplierKey(accepted[i].row) : "_unknown";
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
          supplierFracs
        };
      }
    }
    const totalW = weights.reduce((a, b) => a + b, 0);
    const logEstimate = accepted.reduce((sum, adj, i) => sum + adj.logEstimate * weights[i], 0) / totalW;
    const sigmaBlend = 1 / Math.sqrt(weights.reduce((sum, w) => sum + w, 0));
    const sigmaWithFloor = Math.sqrt(sigmaBlend ** 2 + SIGMA_SYSTEMATIC_FLOOR ** 2);
    const sigmaLog = sigmaWithFloor * SIGMA_CALIBRATION_FACTOR;
    const estimate = Math.round(Math.exp(logEstimate));
    const low = Math.round(Math.exp(logEstimate - 1.28 * sigmaLog));
    const high = Math.round(Math.exp(logEstimate + 1.28 * sigmaLog));
    return { logEstimate, sigmaLog, estimate, low, high, accepted, rejected, sourceConcentration };
  }
  var _compsIndex = null;
  var SUPPLEMENTAL_COMP_FILES = [
    "messi-comps.json",
    "starsgem-comps.json",
    "messi-color-comps.json"
  ];
  function mergeSupplementalComps(index, supplementalIndexes) {
    const merged = {
      ...index,
      comps: [...index.comps || []]
    };
    for (const supp of supplementalIndexes) {
      if (supp?.comps?.length) merged.comps.push(...supp.comps);
    }
    return merged;
  }
  function resolveAlibabaComp(query) {
    if (!_compsIndex) throw new Error("Index not loaded. Call loadIndex() first.");
    const comps = _compsIndex.comps;
    const normShape = normalizeShapeForComp(query.shape);
    const nq = { ...query, shape: normShape };
    const warnings = [];
    let candidates = filterCandidates(nq, comps);
    let broadened = false;
    if (!candidates.length || !candidates.some((r) => shapeDistance(normShape, r.shape) <= 2)) {
      if (!SPECIALTY_SHAPE_KEYS.has(query.shape)) {
        const broadCandidates = comps.filter((r) => {
          if (r.colorFamily !== nq.colorFamily) return false;
          if (nq.colorFamily === "fancy" && !fancyHueCompatible(nq.colorFamily_key, r.color)) return false;
          if (nq.colorFamily === "white" && whiteColorDistance(nq.whiteGrade, r.colorNormalized) > 5) return false;
          return true;
        });
        if (broadCandidates.length) {
          candidates = broadCandidates;
          broadened = true;
          warnings.push("No shape-compatible comps \u2014 broadened to any shape in same color family.");
        }
      }
    }
    if (!candidates.length) {
      return {
        matchType: "none",
        estimate: null,
        low: null,
        high: null,
        perCt: null,
        confidence: null,
        primary: null,
        alternatives: [],
        supportComps: [],
        rejectedComps: [],
        warnings: ["No comps found for this spec."],
        source: null
      };
    }
    const scored = candidates.map((row) => {
      const sc = compErrorScore(nq, row);
      return { row, score: sc.total, scoreComponents: sc };
    }).sort((a, b) => a.score - b.score || a.row.priceUsd - b.row.priceUsd);
    const seenPid = /* @__PURE__ */ new Map();
    for (const c of scored) {
      const identity = compIdentity(c.row);
      if (!seenPid.has(identity)) seenPid.set(identity, c);
    }
    const uniqueScored = [...seenPid.values()].sort((a, b) => a.score - b.score);
    const bestScore = uniqueScored[0].score;
    const localCaratCurve = nq.colorFamily === "white" ? fitLocalCaratSlope(candidates, nq, caratPriorForQuery(nq.carat)) : null;
    const effective = nq.colorFamily === "white" ? resolveEffectiveCaratSlope(localCaratCurve, nq) : null;
    if (localCaratCurve?.queryIsExtrapolated) {
      const dir = nq.carat > localCaratCurve.caratMax ? "above" : "below";
      warnings.push(`Carat ${nq.carat}ct is ${dir} the local comp range (${localCaratCurve.caratMin.toFixed(1)}\u2013${localCaratCurve.caratMax.toFixed(1)}ct). Extrapolation uncertainty is high.`);
    }
    if (localCaratCurve?.rawSlope != null && effective && Math.abs(localCaratCurve.rawSlope - effective.prior) > 0.3) {
      warnings.push(`Local carat slope ${localCaratCurve.rawSlope.toFixed(2)} differs materially from the ${effective.prior} prior; inspect comp support.`);
    }
    if (nearCaratThreshold(nq.carat)) {
      warnings.push(`${nq.carat}ct is near a market carat threshold \u2014 spot price may carry a premium not reflected in nearby comps.`);
    }
    const adjContext = {
      localCaratSlope: effective ? effective.slope : null,
      localCaratExtrapolated: !!localCaratCurve?.queryIsExtrapolated,
      localCaratSlopeMode: effective ? effective.mode : null,
      localCaratSlopePrior: effective ? effective.prior : null,
      localCaratSlopeRaw: effective ? effective.rawFitted : null
    };
    const exactPool = uniqueScored.filter((c) => isExactMatch(nq, c.row) && c.score < 0.1);
    const fallbackPool = uniqueScored.filter((c) => !isExactMatch(nq, c.row) || c.score >= 0.1);
    const supplierCappedFallback = applySupplierCap(fallbackPool);
    const supplierCapped = exactPool.length ? [...exactPool, ...supplierCappedFallback].sort((a, b) => a.score - b.score) : supplierCappedFallback;
    const exactScored = supplierCapped.filter((c) => isExactMatch(nq, c.row) && c.score < 0.1);
    let selected = exactScored.length ? selectCheapestExactEnsemble(exactScored, MAX_ENSEMBLE) : supplierCapped.filter((c) => c.score <= SCORE_HARD_CUTOFF).slice(0, MAX_ENSEMBLE);
    if (!selected.length) {
      selected = supplierCapped.slice(0, Math.min(3, supplierCapped.length));
      warnings.push("No close comps found \u2014 estimate is highly extrapolated.");
    }
    const adjustedList = selected.map(({ row, score, scoreComponents }) => {
      const adj = adjustCompToQuery(nq, row, adjContext);
      return { ...adj, row, score, scoreComponents };
    });
    const blend = blendComps(adjustedList);
    if (!blend) {
      return {
        matchType: "none",
        estimate: null,
        low: null,
        high: null,
        perCt: null,
        confidence: null,
        primary: null,
        alternatives: [],
        supportComps: [],
        rejectedComps: [],
        warnings: [...warnings, "Blending failed."],
        source: null
      };
    }
    if (blend.rejected.length) {
      warnings.push(`${blend.rejected.length} comp(s) rejected as outliers in log-space blend.`);
    }
    if (blend.accepted.length === 1) {
      warnings.push("Single comp in ensemble \u2014 estimate based on one data point.");
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
    const hasExact = isExactMatch(nq, uniqueScored[0].row) && bestScore < 0.1;
    let matchType;
    if (hasExact) matchType = "exact";
    else if (bestScore <= 0.2) matchType = "nearest";
    else matchType = "best_available";
    if (SPECIALTY_SHAPE_KEYS.has(query.shape) && broadened) {
      matchType = "none";
    }
    const exactAdjustedOrdered = matchType === "exact" ? exactScored.map(({ row, score, scoreComponents }) => ({
      ...adjustCompToQuery(nq, row, adjContext),
      row,
      score,
      scoreComponents
    })).sort((a, b) => {
      const aEst = Math.exp(a.logEstimate);
      const bEst = Math.exp(b.logEstimate);
      return aEst - bEst || (a.row?.priceUsd ?? 0) - (b.row?.priceUsd ?? 0) || Math.abs((a.row?.carat ?? 0) - nq.carat) - Math.abs((b.row?.carat ?? 0) - nq.carat) || a.score - b.score;
    }) : [];
    const acceptedOrdered = matchType === "exact" ? exactAdjustedOrdered : blend.accepted;
    const primaryAdj = acceptedOrdered[0];
    const floorSupplierKey = primaryAdj?.row ? supplierKey(primaryAdj.row) : null;
    const otherFactoryExact = matchType === "exact" && floorSupplierKey ? buildOtherFactoryExactList(exactAdjustedOrdered, floorSupplierKey, nq.carat) : [];
    if (otherFactoryExact.length) {
      const names = [...new Set(otherFactoryExact.map((e) => e.supplierKey))].join(", ");
      warnings.push(`Same-spec listings also at ${names} \u2014 shown below, not averaged into floor price.`);
    }
    const MAJOR_SUPPLIERS = ["messi", "starsgem"];
    const NEAREST_COMPARISON_POOL = 5;
    const supplierComparisons = [];
    for (const sk of MAJOR_SUPPLIERS) {
      const exactForSupplier = exactAdjustedOrdered.filter((adj) => supplierKey(adj.row) === sk);
      if (exactForSupplier.length) {
        const best = exactForSupplier[0];
        const usesCaratScale = caratGapNeedsExactAdjustment(nq.carat, best.row?.carat);
        const estPrice = usesCaratScale ? Math.round(Math.exp(best.logEstimate)) : best.row.priceUsd;
        supplierComparisons.push({
          supplierKey: sk,
          label: shortLabel(best.row),
          listingPrice: best.row.priceUsd,
          estimatedPrice: estPrice,
          url: best.row.url,
          row: best.row,
          matchType: "exact",
          modifiers: usesCaratScale || best.parts && best.parts.length ? { combined: Math.exp(best.logEstimate - Math.log(best.row.priceUsd)), estimated: estPrice, parts: best.parts } : null
        });
      } else {
        const topN = uniqueScored.filter((c) => supplierKey(c.row) === sk).slice(0, NEAREST_COMPARISON_POOL);
        if (topN.length) {
          let bestEntry = null;
          let bestEstPrice = Infinity;
          for (const c of topN) {
            const adj = adjustCompToQuery(nq, c.row, adjContext);
            const estPrice = Math.round(Math.exp(adj.logEstimate));
            if (estPrice < bestEstPrice) {
              bestEstPrice = estPrice;
              bestEntry = {
                supplierKey: sk,
                label: shortLabel(c.row),
                listingPrice: c.row.priceUsd,
                estimatedPrice: estPrice,
                url: c.row.url,
                row: c.row,
                matchType: "nearest",
                score: c.score,
                modifiers: {
                  combined: Math.exp(adj.logEstimate - Math.log(c.row.priceUsd)),
                  estimated: estPrice,
                  parts: adj.parts
                }
              };
            }
          }
          if (bestEntry) supplierComparisons.push(bestEntry);
        }
      }
    }
    supplierComparisons.sort((a, b) => a.estimatedPrice - b.estimatedPrice);
    const exactUsesCaratScale = matchType === "exact" && caratGapNeedsExactAdjustment(nq.carat, primaryAdj.row?.carat);
    const primaryEstPrice = matchType === "exact" ? exactUsesCaratScale ? Math.round(Math.exp(primaryAdj.logEstimate)) : primaryAdj.row.priceUsd : blend.estimate;
    const pointEstimate = matchType === "exact" ? primaryEstPrice : blend.estimate;
    const legacyModifiers = matchType === "exact" ? exactUsesCaratScale || primaryAdj.parts && primaryAdj.parts.length ? {
      combined: Math.exp(primaryAdj.logEstimate - Math.log(primaryAdj.row.priceUsd)),
      estimated: primaryEstPrice,
      parts: primaryAdj.parts
    } : null : {
      combined: Math.exp(primaryAdj.logEstimate - Math.log(primaryAdj.row.priceUsd)),
      estimated: blend.estimate,
      parts: primaryAdj.parts
    };
    const primary = {
      row: primaryAdj.row,
      listingPrice: primaryAdj.row.priceUsd,
      estimatedPrice: primaryEstPrice,
      url: primaryAdj.row.url,
      label: shortLabel(primaryAdj.row),
      modifiers: legacyModifiers,
      blendedFrom: matchType === "exact" ? exactAdjustedOrdered.length : blend.accepted.length
    };
    const alternatives = (matchType === "exact" ? acceptedOrdered.slice(1).filter((adj) => supplierKey(adj.row) === floorSupplierKey) : acceptedOrdered.slice(1)).map((adj) => ({
      row: adj.row,
      listingPrice: adj.row.priceUsd,
      estimatedPrice: Math.round(Math.exp(adj.logEstimate)),
      url: adj.row.url,
      label: shortLabel(adj.row),
      modifiers: {
        combined: Math.exp(adj.logEstimate - Math.log(adj.row.priceUsd)),
        estimated: Math.round(Math.exp(adj.logEstimate)),
        parts: adj.parts
      }
    }));
    const confidence = bestScore <= 0.1 ? "high" : bestScore <= 0.25 ? "medium" : "low";
    return {
      matchType,
      estimate: pointEstimate,
      low: matchType === "exact" ? Math.round(pointEstimate * 0.87) : blend.low,
      high: matchType === "exact" ? Math.round(pointEstimate * 1.13) : blend.high,
      perCt: Math.round(pointEstimate / query.carat),
      confidence,
      primary,
      alternatives,
      otherFactoryExact,
      supplierComparisons,
      supportComps: acceptedOrdered.map((adj) => ({
        row: adj.row,
        score: adj.score,
        scoreComponents: adj.scoreComponents,
        logEstimate: adj.logEstimate,
        sigmaLog: adj.sigmaLog,
        estimatedPrice: Math.round(Math.exp(adj.logEstimate)),
        parts: adj.parts
      })),
      rejectedComps: blend.rejected.map((adj) => ({
        row: adj.row,
        reason: adj.rejectReason,
        estimatedPrice: Math.round(Math.exp(adj.logEstimate))
      })),
      warnings,
      source: "comps-index-v3",
      // ── P1: source concentration ──────────────────────────────────────────
      sourceConcentration: blend.sourceConcentration,
      // ── P1b: local carat curve ────────────────────────────────────────────
      // For white diamonds, always emit localCaratCurve so callers can read .mode.
      // When no local fit was possible, emit a minimal prior_only descriptor.
      localCaratCurve: nq.colorFamily === "white" ? localCaratCurve ? {
        // Effective slope after policy (used in all adjustments)
        slope: effective.slope,
        // Pre-policy slope (post-shrink, post-clamp from OLS fit)
        fittedSlope: localCaratCurve.slope,
        // Raw OLS slope before shrinkage
        rawSlope: localCaratCurve.rawSlope,
        prior: effective.prior,
        mode: effective.mode,
        n: localCaratCurve.n,
        rowCount: localCaratCurve.rowCount,
        sourceCount: localCaratCurve.sourceCount,
        confidence: localCaratCurve.confidence,
        caratRange: `${localCaratCurve.caratMin.toFixed(1)}\u2013${localCaratCurve.caratMax.toFixed(1)}ct`,
        queryIsExtrapolated: localCaratCurve.queryIsExtrapolated,
        normalized: localCaratCurve.normalized,
        note: `Slope policy: ${effective.mode} \u2192 ${effective.slope.toFixed(3)} (prior ${effective.prior}, fitted ${localCaratCurve.slope.toFixed(3)}, raw OLS ${localCaratCurve.rawSlope.toFixed(3)})`
      } : {
        // No local fit — using segment prior
        slope: effective.slope,
        fittedSlope: null,
        rawSlope: null,
        prior: effective.prior,
        mode: "prior_only",
        n: 0,
        rowCount: 0,
        sourceCount: 0,
        confidence: null,
        caratRange: null,
        queryIsExtrapolated: false,
        normalized: false,
        note: `No local fit \u2014 using segment prior ${effective.prior}`
      } : null,
      // ── P0: calibration label ─────────────────────────────────────────────
      calibrationNote: `intervals_sigma_inflated_${SIGMA_CALIBRATION_FACTOR}x_uncalibrated`
    };
  }
  async function loadIndex(src) {
    if (typeof src === "object" && src !== null) {
      _compsIndex = src;
      return;
    }
    const url = src || "research/data/alibaba-comps-index.json";
    const baseUrl = url.includes("/") ? url.slice(0, url.lastIndexOf("/") + 1) : "";
    if (false) {
      const { readFileSync } = await null;
      const index2 = JSON.parse(readFileSync(url, "utf8"));
      const supplemental2 = [];
      for (const file of SUPPLEMENTAL_COMP_FILES) {
        try {
          supplemental2.push(JSON.parse(readFileSync(baseUrl + file, "utf8")));
        } catch {
        }
      }
      _compsIndex = mergeSupplementalComps(index2, supplemental2);
      return;
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load comps index: HTTP ${res.status}`);
    const index = await res.json();
    const supplemental = await Promise.all(SUPPLEMENTAL_COMP_FILES.map(async (file) => {
      try {
        const suppRes = await fetch(baseUrl + file);
        return suppRes.ok ? suppRes.json() : null;
      } catch {
        return null;
      }
    }));
    _compsIndex = mergeSupplementalComps(index, supplemental);
  }
  function runTests() {
    if (!_compsIndex) {
      console.error("runTests: index not loaded");
      return;
    }
    const FIXTURES = [
      // ── White: exact / near-exact ──────────────────────────────────────────
      {
        desc: "T01 \u2014 1ct D VS1 round (Messi primary)",
        q: { carat: 1, shape: "round", colorFamily: "white", whiteGrade: "D", clarity: "VS1" },
        expectMatch: ["exact"]
      },
      {
        desc: "T02 \u2014 1ct D VS1 oval",
        q: { carat: 1, shape: "oval", colorFamily: "white", whiteGrade: "D", clarity: "VS1" },
        expectMatch: ["exact", "nearest"]
      },
      {
        desc: "T03 \u2014 2ct D VS1 marquise",
        q: { carat: 2, shape: "marquise", colorFamily: "white", whiteGrade: "D", clarity: "VS1" },
        expectMatch: ["exact", "nearest"]
      },
      {
        desc: "T04 \u2014 3ct D VS1 princess",
        q: { carat: 3, shape: "princess", colorFamily: "white", whiteGrade: "D", clarity: "VS1" },
        expectMatch: ["exact", "nearest"]
      },
      // ── White: color offset ────────────────────────────────────────────────
      {
        desc: "T05 \u2014 2ct H VS1 round (color modifier)",
        q: { carat: 2, shape: "round", colorFamily: "white", whiteGrade: "H", clarity: "VS1" },
        expectMatch: ["exact", "nearest", "best_available"],
        note: "H vs D comp \u2192 color downgrade modifier applied."
      },
      {
        desc: "T06 \u2014 2ct G VS1 round",
        q: { carat: 2, shape: "round", colorFamily: "white", whiteGrade: "G", clarity: "VS1" },
        expectMatch: ["exact", "nearest", "best_available"]
      },
      // ── White: size gaps ───────────────────────────────────────────────────
      {
        desc: "T07 \u2014 4ct D VS1 marquise",
        q: { carat: 4, shape: "marquise", colorFamily: "white", whiteGrade: "D", clarity: "VS1" },
        expectMatch: ["exact", "nearest", "best_available"],
        note: "Merged supplier pools now include 4ct marquise rows."
      },
      {
        desc: "T08 \u2014 4.5ct D VS1 marquise",
        q: { carat: 4.5, shape: "marquise", colorFamily: "white", whiteGrade: "D", clarity: "VS1" },
        expectMatch: ["nearest", "best_available"]
      },
      {
        desc: "T09 \u2014 6ct D VS1 oval",
        q: { carat: 6, shape: "oval", colorFamily: "white", whiteGrade: "D", clarity: "VS1" },
        expectMatch: ["exact", "nearest", "best_available"]
      },
      // ── White: shape normalization ─────────────────────────────────────────
      {
        desc: "T10 \u2014 2ct D VS1 cushion_brilliant (\u2192 cushion)",
        q: { carat: 2, shape: "cushion_brilliant", colorFamily: "white", whiteGrade: "D", clarity: "VS1" },
        expectMatch: ["exact", "nearest"]
      },
      // ── White: specialty shapes ────────────────────────────────────────────
      {
        desc: "T11 \u2014 2ct D VS1 portuguese (has real index rows)",
        q: { carat: 2, shape: "portuguese", colorFamily: "white", whiteGrade: "D", clarity: "VS1" },
        expectMatch: ["exact", "nearest", "best_available"]
      },
      {
        desc: "T12 \u2014 2ct D VS1 moval (has real index rows)",
        q: { carat: 2, shape: "moval", colorFamily: "white", whiteGrade: "D", clarity: "VS1" },
        expectMatch: ["exact", "nearest", "best_available"]
      },
      // ── Fancy: pink ────────────────────────────────────────────────────────
      {
        desc: "T13 \u2014 2ct Fancy Vivid Pink VVS2 heart",
        q: { carat: 2, shape: "heart", colorFamily: "fancy", colorFamily_key: "pink_fv", clarity: "VVS2" },
        expectMatch: ["exact", "nearest", "best_available"]
      },
      {
        desc: "T14 \u2014 1ct Fancy Intense Pink VS1 pear",
        q: { carat: 1, shape: "pear", colorFamily: "fancy", colorFamily_key: "pink_fi", clarity: "VS1" },
        expectMatch: ["nearest", "best_available"]
      },
      {
        desc: "T15 \u2014 1ct Fancy Vivid Orange VS1 oval (no orange rows \u2192 none)",
        q: { carat: 1, shape: "oval", colorFamily: "fancy", colorFamily_key: "orange_fv", clarity: "VS1" },
        expectMatch: ["none"],
        note: "fancyHueCompatible must reject non-orange comps."
      },
      // ── Pink case study: v3 must not select 0.89ct brownish as primary ─────
      {
        desc: "T16 \u2014 3.80ct Fancy Vivid Pink VVS2 radiant (pink case study)",
        q: { carat: 3.8, shape: "radiant", colorFamily: "fancy", colorFamily_key: "pink_fv", clarity: "VVS2" },
        expectMatch: ["nearest", "best_available"],
        checkFn: (result) => {
          const pRow = result.primary?.row;
          if (!pRow) return "No primary comp found";
          if (Math.abs((pRow.carat || 0) - 0.89) < 0.05 && (pRow.color || "").toLowerCase().includes("brownish")) {
            return "FAIL: 0.89ct brownish radiant incorrectly selected as primary";
          }
          const supportColors = result.supportComps.map((sc) => (sc.row.color || "").toLowerCase());
          const supportCarats = result.supportComps.map((sc) => sc.row.carat);
          const hasFVP = supportColors.some((c) => c.includes("vivid"));
          const has413 = supportCarats.some((c) => Math.abs(c - 4.13) < 0.1);
          const has208 = supportCarats.some((c) => Math.abs(c - 2.08) < 0.1);
          if (!hasFVP && !has413 && !has208) {
            return `FAIL: no vivid pink or large-carat comp in support. Colors: ${supportColors.join(", ")}  Carats: ${supportCarats.join(", ")}`;
          }
          if (result.estimate < 500 || result.estimate > 8e3) {
            return `FAIL: estimate ${result.estimate} is outside expected range ($500\u2013$8000)`;
          }
          return null;
        },
        note: "Primary must not be 0.89ct brownish; ensemble uses FVP comp or large-carat pink comps."
      },
      // ── Brownish modifier ──────────────────────────────────────────────────
      {
        desc: "T17 \u2014 0.89ct Fancy Intense Brownish Pink VS2 radiant (self-match check)",
        q: { carat: 0.89, shape: "radiant", colorFamily: "fancy", colorFamily_key: "pink_fi", clarity: "VS2" },
        expectMatch: ["exact", "nearest"],
        note: "The comp IS the 0.89ct brownish row. Exact or near-exact match."
      },
      // ── Edge cases ─────────────────────────────────────────────────────────
      {
        desc: "T18 \u2014 0.5ct D VS1 round (small stone)",
        q: { carat: 0.5, shape: "round", colorFamily: "white", whiteGrade: "D", clarity: "VS1" },
        expectMatch: ["exact"]
      },
      {
        desc: "T19 \u2014 2ct D VVS1 oval (VVS1 premium)",
        q: { carat: 2, shape: "oval", colorFamily: "white", whiteGrade: "D", clarity: "VVS1" },
        expectMatch: ["exact", "nearest", "best_available"]
      },
      {
        desc: "T20 \u2014 3.5ct D VS1 oval",
        q: { carat: 3.5, shape: "oval", colorFamily: "white", whiteGrade: "D", clarity: "VS1" },
        expectMatch: ["exact", "nearest", "best_available"]
      },
      // ── Ensemble blend check ───────────────────────────────────────────────
      {
        desc: "T21 \u2014 4ct Fancy Vivid Pink VS1 cushion",
        q: { carat: 4, shape: "cushion", colorFamily: "fancy", colorFamily_key: "pink_fv", clarity: "VS1" },
        expectMatch: ["exact", "nearest", "best_available"],
        // 4ct cushion row exists
        checkFn: (result) => {
          const pRow = result.primary?.row;
          if (!pRow) return "FAIL: missing primary comp";
          if (pRow.shape !== "cushion") return `FAIL: expected cushion primary, got ${pRow.shape}`;
          if (!(pRow.color || "").toLowerCase().includes("vivid pink")) {
            return `FAIL: expected Fancy Vivid Pink primary, got ${pRow.color}`;
          }
          if (!result.low || !result.high || result.low >= result.high) {
            return `FAIL: invalid range low=${result.low} high=${result.high}`;
          }
          return null;
        }
      },
      {
        desc: "T22 \u2014 1ct Fancy Light Pink VS2 cushion (lower intensity)",
        q: { carat: 1, shape: "cushion", colorFamily: "fancy", colorFamily_key: "pink_fl", clarity: "VS2" },
        expectMatch: ["exact", "nearest", "best_available"]
      },
      {
        desc: "T23 \u2014 5ct D VS1 oval (large white, should have range)",
        q: { carat: 5, shape: "oval", colorFamily: "white", whiteGrade: "D", clarity: "VS1" },
        expectMatch: ["exact", "nearest", "best_available"],
        checkFn: (result) => {
          if (!result.low || !result.high) return "FAIL: missing low/high range";
          return null;
        }
      },
      // ── Multi-supplier exact (Messi sheet + StarGem) ─────────────────────────
      {
        desc: "T24 \u2014 3.01ct E VS1 pear (Messi + StarGem both in blend)",
        q: { carat: 3.01, shape: "pear", colorFamily: "white", whiteGrade: "E", clarity: "VS1" },
        expectMatch: ["exact"],
        checkFn: (result) => {
          if (supplierKey(result.primary?.row) !== "starsgem") {
            return "FAIL: floor primary should be cheapest StarGem";
          }
          const messi = (result.otherFactoryExact || []).filter((e) => e.supplierKey === "messi");
          if (!messi.length) return "FAIL: Messi same-spec listings missing from otherFactoryExact";
          if (!messi.some((e) => e.listingPrice >= 420 && e.listingPrice <= 460)) {
            return `FAIL: expected Messi ~$430\u2013460, got ${messi.map((e) => e.listingPrice).join(", ")}`;
          }
          if (result.estimate > 360) return `FAIL: estimate should be floor ~$348, got ${result.estimate}`;
          return null;
        }
      },
      {
        desc: "T25 \u2014 3ct E VS1 pear (Messi row 17673 / sheet PS)",
        q: { carat: 3, shape: "pear", colorFamily: "white", whiteGrade: "E", clarity: "VS1" },
        expectMatch: ["exact"],
        checkFn: (result) => {
          const messi = (result.otherFactoryExact || []).filter((e) => e.supplierKey === "messi");
          if (!messi.length) return "FAIL: no Messi otherFactoryExact";
          const near438 = messi.some((e) => e.listingPrice >= 430 && e.listingPrice <= 445);
          if (!near438) return `FAIL: expected ~$438 Messi 3ct, got ${messi.map((e) => e.listingPrice).join(", ")}`;
          return null;
        }
      },
      {
        desc: "T26 \u2014 3.02ct E VVS2 pear (Messi ~$498 sheet)",
        q: { carat: 3.02, shape: "pear", colorFamily: "white", whiteGrade: "E", clarity: "VVS2" },
        expectMatch: ["exact", "nearest"],
        checkFn: (result) => {
          const messi = (result.otherFactoryExact || []).filter((e) => e.supplierKey === "messi");
          if (!messi.length) return "FAIL: Messi VVS2 pear missing from otherFactoryExact";
          if (!messi.some((e) => e.row.clarity === "VVS2" && e.listingPrice >= 480)) {
            return "FAIL: expected Messi 3ct E VVS2 near $498";
          }
          return null;
        }
      },
      {
        desc: "T27 \u2014 3.02ct E VS2 pear (Messi ~$423 sheet)",
        q: { carat: 3.02, shape: "pear", colorFamily: "white", whiteGrade: "E", clarity: "VS2" },
        expectMatch: ["exact", "nearest"],
        checkFn: (result) => {
          const messi = (result.otherFactoryExact || []).filter((e) => e.supplierKey === "messi");
          if (!messi.length) return "FAIL: Messi VS2 pear missing from otherFactoryExact";
          if (!messi.some((e) => e.row.clarity === "VS2" && e.listingPrice >= 400 && e.listingPrice <= 440)) {
            return `FAIL: expected Messi VS2 ~$423, got ${messi.map((e) => e.listingPrice).join(", ")}`;
          }
          return null;
        }
      },
      {
        desc: "T28 \u2014 1ct D VS1 pear (shape pear, not round)",
        q: { carat: 1, shape: "pear", colorFamily: "white", whiteGrade: "D", clarity: "VS1" },
        expectMatch: ["exact", "nearest"],
        checkFn: (result) => {
          const shapes = new Set((result.supportComps || []).map((c) => c.row.shape));
          if (!shapes.has("pear")) return `FAIL: support comps not pear: ${[...shapes].join(", ")}`;
          return null;
        }
      },
      {
        desc: "T29 \u2014 3.01ct E VS1 pear primary is cheapest exact (StarGem)",
        q: { carat: 3.01, shape: "pear", colorFamily: "white", whiteGrade: "E", clarity: "VS1" },
        expectMatch: ["exact"],
        checkFn: (result) => {
          const p = result.primary?.row;
          if (!p) return "FAIL: no primary";
          if (p.shape !== "pear") return `FAIL: primary shape ${p.shape}`;
          if (supplierKey(p) !== "starsgem") return `FAIL: primary should be cheapest StarGem, got ${supplierKey(p)}`;
          const messiListed = (result.otherFactoryExact || []).some((e) => e.supplierKey === "messi");
          if (!messiListed) return "FAIL: Messi should appear in otherFactoryExact, not alternatives";
          const altMessi = (result.alternatives || []).some((a) => supplierKey(a.row) === "messi");
          if (altMessi) return "FAIL: Messi should not be in alternatives (floor supplier only)";
          return null;
        }
      },
      {
        desc: "T30 \u2014 2.31ct D VS1 emerald primary is cheapest adjusted exact (StarGem)",
        q: { carat: 2.31, shape: "emerald", colorFamily: "white", whiteGrade: "D", clarity: "VS1" },
        expectMatch: ["exact"],
        checkFn: (result) => {
          const p = result.primary?.row;
          if (!p) return "FAIL: no primary";
          if (p.shape !== "emerald") return `FAIL: primary shape ${p.shape}`;
          if (p.colorNormalized !== "D") return `FAIL: primary color ${p.colorNormalized}`;
          if (p.clarity !== "VS1") return `FAIL: primary clarity ${p.clarity}`;
          if (supplierKey(p) !== "starsgem") return `FAIL: primary should be cheapest StarGem, got ${supplierKey(p)}`;
          if (result.primary.estimatedPrice < 230 || result.primary.estimatedPrice > 250) {
            return `FAIL: expected StarGem adjusted floor around $236-243, got ${result.primary.estimatedPrice}`;
          }
          const messiListed = (result.otherFactoryExact || []).some((e) => e.supplierKey === "messi");
          if (!messiListed) return "FAIL: Messi should appear in otherFactoryExact, not alternatives";
          return null;
        }
      }
    ];
    let passed = 0, failed = 0;
    console.log(`
${"=".repeat(72)}`);
    console.log("ALIBABA COMP ENGINE v3 \u2014 TEST RUN");
    console.log(`${"=".repeat(72)}
`);
    for (const fx of FIXTURES) {
      let result;
      try {
        result = resolveAlibabaComp(fx.q);
      } catch (e) {
        console.error(`  [ERROR] ${fx.desc}
    ${e.message}`);
        failed++;
        continue;
      }
      const mt = result.matchType;
      const mtOk = fx.expectMatch.includes(mt);
      let customErr = null;
      if (fx.checkFn && mtOk) customErr = fx.checkFn(result);
      const ok = mtOk && !customErr;
      if (ok) passed++;
      else failed++;
      const tag = ok ? "[PASS]" : "[FAIL]";
      const p = result.primary;
      const compSpec = p?.row ? `${p.row.carat}ct ${p.row.shape} ${p.row.clarity}${p.row.color ? " " + p.row.color : p.row.colorNormalized ? " " + p.row.colorNormalized : ""}` : "\u2014";
      const priceStr = result.estimate != null ? `$${result.estimate} [$${result.low}\u2013$${result.high}]` : "\u2014";
      const nSupport = result.supportComps?.length || 0;
      const nReject = result.rejectedComps?.length || 0;
      const warnings = result.warnings?.join(" | ") || "\u2014";
      console.log(`${tag} ${fx.desc}`);
      console.log(`       matchType: ${mt}  (expected: ${fx.expectMatch.join("|")})`);
      console.log(`       primaryComp: ${compSpec}`);
      console.log(`       estimate: ${priceStr}  support=${nSupport}  rejected=${nReject}`);
      if (warnings !== "\u2014") console.log(`       warnings: ${warnings}`);
      if (customErr) console.log(`       checkFn: ${customErr}`);
      if (!mtOk && fx.note) console.log(`       note: ${fx.note}`);
      console.log();
    }
    console.log(`${"=".repeat(72)}`);
    console.log(`Results: ${passed} passed, ${failed} failed of ${FIXTURES.length} total`);
    console.log(`${"=".repeat(72)}
`);
  }
  return __toCommonJS(comp_engine_v3_exports);
})();
