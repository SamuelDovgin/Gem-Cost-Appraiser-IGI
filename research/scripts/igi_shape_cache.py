"""IGI public PDF slug candidates and shape cache for supplier indexes."""

from __future__ import annotations

import json
import re
import ssl
import urllib.request
from io import BytesIO
from pathlib import Path

try:
    from pypdf import PdfReader
except ImportError:
    PdfReader = None  # type: ignore

CACHE_PATH = Path(__file__).resolve().parent.parent / "data" / "igi-shape-cache.json"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
CTX = ssl.create_default_context()

SPECIALTY_CUT_SHAPES = frozenset({"old_european", "old_mine"})


def slug_for_report(report_no: str) -> str:
    """Cache key: digits-only report number."""
    return re.sub(r"\D", "", str(report_no))


def build_igi_pdf_candidates(report_no: str) -> list[str]:
    """
    PDF URL slugs for pdf.igi.org/{slug}.pdf — mirrors index.html buildIGIPdfCandidates,
    but tries FDR/FRD/ID before bare digits (supplier lists use FDR…).
    """
    clean = re.sub(r"[^A-Z0-9]", "", str(report_no).upper())
    m = re.search(r"\d{6,}", clean)
    digits = m.group(0) if m else ""
    if not digits:
        return []

    seen: set[str] = set()
    out: list[str] = []

    def add(slug: str) -> None:
        if slug and slug not in seen:
            seen.add(slug)
            out.append(slug)

    if re.match(r"^(ID|FRD|FDR)\d{6,}$", clean):
        add(clean)
    if re.match(r"^LG\d{6,}$", clean):
        add(digits)
        add("LG" + digits)
    if re.match(r"^\d{6,}$", clean):
        add("FDR" + digits)
        add("FRD" + digits)
        add("ID" + digits)
        add(digits)
        add("LG" + digits)
    else:
        add(clean)
        add(digits)
        add("FDR" + digits)
        add("FRD" + digits)
        add("ID" + digits)
    return out


def _fetch_pdf_bytes(slug: str, retries: int = 5) -> tuple[bytes | None, int | None]:
    """Returns (pdf_bytes, last_http_code)."""
    import time
    import urllib.error

    url = f"https://pdf.igi.org/{slug}.pdf"
    last_code: int | None = None
    for attempt in range(retries):
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=18, context=CTX) as r:
                if "pdf" not in (r.headers.get("Content-Type") or "").lower():
                    return None, r.status
                return r.read(), r.status
        except urllib.error.HTTPError as e:
            last_code = e.code
            if e.code == 429 and attempt < retries - 1:
                time.sleep(min(30, 3 * (2**attempt)))
                continue
            return None, e.code
        except Exception:
            if attempt < retries - 1:
                time.sleep(0.5 * (attempt + 1))
    return None, last_code


def parse_igi_shape_from_pdf(pdf_bytes: bytes) -> dict:
    if PdfReader is None:
        raise RuntimeError("pip3 install pypdf")
    reader = PdfReader(BytesIO(pdf_bytes))
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    norm = re.sub(r"\s+", " ", text)
    m = re.search(
        r"Shape and Cutting Style\s*([A-Za-z0-9 /\-]+?)(?:\s*Measurements|\s*GRADING)",
        text,
        re.I,
    )
    shape_raw = m.group(1).strip() if m else ""
    if not shape_raw:
        m2 = re.search(r"(ROUND(?:\s+MODIFIED)?\s+BRILLIANT)", norm, re.I)
        shape_raw = m2.group(1).strip() if m2 else ""
    low = shape_raw.lower()
    is_portuguese = bool(
        re.search(r"round\s+modified", low) or "portuguese" in norm.lower()
    )
    is_round = bool(re.search(r"round\s+brilliant", low)) and not is_portuguese
    return {
        "shapeRaw": shape_raw or None,
        "isPortuguese": is_portuguese,
        "isRoundBrilliant": is_round,
    }


def fetch_and_parse_report(
    report_no: str,
    *,
    delay_between_slugs: float = 0.0,
) -> dict:
    """Try all slug candidates; return cache entry keyed by digits."""
    import time
    from datetime import datetime, timezone

    candidates = build_igi_pdf_candidates(report_no)
    slugs_tried: list[str] = []
    saw_429 = False
    checked_at = datetime.now(timezone.utc).isoformat()

    for i, slug in enumerate(candidates):
        if i > 0 and delay_between_slugs > 0:
            time.sleep(delay_between_slugs)
        slugs_tried.append(slug)
        data, http_code = _fetch_pdf_bytes(slug)
        if http_code == 429:
            saw_429 = True
        if not data:
            continue
        parsed = parse_igi_shape_from_pdf(data)
        parsed["status"] = "ok"
        parsed["pdfSlug"] = slug
        parsed["slugsTried"] = slugs_tried
        parsed["checkedAt"] = checked_at
        parsed["lookupComplete"] = True
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


def cache_entry_from_pdf_slug(pdf_slug: str, shape_raw: str) -> dict:
    """Build a cache entry when the PDF was verified manually (e.g. user-provided URL)."""
    low = shape_raw.lower()
    is_portuguese = bool(
        re.search(r"round\s+modified", low) or "portuguese" in low
    )
    is_round = bool(re.search(r"round\s+brilliant", low)) and not is_portuguese
    digits = slug_for_report(pdf_slug)
    return {
        "status": "ok",
        "pdfSlug": pdf_slug,
        "shapeRaw": shape_raw,
        "isPortuguese": is_portuguese,
        "isRoundBrilliant": is_round,
        "source": "manual",
    }


def load_cache() -> dict:
    if not CACHE_PATH.exists():
        return {}
    with CACHE_PATH.open(encoding="utf-8") as f:
        return json.load(f)


def save_cache(cache: dict) -> None:
    with CACHE_PATH.open("w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2)
        f.write("\n")


def apply_igi_shape_cache(records: list[dict], cache: dict | None = None) -> int:
    """
    Reclassify round → portuguese only when cache has status=ok and isPortuguese.
    Returns count of rows reclassified.
    """
    cache = cache if cache is not None else load_cache()
    if not cache:
        return 0
    changed = 0
    for r in records:
        # Listed as ROUND in supplier sheet (may have wrong cut code column)
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
            r["shape"] = "portuguese"
            r["baseShape"] = "portuguese"
            r["subVariant"] = None
            r["subVariantLabel"] = "Portuguese / Round Modified (IGI verified)"
            changed += 1
        elif hit.get("isRoundBrilliant"):
            r["igiConfirmedRound"] = True
    return changed


def apply_specialty_cut_shape_override(record: dict, shape_labels: dict) -> None:
    """When Cut column is a specialty code (老欧切 etc.), override ROUND shape column."""
    if record.get("baseShape") != "round":
        return
    cut_style = record.get("cutStyle")
    if cut_style not in SPECIALTY_CUT_SHAPES:
        return
    record["shape"] = cut_style
    record["subVariant"] = cut_style
    record["subVariantLabel"] = shape_labels.get(cut_style, cut_style)
    record["reclassifiedFrom"] = "round"
