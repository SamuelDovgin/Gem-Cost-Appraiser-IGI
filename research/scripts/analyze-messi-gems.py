#!/usr/bin/env python3
"""
analyze-messi-gems.py
─────────────────────────────────────────────────────────────────────────────
Parses the Wuzhou Messi Gems IGI Lab Grown Diamond price list Excel file
(IGI Lab Grown Diamond List.2026.05.18xls.xlsx) and produces:

  1. research/data/messi-gems-index.json  — machine-readable comp index
  2. Console summary report               — shape/color/clarity breakdowns

Key logic:
  • Filters: only stones >= 1.00 ct
  • Shape code mapping (RD→round, OV→oval, MQ→marquise, etc.)
  • Moval auto-detection: any OV stone with L/W ratio >= 1.75 is reclassified
    as "moval" (a very elongated oval, between oval and marquise in outline)
  • colorFamily assignment: D/E/F/G/H → "white"; anything else → "fancy"
  • Both pricePerStone and pricePerCarat recorded where available

Usage:
  cd "research/scripts"
  python3 analyze-messi-gems.py

  Or from project root:
  python3 research/scripts/analyze-messi-gems.py
─────────────────────────────────────────────────────────────────────────────
"""

import json
import os
import sys
from collections import defaultdict, Counter
from datetime import date
from statistics import median

try:
    import openpyxl
except ImportError:
    sys.exit("ERROR: openpyxl not installed. Run: pip3 install openpyxl")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shape_buckets import classify_shape_by_lw, MESSI_SHAPE_MAP
from igi_enrichment import apply_enrichment_to_records, load_enrichment
from igi_shape_cache import apply_igi_shape_cache, load_cache

# ──────────────────────────────────────────────────────────────────────────────
# PATHS
# ──────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)           # research/
DATA_DIR = os.path.join(PROJECT_ROOT, 'data')
EXCEL_FILE = os.path.join(DATA_DIR, 'IGI Lab Grown Diamond List.2026.05.18xls.xlsx')
OUTPUT_JSON = os.path.join(DATA_DIR, 'messi-gems-index.json')
COMPS_JSON  = os.path.join(DATA_DIR, 'messi-comps.json')
MESSI_FACTORY_URL = 'https://messijewelry.en.alibaba.com/factory.html?spm=a27aq.24735993.8735814750.1.75a939e6ZJ3XPe'

# ──────────────────────────────────────────────────────────────────────────────
# §1  SHAPE CODE MAPPING  (imported from shape_buckets.py)
# ──────────────────────────────────────────────────────────────────────────────
# MESSI_SHAPE_MAP maps raw Excel shape codes → base canonical shape.
# Sub-variant (moval, elongated_cushion, sq_radiant, etc.) is then derived
# by classify_shape_by_lw() using the stone's measured L/W ratio.

SHAPE_CODE_MAP = MESSI_SHAPE_MAP  # alias for backwards compat

# Human-readable labels for the source-of-truth doc
SHAPE_LABELS = {
    'round':         'Round Brilliant (RD)',
    'oval':          'Oval (OV)',
    'moval':         'Moval — elongated oval (OV, L/W ≥ 1.75)',
    'pear':          'Pear Shape (PS)',
    'emerald':       'Emerald Cut (EM)',
    'radiant':       'Radiant (RA)',
    'marquise':      'Marquise (MQ)',
    'princess':      'Princess (PR)',
    'heart':         'Heart (HT)',
    'cushion':       'Cushion (CU)',
    'ice_oval':      'Ice / Rough-polished Oval (ICE OV)',
    'asscher':       'Asscher (AS)',
    'ice_pear':      'Ice / Rough-polished Pear (ICE PS)',
    'lavender':      'Lavender cut (LV) — specialty, no prices',
    'ashoka':        'Ashoka (阿育王) — elongated cushion hybrid, large stones',
    'old_mine':      'Old Mine Cut (老矿切)',
    'step_cut':      'Step Cut (阶梯切)',
    'trilliant':     'Trilliant / Fat Triangle (肥三角)',
    'freeform_lip':  'Free-Form Lip Shape (自由形式 唇形)',
    'old_european':  'Old European Cut (老欧切)',
}

# ──────────────────────────────────────────────────────────────────────────────
# §2  MOVAL / SHAPE SUB-VARIANT DETECTION
# ──────────────────────────────────────────────────────────────────────────────
# Sub-variant classification (moval, elongated_cushion, sq_radiant, etc.) is
# handled by shape_buckets.classify_shape_by_lw().
#
# Moval threshold: OV stones with L/W >= 1.75 (bimodal gap confirmed in data:
#   - standard ovals: L/W 1.40–1.55; movals: L/W 1.90–2.00)
MOVAL_LW_THRESHOLD = 1.75


# ──────────────────────────────────────────────────────────────────────────────
# §3  COLOR FAMILY
# ──────────────────────────────────────────────────────────────────────────────

WHITE_COLOR_GRADES = {'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'}

def color_family(col_code: str) -> str:
    """Return 'white' or 'fancy' based on the color grade."""
    if col_code and col_code.upper() in WHITE_COLOR_GRADES:
        return 'white'
    return 'fancy'


# ──────────────────────────────────────────────────────────────────────────────
# §4  EXCEL PARSING
# ──────────────────────────────────────────────────────────────────────────────

def load_excel(path: str) -> list[dict]:
    """Load all rows from the Excel file, return as list of dicts."""
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb['总表']
    raw_rows = list(ws.iter_rows(values_only=True))
    wb.close()
    headers = raw_rows[0]
    return [dict(zip(headers, r)) for r in raw_rows[1:]]


def safe_float(val):
    if val is None:
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def safe_int(val):
    if val is None:
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        return None


# ──────────────────────────────────────────────────────────────────────────────
# §5  ROW NORMALISATION
# ──────────────────────────────────────────────────────────────────────────────

def normalise_row(raw: dict) -> dict | None:
    """
    Convert a raw Excel row dict into a normalised comp record.
    Returns None if the stone should be excluded (< 1ct, bad data).
    """
    carat = safe_float(raw.get('CT'))
    if carat is None or carat < 1.0:
        return None

    raw_shape = (raw.get('shape') or '').strip()
    base_shape = SHAPE_CODE_MAP.get(raw_shape, raw_shape.lower() or 'unknown')

    # L/W ratio from size fields
    s1 = safe_float(raw.get('size1'))
    s2 = safe_float(raw.get('size2'))
    s3 = safe_float(raw.get('size3'))

    lw_ratio = None
    if s1 is not None and s2 is not None and min(s1, s2) > 0:
        lw_ratio = round(max(s1, s2) / min(s1, s2), 4)

    # Shape sub-variant classification using shared buckets
    bucket = classify_shape_by_lw(base_shape, lw_ratio)
    canonical_shape = bucket['shape']
    sub_variant     = bucket['subVariant']
    sub_variant_label = bucket['subVariantLabel']

    # Ice shapes and specialty shapes bypass sub-variant classification
    if base_shape in ('ice_oval', 'ice_pear', 'lavender', 'ashoka',
                       'old_mine', 'step_cut', 'trilliant',
                       'freeform_lip', 'old_european'):
        canonical_shape = base_shape
        sub_variant = base_shape

    col = (raw.get('Col') or '').strip()
    clarity = (raw.get('Cla') or '').strip()
    cut = (raw.get('Cut') or '').strip()
    pol = (raw.get('POL') or '').strip()
    sym = (raw.get('SYM') or '').strip()
    flu = (raw.get('flu') or '').strip()
    way = (raw.get('Way') or '').strip()  # CVD or HPHT

    price_per_stone = safe_float(raw.get('USD/STONE(美金/PCS)'))
    price_per_carat = safe_float(raw.get('单价CT'))

    # Derive pricePerCarat if only stonePrice available
    if price_per_carat is None and price_per_stone is not None and carat > 0:
        price_per_carat = round(price_per_stone / carat, 2)

    report_no = safe_int(raw.get('Report No'))
    row_no = safe_int(raw.get('NO'))
    warehouse = (raw.get('仓库') or '').strip()
    lab = (raw.get('Lab') or '').strip()

    return {
        'rowNo':           row_no,
        'lab':             lab,
        'reportNo':        report_no,
        'rawShapeCode':    raw_shape,
        'shape':           canonical_shape,
        'baseShape':       base_shape,
        'subVariant':      sub_variant,
        'subVariantLabel': sub_variant_label,
        'isMoval':         canonical_shape == 'moval',
        'isElongatedCushion': canonical_shape == 'elongated_cushion',
        'carat':           carat,
        'color':           col,
        'colorFamily':     color_family(col),
        'clarity':         clarity,
        'cut':             cut,
        'polish':          pol,
        'symmetry':        sym,
        'fluorescence':    flu,
        'growthMethod':    way,           # CVD | HPHT | ''
        'size1':           s1,            # length (mm)
        'size2':           s2,            # width  (mm)
        'size3':           s3,            # depth  (mm)
        'lwRatio':         lw_ratio,
        'pricePerStone':   price_per_stone,
        'pricePerCarat':   price_per_carat,
        'warehouse':       warehouse,
    }


# ──────────────────────────────────────────────────────────────────────────────
# §6  SUMMARY STATISTICS
# ──────────────────────────────────────────────────────────────────────────────

def build_summary(records: list[dict]) -> dict:
    priced = [r for r in records if r['pricePerStone'] is not None]
    by_shape = defaultdict(list)
    for r in records:
        by_shape[r['shape']].append(r)

    shape_stats = {}
    for shape, recs in sorted(by_shape.items(), key=lambda x: -len(x[1])):
        carats = [r['carat'] for r in recs]
        priced_recs = [r for r in recs if r['pricePerStone'] is not None]
        prices = [r['pricePerStone'] for r in priced_recs]
        ppc = [r['pricePerCarat'] for r in priced_recs if r['pricePerCarat']]
        methods = Counter(r['growthMethod'] for r in recs)
        shape_stats[shape] = {
            'count':         len(recs),
            'pricedCount':   len(priced_recs),
            'caratMin':      min(carats),
            'caratMax':      max(carats),
            'uniqueCarats':  len(set(carats)),
            'priceMin':      min(prices) if prices else None,
            'priceMax':      max(prices) if prices else None,
            'ppcMin':        round(min(ppc), 2) if ppc else None,
            'ppcMax':        round(max(ppc), 2) if ppc else None,
            'growthMethods': dict(methods),
            'label':         SHAPE_LABELS.get(shape, shape),
            'rawCodes':      list(set(r['rawShapeCode'] for r in recs)),
        }

    return {
        'totalStones':       len(records),
        'pricedStones':      len(priced),
        'uniqueShapes':      len(by_shape),
        'priceRange':        {
            'min': min(r['pricePerStone'] for r in priced) if priced else None,
            'max': max(r['pricePerStone'] for r in priced) if priced else None,
        },
        'colorBreakdown':    dict(Counter(r['color'] for r in records)),
        'clarityBreakdown':  dict(Counter(r['clarity'] for r in records)),
        'growthMethods':     dict(Counter(r['growthMethod'] for r in records)),
        'colorFamilies':     dict(Counter(r['colorFamily'] for r in records)),
        'movalCount':        sum(1 for r in records if r['isMoval']),
        'shapeStats':        shape_stats,
    }


# ──────────────────────────────────────────────────────────────────────────────
# §7  MOVAL DETAIL REPORT
# ──────────────────────────────────────────────────────────────────────────────

def moval_detail(records: list[dict]) -> list[dict]:
    movals = [r for r in records if r['isMoval']]
    return sorted(movals, key=lambda r: r['lwRatio'] or 0, reverse=True)


# ──────────────────────────────────────────────────────────────────────────────
# §8  MAIN
# ──────────────────────────────────────────────────────────────────────────────

def main():
    print(f"Loading: {EXCEL_FILE}")
    raw_rows = load_excel(EXCEL_FILE)
    print(f"  Raw rows (all carats): {len(raw_rows):,}")

    records = [normalise_row(r) for r in raw_rows]
    records = [r for r in records if r is not None]
    print(f"  Normalised (>= 1ct):   {len(records):,}")

    igi_store = load_enrichment()
    igi_stats = apply_enrichment_to_records(records, igi_store)
    if igi_store:
        print(
            "  IGI enrichment: "
            f"{igi_stats['storeEntries']:,} reports, "
            f"{igi_stats['pdfsOk']:,} PDFs, "
            f"{igi_stats['rowsEnriched']:,} rows enriched, "
            f"{igi_stats['shapeReclassified']} shape reclassified"
        )
    else:
        igi_cache = load_cache()
        pt_n = apply_igi_shape_cache(records, igi_cache)
        if igi_cache:
            ok_n = sum(1 for v in igi_cache.values() if v.get('status') == 'ok')
            print(f"  IGI cache: {len(igi_cache):,} slugs, {ok_n} PDFs, {pt_n} → portuguese")
        igi_stats = {
            'storeEntries': len(igi_cache),
            'pdfsOk': sum(1 for v in igi_cache.values() if v.get('status') == 'ok'),
            'portugueseOnCert': pt_n,
            'rowsEnriched': 0,
            'shapeReclassified': pt_n,
        }

    summary = build_summary(records)
    movals = moval_detail(records)

    # ── Compact aggregated comp export ────────────────────────────────────────
    # Group by (shape, color, clarity, 0.05ct bin) → median price per group.
    # This gives ~2-5K records instead of 15K, making the file browser-loadable.

    from statistics import median as _median

    def bin_carat(c):
        return round(round(c / 0.05) * 0.05, 2)

    SKIP_SHAPES = {'ice_oval', 'ice_pear', 'lavender', 'ashoka',
                   'old_mine', 'step_cut', 'trilliant', 'freeform_lip',
                   'old_european', 'unknown'}
    WHITE_GRADES = {'D', 'E', 'F', 'G', 'H'}

    groups = defaultdict(list)
    for r in records:
        if r.get('pricePerStone') is None:
            continue
        if r['shape'] in SKIP_SHAPES:
            continue
        if r['color'] not in WHITE_GRADES:
            continue
        key = (r['shape'], r['color'], r['clarity'], bin_carat(r['carat']))
        groups[key].append(r)

    comps = []
    for (shape, color, clarity, carat), recs in sorted(groups.items()):
        prices = [r['pricePerStone'] for r in recs]
        source_rows = sorted(r['rowNo'] for r in recs if r.get('rowNo') is not None)
        report_nos = sorted(r['reportNo'] for r in recs if r.get('reportNo') is not None)
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
            'label':           'Messi Gems IGI',
            'supplier':        'Wuzhou Messi Gems Co., Ltd.',
            'section':         f'{shape} {color} {clarity} IGI — Messi Gems',
            'url':             MESSI_FACTORY_URL,
            'sourceType':      'supplier-sheet',
            'sourceKey':       'messi-gems',
            'sourceFile':      'IGI Lab Grown Diamond List.2026.05.18xls.xlsx',
            'sourceRows':      source_rows[:8],
            'reportNos':       report_nos[:8],
        })

    index = {
        'supplier':              'Wuzhou Messi Gems Co., Ltd.',
        'location':              'Guangxi, China',
        'sourceFile':            'IGI Lab Grown Diamond List.2026.05.18xls.xlsx',
        'sourceDate':            '2026-05-18',
        'generatedDate':         str(date.today()),
        'purpose':               'Secondary source-of-truth comp index for Messi Gems IGI lab-grown diamonds (>=1ct only)',
        'filterApplied':         'carat >= 1.00',
        'movalThreshold':        MOVAL_LW_THRESHOLD,
        'elongatedCushionThreshold': 1.25,
        'shapeCodeMap':          SHAPE_CODE_MAP,
        'shapeLabels':           SHAPE_LABELS,
        'summary':               summary,
        'movals':                movals,
        'igiEnrichment': {
            'storeFile': 'igi-report-enrichment.json',
            'storeEntries': igi_stats['storeEntries'],
            'pdfsOk': igi_stats['pdfsOk'],
            'portugueseOnCert': igi_stats['portugueseOnCert'],
            'rowsEnriched': igi_stats['rowsEnriched'],
            'shapeReclassified': igi_stats['shapeReclassified'],
        },
        'records':               records,
    }

    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=2)
    print(f"\nFull index → {OUTPUT_JSON} ({len(records):,} records)")

    comp_out = {
        'supplier':      'Wuzhou Messi Gems Co., Ltd.',
        'sourceDate':    '2026-05-18',
        'generatedDate': str(date.today()),
        'compCount':     len(comps),
        'binSize':       '0.05ct',
        'comps':         comps,
    }
    with open(COMPS_JSON, 'w', encoding='utf-8') as f:
        json.dump(comp_out, f, ensure_ascii=False, separators=(',', ':'))
    sz = os.path.getsize(COMPS_JSON)
    print(f"Comp pool  → {COMPS_JSON} ({len(comps):,} bins, {sz//1024}KB)")

    # ── Console report ──────────────────────────────────────────────────────
    print("\n" + "═" * 70)
    print("MESSI GEMS — IGI LAB DIAMOND ANALYSIS (>= 1 ct)")
    print("═" * 70)
    print(f"  Total stones:   {summary['totalStones']:,}")
    print(f"  Priced stones:  {summary['pricedStones']:,}")
    print(f"  Unique shapes:  {summary['uniqueShapes']}")
    print(f"  Moval count:    {summary['movalCount']}")
    print(f"  Price range:    ${summary['priceRange']['min']:.2f} – ${summary['priceRange']['max']:.2f}")

    print("\n── COLOR BREAKDOWN ──────────────────────────────────────────────────")
    for col, cnt in sorted(summary['colorBreakdown'].items(), key=lambda x: -x[1]):
        print(f"  {col or '(blank)':>8}:  {cnt:,}")

    print("\n── CLARITY BREAKDOWN ────────────────────────────────────────────────")
    order = ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2']
    for cl in order:
        cnt = summary['clarityBreakdown'].get(cl, 0)
        if cnt:
            print(f"  {cl:>6}:  {cnt:,}")

    print("\n── GROWTH METHOD ────────────────────────────────────────────────────")
    for method, cnt in sorted(summary['growthMethods'].items(), key=lambda x: -x[1]):
        print(f"  {method or '(blank)':>6}:  {cnt:,}")

    print("\n── SHAPES (sorted by count) ─────────────────────────────────────────")
    for shape, stat in sorted(summary['shapeStats'].items(), key=lambda x: -x[1]['count']):
        price_str = f"${stat['priceMin']:.0f}–${stat['priceMax']:.0f}" if stat['priceMin'] else "no price"
        print(f"  {shape:<15}  {stat['count']:>5} stones  "
              f"{stat['caratMin']:.2f}–{stat['caratMax']:.2f}ct  "
              f"{price_str}  [{'/'.join(str(k) for k in stat['growthMethods'])}]")

    if movals:
        print("\n── MOVAL CANDIDATES (OV L/W >= 1.75) ───────────────────────────────")
        for r in movals:
            print(f"  {r['carat']:.2f}ct  L/W={r['lwRatio']:.3f}  "
                  f"{r['size1']}×{r['size2']}×{r['size3']}mm  "
                  f"{r['color']} {r['clarity']}  ${r['pricePerStone'] or 'n/p'}")

    print("\n── UNPRICED SPECIALTY SHAPES ────────────────────────────────────────")
    for shape, stat in summary['shapeStats'].items():
        if stat['pricedCount'] == 0:
            print(f"  {shape}  ({stat['count']} stones, {stat['caratMin']:.2f}–{stat['caratMax']:.2f}ct)  → {stat['label']}")

    print("\nDone.")


if __name__ == '__main__':
    main()
