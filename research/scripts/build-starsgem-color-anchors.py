#!/usr/bin/env python3
"""Build the small StarGem fancy-color anchor index from known quoted stones."""

from __future__ import annotations

import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path
from statistics import median

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
DATA_DIR = PROJECT_ROOT / "data"
OUTPUT_JSON = DATA_DIR / "starsgem-color-index.json"
COMPS_JSON = DATA_DIR / "starsgem-color-comps.json"
STARGEM_URL = "https://starsgem.en.alibaba.com/"

sys.path.insert(0, str(SCRIPT_DIR))
from igi_enrichment import apply_enrichment_to_records, load_enrichment  # noqa: E402
from shape_buckets import classify_shape_by_lw  # noqa: E402


INTENSITY_RANK = {"light": 0, "fancy": 1, "deep": 1, "dark": 1, "intense": 2, "vivid": 3}
MODIFIER_TERMS = [
    "brownish",
    "greyish",
    "grayish",
    "orangy",
    "purplish",
    "yellowish",
    "pinkish",
    "bluish",
    "greenish",
]

ANCHORS = [
    {
        "sourceId": "starsgem-color-anchor-001",
        "reportNo": 790602324,
        "pricePerStone": 310.00,
        "carat": 1.04,
        "rawShape": "Round Brilliant",
        "shape": "round",
        "color": "Fancy Vivid Yellow",
        "clarity": "VVS2",
        "cut": "Ideal",
        "polish": "Excellent",
        "symmetry": "Excellent",
        "fluorescence": "Excellent",
        "growthMethod": "HPHT",
        "treatment": "As Grown - No indication of post-growth treatment",
        "measurement": "6.43 - 6.48 X 4.01 MM",
        "notes": "User-supplied StarGem quote at $310.",
    },
    {
        "sourceId": "starsgem-color-anchor-002",
        "reportNo": 733572027,
        "pricePerStone": 410.00,
        "carat": 2.04,
        "rawShape": "Oval Brilliant",
        "shape": "oval",
        "color": "Fancy Vivid Blue",
        "clarity": "VS2",
        "cut": None,
        "polish": "Excellent",
        "symmetry": "Excellent",
        "fluorescence": "None",
        "growthMethod": "CVD",
        "treatment": "May include post-growth treatment",
        "measurement": "10.97 X 7.23 X 4.02 MM",
        "notes": "User-supplied StarGem quote at $410.",
    },
    {
        "sourceId": "starsgem-color-anchor-003",
        "reportNo": 781650451,
        "pricePerStone": 525.00,
        "carat": 2.10,
        "rawShape": "Marquise Brilliant",
        "shape": "marquise",
        "color": "Fancy Vivid Pink",
        "clarity": "VS1",
        "cut": None,
        "polish": "Excellent",
        "symmetry": "Excellent",
        "fluorescence": "Slight",
        "growthMethod": "CVD",
        "treatment": "May include post-growth treatment",
        "measurement": "12.38 X 6.87 X 4.46 MM",
        "notes": "User-supplied StarGem quote at $525.",
    },
    {
        "sourceId": "starsgem-color-anchor-004",
        "reportNo": 774635289,
        "pricePerStone": 1265.00,
        "carat": 4.16,
        "rawShape": "Cushion Modified Brilliant",
        "shape": "cushion",
        "color": "Fancy Intense Yellow",
        "clarity": "VS1",
        "cut": None,
        "polish": "Excellent",
        "symmetry": "Excellent",
        "fluorescence": "None",
        "growthMethod": "CVD",
        "treatment": None,
        "measurement": "10.47 X 8.50 X 5.21 MM",
        "notes": "User-supplied StarGem quote at $1,265.",
    },
    {
        "sourceId": "starsgem-color-anchor-005",
        "reportNo": 795666166,
        "pricePerStone": 5330.00,
        "carat": 10.17,
        "rawShape": "Round Brilliant",
        "shape": "round",
        "color": "Fancy Intense Blue",
        "clarity": "VS1",
        "cut": "Ideal",
        "polish": "Excellent",
        "symmetry": "Excellent",
        "fluorescence": "Excellent",
        "growthMethod": "CVD",
        "treatment": "May include post-growth treatment",
        "measurement": "13.89 - 13.92 X 8.44 MM",
        "notes": "User-supplied StarGem quote at $5,330.",
    },
]


def clean_text(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()


def parse_measurement(value):
    nums = [float(x) for x in re.findall(r"\d+(?:\.\d+)?", clean_text(value))]
    if len(nums) >= 3:
        s1, s2, s3 = nums[0], nums[1], nums[2]
        ratio = round(max(s1, s2) / min(s1, s2), 4) if min(s1, s2) > 0 else None
        return s1, s2, s3, ratio
    return None, None, None, None


def normalize_color(raw_color):
    raw = clean_text(raw_color)
    lower = raw.lower()
    intensity = "fancy"
    if "vivid" in lower:
        intensity = "vivid"
    elif "intense" in lower:
        intensity = "intense"
    elif "light" in lower:
        intensity = "light"
    elif "deep" in lower:
        intensity = "deep"
    elif "dark" in lower:
        intensity = "dark"

    hue = "unknown"
    for candidate in ("yellow", "pink", "blue", "green", "orange", "purple", "violet", "red", "brown", "gray", "grey"):
        if candidate in lower:
            hue = "purple" if candidate == "violet" else "gray" if candidate == "grey" else candidate
            break

    modifiers = [m for m in MODIFIER_TERMS if m in lower]
    suffix = {
        "light": "fl",
        "fancy": "f",
        "intense": "fi",
        "vivid": "fv",
        "deep": "f",
        "dark": "f",
    }.get(intensity, "f")
    app_key = f"{hue}_{suffix}" if hue != "unknown" else None

    return {
        "normalized": raw,
        "hue": hue,
        "intensity": intensity,
        "intensityRank": INTENSITY_RANK.get(intensity, 1),
        "modifiers": modifiers,
        "appColorKey": app_key,
    }


def bin_carat(carat):
    return round(round(carat / 0.05) * 0.05, 2)


def build_records():
    records = []
    for anchor in ANCHORS:
        s1, s2, s3, ratio = parse_measurement(anchor["measurement"])
        color = normalize_color(anchor["color"])
        bucket = classify_shape_by_lw(anchor["shape"], ratio, anchor["rawShape"])
        shape = bucket["shape"]
        records.append({
            "sourceId": anchor["sourceId"],
            "sourceType": "direct-starsgem-color-quote",
            "sourceDate": "2026-05-27",
            "supplier": "Wuzhou Starsgem Co., Ltd.",
            "lab": "IGI",
            "reportNo": anchor["reportNo"],
            "rawShape": anchor["rawShape"],
            "shape": shape,
            "baseShape": anchor["shape"],
            "subVariant": bucket.get("subVariant"),
            "subVariantLabel": bucket.get("subVariantLabel"),
            "isElongatedCushion": shape == "elongated_cushion",
            "isOvalElongated": bucket.get("subVariant") == "oval_elongated",
            "isLongOval": bucket.get("subVariant") in ("oval_long", "oval_moval_like"),
            "isMovalLikeOval": bucket.get("subVariant") == "oval_moval_like",
            "isMoval": shape == "moval",
            "carat": anchor["carat"],
            "color": color["normalized"],
            "rawColor": anchor["color"],
            "colorFamily": "fancy",
            "colorHue": color["hue"],
            "colorIntensity": color["intensity"],
            "colorIntensityRank": color["intensityRank"],
            "colorModifiers": color["modifiers"],
            "appColorKey": color["appColorKey"],
            "clarity": anchor["clarity"],
            "cut": anchor["cut"],
            "polish": anchor["polish"],
            "symmetry": anchor["symmetry"],
            "fluorescence": anchor["fluorescence"],
            "growthMethod": anchor["growthMethod"],
            "treatment": anchor["treatment"],
            "measurement": anchor["measurement"],
            "size1": s1,
            "size2": s2,
            "size3": s3,
            "lwRatio": ratio,
            "pricePerStone": round(anchor["pricePerStone"], 2),
            "pricePerCarat": round(anchor["pricePerStone"] / anchor["carat"], 2),
            "sourceAdjustmentFactor": 1.0,
            "sourceAdjustedPricePerStone": round(anchor["pricePerStone"], 2),
            "sourceAdjustedPricePerCarat": round(anchor["pricePerStone"] / anchor["carat"], 2),
            "notes": anchor["notes"],
        })
    return records


def build_summary(records):
    return {
        "totalStones": len(records),
        "colorLabels": dict(Counter(r["color"] for r in records)),
        "colorHues": dict(Counter(r["colorHue"] for r in records)),
        "colorIntensities": dict(Counter(r["colorIntensity"] for r in records)),
        "clarityBreakdown": dict(Counter(r["clarity"] for r in records)),
        "shapeBreakdown": dict(Counter(r["shape"] for r in records)),
        "priceRange": {
            "min": min(r["pricePerStone"] for r in records),
            "median": round(median(r["pricePerStone"] for r in records), 2),
            "max": max(r["pricePerStone"] for r in records),
        },
    }


def build_comp_pool(records):
    groups = defaultdict(list)
    for r in records:
        groups[(r["shape"], r["color"], r["clarity"], bin_carat(r["carat"]))].append(r)

    comps = []
    for (shape, color, clarity, carat), recs in sorted(groups.items()):
        prices = [r["pricePerStone"] for r in recs]
        adjusted_prices = [r["sourceAdjustedPricePerStone"] for r in recs]
        hues = Counter(r["colorHue"] for r in recs)
        intensities = Counter(r["colorIntensity"] for r in recs)
        app_keys = Counter(r["appColorKey"] for r in recs if r.get("appColorKey"))
        app_key = app_keys.most_common(1)[0][0] if app_keys else None
        color_slug = (app_key or color or "fancy").replace(" ", "_").lower()
        comps.append({
            "productId": f"starsgem-color-{shape}-{color_slug}-{clarity}-{carat:.2f}",
            "priceUsd": round(median(prices), 2),
            "sourceAdjustedPriceUsd": round(median(adjusted_prices), 2),
            "carat": carat,
            "shape": shape,
            "clarity": clarity,
            "colorFamily": "fancy",
            "color": color,
            "colorHue": hues.most_common(1)[0][0],
            "colorIntensity": intensities.most_common(1)[0][0],
            "appColorKey": app_key,
            "confidence": "direct-anchor",
            "count": len(recs),
            "priceMin": min(prices),
            "priceMax": max(prices),
            "reportNos": sorted(r["reportNo"] for r in recs if r.get("reportNo"))[:8],
            "label": "StarGem Fancy Color Direct Quote",
            "supplier": "Wuzhou Starsgem Co., Ltd.",
            "section": f"{shape} {color} {clarity} — StarGem direct color quote",
            "url": STARGEM_URL,
            "sourceType": "direct-starsgem-color-quote",
            "sourceKey": "starsgem-color",
            "sourceFile": "user-supplied-color-quotes-2026-05-27",
            "sourceRows": sorted(r["sourceId"] for r in recs)[:8],
        })
    return comps


def main():
    records = build_records()
    igi_store = load_enrichment()
    igi_stats = apply_enrichment_to_records(records, igi_store)
    summary = build_summary(records)
    comps = build_comp_pool(records)

    index = {
        "supplier": "Wuzhou Starsgem Co., Ltd.",
        "location": "Guangxi, China",
        "sourceFile": "user-supplied-color-quotes-2026-05-27",
        "sourceDate": "2026-05-27",
        "generatedDate": str(date.today()),
        "purpose": "Tiny direct StarGem fancy-color quote anchor set; no Messi source adjustment applied",
        "filterApplied": "5 known quoted StarGem color stones",
        "igiEnrichment": {
            "storeFile": "igi-report-enrichment.json",
            **igi_stats,
        },
        "summary": summary,
        "records": records,
    }
    with OUTPUT_JSON.open("w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)
        f.write("\n")

    comp_out = {
        "supplier": "Wuzhou Starsgem Co., Ltd.",
        "sourceDate": "2026-05-27",
        "generatedDate": str(date.today()),
        "compCount": len(comps),
        "binSize": "0.05ct",
        "comps": comps,
    }
    with COMPS_JSON.open("w", encoding="utf-8") as f:
        json.dump(comp_out, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")

    print(f"StarGem color index -> {OUTPUT_JSON} ({len(records)} records)")
    print(f"StarGem color comps -> {COMPS_JSON} ({len(comps)} bins)")
    print(
        "IGI enrichment: "
        f"{igi_stats['rowsMatched']} report matches, "
        f"{igi_stats['rowsEnriched']} rows enriched, "
        f"{igi_stats['shapeReclassified']} shape reclassified"
    )


if __name__ == "__main__":
    main()
