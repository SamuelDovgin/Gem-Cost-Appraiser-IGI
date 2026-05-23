#!/usr/bin/env python3
"""
Rate-limited full IGI enrichment for all supplier report numbers.

  python3 research/scripts/igi-enrich-all.py --limit 120 --delay 0.35 --workers 4
  python3 research/scripts/igi-enrich-all.py --run-all --delay 0.35 --workers 4
  # --limit is batch size per loop (not a total cap). Use 0 = entire queue per batch.
  python3 research/scripts/igi-enrich-all.py --run-all --limit 0 --delay 0.35 --workers 4
  python3 research/scripts/igi-enrich-all.py --apply-only

Updates:
  research/data/igi-report-enrichment.json
  research/data/starsgem-index.json
  research/data/messi-gems-index.json
  research/igi-enrichment-progress.md
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
RESEARCH_DIR = SCRIPT_DIR.parent
sys.path.insert(0, str(SCRIPT_DIR))

from igi_enrichment import (  # noqa: E402
    ENRICHMENT_PATH,
    MESSI_INDEX,
    STARSGEM_INDEX,
    all_report_digits_from_indexes,
    apply_enrichment_to_index,
    fetch_full_report,
    load_enrichment,
    needs_enrichment,
    save_enrichment,
)
from igi_report_parser import enrichment_completeness  # noqa: E402


def write_progress_doc(store: dict) -> None:
    by_supplier = all_report_digits_from_indexes()
    all_ids = by_supplier["starsgem"] | by_supplier["messi"]
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    def stat(ids: set[str]) -> dict:
        c = Counter()
        for d in ids:
            e = store.get(d)
            if e is None:
                c["not_started"] += 1
            else:
                c[e.get("status", "?")] += 1
        ok = [store[d] for d in ids if store.get(d, {}).get("status") == "ok"]
        complete = sum(1 for e in ok if e.get("enrichmentComplete"))
        shapes = Counter(e.get("shapeMapped") for e in ok if e.get("shapeMapped"))
        return {"counts": c, "shapes": shapes.most_common(15), "complete": complete}

    sg_s, ms_s, all_s = stat(by_supplier["starsgem"]), stat(by_supplier["messi"]), stat(all_ids)
    pt = [
        (d, store[d])
        for d in sorted(all_ids)
        if store.get(d, {}).get("shapeMapped") == "portuguese"
        or store.get(d, {}).get("isPortuguese")
    ]

    lines = [
        "# IGI full enrichment progress",
        "",
        f"_Updated: **{now}** — `python3 research/scripts/igi-enrich-all.py`_",
        "",
        "Machine store: `research/data/igi-report-enrichment.json`",
        "",
        "Each **complete** OK entry includes: shape (raw + mapped), measurements, L/W,",
        "4Cs, cut/polish/symmetry, fluorescence, table/depth %, girdle/culet, inscription,",
        "report date, Type IIa, growth method, treatment, comments.",
        "",
        "## Summary",
        "",
        "| Scope | Reports | not_started | ok | complete | not_found | rate_limited |",
        "|-------|---------|-------------|-----|----------|-----------|--------------|",
    ]
    for label, st in [("Starsgem", sg_s), ("Messi", ms_s), ("**Total**", all_s)]:
        c = st["counts"]
        lines.append(
            f"| {label} | {sum(c.values())} | {c.get('not_started',0)} | "
            f"{c.get('ok',0)} | {st['complete']} | {c.get('not_found',0)} | "
            f"{c.get('rate_limited',0)} |"
        )
    lines += [
        "",
        f"**Portuguese on cert:** {len(pt)}"
        + ("".join(f"\n- `{d}` — {e.get('shapeRaw')}" for d, e in pt) if pt else " — _none yet_"),
        "",
        "## Top IGI shapeMapped (ok PDFs)",
        "",
    ]
    for label, st in [("All", all_s)]:
        lines.append(f"### {label}")
        for shape, n in st["shapes"]:
            lines.append(f"- `{shape}`: {n}")
        lines.append("")

    lines += [
        "## Commands",
        "",
        "```bash",
        "python3 research/scripts/igi-enrich-all.py --run-all --limit 200 --delay 0.35 --workers 4",
        "# --limit = batch size per loop (not total). --run-all loops until done. --limit 0 = no cap.",
        "python3 research/scripts/igi-enrich-all.py --apply-only",
        "```",
        "",
        "Speed: **FDR-first** (3 slug tries max), **4 workers** with ~0.35s stagger.",
        "Stop if 5× 429 in a row; resume later. Use `--full-retry` for bare-digit slugs on not_found.",
        "",
    ]
    (RESEARCH_DIR / "igi-enrichment-progress.md").write_text("\n".join(lines), encoding="utf-8")


def build_queue(
    store: dict,
    supplier: str,
    status: str,
    *,
    include_complete_not_found: bool = False,
) -> list[str]:
    by = all_report_digits_from_indexes()
    if supplier == "starsgem":
        pool = by["starsgem"]
    elif supplier == "messi":
        pool = by["messi"]
    else:
        pool = by["starsgem"] | by["messi"]

    incomplete: list[str] = []
    rate_limited: list[str] = []
    not_started: list[str] = []
    not_found_retry: list[str] = []

    for d in pool:
        e = store.get(d)
        if status == "rate_limited":
            if e and e.get("status") == "rate_limited":
                rate_limited.append(d)
            continue
        if status != "pending":
            continue
        if (
            not needs_enrichment(e)
            and not (
                include_complete_not_found
                and e
                and e.get("status") == "not_found"
                and e.get("lookupComplete")
            )
        ):
            continue
        if e is None:
            not_started.append(d)
        elif e.get("status") == "ok":
            incomplete.append(d)
        elif e.get("status") == "rate_limited":
            rate_limited.append(d)
        elif e.get("status") == "not_found":
            not_found_retry.append(d)

    return (
        sorted(incomplete)
        + sorted(rate_limited)
        + sorted(not_started)
        + sorted(not_found_retry)
    )


def fetch_one(
    digits: str,
    prev: dict,
    *,
    full_retry: bool,
) -> tuple[str, dict]:
    known = prev.get("pdfSlug") if prev.get("status") == "ok" else None
    entry = fetch_full_report(
        digits,
        delay_between_slugs=0.12,
        known_slug=known,
        fast=not full_retry,
        full_retry=full_retry,
    )
    if entry.get("status") == "ok":
        entry.pop("partial", None)
    return digits, entry


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--supplier", choices=("all", "starsgem", "messi"), default="all")
    ap.add_argument("--status", choices=("pending", "rate_limited"), default="pending")
    ap.add_argument(
        "--limit",
        type=int,
        default=120,
        help="Reports per batch (default 120). With --run-all, loops until queue empty. "
        "Use 0 for no batch cap (process full queue each loop).",
    )
    ap.add_argument("--delay", type=float, default=0.35, help="Stagger between worker starts")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--apply-every", type=int, default=2, help="Apply indexes every N batches")
    ap.add_argument("--run-all", action="store_true")
    ap.add_argument("--apply-only", action="store_true")
    ap.add_argument("--no-apply", action="store_true")
    ap.add_argument(
        "--full-retry",
        action="store_true",
        help="Use all slug variants (for not_found retries)",
    )
    args = ap.parse_args()

    store = load_enrichment()

    if args.apply_only:
        print("Applying enrichment to indexes…")
        print("  starsgem:", apply_enrichment_to_index(STARSGEM_INDEX, store))
        print("  messi:", apply_enrichment_to_index(MESSI_INDEX, store))
        write_progress_doc(store)
        return

    rl_streak = 0
    batch_num = 0

    while True:
        queue = build_queue(
            store,
            args.supplier,
            args.status,
            include_complete_not_found=args.full_retry,
        )
        if args.limit > 0:
            queue = queue[: args.limit]
        if not queue:
            print("Queue empty for this status/supplier.")
            break

        batch_num += 1
        print(
            f"Batch {batch_num}: {len(queue)} reports "
            f"(workers={args.workers}, stagger={args.delay}s)…"
        )

        full_retry = args.full_retry
        results: list[tuple[str, dict]] = []

        with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
            futures = []
            for i, digits in enumerate(queue):
                prev = store.get(digits) or {}
                use_full = full_retry or (
                    prev.get("status") == "not_found" and prev.get("lookupComplete")
                )
                futures.append(
                    pool.submit(
                        fetch_one,
                        digits,
                        prev,
                        full_retry=use_full,
                    )
                )
                if args.delay > 0 and i + 1 < len(queue):
                    time.sleep(args.delay)

            for fut in as_completed(futures):
                digits, entry = fut.result()
                store[digits] = entry
                results.append((digits, entry))

                if entry.get("status") == "ok":
                    rl_streak = 0
                    sm = entry.get("shapeMapped")
                    if sm == "portuguese" or (
                        entry.get("shapeRaw")
                        and "modified" in entry.get("shapeRaw", "").lower()
                    ):
                        print(
                            f"  {digits} {entry.get('shapeRaw')} → {sm} "
                            f"({entry.get('pdfSlug')})"
                        )
                elif entry.get("status") == "rate_limited":
                    rl_streak += 1

        save_enrichment(store)
        ok = sum(1 for v in store.values() if v.get("status") == "ok")
        complete = sum(
            1
            for v in store.values()
            if v.get("status") == "ok" and v.get("enrichmentComplete")
        )
        print(f"  saved — store ok={ok}, complete={complete}")

        if rl_streak >= 5:
            print("Stopping: 5× rate_limited in batch.")
            break

        if not args.no_apply and batch_num % max(1, args.apply_every) == 0:
            apply_enrichment_to_index(STARSGEM_INDEX, store)
            apply_enrichment_to_index(MESSI_INDEX, store)

        write_progress_doc(store)
        if not args.run_all:
            break
        print("--- next batch ---")

    if not args.no_apply:
        apply_enrichment_to_index(STARSGEM_INDEX, store)
        apply_enrichment_to_index(MESSI_INDEX, store)

    pending = len(build_queue(store, "all", "pending"))
    ok = sum(1 for v in store.values() if v.get("status") == "ok")
    complete = sum(
        1 for v in store.values() if v.get("status") == "ok" and enrichment_completeness(v)["complete"]
    )
    print(f"Store: {ENRICHMENT_PATH} ({len(store)} keys, {ok} ok, {complete} complete, {pending} pending)")
    write_progress_doc(store)


if __name__ == "__main__":
    main()
