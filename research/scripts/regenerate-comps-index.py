#!/usr/bin/env python3
"""Rebuild research/data/alibaba-comps-index.json from alibaba-clean-source-of-truth.md."""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOT = ROOT / "research" / "alibaba-clean-source-of-truth.md"
OUT = ROOT / "research" / "data" / "alibaba-comps-index.json"

# Primary ladder product IDs whose sections lack a Confidence column — these are
# the best-evidence rows and should be tagged "high" rather than left null.
HIGH_CONFIDENCE_PIDS = {
    "1600612782670",  # Messi round primary
    "1601228209966",  # Round corroborating
    "1601269837335",  # Starsgem round
    "1601715356045",  # Messi radiant primary (multi-shape)
    "1601257609041",  # Radiant E/F corroboration
    "1601348731065",  # Messi pear primary
    "1601326262607",  # Starsgem pear
    "1601628467240",  # Messi oval primary
    "1601628853707",  # Messi oval corroboration
    "1601407133783",  # Mishang oval
    "1601392715631",  # Starsgem oval
    "1601296278910",  # Starsgem D/E oval
    "1601742375662",  # Starsgem VVS2 oval
    "1601645396114",  # Goldleaf emerald primary
    "1601414377217",  # Mishang emerald corroboration
    "1601360989867",  # Mishang emerald
    "1601718421551",  # Mishang emerald 1.5-3ct
    "1601766186855",  # Messi cushion primary
    "10000014195390", # Mishang cushion 1ct
    "1601412225431",  # Mishang cushion 1ct
    "1601764885212",  # Messi princess primary
    "10000014190420", # Princess corroboration 1ct
    "1601719451540",  # Messi asscher primary
    "10000014259785", # Mishang asscher 1ct
    "1601406519145",  # Mishang marquise primary
    "1601645026580",  # Marquise corroboration (duplicate ladder)
    "1601744111777",  # Marquise D VVS2
    "1601384099752",  # Marquise DE
    "10000038791251", # Vivid pink heart
    "10000040044944",  # Shreeraj Portuguese primary
    "1601570156930",  # Mishang Portuguese 2ct+
    "11000034653073",  # Pink cushion VS1 ladder
}


def parse_float(value: str):
    value = value.strip().replace("$", "").replace(",", "")
    if value in ("-", ""):
        return None
    try:
        return float(value)
    except ValueError:
        return None


def parse_carat(carat_raw: str):
    """Return (carat, carat_min, carat_max, is_band).
    carat is the representative value (min of band or exact).
    """
    s = carat_raw.strip().replace("CT", "").replace("ct", "").strip()
    # Band: "1.0-1.1" or "1.5-1.59"
    band = re.match(r"([\d.]+)\s*[-–]\s*([\d.]+)", s)
    if band:
        lo, hi = float(band.group(1)), float(band.group(2))
        return lo, lo, hi, True
    # mm+carat: "3.5x7mm / 0.3" — take the carat after the slash
    slash = re.search(r"/\s*([\d.]+)", s)
    if slash:
        ct = float(slash.group(1))
        return ct, ct, ct, False
    # Plain number
    num = re.search(r"([\d.]+)", s)
    if num:
        ct = float(num.group(1))
        return ct, ct, ct, False
    return None, None, None, False


def normalize_white_color(color_str):
    """Collapse free-text white color to a canonical enum string."""
    if not color_str:
        return "D"   # unlabeled white ladders default to D
    c = color_str.strip().upper().replace("COLOR", "").replace("WHITE", "").strip()
    if c.startswith("DEF"):
        return "DEF"
    if c.startswith("DE"):
        return "DE"
    if c == "D":
        return "D"
    if c == "E":
        return "E"
    if c == "F":
        return "F"
    return c or "D"


def infer_fancy_color_from_title(title: str):
    """Extract a canonical fancy color label from the section title."""
    tl = title.lower()
    for phrase in [
        "fancy vivid pink", "fancy intense pink", "fancy light pink",
        "fancy vivid yellow", "fancy intense yellow", "fancy light yellow",
        "fancy vivid blue", "fancy intense blue", "fancy light blue",
        "fancy intense green", "fancy vivid green",
        "fancy red", "fancy blue", "fancy pink", "fancy yellow", "fancy green",
    ]:
        if phrase in tl:
            return phrase.title()
    if "pink" in tl:
        return "Fancy Pink"
    if "yellow" in tl:
        return "Fancy Yellow"
    if "blue" in tl:
        return "Fancy Blue"
    return None


def confidence_for_row(raw_conf_cell: str, pid: str):
    """Return confidence string: prefer table cell, fall back to pid whitelist."""
    if raw_conf_cell:
        word = raw_conf_cell.strip().split()[0].lower()
        if word in ("high", "medium-high", "medium", "low-medium", "low"):
            return word
    if pid and pid in HIGH_CONFIDENCE_PIDS:
        return "high"
    return None


def main():
    sot = SOT.read_text()
    clean_part = sot.split("## Clean But Broad")[0]

    # Build pid → canonical URL map from the entire document
    url_by_pid = {}
    for m in re.finditer(
        r"https://www\.alibaba\.com/product-detail/[^`\s\)]+_(\d+)\.html", sot
    ):
        url_by_pid[m.group(1)] = m.group(0).split("?")[0]

    sections = re.split(r"\n(?=### )", clean_part.split("## Clean Exact Comps")[1])
    comps = []

    shape_map = {
        "Elongated Cushion": "elongated_cushion",  # must come before Cushion
        "Portuguese": "portuguese",  # must come before Round (substring match)
        "Moval": "moval",  # must come before Oval (substring match)
        "Round": "round",
        "Pear": "pear",
        "Oval": "oval",
        "Radiant": "radiant",
        "Marquise": "marquise",
        "Emerald": "emerald",
        "Cushion": "cushion",
        "Princess": "princess",
        "Asscher": "asscher",
        "Heart": "heart",
    }

    for section in sections:
        if not section.strip().startswith("###"):
            continue

        title = section.split("\n")[0].replace("### ", "").strip()
        sec_pids = re.findall(r"Product ID[s]?:\s*`?(\d{10,})`?", section)
        sec_urls = re.findall(r"URL[s]?:\s*`?(https://[^`\n]+)`?", section)
        default_pid = sec_pids[0] if len(sec_pids) == 1 else None
        default_url = sec_urls[0].split("?")[0] if len(sec_urls) == 1 else None

        is_fancy = bool(re.search(
            r"Fancy|Pink|Yellow|Blue|Green|Red|Vivid|Intense|Brownish", title, re.I
        ))
        color_family = "fancy" if is_fancy else "white"
        section_fancy_color = infer_fancy_color_from_title(title) if is_fancy else None

        section_shape = "unknown"
        for key, val in shape_map.items():
            if key.lower() in title.lower():
                section_shape = val
                break

        lines = section.splitlines()
        idx = 0
        while idx < len(lines):
            line = lines[idx]
            # Detect markdown table header
            if (
                line.startswith("|")
                and "---" not in line
                and idx + 1 < len(lines)
                and "---" in lines[idx + 1]
            ):
                header = [c.strip() for c in line.strip("|").split("|")]
                idx += 2
                while idx < len(lines) and lines[idx].startswith("|") and "---" not in lines[idx]:
                    cells = [c.strip() for c in lines[idx].strip("|").split("|")]
                    if len(cells) != len(header):
                        idx += 1
                        continue
                    row_map = dict(zip(header, cells))

                    # Product ID + URL
                    pid_m = re.search(r"`?(\d{10,})`?", row_map.get("Product ID", ""))
                    pid = pid_m.group(1) if pid_m else default_pid
                    url = url_by_pid.get(pid) if pid else default_url
                    if not url and pid:
                        url = f"https://www.alibaba.com/product-detail/_{pid}.html"

                    # Carat
                    carat_raw = (
                        row_map.get("Carat")
                        or row_map.get("Carat/Band")
                        or row_map.get("Size")
                        or ""
                    )
                    carat, carat_min, carat_max, is_band = parse_carat(carat_raw)
                    if carat is None:
                        idx += 1
                        continue

                    # Confidence
                    conf = confidence_for_row(row_map.get("Confidence", ""), pid)

                    # Color
                    color_val = (
                        row_map.get("Fancy Color")
                        or row_map.get("Color")
                        or section_fancy_color
                        or None
                    )
                    color_normalized = (
                        normalize_white_color(color_val)
                        if color_family == "white"
                        else None
                    )

                    # Shape (row-level overrides section-level for multi-shape tables)
                    row_shape = section_shape
                    if row_map.get("Shape"):
                        rs = row_map["Shape"].strip().lower().replace(" ", "_")
                        if "portuguese" in rs:
                            row_shape = "portuguese"
                        elif rs:
                            row_shape = rs

                    # Emit one row per split-clarity column (VS2/VS1/VVS2/VVS1/VVS-VS)
                    for clarity in ("VS2", "VS1", "VVS2", "VVS1", "VVS-VS"):
                        if clarity not in row_map:
                            continue
                        price = parse_float(row_map[clarity])
                        if price is None:
                            continue
                        comps.append({
                            "section": title,
                            "productId": pid,
                            "url": url,
                            "colorFamily": color_family,
                            "shape": row_shape,
                            "color": color_val,
                            "colorNormalized": color_normalized,
                            "clarity": clarity,
                            "clarityBand": clarity == "VVS-VS",
                            "carat": carat,
                            "caratMin": carat_min,
                            "caratMax": carat_max,
                            "caratBand": is_band,
                            "priceUsd": price,
                            "priceUnit": "piece",
                            "confidence": conf,
                        })

                    # Emit single-price rows (fancy mixed-shape tables use a Price column)
                    if "Price" in row_map:
                        price = parse_float(row_map["Price"])
                        clarity_val = row_map.get("Clarity")
                        if price is not None:
                            comps.append({
                                "section": title,
                                "productId": pid,
                                "url": url,
                                "colorFamily": color_family,
                                "shape": row_shape,
                                "color": color_val,
                                "colorNormalized": color_normalized,
                                "clarity": clarity_val,
                                "clarityBand": False,
                                "carat": carat,
                                "caratMin": carat_min,
                                "caratMax": carat_max,
                                "caratBand": is_band,
                                "priceUsd": price,
                                "priceUnit": "piece",
                                "confidence": conf,
                            })

                    idx += 1
                continue
            idx += 1

    # Deduplicate
    seen: set = set()
    unique = []
    for comp in comps:
        key = (
            comp["productId"],
            comp["shape"],
            comp["color"],
            comp["clarity"],
            comp["carat"],
            comp["priceUsd"],
        )
        if key in seen:
            continue
        seen.add(key)
        unique.append(comp)

    payload = {
        "generatedFrom": "research/alibaba-clean-source-of-truth.md",
        "indexVersion": "2026-05-21",
        "purpose": "Machine-readable comp rows for stone search → closest Alibaba listing + price.",
        "modifierDocs": {
            "whiteColor": "index.html whiteGradeMult vs E",
            "whiteClarity": "index.html clarityBreakpoints vs VS1 at carat",
            "shapeWhite": "index.html shapeMult vs round",
            "shapeFancy": "index.html shapeMultColor vs round",
            "fancyIntensity": "index.html fancyColorBase ws1 curves",
        },
        "rowCount": len(unique),
        "comps": unique,
    }

    OUT.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"Wrote {len(unique)} comps to {OUT}")

    # Quick sanity report
    null_conf = sum(1 for c in unique if not c["confidence"])
    null_color_fancy = sum(1 for c in unique if c["colorFamily"] == "fancy" and not c["color"])
    band_rows = sum(1 for c in unique if c["caratBand"])
    print(f"  null confidence: {null_conf}  null fancy color: {null_color_fancy}  band rows: {band_rows}")


if __name__ == "__main__":
    main()
