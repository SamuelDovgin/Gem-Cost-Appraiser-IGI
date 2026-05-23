#!/usr/bin/env python3
"""Regenerate research/igi-shape-verification-progress.md from cache + supplier indexes."""

from __future__ import annotations

import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
RESEARCH_DIR = SCRIPT_DIR.parent
DATA_DIR = RESEARCH_DIR / "data"
CACHE_PATH = DATA_DIR / "igi-shape-cache.json"
OUT_PATH = RESEARCH_DIR / "igi-shape-verification-progress.md"

STARSGEM_INDEX = DATA_DIR / "starsgem-index.json"
MESSI_INDEX = DATA_DIR / "messi-gems-index.json"


def slug_for_report(report_no: str) -> str:
    return re.sub(r"\D", "", str(report_no))


def round_report_set(index_path: Path) -> set[str]:
    """Supplier ROUND rows (rawShapeCode), including stones later labeled portuguese."""
    with index_path.open(encoding="utf-8") as f:
        data = json.load(f)
    out = set()
    for r in data.get("records", []):
        raw = (r.get("rawShapeCode") or "").strip().upper()
        if raw not in ("ROUND", "RD") and r.get("baseShape") != "round":
            if r.get("shape") not in ("round", "portuguese") or not r.get("reclassifiedFrom"):
                continue
        if not r.get("reportNo"):
            continue
        out.add(slug_for_report(r["reportNo"]))
    return out


def load_cache() -> dict:
    if not CACHE_PATH.exists():
        return {}
    with CACHE_PATH.open(encoding="utf-8") as f:
        return json.load(f)


def status_bucket(entry: dict | None) -> str:
    if not entry:
        return "not_started"
    st = entry.get("status") or "unknown"
    if st == "ok":
        return "ok"
    if st == "rate_limited":
        return "rate_limited"
    if st == "not_found" and entry.get("lookupComplete"):
        return "not_found_final"
    if st == "not_found":
        return "not_found_maybe_retry"
    return st


def format_report_line(digits: str, entry: dict | None, supplier: str) -> str:
    if not entry:
        return f"| `{digits}` | {supplier} | not_started | — | — | — |"
    st = status_bucket(entry)
    shape = entry.get("shapeRaw") or "—"
    slug = entry.get("pdfSlug") or "—"
    pt = "yes" if entry.get("isPortuguese") else ("no" if st == "ok" else "—")
    checked = (entry.get("checkedAt") or "—")[:19]
    return f"| `{digits}` | {supplier} | {st} | {shape} | `{slug}` | {pt} | {checked} |"


def main() -> None:
    cache = load_cache()
    sg = round_report_set(STARSGEM_INDEX)
    ms = round_report_set(MESSI_INDEX)
    all_targets = sg | ms

    buckets = Counter(status_bucket(cache.get(d)) for d in all_targets)
    for d in all_targets:
        if d not in cache:
            buckets["not_started"] += 1

  # All Portuguese in cache (may include relabeled rows)
    portuguese = sorted(
        (d, cache[d]) for d, e in cache.items() if e.get("isPortuguese")
    )

    rate_limited = sorted(
        d for d in all_targets if status_bucket(cache.get(d)) == "rate_limited"
    )
    not_started = sorted(d for d in all_targets if d not in cache)
    maybe_retry = sorted(
        d
        for d in all_targets
        if status_bucket(cache.get(d)) == "not_found_maybe_retry"
    )
    not_found_final = sorted(
        d
        for d in all_targets
        if status_bucket(cache.get(d)) == "not_found_final"
    )

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    lines = [
        "# IGI shape verification progress (supplier rounds)",
        "",
        f"_Last generated: **{now}** via `python3 research/scripts/generate-igi-progress-doc.py`_",
        "",
        "Tracks which **IGI report numbers** from Starsgem / Messi stock lists have been",
        "looked up on `pdf.igi.org`, so we can **resume without re-hitting** stones already",
        "checked. Use the **slow verifier** (see [How to resume](#how-to-resume-safely)) —",
        "not parallel bulk fetch (caused HTTP **429** in May 2026).",
        "",
        "## Rules (do not skip)",
        "",
        "1. **PDF slug order:** For bare numeric report numbers (supplier sheets), try",
        "   **`FDR{digits}`** first, then `FRD`, `ID`, bare digits, `LG` — see",
        "   `igi_shape_cache.build_igi_pdf_candidates()`.",
        "2. **Example:** `797668056` → `https://pdf.igi.org/FDR797668056.pdf` →",
        "   *Round Modified Brilliant* (Portuguese), not plain `797668056.pdf`.",
        "3. **Portuguese label:** Only when IGI says **Round Modified Brilliant** (or",
        "   Portuguese in text). Round Brilliant stays `round`.",
        "4. **Rate limit:** ~1.0–1.5 s between reports; stop on 429; retry later with",
        "   `igi-verify-slow.py --status rate_limited`.",
        "",
        "## Summary",
        "",
        "| Scope | Round reports | In cache | ok | not_found | rate_limited | not_started |",
        "|-------|---------------|----------|-----|-----------|--------------|-------------|",
    ]

    def scope_row(name: str, ids: set[str]) -> str:
        in_c = [cache.get(d) for d in ids if d in cache]
        ok = sum(1 for e in in_c if e and e.get("status") == "ok")
        nf = sum(1 for e in in_c if e and e.get("status") == "not_found")
        rl = sum(1 for e in in_c if e and e.get("status") == "rate_limited")
        ns = len(ids) - len([d for d in ids if d in cache])
        return f"| {name} | {len(ids)} | {len(ids)-ns} | {ok} | {nf} | {rl} | {ns} |"

    lines.append(scope_row("Starsgem (ROUND rows)", sg))
    lines.append(scope_row("Messi (ROUND / RD rows)", ms))
    lines.append(scope_row("**Combined unique**", all_targets))
    lines.append("")
    lines.append(
        f"**Portuguese confirmed (IGI):** {len(portuguese)} — "
        + (", ".join(f"`{d}`" for d, _ in portuguese) if portuguese else "_none yet_")
    )
    lines.append("")
    lines.append("Machine-readable cache: `research/data/igi-shape-cache.json`")
    lines.append("")
    lines.append("## Status meanings")
    lines.append("")
    lines.append("| Status | Meaning | Resume? |")
    lines.append("|--------|---------|---------|")
    lines.append("| `not_started` | Never fetched | Yes — default queue |")
    lines.append("| `ok` | PDF found; shape parsed | No — done |")
    lines.append("| `not_found_final` | All slug candidates tried, no PDF | Only with `--force` |")
    lines.append("| `not_found_maybe_retry` | Failed before FDR fix or mid-429 run | Yes — `--status not_found` |")
    lines.append("| `rate_limited` | HTTP 429 on last attempt | Yes after cooldown (~30+ min) |")
    lines.append("")
    lines.append("## How to resume safely")
    lines.append("")
    lines.append("```bash")
    lines.append("# From project root — polite pace (recommended)")
    lines.append("python3 research/scripts/igi-verify-slow.py --limit 80 --delay 1.2")
    lines.append("")
    lines.append("# Messi rounds not in cache yet (~4.5k)")
    lines.append("python3 research/scripts/igi-verify-slow.py --supplier messi --limit 100 --delay 1.2")
    lines.append("")
    lines.append("# Retry 429 failures only")
    lines.append("python3 research/scripts/igi-verify-slow.py --status rate_limited --limit 50 --delay 2.0")
    lines.append("")
    lines.append("# Regenerate this document")
    lines.append("python3 research/scripts/generate-igi-progress-doc.py")
    lines.append("```")
    lines.append("")
    lines.append("After a batch, apply labels and rebuild comps:")
    lines.append("")
    lines.append("```bash")
    lines.append("python3 research/scripts/apply-igi-shape-labels.py")
    lines.append("python3 research/scripts/analyze-starsgem.py")
    lines.append("python3 research/scripts/analyze-messi-gems.py")
    lines.append("```")
    lines.append("")

    # Portuguese table
    lines.append("## Portuguese / Round Modified (confirmed)")
    lines.append("")
    if portuguese:
        lines.append("| Report | PDF slug | IGI shape | Notes |")
        lines.append("|--------|----------|-----------|-------|")
        for d, e in portuguese:
            note = e.get("source") or ""
            lines.append(
                f"| `{d}` | `{e.get('pdfSlug','—')}` | {e.get('shapeRaw','—')} | {note} |"
            )
    else:
        lines.append("_None in cache yet._")
    lines.append("")

    # Resume queues (truncated)
    def section(title: str, ids: list[str], max_rows: int = 80) -> None:
        lines.append(f"## {title}")
        lines.append("")
        lines.append(f"Count: **{len(ids)}**" + (f" (showing first {max_rows})" if len(ids) > max_rows else ""))
        lines.append("")
        if not ids:
            lines.append("_Empty._")
            lines.append("")
            return
        lines.append("| Report | Supplier | Status | IGI shape | PDF slug | PT? | Checked |")
        lines.append("|--------|----------|--------|-----------|----------|-----|---------|")
        for d in ids[:max_rows]:
            sup = []
            if d in sg:
                sup.append("starsgem")
            if d in ms:
                sup.append("messi")
            lines.append(format_report_line(d, cache.get(d), "/".join(sup) or "—"))
        if len(ids) > max_rows:
            lines.append(f"| … | | | | | | _{len(ids) - max_rows} more — see cache JSON_ |")
        lines.append("")

    section("Queue: not started", not_started)
    section("Queue: rate_limited (retry after cooldown)", rate_limited)
    section("Queue: not_found (incomplete / retry)", maybe_retry[:200])
    section("Completed: not_found (all slugs tried)", not_found_final[:50])

    lines.append("## History / lessons (May 2026)")
    lines.append("")
    lines.append("- First pass used **digits-only** URLs → most 404s.")
    lines.append("- Second pass added **FDR** → ~7.4k OK for Starsgem.")
    lines.append("- Parallel workers (~8–16) triggered **429**; many false `not_found`.")
    lines.append("- Aborted jobs: bulk `verify-portuguese-igi.py`, `retry-igi-not-found.py`,")
    lines.append("  sequential expensive-round scan.")
    lines.append("- Confirmed: **LG797668056** / `FDR797668056` = Round Modified (Portuguese).")
    lines.append("")

    OUT_PATH.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {OUT_PATH} ({len(lines)} lines)")


if __name__ == "__main__":
    main()
