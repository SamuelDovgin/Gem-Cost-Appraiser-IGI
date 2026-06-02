#!/usr/bin/env python3
"""
Train S28 — a single monotone parametric trend surface.

This is a prototype challenger to the S26 champion hybrid. It deliberately does
not blend model families. It fits one log($/ct) surface from StarGem rows while
projecting coefficients so ordered diamond attributes cannot invert.

Usage:
  python3 research/scripts/train-s28-monotone-parametric.py
"""

from __future__ import annotations

import json
import math
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path
from statistics import mean, median

import numpy as np

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
DATA_DIR = PROJECT_ROOT / "data"

TRAINING_JSON = DATA_DIR / "dataset-clean-training.json"
OUTPUT_JSON = DATA_DIR / "starsgem-ml-model-s28-monotone-parametric.json"
MODEL_VERSION = "s28-monotone-parametric-v0.4-grade-premium-no-vintage"

RIDGE_LAMBDA = 0.018
ITERATIONS = 6000
HOLDOUT_MOD = 5
MIN_RAW_CARAT_LOG_SLOPE = 0.02

COLOR_RANK = {
    "D": 0,
    "E": 1,
    "F": 2,
    "G": 3,
    "H": 4,
    "I": 5,
    "J": 6,
    "K": 7,
}

CLARITY_RANK = {
    "IF": 0,
    "VVS1": 1,
    "VVS": 1.5,
    "VVS2": 2,
    "VS1": 3,
    "VS": 3.5,
    "VS2": 4,
    "SI1": 5,
    "SI2": 6,
}

MAX_COLOR_RANK = max(COLOR_RANK.values())
MAX_CLARITY_RANK = max(CLARITY_RANK.values())
SHAPE_FALLBACK = "round"
MAGIC_THRESHOLDS = [1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 10.0, 20.0]
VINTAGE_KNOTS = [0.2, 0.4, 0.6, 0.8]
MIN_INTERACTION_ROWS = 100


def finite_float(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def norm(value):
    return str(value or "").strip().upper()


def normalize_cut(raw):
    text = norm(raw)
    if text in ("ID", "IDEAL"):
        return "ID"
    if text in ("EX", "EXCELLENT"):
        return "EX"
    if text in ("VG", "VERY GOOD"):
        return "VG"
    if text in ("G", "GD", "GOOD"):
        return "G"
    return "-"


def report_hash(row):
    text = str(row.get("reportNo") or row.get("reportno") or row.get("rowNo") or "")
    total = 0
    for ch in text:
        total = (total * 131 + ord(ch)) % 1_000_003
    return total


def load_rows():
    records = json.loads(TRAINING_JSON.read_text())
    rows = []
    for row in records:
        carat = finite_float(row.get("carat"))
        upc = finite_float(row.get("upc"))
        color = norm(row.get("color"))
        clarity = norm(row.get("clarity"))
        if not carat or carat <= 0 or not upc or upc <= 0:
            continue
        if color not in COLOR_RANK or clarity not in CLARITY_RANK:
            continue
        shape = str(row.get("shape_style") or row.get("shape") or SHAPE_FALLBACK).strip().lower() or SHAPE_FALLBACK
        cut = normalize_cut(row.get("cut_raw"))
        rows.append(
            {
                "rowNo": int(row.get("rowNo") or 0),
                "reportNo": row.get("reportno"),
                "shape": shape,
                "cut": cut,
                "carat": carat,
                "logCarat": math.log(carat),
                "pricePerCarat": upc,
                "logUpc": math.log(upc),
                "color": color,
                "colorRank": COLOR_RANK[color],
                "clarity": clarity,
                "clarityRank": CLARITY_RANK[clarity],
                "isHpht": 1.0 if norm(row.get("typeName")) == "HPHT" else 0.0,
                "lwRatio": finite_float(row.get("lw_ratio")),
                "tablePct": finite_float(row.get("table_pct")),
                "depthPct": finite_float(row.get("depth_pct")),
            }
        )
    return rows


def shape_norms(rows):
    grouped = defaultdict(lambda: {"lw": [], "table": [], "depth": []})
    for row in rows:
        if row["lwRatio"]:
            grouped[row["shape"]]["lw"].append(row["lwRatio"])
        if row["tablePct"]:
            grouped[row["shape"]]["table"].append(row["tablePct"])
        if row["depthPct"]:
            grouped[row["shape"]]["depth"].append(row["depthPct"])

    global_lw = median([r["lwRatio"] for r in rows if r["lwRatio"]])
    global_table = median([r["tablePct"] for r in rows if r["tablePct"]])
    global_depth = median([r["depthPct"] for r in rows if r["depthPct"]])

    norms = {}
    for shape, vals in grouped.items():
        norms[shape] = {
            "lwRatio": median(vals["lw"]) if vals["lw"] else global_lw,
            "tablePct": median(vals["table"]) if vals["table"] else global_table,
            "depthPct": median(vals["depth"]) if vals["depth"] else global_depth,
            "n": len([r for r in rows if r["shape"] == shape]),
        }
    norms["_global"] = {"lwRatio": global_lw, "tablePct": global_table, "depthPct": global_depth}
    return norms


def carat_basis(carat):
    log_ct = math.log(carat)
    return [
        log_ct,
        max(0.0, math.log(carat / 1.0)),
        max(0.0, math.log(carat / 2.0)),
        max(0.0, math.log(carat / 5.0)),
        max(0.0, math.log(carat / 10.0)),
    ]


def magic_basis(carat):
    features = []
    for threshold in MAGIC_THRESHOLDS:
        window = min(0.25, threshold * 0.12)
        ramp_start = max(0.0, threshold - window)
        if carat <= ramp_start:
            approach = 0.0
        elif carat < threshold:
            approach = (carat - ramp_start) / max(1e-9, threshold - ramp_start)
        else:
            approach = 1.0
        features.append(approach)
        features.append(1.0 if carat >= threshold else 0.0)
    return features


def vintage_basis(vintage01):
    return [max(0.0, vintage01 - knot) for knot in VINTAGE_KNOTS]


def feature_row(row, shapes, cuts, shape_interactions, cut_interactions, norms):
    norm_row = norms.get(row["shape"], norms["_global"])
    lw_ref = norm_row["lwRatio"] or norms["_global"]["lwRatio"]
    table_ref = norm_row["tablePct"] or norms["_global"]["tablePct"]
    depth_ref = norm_row["depthPct"] or norms["_global"]["depthPct"]

    lw_dev = 0.0
    if row["lwRatio"] and row["lwRatio"] > 0 and lw_ref > 0:
        lw_dev = abs(math.log(row["lwRatio"] / lw_ref))

    table_dev = 0.0
    if row["tablePct"] is not None and table_ref is not None:
        table_dev = abs(row["tablePct"] - table_ref) / 10.0

    depth_dev = 0.0
    if row["depthPct"] is not None and depth_ref is not None:
        depth_dev = abs(row["depthPct"] - depth_ref) / 10.0

    values = [1.0]
    values.extend(carat_basis(row["carat"]))
    values.extend(magic_basis(row["carat"]))
    grade_size = math.log1p(row["carat"])
    values.extend([
        row["colorRank"],
        row["clarityRank"],
        (MAX_COLOR_RANK - row["colorRank"]) * grade_size,
        (MAX_CLARITY_RANK - row["clarityRank"]) * grade_size,
        row["isHpht"],
    ])
    values.extend([1.0 if row["shape"] == shape else 0.0 for shape in shapes])
    values.extend([1.0 if row["cut"] == cut else 0.0 for cut in cuts])
    carat_extra = carat_basis(row["carat"]) + magic_basis(row["carat"])
    for shape in shape_interactions:
        active = 1.0 if row["shape"] == shape else 0.0
        values.extend([active * value for value in carat_extra])
    for cut in cut_interactions:
        active = 1.0 if row["cut"] == cut else 0.0
        values.extend([active * value for value in carat_extra])
    values.extend([lw_dev, table_dev, depth_dev])
    return values


def make_design(rows, shapes, cuts, shape_interactions, cut_interactions, norms):
    return np.array([feature_row(row, shapes, cuts, shape_interactions, cut_interactions, norms) for row in rows], dtype=float)


def standardize(train_x, other_x):
    means = train_x.mean(axis=0)
    stds = train_x.std(axis=0)
    means[0] = 0.0
    stds[0] = 1.0
    stds[stds == 0.0] = 1.0
    return (train_x - means) / stds, (other_x - means) / stds, means, stds


def project(weights, names, stds):
    out = weights.copy()
    for idx, name in enumerate(names):
        if name == "carat_log":
            out[idx] = max(MIN_RAW_CARAT_LOG_SLOPE * stds[idx], out[idx])
        elif (
            name.startswith("carat_")
            or name.startswith("magic_")
            or "_carat_" in name
            or "_magic_" in name
            or name == "isHpht"
            or name in ("colorPremium", "clarityPremium")
        ):
            out[idx] = max(0.0, out[idx])
        elif (
            name in ("colorRank", "clarityRank", "lwDev", "tableDev", "depthDev")
        ):
            out[idx] = min(0.0, out[idx])
    return out


def fit_projected_ridge(x, y, names, stds):
    n, p = x.shape
    penalty = np.full(p, RIDGE_LAMBDA)
    penalty[0] = 0.0

    # Ridge closed form is a good starting point; projection then enforces signs.
    xtx = x.T @ x / n
    xty = x.T @ y / n
    weights = np.linalg.solve(xtx + np.diag(penalty), xty)
    weights = project(weights, names, stds)

    largest = float(np.linalg.eigvalsh(xtx + np.diag(penalty)).max())
    step = 0.85 / largest

    for _ in range(ITERATIONS):
        residual = x @ weights - y
        grad = x.T @ residual / n + penalty * weights
        weights -= step * grad
        weights = project(weights, names, stds)

    return weights


def predict_log(x, weights):
    return x @ weights


def pct_metrics(rows, logs):
    errors = []
    signed = []
    for row, log_pred in zip(rows, logs):
        pred = math.exp(float(log_pred))
        actual = row["pricePerCarat"]
        errors.append(abs(pred - actual) / actual)
        signed.append((pred - actual) / actual)
    errors_sorted = sorted(errors)
    return {
        "n": len(errors),
        "mape": round(100.0 * mean(errors), 4),
        "mdape": round(100.0 * median(errors), 4),
        "p90ape": round(100.0 * errors_sorted[int(0.9 * (len(errors_sorted) - 1))], 4),
        "biasPct": round(100.0 * mean(signed), 4),
    }


def carat_bucket(carat):
    if carat < 1:
        return "<1"
    if carat < 2:
        return "1-1.99"
    if carat < 3:
        return "2-2.99"
    if carat < 5:
        return "3-4.99"
    if carat < 10:
        return "5-9.99"
    return "10+"


def group_metrics(rows, logs, key_fn):
    grouped = defaultdict(lambda: {"rows": [], "logs": []})
    for row, log_pred in zip(rows, logs):
        key = key_fn(row)
        grouped[key]["rows"].append(row)
        grouped[key]["logs"].append(log_pred)
    return {
        key: pct_metrics(value["rows"], value["logs"])
        for key, value in sorted(grouped.items())
        if len(value["rows"]) >= 8
    }


def monotonicity_checks(weights, names, means, stds, shapes, cuts, shape_interactions, cut_interactions, norms):
    base = {
        "rowNo": 999999,
        "reportNo": "CHECK",
        "shape": "round_standard",
        "cut": "ID",
        "carat": 1.0,
        "color": "D",
        "colorRank": 0,
        "clarity": "IF",
        "clarityRank": 0,
        "isHpht": 0.0,
        "lwRatio": norms.get("round_standard", norms["_global"])["lwRatio"],
        "tablePct": norms.get("round_standard", norms["_global"])["tablePct"],
        "depthPct": norms.get("round_standard", norms["_global"])["depthPct"],
        "vintage01": 1.0,
    }

    def score(row):
        x = np.array([feature_row(row, shapes, cuts, shape_interactions, cut_interactions, norms)], dtype=float)
        x = (x - means) / stds
        return float(math.exp(predict_log(x, weights)[0]))

    carats = [0.5, 1.0, 1.5, 1.9, 2.0, 3.0, 3.9, 4.0, 5.0, 10.0, 30.0]
    carat_prices = []
    for carat in carats:
        row = dict(base, carat=carat)
        carat_prices.append(score(row))

    clarities = ["IF", "VVS1", "VVS2", "VS1", "VS2", "SI1", "SI2"]
    clarity_prices = []
    for clarity in clarities:
        row = dict(base, clarity=clarity, clarityRank=CLARITY_RANK[clarity])
        clarity_prices.append(score(row))

    colors = ["D", "E", "F", "G", "H", "I", "J"]
    color_prices = []
    for color in colors:
        row = dict(base, color=color, colorRank=COLOR_RANK[color])
        color_prices.append(score(row))

    cvd = score(dict(base, isHpht=0.0))
    hpht = score(dict(base, isHpht=1.0))

    def nondecreasing(values):
        return all(values[i + 1] + 1e-9 >= values[i] for i in range(len(values) - 1))

    def nonincreasing(values):
        return all(values[i + 1] <= values[i] + 1e-9 for i in range(len(values) - 1))

    full_grid = []
    for color in COLOR_RANK:
        for clarity in CLARITY_RANK:
            prices = [
                score(dict(
                    base,
                    carat=carat,
                    color=color,
                    colorRank=COLOR_RANK[color],
                    clarity=clarity,
                    clarityRank=CLARITY_RANK[clarity],
                ))
                for carat in carats
            ]
            full_grid.append({
                "spec": f"ROUND {color} {clarity}",
                "caratPerCtNondecreasing": nondecreasing(prices),
                "prices": dict(zip([str(c) for c in carats], [round(v, 2) for v in prices])),
            })

    full_grid_violations = [row for row in full_grid if not row["caratPerCtNondecreasing"]]

    cut_curves = {}
    for cut in ["-", "ID", "EX"]:
        if cut in cuts or cut in cut_interactions or cut == base["cut"]:
            cut_curves[cut] = dict(zip(
                [str(c) for c in carats],
                [round(score(dict(base, cut=cut, carat=c)), 2) for c in carats],
            ))

    return {
        "caratPerCtNondecreasing": nondecreasing(carat_prices),
        "caratPerCtNondecreasingFullGrid": len(full_grid_violations) == 0,
        "clarityBetterIsHigher": nonincreasing(clarity_prices),
        "colorBetterIsHigher": nonincreasing(color_prices),
        "hphtAtLeastCvd": hpht + 1e-9 >= cvd,
        "fullGridCaratViolations": full_grid_violations[:10],
        "sampleRoundDIfPerCtByCarat": dict(zip([str(c) for c in carats], [round(v, 2) for v in carat_prices])),
        "sampleRoundDClarityLadderAt1ct": dict(zip(clarities, [round(v, 2) for v in clarity_prices])),
        "sampleRoundIfColorLadderAt1ct": dict(zip(colors, [round(v, 2) for v in color_prices])),
        "sampleGrowthAt1ct": {"CVD": round(cvd, 2), "HPHT": round(hpht, 2)},
        "sampleRoundDIfPerCtByCut": cut_curves,
    }


def add_interaction_names(names, prefix, values):
    for value in values:
        key = str(value).replace("-", "minus").replace(".", "_")
        names.append(f"{prefix}_{key}_carat_log")
        names.append(f"{prefix}_{key}_carat_hinge_1ct")
        names.append(f"{prefix}_{key}_carat_hinge_2ct")
        names.append(f"{prefix}_{key}_carat_hinge_5ct")
        names.append(f"{prefix}_{key}_carat_hinge_10ct")
        for threshold in MAGIC_THRESHOLDS:
            label = str(threshold).replace(".", "_")
            names.extend([f"{prefix}_{key}_magic_approach_{label}ct", f"{prefix}_{key}_magic_step_{label}ct"])


def threshold_support(rows):
    support = {}
    for threshold in MAGIC_THRESHOLDS:
        window = min(0.25, threshold * 0.12)
        below = [r for r in rows if threshold - window <= r["carat"] < threshold]
        at_or_above = [r for r in rows if threshold <= r["carat"] <= threshold + window]
        support[str(threshold)] = {
            "belowWindow": len(below),
            "atOrAboveWindow": len(at_or_above),
            "windowCt": round(window, 4),
        }
    return support


def main():
    rows = load_rows()
    if not rows:
        raise RuntimeError("No StarGem white rows available for S28 training.")

    min_row = min(r["rowNo"] for r in rows)
    max_row = max(r["rowNo"] for r in rows)
    span = max(1, max_row - min_row)
    for row in rows:
        row["vintage01"] = (row["rowNo"] - min_row) / span

    train = [r for r in rows if report_hash(r) % HOLDOUT_MOD != 0]
    holdout = [r for r in rows if report_hash(r) % HOLDOUT_MOD == 0]

    shape_counts = Counter(r["shape"] for r in train)
    shapes = sorted(shape for shape, count in shape_counts.items() if shape != SHAPE_FALLBACK and count >= 20)
    cut_counts = Counter(r["cut"] for r in train)
    cuts = sorted(cut for cut, count in cut_counts.items() if cut != "-" and count >= 20)
    shape_interactions = sorted(shape for shape, count in shape_counts.items() if count >= MIN_INTERACTION_ROWS)
    cut_interactions = sorted(cut for cut, count in cut_counts.items() if count >= MIN_INTERACTION_ROWS)
    norms = shape_norms(train)

    names = [
        "intercept",
        "carat_log",
        "carat_hinge_1ct",
        "carat_hinge_2ct",
        "carat_hinge_5ct",
        "carat_hinge_10ct",
    ]
    for threshold in MAGIC_THRESHOLDS:
        label = str(threshold).replace(".", "_")
        names.extend([f"magic_approach_{label}ct", f"magic_step_{label}ct"])
    names.extend(["colorRank", "clarityRank", "colorPremium", "clarityPremium", "isHpht"])
    names.extend([f"shape_{shape}" for shape in shapes])
    names.extend([f"cut_{cut}" for cut in cuts])
    add_interaction_names(names, "shape", shape_interactions)
    add_interaction_names(names, "cut", cut_interactions)
    names.extend(["lwDev", "tableDev", "depthDev"])

    train_x_raw = make_design(train, shapes, cuts, shape_interactions, cut_interactions, norms)
    holdout_x_raw = make_design(holdout, shapes, cuts, shape_interactions, cut_interactions, norms)
    train_x, holdout_x, means, stds = standardize(train_x_raw, holdout_x_raw)
    y = np.array([r["logUpc"] for r in train], dtype=float)

    weights = fit_projected_ridge(train_x, y, names, stds)
    train_logs = predict_log(train_x, weights)
    holdout_logs = predict_log(holdout_x, weights)
    checks = monotonicity_checks(weights, names, means, stds, shapes, cuts, shape_interactions, cut_interactions, norms)

    coefficients = {name: round(float(weight), 8) for name, weight in zip(names, weights)}
    model = {
        "generatedDate": date.today().isoformat(),
        "modelName": "S28 — monotone parametric trend surface",
        "modelVersion": MODEL_VERSION,
        "targetType": "single_parametric_surface",
        "prediction": "One constrained log($/ct) surface; no champion blending.",
        "trainingData": {
            "source": "research/data/dataset-clean-training.json",
            "sourcePolicy": "Clean Segment A only. Do not train S28 from starsgem-index.json or the raw XLS.",
            "rows": len(rows),
            "trainRows": len(train),
            "holdoutRows": len(holdout),
            "rowNoMin": min_row,
            "rowNoMax": max_row,
            "holdout": f"reportHash % {HOLDOUT_MOD} == 0",
            "caratMin": round(min(r["carat"] for r in rows), 4),
            "caratMax": round(max(r["carat"] for r in rows), 4),
            "thresholdSupport": threshold_support(rows),
        },
        "constraints": {
            "carat": "coefficients on log-carat bases are projected >= 0, so $/ct is nondecreasing with carat.",
            "caratStrictFloor": f"raw log-carat slope is projected >= {MIN_RAW_CARAT_LOG_SLOPE}, so larger carat has a tiny strict scarcity premium even when sheet rows are flat.",
            "magicWeights": "threshold approach ramps and exact/above-threshold steps are projected >= 0, so the model can learn 1.9ct < 2ct and 3.9ct < 4ct without using a smooth-only equation.",
            "clarity": "clarityRank coefficient is projected <= 0, so worse clarity cannot increase price.",
            "color": "colorRank coefficient is projected <= 0, so worse white color cannot increase price.",
            "gradeSizeInteractions": "colorPremium and clarityPremium use (worst rank - grade rank) * log1p(carat) and are projected >= 0, so better-grade premiums can grow with carat without making worse grades cheaper as size rises.",
            "growth": "HPHT coefficient is projected >= 0, so HPHT cannot price below CVD.",
            "shapeAndCutCaratInteractions": "Supported shapes and cuts receive nonnegative extra carat/magic-weight terms, so carat scarcity can differ by cut/shape without breaking global monotonicity.",
            "dimensions": "shape-normalized L/W, table, and depth deviations are projected <= 0.",
            "vintage": "Disabled in v0.4 so live predictions and training metrics use the same surface instead of forcing every deployed prediction to the current-row edge.",
        },
        "featureNames": names,
        "featureMeans": [round(float(v), 10) for v in means],
        "featureStds": [round(float(v), 10) for v in stds],
        "coefficients": coefficients,
        "shapeNorms": norms,
        "shapeSupport": dict(sorted(shape_counts.items())),
        "cutSupport": dict(sorted(cut_counts.items())),
        "interactionSupport": {
            "minRows": MIN_INTERACTION_ROWS,
            "shapeCaratInteractions": shape_interactions,
            "cutCaratInteractions": cut_interactions,
        },
        "metrics": {
            "train": pct_metrics(train, train_logs),
            "holdout": pct_metrics(holdout, holdout_logs),
            "holdoutByShape": group_metrics(holdout, holdout_logs, lambda r: r["shape"]),
            "holdoutByCaratBucket": group_metrics(holdout, holdout_logs, lambda r: carat_bucket(r["carat"])),
        },
        "monotonicityChecks": checks,
            "caveat": "Prototype uses a linear constrained surface with ridge shrinkage. It is meant to test the single-surface monotone approach before browser deployment.",
    }

    OUTPUT_JSON.write_text(json.dumps(model, indent=2) + "\n")

    print(f"S28 model -> {OUTPUT_JSON}")
    print(f"Rows: train={len(train)} holdout={len(holdout)}")
    print("Holdout:", model["metrics"]["holdout"])
    print("Monotonicity:", {k: v for k, v in checks.items() if isinstance(v, bool)})

    failed = [key for key, value in checks.items() if isinstance(value, bool) and not value]
    if failed:
        raise RuntimeError("S28 monotonicity checks failed: " + ", ".join(failed))


if __name__ == "__main__":
    main()
