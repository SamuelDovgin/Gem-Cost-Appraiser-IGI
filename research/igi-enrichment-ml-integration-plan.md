# IGI Enrichment → ML Model Integration Plan

**Status:** Ready to implement once enrichment is ≥ 90% complete  
**Target:** Retrain StarGem ML model with IGI-certified shape sub-types and measurements  
**Expected gain:** Additional 0.5–1.5pp MAPE reduction on top of current 4.10%

---

## Why this matters

The XLS supplier sheet uses 13 coarse `Shape` values. IGI certificates expose 25+ specific sub-types. Several XLS shapes are **price-discriminating mixtures** that the current model cannot separate:

| XLS `Shape` | XLS rows | IGI splits into | Problem |
|---|---|---|---|
| `SQUARE` | 392 | `asscher` (522) + `square_cushion` (493) | Completely different price tiers — model conflates them |
| `OVAL` | 3,706 | `oval` (2,298) + `oval_modified_brilliant` (594) | Modified brilliant carries a different price multiplier |
| `CUSHION` | 665 | `cushion` (91) + `cushion_brilliant` (23) + `square_cushion` (255) + `cushion_modified_brilliant` (86) | 4 distinct sub-types with different aspect ratios and prices |
| `PEAR` | 2,188 | `pear_brilliant` (1,170) + `pear_modified_brilliant` (377) | ~25% of pears are mis-typed in the model |
| `HEART` | 862 | `heart_brilliant` (691) + `heart_modified_brilliant` (82) | Minor but real separation |
| `RADIANT` | 801 | IGI calls it `Cut Cornered Rectangular Modified Brilliant` | Shape confirmed, but IGI L/W ratio is more accurate |
| *(unknown)* | 219 (blank) | `flower_modified_brilliant` (287) | 287 flower cuts currently falling into fallback |

Additionally, the XLS `Table_Scale` and `Depth_Scale` fields are supplier-entered. IGI-certified `tablePct` and `depthPct` are authoritative. Of the 19,301 complete enrichment records, **100% have L/W ratio, table%, and depth%**.

---

## Coverage

| Scope | Total rows | Enriched (ok, complete) | Coverage |
|---|---|---|---|
| StarGems XLS | 28,394 | ~12,347 | ~43% |
| After full enrichment run | 28,394 | ~18,000–22,000 (est.) | ~65–78% |

Rows without enrichment fall back to XLS values — the model handles missings via median imputation, so partial coverage is fine.

---

## Implementation steps

### Step 1 — Verify enrichment is complete enough

```bash
python3 research/scripts/generate-igi-progress-doc.py
```

Check: StarGems `ok` ≥ ~18,000 (aiming for 65%+ coverage before retraining).

---

### Step 2 — Update `load_rows()` in `starsgem-mrpe-v2.py`

Join on `Reportno` (XLS column) → enrichment JSON key (bare digits).

```python
def load_enrichment():
    with open(os.path.join(DATA_DIR, "igi-report-enrichment.json")) as f:
        raw = json.load(f)
    # Normalize keys: strip prefix letters, keep digits only
    out = {}
    for key, val in raw.items():
        digits = re.sub(r"[^0-9]", "", key)
        if digits and val.get("status") == "ok" and val.get("enrichmentComplete"):
            out[digits] = val
    return out


def load_rows_enriched():
    enrichment = load_enrichment()
    wb = xlrd.open_workbook(XLS_FILE)
    ws = wb.sheet_by_name("Table")
    headers = [str(ws.cell_value(0, col)).strip() for col in range(ws.ncols)]

    raw_rows = []
    for idx in range(1, ws.nrows):
        raw = {headers[col]: ws.cell_value(idx, col) for col in range(ws.ncols)}
        carat = safe_float(raw.get("Carat"))
        price = safe_float(raw.get("SaleDollorPrice"))
        if not carat or carat <= 0 or not price or price <= 0:
            continue

        # Join enrichment
        report_digits = re.sub(r"[^0-9]", "", str(raw.get("Reportno", "")))
        igi = enrichment.get(report_digits, {})
        has_igi = bool(igi)

        length, width, height, ratio = parse_measurement(raw.get("Measurement"))
        internal_price = int(round(price * 170))

        # Shape: prefer IGI-certified shapeMapped, fall back to XLS
        shape_xls = norm_cat(raw.get("Shape"))
        shape_igi = igi.get("shapeMapped")  # e.g. 'square_cushion', 'asscher', 'oval'
        shape_final = norm_cat(shape_igi) if shape_igi else shape_xls

        # Measurements: prefer IGI-certified
        lw_ratio = igi.get("lwRatio") or ratio
        table_pct = igi.get("tablePct") or safe_float(raw.get("Table_Scale"))
        depth_pct = igi.get("depthPct") or safe_float(raw.get("Depth_Scale"))
        igi_l = igi.get("size1") or length
        igi_w = igi.get("size2") or width
        igi_h = igi.get("size3") or height

        row = {
            "rowNo": idx + 1,
            "Carat": carat,
            "Shape": shape_final,           # ← upgraded shape
            "Shape_XLS": shape_xls,         # keep original for ablation
            "Color": norm_cat(raw.get("Color")),
            "Clarity": norm_cat(raw.get("Clarity")),
            "Cut": norm_cat(igi.get("cut") or raw.get("Cut")),
            "Polish": norm_cat(igi.get("polish") or raw.get("Polish")),
            "Symmetry": norm_cat(igi.get("symmetry") or raw.get("Symmetry")),
            "Fluorescence": norm_cat(igi.get("fluorescence") or raw.get("Fluorescence")),
            "Report": "IGI",
            "TypeName": norm_cat(igi.get("growthMethod") or raw.get("TypeName")),
            # Numeric — prefer IGI-certified values
            "Table_Scale": table_pct,
            "Depth_Scale": depth_pct,
            "Length": igi_l,
            "Width": igi_w,
            "Height": igi_h,
            "LengthWidthRatio": lw_ratio,
            # New flags
            "IGI_Enriched": 1.0 if has_igi else 0.0,
            "IGI_IsPortuguese": 1.0 if igi.get("isPortuguese") else 0.0,
            "IGI_IsTypeIIa": 1.0 if (igi.get("diamondType") == "Type IIa") else 0.0,
            # Pricing
            "SaleDollorPrice": price,
            "internal_price": internal_price,
            "usd_per_ct": price / carat,
            "internal_rate_per_ct": internal_price / carat,
            "carat_bucket": carat_bucket(carat),
        }
        raw_rows.append(row)
    return raw_rows
```

---

### Step 3 — Add new features to the model

**New categorical features to add:**
```python
CATEGORICAL_FEATURES_V3 = [
    "Shape",          # ← now uses IGI shapeMapped (25 sub-types vs 13 XLS buckets)
    "Color", "Clarity", "Cut", "Polish", "Symmetry",
    "Fluorescence", "Report", "TypeName", "carat_bucket",
]
```

**New numeric features to add:**
```python
ADDITIONAL_NUMERIC_V3 = [
    "IGI_Enriched",       # 0/1 flag: row has IGI cert data
    "IGI_IsPortuguese",   # 0/1: Portuguese cut (premium)
    "IGI_IsTypeIIa",      # 0/1: Type IIa diamond (premium subset)
]
```

The `LengthWidthRatio`, `Table_Scale`, `Depth_Scale` fields already exist — they just get more accurate values from IGI.

---

### Step 4 — Retrain and compare

```bash
python3 research/scripts/starsgem-mrpe-v2.py
```

Run the S3 strategy (rate-per-carat target + MAE criterion) as baseline, then also test:
- **S3-enriched**: Same S3 config but with `load_rows_enriched()` feeding IGI shapes
- **S3-enriched + IGI flags**: S3-enriched + the 3 new numeric flags above

The MAPE comparison table should look like:

| Model | MAPE | Notes |
|---|---|---|
| S3 (current deployed) | 4.10% | XLS shapes only |
| S3-enriched | ??? | IGI shapes, no new flags |
| S3-enriched + flags | ??? | Best expected |

---

### Step 5 — Ablation: shape upgrade alone

To isolate how much the shape upgrade contributes vs the measurement upgrade:

```python
# In load_rows_enriched(): test with shape upgrade only (XLS measurements)
shape_final = norm_cat(shape_igi) if shape_igi else shape_xls
lw_ratio = ratio          # XLS measurement (not IGI)
table_pct = safe_float(raw.get("Table_Scale"))   # XLS
```

This tells you: is the MAPE gain from better shapes, better measurements, or both?

---

### Step 6 — Export and deploy

If enriched model beats 4.10% MAPE:

1. Export model: `starsgem-mrpe-v2.py` auto-exports to `research/data/starsgem-ml-extra-trees-model.json`
2. Bump version string in `index.html`:
   ```
   starsgem-ml-extra-trees-model.json?v=20260524-igi-enriched
   ```
3. The browser `predictStarsgemMl()` already handles `targetType: 'log_rate'` — no other changes needed.

---

## What to watch out for

**SQUARE disambiguation is the highest-impact change.** The 392 "SQUARE" rows in the XLS are split between `asscher` (Square Emerald Cut — step cut, higher price) and `square_cushion` (pillow shape — lower price). The model currently assigns them the same price signal. After enrichment, these separate cleanly.

**Flower cut coverage.** 287 "Flower Modified Brilliant" records are mapped to `shapeMapped: null` in the current parser. Before retraining, decide: add a `flower` shape class, or map to the nearest shape (`cushion`)? Flower cuts command a significant premium — don't lose this signal.

**Coverage drop-off.** Rows where the Reportno doesn't match enrichment (~35–57%) keep XLS values. This is fine — the model imputes and the categorical shape feature still works. But run the enrichment to completion before retraining for maximum benefit.

**Don't mix Messi.** The Messi stock list has overlapping IGI report numbers but different pricing. Keep the StarGems ML model trained exclusively on the StarGems XLS. Messi gets its own comp lookup path (comp-engine-v3.js), not this ML model.

---

## Summary of expected new features after enrichment

| Feature | Source before | Source after | Notes |
|---|---|---|---|
| `Shape` | XLS (13 values) | IGI shapeMapped (25 values) | Largest single gain |
| `LengthWidthRatio` | XLS measurement string | IGI certified | More accurate for fancy shapes |
| `Table_Scale` | XLS supplier entry | IGI tablePct | Authoritative |
| `Depth_Scale` | XLS supplier entry | IGI depthPct | Authoritative |
| `Cut` / `Polish` / `Symmetry` | XLS | IGI (when available) | Overrides XLS entry |
| `TypeName` (CVD/HPHT) | XLS TypeName | IGI growthMethod | Overrides XLS entry |
| `IGI_IsPortuguese` | *(new)* | IGI isPortuguese flag | Portuguese cut premium |
| `IGI_IsTypeIIa` | *(new)* | IGI diamondType | Type IIa premium |
| `IGI_Enriched` | *(new)* | 0/1 coverage flag | Lets model adjust for data quality |
