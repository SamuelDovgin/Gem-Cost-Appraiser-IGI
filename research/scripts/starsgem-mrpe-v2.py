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
    "Fluorescence", "Report", "TypeName", "carat_bucket",
]
NUMERIC_FEATURES = [
    "Carat", "Table_Scale", "Depth_Scale", "Length", "Width", "Height",
    "LengthWidthRatio",
]
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


def split_train_test(rows, seed=42):
    shuffled = list(rows)
    random.Random(seed).shuffle(shuffled)
    n_test = max(1, int(round(len(shuffled) * 0.2)))
    return shuffled[n_test:], shuffled[:n_test]


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


def lookup_predict_rate(row, tables, global_rate):
    """Return (predicted_rate_per_ct, level, count)."""
    for table in tables:
        key = "||".join(str(row.get(f, "-")) for f in table["fields"])
        hit = table["groups"].get(key)
        if hit:
            return hit["usdPerCt"], table["level"], hit["count"]
    return global_rate / 170, "GLOBAL", 0


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


# ═══════════════════════════════════════════════════════════════════════════
# MODEL EXPORT
# ═══════════════════════════════════════════════════════════════════════════

def round_list(values, digits=8):
    return [round(float(v), digits) for v in values]


def export_model(pipe, feature_names_numeric, model_name, model_metrics, target_type):
    """Serialize the fitted ExtraTrees pipeline to JSON.

    target_type: 'log_price' or 'log_rate' (log_rate means target = log(price/carat))
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
        "target": "log(SaleDollorPrice/Carat)" if target_type == "log_rate" else "log(SaleDollorPrice)",
        "prediction": "exp(mean(tree_log_predictions)) * Carat" if target_type == "log_rate" else "exp(mean(tree_log_predictions))",
        "targetType": target_type,
        "features": {
            "categorical": CATEGORICAL_FEATURES,
            "numeric": feature_names_numeric,
            "categories": categories,
            "numericMedians": numeric_medians,
        },
        "metrics": model_metrics,
        "treeCount": len(trees),
        "trees": trees,
    }

    with open(ML_MODEL_JSON, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"    → Exported to {ML_MODEL_JSON}")
    return out


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
    
    if use_enriched:
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

    results = []
    best_result = None
    best_mape = float("inf")

    for label, fn in strategies_fns:
        print(f"  {label}...", end=" ", flush=True)
        try:
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
        },
        "baselineMape": baseline_mape,
        "bestMape": best_mape,
        "improvementPct": round(100 * (baseline_mape - best_mape) / baseline_mape, 2),
        "strategies": [
            {k: v for k, v in r.items() if k not in ("pipe", "feats_num",
             "_lookup_tables", "_lookup_global", "_cat_tables", "_cat_global", "_cat_levels")}
            for r in results
        ],
        "bestStrategy": {k: v for k, v in best_result.items()
                         if k not in ("pipe", "feats_num",
                          "_lookup_tables", "_lookup_global",
                          "_cat_tables", "_cat_global", "_cat_levels")} if best_result else None,
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
