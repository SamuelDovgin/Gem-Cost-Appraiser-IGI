#!/usr/bin/env python3
"""
Rate-limited IGI PDF verification. Safe to stop and resume.

Updates research/data/igi-shape-cache.json and regenerates the progress doc.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

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


def round_reports(supplier: str) -> list[str]:
    path = STARSGEM_INDEX if supplier == "starsgem" else MESSI_INDEX
    with path.open(encoding="utf-8") as f:
        records = json.load(f)["records"]
    digits = []
    for r in records:
        raw = (r.get("rawShapeCode") or "").strip().upper()
        if supplier == "starsgem":
            in_scope = raw == "ROUND" or r.get("baseShape") == "round"
        else:
            in_scope = raw in ("RD", "ROUND") or r.get("baseShape") == "round"
        if not in_scope or not r.get("reportNo"):
            continue
        digits.append(slug_for_report(r["reportNo"]))
    return sorted(set(digits))


def pick_queue(
    cache: dict,
    supplier: str,
    status_filter: str,
    force: bool,
) -> list[str]:
    if supplier == "starsgem":
        pool = round_reports("starsgem")
    elif supplier == "messi":
        pool = round_reports("messi")
    else:
        pool = sorted(set(round_reports("starsgem")) | set(round_reports("messi")))

    out = []
    for d in pool:
        entry = cache.get(d)
        if status_filter == "not_started":
            if entry is None:
                out.append(d)
            continue
        if not entry:
            continue
        st = entry.get("status")
        if status_filter == "not_found":
            if st == "not_found" and not entry.get("lookupComplete"):
                out.append(d)
            elif force and st == "not_found":
                out.append(d)
        elif status_filter == "rate_limited":
            if st == "rate_limited":
                out.append(d)
        elif status_filter == "all_pending":
            if st in (None,) or st in ("rate_limited",) or (
                st == "not_found" and not entry.get("lookupComplete")
            ):
                out.append(d)
            elif entry is None:
                out.append(d)
    if status_filter == "not_started":
        return out
    return out


def regenerate_doc() -> None:
    import generate_igi_progress_doc

    generate_igi_progress_doc.main()


def main() -> None:
    ap = argparse.ArgumentParser(description="Slow IGI PDF verification (resume-safe)")
    ap.add_argument("--supplier", choices=("starsgem", "messi", "all"), default="all")
    ap.add_argument(
        "--status",
        choices=("not_started", "not_found", "rate_limited", "all_pending"),
        default="not_started",
        help="Which queue to process (default: not_started)",
    )
    ap.add_argument("--limit", type=int, default=50, help="Max reports this run")
    ap.add_argument(
        "--delay",
        type=float,
        default=1.2,
        help="Seconds between report lookups (default 1.2)",
    )
    ap.add_argument("--force", action="store_true", help="Re-fetch not_found_final rows")
    ap.add_argument("--no-doc", action="store_true", help="Skip progress markdown regen")
    args = ap.parse_args()

    cache = load_cache()
    queue = pick_queue(cache, args.supplier, args.status, args.force)[: args.limit]
    print(
        f"IGI slow verify: supplier={args.supplier} status={args.status} "
        f"batch={len(queue)} delay={args.delay}s"
    )
    if not queue:
        print("Nothing to do.")
        if not args.no_doc:
            regenerate_doc()
        return

    ok = pt = rl = 0
    for i, digits in enumerate(queue, 1):
        entry = fetch_and_parse_report(digits, delay_between_slugs=0.25)
        cache[digits] = entry
        st = entry.get("status")
        if st == "ok":
            ok += 1
            if entry.get("isPortuguese"):
                pt += 1
                print(
                    f"  [{i}/{len(queue)}] PORTUGUESE {digits} "
                    f"{entry.get('shapeRaw')} ({entry.get('pdfSlug')})"
                )
        elif st == "rate_limited":
            rl += 1
            print(f"  [{i}/{len(queue)}] 429 rate_limited {digits} — consider stopping")
        save_cache(cache)
        if i % 10 == 0:
            print(f"  …{i}/{len(queue)} ok={ok} portuguese={pt} rate_limited={rl}")
        if st == "rate_limited" and rl >= 3:
            print("Stopping early: multiple 429s in one batch.")
            break
        time.sleep(args.delay)

    save_cache(cache)
    print(f"Batch done. ok={ok} portuguese={pt} rate_limited={rl} cache={CACHE_PATH}")
    if not args.no_doc:
        regenerate_doc()


if __name__ == "__main__":
    main()
