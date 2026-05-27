#!/usr/bin/env python3
"""Diagnose one StarGem browser ML prediction against the supplier sheet."""

import argparse
import json
import math
import os
import re
from collections import defaultdict
from statistics import median

import xlrd

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
DATA_DIR = os.path.join(PROJECT_ROOT, "data")
XLS_FILE = os.path.join(DATA_DIR, "STARS Diamonds Stock2026.5.20.xls")

CARAT_BUCKET_BOUNDS = [
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


def norm(value):
    text = re.sub(r"\s+", " ", str(value if value is not None else "-").strip().upper())
    return text if text and text not in ("N/A", "NONE", "NULL") else "-"


def safe_float(value):
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n if math.isfinite(n) else None


def carat_bucket(carat):
    for lo, hi, label in CARAT_BUCKET_BOUNDS:
        if lo <= carat <= hi:
            return label
    if carat >= 10:
        return "10.00+"
    return "<0.30"


def carat_bucket_position(carat):
    for lo, hi, _ in CARAT_BUCKET_BOUNDS:
        if lo <= carat <= hi:
            return (carat - lo) / (hi - lo)
    return 0.5


def parse_measurement(value):
    nums = []
    for part in re.split(r"\s*-\s*", str(value or "").strip()):
        n = safe_float(part)
        if n is not None:
            nums.append(n)
    length = nums[0] if len(nums) > 0 else None
    width = nums[1] if len(nums) > 1 else None
    height = nums[2] if len(nums) > 2 else None
    ratio = max(length, width) / min(length, width) if length and width and min(length, width) > 0 else None
    return length, width, height, ratio


def load_sheet_rows():
    wb = xlrd.open_workbook(XLS_FILE)
    ws = wb.sheet_by_name("Table")
    headers = [str(ws.cell_value(0, col)).strip() for col in range(ws.ncols)]
    rows = []
    for idx in range(1, ws.nrows):
        raw = {headers[col]: ws.cell_value(idx, col) for col in range(ws.ncols)}
        carat = safe_float(raw.get("Carat"))
        price = safe_float(raw.get("SaleDollorPrice"))
        if not carat or not price:
            continue
        length, width, height, ratio = parse_measurement(raw.get("Measurement"))
        rows.append({
            "rowNo": idx + 1,
            "Carat": carat,
            "Shape": norm(raw.get("Shape")),
            "Color": norm(raw.get("Color")),
            "Clarity": norm(raw.get("Clarity")),
            "Cut": norm(raw.get("Cut")),
            "Polish": norm(raw.get("Polish")),
            "Symmetry": norm(raw.get("Symmetry")),
            "Fluorescence": norm(raw.get("Fluorescence")),
            "Report": "IGI" if "IGI" in norm(raw.get("Report")) else norm(raw.get("Report")),
            "TypeName": norm(raw.get("TypeName")),
            "Table_Scale": safe_float(raw.get("Table_Scale")),
            "Depth_Scale": safe_float(raw.get("Depth_Scale")),
            "Length": length,
            "Width": width,
            "Height": height,
            "LengthWidthRatio": ratio,
            "SaleDollorPrice": price,
            "usd_per_ct": price / carat,
            "carat_bucket": carat_bucket(carat),
            "Reportno": str(raw.get("Reportno", "")),
        })
    return rows


def model_lookup_rate(row, model):
    lookups = model.get("featureLookups", {})
    for table in lookups.get("lookupTables", []):
        key = "||".join(norm(row.get(field)) for field in table.get("fields", []))
        hit = table.get("groups", {}).get(key)
        if hit and safe_float(hit.get("usdPerCt")):
            return float(hit["usdPerCt"]), table.get("level"), hit.get("count", 0), key
    global_rate = safe_float(lookups.get("lookupGlobalRate"))
    return (global_rate / 170 if global_rate else None), "GLOBAL", 0, ""


def model_category_rate(row, model):
    lookups = model.get("featureLookups", {})
    for name, fields in lookups.get("categoryLevels", []):
        key = "||".join(norm(row.get(field)) for field in fields)
        val = lookups.get("categoryTables", {}).get(name, {}).get(key)
        if safe_float(val):
            return float(val), name, key
    return safe_float(lookups.get("categoryGlobalRate")), "GLOBAL", ""


def numeric_feature(row, field, model):
    carat = safe_float(row.get("Carat")) or 0
    if field == "Carat_sq":
        return carat * carat
    if field == "Carat_cube":
        return carat * carat * carat
    if field == "Log_Carat":
        return math.log(carat) if carat > 0 else None
    if field == "Carat_bucket_pos":
        return carat_bucket_position(carat)
    if field == "Dist_carat_threshold":
        return abs(carat - round(carat * 2) / 2)
    if field == "Lookup_RatePerCt":
        return model_lookup_rate(row, model)[0]
    if field == "Lookup_IsGlobal":
        return 1.0 if model_lookup_rate(row, model)[1] == "GLOBAL" else 0.0
    if field == "Lookup_Count":
        return model_lookup_rate(row, model)[2] or 0
    if field == "Log_Lookup_Count":
        return math.log1p(model_lookup_rate(row, model)[2] or 0)
    if field == "Log_Lookup_RatePerCt":
        rate = model_lookup_rate(row, model)[0]
        return math.log(rate) if rate and rate > 0 else None
    if field == "Category_RatePerCt":
        return model_category_rate(row, model)[0]
    if field == "Log_Category_RatePerCt":
        rate = model_category_rate(row, model)[0]
        return math.log(rate) if rate and rate > 0 else None
    if field == "Has_Dimensions":
        return 1.0 if all(safe_float(row.get(f)) for f in ("Length", "Width", "Height")) else 0.0
    if field == "Has_TableDepth":
        return 1.0 if safe_float(row.get("Table_Scale")) and safe_float(row.get("Depth_Scale")) else 0.0
    if field == "Has_GrowthMethod":
        return 0.0 if norm(row.get("TypeName")) == "-" else 1.0
    if field == "Has_Report_Cut":
        return 0.0 if norm(row.get("Cut")) == "-" else 1.0
    if field == "Is_SelectedSpec_Mode":
        return 0.0 if all(safe_float(row.get(f)) for f in ("Length", "Width", "Height")) else 1.0
    return row.get(field)


def predict_model(row, model):
    features = model["features"]
    vector = []
    for field in features.get("categorical", []):
        value = norm(row.get(field))
        vector.extend(1 if value == cat else 0 for cat in features.get("categories", {}).get(field, []))
    for field in features.get("numeric", []):
        raw = numeric_feature(row, field, model)
        raw = safe_float(raw)
        fallback = safe_float(features.get("numericMedians", {}).get(field))
        vector.append(raw if raw is not None else (fallback if fallback is not None else 0))

    leaves = []
    for tree in model["trees"]:
        node = 0
        while tree["childrenLeft"][node] != -1:
            feature = tree["feature"][node]
            threshold = tree["threshold"][node]
            value = vector[feature] if feature < len(vector) else 0
            node = tree["childrenLeft"][node] if value <= threshold else tree["childrenRight"][node]
        leaves.append(tree["value"][node])

    log_value = sum(leaves) / len(leaves)
    carat = row["Carat"]
    if model.get("targetType") == "log_lookup_residual":
        lookup_rate = model_lookup_rate(row, model)[0]
        rate = (lookup_rate or 0.01) * math.exp(log_value)
    elif model.get("targetType") == "log_rate":
        rate = math.exp(log_value)
    else:
        return math.exp(log_value), leaves
    return rate * carat, leaves


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default=os.path.join(DATA_DIR, "starsgem-ml-extra-trees-model-10-trees.json"))
    parser.add_argument("--carat", type=float, required=True)
    parser.add_argument("--shape", required=True)
    parser.add_argument("--color", required=True)
    parser.add_argument("--clarity", required=True)
    parser.add_argument("--cut", default="ID")
    parser.add_argument("--type", default="-", dest="typename")
    args = parser.parse_args()

    with open(args.model, encoding="utf-8") as f:
        model = json.load(f)

    row = {
        "Carat": args.carat,
        "carat_bucket": carat_bucket(args.carat),
        "Shape": norm(args.shape),
        "Color": norm(args.color),
        "Clarity": norm(args.clarity),
        "Cut": norm(args.cut),
        "TypeName": norm(args.typename),
        "Report": "IGI",
        "Polish": "EX",
        "Symmetry": "EX",
        "Fluorescence": "-",
    }
    price, leaves = predict_model(row, model)
    rates = [math.exp(v) for v in leaves]
    if model.get("targetType") == "log_lookup_residual":
        lookup_rate = model_lookup_rate(row, model)[0] or 1
        rates = [lookup_rate * rate for rate in rates]

    sheet = load_sheet_rows()
    bucket_rows = [
        r for r in sheet
        if r["carat_bucket"] == row["carat_bucket"]
        and r["Shape"] == row["Shape"]
        and r["Color"] == row["Color"]
        and r["Clarity"] == row["Clarity"]
    ]
    near_rows = [
        r for r in sheet
        if abs(r["Carat"] - row["Carat"]) <= 0.02
        and r["Shape"] == row["Shape"]
        and r["Color"] == row["Color"]
        and r["Clarity"] == row["Clarity"]
    ]

    print(f"Model: {model.get('modelName')}")
    print(f"Artifact: {args.model}")
    print(f"Target type: {model.get('targetType')} | trees: {len(model.get('trees', []))}")
    print(f"Prediction: ${price:.2f} (${price / row['Carat']:.2f}/ct)")
    print(f"Lookup feature: {model_lookup_rate(row, model)}")
    print(f"Category feature: {model_category_rate(row, model)}")
    print(f"Leaf rates: min ${min(rates):.2f}/ct, median ${median(rates):.2f}/ct, max ${max(rates):.2f}/ct")
    if bucket_rows:
        print(f"Sheet bucket n={len(bucket_rows)} median=${median(r['usd_per_ct'] for r in bucket_rows):.2f}/ct")
    if near_rows:
        print(f"Sheet +/-0.02ct n={len(near_rows)} median=${median(r['usd_per_ct'] for r in near_rows):.2f}/ct")
        by_cut = defaultdict(list)
        for r in near_rows:
            by_cut[r["Cut"]].append(r["usd_per_ct"])
        for cut, vals in sorted(by_cut.items()):
            print(f"  cut {cut}: n={len(vals)} median=${median(vals):.2f}/ct")


if __name__ == "__main__":
    main()
