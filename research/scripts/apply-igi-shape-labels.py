#!/usr/bin/env python3
"""Apply igi-shape-cache.json to starsgem + messi indexes (portuguese only when IGI says so)."""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from igi_shape_cache import apply_igi_shape_cache, load_cache  # noqa: E402

DATA_DIR = SCRIPT_DIR.parent / "data"


def main() -> None:
    cache = load_cache()
    for name in ("starsgem-index.json", "messi-gems-index.json"):
        path = DATA_DIR / name
        with path.open(encoding="utf-8") as f:
            data = json.load(f)
        n = apply_igi_shape_cache(data["records"], cache)
        data["igiShapeScan"] = {
            "cacheFile": "igi-shape-cache.json",
            "cacheSlugs": len(cache),
            "pdfsOk": sum(1 for v in cache.values() if v.get("status") == "ok"),
            "portugueseConfirmed": sum(1 for v in cache.values() if v.get("isPortuguese")),
            "labelsApplied": str(date.today()),
        }
        with path.open("w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
            f.write("\n")
        pt = sum(1 for r in data["records"] if r.get("shape") == "portuguese")
        print(f"{name}: reclassified {n}, portuguese rows {pt}")


if __name__ == "__main__":
    main()
