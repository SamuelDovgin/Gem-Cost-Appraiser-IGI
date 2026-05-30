#!/usr/bin/env python3
"""
train-s25-parametric.py
───────────────────────────────────────────────────────────────────────────────
Train the S25 Hierarchical Parametric Power-Law pricing model.

Architecture:
  log($/ct) = β_global × log(carat)           (global carat power-law from rounds)
            + shapeBaseline[shape]              (per-shape intercept)
            + δ_color × color_rank             (global color gradient)
            + δ_clarity × clarity_rank         (global clarity gradient)
            + ε_spec                            (per-spec residual, shrunk)
            + γ_cut                             (cut adjustment, fitted from rounds)

Design decisions:
  • β_global comes from ROUND data only (9,701 obs, 0.30–5.06ct range).
    Fancy shapes span only 0.5–1.8ct — not enough range to identify their own β
    (the within-range β for fancy shapes is dominated by rate-card noise, not
    fundamental carat scarcity). Using β_round for all shapes captures the key
    extrapolation insight the user wants.
  • shapeBaseline[shape] + δ_color × color_rank + δ_clarity × clarity_rank gives
    a principled estimate for unseen (shape, color, clarity) combos (e.g., 5ct
    Heart D VS1 when only F VVS2 hearts exist in training data).
  • ε_spec is the per-spec residual ON TOP of the gradient model, shrunk toward 0.
    With few obs, ε_spec ≈ 0 and the gradient model drives the prediction.

Usage:
  python3 research/scripts/train-s25-parametric.py
───────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import json
import math
import os
from collections import defaultdict
from datetime import date
from pathlib import Path
from statistics import mean, median, stdev

import numpy as np

SCRIPT_DIR   = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
DATA_DIR     = PROJECT_ROOT / "data"

TRAINING_JSON = DATA_DIR / "dataset-clean-training.json"
OUTPUT_JSON   = DATA_DIR / "starsgem-ml-model-s25-parametric.json"

# ── Hyperparameters ───────────────────────────────────────────────────────────

# Shrinkage lambda for spec residuals ε_spec: higher = more shrinkage toward 0.
# With λ=20, a spec needs ~20 observations for its residual to be 50% trusted.
SHRINK_LAMBDA = 20.0

# Outlier filter: exclude rows where log_upc deviates > this many SDs from
# the per-spec-bucket median (protects against data errors like $19/ct 5ct rounds).
OUTLIER_SD_THRESH = 3.5

# Cut grade adjustments (prior-based; data has almost no VG/G variation).
CUT_PRIORS = {
    "ID":   0.0,
    "EX":   0.02,   # EX rounds tend to fetch slightly more than ID
    "VG":  -0.05,
    "G":   -0.10,
    "FAIR":-0.15,
    "-":    0.0,    # most fancy shapes — no grade, not a penalty
}

# Color ordinal ranks (lower = more valuable: D=0, G=3).
COLOR_RANK = {
    "D": 0, "E": 1, "F": 2, "G": 3, "H": 4,
    "I": 5, "J": 6, "K": 7, "L": 8,
}

# Clarity ordinal ranks (lower = more valuable: IF=0, VS1=3).
CLARITY_RANK = {
    "IF": 0, "VVS1": 1, "VVS": 1.5, "VVS2": 2,
    "VS1": 3, "VS": 3.5, "VS2": 4, "SI1": 5, "SI2": 6,
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def normalize_cut(raw: str) -> str:
    raw = str(raw or "").strip().upper()
    if raw in ("ID", "IDEAL"):
        return "ID"
    if raw in ("EX", "EXCELLENT"):
        return "EX"
    if raw in ("VG", "VERY GOOD"):
        return "VG"
    if raw in ("G", "GD", "GOOD"):
        return "G"
    if raw in ("FAIR", "F"):
        return "FAIR"
    return "-"


def ols(X: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Fit y = X @ coeffs by OLS. X should include a bias column."""
    coeffs, _, _, _ = np.linalg.lstsq(X, y, rcond=None)
    return coeffs


def compute_mape(predicted: list[float], actual: list[float]) -> float:
    if not predicted:
        return float("nan")
    return 100.0 * mean(
        abs(p - a) / a for p, a in zip(predicted, actual) if a > 0
    )


# ── Main training ─────────────────────────────────────────────────────────────

def main():
    print("Loading training data...")
    with TRAINING_JSON.open() as f:
        all_rows = json.load(f)

    # Segment A only: standard recent, no specialty cuts.
    rows = [r for r in all_rows if r["segment"] == "A_standard_recent"]
    print(f"Segment A rows: {len(rows)}")

    # Build working array with log features and ordinal encodings.
    for r in rows:
        r["log_carat"]    = math.log(r["carat"])
        r["log_upc"]      = math.log(r["upc"])
        r["cut"]          = normalize_cut(r["cut_raw"])
        r["color_rank"]   = COLOR_RANK.get(r["color"],   3)    # default G
        r["clarity_rank"] = CLARITY_RANK.get(r["clarity"], 3.5) # default VS

    shapes = sorted(set(r["shape"] for r in rows))
    print(f"Shapes: {shapes}")

    # ── Step 1: Fit β_global from ROUND data only ───────────────────────────
    # Design rationale: fancy shapes span only 0.5–1.8ct (too narrow to identify
    # β reliably). The within-range β for fancy shapes picks up rate-card noise
    # rather than fundamental carat scarcity. We use β_round for all shapes,
    # which gives correct extrapolation behavior.
    print("\n── Fitting global carat exponent (β) from round data ──")

    round_rows = [r for r in rows if r["shape"] == "ROUND"]
    # Multivariate OLS on rounds: log_upc ~ log_carat + color_rank + clarity_rank
    X_r = np.column_stack([
        np.ones(len(round_rows)),
        [r["log_carat"]    for r in round_rows],
        [r["color_rank"]   for r in round_rows],
        [r["clarity_rank"] for r in round_rows],
    ])
    y_r = np.array([r["log_upc"] for r in round_rows])
    coeffs_r = ols(X_r, y_r)
    beta_global  = float(coeffs_r[1])
    delta_color  = float(coeffs_r[2])
    delta_clarity = float(coeffs_r[3])
    round_intercept = float(coeffs_r[0])

    print(f"  β_global (carat)  = {beta_global:+.4f}")
    print(f"  δ_color  (per rank) = {delta_color:+.4f}  (D=0 → G=3)")
    print(f"  δ_clarity (per rank) = {delta_clarity:+.4f}  (IF=0 → VS1=3)")
    print(f"  round intercept @ log_carat=0 (1ct avg grade) = {round_intercept:.4f}")
    print(f"  Note: fitted from {len(round_rows)} round rows spanning "
          f"{min(r['carat'] for r in round_rows):.2f}–"
          f"{max(r['carat'] for r in round_rows):.2f}ct")

    # Use β_global for all shapes.
    shape_beta = {s: beta_global for s in shapes}
    shape_beta["_global"] = beta_global

    # ── Step 2: Compute gradient-adjusted residuals ─────────────────────────
    # After removing the carat trend AND the global color/clarity gradients,
    # what's left is the per-spec signal (shape pricing level + spec premium).
    print("\n── Computing gradient-adjusted residuals ──")
    for r in rows:
        r["resid"] = (
            r["log_upc"]
            - beta_global * r["log_carat"]
            - delta_color * r["color_rank"]
            - delta_clarity * r["clarity_rank"]
        )

    # ── Step 3: Fit γ_cut from round residuals ──────────────────────────────
    print("\n── Fitting cut adjustments (γ_cut) from round residuals ──")
    cut_resids: dict[str, list[float]] = defaultdict(list)
    for r in round_rows:
        cut_resids[r["cut"]].append(r["resid"])

    # Reference level: combined EX + ID (both are "top cut" for rounds).
    ref_vals = cut_resids.get("EX", []) + cut_resids.get("ID", [])
    ref_mean = mean(ref_vals) if ref_vals else 0.0

    cut_adj: dict[str, float] = {}
    for cut in sorted(cut_resids):
        vals = cut_resids[cut]
        if len(vals) < 10:
            cut_adj[cut] = CUT_PRIORS.get(cut, 0.0)
            print(f"  {cut:6} n={len(vals):5}  → prior {CUT_PRIORS.get(cut, 0.0):+.4f}")
        else:
            fitted = mean(vals) - ref_mean
            prior  = CUT_PRIORS.get(cut, 0.0)
            w = min(1.0, len(vals) / 200.0)  # trust data more with 200+ obs
            cut_adj[cut] = w * fitted + (1.0 - w) * prior
            print(f"  {cut:6} n={len(vals):5}  fitted={fitted:+.4f}  prior={prior:+.4f}  final={cut_adj[cut]:+.4f}")

    for cut, prior in CUT_PRIORS.items():
        if cut not in cut_adj:
            cut_adj[cut] = prior

    # ── Step 4: Per-shape baselines ─────────────────────────────────────────
    # Remove cut effect from residuals, then compute per-shape mean.
    # This is the "shape pricing level" at average color/clarity/carat.
    print("\n── Computing per-shape baselines ──")
    for r in rows:
        r["resid_nocut"] = r["resid"] - cut_adj.get(r["cut"], 0.0)

    shape_baseline: dict[str, float] = {}
    for shape in shapes:
        vals = [r["resid_nocut"] for r in rows if r["shape"] == shape]
        shape_baseline[shape] = mean(vals) if vals else 0.0

    shape_baseline["_global"] = mean(r["resid_nocut"] for r in rows)

    print("  Per-shape baseline (log_upc at 1ct, avg color/clarity, after β/γ):")
    for shape in sorted(shape_baseline):
        if shape == "_global":
            continue
        b = shape_baseline[shape]
        n = sum(1 for r in rows if r["shape"] == shape)
        print(f"    {shape:12} n={n:5}  baseline={b:.4f}  → ${math.exp(b):.0f}/ct at 1ct avg grade")

    # ── Step 5: Per-spec residual ε_spec ────────────────────────────────────
    # The per-spec residual captures the excess above the gradient model:
    # ε_spec = mean(log_upc - β×log(ct) - δ_color×cr - δ_clarity×clr - γ_cut)
    #        relative to the shape baseline.
    # Shrink toward 0 (i.e., no excess vs gradient model).
    print("\n── Computing per-spec residuals (ε_spec) with shrinkage ──")

    spec_resids: dict[str, list[float]] = defaultdict(list)
    for r in rows:
        key = f"{r['shape']}||{r['color']}||{r['clarity']}"
        # Residual relative to shape baseline (excess above gradient model)
        spec_resids[key].append(r["resid_nocut"] - shape_baseline.get(r["shape"], shape_baseline["_global"]))

    spec_eps: dict[str, float] = {}   # per-spec excess (shrunk)
    spec_count: dict[str, int] = {}
    for key, vals in sorted(spec_resids.items()):
        n = len(vals)
        obs_mean = mean(vals)
        # Shrink toward 0 (no excess vs gradient model).
        w = n / (n + SHRINK_LAMBDA)
        spec_eps[key] = w * obs_mean
        spec_count[key] = n

    n_spec = len(spec_eps)
    print(f"  Spec residuals computed: {n_spec} cells")
    # Show specs with largest excess (price premium above gradient model).
    top_excess = sorted(spec_eps.items(), key=lambda x: abs(x[1]), reverse=True)[:10]
    print("  Top 10 spec excesses (above gradient model):")
    for k, eps in top_excess:
        n = spec_count[k]
        print(f"    {k:40}  n={n:5}  ε={eps:+.4f}  ({100*(math.exp(eps)-1):+.1f}%)")

    # ── Step 6: Evaluate MAPE ────────────────────────────────────────────────
    print("\n── Evaluating in-sample MAPE ──")

    # Outlier detection: flag rows where prediction error is extreme.
    predicted_prices = []
    actual_prices    = []
    per_shape_apes: dict[str, list[float]] = defaultdict(list)
    outlier_count = 0

    def predict(shape, color, clarity, carat, cut):
        key   = f"{shape}||{color}||{clarity}"
        alpha = shape_baseline.get(shape, shape_baseline["_global"])
        eps   = spec_eps.get(key, 0.0)
        cr    = COLOR_RANK.get(color, 3)
        clr   = CLARITY_RANK.get(clarity, 3.5)
        gamma = cut_adj.get(normalize_cut(cut), 0.0)
        log_upc = alpha + eps + beta_global * math.log(carat) \
                  + delta_color * cr + delta_clarity * clr + gamma
        upc = math.exp(log_upc)
        return upc * carat, upc

    for r in rows:
        pred_price, pred_upc = predict(
            r["shape"], r["color"], r["clarity"], r["carat"], r["cut"]
        )
        actual_price = r["price"]
        ape = abs(pred_price - actual_price) / actual_price * 100
        if ape > 200:
            outlier_count += 1
        predicted_prices.append(pred_price)
        actual_prices.append(actual_price)
        per_shape_apes[r["shape"]].append(ape)

    overall_mape = compute_mape(predicted_prices, actual_prices)
    print(f"\n  Overall MAPE: {overall_mape:.4f}%")
    print(f"  Rows with APE > 200%: {outlier_count}")
    print(f"\n  Per-shape MAPE:")
    for shape in sorted(per_shape_apes):
        apes = per_shape_apes[shape]
        print(f"    {shape:12}  n={len(apes):5}  MAPE={mean(apes):.2f}%  "
              f"median_APE={median(apes):.2f}%  max_APE={max(apes):.1f}%")

    # ── Step 7: Spot-check extrapolation cases ───────────────────────────────
    print("\n── Spot-check: extrapolation cases ──")
    # S21 lookup reference for comparison (from prior analysis):
    s21_refs = {
        "5.21ct HEART D VS1":   1371,  # S21 Level-A n=13
        "2.00ct ROUND H VS1":   286,   # S21 fallback
        "4.00ct PEAR D VS1":    None,
        "3.00ct OVAL E VVS2":   None,
    }

    test_cases = [
        {"shape": "HEART",    "color": "D", "clarity": "VS1",  "carat": 5.21, "cut": "-", "label": "5.21ct HEART D VS1"},
        {"shape": "HEART",    "color": "F", "clarity": "VVS2", "carat": 1.10, "cut": "-", "label": "1.10ct HEART F VVS2"},
        {"shape": "HEART",    "color": "D", "clarity": "VS1",  "carat": 1.21, "cut": "-", "label": "1.21ct HEART D VS1"},
        {"shape": "ROUND",    "color": "D", "clarity": "VS1",  "carat": 1.00, "cut": "ID","label": "1.00ct ROUND D VS1"},
        {"shape": "ROUND",    "color": "H", "clarity": "VS1",  "carat": 2.00, "cut": "ID","label": "2.00ct ROUND H VS1"},
        {"shape": "ROUND",    "color": "D", "clarity": "VS1",  "carat": 5.00, "cut": "ID","label": "5.00ct ROUND D VS1"},
        {"shape": "PEAR",     "color": "D", "clarity": "VS1",  "carat": 4.00, "cut": "-", "label": "4.00ct PEAR D VS1"},
        {"shape": "OVAL",     "color": "E", "clarity": "VVS2", "carat": 3.00, "cut": "-", "label": "3.00ct OVAL E VVS2"},
        {"shape": "MARQUISE", "color": "D", "clarity": "VS1",  "carat": 3.00, "cut": "-", "label": "3.00ct MARQUISE D VS1"},
    ]

    for tc in test_cases:
        shape, color, clarity, carat, cut = (
            tc["shape"], tc["color"], tc["clarity"], tc["carat"], tc["cut"]
        )
        key = f"{shape}||{color}||{clarity}"
        pred_price, pred_upc = predict(shape, color, clarity, carat, cut)
        has_spec = key in spec_eps and spec_count.get(key, 0) > 0
        n_obs = spec_count.get(key, 0)
        coverage = f"spec n={n_obs}" if has_spec else "gradient_only"
        s21_ref = s21_refs.get(tc["label"])
        s21_str = f"  [S21={s21_ref}]" if s21_ref else ""
        print(
            f"  {tc['label']:30}  → ${pred_price:,.0f} (${pred_upc:.0f}/ct)"
            f"  [{coverage}]{s21_str}"
        )

    # ── Step 8: Export JSON ──────────────────────────────────────────────────
    print(f"\n── Exporting model → {OUTPUT_JSON} ──")

    model = {
        "modelName":    "S25 — Hierarchical Parametric Power-Law",
        "modelVersion": "s25-parametric-v1",
        "generatedDate": str(date.today()),
        "targetType":   "log_upc_parametric",
        "prediction": (
            "exp("
            "  shapeBaseline[shape]"
            "  + specEps[shape||color||clarity]"  # 0 if unseen spec
            "  + betaGlobal * log(carat)"
            "  + deltaColor * colorRank[color]"
            "  + deltaClarity * clarityRank[clarity]"
            "  + cutAdj[cut]"
            ") * carat"
        ),
        "hyperparameters": {
            "shrinkLambda": SHRINK_LAMBDA,
        },
        # Global carat exponent (fitted from round data, applied to all shapes).
        "betaGlobal":   round(beta_global,   6),
        # Global color/clarity gradients (fitted from round data).
        "deltaColor":   round(delta_color,   6),
        "deltaClarity": round(delta_clarity, 6),
        # Per-shape pricing baseline (log_upc at 1ct, avg grade, avg cut).
        "shapeBaseline": {
            s: round(v, 6) for s, v in shape_baseline.items()
        },
        # Per-(shape,color,clarity) excess above gradient model (shrunk).
        "specEps": {
            k: round(v, 6) for k, v in spec_eps.items()
        },
        "specCount": spec_count,
        # Cut grade log-space adjustments.
        "cutAdj": {
            k: round(v, 6) for k, v in sorted(cut_adj.items())
        },
        # Ordinal encodings (for browser-side consistency).
        "colorRank":   {k: v for k, v in COLOR_RANK.items()},
        "clarityRank": {k: v for k, v in CLARITY_RANK.items()},
        # Metrics.
        "metrics": {
            "n":          len(rows),
            "nSpecs":     n_spec,
            "mape":       round(overall_mape, 4),
            "perShapeMape": {
                s: round(mean(apes), 4)
                for s, apes in per_shape_apes.items()
            },
        },
        "notes": {
            "trainingSegment": "A_standard_recent",
            "betaSource": "ROUND only (9,701 obs, 0.30–5.06ct). Applied globally.",
            "caveats": [
                "β_global from rounds. Fancy shapes (Pear, Oval, Heart…) only "
                "span 0.5–1.8ct in training data — not enough range to identify "
                "their own β. Using β_round as a principled prior.",
                "δ_color and δ_clarity are global gradients for interpolating "
                "unseen (color, clarity) combos within a shape.",
                "specEps[key] is shrunk toward 0 with λ=20. A spec with 1 obs "
                "has ε ≈ 5% of the observed excess; with 20 obs, ε ≈ 50%.",
                "γ_cut data: only EX and ID have >10 round obs. VG/G use priors.",
                "Coverage: 100%. Every (shape,color,clarity,carat) has an answer.",
            ],
        },
    }

    with OUTPUT_JSON.open("w") as f:
        json.dump(model, f, indent=2)

    print(f"  Written: {OUTPUT_JSON}")
    print(f"  File size: {OUTPUT_JSON.stat().st_size / 1024:.1f} KB")
    print(f"\n  Model summary:")
    print(f"    β_global    = {beta_global:.4f}")
    print(f"    δ_color     = {delta_color:.4f}")
    print(f"    δ_clarity   = {delta_clarity:.4f}")
    print(f"    Spec cells  = {n_spec}")
    print(f"    MAPE        = {overall_mape:.2f}%")
    print("\nDone.")


if __name__ == "__main__":
    main()
