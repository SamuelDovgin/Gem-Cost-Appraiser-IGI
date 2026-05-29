#!/usr/bin/env node
/**
 * Build StarGem training-sample atlas: real sheet rows by shape × carat bucket × clarity,
 * compared to S20 ML lookup + prediction. Outputs JSON + standalone HTML research doc.
 */

import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildStarsgemRow,
  loadStarsgemMlModel,
  predictStarsgemMl,
  starsgemCaratBucket,
  starsgemNorm,
} from './starsgem-ml-predict.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const CLARITY_ORDER = ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2'];
const COLOR_ORDER = ['D', 'E', 'F', 'G', 'H'];
const SHAPES = [
  'ROUND', 'OVAL', 'MARQUISE', 'PEAR', 'CUSHION', 'EMERALD', 'RADIANT', 'PRINCESS', 'HEART', 'ASSCHER',
];
const BUCKET_MID_CARAT = {
  '<0.30': 0.25,
  '0.30-0.49': 0.4,
  '0.50-0.69': 0.6,
  '0.70-0.89': 0.8,
  '0.90-0.99': 0.95,
  '1.00-1.49': 1.25,
  '1.50-1.99': 1.75,
  '2.00-2.99': 2.5,
  '3.00-3.99': 3.5,
  '4.00-4.99': 4.25,
  '5.00-9.99': 6,
  '10.00+': 11,
};
const BUCKETS_INDEXED = [
  '1.00-1.49', '1.50-1.99', '2.00-2.99', '3.00-3.99', '4.00-4.99', '5.00-9.99', '10.00+',
];
const MAX_SAMPLES_PER_CELL = 8;
const IGI_PDF = 'https://pdf.igi.org/';
const XLSX_VIEWER = 'spreadsheet-viewer.html?source=starsgem&rows=';

function median(arr) {
  const s = arr.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function pct(arr, p) {
  const s = arr.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
}

function mlShapeFromRecord(rec) {
  const raw = starsgemNorm(rec.rawShapeCode || rec.shape || '');
  if (raw && raw !== '-') {
    if (raw === 'ASSCHER' || raw === 'SQUARE') return raw === 'SQUARE' ? 'PRINCESS' : 'ASSCHER';
    return raw;
  }
  const base = String(rec.baseShape || rec.shape || '').toLowerCase();
  const map = {
    round: 'ROUND', oval: 'OVAL', marquise: 'MARQUISE', pear: 'PEAR', cushion: 'CUSHION',
    emerald: 'EMERALD', radiant: 'RADIANT', princess: 'PRINCESS', heart: 'HEART', asscher: 'ASSCHER',
  };
  return map[base] || raw || 'ROUND';
}

function defaultCut(shape) {
  return shape === 'HEART' || shape === 'MARQUISE' ? '-' : 'ID';
}

function pickSpreadSamples(rows, maxN) {
  if (rows.length <= maxN) return rows;
  const sorted = [...rows].sort((a, b) => a.pricePerCarat - b.pricePerCarat);
  const picks = new Set();
  picks.add(0);
  picks.add(sorted.length - 1);
  picks.add(Math.floor(sorted.length / 2));
  for (let i = 1; picks.size < maxN && i < sorted.length - 1; i++) {
    const idx = Math.round((i / (maxN - 1)) * (sorted.length - 1));
    picks.add(idx);
  }
  return [...picks].sort((a, b) => a - b).map((i) => sorted[i]);
}

function compactSample(rec) {
  return {
    rowNo: rec.rowNo,
    carat: rec.carat,
    color: rec.color,
    clarity: rec.clarity,
    cut: rec.cut || rec.rawCutCode || null,
    growth: rec.growthMethod || null,
    price: Math.round(rec.pricePerStone * 100) / 100,
    perCt: Math.round(rec.pricePerCarat * 100) / 100,
    reportNo: rec.reportNo || rec.igi?.reportNumber || null,
    pdfSlug: rec.igiPdfSlug || rec.igi?.pdfSlug || null,
    measurements: rec.igi?.measurements || (rec.size1 ? `${rec.size1}×${rec.size2}×${rec.size3}` : null),
    lwRatio: rec.lwRatio != null ? Math.round(rec.lwRatio * 100) / 100 : null,
  };
}

function indexRecords(records) {
  const cells = new Map();
  for (const rec of records) {
    if (rec.colorFamily !== 'white') continue;
    const clarity = starsgemNorm(rec.clarity);
    if (!CLARITY_ORDER.includes(clarity)) continue;
    const color = starsgemNorm(rec.color);
    if (!COLOR_ORDER.includes(color)) continue;
    const shape = mlShapeFromRecord(rec);
    if (!SHAPES.includes(shape)) continue;
    const bucket = starsgemCaratBucket(rec.carat);
    const key = `${shape}||${bucket}||${color}||${clarity}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(rec);
  }
  return cells;
}

function buildCellStats(records, model, shape, bucket, color, clarity) {
  const perCt = records.map((r) => r.pricePerCarat);
  const caratMid = BUCKET_MID_CARAT[bucket] ?? 2;
  const cut = defaultCut(shape);
  const mlRow = buildStarsgemRow({
    carat: caratMid,
    shape,
    color,
    clarity,
    cut,
    typeName: '-',
    polish: 'EX',
    symmetry: 'EX',
  });
  const ml = predictStarsgemMl(mlRow, model);
  const samples = pickSpreadSamples(records, MAX_SAMPLES_PER_CELL).map(compactSample);
  const trainingMedian = median(perCt);
  const mlPerCt = ml?.perCt ?? null;
  return {
    shape,
    bucket,
    color,
    clarity,
    caratMid,
    count: records.length,
    training: {
      medianPerCt: trainingMedian != null ? Math.round(trainingMedian) : null,
      p25PerCt: pct(perCt, 0.25) != null ? Math.round(pct(perCt, 0.25)) : null,
      p75PerCt: pct(perCt, 0.75) != null ? Math.round(pct(perCt, 0.75)) : null,
      minPerCt: perCt.length ? Math.round(Math.min(...perCt)) : null,
      maxPerCt: perCt.length ? Math.round(Math.max(...perCt)) : null,
      medianCarat: median(records.map((r) => r.carat)) != null
        ? Math.round(median(records.map((r) => r.carat)) * 100) / 100
        : null,
    },
    ml: ml ? {
      perCt: Math.round(ml.perCt),
      price: Math.round(ml.price),
      lookupRate: ml.lookupRate != null ? Math.round(ml.lookupRate) : null,
      lookupCount: ml.lookupCount,
      lookupLevel: ml.lookupLevel,
      residualMult: ml.residualMult != null ? Math.round(ml.residualMult * 1000) / 1000 : null,
    } : null,
    mlVsTrainingPct: trainingMedian && ml?.perCt
      ? Math.round(((ml.perCt - trainingMedian) / trainingMedian) * 1000) / 10
      : null,
    samples,
    viewerUrl: samples.length
      ? XLSX_VIEWER + samples.map((s) => s.rowNo).join(',')
      : null,
  };
}

function ladderForShapeColor(cells, model, shape, color, bucket) {
  return CLARITY_ORDER.map((clarity) => {
    const key = `${shape}||${bucket}||${color}||${clarity}`;
    const recs = cells.get(key) || [];
    return buildCellStats(recs, model, shape, bucket, color, clarity);
  });
}

const index = JSON.parse(readFileSync(path.join(ROOT, 'research/data/starsgem-index.json'), 'utf8'));
const model = await loadStarsgemMlModel();
const cells = indexRecords(index.records || []);
const generatedAt = new Date().toISOString().slice(0, 10);

const shapeSections = [];
for (const shape of SHAPES) {
  const buckets = [];
  for (const bucket of BUCKETS_INDEXED) {
    const ladders = {};
    for (const color of ['D', 'E', 'F']) {
      ladders[color] = ladderForShapeColor(cells, model, shape, color, bucket);
    }
    const totalN = CLARITY_ORDER.reduce((s, cl) => {
      return s + (cells.get(`${shape}||${bucket}||E||${cl}`)?.length || 0);
    }, 0);
    buckets.push({ bucket, caratMid: BUCKET_MID_CARAT[bucket], totalSamplesE: totalN, ladders });
  }
  const shapeTotal = [...cells.keys()].filter((k) => k.startsWith(shape + '||')).reduce((s, k) => s + cells.get(k).length, 0);
  shapeSections.push({ shape, totalSamples: shapeTotal, buckets });
}

const pinnedCases = [
  { label: 'Marquise 4.08ct E VVS2 (near your cert)', shape: 'MARQUISE', carat: 4.08, color: 'E', clarity: 'VVS2' },
  { label: 'Marquise 4.08ct E SI1', shape: 'MARQUISE', carat: 4.08, color: 'E', clarity: 'SI1' },
  { label: 'Round 2ct E VS1', shape: 'ROUND', carat: 2, color: 'E', clarity: 'VS1' },
].map((pin) => {
  const tol = 0.35;
  const near = (index.records || []).filter((r) => {
    if (mlShapeFromRecord(r) !== pin.shape) return false;
    if (starsgemNorm(r.color) !== pin.color) return false;
    if (starsgemNorm(r.clarity) !== pin.clarity) return false;
    return Math.abs(r.carat - pin.carat) <= tol;
  });
  const ml = predictStarsgemMl(buildStarsgemRow({
    carat: pin.carat,
    shape: pin.shape,
    color: pin.color,
    clarity: pin.clarity,
    cut: defaultCut(pin.shape),
  }), model);
  return {
    ...pin,
    nearCount: near.length,
    nearSamples: pickSpreadSamples(near, 12).map(compactSample),
    ml: ml ? { perCt: Math.round(ml.perCt), lookupCount: ml.lookupCount, lookupRate: Math.round(ml.lookupRate) } : null,
    trainingMedian: median(near.map((r) => r.pricePerCarat)) != null
      ? Math.round(median(near.map((r) => r.pricePerCarat)))
      : null,
  };
});

const coverageMatrix = [];
for (const shape of SHAPES) {
  const row = { shape, buckets: {} };
  for (const bucket of BUCKETS_INDEXED) {
    row.buckets[bucket] = {};
    for (const clarity of CLARITY_ORDER) {
      const key = `${shape}||${bucket}||E||${clarity}`;
      row.buckets[bucket][clarity] = cells.get(key)?.length || 0;
    }
  }
  coverageMatrix.push(row);
}

const payload = {
  generatedAt,
  source: {
    file: index.sourceFile,
    supplier: index.supplier,
    filter: index.filterApplied,
    totalRecords: index.records?.length ?? 0,
    indexedWhite: [...cells.values()].reduce((s, a) => s + a.length, 0),
    claritiesInIndex: [...new Set((index.records || []).map((r) => r.clarity))].sort(),
  },
  modelName: model.modelName,
  shapes: SHAPES,
  buckets: BUCKETS_INDEXED,
  clarityOrder: CLARITY_ORDER,
  colorOrder: COLOR_ORDER,
  coverageMatrix,
  pinnedCases,
  shapeSections,
};

const jsonPath = path.join(ROOT, 'research/data/ml-sample-atlas.json');
writeFileSync(jsonPath, JSON.stringify(payload));
console.log(`Wrote ${jsonPath} (${(JSON.stringify(payload).length / 1024 / 1024).toFixed(2)} MB)`);

// Emit HTML shell (charts load JSON)
const htmlPath = path.join(ROOT, 'research/ml-sample-atlas.html');
writeFileSync(htmlPath, buildHtmlShell());
console.log(`Wrote ${htmlPath}`);

function buildHtmlShell() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>StarGem sample atlas — training rows vs S20 ML</title>
  <style>
    :root { --ink:#1f2933; --muted:#697586; --line:#d8dee8; --surface:#fff; --bg:#f6f7f9; --accent:#176c7d; --train:#2f855a; --ml:#6d5bd0; --sparse:#b45309; }
    *{box-sizing:border-box}
    body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,system-ui,sans-serif;line-height:1.45}
    header{padding:20px 24px;border-bottom:1px solid var(--line);background:var(--surface);position:sticky;top:0;z-index:3}
    h1{margin:0 0 6px;font-size:22px;font-weight:720}
  .meta{color:var(--muted);font-size:13px;display:flex;flex-wrap:wrap;gap:8px 16px}
    nav.toc{position:sticky;top:72px;max-height:calc(100vh - 90px);overflow:auto;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:12px;font-size:13px}
    nav.toc a{display:block;padding:4px 0;color:var(--accent);text-decoration:none}
    nav.toc a:hover{text-decoration:underline}
    main{max-width:1600px;margin:0 auto;padding:20px 24px 60px;display:grid;grid-template-columns:200px 1fr;gap:20px}
    @media(max-width:1000px){main{grid-template-columns:1fr}nav.toc{position:static;max-height:none}}
    .panel{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:16px;margin-bottom:16px}
    h2{margin:0 0 12px;font-size:17px}
    h3{margin:16px 0 8px;font-size:14px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
    .summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}
    .metric{padding:12px;border:1px solid var(--line);border-radius:8px;background:var(--surface)}
    .metric .l{font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:650}
    .metric .v{font-size:18px;font-weight:740;margin-top:4px}
    svg{width:100%;height:auto;background:#fbfcfd;border:1px solid #eef1f5;border-radius:6px}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
    th{color:var(--muted);font-size:10px;text-transform:uppercase}
    tr.empty td{color:var(--muted);font-style:italic}
    tr.sparse td{background:rgba(180,83,9,.06)}
    tr.invert td{background:rgba(159,18,57,.07)}
    .samples{font-size:11px;color:var(--muted);max-width:280px}
    .samples a{color:var(--accent)}
    .legend{display:flex;flex-wrap:wrap;gap:10px 16px;font-size:12px;color:var(--muted);margin-top:8px}
    .key{display:inline-flex;align-items:center;gap:6px}
    .sw{width:16px;height:3px;border-radius:2px}
    details{margin:8px 0}
    details summary{cursor:pointer;font-weight:600;font-size:13px}
    .pin-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px}
    .pin-card{border:1px solid var(--line);border-radius:8px;padding:12px}
    #status{padding:24px;color:var(--muted)}
  </style>
</head>
<body>
  <header>
    <h1>StarGem sample atlas — real stock vs S20 ML</h1>
    <div class="meta">
      <span id="hdr-source">Loading…</span>
      <span id="hdr-model"></span>
      <span>Run <code>node research/scripts/build-ml-sample-atlas.mjs</code> to refresh</span>
    </div>
  </header>
  <div id="status">Loading atlas data…</div>
  <main id="app" hidden>
    <nav class="toc" id="toc"></nav>
    <div id="content">
      <div class="summary" id="top-metrics"></div>
      <div class="panel" id="coverage-panel"><h2>Sample coverage — E color (stone count per cell)</h2>
        <p style="color:var(--muted);font-size:13px;margin:0 0 10px">Darker = more real stock rows in that shape × carat bucket × clarity. Empty cells explain ML lookup fallbacks.</p>
        <div id="coverage-heat"></div>
      </div>
      <div class="panel" id="pinned-panel"><h2>Pinned lookups (near-match samples from sheet)</h2><div class="pin-grid" id="pinned"></div></div>
      <div id="shapes"></div>
    </div>
  </main>
  <script>
    const DATA_URL = 'data/ml-sample-atlas.json';
    const CLARITY = ['IF','VVS1','VVS2','VS1','VS2','SI1','SI2'];
    const IGI = 'https://pdf.igi.org/viewpdf.htm?r=';

    let D;

    function fmt(n){ return n==null?'—':'$'+Number(n).toLocaleString(); }

    function chart(el, series, labels, opts={}) {
      const W=opts.width||900, H=opts.height||260, pad={l:52,r:16,t:16,b:40};
      const pts=series.flatMap(s=>s.values);
      const maxY=Math.max(...pts.filter(Number.isFinite),1)*1.1;
      const sx=i=>pad.l+i/(labels.length-1||1)*(W-pad.l-pad.r);
      const sy=y=>H-pad.b-(y/maxY)*(H-pad.t-pad.b);
      let g='';
      for(let i=0;i<=4;i++){const y=maxY*i/4;g+=\`<line x1="\${pad.l}" x2="\${W-pad.r}" y1="\${sy(y)}" y2="\${sy(y)}" stroke="#e8edf3"/>\`;
        g+=\`<text x="\${pad.l-6}" y="\${sy(y)+4}" text-anchor="end" font-size="10" fill="#697586">\${Math.round(y)}</text>\`;}
      labels.forEach((lab,i)=>{g+=\`<text x="\${sx(i)}" y="\${H-8}" text-anchor="middle" font-size="10" fill="#697586">\${lab}</text>\`;});
      const colors=['#2f855a','#6d5bd0','#176c7d','#b45309'];
      series.forEach((s,si)=>{
        const d=s.values.map((y,i)=>\`\${i?'L':'M'}\${sx(i).toFixed(1)},\${sy(y||0).toFixed(1)}\`).join(' ');
        g+=\`<path d="\${d}" fill="none" stroke="\${s.color||colors[si%colors.length]}" stroke-width="2.2"/>\`;
        s.values.forEach((y,i)=>{if(y==null)return;g+=\`<circle cx="\${sx(i)}" cy="\${sy(y)}" r="3.5" fill="\${s.color||colors[si%colors.length]}"/>\`;});
      });
      el.innerHTML=\`<svg viewBox="0 0 \${W} \${H}">\${g}<text x="\${pad.l}" y="14" font-size="10" fill="#697586">\${opts.ylabel||'$/ct'}</text></svg>\`;
    }

    function renderCoverage() {
      const el=document.getElementById('coverage-heat');
      let max=1;
      D.coverageMatrix.forEach(r=>D.buckets.forEach(b=>D.clarityOrder.forEach(c=>{
        max=Math.max(max,r.buckets[b][c]||0);
      })));
      let html='<div style="overflow:auto"><table><thead><tr><th>Shape</th>';
      for(const b of D.buckets){
        html+=\`<th colspan="\${D.clarityOrder.length}">\${b}</th>\`;
      }
      html+='</tr><tr><th></th>';
      for(const b of D.buckets){
        for(const c of D.clarityOrder) html+=\`<th>\${c}</th>\`;
      }
      html+='</tr></thead><tbody>';
      for(const row of D.coverageMatrix){
        html+=\`<tr><td><strong>\${row.shape}</strong></td>\`;
        for(const b of D.buckets){
          for(const c of D.clarityOrder){
            const n=row.buckets[b][c]||0;
            const t=n/max;
            const bg=n?\`rgba(23,108,125,\${0.06+t*0.5})\`:'transparent';
            html+=\`<td style="background:\${bg};text-align:center">\${n||'·'}</td>\`;
          }
        }
        html+='</tr>';
      }
      html+='</tbody></table></div>';
      el.innerHTML=html;
    }

    function renderPinned() {
      const wrap=document.getElementById('pinned');
      wrap.innerHTML=D.pinnedCases.map(p=>\`
        <div class="pin-card">
          <strong>\${p.label}</strong>
          <div style="font-size:13px;margin:6px 0">
            Sheet near-match (±0.35ct): <strong>\${p.nearCount}</strong> stones ·
            training median \${fmt(p.trainingMedian)}/ct ·
            ML \${fmt(p.ml?.perCt)}/ct (lookup n=\${p.ml?.lookupCount??'—'})
          </div>
          <table><thead><tr><th>Row</th><th>ct</th><th>$/ct</th><th>IGI</th></tr></thead><tbody>
          \${(p.nearSamples||[]).map(s=>\`<tr><td>\${s.rowNo}</td><td>\${s.carat}</td><td>\${fmt(s.perCt)}</td><td>\${s.pdfSlug?'<a href="'+IGI+s.pdfSlug+'" target="_blank">PDF</a>':'—'}</td></tr>\`).join('')||'<tr><td colspan="4">No sheet rows in window</td></tr>'}
          </tbody></table>
        </div>\`).join('');
    }

    function cellTable(ladder, color) {
      let html='<table><thead><tr><th>Clarity</th><th>n</th><th>Train med</th><th>p25–p75</th><th>ML</th><th>Δ ML vs med</th><th>Samples</th></tr></thead><tbody>';
      let prev=null;
      for(const c of ladder){
        const sparse=c.count>0&&c.count<5;
        const inv=prev&&c.training.medianPerCt&&prev.training.medianPerCt&&c.training.medianPerCt<prev.training.medianPerCt;
        const cls=[!c.count?'empty':'',sparse?'sparse':'',inv?'invert':''].filter(Boolean).join(' ');
        const samp=(c.samples||[]).slice(0,4).map(s=>
          \`<div>\${s.carat}ct \${fmt(s.perCt)} <a href="\${IGI}\${s.pdfSlug||''}" target="_blank">\${(s.reportNo||'').slice(-6)}</a></div>\`
        ).join('');
        html+=\`<tr class="\${cls}"><td>\${c.clarity}</td><td>\${c.count||'—'}</td>
          <td>\${fmt(c.training.medianPerCt)}</td>
          <td>\${c.training.p25PerCt!=null?fmt(c.training.p25PerCt)+'–'+fmt(c.training.p75PerCt):'—'}</td>
          <td>\${fmt(c.ml?.perCt)} <span style="color:var(--muted)">(lkp n=\${c.ml?.lookupCount??'—'})</span></td>
          <td>\${c.mlVsTrainingPct!=null?((c.mlVsTrainingPct>=0?'+':'')+c.mlVsTrainingPct+'%'):'—'}</td>
          <td class="samples">\${samp||'—'} \${c.viewerUrl?'<a href="'+c.viewerUrl+'">all rows ↗</a>':''}</td></tr>\`;
        if(c.training.medianPerCt) prev=c;
      }
      return html+'</tbody></table>';
    }

    function renderShape(sec) {
      const id='shape-'+sec.shape;
      const el=document.createElement('section');
      el.className='panel';
      el.id=id;
      el.innerHTML=\`<h2>\${sec.shape} <span style="color:var(--muted);font-weight:500">(\${sec.totalSamples.toLocaleString()} indexed stones)</span></h2>\`;
      for(const b of sec.buckets){
        const block=document.createElement('div');
        block.innerHTML=\`<h3>\${b.bucket} · ~\${b.caratMid}ct reference · E-color: \${b.totalSamplesE} stones</h3>\`;
        const chartDiv=document.createElement('div');
        block.appendChild(chartDiv);
        const lad=b.ladders.E;
        chart(chartDiv,[
          {name:'Training median',color:'#2f855a',values:lad.map(c=>c.training.medianPerCt)},
          {name:'S20 ML',color:'#6d5bd0',values:lad.map(c=>c.ml?.perCt)},
          {name:'Lookup anchor',color:'#b45309',values:lad.map(c=>c.ml?.lookupRate)},
        ], CLARITY, {ylabel:'$/ct',height:240});
        const leg=document.createElement('div');
        leg.className='legend';
        leg.innerHTML='<span class="key"><span class="sw" style="background:#2f855a"></span>Training median (real sheet)</span><span class="key"><span class="sw" style="background:#6d5bd0"></span>S20 ML</span><span class="key"><span class="sw" style="background:#b45309"></span>Lookup anchor</span>';
        block.appendChild(leg);
        for(const col of ['E','D','F']){
          const det=document.createElement('details');
          det.innerHTML=\`<summary>Color \${col} — sample table</summary>\${cellTable(b.ladders[col], col)}\`;
          block.appendChild(det);
        }
        el.appendChild(block);
      }
      return el;
    }

    async function init(){
      const res=await fetch(DATA_URL);
      if(!res.ok) throw new Error('Load '+DATA_URL+': '+res.status);
      D=await res.json();
      document.getElementById('hdr-source').textContent=
        D.source.supplier+' · '+D.source.file+' · '+D.source.indexedWhite.toLocaleString()+' white stones indexed';
      document.getElementById('hdr-model').textContent=D.modelName;
      document.getElementById('top-metrics').innerHTML=[
        ['Total sheet rows', D.source.totalRecords.toLocaleString()],
        ['White indexed', D.source.indexedWhite.toLocaleString()],
        ['Shapes', D.shapes.length],
        ['Buckets × clarities', D.buckets.length+'×'+D.clarityOrder.length],
      ].map(([l,v])=>\`<div class="metric"><div class="l">\${l}</div><div class="v">\${v}</div></div>\`).join('');
      const toc=document.getElementById('toc');
      toc.innerHTML='<strong>Shapes</strong>'+D.shapeSections.map(s=>
        \`<a href="#shape-\${s.shape}">\${s.shape} (\${s.totalSamples})</a>\`).join('');
      renderCoverage();
      renderPinned();
      const shapes=document.getElementById('shapes');
      D.shapeSections.forEach(s=>shapes.appendChild(renderShape(s)));
      document.getElementById('status').hidden=true;
      document.getElementById('app').hidden=false;
    }
    init().catch(e=>{document.getElementById('status').textContent=e.message;});
  </script>
</body>
</html>`;
}
