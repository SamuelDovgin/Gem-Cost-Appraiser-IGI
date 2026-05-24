#!/usr/bin/env python3
"""
Gem Appraise — MRPE/MAPE Improvement Testing
═══════════════════════════════════════════════════════════════════════════════
Tests various strategies to reduce Mean Relative Percentage Error (MRPE/MAPE)
across ML models for StarGem diamond pricing.

Strategy categories:
  1. Hyperparameter tuning (depth, learning_rate, n_estimators, etc.)
  2. Feature engineering (polynomial, log transforms, ratios, interactions)
  3. Outlier handling (removal, clipping, robust scaling)
  4. Ensemble/weighted combinations
  5. Domain-specific improvements (carat bucketing, color integration ready)

All results are saved to: research/data/mrpe-improvement-results.json

Note: Currently does NOT include color features, but structure is ready for
color integration in future iterations.
"""

import json
import math
import os
import random
from datetime import date
from collections import defaultdict
import xlrd

# Import the original script functions
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
DATA_DIR = os.path.join(PROJECT_ROOT, "data")
XLS_FILE = os.path.join(DATA_DIR, "STARS Diamonds Stock2026.5.20.xls")

REQUIRED_COLUMNS = [
    "Carat", "Shape", "Color", "Clarity", "Cut", "Polish", "Symmetry",
    "Fluorescence", "Report", "Measurement", "Table_Scale", "Depth_Scale",
    "TypeName", "SaleDollorPrice",
]

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

# ═══════════════════════════════════════════════════════════════════════════════
# UTILITY FUNCTIONS (copied from reconstruct-starsgem-pricing.py)
# ═══════════════════════════════════════════════════════════════════════════════

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
    import re
    return re.sub(r"\s+", " ", text)


def parse_measurement(value):
    import re
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
    buckets = [
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
    for lo, hi, label in buckets:
        if lo <= carat <= hi:
            return label
    if carat >= 10.0:
        return "10.00+"
    return "<0.30"


def load_rows():
    wb = xlrd.open_workbook(XLS_FILE)
    ws = wb.sheet_by_name("Table")
    headers = [str(ws.cell_value(0, col)).strip() for col in range(ws.ncols)]
    missing = [col for col in REQUIRED_COLUMNS if col not in headers]
    if missing:
        raise RuntimeError("Missing required columns: " + ", ".join(missing))

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
    return raw_rows, headers


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


def as_model_frame(rows, include_engineered_features=False):
    """Convert rows to dataframe, optionally with engineered features."""
    import pandas as pd
    
    data = []
    for row in rows:
        item = {}
        for col in CATEGORICAL_FEATURES:
            item[col] = norm_cat(row.get(col))
        for col in NUMERIC_FEATURES:
            item[col] = row.get(col)
        
        # ENGINEERED FEATURES (prepared for future color integration)
        if include_engineered_features:
            c = item.get("Carat")
            if c:
                item["Carat_squared"] = c ** 2
                item["Carat_cubed"] = c ** 3
                item["Log_Carat"] = math.log(c)
            
            # Dimension ratios
            l, w, h = item.get("Length"), item.get("Width"), item.get("Height")
            if l and w and h:
                item["Dim_Volume"] = l * w * h
                item["Dim_Surface"] = 2 * (l*w + w*h + l*h)
            
            # Table/Depth proportions
            t, d = item.get("Table_Scale"), item.get("Depth_Scale")
            if t and d:
                item["Table_Depth_Ratio"] = t / d if d > 0 else None
        
        data.append(item)
    
    return pd.DataFrame(data)


# ═══════════════════════════════════════════════════════════════════════════════
# IMPROVEMENT STRATEGIES
# ═══════════════════════════════════════════════════════════════════════════════

def strategy_baseline_extra_trees(train, test):
    """Original Extra Trees with baseline hyperparameters."""
    import numpy as np
    from sklearn.compose import ColumnTransformer
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder
    from sklearn.ensemble import ExtraTreesRegressor
    
    x_train = as_model_frame(train)
    x_test = as_model_frame(test)
    y_train = np.log([r["SaleDollorPrice"] for r in train])
    
    pre = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=True), CATEGORICAL_FEATURES),
        ("num", SimpleImputer(strategy="median"), NUMERIC_FEATURES),
    ])
    
    model = ExtraTreesRegressor(n_estimators=60, max_depth=24, min_samples_leaf=2, random_state=42, n_jobs=-1)
    pipe = Pipeline([("pre", pre), ("model", model)])
    pipe.fit(x_train, y_train)
    preds = clamp_positive_predictions(np.exp(pipe.predict(x_test)))
    
    return {
        "name": "Extra Trees (baseline)",
        "strategy": "baseline",
        "metrics": metrics([r["SaleDollorPrice"] for r in test], preds),
        "description": "Original hyperparameters: 60 trees, depth=24, min_samples_leaf=2",
    }


def strategy_tuned_extra_trees_aggressive(train, test):
    """Extra Trees with more aggressive hyperparameter tuning."""
    import numpy as np
    from sklearn.compose import ColumnTransformer
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder
    from sklearn.ensemble import ExtraTreesRegressor
    
    x_train = as_model_frame(train)
    x_test = as_model_frame(test)
    y_train = np.log([r["SaleDollorPrice"] for r in train])
    
    pre = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=True), CATEGORICAL_FEATURES),
        ("num", SimpleImputer(strategy="median"), NUMERIC_FEATURES),
    ])
    
    # More trees, deeper, different leaf strategy
    model = ExtraTreesRegressor(
        n_estimators=120,
        max_depth=28,
        min_samples_leaf=1,
        min_samples_split=2,
        random_state=42,
        n_jobs=-1
    )
    pipe = Pipeline([("pre", pre), ("model", model)])
    pipe.fit(x_train, y_train)
    preds = clamp_positive_predictions(np.exp(pipe.predict(x_test)))
    
    return {
        "name": "Extra Trees (aggressive tuning)",
        "strategy": "hyperparameter_tuning",
        "metrics": metrics([r["SaleDollorPrice"] for r in test], preds),
        "description": "Tuned: 120 trees, depth=28, min_samples_leaf=1, min_samples_split=2",
    }


def strategy_tuned_lightgbm(train, test):
    """LightGBM with optimized hyperparameters."""
    import numpy as np
    from sklearn.compose import ColumnTransformer
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder
    from lightgbm import LGBMRegressor
    
    x_train = as_model_frame(train)
    x_test = as_model_frame(test)
    y_train = np.log([r["SaleDollorPrice"] for r in train])
    
    pre = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=True), CATEGORICAL_FEATURES),
        ("num", SimpleImputer(strategy="median"), NUMERIC_FEATURES),
    ])
    
    # Tuned parameters targeting lower MAPE
    model = LGBMRegressor(
        n_estimators=600,
        learning_rate=0.03,
        num_leaves=64,
        subsample=0.85,
        colsample_bytree=0.85,
        min_child_samples=2,
        max_depth=8,
        random_state=42,
        verbose=-1,
    )
    pipe = Pipeline([("pre", pre), ("model", model)])
    pipe.fit(x_train, y_train)
    preds = clamp_positive_predictions(np.exp(pipe.predict(x_test)))
    
    return {
        "name": "LightGBM (tuned)",
        "strategy": "hyperparameter_tuning",
        "metrics": metrics([r["SaleDollorPrice"] for r in test], preds),
        "description": "Tuned: 600 estimators, lr=0.03, num_leaves=64, depth=8, subsample=0.85",
    }


def strategy_engineered_features_extra_trees(train, test):
    """Extra Trees with engineered polynomial and ratio features."""
    import numpy as np
    from sklearn.compose import ColumnTransformer
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder
    from sklearn.ensemble import ExtraTreesRegressor
    
    x_train = as_model_frame(train, include_engineered_features=True)
    x_test = as_model_frame(test, include_engineered_features=True)
    y_train = np.log([r["SaleDollorPrice"] for r in train])
    
    engineered_numeric = NUMERIC_FEATURES + [
        "Carat_squared", "Carat_cubed", "Log_Carat",
        "Dim_Volume", "Dim_Surface", "Table_Depth_Ratio"
    ]
    
    pre = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=True), CATEGORICAL_FEATURES),
        ("num", SimpleImputer(strategy="median"), engineered_numeric),
    ])
    
    model = ExtraTreesRegressor(n_estimators=100, max_depth=26, min_samples_leaf=1, random_state=42, n_jobs=-1)
    pipe = Pipeline([("pre", pre), ("model", model)])
    pipe.fit(x_train, y_train)
    preds = clamp_positive_predictions(np.exp(pipe.predict(x_test)))
    
    return {
        "name": "Extra Trees (engineered features)",
        "strategy": "feature_engineering",
        "metrics": metrics([r["SaleDollorPrice"] for r in test], preds),
        "description": "Added: Carat²/³, Log(Carat), dimension volume/surface, table/depth ratio",
    }


def strategy_ensemble_weighted(train, test):
    """Weighted ensemble of Extra Trees + LightGBM + Random Forest."""
    import numpy as np
    from sklearn.compose import ColumnTransformer
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder
    from sklearn.ensemble import ExtraTreesRegressor, RandomForestRegressor
    from lightgbm import LGBMRegressor
    
    x_train = as_model_frame(train)
    x_test = as_model_frame(test)
    y_train = np.log([r["SaleDollorPrice"] for r in train])
    
    pre = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=True), CATEGORICAL_FEATURES),
        ("num", SimpleImputer(strategy="median"), NUMERIC_FEATURES),
    ])
    
    x_train_prepared = pre.fit_transform(x_train)
    x_test_prepared = pre.transform(x_test)
    
    # Train three diverse models
    et = ExtraTreesRegressor(n_estimators=80, max_depth=26, min_samples_leaf=1, random_state=42, n_jobs=-1)
    et.fit(x_train_prepared, y_train)
    et_preds = et.predict(x_test_prepared)
    
    rf = RandomForestRegressor(n_estimators=80, max_depth=24, min_samples_leaf=2, random_state=42, n_jobs=-1)
    rf.fit(x_train_prepared, y_train)
    rf_preds = rf.predict(x_test_prepared)
    
    lgb = LGBMRegressor(n_estimators=500, learning_rate=0.04, num_leaves=56, subsample=0.85, random_state=42, verbose=-1)
    lgb.fit(x_train_prepared, y_train)
    lgb_preds = lgb.predict(x_test_prepared)
    
    # Weighted average: Extra Trees (0.5) + LightGBM (0.35) + Random Forest (0.15)
    ensemble_preds = 0.5 * et_preds + 0.35 * lgb_preds + 0.15 * rf_preds
    preds = clamp_positive_predictions(np.exp(ensemble_preds))
    
    return {
        "name": "Ensemble (ET + LGB + RF weighted)",
        "strategy": "ensemble",
        "metrics": metrics([r["SaleDollorPrice"] for r in test], preds),
        "description": "Weighted blend: ET(0.5) + LightGBM(0.35) + RF(0.15) for diversity",
    }


def strategy_outlier_removed_extra_trees(train, test):
    """Extra Trees with outlier removal using IQR method."""
    import numpy as np
    from sklearn.compose import ColumnTransformer
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder
    from sklearn.ensemble import ExtraTreesRegressor
    
    # Remove outliers from training set only
    prices = [r["SaleDollorPrice"] for r in train]
    q1, q3 = np.percentile(prices, [25, 75])
    iqr = q3 - q1
    lower_bound = q1 - 1.5 * iqr
    upper_bound = q3 + 1.5 * iqr
    
    train_clean = [r for r in train if lower_bound <= r["SaleDollorPrice"] <= upper_bound]
    removed = len(train) - len(train_clean)
    
    x_train = as_model_frame(train_clean)
    x_test = as_model_frame(test)
    y_train = np.log([r["SaleDollorPrice"] for r in train_clean])
    
    pre = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=True), CATEGORICAL_FEATURES),
        ("num", SimpleImputer(strategy="median"), NUMERIC_FEATURES),
    ])
    
    model = ExtraTreesRegressor(n_estimators=90, max_depth=25, min_samples_leaf=1, random_state=42, n_jobs=-1)
    pipe = Pipeline([("pre", pre), ("model", model)])
    pipe.fit(x_train, y_train)
    preds = clamp_positive_predictions(np.exp(pipe.predict(x_test)))
    
    return {
        "name": "Extra Trees (outlier-cleaned)",
        "strategy": "data_preprocessing",
        "metrics": metrics([r["SaleDollorPrice"] for r in test], preds),
        "description": f"Removed {removed} training outliers (IQR method) before fitting",
    }


def strategy_catboost_tuned(train, test):
    """CatBoost with optimized hyperparameters."""
    import numpy as np
    from catboost import CatBoostRegressor, Pool
    
    x_train = as_model_frame(train)
    x_test = as_model_frame(test)
    for col in CATEGORICAL_FEATURES:
        x_train[col] = x_train[col].astype(str)
        x_test[col] = x_test[col].astype(str)
    
    y_train = np.log([r["SaleDollorPrice"] for r in train])
    
    model = CatBoostRegressor(
        iterations=600,
        depth=7,
        learning_rate=0.06,
        loss_function="RMSE",
        random_seed=42,
        verbose=False,
        allow_writing_files=False,
        subsample=0.85,
        colsample_bylevel=0.85,
    )
    model.fit(Pool(x_train, y_train, cat_features=CATEGORICAL_FEATURES))
    preds = clamp_positive_predictions(np.exp(model.predict(Pool(x_test, cat_features=CATEGORICAL_FEATURES))))
    
    return {
        "name": "CatBoost (tuned)",
        "strategy": "hyperparameter_tuning",
        "metrics": metrics([r["SaleDollorPrice"] for r in test], preds),
        "description": "Tuned: 600 iterations, depth=7, lr=0.06, subsample=0.85",
    }


# ═══════════════════════════════════════════════════════════════════════════════
# TEST RUNNER
# ═══════════════════════════════════════════════════════════════════════════════

def run_improvement_tests():
    """Run all improvement strategy tests."""
    print("\n" + "=" * 90)
    print("STARSGEM MRPE IMPROVEMENT TESTING")
    print("=" * 90)
    
    rows, _ = load_rows()
    train, test = split_train_test(rows)
    
    print(f"\nDataset: {len(rows):,} rows")
    print(f"Train/Test split: {len(train):,} / {len(test):,} (80/20)")
    print(f"\nTesting strategies...\n")
    
    strategies = []
    
    # Baseline
    try:
        print("  1. Extra Trees (baseline)...", end=" ", flush=True)
        result = strategy_baseline_extra_trees(train, test)
        strategies.append(result)
        print(f"✓ MAPE: {result['metrics']['mape']:.4f}%")
    except Exception as e:
        print(f"✗ {e}")
    
    # Hyperparameter tuning
    try:
        print("  2. Extra Trees (aggressive tuning)...", end=" ", flush=True)
        result = strategy_tuned_extra_trees_aggressive(train, test)
        strategies.append(result)
        print(f"✓ MAPE: {result['metrics']['mape']:.4f}%")
    except Exception as e:
        print(f"✗ {e}")
    
    try:
        print("  3. LightGBM (tuned)...", end=" ", flush=True)
        result = strategy_tuned_lightgbm(train, test)
        strategies.append(result)
        print(f"✓ MAPE: {result['metrics']['mape']:.4f}%")
    except Exception as e:
        print(f"✗ {e}")
    
    try:
        print("  4. CatBoost (tuned)...", end=" ", flush=True)
        result = strategy_catboost_tuned(train, test)
        strategies.append(result)
        print(f"✓ MAPE: {result['metrics']['mape']:.4f}%")
    except Exception as e:
        print(f"✗ {e}")
    
    # Feature engineering
    try:
        print("  5. Extra Trees (engineered features)...", end=" ", flush=True)
        result = strategy_engineered_features_extra_trees(train, test)
        strategies.append(result)
        print(f"✓ MAPE: {result['metrics']['mape']:.4f}%")
    except Exception as e:
        print(f"✗ {e}")
    
    # Ensemble
    try:
        print("  6. Ensemble (ET + LGB + RF)...", end=" ", flush=True)
        result = strategy_ensemble_weighted(train, test)
        strategies.append(result)
        print(f"✓ MAPE: {result['metrics']['mape']:.4f}%")
    except Exception as e:
        print(f"✗ {e}")
    
    # Data preprocessing
    try:
        print("  7. Extra Trees (outlier-cleaned)...", end=" ", flush=True)
        result = strategy_outlier_removed_extra_trees(train, test)
        strategies.append(result)
        print(f"✓ MAPE: {result['metrics']['mape']:.4f}%")
    except Exception as e:
        print(f"✗ {e}")
    
    # ─────────────────────────────────────────────────────────────────────────────
    # Summary
    # ─────────────────────────────────────────────────────────────────────────────
    
    print("\n" + "=" * 90)
    print("RESULTS SUMMARY (sorted by MAPE)")
    print("=" * 90 + "\n")
    
    for i, strat in enumerate(sorted(strategies, key=lambda x: x['metrics']['mape']), 1):
        mape = strat['metrics']['mape']
        mae = strat['metrics']['mae']
        r2 = strat['metrics']['r2']
        print(f"{i}. {strat['name']:40} MAPE: {mape:7.4f}%  MAE: ${mae:8.2f}  R²: {r2:.4f}")
        print(f"   Strategy: {strat['strategy']:25} | {strat['description']}")
        print()
    
    # Save results
    output = {
        "generatedDate": str(date.today()),
        "testSummary": {
            "totalRows": len(rows),
            "trainRows": len(train),
            "testRows": len(test),
            "strategiesTested": len(strategies),
        },
        "strategies": strategies,
        "baseline": strategies[0]['metrics']['mape'] if strategies else None,
        "bestImprovement": min(strategies, key=lambda x: x['metrics']['mape']) if strategies else None,
    }
    
    output_path = os.path.join(DATA_DIR, "mrpe-improvement-results.json")
    with open(output_path, "w") as f:
        json.dump(output, f, indent=2)
    
    print(f"\n✓ Results saved to: {output_path}")
    
    return strategies


if __name__ == "__main__":
    try:
        strategies = run_improvement_tests()
    except Exception as e:
        print(f"\n✗ Error: {e}")
        import traceback
        traceback.print_exc()
