"""
shape_buckets.py — Shared shape sub-variant classification by L/W ratio
─────────────────────────────────────────────────────────────────────────────
Empirically derived from:
  • Wuzhou Messi Gems dataset (18,090 stones ≥ 1ct, May 2026)
  • Wuzhou StarGem dataset   (22,541 stones ≥ 1ct, May 2026)

Defines:
  SHAPE_LW_BUCKETS  — thresholds for each base shape
  classify_shape_by_lw(base_shape, lw_ratio, cut_hint='') → dict
  RATIO_GUIDE_JSON  — copy into ratioGuides in index.html

Import in other scripts:
  from shape_buckets import classify_shape_by_lw, SHAPE_LW_BUCKETS, RATIO_GUIDE_JS
─────────────────────────────────────────────────────────────────────────────
"""

# ──────────────────────────────────────────────────────────────────────────────
# §1  THRESHOLD DEFINITIONS
# Each entry: (canonical_shape, sub_variant_key, label, ideal_lo, ideal_hi, lo, hi)
# ──────────────────────────────────────────────────────────────────────────────

SHAPE_LW_BUCKETS = {
    # ── OVAL (OV in Messi; OVAL in StarGem) ────────────────────────────────
    # Tuples: (lo, hi, canonical_shape, sub_variant_key, label, ideal_lo, ideal_hi, lo, hi)
    # canonical_shape is what goes into the comp pool (must match app's shape system)
    # sub_variant_key is metadata-only (for analysis/display)
    'oval': [
        # (lo_threshold, hi_threshold, canonical_shape, sub_variant_key, label, idealLo, idealHi, lo, hi)
        (1.75, None,  'moval',  'moval',          'Moval (very elongated oval)',   1.65, 1.90, 1.55, 2.10),
        (1.55, 1.74,  'oval',   'oval_elongated',  'Elongated Oval',               1.60, 1.72, 1.55, 1.75),
        (1.30, 1.54,  'oval',   'oval',            'Standard Oval',                1.35, 1.50, 1.30, 1.55),
        (0.00, 1.29,  'oval',   'oval',            'Wide / Round Oval',            1.30, 1.45, 1.20, 1.55),
    ],

    # ── CUSHION (CU in Messi; CUSHION in StarGem) ───────────────────────────
    'cushion': [
        (1.25, None, 'elongated_cushion', 'elongated_cushion', 'Elongated / Rectangular Cushion', 1.30, 1.45, 1.25, 1.55),
        (1.10, 1.24, 'cushion',           'cushion_modified',  'Modified / Rectangular Cushion',  1.10, 1.20, 1.08, 1.25),
        (1.03, 1.09, 'cushion',           'cushion',           'Standard Cushion Brilliant',       1.03, 1.08, 1.00, 1.12),
        (0.00, 1.02, 'square_cushion',    'square_cushion',    'Square Cushion',                   1.00, 1.02, 0.98, 1.04),
    ],

    # ── RADIANT (RA in Messi; RADIANT in StarGem) ──────────────────────────
    'radiant': [
        (1.55, None, 'radiant',    'radiant_elongated', 'Elongated Rectangular Radiant', 1.35, 1.50, 1.10, 1.60),
        (1.10, 1.54, 'radiant',    'radiant',           'Standard Radiant',              1.30, 1.45, 1.10, 1.55),
        (0.00, 1.09, 'sq_radiant', 'sq_radiant',        'Square Radiant',                1.00, 1.06, 0.97, 1.10),
    ],

    # ── EMERALD (EM in Messi; EMERALD in StarGem) ──────────────────────────
    'emerald': [
        (1.65, None, 'emerald', 'emerald_elongated', 'Elongated Emerald Cut', 1.50, 1.65, 1.40, 2.10),
        (1.25, 1.64, 'emerald', 'emerald',           'Standard Emerald Cut',  1.35, 1.50, 1.25, 1.65),
        (0.00, 1.24, 'emerald', 'emerald_wide',      'Wide Emerald Cut',      1.25, 1.40, 1.10, 1.40),
    ],

    # ── PEAR (PS in Messi; PEAR in StarGem) ────────────────────────────────
    'pear': [
        (1.70, None, 'pear', 'pear_elongated', 'Elongated Pear', 1.65, 1.80, 1.60, 1.85),
        (1.45, 1.69, 'pear', 'pear',           'Standard Pear',  1.55, 1.65, 1.45, 1.75),
        (0.00, 1.44, 'pear', 'pear_wide',      'Wide Pear',      1.45, 1.60, 1.35, 1.65),
    ],

    # ── MARQUISE (MQ in Messi; MARQUISE in StarGem) ─────────────────────────
    'marquise': [
        (2.10, None, 'marquise', 'marquise_elongated', 'Elongated Marquise', 1.95, 2.15, 1.90, 2.30),
        (1.80, 2.09, 'marquise', 'marquise',           'Standard Marquise',  1.90, 2.10, 1.80, 2.20),
        (0.00, 1.79, 'marquise', 'marquise_wide',      'Wide Marquise',      1.75, 2.00, 1.60, 2.10),
    ],

    # ── HEART (HT in Messi; HEART in StarGem) ──────────────────────────────
    'heart': [
        (1.15, None, 'heart', 'heart_elongated', 'Elongated Heart', 0.95, 1.15, 0.90, 1.25),
        (0.90, 1.14, 'heart', 'heart',           'Standard Heart',  0.95, 1.05, 0.90, 1.15),
        (0.00, 0.89, 'heart', 'heart_wide',      'Wide Heart',      0.90, 1.10, 0.80, 1.15),
    ],

    # ── ROUND (RD / ROUND) ─────────────────────────────────────────────────
    'round': [
        (0.00, None, 'round', 'round', 'Round Brilliant', 0.99, 1.01, 0.98, 1.02),
    ],

    # ── PRINCESS (PR / PRINCESS) ────────────────────────────────────────────
    'princess': [
        (0.00, None, 'princess', 'princess', 'Princess Cut', 1.00, 1.05, 0.98, 1.08),
    ],

    # ── ASSCHER (AS / Asscher) ──────────────────────────────────────────────
    'asscher': [
        (0.00, None, 'asscher', 'asscher', 'Asscher (Square Emerald)', 1.00, 1.05, 0.98, 1.08),
    ],
}

# Moval gets its own ratio guide (derived from oval but reclassified)
SHAPE_LW_BUCKETS['moval'] = [
    (0.00, None, 'moval', 'moval', 'Moval (Marquise–Oval Hybrid)', 1.65, 1.90, 1.55, 2.10),
]


# ──────────────────────────────────────────────────────────────────────────────
# §2  CLASSIFICATION FUNCTION
# ──────────────────────────────────────────────────────────────────────────────

def classify_shape_by_lw(base_shape: str, lw_ratio: float | None, cut_hint: str = '') -> dict:
    """
    Classify a stone into a shape sub-variant based on L/W ratio.

    Parameters:
        base_shape:  canonical base shape (e.g., 'oval', 'cushion', 'radiant')
        lw_ratio:    measured length/width ratio (or None if not available)
        cut_hint:    any cut code from the source (e.g., '长垫形' for elongated cushion)

    Returns dict:
        shape           – final canonical shape key for comp matching (e.g., 'oval', 'elongated_cushion')
        subVariant      – sub-variant key for analysis/display (may differ from shape)
        subVariantLabel – human-readable label
        lwBucket        – ratio range string (e.g., '1.35–1.50')
        idealLo, idealHi, lo, hi – ratio guide bounds

    Bucket tuple format: (lo_threshold, hi_threshold, canonical_shape, sub_variant_key, label,
                          idealLo, idealHi, lo, hi)
    """
    # Special case: elongated cushion explicitly flagged in source data
    if base_shape == 'cushion' and cut_hint in ('长垫形',):
        return {
            'shape': 'elongated_cushion',
            'subVariant': 'elongated_cushion',
            'subVariantLabel': 'Elongated / Rectangular Cushion (explicit flag)',
            'lwBucket': 'explicit',
            'idealLo': 1.30, 'idealHi': 1.45, 'lo': 1.25, 'hi': 1.55,
        }

    buckets = SHAPE_LW_BUCKETS.get(base_shape)
    if not buckets or lw_ratio is None:
        return {
            'shape': base_shape,
            'subVariant': base_shape,
            'subVariantLabel': base_shape.replace('_', ' ').title(),
            'lwBucket': None,
            'idealLo': None, 'idealHi': None, 'lo': None, 'hi': None,
        }

    for (threshold_lo, threshold_hi, canonical, sub_variant, label, ideal_lo, ideal_hi, lo, hi) in buckets:
        if threshold_hi is None:  # uppermost bucket (no cap)
            if lw_ratio >= threshold_lo:
                return {
                    'shape': canonical,
                    'subVariant': sub_variant,
                    'subVariantLabel': label,
                    'lwBucket': f'>= {threshold_lo:.2f}',
                    'idealLo': ideal_lo, 'idealHi': ideal_hi, 'lo': lo, 'hi': hi,
                }
        else:
            if threshold_lo <= lw_ratio <= threshold_hi:
                return {
                    'shape': canonical,
                    'subVariant': sub_variant,
                    'subVariantLabel': label,
                    'lwBucket': f'{threshold_lo:.2f}–{threshold_hi:.2f}',
                    'idealLo': ideal_lo, 'idealHi': ideal_hi, 'lo': lo, 'hi': hi,
                }

    # Fallback: return base shape with lowest bucket
    last = buckets[-1]
    return {
        'shape': last[2],
        'subVariant': last[3],
        'subVariantLabel': last[4],
        'lwBucket': 'fallback',
        'idealLo': last[5], 'idealHi': last[6], 'lo': last[7], 'hi': last[8],
    }


# ──────────────────────────────────────────────────────────────────────────────
# §3  RATIO GUIDE FOR index.html (JavaScript)
# Paste into the ratioGuides constant in index.html to update the ratio bar.
# ──────────────────────────────────────────────────────────────────────────────

RATIO_GUIDE_JS = """
const ratioGuides = {
  round:            { lo:0.98, hi:1.02,  idealLo:0.99,  idealHi:1.01,  label:'round outline' },
  oval:             { lo:1.30, hi:1.55,  idealLo:1.35,  idealHi:1.50,  label:'standard oval' },
  oval_elongated:   { lo:1.55, hi:1.75,  idealLo:1.60,  idealHi:1.72,  label:'elongated oval' },
  moval:            { lo:1.55, hi:2.10,  idealLo:1.65,  idealHi:1.90,  label:'moval (elongated oval)' },
  pear:             { lo:1.45, hi:1.75,  idealLo:1.55,  idealHi:1.65,  label:'pear' },
  marquise:         { lo:1.80, hi:2.20,  idealLo:1.90,  idealHi:2.10,  label:'marquise' },
  hexagonal_dutch:  { lo:1.75, hi:2.25,  idealLo:1.85,  idealHi:2.10,  label:'Dutch marquise' },
  heart:            { lo:0.90, hi:1.15,  idealLo:0.95,  idealHi:1.05,  label:'heart' },
  cushion:          { lo:1.00, hi:1.25,  idealLo:1.02,  idealHi:1.10,  label:'cushion' },
  cushion_brilliant:{ lo:1.00, hi:1.25,  idealLo:1.02,  idealHi:1.10,  label:'cushion' },
  square_cushion:   { lo:0.98, hi:1.05,  idealLo:0.99,  idealHi:1.03,  label:'square cushion' },
  elongated_cushion:{ lo:1.10, hi:1.55,  idealLo:1.25,  idealHi:1.45,  label:'elongated / rectangular cushion' },
  radiant:          { lo:1.10, hi:1.60,  idealLo:1.30,  idealHi:1.45,  label:'rectangular radiant' },
  sq_radiant:       { lo:0.97, hi:1.10,  idealLo:1.00,  idealHi:1.06,  label:'square radiant' },
  emerald:          { lo:1.25, hi:2.10,  idealLo:1.35,  idealHi:1.55,  label:'emerald' },
  asscher:          { lo:0.98, hi:1.08,  idealLo:1.00,  idealHi:1.05,  label:'asscher' },
  princess:         { lo:0.98, hi:1.08,  idealLo:1.00,  idealHi:1.05,  label:'princess' },
};
"""


# ──────────────────────────────────────────────────────────────────────────────
# §4  STAR GEMS SHAPE CODE NORMALIZATION
# ──────────────────────────────────────────────────────────────────────────────

STARSGEM_SHAPE_MAP = {
    'ROUND':    'round',
    'round':    'round',
    'OVAL':     'oval',    # may upgrade to moval / elongated by L/W
    'PEAR':     'pear',
    'PRINCESS': 'princess',
    'princess': 'princess',
    'HEART':    'heart',
    'heart':    'heart',
    'RADIANT':  'radiant',  # may degrade to sq_radiant by L/W
    'emerald':  'emerald',
    'EMERALD':  'emerald',
    'CUSHION':  'cushion',  # may upgrade to elongated_cushion
    'marquise': 'marquise',
    'MARQUISE': 'marquise',
    'SQUARE':   'princess', # near-square stones (L/W 1.00-1.05), unknown cut style → princess default
    'Asscher':  'asscher',
    'asscher':  'asscher',
    'ASHOKA':   'ashoka',
}

STARSGEM_CUT_MAP = {
    'ID':   'ideal',
    'EX':   'excellent',
    'VG':   'very_good',
    '-':    None,
    '':     None,
    '  ':   None,
    '传统切': 'traditional_brilliant',   # traditional brilliant cut
    '冰花切': 'ice_flower',              # crushed-ice / flower / icé cut
    '长垫形': 'elongated_cushion_flag',   # shape modifier: elongated cushion
    '老矿切': 'old_mine',
    '老欧切': 'old_european',
}

MESSI_SHAPE_MAP = {
    'RD':        'round',
    'OV':        'oval',
    'PS':        'pear',
    'EM':        'emerald',
    'RA':        'radiant',
    'MQ':        'marquise',
    'PR':        'princess',
    'HT':        'heart',
    'CU':        'cushion',
    'ICE OV':    'ice_oval',
    'AS':        'asscher',
    'ICE PS':    'ice_pear',
    'LV':        'lavender',
    '阿育王':    'ashoka',
    '老矿切':    'old_mine',
    '阶梯切':    'step_cut',
    '肥三角':    'trilliant',
    '自由形式 （唇形）': 'freeform_lip',
    '老欧切':    'old_european',
}


if __name__ == '__main__':
    # Quick self-test
    tests = [
        ('oval', 2.00, '', 'moval'),
        ('oval', 1.65, '', 'oval'),            # elongated oval → still canonical 'oval'
        ('oval', 1.42, '', 'oval'),
        ('cushion', 1.40, '', 'elongated_cushion'),
        ('cushion', 1.40, '长垫形', 'elongated_cushion'),
        ('cushion', 1.18, '', 'cushion'),
        ('cushion', 1.01, '', 'square_cushion'),
        ('radiant', 1.05, '', 'sq_radiant'),
        ('radiant', 1.40, '', 'radiant'),
        ('emerald', 1.80, '', 'emerald'),
        ('pear', 1.60, '', 'pear'),
        ('marquise', 2.05, '', 'marquise'),
    ]
    print('Shape bucket self-test:')
    all_pass = True
    for base, lw, hint, expected in tests:
        result = classify_shape_by_lw(base, lw, hint)
        ok = result['shape'] == expected
        if not ok: all_pass = False
        status = '✓' if ok else '✗'
        print(f'  {status} {base} L/W={lw} hint={hint!r} → {result["shape"]!r} ({result["subVariantLabel"]}) [expected {expected!r}]')
    print('All pass!' if all_pass else 'FAILURES above.')
