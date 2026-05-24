"""Fetch, cache, and apply full IGI PDF enrichment for supplier indexes."""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from igi_report_parser import (  # noqa: E402
    PARSER_VERSION,
    enrichment_completeness,
    map_report_shape_to_state,
    parse_igi_pdf_text,
)
from igi_shape_cache import (  # noqa: E402
    _fetch_pdf_bytes,
    build_igi_pdf_candidates,
    slug_for_report,
)
from shape_buckets import classify_shape_by_lw  # noqa: E402

DATA_DIR = SCRIPT_DIR.parent / "data"
ENRICHMENT_PATH = DATA_DIR / "igi-report-enrichment.json"
LEGACY_CACHE_PATH = DATA_DIR / "igi-shape-cache.json"
STARSGEM_INDEX = DATA_DIR / "starsgem-index.json"
MESSI_INDEX = DATA_DIR / "messi-gems-index.json"

# Shapes we never override from sheet-only specialty flags when IGI disagrees
IGI_SHAPE_AUTHORITY = True


def load_enrichment() -> dict:
    if ENRICHMENT_PATH.exists():
        with ENRICHMENT_PATH.open(encoding="utf-8") as f:
            store = json.load(f)
        for entry in store.values():
            normalize_enrichment_entry(entry)
        return store
    # Migrate legacy shape-only cache
    store: dict = {}
    if LEGACY_CACHE_PATH.exists():
        with LEGACY_CACHE_PATH.open(encoding="utf-8") as f:
            legacy = json.load(f)
        for digits, entry in legacy.items():
            if entry.get("status") == "ok":
                migrated = {
                    **entry,
                    "partial": True,
                    "migratedFrom": "igi-shape-cache.json",
                }
                if not migrated.get("shapeMapped"):
                    if migrated.get("isPortuguese"):
                        migrated["shapeMapped"] = "portuguese"
                    elif migrated.get("isRoundBrilliant"):
                        migrated["shapeMapped"] = "round"
                    elif migrated.get("shapeRaw"):
                        from igi_report_parser import map_report_shape_to_state

                        migrated["shapeMapped"] = map_report_shape_to_state(
                            migrated["shapeRaw"], ""
                        )
                store[digits] = migrated
            else:
                store[digits] = entry
    return store


def normalize_enrichment_entry(entry: dict | None) -> None:
    """Refresh derived parser fields without refetching the PDF."""
    if not entry or entry.get("status") != "ok":
        return
    if not entry.get("shapeMapped") and entry.get("shapeRaw"):
        entry["shapeMapped"] = map_report_shape_to_state(entry["shapeRaw"], "")
    comp = enrichment_completeness(entry)
    entry["enrichmentComplete"] = comp["complete"]
    entry["missingFields"] = comp["missingRequired"] + comp["missingImportant"]
    entry["unsupportedShapeRaw"] = bool(entry.get("shapeRaw") and not entry.get("shapeMapped"))


def save_enrichment(store: dict) -> None:
    with ENRICHMENT_PATH.open("w", encoding="utf-8") as f:
        json.dump(store, f, indent=2)
        f.write("\n")


def _parse_pdf_bytes(data: bytes, fallback_digits: str = "") -> dict[str, Any]:
    from io import BytesIO

    from pypdf import PdfReader

    reader = PdfReader(BytesIO(data))
    lines: list[str] = []
    for page in reader.pages:
        text = page.extract_text() or ""
        for line in text.splitlines():
            line = line.strip()
            if line:
                lines.append(line)
    return parse_igi_pdf_text(lines, fallback_digits=fallback_digits)


def _fast_slug_candidates(report_no: str, known_slug: str | None) -> list[str]:
    """Supplier stock: FDR/FRD first; skip bare-digit slugs unless retrying."""
    if known_slug:
        return [known_slug]
    clean = re.sub(r"[^A-Z0-9]", "", str(report_no).upper())
    m = re.search(r"\d{6,}", clean)
    digits = m.group(0) if m else ""
    if not digits:
        return build_igi_pdf_candidates(report_no)
    if re.match(r"^(ID|FRD|FDR)\d{6,}$", clean):
        return [clean]
    return [f"FDR{digits}", f"FRD{digits}", f"ID{digits}"]


def fetch_full_report(
    report_no: str,
    *,
    delay_between_slugs: float = 0.15,
    known_slug: str | None = None,
    fast: bool = True,
    full_retry: bool = False,
) -> dict[str, Any]:
    import time

    if full_retry or not fast:
        candidates = build_igi_pdf_candidates(report_no)
    else:
        candidates = _fast_slug_candidates(report_no, known_slug)
    if known_slug and known_slug not in candidates:
        candidates.insert(0, known_slug)
    slugs_tried: list[str] = []
    checked_at = datetime.now(timezone.utc).isoformat()
    saw_429 = False

    for i, slug in enumerate(candidates):
        if i > 0 and delay_between_slugs > 0:
            time.sleep(delay_between_slugs)
        slugs_tried.append(slug)
        data, code = _fetch_pdf_bytes(slug)
        if code == 429:
            saw_429 = True
        if not data:
            continue
        parsed = _parse_pdf_bytes(data, fallback_digits=slug_for_report(report_no))
        parsed["pdfSlug"] = slug
        parsed["slugsTried"] = slugs_tried
        parsed["checkedAt"] = checked_at
        parsed["lookupComplete"] = True
        parsed.pop("partial", None)
        return parsed

    if saw_429:
        return {
            "status": "rate_limited",
            "slugsTried": slugs_tried,
            "checkedAt": checked_at,
            "lookupComplete": False,
        }
    return {
        "status": "not_found",
        "slugsTried": slugs_tried,
        "checkedAt": checked_at,
        "lookupComplete": True,
    }


def needs_enrichment(entry: dict | None) -> bool:
    if entry is None:
        return True
    if entry.get("status") == "rate_limited":
        return True
    if entry.get("status") == "not_found":
        return not entry.get("lookupComplete")
    if entry.get("status") != "ok":
        return True
    if entry.get("partial"):
        return True
    if entry.get("parserVersion", 0) < PARSER_VERSION:
        return True
    if not enrichment_completeness(entry)["complete"]:
        return True
    return False


def all_report_digits_from_indexes() -> dict[str, set[str]]:
    out = {"starsgem": set(), "messi": set()}
    for supplier, path in (("starsgem", STARSGEM_INDEX), ("messi", MESSI_INDEX)):
        with path.open(encoding="utf-8") as f:
            data = json.load(f)
        for r in data.get("records", []):
            if r.get("reportNo"):
                out[supplier].add(slug_for_report(r["reportNo"]))
    return out


def apply_enrichment_to_record(record: dict, entry: dict) -> bool:
    """Merge IGI enrichment into a supplier index row. Returns True if shape changed."""
    if entry.get("status") != "ok":
        record["igi"] = {"status": entry.get("status"), "checkedAt": entry.get("checkedAt")}
        return False

    changed = False
    prev_shape = record.get("shape")

    igi_block: dict[str, Any] = {
        "status": "ok",
        "pdfSlug": entry.get("pdfSlug"),
        "reportNumber": entry.get("reportNumber"),
        "shapeRaw": entry.get("shapeRaw"),
        "shapeMapped": entry.get("shapeMapped"),
        "measurements": entry.get("measurements"),
        "size1": entry.get("size1"),
        "size2": entry.get("size2"),
        "size3": entry.get("size3"),
        "lwRatio": entry.get("lwRatio"),
        "carat": entry.get("carat"),
        "colorRaw": entry.get("colorRaw"),
        "color": entry.get("color"),
        "colorFamilyFromCert": entry.get("colorFamilyFromCert"),
        "colorHue": entry.get("colorHue"),
        "colorIntensity": entry.get("colorIntensity"),
        "colorModifiers": entry.get("colorModifiers"),
        "clarity": entry.get("clarity"),
        "cutRaw": entry.get("cutRaw"),
        "cut": entry.get("cut"),
        "polishRaw": entry.get("polishRaw"),
        "polish": entry.get("polish"),
        "symmetryRaw": entry.get("symmetryRaw"),
        "symmetry": entry.get("symmetry"),
        "fluorescenceRaw": entry.get("fluorescenceRaw"),
        "fluorescence": entry.get("fluorescence"),
        "growthMethod": entry.get("growthMethod"),
        "treatment": entry.get("treatment"),
        "tablePct": entry.get("tablePct"),
        "depthPct": entry.get("depthPct"),
        "girdle": entry.get("girdle"),
        "culet": entry.get("culet"),
        "inscription": entry.get("inscription"),
        "reportDate": entry.get("reportDate"),
        "diamondType": entry.get("diamondType"),
        "comments": entry.get("comments"),
        "isLabGrown": entry.get("isLabGrown"),
        "enrichmentComplete": entry.get("enrichmentComplete"),
        "checkedAt": entry.get("checkedAt"),
    }
    record["igi"] = igi_block

    # Fill missing physical fields from IGI when sheet lacks them
    if entry.get("size1") and not record.get("size1"):
        record["size1"] = entry["size1"]
        record["size2"] = entry.get("size2")
        record["size3"] = entry.get("size3")
    if entry.get("lwRatio") and not record.get("lwRatio"):
        record["lwRatio"] = entry["lwRatio"]
    if entry.get("tablePct") is not None and record.get("tablePct") is None:
        record["tablePct"] = entry["tablePct"]
    if entry.get("depthPct") is not None and record.get("depthPct") is None:
        record["depthPct"] = entry["depthPct"]

    mapped = entry.get("shapeMapped")
    if not mapped or not IGI_SHAPE_AUTHORITY:
        return False

    lw = entry.get("lwRatio") or record.get("lwRatio")
    # Portuguese / moval / specialty: use mapped directly
    if mapped in (
        "portuguese",
        "moval",
        "old_european",
        "old_mine",
        "rose",
        "briolette",
        "flanders",
        "hexagonal",
        "hexagonal_dutch",
    ):
        bucket = {
            "shape": mapped,
            "subVariant": None if mapped == "portuguese" else mapped,
            "subVariantLabel": entry.get("shapeRaw") or mapped.replace("_", " ").title(),
        }
    else:
        base = mapped
        if mapped == "cushion_brilliant":
            base = "cushion"
        bucket = classify_shape_by_lw(base, lw, record.get("rawCutCode") or "")

    new_shape = bucket["shape"]
    if record.get("shape") != new_shape or record.get("subVariant") != bucket.get("subVariant"):
        if record.get("shape") != new_shape:
            record["reclassifiedFrom"] = record.get("shape")
            changed = True
        record["shape"] = new_shape
        record["baseShape"] = mapped if mapped == "portuguese" else bucket.get("shape", mapped)
        record["subVariant"] = bucket.get("subVariant")
        record["subVariantLabel"] = (
            "Portuguese / Round Modified (IGI verified)"
            if mapped == "portuguese"
            else bucket.get("subVariantLabel")
        )
        record["isMoval"] = new_shape == "moval"
        record["isElongatedCushion"] = new_shape == "elongated_cushion"
        record["isSqRadiant"] = new_shape == "sq_radiant"

    record["igiVerified"] = True
    record["igiShapeRaw"] = entry.get("shapeRaw")
    record["igiPdfSlug"] = entry.get("pdfSlug")
    if mapped == "portuguese":
        record["igiConfirmedRound"] = False
    elif mapped == "round":
        record["igiConfirmedRound"] = True

    return changed and prev_shape != record.get("shape")


def apply_enrichment_to_records(records: list[dict], store: dict | None = None) -> dict:
    """
    Merge full IGI enrichment into normalized supplier rows before summaries/comps.
    Returns counts so analyzer scripts can report what was applied.
    """
    store = store if store is not None else load_enrichment()
    stats = {
        "storeEntries": len(store),
        "pdfsOk": sum(1 for v in store.values() if v.get("status") == "ok"),
        "portugueseOnCert": sum(
            1
            for v in store.values()
            if v.get("status") == "ok" and v.get("shapeMapped") == "portuguese"
        ),
        "rowsMatched": 0,
        "rowsEnriched": 0,
        "shapeReclassified": 0,
    }
    if not store:
        return stats

    for record in records:
        rn = record.get("reportNo")
        if not rn:
            continue
        entry = store.get(slug_for_report(rn))
        if not entry:
            continue
        stats["rowsMatched"] += 1
        if apply_enrichment_to_record(record, entry):
            stats["shapeReclassified"] += 1
        if entry.get("status") == "ok":
            stats["rowsEnriched"] += 1
    return stats


def apply_enrichment_to_index(path: Path, store: dict) -> dict:
    with path.open(encoding="utf-8") as f:
        data = json.load(f)
    reclassified_shapes = 0
    enriched = 0
    for r in data.get("records", []):
        rn = r.get("reportNo")
        if not rn:
            continue
        key = slug_for_report(rn)
        entry = store.get(key)
        if not entry:
            continue
        apply_enrichment_to_record(r, entry)
        if entry.get("status") == "ok":
            enriched += 1
            if r.get("igiVerified") and r.get("reclassifiedFrom"):
                reclassified_shapes += 1

    ok_n = sum(1 for v in store.values() if v.get("status") == "ok")
    pt_n = sum(
        1
        for v in store.values()
        if v.get("status") == "ok" and v.get("shapeMapped") == "portuguese"
    )
    data["igiEnrichment"] = {
        "storeFile": ENRICHMENT_PATH.name,
        "storeEntries": len(store),
        "pdfsOk": ok_n,
        "portugueseOnCert": pt_n,
        "rowsEnriched": enriched,
        "shapeReclassified": reclassified_shapes,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    return {
        "enriched": enriched,
        "shapeReclassified": reclassified_shapes,
    }
