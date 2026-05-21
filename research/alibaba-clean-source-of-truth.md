# Alibaba Clean Diamond Comp Source of Truth

Created: 2026-05-21  
Source files: `data/1ct-2ct-fancy-cut-lab-grown-diamond-radiant-cut-d-vs1-ig-sku-prices.json`, `data/igi-certificate-fancy-light-pink-loose-lab-diamond-hpht--sku-prices.json`  
Purpose: keep one durable reference for Alibaba diamond comps that have enough captured evidence to use later in pricing logic.

## Inclusion Rules

A row is clean enough when it has:

- shape or cutting style, such as Round Brilliant, Pear, Radiant, Marquise, Oval
- color or color range, such as D, DE, DEF, Fancy Pink
- clarity or clarity range, such as VS1, VVS2, VVS-VS
- carat, carat band, or millimeter size
- actual SKU price, not only a page-wide range
- no obvious conflict like one constant price reused across incompatible SKUs

Cut terminology note: Alibaba often uses "cut" to mean shape. This document records `shape/cut style` separately from `cut grade`. A formal cut grade is only trusted when the listing says Excellent, 2EX, 3EX, Ideal, etc.

## Evidence Priority

1. Exact SKU selector row with selected options and price.
2. Visible key attributes or parsed page source, especially `Diamond Shape`, `White Diamond Color`, `Diamond Clarity`, and certificate fields.
3. Listing title and meta tags.
4. Manual override from the capture extension, only when marked as manual.

## Clean Exact Comps

### Round Brilliant, D/White, IGI - Wuzhou Messi Gems

Product ID: `1600612782670`  
URL: `https://www.alibaba.com/product-detail/Factory-Prices-Lab-Created-VVS-VS1_1600612782670.html`  
Supplier: Wuzhou Messi Gems Co., Ltd.  
Evidence: exact SKU rows in capture; user-provided page source shows `Diamond Shape = Round Brilliant Cut`, `White Diamond Color = D`, `Fancy Diamond Color = White`, `Certificate Type = IGI`.  
Use: primary factory-direct white round IGI ladder. High confidence.

| Carat | VS2 | VS1 | VVS2 | VVS1 |
|---:|---:|---:|---:|---:|
| 0.30 | $41 | $45 | $50 | $68 |
| 0.50 | $64 | $58 | $61 | $72 |
| 1.00 | $140 | $121.50 | $123.50 | $129 |
| 1.50 | $216 | $206 | $216.50 | $284.50 |
| 2.00 | $312 | $293.50 | $329.50 | $580 |
| 3.00 | $487 | $467.50 | $535 | $999 |
| 4.00 | $760 | $832 | $960 | $1,320 |
| 5.00 | $1,044 | $1,173 | $1,300 | $1,750 |
| 6.00 | $1,380 | $1,500 | $1,620 | $2,100 |

### Round, D Color, IGI - Corroborating Ladder

Product ID: `1601228209966`  
Evidence: SKU rows include `D Color Round`; title says Excellent Cut, VVS/VS, IGI certified.  
Use: secondary corroborating round ladder. High confidence for shape/color/price; watch promotion timing.

| Carat | VS2 | VS1 | VVS2 | VVS1 |
|---:|---:|---:|---:|---:|
| 0.30 | $41 | $45 | $50 | $68 |
| 0.50 | $57 | $58 | $59 | $70 |
| 1.00 | $110 | $112 | $115 | $125 |
| 1.50 | $168 | $170 | $184 | $270 |
| 2.00 | $260 | $265 | $300 | $458 |
| 3.00 | $440 | $450 | $535 | $980 |
| 4.00 | $700 | $750 | $960 | $1,320 |
| 5.00 | $1,100 | $1,300 | $1,400 | $1,750 |
| 6.00 | $1,320 | $1,500 | $1,620 | $2,100 |

### Round, DE/White, IGI - Starsgem

Product ID: `1601269837335`  
Evidence: title says Round HPHT/CVD Lab Grown Diamond IGI; SKU rows show `whiteDE` and clarity.  
Use: independent round white ladder. Medium-high confidence because color is a DE range, not a single grade.

| Carat | VS1 | VVS2 | VVS1 |
|---:|---:|---:|---:|
| 0.30 | $45 | $62 | $68 |
| 0.50 | $62 | $64 | $78 |
| 1.00 | $118 | $125 | $173 |
| 1.50 | $184 | $192 | $214 |
| 2.00 | $336 | $346 | $471 |
| 3.00 | $478 | $486 | - |
| 5.00 | $1,102 | $1,250 | - |

### Radiant, D/E/F, VS1, IGI

Product ID: `1601257609041`  
Evidence: title says Radiant, D E F, VS1, IGI; SKU rows include exact carat/color labels.  
Use: good radiant large-stone comp. High confidence.

| SKU | Price |
|---|---:|
| IGI 3ct F VS1 Radiant | $456 |
| IGI 3ct E VS1 Radiant | $465 |
| IGI 4ct E VS1 Radiant | $800 |
| IGI 4ct D VS1 Radiant | $820 |
| IGI 5ct E VS1 Radiant | $925 |
| IGI 5.1ct D VS1 Radiant | $1,020 |
| IGI 6.21ct F VS1 Radiant | $2,000 |

### Radiant, D, VS1, IGI

Product ID: `1600865913645`  
Evidence: title says Radiant Cut D VS1 IGI; rows include `1ct IGI/D/VS1/EX/EX` and `2ct ... D/VS1/EX/EX`.  
Use: exact 1-2ct radiant comp, but listing title includes "Ring", so treat as medium confidence until page confirms loose-only context.

| SKU | Price |
|---|---:|
| 1ct D VS1 EX/EX Radiant IGI | $269 |
| 2ct D VS1 EX/EX Radiant IGI | $569 |

### Pear, D/White, IGI - Messi

Product ID: `1601348731065`  
Evidence: title says Pear Shape, White Color D, IGI, Excellent Cut; SKU rows are exact D color and clarity.  
Use: primary pear D ladder. High confidence.

| Carat | VS2 | VS1 | VVS2 | VVS1 |
|---:|---:|---:|---:|---:|
| 1.00 | $150 | $155 | $160 | $175 |
| 1.50 | $210 | $218 | $225 | $330 |
| 2.00 | $290 | $310 | $340 | $520 |
| 2.50 | $363 | $388 | $425 | $650 |
| 3.00 | $465 | $495 | $540 | $840 |
| 4.00 | $640 | $680 | - | $1,200 |
| 5.00 | $800 | $850 | $1,100 | $1,500 |

### Pear, D/White, IGI - Starsgem

Product ID: `1601326262607`  
Evidence: title says Pear Cut IGI; SKU rows show White D, VS1/VVS2, exact carat.  
Use: independent pear corroboration. High confidence.

| Carat | VS1 | VVS2 |
|---:|---:|---:|
| 1.00 | $118 | $125 |
| 1.50 | $155 | - |
| 2.00 | $221 | $265 |
| 3.00 | $420 | $498 |
| 5.00 | $949 | $1,060 |

### Oval, DEF, VS1/VVS2, IGI

Product ID: `1600331442768`  
Evidence: title says Oval Cut, IGI, VVS2/VS1, DEF color; rows are carat bands.  
Use: size-band oval comp, not exact single-stone carat. Medium-high confidence.

| Carat Band | VS1 | VVS2 |
|---:|---:|---:|
| 1.0-1.1 | $150 | $155 |
| 1.5-1.59 | $221 | $231 |
| 2.0-2.1 | $320 | $325 |
| 3.0-3.1 | $430 | $475 |

### Marquise, D/DE/DEF, IGI

Use: marquise comps are clean, but several are color ranges or millimeter sizes. Keep exact D/DE rows higher confidence than DEF size rows.

| Product ID | Shape | Color | Clarity | Size | Price | Confidence |
|---|---|---|---|---:|---:|---|
| `1601744111777` | Marquise | D | VVS2 | 1ct | $190 | High |
| `1601744111777` | Marquise | D | VVS2 | 2ct | $380 | High |
| `1601744111777` | Marquise | D | VVS2 | 3ct | $600 | High |
| `1601384099752` | Marquise | DE | VS1 | 1ct | $198.38 | High |
| `1601384099752` | Marquise | DE | VS1 | 1.5ct | $245.98 | High |
| `1601384099752` | Marquise | DE | VS1 | 2ct | $417.91 | High |
| `1601384099752` | Marquise | DE | VS1 | 3ct | $681.09 | High |
| `1601384099752` | Marquise | DE | VVS2 | 1ct | $219.54 | High |
| `1601384099752` | Marquise | DE | VVS2 | 1.5ct | $264.50 | High |
| `1601384099752` | Marquise | DE | VVS2 | 2ct | $481.39 | High |
| `1601384099752` | Marquise | DE | VVS2 | 3ct | $905.91 | High |
| `1601402501696` | Marquise | DEF | VVS | 3.5x7mm / 0.3ct | $36 | Medium |
| `1601402501696` | Marquise | DEF | VVS | 4x8mm / 0.48ct | $58 | Medium |
| `1601402501696` | Marquise | DEF | VVS | 4.5x9mm / 0.64ct | $77 | Medium |
| `1601402501696` | Marquise | DEF | VVS | 5x10mm / 0.9ct | $108 | Medium |
| `1601402501696` | Marquise | DEF | VVS | 5.5x10mm / 1ct | $137 | Medium |

### Fancy Pink Mixed Shapes, IGI - Mishang Diamond

Product ID: `1601561025630`  
URL: `https://www.alibaba.com/product-detail/IGI-Certificate-Fancy-Light-Pink-Loose_1601561025630.html`  
Evidence: exact SKU rows from `data/igi-certificate-fancy-light-pink-loose-lab-diamond-hpht--sku-prices.json`; page attributes show lab-grown, IGI, Fancy color, Excellent cut grade, and certificate sample `LG555269066`.  
Use: medium-high confidence pink lab-grown IGI row comps. The page-level `Diamond Shape` says Radiant Cut, but the SKU row labels contain the actual row-level shapes; use the row labels for shape, color intensity, carat, and clarity.

| Shape | Fancy Color | Carat | Clarity | Cut Grade | Price | $/ct | Confidence |
|---|---|---:|---|---|---:|---:|---|
| Cushion | Fancy Pink | 4.13 | VS1 | Excellent | $1,471 | $356 | Medium-high |
| Princess | Fancy Light Pink | 3.03 | VS1 | Excellent | $1,126 | $372 | Medium-high |
| Heart | Fancy Vivid Pink | 2.08 | VVS2 | Excellent | $770 | $370 | Medium-high |
| Pear | Fancy Intense Pink | 1.55 | VS1 | Excellent | $534 | $345 | Medium-high |
| Emerald | Fancy Intense Pink | 1.06 | VS1 | Excellent | $331 | $312 | Medium-high |
| Radiant | Fancy Intense Brownish Pink | 0.89 | VS2 | Excellent | $262 | $294 | Medium-high |

## Clean But Broad Or Specialty

These can be used as guardrails, but not as exact one-to-one comps.

| Product ID | Listing | Why Broad |
|---|---|---|
| `1600092144781` | Messi pear 1-5ct, White, VS/VVS, Excellent | Rows captured with price but the exported rows lost per-row carat labels in some captures. Use product page again with v3 extension. |
| `10000030952345` | Round Portuguese Cut, DEF, VVS-VS | Portuguese cut is specialty; rows captured as repeated clarity labels without clean carat labels. |
| `1601132548922` | Fancy light pink, mixed fancy shapes | Uses `Diamond Cut` for shape/size labels; use only after recapture with page-source evidence. |

## Excluded Or Suspicious

Do not use these rows as exact comps without recapture or supplier quote.

| Product ID | Reason |
|---|---|
| `1601663842022` | Pink heart listing repeats $480 across incompatible clarity/cut combinations. Treat as broad page quote only. |
| `1601651233708` | Many SKU selections but no captured price rows. |
| `1601763180772` | Ring/mounted jewelry context; no reliable loose-stone exact row. |
| `1601706050088` | Ring listing context; no reliable loose-stone exact row. |
| `1601675586306` | Many captures but no reliable price rows. |
| `1601665263148` | Mixed Chinese option labels, no reliable price rows. |
| `1600196290282` | Only one color-level row; shape/carat not sufficiently captured. |
| `10000038133726` | One flat wholesale price for antique marquise; insufficient exact size evidence. |
| `12000002302055` | One 5ct Dutch marquise price; specialty style, not enough corroboration. |

## Recapture Checklist

For future captures, trust a row when the extension saves:

- `normalized.shape.value`
- `normalized.color.value`
- `normalized.clarity.value`
- `normalized.carat.value` or a row-level `priceRows[].carat`
- `normalized.certificate.type` when IGI is claimed
- `sourceContext.keyAttributes` with `Diamond Shape`, `White Diamond Color`, `Fancy Diamond Color`, or certificate fields when the title is vague

If any of those are missing, manually fill the prompt only when the value is visible on the page or certificate. Otherwise leave it blank and mark the row provisional.
