#!/usr/bin/env python3
"""Holdout comparison: S20 vs S21 on the shared 792-row test set.

Writes research/data/s20-s21-holdout-comparison.json for the research doc generator.
"""

from __future__ import annotations

import importlib.util
import json
import math
import os
import sys
from collections import defaultdict
from datetime import date

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "..", ".."))
OUT_JSON = os.path.join(ROOT, "research", "data", "s20-s21-holdout-comparison.json")


def load_mrpe():
    path = os.path.join(SCRIPT_DIR, "starsgem-mrpe-v2.py")
    spec = importlib.util.spec_from_file_location("starsgem_mrpe_v2", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def pct_err(actual, pred):
    if not actual or actual <= 0:
        return None
    return abs(pred - actual) / actual * 100


def bucket_metrics(rows, preds):
    actuals = [r["SaleDollorPrice"] for r in rows]
    return mrpe.metrics(actuals, preds)


def segment_mape(test, preds, key_fn):
    groups = defaultdict(list)
    pred_by_idx = list(preds)
    for i, row in enumerate(test):
        groups[key_fn(row)].append((row["SaleDollorPrice"], pred_by_idx[i]))
    out = {}
    for k in sorted(groups.keys(), key=lambda x: (x is None, str(x))):
        actuals = [a for a, _ in groups[k]]
        ps = [p for _, p in groups[k]]
        if len(actuals) < 1:
            continue
        out[str(k)] = {
            "count": len(actuals),
            **mrpe.metrics(actuals, ps),
        }
    return out


def wmape(actuals, preds):
    """Dollar-weighted MAPE: 100 × Σ|error| / Σ|actual| (not same as mean % error)."""
    pairs = [(a, p) for a, p in zip(actuals, preds) if a and p is not None and a > 0]
    if not pairs:
        return None
    num = sum(abs(a - p) for a, p in pairs)
    den = sum(a for a, _ in pairs)
    return round(100 * num / den, 4) if den else None


def per_stone_pct_errors(test, preds):
    out = []
    for row, pred in zip(test, preds):
        actual = row["SaleDollorPrice"]
        if not actual or actual <= 0 or pred is None:
            continue
        out.append({
            "row": row,
            "pctOff": abs(pred - actual) / actual * 100,
            "actual": actual,
            "pred": pred,
        })
    return out


def catalog_weights_from_rows(rows):
    """Full-sheet row counts for catalog-weighted MAPE on holdout."""
    counts = defaultdict(int)
    round_1_2 = 0
    round_1_3 = 0
    for row in rows:
        carat = float(row.get("Carat") or 0)
        shape = str(row.get("Shape") or "-").upper()
        bucket = row.get("carat_bucket") or mrpe.carat_bucket(carat)
        counts[("carat_bucket", bucket)] += 1
        counts[("shape", shape)] += 1
        counts[("shape_carat_bucket", shape, bucket)] += 1
        if shape == "ROUND" and 1.0 <= carat <= 2.0:
            round_1_2 += 1
        if shape == "ROUND" and 1.0 <= carat <= 3.0:
            round_1_3 += 1
    counts["round_1_00_to_2_00ct_rows"] = round_1_2
    counts["round_1_00_to_3_00ct_rows"] = round_1_3
    counts["total_rows"] = len(rows)
    return dict(counts)


def catalog_weighted_mape(stone_errors, weight_fn):
    weighted = [(weight_fn(e["row"]), e["pctOff"]) for e in stone_errors]
    weighted = [(w, p) for w, p in weighted if w > 0]
    if not weighted:
        return None
    total_w = sum(w for w, _ in weighted)
    return round(sum(w * p for w, p in weighted) / total_w, 4)


def mape_methodology_block():
    return {
        "perStonePctOff": (
            "For each holdout stone: pctOff = 100 × |predicted − actual| / actual. "
            "Uses SaleDollorPrice (total stone), selected-spec inference view."
        ),
        "bucketMape": (
            "Within a bucket (e.g. carat_bucket '1.00-1.49'): MAPE = arithmetic mean of "
            "pctOff over stones in that bucket only. Each stone counts equally — not "
            "dollar-weighted within the bucket."
        ),
        "overallMape": (
            "MAPE over all 792 holdout stones = mean(pctOff). Mathematically equals "
            "volume-weighted mean of bucket MAPEs when buckets partition the set, but "
            "does NOT match catalog-weighted MAPE (see below)."
        ),
        "wmape": "100 × Σ|error| / Σ(actual) — dollar-weighted; large stones pull more.",
        "catalogWeightedMape": (
            "Σ (training_stock_count_segment × pctOff) / Σ training_stock_count_segment "
            "for stones in that segment. Reflects how much of the sheet is round 1–2 ct "
            "vs 5 ct+, so headline MAPE is not dominated by rare holdout buckets."
        ),
        "holdoutCaveat": (
            "Holdout is one stone per (Shape × carat_bucket × Color × Clarity × Cut) — "
            "balanced for training, not proportional to sales volume. Raw overall MAPE can "
            "look acceptable because 1–2 ct round is accurate while large-carat buckets "
            "are worse but fewer holdout rows."
        ),
    }


def top_deltas(test, preds_s20, preds_s21, n=40):
    rows = []
    for i, row in enumerate(test):
        actual = row["SaleDollorPrice"]
        p20, p21 = preds_s20[i], preds_s21[i]
        e20 = pct_err(actual, p20)
        e21 = pct_err(actual, p21)
        rows.append({
            "rowNo": row.get("rowNo"),
            "carat": row.get("Carat"),
            "carat_bucket": row.get("carat_bucket"),
            "shape": row.get("Shape"),
            "color": row.get("Color"),
            "clarity": row.get("Clarity"),
            "cut": row.get("Cut"),
            "actual": round(actual, 2),
            "s20": round(p20, 2),
            "s21": round(p21, 2),
            "deltaPct": round((p21 - p20) / p20 * 100, 2) if p20 > 0 else None,
            "mapeS20": round(e20, 3) if e20 is not None else None,
            "mapeS21": round(e21, 3) if e21 is not None else None,
            "mapeDelta": round((e21 or 0) - (e20 or 0), 3),
        })
    worse = sorted(rows, key=lambda r: r["mapeDelta"], reverse=True)[:n]
    better = sorted(rows, key=lambda r: r["mapeDelta"])[:n]
    biggest_shift = sorted(rows, key=lambda r: abs(r["deltaPct"] or 0), reverse=True)[:n]
    return {"worseOnS21": worse, "betterOnS21": better, "largestPriceShift": biggest_shift}


def main():
    global mrpe
    mrpe = load_mrpe()
    print("Loading StarGem rows…")
    rows = mrpe.load_rows()
    train, test = mrpe.split_train_test(rows)
    print(f"Train {len(train):,} | Test {len(test):,}")

    print("Training S20…")
    s20 = mrpe.strategy_s20_specialty_tail_selected_spec(train, test, all_rows=rows)
    print("Training S21…")
    s21 = mrpe.strategy_s21_monotone_grade_selected_spec(train, test, all_rows=rows)

    selected_test = [mrpe.selected_spec_view(row, mask_cut=False) for row in test]
    preds_s20 = mrpe.s20_predict_prices(
        s20["pipe"], selected_test,
        s20["_lookup_tables"], s20["_lookup_global"],
        s20["_cat_tables"], s20["_cat_global"], s20["_cat_levels"],
        s20["_large_carat_tail"],
    )
    preds_s21 = mrpe.s21_predict_prices(
        s21.get("_lgbm"), s21.get("_pre"), selected_test,
        s21["_lookup_tables"], s21["_lookup_global"],
        s21["_cat_tables"], s21["_cat_global"], s21["_cat_levels"],
        s21["_large_carat_tail"],
    )

    cert_test = [mrpe.cert_loaded_view(row) for row in test]
    cert_s20 = mrpe.s20_predict_prices(
        s20["pipe"], cert_test,
        s20["_lookup_tables"], s20["_lookup_global"],
        s20["_cat_tables"], s20["_cat_global"], s20["_cat_levels"],
        s20["_large_carat_tail"],
    )
    cert_s21 = mrpe.s21_predict_prices(
        s21.get("_lgbm"), s21.get("_pre"), cert_test,
        s21["_lookup_tables"], s21["_lookup_global"],
        s21["_cat_tables"], s21["_cat_global"], s21["_cat_levels"],
        s21["_large_carat_tail"],
    )

    def strip_result(r):
        skip = {"pipe", "feats_num", "_lgbm", "_pre"}
        return {k: v for k, v in r.items() if k not in skip and not k.startswith("_")}

    err20 = per_stone_pct_errors(test, preds_s20)
    err21 = per_stone_pct_errors(test, preds_s21)
    train_counts = catalog_weights_from_rows(train)
    all_counts = catalog_weights_from_rows(rows)

    def is_round_1_2(r):
        c = float(r.get("Carat") or 0)
        return str(r.get("Shape", "")).upper() == "ROUND" and 1.0 <= c <= 2.0

    def is_round_1_3(r):
        c = float(r.get("Carat") or 0)
        return str(r.get("Shape", "")).upper() == "ROUND" and 1.0 <= c <= 3.0

    def seg_metrics(predicate):
        sub = [r for r in test if predicate(r)]
        if not sub:
            return None
        ixs = [i for i, r in enumerate(test) if predicate(r)]
        a = [test[i]["SaleDollorPrice"] for i in ixs]
        p20 = [preds_s20[i] for i in ixs]
        p21 = [preds_s21[i] for i in ixs]
        m20 = mrpe.metrics(a, p20)
        m21 = mrpe.metrics(a, p21)
        return {
            "count": len(sub),
            "s20": {**m20, "wmape": wmape(a, p20)},
            "s21": {**m21, "wmape": wmape(a, p21)},
            "deltaMapePp": round(m21["mape"] - m20["mape"], 4),
            "deltaWmapePp": round((wmape(a, p21) or 0) - (wmape(a, p20) or 0), 4),
        }

    priority = {
        "round_1_00_to_2_00ct": seg_metrics(is_round_1_2),
        "round_1_00_to_3_00ct": seg_metrics(is_round_1_3),
        "round_1_00_to_1_49_bucket": seg_metrics(
            lambda r: str(r.get("Shape", "")).upper() == "ROUND"
            and r.get("carat_bucket") == "1.00-1.49"
        ),
        "round_1_50_to_1_99_bucket": seg_metrics(
            lambda r: str(r.get("Shape", "")).upper() == "ROUND"
            and r.get("carat_bucket") == "1.50-1.99"
        ),
        "round_2_00_to_2_99_bucket": seg_metrics(
            lambda r: str(r.get("Shape", "")).upper() == "ROUND"
            and r.get("carat_bucket") == "2.00-2.99"
        ),
        "holdout_excluding_round_1_2ct": seg_metrics(lambda r: not is_round_1_2(r)),
        "holdout_excluding_carat_1_49_and_below": seg_metrics(
            lambda r: r.get("carat_bucket") not in ("0.30-0.49", "0.50-0.69", "0.70-0.89", "0.90-0.99", "1.00-1.49")
        ),
    }

    def bucket_weight(row):
        b = row.get("carat_bucket") or mrpe.carat_bucket(row.get("Carat"))
        return all_counts.get(("carat_bucket", b), 1)

    def shape_bucket_weight(row):
        shape = str(row.get("Shape", "")).upper()
        b = row.get("carat_bucket") or mrpe.carat_bucket(row.get("Carat"))
        return all_counts.get(("shape_carat_bucket", shape, b), 1)

    catalog_w = {
        "trainingRowCounts": {
            "trainRows": len(train),
            "allSheetRows": all_counts.get("total_rows", len(rows)),
            "round_1_00_to_2_00ct_on_sheet": all_counts.get("round_1_00_to_2_00ct_rows", 0),
            "round_1_00_to_3_00ct_on_sheet": all_counts.get("round_1_00_to_3_00ct_rows", 0),
            "round_1_2ct_share_of_sheet_pct": round(
                100 * all_counts.get("round_1_00_to_2_00ct_rows", 0) / max(all_counts.get("total_rows", 1), 1),
                2,
            ),
        },
        "catalogWeightedMape": {
            "byCaratBucketStockWeight": {
                "s20": catalog_weighted_mape(err20, bucket_weight),
                "s21": catalog_weighted_mape(err21, bucket_weight),
                "deltaPp": None,
            },
            "byShapeAndCaratBucketStockWeight": {
                "s20": catalog_weighted_mape(err20, shape_bucket_weight),
                "s21": catalog_weighted_mape(err21, shape_bucket_weight),
            },
        },
        "note": (
            "Each holdout stone is weighted by how many priced rows exist on the full StarGem sheet "
            "in the same segment. This raises MAPE toward high-volume buckets (often 1–1.49 ct round) "
            "but large-dollar 5 ct+ rows still move WMAPE. Compare prioritySegments.round_1_00_to_2_00ct "
            "for the product focus in isolation."
        ),
    }
    cw = catalog_w["catalogWeightedMape"]["byCaratBucketStockWeight"]
    if cw["s20"] is not None and cw["s21"] is not None:
        cw["deltaPp"] = round(cw["s21"] - cw["s20"], 4)

    actual_all = [r["SaleDollorPrice"] for r in test]
    payload = {
        "generatedDate": str(date.today()),
        "testRows": len(test),
        "split": "one_holdout_per_bucket",
        "note": (
            "Holdout MAPE uses Python inference (S20 ExtraTrees, S21 LightGBM Layers 1–3). "
            "Browser S21 additionally applies Layer-4 PAV for grade ordering; that projection "
            "is measured in compare-s20-s21.mjs monotonicity sweeps."
        ),
        "s20": strip_result(s20),
        "s21": strip_result(s21),
        "delta": {
            "selectedSpecMapePp": round(s21["metrics"]["mape"] - s20["metrics"]["mape"], 4),
            "certLoadedMapePp": round(
                s21["certLoadedMetrics"]["mape"] - s20["certLoadedMetrics"]["mape"], 4
            ),
        },
        "segments": {
            "byCaratBucket": {
                "s20": s20["segmentMetrics"]["byCaratBucket"],
                "s21": s21["segmentMetrics"]["byCaratBucket"],
                "deltaMapePp": {},
            },
            "byShape": {
                "s20": segment_mape(test, preds_s20, lambda r: r.get("Shape")),
                "s21": segment_mape(test, preds_s21, lambda r: r.get("Shape")),
            },
            "byClarity": {
                "s20": segment_mape(test, preds_s20, lambda r: r.get("Clarity")),
                "s21": segment_mape(test, preds_s21, lambda r: r.get("Clarity")),
            },
            "byColor": {
                "s20": segment_mape(test, preds_s20, lambda r: r.get("Color")),
                "s21": segment_mape(test, preds_s21, lambda r: r.get("Color")),
            },
            "byCutStyle": {
                "s20": s20["segmentMetrics"]["byCutStyle"],
                "s21": s21["segmentMetrics"]["byCutStyle"],
            },
        },
        "mapeMethodology": mape_methodology_block(),
        "overallWmape": {
            "s20": wmape(actual_all, preds_s20),
            "s21": wmape(actual_all, preds_s21),
            "deltaPp": round((wmape(actual_all, preds_s21) or 0) - (wmape(actual_all, preds_s20) or 0), 4),
        },
        "prioritySegments": priority,
        "catalogWeighting": catalog_w,
        "rowAnalysis": top_deltas(test, preds_s20, preds_s21),
        "meanAbsPriceDeltaPct": round(
            sum(abs((p21 - p20) / p20) for p20, p21 in zip(preds_s20, preds_s21) if p20 > 0)
            / len(test)
            * 100,
            3,
        ),
    }

    buckets = set(s20["segmentMetrics"]["byCaratBucket"]) | set(
        s21["segmentMetrics"]["byCaratBucket"]
    )
    for b in sorted(buckets):
        m20 = s20["segmentMetrics"]["byCaratBucket"].get(b, {}).get("mape")
        m21 = s21["segmentMetrics"]["byCaratBucket"].get(b, {}).get("mape")
        if m20 is not None and m21 is not None:
            payload["segments"]["byCaratBucket"]["deltaMapePp"][b] = round(m21 - m20, 4)

    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"\n✓ Wrote {OUT_JSON}")
    print(
        f"  Selected-spec MAPE: S20 {s20['metrics']['mape']:.4f}% → S21 {s21['metrics']['mape']:.4f}% "
        f"(Δ {payload['delta']['selectedSpecMapePp']:+.4f} pp)"
    )
    pr = priority.get("round_1_00_to_2_00ct")
    if pr:
        print(
            f"  Round 1.00–2.00 ct: S20 {pr['s20']['mape']:.4f}% → S21 {pr['s21']['mape']:.4f}% "
            f"(n={pr['count']}, Δ {pr['deltaMapePp']:+.4f} pp)"
        )
    ex = priority.get("holdout_excluding_round_1_2ct")
    if ex:
        print(
            f"  Excl. round 1–2 ct: S20 {ex['s20']['mape']:.4f}% → S21 {ex['s21']['mape']:.4f}% "
            f"(n={ex['count']})"
        )


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"✗ {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)
