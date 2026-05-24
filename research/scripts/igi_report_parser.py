"""Parse IGI lab-grown PDF text into structured enrichment records."""

from __future__ import annotations

import re
from typing import Any

CARAT_MAX = 50.0
PARSER_VERSION = 3

HARD_STOP = re.compile(
    r"^(Description|Shape and Cutting Style|Shape & Cut|Shape/cut|Measurements|"
    r"GRADING RESULTS|Carat Weight|Color Grade|Clarity Grade|Cut Grade|"
    r"ADDITIONAL GRADING INFORMATION|Polish|Symmetry|Fluorescence|"
    r"Inscription\(s\)|Comments:?|PROPORTIONS|GRADING SCALES|KEY TO SYMBOLS|COLOR|CLARITY)$",
    re.I,
)

# Fields required for a "complete" enrichment row
REQUIRED_FIELDS = ("carat", "shapeRaw", "color", "clarity", "measurements")
IMPORTANT_FIELDS = (
    "polish",
    "symmetry",
    "fluorescence",
    "tablePct",
    "depthPct",
    "growthMethod",
    "inscription",
    "reportDate",
)

FANCY_COLOR_HUES = (
    "yellow",
    "pink",
    "blue",
    "green",
    "orange",
    "purple",
    "violet",
    "brown",
    "gray",
    "grey",
    "black",
    "red",
)

FANCY_COLOR_WORDS = {
    "FANCY",
    "LIGHT",
    "INTENSE",
    "VIVID",
    "DEEP",
    "DARK",
    "BROWNISH",
    "GRAYISH",
    "GREYISH",
    "ORANGY",
    "ORANGEISH",
    "PURPLISH",
    "VIOLETISH",
    "YELLOWISH",
    "PINKISH",
    "BLUISH",
    "GREENISH",
    "REDDISH",
    "YELLOW",
    "PINK",
    "BLUE",
    "GREEN",
    "ORANGE",
    "PURPLE",
    "VIOLET",
    "BROWN",
    "GRAY",
    "GREY",
    "BLACK",
    "RED",
}

FANCY_INTENSITY_WORDS = ("light", "fancy", "intense", "vivid", "deep", "dark")
FANCY_MODIFIER_WORDS = (
    "brownish",
    "grayish",
    "greyish",
    "orangy",
    "orangeish",
    "purplish",
    "violetish",
    "yellowish",
    "pinkish",
    "bluish",
    "greenish",
    "reddish",
)


def map_report_shape_to_state(shape: str, report_hint: str = "") -> str | None:
    sh = (shape or "").lower().replace(".", "")
    ctx = (report_hint or "").lower()
    combined = f"{sh} {ctx}".strip()
    if "portuguese" in combined:
        return "portuguese"
    if "round" in combined and "modified" in combined and (
        "brilliant" in combined or "portuguese" in combined
    ):
        return "portuguese"
    if re.search(r"round\s+modified", combined):
        return "portuguese"
    if (
        "round" in sh
        and "brilliant" in sh
        and "square" not in sh
        and "cornered" not in sh
    ):
        if "portuguese" in ctx or re.search(r"round\s+modified", ctx):
            return "portuguese"
    if "moval" in sh or "movel" in sh:
        return "moval"
    if "flower" in sh:
        return "flower"
    if "freeform" in sh or "free form" in sh:
        return "freeform"
    if "dutch" in sh and ("hex" in sh or "marquise" in sh):
        return "hexagonal_dutch"
    if "hexagonal" in sh and "dutch" in sh:
        return "hexagonal_dutch"
    if "dutch marquise" in sh or "dutch-marquise" in sh:
        return "hexagonal_dutch"
    if "old european" in sh:
        return "old_european"
    if "old mine" in sh:
        return "old_mine"
    if "round" in sh:
        return "round"
    if "oval" in sh:
        return "oval"
    if "pear" in sh or "drop" in sh:
        return "pear"
    if "marquise" in sh:
        return "marquise"
    if "heart" in sh:
        return "heart"
    if "trilliant" in sh or "triangle" in sh or "triangular" in sh:
        return "trilliant"
    if "square cushion" in sh:
        return "square_cushion"
    if "cushion" in sh and "modified" in sh:
        return "cushion"
    if "cushion" in sh and "brilliant" in sh:
        return "cushion_brilliant"
    if "cushion" in sh:
        return "cushion"
    if ("cut cornered" in sh or "cut-cornered" in sh) and "square" in sh:
        return "sq_radiant"
    if ("cut cornered" in sh or "cut-cornered" in sh) and (
        "rect" in sh or "rectangular" in sh
    ):
        return "radiant"
    if "radiant" in sh and ("square" in sh or "sq" in sh):
        return "sq_radiant"
    if "radiant" in sh:
        return "radiant"
    if "princess" in sh or "square modified brilliant" in sh:
        return "princess"
    if "square emerald" in sh or "asscher" in sh:
        return "asscher"
    if "emerald" in sh:
        return "emerald"
    if "baguette" in sh and "taper" in sh:
        return "tapered_baguette"
    if "baguette" in sh:
        return "baguette"
    if "half moon" in sh or "halfmoon" in sh:
        return "half_moon"
    if "shield" in sh or "kite" in sh:
        return "shield"
    if "hexagonal" in sh:
        return "hexagonal"
    if "dutch" in sh:
        return "hexagonal_dutch"
    if "carre" in sh or "carr" in sh:
        return "carre"
    if "rose" in sh:
        return "rose"
    if "briolette" in sh:
        return "briolette"
    if "flanders" in sh:
        return "flanders"
    return None


def _clean(s: str) -> str:
    return (
        (s or "")
        .replace("|", " ")
        .replace("---", " ")
        .replace("Sample Image Used", "")
        .strip(": ")
        .strip()
    )


def _norm_lines(lines: list[str]) -> str:
    return re.sub(r"\s+", " ", " ".join(lines))


def get_report_data_lines(lines: list[str]) -> list[str]:
    start = -1
    for i, line in enumerate(lines):
        if re.search(
            r"IGI Report (?:Number|No)\b|^(Description|Shape and Cutting Style|GRADING RESULTS)\b",
            line,
            re.I,
        ):
            start = i
            break
    end = len(lines)
    for i, line in enumerate(lines):
        if i > max(start, 0) and re.match(r"^KEY TO SYMBOLS\b", line.strip(), re.I):
            end = i
            break
    return lines[:end] if end else lines


def _read_after_label(
    lines: list[str], label_re: str, stop_re: str, max_lines: int = 4
) -> str:
    for i, line in enumerate(lines):
        if not re.search(label_re, line, re.I):
            continue
        m = re.search(label_re, line, re.I)
        same = line[m.end() :].strip() if m else ""
        same = re.sub(r"^[:\s|]+", "", same)
        parts = []
        if same and not HARD_STOP.match(same):
            parts.append(same)
        for j in range(i + 1, min(len(lines), i + 1 + max_lines)):
            nxt = lines[j].strip()
            if not nxt:
                continue
            if re.fullmatch(r"[:|]+", nxt):
                continue
            next_label = " ".join(
                x.strip() for x in lines[j : min(len(lines), j + 2)] if x.strip()
            )
            if re.match(r"^(?:Min\.\s*)?Clarity$", nxt, re.I) and re.search(
                stop_re, next_label, re.I
            ):
                break
            if re.search(stop_re, nxt, re.I) or HARD_STOP.match(nxt):
                break
            parts.append(nxt)
        val = _clean(" ".join(parts))
        if val:
            return val
    return ""


def _read_label_next(lines: list[str], labels: list[str]) -> dict[str, str]:
    """Label on one line, value on the following line (main report body)."""
    out: dict[str, str] = {}
    norm_labels = {lb.lower(): lb for lb in labels}
    for i, line in enumerate(lines):
        key = line.strip().lower()
        if key not in norm_labels:
            continue
        canon = norm_labels[key]
        if i + 1 >= len(lines):
            continue
        nxt = lines[i + 1].strip()
        if nxt and not HARD_STOP.match(nxt) and nxt.lower() not in norm_labels:
            out[canon] = nxt
    return out


def _pair_label_values_before(lines: list[str], labels: list[str]) -> dict[str, str]:
    """Electronic-copy footer: value line immediately before label."""
    out: dict[str, str] = {}
    norm_labels = {lb.lower(): lb for lb in labels}
    for i, line in enumerate(lines):
        key = line.strip().lower()
        if key not in norm_labels:
            continue
        canon = norm_labels[key]
        if i > 0:
            prev = lines[i - 1].strip()
            if prev and not HARD_STOP.match(prev) and prev.lower() not in norm_labels:
                out[canon] = prev
    return out


def normalize_shape_text(value: str) -> str:
    s = _clean(value)
    s = re.sub(
        r"^(Shape\s+And\s+Cutting\s+Style|Shape\s*&\s*Cut|Shape)\s+",
        "",
        s,
        flags=re.I,
    )
    s = re.sub(r"Rectangularangular", "Rectangular", s, flags=re.I)
    s = re.sub(r"\s+", " ", s).strip()
    return s.title() if s else ""


def is_minimum_grade_report(norm: str) -> bool:
    """IGI compact ID reports list min grades and omit full proportions."""
    return bool(
        re.search(r"\bDIAMOND REPORT\b", norm, re.I)
        and re.search(r"\bMin\.\s*Color Grade\b", norm, re.I)
        and re.search(r"\bMin\.\s*Clarity\s*Grade\b", norm, re.I)
    )


def parse_measurements(value: str, norm: str) -> tuple[float | None, float | None, float | None, str | None]:
    source = f"{_clean(value)} {norm}"
    m = re.search(
        r"(\d+(?:\.\d+)?)\s*[-xX]\s*(\d+(?:\.\d+)?)(?:\s*[-xX]\s*(\d+(?:\.\d+)?))?\s*MM",
        source,
        re.I,
    )
    if not m:
        return None, None, None, None
    a, b = float(m.group(1)), float(m.group(2))
    d = float(m.group(3)) if m.group(3) else None
    s1, s2 = max(a, b), min(a, b)
    meas = f"{s1:.2f} - {s2:.2f}" + (f" - {d:.2f}" if d else "") + " MM"
    return s1, s2, d, meas


def lw_ratio_from_sizes(s1: float | None, s2: float | None) -> float | None:
    if not s1 or not s2 or min(s1, s2) <= 0:
        return None
    return round(max(s1, s2) / min(s1, s2), 4)


def extract_report_number(norm: str, fallback: str = "") -> str:
    for pat in [
        r"IGI Report (?:Number|No)\s+((?:LG|ID|FRD|FDR)?\d{6,})",
        r"\b(LG\d{6,})\b",
        r"\b((?:ID|FRD|FDR)\d{6,})\b",
    ]:
        m = re.search(pat, norm, re.I)
        if m:
            return m.group(1).upper()
    return fallback.upper() if fallback else ""


def normalize_clarity(raw: str) -> str | None:
    value = (raw or "").upper()
    if "INTERNALLY FLAWLESS" in value:
        return "IF"
    if re.search(r"\bFLAWLESS\b", value):
        return "FL"
    src = re.sub(r"\s+", "", (raw or "").upper())
    m = re.search(r"\b(IF|VVS1|VVS2|VS1|VS2|SI1|SI2|I1|I2|I3)\b", src)
    if m:
        return m.group(1)
    m = re.search(r"\b(VVS|VS|SI)\s*([12])?\b", value)
    if m:
        return m.group(1) + (m.group(2) or "1")
    return None


def normalize_grade(raw: str) -> str | None:
    v = _clean(raw).upper()
    if not v:
        return None
    if "IDEAL" in v:
        return "Ideal"
    if "EXCELLENT" in v:
        return "Excellent"
    if "VERY GOOD" in v:
        return "Very Good"
    if re.search(r"\bGOOD\b", v):
        return "Good"
    if "NONE" in v:
        return "None"
    if "FAINT" in v:
        return "Faint"
    if "MEDIUM" in v:
        return "Medium"
    if "STRONG" in v:
        return "Strong"
    return _clean(raw).title()


def _read_between_labels(norm_text: str, label_re: str, stop_re: str) -> str:
    source = _clean(norm_text)
    m = re.search(label_re, source, re.I)
    if not m:
        return ""
    rest = re.sub(r"^[:\s|]+", "", source[m.end() :])
    stop = re.search(stop_re, rest, re.I)
    return _clean(rest[: stop.start()] if stop else rest)


def extract_fancy_color_label(source: str) -> str | None:
    words = re.findall(r"[A-Z]+", (source or "").upper())
    starts: list[int] = []
    for i, word in enumerate(words):
        if word == "FANCY":
            starts.append(i)
            continue
        if word not in FANCY_COLOR_WORDS or word.lower() in FANCY_COLOR_HUES:
            continue
        if any(next_word.lower() in FANCY_COLOR_HUES for next_word in words[i + 1 : i + 8]):
            starts.append(i)

    for start in starts:
        out: list[str] = []
        if words[start] != "FANCY":
            out.append("FANCY")
        saw_hue = False
        for i in range(start, min(len(words), start + 12)):
            word = words[i]
            if word not in FANCY_COLOR_WORDS:
                if not saw_hue:
                    continue
                break
            out.append(word)
            if word.lower() in FANCY_COLOR_HUES:
                saw_hue = True
                nxt = words[i + 1].lower() if i + 1 < len(words) else ""
                if nxt not in FANCY_COLOR_HUES:
                    break
        if saw_hue:
            return _clean(" ".join(out)).title().replace("Grey", "Gray")
    return None


def parse_fancy_color_parts(color: str | None) -> dict[str, Any] | None:
    if not color or "fancy" not in color.lower():
        return None
    words = re.findall(r"[A-Za-z]+", color.lower().replace("grey", "gray"))
    hue_positions = [
        (i, word)
        for i, word in enumerate(words)
        if word in FANCY_COLOR_HUES and word != "grey"
    ]
    hue = hue_positions[-1][1] if hue_positions else None
    intensity = "fancy"
    for word in words:
        if word in ("light", "intense", "vivid", "deep", "dark"):
            intensity = word
            break
    modifiers = []
    for word in words:
        normalized = word.replace("grey", "gray")
        if normalized in FANCY_MODIFIER_WORDS and normalized not in modifiers:
            modifiers.append(normalized)
    return {
        "family": "fancy",
        "intensity": intensity,
        "hue": hue,
        "modifiers": modifiers,
    }


def normalize_color(raw: str, norm: str) -> str | None:
    src = f"{(raw or '').upper()} {norm}"
    fancy = extract_fancy_color_label(src)
    if fancy:
        return fancy
    m = re.search(r"\bColor Grade\s+([D-Z])\b", src)
    if m:
        return m.group(1)
    m = re.fullmatch(r"\s*([D-Z]){2}\s*", raw or "")
    if m:
        return (raw or "").strip()[0].upper()
    m = re.search(r"\b([D-Z])\b", raw or "")
    return m.group(1) if m else None


def extract_carat(lines: list[str], norm: str) -> float | None:
    for pat in [
        r"Carat Weight\s+(\d+(?:\.\d+)?)\s*CARATS?\b",
        r"\b(\d+(?:\.\d+)?)\s*CARATS?\s+Carat Weight",
        r"GRADING RESULTS.*?(\d+(?:\.\d+)?)\s*CARATS?",
    ]:
        m = re.search(pat, norm, re.I | re.DOTALL)
        if m:
            n = float(m.group(1))
            if 0 < n <= CARAT_MAX:
                return round(n, 2)
    for i, line in enumerate(lines):
        if "Carat Weight" not in line:
            continue
        snip = " ".join(lines[i : i + 4])
        m = re.search(r"(\d+(?:\.\d+)?)\s*CARATS?", snip, re.I)
        if m:
            n = float(m.group(1))
            if 0 < n <= CARAT_MAX:
                return round(n, 2)
    return None


def _parse_electronic_copy(lines: list[str]) -> dict[str, Any]:
    """Parse proportions from ELECTRONIC COPY value column (values then labels)."""
    out: dict[str, Any] = {}
    try:
        idx = next(i for i, l in enumerate(lines) if l.strip().upper() == "ELECTRONIC COPY")
    except StopIteration:
        return out

    label_start = None
    for j in range(idx + 1, min(idx + 40, len(lines))):
        if lines[j].strip() == "Carat Weight":
            label_start = j
            break
    if label_start is None:
        return out

    value_block = lines[idx + 1 : label_start]
    pcts: list[float] = []
    grades: list[str] = []
    girdle_parts: list[str] = []

    for line in value_block:
        if re.match(r"^\d+(?:\.\d+)?\s*CARATS?\b", line, re.I):
            continue
        if re.match(r"^[D-Z]$", line):
            continue
        if re.search(r"\b(VS|VVS|SI|IF)\b", line, re.I):
            continue
        if line.endswith("%"):
            pcts.append(float(line.rstrip("%")))
            continue
        g = normalize_grade(line)
        if g in ("Excellent", "Very Good", "Good", "Ideal"):
            grades.append(g)
            continue
        if g in ("None", "Faint", "Medium", "Strong"):
            out["fluorescence"] = g
            continue
        if re.search(r"(?:LG|FDR|FRD|ID)\d{6,}", line, re.I):
            out["inscription"] = re.sub(r"^[^\wA-Z]+", "", line).strip()
            continue
        if re.search(
            r"\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b", line, re.I
        ):
            continue
        if line.lower() in ("large", "small", "medium", "pointed", "none"):
            out["culet"] = line
            continue
        if re.search(r"thick|faceted|girdle", line, re.I) or (
            girdle_parts and not grades
        ):
            girdle_parts.append(line)

    if len(pcts) >= 2:
        out["depthPct"] = pcts[0]
        out["tablePct"] = pcts[1]
    if len(grades) >= 1:
        out["polish"] = grades[0]
    if len(grades) >= 2:
        out["symmetry"] = grades[1]
    if girdle_parts:
        out["girdle"] = _clean(" ".join(girdle_parts))

    footer = lines[label_start : label_start + 15]
    paired = _pair_label_values_before(
        footer, ["Depth", "Table", "Girdle", "Culet", "Polish", "Symmetry", "Fluorescence"]
    )
    if paired.get("Depth", "").endswith("%"):
        out.setdefault("depthPct", float(paired["Depth"].rstrip("%")))
    if paired.get("Table", "").endswith("%"):
        out.setdefault("tablePct", float(paired["Table"].rstrip("%")))
    out.setdefault("girdle", paired.get("Girdle"))
    out.setdefault("culet", paired.get("Culet"))

    return out


def _parse_comments(lines: list[str]) -> str | None:
    parts: list[str] = []
    capturing = False
    for line in lines:
        if re.match(r"^Comments:?", line.strip(), re.I):
            capturing = True
            line = re.sub(r"^Comments:?\s*", "", line, flags=re.I).strip()
            if line:
                parts.append(line)
            continue
        if capturing:
            if HARD_STOP.match(line.strip()) or re.match(
                r"^(IGI Report|Description|Shape and|May \d|Type II)", line.strip(), re.I
            ):
                break
            parts.append(line.strip())
    text = _clean(" ".join(parts))
    return text[:600] if text else None


def enrichment_completeness(entry: dict) -> dict[str, Any]:
    """Return {complete, missingRequired, missingImportant}."""
    if entry.get("status") != "ok":
        return {"complete": False, "missingRequired": ["status"], "missingImportant": []}
    if entry.get("reportVariant") == "minimum_grade":
        required = (
            "carat",
            "shapeRaw",
            "color",
            "clarity",
            "inscription",
            "reportDate",
        )
        miss_r = [f for f in required if not entry.get(f)]
        return {
            "complete": len(miss_r) == 0,
            "missingRequired": miss_r,
            "missingImportant": [],
        }
    miss_r = [f for f in REQUIRED_FIELDS if not entry.get(f)]
    miss_i = [f for f in IMPORTANT_FIELDS if not entry.get(f)]
    return {
        "complete": len(miss_r) == 0,
        "missingRequired": miss_r,
        "missingImportant": miss_i,
    }


def parse_igi_pdf_text(lines: list[str], fallback_digits: str = "") -> dict[str, Any]:
    report_lines = get_report_data_lines(lines)
    norm = _norm_lines(report_lines)
    report_variant = "minimum_grade" if is_minimum_grade_report(norm) else "full_grading"

    shape_raw = normalize_shape_text(
        _read_after_label(
            report_lines,
            r"Shape(?:\s+and\s+Cutting\s+Style|\s*&\s*Cut|/cut)",
            r"Measurements|GRADING RESULTS|Carat Weight",
            6,
        )
    )
    if not shape_raw:
        m = re.search(
            r"((?:CUT[- ]CORNERED|SQUARE|ROUND|OVAL|PEAR|MARQUISE|HEART|CUSHION|"
            r"RADIANT|PRINCESS|EMERALD|ASSCHER)[\w\s]*(?:MODIFIED\s+)?BRILLIANT)",
            norm,
            re.I,
        )
        shape_raw = normalize_shape_text(m.group(1)) if m else ""

    s1, s2, s3, measurements = parse_measurements(
        _read_after_label(
            report_lines,
            r"Measurements",
            r"GRADING RESULTS|Carat Weight|Color Grade",
            4,
        ),
        norm,
    )
    lw = lw_ratio_from_sizes(s1, s2)

    carat = extract_carat(report_lines, norm)
    color_raw = _read_after_label(
        report_lines,
        r"(?:Min\.\s*)?Color Grade",
        r"(?:Min\.\s*)?Clarity\s*Grade|Cut Grade",
        4,
    ) or _read_between_labels(
        norm,
        r"(?:Min\.\s*)?Color Grade",
        r"(?:Min\.\s*)?Clarity\s*Grade",
    )
    clarity_raw = _read_after_label(
        report_lines,
        r"(?:Min\.\s*)?Clarity\s*Grade",
        r"Cut Grade|ADDITIONAL|Polish|Inscription",
        4,
    ) or _read_between_labels(
        norm,
        r"(?:Min\.\s*)?Clarity\s*Grade",
        r"Cut Grade|ADDITIONAL|Polish|Inscription",
    )
    cut_raw = _read_after_label(report_lines, r"Cut Grade", r"ADDITIONAL|Polish|Symmetry", 3) or _read_between_labels(
        norm, r"Cut Grade", r"ADDITIONAL|Polish|Symmetry"
    )

    color = normalize_color(color_raw, norm) or normalize_color(norm, "")
    clarity = normalize_clarity(clarity_raw)
    cut = normalize_grade(cut_raw)

    add_pairs = _read_label_next(
        report_lines,
        ["Polish", "Symmetry", "Fluorescence", "Inscription(s)"],
    )
    polish_raw = add_pairs.get("Polish", "")
    symmetry_raw = add_pairs.get("Symmetry", "")
    fluorescence_raw = add_pairs.get("Fluorescence", "")
    polish = normalize_grade(polish_raw)
    symmetry = normalize_grade(symmetry_raw)
    fluorescence = normalize_grade(fluorescence_raw)
    inscription = add_pairs.get("Inscription(s)", "")
    if inscription:
        inscription = re.sub(r"^[^\wA-Z]+", "", inscription).strip()
        if not re.search(r"\d{6,}", inscription):
            inscription = ""

    ecopy = _parse_electronic_copy(lines)
    polish = polish or ecopy.get("polish")
    symmetry = symmetry or ecopy.get("symmetry")
    fluorescence = fluorescence or ecopy.get("fluorescence")
    polish_raw = polish_raw or ecopy.get("polish")
    symmetry_raw = symmetry_raw or ecopy.get("symmetry")
    fluorescence_raw = fluorescence_raw or ecopy.get("fluorescence")
    cut = cut or ecopy.get("cut")
    cut_raw = cut_raw or ecopy.get("cut")
    ecopy_insc = ecopy.get("inscription")
    if ecopy_insc and re.search(r"\d{6,}", str(ecopy_insc)):
        inscription = inscription or ecopy_insc
    table_pct = ecopy.get("tablePct")
    depth_pct = ecopy.get("depthPct")
    girdle = ecopy.get("girdle")
    culet = ecopy.get("culet")

    if table_pct is None:
        m = re.search(r"(\d+(?:\.\d+)?)\s*%\s*Table", norm, re.I)
        if m:
            table_pct = float(m.group(1))
    if depth_pct is None:
        m = re.search(r"(\d+(?:\.\d+)?)\s*%\s*Depth", norm, re.I)
        if m:
            depth_pct = float(m.group(1))

    comments = _parse_comments(report_lines)
    report_date = None
    dm = re.search(
        r"\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})\b",
        norm,
    )
    if dm:
        report_date = dm.group(1)
    type_line = None
    if re.search(r"Type\s+IIa", norm, re.I):
        type_line = "Type IIa"
    elif re.search(r"Type\s+II", norm, re.I):
        type_line = "Type II"

    growth = None
    if re.search(r"HPHT|High Pressure High Temperature", norm, re.I):
        growth = "HPHT"
    elif re.search(r"CVD|Chemical Vapor Deposition", norm, re.I):
        growth = "CVD"

    treatment = None
    if re.search(r"As Grown|No indication of post-growth treatment", norm, re.I):
        treatment = "As Grown"
    elif re.search(r"post-growth treatment", norm, re.I):
        treatment = "May include post-growth treatment"

    cert = extract_report_number(norm, fallback_digits)
    hint = " | ".join(x for x in [shape_raw, comments or "", type_line or ""] if x)
    shape_mapped = map_report_shape_to_state(shape_raw, hint)
    color_parts = parse_fancy_color_parts(color)

    entry: dict[str, Any] = {
        "status": "ok",
        "parserVersion": PARSER_VERSION,
        "reportVariant": report_variant,
        "reportNumber": cert or None,
        "shapeRaw": shape_raw or None,
        "shapeMapped": shape_mapped,
        "unsupportedShapeRaw": bool(shape_raw and not shape_mapped),
        "isPortuguese": shape_mapped == "portuguese",
        "isRoundBrilliant": shape_mapped == "round",
        "measurements": measurements,
        "size1": s1,
        "size2": s2,
        "size3": s3,
        "lwRatio": lw,
        "carat": carat,
        "colorRaw": color_raw or color,
        "color": color,
        "colorFamilyFromCert": color_parts["family"] if color_parts else "white",
        "colorHue": color_parts["hue"] if color_parts else None,
        "colorIntensity": color_parts["intensity"] if color_parts else None,
        "colorModifiers": color_parts["modifiers"] if color_parts else [],
        "clarity": clarity,
        "cutRaw": cut_raw or cut,
        "cut": cut,
        "polishRaw": polish_raw or polish,
        "polish": polish,
        "symmetryRaw": symmetry_raw or symmetry,
        "symmetry": symmetry,
        "fluorescenceRaw": fluorescence_raw or fluorescence,
        "fluorescence": fluorescence,
        "growthMethod": growth,
        "treatment": treatment,
        "tablePct": table_pct,
        "depthPct": depth_pct,
        "girdle": girdle,
        "culet": culet,
        "inscription": inscription or cert,
        "reportDate": report_date,
        "diamondType": type_line,
        "comments": comments,
        "isLabGrown": bool(re.search(r"LABORATORY GROWN", norm, re.I)),
    }
    comp = enrichment_completeness(entry)
    entry["enrichmentComplete"] = comp["complete"]
    entry["missingFields"] = comp["missingRequired"] + comp["missingImportant"]
    return entry
