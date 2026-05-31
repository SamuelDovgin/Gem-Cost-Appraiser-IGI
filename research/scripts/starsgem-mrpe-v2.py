#!/usr/bin/env python3
"""
Gem Appraise — MRPE/MAPE Improvement v2
═══════════════════════════════════════════════════════════════════════════════
Builds on v1 (4.38% MAPE) with five new structural improvements:

  Key insight: StarGem prices = round(carat × rate_per_ct) / 170, where
  rate_per_ct is what the supplier actually sets per (shape, color, clarity, etc.).
  By predicting log(price/carat) instead of log(price), we remove the
  multiplicative carat effect from the prediction target, forcing the model
  to only learn the rate — a smoother, more structured signal.

New strategies vs v1:
  S1  Baseline (v1 best: engineered features, log-price target)       [reference]
  S2  Rate-per-carat target  log(price/carat) → exp(pred) × carat
  S3  Rate + MAE criterion   ExtraTrees criterion='absolute_error'
  S4  Rate + MAE + engineered features                                 [combo]
  S5  Rate + lookup-as-feature (hierarchical lookup rate as ML input)
  S6  Rate + category prior feature (per-spec median rate in training)
  S7  Full combo: S4 + S5 + S6 + bucket-position features             [best?]
  S8  Quantile-pinball objective (LightGBM quantile=0.50, MAPE-optimal)

The best model is exported to:
  research/data/starsgem-ml-extra-trees-model.json

Browser inference note: if the best model uses the rate-per-carat target,
the JSON will contain "target": "log(SaleDollorPrice/Carat)" and the
browser must compute: price = exp(tree_mean) * carat.
The export function and index.html predictStarsgemMl() are updated accordingly.

Run:
  python3 research/scripts/starsgem-mrpe-v2.py
"""

import json
import math
import os
import random
import re
import sys
from collections import defaultdict
from datetime import date
from statistics import median

import xlrd

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)


def sanitize_for_json(obj):
    """Recursively replace NaN/Inf with None so JSON.parse() works in JavaScript."""
    if isinstance(obj, float):
        return None if (math.isnan(obj) or math.isinf(obj)) else obj
    if isinstance(obj, dict):
        return {k: sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize_for_json(v) for v in obj]
    return obj
DATA_DIR = os.path.join(PROJECT_ROOT, "data")
XLS_FILE = os.path.join(DATA_DIR, "STARS Diamonds Stock2026.5.20.xls")
ML_MODEL_JSON = os.path.join(DATA_DIR, "starsgem-ml-extra-trees-model.json")
RESULTS_JSON = os.path.join(DATA_DIR, "mrpe-v2-results.json")

REQUIRED_COLUMNS = [
    "Carat", "Shape", "Color", "Clarity", "Cut", "Polish", "Symmetry",
    "Fluorescence", "Report", "Measurement", "Table_Scale", "Depth_Scale",
    "TypeName", "SaleDollorPrice",
]

# Lookup fallback hierarchy (same as original)
LOOKUP_LEVELS = [
    ("A", ["carat_bucket", "Shape", "Color", "Clarity", "TypeName", "Report", "Cut", "Polish", "Symmetry"]),
    ("B", ["carat_bucket", "Shape", "Color", "Clarity", "TypeName", "Report", "Cut"]),
    ("C", ["carat_bucket", "Shape", "Color", "Clarity", "TypeName", "Report"]),
    ("D", ["carat_bucket", "Shape", "Color", "Clarity", "TypeName"]),
    ("E", ["carat_bucket", "Shape", "Color", "Clarity"]),
    ("F", ["carat_bucket", "Color", "Clarity"]),
    ("G", ["carat_bucket"]),
]

CATEGORICAL_FEATURES = [
    "Shape", "Color", "Clarity", "Cut", "Polish", "Symmetry",
    "Fluorescence", "Report", "TypeName", "carat_bucket", "Cut_Style_Group",
]
NUMERIC_FEATURES = [
    "Carat", "Table_Scale", "Depth_Scale", "Length", "Width", "Height",
    "LengthWidthRatio",
]
SELECTED_SPEC_FLAGS = [
    "Has_Dimensions",
    "Has_TableDepth",
    "Has_GrowthMethod",
    "Has_Report_Cut",
    "Is_SelectedSpec_Mode",
]
SPECIALTY_CUT_LABELS = {
    "传统切": "traditional",
    "冰花切": "ice_flower",
    "长垫形": "elongated_cushion",
    "老欧切": "old_european",
    "老矿切": "old_miner",
}
STANDARD_CUT_LABELS = {"-", "ID", "EX", "VG", "GD"}
LARGE_CARAT_TAIL_LEVELS = [
    ("SCCT", ["Shape", "Color", "Clarity", "Cut_Style_Group", "TypeName"]),
    ("SCCG", ["Shape", "Color", "Clarity", "Cut_Style_Group"]),
    ("SCC", ["Shape", "Color", "Clarity"]),
    ("SG", ["Shape", "Cut_Style_Group"]),
    ("S", ["Shape"]),
    ("G", ["Cut_Style_Group"]),
]
# S23-specific tail levels: grade-agnostic (no Color/Clarity).
# The grade-aware LARGE_CARAT_TAIL_LEVELS would make Large_Carat_Tail_Multiplier
# change with clarity, creating unconstrained grade signal in the prediction formula
# that can invert the ladder at 7-10ct even with monotone GBDT constraints.
S23_TAIL_LEVELS = [
    ("SGT", ["Shape", "Cut_Style_Group", "TypeName"]),
    ("SG",  ["Shape", "Cut_Style_Group"]),
    ("S",   ["Shape"]),
    ("G",   ["Cut_Style_Group"]),
]
LARGE_CARAT_TAIL_START_CT = 5.0
LARGE_CARAT_TAIL_MIN_COUNT = 5
LARGE_CARAT_TAIL_MAX_SLOPE = 1.25
# New numeric features from IGI enrichment (optional, for enriched models)
NUMERIC_FEATURES_IGI_ENRICHMENT = [
    "IGI_Enriched", "IGI_IsPortuguese", "IGI_IsTypeIIa",
]

# Carat bucket boundaries for position features
CARAT_BUCKET_BOUNDS = [
    (0.30, 0.49, "0.30-0.49"),
    (0.50, 0.69, "0.50-0.69"),
    (0.70, 0.89, "0.70-0.89"),
    (0.90, 0.99, "0.90-0.99"),
    (1.00, 1.49, "1.00-1.49"),
    (1.50, 1.99, "1.50-1.99"),
    (2.00, 2.99, "2.00-2.99"),
    (3.00, 3.99, "3.00-3.99"),
    (4.00, 4.99, "4.00-4.99"),
    (5.00, 9.99, "5.00-9.99"),
]

# Validation should represent the catalog surface, not the raw row population.
# The stock sheet is heavily concentrated in round / ~1ct rows; holding out one
# representative per spec bucket prevents that dominant segment from selecting a
# model that quietly regresses sparse/high-carat stones.
VALIDATION_BUCKET_FIELDS = ["Shape", "carat_bucket", "Color", "Clarity", "Cut"]

# Production routing: exact/near source-sheet matches are evidence, not ML.
HYBRID_ANCHOR_FIELDS = ["Shape", "Color", "Clarity", "TypeName", "Report", "Cut"]
HYBRID_EXACT_CARAT_TOLERANCE = 0.005
HYBRID_NEAR_CARAT_TOLERANCE = 0.03
HYBRID_INTERPOLATION_MAX_GAP = 0.75

# ──────────────────────────────────────────────────────────────────────────
# S21 — Monotonic grade model constants
# ──────────────────────────────────────────────────────────────────────────
CLARITY_RANK = {"IF": 0, "VVS1": 1, "VVS2": 2, "VS1": 3, "VS2": 4, "SI1": 5, "SI2": 6}
COLOR_RANK   = {"D": 0, "E": 1, "F": 2, "G": 3, "H": 4, "I": 5, "J": 6}
CLARITY_ORDER_S21 = ["IF", "VVS1", "VVS2", "VS1", "VS2", "SI1", "SI2"]
COLOR_ORDER_S21   = ["D", "E", "F", "G", "H", "I", "J"]
MONOTONE_LOOKUP_MIN_SUPPORT = 15   # shrink cells with n < this toward parent
MONOTONE_LOOKUP_SHRINK_K    = 10   # pseudo-count weight for shrinkage
S21_MODEL_JSON = os.path.join(DATA_DIR, "starsgem-ml-extra-trees-model-s21-monotone.json")
MONOTONE_AXES_JSON = os.path.join(DATA_DIR, "monotone-axes.json")

# ──────────────────────────────────────────────────────────────────────────
# S23 — Grade-agnostic anchor constants
# ──────────────────────────────────────────────────────────────────────────
# Color and Clarity are intentionally removed from the categorical features
# and from every anchor lookup level.  Grade signal enters the model only
# through ordinal rank features (Clarity_Rank, Color_Rank) with LightGBM
# monotone constraints.  No explicit grade×carat interaction terms are used:
# monotone constraints are per-feature/marginal, so an unconstrained
# Log_Carat×GradeRank term weakens the formal ordering guarantee (identified
# in deep-research-report (1)).  LightGBM learns size-dependent grade
# effects internally through tree splits.
S23_CATEGORICAL_FEATURES = [
    "Shape", "Cut", "Polish", "Symmetry",
    "Fluorescence", "Report", "TypeName", "carat_bucket", "Cut_Style_Group",
]

S23_LOOKUP_LEVELS = [
    ("A", ["carat_bucket", "Shape", "TypeName", "Report", "Cut", "Polish", "Symmetry"]),
    ("B", ["carat_bucket", "Shape", "TypeName", "Report", "Cut"]),
    ("C", ["carat_bucket", "Shape", "TypeName", "Report"]),
    ("D", ["carat_bucket", "Shape", "TypeName"]),
    ("E", ["carat_bucket", "Shape"]),
    ("F", ["carat_bucket"]),
]

S23_MODEL_JSON = os.path.join(DATA_DIR, "starsgem-ml-extra-trees-model-s23-grade-agnostic-anchor.json")
S20_MODEL_JSON = os.path.join(DATA_DIR, "starsgem-ml-extra-trees-model-s20-specialty-tail.json")
CLEAN_TRAINING_JSON = os.path.join(DATA_DIR, "dataset-clean-training.json")


def load_monotone_axes_registry(path=MONOTONE_AXES_JSON):
    """Load the monotone-axes.json registry from disk."""
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def build_monotone_vector(feature_names_out, gem_family, registry):
    """
    Build the LightGBM monotone_constraints vector from the monotone-axes registry.

    feature_names_out: list of feature names as returned by ColumnTransformer.get_feature_names_out().
        ColumnTransformer prefixes: "num__<feature>" for numeric, "cat__<feature>_<value>" for one-hot.
    gem_family: key into registry (e.g. "white_diamond").
    registry: dict loaded from monotone-axes.json.

    Returns a list of +1 / -1 / 0 (one per feature), matching the order of feature_names_out.

    Example:
        registry = load_monotone_axes_registry()
        constraints = build_monotone_vector(feat_names_out, "white_diamond", registry)
    """
    axes = registry.get(gem_family, [])
    # Build lookup: "num__<feature>" → direction
    by_feat = {f"num__{ax['feature']}": ax["direction"] for ax in axes if ax.get("direction") is not None}
    return [by_feat.get(name, 0) for name in feature_names_out]


# ═══════════════════════════════════════════════════════════════════════════
# DATA UTILITIES
# ═══════════════════════════════════════════════════════════════════════════

def safe_float(value):
    if value is None:
        return None
    if isinstance(value, str) and not value.strip():
        return None
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n if math.isfinite(n) else None


def norm_cat(value):
    if value is None:
        return "-"
    text = str(value).strip().upper()
    if text in ("", "-", "N/A", "NONE", "NULL"):
        return "-"
    return re.sub(r"\s+", " ", text)


def parse_measurement(value):
    if value is None:
        return None, None, None, None
    nums = []
    for part in re.split(r"\s*-\s*", str(value).strip()):
        try:
            nums.append(float(part.strip()))
        except (TypeError, ValueError):
            continue
    length = nums[0] if len(nums) > 0 else None
    width = nums[1] if len(nums) > 1 else None
    height = nums[2] if len(nums) > 2 else None
    ratio = None
    if length and width and min(length, width) > 0:
        ratio = round(max(length, width) / min(length, width), 4)
    return length, width, height, ratio


def carat_bucket(carat):
    for lo, hi, label in CARAT_BUCKET_BOUNDS:
        if lo <= carat <= hi:
            return label
    if carat >= 10.0:
        return "10.00+"
    return "<0.30"


def carat_bucket_position(carat):
    """Return 0→1 position within the carat bucket. Returns 0.5 if no bucket."""
    for lo, hi, _ in CARAT_BUCKET_BOUNDS:
        if lo <= carat <= hi:
            span = hi - lo
            return (carat - lo) / span if span > 0 else 0.5
    return 0.5


def cut_style_group(cut):
    cut_norm = norm_cat(cut)
    if cut_norm in SPECIALTY_CUT_LABELS:
        return SPECIALTY_CUT_LABELS[cut_norm]
    if cut_norm in STANDARD_CUT_LABELS:
        return "standard_grade" if cut_norm != "-" else "unknown"
    return "unknown"


def add_cut_style_features(row):
    group = cut_style_group(row.get("Cut"))
    row["Cut_Style_Group"] = group
    row["Is_Specialty_Cut"] = 1.0 if group not in ("standard_grade", "unknown") else 0.0
    row["Is_Traditional_Cut"] = 1.0 if group == "traditional" else 0.0
    row["Is_IceFlower_Cut"] = 1.0 if group == "ice_flower" else 0.0
    return row


def large_carat_tail_x(carat):
    if not carat or carat <= LARGE_CARAT_TAIL_START_CT:
        return 0.0
    return math.log(carat / LARGE_CARAT_TAIL_START_CT)


def large_carat_tail_features(carat):
    x = large_carat_tail_x(carat)
    return {
        "Is_Large_Carat": 1.0 if carat and carat >= LARGE_CARAT_TAIL_START_CT else 0.0,
        "Is_10ct_Plus": 1.0 if carat and carat >= 10.0 else 0.0,
        "Large_Carat_Tail_X": x,
        "Large_Carat_Tail_X_sq": x * x,
    }


def tail_anchor_lookup_row(row):
    """Use the 5-9.99ct surface as the anchor before applying the tail curve."""
    out = dict(row)
    carat = out.get("Carat")
    if carat and carat > LARGE_CARAT_TAIL_START_CT:
        out["carat_bucket"] = "5.00-9.99"
    return out


# Magic carat thresholds where price jumps discontinuously
MAGIC_THRESHOLDS = [0.30, 0.50, 0.70, 0.90, 1.00, 1.50, 2.00, 3.00, 4.00, 5.00, 10.00]


def carat_0_01_bucket(carat):
    """Bucket carat to nearest 0.01 for fine lookup granularity."""
    return round(carat * 100) / 100


def magic_threshold_features(carat):
    """Features that capture proximity to magic carat thresholds.

    The rate-per-carat premium decays rapidly as you move away from a magic
    number. A 2.00ct stone commands $203/ct while 2.05ct gets $145/ct —
    a $58/ct drop over 0.05ct. These features let the model learn that curve.
    """
    if not carat or carat <= 0:
        return {"dist_to_magic": 0.0, "inv_dist_to_magic": 0.0,
                "log1p_dist_to_magic": 0.0, "is_near_magic": 0.0}

    # Find nearest magic threshold at or below this carat
    magic_below = max([t for t in MAGIC_THRESHOLDS if t <= carat], default=0.0)
    # Also find nearest magic above
    magic_above = min([t for t in MAGIC_THRESHOLDS if t > carat], default=999.0)

    dist_to_lower = carat - magic_below
    dist_to_upper = magic_above - carat if magic_above != 999.0 else 99.0

    # The premium is strongest near the lower magic number
    eps = 0.001
    return {
        "dist_to_magic": dist_to_lower,
        "inv_dist_to_magic": 1.0 / (dist_to_lower + eps),
        "log1p_dist_to_magic": math.log(1.0 + dist_to_lower),
        "dist_to_magic_above": dist_to_upper,
        "magic_number": magic_below,
    }


# Fine lookup levels with Cut included and 0.01ct carat granularity
FINE_LOOKUP_LEVELS = [
    ("A", ["carat_0_01_bucket", "Shape", "Color", "Clarity", "TypeName", "Report", "Cut", "Polish", "Symmetry"]),
    ("B", ["carat_0_01_bucket", "Shape", "Color", "Clarity", "TypeName", "Report", "Cut"]),
    ("C", ["carat_0_01_bucket", "Shape", "Color", "Clarity", "TypeName", "Report"]),
    ("D", ["carat_0_01_bucket", "Shape", "Color", "Clarity", "TypeName"]),
    ("E", ["carat_0_01_bucket", "Shape", "Color", "Clarity"]),
    ("F", ["carat_0_01_bucket", "Color", "Clarity"]),
    ("G", ["carat_bucket", "Shape", "Color", "Clarity", "TypeName"]),
    ("H", ["carat_bucket", "Color", "Clarity"]),
    ("I", ["carat_bucket"]),
]


def build_fine_lookup(rows):
    """Build fine-grained lookup at 0.01ct resolution with Cut included."""
    # Add 0.01ct bucket to each row
    for r in rows:
        r["carat_0_01_bucket"] = carat_0_01_bucket(r["Carat"])

    tables = []
    for level, fields in FINE_LOOKUP_LEVELS:
        grouped = defaultdict(list)
        for row in rows:
            key = tuple(str(row.get(f, "-")) for f in fields)
            grouped[key].append(row)
        groups = {}
        for key, recs in grouped.items():
            rates = [r["internal_rate_per_ct"] for r in recs]
            usd_rates = [r["usd_per_ct"] for r in recs]
            groups["||".join(key)] = {
                "rate": round(median(rates), 6),
                "usdPerCt": round(median(usd_rates), 4),
                "count": len(recs),
            }
        tables.append({"level": level, "fields": fields, "groups": groups})

    all_rates = [r["internal_rate_per_ct"] for r in rows]
    global_rate = round(median(all_rates), 6)
    return tables, global_rate


def fine_lookup_predict_rate(row, tables, global_rate):
    """Return (predicted_rate_per_ct, level, count) from fine lookup."""
    for table in tables:
        key = "||".join(str(row.get(f, "-")) for f in table["fields"])
        hit = table["groups"].get(key)
        if hit:
            return hit["usdPerCt"], table["level"], hit["count"]
    return global_rate / 170, "GLOBAL", 0


def load_rows():
    wb = xlrd.open_workbook(XLS_FILE)
    ws = wb.sheet_by_name("Table")
    headers = [str(ws.cell_value(0, col)).strip() for col in range(ws.ncols)]
    missing = [col for col in REQUIRED_COLUMNS if col not in headers]
    if missing:
        raise RuntimeError("Missing columns: " + ", ".join(missing))

    raw_rows = []
    for idx in range(1, ws.nrows):
        raw = {headers[col]: ws.cell_value(idx, col) for col in range(ws.ncols)}
        carat = safe_float(raw.get("Carat"))
        price = safe_float(raw.get("SaleDollorPrice"))
        if not carat or carat <= 0 or not price or price <= 0:
            continue
        length, width, height, ratio = parse_measurement(raw.get("Measurement"))
        internal_price = int(round(price * 170))
        row = {
            "rowNo": idx + 1,
            "Carat": carat,
            "Shape": norm_cat(raw.get("Shape")),
            "Color": norm_cat(raw.get("Color")),
            "Clarity": norm_cat(raw.get("Clarity")),
            "Cut": norm_cat(raw.get("Cut")),
            "Polish": norm_cat(raw.get("Polish")),
            "Symmetry": norm_cat(raw.get("Symmetry")),
            "Fluorescence": norm_cat(raw.get("Fluorescence")),
            "Report": "IGI" if "IGI" in norm_cat(raw.get("Report")) else norm_cat(raw.get("Report")),
            "TypeName": norm_cat(raw.get("TypeName")),
            "Table_Scale": safe_float(raw.get("Table_Scale")),
            "Depth_Scale": safe_float(raw.get("Depth_Scale")),
            "Length": length,
            "Width": width,
            "Height": height,
            "LengthWidthRatio": ratio,
            "SaleDollorPrice": price,
            "internal_price": internal_price,
            "usd_per_ct": price / carat,
            "internal_rate_per_ct": internal_price / carat,
            "carat_bucket": carat_bucket(carat),
        }
        add_cut_style_features(row)
        raw_rows.append(row)
    return raw_rows


def load_enrichment():
    """Load IGI enrichment data from JSON. Returns dict keyed by report number (digits only)."""
    enrichment_path = os.path.join(DATA_DIR, "igi-report-enrichment.json")
    try:
        with open(enrichment_path) as f:
            raw = json.load(f)
    except FileNotFoundError:
        print(f"⚠  Enrichment file not found: {enrichment_path}")
        return {}
    
    # Normalize keys: strip prefix letters, keep digits only
    out = {}
    for key, val in raw.items():
        digits = re.sub(r"[^0-9]", "", key)
        if digits and val.get("status") == "ok" and val.get("enrichmentComplete"):
            out[digits] = val
    return out


def load_rows_enriched():
    """Load rows with IGI enrichment data merged in.
    
    Joins on Reportno (XLS) → enrichment key (report number digits).
    Prefers IGI-certified values for Shape, Cut, Polish, Symmetry, Fluorescence, TypeName,
    and measurements (L/W/H, table%, depth%), falling back to XLS values if enrichment unavailable.
    Adds new flags: IGI_Enriched, IGI_IsPortuguese, IGI_IsTypeIIa.
    """
    enrichment = load_enrichment()
    wb = xlrd.open_workbook(XLS_FILE)
    ws = wb.sheet_by_name("Table")
    headers = [str(ws.cell_value(0, col)).strip() for col in range(ws.ncols)]
    missing = [col for col in REQUIRED_COLUMNS if col not in headers]
    if missing:
        raise RuntimeError("Missing columns: " + ", ".join(missing))

    raw_rows = []
    for idx in range(1, ws.nrows):
        raw = {headers[col]: ws.cell_value(idx, col) for col in range(ws.ncols)}
        carat = safe_float(raw.get("Carat"))
        price = safe_float(raw.get("SaleDollorPrice"))
        if not carat or carat <= 0 or not price or price <= 0:
            continue

        # Join enrichment data
        report_digits = re.sub(r"[^0-9]", "", str(raw.get("Reportno", "")))
        igi = enrichment.get(report_digits, {})
        has_igi = bool(igi)

        # Parse XLS measurements
        length, width, height, ratio = parse_measurement(raw.get("Measurement"))
        internal_price = int(round(price * 170))

        # Shape: prefer IGI-certified shapeMapped, fall back to XLS
        shape_xls = norm_cat(raw.get("Shape"))
        shape_igi = igi.get("shapeMapped")  # e.g. 'square_cushion', 'asscher', 'oval'
        shape_final = norm_cat(shape_igi) if shape_igi else shape_xls

        # Measurements: prefer IGI-certified values
        lw_ratio = igi.get("lwRatio") or ratio
        table_pct = igi.get("tablePct") or safe_float(raw.get("Table_Scale"))
        depth_pct = igi.get("depthPct") or safe_float(raw.get("Depth_Scale"))
        igi_length = igi.get("size1") or length
        igi_width = igi.get("size2") or width
        igi_height = igi.get("size3") or height

        # Other attributes: prefer IGI values
        cut_final = norm_cat(igi.get("cut") or raw.get("Cut"))
        polish_final = norm_cat(igi.get("polish") or raw.get("Polish"))
        symmetry_final = norm_cat(igi.get("symmetry") or raw.get("Symmetry"))
        fluorescence_final = norm_cat(igi.get("fluorescence") or raw.get("Fluorescence"))
        typename_final = norm_cat(igi.get("growthMethod") or raw.get("TypeName"))

        row = {
            "rowNo": idx + 1,
            "Carat": carat,
            "Shape": shape_final,           # ← upgraded shape from IGI
            "Shape_XLS": shape_xls,         # keep original for ablation
            "Color": norm_cat(raw.get("Color")),
            "Clarity": norm_cat(raw.get("Clarity")),
            "Cut": cut_final,
            "Polish": polish_final,
            "Symmetry": symmetry_final,
            "Fluorescence": fluorescence_final,
            "Report": "IGI" if "IGI" in norm_cat(raw.get("Report")) else norm_cat(raw.get("Report")),
            "TypeName": typename_final,
            "Table_Scale": table_pct,
            "Depth_Scale": depth_pct,
            "Length": igi_length,
            "Width": igi_width,
            "Height": igi_height,
            "LengthWidthRatio": lw_ratio,
            # New IGI enrichment flags
            "IGI_Enriched": 1.0 if has_igi else 0.0,
            "IGI_IsPortuguese": 1.0 if igi.get("isPortuguese") else 0.0,
            "IGI_IsTypeIIa": 1.0 if (igi.get("diamondType") == "Type IIa") else 0.0,
            # Pricing
            "SaleDollorPrice": price,
            "internal_price": internal_price,
            "usd_per_ct": price / carat,
            "internal_rate_per_ct": internal_price / carat,
            "carat_bucket": carat_bucket(carat),
        }
        add_cut_style_features(row)
        raw_rows.append(row)
    return raw_rows


def metrics(actual, predicted):
    pairs = [(a, p) for a, p in zip(actual, predicted) if a and p is not None]
    n = len(pairs)
    if not n:
        return {"count": 0, "mape": None, "mae": None, "rmse": None, "r2": None}
    abs_err = [abs(a - p) for a, p in pairs]
    sq_err = [(a - p) ** 2 for a, p in pairs]
    mean_actual = sum(a for a, _ in pairs) / n
    sst = sum((a - mean_actual) ** 2 for a, _ in pairs)
    sse = sum(sq_err)
    return {
        "count": n,
        "mape": round(100 * sum(abs(a - p) / a for a, p in pairs) / n, 4),
        "mae": round(sum(abs_err) / n, 4),
        "rmse": round(math.sqrt(sse / n), 4),
        "r2": round(1 - sse / sst, 6) if sst else None,
    }


def split_train_test_random(rows, seed=42):
    shuffled = list(rows)
    random.Random(seed).shuffle(shuffled)
    n_test = max(1, int(round(len(shuffled) * 0.2)))
    return shuffled[n_test:], shuffled[:n_test]


def split_train_test_balanced(rows, bucket_fields=VALIDATION_BUCKET_FIELDS, seed=42):
    """Hold out one row per populated spec bucket; singleton buckets stay train-only."""
    rng = random.Random(seed)
    groups = defaultdict(list)
    for row in rows:
        key = tuple(row.get(field, "-") for field in bucket_fields)
        groups[key].append(row)

    train = []
    test = []
    for key in sorted(groups):
        recs = list(groups[key])
        if len(recs) < 2:
            train.extend(recs)
            continue
        chosen_idx = rng.randrange(len(recs))
        test.append(recs[chosen_idx])
        train.extend(r for idx, r in enumerate(recs) if idx != chosen_idx)
    rng.shuffle(train)
    rng.shuffle(test)
    return train, test


def split_train_test(rows, seed=42):
    return split_train_test_balanced(rows, seed=seed)


def split_train_test_temporal(rows, train_frac=0.7, seed=42):
    """Sort by rowNo (chronological proxy), train on recent data only.

    Hypothesis: StarGem updates their rate card periodically. Training on
    mixed-time data forces the model to average across different rate regimes.
    By training only on recent data, we eliminate this artificial noise.
    """
    sorted_rows = sorted(rows, key=lambda r: r["rowNo"])
    n_recent = int(len(sorted_rows) * train_frac)
    recent = sorted_rows[-n_recent:]  # most recent train_frac of data
    return split_train_test_balanced(recent, seed=seed)


def recent_training_subset(train, all_rows=None, train_frac=0.7):
    """Keep the shared test set fixed while restricting training to recent rows."""
    source_rows = all_rows if all_rows is not None else train
    sorted_rows = sorted(source_rows, key=lambda r: r["rowNo"])
    n_recent = int(len(sorted_rows) * train_frac)
    recent_ids = {r["rowNo"] for r in sorted_rows[-n_recent:]}
    recent_train = [r for r in train if r["rowNo"] in recent_ids]
    return recent_train or train


def clamp_positive_predictions(values):
    out = []
    for value in values:
        try:
            n = float(value)
        except (TypeError, ValueError):
            n = 0.0
        out.append(max(n, 0.01))
    return out


# ═══════════════════════════════════════════════════════════════════════════
# LOOKUP TABLE (for use as ML feature)
# ═══════════════════════════════════════════════════════════════════════════

def build_lookup(rows):
    """Build the deterministic lookup table from training rows."""
    tables = []
    for level, fields in LOOKUP_LEVELS:
        grouped = defaultdict(list)
        for row in rows:
            key = tuple(str(row.get(f, "-")) for f in fields)
            grouped[key].append(row)
        groups = {}
        for key, recs in grouped.items():
            rates = [r["internal_rate_per_ct"] for r in recs]
            usd_rates = [r["usd_per_ct"] for r in recs]
            groups["||".join(key)] = {
                "rate": round(median(rates), 6),
                "usdPerCt": round(median(usd_rates), 4),
                "count": len(recs),
            }
        tables.append({"level": level, "fields": fields, "groups": groups})

    all_rates = [r["internal_rate_per_ct"] for r in rows]
    global_rate = round(median(all_rates), 6)
    return tables, global_rate


def pav_non_increasing(values):
    """Pool-adjacent violators: return isotonically non-increasing sequence closest to `values`.

    values[i] >= values[i+1] is guaranteed for every i in the output.
    None entries are propagated unchanged (skipped during merge).
    """
    # Work only on finite positions; keep None positions as-is
    idxs = [i for i, v in enumerate(values) if v is not None]
    if len(idxs) <= 1:
        return list(values)

    # Initialise blocks: [(block_sum, block_count, [original_indices])]
    blocks = [[values[i], 1, [i]] for i in idxs]

    j = 0
    while j < len(blocks) - 1:
        avg_j  = blocks[j][0]  / blocks[j][1]
        avg_j1 = blocks[j+1][0] / blocks[j+1][1]
        if avg_j < avg_j1:          # violation: j < j+1, merge
            blocks[j][0] += blocks[j+1][0]
            blocks[j][1] += blocks[j+1][1]
            blocks[j][2]  = blocks[j][2] + blocks[j+1][2]
            blocks.pop(j+1)
            if j > 0:
                j -= 1
        else:
            j += 1

    result = list(values)  # copy
    for bsum, bcnt, bidxs in blocks:
        avg = bsum / bcnt
        for i in bidxs:
            result[i] = avg
    return result


def build_monotone_lookup_tables(rows):
    """Layer-1 lookup: build tables, then isotonically regularise clarity+color.

    For every (carat_bucket, Shape, Color) group in Level-E cells:
      1. Shrink sparse cells (n < MIN_SUPPORT) toward the group weighted mean.
      2. Apply PAV (non-increasing) over the CLARITY_ORDER_S21 axis.
    Same procedure for color axis: fix (carat_bucket, Shape, Clarity), PAV over COLOR_ORDER_S21.
    A 'monotonic': True marker is written into Level-E for diagnostic use.
    """
    tables, global_rate = build_lookup(rows)

    MIN_SUPPORT = MONOTONE_LOOKUP_MIN_SUPPORT
    SHRINK_K    = MONOTONE_LOOKUP_SHRINK_K

    # Find Level-E table: fields = ["carat_bucket", "Shape", "Color", "Clarity"]
    for tbl_idx, tbl in enumerate(tables):
        if tbl["level"] != "E":
            continue
        groups = tbl["groups"]  # key="cb||shape||color||clarity" → {usdPerCt, rate, count}

        # ── Clarity axis PAV ──────────────────────────────────────────────
        # Collect unique (cb, shape, color) combos
        cs_combos = set()
        for key in groups:
            parts = key.split("||")
            cs_combos.add((parts[0], parts[1], parts[2]))  # cb, shape, color

        for (cb, shape, color) in cs_combos:
            rates  = {}   # clarity → usdPerCt
            counts = {}   # clarity → n
            for cl in CLARITY_ORDER_S21:
                k = f"{cb}||{shape}||{color}||{cl}"
                if k in groups:
                    rates[cl]  = groups[k]["usdPerCt"]
                    counts[cl] = groups[k]["count"]
            if not rates:
                continue
            # Weighted group average for shrinkage prior
            total_cnt = sum(counts.values())
            group_avg = sum(rates[cl] * counts[cl] for cl in rates) / max(total_cnt, 1)
            # Shrink
            shrunk = {}
            for cl in rates:
                n = counts[cl]
                if n < MIN_SUPPORT:
                    shrunk[cl] = (n * rates[cl] + SHRINK_K * group_avg) / (n + SHRINK_K)
                else:
                    shrunk[cl] = rates[cl]
            # PAV
            present = [cl for cl in CLARITY_ORDER_S21 if cl in shrunk]
            if len(present) < 2:
                continue
            pav_vals = pav_non_increasing([shrunk[cl] for cl in present])
            for cl, pav_rate in zip(present, pav_vals):
                k = f"{cb}||{shape}||{color}||{cl}"
                if k in groups:
                    groups[k] = {
                        "usdPerCt": round(pav_rate, 4),
                        "rate":     round(pav_rate / 170, 6),
                        "count":    groups[k]["count"],
                    }

        # ── Color axis PAV ────────────────────────────────────────────────
        sc_combos = set()
        for key in groups:
            parts = key.split("||")
            sc_combos.add((parts[0], parts[1], parts[3]))  # cb, shape, clarity

        for (cb, shape, clarity) in sc_combos:
            rates  = {}
            counts = {}
            for co in COLOR_ORDER_S21:
                k = f"{cb}||{shape}||{co}||{clarity}"
                if k in groups:
                    rates[co]  = groups[k]["usdPerCt"]
                    counts[co] = groups[k]["count"]
            if not rates:
                continue
            total_cnt = sum(counts.values())
            group_avg = sum(rates[co] * counts[co] for co in rates) / max(total_cnt, 1)
            shrunk = {}
            for co in rates:
                n = counts[co]
                if n < MIN_SUPPORT:
                    shrunk[co] = (n * rates[co] + SHRINK_K * group_avg) / (n + SHRINK_K)
                else:
                    shrunk[co] = rates[co]
            present = [co for co in COLOR_ORDER_S21 if co in shrunk]
            if len(present) < 2:
                continue
            pav_vals = pav_non_increasing([shrunk[co] for co in present])
            for co, pav_rate in zip(present, pav_vals):
                k = f"{cb}||{shape}||{co}||{clarity}"
                if k in groups:
                    groups[k] = {
                        "usdPerCt": round(pav_rate, 4),
                        "rate":     round(pav_rate / 170, 6),
                        "count":    groups[k]["count"],
                    }

        tables[tbl_idx]["groups"]    = groups
        tables[tbl_idx]["monotonic"] = True
        break  # only Level-E needs PAV; others serve as coarser fallbacks

    return tables, global_rate


def lookup_predict_rate(row, tables, global_rate):
    """Return (predicted_rate_per_ct, level, count)."""
    for table in tables:
        key = "||".join(str(row.get(f, "-")) for f in table["fields"])
        hit = table["groups"].get(key)
        if hit:
            return hit["usdPerCt"], table["level"], hit["count"]
    return global_rate / 170, "GLOBAL", 0


def build_s23_lookup(rows):
    """Build grade-agnostic lookup table using S23_LOOKUP_LEVELS.

    Color and Clarity are NOT in any lookup key.  The anchor captures only
    (carat_bucket, Shape, TypeName, etc.) price level.  Grade premiums are
    learned entirely by the GBDT's ordinal rank features and their monotone
    constraints, enabling the IF-premium learned from dense 1 ct cells to
    transfer to sparse 3 ct+ cells that previously collapsed to the global
    fallback anchor ($127/ct) and inverted the ladder.

    No PAV step is applied here because there are no grade axes to isotonically
    regularise — the isotonic defence moves fully to the GBDT constraint layer.
    """
    tables = []
    for level, fields in S23_LOOKUP_LEVELS:
        grouped = defaultdict(list)
        for row in rows:
            key = tuple(str(row.get(f, "-")) for f in fields)
            grouped[key].append(row)
        groups = {}
        for key, recs in grouped.items():
            usd_rates = [r["usd_per_ct"] for r in recs]
            groups["||".join(key)] = {
                "usdPerCt": round(median(usd_rates), 4),
                "count": len(recs),
            }
        tables.append({"level": level, "fields": fields, "groups": groups})

    global_rate = round(median(r["usd_per_ct"] for r in rows), 6)
    return tables, global_rate


def build_large_carat_tail_model(rows, lookup_tables, lookup_global_rate, levels=None):
    """Fit monotonic log-rate tail curves for large stones.

    The tail is multiplicative on top of the 5-9.99ct lookup surface:
      rate = base_lookup_rate * exp(slope * log(carat / 5))

    Slopes are clipped non-negative so comparable specs never get cheaper per
    carat only because the browser is extrapolating past the dense buckets.

    Pass `levels` to override LARGE_CARAT_TAIL_LEVELS (e.g. S23_TAIL_LEVELS,
    which omits Color/Clarity to keep the multiplier grade-agnostic).
    """
    if levels is None:
        levels = LARGE_CARAT_TAIL_LEVELS
    rows_with_residuals = []
    for row in rows:
        carat = row.get("Carat")
        if not carat or carat < LARGE_CARAT_TAIL_START_CT:
            continue
        base_rate, _, _ = lookup_predict_rate(tail_anchor_lookup_row(row), lookup_tables, lookup_global_rate)
        x = large_carat_tail_x(carat)
        if x <= 0 or not base_rate or base_rate <= 0:
            continue
        y = math.log(max(row["usd_per_ct"], 0.01) / max(base_rate, 0.01))
        rows_with_residuals.append((row, x, y))

    def fit_slope(items):
        denom = sum(x * x for _, x, _ in items)
        if denom <= 0:
            return 0.0
        slope = sum(x * y for _, x, y in items) / denom
        return max(0.0, min(LARGE_CARAT_TAIL_MAX_SLOPE, slope))

    global_slope = fit_slope(rows_with_residuals)
    tables = []
    for name, fields in levels:
        grouped = defaultdict(list)
        for row, x, y in rows_with_residuals:
            key = tuple(str(row.get(f, "-")) for f in fields)
            grouped[key].append((row, x, y))
        groups = {}
        for key, items in grouped.items():
            count = len(items)
            if count < LARGE_CARAT_TAIL_MIN_COUNT:
                continue
            raw_slope = fit_slope(items)
            weight = count / (count + 20.0)
            slope = weight * raw_slope + (1.0 - weight) * global_slope
            groups["||".join(key)] = {
                "slope": round(float(max(0.0, min(LARGE_CARAT_TAIL_MAX_SLOPE, slope))), 8),
                "rawSlope": round(float(raw_slope), 8),
                "count": count,
            }
        tables.append({"level": name, "fields": fields, "groups": groups})

    return {
        "startCarat": LARGE_CARAT_TAIL_START_CT,
        "maxSlope": LARGE_CARAT_TAIL_MAX_SLOPE,
        "minCount": LARGE_CARAT_TAIL_MIN_COUNT,
        "globalSlope": round(float(global_slope), 8),
        "levels": tables,
    }


def large_carat_tail_multiplier(row, tail_model):
    if not tail_model:
        return 1.0, "NONE", 0, 0.0
    carat = row.get("Carat")
    start_ct = float(tail_model.get("startCarat") or LARGE_CARAT_TAIL_START_CT)
    if not carat or carat <= start_ct:
        return 1.0, "NONE", 0, 0.0
    x = math.log(carat / start_ct)
    for table in tail_model.get("levels", []):
        key = "||".join(str(row.get(f, "-")) for f in table.get("fields", []))
        hit = table.get("groups", {}).get(key)
        if hit:
            slope = float(hit.get("slope") or 0.0)
            return math.exp(slope * x), table.get("level", "TAIL"), int(hit.get("count") or 0), slope
    slope = float(tail_model.get("globalSlope") or 0.0)
    return math.exp(slope * x), "GLOBAL", 0, slope


def build_hybrid_anchor_table(rows):
    """Exact/near source-sheet anchors for browser routing before ML fallback."""
    grouped = defaultdict(lambda: defaultdict(list))
    for row in rows:
        carat = row.get("Carat")
        rate = row.get("usd_per_ct")
        if not carat or not rate:
            continue
        key = "||".join(str(row.get(field, "-")) for field in HYBRID_ANCHOR_FIELDS)
        grouped[key][carat_0_01_bucket(carat)].append(rate)

    anchors = {}
    for key, carat_rates in grouped.items():
        points = []
        for carat, rates in sorted(carat_rates.items()):
            points.append([
                round(float(carat), 2),
                round(float(median(rates)), 6),
                len(rates),
            ])
        if points:
            anchors[key] = points
    return {
        "specFields": HYBRID_ANCHOR_FIELDS,
        "exactCaratTolerance": HYBRID_EXACT_CARAT_TOLERANCE,
        "nearCaratTolerance": HYBRID_NEAR_CARAT_TOLERANCE,
        "interpolationMaxGap": HYBRID_INTERPOLATION_MAX_GAP,
        "anchors": anchors,
    }


# ═══════════════════════════════════════════════════════════════════════════
# CATEGORY PRIOR FEATURE (kNN-style)
# ═══════════════════════════════════════════════════════════════════════════

def build_category_prior(train_rows):
    """Build per-category median rate_per_ct for use as a feature.

    Categories in priority order (most specific → least specific):
      1. (Shape, Color, Clarity, TypeName)
      2. (Shape, Color, Clarity)
      3. (Color, Clarity)
      4. global
    """
    levels = [
        ("SCCT", ["Shape", "Color", "Clarity", "TypeName"]),
        ("SCC",  ["Shape", "Color", "Clarity"]),
        ("CC",   ["Color", "Clarity"]),
    ]
    tables = {}
    for name, fields in levels:
        grouped = defaultdict(list)
        for row in train_rows:
            key = tuple(str(row.get(f, "-")) for f in fields)
            grouped[key].append(row["usd_per_ct"])
        tables[name] = {
            "||".join(k): round(median(v), 6)
            for k, v in grouped.items()
        }

    global_prior = round(median(r["usd_per_ct"] for r in train_rows), 6)
    return tables, global_prior, levels


def category_prior_rate(row, cat_tables, global_prior, levels):
    """Return the most-specific known category prior rate for this row."""
    for name, fields in levels:
        key = "||".join(str(row.get(f, "-")) for f in fields)
        val = cat_tables[name].get(key)
        if val is not None:
            return val
    return global_prior


# ═══════════════════════════════════════════════════════════════════════════
# FEATURE FRAME BUILDERS
# ═══════════════════════════════════════════════════════════════════════════

def as_model_frame_base(rows):
    """Same features as the v1 baseline model."""
    import pandas as pd
    data = []
    for row in rows:
        item = {}
        for col in CATEGORICAL_FEATURES:
            item[col] = norm_cat(row.get(col))
        for col in NUMERIC_FEATURES:
            item[col] = row.get(col)
        data.append(item)
    return pd.DataFrame(data)


def as_model_frame_engineered(rows):
    """Add polynomial carat transforms + dimension features."""
    import pandas as pd
    data = []
    for row in rows:
        item = {}
        for col in CATEGORICAL_FEATURES:
            item[col] = norm_cat(row.get(col))
        for col in NUMERIC_FEATURES:
            item[col] = row.get(col)

        # Carat polynomial transforms
        c = item.get("Carat")
        if c and c > 0:
            item["Carat_sq"] = c * c
            item["Carat_cube"] = c * c * c
            item["Log_Carat"] = math.log(c)
            item["Carat_bucket_pos"] = carat_bucket_position(c)
            # Distance from nearest integer carat threshold (0.5, 1.0, 1.5, ...)
            nearest_thresh = round(c * 2) / 2
            item["Dist_carat_threshold"] = abs(c - nearest_thresh)

        # Dimension features
        l, w, h = item.get("Length"), item.get("Width"), item.get("Height")
        if l and w and h:
            item["Dim_Volume"] = l * w * h
            item["Dim_Surface"] = 2 * (l * w + w * h + l * h)
        if l and w and min(l, w) > 0:
            item["LW_Ratio_refined"] = max(l, w) / min(l, w)

        # Table / depth ratio
        t, d = item.get("Table_Scale"), item.get("Depth_Scale")
        if t and d and d > 0:
            item["Table_Depth_Ratio"] = t / d

        data.append(item)
    return pd.DataFrame(data)


def as_model_frame_full(rows, lookup_tables, lookup_global_rate,
                         cat_tables, cat_global_prior, cat_levels):
    """Full feature set: engineered + lookup rate prior + category prior."""
    import pandas as pd
    data = []
    for row in rows:
        item = {}
        for col in CATEGORICAL_FEATURES:
            item[col] = norm_cat(row.get(col))
        for col in NUMERIC_FEATURES:
            item[col] = row.get(col)

        # Carat polynomial transforms
        c = item.get("Carat")
        if c and c > 0:
            item["Carat_sq"] = c * c
            item["Carat_cube"] = c * c * c
            item["Log_Carat"] = math.log(c)
            item["Carat_bucket_pos"] = carat_bucket_position(c)
            nearest_thresh = round(c * 2) / 2
            item["Dist_carat_threshold"] = abs(c - nearest_thresh)

        # Dimension features
        l, w, h = item.get("Length"), item.get("Width"), item.get("Height")
        if l and w and h:
            item["Dim_Volume"] = l * w * h
            item["Dim_Surface"] = 2 * (l * w + w * h + l * h)
        if l and w and min(l, w) > 0:
            item["LW_Ratio_refined"] = max(l, w) / min(l, w)
        t, d = item.get("Table_Scale"), item.get("Depth_Scale")
        if t and d and d > 0:
            item["Table_Depth_Ratio"] = t / d

        # Lookup rate prior (built from training data → no leakage)
        lookup_rate, lookup_level, _ = lookup_predict_rate(
            row, lookup_tables, lookup_global_rate
        )
        item["Lookup_RatePerCt"] = lookup_rate
        item["Lookup_IsGlobal"] = 1.0 if lookup_level == "GLOBAL" else 0.0
        if c and c > 0 and lookup_rate:
            item["Log_Lookup_RatePerCt"] = math.log(lookup_rate) if lookup_rate > 0 else None

        # Category prior rate (median rate of similar diamonds)
        cat_rate = category_prior_rate(row, cat_tables, cat_global_prior, cat_levels)
        item["Category_RatePerCt"] = cat_rate
        if cat_rate and cat_rate > 0:
            item["Log_Category_RatePerCt"] = math.log(cat_rate)

        data.append(item)
    return pd.DataFrame(data)


def selected_spec_view(row, mask_cut=False):
    """Inference-like view used before the IGI report has filled dimensions."""
    out = dict(row)
    out["TypeName"] = "-"
    if mask_cut:
        out["Cut"] = "-"
    add_cut_style_features(out)
    for field in ("Table_Scale", "Depth_Scale", "Length", "Width", "Height", "LengthWidthRatio"):
        out[field] = None
    out["Has_Dimensions"] = 0.0
    out["Has_TableDepth"] = 0.0
    out["Has_GrowthMethod"] = 0.0
    out["Has_Report_Cut"] = 0.0 if mask_cut else (1.0 if norm_cat(out.get("Cut")) != "-" else 0.0)
    out["Is_SelectedSpec_Mode"] = 1.0
    return out


def cert_loaded_view(row):
    """Report-loaded view with explicit missingness flags."""
    out = dict(row)
    add_cut_style_features(out)
    out["Has_Dimensions"] = 1.0 if all(out.get(f) for f in ("Length", "Width", "Height", "LengthWidthRatio")) else 0.0
    out["Has_TableDepth"] = 1.0 if out.get("Table_Scale") and out.get("Depth_Scale") else 0.0
    out["Has_GrowthMethod"] = 1.0 if norm_cat(out.get("TypeName")) != "-" else 0.0
    out["Has_Report_Cut"] = 1.0 if norm_cat(out.get("Cut")) != "-" else 0.0
    out["Is_SelectedSpec_Mode"] = 0.0
    return out


def s19_augmented_training_rows(rows):
    augmented = []
    for row in rows:
        augmented.append(cert_loaded_view(row))
        augmented.append(selected_spec_view(row, mask_cut=False))
        # A small cut-missing augmentation teaches "-" as unknown, not a premium segment.
        if row["rowNo"] % 4 == 0:
            augmented.append(selected_spec_view(row, mask_cut=True))
    return augmented


def as_model_frame_s19(rows, lookup_tables, lookup_global_rate,
                       cat_tables, cat_global_prior, cat_levels):
    """Residual-rate feature frame for selected-spec-aware ML."""
    import pandas as pd
    data = []
    for row in rows:
        item = {}
        for col in CATEGORICAL_FEATURES:
            item[col] = norm_cat(row.get(col))
        for col in NUMERIC_FEATURES:
            item[col] = row.get(col)
        for col in SELECTED_SPEC_FLAGS:
            item[col] = float(row.get(col, 0.0) or 0.0)

        c = item.get("Carat")
        if c and c > 0:
            item["Carat_sq"] = c * c
            item["Carat_cube"] = c * c * c
            item["Log_Carat"] = math.log(c)
            item["Carat_bucket_pos"] = carat_bucket_position(c)
            item["Dist_carat_threshold"] = abs(c - round(c * 2) / 2)

        l, w, h = item.get("Length"), item.get("Width"), item.get("Height")
        if l and w and h:
            item["Dim_Volume"] = l * w * h
            item["Dim_Surface"] = 2 * (l * w + w * h + l * h)
        if l and w and min(l, w) > 0:
            item["LW_Ratio_refined"] = max(l, w) / min(l, w)
        t, d = item.get("Table_Scale"), item.get("Depth_Scale")
        if t and d and d > 0:
            item["Table_Depth_Ratio"] = t / d

        for optional_numeric in ("Dim_Volume", "Dim_Surface", "LW_Ratio_refined", "Table_Depth_Ratio"):
            item.setdefault(optional_numeric, None)

        lookup_rate, lookup_level, lookup_count = lookup_predict_rate(
            row, lookup_tables, lookup_global_rate
        )
        item["Lookup_RatePerCt"] = lookup_rate
        item["Lookup_IsGlobal"] = 1.0 if lookup_level == "GLOBAL" else 0.0
        item["Lookup_Count"] = float(lookup_count or 0)
        item["Log_Lookup_Count"] = math.log1p(float(lookup_count or 0))
        if lookup_rate and lookup_rate > 0:
            item["Log_Lookup_RatePerCt"] = math.log(lookup_rate)

        cat_rate = category_prior_rate(row, cat_tables, cat_global_prior, cat_levels)
        item["Category_RatePerCt"] = cat_rate
        if cat_rate and cat_rate > 0:
            item["Log_Category_RatePerCt"] = math.log(cat_rate)

        data.append(item)
    return pd.DataFrame(data)


def s19_predict_prices(pipe, rows, lookup_tables, lookup_global_rate,
                       cat_tables, cat_global_prior, cat_levels):
    residual_preds = pipe.predict(as_model_frame_s19(
        rows, lookup_tables, lookup_global_rate, cat_tables, cat_global_prior, cat_levels
    ))
    prices = []
    for residual, row in zip(residual_preds, rows):
        lookup_rate, _, _ = lookup_predict_rate(row, lookup_tables, lookup_global_rate)
        prices.append(max(0.01, lookup_rate * math.exp(residual) * row["Carat"]))
    return prices


def as_model_frame_s20(rows, lookup_tables, lookup_global_rate,
                       cat_tables, cat_global_prior, cat_levels, tail_model):
    """S20 frame: S19 features plus explicit specialty-cut and tail features."""
    df = as_model_frame_s19(rows, lookup_tables, lookup_global_rate, cat_tables, cat_global_prior, cat_levels)
    for idx, row in enumerate(rows):
        add_cut_style_features(row)
        group = row.get("Cut_Style_Group")
        df.at[idx, "Is_Specialty_Cut"] = float(row.get("Is_Specialty_Cut", 0.0) or 0.0)
        df.at[idx, "Is_Traditional_Cut"] = float(row.get("Is_Traditional_Cut", 0.0) or 0.0)
        df.at[idx, "Is_IceFlower_Cut"] = float(row.get("Is_IceFlower_Cut", 0.0) or 0.0)

        carat = row.get("Carat")
        for name, value in large_carat_tail_features(carat).items():
            df.at[idx, name] = value

        tail_base_rate, tail_base_level, tail_base_count = lookup_predict_rate(
            tail_anchor_lookup_row(row), lookup_tables, lookup_global_rate
        )
        tail_mult, tail_level, tail_count, tail_slope = large_carat_tail_multiplier(row, tail_model)
        df.at[idx, "Tail_Base_Lookup_RatePerCt"] = tail_base_rate
        df.at[idx, "Log_Tail_Base_Lookup_RatePerCt"] = math.log(tail_base_rate) if tail_base_rate and tail_base_rate > 0 else None
        df.at[idx, "Tail_Base_Lookup_Count"] = float(tail_base_count or 0)
        df.at[idx, "Large_Carat_Tail_Multiplier"] = tail_mult
        df.at[idx, "Log_Large_Carat_Tail_Multiplier"] = math.log(tail_mult) if tail_mult and tail_mult > 0 else 0.0
        df.at[idx, "Large_Carat_Tail_Slope"] = tail_slope
        df.at[idx, "Large_Carat_Tail_Count"] = float(tail_count or 0)
    return df


def s20_predict_prices(pipe, rows, lookup_tables, lookup_global_rate,
                       cat_tables, cat_global_prior, cat_levels, tail_model):
    residual_preds = pipe.predict(as_model_frame_s20(
        rows, lookup_tables, lookup_global_rate, cat_tables, cat_global_prior, cat_levels, tail_model
    ))
    prices = []
    for residual, row in zip(residual_preds, rows):
        base_rate, _, _ = lookup_predict_rate(tail_anchor_lookup_row(row), lookup_tables, lookup_global_rate)
        tail_mult, _, _, _ = large_carat_tail_multiplier(row, tail_model)
        prices.append(max(0.01, base_rate * tail_mult * math.exp(residual) * row["Carat"]))
    return prices


def as_model_frame_s21(rows, lookup_tables, lookup_global_rate,
                       cat_tables, cat_global_prior, cat_levels, tail_model):
    """S21 frame: S20 features plus Clarity_Rank and Color_Rank ordinal features (Layer 2)."""
    import pandas as pd
    df = as_model_frame_s20(rows, lookup_tables, lookup_global_rate,
                            cat_tables, cat_global_prior, cat_levels, tail_model)
    for idx, row in enumerate(rows):
        clarity = norm_cat(row.get("Clarity", "-"))
        color   = norm_cat(row.get("Color",   "-"))
        df.at[idx, "Clarity_Rank"] = float(CLARITY_RANK.get(clarity, 7))
        df.at[idx, "Color_Rank"]   = float(COLOR_RANK.get(color, 7))
    return df


def s21_predict_prices(lgbm_model, pre, rows, lookup_tables, lookup_global_rate,
                       cat_tables, cat_global_prior, cat_levels, tail_model):
    """Inference with the S21 LightGBM model (raw, no PAV projection)."""
    import numpy as np
    x_df = as_model_frame_s21(rows, lookup_tables, lookup_global_rate,
                               cat_tables, cat_global_prior, cat_levels, tail_model)
    X    = pre.transform(x_df)
    residuals = lgbm_model.predict(X)
    prices = []
    for residual, row in zip(residuals, rows):
        base_rate, _, _ = lookup_predict_rate(tail_anchor_lookup_row(row), lookup_tables, lookup_global_rate)
        tail_mult, _, _, _ = large_carat_tail_multiplier(row, tail_model)
        prices.append(max(0.01, base_rate * tail_mult * math.exp(residual) * row["Carat"]))
    return prices


def as_model_frame_s23(rows, lookup_tables, lookup_global_rate,
                        cat_tables, cat_global_prior, cat_levels, tail_model):
    """S23 feature frame: grade-agnostic anchor + ordinal ranks.

    Key differences from S21:
    - Categorical features: S23_CATEGORICAL_FEATURES (Color and Clarity removed).
      Grade signal enters only through ordinal rank numerics, not one-hot dummies.
    - Lookup tables use S23_LOOKUP_LEVELS (grade-agnostic anchor).
    - No explicit grade×carat interaction terms: monotone constraints are per-feature
      (marginal), so Log_Carat_x_ClarityRank would be an UNCONSTRAINED feature that
      moves whenever grade changes, weakening the formal ordering guarantee.  LightGBM
      learns size-dependent grade effects internally via tree splits on Clarity_Rank at
      different points of the Log_Carat axis — no manual interaction term needed.
    """
    import pandas as pd
    data = []
    for row in rows:
        item = {}

        # ── Categorical (Color and Clarity excluded — ordinal ranks instead) ──
        for col in S23_CATEGORICAL_FEATURES:
            item[col] = norm_cat(row.get(col))

        # ── Numeric base ──────────────────────────────────────────────────────
        for col in NUMERIC_FEATURES:
            item[col] = row.get(col)
        for col in SELECTED_SPEC_FLAGS:
            item[col] = float(row.get(col, 0.0) or 0.0)

        # ── Carat polynomial transforms ───────────────────────────────────────
        c = item.get("Carat")
        log_c = None
        if c and c > 0:
            log_c = math.log(c)
            item["Carat_sq"] = c * c
            item["Carat_cube"] = c * c * c
            item["Log_Carat"] = log_c
            item["Carat_bucket_pos"] = carat_bucket_position(c)
            item["Dist_carat_threshold"] = abs(c - round(c * 2) / 2)

        # ── Dimension features ────────────────────────────────────────────────
        l, w, h = item.get("Length"), item.get("Width"), item.get("Height")
        if l and w and h:
            item["Dim_Volume"] = l * w * h
            item["Dim_Surface"] = 2 * (l * w + w * h + l * h)
        if l and w and min(l, w) > 0:
            item["LW_Ratio_refined"] = max(l, w) / min(l, w)
        t, d = item.get("Table_Scale"), item.get("Depth_Scale")
        if t and d and d > 0:
            item["Table_Depth_Ratio"] = t / d
        for opt in ("Dim_Volume", "Dim_Surface", "LW_Ratio_refined", "Table_Depth_Ratio"):
            item.setdefault(opt, None)

        # ── Grade-agnostic lookup rate (no Color/Clarity in key) ─────────────
        lookup_rate, lookup_level, lookup_count = lookup_predict_rate(
            row, lookup_tables, lookup_global_rate
        )
        item["Lookup_RatePerCt"] = lookup_rate
        item["Lookup_IsGlobal"] = 1.0 if lookup_level == "GLOBAL" else 0.0
        item["Lookup_Count"] = float(lookup_count or 0)
        item["Log_Lookup_Count"] = math.log1p(float(lookup_count or 0))
        if lookup_rate and lookup_rate > 0:
            item["Log_Lookup_RatePerCt"] = math.log(lookup_rate)

        # ── Category prior omitted from S23 ────────────────────────────────
        # Category_RatePerCt is grade-aware (uses Color+Clarity in its keys).
        # When clarity changes in the monotonicity sweep, it changes too but
        # is NOT in the monotone constraint vector, allowing it to overpower
        # the Clarity_Rank constraint.  The grade-agnostic Lookup_RatePerCt
        # already provides the dominant anchor signal — no grade-aware prior
        # is needed in S23.

        # ── Specialty cut flags ───────────────────────────────────────────────
        add_cut_style_features(row)
        item["Is_Specialty_Cut"] = float(row.get("Is_Specialty_Cut", 0.0) or 0.0)
        item["Is_Traditional_Cut"] = float(row.get("Is_Traditional_Cut", 0.0) or 0.0)
        item["Is_IceFlower_Cut"] = float(row.get("Is_IceFlower_Cut", 0.0) or 0.0)

        # ── Large-carat tail features ─────────────────────────────────────────
        for name, value in large_carat_tail_features(c).items():
            item[name] = value
        tail_base_rate, _, tail_base_count = lookup_predict_rate(
            tail_anchor_lookup_row(row), lookup_tables, lookup_global_rate
        )
        tail_mult, _, tail_count, tail_slope = large_carat_tail_multiplier(row, tail_model)
        item["Tail_Base_Lookup_RatePerCt"] = tail_base_rate
        item["Log_Tail_Base_Lookup_RatePerCt"] = (
            math.log(tail_base_rate) if tail_base_rate and tail_base_rate > 0 else None
        )
        item["Tail_Base_Lookup_Count"] = float(tail_base_count or 0)
        item["Large_Carat_Tail_Multiplier"] = tail_mult
        item["Log_Large_Carat_Tail_Multiplier"] = (
            math.log(tail_mult) if tail_mult and tail_mult > 0 else 0.0
        )
        item["Large_Carat_Tail_Slope"] = tail_slope
        item["Large_Carat_Tail_Count"] = float(tail_count or 0)

        # ── Ordinal grade ranks ───────────────────────────────────────────────
        # No interaction terms: see docstring for rationale.
        clarity = norm_cat(row.get("Clarity", "-"))
        color = norm_cat(row.get("Color", "-"))
        item["Clarity_Rank"] = float(CLARITY_RANK.get(clarity, 7))
        item["Color_Rank"] = float(COLOR_RANK.get(color, 7))

        data.append(item)
    return pd.DataFrame(data)


def s23_predict_prices(lgbm_model, pre, rows, lookup_tables, lookup_global_rate,
                        cat_tables, cat_global_prior, cat_levels, tail_model):
    """Inference with the S23 LightGBM model (grade-agnostic anchor, raw prediction)."""
    import numpy as np
    x_df = as_model_frame_s23(rows, lookup_tables, lookup_global_rate,
                               cat_tables, cat_global_prior, cat_levels, tail_model)
    X = pre.transform(x_df)
    residuals = lgbm_model.predict(X)
    prices = []
    for residual, row in zip(residuals, rows):
        base_rate, _, _ = lookup_predict_rate(
            tail_anchor_lookup_row(row), lookup_tables, lookup_global_rate
        )
        tail_mult, _, _, _ = large_carat_tail_multiplier(row, tail_model)
        prices.append(max(0.01, base_rate * tail_mult * math.exp(residual) * row["Carat"]))
    return prices


# ═══════════════════════════════════════════════════════════════════════════
# MODEL EXPORT
# ═══════════════════════════════════════════════════════════════════════════

def round_list(values, digits=8):
    return [round(float(v), digits) for v in values]


def load_rows_from_clean_training():
    """Load training rows from dataset-clean-training.json (Segment A only).

    Maps the clean JSON format (lowercase keys, dataset-split-outliers.py schema)
    to the uppercase key format expected by all training functions.  Joins with
    the original XLS for the Report field (not stored in the clean JSON) and
    parses the Measurement string into L/W/H dimensions.
    """
    with open(CLEAN_TRAINING_JSON, "r", encoding="utf-8") as f:
        clean_rows = json.load(f)

    # Build rowNo → Report lookup from XLS
    report_by_rowno = {}
    try:
        wb = xlrd.open_workbook(XLS_FILE)
        ws = wb.sheet_by_name("Table")
        headers = [str(ws.cell_value(0, c)).strip() for c in range(ws.ncols)]
        if "Report" in headers:
            ri = headers.index("Report")
            for r in range(1, ws.nrows):
                rpt = str(ws.cell_value(r, ri)).strip().upper()
                report_by_rowno[r] = "IGI" if "IGI" in rpt else (rpt or "IGI")
    except Exception:
        pass  # default to "IGI" if XLS unavailable

    raw_rows = []
    for cr in clean_rows:
        carat = float(cr["carat"])
        price = float(cr["price"])
        cut   = str(cr.get("cut_raw") or "-").strip()
        meas  = str(cr.get("measurement") or "").strip()
        length, width, height, ratio = parse_measurement(meas)
        lw_ratio = cr.get("lw_ratio") or ratio
        row_no   = int(cr["rowNo"])
        report   = report_by_rowno.get(row_no, "IGI")
        internal_price = int(round(price * 170))

        row = {
            "rowNo":              row_no,
            "Carat":              carat,
            "Shape":              norm_cat(cr.get("shape",       "-")),
            "Color":              norm_cat(cr.get("color",       "-")),
            "Clarity":            norm_cat(cr.get("clarity",     "-")),
            "Cut":                norm_cat(cut),
            "Polish":             norm_cat(cr.get("polish",      "-")),
            "Symmetry":           norm_cat(cr.get("symmetry",    "-")),
            "Fluorescence":       norm_cat(cr.get("fluorescence","-")),
            "Report":             report,
            "TypeName":           norm_cat(cr.get("typeName",    "-")),
            "Table_Scale":        cr.get("table_pct"),
            "Depth_Scale":        cr.get("depth_pct"),
            "Length":             length,
            "Width":              width,
            "Height":             height,
            "LengthWidthRatio":   lw_ratio,
            # IGI enrichment flags — clean set has no separate enrichment pass yet
            "IGI_Enriched":       0.0,
            "IGI_IsPortuguese":   0.0,
            "IGI_IsTypeIIa":      0.0,
            "SaleDollorPrice":    price,
            "internal_price":     internal_price,
            "usd_per_ct":         price / carat,
            "internal_rate_per_ct": internal_price / carat,
            "carat_bucket":       carat_bucket(carat),
        }
        add_cut_style_features(row)
        raw_rows.append(row)

    print(f"Loaded {len(raw_rows):,} rows from clean training dataset (Segment A)")
    return raw_rows


def export_model(pipe, feature_names_numeric, model_name, model_metrics, target_type,
                 lookup_tables=None, lookup_global=None,
                 cat_tables=None, cat_global=None, cat_levels=None,
                 large_carat_tail=None, output_path=None, all_rows=None):
    """Serialize the fitted ExtraTrees pipeline to JSON.

    target_type:
      - 'log_price': target = log(price)
      - 'log_rate': target = log(price/carat)
      - 'log_lookup_residual': target = log((price/carat) / lookup_rate)
      - 'log_tail_lookup_residual': target = log((price/carat) / (lookup_rate * large_carat_tail))
    """
    pre = pipe.named_steps["pre"]
    model = pipe.named_steps["model"]
    encoder = pre.named_transformers_["cat"]
    imputer = pre.named_transformers_["num"]

    categories = {
        feature: [str(v) for v in cats]
        for feature, cats in zip(CATEGORICAL_FEATURES, encoder.categories_)
    }
    numeric_medians = {
        feature: round(float(value), 8)
        for feature, value in zip(feature_names_numeric, imputer.statistics_)
    }

    trees = []
    for estimator in model.estimators_:
        t = estimator.tree_
        trees.append({
            "childrenLeft": t.children_left.astype(int).tolist(),
            "childrenRight": t.children_right.astype(int).tolist(),
            "feature": t.feature.astype(int).tolist(),
            "threshold": round_list(t.threshold, 8),
            "value": round_list(t.value[:, 0, 0], 8),
        })

    out = {
        "generatedDate": str(date.today()),
        "modelName": model_name,
        "target": (
            "log((SaleDollorPrice/Carat)/(Lookup_RatePerCt*Large_Carat_Tail_Multiplier))" if target_type == "log_tail_lookup_residual"
            else "log((SaleDollorPrice/Carat)/Lookup_RatePerCt)" if target_type == "log_lookup_residual"
            else "log(SaleDollorPrice/Carat)" if target_type == "log_rate"
            else "log(SaleDollorPrice)"
        ),
        "prediction": (
            "Lookup_RatePerCt * Large_Carat_Tail_Multiplier * exp(mean(tree_log_predictions)) * Carat" if target_type == "log_tail_lookup_residual"
            else "Lookup_RatePerCt * exp(mean(tree_log_predictions)) * Carat" if target_type == "log_lookup_residual"
            else "exp(mean(tree_log_predictions)) * Carat" if target_type == "log_rate"
            else "exp(mean(tree_log_predictions))"
        ),
        "targetType": target_type,
        "features": {
            "categorical": CATEGORICAL_FEATURES,
            "numeric": feature_names_numeric,
            "categories": categories,
            "numericMedians": numeric_medians,
        },
        "metrics": model_metrics,
        "validation": {
            "split": "one_holdout_per_bucket",
            "bucketFields": VALIDATION_BUCKET_FIELDS,
            "selectionMetric": "bucket-balanced MAPE",
        },
        "featureLookups": {
            "lookupTables": lookup_tables or [],
            "lookupGlobalRate": lookup_global,
            "categoryTables": cat_tables or {},
            "categoryGlobalRate": cat_global,
            "categoryLevels": cat_levels or [],
        },
        "largeCaratTail": large_carat_tail,
        "hybridRouter": build_hybrid_anchor_table(
            all_rows or (load_rows_enriched() if "--enriched" in sys.argv else load_rows())
        ),
        "treeCount": len(trees),
        "trees": trees,
    }

    dest = output_path or ML_MODEL_JSON
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(sanitize_for_json(out), f, separators=(",", ":"))
    print(f"    → Exported to {dest}")
    return out


# ═══════════════════════════════════════════════════════════════════════════
# S21 LIGHTGBM EXPORT HELPERS
# ═══════════════════════════════════════════════════════════════════════════

def convert_lgbm_tree_to_flat(tree_struct):
    """Convert LightGBM recursive tree dict → flat arrays (same shape as ExtraTrees export).

    Leaf nodes:  childrenLeft[i] = childrenRight[i] = -1, value[i] = leaf_value.
    Split nodes: childrenLeft[i] = left child index, decision_type is '<='.
    """
    children_left  = []
    children_right = []
    feature_arr    = []
    threshold_arr  = []
    value_arr      = []

    def visit(node):
        idx = len(children_left)
        children_left.append(-1)
        children_right.append(-1)
        feature_arr.append(-2)
        threshold_arr.append(-2.0)
        value_arr.append(0.0)

        if "leaf_value" in node:
            value_arr[idx] = float(node["leaf_value"])
        else:
            feature_arr[idx]   = int(node["split_feature"])
            threshold_arr[idx] = float(node["threshold"])  # LightGBM stores as numeric
            l_idx = visit(node["left_child"])
            children_left[idx]  = l_idx
            r_idx = visit(node["right_child"])
            children_right[idx] = r_idx
        return idx

    visit(tree_struct)
    return {
        "childrenLeft":  children_left,
        "childrenRight": children_right,
        "feature":       feature_arr,
        "threshold":     [round(t, 8) for t in threshold_arr],
        "value":         [round(v, 8) for v in value_arr],
    }


def export_model_lgbm(lgbm_model, pre, feat_names_numeric, model_name,
                      model_metrics, target_type,
                      X_train_transformed, y_train,
                      lookup_tables=None, lookup_global=None,
                      cat_tables=None, cat_global=None, cat_levels=None,
                      large_carat_tail=None, all_rows=None,
                      output_path=None, categorical_features=None):
    """Serialize a fitted LightGBM model to the same JSON schema as export_model().

    Key differences vs ExtraTrees:
      - modelType: 'lgbm'
      - lgbmBaseScore: base score (init_score); prediction = base + sum(tree values)
      - trees: same flat array format (childrenLeft/Right/feature/threshold/value)

    output_path: override write destination (default: S21_MODEL_JSON).
    categorical_features: list used in the ColumnTransformer (default: CATEGORICAL_FEATURES).
        Pass S23_CATEGORICAL_FEATURES when exporting an S23 model.
    """
    from scipy.sparse import issparse
    import numpy as np

    output_path = output_path or S21_MODEL_JSON
    cat_feats   = categorical_features or CATEGORICAL_FEATURES

    booster = lgbm_model.booster_
    dump    = booster.dump_model()

    # Convert trees
    flat_trees = [
        convert_lgbm_tree_to_flat(ti["tree_structure"])
        for ti in dump.get("tree_info", [])
    ]

    # ── Compute base_score empirically ───────────────────────────────────
    # Walk all trees for one sample; base_score = full_pred − tree_sum.
    sample = X_train_transformed[:1]
    sample_dense = sample.toarray() if issparse(sample) else np.array(sample)
    row_vec = sample_dense[0]

    def walk_flat(flat_tree, rv):
        node = 0
        cl   = flat_tree["childrenLeft"]
        while cl[node] != -1:
            feat  = flat_tree["feature"][node]
            thresh = flat_tree["threshold"][node]
            val   = float(rv[feat]) if feat < len(rv) else 0.0
            node  = cl[node] if val <= thresh else flat_tree["childrenRight"][node]
        return flat_tree["value"][node]

    raw_sum    = sum(walk_flat(t, row_vec) for t in flat_trees)
    full_pred  = float(lgbm_model.predict(sample)[0])
    base_score = float(full_pred - raw_sum)

    # ── Encoder / imputer metadata ──────────────────────────────────────
    encoder = pre.named_transformers_["cat"]
    imputer = pre.named_transformers_["num"]
    categories = {
        feature: [str(v) for v in cats]
        for feature, cats in zip(cat_feats, encoder.categories_)
    }
    numeric_medians = {
        feature: round(float(value), 8)
        for feature, value in zip(feat_names_numeric, imputer.statistics_)
    }

    # ── Build hybrid router ──────────────────────────────────────────────
    rows_for_router = all_rows or load_rows()

    out = {
        "generatedDate": str(date.today()),
        "modelName":     model_name,
        "modelType":     "lgbm",
        "lgbmBaseScore": round(base_score, 8),
        "target":        "log((SaleDollorPrice/Carat)/(Lookup_RatePerCt*Large_Carat_Tail_Multiplier))",
        "prediction":    "Lookup_RatePerCt * Large_Carat_Tail_Multiplier * exp(sum(tree_log_preds) + lgbmBaseScore) * Carat",
        "targetType":    target_type,
        "features": {
            "categorical":    cat_feats,
            "numeric":        feat_names_numeric,
            "categories":     categories,
            "numericMedians": numeric_medians,
        },
        "metrics": model_metrics,
        "validation": {
            "split":           "one_holdout_per_bucket",
            "bucketFields":    VALIDATION_BUCKET_FIELDS,
            "selectionMetric": "bucket-balanced MAPE",
        },
        "featureLookups": {
            "lookupTables":    lookup_tables or [],
            "lookupGlobalRate": lookup_global,
            "categoryTables":  cat_tables or {},
            "categoryGlobalRate": cat_global,
            "categoryLevels":  cat_levels or [],
            "monotonic":       True,
        },
        "largeCaratTail": large_carat_tail,
        "hybridRouter":   build_hybrid_anchor_table(rows_for_router),
        "treeCount":      len(flat_trees),
        "trees":          flat_trees,
        "monotone": {
            "clarityRank": CLARITY_RANK,
            "colorRank":   COLOR_RANK,
            "clarityConstraint": -1,
            "colorConstraint":   -1,
            "caratConstraint":   +1,
        },
    }

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(sanitize_for_json(out), f, separators=(",", ":"))
    sz = os.path.getsize(output_path) / 1024 / 1024
    print(f"    → model exported to {output_path}  ({sz:.1f} MB, {len(flat_trees)} trees)")
    return output_path


# ═══════════════════════════════════════════════════════════════════════════
# STRATEGY IMPLEMENTATIONS
# ═══════════════════════════════════════════════════════════════════════════

def strategy_s1_baseline(train, test):
    """S1 — v1 best: log(price) target with engineered features."""
    import numpy as np
    from sklearn.compose import ColumnTransformer
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder
    from sklearn.ensemble import ExtraTreesRegressor

    feats_num = NUMERIC_FEATURES + [
        "Carat_sq", "Carat_cube", "Log_Carat",
        "Dim_Volume", "Dim_Surface", "Table_Depth_Ratio",
    ]
    x_train = as_model_frame_engineered(train)
    x_test = as_model_frame_engineered(test)
    y_train = np.log([r["SaleDollorPrice"] for r in train])

    pre = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=True), CATEGORICAL_FEATURES),
        ("num", SimpleImputer(strategy="median"), feats_num),
    ])
    model = ExtraTreesRegressor(
        n_estimators=100, max_depth=26, min_samples_leaf=1, random_state=42, n_jobs=-1
    )
    pipe = Pipeline([("pre", pre), ("model", model)])
    pipe.fit(x_train, y_train)
    preds = clamp_positive_predictions(np.exp(pipe.predict(x_test)))

    return {
        "name": "S1 — v1 best (log-price, engineered feats)",
        "strategy": "baseline_v1",
        "target_type": "log_price",
        "metrics": metrics([r["SaleDollorPrice"] for r in test], preds),
        "description": "Previous best: log(price) target, 100 trees, depth=26, engineered features",
        "pipe": pipe, "feats_num": feats_num,
    }


def strategy_s2_rate_target(train, test):
    """S2 — Rate-per-carat target: log(price/carat). Core structural fix."""
    import numpy as np
    from sklearn.compose import ColumnTransformer
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder
    from sklearn.ensemble import ExtraTreesRegressor

    x_train = as_model_frame_base(train)
    x_test = as_model_frame_base(test)
    # KEY CHANGE: target is log(price/carat) not log(price)
    y_train = np.log([r["usd_per_ct"] for r in train])

    pre = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=True), CATEGORICAL_FEATURES),
        ("num", SimpleImputer(strategy="median"), NUMERIC_FEATURES),
    ])
    model = ExtraTreesRegressor(
        n_estimators=100, max_depth=26, min_samples_leaf=1, random_state=42, n_jobs=-1
    )
    pipe = Pipeline([("pre", pre), ("model", model)])
    pipe.fit(x_train, y_train)
    # Reconstruct price: exp(log_rate) * carat
    log_rate_preds = pipe.predict(x_test)
    preds = clamp_positive_predictions([
        math.exp(lr) * r["Carat"] for lr, r in zip(log_rate_preds, test)
    ])

    return {
        "name": "S2 — Rate-per-carat target (log(price/carat))",
        "strategy": "rate_target",
        "target_type": "log_rate",
        "metrics": metrics([r["SaleDollorPrice"] for r in test], preds),
        "description": "log(price/carat) target → removes multiplicative carat effect from prediction error",
        "pipe": pipe, "feats_num": NUMERIC_FEATURES,
    }


def strategy_s3_rate_mae(train, test):
    """S3 — Rate target + MAE criterion (median trees, closer to MAPE-optimal)."""
    import numpy as np
    from sklearn.compose import ColumnTransformer
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder
    from sklearn.ensemble import ExtraTreesRegressor

    x_train = as_model_frame_base(train)
    x_test = as_model_frame_base(test)
    y_train = np.log([r["usd_per_ct"] for r in train])

    pre = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=True), CATEGORICAL_FEATURES),
        ("num", SimpleImputer(strategy="median"), NUMERIC_FEATURES),
    ])
    model = ExtraTreesRegressor(
        n_estimators=120,
        max_depth=28,
        min_samples_leaf=1,
        criterion="absolute_error",   # ← median split criterion
        random_state=42,
        n_jobs=-1,
    )
    pipe = Pipeline([("pre", pre), ("model", model)])
    pipe.fit(x_train, y_train)
    log_rate_preds = pipe.predict(x_test)
    preds = clamp_positive_predictions([
        math.exp(lr) * r["Carat"] for lr, r in zip(log_rate_preds, test)
    ])

    return {
        "name": "S3 — Rate target + MAE criterion",
        "strategy": "rate_mae",
        "target_type": "log_rate",
        "metrics": metrics([r["SaleDollorPrice"] for r in test], preds),
        "description": "log(price/carat) + criterion=absolute_error (median splits, MAPE-optimal)",
        "pipe": pipe, "feats_num": NUMERIC_FEATURES,
    }


def strategy_s4_rate_mae_engineered(train, test):
    """S4 — Rate target + MAE criterion + full engineered feature set."""
    import numpy as np
    from sklearn.compose import ColumnTransformer
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder
    from sklearn.ensemble import ExtraTreesRegressor

    feats_num = NUMERIC_FEATURES + [
        "Carat_sq", "Carat_cube", "Log_Carat",
        "Carat_bucket_pos", "Dist_carat_threshold",
        "Dim_Volume", "Dim_Surface", "LW_Ratio_refined", "Table_Depth_Ratio",
    ]
    x_train = as_model_frame_engineered(train)
    x_test = as_model_frame_engineered(test)
    y_train = np.log([r["usd_per_ct"] for r in train])

    pre = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=True), CATEGORICAL_FEATURES),
        ("num", SimpleImputer(strategy="median"), feats_num),
    ])
    model = ExtraTreesRegressor(
        n_estimators=150,
        max_depth=30,
        min_samples_leaf=1,
        criterion="absolute_error",
        random_state=42,
        n_jobs=-1,
    )
    pipe = Pipeline([("pre", pre), ("model", model)])
    pipe.fit(x_train, y_train)
    log_rate_preds = pipe.predict(x_test)
    preds = clamp_positive_predictions([
        math.exp(lr) * r["Carat"] for lr, r in zip(log_rate_preds, test)
    ])

    return {
        "name": "S4 — Rate + MAE + engineered features",
        "strategy": "rate_mae_engineered",
        "target_type": "log_rate",
        "metrics": metrics([r["SaleDollorPrice"] for r in test], preds),
        "description": "log(price/carat) + MAE splits + bucket-position + dimension features, 150 trees",
        "pipe": pipe, "feats_num": feats_num,
    }


def strategy_s5_rate_lookup_feature(train, test):
    """S5 — Rate target + lookup table rate as ML feature."""
    import numpy as np
    from sklearn.compose import ColumnTransformer
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder
    from sklearn.ensemble import ExtraTreesRegressor

    # Build lookup from training data only (no leakage)
    tables, global_rate = build_lookup(train)

    feats_num = NUMERIC_FEATURES + [
        "Log_Carat",
        "Lookup_RatePerCt", "Lookup_IsGlobal", "Log_Lookup_RatePerCt",
    ]

    cat_tables, cat_global, cat_levels = build_category_prior(train)
    x_train = as_model_frame_full(train, tables, global_rate, cat_tables, cat_global, cat_levels)
    x_test = as_model_frame_full(test, tables, global_rate, cat_tables, cat_global, cat_levels)
    y_train = np.log([r["usd_per_ct"] for r in train])

    all_feats_num = NUMERIC_FEATURES + [
        "Carat_sq", "Carat_cube", "Log_Carat",
        "Carat_bucket_pos", "Dist_carat_threshold",
        "Dim_Volume", "Dim_Surface", "Table_Depth_Ratio",
        "Lookup_RatePerCt", "Lookup_IsGlobal", "Log_Lookup_RatePerCt",
        "Category_RatePerCt", "Log_Category_RatePerCt",
    ]

    pre = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=True), CATEGORICAL_FEATURES),
        ("num", SimpleImputer(strategy="median"), all_feats_num),
    ])
    model = ExtraTreesRegressor(
        n_estimators=150,
        max_depth=30,
        min_samples_leaf=1,
        criterion="absolute_error",
        random_state=42,
        n_jobs=-1,
    )
    pipe = Pipeline([("pre", pre), ("model", model)])
    pipe.fit(x_train, y_train)
    log_rate_preds = pipe.predict(x_test)
    preds = clamp_positive_predictions([
        math.exp(lr) * r["Carat"] for lr, r in zip(log_rate_preds, test)
    ])

    return {
        "name": "S5 — Rate + lookup as feature + category prior",
        "strategy": "rate_lookup_feature",
        "target_type": "log_rate",
        "metrics": metrics([r["SaleDollorPrice"] for r in test], preds),
        "description": "log(price/carat) + lookup rate/category prior as features + MAE criterion",
        "pipe": pipe, "feats_num": all_feats_num,
        "_lookup_tables": tables, "_lookup_global": global_rate,
        "_cat_tables": cat_tables, "_cat_global": cat_global, "_cat_levels": cat_levels,
    }


def strategy_s6_rate_category_prior(train, test):
    """S6 — Rate target + category prior only (no lookup table overhead)."""
    import numpy as np
    from sklearn.compose import ColumnTransformer
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder
    from sklearn.ensemble import ExtraTreesRegressor

    cat_tables, cat_global, cat_levels = build_category_prior(train)
    tables, global_rate = build_lookup(train)

    all_feats_num = NUMERIC_FEATURES + [
        "Carat_sq", "Carat_cube", "Log_Carat",
        "Carat_bucket_pos", "Dist_carat_threshold",
        "Dim_Volume", "Dim_Surface", "Table_Depth_Ratio",
        "Category_RatePerCt", "Log_Category_RatePerCt",
    ]

    x_train = as_model_frame_full(train, tables, global_rate, cat_tables, cat_global, cat_levels)
    x_test = as_model_frame_full(test, tables, global_rate, cat_tables, cat_global, cat_levels)
    y_train = np.log([r["usd_per_ct"] for r in train])

    pre = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=True), CATEGORICAL_FEATURES),
        ("num", SimpleImputer(strategy="median"), all_feats_num),
    ])
    model = ExtraTreesRegressor(
        n_estimators=150,
        max_depth=30,
        min_samples_leaf=1,
        criterion="absolute_error",
        random_state=42,
        n_jobs=-1,
    )
    pipe = Pipeline([("pre", pre), ("model", model)])
    pipe.fit(x_train, y_train)
    log_rate_preds = pipe.predict(x_test)
    preds = clamp_positive_predictions([
        math.exp(lr) * r["Carat"] for lr, r in zip(log_rate_preds, test)
    ])

    return {
        "name": "S6 — Rate + category prior feature",
        "strategy": "rate_category_prior",
        "target_type": "log_rate",
        "metrics": metrics([r["SaleDollorPrice"] for r in test], preds),
        "description": "log(price/carat) + per-category median rate as feature + MAE criterion",
        "pipe": pipe, "feats_num": all_feats_num,
        "_cat_tables": cat_tables, "_cat_global": cat_global, "_cat_levels": cat_levels,
    }


def strategy_s7_full_combo(train, test):
    """S7 — Full combination: all features + rate target + MAE + larger forest."""
    import numpy as np
    from sklearn.compose import ColumnTransformer
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder
    from sklearn.ensemble import ExtraTreesRegressor

    tables, global_rate = build_lookup(train)
    cat_tables, cat_global, cat_levels = build_category_prior(train)

    all_feats_num = NUMERIC_FEATURES + [
        "Carat_sq", "Carat_cube", "Log_Carat",
        "Carat_bucket_pos", "Dist_carat_threshold",
        "Dim_Volume", "Dim_Surface", "LW_Ratio_refined", "Table_Depth_Ratio",
        "Lookup_RatePerCt", "Lookup_IsGlobal", "Log_Lookup_RatePerCt",
        "Category_RatePerCt", "Log_Category_RatePerCt",
    ]

    x_train = as_model_frame_full(train, tables, global_rate, cat_tables, cat_global, cat_levels)
    x_test = as_model_frame_full(test, tables, global_rate, cat_tables, cat_global, cat_levels)
    y_train = np.log([r["usd_per_ct"] for r in train])

    pre = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=True), CATEGORICAL_FEATURES),
        ("num", SimpleImputer(strategy="median"), all_feats_num),
    ])
    model = ExtraTreesRegressor(
        n_estimators=200,
        max_depth=None,    # no max depth → fully grown trees
        min_samples_leaf=1,
        criterion="absolute_error",
        max_features="sqrt",   # standard random feature subsampling
        random_state=42,
        n_jobs=-1,
    )
    pipe = Pipeline([("pre", pre), ("model", model)])
    pipe.fit(x_train, y_train)
    log_rate_preds = pipe.predict(x_test)
    preds = clamp_positive_predictions([
        math.exp(lr) * r["Carat"] for lr, r in zip(log_rate_preds, test)
    ])

    return {
        "name": "S7 — Full combo (rate + MAE + all features + 200 trees)",
        "strategy": "full_combo",
        "target_type": "log_rate",
        "metrics": metrics([r["SaleDollorPrice"] for r in test], preds),
        "description": "All innovations: rate target, MAE splits, lookup+category priors, depth=None, 200 trees",
        "pipe": pipe, "feats_num": all_feats_num,
        "_lookup_tables": tables, "_lookup_global": global_rate,
        "_cat_tables": cat_tables, "_cat_global": cat_global, "_cat_levels": cat_levels,
    }


def strategy_s8_lgb_quantile(train, test):
    """S8 — LightGBM with quantile (median) objective → directly minimizes MAE in log space."""
    try:
        import numpy as np
        from sklearn.compose import ColumnTransformer
        from sklearn.impute import SimpleImputer
        from sklearn.pipeline import Pipeline
        from sklearn.preprocessing import OneHotEncoder
        from lightgbm import LGBMRegressor

        feats_num = NUMERIC_FEATURES + [
            "Carat_sq", "Carat_cube", "Log_Carat",
            "Carat_bucket_pos", "Dist_carat_threshold",
            "Dim_Volume", "Dim_Surface", "Table_Depth_Ratio",
        ]
        x_train = as_model_frame_engineered(train)
        x_test = as_model_frame_engineered(test)
        y_train = np.log([r["usd_per_ct"] for r in train])

        pre = ColumnTransformer([
            ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=True), CATEGORICAL_FEATURES),
            ("num", SimpleImputer(strategy="median"), feats_num),
        ])
        # quantile regression at 0.5 = median regression = MAE minimization
        model = LGBMRegressor(
            n_estimators=800,
            learning_rate=0.02,
            num_leaves=80,
            max_depth=10,
            subsample=0.85,
            colsample_bytree=0.85,
            objective="quantile",
            alpha=0.5,   # median
            random_state=42,
            verbose=-1,
        )
        pipe = Pipeline([("pre", pre), ("model", model)])
        pipe.fit(x_train, y_train)
        log_rate_preds = pipe.predict(x_test)
        preds = clamp_positive_predictions([
            math.exp(lr) * r["Carat"] for lr, r in zip(log_rate_preds, test)
        ])

        return {
            "name": "S8 — LightGBM quantile(0.5) rate target",
            "strategy": "lgb_quantile_rate",
            "target_type": "log_rate",
            "metrics": metrics([r["SaleDollorPrice"] for r in test], preds),
            "description": "LightGBM quantile=0.5 on log(price/carat) → median regression, MAPE-optimal",
        }
    except ImportError:
        return None


def strategy_s9_rate_mse_large(train, test):
    """S9 — Rate target, MSE criterion (default), very large forest for comparison."""
    import numpy as np
    from sklearn.compose import ColumnTransformer
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder
    from sklearn.ensemble import ExtraTreesRegressor

    tables, global_rate = build_lookup(train)
    cat_tables, cat_global, cat_levels = build_category_prior(train)

    all_feats_num = NUMERIC_FEATURES + [
        "Carat_sq", "Carat_cube", "Log_Carat",
        "Carat_bucket_pos", "Dist_carat_threshold",
        "Dim_Volume", "Dim_Surface", "LW_Ratio_refined", "Table_Depth_Ratio",
        "Lookup_RatePerCt", "Lookup_IsGlobal", "Log_Lookup_RatePerCt",
        "Category_RatePerCt", "Log_Category_RatePerCt",
    ]

    x_train = as_model_frame_full(train, tables, global_rate, cat_tables, cat_global, cat_levels)
    x_test = as_model_frame_full(test, tables, global_rate, cat_tables, cat_global, cat_levels)
    y_train = np.log([r["usd_per_ct"] for r in train])

    pre = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=True), CATEGORICAL_FEATURES),
        ("num", SimpleImputer(strategy="median"), all_feats_num),
    ])
    model = ExtraTreesRegressor(
        n_estimators=200,
        max_depth=None,
        min_samples_leaf=1,
        criterion="squared_error",   # default MSE
        max_features="sqrt",
        random_state=42,
        n_jobs=-1,
    )
    pipe = Pipeline([("pre", pre), ("model", model)])
    pipe.fit(x_train, y_train)
    log_rate_preds = pipe.predict(x_test)
    preds = clamp_positive_predictions([
        math.exp(lr) * r["Carat"] for lr, r in zip(log_rate_preds, test)
    ])

    return {
        "name": "S9 — Rate + MSE + all features (ablation of MAE vs MSE)",
        "strategy": "rate_mse_full",
        "target_type": "log_rate",
        "metrics": metrics([r["SaleDollorPrice"] for r in test], preds),
        "description": "Same as S7 but MSE criterion instead of MAE — ablation study",
        "pipe": pipe, "feats_num": all_feats_num,
        "_lookup_tables": tables, "_lookup_global": global_rate,
        "_cat_tables": cat_tables, "_cat_global": cat_global, "_cat_levels": cat_levels,
    }


def strategy_s10_enriched_rate_mae(train, test):
    """S10 — Rate target + MAE criterion + IGI enriched shapes + new IGI flags.
    
    This is S3 but trained on enriched data with IGI shapes and IGI enrichment flags.
    Expected to beat S3 due to better shape categories and additional IGI signals.
    """
    import numpy as np
    from sklearn.compose import ColumnTransformer
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder
    from sklearn.ensemble import ExtraTreesRegressor
    import pandas as pd

    # Create base feature frames
    x_train = as_model_frame_base(train)
    x_test = as_model_frame_base(test)
    
    # Add IGI enrichment flags
    for flag in NUMERIC_FEATURES_IGI_ENRICHMENT:
        x_train[flag] = [row.get(flag, 0.0) for row in train]
        x_test[flag] = [row.get(flag, 0.0) for row in test]
    
    # Add numeric features to be used
    feats_num = NUMERIC_FEATURES + NUMERIC_FEATURES_IGI_ENRICHMENT
    y_train = np.log([r["usd_per_ct"] for r in train])

    pre = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=True), CATEGORICAL_FEATURES),
        ("num", SimpleImputer(strategy="median"), feats_num),
    ])
    model = ExtraTreesRegressor(
        n_estimators=150,
        max_depth=30,
        min_samples_leaf=1,
        criterion="absolute_error",
        random_state=42,
        n_jobs=-1,
    )
    pipe = Pipeline([("pre", pre), ("model", model)])
    pipe.fit(x_train, y_train)
    log_rate_preds = pipe.predict(x_test)
    preds = clamp_positive_predictions([
        math.exp(lr) * r["Carat"] for lr, r in zip(log_rate_preds, test)
    ])

    return {
        "name": "S10 — Enriched rate + MAE (IGI shapes + flags)",
        "strategy": "enriched_rate_mae",
        "target_type": "log_rate",
        "metrics": metrics([r["SaleDollorPrice"] for r in test], preds),
        "description": "S3 strategy (rate target + MAE) but trained on enriched data with IGI shapes and IGI enrichment flags",
        "pipe": pipe, "feats_num": feats_num,
    }



def strategy_s11_temporal_cutoff(train, test, all_rows=None):
    """S11 — S3 strategy but trained ONLY on recent data (temporal split).

    Uses the same model architecture as S3 (best at 4.05%), but applied to
    a temporally-sorted train/test split where training uses only the most
    recent 70% of data. If temporal rate-card shifts are the main error
    source, this should significantly outperform S3.
    """
    import numpy as np
    from sklearn.compose import ColumnTransformer
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder
    from sklearn.ensemble import ExtraTreesRegressor

    train = recent_training_subset(train, all_rows)

    x_train = as_model_frame_base(train)
    x_test = as_model_frame_base(test)
    y_train = np.log([r["usd_per_ct"] for r in train])

    pre = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=True), CATEGORICAL_FEATURES),
        ("num", SimpleImputer(strategy="median"), NUMERIC_FEATURES),
    ])
    model = ExtraTreesRegressor(
        n_estimators=120,
        max_depth=28,
        min_samples_leaf=1,
        criterion="absolute_error",
        random_state=42,
        n_jobs=-1,
    )
    pipe = Pipeline([("pre", pre), ("model", model)])
    pipe.fit(x_train, y_train)
    log_rate_preds = pipe.predict(x_test)
    preds = clamp_positive_predictions([
        math.exp(lr) * r["Carat"] for lr, r in zip(log_rate_preds, test)
    ])

    return {
        "name": "S11 — Temporal cutoff (S3 on recent 70% data)",
        "strategy": "temporal_cutoff",
        "target_type": "log_rate",
        "metrics": metrics([r["SaleDollorPrice"] for r in test], preds),
        "description": "Same as S3 but trained only on most recent 70% of data and evaluated on the shared balanced holdout",
        "pipe": pipe, "feats_num": NUMERIC_FEATURES,
    }


def strategy_s12_fine_lookup_consensus(train, test):
    """S12 — Fine lookup consensus at 0.01ct resolution with Cut included. No ML.

    Tests the hypothesis that StarGem uses a deterministic lookup table.
    If true, this direct lookup reconstruction should approach the theoretical
    minimum MAPE — limited only by within-cell variance from Polish/Symmetry/
    measurements and temporal effects.
    """
    tables, global_rate = build_fine_lookup(train)

    # Add 0.01ct bucket to test rows
    for r in test:
        r["carat_0_01_bucket"] = carat_0_01_bucket(r["Carat"])

    preds = []
    levels = []
    for r in test:
        rate, level, count = fine_lookup_predict_rate(r, tables, global_rate)
        preds.append(rate * r["Carat"])
        levels.append(level)

    level_counts = {}
    for l in levels:
        level_counts[l] = level_counts.get(l, 0) + 1

    return {
        "name": "S12 — Fine lookup (0.01ct + Cut, no ML)",
        "strategy": "fine_lookup_consensus",
        "target_type": "lookup",
        "metrics": metrics([r["SaleDollorPrice"] for r in test], preds),
        "description": f"Direct lookup at 0.01ct×Cut resolution. Fallback distribution: {level_counts}",
        "_level_counts": level_counts,
    }


def strategy_s13_two_stage_residual(train, test):
    """S13 — Two-stage: fine lookup consensus + ML on residual.

    Stage 1: Fine lookup (S12) captures the step-function pricing structure.
    Stage 2: ExtraTrees on residual (actual - lookup) using Polish, Symmetry,
             table%, depth%, L/W ratio, fluorescence — the continuous features
             that the lookup table doesn't capture.
    """
    import numpy as np
    from sklearn.compose import ColumnTransformer
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder
    from sklearn.ensemble import ExtraTreesRegressor
    import pandas as pd

    tables, global_rate = build_fine_lookup(train)

    # Stage 1: Lookup predictions
    for r in train:
        r["carat_0_01_bucket"] = carat_0_01_bucket(r["Carat"])
    for r in test:
        r["carat_0_01_bucket"] = carat_0_01_bucket(r["Carat"])

    train_lookup_preds = []
    test_lookup_preds = []
    for r in train:
        rate, _, _ = fine_lookup_predict_rate(r, tables, global_rate)
        train_lookup_preds.append(rate * r["Carat"])
    for r in test:
        rate, _, _ = fine_lookup_predict_rate(r, tables, global_rate)
        test_lookup_preds.append(rate * r["Carat"])

    # Compute residuals (in log-rate space)
    train_residuals = np.log([r["usd_per_ct"] for r in train])
    train_lookup_log_rates = np.log([lp / r["Carat"] for lp, r in zip(train_lookup_preds, train)])

    # Stage 2: ML model on residuals using secondary features
    residual_features = [
        "Polish", "Symmetry", "Fluorescence", "Table_Scale", "Depth_Scale",
        "Length", "Width", "Height", "LengthWidthRatio",
    ]
    residual_numeric = [
        "Table_Scale", "Depth_Scale", "Length", "Width", "Height", "LengthWidthRatio",
    ]
    residual_cat = ["Polish", "Symmetry", "Fluorescence"]

    # Build feature frames for residual model
    x_train_res = pd.DataFrame()
    x_test_res = pd.DataFrame()
    for col in residual_cat:
        x_train_res[col] = [norm_cat(r.get(col)) for r in train]
        x_test_res[col] = [norm_cat(r.get(col)) for r in test]
    for col in residual_numeric:
        x_train_res[col] = [r.get(col) for r in train]
        x_test_res[col] = [r.get(col) for r in test]

    # Add magic threshold features and carat bucket position
    for col in ["Carat_sq", "Carat_cube", "Log_Carat", "Carat_bucket_pos", "Dist_carat_threshold"]:
        if col == "Carat_sq":
            x_train_res[col] = [r["Carat"] ** 2 for r in train]
            x_test_res[col] = [r["Carat"] ** 2 for r in test]
        elif col == "Carat_cube":
            x_train_res[col] = [r["Carat"] ** 3 for r in train]
            x_test_res[col] = [r["Carat"] ** 3 for r in test]
        elif col == "Log_Carat":
            x_train_res[col] = [math.log(r["Carat"]) for r in train]
            x_test_res[col] = [math.log(r["Carat"]) for r in test]
        elif col == "Carat_bucket_pos":
            x_train_res[col] = [carat_bucket_position(r["Carat"]) for r in train]
            x_test_res[col] = [carat_bucket_position(r["Carat"]) for r in test]
        elif col == "Dist_carat_threshold":
            x_train_res[col] = [abs(r["Carat"] - round(r["Carat"] * 2) / 2) for r in train]
            x_test_res[col] = [abs(r["Carat"] - round(r["Carat"] * 2) / 2) for r in test]
        residual_numeric = residual_numeric + [col]

    # Add magic threshold features
    for r in train:
        mt = magic_threshold_features(r["Carat"])
        for k, v in mt.items():
            r["_mt_" + k] = v
    for r in test:
        mt = magic_threshold_features(r["Carat"])
        for k, v in mt.items():
            r["_mt_" + k] = v

    mt_keys = ["dist_to_magic", "inv_dist_to_magic", "log1p_dist_to_magic",
               "dist_to_magic_above", "magic_number"]
    for k in mt_keys:
        x_train_res["mt_" + k] = [r.get("_mt_" + k, 0) for r in train]
        x_test_res["mt_" + k] = [r.get("_mt_" + k, 0) for r in test]
        residual_numeric.append("mt_" + k)

    y_train_res = train_residuals - train_lookup_log_rates

    pre = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=True), residual_cat),
        ("num", SimpleImputer(strategy="median"), residual_numeric),
    ])
    model = ExtraTreesRegressor(
        n_estimators=80,
        max_depth=20,
        min_samples_leaf=1,
        criterion="absolute_error",
        random_state=42,
        n_jobs=-1,
    )
    pipe = Pipeline([("pre", pre), ("model", model)])
    pipe.fit(x_train_res, y_train_res)

    # Final prediction: lookup × exp(residual_correction)
    residual_preds = pipe.predict(x_test_res)
    preds = clamp_positive_predictions([
        lp * math.exp(rp) for lp, rp in zip(test_lookup_preds, residual_preds)
    ])

    return {
        "name": "S13 — Two-stage (lookup + ML residual)",
        "strategy": "two_stage_residual",
        "target_type": "two_stage",
        "metrics": metrics([r["SaleDollorPrice"] for r in test], preds),
        "description": "Stage1: fine lookup consensus. Stage2: ExtraTrees on residual using Polish/Sym/measurements/magic features",
    }


def strategy_s14_cut_specific(train, test):
    """S14 — Cut-specific ExtraTrees models.

    EX and ID cut diamonds have fundamentally different pricing curves.
    A single model has to split on Cut to learn these, which wastes tree
    capacity. Training separate models per Cut grade lets each specialize.
    """
    import numpy as np
    from sklearn.compose import ColumnTransformer
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder
    from sklearn.ensemble import ExtraTreesRegressor

    cut_grades = sorted(set(r["Cut"] for r in train if r["Cut"] != "-"))
    models = {}
    feats_num = NUMERIC_FEATURES + [
        "Carat_sq", "Carat_cube", "Log_Carat",
        "Carat_bucket_pos", "Dist_carat_threshold",
    ]

    # Add magic threshold features to all rows
    for r in train:
        mt = magic_threshold_features(r["Carat"])
        for k, v in mt.items():
            r["_mt_" + k] = v
        r["Carat_sq"] = r["Carat"] ** 2
        r["Carat_cube"] = r["Carat"] ** 3
        r["Log_Carat"] = math.log(r["Carat"])
        r["Carat_bucket_pos"] = carat_bucket_position(r["Carat"])
        r["Dist_carat_threshold"] = abs(r["Carat"] - round(r["Carat"] * 2) / 2)
    for r in test:
        mt = magic_threshold_features(r["Carat"])
        for k, v in mt.items():
            r["_mt_" + k] = v
        r["Carat_sq"] = r["Carat"] ** 2
        r["Carat_cube"] = r["Carat"] ** 3
        r["Log_Carat"] = math.log(r["Carat"])
        r["Carat_bucket_pos"] = carat_bucket_position(r["Carat"])
        r["Dist_carat_threshold"] = abs(r["Carat"] - round(r["Carat"] * 2) / 2)

    mt_keys = ["dist_to_magic", "inv_dist_to_magic", "log1p_dist_to_magic",
               "dist_to_magic_above", "magic_number"]
    all_feats = feats_num + ["mt_" + k for k in mt_keys]

    preds = [None] * len(test)

    for cut in cut_grades:
        train_cut = [r for r in train if r["Cut"] == cut]
        test_cut_idx = [i for i, r in enumerate(test) if r["Cut"] == cut]
        if len(train_cut) < 50 or not test_cut_idx:
            continue

        x_train = as_model_frame_engineered(train_cut)
        x_test = as_model_frame_engineered([test[i] for i in test_cut_idx])
        # Add magic features
        for k in mt_keys:
            x_train["mt_" + k] = [r["_mt_" + k] for r in train_cut]
            x_test["mt_" + k] = [r["_mt_" + k] for r in [test[i] for i in test_cut_idx]]

        y_train = np.log([r["usd_per_ct"] for r in train_cut])

        pre = ColumnTransformer([
            ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=True), CATEGORICAL_FEATURES),
            ("num", SimpleImputer(strategy="median"), all_feats),
        ])
        model = ExtraTreesRegressor(
            n_estimators=80,
            max_depth=24,
            min_samples_leaf=1,
            criterion="absolute_error",
            random_state=42,
            n_jobs=-1,
        )
        pipe = Pipeline([("pre", pre), ("model", model)])
        pipe.fit(x_train, y_train)
        log_rate_preds = pipe.predict(x_test)
        for i, lr in zip(test_cut_idx, log_rate_preds):
            preds[i] = math.exp(lr) * test[i]["Carat"]

    # Fallback for any unpredicted rows using S3 approach
    fallback_idx = [i for i, p in enumerate(preds) if p is None]
    if fallback_idx:
        fallback_test = [test[i] for i in fallback_idx]
        s3_result = strategy_s3_rate_mae(train, fallback_test)
        # S3 returns a dict, we need to compute predictions ourselves
        import pandas as pd
        x_fb = as_model_frame_base(fallback_test)
        # Use a quick simple model
        x_fb_train = as_model_frame_base(train)
        y_fb_train = np.log([r["usd_per_ct"] for r in train])
        pre_fb = ColumnTransformer([
            ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=True), CATEGORICAL_FEATURES),
            ("num", SimpleImputer(strategy="median"), NUMERIC_FEATURES),
        ])
        model_fb = ExtraTreesRegressor(
            n_estimators=60, max_depth=20, min_samples_leaf=1,
            criterion="absolute_error", random_state=42, n_jobs=-1,
        )
        pipe_fb = Pipeline([("pre", pre_fb), ("model", model_fb)])
        pipe_fb.fit(x_fb_train, y_fb_train)
        fb_preds = clamp_positive_predictions([
            math.exp(lr) * r["Carat"] for lr, r in zip(pipe_fb.predict(x_fb), fallback_test)
        ])
        for i, p in zip(fallback_idx, fb_preds):
            preds[i] = p

    return {
        "name": "S14 — Cut-specific models + magic features",
        "strategy": "cut_specific",
        "target_type": "log_rate",
        "metrics": metrics([r["SaleDollorPrice"] for r in test], preds),
        "description": f"Separate ExtraTrees per Cut grade ({', '.join(cut_grades)}) with magic threshold features",
    }


def strategy_s15_magic_thresholds(train, test):
    """S15 — S3 + magic threshold proximity features.

    Adds 1/(carat - lower_magic + eps), log(1 + dist), and magic number
    indicator features to capture the non-linear premium decay near round
    carat thresholds (0.50, 1.00, 1.50, 2.00, 3.00, etc.).
    """
    import numpy as np
    from sklearn.compose import ColumnTransformer
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder
    from sklearn.ensemble import ExtraTreesRegressor
    import pandas as pd

    feats_num = NUMERIC_FEATURES + [
        "dist_to_magic", "inv_dist_to_magic", "log1p_dist_to_magic",
        "dist_to_magic_above", "magic_number",
    ]

    x_train = as_model_frame_base(train)
    x_test = as_model_frame_base(test)

    # Add magic threshold features
    for r in train:
        mt = magic_threshold_features(r["Carat"])
        for k, v in mt.items():
            r["_mt_" + k] = v
    for r in test:
        mt = magic_threshold_features(r["Carat"])
        for k, v in mt.items():
            r["_mt_" + k] = v

    for k in ["dist_to_magic", "inv_dist_to_magic", "log1p_dist_to_magic",
              "dist_to_magic_above", "magic_number"]:
        x_train[k] = [r.get("_mt_" + k, 0) for r in train]
        x_test[k] = [r.get("_mt_" + k, 0) for r in test]

    y_train = np.log([r["usd_per_ct"] for r in train])

    pre = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=True), CATEGORICAL_FEATURES),
        ("num", SimpleImputer(strategy="median"), feats_num),
    ])
    model = ExtraTreesRegressor(
        n_estimators=150,
        max_depth=30,
        min_samples_leaf=1,
        criterion="absolute_error",
        random_state=42,
        n_jobs=-1,
    )
    pipe = Pipeline([("pre", pre), ("model", model)])
    pipe.fit(x_train, y_train)
    log_rate_preds = pipe.predict(x_test)
    preds = clamp_positive_predictions([
        math.exp(lr) * r["Carat"] for lr, r in zip(log_rate_preds, test)
    ])

    return {
        "name": "S15 — S3 + magic threshold features",
        "strategy": "magic_thresholds",
        "target_type": "log_rate",
        "metrics": metrics([r["SaleDollorPrice"] for r in test], preds),
        "description": "S3 base + 1/(carat-magic+eps), log(1+dist), magic_number features to capture premium decay",
        "pipe": pipe, "feats_num": feats_num,
    }


def strategy_s16_cut_carat_interactions(train, test):
    """S16 — S3 + Cut×carat_bucket + Cut×Color×Clarity interaction features.

    Cut is a major price differentiator ($171/ct vs $120/ct for same specs).
    Creating explicit interaction features lets trees split on them directly
    rather than discovering the interaction through multiple splits.
    """
    import numpy as np
    from sklearn.compose import ColumnTransformer
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder
    from sklearn.ensemble import ExtraTreesRegressor
    import pandas as pd

    # Extended categorical features with interactions
    extended_cat = CATEGORICAL_FEATURES + ["Cut_CaratBucket", "Cut_Color_Clarity"]

    x_train = as_model_frame_base(train)
    x_test = as_model_frame_base(test)

    # Add interaction features
    for df, rows in [(x_train, train), (x_test, test)]:
        df["Cut_CaratBucket"] = [
            norm_cat(r["Cut"]) + "_" + r["carat_bucket"] for r in rows
        ]
        df["Cut_Color_Clarity"] = [
            norm_cat(r["Cut"]) + "_" + norm_cat(r["Color"]) + "_" + norm_cat(r["Clarity"])
            for r in rows
        ]

    y_train = np.log([r["usd_per_ct"] for r in train])

    pre = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=True), extended_cat),
        ("num", SimpleImputer(strategy="median"), NUMERIC_FEATURES),
    ])
    model = ExtraTreesRegressor(
        n_estimators=150,
        max_depth=30,
        min_samples_leaf=1,
        criterion="absolute_error",
        random_state=42,
        n_jobs=-1,
    )
    pipe = Pipeline([("pre", pre), ("model", model)])
    pipe.fit(x_train, y_train)
    log_rate_preds = pipe.predict(x_test)
    preds = clamp_positive_predictions([
        math.exp(lr) * r["Carat"] for lr, r in zip(log_rate_preds, test)
    ])

    return {
        "name": "S16 — S3 + Cut×Carat + Cut×Color×Clarity interactions",
        "strategy": "cut_carat_interactions",
        "target_type": "log_rate",
        "metrics": metrics([r["SaleDollorPrice"] for r in test], preds),
        "description": "Explicit Cut×carat_bucket and Cut×Color×Clarity interaction features on top of S3",
    }


def strategy_s17_full_combo_v2(train, test, all_rows=None):
    """S17 — Full combo v2: temporal cutoff + fine lookup + magic features + Cut interactions.

    All structural fixes combined:
    1. Temporal split (train on recent data only)
    2. Fine lookup rate and category prior as features
    3. Magic threshold proximity features
    4. Cut interaction features
    5. ExtraTrees with MAE criterion
    """
    import numpy as np
    from sklearn.compose import ColumnTransformer
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder
    from sklearn.ensemble import ExtraTreesRegressor
    import pandas as pd

    train = recent_training_subset(train, all_rows)

    # Build fine lookup from training data
    tables, global_rate = build_fine_lookup(train)
    cat_tables, cat_global, cat_levels = build_category_prior(train)

    # Add features to rows
    for r in train:
        r["carat_0_01_bucket"] = carat_0_01_bucket(r["Carat"])
        mt = magic_threshold_features(r["Carat"])
        for k, v in mt.items():
            r["_mt_" + k] = v
    for r in test:
        r["carat_0_01_bucket"] = carat_0_01_bucket(r["Carat"])
        mt = magic_threshold_features(r["Carat"])
        for k, v in mt.items():
            r["_mt_" + k] = v

    # Build feature frame
    extended_cat = CATEGORICAL_FEATURES + ["Cut_CaratBucket"]

    x_train = pd.DataFrame()
    x_test = pd.DataFrame()
    for col in extended_cat:
        if col == "Cut_CaratBucket":
            x_train[col] = [norm_cat(r["Cut"]) + "_" + r["carat_bucket"] for r in train]
            x_test[col] = [norm_cat(r["Cut"]) + "_" + r["carat_bucket"] for r in test]
        else:
            x_train[col] = [norm_cat(r.get(col)) for r in train]
            x_test[col] = [norm_cat(r.get(col)) for r in test]

    # Numeric features
    feats_num = list(NUMERIC_FEATURES) + [
        "Carat_sq", "Carat_cube", "Log_Carat",
        "Carat_bucket_pos", "Dist_carat_threshold",
        "dist_to_magic", "inv_dist_to_magic", "log1p_dist_to_magic",
        "dist_to_magic_above", "magic_number",
        "Lookup_RatePerCt", "Lookup_IsGlobal",
        "Category_RatePerCt",
    ]

    # Add numeric features
    for df, rows in [(x_train, train), (x_test, test)]:
        # Base numeric features
        for col in NUMERIC_FEATURES:
            df[col] = [r.get(col) for r in rows]
        for r_idx, r in enumerate(rows):
            c = r["Carat"]
            df.at[r_idx, "Carat_sq"] = c ** 2
            df.at[r_idx, "Carat_cube"] = c ** 3
            df.at[r_idx, "Log_Carat"] = math.log(c) if c > 0 else 0
            df.at[r_idx, "Carat_bucket_pos"] = carat_bucket_position(c)
            df.at[r_idx, "Dist_carat_threshold"] = abs(c - round(c * 2) / 2)
            df.at[r_idx, "dist_to_magic"] = r.get("_mt_dist_to_magic", 0)
            df.at[r_idx, "inv_dist_to_magic"] = r.get("_mt_inv_dist_to_magic", 0)
            df.at[r_idx, "log1p_dist_to_magic"] = r.get("_mt_log1p_dist_to_magic", 0)
            df.at[r_idx, "dist_to_magic_above"] = r.get("_mt_dist_to_magic_above", 0)
            df.at[r_idx, "magic_number"] = r.get("_mt_magic_number", 0)
            lookup_rate, lookup_level, _ = fine_lookup_predict_rate(r, tables, global_rate)
            df.at[r_idx, "Lookup_RatePerCt"] = lookup_rate
            df.at[r_idx, "Lookup_IsGlobal"] = 1.0 if lookup_level == "GLOBAL" else 0.0
            cat_rate = category_prior_rate(r, cat_tables, cat_global, cat_levels)
            df.at[r_idx, "Category_RatePerCt"] = cat_rate

    # Ensure numeric columns
    for col in feats_num:
        x_train[col] = [float(v) if v is not None else 0.0 for v in x_train[col]]
        x_test[col] = [float(v) if v is not None else 0.0 for v in x_test[col]]

    y_train = np.log([r["usd_per_ct"] for r in train])

    pre = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=True), extended_cat),
        ("num", SimpleImputer(strategy="median"), feats_num),
    ])
    model = ExtraTreesRegressor(
        n_estimators=200,
        max_depth=None,
        min_samples_leaf=1,
        criterion="absolute_error",
        max_features="sqrt",
        random_state=42,
        n_jobs=-1,
    )
    pipe = Pipeline([("pre", pre), ("model", model)])
    pipe.fit(x_train, y_train)
    log_rate_preds = pipe.predict(x_test)
    preds = clamp_positive_predictions([
        math.exp(lr) * r["Carat"] for lr, r in zip(log_rate_preds, test)
    ])

    return {
        "name": "S17 — Full combo v2 (temporal + lookup + magic + Cut interactions)",
        "strategy": "full_combo_v2",
        "target_type": "log_rate",
        "metrics": metrics([r["SaleDollorPrice"] for r in test], preds),
        "description": "All structural fixes: recent-only training, shared balanced holdout, fine lookup, magic thresholds, Cut interactions",
        "pipe": pipe, "feats_num": feats_num,
        "_lookup_tables": tables, "_lookup_global": global_rate,
        "_cat_tables": cat_tables, "_cat_global": cat_global, "_cat_levels": cat_levels,
    }


def strategy_s18_temporal_shallow(train, test, all_rows=None):
    """S18 — S11 temporal window with shallower trees.

    The S11 follow-up sweep showed that the recent 70% window is still the
    right data slice, but max_depth=28 overfits small within-window rate noise.
    A shallower depth of 24 improves the same recent holdout while keeping the
    base feature set browser-compatible.
    """
    import numpy as np
    from sklearn.compose import ColumnTransformer
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder
    from sklearn.ensemble import ExtraTreesRegressor

    train = recent_training_subset(train, all_rows)

    x_train = as_model_frame_base(train)
    x_test = as_model_frame_base(test)
    y_train = np.log([r["usd_per_ct"] for r in train])

    pre = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=True), CATEGORICAL_FEATURES),
        ("num", SimpleImputer(strategy="median"), NUMERIC_FEATURES),
    ])
    model = ExtraTreesRegressor(
        n_estimators=200,
        max_depth=24,
        min_samples_leaf=1,
        criterion="absolute_error",
        random_state=42,
        n_jobs=-1,
    )
    pipe = Pipeline([("pre", pre), ("model", model)])
    pipe.fit(x_train, y_train)
    log_rate_preds = pipe.predict(x_test)
    preds = clamp_positive_predictions([
        math.exp(lr) * r["Carat"] for lr, r in zip(log_rate_preds, test)
    ])

    return {
        "name": "S18 — Temporal cutoff, shallower trees",
        "strategy": "temporal_cutoff_shallow",
        "target_type": "log_rate",
        "metrics": metrics([r["SaleDollorPrice"] for r in test], preds),
        "description": "S11 recent 70% training window with shared balanced holdout, base features, 200 trees, max_depth=24",
        "pipe": pipe, "feats_num": NUMERIC_FEATURES,
    }


def strategy_s19_lookup_residual_selected_spec(train, test, all_rows=None):
    """S19 — Coarse lookup residual model with selected-spec augmentation.

    The browser often predicts before IGI dimensions/growth method are loaded.
    This strategy trains that inference mode directly: duplicated training rows
    include a selected-spec view with dimensions and TypeName masked. The model
    predicts only the residual multiplier around the coarse StarGem lookup rate,
    which keeps dense commodity cells locally calibrated while preserving an ML
    estimate.
    """
    import numpy as np
    from sklearn.compose import ColumnTransformer
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder
    from sklearn.ensemble import ExtraTreesRegressor

    tables, global_rate = build_lookup(train)
    cat_tables, cat_global, cat_levels = build_category_prior(train)

    augmented_train = s19_augmented_training_rows(train)
    cert_test = [cert_loaded_view(row) for row in test]
    selected_test = [selected_spec_view(row, mask_cut=False) for row in test]

    feats_num = NUMERIC_FEATURES + SELECTED_SPEC_FLAGS + [
        "Carat_sq", "Carat_cube", "Log_Carat",
        "Carat_bucket_pos", "Dist_carat_threshold",
        "Dim_Volume", "Dim_Surface", "LW_Ratio_refined", "Table_Depth_Ratio",
        "Lookup_RatePerCt", "Lookup_IsGlobal", "Lookup_Count", "Log_Lookup_Count",
        "Log_Lookup_RatePerCt", "Category_RatePerCt", "Log_Category_RatePerCt",
    ]

    x_train = as_model_frame_s19(augmented_train, tables, global_rate, cat_tables, cat_global, cat_levels)
    y_train = []
    for row in augmented_train:
        lookup_rate, _, _ = lookup_predict_rate(row, tables, global_rate)
        y_train.append(math.log(max(row["usd_per_ct"], 0.01) / max(lookup_rate, 0.01)))

    pre = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=True), CATEGORICAL_FEATURES),
        ("num", SimpleImputer(strategy="median"), feats_num),
    ])
    model = ExtraTreesRegressor(
        n_estimators=96,
        max_depth=20,
        min_samples_leaf=2,
        criterion="absolute_error",
        max_features="sqrt",
        random_state=42,
        n_jobs=-1,
    )
    pipe = Pipeline([("pre", pre), ("model", model)])
    pipe.fit(x_train, np.array(y_train))

    selected_preds = s19_predict_prices(pipe, selected_test, tables, global_rate, cat_tables, cat_global, cat_levels)
    cert_preds = s19_predict_prices(pipe, cert_test, tables, global_rate, cat_tables, cat_global, cat_levels)

    pinned = selected_spec_view({
        "Carat": 3.0,
        "carat_bucket": carat_bucket(3.0),
        "Shape": "ROUND",
        "Color": "E",
        "Clarity": "VS1",
        "Cut": "ID",
        "Polish": "EX",
        "Symmetry": "EX",
        "Fluorescence": "-",
        "Report": "IGI",
        "TypeName": "-",
        "SaleDollorPrice": 0,
        "usd_per_ct": 0,
    })
    pinned_price = s19_predict_prices(pipe, [pinned], tables, global_rate, cat_tables, cat_global, cat_levels)[0]
    pinned_lookup_rate, pinned_lookup_level, pinned_lookup_count = lookup_predict_rate(pinned, tables, global_rate)

    selected_metrics = metrics([r["SaleDollorPrice"] for r in test], selected_preds)
    cert_metrics = metrics([r["SaleDollorPrice"] for r in test], cert_preds)

    return {
        "name": "S19 — Lookup residual + selected-spec augmentation",
        "strategy": "lookup_residual_selected_spec",
        "target_type": "log_lookup_residual",
        "metrics": selected_metrics,
        "certLoadedMetrics": cert_metrics,
        "description": "Coarse StarGem lookup residual target with selected-spec missingness augmentation, 96 trees, depth=20",
        "pinnedCases": {
            "3ct_round_e_vs1_id_selected_spec": {
                "price": round(pinned_price, 4),
                "rate": round(pinned_price / 3.0, 4),
                "lookupRate": round(pinned_lookup_rate, 4),
                "lookupLevel": pinned_lookup_level,
                "lookupCount": pinned_lookup_count,
            }
        },
        "pipe": pipe, "feats_num": feats_num,
        "_lookup_tables": tables, "_lookup_global": global_rate,
        "_cat_tables": cat_tables, "_cat_global": cat_global, "_cat_levels": cat_levels,
    }


def metrics_for_subset(rows, preds, predicate):
    actual = []
    predicted = []
    for row, pred in zip(rows, preds):
        if predicate(row):
            actual.append(row["SaleDollorPrice"])
            predicted.append(pred)
    return metrics(actual, predicted)


def strategy_s20_specialty_tail_selected_spec(train, test, all_rows=None):
    """S20 — S19 plus specialty-cut features and monotonic large-carat tail."""
    import numpy as np
    from sklearn.compose import ColumnTransformer
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder
    from sklearn.ensemble import ExtraTreesRegressor

    tables, global_rate = build_lookup(train)
    cat_tables, cat_global, cat_levels = build_category_prior(train)
    tail_model = build_large_carat_tail_model(train, tables, global_rate)

    augmented_train = s19_augmented_training_rows(train)
    cert_test = [cert_loaded_view(row) for row in test]
    selected_test = [selected_spec_view(row, mask_cut=False) for row in test]

    feats_num = NUMERIC_FEATURES + SELECTED_SPEC_FLAGS + [
        "Carat_sq", "Carat_cube", "Log_Carat",
        "Carat_bucket_pos", "Dist_carat_threshold",
        "Dim_Volume", "Dim_Surface", "LW_Ratio_refined", "Table_Depth_Ratio",
        "Lookup_RatePerCt", "Lookup_IsGlobal", "Lookup_Count", "Log_Lookup_Count",
        "Log_Lookup_RatePerCt", "Category_RatePerCt", "Log_Category_RatePerCt",
        "Is_Specialty_Cut", "Is_Traditional_Cut", "Is_IceFlower_Cut",
        "Is_Large_Carat", "Is_10ct_Plus",
        "Large_Carat_Tail_X", "Large_Carat_Tail_X_sq",
        "Tail_Base_Lookup_RatePerCt", "Log_Tail_Base_Lookup_RatePerCt",
        "Tail_Base_Lookup_Count",
        "Large_Carat_Tail_Multiplier", "Log_Large_Carat_Tail_Multiplier",
        "Large_Carat_Tail_Slope", "Large_Carat_Tail_Count",
    ]

    x_train = as_model_frame_s20(augmented_train, tables, global_rate, cat_tables, cat_global, cat_levels, tail_model)
    y_train = []
    for row in augmented_train:
        base_rate, _, _ = lookup_predict_rate(tail_anchor_lookup_row(row), tables, global_rate)
        tail_mult, _, _, _ = large_carat_tail_multiplier(row, tail_model)
        y_train.append(math.log(max(row["usd_per_ct"], 0.01) / max(base_rate * tail_mult, 0.01)))

    pre = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=True), CATEGORICAL_FEATURES),
        ("num", SimpleImputer(strategy="median"), feats_num),
    ])
    model = ExtraTreesRegressor(
        n_estimators=160,
        max_depth=20,
        min_samples_leaf=2,
        criterion="absolute_error",
        max_features="sqrt",
        random_state=42,
        n_jobs=-1,
    )
    pipe = Pipeline([("pre", pre), ("model", model)])
    pipe.fit(x_train, np.array(y_train))

    selected_preds = s20_predict_prices(pipe, selected_test, tables, global_rate, cat_tables, cat_global, cat_levels, tail_model)
    cert_preds = s20_predict_prices(pipe, cert_test, tables, global_rate, cat_tables, cat_global, cat_levels, tail_model)

    pinned_cases = {}
    for ct in (3.0, 8.0, 10.0, 12.0):
        pinned = selected_spec_view({
            "Carat": ct,
            "carat_bucket": carat_bucket(ct),
            "Shape": "ROUND",
            "Color": "E",
            "Clarity": "VS1",
            "Cut": "ID",
            "Polish": "EX",
            "Symmetry": "EX",
            "Fluorescence": "-",
            "Report": "IGI",
            "TypeName": "-",
            "SaleDollorPrice": 0,
            "usd_per_ct": 0,
        })
        price = s20_predict_prices(pipe, [pinned], tables, global_rate, cat_tables, cat_global, cat_levels, tail_model)[0]
        base_rate, base_level, base_count = lookup_predict_rate(tail_anchor_lookup_row(pinned), tables, global_rate)
        tail_mult, tail_level, tail_count, tail_slope = large_carat_tail_multiplier(pinned, tail_model)
        pinned_cases[f"{ct:g}ct_round_e_vs1_id_selected_spec"] = {
            "price": round(price, 4),
            "rate": round(price / ct, 4),
            "tailBaseRate": round(base_rate, 4),
            "tailBaseLevel": base_level,
            "tailBaseCount": base_count,
            "tailMultiplier": round(tail_mult, 6),
            "tailLevel": tail_level,
            "tailCount": tail_count,
            "tailSlope": round(tail_slope, 8),
        }

    selected_metrics = metrics([r["SaleDollorPrice"] for r in test], selected_preds)
    cert_metrics = metrics([r["SaleDollorPrice"] for r in test], cert_preds)
    bucket_metrics = {
        bucket: metrics_for_subset(test, selected_preds, lambda r, b=bucket: r.get("carat_bucket") == b)
        for bucket in sorted({r.get("carat_bucket") for r in test})
    }
    cut_style_metrics = {
        group: metrics_for_subset(test, selected_preds, lambda r, g=group: cut_style_group(r.get("Cut")) == g)
        for group in sorted({cut_style_group(r.get("Cut")) for r in test})
    }

    print(f"\n    Exporting S20 model…", end=" ", flush=True)
    export_model(
        pipe=pipe,
        feature_names_numeric=feats_num,
        model_name="S20 — Specialty cut + monotonic large-carat tail",
        model_metrics=selected_metrics,
        target_type="log_tail_lookup_residual",
        lookup_tables=tables,
        lookup_global=global_rate,
        cat_tables=cat_tables,
        cat_global=cat_global,
        cat_levels=cat_levels,
        large_carat_tail=tail_model,
        output_path=S20_MODEL_JSON,
        all_rows=all_rows,
    )

    return {
        "name": "S20 — Specialty cut + monotonic large-carat tail",
        "strategy": "specialty_cut_tail_selected_spec",
        "target_type": "log_tail_lookup_residual",
        "metrics": selected_metrics,
        "certLoadedMetrics": cert_metrics,
        "segmentMetrics": {
            "byCaratBucket": bucket_metrics,
            "byCutStyle": cut_style_metrics,
            "selectedSpec10ctPlus": metrics_for_subset(test, selected_preds, lambda r: r.get("Carat", 0) >= 10.0),
            "selectedSpec8ctPlus": metrics_for_subset(test, selected_preds, lambda r: r.get("Carat", 0) >= 8.0),
        },
        "description": "S19 residual model plus explicit Chinese specialty-cut features and a monotonic parametric 5ct+ tail, 160 trees, depth=20",
        "pinnedCases": pinned_cases,
        "largeCaratTailSummary": {
            "globalSlope": tail_model.get("globalSlope"),
            "startCarat": tail_model.get("startCarat"),
            "levelCounts": {
                level["level"]: len(level.get("groups", {}))
                for level in tail_model.get("levels", [])
            },
        },
        "pipe": pipe, "feats_num": feats_num,
        "_lookup_tables": tables, "_lookup_global": global_rate,
        "_cat_tables": cat_tables, "_cat_global": cat_global, "_cat_levels": cat_levels,
        "_large_carat_tail": tail_model,
    }


def strategy_s21_monotone_grade_selected_spec(train, test, all_rows=None):
    """S21 — Monotone grade model (four-layer defence).

    Layer 1: Isotonic lookup surface (PAV over clarity/color at Level-E).
    Layer 2: Clarity_Rank + Color_Rank ordinal numeric features.
    Layer 3: LightGBM with monotone_constraints on Carat (+1), Clarity_Rank (−1), Color_Rank (−1).
    Layer 4: PAV projection at inference (predictStarsgemMlMonotone in browser).
    Target: same log_tail_lookup_residual as S20.
    """
    import numpy as np
    import lightgbm as lgb
    from sklearn.compose import ColumnTransformer
    from sklearn.impute import SimpleImputer
    from sklearn.preprocessing import OneHotEncoder

    # ── Layer 1: monotone lookup surface ───────────────────────────────────────
    tables, global_rate = build_monotone_lookup_tables(train)
    cat_tables, cat_global, cat_levels = build_category_prior(train)
    tail_model = build_large_carat_tail_model(train, tables, global_rate)

    augmented_train = s19_augmented_training_rows(train)
    cert_test     = [cert_loaded_view(row) for row in test]
    selected_test = [selected_spec_view(row, mask_cut=False) for row in test]

    # ── Layer 2: feature frame with rank features ─────────────────────────────
    feats_num = NUMERIC_FEATURES + SELECTED_SPEC_FLAGS + [
        "Carat_sq", "Carat_cube", "Log_Carat",
        "Carat_bucket_pos", "Dist_carat_threshold",
        "Dim_Volume", "Dim_Surface", "LW_Ratio_refined", "Table_Depth_Ratio",
        "Lookup_RatePerCt", "Lookup_IsGlobal", "Lookup_Count", "Log_Lookup_Count",
        "Log_Lookup_RatePerCt", "Category_RatePerCt", "Log_Category_RatePerCt",
        "Is_Specialty_Cut", "Is_Traditional_Cut", "Is_IceFlower_Cut",
        "Is_Large_Carat", "Is_10ct_Plus",
        "Large_Carat_Tail_X", "Large_Carat_Tail_X_sq",
        "Tail_Base_Lookup_RatePerCt", "Log_Tail_Base_Lookup_RatePerCt",
        "Tail_Base_Lookup_Count",
        "Large_Carat_Tail_Multiplier", "Log_Large_Carat_Tail_Multiplier",
        "Large_Carat_Tail_Slope", "Large_Carat_Tail_Count",
        "Clarity_Rank",   # ordinal: 0=IF → 6=SI2  (monotone constraint −1)
        "Color_Rank",     # ordinal: 0=D  → 6=J    (monotone constraint −1)
    ]

    x_train_df = as_model_frame_s21(
        augmented_train, tables, global_rate, cat_tables, cat_global, cat_levels, tail_model
    )
    y_train = []
    for row in augmented_train:
        base_rate, _, _ = lookup_predict_rate(tail_anchor_lookup_row(row), tables, global_rate)
        tail_mult, _, _, _ = large_carat_tail_multiplier(row, tail_model)
        y_train.append(math.log(max(row["usd_per_ct"], 0.01) / max(base_rate * tail_mult, 0.01)))
    y_train = np.array(y_train)

    # Fit pre-processor to get feature names
    pre = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=True), CATEGORICAL_FEATURES),
        ("num", SimpleImputer(strategy="median"), feats_num),
    ])
    X_train = pre.fit_transform(x_train_df)

    # ── Layer 3: LightGBM with monotone_constraints ────────────────────────
    feat_names_out = list(pre.get_feature_names_out())

    # Build constraint vector from the monotone-axes registry (source of truth)
    _axes_registry = load_monotone_axes_registry()
    constraints = build_monotone_vector(feat_names_out, "white_diamond", _axes_registry)

    lgbm = lgb.LGBMRegressor(
        n_estimators=400,
        num_leaves=63,
        max_depth=-1,
        learning_rate=0.04,
        min_child_samples=20,
        monotone_constraints=constraints,
        monotone_constraints_method="advanced",
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=42,
        verbose=-1,
        n_jobs=-1,
    )
    lgbm.fit(X_train, y_train, feature_name=feat_names_out)

    # ── Evaluate ───────────────────────────────────────────────────────────
    selected_preds = s21_predict_prices(lgbm, pre, selected_test, tables, global_rate,
                                        cat_tables, cat_global, cat_levels, tail_model)
    cert_preds     = s21_predict_prices(lgbm, pre, cert_test,     tables, global_rate,
                                        cat_tables, cat_global, cat_levels, tail_model)

    # Pinned regression cases
    pinned_cases = {}
    for ct in (3.0, 8.0, 10.0, 12.0):
        pinned = selected_spec_view({
            "Carat": ct, "carat_bucket": carat_bucket(ct),
            "Shape": "ROUND", "Color": "E", "Clarity": "VS1",
            "Cut": "ID", "Polish": "EX", "Symmetry": "EX",
            "Fluorescence": "-", "Report": "IGI", "TypeName": "-",
            "SaleDollorPrice": 0, "usd_per_ct": 0,
        })
        price = s21_predict_prices(lgbm, pre, [pinned], tables, global_rate,
                                   cat_tables, cat_global, cat_levels, tail_model)[0]
        base_rate, base_level, base_count = lookup_predict_rate(tail_anchor_lookup_row(pinned), tables, global_rate)
        tail_mult, tail_level, tail_count, tail_slope = large_carat_tail_multiplier(pinned, tail_model)
        pinned_cases[f"{ct:g}ct_round_e_vs1_id_selected_spec"] = {
            "price": round(price, 4), "rate": round(price / ct, 4),
            "tailBaseRate": round(base_rate, 4), "tailBaseLevel": base_level,
            "tailMultiplier": round(tail_mult, 6),
        }

    # Clarity-ladder pinned cases (the key regression tests for R1–R3)
    clarity_ladder_cases = {}
    for (shape, carat, color, cut) in [
        ("MARQUISE", 4.08, "E", "-"),
        ("HEART", 3.0, "E", "-"),
        ("ROUND", 2.0, "E", "ID"),
    ]:
        ladder = []
        for cl in CLARITY_ORDER_S21:
            row = selected_spec_view({
                "Carat": carat, "carat_bucket": carat_bucket(carat),
                "Shape": shape.upper(), "Color": color, "Clarity": cl,
                "Cut": cut, "Polish": "EX", "Symmetry": "EX",
                "Fluorescence": "-", "Report": "IGI", "TypeName": "-",
                "SaleDollorPrice": 0, "usd_per_ct": 0,
            })
            p = s21_predict_prices(lgbm, pre, [row], tables, global_rate,
                                   cat_tables, cat_global, cat_levels, tail_model)[0]
            ladder.append({"clarity": cl, "price": round(p, 2), "perCt": round(p / carat, 2)})
        # Check for inversions
        violations = [
            f"{ladder[i]['clarity']}→{ladder[i+1]['clarity']} (−{((ladder[i]['perCt']-ladder[i+1]['perCt'])/ladder[i]['perCt']*100):.1f}%)"
            for i in range(len(ladder) - 1)
            if ladder[i+1]["perCt"] < ladder[i]["perCt"] * 0.999
        ]
        clarity_ladder_cases[f"{shape}_{carat}ct_{color}"] = {
            "ladder": ladder,
            "violations": violations,
            "monotone": len(violations) == 0,
        }

    selected_metrics = metrics([r["SaleDollorPrice"] for r in test], selected_preds)
    cert_metrics     = metrics([r["SaleDollorPrice"] for r in test], cert_preds)
    bucket_metrics   = {
        bucket: metrics_for_subset(test, selected_preds, lambda r, b=bucket: r.get("carat_bucket") == b)
        for bucket in sorted({r.get("carat_bucket") for r in test})
    }
    cut_style_metrics = {
        group: metrics_for_subset(test, selected_preds, lambda r, g=group: cut_style_group(r.get("Cut")) == g)
        for group in sorted({cut_style_group(r.get("Cut")) for r in test})
    }

    # ── Export ───────────────────────────────────────────────────────────────
    print(f"\n    Exporting S21 model…", end=" ", flush=True)
    export_model_lgbm(
        lgbm_model=lgbm,
        pre=pre,
        feat_names_numeric=feats_num,
        model_name="S21 — Monotone grade model (LightGBM)",
        model_metrics=selected_metrics,
        target_type="log_tail_lookup_residual",
        X_train_transformed=X_train,
        y_train=y_train,
        lookup_tables=tables,
        lookup_global=global_rate,
        cat_tables=cat_tables,
        cat_global=cat_global,
        cat_levels=cat_levels,
        large_carat_tail=tail_model,
        all_rows=all_rows,
    )

    return {
        "name": "S21 — Monotone grade model (LightGBM + isotonic lookup + rank features)",
        "strategy": "monotone_grade_lgbm_selected_spec",
        "target_type": "log_tail_lookup_residual",
        "metrics": selected_metrics,
        "certLoadedMetrics": cert_metrics,
        "segmentMetrics": {
            "byCaratBucket": bucket_metrics,
            "byCutStyle": cut_style_metrics,
            "selectedSpec10ctPlus": metrics_for_subset(test, selected_preds, lambda r: r.get("Carat", 0) >= 10.0),
            "selectedSpec8ctPlus":  metrics_for_subset(test, selected_preds, lambda r: r.get("Carat", 0) >= 8.0),
        },
        "description": (
            "Layer-1 isotonic lookup PAV + Layer-2 Clarity_Rank/Color_Rank ordinal features + "
            "Layer-3 LightGBM monotone_constraints (400 trees, num_leaves=63, lr=0.04) + "
            "Layer-4 PAV projection at browser inference"
        ),
        "pinnedCases": pinned_cases,
        "clarityLadderCases": clarity_ladder_cases,
        "largeCaratTailSummary": {
            "globalSlope": tail_model.get("globalSlope"),
            "startCarat":  tail_model.get("startCarat"),
        },
        "_lgbm": lgbm,
        "_pre": pre,
        "_lookup_tables": tables,
        "_lookup_global": global_rate,
        "_cat_tables": cat_tables,
        "_cat_global": cat_global,
        "_cat_levels": cat_levels,
        "_large_carat_tail": tail_model,
    }


def strategy_s23_grade_agnostic_anchor(train, test, all_rows=None):
    """S23 — Grade-agnostic anchor + monotone LightGBM residual.

    Root cause of S20/S21 failures: sparse grade-specific lookup cells
    (e.g. IF at 3ct+) collapse to the global fallback ($127/ct) while VVS1
    at 3ct+ has 17 rows and anchors to $638/ct — producing 1,127 clarity
    inversions.  S21's monotone LightGBM constraint fights the anchor rather
    than fixing the sparsity, causing MAPE regression of +0.75 pp.

    S23 fix:
      - Remove Color/Clarity from ALL lookup levels (grade-agnostic anchor).
        Now IF and VVS1 at 3ct+ share the same dense anchor.
      - All grade premium is learned by the GBDT through ordinal rank features
        (Clarity_Rank, Color_Rank) with monotone constraints.
      - IF premium learned from dense 1 ct data transfers to sparse 3 ct cells
        through shared numeric features — ExtraTrees cannot do this.
      - NO explicit grade×carat interaction terms.  Deep-research report (1)
        identifies that monotone constraints are per-feature/marginal: an
        unconstrained Log_Carat×ClarityRank feature moves whenever grade
        changes, weakening the formal ordering guarantee.  LightGBM learns
        the size-dependent grade premium internally via tree splits.  The full
        monotonicity sweep (8 shapes × 7 carats × 2 cuts) validates this.
    """
    import numpy as np
    import lightgbm as lgb
    from sklearn.compose import ColumnTransformer
    from sklearn.impute import SimpleImputer
    from sklearn.preprocessing import OneHotEncoder

    # ── Grade-agnostic lookup anchor (no Color/Clarity in any level) ───────
    tables, global_rate = build_s23_lookup(train)
    cat_tables, cat_global, cat_levels = build_category_prior(train)
    tail_model = build_large_carat_tail_model(train, tables, global_rate, levels=S23_TAIL_LEVELS)

    augmented_train = s19_augmented_training_rows(train)
    cert_test     = [cert_loaded_view(row) for row in test]
    selected_test = [selected_spec_view(row, mask_cut=False) for row in test]

    # ── Feature set (same as S21 + interaction terms, Color/Clarity removed
    #    from categoricals, grade enters only via ordinal rank numerics) ───
    feats_num = NUMERIC_FEATURES + SELECTED_SPEC_FLAGS + [
        "Carat_sq", "Carat_cube", "Log_Carat",
        "Carat_bucket_pos", "Dist_carat_threshold",
        "Dim_Volume", "Dim_Surface", "LW_Ratio_refined", "Table_Depth_Ratio",
        "Lookup_RatePerCt", "Lookup_IsGlobal", "Lookup_Count", "Log_Lookup_Count",
        "Log_Lookup_RatePerCt",
        # Category_RatePerCt omitted: grade-aware prior (uses Color+Clarity in keys).
        # When clarity changes in the sweep, it changes too but is unconstrained,
        # allowing it to overpower the Clarity_Rank monotone constraint.
        "Is_Specialty_Cut", "Is_Traditional_Cut", "Is_IceFlower_Cut",
        "Is_Large_Carat", "Is_10ct_Plus",
        "Large_Carat_Tail_X", "Large_Carat_Tail_X_sq",
        "Tail_Base_Lookup_RatePerCt", "Log_Tail_Base_Lookup_RatePerCt",
        "Tail_Base_Lookup_Count",
        "Large_Carat_Tail_Multiplier", "Log_Large_Carat_Tail_Multiplier",
        "Large_Carat_Tail_Slope", "Large_Carat_Tail_Count",
        "Clarity_Rank",  # ordinal 0=IF → 6=SI2 (monotone −1); no interaction term — see as_model_frame_s23 docstring
        "Color_Rank",    # ordinal 0=D  → 6=J   (monotone −1)
    ]

    x_train_df = as_model_frame_s23(
        augmented_train, tables, global_rate, cat_tables, cat_global, cat_levels, tail_model
    )
    y_train = []
    for row in augmented_train:
        base_rate, _, _ = lookup_predict_rate(tail_anchor_lookup_row(row), tables, global_rate)
        tail_mult, _, _, _ = large_carat_tail_multiplier(row, tail_model)
        y_train.append(math.log(max(row["usd_per_ct"], 0.01) / max(base_rate * tail_mult, 0.01)))
    y_train = np.array(y_train)

    pre = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=True), S23_CATEGORICAL_FEATURES),
        ("num", SimpleImputer(strategy="median"), feats_num),
    ])
    X_train = pre.fit_transform(x_train_df)

    feat_names_out = list(pre.get_feature_names_out())
    _axes_registry = load_monotone_axes_registry()
    constraints = build_monotone_vector(feat_names_out, "white_diamond", _axes_registry)

    lgbm = lgb.LGBMRegressor(
        n_estimators=400,
        num_leaves=63,
        max_depth=-1,
        learning_rate=0.04,
        min_child_samples=20,
        monotone_constraints=constraints,
        monotone_constraints_method="advanced",
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=42,
        verbose=-1,
        n_jobs=-1,
    )
    lgbm.fit(X_train, y_train, feature_name=feat_names_out)

    # ── Evaluate ────────────────────────────────────────────────────────────
    selected_preds = s23_predict_prices(lgbm, pre, selected_test, tables, global_rate,
                                        cat_tables, cat_global, cat_levels, tail_model)
    cert_preds     = s23_predict_prices(lgbm, pre, cert_test,     tables, global_rate,
                                        cat_tables, cat_global, cat_levels, tail_model)

    # Pinned regression cases
    pinned_cases = {}
    for ct in (3.0, 8.0, 10.0, 12.0):
        pinned = selected_spec_view({
            "Carat": ct, "carat_bucket": carat_bucket(ct),
            "Shape": "ROUND", "Color": "E", "Clarity": "VS1",
            "Cut": "ID", "Polish": "EX", "Symmetry": "EX",
            "Fluorescence": "-", "Report": "IGI", "TypeName": "-",
            "SaleDollorPrice": 0, "usd_per_ct": 0,
        })
        price = s23_predict_prices(lgbm, pre, [pinned], tables, global_rate,
                                   cat_tables, cat_global, cat_levels, tail_model)[0]
        base_rate, base_level, base_count = lookup_predict_rate(tail_anchor_lookup_row(pinned), tables, global_rate)
        tail_mult, tail_level, tail_count, tail_slope = large_carat_tail_multiplier(pinned, tail_model)
        pinned_cases[f"{ct:g}ct_round_e_vs1_id_selected_spec"] = {
            "price": round(price, 4), "rate": round(price / ct, 4),
            "tailBaseRate": round(base_rate, 4), "tailBaseLevel": base_level,
            "tailMultiplier": round(tail_mult, 6),
        }

    # ── Full monotonicity sweep over the actionable grid ─────────────────────
    # The deep-research report warns that monotone constraints are per-feature
    # (marginal), so the sweep must cover the full cross of shape × carat × color
    # rather than a handful of handpicked examples.  Every cell must show
    # clarity non-increasing and color non-increasing at the $/ct level.
    SWEEP_SHAPES  = ["ROUND", "OVAL", "CUSHION", "EMERALD", "PEAR", "MARQUISE", "HEART", "RADIANT"]
    SWEEP_CARATS  = [0.50, 1.00, 1.50, 2.00, 3.00, 4.08, 5.00, 7.00, 10.00]
    SWEEP_COLORS  = ["D", "E", "F", "G", "H", "I", "J"]
    SWEEP_CUTS    = ["-", "ID"]
    sweep_total_clarity   = 0
    sweep_total_color     = 0
    sweep_violations_clarity = []
    sweep_violations_color   = []

    for sh in SWEEP_SHAPES:
        for ct in SWEEP_CARATS:
            for cut in SWEEP_CUTS:
                cb = carat_bucket(ct)
                # Clarity sweep (fix best color D)
                clarity_prices = {}
                for cl in CLARITY_ORDER_S21:
                    r = selected_spec_view({
                        "Carat": ct, "carat_bucket": cb,
                        "Shape": sh, "Color": "D", "Clarity": cl,
                        "Cut": cut, "Polish": "EX", "Symmetry": "EX",
                        "Fluorescence": "-", "Report": "IGI", "TypeName": "-",
                        "SaleDollorPrice": 0, "usd_per_ct": 0,
                    })
                    clarity_prices[cl] = s23_predict_prices(
                        lgbm, pre, [r], tables, global_rate,
                        cat_tables, cat_global, cat_levels, tail_model
                    )[0] / ct
                for i in range(len(CLARITY_ORDER_S21) - 1):
                    c1, c2 = CLARITY_ORDER_S21[i], CLARITY_ORDER_S21[i + 1]
                    sweep_total_clarity += 1
                    if clarity_prices[c2] > clarity_prices[c1] * 1.001:
                        sweep_violations_clarity.append(
                            f"{sh} {ct}ct cut={cut}: {c1}→{c2} ({clarity_prices[c1]:.0f}→{clarity_prices[c2]:.0f}/ct)"
                        )
                # Color sweep (fix best clarity IF)
                color_prices = {}
                for co in SWEEP_COLORS:
                    r = selected_spec_view({
                        "Carat": ct, "carat_bucket": cb,
                        "Shape": sh, "Color": co, "Clarity": "IF",
                        "Cut": cut, "Polish": "EX", "Symmetry": "EX",
                        "Fluorescence": "-", "Report": "IGI", "TypeName": "-",
                        "SaleDollorPrice": 0, "usd_per_ct": 0,
                    })
                    color_prices[co] = s23_predict_prices(
                        lgbm, pre, [r], tables, global_rate,
                        cat_tables, cat_global, cat_levels, tail_model
                    )[0] / ct
                for i in range(len(SWEEP_COLORS) - 1):
                    c1, c2 = SWEEP_COLORS[i], SWEEP_COLORS[i + 1]
                    sweep_total_color += 1
                    if color_prices[c2] > color_prices[c1] * 1.001:
                        sweep_violations_color.append(
                            f"{sh} {ct}ct cut={cut}: color {c1}→{c2} ({color_prices[c1]:.0f}→{color_prices[c2]:.0f}/ct)"
                        )

    total_sweep_checks = sweep_total_clarity + sweep_total_color
    total_violations   = len(sweep_violations_clarity) + len(sweep_violations_color)
    print(f"\n    [S23 monotonicity sweep] {total_sweep_checks} checks  "
          f"clarity violations: {len(sweep_violations_clarity)}  "
          f"color violations: {len(sweep_violations_color)}  "
          f"{'✅ PASS' if total_violations == 0 else f'❌ {total_violations} VIOLATIONS'}")
    if sweep_violations_clarity[:3]:
        for v in sweep_violations_clarity[:3]:
            print(f"      clarity: {v}")
    if sweep_violations_color[:3]:
        for v in sweep_violations_color[:3]:
            print(f"      color:   {v}")

    clarity_ladder_cases = {
        "_sweepSummary": {
            "totalChecks": total_sweep_checks,
            "clarityViolations": len(sweep_violations_clarity),
            "colorViolations": len(sweep_violations_color),
            "pass": total_violations == 0,
            "exampleViolations": (sweep_violations_clarity + sweep_violations_color)[:10],
        }
    }
    # Keep a few representative ladders for human-readable auditing
    for (shape, carat, color, cut) in [
        ("MARQUISE", 4.08, "E", "-"),
        ("HEART",    3.0,  "E", "-"),
        ("ROUND",    2.0,  "E", "ID"),
        ("ROUND",    3.0,  "E", "ID"),
    ]:
        ladder = []
        for cl in CLARITY_ORDER_S21:
            row = selected_spec_view({
                "Carat": carat, "carat_bucket": carat_bucket(carat),
                "Shape": shape.upper(), "Color": color, "Clarity": cl,
                "Cut": cut, "Polish": "EX", "Symmetry": "EX",
                "Fluorescence": "-", "Report": "IGI", "TypeName": "-",
                "SaleDollorPrice": 0, "usd_per_ct": 0,
            })
            p = s23_predict_prices(lgbm, pre, [row], tables, global_rate,
                                   cat_tables, cat_global, cat_levels, tail_model)[0]
            ladder.append({"clarity": cl, "price": round(p, 2), "perCt": round(p / carat, 2)})
        violations = [
            f"{ladder[i]['clarity']}→{ladder[i+1]['clarity']} (−{((ladder[i]['perCt']-ladder[i+1]['perCt'])/ladder[i]['perCt']*100):.1f}%)"
            for i in range(len(ladder) - 1)
            if ladder[i+1]["perCt"] < ladder[i]["perCt"] * 0.999
        ]
        clarity_ladder_cases[f"{shape}_{carat}ct_{color}"] = {
            "ladder": ladder,
            "violations": violations,
            "monotone": len(violations) == 0,
        }

    # S23 acceptance check: IF 3ct ROUND E > VVS1 3ct ROUND E (no floor hack)
    if_3ct = s23_predict_prices(lgbm, pre, [selected_spec_view({
        "Carat": 3.0, "carat_bucket": carat_bucket(3.0),
        "Shape": "ROUND", "Color": "E", "Clarity": "IF",
        "Cut": "ID", "Polish": "EX", "Symmetry": "EX",
        "Fluorescence": "-", "Report": "IGI", "TypeName": "-",
        "SaleDollorPrice": 0, "usd_per_ct": 0,
    })], tables, global_rate, cat_tables, cat_global, cat_levels, tail_model)[0]
    vvs1_3ct = s23_predict_prices(lgbm, pre, [selected_spec_view({
        "Carat": 3.0, "carat_bucket": carat_bucket(3.0),
        "Shape": "ROUND", "Color": "E", "Clarity": "VVS1",
        "Cut": "ID", "Polish": "EX", "Symmetry": "EX",
        "Fluorescence": "-", "Report": "IGI", "TypeName": "-",
        "SaleDollorPrice": 0, "usd_per_ct": 0,
    })], tables, global_rate, cat_tables, cat_global, cat_levels, tail_model)[0]
    if_beats_vvs1 = if_3ct > vvs1_3ct
    print(f"\n    [S23 acceptance] IF 3ct ROUND E: ${if_3ct:,.2f}  VVS1: ${vvs1_3ct:,.2f}  "
          f"{'✅ IF > VVS1' if if_beats_vvs1 else '❌ INVERSION'}")

    selected_metrics = metrics([r["SaleDollorPrice"] for r in test], selected_preds)
    cert_metrics     = metrics([r["SaleDollorPrice"] for r in test], cert_preds)
    bucket_metrics   = {
        bucket: metrics_for_subset(test, selected_preds, lambda r, b=bucket: r.get("carat_bucket") == b)
        for bucket in sorted({r.get("carat_bucket") for r in test})
    }
    cut_style_metrics = {
        group: metrics_for_subset(test, selected_preds, lambda r, g=group: cut_style_group(r.get("Cut")) == g)
        for group in sorted({cut_style_group(r.get("Cut")) for r in test})
    }

    # ── Export ───────────────────────────────────────────────────────────────
    print(f"\n    Exporting S23 model…", end=" ", flush=True)
    export_model_lgbm(
        lgbm_model=lgbm,
        pre=pre,
        feat_names_numeric=feats_num,
        model_name="S23 — Grade-agnostic anchor + monotone LightGBM residual",
        model_metrics=selected_metrics,
        target_type="log_tail_lookup_residual",
        X_train_transformed=X_train,
        y_train=y_train,
        lookup_tables=tables,
        lookup_global=global_rate,
        cat_tables=cat_tables,
        cat_global=cat_global,
        cat_levels=cat_levels,
        large_carat_tail=tail_model,
        all_rows=all_rows,
        output_path=S23_MODEL_JSON,
        categorical_features=S23_CATEGORICAL_FEATURES,
    )

    return {
        "name": "S23 — Grade-agnostic anchor + monotone LightGBM residual",
        "strategy": "grade_agnostic_anchor_lgbm",
        "target_type": "log_tail_lookup_residual",
        "metrics": selected_metrics,
        "certLoadedMetrics": cert_metrics,
        "segmentMetrics": {
            "byCaratBucket": bucket_metrics,
            "byCutStyle": cut_style_metrics,
            "selectedSpec10ctPlus": metrics_for_subset(test, selected_preds, lambda r: r.get("Carat", 0) >= 10.0),
            "selectedSpec8ctPlus":  metrics_for_subset(test, selected_preds, lambda r: r.get("Carat", 0) >= 8.0),
        },
        "description": (
            "Grade-agnostic anchor (no Color/Clarity in lookup) + "
            "Clarity_Rank/Color_Rank ordinal features with LightGBM monotone constraints "
            "(400 trees, num_leaves=63, lr=0.04). "
            "No unconstrained grade×carat interaction terms. "
            "Full monotonicity sweep: 8 shapes × 7 carats × 2 cuts."
        ),
        "pinnedCases": pinned_cases,
        "clarityLadderCases": clarity_ladder_cases,
        "if3ctBeatsVvs1": if_beats_vvs1,
        "largeCaratTailSummary": {
            "globalSlope": tail_model.get("globalSlope"),
            "startCarat":  tail_model.get("startCarat"),
        },
        "_lgbm": lgbm,
        "_pre": pre,
        "_lookup_tables": tables,
        "_lookup_global": global_rate,
        "_cat_tables": cat_tables,
        "_cat_global": cat_global,
        "_cat_levels": cat_levels,
        "_large_carat_tail": tail_model,
    }


# ═══════════════════════════════════════════════════════════════════════════
# MAIN RUNNER
# ═══════════════════════════════════════════════════════════════════════════

def run():
    print("\n" + "=" * 90)
    print("STARSGEM MRPE IMPROVEMENT v2")
    print("Key innovation: rate-per-carat target + lookup/category priors + MAE criterion")
    print("=" * 90)

    # Check for --enriched flag
    use_enriched = "--enriched" in sys.argv
    use_clean    = "--clean"    in sys.argv
    only_s19 = "--only-s19" in sys.argv
    only_s20 = "--only-s20" in sys.argv
    only_s21 = "--only-s21" in sys.argv
    only_s23 = "--only-s23" in sys.argv

    if use_clean:
        rows = load_rows_from_clean_training()
        print("\n📊 Using clean training dataset (Segment A — 12,843 rows, cluster-quarantine applied)")
    elif use_enriched:
        rows = load_rows_enriched()
        print("\n📊 Using IGI-enriched data (86.7% coverage)")
    else:
        rows = load_rows()
        print("\n📊 Using baseline XLS data (no enrichment)")
    
    train, test = split_train_test(rows)

    print(f"\nDataset: {len(rows):,} rows  |  Train: {len(train):,}  |  Test: {len(test):,}")
    print(f"Carat range: {min(r['Carat'] for r in rows):.2f}–{max(r['Carat'] for r in rows):.2f}")
    print(f"Price range: ${min(r['SaleDollorPrice'] for r in rows):.2f}–${max(r['SaleDollorPrice'] for r in rows):.2f}")
    print()

    if only_s23:
        strategies_fns = [
            ("S23 (grade-agnostic anchor + monotone LightGBM)", strategy_s23_grade_agnostic_anchor),
        ]
    elif only_s21:
        strategies_fns = [
            ("S21 (monotone grade LightGBM)", strategy_s21_monotone_grade_selected_spec),
        ]
    elif only_s20:
        strategies_fns = [
            ("S20 (specialty cut + large-carat tail)", strategy_s20_specialty_tail_selected_spec),
        ]
    elif only_s19:
        strategies_fns = [
            ("S19 (lookup residual selected-spec)", strategy_s19_lookup_residual_selected_spec),
        ]
    else:
        strategies_fns = [
            ("S1 (v1 best baseline)",         strategy_s1_baseline),
            ("S2 (rate target)",              strategy_s2_rate_target),
            ("S3 (rate + MAE criterion)",     strategy_s3_rate_mae),
            ("S4 (rate + MAE + engineered)",  strategy_s4_rate_mae_engineered),
            ("S5 (rate + lookup feature)",    strategy_s5_rate_lookup_feature),
            ("S6 (rate + category prior)",    strategy_s6_rate_category_prior),
            ("S7 (full combo)",               strategy_s7_full_combo),
            ("S8 (LGB quantile)",             strategy_s8_lgb_quantile),
            ("S9 (rate + MSE ablation)",      strategy_s9_rate_mse_large),
        ]

        # Add S10 only if enriched data is being tested
        if use_enriched:
            strategies_fns.append(("S10 (enriched rate + MAE)", strategy_s10_enriched_rate_mae))

        # New v2 strategies
        strategies_fns.extend([
            ("S11 (temporal cutoff)",         strategy_s11_temporal_cutoff),
            ("S12 (fine lookup consensus)",   strategy_s12_fine_lookup_consensus),
            ("S13 (two-stage residual)",      strategy_s13_two_stage_residual),
            ("S14 (Cut-specific models)",     strategy_s14_cut_specific),
            ("S15 (magic thresholds)",        strategy_s15_magic_thresholds),
            ("S16 (Cut×carat interactions)",  strategy_s16_cut_carat_interactions),
            ("S17 (full combo v2)",           strategy_s17_full_combo_v2),
            ("S18 (temporal shallow)",        strategy_s18_temporal_shallow),
            ("S19 (lookup residual selected-spec)", strategy_s19_lookup_residual_selected_spec),
            ("S20 (specialty cut + large-carat tail)", strategy_s20_specialty_tail_selected_spec),
            ("S21 (monotone grade LightGBM)",          strategy_s21_monotone_grade_selected_spec),
            ("S23 (grade-agnostic anchor + monotone LightGBM)", strategy_s23_grade_agnostic_anchor),
        ])

    results = []
    best_result = None
    best_mape = float("inf")

    for label, fn in strategies_fns:
        print(f"  {label}...", end=" ", flush=True)
        try:
            try:
                result = fn(train, test, all_rows=rows)
            except TypeError:
                result = fn(train, test)
            if result is None:
                print("⊘ skipped (dependency missing)")
                continue
            mape = result["metrics"]["mape"]
            mae = result["metrics"]["mae"]
            r2 = result["metrics"]["r2"]
            print(f"✓  MAPE: {mape:.4f}%  MAE: ${mae:.2f}  R²: {r2:.4f}")
            results.append(result)
            if mape < best_mape:
                best_mape = mape
                best_result = result
        except Exception as e:
            print(f"✗  {e}")
            import traceback
            traceback.print_exc()

    # ─────────────────────────────────────────────────────────────────────
    # Rankings
    # ─────────────────────────────────────────────────────────────────────
    print("\n" + "=" * 90)
    print("RANKED RESULTS (by MAPE)")
    print("=" * 90 + "\n")

    baseline_mape = next((r["metrics"]["mape"] for r in results if "S1" in r["name"]), 4.38)
    for i, r in enumerate(sorted(results, key=lambda x: x["metrics"]["mape"]), 1):
        mape = r["metrics"]["mape"]
        delta = mape - baseline_mape
        flag = "🏆 BEST" if i == 1 else ("✅" if mape < baseline_mape else "  ")
        print(f"  {i:2}. {r['name']:<50}  MAPE: {mape:.4f}%  Δ: {delta:+.4f}pp  {flag}")

    # ─────────────────────────────────────────────────────────────────────
    # Export best model
    # ─────────────────────────────────────────────────────────────────────
    if best_result and "pipe" in best_result:
        print(f"\n🚀 Exporting best model: {best_result['name']}")
        print(f"   MAPE: {best_result['metrics']['mape']:.4f}%  (was {baseline_mape:.4f}%)")
        export_model(
            pipe=best_result["pipe"],
            feature_names_numeric=best_result["feats_num"],
            model_name=best_result["name"],
            model_metrics=best_result["metrics"],
            target_type=best_result["target_type"],
            lookup_tables=best_result.get("_lookup_tables"),
            lookup_global=best_result.get("_lookup_global"),
            cat_tables=best_result.get("_cat_tables"),
            cat_global=best_result.get("_cat_global"),
            cat_levels=best_result.get("_cat_levels"),
            large_carat_tail=best_result.get("_large_carat_tail"),
        )
    else:
        print("\n⚠  No exportable best result found.")

    # ─────────────────────────────────────────────────────────────────────
    # Save results JSON
    # ─────────────────────────────────────────────────────────────────────
    output = {
        "generatedDate": str(date.today()),
        "testSummary": {
            "totalRows": len(rows), "trainRows": len(train), "testRows": len(test),
            "strategiesTested": len(results),
            "split": "one_holdout_per_bucket",
            "bucketFields": VALIDATION_BUCKET_FIELDS,
        },
        "baselineMape": baseline_mape,
        "bestMape": best_mape,
        "improvementPct": round(100 * (baseline_mape - best_mape) / baseline_mape, 2),
        "strategies": [
            {k: v for k, v in r.items() if k not in ("pipe", "feats_num",
             "_lookup_tables", "_lookup_global", "_cat_tables", "_cat_global", "_cat_levels",
             "_large_carat_tail", "_lgbm", "_pre")}
            for r in results
        ],
        "bestStrategy": {k: v for k, v in best_result.items()
                         if k not in ("pipe", "feats_num",
                          "_lookup_tables", "_lookup_global",
                          "_cat_tables", "_cat_global", "_cat_levels",
                          "_large_carat_tail", "_lgbm", "_pre")} if best_result else None,
    }

    with open(RESULTS_JSON, "w") as f:
        json.dump(output, f, indent=2)
    print(f"\n✓ Results saved to {RESULTS_JSON}")

    return results, best_result


if __name__ == "__main__":
    try:
        run()
    except Exception as e:
        print(f"\n✗ Fatal: {e}")
        import traceback
        traceback.print_exc()
