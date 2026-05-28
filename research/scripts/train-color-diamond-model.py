#!/usr/bin/env python3
"""Train a source-adjusted fancy-color diamond pricing model.

Training target is StarGem-like factory pricing:
  - Messi color rows are divided by SOURCE_ADJUSTMENT_MESSI_TO_STARGEM.
  - Direct StarGem color anchors are used at face value.
"""

from __future__ import annotations

import json
import math
import os
import random
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path
from statistics import median

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
DATA_DIR = PROJECT_ROOT / "data"

MESSI_COLOR_INDEX = DATA_DIR / "messi-color-index.json"
STARSGEM_COLOR_INDEX = DATA_DIR / "starsgem-color-index.json"
MODEL_JSON = DATA_DIR / "color-diamond-ml-model.json"
RESULTS_JSON = DATA_DIR / "color-diamond-ml-results.json"
RESULTS_MD = PROJECT_ROOT / "color-diamond-ml-results.md"

SOURCE_ADJUSTMENT_MESSI_TO_STARGEM = 1.25

CATEGORICAL_FEATURES = [
    "shape",
    "subVariant",
    "color",
    "colorHue",
    "colorIntensity",
    "appColorKey",
    "clarity",
    "growthMethod",
    "cut",
    "polish",
    "symmetry",
    "fluorescence",
    "treatmentGroup",
    "diamondType",
    "certShapeMapped",
]

NUMERIC_FEATURES = [
    "carat",
    "logCarat",
    "colorIntensityRank",
    "modifierCount",
    "lwRatio",
    "size1",
    "size2",
    "size3",
    "tablePct",
    "depthPct",
    "IGI_Enriched",
    "IGI_IsTypeIIa",
    "isLargeCarat",
    "is10ctPlus",
]

VALIDATION_BUCKET_FIELDS = ["sourceTrainingType", "colorHue", "colorIntensity", "shape", "clarity", "caratBucket"]


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def clean_cat(value) -> str:
    text = str(value or "").strip()
    return text if text else "-"


def safe_float(value):
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n if math.isfinite(n) else None


def carat_bucket(carat: float) -> str:
    bands = [
        (1.0, 1.49, "1.00-1.49"),
        (1.5, 1.99, "1.50-1.99"),
        (2.0, 2.99, "2.00-2.99"),
        (3.0, 3.99, "3.00-3.99"),
        (4.0, 4.99, "4.00-4.99"),
        (5.0, 9.99, "5.00-9.99"),
    ]
    for lo, hi, label in bands:
        if lo <= carat <= hi:
            return label
    if carat >= 10:
        return "10.00+"
    return "<1.00"


def treatment_group(value) -> str:
    text = str(value or "").lower()
    if not text:
        return "-"
    if "as grown" in text or "no indication" in text:
        return "as_grown"
    if "may include" in text:
        return "may_include_treatment"
    if "post-growth" in text or "post growth" in text:
        return "post_growth"
    return "other"


def normalize_record(row: dict, source: str) -> dict | None:
    carat = safe_float(row.get("carat"))
    price = safe_float(row.get("pricePerStone"))
    if not carat or carat <= 0 or not price or price <= 0:
        return None

    igi = row.get("igi") if isinstance(row.get("igi"), dict) else {}
    is_starsgem = source == "starsgem_color"
    source_adjustment = 1.0 if is_starsgem else SOURCE_ADJUSTMENT_MESSI_TO_STARGEM
    adjusted_price = price / source_adjustment
    modifiers = row.get("colorModifiers") or []

    out = {
        "source": source,
        "sourceTrainingType": "direct_starsgem" if is_starsgem else "messi_source_adjusted",
        "sourceAdjustmentFactor": source_adjustment,
        "reportNo": row.get("reportNo"),
        "shape": clean_cat(row.get("shape")),
        "subVariant": clean_cat(row.get("subVariant")),
        "color": clean_cat(row.get("color")),
        "colorHue": clean_cat(row.get("colorHue")),
        "colorIntensity": clean_cat(row.get("colorIntensity")),
        "appColorKey": clean_cat(row.get("appColorKey")),
        "clarity": clean_cat(row.get("clarity")),
        "growthMethod": clean_cat(igi.get("growthMethod") or row.get("growthMethod")),
        "cut": clean_cat(igi.get("cut") or row.get("cut")),
        "polish": clean_cat(igi.get("polish") or row.get("polish")),
        "symmetry": clean_cat(igi.get("symmetry") or row.get("symmetry")),
        "fluorescence": clean_cat(igi.get("fluorescence") or row.get("fluorescence")),
        "treatmentGroup": treatment_group(igi.get("treatment") or row.get("treatment")),
        "diamondType": clean_cat(igi.get("diamondType")),
        "certShapeMapped": clean_cat(igi.get("shapeMapped")),
        "carat": carat,
        "logCarat": math.log(carat),
        "caratBucket": carat_bucket(carat),
        "colorIntensityRank": safe_float(row.get("colorIntensityRank")) or 1.0,
        "modifierCount": float(len(modifiers)),
        "lwRatio": safe_float(igi.get("lwRatio")) or safe_float(row.get("lwRatio")),
        "size1": safe_float(igi.get("size1")) or safe_float(row.get("size1")),
        "size2": safe_float(igi.get("size2")) or safe_float(row.get("size2")),
        "size3": safe_float(igi.get("size3")) or safe_float(row.get("size3")),
        "tablePct": safe_float(igi.get("tablePct")) or safe_float(row.get("tablePct")),
        "depthPct": safe_float(igi.get("depthPct")) or safe_float(row.get("depthPct")),
        "IGI_Enriched": 1.0 if igi.get("status") == "ok" else 0.0,
        "IGI_IsTypeIIa": 1.0 if igi.get("diamondType") == "Type IIa" else 0.0,
        "isLargeCarat": 1.0 if carat >= 5.0 else 0.0,
        "is10ctPlus": 1.0 if carat >= 10.0 else 0.0,
        "rawPricePerStone": price,
        "rawPricePerCarat": price / carat,
        "sourceAdjustedPricePerStone": adjusted_price,
        "sourceAdjustedPricePerCarat": adjusted_price / carat,
        "targetLogRate": math.log(adjusted_price / carat),
    }
    return out


def load_rows() -> list[dict]:
    rows = []
    for path, source in ((MESSI_COLOR_INDEX, "messi_color"), (STARSGEM_COLOR_INDEX, "starsgem_color")):
        data = load_json(path)
        for row in data.get("records", []):
            norm = normalize_record(row, source)
            if norm:
                rows.append(norm)
    return rows


def split_train_test(rows: list[dict], seed: int = 42) -> tuple[list[dict], list[dict]]:
    rng = random.Random(seed)
    groups = defaultdict(list)
    for row in rows:
        key = tuple(row.get(field) for field in VALIDATION_BUCKET_FIELDS)
        groups[key].append(row)

    train, test = [], []
    for group_rows in groups.values():
        shuffled = list(group_rows)
        rng.shuffle(shuffled)
        if len(shuffled) >= 3:
            test.append(shuffled[0])
            train.extend(shuffled[1:])
        else:
            train.extend(shuffled)

    # Always keep direct StarGem anchors in training; score them separately as in-sample anchors.
    moved = [r for r in test if r["source"] == "starsgem_color"]
    if moved:
        train.extend(moved)
        test = [r for r in test if r["source"] != "starsgem_color"]
    return train, test


def frame(rows: list[dict]):
    import pandas as pd

    cols = CATEGORICAL_FEATURES + NUMERIC_FEATURES
    return pd.DataFrame([{col: row.get(col) for col in cols} for row in rows])


def mape(actual, pred):
    vals = []
    for a, p in zip(actual, pred):
        if a:
            vals.append(abs(p - a) / abs(a))
    return sum(vals) / len(vals) if vals else None


def median_ape(actual, pred):
    vals = [abs(p - a) / abs(a) for a, p in zip(actual, pred) if a]
    return median(vals) if vals else None


def summarize_predictions(rows: list[dict], preds: list[float]) -> dict:
    actual = [r["sourceAdjustedPricePerStone"] for r in rows]
    by_source = {}
    for source in sorted(set(r["source"] for r in rows)):
        idx = [i for i, r in enumerate(rows) if r["source"] == source]
        by_source[source] = {
            "count": len(idx),
            "mape": mape([actual[i] for i in idx], [preds[i] for i in idx]),
            "medianApe": median_ape([actual[i] for i in idx], [preds[i] for i in idx]),
        }
    return {
        "count": len(rows),
        "mape": mape(actual, preds),
        "medianApe": median_ape(actual, preds),
        "bySource": by_source,
    }


def round_float(value, places=8):
    if value is None:
        return None
    return round(float(value), places)


def round_list(values, places=8):
    return [round_float(v, places) for v in values]


def export_model(pipe, metrics: dict):
    pre = pipe.named_steps["pre"]
    model = pipe.named_steps["model"]
    encoder = pre.named_transformers_["cat"].named_steps["onehot"]
    imputer = pre.named_transformers_["num"]

    categories = {
        feature: [str(v) for v in cats]
        for feature, cats in zip(CATEGORICAL_FEATURES, encoder.categories_)
    }
    numeric_medians = {
        feature: round_float(value)
        for feature, value in zip(NUMERIC_FEATURES, imputer.statistics_)
    }

    trees = []
    for estimator in model.estimators_:
        t = estimator.tree_
        trees.append({
            "childrenLeft": t.children_left.astype(int).tolist(),
            "childrenRight": t.children_right.astype(int).tolist(),
            "feature": t.feature.astype(int).tolist(),
            "threshold": round_list(t.threshold),
            "value": round_list(t.value[:, 0, 0]),
        })

    out = {
        "generatedDate": str(date.today()),
        "modelName": "color-diamond-source-adjusted-extra-trees-v1",
        "target": "log(sourceAdjustedPricePerStone / carat)",
        "prediction": "exp(mean(tree_log_rate_predictions)) * carat",
        "targetType": "log_rate",
        "sourceAdjustment": {
            "messiColorToStarsgemLikeFactor": SOURCE_ADJUSTMENT_MESSI_TO_STARGEM,
            "starsgemDirectFactor": 1.0,
            "notes": "Messi color rows are source-adjusted to StarGem-like factory pricing; direct StarGem anchors are unadjusted.",
        },
        "features": {
            "categorical": CATEGORICAL_FEATURES,
            "numeric": NUMERIC_FEATURES,
            "categories": categories,
            "numericMedians": numeric_medians,
        },
        "metrics": metrics,
        "treeCount": len(trees),
        "trees": trees,
    }
    with MODEL_JSON.open("w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
        f.write("\n")
    return out


def write_report(rows, train, test, metrics, anchor_rows, anchor_preds):
    source_counts = Counter(r["source"] for r in rows)
    hue_counts = Counter(r["colorHue"] for r in rows)
    lines = [
        "# Color Diamond ML Results",
        "",
        f"Document date: {date.today()}",
        "",
        "## Summary",
        "",
        f"- Training rows total: {len(rows):,}",
        f"- Messi color source-adjusted rows: {source_counts.get('messi_color', 0):,}",
        f"- Direct StarGem color anchor rows: {source_counts.get('starsgem_color', 0):,}",
        f"- Messi source adjustment: divide by {SOURCE_ADJUSTMENT_MESSI_TO_STARGEM:.2f}",
        f"- Validation rows: {len(test):,}",
        f"- Validation MAPE: {metrics['validation']['mape'] * 100:.2f}%",
        f"- Validation MdAPE: {metrics['validation']['medianApe'] * 100:.2f}%",
        "",
        "## Coverage By Hue",
        "",
        "| Hue | Rows |",
        "|---|---:|",
    ]
    for hue, count in hue_counts.most_common():
        lines.append(f"| {hue} | {count:,} |")

    lines += [
        "",
        "## Direct StarGem Anchors",
        "",
        "| Report | Spec | Actual | Predicted | Error |",
        "|---|---|---:|---:|---:|",
    ]
    for row, pred in zip(anchor_rows, anchor_preds):
        actual = row["sourceAdjustedPricePerStone"]
        err = (pred / actual - 1) if actual else 0
        spec = f"{row['carat']:.2f}ct {row['shape']} {row['color']} {row['clarity']}"
        lines.append(f"| {row.get('reportNo')} | {spec} | ${actual:,.0f} | ${pred:,.0f} | {err:+.1%} |")

    lines += [
        "",
        "## Files",
        "",
        f"- Model: `research/data/{MODEL_JSON.name}`",
        f"- Metrics: `research/data/{RESULTS_JSON.name}`",
        f"- Messi enriched color index: `research/data/{MESSI_COLOR_INDEX.name}`",
        f"- StarGem color anchors: `research/data/{STARSGEM_COLOR_INDEX.name}`",
        "",
        "## Interpretation",
        "",
        "This model estimates a StarGem-like fancy-color factory surface. It does not overwrite raw Messi prices; it divides Messi rows by the measured temporary supplier factor and leaves direct StarGem anchors at face value.",
        "",
        "Use this as an overlay/fallback until a larger StarGem color quote sheet exists. Large rare-color stones should still carry a direct-quote warning.",
    ]
    RESULTS_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    from sklearn.compose import ColumnTransformer
    from sklearn.ensemble import ExtraTreesRegressor
    from sklearn.impute import SimpleImputer
    from sklearn.metrics import mean_absolute_error, r2_score
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder

    rows = load_rows()
    train, test = split_train_test(rows)

    pre = ColumnTransformer([
        ("cat", Pipeline([
            ("impute", SimpleImputer(strategy="constant", fill_value="-")),
            ("onehot", OneHotEncoder(handle_unknown="ignore", sparse_output=False)),
        ]), CATEGORICAL_FEATURES),
        ("num", SimpleImputer(strategy="median"), NUMERIC_FEATURES),
    ])
    model = ExtraTreesRegressor(
        n_estimators=120,
        criterion="absolute_error",
        min_samples_leaf=2,
        max_features=0.75,
        random_state=42,
        n_jobs=-1,
    )
    pipe = Pipeline([("pre", pre), ("model", model)])

    x_train = frame(train)
    y_train = [r["targetLogRate"] for r in train]
    weights = [10.0 if r["source"] == "starsgem_color" else 1.0 for r in train]
    pipe.fit(x_train, y_train, model__sample_weight=weights)

    def predict_price(eval_rows):
        log_rates = pipe.predict(frame(eval_rows))
        return [math.exp(log_rate) * row["carat"] for log_rate, row in zip(log_rates, eval_rows)]

    train_preds = predict_price(train)
    test_preds = predict_price(test)
    anchor_rows = [r for r in rows if r["source"] == "starsgem_color"]
    anchor_preds = predict_price(anchor_rows)

    actual_test = [r["sourceAdjustedPricePerStone"] for r in test]
    metrics = {
        "sourceAdjustment": {
            "messiColorToStarsgemLikeFactor": SOURCE_ADJUSTMENT_MESSI_TO_STARGEM,
            "starsgemDirectFactor": 1.0,
        },
        "rowCounts": {
            "all": len(rows),
            "train": len(train),
            "validation": len(test),
            **{f"source_{k}": v for k, v in Counter(r["source"] for r in rows).items()},
        },
        "validation": {
            **summarize_predictions(test, test_preds),
            "mae": mean_absolute_error(actual_test, test_preds) if test else None,
            "r2": r2_score(actual_test, test_preds) if len(test) > 1 else None,
        },
        "train": summarize_predictions(train, train_preds),
        "directStarGemAnchorsInSample": summarize_predictions(anchor_rows, anchor_preds),
    }

    export_model(pipe, metrics)
    with RESULTS_JSON.open("w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)
        f.write("\n")
    write_report(rows, train, test, metrics, anchor_rows, anchor_preds)

    print(f"Rows: {len(rows):,} ({Counter(r['source'] for r in rows)})")
    print(f"Train: {len(train):,}; validation: {len(test):,}")
    print(f"Validation MAPE: {metrics['validation']['mape'] * 100:.2f}%")
    print(f"Validation MdAPE: {metrics['validation']['medianApe'] * 100:.2f}%")
    print(f"Direct StarGem anchor in-sample MAPE: {metrics['directStarGemAnchorsInSample']['mape'] * 100:.2f}%")
    print(f"Model -> {MODEL_JSON}")
    print(f"Results -> {RESULTS_JSON}")
    print(f"Report -> {RESULTS_MD}")


if __name__ == "__main__":
    main()
