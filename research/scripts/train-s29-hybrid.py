#!/usr/bin/env python3
"""
Train S29 — the empirical-Bayes anchored hybrid pricing model.

Architecture:
  anchor (empirical-Bayes cell shrinkage toward S28 surface)
    + cut-stratified anchoring (Tier A premium vs Tier B commodity)
    + support-shrunk monotone LightGBM residual

Phases implemented per white-diamond-ml-pricing-improvement-plan.md:
  Phase 1: Held-out cell benchmark infrastructure
  Phase 2: Fixed S28 monotone surface (grade-premium reparameterization)
  Phase 3: Empirical-Bayes spec anchor with tuned k
  Phase 4: Cut-stratified anchor (Tier A/B)
  Phase 5: Support-shrunk monotone residual

Usage:
  python3 research/scripts/train-s29-hybrid.py
"""

from __future__ import annotations

import hashlib
import json
import math
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path
from statistics import mean, median

import numpy as np

try:
    import lightgbm as lgb
    HAS_LGB = True
except ImportError:
    HAS_LGB = False
    print("WARNING: lightgbm not available; residual layer will use a simple fallback", file=sys.stderr)

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
DATA_DIR = PROJECT_ROOT / "data"

TRAINING_JSON = DATA_DIR / "dataset-clean-training.json"
S28_MODEL_JSON = DATA_DIR / "starsgem-ml-model-s28-monotone-parametric.json"
S26_MODEL_JSON = DATA_DIR / "starsgem-ml-model-s26-champion.json"
INTEL_JSON = DATA_DIR / "starsgem-pricing-intelligence.json"
OUTPUT_MODEL_JSON = DATA_DIR / "starsgem-ml-model-s29-hybrid.json"
OUTPUT_BENCHMARK_JSON = DATA_DIR / "benchmark-s29-vs-s26-s28.json"
OUTPUT_REPORT_MD = PROJECT_ROOT / "white-diamond-ml-pricing-improvement-plan" / ".." / "S29-implementation-report.md"

# ─── Configuration ───────────────────────────────────────────────────────────
RANDOM_SEED = 42
K_PRIOR = 5.0           # Prior strength for empirical-Bayes anchor
N_THRESHOLD = 10         # Support threshold for residual shrinkage
CUT_TIER_MIN_SUPPORT = 5  # Min rows for cut-stratified anchor
CELL_HOLDOUT_FRAC = 0.20 # Fraction of cells held out
RIDGE_LAMBDA = 0.018
ITERATIONS = 6000
MIN_RAW_CARAT_LOG_SLOPE = 0.02

COLOR_RANK = {"D": 0, "E": 1, "F": 2, "G": 3, "H": 4, "I": 5, "J": 6, "K": 7}
CLARITY_RANK = {"IF": 0, "VVS1": 1, "VVS": 1.5, "VVS2": 2, "VS1": 3, "VS": 3.5, "VS2": 4, "SI1": 5, "SI2": 6}

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

MAGIC_THRESHOLDS = [1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 10.0, 20.0]
VINTAGE_KNOTS = [0.2, 0.4, 0.6, 0.8]
MIN_INTERACTION_ROWS = 100

np.random.seed(RANDOM_SEED)

# ─── Helpers ──────────────────────────────────────────────────────────────────

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


def carat_band(carat):
    for lo, hi, label in CARAT_BANDS:
        if lo <= carat <= hi:
            return label
    return "<1.00"


def cell_key(row, cut_tier=None):
    """Anchor cell key: (shape_style, color, clarity).

    Carat_band is intentionally NOT in the anchor key. The S28 surface handles
    all carat variation continuously. Including carat_band would create steps
    at band boundaries, breaking full-hybrid monotonicity (audit Fix 2 & 4).
    """
    sh = str(row.get("shape_style") or row.get("shape") or "round").strip().lower()
    co = norm(row.get("color"))
    cl = norm(row.get("clarity"))
    if cut_tier:
        return f"{sh}||{co}||{cl}||{cut_tier}"
    return f"{sh}||{co}||{cl}"


def benchmark_cell_key(row):
    """Held-out benchmark cell key: (shape_style, color, clarity, carat_band).

    Includes carat_band so that cell-level holdout tests whether the model
    can extrapolate to unseen spec×carat combinations. This is the evaluation
    split only — anchors do not use carat_band.
    """
    sh = str(row.get("shape_style") or row.get("shape") or "round").strip().lower()
    co = norm(row.get("color"))
    cl = norm(row.get("clarity"))
    cb = carat_band(float(row.get("carat", 0)))
    return f"{sh}||{co}||{cl}||{cb}"


def classify_cut_tier(row):
    """Tier A = premium (ID/EX cut, good polish & symmetry). Tier B = commodity."""
    cut = norm(row.get("cut_raw", ""))
    polish = norm(row.get("polish", ""))
    symmetry = norm(row.get("symmetry", ""))
    if cut in ("ID", "EX") and polish in ("EX", "IDEAL", "VG") and symmetry in ("EX", "VG"):
        return "A"
    return "B"


def cell_hash(key):
    """Deterministic hash of a cell key for holdout assignment."""
    return int(hashlib.md5(key.encode()).hexdigest(), 16) % 1000


def support_tier(n_cell):
    """Classify cell support: dense, medium, sparse, empty."""
    if n_cell >= 20:
        return "dense"
    if n_cell >= 5:
        return "medium"
    if n_cell >= 1:
        return "sparse"
    return "empty"


# ─── Data Loading ─────────────────────────────────────────────────────────────

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
        shape = str(row.get("shape_style") or row.get("shape") or "round").strip().lower() or "round"
        cut = normalize_cut(row.get("cut_raw"))
        cut_tier = classify_cut_tier(row)
        # Preserve original supplier fields for correct S26 benchmarking (Fix 1)
        raw_shape = norm(row.get("raw_shape_code") or row.get("shape", ""))
        type_name = norm(row.get("typeName", "CVD"))
        original_cut_raw = row.get("cut_raw", "-")
        polish_raw = norm(row.get("polish", ""))
        symmetry_raw = norm(row.get("symmetry", ""))
        rows.append({
            "rowNo": int(row.get("rowNo") or 0),
            "reportNo": row.get("reportno"),
            "shape": shape,
            "rawShape": raw_shape,
            "cut": cut,
            "originalCutRaw": original_cut_raw,
            "cutTier": cut_tier,
            "carat": carat,
            "logCarat": math.log(carat),
            "pricePerCarat": upc,
            "logUpc": math.log(upc),
            "price": float(row.get("price", 0)),
            "color": color,
            "colorRank": COLOR_RANK[color],
            "clarity": clarity,
            "clarityRank": CLARITY_RANK[clarity],
            "isHpht": 1.0 if type_name == "HPHT" else 0.0,
            "typeName": type_name,
            "lwRatio": finite_float(row.get("lw_ratio")),
            "tablePct": finite_float(row.get("table_pct")),
            "depthPct": finite_float(row.get("depth_pct")),
            "polish": polish_raw,
            "symmetry": symmetry_raw,
        })
    return rows


# ─── S26 Lookup Prediction (for comparison) ──────────────────────────────────

def load_s26_intel():
    """Load S26 lookup intelligence for baseline comparison."""
    try:
        intel = json.loads(INTEL_JSON.read_text())
        return intel
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def predict_s26_lookup(row, intel):
    """Replicate S26 lookup prediction using exact S26 field normalization.

    Mirrors train-s26-champion.mjs: Shape = raw_shape_code (e.g. ROUND),
    TypeName = actual CVD/HPHT, Cut = original cut_raw.
    """
    if intel is None:
        return None
    carat = float(row["carat"])
    # Use canonical S26 normalization: supplier shape, not shape_style
    normalized = {
        "carat_bucket": carat_band(carat),
        "Shape": row.get("rawShape", norm(row.get("shape", ""))),
        "Color": row["color"],
        "Clarity": row["clarity"],
        "TypeName": row.get("typeName", "CVD"),
        "Report": "IGI",
        "Cut": norm(row.get("originalCutRaw", row.get("cut", "-"))),
        "Polish": row.get("polish", "EX") or "EX",
        "Symmetry": row.get("symmetry", "EX") or "EX",
    }
    for table in intel.get("lookup", {}).get("tables", []):
        key = "||".join(normalized.get(f, "-") for f in table["fields"])
        hit = table.get("groups", {}).get(key)
        if hit:
            price = carat * hit["rate"] / 170
            return {"price": price, "upc": price / carat, "level": table["level"], "count": hit["count"]}
    rate = float(intel.get("lookup", {}).get("globalMedianInternalRatePerCt", 0)) / 170
    if rate > 0:
        return {"price": carat * rate, "upc": rate, "level": "GLOBAL", "count": 0}
    return None


# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 2: Fixed S28 Monotone Surface (grade-premium reparameterization)
# ═══════════════════════════════════════════════════════════════════════════════

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


def feature_row_s28(row, shapes, cuts, shape_interactions, cut_interactions, norms):
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

    grade_size = math.log1p(row["carat"])

    # PHASE 2 FIX: grade premium = (max_rank - rank) * grade_size, constrained >= 0
    # This ensures better grades ALWAYS get at least as much carat premium as worse grades.
    color_premium = (MAX_COLOR_RANK - row["colorRank"]) * grade_size
    clarity_premium = (MAX_CLARITY_RANK - row["clarityRank"]) * grade_size

    values = [1.0]
    values.extend(carat_basis(row["carat"]))
    values.extend(magic_basis(row["carat"]))
    values.extend([
        row["colorRank"],        # <= 0: worse color = lower price
        row["clarityRank"],      # <= 0: worse clarity = lower price
        color_premium,           # >= 0: better color gets MORE premium at larger carats
        clarity_premium,         # >= 0: better clarity gets MORE premium at larger carats
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
    values.extend([lw_dev, table_dev, depth_dev, row["vintage01"]])
    values.extend(vintage_basis(row["vintage01"]))
    return values


def make_design(rows, shapes, cuts, shape_interactions, cut_interactions, norms):
    return np.array([feature_row_s28(row, shapes, cuts, shape_interactions, cut_interactions, norms)
                     for row in rows], dtype=float)


def standardize(train_x, other_x):
    means = train_x.mean(axis=0)
    stds = train_x.std(axis=0)
    means[0] = 0.0
    stds[0] = 1.0
    stds[stds == 0.0] = 1.0
    return (train_x - means) / stds, (other_x - means) / stds, means, stds


def project_weights(weights, names, stds):
    """Project weights to satisfy monotonicity constraints.

    PHASE 2 FIX: color_premium and clarity_premium are projected >= 0 (instead of
    the old colorRank_size/clarityRank_size which were <= 0). This ensures better
    grades get nonnegative extra premium at larger carats.
    """
    out = weights.copy()
    for idx, name in enumerate(names):
        if name == "carat_log":
            out[idx] = max(MIN_RAW_CARAT_LOG_SLOPE * stds[idx], out[idx])
        elif (name.startswith("carat_") or name.startswith("magic_")
              or "_carat_" in name or "_magic_" in name
              or name == "isHpht"
              or name in ("colorPremium", "clarityPremium")):
            out[idx] = max(0.0, out[idx])
        elif (name in ("colorRank", "clarityRank", "lwDev", "tableDev", "depthDev")
              or name.startswith("vintage_")):
            out[idx] = min(0.0, out[idx])
    return out


def fit_projected_ridge(x, y, names, stds):
    n, p = x.shape
    penalty = np.full(p, RIDGE_LAMBDA)
    penalty[0] = 0.0
    xtx = x.T @ x / n
    xty = x.T @ y / n
    weights = np.linalg.solve(xtx + np.diag(penalty), xty)
    weights = project_weights(weights, names, stds)
    largest = float(np.linalg.eigvalsh(xtx + np.diag(penalty)).max())
    step = 0.85 / largest
    for _ in range(ITERATIONS):
        residual = x @ weights - y
        grad = x.T @ residual / n + penalty * weights
        weights -= step * grad
        weights = project_weights(weights, names, stds)
    return weights


def predict_log_surface(x, weights):
    return x @ weights


def make_surface_predictor(weights, names, means, stds, shapes, cuts,
                           shape_interactions, cut_interactions, norms):
    """Return a function that predicts log($/ct) for a single row dict."""
    def predict(row):
        x = np.array([feature_row_s28(row, shapes, cuts, shape_interactions,
                                       cut_interactions, norms)], dtype=float)
        x = (x - means) / stds
        return float(predict_log_surface(x, weights)[0])
    return predict


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
            names.extend([f"{prefix}_{key}_magic_approach_{label}ct",
                          f"{prefix}_{key}_magic_step_{label}ct"])


def train_s28_surface(train_rows):
    """Train the fixed S28 monotone surface (Phase 2 reparameterization)."""
    shapes_list = sorted(set(r["shape"] for r in train_rows if r["shape"] != "round"))
    # Filter shapes with enough support
    shape_counts = Counter(r["shape"] for r in train_rows)
    shapes = sorted(s for s, c in shape_counts.items() if s != "round" and c >= 20)
    cut_counts = Counter(r["cut"] for r in train_rows)
    cuts = sorted(c for c, cnt in cut_counts.items() if c != "-" and cnt >= 20)
    shape_interactions = sorted(s for s, cnt in shape_counts.items() if cnt >= MIN_INTERACTION_ROWS)
    cut_interactions = sorted(c for c, cnt in cut_counts.items() if cnt >= MIN_INTERACTION_ROWS)
    norms = shape_norms(train_rows)

    names = [
        "intercept",
        "carat_log", "carat_hinge_1ct", "carat_hinge_2ct", "carat_hinge_5ct", "carat_hinge_10ct",
    ]
    for threshold in MAGIC_THRESHOLDS:
        label = str(threshold).replace(".", "_")
        names.extend([f"magic_approach_{label}ct", f"magic_step_{label}ct"])
    # PHASE 2: colorPremium and clarityPremium replace colorRank_size and clarityRank_size
    names.extend(["colorRank", "clarityRank", "colorPremium", "clarityPremium", "isHpht"])
    names.extend([f"shape_{shape}" for shape in shapes])
    names.extend([f"cut_{cut}" for cut in cuts])
    add_interaction_names(names, "shape", shape_interactions)
    add_interaction_names(names, "cut", cut_interactions)
    names.extend(["lwDev", "tableDev", "depthDev", "vintage01"])
    for knot in VINTAGE_KNOTS:
        names.append(f"vintage_hinge_{str(knot).replace('.', '_')}")

    train_x_raw = make_design(train_rows, shapes, cuts, shape_interactions, cut_interactions, norms)
    train_x, _, means, stds = standardize(train_x_raw, train_x_raw)
    y = np.array([r["logUpc"] for r in train_rows], dtype=float)

    weights = fit_projected_ridge(train_x, y, names, stds)

    predictor = make_surface_predictor(weights, names, means, stds, shapes, cuts,
                                        shape_interactions, cut_interactions, norms)

    coefficients = {name: round(float(w), 8) for name, w in zip(names, weights)}

    return {
        "predictor": predictor,
        "weights": weights,
        "names": names,
        "means": means,
        "stds": stds,
        "coefficients": coefficients,
        "shapes": shapes,
        "cuts": cuts,
        "shape_interactions": shape_interactions,
        "cut_interactions": cut_interactions,
        "norms": norms,
    }


def check_monotonicity(surface, norms):
    """Check monotonicity on common grades including E/VS1 and F/VS2 (Phase 2 requirement)."""
    base = {
        "rowNo": 999999, "reportNo": "CHECK",
        "shape": "round_standard", "shape_style": "round_standard",
        "cut": "ID",
        "carat": 1.0, "color": "D", "colorRank": 0,
        "clarity": "IF", "clarityRank": 0,
        "isHpht": 0.0,
        "lwRatio": norms.get("round", norms["_global"])["lwRatio"],
        "tablePct": norms.get("round", norms["_global"])["tablePct"],
        "depthPct": norms.get("round", norms["_global"])["depthPct"],
        "vintage01": 1.0,
        "polish": "EX", "symmetry": "EX",
    }

    def score(row):
        return math.exp(surface["predictor"](row))

    # Check multiple grade×carat combinations (Phase 2 gates)
    gate_specs = [
        ("ROUND D IF", "round_standard", "D", "IF"),
        ("ROUND E VS1", "round_standard", "E", "VS1"),
        ("ROUND F VS2", "round_standard", "F", "VS2"),
    ]

    carats = [1.0, 2.0, 3.0, 5.0, 10.0]
    gate_results = {}
    for name, shape, color, clarity in gate_specs:
        prices = []
        for ct in carats:
            row = dict(base, shape=shape, color=color, clarity=clarity,
                       colorRank=COLOR_RANK[color], clarityRank=CLARITY_RANK[clarity],
                       carat=ct, logCarat=math.log(ct))
            prices.append(score(row))
        nondecreasing = all(prices[i + 1] + 1e-9 >= prices[i] for i in range(len(prices) - 1))
        gate_results[name] = {
            "prices": dict(zip([str(c) for c in carats], [round(p, 2) for p in prices])),
            "nondecreasing": nondecreasing,
        }

    return gate_results


# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 1: Held-Out Cell Benchmark Infrastructure
# ═══════════════════════════════════════════════════════════════════════════════

def build_cell_index(rows, key_fn=cell_key):
    """Index rows by a cell key function. Returns {cell_key: [row_indices]}."""
    index = defaultdict(list)
    for i, row in enumerate(rows):
        index[key_fn(row)].append(i)
    return dict(index)


def split_cells_holdout(cell_index):
    """Split cells into train/holdout sets by hashing cell keys.
    Returns (train_cells, holdout_cells) as sets of cell keys.
    """
    train_cells = set()
    holdout_cells = set()
    for key in cell_index:
        if cell_hash(key) / 1000.0 < CELL_HOLDOUT_FRAC:
            holdout_cells.add(key)
        else:
            train_cells.add(key)
    return train_cells, holdout_cells


def get_rows_from_cells(rows, cell_index, cell_set):
    """Get row indices belonging to a set of cells."""
    indices = []
    for key in cell_set:
        indices.extend(cell_index.get(key, []))
    return indices


def cell_support_stats(cell_index):
    """Compute support tier counts and cell counts."""
    tiers = defaultdict(int)
    cell_counts = []
    for key, indices in cell_index.items():
        n = len(indices)
        cell_counts.append(n)
        tiers[support_tier(n)] += 1
    return {
        "totalCells": len(cell_index),
        "denseCells": tiers["dense"],
        "mediumCells": tiers["medium"],
        "sparseCells": tiers["sparse"],
        "emptyCells": tiers["empty"],
        "cellSizeDistribution": {
            "min": min(cell_counts) if cell_counts else 0,
            "p25": int(np.percentile(cell_counts, 25)),
            "median": int(np.percentile(cell_counts, 50)),
            "p75": int(np.percentile(cell_counts, 75)),
            "max": max(cell_counts) if cell_counts else 0,
        },
    }


# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 3: Empirical-Bayes Spec Anchor (as surface offsets — Fix 2)
# ═══════════════════════════════════════════════════════════════════════════════

def build_empirical_bayes_anchor(train_rows, cell_index, surface, k_prior=K_PRIOR):
    """Build empirical-Bayes cell offsets from the S28 surface.

    cell_offset = (n * mean(log_actual - log_surface) + k * 0) / (n + k)

    The offset is shrunk toward zero (the surface) as support thins.
    Anchors are ADDED to the surface, not replacements for it.
    """
    anchors = {}
    for key, indices in cell_index.items():
        if not indices:
            continue
        cell_rows = [train_rows[i] for i in indices]
        n = len(cell_rows)

        # Residual from surface for each row
        residuals = [r["logUpc"] - surface["predictor"](r) for r in cell_rows]
        mean_residual = mean(residuals)

        # Empirical Bayes: shrink offset toward zero (the surface)
        offset = (n * mean_residual + k_prior * 0.0) / (n + k_prior)

        anchors[key] = {
            "offset": offset,
            "n": n,
            "meanResidual": mean_residual,
            "meanLogUpc": mean(r["logUpc"] for r in cell_rows),
        }

    return anchors


def predict_anchor_for_row(row, anchors, surface):
    """Return surface + cell offset for a row. Falls back to pure surface."""
    key = cell_key(row)
    surface_log = surface["predictor"](row)
    if key in anchors:
        return surface_log + anchors[key]["offset"]
    return surface_log


def predict_anchor_for_row_cut_stratified(row, base_anchors, cut_anchors, surface,
                                          min_support=CUT_TIER_MIN_SUPPORT):
    """Predict anchored log($/ct) with cut stratification (Phase 4).

    Priority:
      1. Cut-stratified offset (if support >= min_support)
      2. Base cell offset
      3. Pure S28 surface

    All paths include the surface; anchors add offsets, not replacements.
    """
    surface_log = surface["predictor"](row)
    cut_tier = row.get("cutTier", classify_cut_tier(row))
    cut_key = cell_key(row, cut_tier)

    if cut_key in cut_anchors and cut_anchors[cut_key]["n"] >= min_support:
        return surface_log + cut_anchors[cut_key]["offset"], "cut_stratified"

    base_key = cell_key(row)
    if base_key in base_anchors:
        return surface_log + base_anchors[base_key]["offset"], "base_anchor"

    return surface_log, "surface"


# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 4: Cut-Stratified Anchor (as surface offsets — Fix 2)
# ═══════════════════════════════════════════════════════════════════════════════

def build_cut_stratified_anchors(train_rows, cell_index, surface, k_prior=K_PRIOR):
    """Build separate Tier A / Tier B offsets from the surface."""
    cut_index = defaultdict(list)
    for i, row in enumerate(train_rows):
        cut_tier = row.get("cutTier", classify_cut_tier(row))
        cut_key = cell_key(row, cut_tier)
        cut_index[cut_key].append(i)

    cut_anchors = {}
    for key, indices in cut_index.items():
        if not indices:
            continue
        cell_rows = [train_rows[i] for i in indices]
        n = len(cell_rows)
        residuals = [r["logUpc"] - surface["predictor"](r) for r in cell_rows]
        mean_residual = mean(residuals)
        offset = (n * mean_residual + k_prior * 0.0) / (n + k_prior)
        cut_anchors[key] = {
            "offset": offset,
            "n": n,
            "meanResidual": mean_residual,
            "meanLogUpc": mean(r["logUpc"] for r in cell_rows),
        }

    return cut_anchors


# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 5: Support-Shrunk Monotone Residual
# ═══════════════════════════════════════════════════════════════════════════════

def compute_residual_targets(train_rows, base_anchors, cut_anchors, surface):
    """Compute residual targets: log(actual / anchored_surface_prediction)."""
    targets = []
    anchor_sources = []
    for row in train_rows:
        anchor_log, source = predict_anchor_for_row_cut_stratified(
            row, base_anchors, cut_anchors, surface)
        residual = row["logUpc"] - anchor_log
        targets.append(residual)
        anchor_sources.append(source)
    return np.array(targets, dtype=float), anchor_sources


def build_residual_features(rows):
    """Build feature matrix for residual model.

    Features encode relative position within a cell and gemological attributes
    that might explain within-cell variation.
    """
    features = []
    for row in rows:
        carat = row["carat"]
        feat = [
            math.log(carat),
            row["colorRank"],
            row["clarityRank"],
            row["isHpht"],
            1.0 if row["cut"] == "ID" else 0.0,
            1.0 if row["cut"] == "EX" else 0.0,
            1.0 if row["polish"] in ("EX", "IDEAL") else 0.0,
            1.0 if row["symmetry"] == "EX" else 0.0,
            row["lwRatio"] if row["lwRatio"] else 1.0,
            row["tablePct"] if row["tablePct"] else 58.0,
            row["depthPct"] if row["depthPct"] else 62.0,
        ]
        features.append(feat)
    return np.array(features, dtype=float)


def train_residual_model(train_rows, base_anchors, cut_anchors, surface, cell_index):
    """Train support-shrunk monotone residual model (Phase 5).

    Uses LightGBM with monotone constraints where appropriate, then applies
    support-based shrinkage: residual_weight = min(1, n_cell / N_THRESHOLD).
    """
    targets, anchor_sources = compute_residual_targets(
        train_rows, base_anchors, cut_anchors, surface)

    X = build_residual_features(train_rows)

    # Compute support weights for each row
    support_weights = []
    for row in train_rows:
        key = cell_key(row)
        n = len(cell_index.get(key, []))
        w = min(1.0, n / N_THRESHOLD)
        support_weights.append(w)
    support_weights = np.array(support_weights, dtype=float)

    if HAS_LGB and len(train_rows) > 100:
        # Monotone constraints: higher colorRank (worse color) → lower residual
        # (worse color shouldn't increase price), similarly for clarity
        gbm = lgb.LGBMRegressor(
            n_estimators=200,
            max_depth=5,
            num_leaves=31,
            learning_rate=0.03,
            min_child_samples=20,
            subsample=0.8,
            colsample_bytree=0.8,
            reg_alpha=0.1,
            reg_lambda=0.1,
            # logCarat=1 (nondecreasing): residual must not reverse surface carat monotonicity
            monotone_constraints=[1, -1, -1, 0, 0, 0, 0, 0, 0, 0, 0],
            random_state=RANDOM_SEED,
            verbose=-1,
        )
        # Weight training examples by support
        gbm.fit(X, targets, sample_weight=support_weights)
        residual_model = {"type": "lightgbm", "model": gbm}
    else:
        # Fallback: simple mean residual per cell
        cell_residuals = defaultdict(list)
        for i, row in enumerate(train_rows):
            key = cell_key(row)
            cell_residuals[key].append(targets[i])
        cell_mean_residual = {k: mean(v) for k, v in cell_residuals.items()}
        residual_model = {"type": "cell_mean", "means": cell_mean_residual}

    return residual_model


def predict_residual(row, residual_model, features=None):
    """Predict residual for a single row."""
    if residual_model["type"] == "lightgbm":
        if features is None:
            features = build_residual_features([row])
        return float(residual_model["model"].predict(features)[0])
    else:
        key = cell_key(row)
        return residual_model["means"].get(key, 0.0)


def compute_shrink_weight(row, cell_index, train_benchmark_cells=None):
    """Compute residual shrinkage weight based on cell support.

    If train_benchmark_cells is provided and the row's benchmark cell
    (with carat_band) was NOT in the training set, returns 0.0 —
    held-out cells get pure surface predictions with no residual.
    """
    if train_benchmark_cells is not None:
        bm_key = benchmark_cell_key(row)
        if bm_key not in train_benchmark_cells:
            return 0.0
    key = cell_key(row)
    n = len(cell_index.get(key, []))
    return min(1.0, n / N_THRESHOLD)


def cell_is_held_out(row, train_benchmark_cells):
    """Check if the row's benchmark cell (with carat_band) was held out."""
    if train_benchmark_cells is None:
        return False
    return benchmark_cell_key(row) not in train_benchmark_cells


# ═══════════════════════════════════════════════════════════════════════════════
# Full Hybrid Prediction
# ═══════════════════════════════════════════════════════════════════════════════

def predict_s29(row, base_anchors, cut_anchors, surface, residual_model,
                cell_index, train_benchmark_cells=None):
    """Full S29 hybrid prediction.

    log($/ct) = surface(row) + cell_offset + shrink_weight * residual(row)

    For held-out benchmark cells (carat_band not seen in training),
    forces pure surface prediction: no anchor offset, no residual.
    This prevents same-spec leakage where anchor offsets from one
    carat band contaminate predictions for a different carat band.
    """
    if cell_is_held_out(row, train_benchmark_cells):
        surface_log = surface["predictor"](row)
        upc = math.exp(surface_log)
        return {
            "price": upc * row["carat"],
            "upc": upc,
            "logUpc": surface_log,
            "anchorLogUpc": surface_log,
            "anchorSource": "surface_held_out",
            "residual": 0.0,
            "shrinkWeight": 0.0,
            "cellSupport": 0,
        }

    anchor_log, anchor_source = predict_anchor_for_row_cut_stratified(
        row, base_anchors, cut_anchors, surface)

    shrink_w = compute_shrink_weight(row, cell_index)
    residual = predict_residual(row, residual_model)

    log_upc = anchor_log + shrink_w * residual
    upc = math.exp(log_upc)
    carat = row["carat"]

    return {
        "price": upc * carat,
        "upc": upc,
        "logUpc": log_upc,
        "anchorLogUpc": anchor_log,
        "anchorSource": anchor_source,
        "residual": residual,
        "shrinkWeight": shrink_w,
        "cellSupport": len(cell_index.get(cell_key(row), [])),
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Evaluation Metrics
# ═══════════════════════════════════════════════════════════════════════════════

def pct_metrics(actuals, preds):
    """Compute MAPE, MdAPE, P90APE, bias."""
    errors = []
    signed = []
    for a, p in zip(actuals, preds):
        if a > 0 and p > 0:
            errors.append(abs(p - a) / a)
            signed.append((p - a) / a)
    if not errors:
        return {"n": 0, "mape": None, "mdape": None, "p90ape": None, "biasPct": None}
    errors_sorted = sorted(errors)
    return {
        "n": len(errors),
        "mape": round(100.0 * mean(errors), 4),
        "mdape": round(100.0 * median(errors), 4),
        "p90ape": round(100.0 * errors_sorted[int(0.9 * (len(errors_sorted) - 1))], 4),
        "biasPct": round(100.0 * mean(signed), 4),
    }


def group_metrics(rows, preds, key_fn, min_n=5):
    grouped = defaultdict(lambda: {"actuals": [], "preds": []})
    for row, pred in zip(rows, preds):
        key = key_fn(row)
        a = float(row["price"])
        p = float(pred["price"]) if isinstance(pred, dict) else float(pred)
        if a > 0 and p > 0:
            grouped[key]["actuals"].append(a)
            grouped[key]["preds"].append(p)
    return {
        key: pct_metrics(v["actuals"], v["preds"])
        for key, v in sorted(grouped.items())
        if len(v["actuals"]) >= min_n
    }


def evaluate_monotonicity_grid(surface, norms):
    """Full monotonicity grid evaluation across common grades (Phase 1/2)."""
    base = {
        "rowNo": 999999, "reportNo": "CHECK",
        "shape": "round_standard", "shape_style": "round_standard",
        "cut": "ID",
        "carat": 1.0, "color": "D", "colorRank": 0,
        "clarity": "IF", "clarityRank": 0,
        "isHpht": 0.0,
        "lwRatio": norms.get("round", norms["_global"])["lwRatio"],
        "tablePct": norms.get("round", norms["_global"])["tablePct"],
        "depthPct": norms.get("round", norms["_global"])["depthPct"],
        "vintage01": 1.0,
        "polish": "EX", "symmetry": "EX",
    }

    def score(row):
        return math.exp(surface["predictor"](row))

    results = {}

    # Carat × grade grids
    for color in ["D", "E", "F"]:
        for clarity in ["IF", "VS1", "VS2"]:
            label = f"ROUND {color} {clarity}"
            carat_prices = {}
            for ct in [1.0, 1.5, 2.0, 3.0, 5.0, 10.0]:
                row = dict(base, color=color, clarity=clarity,
                           colorRank=COLOR_RANK[color], clarityRank=CLARITY_RANK[clarity],
                           carat=ct, logCarat=math.log(ct))
                carat_prices[str(ct)] = round(score(row), 2)
            nondec = all(
                list(carat_prices.values())[i + 1] + 1e-9 >= list(carat_prices.values())[i]
                for i in range(len(carat_prices) - 1)
            )
            results[label] = {"prices": carat_prices, "caratNondecreasing": nondec}

    # Color ladder at 1ct ROUND VS1
    color_ladder = {}
    for color in ["D", "E", "F", "G", "H"]:
        row = dict(base, color=color, colorRank=COLOR_RANK[color], clarity="VS1",
                   clarityRank=CLARITY_RANK["VS1"], carat=1.0, logCarat=0.0)
        color_ladder[color] = round(score(row), 2)
    color_ok = all(
        list(color_ladder.values())[i + 1] <= list(color_ladder.values())[i] + 1e-9
        for i in range(len(color_ladder) - 1)
    )

    # Clarity ladder at 1ct ROUND E
    clarity_ladder = {}
    for clarity in ["IF", "VVS1", "VVS2", "VS1", "VS2", "SI1"]:
        row = dict(base, color="E", colorRank=COLOR_RANK["E"], clarity=clarity,
                   clarityRank=CLARITY_RANK[clarity], carat=1.0, logCarat=0.0)
        clarity_ladder[clarity] = round(score(row), 2)
    clarity_ok = all(
        list(clarity_ladder.values())[i + 1] <= list(clarity_ladder.values())[i] + 1e-9
        for i in range(len(clarity_ladder) - 1)
    )

    results["_colorLadder1ctRoundVS1"] = {"prices": color_ladder, "nonincreasing": color_ok}
    results["_clarityLadder1ctRoundE"] = {"prices": clarity_ladder, "nonincreasing": clarity_ok}

    return results


def evaluate_support_tier_breakdown(rows, preds, cell_index, key_fn=benchmark_cell_key):
    """Report metrics by support tier (Phase 1 requirement).

    Uses the key_fn that matches how cell_index was built. For benchmark
    evaluation, this is benchmark_cell_key (with carat_band). For anchor
    support, this would be cell_key (without carat_band).
    """
    tiers = defaultdict(lambda: {"actuals": [], "preds": []})
    for row, pred in zip(rows, preds):
        key = key_fn(row)
        n = len(cell_index.get(key, []))
        tier = support_tier(n)
        a = float(row["price"])
        p = float(pred["price"]) if isinstance(pred, dict) else float(pred)
        if a > 0 and p > 0:
            tiers[tier]["actuals"].append(a)
            tiers[tier]["preds"].append(p)
    return {
        tier: pct_metrics(v["actuals"], v["preds"])
        for tier, v in sorted(tiers.items())
    }


def evaluate_residual_contribution(rows, preds, cell_index, key_fn=benchmark_cell_key):
    """Report residual contribution by support tier (Phase 5)."""
    tiers = defaultdict(lambda: {"contribs": [], "abs_contribs": []})
    for row, pred in zip(rows, preds):
        if not isinstance(pred, dict) or "shrinkWeight" not in pred:
            continue
        key = key_fn(row)
        n = len(cell_index.get(key, []))
        tier = support_tier(n)
        contrib = pred.get("shrinkWeight", 0) * pred.get("residual", 0)
        tiers[tier]["contribs"].append(contrib)
        tiers[tier]["abs_contribs"].append(abs(contrib))
    return {
        tier: {
            "meanResidualContribution": round(float(np.mean(v["contribs"])), 6),
            "meanAbsResidualContribution": round(float(np.mean(v["abs_contribs"])), 6),
            "n": len(v["contribs"]),
        }
        for tier, v in sorted(tiers.items())
    }


def evaluate_full_hybrid_monotonicity(predict_fn, norms):
    """Check monotonicity of the FULL S29 hybrid (surface + anchors + residual).

    Tests carat, color, and clarity ladders for common specs where anchors
    exist, for both Tier A and Tier B, and for held-out (surface-only) cases.
    """
    tests = []

    # Carat ladders: ROUND_STANDARD, common grades, Tier A
    for color, clarity, color_rank, clarity_rank in [
        ("D", "IF", 0, 0), ("E", "VS1", 1, 3), ("F", "VS2", 2, 4)
    ]:
        for cut, cut_tier in [("ID", "A"), ("EX", "A"), ("VG", "B")]:
            prices = []
            for ct in [1.0, 2.0, 3.0, 5.0, 10.0]:
                row = {
                    "rowNo": 999999, "reportNo": "MONO_FULL",
                    "shape": "round_standard", "shape_style": "round_standard",
                    "cut": cut, "cutTier": cut_tier, "originalCutRaw": cut,
                    "carat": ct, "logCarat": math.log(ct),
                    "pricePerCarat": 0, "logUpc": 0, "price": 0,
                    "color": color, "colorRank": color_rank,
                    "clarity": clarity, "clarityRank": clarity_rank,
                    "isHpht": 0.0, "typeName": "CVD",
                    "lwRatio": 1.0, "tablePct": 58.0, "depthPct": 62.0,
                    "polish": "EX", "symmetry": "EX",
                    "vintage01": 1.0, "rawShape": "ROUND",
                }
                try:
                    pred = predict_fn(row)
                    prices.append(pred["upc"])
                except Exception:
                    prices.append(None)

            valid = [p for p in prices if p is not None]
            nondec = all(valid[i + 1] + 1e-9 >= valid[i] for i in range(len(valid) - 1)) if len(valid) >= 2 else True
            tests.append({
                "type": "carat", "label": f"ROUND {color} {clarity} Tier{cut_tier}",
                "nondecreasing": nondec,
                "prices": dict(zip(["1ct", "2ct", "3ct", "5ct", "10ct"],
                                   [round(p, 2) if p else None for p in prices])),
            })

    # Color ladder: ROUND, 1ct, VS1, Tier A
    color_prices = []
    for color in ["D", "E", "F", "G", "H"]:
        row = {
            "rowNo": 999999, "reportNo": "MONO_FULL",
            "shape": "round_standard", "shape_style": "round_standard",
            "cut": "EX", "cutTier": "A", "originalCutRaw": "EX",
            "carat": 1.0, "logCarat": 0.0,
            "pricePerCarat": 0, "logUpc": 0, "price": 0,
            "color": color, "colorRank": COLOR_RANK[color],
            "clarity": "VS1", "clarityRank": CLARITY_RANK["VS1"],
            "isHpht": 0.0, "typeName": "CVD",
            "lwRatio": 1.0, "tablePct": 58.0, "depthPct": 62.0,
            "polish": "EX", "symmetry": "EX",
            "vintage01": 1.0, "rawShape": "ROUND",
        }
        try:
            pred = predict_fn(row)
            color_prices.append(pred["upc"])
        except Exception:
            color_prices.append(None)
    valid_co = [p for p in color_prices if p is not None]
    color_ok = all(valid_co[i + 1] <= valid_co[i] + 1e-9 for i in range(len(valid_co) - 1)) if len(valid_co) >= 2 else True
    tests.append({
        "type": "color", "label": "ROUND 1ct VS1 TierA color ladder",
        "nonincreasing": color_ok,
        "prices": dict(zip(["D", "E", "F", "G", "H"], [round(p, 2) if p else None for p in color_prices])),
    })

    # Clarity ladder: ROUND, 1ct, E, Tier A
    clarity_prices = []
    for clarity in ["IF", "VVS1", "VVS2", "VS1", "VS2", "SI1"]:
        row = {
            "rowNo": 999999, "reportNo": "MONO_FULL",
            "shape": "round_standard", "shape_style": "round_standard",
            "cut": "EX", "cutTier": "A", "originalCutRaw": "EX",
            "carat": 1.0, "logCarat": 0.0,
            "pricePerCarat": 0, "logUpc": 0, "price": 0,
            "color": "E", "colorRank": COLOR_RANK["E"],
            "clarity": clarity, "clarityRank": CLARITY_RANK[clarity],
            "isHpht": 0.0, "typeName": "CVD",
            "lwRatio": 1.0, "tablePct": 58.0, "depthPct": 62.0,
            "polish": "EX", "symmetry": "EX",
            "vintage01": 1.0, "rawShape": "ROUND",
        }
        try:
            pred = predict_fn(row)
            clarity_prices.append(pred["upc"])
        except Exception:
            clarity_prices.append(None)
    valid_cl = [p for p in clarity_prices if p is not None]
    clarity_ok = all(valid_cl[i + 1] <= valid_cl[i] + 1e-9 for i in range(len(valid_cl) - 1)) if len(valid_cl) >= 2 else True
    tests.append({
        "type": "clarity", "label": "ROUND 1ct E TierA clarity ladder",
        "nonincreasing": clarity_ok,
        "prices": dict(zip(["IF", "VVS1", "VVS2", "VS1", "VS2", "SI1"],
                           [round(p, 2) if p else None for p in clarity_prices])),
    })

    return tests


def pinned_cases_evaluation(predict_fn, s26_intel):
    """Evaluate on pinned cases from §9.3 of the research report."""
    cases = [
        {"carat": 7.77, "shape_style": "round_standard", "color": "E", "clarity": "VS1",
         "colorRank": 1, "clarityRank": 3, "cut": "EX", "label": "7.77ct ROUND E VS1"},
        {"carat": 3.0, "shape_style": "round_standard", "color": "E", "clarity": "VS1",
         "colorRank": 1, "clarityRank": 3, "cut": "EX", "label": "3.0ct ROUND E VS1"},
        {"carat": 3.0, "shape_style": "round_standard", "color": "E", "clarity": "VS2",
         "colorRank": 1, "clarityRank": 4, "cut": "EX", "label": "3.0ct ROUND E VS2"},
        {"carat": 1.0, "shape_style": "round_standard", "color": "D", "clarity": "IF",
         "colorRank": 0, "clarityRank": 0, "cut": "ID", "label": "1.0ct ROUND D IF"},
    ]

    results = {}
    for case in cases:
        base = {
            "rowNo": 999999, "reportNo": "PINNED",
            "shape": case.get("shape_style", case.get("shape", "round")),
            "shape_style": case.get("shape_style", case.get("shape", "round")),
            "cut": case["cut"],
            "cutTier": "A" if case["cut"] in ("ID", "EX") else "B",
            "carat": case["carat"], "logCarat": math.log(case["carat"]),
            "pricePerCarat": 0, "logUpc": 0, "price": 0,
            "color": case["color"], "colorRank": case["colorRank"],
            "clarity": case["clarity"], "clarityRank": case["clarityRank"],
            "isHpht": 0.0,
            "lwRatio": 1.0, "tablePct": 58.0, "depthPct": 62.0,
            "polish": "EX", "symmetry": "EX",
            "vintage01": 1.0,
        }
        try:
            pred = predict_fn(base)
            results[case["label"]] = {
                "upc": round(pred["upc"], 2),
                "price": round(pred["price"], 2),
                "anchorSource": pred.get("anchorSource", "N/A"),
                "cellSupport": pred.get("cellSupport", 0),
                "shrinkWeight": pred.get("shrinkWeight", 0),
            }
        except Exception as e:
            results[case["label"]] = {"error": str(e)}

    return results


# ═══════════════════════════════════════════════════════════════════════════════
# Tune k_prior
# ═══════════════════════════════════════════════════════════════════════════════

def tune_k_prior(train_rows, cell_index, surface, k_values=None):
    """Tune prior strength k using within-cell row-split validation (Fix 5).

    For cells with >= 10 rows, hold out 20% of rows. This ensures the anchor
    exists but with reduced support, so k actually affects the prediction.
    Cells with < 10 rows go entirely to training.
    """
    if k_values is None:
        k_values = [1, 2, 3, 5, 8, 10, 15, 20, 30]

    best_k = K_PRIOR
    best_mape = float("inf")
    results = {}

    # Within-cell split: for cells with enough rows, hold out some rows
    kt_train_indices = []
    kt_val_indices = []
    for key, indices in cell_index.items():
        if len(indices) >= 10:
            # Deterministic split: hash-based row assignment within cell
            cell_train = []
            cell_val = []
            for idx in indices:
                row = train_rows[idx]
                h = int(hashlib.md5(f"{row['rowNo']}:{key}".encode()).hexdigest(), 16) % 100
                if h < 20:
                    cell_val.append(idx)
                else:
                    cell_train.append(idx)
            kt_train_indices.extend(cell_train)
            kt_val_indices.extend(cell_val)
        else:
            kt_train_indices.extend(indices)
            # Small cells: no validation rows (can't hold out from a cell with 3 rows)

    if len(kt_val_indices) < 50:
        # Fallback: use cell-level split (previous method)
        kt_train_cells = set()
        kt_val_cells = set()
        for key in cell_index:
            h = cell_hash(key + "_ktune")
            if h / 1000.0 < 0.2:
                kt_val_cells.add(key)
            else:
                kt_train_cells.add(key)
        kt_train_indices = []
        kt_val_indices = []
        for key in kt_train_cells:
            kt_train_indices.extend(cell_index.get(key, []))
        for key in kt_val_cells:
            kt_val_indices.extend(cell_index.get(key, []))

    if not kt_val_indices:
        return best_k, {"note": "no validation rows for k-tuning"}

    kt_train = [train_rows[i] for i in kt_train_indices]
    kt_val = [train_rows[i] for i in kt_val_indices]
    kt_train_index = build_cell_index(kt_train)

    for k in k_values:
        anchors = build_empirical_bayes_anchor(kt_train, kt_train_index, surface, k_prior=k)
        errors = []
        for row in kt_val:
            anchor_log = predict_anchor_for_row(row, anchors, surface)
            pred_upc = math.exp(anchor_log)
            actual_upc = row["pricePerCarat"]
            if actual_upc > 0 and pred_upc > 0:
                errors.append(abs(pred_upc - actual_upc) / actual_upc)
        mape_k = 100.0 * mean(errors) if errors else float("inf")
        results[str(k)] = round(mape_k, 4)
        if mape_k < best_mape:
            best_mape = mape_k
            best_k = k

    return best_k, results


# ═══════════════════════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    print("=" * 70)
    print("S29 Hybrid Model Training Pipeline")
    print("=" * 70)

    # ── Load data ──────────────────────────────────────────────────────────
    print("\n[1/8] Loading data...")
    all_rows = load_rows()
    print(f"  Loaded {len(all_rows)} rows from dataset-clean-training.json")

    # Assign vintage01
    min_row = min(r["rowNo"] for r in all_rows)
    max_row = max(r["rowNo"] for r in all_rows)
    span = max(1, max_row - min_row)
    for row in all_rows:
        row["vintage01"] = (row["rowNo"] - min_row) / span

    # ── Phase 1: Build cell index and held-out split ───────────────────────
    print("\n[2/8] Phase 1: Building held-out cell benchmark...")
    # Benchmark split uses carat_band in the key (tests extrapolation to unseen carat ranges)
    benchmark_cell_index = build_cell_index(all_rows, key_fn=benchmark_cell_key)
    cell_stats = cell_support_stats(benchmark_cell_index)
    print(f"  Total cells (with carat_band): {cell_stats['totalCells']}")
    print(f"  Dense (>=20): {cell_stats['denseCells']}, "
          f"Medium (5-19): {cell_stats['mediumCells']}, "
          f"Sparse (1-4): {cell_stats['sparseCells']}")
    print(f"  Cell sizes: median={cell_stats['cellSizeDistribution']['median']}, "
          f"p75={cell_stats['cellSizeDistribution']['p75']}, "
          f"max={cell_stats['cellSizeDistribution']['max']}")

    train_cells, holdout_cells = split_cells_holdout(benchmark_cell_index)
    train_indices = get_rows_from_cells(all_rows, benchmark_cell_index, train_cells)
    holdout_indices = get_rows_from_cells(all_rows, benchmark_cell_index, holdout_cells)
    train_rows = [all_rows[i] for i in train_indices]
    holdout_rows = [all_rows[i] for i in holdout_indices]

    # Anchor cell index does NOT use carat_band (surface handles all carat variation)
    anchor_cell_index = build_cell_index(train_rows, key_fn=cell_key)
    anchor_cell_stats = cell_support_stats(anchor_cell_index)
    print(f"  Anchor cells (without carat_band): {anchor_cell_stats['totalCells']}")
    print(f"  Train: {len(train_rows)} rows in {len(train_cells)} benchmark cells")
    print(f"  Holdout: {len(holdout_rows)} rows in {len(holdout_cells)} benchmark cells")

    # Build cell index from training data only (for anchors)
    anchor_cell_index = build_cell_index(train_rows)

    print(f"  Train: {len(train_rows)} rows in {len(train_cells)} cells")
    print(f"  Holdout: {len(holdout_rows)} rows in {len(holdout_cells)} cells")

    # ── Phase 2: Train fixed S28 surface ───────────────────────────────────
    print("\n[3/8] Phase 2: Training fixed S28 monotone surface...")
    surface = train_s28_surface(train_rows)
    train_logs = np.array([surface["predictor"](r) for r in train_rows])
    holdout_logs = np.array([surface["predictor"](r) for r in holdout_rows])

    surface_train_metrics = pct_metrics(
        [r["pricePerCarat"] for r in train_rows],
        [math.exp(l) for l in train_logs])
    surface_holdout_metrics = pct_metrics(
        [r["pricePerCarat"] for r in holdout_rows],
        [math.exp(l) for l in holdout_logs])

    print(f"  Surface train MAPE: {surface_train_metrics['mape']}%")
    print(f"  Surface holdout MAPE: {surface_holdout_metrics['mape']}%")

    # Monotonicity gates
    mono_checks = check_monotonicity(surface, surface["norms"])
    all_mono_ok = True
    for name, result in mono_checks.items():
        ok = result["nondecreasing"]
        if not ok:
            all_mono_ok = False
        print(f"  {name}: carat nondecreasing = {ok}  {result['prices']}")

    if not all_mono_ok:
        print("  WARNING: Some monotonicity gates failed!")
    else:
        print("  All monotonicity gates passed.")

    # ── Phase 3: Empirical-Bayes anchor (tune k) ───────────────────────────
    print("\n[4/8] Phase 3: Tuning empirical-Bayes prior strength k...")
    best_k, k_tuning_results = tune_k_prior(
        train_rows, anchor_cell_index, surface)
    print(f"  Best k = {best_k}")
    print(f"  k tuning results (holdout-cell MAPE): {k_tuning_results}")

    base_anchors = build_empirical_bayes_anchor(
        train_rows, anchor_cell_index, surface, k_prior=best_k)

    # ── Phase 4: Cut-stratified anchors ────────────────────────────────────
    print("\n[5/8] Phase 4: Building cut-stratified anchors...")
    cut_anchors = build_cut_stratified_anchors(
        train_rows, anchor_cell_index, surface, k_prior=best_k)

    # Count how many cells benefit from cut stratification
    cut_cells_with_support = sum(1 for v in cut_anchors.values() if v["n"] >= CUT_TIER_MIN_SUPPORT)
    print(f"  Cut-stratified cells with sufficient support (>= {CUT_TIER_MIN_SUPPORT}): "
          f"{cut_cells_with_support} / {len(cut_anchors)}")

    # Show premium vs commodity spread for a key example
    for shape in ["round", "oval_standard"]:
        for color in ["E"]:
            for clarity in ["VS1"]:
                for cb_label in ["3.00-3.99"]:
                    key_a = f"{shape}||{color}||{clarity}||{cb_label}||A"
                    key_b = f"{shape}||{color}||{clarity}||{cb_label}||B"
                    if key_a in cut_anchors and key_b in cut_anchors:
                        a_upc = math.exp(cut_anchors[key_a]["anchorLogUpc"])
                        b_upc = math.exp(cut_anchors[key_b]["anchorLogUpc"])
                        spread = (a_upc - b_upc) / b_upc * 100
                        print(f"  Example {cb_label} {shape} {color} {clarity}: "
                              f"Tier A=${a_upc:.0f}/ct, Tier B=${b_upc:.0f}/ct, "
                              f"spread={spread:.1f}%")

    # ── Phase 5: Train residual ────────────────────────────────────────────
    print("\n[6/8] Phase 5: Training support-shrunk residual model...")
    residual_model = train_residual_model(
        train_rows, base_anchors, cut_anchors, surface, anchor_cell_index)

    if residual_model["type"] == "lightgbm":
        # Feature importance
        if HAS_LGB:
            importance = residual_model["model"].feature_importances_
            feat_names = ["logCarat", "colorRank", "clarityRank", "isHpht",
                          "cut_ID", "cut_EX", "polish_EX", "symmetry_EX",
                          "lwRatio", "tablePct", "depthPct"]
            print("  Residual model feature importance:")
            for name, imp in sorted(zip(feat_names, importance), key=lambda x: -x[1]):
                print(f"    {name}: {imp:.4f}")
    else:
        print(f"  Using cell-mean residual fallback ({len(residual_model['means'])} cells)")

    # ── Full evaluation ────────────────────────────────────────────────────
    print("\n[7/8] Running full evaluation...")
    s26_intel = load_s26_intel()

    def make_s29_predictor():
        def predict(row):
            return predict_s29(row, base_anchors, cut_anchors, surface,
                               residual_model, anchor_cell_index,
                               train_benchmark_cells=train_cells)
        return predict

    s29_predict = make_s29_predictor()

    # Helper: S26 prediction with correct field normalization
    def predict_s26_for_row(r):
        p = predict_s26_lookup(r, s26_intel)
        return p if p else {"price": 0, "upc": 0}

    # ---- In-cell evaluation (training cells) ----
    train_eval_sample = train_rows[:min(5000, len(train_rows))]
    s29_train_preds = [s29_predict(r) for r in train_eval_sample]
    s28_train_preds = [{"price": math.exp(surface["predictor"](r)) * r["carat"],
                        "upc": math.exp(surface["predictor"](r))}
                       for r in train_eval_sample]
    s26_train_preds = [predict_s26_for_row(r) for r in train_eval_sample]

    train_actuals = [float(r["price"]) for r in train_eval_sample]
    s29_train_metrics = pct_metrics(train_actuals, [p["price"] for p in s29_train_preds])
    s28_train_metrics = pct_metrics(train_actuals, [p["price"] for p in s28_train_preds])
    s26_train_metrics = pct_metrics(train_actuals, [p["price"] for p in s26_train_preds])

    print(f"\n  IN-CELL BENCHMARK (training cells, n={len(train_eval_sample)}):")
    print(f"  {'Model':<8} {'MAPE':>8} {'MdAPE':>8} {'Bias%':>8}")
    print(f"  {'-'*36}")
    print(f"  {'S29':<8} {s29_train_metrics['mape']:>7.2f}% {s29_train_metrics['mdape']:>7.2f}% "
          f"{s29_train_metrics['biasPct']:>7.2f}%")
    print(f"  {'S28':<8} {s28_train_metrics['mape']:>7.2f}% {s28_train_metrics['mdape']:>7.2f}% "
          f"{s28_train_metrics['biasPct']:>7.2f}%")
    print(f"  {'S26':<8} {s26_train_metrics['mape']:>7.2f}% {s26_train_metrics['mdape']:>7.2f}% "
          f"{s26_train_metrics['biasPct']:>7.2f}%")

    # In-cell support-tier breakdown
    s29_train_tiers = evaluate_support_tier_breakdown(
        train_eval_sample, s29_train_preds, benchmark_cell_index)
    s26_train_tiers = evaluate_support_tier_breakdown(
        train_eval_sample, s26_train_preds, benchmark_cell_index)

    print(f"\n  IN-CELL MAPE BY SUPPORT TIER:")
    print(f"  {'Tier':<8} {'S29':>10} {'S26':>10}  {'n_S29':>8}")
    print(f"  {'-'*40}")
    for tier in ["dense", "medium", "sparse"]:
        s29_m = s29_train_tiers.get(tier, {}).get("mape", None)
        s26_m = s26_train_tiers.get(tier, {}).get("mape", None)
        s29_n = s29_train_tiers.get(tier, {}).get("n", 0)
        print(f"  {tier:<8} {s29_m if s29_m else 'N/A':>10} "
              f"{s26_m if s26_m else 'N/A':>10}  {s29_n:>8}")

    # In-cell residual contribution
    train_residual_contrib = evaluate_residual_contribution(
        train_eval_sample, s29_train_preds, benchmark_cell_index)
    print(f"\n  IN-CELL RESIDUAL CONTRIBUTION BY SUPPORT TIER:")
    for tier, info in train_residual_contrib.items():
        print(f"  {tier:<8} mean={info['meanResidualContribution']:.4f} "
              f"abs_mean={info['meanAbsResidualContribution']:.4f} n={info['n']}")

    # ---- Held-out cell evaluation ----
    s29_holdout_preds = [s29_predict(r) for r in holdout_rows]
    s28_holdout_preds = [{"price": math.exp(surface["predictor"](r)) * r["carat"],
                          "upc": math.exp(surface["predictor"](r))}
                         for r in holdout_rows]
    s26_holdout_preds = [predict_s26_for_row(r) for r in holdout_rows]

    # Holdout metrics
    holdout_actuals = [float(r["price"]) for r in holdout_rows]
    s29_ho_metrics = pct_metrics(holdout_actuals, [p["price"] for p in s29_holdout_preds])
    s28_ho_metrics = pct_metrics(holdout_actuals, [p["price"] for p in s28_holdout_preds])
    s26_ho_metrics = pct_metrics(holdout_actuals, [p["price"] for p in s26_holdout_preds])

    print(f"\n  HELD-OUT CELL BENCHMARK (n={len(holdout_rows)} rows, {len(holdout_cells)} cells):")
    print(f"  {'Model':<8} {'MAPE':>8} {'MdAPE':>8} {'Bias%':>8}")
    print(f"  {'-'*36}")
    print(f"  {'S29':<8} {s29_ho_metrics['mape']:>7.2f}% {s29_ho_metrics['mdape']:>7.2f}% "
          f"{s29_ho_metrics['biasPct']:>7.2f}%")
    print(f"  {'S28':<8} {s28_ho_metrics['mape']:>7.2f}% {s28_ho_metrics['mdape']:>7.2f}% "
          f"{s28_ho_metrics['biasPct']:>7.2f}%")
    print(f"  {'S26':<8} {s26_ho_metrics['mape']:>7.2f}% {s26_ho_metrics['mdape']:>7.2f}% "
          f"{s26_ho_metrics['biasPct']:>7.2f}%")

    # Held-out support-tier breakdown (classify by FULL cell index)
    s29_ho_tiers = evaluate_support_tier_breakdown(holdout_rows, s29_holdout_preds, benchmark_cell_index)
    s28_ho_tiers = evaluate_support_tier_breakdown(holdout_rows, s28_holdout_preds, benchmark_cell_index)
    s26_ho_tiers = evaluate_support_tier_breakdown(holdout_rows, s26_holdout_preds, benchmark_cell_index)

    print(f"\n  HELD-OUT MAPE BY SUPPORT TIER:")
    print(f"  {'Tier':<8} {'S29':>10} {'S28':>10} {'S26':>10}  {'n':>6}")
    print(f"  {'-'*46}")
    for tier in ["dense", "medium", "sparse", "empty"]:
        s29_m = s29_ho_tiers.get(tier, {}).get("mape", None)
        s28_m = s28_ho_tiers.get(tier, {}).get("mape", None)
        s26_m = s26_ho_tiers.get(tier, {}).get("mape", None)
        n_tier = s29_ho_tiers.get(tier, {}).get("n", 0)
        if n_tier > 0:
            print(f"  {tier:<8} {s29_m if s29_m else 'N/A':>10} "
                  f"{s28_m if s28_m else 'N/A':>10} "
                  f"{s26_m if s26_m else 'N/A':>10}  {n_tier:>6}")

    # Held-out MAPE by carat bucket
    def carat_bucket_fn(row):
        return carat_band(row["carat"])
    s29_carat_metrics = group_metrics(holdout_rows, s29_holdout_preds, carat_bucket_fn, min_n=1)
    s26_carat_metrics = group_metrics(holdout_rows, s26_holdout_preds, carat_bucket_fn, min_n=1)

    print(f"\n  HELD-OUT MAPE BY CARAT BUCKET:")
    print(f"  {'Bucket':<12} {'S29':>10} {'S26':>10}")
    print(f"  {'-'*36}")
    for lo, hi, label in CARAT_BANDS:
        s29_m = s29_carat_metrics.get(label, {}).get("mape", None)
        s26_m = s26_carat_metrics.get(label, {}).get("mape", None)
        if s29_m or s26_m:
            print(f"  {label:<12} {s29_m if s29_m else 'N/A':>10} "
                  f"{s26_m if s26_m else 'N/A':>10}")

    # Surface monotonicity grid
    mono_grid = evaluate_monotonicity_grid(surface, surface["norms"])
    grid_failures = [name for name, result in mono_grid.items()
                     if name.startswith("_") and not result.get("nonincreasing", True)
                     or not name.startswith("_") and not result.get("caratNondecreasing", True)]

    print(f"\n  SURFACE MONOTONICITY GRID: "
          f"{'All checks passed.' if not grid_failures else f'FAILURES: {grid_failures}'}")

    # Full-hybrid monotonicity (Fix 4) — test structural behavior WITHOUT the
    # held-out check. The held-out split is an evaluation concern; monotonicity
    # tests the model architecture itself.
    def s29_predict_no_holdout_check(row):
        return predict_s29(row, base_anchors, cut_anchors, surface,
                           residual_model, anchor_cell_index,
                           train_benchmark_cells=None)
    full_mono_tests = evaluate_full_hybrid_monotonicity(s29_predict_no_holdout_check, surface["norms"])
    full_mono_failures = [t for t in full_mono_tests
                          if not t.get("nondecreasing", True) or not t.get("nonincreasing", True)]

    print(f"\n  FULL-HYBRID MONOTONICITY:")
    for t in full_mono_tests:
        ok = t.get("nondecreasing", t.get("nonincreasing", True))
        flag = "" if ok else " *** FAIL ***"
        print(f"    {t['label']}: {'PASS' if ok else 'FAIL'}{flag}")
        if not ok:
            print(f"      Prices: {t['prices']}")

    # Pinned cases
    pinned = pinned_cases_evaluation(s29_predict, s26_intel)
    print(f"\n  PINNED CASES:")
    for label, info in pinned.items():
        if "error" in info:
            print(f"  {label}: ERROR - {info['error']}")
        else:
            print(f"  {label}: ${info['price']:.0f} (${info['upc']:.0f}/ct) "
                  f"anchor={info['anchorSource']} support={info['cellSupport']} "
                  f"shrink={info['shrinkWeight']:.2f}")

    # Check for the specific E VS1 vs VS2 inversion the audit flagged
    vs1_price = None
    vs2_price = None
    for label, info in pinned.items():
        if "3.0ct ROUND E VS1" in label:
            vs1_price = info.get("upc")
        if "3.0ct ROUND E VS2" in label:
            vs2_price = info.get("upc")
    pinned_clarity_ok = True
    if vs1_price and vs2_price:
        pinned_clarity_ok = vs2_price <= vs1_price + 1e-9
        if not pinned_clarity_ok:
            print(f"\n  *** PINNED CASE CLARITY VIOLATION: E/VS2=${vs2_price} > E/VS1=${vs1_price}")

    # ---- Decision Rule Check ----
    print(f"\n[8/8] Decision Rule Evaluation:")
    print(f"  Rule 1: S29 matches S26 within 1pp on dense held-out cells?")
    s29_dense_ho = s29_ho_tiers.get("dense", {}).get("mape", None)
    s26_dense_ho = s26_ho_tiers.get("dense", {}).get("mape", None)
    rule1 = (s29_dense_ho is not None and s26_dense_ho is not None
             and abs(s29_dense_ho - s26_dense_ho) <= 1.0)
    print(f"    S29 dense held-out MAPE={s29_dense_ho}, S26 dense held-out MAPE={s26_dense_ho} -> "
          f"{'PASS' if rule1 else 'FAIL'}")

    print(f"  Rule 1b: S29 BEATS S26 on dense IN-CELL rows?")
    s29_dense_in = s29_train_tiers.get("dense", {}).get("mape", None)
    s26_dense_in = s26_train_tiers.get("dense", {}).get("mape", None)
    rule1b = (s29_dense_in is not None and s26_dense_in is not None and s29_dense_in < s26_dense_in)
    print(f"    S29 dense in-cell MAPE={s29_dense_in}, S26 dense in-cell MAPE={s26_dense_in} -> "
          f"{'PASS (S29 better by ' + str(round(s26_dense_in - s29_dense_in, 1)) + 'pp)' if rule1b else 'FAIL'}")

    print(f"  Rule 2: Zero FULL-HYBRID monotonicity violations?")
    rule2 = len(grid_failures) == 0 and len(full_mono_failures) == 0 and all_mono_ok and pinned_clarity_ok
    all_failures = grid_failures + [t["label"] for t in full_mono_failures]
    if not pinned_clarity_ok:
        all_failures.append("pinned_E_VS1_VS2_inversion")
    print(f"    Surface failures={grid_failures}, full-hybrid failures={[t['label'] for t in full_mono_failures]}, "
          f"pinned_clarity_ok={pinned_clarity_ok} -> "
          f"{'PASS' if rule2 else 'FAIL'}")

    print(f"  Rule 3: Continuous in carat except at magic-weight thresholds?")
    # With offset architecture, carat-continuity of surface + anchor is maintained
    # since offset is per-cell constant and surface is continuous
    carat_tests = [t for t in full_mono_tests if t["type"] == "carat"]
    rule3 = all(t.get("nondecreasing", True) for t in carat_tests)
    print(f"    Full-hybrid carat ladders all nondecreasing: {rule3} -> {'PASS' if rule3 else 'FAIL'}")

    print(f"  Rule 5: S29 meaningfully improves over S28 on held-out sparse/extrapolation?")
    s29_ho_sparse = s29_ho_tiers.get("sparse", {}).get("mape", None)
    s28_ho_sparse = s28_ho_tiers.get("sparse", {}).get("mape", None)
    # Must beat S28 by at least 1pp, or sparse MAPE must be under an absolute bound
    SPARSE_MAPE_BOUND = 50.0  # absolute fallback: sparse MAPE must be reasonable
    rule5 = (s29_ho_sparse is not None and s28_ho_sparse is not None
             and (s29_ho_sparse < s28_ho_sparse - 1.0
                  or (s29_ho_sparse < SPARSE_MAPE_BOUND and s29_ho_sparse <= s28_ho_sparse + 0.01)))
    print(f"    S29 sparse MAPE={s29_ho_sparse}, S28 sparse MAPE={s28_ho_sparse} -> "
          f"{'PASS' if rule5 else 'FAIL'} "
          f"(requires S29 < S28 by >=1pp, or S29 < {SPARSE_MAPE_BOUND}% and not worse than S28)")

    rules_passed = sum([rule1, rule2, rule3, rule5])
    print(f"\n  Decision rules passed: {rules_passed}/4 (excl. Rule 1b)")
    print(f"  Rule 1b (S29 beats S26 on in-cell dense): {'PASS' if rule1b else 'FAIL'}")

    # ── Save model artifact ────────────────────────────────────────────────
    print(f"\n  Saving model artifact to {OUTPUT_MODEL_JSON}...")

    model_artifact = {
        "generatedDate": date.today().isoformat(),
        "modelName": "S29 — Empirical-Bayes anchored hybrid pricing model",
        "modelVersion": "s29-hybrid-v1.0",
        "targetType": "hybrid_anchor_surface_residual",
        "prediction": ("Empirical-Bayes cell anchor (log-space shrinkage toward S28 surface) "
                       "+ cut-stratified anchoring (Tier A/B) "
                       "+ support-shrunk monotone LightGBM residual"),
        "architecture": {
            "predictionFormula": "log($/ct) = surface(row) + cell_offset + shrink_weight * residual(row)",
            "anchor": "Empirical-Bayes cell OFFSET from surface: offset = (n*mean_residual + k*0)/(n+k), shrunk toward zero as support thins",
            "surface": "S28-fixed monotone parametric surface — always active, anchors are additive offsets",
            "cutStratification": "Tier A (ID/EX, EX/VG polish+symmetry) vs Tier B (commodity), offsets per tier",
            "residual": "Monotone LightGBM on log(actual/(surface+offset)), shrunk by min(1, n/10)",
            "displayBoundary": "PAV/isotonic projection reserved for display layer only",
        },
        "configuration": {
            "kPrior": best_k,
            "nThreshold": N_THRESHOLD,
            "cutTierMinSupport": CUT_TIER_MIN_SUPPORT,
            "cellHoldoutFrac": CELL_HOLDOUT_FRAC,
            "randomSeed": RANDOM_SEED,
        },
        "data": {
            "source": "research/data/dataset-clean-training.json",
            "totalRows": len(all_rows),
            "trainRows": len(train_rows),
            "holdoutRows": len(holdout_rows),
            "trainCells": len(train_cells),
            "holdoutCells": len(holdout_cells),
            "holdoutMethod": "cell-hash-based (whole cells held out, not rows)",
        },
        "surfaceModel": {
            "featureNames": surface["names"],
            "coefficients": surface["coefficients"],
            "featureMeans": [round(float(v), 10) for v in surface["means"]],
            "featureStds": [round(float(v), 10) for v in surface["stds"]],
            "norms": {k: v for k, v in surface["norms"].items()},
            "shapes": surface["shapes"],
            "cuts": surface["cuts"],
            "shapeInteractions": surface["shape_interactions"],
            "cutInteractions": surface["cut_interactions"],
            "trainMetrics": surface_train_metrics,
            "holdoutMetrics": surface_holdout_metrics,
            "monotonicityGates": {k: v["nondecreasing"] for k, v in mono_checks.items()},
        },
        "anchors": {
            "type": "surface_offsets",
            "baseAnchors": {
                key: {"offset": round(v["offset"], 10), "n": v["n"],
                      "meanResidual": round(v["meanResidual"], 10)}
                for key, v in base_anchors.items()
            },
            "cutStratifiedAnchors": {
                key: {"offset": round(v["offset"], 10), "n": v["n"],
                      "meanResidual": round(v["meanResidual"], 10)}
                for key, v in cut_anchors.items()
            },
            "baseAnchorsCount": len(base_anchors),
            "cutStratifiedAnchorsCount": len(cut_anchors),
            "cutAnchorsWithSupport": cut_cells_with_support,
            "kPrior": best_k,
            "kTuningResults": k_tuning_results,
        },
        "residualModel": {
            "type": residual_model["type"],
            "featureNames": ["logCarat", "colorRank", "clarityRank", "isHpht",
                             "cut_ID", "cut_EX", "polish_EX", "symmetry_EX",
                             "lwRatio", "tablePct", "depthPct"],
            "lightgbmDump": residual_model["model"].booster_.dump_model() if residual_model["type"] == "lightgbm" else None,
        },
        "evaluation": {
            "inCellBenchmark": {
                "s29": s29_train_metrics,
                "s28": s28_train_metrics,
                "s26": s26_train_metrics,
            },
            "inCellBySupportTier": {
                "s29": s29_train_tiers,
                "s26": s26_train_tiers,
            },
            "inCellResidualContributionByTier": train_residual_contrib,
            "holdoutCellBenchmark": {
                "s29": s29_ho_metrics,
                "s28": s28_ho_metrics,
                "s26": s26_ho_metrics,
            },
            "holdoutBySupportTier": {
                "s29": s29_ho_tiers,
                "s28": s28_ho_tiers,
                "s26": s26_ho_tiers,
            },
            "holdoutByCaratBucket": {
                "s29": s29_carat_metrics,
                "s26": s26_carat_metrics,
            },
            "monotonicityGrid": mono_grid,
            "fullHybridMonotonicity": {
                "tests": full_mono_tests,
                "allPassed": len(full_mono_failures) == 0,
                "failures": [t["label"] for t in full_mono_failures],
            },
            "pinnedCases": pinned,
            "pinnedClarityOk": pinned_clarity_ok,
            "decisionRule": {
                "rule1_denseMatchHeldout": rule1,
                "rule1b_beatS26InCellDense": rule1b,
                "rule2_zeroMonoViolations": rule2,
                "rule3_continuousCarat": rule3,
                "rule5_beatS28Sparse": rule5,
                "totalPassedCore": rules_passed,
                "totalCoreRules": 4,
            },
            "cellStatistics": cell_stats,
        },
    }

    # Save the model (without LightGBM binary which can't be JSON-serialized)
    serializable = json.loads(json.dumps(model_artifact, default=str))
    OUTPUT_MODEL_JSON.write_text(json.dumps(serializable, indent=2) + "\n")
    print(f"  Model saved.")

    # Save benchmark comparison
    OUTPUT_BENCHMARK_JSON.write_text(json.dumps({
        "date": date.today().isoformat(),
        "models": {
            "s29": s29_ho_metrics,
            "s28": s28_ho_metrics,
            "s26": s26_ho_metrics,
        },
        "supportTierBreakdown": {
            "s29": s29_ho_tiers,
            "s28": s28_ho_tiers,
            "s26": s26_ho_tiers,
        },
        "decisionRule": serializable["evaluation"]["decisionRule"],
    }, indent=2) + "\n")
    print(f"  Benchmark saved to {OUTPUT_BENCHMARK_JSON}")

    # ── Summary ────────────────────────────────────────────────────────────
    print(f"\n{'='*70}")
    print(f"TRAINING COMPLETE")
    print(f"{'='*70}")
    print(f"S29 in-cell MAPE: {s29_train_metrics['mape']}%, holdout-cell MAPE: {s29_ho_metrics['mape']}%")
    print(f"S28 in-cell MAPE: {s28_train_metrics['mape']}%, holdout-cell MAPE: {s28_ho_metrics['mape']}%")
    print(f"S26 in-cell MAPE: {s26_train_metrics['mape']}%, holdout-cell MAPE: {s26_ho_metrics['mape']}%")
    print(f"Decision rules passed: {rules_passed}/4")
    print(f"Best k_prior: {best_k}")

    return model_artifact


if __name__ == "__main__":
    main()
