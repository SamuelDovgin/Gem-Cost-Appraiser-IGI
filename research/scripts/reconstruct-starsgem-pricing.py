#!/usr/bin/env python3
"""
Reverse-engineer StarGem's May 20, 2026 supplier sheet pricing.

Outputs:
  - research/data/starsgem-lookup-table.csv
  - research/data/starsgem-residual-analysis.csv
  - research/data/starsgem-pricing-intelligence.json
  - research/starsgem-predict-price.js

The model is intentionally deterministic first: it looks for the internal
integer price implied by SaleDollorPrice * 170, then rebuilds fallback lookup
tables over median internal rate per carat. If pandas/sklearn/XGBoost/LightGBM/
CatBoost are installed, it also benchmarks ML-only and lookup+residual models.
"""

import csv
import importlib.util
import json
import math
import os
import random
import re
from collections import defaultdict
from datetime import date
from statistics import median

import xlrd

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
DATA_DIR = os.path.join(PROJECT_ROOT, "data")
XLS_FILE = os.path.join(DATA_DIR, "STARS Diamonds Stock2026.5.20.xls")
LOOKUP_CSV = os.path.join(DATA_DIR, "starsgem-lookup-table.csv")
RESIDUAL_CSV = os.path.join(DATA_DIR, "starsgem-residual-analysis.csv")
INTEL_JSON = os.path.join(DATA_DIR, "starsgem-pricing-intelligence.json")
ML_MODEL_JSON = os.path.join(DATA_DIR, "starsgem-ml-extra-trees-model.json")
PREDICT_JS = os.path.join(PROJECT_ROOT, "starsgem-predict-price.js")

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

MODEL_RECS = [
    ("CatBoost", "Best first ML check for mixed categorical supplier data; usually needs the least one-hot plumbing."),
    ("LightGBM / XGBoost", "Best gradient-boosted-tree family for nonlinear carat curves and interactions."),
    ("Random Forest / Extra Trees", "Good sanity-check ensemble for discrete lookup-like behavior."),
    ("Ridge / Lasso on log price", "Fast interpretable baseline; useful for validating multiplicative structure."),
    ("Lookup + residual ML", "Use the deterministic lookup as base, then learn residuals from dimensions/proportions."),
]

CATEGORICAL_FEATURES = [
    "Shape", "Color", "Clarity", "Cut", "Polish", "Symmetry",
    "Fluorescence", "Report", "TypeName", "carat_bucket",
]
NUMERIC_FEATURES = [
    "Carat", "Table_Scale", "Depth_Scale", "Length", "Width", "Height",
    "LengthWidthRatio",
]


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


def key_for(row, fields):
    return tuple(str(row.get(field, "-")) for field in fields)


def key_string(values):
    return "||".join(str(v) for v in values)


def build_lookup(rows):
    tables = []
    for level, fields in LOOKUP_LEVELS:
        grouped = defaultdict(list)
        for row in rows:
            grouped[key_for(row, fields)].append(row)

        groups = {}
        for key, recs in grouped.items():
            rates = [r["internal_rate_per_ct"] for r in recs]
            usd_rates = [r["usd_per_ct"] for r in recs]
            groups[key_string(key)] = {
                "rate": round(median(rates), 6),
                "usdPerCt": round(median(usd_rates), 4),
                "count": len(recs),
            }
        tables.append({"level": level, "fields": fields, "groups": groups})

    all_rates = [r["internal_rate_per_ct"] for r in rows]
    return tables, round(median(all_rates), 6)


def predict_internal(row, tables, global_rate):
    for table in tables:
        key = key_string(key_for(row, table["fields"]))
        found = table["groups"].get(key)
        if found:
            internal = int(round(row["Carat"] * found["rate"]))
            return internal, found["rate"], table["level"], table["fields"], found["count"]
    internal = int(round(row["Carat"] * global_rate))
    return internal, global_rate, "GLOBAL", [], len(tables)


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


def split_train_test(rows):
    shuffled = list(rows)
    random.Random(42).shuffle(shuffled)
    n_test = max(1, int(round(len(shuffled) * 0.2)))
    return shuffled[n_test:], shuffled[:n_test]


def granularity(rows):
    tests = {}
    for factor in range(1, 1001):
        off = 0
        max_abs = 0.0
        for row in rows:
            x = row["SaleDollorPrice"] * factor
            delta = abs(x - round(x))
            max_abs = max(max_abs, delta)
            if delta > 1e-6:
                off += 1
        ratio = (len(rows) - off) / len(rows)
        tests[str(factor)] = {"integerShare": round(ratio, 6), "offCount": off, "maxRemainder": round(max_abs, 8)}

    strong = [
        (int(k), v["integerShare"])
        for k, v in tests.items()
        if v["integerShare"] >= 0.999
    ]
    requested = {str(k): tests[str(k)] for k in (17, 100, 170, 1000) if str(k) in tests}
    return {
        "smallestStrongFactor": strong[0][0] if strong else None,
        "bestFactor": max(((int(k), v["integerShare"]) for k, v in tests.items()), key=lambda x: (x[1], -x[0]))[0],
        "requested": requested,
    }


def write_lookup_csv(tables):
    fields = [
        "level", "key_fields", "carat_bucket", "Shape", "Color", "Clarity",
        "TypeName", "Report", "Cut", "Polish", "Symmetry",
        "count", "median_internal_rate_per_ct", "median_usd_per_ct",
    ]
    with open(LOOKUP_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for table in tables:
            for key, value in sorted(table["groups"].items()):
                parts = key.split("||")
                row = {field: "" for field in fields}
                row["level"] = table["level"]
                row["key_fields"] = "+".join(table["fields"])
                for name, part in zip(table["fields"], parts):
                    if name in row:
                        row[name] = part
                row["count"] = value["count"]
                row["median_internal_rate_per_ct"] = value["rate"]
                row["median_usd_per_ct"] = value["usdPerCt"]
                writer.writerow(row)


def group_metric_rows(rows):
    out = []
    for field in ["carat_bucket", "Shape", "Color", "Clarity", "TypeName"]:
        groups = defaultdict(list)
        for row in rows:
            groups[row[field]].append(row)
        for value, recs in sorted(groups.items(), key=lambda item: (-len(item[1]), str(item[0]))):
            actual = [r["SaleDollorPrice"] for r in recs]
            predicted = [r["predicted_price"] for r in recs]
            m = metrics(actual, predicted)
            bias = sum((p - a) for a, p in zip(actual, predicted)) / len(recs)
            out.append({
                "group_type": field,
                "group_value": value,
                "count": m["count"],
                "mape": m["mape"],
                "mae": m["mae"],
                "rmse": m["rmse"],
                "r2": m["r2"],
                "bias_pred_minus_actual": round(bias, 4),
            })
    return out


def write_residual_csv(rows):
    fields = [
        "group_type", "group_value", "count", "mape", "mae", "rmse", "r2",
        "bias_pred_minus_actual",
    ]
    with open(RESIDUAL_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(group_metric_rows(rows))


def package_available(module_name):
    return importlib.util.find_spec(module_name) is not None


def as_model_frame(rows):
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


def clamp_positive_predictions(values):
    out = []
    for value in values:
        try:
            n = float(value)
        except (TypeError, ValueError):
            n = 0.0
        out.append(max(n, 0.01))
    return out


def round_list(values, digits=8):
    return [round(float(v), digits) for v in values]


def export_tree_ensemble_model(pipe, model_name, model_metrics):
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
        for feature, value in zip(NUMERIC_FEATURES, imputer.statistics_)
    }
    trees = []
    for estimator in model.estimators_:
        tree = estimator.tree_
        trees.append({
            "childrenLeft": tree.children_left.astype(int).tolist(),
            "childrenRight": tree.children_right.astype(int).tolist(),
            "feature": tree.feature.astype(int).tolist(),
            "threshold": round_list(tree.threshold, 8),
            "value": round_list(tree.value[:, 0, 0], 8),
        })

    out = {
        "generatedDate": str(date.today()),
        "modelName": model_name,
        "target": "log(SaleDollorPrice)",
        "prediction": "exp(mean(tree_log_predictions))",
        "features": {
            "categorical": CATEGORICAL_FEATURES,
            "numeric": NUMERIC_FEATURES,
            "categories": categories,
            "numericMedians": numeric_medians,
        },
        "metrics": model_metrics,
        "treeCount": len(trees),
        "trees": trees,
    }
    with open(ML_MODEL_JSON, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
    return out


def add_model_result(results, name, status, note, predictions=None, actual=None, packages=None, error=None):
    results.append({
        "name": name,
        "status": status,
        "packages": packages or [],
        "metrics": metrics(actual, predictions) if predictions is not None and actual is not None else None,
        "note": note if error is None else note + f" Error: {error}",
    })


def run_sklearn_log_model(name, estimator, train, test, note, packages):
    import numpy as np
    from sklearn.compose import ColumnTransformer
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder, StandardScaler

    x_train = as_model_frame(train)
    x_test = as_model_frame(test)
    y_train = np.log([r["SaleDollorPrice"] for r in train])

    pre = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=True), CATEGORICAL_FEATURES),
        ("num", Pipeline([
            ("impute", SimpleImputer(strategy="median")),
            ("scale", StandardScaler(with_mean=False)),
        ]), NUMERIC_FEATURES),
    ])
    pipe = Pipeline([("pre", pre), ("model", estimator)])
    pipe.fit(x_train, y_train)
    preds = clamp_positive_predictions(np.exp(pipe.predict(x_test)))
    return {
        "name": name,
        "status": "complete",
        "packages": packages,
        "metrics": metrics([r["SaleDollorPrice"] for r in test], preds),
        "note": note,
    }


def run_tree_pipeline(name, estimator, train, test, note, packages):
    import numpy as np
    from sklearn.compose import ColumnTransformer
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder

    x_train = as_model_frame(train)
    x_test = as_model_frame(test)
    y_train = np.log([r["SaleDollorPrice"] for r in train])

    pre = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=True), CATEGORICAL_FEATURES),
        ("num", SimpleImputer(strategy="median"), NUMERIC_FEATURES),
    ])
    pipe = Pipeline([("pre", pre), ("model", estimator)])
    pipe.fit(x_train, y_train)
    preds = clamp_positive_predictions(np.exp(pipe.predict(x_test)))
    model_metrics = metrics([r["SaleDollorPrice"] for r in test], preds)
    export_path = None
    if name == "Extra Trees":
        export_tree_ensemble_model(pipe, name, model_metrics)
        export_path = "research/data/starsgem-ml-extra-trees-model.json"
    return {
        "name": name,
        "status": "complete",
        "packages": packages,
        "metrics": model_metrics,
        "note": note if export_path is None else note + f" Browser model exported to {export_path}.",
    }


def run_catboost(train, test):
    import numpy as np
    from catboost import CatBoostRegressor, Pool

    x_train = as_model_frame(train)
    x_test = as_model_frame(test)
    for col in CATEGORICAL_FEATURES:
        x_train[col] = x_train[col].astype(str)
        x_test[col] = x_test[col].astype(str)
    y_train = np.log([r["SaleDollorPrice"] for r in train])
    model = CatBoostRegressor(
        iterations=450,
        depth=6,
        learning_rate=0.08,
        loss_function="RMSE",
        random_seed=42,
        verbose=False,
        allow_writing_files=False,
    )
    model.fit(Pool(x_train, y_train, cat_features=CATEGORICAL_FEATURES))
    preds = clamp_positive_predictions(np.exp(model.predict(Pool(x_test, cat_features=CATEGORICAL_FEATURES))))
    return {
        "name": "CatBoost",
        "status": "complete",
        "packages": ["catboost"],
        "metrics": metrics([r["SaleDollorPrice"] for r in test], preds),
        "note": "Native categorical gradient boosting on log price.",
    }


def run_lookup_residual_model(train, test):
    import numpy as np
    from sklearn.compose import ColumnTransformer
    from sklearn.ensemble import HistGradientBoostingRegressor
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder

    x_train = as_model_frame(train)
    x_test = as_model_frame(test)
    x_train["lookup_pred"] = [r["predicted_price"] for r in train]
    x_test["lookup_pred"] = [r["predicted_price"] for r in test]
    num_features = NUMERIC_FEATURES + ["lookup_pred"]
    y_train = [
        math.log(r["SaleDollorPrice"]) - math.log(max(r["predicted_price"], 0.01))
        for r in train
    ]
    pre = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=False), CATEGORICAL_FEATURES),
        ("num", SimpleImputer(strategy="median"), num_features),
    ])
    model = HistGradientBoostingRegressor(max_iter=250, learning_rate=0.06, max_leaf_nodes=31, random_state=42)
    pipe = Pipeline([("pre", pre), ("model", model)])
    pipe.fit(x_train, y_train)
    residual_pred = pipe.predict(x_test)
    preds = clamp_positive_predictions([
        base * math.exp(float(delta))
        for base, delta in zip([r["predicted_price"] for r in test], residual_pred)
    ])
    return {
        "name": "Lookup + residual ML",
        "status": "complete",
        "packages": ["sklearn"],
        "metrics": metrics([r["SaleDollorPrice"] for r in test], preds),
        "note": "A-G lookup prediction plus gradient-boosted residual correction.",
    }


def model_benchmarks(lookup_metrics, train, test):
    results = [{
        "name": "Lookup-only reconstruction",
        "status": "complete",
        "metrics": lookup_metrics,
        "note": "Median internal_rate_per_ct lookup with A-G fallback keys.",
    }]

    if package_available("catboost"):
        try:
            results.append(run_catboost(train, test))
        except Exception as exc:
            add_model_result(results, "CatBoost", "failed", MODEL_RECS[0][1], packages=["catboost"], error=str(exc))
    else:
        add_model_result(results, "CatBoost", "dependency_missing", MODEL_RECS[0][1])

    if package_available("lightgbm"):
        try:
            from lightgbm import LGBMRegressor
            results.append(run_tree_pipeline(
                "LightGBM",
                LGBMRegressor(
                    n_estimators=450,
                    learning_rate=0.05,
                    num_leaves=48,
                    subsample=0.9,
                    colsample_bytree=0.9,
                    random_state=42,
                    verbose=-1,
                ),
                train, test, "Gradient-boosted trees on log price with one-hot categoricals.", ["lightgbm"],
            ))
        except Exception as exc:
            add_model_result(results, "LightGBM", "failed", MODEL_RECS[1][1], packages=["lightgbm"], error=str(exc))
    else:
        add_model_result(results, "LightGBM", "dependency_missing", MODEL_RECS[1][1])

    if package_available("xgboost"):
        try:
            from xgboost import XGBRegressor
            results.append(run_tree_pipeline(
                "XGBoost",
                XGBRegressor(
                    n_estimators=450,
                    max_depth=6,
                    learning_rate=0.05,
                    subsample=0.9,
                    colsample_bytree=0.9,
                    objective="reg:squarederror",
                    random_state=42,
                    n_jobs=4,
                ),
                train, test, "Gradient-boosted trees on log price with one-hot categoricals.", ["xgboost"],
            ))
        except Exception as exc:
            add_model_result(results, "XGBoost", "failed", MODEL_RECS[1][1], packages=["xgboost"], error=str(exc))
    else:
        add_model_result(results, "XGBoost", "dependency_missing", MODEL_RECS[1][1])

    if package_available("sklearn"):
        try:
            from sklearn.ensemble import ExtraTreesRegressor, RandomForestRegressor
            results.append(run_tree_pipeline(
                "Random Forest",
                RandomForestRegressor(n_estimators=160, min_samples_leaf=2, random_state=42, n_jobs=-1),
                train, test, "Tree ensemble sanity check for discrete lookup-like behavior.", ["sklearn"],
            ))
            results.append(run_tree_pipeline(
                "Extra Trees",
                ExtraTreesRegressor(n_estimators=60, max_depth=24, min_samples_leaf=2, random_state=42, n_jobs=-1),
                train, test, "More randomized tree ensemble for interaction detection.", ["sklearn"],
            ))
        except Exception as exc:
            add_model_result(results, "Random Forest / Extra Trees", "failed", MODEL_RECS[2][1], packages=["sklearn"], error=str(exc))

        try:
            from sklearn.linear_model import Lasso, Ridge
            results.append(run_sklearn_log_model(
                "Ridge log-price",
                Ridge(alpha=1.0),
                train, test, "One-hot categorical log-price linear baseline.", ["sklearn"],
            ))
            results.append(run_sklearn_log_model(
                "Lasso log-price",
                Lasso(alpha=0.0005, max_iter=10000),
                train, test, "Sparse one-hot categorical log-price linear baseline.", ["sklearn"],
            ))
        except Exception as exc:
            add_model_result(results, "Ridge / Lasso on log price", "failed", MODEL_RECS[3][1], packages=["sklearn"], error=str(exc))

        try:
            results.append(run_lookup_residual_model(train, test))
        except Exception as exc:
            add_model_result(results, "Lookup + residual ML", "failed", MODEL_RECS[4][1], packages=["sklearn"], error=str(exc))
    else:
        add_model_result(results, "Random Forest / Extra Trees", "dependency_missing", MODEL_RECS[2][1])
        add_model_result(results, "Ridge / Lasso on log price", "dependency_missing", MODEL_RECS[3][1])
        add_model_result(results, "Lookup + residual ML", "dependency_missing", MODEL_RECS[4][1])

    return sorted(
        results,
        key=lambda item: (
            item["metrics"] is None,
            item["metrics"]["mape"] if item["metrics"] else float("inf"),
        ),
    )


def write_predict_js(global_rate):
    js = f"""// Generated by research/scripts/reconstruct-starsgem-pricing.py
// Minimal deterministic StarGem predictor. For full lookup data, load
// research/data/starsgem-pricing-intelligence.json and use the A-G fallback tables.
export function starsgemCaratBucket(carat) {{
  const c = Number(carat);
  if (c >= 0.30 && c <= 0.49) return '0.30-0.49';
  if (c >= 0.50 && c <= 0.69) return '0.50-0.69';
  if (c >= 0.70 && c <= 0.89) return '0.70-0.89';
  if (c >= 0.90 && c <= 0.99) return '0.90-0.99';
  if (c >= 1.00 && c <= 1.49) return '1.00-1.49';
  if (c >= 1.50 && c <= 1.99) return '1.50-1.99';
  if (c >= 2.00 && c <= 2.99) return '2.00-2.99';
  if (c >= 3.00 && c <= 3.99) return '3.00-3.99';
  if (c >= 4.00 && c <= 4.99) return '4.00-4.99';
  if (c >= 5.00 && c <= 9.99) return '5.00-9.99';
  if (c >= 10.00) return '10.00+';
  return '<0.30';
}}

export function predict_price(row, lookupTables = [], globalRate = {global_rate}) {{
  const carat = Number(row.Carat ?? row.carat);
  if (!Number.isFinite(carat) || carat <= 0) return null;
  const norm = value => {{
    const text = String(value ?? '-').trim().toUpperCase().replace(/\\s+/g, ' ');
    return text && text !== 'N/A' && text !== 'NONE' && text !== 'NULL' ? text : '-';
  }};
  const normalized = {{
    ...row,
    Carat: carat,
    carat_bucket: row.carat_bucket || starsgemCaratBucket(carat),
    Shape: norm(row.Shape ?? row.shape),
    Color: norm(row.Color ?? row.color),
    Clarity: norm(row.Clarity ?? row.clarity),
    TypeName: norm(row.TypeName ?? row.typeName ?? row.growthMethod),
    Report: norm(row.Report ?? row.report ?? 'IGI').includes('IGI') ? 'IGI' : norm(row.Report ?? row.report),
    Cut: norm(row.Cut ?? row.cut),
    Polish: norm(row.Polish ?? row.polish),
    Symmetry: norm(row.Symmetry ?? row.symmetry),
  }};
  for (const table of lookupTables || []) {{
    const key = table.fields.map(field => normalized[field] ?? '-').join('||');
    const hit = table.groups && table.groups[key];
    if (hit) {{
      const internalPrice = Math.round(carat * hit.rate);
      return {{ price: internalPrice / 170, internalPrice, rate: hit.rate, level: table.level, count: hit.count }};
    }}
  }}
  const internalPrice = Math.round(carat * globalRate);
  return {{ price: internalPrice / 170, internalPrice, rate: globalRate, level: 'GLOBAL', count: 0 }};
}}
"""
    with open(PREDICT_JS, "w", encoding="utf-8") as f:
        f.write(js)


def main():
    rows, headers = load_rows()
    train, test = split_train_test(rows)
    tables, global_rate = build_lookup(train)

    for row in train + test:
        internal, rate, level, fields, count = predict_internal(row, tables, global_rate)
        row["predicted_internal_price"] = internal
        row["predicted_price"] = internal / 170
        row["lookup_level"] = level
        row["lookup_count"] = count

    lookup_metrics = metrics(
        [r["SaleDollorPrice"] for r in test],
        [r["predicted_price"] for r in test],
    )
    by_level = dict(defaultdict(int))
    for row in test:
        by_level[row["lookup_level"]] = by_level.get(row["lookup_level"], 0) + 1

    gran = granularity(rows)
    write_lookup_csv(tables)
    write_residual_csv(test)
    write_predict_js(global_rate)

    top_lookup_rows = []
    level_a = tables[0]
    for key, value in sorted(level_a["groups"].items(), key=lambda item: (-item[1]["count"], item[0]))[:40]:
        parts = key.split("||")
        top_lookup_rows.append({
            "level": "A",
            "fields": dict(zip(level_a["fields"], parts)),
            "rate": value["rate"],
            "usdPerCt": value["usdPerCt"],
            "count": value["count"],
        })

    intel = {
        "generatedDate": str(date.today()),
        "sourceFile": os.path.basename(XLS_FILE),
        "rowCount": len(rows),
        "columnsInspected": [c for c in REQUIRED_COLUMNS if c in headers],
        "formula": {
            "likely": "SaleDollorPrice = round(Carat * median_internal_rate_per_ct_from_lookup) / 170",
            "internalPrice": "round(SaleDollorPrice * 170)",
            "notes": [
                "The 170 conversion factor is a deterministic granularity clue, not evidence of ML.",
                "The lookup rate is learned from medians because multiple rows can share a bucket with small supplier adjustments.",
                "Dimensions/proportions are best tested as residual features after the lookup baseline.",
            ],
        },
        "granularity": gran,
        "lookup": {
            "globalMedianInternalRatePerCt": global_rate,
            "levels": [{"level": level, "fields": fields} for level, fields in LOOKUP_LEVELS],
            "tables": tables,
            "topRows": top_lookup_rows,
        },
        "evaluation": {
            "split": "80/20 random seed 42",
            "lookupOnly": lookup_metrics,
            "lookupLevelCounts": by_level,
            "models": model_benchmarks(lookup_metrics, train, test),
        },
        "artifacts": {
            "lookupTableCsv": "research/data/starsgem-lookup-table.csv",
            "residualAnalysisCsv": "research/data/starsgem-residual-analysis.csv",
            "mlModelJson": "research/data/starsgem-ml-extra-trees-model.json",
            "predictJs": "research/starsgem-predict-price.js",
        },
    }

    with open(INTEL_JSON, "w", encoding="utf-8") as f:
        json.dump(intel, f, ensure_ascii=False, separators=(",", ":"))

    print(f"Rows analyzed: {len(rows):,}")
    print(f"Smallest strong granularity factor: {gran['smallestStrongFactor']}")
    print(f"Lookup-only test MAPE: {lookup_metrics['mape']}%")
    print(f"Lookup table: {LOOKUP_CSV}")
    print(f"Residual analysis: {RESIDUAL_CSV}")
    print(f"UI intelligence: {INTEL_JSON}")


if __name__ == "__main__":
    main()
