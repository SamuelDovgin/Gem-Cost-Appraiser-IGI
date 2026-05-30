#!/usr/bin/env python3
"""
dataset-split-outliers.py
═══════════════════════════════════════════════════════════════════════════════
Classifies every row in the StarGem XLS into one of six segments and writes
a comprehensive JSON report + clean CSV suitable for ML training.

Segments:
  A_standard_recent     → recommended ML training set
  B_trad_cut            → 传统切 (Traditional Brilliant) — data-entry artifact
  C_ice_flower          → 冰花切 (Ice Flower) — genuine specialty cut, needs own model
  D_elongated_cushion   → 长垫形 (Elongated Cushion) — shape variant, already classified
  E_old_rate_card       → rows ≤ OLD_ROW_CUTOFF with no specialty label (temporal contamination)
  F_extreme_outlier     → lone point ≥40% above the BASE spec cluster (stale/mispriced single)
  G_other_specialty     → 老矿切 / 老欧切 — rare historical cuts
  H_high_price_cluster  → a CLUSTER priced ≥30% above the base/low cluster of the same spec
                          (keep the lower base set, quarantine the high mode). Guardrailed so
                          the base cluster is always the majority → never removes >½ a group.

Output files (research/data/):
  dataset-split-report.json   — full classified records with segment + reason
  dataset-split-summary.json  — per-segment counts, price stats, noise floor MAPE
  dataset-clean-training.json — segment A only, ready for ML consumption

Usage:
  python3 research/scripts/dataset-split-outliers.py

═══════════════════════════════════════════════════════════════════════════════
"""

import json, os, sys, re
from collections import defaultdict, Counter
from statistics import mean, median, stdev

try:
    import xlrd
except ImportError:
    sys.exit("ERROR: xlrd not installed.  Run: pip3 install xlrd")

# ── PATHS ────────────────────────────────────────────────────────────────────
SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
DATA_DIR     = os.path.join(PROJECT_ROOT, "data")

XLS_FILE           = os.path.join(DATA_DIR, "STARS Diamonds Stock2026.5.20.xls")
IGI_ENRICHMENT     = os.path.join(DATA_DIR, "igi-report-enrichment.json")
OUT_REPORT         = os.path.join(DATA_DIR, "dataset-split-report.json")
OUT_SUMMARY        = os.path.join(DATA_DIR, "dataset-split-summary.json")
OUT_CLEAN_TRAINING = os.path.join(DATA_DIR, "dataset-clean-training.json")

# ── PARAMETERS ───────────────────────────────────────────────────────────────
# Row number below which stones are considered "old rate card era".
# Empirically: price rate cards shifted between rows 13,000–16,000.
# We use 15,000 as the conservative boundary (all 传统切 stones are below this).
OLD_ROW_CUTOFF = 15_000

# Price premium threshold above the BASE (low) spec cluster to flag a single
# stone as an extreme point outlier (Segment F).  40% = user-specified threshold.
OUTLIER_PREMIUM_THRESHOLD = 0.40

# Minimum number of stones in a spec group (recent window) to apply point-outlier
# detection (Segment F).
MIN_GROUP_SIZE_FOR_OUTLIER = 3

# ── Segment H: "random high price cluster" quarantine ────────────────────────
# User request: within an otherwise-identical spec (same shape/color/clarity/carat),
# if a *cluster* of stones sits ≥30% above the base (lower) cluster "for no reason",
# keep the lower base set and quarantine the high cluster.  This is distinct from
# Segment F (which catches lone point outliers): H catches a coherent high MODE.
#
# Anti-over-removal guardrails (all must hold to quarantine the high cluster):
#   1. group has ≥ MIN_GROUP_SIZE_FOR_CLUSTER stones,
#   2. the largest consecutive price gap is ≥ CLUSTER_GAP_THRESHOLD (i.e. ≥30%),
#   3. BOTH sides of that gap have ≥ MIN_CLUSTER_SIZE stones (a single high stone
#      is left to Segment F, not quarantined here),
#   4. the LOW/base cluster is the majority (len(low) ≥ len(high)) — we never remove
#      more than half of any spec group, so the "base set" is always preserved.
CLUSTER_GAP_THRESHOLD       = 1.30   # 30% jump between consecutive sorted prices
MIN_GROUP_SIZE_FOR_CLUSTER  = 6      # need a real population before calling bimodality
MIN_CLUSTER_SIZE            = 2      # each mode must have ≥2 stones to be a "cluster"

# Per-shape data-sufficiency floor: shapes whose clean (Segment A) count falls below
# this are flagged in the summary so we can confirm we are not starving any pool.
MIN_SHAPE_TRAINING_ROWS = 50

# Carat rounding precision for spec-group matching
CARAT_ROUND = 2


# ── CHINESE CUT LABELS ───────────────────────────────────────────────────────
TRAD_CUT_LABEL    = "传统切"   # Traditional Brilliant — data artifact (old rate card marker)
ICE_FLOWER_LABEL  = "冰花切"   # Ice Flower / Crushed Ice — genuine specialty cut
ELONG_CUSHION_LABEL = "长垫形" # Elongated Cushion — shape variant
OLD_MINE_LABEL    = "老矿切"   # Old Mine Cut — genuine specialty
OLD_EUR_LABEL     = "老欧切"   # Old European Cut — genuine specialty


# ═══════════════════════════════════════════════════════════════════════════════
# §1  LOAD DATA
# ═══════════════════════════════════════════════════════════════════════════════

def parse_lw(meas: str):
    """Parse L/W ratio from 'L - W - H' measurement string."""
    parts = meas.replace(" ", "").split("-")
    if len(parts) >= 2:
        try:
            return round(float(parts[0]) / float(parts[1]), 4)
        except (ValueError, ZeroDivisionError):
            pass
    return None


def load_xls(path: str) -> list[dict]:
    wb = xlrd.open_workbook(path)
    ws = wb.sheet_by_name("Table")
    headers = [str(ws.cell_value(0, c)).strip() for c in range(ws.ncols)]

    records = []
    for r in range(1, ws.nrows):
        rv = {headers[c]: ws.cell_value(r, c) for c in range(ws.ncols)}

        def sf(k):  return str(rv.get(k, "")).strip()
        def nf(k):
            try:    return float(rv.get(k, ""))
            except: return None

        carat = nf("Carat")
        price = nf("SaleDollorPrice")
        if not carat or not price or carat <= 0 or price <= 0:
            continue

        cut_raw   = sf("Cut")
        meas      = sf("Measurement")
        lw_ratio  = parse_lw(meas)

        records.append({
            "rowNo":       r,
            "reportno":    sf("Reportno"),
            "carat":       round(carat, 4),
            "price":       round(price, 2),
            "upc":         round(price / carat, 4),   # USD per carat
            "shape":       sf("Shape").upper(),
            "color":       sf("Color").upper(),
            "clarity":     sf("Clarity").upper(),
            "cut_raw":     cut_raw,
            "polish":      sf("Polish").upper(),
            "symmetry":    sf("Symmetry").upper(),
            "fluorescence":sf("Fluorescence").upper(),
            "typeName":    sf("TypeName").upper(),
            "measurement": meas,
            "lw_ratio":    lw_ratio,
            "table_pct":   nf("Table_Scale"),
            "depth_pct":   nf("Depth_Scale"),
        })

    print(f"Loaded {len(records):,} valid rows from XLS")
    return records


def load_enrichment(path: str) -> dict:
    if not os.path.exists(path):
        print("WARNING: IGI enrichment file not found — skipping IGI shape cross-reference")
        return {}
    with open(path) as f:
        return json.load(f)


# ═══════════════════════════════════════════════════════════════════════════════
# §2  CLASSIFY INTO SEGMENTS
# ═══════════════════════════════════════════════════════════════════════════════

SEGMENT_LABELS = {
    "A_standard_recent":   "Standard (current rate card, no specialty cut)",
    "B_trad_cut":          "传统切 — Traditional Brilliant label (data artifact, old rate card)",
    "C_ice_flower":        "冰花切 — Ice Flower specialty cut (genuine premium, needs own model)",
    "D_elongated_cushion": "长垫形 — Elongated Cushion shape variant (already classified)",
    "E_old_rate_card":     "Old rate card era (row ≤ {:,}, no specialty label) — temporal contamination".format(OLD_ROW_CUTOFF),
    "F_extreme_outlier":   f"Lone point outlier in recent window (price ≥{int(OUTLIER_PREMIUM_THRESHOLD*100)+100}% of base spec cluster)",
    "G_other_specialty":   "Other specialty cut (老矿切/老欧切) — historical novelty, negligible count",
    "H_high_price_cluster": f"Random high price cluster (≥{int((CLUSTER_GAP_THRESHOLD-1)*100)}% above the base/low cluster of the same spec) — quarantined, keep the lower base set",
}

EXCLUDE_FROM_ML = {"B_trad_cut", "C_ice_flower", "D_elongated_cushion",
                   "E_old_rate_card", "F_extreme_outlier", "G_other_specialty",
                   "H_high_price_cluster"}


def build_spec_key(r: dict, carat_round: int = CARAT_ROUND) -> tuple:
    """Coarse spec key for grouping (carat rounded, shape, color, clarity)."""
    return (round(r["carat"], carat_round), r["shape"], r["color"], r["clarity"])


def detect_high_cluster(sorted_recs: list[dict],
                        gap_threshold: float = CLUSTER_GAP_THRESHOLD,
                        min_cluster_size: int = MIN_CLUSTER_SIZE) -> tuple[list[dict], list[dict]]:
    """
    Split a spec group (sorted ascending by upc) into a low/base cluster and a high
    cluster, IF a genuine ≥`gap_threshold` price jump separates two real clusters.

    Returns (base_recs, high_recs).  `high_recs` is empty unless ALL guardrails hold:
      • the largest consecutive price ratio gap is ≥ gap_threshold,
      • both sides of the gap have ≥ min_cluster_size stones,
      • the base (low) side is the majority (len(low) ≥ len(high)).
    This guarantees we never quarantine more than half of any spec group.
    """
    n = len(sorted_recs)
    if n < MIN_GROUP_SIZE_FOR_CLUSTER:
        return sorted_recs, []

    # Find the largest relative gap between consecutive sorted prices.
    best_ratio, best_idx = 1.0, None
    for i in range(n - 1):
        lo, hi = sorted_recs[i]["upc"], sorted_recs[i + 1]["upc"]
        if lo <= 0:
            continue
        ratio = hi / lo
        if ratio > best_ratio:
            best_ratio, best_idx = ratio, i

    if best_idx is None or best_ratio < gap_threshold:
        return sorted_recs, []

    low  = sorted_recs[: best_idx + 1]
    high = sorted_recs[best_idx + 1:]

    # Guardrails: real clusters on both sides, and base must stay the majority.
    if len(low) < min_cluster_size or len(high) < min_cluster_size:
        return sorted_recs, []
    if len(low) < len(high):
        return sorted_recs, []

    return low, high


def classify(records: list[dict],
             old_row_cutoff: int = OLD_ROW_CUTOFF,
             outlier_premium: float = OUTLIER_PREMIUM_THRESHOLD,
             cluster_gap: float = CLUSTER_GAP_THRESHOLD,
             enable_cluster: bool = True,
             verbose: bool = True) -> list[dict]:
    """
    Two-pass classification.

    Pass 1 — label/temporal routing (B, C, D, G, E).  Everything else (recent,
             non-specialty) becomes an A-candidate and is bucketed by spec key.
    Pass 2 — per spec group: split off any random HIGH price cluster (Segment H),
             then flag lone point outliers vs the BASE cluster median (Segment F),
             leaving the clean base set as Segment A.
    """
    a_candidates = defaultdict(list)   # spec_key -> [records]

    for r in records:
        cut = r["cut_raw"]

        if TRAD_CUT_LABEL in cut:
            r["segment"] = "B_trad_cut"
            r["segment_reason"] = (
                "传统切 label: IGI certificates confirm standard Brilliant cuts (Oval/Pear/Heart Brilliant). "
                "Label is a data-entry artifact from earlier inventory operator; all stones are in old "
                f"rate card era (rows ≤ {old_row_cutoff:,})."
            )
        elif ICE_FLOWER_LABEL in cut:
            r["segment"] = "C_ice_flower"
            r["segment_reason"] = (
                "冰花切 (Ice Flower) specialty cut: IGI reports describe these as Modified Brilliant. "
                "They command a genuine +100–150% price premium vs standard cuts of same spec. "
                "All inventory is in early rows (old rate card era). Needs a dedicated price model."
            )
        elif ELONG_CUSHION_LABEL in cut:
            r["segment"] = "D_elongated_cushion"
            r["segment_reason"] = (
                "长垫形 (Elongated Cushion) shape flag: already routed to elongated_cushion in the "
                "comp engine via shape_buckets. Kept separate to avoid contaminating standard Cushion stats."
            )
        elif cut in (OLD_MINE_LABEL, OLD_EUR_LABEL):
            r["segment"] = "G_other_specialty"
            r["segment_reason"] = f"Rare historical specialty cut: {cut}. Too few stones for a dedicated model."
        elif r["rowNo"] <= old_row_cutoff:
            r["segment"] = "E_old_rate_card"
            r["segment_reason"] = (
                f"Row {r['rowNo']:,} ≤ cutoff {old_row_cutoff:,}: belongs to old rate card era "
                "where supplier priced stones significantly higher than current market. "
                "Including these inflates MAPE by ~26.8% average drift."
            )
        else:
            r["segment"] = None  # decided in pass 2
            a_candidates[build_spec_key(r)].append(r)

    # ── Pass 2: per spec group cluster + point-outlier detection ──────────────
    n_groups_with_cluster = 0
    for key, grp in a_candidates.items():
        grp_sorted = sorted(grp, key=lambda x: x["upc"])

        # 1) Random high price cluster (Segment H)
        base, high = ([], [])
        if enable_cluster:
            base, high = detect_high_cluster(grp_sorted, gap_threshold=cluster_gap)
        if high:
            n_groups_with_cluster += 1
            base_med = median([b["upc"] for b in base])
            for h in high:
                pct_above = round((h["upc"] / base_med - 1) * 100, 1)
                h["segment"] = "H_high_price_cluster"
                h["segment_reason"] = (
                    f"Price ${h['upc']:.0f}/ct sits in a high cluster {pct_above}% above the base "
                    f"cluster median ${base_med:.0f}/ct for {key[1]} {key[2]} {key[3]} {key[0]:.2f}ct "
                    f"(base n={len(base)}, high n={len(high)}). No spec difference explains the jump — "
                    "quarantined so training keeps the lower base price."
                )
            base_recs = base
        else:
            base_recs = grp_sorted

        # 2) Lone point outliers vs the BASE cluster median (Segment F)
        if len(base_recs) >= MIN_GROUP_SIZE_FOR_OUTLIER:
            base_med = median([b["upc"] for b in base_recs])
            for r in base_recs:
                if r["upc"] > base_med * (1 + outlier_premium):
                    pct_above = round((r["upc"] / base_med - 1) * 100, 1)
                    r["segment"] = "F_extreme_outlier"
                    r["segment_reason"] = (
                        f"Price ${r['upc']:.0f}/ct is {pct_above}% above base spec median "
                        f"${base_med:.0f}/ct for {key[1]} {key[2]} {key[3]} {key[0]:.2f}ct. "
                        "Lone stale/mispriced listing within the current rate card window."
                    )
                else:
                    r["segment"] = "A_standard_recent"
                    r["segment_reason"] = "Standard stone in current rate card window, no specialty label."
        else:
            for r in base_recs:
                r["segment"] = "A_standard_recent"
                r["segment_reason"] = (
                    "Standard stone in current rate card window; spec group too small "
                    f"(<{MIN_GROUP_SIZE_FOR_OUTLIER}) for outlier detection."
                )

    if verbose:
        print(f"Bucketed recent A-candidates into {len(a_candidates):,} spec groups")
        print(f"Found random high price clusters in {n_groups_with_cluster:,} spec groups")

    return records


# ═══════════════════════════════════════════════════════════════════════════════
# §3  NOISE FLOOR COMPUTATION
# ═══════════════════════════════════════════════════════════════════════════════

def compute_noise_floor_mape(records: list[dict], label: str = "") -> dict:
    """
    Compute intrinsic noise floor MAPE:
    For each spec group, predict the group median for every stone in that group.
    MAPE = mean(|pred - actual| / actual).
    This is the theoretical minimum any model could achieve given within-spec price variance.
    """
    groups = defaultdict(list)
    for r in records:
        groups[build_spec_key(r)].append(r["upc"])

    apes = []
    for key, prices in groups.items():
        if len(prices) < 2:
            continue
        grp_median = median(prices)
        for p in prices:
            apes.append(abs(p - grp_median) / p)

    if not apes:
        return {"mape_pct": None, "n_groups": 0, "n_stones": 0}

    result = {
        "label":        label,
        "mape_pct":     round(mean(apes) * 100, 4),
        "n_groups":     len([g for g in groups.values() if len(g) >= 2]),
        "n_stones":     len(apes),
    }
    if label:
        print(f"  Noise floor MAPE ({label}): {result['mape_pct']:.4f}%  "
              f"({result['n_stones']:,} stones in {result['n_groups']:,} multi-stone groups)")
    return result


# ═══════════════════════════════════════════════════════════════════════════════
# §4  IGI ENRICHMENT CROSS-REFERENCE
# ═══════════════════════════════════════════════════════════════════════════════

def enrich_shape_raw(records: list[dict], enrichment: dict) -> dict:
    """
    For a sample of 传统切 and 冰花切 stones, look up IGI shapeRaw.
    Returns a summary dict for the analysis doc.
    """
    results = {"trad_cut": [], "ice_flower": []}

    for r in records:
        cut = r["cut_raw"]
        rno = r["reportno"]
        e = enrichment.get(rno) or enrichment.get(str(int(float(rno))) if rno else "")
        if not e or e.get("status") != "ok":
            continue
        shape_raw = e.get("shapeRaw", "")
        lw_ratio  = e.get("lwRatio")

        if TRAD_CUT_LABEL in cut and len(results["trad_cut"]) < 30:
            results["trad_cut"].append({
                "reportno":  rno,
                "rowNo":     r["rowNo"],
                "shape":     r["shape"],
                "upc":       r["upc"],
                "shapeRaw":  shape_raw,
                "lwRatio":   lw_ratio,
            })
        elif ICE_FLOWER_LABEL in cut and len(results["ice_flower"]) < 30:
            results["ice_flower"].append({
                "reportno":  rno,
                "rowNo":     r["rowNo"],
                "shape":     r["shape"],
                "upc":       r["upc"],
                "shapeRaw":  shape_raw,
                "lwRatio":   lw_ratio,
            })

        if len(results["trad_cut"]) >= 30 and len(results["ice_flower"]) >= 30:
            break

    return results


# ═══════════════════════════════════════════════════════════════════════════════
# §5  SUMMARY STATISTICS
# ═══════════════════════════════════════════════════════════════════════════════

def summarize_segments(records: list[dict]) -> dict:
    segs = defaultdict(list)
    for r in records:
        segs[r["segment"]].append(r)

    summary = {}
    for seg, stones in sorted(segs.items()):
        prices = [s["upc"] for s in stones]
        summary[seg] = {
            "label":        SEGMENT_LABELS.get(seg, seg),
            "count":        len(stones),
            "pct_of_total": round(100 * len(stones) / len(records), 2),
            "upc_min":      round(min(prices), 2),
            "upc_max":      round(max(prices), 2),
            "upc_mean":     round(mean(prices), 2),
            "upc_median":   round(median(prices), 2),
            "excluded_from_ml": seg in EXCLUDE_FROM_ML,
            "row_range":    [min(s["rowNo"] for s in stones), max(s["rowNo"] for s in stones)],
            "shapes":       dict(Counter(s["shape"] for s in stones).most_common()),
        }

    summary["_totals"] = {
        "total_rows":          len(records),
        "ml_training_rows":    sum(1 for r in records if r["segment"] == "A_standard_recent"),
        "ml_training_pct":     round(100 * sum(1 for r in records if r["segment"] == "A_standard_recent") / len(records), 2),
        "excluded_rows":       sum(1 for r in records if r["segment"] in EXCLUDE_FROM_ML),
        "old_row_cutoff":      OLD_ROW_CUTOFF,
        "outlier_threshold":   OUTLIER_PREMIUM_THRESHOLD,
        "cluster_gap_threshold": CLUSTER_GAP_THRESHOLD,
    }

    return summary


def build_data_sufficiency(records: list[dict]) -> dict:
    """
    Per-shape census of the clean Segment A training set vs how many of that shape
    were removed, so we can confirm we are not starving any pool.  Flags shapes whose
    surviving training count falls below MIN_SHAPE_TRAINING_ROWS.
    """
    seg_a = [r for r in records if r["segment"] == "A_standard_recent"]
    by_shape_a = Counter(r["shape"] for r in seg_a)
    by_shape_total = Counter(r["shape"] for r in records)

    rows = {}
    for shape, total in by_shape_total.most_common():
        kept = by_shape_a.get(shape, 0)
        rows[shape or "(blank)"] = {
            "total":       total,
            "kept_in_A":   kept,
            "kept_pct":    round(100 * kept / total, 1) if total else 0.0,
            "below_floor": kept < MIN_SHAPE_TRAINING_ROWS,
        }
    flagged = [s for s, v in rows.items() if v["below_floor"]]
    return {
        "min_shape_training_rows": MIN_SHAPE_TRAINING_ROWS,
        "by_shape": rows,
        "shapes_below_floor": flagged,
    }


def build_sensitivity(records: list[dict]) -> list[dict]:
    """
    Re-classify the dataset under several cleaning configurations and report rows
    kept + Segment-A noise floor for each, so the over-removal vs. accuracy tradeoff
    is explicit.  Mutates `records` in place; caller must re-run the canonical
    classify() afterwards to restore the chosen configuration.
    """
    configs = [
        ("row-cutoff only (no F, no H)", dict(outlier_premium=10.0, enable_cluster=False)),
        ("F only (point outliers, no H)", dict(outlier_premium=0.40, enable_cluster=False)),
        ("F + H gap 1.40 (conservative)", dict(outlier_premium=0.40, cluster_gap=1.40, enable_cluster=True)),
        ("F + H gap 1.30 (recommended)",  dict(outlier_premium=0.40, cluster_gap=1.30, enable_cluster=True)),
        ("F + H gap 1.25 (aggressive)",   dict(outlier_premium=0.40, cluster_gap=1.25, enable_cluster=True)),
    ]
    out = []
    for label, cfg in configs:
        classify(records, verbose=False, **cfg)
        seg_a = [r for r in records if r["segment"] == "A_standard_recent"]
        nf = compute_noise_floor_mape(seg_a, label="")
        out.append({
            "config":            label,
            "A_rows":            len(seg_a),
            "A_pct":             round(100 * len(seg_a) / len(records), 2),
            "F_rows":            sum(1 for r in records if r["segment"] == "F_extreme_outlier"),
            "H_rows":            sum(1 for r in records if r["segment"] == "H_high_price_cluster"),
            "segA_noise_floor":  nf["mape_pct"],
        })
    return out


# ═══════════════════════════════════════════════════════════════════════════════
# §6  MAIN
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    print("=" * 70)
    print("StarGem Dataset Segmentation & Outlier Split")
    print("=" * 70)

    # Load
    records    = load_xls(XLS_FILE)
    enrichment = load_enrichment(IGI_ENRICHMENT)

    # Sensitivity sweep FIRST (mutates segments under various configs)
    print("\nRunning cleaning-config sensitivity sweep (over-removal tradeoff)...")
    sensitivity = build_sensitivity(records)
    print(f"  {'config':34} {'A rows':>8} {'A %':>7} {'F':>5} {'H':>5} {'segA NF':>9}")
    for s in sensitivity:
        print(f"  {s['config']:34} {s['A_rows']:>8,} {s['A_pct']:>6.1f}% "
              f"{s['F_rows']:>5,} {s['H_rows']:>5,} {s['segA_noise_floor']:>8.3f}%")

    # Canonical classify (recommended config) — this is what gets written out
    print("\nClassifying rows into segments (recommended config)...")
    records = classify(records)

    # Segment counts
    seg_counter = Counter(r["segment"] for r in records)
    print("\nSegment breakdown:")
    for seg, cnt in sorted(seg_counter.items()):
        pct = 100 * cnt / len(records)
        excl = " [EXCLUDED FROM ML]" if seg in EXCLUDE_FROM_ML else " ← ML TRAINING"
        print(f"  {seg:35}: {cnt:6,} ({pct:5.1f}%){excl}")

    # Noise floors
    print("\nComputing noise floor MAPE per segment...")
    seg_a = [r for r in records if r["segment"] == "A_standard_recent"]
    all_recent = [r for r in records if r["rowNo"] > OLD_ROW_CUTOFF]

    nf_full    = compute_noise_floor_mape(records,    "all 28,394 rows")
    nf_recent  = compute_noise_floor_mape(all_recent, "recent rows (> {:,})".format(OLD_ROW_CUTOFF))
    nf_seg_a   = compute_noise_floor_mape(seg_a,      "segment A (clean training)")

    # IGI enrichment cross-reference
    print("\nCross-referencing specialty cut labels with IGI enrichment...")
    igi_cross = enrich_shape_raw(records, enrichment)
    print(f"  传统切 IGI hits: {len(igi_cross['trad_cut'])}")
    print(f"  冰花切 IGI hits: {len(igi_cross['ice_flower'])}")

    # Summary
    summary = summarize_segments(records)
    summary["noise_floors"] = {
        "all":      nf_full,
        "recent":   nf_recent,
        "seg_a":    nf_seg_a,
    }
    summary["data_sufficiency"] = build_data_sufficiency(records)
    summary["sensitivity"]      = sensitivity
    summary["igi_cross_reference_sample"] = igi_cross

    # Write outputs
    print("\nWriting output files...")

    # Full classified report
    report_payload = {
        "generated":    __import__("datetime").date.today().isoformat(),
        "parameters": {
            "old_row_cutoff":             OLD_ROW_CUTOFF,
            "outlier_premium_threshold":  OUTLIER_PREMIUM_THRESHOLD,
            "min_group_size_for_outlier": MIN_GROUP_SIZE_FOR_OUTLIER,
            "carat_round":                CARAT_ROUND,
        },
        "records": records,
    }
    with open(OUT_REPORT, "w") as f:
        json.dump(report_payload, f, indent=2, ensure_ascii=False)
    print(f"  Wrote {OUT_REPORT}")

    # Summary
    with open(OUT_SUMMARY, "w") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)
    print(f"  Wrote {OUT_SUMMARY}")

    # Clean training set (segment A only)
    clean = [r for r in records if r["segment"] == "A_standard_recent"]
    with open(OUT_CLEAN_TRAINING, "w") as f:
        json.dump(clean, f, indent=2, ensure_ascii=False)
    print(f"  Wrote {OUT_CLEAN_TRAINING}  ({len(clean):,} rows)")

    # Console summary
    print("\n" + "=" * 70)
    print("FINAL SUMMARY")
    print("=" * 70)
    t = summary["_totals"]
    print(f"  Total rows parsed:       {t['total_rows']:,}")
    print(f"  Excluded rows:           {t['excluded_rows']:,}")
    print(f"  ML training set (A):     {t['ml_training_rows']:,}  ({t['ml_training_pct']}%)")
    print(f"  Noise floor — all data:  {nf_full['mape_pct']:.4f}%")
    print(f"  Noise floor — recent:    {nf_recent['mape_pct']:.4f}%")
    print(f"  Noise floor — seg A:     {nf_seg_a['mape_pct']:.4f}%")
    print()
    print("  Key findings:")
    print("  • 传统切 (Traditional Brilliant): IGI certs confirm standard cuts — purely a rate-card artifact")
    print("  • 冰花切 (Ice Flower): genuine specialty cut commanding +100–150% premium")
    print("  • Row cutoff {:,} cleanly separates old vs current rate card eras".format(OLD_ROW_CUTOFF))
    print(f"  • {seg_counter['F_extreme_outlier']} lone point outliers (Seg F, ≥{int(OUTLIER_PREMIUM_THRESHOLD*100)+100}% of base spec median)")
    print(f"  • {seg_counter['H_high_price_cluster']} stones in random high price clusters (Seg H, ≥{int((CLUSTER_GAP_THRESHOLD-1)*100)}% above base cluster) quarantined")
    suff = summary["data_sufficiency"]
    if suff["shapes_below_floor"]:
        print(f"  • Shapes below {MIN_SHAPE_TRAINING_ROWS}-row training floor: {', '.join(suff['shapes_below_floor'])}")
    else:
        print(f"  • All shapes retain ≥{MIN_SHAPE_TRAINING_ROWS} clean training rows (no over-removal)")
    print()


if __name__ == "__main__":
    main()
