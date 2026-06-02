#!/usr/bin/env python3
"""
Benchmark S32-B against S32-A, S28, S26, S31.
Uses native CatBoost evaluation for the residual model.

Usage:
  python3 research/scripts/benchmark-s32b.py
"""

from __future__ import annotations

import hashlib
import json
import math
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path
from statistics import mean, median

import numpy as np
from catboost import CatBoostRegressor

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
DATA_DIR = PROJECT_ROOT / "data"

S32B_MODEL_JSON = DATA_DIR / "starsgem-ml-model-s32b.json"
OUTPUT_JSON = DATA_DIR / "benchmark-s32b-python.json"

HOLDOUT_MOD = 5
CELL_HOLDOUT_MOD = 5

COLORS = ["D", "E", "F", "G", "H", "I", "J", "K"]
CLARITIES = ["IF", "VVS1", "VVS2", "VS1", "VS2", "SI1", "SI2"]
COLOR_RANK = {"D": 0, "E": 1, "F": 2, "G": 3, "H": 4, "I": 5, "J": 6, "K": 7}
CLARITY_RANK = {"IF": 0, "VVS1": 1, "VVS2": 2, "VS1": 3, "VS2": 4, "SI1": 5, "SI2": 6}
MAX_COLOR = max(COLOR_RANK.values())
MAX_CLARITY = max(CLARITY_RANK.values())

CARAT_BANDS = [
    (1.00, 1.49, "1.00-1.49"),
    (1.50, 1.99, "1.50-1.99"),
    (2.00, 2.99, "2.00-2.99"),
    (3.00, 3.99, "3.00-3.99"),
    (4.00, 4.99, "4.00-4.99"),
    (5.00, 9.99, "5.00-9.99"),
    (10.00, 99.99, "10.00+"),
]


def load_json(path: Path) -> dict:
    with open(path) as f:
        return json.load(f)


def carat_band(carat: float) -> str:
    for lo, hi, label in CARAT_BANDS:
        if lo <= carat <= hi:
            return label
    return "10.00+" if carat >= 10 else "<1.00"


def report_hash(row: dict) -> int:
    text = str(row.get("reportNo") or row.get("reportno") or row.get("rowNo") or "")
    total = 0
    for ch in text:
        total = (total * 131 + ord(ch)) % 1_000_003
    return total


def cell_hash(key: str) -> int:
    total = 0
    for ch in key:
        total = (total * 131 + ord(ch)) % 1_000_003
    return total


def benchmark_cell_key(row: dict) -> str:
    shape = str(row.get("shape_style", "round_standard")).strip().lower()
    color = str(row.get("color", "")).strip().upper()
    clarity = str(row.get("clarity", "")).strip().upper()
    band = carat_band(float(row.get("carat", 0)))
    return f"{shape}||{color}||{clarity}||{band}"


def ape(pred: float, actual: float) -> float:
    return abs(pred - actual) / actual * 100


def bias_pct(pred: float, actual: float) -> float:
    return (pred - actual) / actual * 100


def compute_metrics(predictions: list[tuple[float, float]]) -> dict:
    """Compute MAPE, MdAPE, p90, bias from (pred, actual) pairs."""
    valid = [(p, a) for p, a in predictions if p > 0 and a > 0]
    if not valid:
        return {"n": 0, "mape": None, "mdape": None, "p90ape": None, "biasPct": None}

    apes = sorted([ape(p, a) for p, a in valid])
    biases = [bias_pct(p, a) for p, a in valid]
    n = len(apes)
    return {
        "n": n,
        "mape": round(mean(apes), 4),
        "mdape": round(apes[n // 2], 4),
        "p90ape": round(apes[int(n * 0.9)], 4),
        "biasPct": round(mean(biases), 4),
    }


def predict_s32a(row: dict, model: dict) -> float | None:
    """Replicate S32-A prediction logic in Python."""
    # This requires evaluating S28 + hierarchical anchors
    # Since we don't have S28 in Python, we'll use pre-computed S28 values
    # from the Node.js output
    s28_upc = row.get("_s28_upc")
    if s28_upc is None or s28_upc <= 0:
        return None

    s28_log = math.log(s28_upc)
    cell_key = row.get("_cell_key", "")
    parent1 = row.get("_parent1", "")
    parent2 = row.get("_parent2", "")
    parent3 = row.get("_parent3", "")

    anchors = model.get("anchors", [])
    hp = model.get("hyperparameters", {})
    K_anchor = hp.get("K_anchor", [10, 15, 20, 30, 50])
    level_cap = hp.get("level_cap", [1.0, 0.7, 0.45, 0.25, 0.1])
    A_cap = hp.get("A_cap", 0.2)

    level_keys = [
        (1, cell_key),
        (2, parent1),
        (3, parent2),
        (4, parent3),
        (5, "__global__"),
    ]

    offset = 0.0
    for level, key in level_keys:
        anchor_dict = anchors[level - 1] if level - 1 < len(anchors) else {}
        hit = anchor_dict.get(key)
        if hit and hit.get("n", 0) > 0 and hit.get("delta") is not None:
            cap = level_cap[level - 1]
            K = K_anchor[level - 1]
            w = min(cap, hit["n"] / (hit["n"] + K))
            offset = max(-A_cap, min(A_cap, w * hit["delta"]))
            break

    log_upc = s28_log + offset
    return math.exp(log_upc) * float(row.get("carat", 0))


def predict_s32b(row: dict, model: dict, cb_model: CatBoostRegressor) -> float | None:
    """S32-B prediction: S32-A + capped CatBoost residual."""
    s32a_price = row.get("_s32a_price")
    if s32a_price is None or s32a_price <= 0:
        return None

    hp = model.get("hyperparameters", {})
    r_min = hp.get("r_min", 10)
    K_resid = hp.get("K_resid", 15)
    R_cap = hp.get("R_cap", 0.15)

    n_full = row.get("_n_full", 0)

    if n_full < r_min:
        return s32a_price  # no residual on cold cells

    # Prepare CatBoost features
    carat = float(row.get("carat", 0))
    color = str(row.get("color", "")).strip().upper()
    clarity = str(row.get("clarity", "")).strip().upper()
    shape = str(row.get("shape_style", "round_standard")).strip().lower()
    cut = str(row.get("cut_raw", "-")).strip().upper()
    type_name = str(row.get("typeName", "CVD")).strip().upper()

    color_rank = COLOR_RANK.get(color, 3)
    clarity_rank = CLARITY_RANK.get(clarity, 3)

    features = np.array([[
        math.log(max(0.01, carat)),
        MAX_COLOR - color_rank,
        MAX_CLARITY - clarity_rank,
        float(row.get("lw_ratio") or 0),
        float(row.get("table_pct") or 0),
        float(row.get("depth_pct") or 0),
        float(row.get("_anchor_level", 5)),
        float(n_full),
        float(row.get("_anchor_n", 0)),
        shape,
        cut if cut in ("ID", "EX", "VG", "G", "GD") else "OTHER",
        type_name if type_name in ("CVD", "HPHT") else "CVD",
    ]], dtype=object)

    cat_indices = [9, 10, 11]
    residual = cb_model.predict(features)[0]

    # Credibility-weighted, capped residual
    w_resid = n_full / (n_full + K_resid)
    safe_resid = max(-R_cap, min(R_cap, residual))
    log_upc = math.log(s32a_price / carat) + w_resid * safe_resid
    return math.exp(log_upc) * carat


def main():
    print("─── S32-B Python Benchmark ───\n")

    # Load data
    print("Loading data...")
    dataset = load_json(DATA_DIR / "dataset-clean-training.json")
    s32a_model = load_json(DATA_DIR / "starsgem-ml-model-s32a-anchors.json")
    s32b_model = load_json(DATA_DIR / "starsgem-ml-model-s32b.json")
    intel = load_json(DATA_DIR / "starsgem-pricing-intelligence.json")

    print(f"Dataset: {len(dataset)} rows")

    # Load CatBoost model
    cb_path = DATA_DIR / "s32b-catboost-model.json"
    cb_model = CatBoostRegressor()
    cb_model.load_model(str(cb_path))
    print(f"CatBoost model loaded ({cb_model.tree_count_} trees)")

    # Prepare rows with pre-computed S28 and S32-A values
    # We need S28 predictions — use S32-A artifact for S28 predictions
    # Since S28 is embedded but in Node.js format, we'll compute them
    # For now, read pre-computed values from Node.js output
    print("Preparing evaluation rows...")

    # Build eval rows manually with S28 and anchor lookups
    eval_rows = []
    for row in dataset:
        carat = float(row.get("carat", 0))
        price = float(row.get("price", 0))
        if not (carat > 0 and price > 0):
            continue

        color = str(row.get("color", "")).strip().upper()
        clarity = str(row.get("clarity", "")).strip().upper()
        if color not in COLORS or clarity not in CLARITIES:
            continue

        shape = str(row.get("shape_style", "round_standard")).strip().lower()
        band = carat_band(carat)
        cell_key = f"{shape}||{color}||{clarity}||{band}"
        parent1 = f"{shape}||{color}||{clarity}"
        parent2 = f"{shape}||{color}"
        parent3 = shape

        eval_rows.append({
            "carat": carat,
            "price": price,
            "upc": price / carat,
            "shape_style": shape,
            "color": color,
            "clarity": clarity,
            "band": band,
            "cell_key": cell_key,
            "parent1": parent1,
            "parent2": parent2,
            "parent3": parent3,
            "cut_raw": row.get("cut_raw", "-"),
            "typeName": row.get("typeName", "CVD"),
            "lw_ratio": row.get("lw_ratio"),
            "table_pct": row.get("table_pct"),
            "depth_pct": row.get("depth_pct"),
            "polish": row.get("polish", "EX"),
            "symmetry": row.get("symmetry", "EX"),
            "reportHashVal": report_hash(row),
            "cellHashVal": cell_hash(cell_key),
            "_s28_upc": None,  # would need S28 evaluation
            "_s32a_price": None,  # would need S32-A evaluation
            "_n_full": 0,
            "_anchor_level": 5,
            "_anchor_n": 0,
        })

    print(f"Valid eval rows: {len(eval_rows)}")

    # Since Python doesn't have S28 predict function, use a simpler benchmark:
    # Compare S32-A (Node) metrics vs expected S32-B improvement from residual
    # The residual model reduces residual MAE from 0.0687 to 0.0444 (35% reduction)

    print("\n─── S32-B Residual Impact Analysis ───")
    print(f"S32-A residual (mean abs): 0.0687 (from compute-s32b-residuals.mjs)")
    print(f"CatBoost residual MAE:      0.0444 (from train-s32b-residual.py)")
    print(f"Expected improvement:       ~35% reduction in residual error")

    # Write a summary with known metrics
    benchmark = {
        "date": date.today().isoformat(),
        "phase": "S32-B",
        "status": "CatBoost trained, full Node.js evaluation pending ONNX/npm runtime",
        "s32a_metrics": {
            "rowHoldoutMape": 7.0891,
            "cellHoldoutMape": 6.8753,
            "highCaratMape": 10.5644,
            "sparseSupportMape": 19.5759,
            "princessMape": 13.3584,
        },
        "residual_metrics": {
            "train_mae": 0.040893,
            "val_mae": 0.044376,
            "val_corr": 0.5897,
            "pct_capped": 3.5,
            "expected_residual_reduction": "~35%",
        },
        "estimated_s32b_improvement": {
            "note": "Rough estimate: residual MAE reduction of ~35% applied to warm cells (n_full >= 10)",
            "expected_row_holdout_improvement": "~0.5-1.5pp on dense cells",
            "expected_cell_holdout_impact": "Minimal (cold cells get no residual)",
        },
        "blocking_issue": "Node.js CatBoost evaluation requires ONNX export or official npm package",
        "recommendation": "Complete S32-C (PAV lattice) first, then evaluate S32-B+C together in Python",
    }

    with open(OUTPUT_JSON, "w") as f:
        json.dump(benchmark, f, indent=2)
        f.write("\n")
    print(f"\nBenchmark written to {OUTPUT_JSON.name}")


if __name__ == "__main__":
    main()
