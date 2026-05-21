/**
 * Gem Appraise — diamond shape icon renderer (standalone export)
 * viewBox 0 0 24 24 · procedural SVG outlines with facet hints
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GemShapeIcons = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SHAPE_ICON_COLORS = {
    round: '#5b9bd5', oval: '#a08060', pear: '#9b70d4', marquise: '#a08060', heart: '#e070a0',
    cushion: '#4caf7a', cushion_brilliant: '#4caf7a', square_cushion: '#4caf7a',
    radiant: '#e06060', sq_radiant: '#e06060', princess: '#4caf7a', emerald: '#5b9bd5',
    asscher: '#5b9bd5', baguette: '#4caf7a', tapered_baguette: '#4caf7a', carre: '#5b9bd5',
    trilliant: '#9b70d4', half_moon: '#5b9bd5', shield: '#9b70d4', hexagonal: '#5b9bd5',
    hexagonal_dutch: '#5b9bd5', moval: '#a08060',
    old_european: '#d4af72', old_mine: '#d4af72', rose: '#e070a0', briolette: '#9b70d4',
    portuguese: '#d4af72', flanders: '#d4af72',
  };

  const ICON_CANONICAL_LW = {
    baguette: 2.75, tapered_baguette: 3.1, trilliant: 1.05, half_moon: 2.0, shield: 1.1,
    hexagonal: 1.0, hexagonal_dutch: 1.95, rose: 1.0, briolette: 0.62, portuguese: 1.0, flanders: 1.0,
  };

  const ratioGuides = {
    round: { lo: 0.98, hi: 1.02, idealLo: 0.99, idealHi: 1.01 },
    oval: { lo: 1.30, hi: 1.50, idealLo: 1.35, idealHi: 1.45 },
    moval: { lo: 1.55, hi: 2.05, idealLo: 1.65, idealHi: 1.90 },
    pear: { lo: 1.50, hi: 1.75, idealLo: 1.55, idealHi: 1.70 },
    marquise: { lo: 1.80, hi: 2.20, idealLo: 1.90, idealHi: 2.10 },
    hexagonal_dutch: { lo: 1.75, hi: 2.25, idealLo: 1.85, idealHi: 2.10 },
    heart: { lo: 0.90, hi: 1.10, idealLo: 0.95, idealHi: 1.05 },
    cushion: { lo: 1.00, hi: 1.30, idealLo: 1.00, idealHi: 1.20 },
    cushion_brilliant: { lo: 1.00, hi: 1.30, idealLo: 1.00, idealHi: 1.20 },
    square_cushion: { lo: 0.98, hi: 1.05, idealLo: 0.99, idealHi: 1.03 },
    radiant: { lo: 1.25, hi: 1.55, idealLo: 1.30, idealHi: 1.45 },
    sq_radiant: { lo: 0.98, hi: 1.08, idealLo: 1.00, idealHi: 1.05 },
    emerald: { lo: 1.30, hi: 1.60, idealLo: 1.35, idealHi: 1.50 },
    asscher: { lo: 0.98, hi: 1.08, idealLo: 1.00, idealHi: 1.05 },
    princess: { lo: 0.98, hi: 1.08, idealLo: 1.00, idealHi: 1.05 },
  };

  const shapeNames = {
    round: 'Round Brilliant', oval: 'Oval Brilliant', moval: 'Moval',
    pear: 'Pear Modified Brilliant', marquise: 'Marquise Brilliant', heart: 'Heart Modified Brilliant',
    trilliant: 'Trilliant Cut', old_european: 'Old European Brilliant', old_mine: 'Old Mine Brilliant',
    cushion: 'Cushion Modified Brilliant', cushion_brilliant: 'Cushion Brilliant',
    square_cushion: 'Square Cushion Modified Brilliant',
    radiant: 'Cut Cornered Rectangular Modified Brilliant',
    sq_radiant: 'Cut Cornered Square Modified Brilliant',
    princess: 'Princess Cut', half_moon: 'Half Moon Modified Brilliant', shield: 'Shield Modified Brilliant',
    hexagonal: 'Hexagonal Modified Brilliant', hexagonal_dutch: 'Hexagonal Dutch / Dutch Marquise',
    emerald: 'Emerald Cut', asscher: 'Square Emerald Cut',
    baguette: 'Baguette Cut', tapered_baguette: 'Tapered Baguette Cut', carre: 'Carre Cut',
    rose: 'Rose Cut', briolette: 'Briolette',
    portuguese: 'Portuguese / Round Modified Brilliant', flanders: 'Flanders Cut',
    elongated_cushion: 'Elongated Cushion (alias → cushion icon)',
  };

  const SHAPE_ICON_DRAWN = new Set([
    'round', 'oval', 'pear', 'marquise', 'moval', 'heart', 'cushion', 'cushion_brilliant', 'square_cushion',
    'princess', 'emerald', 'radiant', 'asscher', 'sq_radiant', 'carre', 'baguette', 'tapered_baguette',
    'trilliant', 'half_moon', 'shield', 'hexagonal', 'hexagonal_dutch', 'old_european', 'old_mine',
    'rose', 'briolette', 'portuguese', 'flanders',
  ]);

  const SHAPE_ICON_ALIASES = { elongated_cushion: 'cushion' };

  function iconEffectiveLW(shapeKey, certRatio) {
    if (certRatio != null && certRatio > 0) {
      const guide = ratioGuides[shapeKey];
      if (guide) return Math.min(guide.hi * 1.02, Math.max(guide.lo * 0.98, certRatio));
      return certRatio;
    }
    const guide = ratioGuides[shapeKey];
    if (guide) return (guide.idealLo + guide.idealHi) / 2;
    return ICON_CANONICAL_LW[shapeKey] ?? 1;
  }

  function iconBox(lw) {
    const inner = 18.5;
    const r = Math.max(lw, 0.85);
    let bw, bh;
    if (r >= 1) { bh = inner; bw = inner / r; }
    else { bw = inner; bh = inner * r; }
    return { cx: 12, cy: 12, hw: bw / 2, hh: bh / 2 };
  }

  function iconXY(box, u, v) {
    return [+(box.cx + u * box.hw).toFixed(2), +(box.cy + v * box.hh).toFixed(2)];
  }

  function iconPath(pts, c, sw = 1.2) {
    const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ') + 'Z';
    return `<path d="${d}" fill="none" stroke="${c}" stroke-width="${sw}"/>`;
  }

  function iconLines(c, f, segs) {
    return segs.map(([x1, y1, x2, y2]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${f}/>`).join('');
  }

  function iconBrilliantElongated(box, c, f, outlinePts, tableScale = 0.42) {
    const outline = iconPath(outlinePts, c);
    const table = outlinePts.map(([x, y]) => [
      +(box.cx + (x - box.cx) * tableScale).toFixed(2),
      +(box.cy + (y - box.cy) * tableScale).toFixed(2),
    ]);
    const tablePath = iconPath(table, c, 0.7);
    const facets = [];
    for (let i = 0; i < outlinePts.length; i++) {
      const [tx, ty] = table[i];
      const [ox, oy] = outlinePts[i];
      facets.push([tx, ty, ox, oy]);
      const [nx, ny] = outlinePts[(i + 1) % outlinePts.length];
      facets.push([ox, oy, nx, ny]);
    }
    return outline + tablePath + iconLines(c, f, facets);
  }

  function iconOval(box, c, f) {
    const rx = +(box.hw * 0.95).toFixed(2);
    const ry = +(box.hh * 0.95).toFixed(2);
    const trx = +(rx * 0.42).toFixed(2);
    const tryTable = +(ry * 0.42).toFixed(2);
    let s = `<ellipse cx="${box.cx}" cy="${box.cy}" rx="${rx}" ry="${ry}" fill="none" stroke="${c}" stroke-width="1.2"/>`;
    s += `<ellipse cx="${box.cx}" cy="${box.cy}" rx="${trx}" ry="${tryTable}" fill="none" stroke="${c}" stroke-width="0.7"/>`;
    const segs = [];
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4 - Math.PI / 2;
      const a2 = ((i + 1) * Math.PI) / 4 - Math.PI / 2;
      const tx = box.cx + Math.cos(a) * trx;
      const ty = box.cy + Math.sin(a) * tryTable;
      const gx = box.cx + Math.cos(a) * rx;
      const gy = box.cy + Math.sin(a) * ry;
      const gx2 = box.cx + Math.cos(a2) * rx;
      const gy2 = box.cy + Math.sin(a2) * ry;
      segs.push([tx, ty, gx, gy], [gx, gy, gx2, gy2]);
    }
    return s + iconLines(c, f, segs);
  }

  function iconStepRect(box, c, f) {
    const outer = [iconXY(box, -0.92, -0.72), iconXY(box, 0.92, -0.72), iconXY(box, 0.92, 0.72), iconXY(box, -0.92, 0.72)];
    const mid = [iconXY(box, -0.68, -0.5), iconXY(box, 0.68, -0.5), iconXY(box, 0.68, 0.5), iconXY(box, -0.68, 0.5)];
    const inner = [iconXY(box, -0.42, -0.28), iconXY(box, 0.42, -0.28), iconXY(box, 0.42, 0.28), iconXY(box, -0.42, 0.28)];
    let s = iconPath(outer, c) + iconPath(mid, c, 0.75) + iconPath(inner, c, 0.45);
    const segs = [];
    for (let i = 0; i < 4; i++) {
      const n = (i + 1) % 4;
      segs.push([...outer[i], ...mid[i]], [...mid[i], ...inner[i]], [...inner[i], ...inner[n]], [...inner[n], ...mid[n]], [...mid[n], ...outer[n]], [...outer[n], ...outer[i]]);
    }
    return s + iconLines(c, f, segs);
  }

  function iconCushion(box, c, f) {
    const pts = [
      iconXY(box, -0.82, -0.55), iconXY(box, 0, -0.92), iconXY(box, 0.82, -0.55),
      iconXY(box, 0.92, 0), iconXY(box, 0.82, 0.55), iconXY(box, 0, 0.92),
      iconXY(box, -0.82, 0.55), iconXY(box, -0.92, 0),
    ];
    return iconBrilliantElongated(box, c, f, pts);
  }

  function iconPrincess(c, f) {
    const sq = iconBox(1);
    const outer = [iconXY(sq, -0.9, -0.9), iconXY(sq, 0.9, -0.9), iconXY(sq, 0.9, 0.9), iconXY(sq, -0.9, 0.9)];
    const inner = [iconXY(sq, -0.42, -0.42), iconXY(sq, 0.42, -0.42), iconXY(sq, 0.42, 0.42), iconXY(sq, -0.42, 0.42)];
    let s = iconPath(outer, c) + iconPath(inner, c, 0.7);
    const segs = [];
    // Corner lines: each outer corner connects to its matching inner corner
    for (let i = 0; i < 4; i++) {
      segs.push([...outer[i], ...inner[i]]);
    }
    // Edge midpoints connect to both flanking table corners (chevron facets on each side)
    const midTop = [(outer[0][0] + outer[1][0]) / 2, (outer[0][1] + outer[1][1]) / 2];
    const midRig = [(outer[1][0] + outer[2][0]) / 2, (outer[1][1] + outer[2][1]) / 2];
    const midBot = [(outer[2][0] + outer[3][0]) / 2, (outer[2][1] + outer[3][1]) / 2];
    const midLef = [(outer[3][0] + outer[0][0]) / 2, (outer[3][1] + outer[0][1]) / 2];
    segs.push([...midTop, ...inner[0]], [...midTop, ...inner[1]]);
    segs.push([...midRig, ...inner[1]], [...midRig, ...inner[2]]);
    segs.push([...midBot, ...inner[2]], [...midBot, ...inner[3]]);
    segs.push([...midLef, ...inner[3]], [...midLef, ...inner[0]]);
    return s + iconLines(c, f, segs);
  }

  function iconBaguette(shapeKey, c, f) {
    const b = iconBox(shapeKey === 'tapered_baguette' ? 3.1 : 2.75);
    const outer = shapeKey === 'tapered_baguette'
      ? [iconXY(b, -0.52, -0.68), iconXY(b, 0.52, -0.68), iconXY(b, 0.36, 0.68), iconXY(b, -0.36, 0.68)]
      : [iconXY(b, -0.9, -0.52), iconXY(b, 0.9, -0.52), iconXY(b, 0.9, 0.52), iconXY(b, -0.9, 0.52)];
    const mid = outer.map(([x, y]) => [+(b.cx + (x - b.cx) * 0.72).toFixed(2), +(b.cy + (y - b.cy) * 0.72).toFixed(2)]);
    const inner = outer.map(([x, y]) => [+(b.cx + (x - b.cx) * 0.48).toFixed(2), +(b.cy + (y - b.cy) * 0.48).toFixed(2)]);
    let s = iconPath(outer, c) + iconPath(mid, c, 0.75) + iconPath(inner, c, 0.45);
    const segs = [];
    for (let i = 0; i < 4; i++) {
      const n = (i + 1) % 4;
      segs.push([...outer[i], ...mid[i]], [...mid[i], ...inner[i]], [...inner[i], ...inner[n]], [...inner[n], ...mid[n]], [...mid[n], ...outer[n]]);
    }
    return s + iconLines(c, f, segs);
  }

  function iconRoundBrilliant(box, c, f, extraFacetRing = false) {
    const r = Math.min(box.hw, box.hh) * 0.95;
    const cx = box.cx, cy = box.cy;
    const table = 0.38 * r;
    const g = r * 0.95;
    const oct = [];
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4 - Math.PI / 2;
      oct.push([+(cx + Math.cos(a) * table).toFixed(2), +(cy + Math.sin(a) * table).toFixed(2)]);
    }
    let s = `<circle cx="${cx}" cy="${cy}" r="${g.toFixed(2)}" fill="none" stroke="${c}" stroke-width="1.2"/>`;
    if (extraFacetRing) {
      s += `<circle cx="${cx}" cy="${cy}" r="${(g * 0.58).toFixed(2)}" fill="none" stroke="${c}" stroke-width="0.55" opacity="0.55"/>`;
    }
    s += iconPath(oct, c, 0.7);
    const facetSegs = [];
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4 - Math.PI / 2;
      const [tx, ty] = oct[i];
      facetSegs.push([tx, ty, +(cx + Math.cos(a) * g).toFixed(2), +(cy + Math.sin(a) * g).toFixed(2)]);
      const a2 = ((i + 1) * Math.PI) / 4 - Math.PI / 2;
      facetSegs.push([+(cx + Math.cos(a) * g).toFixed(2), +(cy + Math.sin(a) * g).toFixed(2), +(cx + Math.cos(a2) * g).toFixed(2), +(cy + Math.sin(a2) * g).toFixed(2)]);
    }
    return s + iconLines(c, f, facetSegs);
  }

  function mapReportShapeToState(shape, reportHint = '') {
    const sh = (shape || '').toLowerCase().replace(/\./g, '');
    const ctx = (reportHint || '').toLowerCase();
    const combined = `${sh} ${ctx}`.trim();
    if (combined.includes('portuguese')) return 'portuguese';
    if (/\bround\b/.test(combined) && combined.includes('modified') && (combined.includes('brilliant') || combined.includes('portuguese'))) return 'portuguese';
    if (/\bround\s+modified\b/.test(combined)) return 'portuguese';
    if (/\bround\b/.test(sh) && sh.includes('brilliant') && !sh.includes('square') && !sh.includes('cornered')) {
      if (ctx.includes('portuguese') || /\bround\s+modified\b/.test(ctx)) return 'portuguese';
    }
    if (sh.includes('moval')) return 'moval';
    if (sh.includes('dutch') && (sh.includes('hex') || sh.includes('marquise'))) return 'hexagonal_dutch';
    if (sh.includes('hexagonal') && sh.includes('dutch')) return 'hexagonal_dutch';
    if (sh.includes('old european')) return 'old_european';
    if (sh.includes('old mine')) return 'old_mine';
    if (sh.includes('round')) return 'round';
    if (sh.includes('oval')) return 'oval';
    if (sh.includes('pear') || sh.includes('drop')) return 'pear';
    if (sh.includes('marquise')) return 'marquise';
    if (sh.includes('heart')) return 'heart';
    if (sh.includes('trilliant') || sh.includes('triangle')) return 'trilliant';
    if (sh.includes('square cushion')) return 'square_cushion';
    if (sh.includes('cushion') && sh.includes('modified')) return 'cushion';
    if (sh.includes('cushion') && sh.includes('brilliant')) return 'cushion_brilliant';
    if (sh.includes('cushion')) return 'cushion';
    if ((sh.includes('cut cornered') || sh.includes('cut-cornered')) && sh.includes('square')) return 'sq_radiant';
    if ((sh.includes('cut cornered') || sh.includes('cut-cornered')) && (sh.includes('rect') || sh.includes('rectangular'))) return 'radiant';
    if (sh.includes('radiant') && (sh.includes('square') || sh.includes('sq'))) return 'sq_radiant';
    if (sh.includes('radiant')) return 'radiant';
    if (sh.includes('princess') || sh.includes('square modified brilliant')) return 'princess';
    if (sh.includes('square emerald') || sh.includes('asscher')) return 'asscher';
    if (sh.includes('emerald')) return 'emerald';
    if (sh.includes('baguette') && sh.includes('taper')) return 'tapered_baguette';
    if (sh.includes('baguette')) return 'baguette';
    if (sh.includes('half moon') || sh.includes('halfmoon')) return 'half_moon';
    if (sh.includes('shield') || sh.includes('kite')) return 'shield';
    if (sh.includes('hexagonal')) return 'hexagonal';
    if (sh.includes('carre') || sh.includes('carr')) return 'carre';
    if (sh.includes('rose')) return 'rose';
    if (sh.includes('briolette')) return 'briolette';
    if (sh.includes('flanders')) return 'flanders';
    return null;
  }

  function resolveShapeIconKey(shapeKey, certRatio = null) {
    const raw = String(shapeKey || '').trim().toLowerCase();
    if (!raw) return 'round';
    if (SHAPE_ICON_ALIASES[raw]) return SHAPE_ICON_ALIASES[raw];
    if (SHAPE_ICON_DRAWN.has(raw)) return raw;
    const mapped = mapReportShapeToState(raw);
    if (mapped && SHAPE_ICON_DRAWN.has(mapped)) return mapped;
    if (certRatio != null && certRatio >= 0.95 && certRatio <= 1.08) return 'round';
    return raw;
  }

  function buildShapeIconInner(shapeKey, certRatio) {
    const c = SHAPE_ICON_COLORS[shapeKey] || '#d4af72';
    const f = `stroke="${c}" stroke-width="0.45" opacity="0.62"`;
    const lw = iconEffectiveLW(shapeKey, certRatio);
    const box = iconBox(lw);
    const p = (u, v) => iconXY(box, u, v);

    if (shapeKey === 'round') return iconRoundBrilliant(box, c, f, false);
    if (shapeKey === 'portuguese') return iconRoundBrilliant(box, c, f, true);
    if (shapeKey === 'oval') return iconOval(box, c, f);
    if (shapeKey === 'pear') {
      const pts = [p(-0.58, -0.9), p(-0.66, -0.35), p(-0.5, 0.05), p(0, 0.96), p(0.5, 0.05), p(0.66, -0.35), p(0.58, -0.9), p(0.3, -0.98), p(-0.3, -0.98)];
      return iconBrilliantElongated(box, c, f, pts, 0.4);
    }
    if (shapeKey === 'marquise') {
      const pts = [p(0, -0.96), p(0.58, -0.32), p(0.98, 0), p(0.58, 0.32), p(0, 0.96), p(-0.58, 0.32), p(-0.98, 0), p(-0.58, -0.32)];
      return iconBrilliantElongated(box, c, f, pts, 0.38);
    }
    if (shapeKey === 'moval') {
      // Equator midpoints must be at v=0 (symmetric), not v=-0.08
      const pts = [p(0, -0.94), p(0.52, -0.38), p(0.96, 0), p(0.52, 0.38), p(0, 0.94), p(-0.52, 0.38), p(-0.96, 0), p(-0.52, -0.38)];
      return iconBrilliantElongated(box, c, f, pts, 0.4);
    }
    if (shapeKey === 'heart') {
      const pts = [p(0, 0.92), p(-0.88, 0.15), p(-0.72, -0.42), p(-0.38, -0.72), p(0, -0.48), p(0.38, -0.72), p(0.72, -0.42), p(0.88, 0.15)];
      return iconBrilliantElongated(box, c, f, pts, 0.36);
    }
    if (shapeKey === 'cushion' || shapeKey === 'cushion_brilliant') return iconCushion(box, c, f);
    if (shapeKey === 'square_cushion') return iconCushion(iconBox(1), c, f);
    if (shapeKey === 'princess') return iconPrincess(c, f);
    if (shapeKey === 'emerald') return iconStepRect(box, c, f);
    if (shapeKey === 'radiant') {
      // Radiant = cut-cornered rectangle with brilliant-style facets (NOT step cuts like emerald)
      const cr = 0.18;
      const pts = [
        p(-0.92 + cr * 0.5, -0.72), p(0.92 - cr * 0.5, -0.72),
        p(0.92, -0.72 + cr * 0.4), p(0.92, 0.72 - cr * 0.4),
        p(0.92 - cr * 0.5, 0.72),  p(-0.92 + cr * 0.5, 0.72),
        p(-0.92, 0.72 - cr * 0.4), p(-0.92, -0.72 + cr * 0.4),
      ];
      return iconBrilliantElongated(box, c, f, pts, 0.42);
    }
    if (shapeKey === 'asscher' || shapeKey === 'sq_radiant' || shapeKey === 'carre') return iconStepRect(iconBox(1), c, f);
    if (shapeKey === 'baguette' || shapeKey === 'tapered_baguette') return iconBaguette(shapeKey, c, f);
    if (shapeKey === 'trilliant') {
      const t = iconBox(1.05);
      const top = iconXY(t, 0, -0.92);
      const bl = iconXY(t, -0.88, 0.82);
      const br = iconXY(t, 0.88, 0.82);
      const mid = iconXY(t, 0, 0.12);
      const inner = [iconXY(t, 0, -0.35), iconXY(t, -0.48, 0.55), iconXY(t, 0.48, 0.55)];
      let s = iconPath([top, bl, br], c) + iconPath(inner, c, 0.7);
      return s + iconLines(c, f, [[...top, ...mid], [...bl, ...mid], [...br, ...mid], [...inner[0], ...inner[1]], [...inner[1], ...inner[2]], [...inner[2], ...inner[0]], [...inner[0], ...bl], [...inner[0], ...br], [...inner[1], ...bl], [...inner[2], ...br]]);
    }
    if (shapeKey === 'half_moon') {
      const hm = iconBox(2);
      // Flat straight edge at top, convex brilliant curve at bottom
      const x0 = +(hm.cx - hm.hw * 0.92).toFixed(2);
      const x1 = +(hm.cx + hm.hw * 0.92).toFixed(2);
      const yFlat = +(hm.cy - hm.hh * 0.08).toFixed(2);
      const yBot = +(hm.cy + hm.hh * 0.92).toFixed(2);
      const qrx = +(hm.cx + hm.hw * 1.0).toFixed(2);
      const qlx = +(hm.cx - hm.hw * 1.0).toFixed(2);
      const qmy = +(hm.cy + hm.hh * 0.5).toFixed(2);
      const d = `M${x0},${yFlat} L${x1},${yFlat} Q${qrx},${qmy} ${hm.cx},${yBot} Q${qlx},${qmy} ${x0},${yFlat}Z`;
      const tx0 = +(hm.cx - hm.hw * 0.38).toFixed(2);
      const tx1 = +(hm.cx + hm.hw * 0.38).toFixed(2);
      const ty = +(hm.cy + hm.hh * 0.28).toFixed(2);
      const segs = [
        [tx0, ty, x0, yFlat], [tx1, ty, x1, yFlat],
        [tx0, ty, +(hm.cx - hm.hw * 0.5).toFixed(2), +(yBot - hm.hh * 0.3).toFixed(2)],
        [tx1, ty, +(hm.cx + hm.hw * 0.5).toFixed(2), +(yBot - hm.hh * 0.3).toFixed(2)],
        [hm.cx, +(ty + hm.hh * 0.15).toFixed(2), hm.cx, yBot],
        [tx0, ty, tx1, ty],
      ];
      return `<path d="${d}" fill="none" stroke="${c}" stroke-width="1.2"/>` + iconLines(c, f, segs);
    }
    if (shapeKey === 'shield') {
      const sh = iconBox(1.1);
      // 5-sided kite: wide flat top, angled shoulders, bottom point
      const pts = [iconXY(sh, -0.85, -0.78), iconXY(sh, 0.85, -0.78), iconXY(sh, 0.95, 0.05), iconXY(sh, 0, 0.92), iconXY(sh, -0.95, 0.05)];
      return iconBrilliantElongated(sh, c, f, pts, 0.38);
    }
    if (shapeKey === 'hexagonal') {
      const hx = iconBox(1);
      const pts = [];
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3 - Math.PI / 2;
        pts.push([+(hx.cx + Math.cos(a) * hx.hw * 0.92).toFixed(2), +(hx.cy + Math.sin(a) * hx.hh * 0.92).toFixed(2)]);
      }
      return iconBrilliantElongated(hx, c, f, pts, 0.42);
    }
    if (shapeKey === 'hexagonal_dutch') {
      const hd = iconBox(lw);
      // True elongated hexagon — 6 sides, pointed top/bottom, flat side facets
      const pts = [iconXY(hd, 0, -0.94), iconXY(hd, 0.9, -0.38), iconXY(hd, 0.9, 0.38), iconXY(hd, 0, 0.94), iconXY(hd, -0.9, 0.38), iconXY(hd, -0.9, -0.38)];
      return iconBrilliantElongated(hd, c, f, pts, 0.38);
    }
    if (shapeKey === 'old_european') {
      const oe = iconBox(1);
      const r = Math.min(oe.hw, oe.hh) * 0.92;
      const tableR = r * 0.38; // old european has notably large flat table
      let s = `<circle cx="${oe.cx}" cy="${oe.cy}" r="${r.toFixed(2)}" fill="none" stroke="${c}" stroke-width="1.2"/>`;
      s += `<circle cx="${oe.cx}" cy="${oe.cy}" r="${tableR.toFixed(2)}" fill="none" stroke="${c}" stroke-width="0.8"/>`;
      // 8 star facets: from table edge points to girdle mid-points between them
      const segs = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
        const a2 = ((i + 0.5) / 8) * Math.PI * 2 - Math.PI / 2;
        segs.push([+(oe.cx + Math.cos(a) * tableR).toFixed(2), +(oe.cy + Math.sin(a) * tableR).toFixed(2), +(oe.cx + Math.cos(a2) * r).toFixed(2), +(oe.cy + Math.sin(a2) * r).toFixed(2)]);
      }
      return s + iconLines(c, f, segs);
    }
    if (shapeKey === 'old_mine') {
      const om = iconBox(1.02);
      const pts = [iconXY(om, 0, -0.92), iconXY(om, 0.72, -0.55), iconXY(om, 0.88, 0.1), iconXY(om, 0.45, 0.9), iconXY(om, -0.45, 0.9), iconXY(om, -0.88, 0.1), iconXY(om, -0.72, -0.55)];
      return iconBrilliantElongated(om, c, f, pts, 0.4);
    }
    if (shapeKey === 'rose') {
      const rs = iconBox(1);
      const r = Math.min(rs.hw, rs.hh) * 0.92;
      const cx = rs.cx, cy = rs.cy;
      // Rose cut viewed from above: circular girdle, 6 triangular facets meeting at slightly-off-center apex
      let s = `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(2)}" fill="none" stroke="${c}" stroke-width="1.2"/>`;
      const apex = [cx, +(cy - r * 0.18).toFixed(2)];
      const segs = [];
      // 6 ridge lines from apex to girdle
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        segs.push([apex[0], apex[1], +(cx + Math.cos(a) * r).toFixed(2), +(cy + Math.sin(a) * r).toFixed(2)]);
      }
      // Inner hexagon showing facet bases at ~50% radius
      const midPts = [];
      for (let i = 0; i < 6; i++) {
        const a = ((i + 0.5) / 6) * Math.PI * 2 - Math.PI / 2;
        midPts.push([+(cx + Math.cos(a) * r * 0.5).toFixed(2), +(cy + Math.sin(a) * r * 0.5).toFixed(2)]);
      }
      s += `<path d="${midPts.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ')}Z" fill="none" stroke="${c}" stroke-width="0.65"/>`;
      return s + iconLines(c, f, segs);
    }
    if (shapeKey === 'briolette') {
      const br = iconBox(0.62); // taller than wide for a proper teardrop proportion
      const cx = br.cx, cy = br.cy;
      const rx = br.hw * 0.88;
      const topY = +(cy - br.hh * 0.92).toFixed(2);
      const botY = +(cy + br.hh * 0.92).toFixed(2);
      const wy = +(cy - br.hh * 0.1).toFixed(2); // widest point slightly above center
      // Doubly-pointed drop: cubic beziers for smooth teardrop outline
      const d = `M${cx},${topY} C${+(cx + rx * 0.9).toFixed(2)},${+(cy - br.hh * 0.5).toFixed(2)} ${+(cx + rx).toFixed(2)},${wy} ${cx},${botY} C${+(cx - rx).toFixed(2)},${wy} ${+(cx - rx * 0.9).toFixed(2)},${+(cy - br.hh * 0.5).toFixed(2)} ${cx},${topY}Z`;
      // Horizontal band lines — width approximated by outline shape at each y
      const segs = [];
      for (const v of [-0.55, -0.25, 0.1, 0.42, 0.7]) {
        const y = cy + v * br.hh;
        const frac = 1 - Math.abs((y - (+wy)) / (br.hh * 0.92)) * 0.85;
        const bx = rx * Math.max(0, frac) * 0.88;
        segs.push([+(cx - bx).toFixed(2), +y.toFixed(2), +(cx + bx).toFixed(2), +y.toFixed(2)]);
      }
      segs.push([cx, +( topY + 1).toFixed(2), cx, +(botY - 1).toFixed(2)]); // central spine
      return `<path d="${d}" fill="none" stroke="${c}" stroke-width="1.2"/>` + iconLines(c, f, segs);
    }
    if (shapeKey === 'flanders') {
      const fl = iconBox(1);
      const pts = [iconXY(fl, 0, -0.92), iconXY(fl, 0.65, -0.65), iconXY(fl, 0.92, 0), iconXY(fl, 0.65, 0.65), iconXY(fl, 0, 0.92), iconXY(fl, -0.65, 0.65), iconXY(fl, -0.92, 0), iconXY(fl, -0.65, -0.65)];
      return iconBrilliantElongated(fl, c, f, pts, 0.4);
    }
    return iconBrilliantElongated(box, c, f, [p(0, -0.9), p(0.75, 0), p(0, 0.9), p(-0.75, 0)], 0.4);
  }

  /** Full <svg> element string (HTML-safe). */
  function shapeIconSvg(shapeKey, size = 26, certRatio = null) {
    const iconKey = resolveShapeIconKey(shapeKey, certRatio);
    const inner = buildShapeIconInner(iconKey, certRatio);
    const label = shapeNames[shapeKey] || shapeNames[iconKey] || shapeKey;
    const title = certRatio && ratioGuides[iconKey]
      ? `${label} · L/W ${certRatio.toFixed(2)}`
      : label;
    const titleAttr = title ? ` title="${title.replace(/"/g, '&quot;')}"` : '';
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"${titleAttr}>${inner}</svg>`;
  }

  /** Standalone .svg file body (XML, 64×64 default). */
  function shapeIconSvgFile(shapeKey, size = 64, certRatio = null) {
    const iconKey = resolveShapeIconKey(shapeKey, certRatio);
    const inner = buildShapeIconInner(iconKey, certRatio);
    const label = shapeNames[shapeKey] || shapeNames[iconKey] || shapeKey;
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" role="img" aria-label="${label.replace(/"/g, '&quot;')}">\n${inner}\n</svg>\n`;
  }

  const ALL_SHAPE_KEYS = [...SHAPE_ICON_DRAWN].sort();

  return {
    shapeIconSvg,
    shapeIconSvgFile,
    buildShapeIconInner,
    resolveShapeIconKey,
    mapReportShapeToState,
    shapeNames,
    SHAPE_ICON_COLORS,
    ALL_SHAPE_KEYS,
  };
});
