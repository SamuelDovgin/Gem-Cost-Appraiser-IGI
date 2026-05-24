#!/usr/bin/env python3
"""Build file:// assets: comp-engine IIFE bundle + JSON browser-data shims."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "research" / "data"

FILES = {
    "alibaba-comps-index.json": "__GEM_ALIBABA_COMPS_INDEX__",
    "messi-comps.json": "__GEM_MESSI_COMPS__",
    "starsgem-comps.json": "__GEM_STARSGEM_COMPS__",
    "messi-color-comps.json": "__GEM_MESSI_COLOR_COMPS__",
}

ENRICHMENT_PATH = DATA / "igi-report-enrichment.json"
DICE_VERIFIED_PATH = DATA / "igi-dice-verified.json"


def build_engine_bundle() -> None:
    out = ROOT / "research" / "comp-engine-v3.browser.js"
    cmd = [
        "npx",
        "--yes",
        "esbuild",
        str(ROOT / "research" / "comp-engine-v3.js"),
        "--bundle",
        "--platform=browser",
        "--format=iife",
        "--global-name=GemAppraiseV3Engine",
        "--define:process=undefined",
        f"--outfile={out}",
    ]
    subprocess.run(cmd, check=True, cwd=ROOT)
    print(f"wrote {out.name} ({out.stat().st_size // 1024} KiB)")


def build_igi_dice_verified() -> None:
    if not ENRICHMENT_PATH.exists():
        raise SystemExit(f"Missing {ENRICHMENT_PATH}")
    store = json.loads(ENRICHMENT_PATH.read_text(encoding="utf-8"))
    stones: list[dict] = []
    for key, entry in store.items():
        if entry.get("status") != "ok":
            continue
        if not entry.get("enrichmentComplete"):
            continue
        slug = entry.get("pdfSlug")
        if not slug:
            continue
        digits = "".join(ch for ch in str(key) if ch.isdigit())
        if len(digits) < 6:
            digits = "".join(ch for ch in str(entry.get("reportNumber") or "") if ch.isdigit())
        if len(digits) < 6:
            continue
        carat = entry.get("carat")
        clarity = entry.get("clarity")
        if carat is None or not clarity:
            continue
        family = entry.get("colorFamilyFromCert") or "white"
        short: dict = {
            "d": digits,
            "p": slug,
            "c": round(float(carat), 2),
            "cl": str(clarity).upper(),
            "f": "c" if family == "fancy" else "w",
        }
        shape = entry.get("shapeMapped")
        if shape:
            short["sh"] = shape
        color = entry.get("color") or entry.get("colorRaw")
        if color:
            short["co"] = str(color).strip()
        cut = entry.get("cut")
        if cut:
            short["cu"] = str(cut).strip()
        growth = entry.get("growthMethod")
        if growth:
            short["gm"] = str(growth).strip()
        stones.append(short)

    payload = {
        "generatedFrom": ENRICHMENT_PATH.name,
        "stoneCount": len(stones),
        "stones": stones,
    }
    DICE_VERIFIED_PATH.write_text(
        json.dumps(payload, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"wrote {DICE_VERIFIED_PATH.name} ({DICE_VERIFIED_PATH.stat().st_size // 1024} KiB, {len(stones)} stones)")


def main() -> None:
    build_engine_bundle()
    build_igi_dice_verified()
    for filename, global_name in FILES.items():
        src = DATA / filename
        if not src.exists():
            raise SystemExit(f"Missing {src}")
        payload = json.loads(src.read_text(encoding="utf-8"))
        out = DATA / filename.replace(".json", ".browser-data.js")
        out.write_text(
            f"window.{global_name} = {json.dumps(payload, separators=(',', ':'))};\n",
            encoding="utf-8",
        )
        print(f"wrote {out.name} ({out.stat().st_size // 1024} KiB)")


if __name__ == "__main__":
    main()
