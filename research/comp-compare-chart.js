/**
 * Chart-style comp comparison: current gem column + comp columns with per-stat modifiers.
 */

function escapeHTML(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function extractMultiplier(text) {
  const m = String(text || '').match(/[×÷]\s*([0-9]+(?:\.[0-9]+)?)/);
  if (!m) return String(text || '').trim();
  const sym = text.includes('÷') ? '÷' : '×';
  return `${sym}${m[1]}`;
}

export function modifiersFromParts(parts) {
  const mods = {};
  for (const part of parts || []) {
    const p = String(part);
    if (/^carat\b/i.test(p) || /price\/ct/i.test(p)) mods.carat = extractMultiplier(p);
    else if (/^color\b/i.test(p)) mods.color = extractMultiplier(p);
    else if (/^clarity\b/i.test(p)) mods.clarity = extractMultiplier(p);
    else if (/^shape\b/i.test(p)) mods.shape = extractMultiplier(p);
    else if (/source adjust/i.test(p)) mods.source = p.replace(/^source adjust\s*/i, '').trim();
    else if (/intensity\+carat/i.test(p)) mods.color = extractMultiplier(p);
    else if (/modifier\b/i.test(p)) mods.color = mods.color || extractMultiplier(p);
  }
  return mods;
}

function colorDisplay(row, isWhite) {
  if (!row) return '—';
  if (isWhite) return row.colorNormalized || row.color || row.whiteGrade || '—';
  return row.color || row.colorNormalized || '—';
}

function shapeDisplay(shape, shapeNames = {}) {
  if (!shape) return '—';
  return shapeNames[shape] || String(shape).replace(/_/g, ' ');
}

export function buildQuerySpec(state, ct, shapeNames) {
  const isWhite = state.colorFamily === 'white';
  return {
    carat: ct,
    shape: state.shape,
    shapeLabel: shapeDisplay(state.shape, shapeNames),
    color: isWhite ? state.whiteGrade : (state.colorReportRaw || state.colorFamily),
    clarity: state.clarity,
    cut: state.hasCutGrade ? state.cut : null,
    cutLabel: state.hasCutGrade ? (state.cut === 'ideal' ? 'EX / 3EX' : state.cut) : '—',
    growth: state.hpht ? 'HPHT' : state.cvd ? 'CVD' : state.asgrown ? 'As-grown' : '—',
    isWhite,
  };
}

export function columnFromCompEntry(entry, { id, title, tag, linksHtml = '' }) {
  const row = entry?.row || {};
  const parts = entry?.modifiers?.parts || entry?.parts || [];
  const isWhite = row.colorFamily === 'white' || (!row.colorFamily && !row.color);
  return {
    id,
    title,
    tag,
    linksHtml,
    listingPrice: entry?.listingPrice ?? row.priceUsd ?? null,
    estimatedPrice: entry?.estimatedPrice ?? null,
    values: {
      carat: row.carat ?? null,
      shape: row.shape ?? null,
      color: colorDisplay(row, isWhite),
      clarity: row.clarity ?? null,
      cut: '—',
      growth: '—',
      listingPrice: entry?.listingPrice ?? row.priceUsd ?? null,
      estimatedPrice: entry?.estimatedPrice ?? null,
    },
    modifiers: modifiersFromParts(parts),
  };
}

export function columnFromModelSource({ id, title, tag, spec, price, note = '' }) {
  return {
    id,
    title,
    tag,
    linksHtml: '',
    listingPrice: null,
    estimatedPrice: price,
    values: {
      carat: spec.carat,
      shape: spec.shapeLabel,
      color: spec.color,
      clarity: spec.clarity,
      cut: spec.cutLabel,
      growth: spec.growth,
      listingPrice: null,
      estimatedPrice: price,
    },
    modifiers: {},
    note,
  };
}

export function collectCompareColumns(ac, spec, { fmt, shapeNames }) {
  const columns = [];
  const seen = new Set();

  function push(col) {
    if (!col || !Number.isFinite(col.estimatedPrice)) return;
    if (seen.has(col.id)) return;
    seen.add(col.id);
    columns.push(col);
  }

  if (ac?.primary) {
    push(columnFromCompEntry(ac.primary, {
      id: `primary-${compColumnId(ac.primary)}`,
      title: 'Floor (primary)',
      tag: ac.matchType || 'comp',
    }));
  }

  for (const alt of ac?.alternatives || []) {
    push(columnFromCompEntry(alt, {
      id: `alt-${compColumnId(alt)}`,
      title: 'Near carat (same factory)',
      tag: 'alt',
    }));
  }

  for (const sc of ac?.supportComps || []) {
    if (sc.row && sameRowId(ac.primary, sc)) continue;
    push(columnFromCompEntry({
      row: sc.row,
      listingPrice: sc.row?.priceUsd,
      estimatedPrice: sc.estimatedPrice,
      modifiers: { parts: sc.parts },
    }, {
      id: `support-${compColumnId({ row: sc.row })}`,
      title: 'Blend support',
      tag: 'blend',
    }));
  }

  for (const entry of ac?.otherFactoryExact || []) {
    push(columnFromCompEntry(entry, {
      id: `other-${compColumnId(entry)}`,
      title: entry.supplierKey === 'messi' ? 'Messi (exact)' : 'Other factory',
      tag: 'exact',
    }));
  }

  return columns;
}

function compColumnId(entry) {
  const r = entry?.row || {};
  return `${entry?.supplierKey || ''}-${r.carat}-${r.shape}-${r.clarity}-${r.colorNormalized || r.color || ''}`;
}

function sameRowId(a, b) {
  if (!a?.row || !b?.row) return false;
  return compColumnId(a) === compColumnId(b);
}

export function collectPremiumColumns(ac, spec, marketCols, extras = {}) {
  const floor = ac?.estimate ?? ac?.primary?.estimatedPrice ?? 0;
  const threshold = floor * 1.02;
  const visibleIds = new Set(marketCols.map(c => c.id));
  const premium = [];

  function push(col) {
    if (!col || !Number.isFinite(col.estimatedPrice)) return;
    if (col.estimatedPrice < threshold) return;
    if (visibleIds.has(col.id)) return;
    premium.push(col);
    visibleIds.add(col.id);
  }

  for (const entry of ac?.supplierComparisons || []) {
    push(columnFromCompEntry(entry, {
      id: `sup-${compColumnId(entry)}`,
      title: entry.supplierKey === 'messi' ? 'Messi check' : (entry.supplierKey || 'Supplier'),
      tag: entry.matchType || 'check',
    }));
  }

  if (extras.mlPrice && extras.mlPrice >= threshold) {
    push(columnFromModelSource({
      id: 'model-ml',
      title: 'StarGem ML',
      tag: 'list model',
      spec,
      price: extras.mlPrice,
      note: 'Sheet list economics — often above Alibaba floor',
    }));
  }

  if (extras.lookupPrice && extras.lookupPrice >= threshold && Math.abs(extras.lookupPrice - (extras.mlPrice || 0)) > 2) {
    push(columnFromModelSource({
      id: 'model-lookup',
      title: 'StarGem lookup',
      tag: '/170 sheet',
      spec,
      price: extras.lookupPrice,
      note: 'Internal rate formula, not floor listing',
    }));
  }

  if (extras.reconciledPrice && extras.reconciledPrice >= threshold) {
    const alreadyShown = marketCols.some(c => Math.abs(c.estimatedPrice - extras.reconciledPrice) < 3);
    if (!alreadyShown) {
      push(columnFromModelSource({
        id: 'model-reconciled',
        title: 'Reconciled wholesale',
        tag: 'headline',
        spec,
        price: extras.reconciledPrice,
        note: 'Comp + ML blend shown in hero price',
      }));
    }
  }

  premium.sort((a, b) => (a.estimatedPrice || 0) - (b.estimatedPrice || 0));
  return premium;
}

function statRowsFor(spec, { includeRefs = false } = {}) {
  const rows = [
    { key: 'carat', label: 'Carat' },
    { key: 'shape', label: 'Shape' },
    { key: 'color', label: 'Color' },
    { key: 'clarity', label: 'Clarity' },
  ];
  if (spec.isWhite) {
    rows.push({ key: 'cut', label: 'Cut' });
    rows.push({ key: 'growth', label: 'Growth' });
  }
  if (includeRefs) {
    rows.push({ key: 'compFloor', label: 'Comp floor', price: true, currentOnly: true });
    rows.push({ key: 'lookupRef', label: 'Sheet lookup', price: true, currentOnly: true });
    rows.push({ key: 'mlRef', label: 'StarGem ML', price: true, currentOnly: true });
  }
  rows.push({ key: 'listingPrice', label: 'List price' });
  rows.push({ key: 'estimatedPrice', label: 'Wholesale (hero)', price: true });
  return rows;
}

function displayStat(key, val, spec, shapeNames) {
  if (val === null || val === undefined || val === '') return '—';
  if (key === 'carat' && Number.isFinite(Number(val))) return `${Number(val).toFixed(2)} ct`;
  if (key === 'shape') return shapeDisplay(val, shapeNames);
  if (key === 'listingPrice' || key === 'estimatedPrice') return null;
  return String(val);
}

function normShape(val, shapeNames) {
  if (!val) return '';
  const label = shapeNames[val] || val;
  return String(label).toLowerCase().replace(/\s+/g, ' ');
}

function valuesMatch(key, a, b, spec, shapeNames) {
  if (a === null || b === null || a === undefined || b === undefined) return true;
  if (key === 'carat') return Math.abs(Number(a) - Number(b)) < 0.005;
  if (key === 'shape') return normShape(a, shapeNames) === normShape(b, shapeNames);
  return String(a).toUpperCase() === String(b).toUpperCase();
}

function renderTable(currentCol, compCols, { fmt, shapeNames, currentOnlyRows = false }) {
  const spec = currentCol.spec;
  const rows = statRowsFor(spec, { includeRefs: currentOnlyRows });
  const allCols = [currentCol, ...compCols];

  let html = '<div class="comp-chart-scroll"><table class="comp-chart-table"><thead><tr>';
  html += '<th class="comp-chart-stat">Spec</th>';
  for (const col of allCols) {
    const tag = col.tag ? `<span class="comp-chart-tag">${escapeHTML(col.tag)}</span>` : '';
    html += `<th><div class="comp-chart-col-title">${escapeHTML(col.title)}</div>${tag}</th>`;
  }
  html += '</tr></thead><tbody>';

  for (const row of rows) {
    html += `<tr class="${row.price ? 'comp-chart-price-row' : ''}"><th>${escapeHTML(row.label)}</th>`;
    for (const col of allCols) {
      if (row.currentOnly && col !== currentCol) {
        html += '<td>—</td>';
        continue;
      }
      if (col === currentCol) {
        const v = col.values[row.key];
        if (row.price && Number.isFinite(v)) {
          const note = row.key === 'estimatedPrice' && col.subnote
            ? `<div class="comp-chart-note">${escapeHTML(col.subnote)}</div>`
            : '';
          html += `<td class="comp-chart-current"><strong>${fmt(v)}</strong>${note}</td>`;
        } else if ((row.key === 'listingPrice' || row.key === 'estimatedPrice' || row.currentOnly) && !Number.isFinite(v)) {
          html += '<td class="comp-chart-current">—</td>';
        } else {
          const d = row.key === 'listingPrice' || row.key === 'estimatedPrice'
            ? (Number.isFinite(v) ? fmt(v) : '—')
            : displayStat(row.key, v, spec, shapeNames);
          html += `<td class="comp-chart-current">${escapeHTML(d)}</td>`;
        }
        continue;
      }
      const v = col.values[row.key];
      const mod = col.modifiers[row.key];
      const differs = !valuesMatch(row.key, v, currentCol.values[row.key], spec, shapeNames);
      if (row.price && Number.isFinite(v)) {
        html += `<td><strong>${fmt(v)}</strong></td>`;
      } else if (row.key === 'listingPrice' && Number.isFinite(v)) {
        html += `<td>${fmt(v)}${differs && mod ? ` <em class="comp-cell-mod">${escapeHTML(mod)}</em>` : ''}</td>`;
      } else if (row.key === 'listingPrice' || row.key === 'estimatedPrice') {
        html += '<td>—</td>';
      } else {
        const d = displayStat(row.key, v, spec, shapeNames);
        const modHtml = differs && mod ? ` <em class="comp-cell-mod">${escapeHTML(mod)}</em>` : '';
        html += `<td class="${differs ? 'comp-chart-diff' : ''}">${escapeHTML(d)}${modHtml}</td>`;
      }
    }
    html += '</tr>';
  }

  html += '</tbody></table></div>';
  return html;
}

export function buildCurrentColumn(spec, extras, { fmt }) {
  return {
    id: 'current',
    title: 'Your stone',
    tag: 'selected',
    spec,
    values: {
      carat: spec.carat,
      shape: spec.shapeLabel,
      color: spec.color,
      clarity: spec.clarity,
      cut: spec.cutLabel,
      growth: spec.growth,
      listingPrice: null,
      compFloor: extras.compFloor ?? null,
      mlRef: extras.mlPrice ?? null,
      lookupRef: extras.lookupPrice ?? null,
      estimatedPrice: extras.reconciledPrice ?? null,
    },
    modifiers: {},
    subnote: extras.reconciledPerCt ? `${fmt(extras.reconciledPerCt)}/ct wholesale` : '',
  };
}

export function renderCompCompareFlow({
  ac,
  spec,
  fmt,
  fmtR,
  shapeNames,
  matchLabel,
  rangeNote = '',
  footerNote = '',
  extras = {},
}) {
  if (!ac || ac.matchType === 'none') return '';

  const currentCol = buildCurrentColumn(spec, extras, { fmt });
  const marketCols = collectCompareColumns(ac, spec, { fmt, shapeNames });
  const premiumCols = collectPremiumColumns(ac, spec, marketCols, extras);

  const headline = matchLabel || 'Comp market';
  const blendEstimate = ac.estimate ? fmt(ac.estimate) : '—';

  let html = `<div class="comp-compare-flow">`;
  html += `<div class="comp-compare-intro"><strong>${escapeHTML(headline)}</strong>`;
  if (ac.estimate) html += ` · floor blend <span class="comp-chart-est">${blendEstimate}</span>`;
  html += `</div>`;

  html += `<div class="comp-compare-section"><div class="comp-compare-section-title">Your stone</div>`;
  html += renderTable(currentCol, [], { fmt, shapeNames, currentOnlyRows: true });
  if (extras.reconciledLow && extras.reconciledHigh) {
    html += `<div class="comp-chart-band">${escapeHTML(extras.bandLabel || 'Holdout band')} ${fmtR(extras.reconciledLow, extras.reconciledHigh)}</div>`;
  }
  html += `</div>`;

  if (marketCols.length) {
    html += `<div class="comp-compare-section"><div class="comp-compare-section-title">Factory comps (adjusted to your stone)</div>`;
    html += renderTable(currentCol, marketCols, { fmt, shapeNames });
    html += `</div>`;
  }

  if (premiumCols.length) {
    html += `<details class="comp-compare-premium"><summary class="comp-compare-premium-summary">Higher list-price references (${premiumCols.length}) — ML, sheet, and listings above the floor</summary>`;
    html += `<p class="comp-compare-premium-note">These are <strong>not</strong> blended into the Alibaba floor. StarGem ML and lookup reflect sheet list economics; extra listings are cross-checks when you want a ceiling, not a negotiation floor.</p>`;
    html += renderTable(currentCol, premiumCols, { fmt, shapeNames });
    html += `</details>`;
  }

  if (footerNote) {
    html += `<div class="comp-compare-footer">${footerNote}${rangeNote ? ` ${rangeNote}` : ''}</div>`;
  }

  html += `</div>`;
  return html;
}

export default {
  modifiersFromParts,
  buildQuerySpec,
  renderCompCompareFlow,
  collectCompareColumns,
  collectPremiumColumns,
};
