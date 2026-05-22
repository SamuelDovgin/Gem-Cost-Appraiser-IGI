#!/usr/bin/env python3
"""
analyze-messi-colors.py
─────────────────────────────────────────────────────────────────────────────
Parses the Wuzhou Messi Gems fancy-color lab diamond workbook
(2026.05.11MESSIGEMS COLORS LAB DIAMONDS LIST.xlsx) and produces:

  1. research/data/messi-color-index.json  — full machine-readable color index
  2. research/data/messi-color-comps.json  — compact app comp pool
  3. Console summary report by hue/intensity/shape

Key logic:
  • Includes all priced stones >= 1.00 ct
  • Normalizes Messi shape codes and Chinese shape hints
  • Preserves raw color labels while classifying hue, modifier, and intensity
  • Groups app comps by (shape, normalized color label, clarity, 0.05ct bin)

Usage:
  python3 research/scripts/analyze-messi-colors.py
─────────────────────────────────────────────────────────────────────────────
"""

import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import date
from statistics import median

try:
    import openpyxl
except ImportError:
    sys.exit("ERROR: openpyxl not installed. Run: pip3 install openpyxl")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shape_buckets import MESSI_SHAPE_MAP, classify_shape_by_lw


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
DATA_DIR = os.path.join(PROJECT_ROOT, "data")
EXCEL_FILE = os.path.join(DATA_DIR, "2026.05.11MESSIGEMS COLORS LAB DIAMONDS LIST.xlsx")
OUTPUT_JSON = os.path.join(DATA_DIR, "messi-color-index.json")
COMPS_JSON = os.path.join(DATA_DIR, "messi-color-comps.json")
MESSI_FACTORY_URL = "https://messijewelry.en.alibaba.com/factory.html?spm=a27aq.24735993.8735814750.1.75a939e6ZJ3XPe"


SHAPE_CODE_MAP = {
    **MESSI_SHAPE_MAP,
    "AC": "ashoka",
    "AS": "asscher",
    "CCR": "radiant",
    "CL": "clover",
    "DM": "shield",
    "LX": "hexagonal",
    "MS": "marquise",
    "OM": "old_mine",
    "PA": "radiant",
    "SJ": "trilliant",
    "TB": "tapered_baguette",
}

CHINESE_SHAPE_HINTS = {
    "长垫形": "elongated_cushion",
    "直角垫形": "elongated_cushion",
    "正垫形": "square_cushion",
    "阿育王": "ashoka",
    "菱形": "shield",
    "棱形": "shield",
    "马眼": "marquise",
    "三角": "trilliant",
    "六边形": "hexagonal",
    "四叶草": "clover",
    "老矿": "old_mine",
}

COMP_SKIP_SHAPES = {"unknown", "ashoka", "clover"}
CLARITY_NORM = {
    "VVS": "VVS2",
    "VVS 1": "VVS1",
    "VVS 2": "VVS2",
    "VS": "VS1",
    "VS 1": "VS1",
    "VS 2": "VS2",
    "SI": "SI1",
}

INTENSITY_RANK = {"light": 0, "fancy": 1, "deep": 1, "dark": 1, "intense": 2, "vivid": 3}
MODIFIER_TERMS = ["brownish", "greyish", "grayish", "orangy", "purplish", "yellowish", "pinkish", "bluish", "greenish"]


def safe_float(value):
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def safe_int(value):
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def clean_text(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()


def header_index(headers, name):
    for i, header in enumerate(headers):
        if header == name:
            return i
    return None


def cell(row, index):
    if index is None or index >= len(row):
        return None
    return row[index]


def load_rows(path):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    rows = []
    try:
        for ws in wb.worksheets:
            raw_rows = list(ws.iter_rows(values_only=True))
            if not raw_rows:
                continue
            headers = raw_rows[0]
            indices = {name: header_index(headers, name) for name in [
                "NO.", "CERT NO.", "形状", "SHAPE", "CT", "COLOR", "CLARITY",
                "POL.", "SYM.", "CUT", "MEASUREMENT", "TYPE", "USD/STONE", "REMARK"
            ]}
            for raw in raw_rows[1:]:
                if not any(v is not None for v in raw):
                    continue
                rows.append({
                    "sourceSheet": ws.title,
                    "no": cell(raw, indices["NO."]),
                    "certNo": cell(raw, indices["CERT NO."]),
                    "shapeChinese": cell(raw, indices["形状"]),
                    "shapeCode": cell(raw, indices["SHAPE"]),
                    "carat": cell(raw, indices["CT"]),
                    "color": cell(raw, indices["COLOR"]),
                    "clarity": cell(raw, indices["CLARITY"]),
                    "polish": cell(raw, indices["POL."]),
                    "symmetry": cell(raw, indices["SYM."]),
                    "cut": cell(raw, indices["CUT"]),
                    "measurement": cell(raw, indices["MEASUREMENT"]),
                    "growthMethod": cell(raw, indices["TYPE"]),
                    "pricePerStone": cell(raw, indices["USD/STONE"]),
                    "remark": cell(raw, indices["REMARK"]),
                })
    finally:
        wb.close()
    return rows


def parse_measurement(value):
    nums = [safe_float(x) for x in re.findall(r"\d+(?:\.\d+)?", clean_text(value))]
    nums = [n for n in nums if n is not None]
    if len(nums) >= 3:
        return nums[0], nums[1], nums[2]
    if len(nums) == 2:
        return nums[0], nums[1], None
    return None, None, None


def normalize_clarity(value):
    raw = clean_text(value).upper()
    return CLARITY_NORM.get(raw, raw)


def normalize_shape(raw_code, chinese_hint, lw_ratio):
    code = clean_text(raw_code).upper()
    hint = clean_text(chinese_hint)
    explicit = None
    for token, shape in CHINESE_SHAPE_HINTS.items():
        if token in hint:
            explicit = shape
            break

    base = SHAPE_CODE_MAP.get(code, code.lower() or "unknown")
    if explicit in {"ashoka", "clover", "old_mine", "shield", "trilliant", "hexagonal"}:
        return explicit, base, explicit, explicit.replace("_", " ").title()

    cut_hint = "长垫形" if explicit == "elongated_cushion" else ""
    bucket = classify_shape_by_lw(base, lw_ratio, cut_hint)
    shape = bucket["shape"]
    sub_variant = bucket["subVariant"]
    sub_label = bucket["subVariantLabel"]

    if explicit == "square_cushion":
        shape = "square_cushion"
        sub_variant = "square_cushion"
        sub_label = "Square Cushion"

    return shape, base, sub_variant, sub_label


def normalize_color(raw_color, source_sheet):
    raw = clean_text(raw_color)
    compact = re.sub(r"\s+", " ", raw).strip()
    lower = compact.lower()
    sheet = clean_text(source_sheet).lower()

    if lower == "coffee":
        compact = "Fancy Brown / Coffee"
        lower = compact.lower()
    elif lower in {"yellow", "pink", "blue", "green"}:
        compact = "Fancy " + compact.title()
        lower = compact.lower()
    elif lower == "blue green":
        compact = "Fancy Blue Green"
        lower = compact.lower()
    elif not lower.startswith("fancy") and sheet in {"yellow", "pink", "blue", "green", "coffee"}:
        compact = "Fancy " + compact.title()
        lower = compact.lower()

    hue = None
    # Last hue wins for modifier-style labels like "Greenish Blue" or "Brownish Pink".
    hue_hits = []
    for hue_name in ["yellow", "pink", "blue", "green", "orange", "orangy", "purple", "violet", "brown", "coffee", "black", "red"]:
        idx = lower.rfind(hue_name)
        if idx >= 0:
            hue_hits.append((idx, hue_name))
    if hue_hits:
        hue = sorted(hue_hits)[-1][1]
    if hue == "coffee":
        hue = "brown"
    if hue == "orangy":
        hue = "orange"
    if hue == "violet":
        hue = "purple"

    intensity = "fancy"
    for token in ["vivid", "intense", "light", "deep", "dark"]:
        if token in lower:
            intensity = token
            break

    modifiers = [m for m in MODIFIER_TERMS if m in lower]
    if "coffee" in lower and "brownish" not in modifiers:
        modifiers.append("brownish")

    if hue in {"brown", "black"}:
        app_key = "brown_f" if hue == "brown" else "black"
    elif hue == "red":
        app_key = "red_fv" if intensity == "vivid" else "red_f"
    elif hue in {"yellow", "pink", "blue", "green", "orange", "purple"}:
        suffix = {"light": "fl", "fancy": "f", "deep": "f", "dark": "f", "intense": "fi", "vivid": "fv"}[intensity]
        if hue == "green" and suffix == "fv":
            app_key = "green_fv"
        elif hue == "green" and suffix == "fl":
            app_key = "green_fl"
        elif hue == "purple" and suffix == "fv":
            app_key = "purple_fi"
        else:
            app_key = f"{hue}_{suffix}"
    else:
        app_key = None

    return {
        "raw": raw,
        "normalized": compact,
        "hue": hue or "unknown",
        "intensity": intensity,
        "intensityRank": INTENSITY_RANK.get(intensity, 1),
        "modifiers": modifiers,
        "appColorKey": app_key,
    }


def bin_carat(carat):
    return round(round(carat / 0.05) * 0.05, 2)


def normalise_row(raw):
    carat = safe_float(raw["carat"])
    price = safe_float(raw["pricePerStone"])
    if carat is None or carat < 1.0 or price is None or price <= 0:
        return None

    s1, s2, s3 = parse_measurement(raw["measurement"])
    lw_ratio = round(max(s1, s2) / min(s1, s2), 4) if s1 and s2 and min(s1, s2) > 0 else None
    shape, base_shape, sub_variant, sub_label = normalize_shape(raw["shapeCode"], raw["shapeChinese"], lw_ratio)
    color = normalize_color(raw["color"], raw["sourceSheet"])
    clarity = normalize_clarity(raw["clarity"])

    return {
        "sourceSheet": clean_text(raw["sourceSheet"]),
        "rowNo": clean_text(raw["no"]),
        "lab": "IGI" if raw.get("certNo") else None,
        "reportNo": safe_int(raw.get("certNo")),
        "rawShapeCode": clean_text(raw["shapeCode"]),
        "shapeChinese": clean_text(raw["shapeChinese"]),
        "shape": shape,
        "baseShape": base_shape,
        "subVariant": sub_variant,
        "subVariantLabel": sub_label,
        "isElongatedCushion": shape == "elongated_cushion",
        "isOvalElongated": sub_variant == "oval_elongated",
        "isMoval": shape == "moval",
        "carat": carat,
        "color": color["normalized"],
        "rawColor": color["raw"],
        "colorFamily": "fancy",
        "colorHue": color["hue"],
        "colorIntensity": color["intensity"],
        "colorIntensityRank": color["intensityRank"],
        "colorModifiers": color["modifiers"],
        "appColorKey": color["appColorKey"],
        "clarity": clarity,
        "cut": clean_text(raw["cut"]),
        "polish": clean_text(raw["polish"]),
        "symmetry": clean_text(raw["symmetry"]),
        "growthMethod": clean_text(raw["growthMethod"]),
        "measurement": clean_text(raw["measurement"]),
        "size1": s1,
        "size2": s2,
        "size3": s3,
        "lwRatio": lw_ratio,
        "pricePerStone": round(price, 2),
        "pricePerCarat": round(price / carat, 2),
        "remark": clean_text(raw["remark"]),
    }


def build_summary(records):
    by_color = defaultdict(list)
    by_shape = defaultdict(list)
    by_color_shape = defaultdict(list)
    for r in records:
        by_color[(r["colorHue"], r["colorIntensity"], r["color"])].append(r)
        by_shape[r["shape"]].append(r)
        by_color_shape[(r["colorHue"], r["colorIntensity"], r["shape"])].append(r)

    def stats(recs):
        prices = [r["pricePerStone"] for r in recs]
        ppc = [r["pricePerCarat"] for r in recs]
        carats = [r["carat"] for r in recs]
        return {
            "count": len(recs),
            "caratMin": min(carats),
            "caratMax": max(carats),
            "priceMin": min(prices),
            "priceMedian": round(median(prices), 2),
            "priceMax": max(prices),
            "ppcMedian": round(median(ppc), 2),
        }

    return {
        "totalStones": len(records),
        "sourceSheets": dict(Counter(r["sourceSheet"] for r in records)),
        "colorLabels": dict(Counter(r["color"] for r in records)),
        "colorHues": dict(Counter(r["colorHue"] for r in records)),
        "colorIntensities": dict(Counter(r["colorIntensity"] for r in records)),
        "colorModifiers": dict(Counter(m for r in records for m in r["colorModifiers"])),
        "clarityBreakdown": dict(Counter(r["clarity"] for r in records)),
        "shapeBreakdown": dict(Counter(r["shape"] for r in records)),
        "elongatedCushionCount": sum(1 for r in records if r["isElongatedCushion"]),
        "ovalElongatedCount": sum(1 for r in records if r["isOvalElongated"]),
        "movalCount": sum(1 for r in records if r["isMoval"]),
        "byColor": {f"{hue}/{intensity}/{label}": stats(recs) for (hue, intensity, label), recs in sorted(by_color.items())},
        "byShape": {shape: stats(recs) for shape, recs in sorted(by_shape.items())},
        "byColorShape": {f"{hue}/{intensity}/{shape}": stats(recs) for (hue, intensity, shape), recs in sorted(by_color_shape.items())},
    }


def build_comp_pool(records):
    groups = defaultdict(list)
    for r in records:
        if r["shape"] in COMP_SKIP_SHAPES:
            continue
        if not r["appColorKey"]:
            continue
        key = (r["shape"], r["color"], r["clarity"], bin_carat(r["carat"]))
        groups[key].append(r)

    comps = []
    for (shape, color, clarity, carat), recs in sorted(groups.items()):
        prices = [r["pricePerStone"] for r in recs]
        hues = Counter(r["colorHue"] for r in recs)
        intensities = Counter(r["colorIntensity"] for r in recs)
        app_keys = Counter(r["appColorKey"] for r in recs)
        comps.append({
            "priceUsd": round(median(prices), 2),
            "carat": carat,
            "shape": shape,
            "clarity": clarity,
            "colorFamily": "fancy",
            "colorNormalized": None,
            "color": color,
            "colorHue": hues.most_common(1)[0][0],
            "colorIntensity": intensities.most_common(1)[0][0],
            "appColorKey": app_keys.most_common(1)[0][0],
            "caratBand": False,
            "clarityBand": clarity in {"VS1", "VVS2", "SI1"} and any(r["clarity"] in {"VS", "VVS", "SI"} for r in recs),
            "confidence": "high" if len(recs) >= 2 else "medium-high",
            "count": len(recs),
            "priceMin": min(prices),
            "priceMax": max(prices),
            "label": "Messi Gems Fancy Color",
            "supplier": "Wuzhou Messi Gems Co., Ltd.",
            "section": f"{shape} {color} {clarity} — Messi Gems color stock",
            "url": MESSI_FACTORY_URL,
            "sourceType": "supplier-color-sheet",
        })
    return comps


def main():
    print(f"Loading: {EXCEL_FILE}")
    raw_rows = load_rows(EXCEL_FILE)
    print(f"  Raw rows: {len(raw_rows):,}")
    records = [normalise_row(r) for r in raw_rows]
    records = [r for r in records if r is not None]
    print(f"  Normalised priced >=1ct: {len(records):,}")

    summary = build_summary(records)
    comps = build_comp_pool(records)

    index = {
        "supplier": "Wuzhou Messi Gems Co., Ltd.",
        "location": "Guangxi, China",
        "sourceFile": "2026.05.11MESSIGEMS COLORS LAB DIAMONDS LIST.xlsx",
        "sourceDate": "2026-05-11",
        "generatedDate": str(date.today()),
        "purpose": "Fancy-color source-of-truth comp index for Messi Gems lab-grown diamonds",
        "filterApplied": "carat >= 1.00 AND pricePerStone > 0",
        "shapeCodeMap": SHAPE_CODE_MAP,
        "summary": summary,
        "records": records,
    }
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)
    print(f"\nFull index → {OUTPUT_JSON} ({len(records):,} records)")

    comp_out = {
        "supplier": "Wuzhou Messi Gems Co., Ltd.",
        "sourceDate": "2026-05-11",
        "generatedDate": str(date.today()),
        "compCount": len(comps),
        "binSize": "0.05ct",
        "comps": comps,
    }
    with open(COMPS_JSON, "w", encoding="utf-8") as f:
        json.dump(comp_out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Comp pool  → {COMPS_JSON} ({len(comps):,} bins, {os.path.getsize(COMPS_JSON)//1024}KB)")

    print("\n" + "═" * 70)
    print("MESSI GEMS — FANCY COLOR LAB DIAMOND ANALYSIS (priced >= 1 ct)")
    print("═" * 70)
    print(f"  Total stones:             {summary['totalStones']:,}")
    print(f"  Comp bins:                {len(comps):,}")
    print(f"  Elongated cushion count:  {summary['elongatedCushionCount']:,}")
    print(f"  Elongated oval metadata:  {summary['ovalElongatedCount']:,} (canonical oval)")
    print(f"  Moval count:              {summary['movalCount']:,}")

    print("\n── COLOR HUES ───────────────────────────────────────────────────────")
    for hue, count in sorted(summary["colorHues"].items(), key=lambda x: -x[1]):
        print(f"  {hue:>8}: {count:,}")

    print("\n── COLOR LABELS ─────────────────────────────────────────────────────")
    for label, count in sorted(summary["colorLabels"].items(), key=lambda x: -x[1]):
        print(f"  {label:<32} {count:>5,}")

    print("\n── SHAPES ───────────────────────────────────────────────────────────")
    for shape, count in sorted(summary["shapeBreakdown"].items(), key=lambda x: -x[1]):
        print(f"  {shape:<20} {count:>5,}")

    print("\nDone.")


if __name__ == "__main__":
    main()
