#!/usr/bin/env python3
"""
analyze-starsgem.py
─────────────────────────────────────────────────────────────────────────────
Parses the Wuzhou StarGem IGI Lab Grown Diamond stock file
(STARS Diamonds Stock2026.5.20.xls) and produces:

  1. research/data/starsgem-index.json   — full machine-readable index
  2. research/data/starsgem-comps.json   — compact comp-pool array (for the app)
  3. Console summary report

Key logic:
  • Filters: only stones >= 1.00 ct with a price
  • Shape code normalization (ROUND/round→round, OVAL→oval, etc.)
  • L/W ratio computed from Measurement string "L - W - D"
  • Shape sub-variant bucketing via shape_buckets.classify_shape_by_lw()
  • Moval detection: OV + L/W >= 1.75
  • Elongated cushion detection: CUSHION + L/W >= 1.25 OR cut_hint == '长垫形'
  • Square radiant detection: RADIANT + L/W < 1.10
  • SQUARE shape → mapped to 'princess' (no cut grade; near-1:1 L/W)
  • Cut code mapping (传统切→traditional_brilliant, 冰花切→ice_flower, etc.)

Usage:
  python3 research/scripts/analyze-starsgem.py
─────────────────────────────────────────────────────────────────────────────
"""

import json, re, os, sys
from collections import defaultdict, Counter
from datetime import date

try:
    import xlrd
except ImportError:
    sys.exit("ERROR: xlrd not installed. Run: pip3 install xlrd")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shape_buckets import (
    classify_shape_by_lw, STARSGEM_SHAPE_MAP, STARSGEM_CUT_MAP,
    SHAPE_LW_BUCKETS
)

# ──────────────────────────────────────────────────────────────────────────────
# PATHS
# ──────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
DATA_DIR     = os.path.join(PROJECT_ROOT, 'data')
XLS_FILE     = os.path.join(DATA_DIR, 'STARS Diamonds Stock2026.5.20.xls')
OUTPUT_JSON  = os.path.join(DATA_DIR, 'starsgem-index.json')
COMPS_JSON   = os.path.join(DATA_DIR, 'starsgem-comps.json')
STARSGEM_FACTORY_URL = 'https://starsgem.en.alibaba.com/factory.html?spm=a27aq.24735993.8735814750.6.75a939e6ZJ3XPe'

# ──────────────────────────────────────────────────────────────────────────────
# §1  SHAPE LABELS
# ──────────────────────────────────────────────────────────────────────────────

SHAPE_LABELS = {
    'round':             'Round Brilliant (ROUND)',
    'oval':              'Oval (OVAL) — standard L/W',
    'oval_elongated':    'Elongated Oval (OVAL, L/W 1.55–1.74)',
    'moval':             'Moval (OVAL, L/W ≥ 1.75)',
    'pear':              'Pear Shape (PEAR)',
    'emerald':           'Emerald Cut (EMERALD)',
    'radiant':           'Radiant (RADIANT)',
    'sq_radiant':        'Square Radiant (RADIANT, L/W < 1.10)',
    'marquise':          'Marquise (MARQUISE)',
    'princess':          'Princess / Square (PRINCESS or SQUARE)',
    'heart':             'Heart (HEART)',
    'cushion':           'Cushion (CUSHION, L/W 1.03–1.24)',
    'square_cushion':    'Square Cushion (CUSHION, L/W < 1.03)',
    'elongated_cushion': 'Elongated / Rectangular Cushion (CUSHION, L/W ≥ 1.25 or 长垫形)',
    'asscher':           'Asscher (Asscher)',
    'ashoka':            'Ashoka (ASHOKA)',
}

# Unpriced specialty shapes that exist in the Cut column
CUT_SPECIALTY_MAP = {
    'old_mine':     'Old Mine Cut (老矿切)',
    'old_european': 'Old European Cut (老欧切)',
    'ice_flower':   'Ice Flower / Crushed Ice Cut (冰花切)',
    'traditional_brilliant': 'Traditional Brilliant (传统切)',
    'elongated_cushion_flag': 'Elongated Cushion (长垫形 flag)',
}

WHITE_COLOR_GRADES = {'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'}

# ──────────────────────────────────────────────────────────────────────────────
# §2  EXCEL PARSING
# ──────────────────────────────────────────────────────────────────────────────

def load_xls(path: str) -> list[dict]:
    wb = xlrd.open_workbook(path)
    ws = wb.sheet_by_name('Table')
    headers = [ws.cell_value(0, j) for j in range(ws.ncols)]
    rows = []
    for i in range(1, ws.nrows):
        row = {headers[j]: ws.cell_value(i, j) for j in range(ws.ncols)}
        row['__excelRow'] = i + 1
        rows.append(row)
    return rows


def parse_measurement(s: str):
    """Parse '10.21 - 6.49 - 4.43 ' → (10.21, 6.49, 4.43)"""
    if not s or not str(s).strip():
        return None, None, None
    parts = re.split(r'\s*-\s*', str(s).strip())
    nums = []
    for p in parts:
        try:
            nums.append(float(p.strip()))
        except (ValueError, TypeError):
            pass
    if len(nums) >= 3:
        return nums[0], nums[1], nums[2]
    if len(nums) == 2:
        return nums[0], nums[1], None
    return None, None, None


def safe_float(v):
    if v is None or v == '':
        return None
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


# ──────────────────────────────────────────────────────────────────────────────
# §3  ROW NORMALIZATION
# ──────────────────────────────────────────────────────────────────────────────

CLARITY_ORDER = ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2']
CLARITY_NORM = {
    'VVS': 'VVS2',   # ambiguous → treat as VVS2 (conservative)
    'VS':  'VS1',    # ambiguous → treat as VS1 (conservative)
}

def norm_clarity(c: str) -> str | None:
    c = (c or '').strip()
    if c in CLARITY_ORDER:
        return c
    return CLARITY_NORM.get(c)


def norm_color(c: str) -> str:
    return (c or '').strip().upper()


def normalise_row(raw: dict) -> dict | None:
    carat = safe_float(raw.get('Carat'))
    if carat is None or carat < 1.0:
        return None
    price = safe_float(raw.get('SaleDollorPrice'))
    if price is None or price <= 0:
        return None  # no price → skip

    raw_shape = str(raw.get('Shape') or '').strip()
    base_shape = STARSGEM_SHAPE_MAP.get(raw_shape)
    if base_shape is None:
        base_shape = 'unknown'

    raw_cut = str(raw.get('Cut') or '').strip()
    cut_canonical = STARSGEM_CUT_MAP.get(raw_cut, None)

    # Measurement parsing → L/W ratio
    s1, s2, s3 = parse_measurement(raw.get('Measurement'))
    lw_ratio = None
    if s1 and s2 and min(s1, s2) > 0:
        lw_ratio = round(max(s1, s2) / min(s1, s2), 4)

    # Shape sub-variant classification
    cut_hint = raw_cut if raw_cut in ('长垫形',) else ''
    bucket = classify_shape_by_lw(base_shape, lw_ratio, cut_hint)
    canonical_shape  = bucket['shape']
    sub_variant      = bucket['subVariant']
    sub_variant_label = bucket['subVariantLabel']

    color = norm_color(raw.get('Color', ''))
    clarity = norm_clarity(raw.get('Clarity', ''))

    # Skip ambiguous/unknown clarity
    if clarity is None:
        return None

    color_family = 'white' if color in WHITE_COLOR_GRADES else 'fancy'

    cut_grade = raw.get('Cut', '').strip()
    polish    = str(raw.get('Polish', '') or '').strip()
    sym       = str(raw.get('Symmetry', '') or '').strip()
    flu       = str(raw.get('Fluorescence', '') or '').strip()
    report    = str(raw.get('Report', '') or '').strip()
    report_no = str(raw.get('Reportno', '') or '').strip()
    growth    = str(raw.get('TypeName', '') or '').strip()
    table_pct = safe_float(raw.get('Table_Scale'))
    depth_pct = safe_float(raw.get('Depth_Scale'))

    price_per_carat = round(price / carat, 2) if carat > 0 else None

    # Normalize IGI variants (IGI / IGI(SH) both → IGI)
    lab_norm = 'IGI' if 'IGI' in report.upper() else report

    return {
        'rowNo':           int(raw.get('__excelRow')) if raw.get('__excelRow') else None,
        'rawShapeCode':    raw_shape,
        'rawCutCode':      raw_cut,
        'shape':           canonical_shape,
        'baseShape':       base_shape,
        'subVariant':      sub_variant,
        'subVariantLabel': sub_variant_label,
        'isMoval':         canonical_shape == 'moval',
        'isElongatedCushion': canonical_shape == 'elongated_cushion',
        'isSqRadiant':     canonical_shape == 'sq_radiant',
        'cutStyle':        cut_canonical,
        'isIceFlower':     cut_canonical == 'ice_flower',
        'isTraditional':   cut_canonical == 'traditional_brilliant',
        'carat':           carat,
        'color':           color,
        'colorFamily':     color_family,
        'clarity':         clarity,
        'cut':             cut_canonical if cut_canonical not in (
                               'elongated_cushion_flag', 'ice_flower',
                               'traditional_brilliant', 'old_mine', 'old_european'
                           ) else None,
        'polish':          polish or None,
        'symmetry':        sym or None,
        'fluorescence':    flu or None,
        'growthMethod':    growth or None,
        'lab':             lab_norm,
        'reportNo':        report_no or None,
        'size1':           s1,
        'size2':           s2,
        'size3':           s3,
        'lwRatio':         lw_ratio,
        'tablePct':        table_pct,
        'depthPct':        depth_pct,
        'pricePerStone':   price,
        'pricePerCarat':   price_per_carat,
    }


# ──────────────────────────────────────────────────────────────────────────────
# §4  COMPACT AGGREGATED COMP EXPORT
# Groups stones by (shape, color, clarity, 0.05ct bin) → median price per group.
# This gives ~3-5K bins instead of 22K individual records, keeping the file small.
# ──────────────────────────────────────────────────────────────────────────────

from statistics import median as _median

COMP_SKIP_SHAPES = {'unknown', 'lavender', 'ashoka', 'freeform_lip',
                    'old_mine', 'old_european', 'step_cut'}
COMP_WHITE_GRADES = {'D', 'E', 'F', 'G', 'H'}

def bin_carat(c):
    return round(round(c / 0.05) * 0.05, 2)


def build_comp_pool(records: list[dict]) -> list[dict]:
    """Aggregate individual stone records into (shape, color, clarity, carat-bin) groups."""
    groups = defaultdict(list)
    for r in records:
        if r.get('pricePerStone') is None:
            continue
        if r['shape'] in COMP_SKIP_SHAPES:
            continue
        if r['color'] not in COMP_WHITE_GRADES:
            continue
        if r['isIceFlower']:
            continue
        key = (r['shape'], r['color'], r['clarity'], bin_carat(r['carat']))
        groups[key].append(r)

    comps = []
    for (shape, color, clarity, carat), recs in sorted(groups.items()):
        prices = [r['pricePerStone'] for r in recs]
        source_rows = sorted(r['rowNo'] for r in recs if r.get('rowNo') is not None)
        report_nos = sorted(r['reportNo'] for r in recs if r.get('reportNo'))
        comps.append({
            'priceUsd':        round(_median(prices), 2),
            'carat':           carat,
            'shape':           shape,
            'clarity':         clarity,
            'colorFamily':     'white',
            'colorNormalized': color,
            'color':           None,
            'caratBand':       False,
            'clarityBand':     False,
            'confidence':      'high',
            'count':           len(prices),
            'priceMin':        min(prices),
            'priceMax':        max(prices),
            'label':           'StarGem IGI',
            'supplier':        'Wuzhou Starsgem Co., Ltd.',
            'section':         f'{shape} {color} {clarity} IGI — StarGem',
            'url':             STARSGEM_FACTORY_URL,
            'sourceType':      'supplier-sheet',
            'sourceKey':       'starsgem',
            'sourceFile':      'STARS Diamonds Stock2026.5.20.xls',
            'sourceRows':      source_rows[:8],
            'reportNos':       report_nos[:8],
        })
    return comps


# ──────────────────────────────────────────────────────────────────────────────
# §5  SUMMARY STATISTICS
# ──────────────────────────────────────────────────────────────────────────────

def build_summary(records: list[dict]) -> dict:
    by_shape = defaultdict(list)
    for r in records:
        by_shape[r['shape']].append(r)

    shape_stats = {}
    for shape, recs in sorted(by_shape.items(), key=lambda x: -len(x[1])):
        carats = [r['carat'] for r in recs]
        prices = [r['pricePerStone'] for r in recs if r.get('pricePerStone')]
        ppc    = [r['pricePerCarat'] for r in recs if r.get('pricePerCarat')]
        methods = Counter(r['growthMethod'] for r in recs)
        cut_styles = Counter(r['cutStyle'] for r in recs)
        shape_stats[shape] = {
            'count':         len(recs),
            'pricedCount':   len(prices),
            'caratMin':      min(carats),
            'caratMax':      max(carats),
            'uniqueCarats':  len(set(carats)),
            'priceMin':      min(prices) if prices else None,
            'priceMax':      max(prices) if prices else None,
            'ppcMin':        round(min(ppc), 2) if ppc else None,
            'ppcMax':        round(max(ppc), 2) if ppc else None,
            'growthMethods': dict(methods),
            'cutStyles':     {k: v for k, v in cut_styles.items() if k},
            'label':         SHAPE_LABELS.get(shape, shape),
        }

    all_prices = [r['pricePerStone'] for r in records if r.get('pricePerStone')]
    return {
        'totalStones':      len(records),
        'pricedStones':     len(all_prices),
        'uniqueShapes':     len(by_shape),
        'priceRange':       {'min': min(all_prices) if all_prices else None,
                             'max': max(all_prices) if all_prices else None},
        'colorBreakdown':   dict(Counter(r['color'] for r in records)),
        'clarityBreakdown': dict(Counter(r['clarity'] for r in records)),
        'growthMethods':    dict(Counter(r['growthMethod'] for r in records)),
        'cutStyles':        dict(Counter(r['cutStyle'] for r in records if r['cutStyle'])),
        'movalCount':       sum(1 for r in records if r['isMoval']),
        'elongatedCushionCount': sum(1 for r in records if r['isElongatedCushion']),
        'sqRadiantCount':   sum(1 for r in records if r['isSqRadiant']),
        'iceFlowerCount':   sum(1 for r in records if r['isIceFlower']),
        'shapeStats':       shape_stats,
    }


# ──────────────────────────────────────────────────────────────────────────────
# §6  MAIN
# ──────────────────────────────────────────────────────────────────────────────

def main():
    print(f"Loading: {XLS_FILE}")
    raw_rows = load_xls(XLS_FILE)
    print(f"  Raw rows: {len(raw_rows):,}")

    records = [normalise_row(r) for r in raw_rows]
    records = [r for r in records if r is not None]
    print(f"  Normalised (>= 1ct, priced, valid clarity): {len(records):,}")

    summary = build_summary(records)

    # Compact aggregated comp export
    comps = build_comp_pool(records)

    # ── Write full index ──────────────────────────────────────────────────────
    index = {
        'supplier':       'Wuzhou Starsgem Co., Ltd.',
        'location':       'Guangxi, China',
        'sourceFile':     'STARS Diamonds Stock2026.5.20.xls',
        'sourceDate':     '2026-05-20',
        'generatedDate':  str(date.today()),
        'purpose':        'Secondary source-of-truth comp index for StarGem IGI lab-grown diamonds (>=1ct, priced only)',
        'filterApplied':  'carat >= 1.00 AND pricePerStone > 0 AND clarity in standard set',
        'movalThreshold': 1.75,
        'elongatedCushionThreshold': 1.25,
        'sqRadiantThreshold': 1.10,
        'shapeCodeMap':   STARSGEM_SHAPE_MAP,
        'cutCodeMap':     STARSGEM_CUT_MAP,
        'shapeLabels':    SHAPE_LABELS,
        'summary':        summary,
        'records':        records,
    }

    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=2)
    print(f"\nFull index → {OUTPUT_JSON} ({len(records):,} records)")

    # ── Write compact comp file ───────────────────────────────────────────────
    comp_out = {
        'supplier':      'Wuzhou Starsgem Co., Ltd.',
        'sourceDate':    '2026-05-20',
        'generatedDate': str(date.today()),
        'compCount':     len(comps),
        'binSize':       '0.05ct',
        'comps':         comps,
    }
    with open(COMPS_JSON, 'w', encoding='utf-8') as f:
        json.dump(comp_out, f, ensure_ascii=False, separators=(',', ':'))
    sz = os.path.getsize(COMPS_JSON)
    print(f"Comp pool  → {COMPS_JSON} ({len(comps):,} bins, {sz//1024}KB)")

    # ── Console report ─────────────────────────────────────────────────────────
    print("\n" + "═" * 70)
    print("STARSGEM — IGI LAB DIAMOND ANALYSIS (>= 1 ct, priced)")
    print("═" * 70)
    print(f"  Total stones:            {summary['totalStones']:,}")
    print(f"  Priced stones:           {summary['pricedStones']:,}")
    print(f"  Unique shapes:           {summary['uniqueShapes']}")
    print(f"  Moval count:             {summary['movalCount']}")
    print(f"  Elongated cushion count: {summary['elongatedCushionCount']}")
    print(f"  Square radiant count:    {summary['sqRadiantCount']}")
    print(f"  Ice flower cut count:    {summary['iceFlowerCount']}")
    print(f"  Price range: ${summary['priceRange']['min']:.0f} – ${summary['priceRange']['max']:.0f}")

    print("\n── COLOR BREAKDOWN ──────────────────────────────────────────────────")
    for col, cnt in sorted(summary['colorBreakdown'].items(), key=lambda x: -x[1]):
        print(f"  {col or '(blank)':>8}: {cnt:,}")

    print("\n── CLARITY BREAKDOWN ────────────────────────────────────────────────")
    for cl in ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2']:
        cnt = summary['clarityBreakdown'].get(cl, 0)
        if cnt:
            print(f"  {cl:>6}: {cnt:,}")

    print("\n── GROWTH METHOD ────────────────────────────────────────────────────")
    for m, cnt in sorted(summary['growthMethods'].items(), key=lambda x: -x[1]):
        print(f"  {m or '(blank)':>6}: {cnt:,}")

    print("\n── CUT STYLES ───────────────────────────────────────────────────────")
    for cs, cnt in sorted(summary['cutStyles'].items(), key=lambda x: -x[1]):
        print(f"  {cs}: {cnt}")

    print("\n── SHAPES (sorted by count) ─────────────────────────────────────────")
    for shape, stat in sorted(summary['shapeStats'].items(), key=lambda x: -x[1]['count']):
        price_str = f"${stat['priceMin']:.0f}–${stat['priceMax']:.0f}" if stat['priceMin'] else "no price"
        methods = '/'.join(k for k in stat['growthMethods'] if k)
        print(f"  {shape:<20}  {stat['count']:>5} stones  "
              f"{stat['caratMin']:.2f}–{stat['caratMax']:.2f}ct  "
              f"{price_str}  [{methods}]")

    print(f"\nComp pool: {len(comps):,} records → {COMPS_JSON}")
    print("Done.")


if __name__ == '__main__':
    main()
