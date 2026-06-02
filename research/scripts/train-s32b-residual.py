#!/usr/bin/env python3
"""
Train S32-B — capped CatBoost residual on warm cells only.

Loads OOF residual targets computed by compute-s32b-residuals.mjs,
trains a conservative CatBoost model, and exports the JSON model.

Architecture (S32-B):
  log($/ct)_S32B = log($/ct)_S28
                 + clip(w_anchor * Δ_L, -A_cap, +A_cap)      [S32-A]
                 + w_resid * clip(CatBoost_residual, -R_cap, +R_cap)  [S32-B]

Usage:
  python3 research/scripts/train-s32b-residual.py
"""

from __future__ import annotations

import json
import math
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path
from statistics import mean, median

import numpy as np
from catboost import CatBoostRegressor, Pool

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
DATA_DIR = PROJECT_ROOT / "data"

RESIDUAL_JSON = DATA_DIR / "s32b-residual-targets.json"
S32A_MODEL_JSON = DATA_DIR / "starsgem-ml-model-s32a-anchors.json"
OUTPUT_MODEL_JSON = DATA_DIR / "starsgem-ml-model-s32b-residual.json"
OUTPUT_BENCHMARK_JSON = DATA_DIR / "benchmark-s32b-residual.json"

# ─── Configuration ───────────────────────────────────────────────────────────

RANDOM_SEED = 42
R_MIN = 10          # minimum full-cell support for residual
K_RESID = 15        # credibility K for residual weight
R_CAP = 0.15        # cap on residual (±15% in log space ≈ ±16% in price)

# CatBoost hyperparameters (conservative per proposal)
CB_ITERATIONS = 1200
CB_LEARNING_RATE = 0.02
CB_DEPTH = 4
CB_L2_LEAF_REG = 10
CB_RANDOM_STRENGTH = 2

COLOR_RANK = {"D": 0, "E": 1, "F": 2, "G": 3, "H": 4, "I": 5, "J": 6, "K": 7}
CLARITY_RANK = {"IF": 0, "VVS1": 1, "VVS2": 2, "VS1": 3, "VS2": 4, "SI1": 5, "SI2": 6}
MAX_COLOR_RANK = max(COLOR_RANK.values())
MAX_CLARITY_RANK = max(CLARITY_RANK.values())

CARAT_BANDS = [
    (1.00, 1.49, "1.00-1.49"),
    (1.50, 1.99, "1.50-1.99"),
    (2.00, 2.99, "2.00-2.99"),
    (3.00, 3.99, "3.00-3.99"),
    (4.00, 4.99, "4.00-4.99"),
    (5.00, 9.99, "5.00-9.99"),
    (10.00, 99.99, "10.00+"),
]

# ─── Feature preparation ─────────────────────────────────────────────────────

def prepare_features(rows: list[dict]) -> tuple[np.ndarray, np.ndarray, list, list]:
    """Prepare features and targets for CatBoost training.

    Returns:
        X: feature matrix
        y: target vector (yResid)
        cat_features: list of categorical feature names
        feature_names: list of all feature names
    """
    feature_rows = []
    targets = []

    for row in rows:
        carat = float(row["carat"])
        color = str(row.get("color", "")).strip().upper()
        clarity = str(row.get("clarity", "")).strip().upper()
        shape = str(row.get("shape_style", "round_standard")).strip().lower()
        cut = str(row.get("cut_raw", "-")).strip().upper()
        type_name = str(row.get("typeName", "CVD")).strip().upper()

        color_rank = COLOR_RANK.get(color, 3)
        clarity_rank = CLARITY_RANK.get(clarity, 3)

        features = {
            "log_carat": math.log(max(0.01, carat)),
            "color_goodness": MAX_COLOR_RANK - color_rank,      # higher = better
            "clarity_goodness": MAX_CLARITY_RANK - clarity_rank, # higher = better
            "shape_style": shape,
            "cut_grade": cut if cut in ("ID", "EX", "VG", "G", "GD") else "OTHER",
            "typeName": type_name if type_name in ("CVD", "HPHT") else "CVD",
            "lw_ratio": float(row.get("lw_ratio", 0) or 0),
            "table_pct": float(row.get("table_pct", 0) or 0),
            "depth_pct": float(row.get("depth_pct", 0) or 0),
            # Support features — help CatBoost learn when to be conservative
            "anchor_level": int(row.get("anchorLevel", 5) or 5),
            "n_full": int(row.get("nFull", 0) or 0),
            "anchor_n": int(row.get("anchorN", 0) or 0),
        }

        feature_rows.append(features)
        targets.append(float(row["yResid"]))

    # Build feature matrix with categorical features as strings
    cat_feature_names = ["shape_style", "cut_grade", "typeName"]
    numeric_feature_names = [
        "log_carat", "color_goodness", "clarity_goodness",
        "lw_ratio", "table_pct", "depth_pct",
        "anchor_level", "n_full", "anchor_n",
    ]
    all_feature_names = numeric_feature_names + cat_feature_names

    # CatBoost can handle categorical features natively as strings
    # We'll use Pool with cat_features indices
    X_rows = []
    for fr in feature_rows:
        row_vals = []
        for name in all_feature_names:
            val = fr.get(name, "")
            if name in numeric_feature_names:
                row_vals.append(float(val) if val != "" else 0.0)
            else:
                row_vals.append(str(val))
        X_rows.append(row_vals)

    X = np.array(X_rows, dtype=object)
    y = np.array(targets, dtype=np.float64)

    # Cat feature indices (columns after numeric features)
    cat_indices = [len(numeric_feature_names) + i for i in range(len(cat_feature_names))]

    return X, y, cat_indices, all_feature_names


# ─── Training ─────────────────────────────────────────────────────────────────

def main():
    print("─── S32-B CatBoost Residual Training ───\n")

    # Load OOF residuals
    with open(RESIDUAL_JSON) as f:
        residuals = json.load(f)
    print(f"Loaded {len(residuals)} OOF residual targets (n_full >= {R_MIN})")

    # Prepare features
    X, y, cat_indices, feature_names = prepare_features(residuals)
    print(f"Features: {len(feature_names)} total ({len(cat_indices)} categorical)")
    print(f"  Numeric: {[n for n in feature_names if n not in ('shape_style', 'cut_grade', 'typeName')]}")
    print(f"  Categorical: {['shape_style', 'cut_grade', 'typeName']}")

    # Target stats
    print(f"\nTarget (yResid) stats:")
    print(f"  mean={np.mean(y):.6f}  std={np.std(y):.6f}")
    print(f"  min={np.min(y):.6f}  max={np.max(y):.6f}")
    print(f"  p01={np.percentile(y, 1):.6f}  p99={np.percentile(y, 99):.6f}")
    print(f"  mean(abs)={np.mean(np.abs(y)):.6f}  median(abs)={np.median(np.abs(y)):.6f}")

    # Train/validation split (by reportHash-like determinism)
    # Use modulo 5 of row index as proxy for the standard split
    indices = np.arange(len(y))
    np.random.seed(RANDOM_SEED)
    np.random.shuffle(indices)
    train_idx = indices[:int(len(indices) * 0.8)]
    val_idx = indices[int(len(indices) * 0.8):]

    X_train, y_train = X[train_idx], y[train_idx]
    X_val, y_val = X[val_idx], y[val_idx]

    print(f"\nTrain: {len(train_idx)} rows, Val: {len(val_idx)} rows")

    # Create CatBoost Pools
    train_pool = Pool(X_train, y_train, cat_features=cat_indices)
    val_pool = Pool(X_val, y_val, cat_features=cat_indices)

    # Monotone constraints:
    # log_carat: 0 (no $/ct constraint — lab commodity can be non-monotone in $/ct)
    # color_goodness: +1 (better color → higher price)
    # clarity_goodness: +1 (better clarity → higher price)
    # All other features: 0
    # Indices correspond to the order in feature_names
    monotone_constraints = []
    for name in feature_names:
        if name == "color_goodness":
            monotone_constraints.append(1)
        elif name == "clarity_goodness":
            monotone_constraints.append(1)
        else:
            monotone_constraints.append(0)

    print(f"\nMonotone constraints: {dict(zip(feature_names, monotone_constraints))}")

    # Train CatBoost
    print(f"\nTraining CatBoostRegressor...")
    print(f"  iterations={CB_ITERATIONS}, lr={CB_LEARNING_RATE}, depth={CB_DEPTH}")
    print(f"  l2_leaf_reg={CB_L2_LEAF_REG}, random_strength={CB_RANDOM_STRENGTH}")

    model = CatBoostRegressor(
        loss_function="MAE",
        eval_metric="MAPE",
        iterations=CB_ITERATIONS,
        learning_rate=CB_LEARNING_RATE,
        depth=CB_DEPTH,
        l2_leaf_reg=CB_L2_LEAF_REG,
        random_strength=CB_RANDOM_STRENGTH,
        bootstrap_type="Bayesian",
        bagging_temperature=0.5,
        monotone_constraints=monotone_constraints,
        random_seed=RANDOM_SEED,
        verbose=100,
        allow_writing_files=False,
    )

    model.fit(train_pool, eval_set=val_pool, early_stopping_rounds=100)

    # Evaluation
    print(f"\n─── Model Evaluation ───")
    train_pred = model.predict(train_pool)
    val_pred = model.predict(val_pool)

    train_mape = np.mean(np.abs((train_pred - y_train) / np.maximum(1e-9, np.abs(y_train)))) * 100
    val_mape = np.mean(np.abs((val_pred - y_val) / np.maximum(1e-9, np.abs(y_val)))) * 100
    train_mae = np.mean(np.abs(train_pred - y_train))
    val_mae = np.mean(np.abs(val_pred - y_val))
    train_corr = np.corrcoef(train_pred, y_train)[0, 1]
    val_corr = np.corrcoef(val_pred, y_val)[0, 1]

    print(f"  Train: MAE={train_mae:.6f}  MAPE(on residual)={train_mape:.2f}%  corr={train_corr:.4f}")
    print(f"  Val:   MAE={val_mae:.6f}  MAPE(on residual)={val_mape:.2f}%  corr={val_corr:.4f}")

    # Feature importance
    importances = model.get_feature_importance()
    print(f"\nFeature importance:")
    for name, imp in sorted(zip(feature_names, importances), key=lambda x: -x[1]):
        print(f"  {name}: {imp:.4f}")

    # Cap analysis: how many predictions would be capped?
    raw_pred = model.predict(train_pool)
    capped_count = np.sum(np.abs(raw_pred) > R_CAP)
    print(f"\nResidual cap analysis (R_cap={R_CAP}):")
    print(f"  {capped_count}/{len(raw_pred)} ({100*capped_count/len(raw_pred):.1f}%) predictions would be capped")
    print(f"  mean(raw)={np.mean(raw_pred):.6f}  std(raw)={np.std(raw_pred):.6f}")

    # Export model as JSON
    print(f"\n─── Exporting Model ───")

    # Save CatBoost model as JSON
    model_json_path = DATA_DIR / "s32b-catboost-model.json"
    model.save_model(str(model_json_path), format="json")
    print(f"CatBoost model saved to {model_json_path.name}")

    # Build S32-B artifact metadata
    artifact = {
        "generatedDate": date.today().isoformat(),
        "modelName": "S32-B — S32-A anchors + capped CatBoost residual",
        "modelVersion": "s32b-residual-v0.1",
        "targetType": "surface_plus_anchors_plus_residual",
        "catboostModelPath": str(model_json_path.name),
        "hyperparameters": {
            "r_min": R_MIN,
            "K_resid": K_RESID,
            "R_cap": R_CAP,
            "cb_iterations": CB_ITERATIONS,
            "cb_learning_rate": CB_LEARNING_RATE,
            "cb_depth": CB_DEPTH,
            "cb_l2_leaf_reg": CB_L2_LEAF_REG,
            "cb_random_strength": CB_RANDOM_STRENGTH,
        },
        "features": {
            "numeric": [n for n in feature_names if n not in ("shape_style", "cut_grade", "typeName")],
            "categorical": ["shape_style", "cut_grade", "typeName"],
        },
        "monotone_constraints": dict(zip(feature_names, monotone_constraints)),
        "metrics": {
            "train_mae": float(train_mae),
            "val_mae": float(val_mae),
            "train_mape_on_residual": float(train_mape),
            "val_mape_on_residual": float(val_mape),
            "train_corr": float(train_corr),
            "val_corr": float(val_corr),
            "pct_capped": float(100 * capped_count / len(raw_pred)),
        },
    }

    with open(OUTPUT_MODEL_JSON, "w") as f:
        json.dump(artifact, f, indent=2)
        f.write("\n")
    print(f"S32-B artifact written to {OUTPUT_MODEL_JSON.name}")

    # Write benchmark
    benchmark = {
        "date": date.today().isoformat(),
        "model": artifact["modelVersion"],
        "phase": "S32-B",
        "hyperparameters": artifact["hyperparameters"],
        "features": artifact["features"],
        "metrics": artifact["metrics"],
        "feature_importance": {name: float(imp) for name, imp in zip(feature_names, importances)},
    }

    with open(OUTPUT_BENCHMARK_JSON, "w") as f:
        json.dump(benchmark, f, indent=2)
        f.write("\n")
    print(f"Benchmark written to {OUTPUT_BENCHMARK_JSON.name}")

    # Recommendation
    val_improvement = val_corr > 0.05
    print(f"\n─── S32-B Assessment ───")
    if val_improvement:
        print(f"CatBoost residual shows meaningful signal (val corr={val_corr:.4f}).")
        print(f"Proceed to integrate with S32-A artifact and benchmark.")
    else:
        print(f"WARNING: CatBoost residual shows weak signal (val corr={val_corr:.4f}).")
        print(f"Consider skipping S32-B or increasing r_min.")

    print(f"\nDone.")


if __name__ == "__main__":
    main()
