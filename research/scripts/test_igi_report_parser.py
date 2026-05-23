#!/usr/bin/env python3
"""Focused regression checks for IGI PDF parsing and enrichment queue behavior."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from igi_report_parser import parse_igi_pdf_text  # noqa: E402


def assert_eq(actual, expected, label: str) -> None:
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def assert_close(actual, expected, label: str) -> None:
    if actual is None or abs(actual - expected) > 0.0001:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def test_portuguese_full_layout() -> None:
    entry = parse_igi_pdf_text(
        [
            "IGI Report Number LG797668056",
            "Description",
            "LABORATORY GROWN DIAMOND",
            "Shape and Cutting Style",
            "ROUND MODIFIED BRILLIANT",
            "Measurements",
            "7.90 - 7.85 - 4.88 MM",
            "GRADING RESULTS",
            "Carat Weight",
            "2.06 CARATS",
            "Color Grade",
            "E",
            "Clarity Grade",
            "VS1",
            "ADDITIONAL GRADING INFORMATION",
            "Polish",
            "EXCELLENT",
            "Symmetry",
            "EXCELLENT",
            "Fluorescence",
            "NONE",
            "Inscription(s)",
            "LG797668056",
            "Comments",
            "As Grown - No indication of post-growth treatment.",
            "This Laboratory Grown Diamond was created by Chemical Vapor Deposition (CVD) growth process.",
            "Type IIa",
            "May 15, 2026",
            "ELECTRONIC COPY",
            "2.06 CARATS",
            "E",
            "VS1",
            "62%",
            "53%",
            "Thick (Faceted)",
            "Large",
            "Excellent",
            "Excellent",
            "None",
            "LG797668056",
            "Carat Weight",
            "Color Grade",
            "Clarity Grade",
            "Depth",
            "Table",
            "Girdle",
            "Culet",
            "Polish",
            "Symmetry",
            "Fluorescence",
            "Inscription(s)",
        ]
    )
    assert_eq(entry["shapeMapped"], "portuguese", "Portuguese shape mapping")
    assert_eq(entry["reportNumber"], "LG797668056", "report number")
    assert_eq(entry["measurements"], "7.90 - 7.85 - 4.88 MM", "measurements")
    assert_close(entry["lwRatio"], 1.0064, "lw ratio")
    assert_eq(entry["carat"], 2.06, "carat")
    assert_eq(entry["color"], "E", "color")
    assert_eq(entry["clarity"], "VS1", "clarity")
    assert_eq(entry["growthMethod"], "CVD", "growth")
    assert_eq(entry["treatment"], "As Grown", "treatment")
    assert_eq(entry["diamondType"], "Type IIa", "diamond type")
    assert_eq(entry["reportDate"], "May 15, 2026", "report date")
    assert_close(entry["depthPct"], 62.0, "depth")
    assert_close(entry["tablePct"], 53.0, "table")
    assert_eq(entry["girdle"], "Thick (Faceted)", "girdle")
    assert_eq(entry["culet"], "Large", "culet")
    assert_eq(entry["enrichmentComplete"], True, "complete")


def test_sq_radiant_and_oval_modified() -> None:
    sq = parse_igi_pdf_text(
        [
            "IGI Report Number LG626468526",
            "Description",
            "LABORATORY GROWN DIAMOND",
            "Shape and Cutting Style",
            "CUT CORNERED SQUARE MODIFIED BRILLIANT",
            "Measurements",
            "6.39 - 6.38 - 4.25 MM",
            "GRADING RESULTS",
            "Carat Weight",
            "1.53 CARATS",
            "Color Grade",
            "D",
            "Clarity Grade",
            "VVS2",
            "Comments",
            "As Grown - No indication of post-growth treatment.",
            "This Laboratory Grown Diamond was created by High Pressure High Temperature (HPHT) growth process.",
            "Type II",
            "March 20, 2024",
            "ELECTRONIC COPY",
            "1.53 CARATS",
            "D",
            "VVS2",
            "66.6%",
            "64%",
            "Thick",
            "Pointed",
            "Excellent",
            "Very Good",
            "None",
            "LG626468526",
            "Carat Weight",
        ]
    )
    assert_eq(sq["shapeMapped"], "sq_radiant", "square radiant mapping")
    assert_eq(sq["growthMethod"], "HPHT", "square radiant growth")
    assert_close(sq["depthPct"], 66.6, "square radiant depth")
    assert_close(sq["tablePct"], 64.0, "square radiant table")

    oval = parse_igi_pdf_text(
        [
            "IGI Report Number LG786630477",
            "Shape and Cutting Style",
            "OVAL MODIFIED BRILLIANT",
            "Measurements",
            "25.84 - 17.77 - 10.85 MM",
            "Carat Weight",
            "40.11 CARATS",
            "Color Grade",
            "D",
            "Clarity Grade",
            "VVS1",
            "Comments",
            "As Grown - No indication of post-growth treatment.",
            "This Laboratory Grown Diamond was created by Chemical Vapor Deposition (CVD) growth process.",
            "Type IIa March 26, 2026",
            "ELECTRONIC COPY",
            "40.11 CARATS",
            "D",
            "VVS1",
            "61.1%",
            "68%",
            "Thick To Very Thick (Faceted)",
            "Pointed",
            "Excellent",
            "Excellent",
            "None",
            "LG786630477",
            "Carat Weight",
        ]
    )
    assert_eq(oval["shapeMapped"], "oval", "oval modified mapping")
    assert_close(oval["lwRatio"], 1.4541, "oval lw ratio")
    assert_close(oval["tablePct"], 68.0, "oval table")
    assert_close(oval["depthPct"], 61.1, "oval depth")


def test_full_retry_queue_includes_completed_not_found() -> None:
    spec = importlib.util.spec_from_file_location("igi_enrich_all", SCRIPT_DIR / "igi-enrich-all.py")
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load igi-enrich-all.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.all_report_digits_from_indexes = lambda: {
        "starsgem": {"1", "2", "3", "4"},
        "messi": set(),
    }
    store = {
        "1": {"status": "not_found", "lookupComplete": True},
        "2": {"status": "not_found", "lookupComplete": False},
        "3": {"status": "ok", "partial": True},
        "4": {"status": "ok", "parserVersion": 999, "enrichmentComplete": True},
    }
    assert_eq(mod.build_queue(store, "starsgem", "pending"), ["3", "2"], "normal queue")
    assert_eq(
        mod.build_queue(
            store,
            "starsgem",
            "pending",
            include_complete_not_found=True,
        ),
        ["3", "1", "2"],
        "full retry queue",
    )


def main() -> None:
    test_portuguese_full_layout()
    test_sq_radiant_and_oval_modified()
    test_full_retry_queue_includes_completed_not_found()
    print("IGI parser/enrichment tests passed")


if __name__ == "__main__":
    main()
