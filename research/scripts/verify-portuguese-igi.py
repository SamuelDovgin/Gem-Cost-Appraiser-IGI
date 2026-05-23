#!/usr/bin/env python3
"""
Fetch public IGI PDFs for supplier round listings and reclassify only when the
certificate explicitly says Round Modified Brilliant / Portuguese.

Uses FDR/FRD/ID/LG slug prefixes (see igi_shape_cache.build_igi_pdf_candidates).
"""

from __future__ import annotations

import json
import sys
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from pathlib import Path
from statistics import median

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from igi_shape_cache import (  # noqa: E402
    CACHE_PATH,
    fetch_and_parse_report,
    load_cache,
    save_cache,
    slug_for_report,
)

DATA_DIR = SCRIPT_DIR.parent / "data"
STARSGEM_INDEX = DATA_DIR / "starsgem-index.json"
MESSI_INDEX = DATA_DIR / "messi-gems-index.json"
STARSGEM_COMPS = DATA_DIR / "starsgem-comps.json"


def expensive_round_candidates(records: list[dict], pct: float = 0.12, min_group: int = 8) -> list[dict]:
    rounds = [
        r
        for r in records
        if r.get("baseShape") == "round"
        and r.get("colorFamily") == "white"
        and (r.get("carat") or 0) >= 0.95
    ]
    groups: dict[tuple, list] = defaultdict(list)
    for r in rounds:
        bin_ct = round(round(r["carat"] / 0.05) * 0.05, 2)
        ppc = r.get("pricePerCarat")
        if ppc:
            groups[(r.get("color"), r.get("clarity"), bin_ct)].append((ppc, r))
    out = []
    for items in groups.values():
        if len(items) < min_group:
            continue
        med = median([x[0] for x in items])
        for ppc, r in items:
            if ppc > med * (1 + pct):
                out.append(r)
    return out


def purge_stale_cache(cache: dict) -> int:
    """Re-fetch prior not_found rows (wrong slug order before FDR fix)."""
    stale = [k for k, v in cache.items() if v.get("status") == "not_found"]
    for k in stale:
        del cache[k]
    return len(stale)


def verify_reports(report_nos: list[str], cache: dict, workers: int = 8) -> dict:
    unique_digits = sorted({slug_for_report(r) for r in report_nos if r})
    todo = [d for d in unique_digits if d not in cache]
    print(f"  IGI lookups: {len(todo)} new ({len(unique_digits)} unique, cache {len(cache)})")
    done = 0

    def work(digits: str) -> tuple[str, dict]:
        # Reconstruct minimal report_no for candidate builder
        return digits, fetch_and_parse_report(digits)

    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(work, d): d for d in todo}
        for fut in as_completed(futs):
            digits, entry = fut.result()
            cache[digits] = entry
            done += 1
            if done % 100 == 0:
                save_cache(cache)
                ok = sum(1 for v in cache.values() if v.get("status") == "ok")
                pt = sum(1 for v in cache.values() if v.get("isPortuguese"))
                print(f"    …{done}/{len(todo)} (ok={ok}, portuguese={pt})")
            time.sleep(0.02)
    save_cache(cache)
    return cache


def apply_labels(index_path: Path, cache: dict) -> tuple[int, int]:
    with index_path.open(encoding="utf-8") as f:
        data = json.load(f)
    records = data["records"]
    changed = 0
    confirmed_pt = 0
    for r in records:
        if r.get("baseShape") != "round":
            continue
        rn = r.get("reportNo")
        if not rn:
            continue
        hit = cache.get(slug_for_report(rn))
        if not hit or hit.get("status") != "ok":
            continue
        r["igiShapeRaw"] = hit.get("shapeRaw")
        r["igiPdfSlug"] = hit.get("pdfSlug")
        r["igiVerified"] = True
        if hit.get("isPortuguese"):
            if r.get("shape") != "portuguese":
                r["reclassifiedFrom"] = r.get("shape") or "round"
                changed += 1
            r["shape"] = "portuguese"
            r["baseShape"] = "portuguese"
            r["subVariant"] = None
            r["subVariantLabel"] = "Portuguese / Round Modified (IGI verified)"
            confirmed_pt += 1
        elif hit.get("isRoundBrilliant"):
            r["igiConfirmedRound"] = True
    data["portugueseReclassified"] = changed
    data["igiPortugueseVerifiedCount"] = confirmed_pt
    data["igiShapeScan"] = {
        "cacheFile": CACHE_PATH.name,
        "cacheSlugs": len(cache),
        "pdfsOk": sum(1 for v in cache.values() if v.get("status") == "ok"),
        "portugueseConfirmed": confirmed_pt,
    }
    with index_path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    return changed, confirmed_pt


def _load_analyze_module(filename: str):
    import importlib.util

    path = SCRIPT_DIR / filename
    spec = importlib.util.spec_from_file_location(path.stem, path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(mod)
    return mod


def rebuild_comps(index_path: Path, comps_path: Path, analyze_file: str, comp_meta: dict) -> None:
    mod = _load_analyze_module(analyze_file)
    with index_path.open(encoding="utf-8") as f:
        data = json.load(f)
    comps = mod.build_comp_pool(data["records"])
    out = {**comp_meta, "generatedDate": str(date.today()), "compCount": len(comps), "comps": comps}
    with comps_path.open("w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"  wrote {comps_path.name}: {len(comps)} comp rows")


def main() -> None:
    cache = load_cache()
    purged = purge_stale_cache(cache)
    print(f"Purged {purged} stale not_found cache entries (retry with FDR slugs)")

    for name, index_path in [("starsgem", STARSGEM_INDEX), ("messi", MESSI_INDEX)]:
        print(f"\n=== {name} ===")
        with index_path.open(encoding="utf-8") as f:
            records = json.load(f)["records"]
        candidates = expensive_round_candidates(records)
        print(f"  expensive round candidates: {len(candidates)}")
        report_nos = [r["reportNo"] for r in candidates if r.get("reportNo")]
        verify_reports(report_nos, cache)

        if name == "starsgem":
            all_rounds = [
                r["reportNo"]
                for r in records
                if r.get("baseShape") == "round" and r.get("reportNo")
            ]
            verify_reports(all_rounds, cache)

        changed, pt = apply_labels(index_path, cache)
        ok = sum(1 for v in cache.values() if v.get("status") == "ok")
        print(f"  cache ok PDFs: {ok}, reclassified → portuguese: {changed}")

    save_cache(cache)
    print("\n=== rebuild comps ===")
    rebuild_comps(
        STARSGEM_INDEX,
        STARSGEM_COMPS,
        "analyze-starsgem.py",
        {
            "supplier": "Wuzhou Starsgem Co., Ltd.",
            "sourceDate": "2026-05-20",
            "binSize": "0.05ct",
        },
    )
    print(f"\nCache: {CACHE_PATH}")


if __name__ == "__main__":
    main()
