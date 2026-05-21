# Alibaba Clean Diamond Comp Source of Truth

Created: 2026-05-21  
Source files: `data/1ct-2ct-fancy-cut-lab-grown-diamond-radiant-cut-d-vs1-ig-sku-prices.json`, `data/igi-certificate-fancy-light-pink-loose-lab-diamond-hpht--sku-prices.json`, `data/starsgem-oval-diamante-1ct-2ct-3ct-d-vs1-vvs2-hpht-cvd-i-sku-prices.json`, `data/mishang-1ct-2ct-3ct-loose-lab-created-diamond-vs-vvs-exc-sku-prices.json`, `data/igi-certified-elongated-cushion-cut-lab-grown-diamond-1--sku-prices.json`, `data/hpht-cvd-loose-lab-grown-diamond-cushion-def-gh-vvs-vs-i-sku-prices.json`, `data/fancy-color-yellow-princess-cut-def-vvs-vs-1ct-2ct-3ct-4-sku-prices.json`, `data/in-stock-asscher-shape-igi-cvd-htpt-diamond-1ct-5ct-high-sku-prices.json`, `data/alibaba-com-manufacturers-suppliers-exporters-importers--sku-prices.json`, `data/0-3ct-0-5ct-1ct-1-5ct-2ct-3ct-4ct-cvd-diamond-starsgem-r-sku-prices.json`, `data/1ct-2ct-3ct-lab-loose-diamond-white-d-e-vvs-vs-igi-certi-sku-prices.json`, `data/portuguese-cut-1-00-carat-cvd-lab-grown-diamond-with-igi-sku-prices.json`  
Purpose: keep one durable reference for Alibaba diamond comps that have enough captured evidence to use later in pricing logic.

URL retention rule: every promoted product or product group should retain a `URL:` field that links back to the Alibaba page where the comp was found whenever the capture contains a URL or one can be reconstructed from `productId`. Prefer canonical product-detail URLs without tracking parameters, but never drop the page link entirely just because tracking cleanup is imperfect.

## Inclusion Rules

A row is clean enough when it has:

- shape or cutting style, such as Round Brilliant, Pear, Radiant, Marquise, Oval
- color or color range, such as D, DE, DEF, Fancy Pink
- clarity or clarity range, such as VS1, VVS2, VVS-VS
- carat, carat band, or millimeter size
- actual SKU price, not only a page-wide range
- source page URL or enough product identity to reconstruct it
- no obvious conflict like one constant price reused across incompatible SKUs

Cut terminology note: Alibaba often uses "cut" to mean shape. This document records `shape/cut style` separately from `cut grade`. A formal cut grade is only trusted when the listing says Excellent, 2EX, 3EX, Ideal, etc.

## Evidence Priority

1. Source URL plus product ID, so the original page can be revisited.
2. Exact SKU selector row with selected options and price.
3. Visible key attributes or parsed page source, especially `Diamond Shape`, `White Diamond Color`, `Diamond Clarity`, and certificate fields.
4. Listing title and meta tags.
5. Manual override from the capture extension, only when marked as manual.

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
URL: `https://www.alibaba.com/product-detail/Lab-Created-Diamond-HPHT-CVD-VVS_1601228209966.html`  
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
URL: `https://www.alibaba.com/product-detail/Starsgem-International-IGI-0-3ct-0_1601269837335.html`  
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

### Radiant Cut, D/White, VS/VVS, IGI - Messi Jewelry (Primary)

Product ID: `1601715356045`  
URL: `https://www.alibaba.com/product-detail/Wholesale-IGI-Certified-Fancy-Shape-1CT_1601715356045.html`  
Source file: `data/0-3ct-0-5ct-1ct-1-5ct-2ct-3ct-4ct-cvd-diamond-starsgem-r-sku-prices.json`  
Supplier: Messi Jewelry  
Evidence: 23 exact radiant SKU rows from a 136-snapshot multi-shape capture session; row labels use `Radiant Cut, X carat, D Color` with VS2/VS1/VVS2/VVS1 selectors. Page-level `Diamond Shape` and `normalized.shape` say Round Brilliant Cut on a multi-shape listing — use row labels as shape authority (same pattern as `1601561025630` pink mixed shapes).  
Use: **primary white radiant IGI ladder**. Resolves the prior clarity-spread gap. High confidence.

| Carat | VS2 | VS1 | VVS2 | VVS1 |
|---:|---:|---:|---:|---:|
| 1.00 | $130 | $135 | $140 | $190 |
| 1.50 | $180 | $188 | $195 | $285 |
| 2.00 | $270 | $280 | $300 | $480 |
| 3.00 | $465 | $480 | $570 | $690 |
| 4.00 | $720 | $740 | - | $1,120 |
| 5.00 | $900 | $925 | $1,100 | $1,400 |

**Clarity multiplier notes (D, 1-3ct anchors):**

| Step | VS2 → VS1 | VS1 → VVS2 | VVS2 → VVS1 |
|---|---:|---:|---:|
| 1.00ct | +3.8% | +3.7% | +35.7% |
| 1.50ct | +4.4% | +3.7% | +46.2% |
| 2.00ct | +3.7% | +7.1% | +60.0% |
| 3.00ct | +3.2% | +18.8% | +21.1% |

**Cross-shape Messi pricing check (same capture file, same supplier):** At 1.00ct D VS1, radiant `$135` matches princess `$135`, cushion `$135`, and asscher `$135` from their respective primary ladders — supports treating this as Messi factory family pricing, not a radiant outlier.

### Radiant Cut, D/E/F, VS1, IGI - Large-Stone Corroboration

Product ID: `1601257609041`  
URL: `https://www.alibaba.com/product-detail/IGI-Certified-3ct-4ct-5ct-6ct_1601257609041.html`  
Source files: `data/1ct-2ct-fancy-cut-lab-grown-diamond-radiant-cut-d-vs1-ig-sku-prices.json`, `data/0-3ct-0-5ct-1ct-1-5ct-2ct-3ct-4ct-cvd-diamond-starsgem-r-sku-prices.json` (5ct D VS1 corroboration)  
Evidence: prior capture with explicit `IGI Xct COLOR VS1 Radiant` row labels; independent product from Messi multi-shape listing.  
Use: corroboration for **VS1-only** at 3ct+ and single-grade E/F; keep alongside primary ladder, do not replace it.

| Carat | Color | VS1 | vs Primary D VS1 | Confidence |
|---:|---|---:|---|---|
| 3.00 | F | $456 | -5.0% vs $480 | Medium-high |
| 3.00 | E | $465 | -3.1% vs $480 | Medium-high |
| 4.00 | E | $800 | +8.1% vs $740 | Medium-high |
| 4.00 | D | $820 | +10.8% vs $740 | Medium-high |
| 5.00 | E | $925 | **match** primary D $925 | High |
| 5.10 | D | $1,020 | +10.3% vs $925 | Medium-high |
| 6.21 | F | $2,000 | (no primary row) | Medium |

### Radiant Cut, D, VS1, IGI - Prior Ring-Context Capture (Superseded for 1-2ct)

Product ID: `1600865913645`  
URL: `https://www.alibaba.com/product-detail/1ct-2ct-Fancy-Cut-Lab-Grown_1600865913645.html`  
Source file: `data/1ct-2ct-fancy-cut-lab-grown-diamond-radiant-cut-d-vs1-ig-sku-prices.json`  
Evidence: earlier capture with `1ct`/`2ct` D VS1 EX/EX rows; listing title includes **Ring**.  
Use: retain for audit trail only. Prices run ~2× the Messi primary ladder ($269 vs $135 at 1ct; $569 vs $280 at 2ct). **Do not use as primary radiant anchor** unless ring-isolated loose pricing is confirmed.

| SKU | Price | vs Primary D VS1 | Confidence |
|---|---:|---:|---|
| 1ct D VS1 EX/EX Radiant IGI | $269 | +99% | Low / broad |
| 2ct D VS1 EX/EX Radiant IGI | $569 | +103% | Low / broad |

Fancy pink radiant row (`Radiant Fancy Intense Brownish Pink 0.89ct VS2`, $262) remains under Fancy Pink Mixed Shapes from `1601561025630`.

### Pear, D/White, IGI - Messi

Product ID: `1601348731065`  
URL: `https://www.alibaba.com/product-detail/White-Color-D-VVS-VS-Pear_1601348731065.html`  
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
URL: `https://www.alibaba.com/product-detail/Starsgem-Pear-Cut-IGI-Certificated-Diamond_1601326262607.html`  
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
URL: `https://www.alibaba.com/product-detail/Wholesale-Oval-Cut-1ct-3ct-IGI_1600331442768.html`  
Evidence: title says Oval Cut, IGI, VVS2/VS1, DEF color; rows are carat bands.  
Use: size-band oval comp, not exact single-stone carat. Medium-high confidence.

| Carat Band | VS1 | VVS2 |
|---:|---:|---:|
| 1.0-1.1 | $150 | $155 |
| 1.5-1.59 | $221 | $231 |
| 2.0-2.1 | $320 | $325 |
| 3.0-3.1 | $430 | $475 |

### Oval, D/White, IGI - Messi

Product ID: `1601628467240`  
URL: `https://www.alibaba.com/product-detail/Wholesale-IGI-Loose-Lab-Created-Diamond_1601628467240.html`  
Source file: `data/starsgem-oval-diamante-1ct-2ct-3ct-d-vs1-vvs2-hpht-cvd-i-sku-prices.json`  
Supplier: Messi Jewelry  
Evidence: exact SKU rows show `1ct OV IGI` through `5ct OV IGI`; key attributes show `Diamond Shape = Oval Cut`, `White Diamond Color = D`, lab-grown, and IGI in title/certificate fields. Product `1601628853707` from the same capture corroborates the 1ct, 2ct, 3ct, 4ct, and 5ct prices.  
Corroborating URL (`1601628853707`): `https://www.alibaba.com/product-detail/Lab-Created-IGI-Certified-1CT-2CT_1601628853707.html`  
Use: primary exact D oval ladder. High confidence.

| Carat | VS2 | VS1 | VVS2 | VVS1 |
|---:|---:|---:|---:|---:|
| 1.00 | $155 | $175 | $185 | $227 |
| 1.50 | $237 | $260 | $275 | $337 |
| 2.00 | $345 | $376 | $406 | $508 |
| 2.50 | $430 | $468 | $506 | $633 |
| 3.00 | $515 | $561 | $606 | $848 |
| 4.00 | $806 | $846 | $927 | $1,209 |
| 5.00 | $1,006 | $1,056 | $1,157 | $1,509 |

### Oval, D/White, IGI - Mishang Diamond

Product ID: `1601407133783`  
URL: `https://www.alibaba.com/product-detail/Popular-1-5ct-VVS1-VVS2-VS1_1601407133783.html`  
Source file: `data/starsgem-oval-diamante-1ct-2ct-3ct-d-vs1-vvs2-hpht-cvd-i-sku-prices.json`  
Supplier: Mishang Diamond  
Evidence: exact SKU rows include row-level `Oval Cut`, exact carat, and `D Color`; key attributes show `Diamond Shape = Oval Cut`, `White Diamond Color = D`, lab-grown, and IGI.  
Use: independent exact D oval ladder. High confidence.

| Carat | VS2 | VS1 | VVS2 | VVS1 |
|---:|---:|---:|---:|---:|
| 1.00 | $155 | $160 | $165 | $180 |
| 1.50 | $214 | $222 | $230 | $337 |
| 2.00 | $294 | $315 | $345 | $528 |
| 2.50 | $367 | $392 | $430 | $658 |
| 3.00 | $470 | $500 | $545 | $848 |
| 4.00 | $645 | $685 | $887 | $1,209 |
| 5.00 | $805 | $855 | $1,107 | $1,509 |

### Oval, D/White, IGI - Starsgem

Product ID: `1601392715631`  
URL: `https://www.alibaba.com/product-detail/Starsgem-Oval-Diamante-1ct-2ct-3ct_1601392715631.html`  
Source file: `data/starsgem-oval-diamante-1ct-2ct-3ct-d-vs1-vvs2-hpht-cvd-i-sku-prices.json`  
Supplier: Starsgem  
Evidence: title says `Starsgem Oval Diamante 1ct 2ct 3ct D VS1 VVS2 HPHT CVD IGI Certified Lab Grown Diamond`; selected options show `White D`, exact carat, and VS1/VVS2; key attributes show `Diamond Shape = Oval Cut`, `White Diamond Color = D`, lab-grown, and IGI.  
Use: independent 1-3ct D oval corroboration. High confidence.

| Carat | VS1 | VVS2 |
|---:|---:|---:|
| 1.00 | $150 | $157 |
| 1.50 | $206 | $217 |
| 2.00 | $306 | $315 |
| 3.00 | $396 | $493 |

### Oval, D/E/DE White, IGI - Starsgem

Product IDs: `1601296278910`, `1601299293067`  
URLs: `https://www.alibaba.com/product-detail/Loose-Lab-Diamond-IGI-Certificate-1ct_1601296278910.html`, `https://www.alibaba.com/product-detail/Oval-Brilliant-Cut-1ct-3ct-HPHT_1601299293067.html`  
Source file: `data/starsgem-oval-diamante-1ct-2ct-3ct-d-vs1-vvs2-hpht-cvd-i-sku-prices.json`  
Supplier: Starsgem  
Evidence: exact SKU rows from `1601296278910` include row-level carat and D/E color; `1601299293067` corroborates DE band prices. Certificate fields are messier on `1601296278910` (`Certificate Type = None`, `Certificate NO. = IGI`), so use as medium-high corroboration rather than the primary IGI anchor.  
Use: single-grade D/E and DE-band oval guardrail.

| Product ID | Color | Carat/Band | VS1 | VVS2 | Confidence |
|---|---|---:|---:|---:|---|
| `1601296278910` | D | 1.00 | $146 | $153 | Medium-high |
| `1601296278910` | E | 1.00 | $130 | $150 | Medium-high |
| `1601296278910` | D | 2.00 | $325 | $345 | Medium-high |
| `1601296278910` | E | 2.00 | - | $328 | Medium-high |
| `1601296278910` | D | 3.00 | $452 | $510 | Medium-high |
| `1601296278910` | E | 3.00 | $435 | $465 | Medium-high |
| `1601299293067` | DE | 1.0-1.1 | $150 | $155 | Medium |
| `1601299293067` | DE | 1.5-1.59 | $221 | $231 | Medium |
| `1601299293067` | DE | 2.0-2.1 | $318 | $324 | Medium |

### Oval, D, VVS2, IGI - Starsgem Corroboration

Product ID: `1601742375662`  
URL: `https://www.alibaba.com/product-detail/Starsgem-Loose-Diamond-IGI-Certificates-1_1601742375662.html`  
Source file: `data/starsgem-oval-diamante-1ct-2ct-3ct-d-vs1-vvs2-hpht-cvd-i-sku-prices.json`  
Supplier: Starsgem  
Evidence: exact SKU rows with `D color`, carat, and VVS2; title confirms oval IGI loose diamond.  
Use: independent VVS2 oval corroboration. High confidence for captured carats; capture also includes VS1/VS2/E rows not fully promoted here.

| Carat | VVS2 | Confidence |
|---:|---:|---|
| 1.00 | $149 | High |
| 1.50 | $228 | High |
| 2.00 | $330 | High |
| 2.50 | $475 | High |
| 3.00 | $470 | High |

### Moval (Movel Cut), D/White, VS1/VVS2, IGI - OM GEMS

Product ID: `10000040923161`  
URL: `https://www.alibaba.com/product-detail/Popular-1-4ct-VVS-VS-Moval_10000040923161.html`  
Source file: `data/starsgem-oval-diamante-1ct-2ct-3ct-d-vs1-vvs2-hpht-cvd-i-sku-prices.json`  
Supplier: OM GEMS  
Evidence: exact SKU rows with `Design = Movel Cut`, D color, VS1/VVS2, and 1.0–3.0 CT selectors; title and keywords say **Moval** / Movel Cut. Key attributes show `Diamond Shape = Oval Cut` but `Shape = Movel cut` — **do not merge into the oval ladders above**; treat as marquise–oval hybrid (moval). Page lists `Diamond Enhancements = Laser Drilling`; verify IGI report before using as a deal anchor.  
Use: primary exact D moval ladder 1–3ct. Medium-high confidence (single supplier, shape-label mismatch, enhancement flag).

| Carat | VS1 | VVS2 | Confidence |
|---:|---:|---:|---|
| 1.00 | $229 | $248 | Medium-high |
| 2.00 | $458 | $498 | Medium-high |
| 3.00 | $689 | $748 | Medium-high |

**vs oval (same capture session, D 1ct):** Starsgem oval `1601392715631` = `$150` VS1 / `$157` VVS2; Messi oval `1601628467240` = `$175` VS1 / `$185` VVS2. OM GEMS moval runs **~35–58% above** those oval anchors at 1ct — consistent with specialty-cut / non-standard-shape pricing, not a drop-in oval substitute.

### Moval, E, VS1, IGI - Corroboration

Product ID: `10000041334377`  
URL: `https://www.alibaba.com/product-detail/Eco-Friendly-3-03-CT-Moval_10000041334377.html`  
Source file: `data/starsgem-oval-diamante-1ct-2ct-3ct-d-vs1-vvs2-hpht-cvd-i-sku-prices.json`  
Evidence: single exact row, E color, 3.03ct, VS1, `Design = Moval Cut Lab Grown Diamond`; title says Moval Cut.  
Use: specialty-size E moval guardrail only. Medium confidence.

| Carat | Color | Clarity | Price | Confidence |
|---:|---|---|---|---|
| 3.03 | E | VS1 | $850 | Medium |

### Oval, D, 1ct, IGI - Loose Lab Corroboration

Product ID: `1601601861985`  
URL: `https://www.alibaba.com/product-detail/Loose-Lab-Diamond-IGI-Certificate-1ct_1601601861985.html`  
Source file: `data/starsgem-oval-diamante-1ct-2ct-3ct-d-vs1-vvs2-hpht-cvd-i-sku-prices.json`  
Evidence: exact SKU rows for 1ct D/E with VVS1/VVS2 from one capture; MOQ **2 pieces** on listing.  
Use: 1ct oval color/clarity spread corroboration only — not a primary ladder. Medium confidence.

| Carat | Color | Clarity | Price | Confidence |
|---:|---|---|---:|---|
| 1.00 | D | VVS1 | $220 | Medium |
| 1.00 | D | VVS2 | $198 | Medium |
| 1.00 | E | VVS1 | $198 | Medium |
| 1.00 | E | VVS2 | $168 | Medium |

### Marquise Cut, D/White, VS/VVS, IGI - Mishang Diamond (Primary)

Product ID: `1601406519145`  
URL: `https://www.alibaba.com/product-detail/MiShang-Excellent-Marquise-Cut-D-Color_1601406519145.html`  
Source file: `data/1ct-2ct-3ct-lab-loose-diamond-white-d-e-vvs-vs-igi-certi-sku-prices.json`  
Supplier: Mishang Diamond  
Evidence: 20 exact SKU snapshots with row-level `D Clolor XCT Marquise Cut` labels and VS2/VS1/VVS2/VVS1 selectors; key attributes show `Diamond Shape = Marquise Cut`, `White Diamond Color = D`, lab-grown, `Certificate Type = IGI`, sample cert `LG597394175`. Row labels win over page `Fancy Diamond Color = Fancy`.  
Use: **primary white marquise IGI ladder**. Resolves the prior 1-3ct clarity-spread gap. High confidence.

| Carat | VS2 | VS1 | VVS2 | VVS1 |
|---:|---:|---:|---:|---:|
| 1.00 | $160 | $175 | $185 | $225 |
| 1.50 | $233 | $248 | $278 | $338 |
| 2.00 | $340 | $360 | $400 | $560 |
| 2.50 | $425 | $450 | $500 | $700 |
| 3.00 | $555 | $600 | $660 | $1,050 |

**Clarity multiplier notes (D, 1-3ct anchors):**

| Step | VS2 → VS1 | VS1 → VVS2 | VVS2 → VVS1 |
|---|---:|---:|---:|
| 1.00ct | +9.4% | +5.7% | +21.6% |
| 1.50ct | +6.4% | +12.1% | +21.6% |
| 2.00ct | +5.9% | +11.1% | +40.0% |
| 3.00ct | +8.1% | +10.0% | +59.1% |

**Cross-shape Messi pricing check (same-day capture, `data/0-3ct-0-5ct-1ct-1-5ct-2ct-3ct-4ct-cvd-diamond-starsgem-r-sku-prices.json`):** Messi multi-shape listing `1601715356045` includes Round/Oval/Radiant/Pear/Heart/Princess but **no Marquise Cut selector** — marquise must be captured on dedicated listings. At 1.00ct D VS1, Messi radiant/princess/cushion/asscher = `$135` while this Mishang marquise = `$175` (+29.6%). Treat marquise as its own ladder, not a Messi-family shape clone.

### Marquise Cut, D, VVS2, IGI - Starsgem (VVS2-Only Ladder)

Product ID: `1601744111777`  
URL: `https://www.alibaba.com/product-detail/IGI-Certified-Lab-Diamond-Marquise-Cut_1601744111777.html`  
Source file: `data/1ct-2ct-3ct-lab-loose-diamond-white-d-e-vvs-vs-igi-certi-sku-prices.json`  
Supplier: starsgem (title/branding)  
Evidence: one capture with VVS2 selected and a three-row carat ladder (`1CT`/`2CT`/`3CT`) at `$190`/`$380`/`$600`; page attributes show Marquise Cut, D, IGI.  
Use: independent VVS2-only corroboration for 1-3ct. High confidence for captured grades; does not replace the full-clarity primary ladder.

| Carat | VVS2 | vs Primary D VVS2 | Confidence |
|---:|---:|---:|---|
| 1.00 | $190 | +2.7% | High |
| 2.00 | $380 | -5.0% | High |
| 3.00 | $600 | -9.1% | High |

### Marquise Cut, DE White, VS1/VVS2, IGI - Starsgem RTS

Product ID: `1601384099752`  
URL: `https://www.alibaba.com/product-detail/RTS-Starsgem-1ct-Marquise-Lab-Grown_1601384099752.html`  
Source files: `data/1ct-2ct-3ct-lab-loose-diamond-white-d-e-vvs-vs-igi-certi-sku-prices.json`, `data/1ct-2ct-fancy-cut-lab-grown-diamond-radiant-cut-d-vs1-ig-sku-prices.json`  
Evidence: exact row-level `1carat`/`1.5carat`/`2carat`/`3carat` prices with DE White page color and VS1/VVS2 selectors.  
Use: DE-range marquise guardrail. High confidence for row prices; color is a range, not single D.

| Carat | VS1 | VVS2 | vs Primary D VS1 | vs Primary D VVS2 | Confidence |
|---:|---:|---:|---:|---:|---|
| 1.00 | $198.38 | $219.54 | +13.4% | +18.7% | High |
| 1.50 | $245.98 | $264.50 | -0.8% | -4.9% | High |
| 2.00 | $417.91 | $481.39 | +16.1% | +20.3% | High |
| 3.00 | $681.09 | $905.91 | +13.5% | +37.3% | High |

### Marquise Cut, D/E, VS1/VVS2, IGI - Corroborating Listings

Source file: `data/1ct-2ct-3ct-lab-loose-diamond-white-d-e-vvs-vs-igi-certi-sku-prices.json`  
Use: secondary corroboration. `1601645026580` duplicates Mishang primary prices exactly (same VS2-VVS1 matrix through 2.5ct). `1601651318383` adds thin D/E rows at 1-3ct.

| Product ID | URL | Carat | Color | VS1 | VVS2 | Confidence |
|---|---|---:|---|---:|---:|---|
| `1601645026580` | `https://www.alibaba.com/product-detail/CVD-HPHT-1ct-1-5ct-2ct_1601645026580.html` | 1.00 | D | $175 | $185 | High |
| `1601645026580` | `https://www.alibaba.com/product-detail/CVD-HPHT-1ct-1-5ct-2ct_1601645026580.html` | 2.50 | D | $450 | $500 | High |
| `1601651318383` | `https://www.alibaba.com/product-detail/1CT-2CT-3CT-Lab-Loose-Diamond_1601651318383.html` | 1.00 | D | $193.50 | $216 | Medium-high |
| `1601651318383` | `https://www.alibaba.com/product-detail/1CT-2CT-3CT-Lab-Loose-Diamond_1601651318383.html` | 1.00 | E | $189 | $193.50 | Medium-high |
| `1601651318383` | `https://www.alibaba.com/product-detail/1CT-2CT-3CT-Lab-Loose-Diamond_1601651318383.html` | 2.00 | D | $441 | $522 | Medium-high |
| `1601651318383` | `https://www.alibaba.com/product-detail/1CT-2CT-3CT-Lab-Loose-Diamond_1601651318383.html` | 3.00 | D | $630 | $738 | Medium-high |

### Marquise Cut, DEF, VVS, IGI - Millimeter Sizes

Product ID: `1601402501696`  
URL: `https://www.alibaba.com/product-detail/Wholesale-CVD-HPHT-0-03CT-1_1601402501696.html`  
Source file: `data/1ct-2ct-fancy-cut-lab-grown-diamond-radiant-cut-d-vs1-ig-sku-prices.json`  
Evidence: mm-based selector rows with DEF color and VVS clarity band.  
Use: small-size DEF marquise guardrail. Medium confidence — size is millimeter/carat hybrid, not a standard 1.00ct exact row.

| Size | Price | Confidence |
|---|---:|---|
| 3.5x7mm / 0.3ct | $36 | Medium |
| 4x8mm / 0.48ct | $58 | Medium |
| 4.5x9mm / 0.64ct | $77 | Medium |
| 5x10mm / 0.9ct | $108 | Medium |
| 5.5x10mm / 1ct | $137 | Medium |

### Emerald Cut, D/E/F, VS/VVS, IGI - Goldleaf

Product ID: `1601645396114`  
URL: `https://www.alibaba.com/product-detail/IGI-Certified-Emerald-Cut-Lab-Grown_1601645396114.html`  
Source file: `data/mishang-1ct-2ct-3ct-loose-lab-created-diamond-vs-vvs-exc-sku-prices.json`  
Supplier: Goldleaf  
Evidence: exact SKU rows with row-level `D Color Xct IGI` / `E Color` / `F Color` labels and VS2/VS1/VVS2/VVS1 selectors; key attributes show `Diamond Shape = Emerald Cut`, lab-grown, `Certificate Type = IGI`, sample cert `20251212082`.  
Use: primary white emerald IGI ladder. High confidence for D; medium-high for E/F because page-level `White Diamond Color` stays D while row labels carry E/F.

| Carat | VS2 | VS1 | VVS2 | VVS1 |
|---:|---:|---:|---:|---:|
| 1.00 | $135 | $134 | $142 | $167 |
| 1.50 | $245 | $213 | $218 | $323 |
| 2.00 | $306 | $308 | $319 | $520 |
| 3.00 | $533 | $554 | $630 | $941 |
| 4.00 | $934 | $819 | $913 | - |
| 5.00 | $1,016 | $1,005 | $1,076 | $2,010 |
| 6.00 | $1,495 | $1,649 | $1,801 | - |
| 7.00 | - | $1,928 | $2,229 | $2,432 |

### Emerald Cut, D, VS/VVS, IGI - Corroborating Listings

Source file: `data/mishang-1ct-2ct-3ct-loose-lab-created-diamond-vs-vvs-exc-sku-prices.json`  
Use: independent emerald corroboration. High confidence at 1ct across four Mishang/Goldleaf listings; `1601718421551` adds 1.5-5ct D rows.

| Product ID | URL | Supplier | Carat | VS2 | VS1 | VVS2 | VVS1 | Confidence |
|---|---|---|---:|---:|---:|---:|---:|---|
| `1601414377217` | `https://www.alibaba.com/product-detail/Mishang-1ct-2ct-3ct-Loose-Lab_1601414377217.html` | Mishang | 1.00 | $130 | $135 | $140 | $190 | High |
| `1601360989867` | `https://www.alibaba.com/product-detail/Mishang-Excellent-Step-Cut-Loose-Lab_1601360989867.html` | Mishang | 1.00 | $130 | $135 | $140 | - | High |
| `1601718421551` | `https://www.alibaba.com/product-detail/IGI-Certificate-Excellent-Cut-1CT-2CT_1601718421551.html` | Mishang | 1.00 | $130 | $135 | $140 | $190 | High |
| `1601718421551` | `https://www.alibaba.com/product-detail/IGI-Certificate-Excellent-Cut-1CT-2CT_1601718421551.html` | Mishang | 1.50 | $180 | $188 | $195 | $285 | High |
| `1601718421551` | `https://www.alibaba.com/product-detail/IGI-Certificate-Excellent-Cut-1CT-2CT_1601718421551.html` | Mishang | 2.00 | $270 | $280 | $300 | $480 | High |
| `1601718421551` | `https://www.alibaba.com/product-detail/IGI-Certificate-Excellent-Cut-1CT-2CT_1601718421551.html` | Mishang | 3.00 | $465 | $480 | $570 | $690 | High |
| `1601736826020` | `https://www.alibaba.com/product-detail/IGI-Certified-Lab-Diamond-DE-Color_1601736826020.html` | Mishang | 1.00 | - | - | $125 | - | Medium-high |
| `1601736826020` | `https://www.alibaba.com/product-detail/IGI-Certified-Lab-Diamond-DE-Color_1601736826020.html` | Mishang | 1.50 | - | - | $165 | - | Medium-high |
| `1601736826020` | `https://www.alibaba.com/product-detail/IGI-Certified-Lab-Diamond-DE-Color_1601736826020.html` | Mishang | 2.00 | - | - | $295 | - | Medium-high |
| `1601405166656` | `https://www.alibaba.com/product-detail/IGI-Certificate-CVD-HPHT-1ct-3ct_1601405166656.html` | Mishang | 1.00 | $153.90 | $180.90 | $205.20 | - | Medium-high |

### Cushion Cut, D/White, VS/VVS, IGI - Messi Gems

Product ID: `1601766186855`  
URL: `https://www.alibaba.com/product-detail/Messi-Gems-IGI-Certificate-1CT-1_1601766186855.html`  
Source file: `data/igi-certified-elongated-cushion-cut-lab-grown-diamond-1--sku-prices.json`  
Supplier: Messi Jewelry  
Evidence: exact SKU rows with `D Color Xct IGI Cushion Cut` labels and VS2/VS1/VVS2/VVS1 selectors; key attributes show `Diamond Shape = Cushion Cut`, `White Diamond Color = D`, lab-grown, `Certificate Type = IGI`.  
Use: primary white cushion IGI ladder. High confidence.

| Carat | VS2 | VS1 | VVS2 | VVS1 |
|---:|---:|---:|---:|---:|
| 1.00 | $130 | $135 | $140 | $190 |
| 1.50 | $195 | $203 | $210 | $285 |
| 2.00 | $310 | $320 | $340 | $460 |
| 2.50 | $388 | $400 | $425 | $575 |
| 3.00 | $480 | $510 | $540 | $690 |
| 4.00 | $760 | $800 | - | $1,000 |
| 5.00 | $1,000 | $1,050 | $1,100 | $1,250 |

### Cushion Cut, D, VS/VVS, IGI - Corroborating Listings

Source file: `data/igi-certified-elongated-cushion-cut-lab-grown-diamond-1--sku-prices.json`  
Use: independent 1ct D cushion corroboration across three listings; aligns closely with Messi primary ladder.

| Product ID | Supplier | URL | Carat | VS2 | VS1 | VVS2 | VVS1 | Confidence |
|---|---|---|---:|---:|---:|---:|---:|---|
| `10000014195390` | Mishang | `https://www.alibaba.com/product-detail/Mishang-CVD-HPHT-Cushion-Cut-Lab_10000014195390.html` | 1.00 | $130 | $135 | $140 | $190 | High |
| `1601412225431` | Mishang | `https://www.alibaba.com/product-detail/MiShang-D-Color-1Carat-2Carat-3Carat_1601412225431.html` | 1.00 | $130 | $135 | $140 | $190 | High |
| `1601585632323` | Starsgem | `https://www.alibaba.com/product-detail/Starsgem-International-IGI-Certificate-Cushion-Cut_1601585632323.html` | 1.00 | - | $125 | - | - | Medium-high |

### Elongated Cushion Cut, E, VS/VVS2, IGI

Product ID: `10000030984628`  
URL: `https://www.alibaba.com/product-detail/IGI-Certified-Elongated-Cushion-Cut-Lab_10000030984628.html`  
Source file: `data/igi-certified-elongated-cushion-cut-lab-grown-diamond-1--sku-prices.json`  
Evidence: title says Elongated Cushion Cut, E color, IGI; exact row-level carat and clarity with Excellent cut grade on selector.  
Use: E-color elongated cushion ladder. Medium-high confidence; single product only.

| Carat | VS1 | VVS2 | Confidence |
|---:|---:|---:|---|
| 1.00 | $139 | $149 | Medium-high |
| 2.00 | $310 | $325 | Medium-high |
| 3.00 | $595 | $605 | Medium-high |
| 4.00 | $695 | $695 | Medium-high |

### Princess Cut, D/White, VS/VVS, IGI - Messi Jewelry

Product ID: `1601764885212`  
URL: `https://www.alibaba.com/product-detail/Manufacture-Wholesale-1-5CT-DEF-IGI_1601764885212.html`  
Source file: `data/fancy-color-yellow-princess-cut-def-vvs-vs-1ct-2ct-3ct-4-sku-prices.json`  
Supplier: Messi Jewelry  
Evidence: exact SKU rows with `D Color Xct IGI Princess Cut` labels and VS2/VS1/VVS2/VVS1 selectors; key attributes show `Diamond Shape = Princess Cut`, `White Diamond Color = D`, lab-grown, `Certificate Type = IGI`.  
Use: primary white princess IGI ladder. High confidence.

| Carat | VS2 | VS1 | VVS2 | VVS1 |
|---:|---:|---:|---:|---:|
| 1.00 | $130 | $135 | $140 | $190 |
| 1.50 | $195 | $203 | $210 | $285 |
| 2.00 | $310 | $320 | $340 | $460 |
| 2.50 | $388 | $400 | $425 | $575 |
| 3.00 | $480 | $510 | $540 | $690 |
| 4.00 | $760 | $800 | - | $1,000 |
| 5.00 | $1,000 | $1,050 | - | $1,250 |

### Princess Cut, D, VS/VVS, IGI - Corroborating Listings

Source file: `data/fancy-color-yellow-princess-cut-def-vvs-vs-1ct-2ct-3ct-4-sku-prices.json`  
Use: independent princess corroboration. 1ct quad-clarity rows align with Messi primary; `10000042621044` adds VS1-only 1-5ct ladder with `Design = Princess` on the selector despite page `normalized.shape` showing Round.

| Product ID | URL | Carat | VS2 | VS1 | VVS2 | VVS1 | Confidence |
|---|---|---:|---:|---:|---:|---:|---|
| `10000014190420` | `https://www.alibaba.com/product-detail/IGI-Certificate-Lab-Created-Diamond-1ct_10000014190420.html` | 1.00 | $130 | $135 | $140 | $190 | High |
| `1601715266105` | `https://www.alibaba.com/product-detail/Lab-Grown-Diamond-Princess-Cut-IGI_1601715266105.html` | 1.00 | - | $163 | - | - | Medium-high |
| `1601715266105` | `https://www.alibaba.com/product-detail/Lab-Grown-Diamond-Princess-Cut-IGI_1601715266105.html` | 2.00 | - | $346 | - | - | Medium-high |
| `1601715266105` | `https://www.alibaba.com/product-detail/Lab-Grown-Diamond-Princess-Cut-IGI_1601715266105.html` | 3.00 | - | $551 | - | - | Medium-high |
| `10000042621044` | `https://www.alibaba.com/product-detail/IGI-Certified-1-00-5-00_10000042621044.html` | 1.00 | - | $175 | - | - | Medium-high |
| `10000042621044` | `https://www.alibaba.com/product-detail/IGI-Certified-1-00-5-00_10000042621044.html` | 2.00 | - | $285 | - | - | Medium-high |
| `10000042621044` | `https://www.alibaba.com/product-detail/IGI-Certified-1-00-5-00_10000042621044.html` | 3.00 | - | $470 | - | - | Medium-high |
| `10000042621044` | `https://www.alibaba.com/product-detail/IGI-Certified-1-00-5-00_10000042621044.html` | 4.00 | - | $865 | - | - | Medium-high |
| `10000042621044` | `https://www.alibaba.com/product-detail/IGI-Certified-1-00-5-00_10000042621044.html` | 5.00 | - | $910 | - | - | Medium-high |

### Princess Cut, DE White, VS/VVS2, IGI - Carat Bands

Product ID: `1601648808956`  
URL: `https://www.alibaba.com/product-detail/Loose-Princess-Cut-1-2ct-Lab_1601648808956.html`  
Source file: `data/fancy-color-yellow-princess-cut-def-vvs-vs-1ct-2ct-3ct-4-sku-prices.json`  
Evidence: row-level carat bands in Chinese selector `钻石重量` with DE White color and VS1/VVS2; title confirms princess cut.  
Use: DE-band princess guardrail. Medium confidence.

| Carat Band | VS1 | VVS2 | Confidence |
|---|---:|---:|---|
| 1.0-1.1ct | $128 | $130 | Medium |
| 1.5-1.59ct | $189 | $205 | Medium |
| 2.0-2.1ct | $265 | $280 | Medium |

### Princess Cut, E, VS/VVS, IGI - 1ct Anchor

Product ID: `1601682207347`  
URL: `https://www.alibaba.com/product-detail/IGI-Certified-Lab-Grown-Diamonds-with_1601682207347.html`  
Source file: `data/fancy-color-yellow-princess-cut-def-vvs-vs-1ct-2ct-3ct-4-sku-prices.json`  
Evidence: exact 1ct E rows with VS2/VS1/VVS2/VVS1; title claims 1-5ct but capture only priced 1ct combinations.  
Use: thin E-color princess anchor. Medium-high for 1ct only; supplier spread looks wide vs D ladder — verify before anchoring clarity premiums.

| Carat | VS2 | VS1 | VVS2 | VVS1 | Confidence |
|---:|---:|---:|---:|---:|---|
| 1.00 | $171.28 | $117.11 | $132.86 | $180.27 | Medium-high |

### Asscher Cut, D/White, VS/VVS, IGI - Messi Jewelry

Product ID: `1601719451540`  
URL: `https://www.alibaba.com/product-detail/IGI-Certificate-Excellent-Cut-1-5CT_1601719451540.html`  
Source file: `data/in-stock-asscher-shape-igi-cvd-htpt-diamond-1ct-5ct-high-sku-prices.json`  
Supplier: Messi Jewelry  
Evidence: exact SKU rows with `D Color Xct IGI Asscher Cut` labels and VS2/VS1/VVS2/VVS1 selectors; key attributes show `Diamond Shape = Asscher Cut`, `White Diamond Color = D`, lab-grown, `Certificate Type = IGI`.  
Use: primary white asscher IGI ladder. High confidence. Prices align closely with Messi princess/cushion ladders from the same supplier family.

| Carat | VS2 | VS1 | VVS2 | VVS1 |
|---:|---:|---:|---:|---:|
| 1.00 | $130 | $135 | $140 | $190 |
| 1.50 | $195 | $203 | $210 | $285 |
| 2.00 | $310 | $320 | $340 | $460 |
| 2.50 | $388 | $400 | $425 | $575 |
| 3.00 | $480 | $510 | $540 | $690 |
| 4.00 | $760 | $800 | - | $1,000 |
| 5.00 | $1,000 | $1,050 | $1,100 | $1,250 |

### Asscher Cut, D, VS/VVS, IGI - Corroborating Listings

Source file: `data/in-stock-asscher-shape-igi-cvd-htpt-diamond-1ct-5ct-high-sku-prices.json`  
Use: independent asscher corroboration. 1ct quad-clarity rows match Messi primary; partial ladders add medium-high guardrails.

| Product ID | URL | Carat | VS2 | VS1 | VVS2 | VVS1 | Confidence |
|---|---|---:|---:|---:|---:|---:|---|
| `10000014259785` | `https://www.alibaba.com/product-detail/MiShang-Jewelry-1ct-D-Color-VS_10000014259785.html` | 1.00 | $130 | $135 | $140 | $190 | High |
| `1601651833888` | `https://www.alibaba.com/product-detail/1CT-1-5CT-2CT-3CT-D_1601651833888.html` | 1.00 | - | $150 | - | $170 | Medium-high |
| `1601651833888` | `https://www.alibaba.com/product-detail/1CT-1-5CT-2CT-3CT-D_1601651833888.html` | 1.50 | - | $230 | - | $250 | Medium-high |
| `1601651833888` | `https://www.alibaba.com/product-detail/1CT-1-5CT-2CT-3CT-D_1601651833888.html` | 2.00 | - | $308 | - | $336 | Medium-high |
| `1601651833888` | `https://www.alibaba.com/product-detail/1CT-1-5CT-2CT-3CT-D_1601651833888.html` | 3.00 | - | $490 | - | - | Medium-high |
| `1601740880180` | `https://www.alibaba.com/product-detail/Starsgem-2EX-Asscher-Cut-Synthetic-Diamond_1601740880180.html` | 1.00 | - | $130 | - | - | Medium-high |
| `1601740880180` | `https://www.alibaba.com/product-detail/Starsgem-2EX-Asscher-Cut-Synthetic-Diamond_1601740880180.html` | 1.50 | - | $195 | - | - | Medium-high |
| `1601740880180` | `https://www.alibaba.com/product-detail/Starsgem-2EX-Asscher-Cut-Synthetic-Diamond_1601740880180.html` | 2.00 | - | $280 | - | - | Medium-high |
| `1601740880180` | `https://www.alibaba.com/product-detail/Starsgem-2EX-Asscher-Cut-Synthetic-Diamond_1601740880180.html` | 3.00 | - | $445 | - | - | Medium-high |

### Asscher Cut, DEF, VS/VVS, IGI - In Stock Listing

Product ID: `1601639441690`  
URL: `https://www.alibaba.com/product-detail/In-Stock-Asscher-Shape-IGI-CVD_1601639441690.html`  
Source file: `data/in-stock-asscher-shape-igi-cvd-htpt-diamond-1ct-5ct-high-sku-prices.json`  
Evidence: exact rows use `XCT DEF Color` selector labels with VS2/VS1/VVS2/VVS1; title matches capture filename and claims 1-5ct asscher IGI stock.  
Use: DEF-color asscher ladder from a second supplier path. Medium-high confidence; prices run higher than Messi D primary — treat as guardrail, not the main D anchor.

| Carat | VS2 | VS1 | VVS2 | VVS1 | Confidence |
|---:|---:|---:|---:|---:|---|
| 1.00 | $207.42 | $171.85 | $207 | $261.42 | Medium-high |
| 2.00 | $503.35 | $429.85 | $453.21 | $634.50 | Medium-high |
| 3.00 | $632.67 | $719.57 | $709.92 | $962.35 | Medium-high |
| 4.00 | $879.42 | $877.92 | $922.07 | $2,596.07 | Medium |
| 5.00 | $1,598.78 | $1,374 | $1,538.35 | $1,654.07 | Medium-high |

### Asscher Cut, E, VVS-VS, IGI - Small Sizes

Product ID: `10000036828887`  
URL: `https://www.alibaba.com/product-detail/IGI-GIA-Certified-4-0-Ct_10000036828887.html`  
Source file: `data/in-stock-asscher-shape-igi-cvd-htpt-diamond-1ct-5ct-high-sku-prices.json`  
Evidence: E-color rows with combined `VVS-VS` clarity band and carat labels 0.40-3.00.  
Use: broad E asscher guardrail only. Medium confidence; not a split VS1/VVS2 ladder.

| Carat | VVS-VS | Confidence |
|---:|---:|---|
| 0.40 | $144.30 | Medium |
| 0.50 | $170.94 | Medium |
| 1.00 | $255.30 | Medium |
| 2.00 | $488.40 | Medium |
| 3.00 | $830.28 | Medium |

### Heart Cut, D/White, VS/VVS2, IGI - Starsgem

Product ID: `1600980186115`  
URL: `https://www.alibaba.com/product-detail/Gorgeous-Love-Shape-Diamond-Pendent-Heart_1600980186115.html`  
Source file: `data/alibaba-com-manufacturers-suppliers-exporters-importers--sku-prices.json`  
Supplier: Starsgem  
Evidence: exact SKU rows with `White D`, carat, VS1/VVS2, and Excellent cut grade; key attributes show `Diamond Shape = Heart Cut`, `White Diamond Color = D`, IGI. Title references pendant context — treat as medium-high until loose-only context is confirmed.  
Use: first white heart IGI ladder. Medium-high confidence; partial coverage (1-2ct only, VS1/VVS2 only).

| Carat | VS1 | VVS2 | Confidence |
|---:|---:|---:|---|
| 1.00 | $156 | $162 | Medium-high |
| 1.50 | $231.60 | $258 | Medium-high |
| 2.00 | $360 | $378 | Medium-high |

### Heart Cut, D, VS/VVS, IGI - Corroborating Listings

Source file: `data/alibaba-com-manufacturers-suppliers-exporters-importers--sku-prices.json`  
Use: 1ct D heart corroboration; aligns with Starsgem primary within ~15-20%.

| Product ID | URL | Carat | VS1 | VVS2 | VVS1 | Confidence |
|---|---|---:|---:|---:|---:|---|
| `1601056018336` | `https://www.alibaba.com/product-detail/Redleaf-Lab-Diamond-IGI-Heart-Cut_1601056018336.html` | 1.00 | $185 | $188 | - | Medium-high |
| `1601656742443` | `https://www.alibaba.com/product-detail/Wholesale-Heart-Shaped-Loose-Diamond-IGI_1601656742443.html` | 1.00 | - | $159.80 | - | Medium-high |
| `1601438396327` | `https://www.alibaba.com/product-detail/Lab-Diamond-Grown-D-E-F_1601438396327.html` | 1.00 | $140 | - | - | Medium |

Note: `1601438396327` captured one `1Carat` row without clarity selector split.

### Heart Cut, E, VS1, IGI - Large Sizes

Product ID: `1601610944760`  
URL: `https://www.alibaba.com/product-detail/IGI-Certified-3ct-5ct-Heart-Cut_1601610944760.html`  
Source file: `data/alibaba-com-manufacturers-suppliers-exporters-importers--sku-prices.json`  
Evidence: exact rows `XCT/IGI/E` with VS1; title claims 3-5ct heart E color.  
Use: thin E-color heart anchor for 3ct+ only. Medium confidence; VS1-only.

| Carat | VS1 | Confidence |
|---:|---:|---|
| 3.00 | $479 | Medium |
| 5.00 | $999 | Medium |
| 6.00 | $1,289 | Medium |

### Portuguese Cut, D, VS1, IGI - Shreeraj Solitaire (Primary 1-3ct)

Product ID: `10000040044944`  
URL: `https://www.alibaba.com/product-detail/IGI-Certified-Portuguese-Cut-Lab-Grown_10000040044944.html`  
Source file: `data/portuguese-cut-1-00-carat-cvd-lab-grown-diamond-with-igi-sku-prices.json`  
Supplier: SHREERAJ SOLITAIRE  
Evidence: exact SKU rows with `shape: portuguese` on capture; title and URL say Portuguese Cut; selectors show `1.00/2.00/3.00 Carat`, `Diamond Clarity = VS1`, `Color = D (Top Color)`, Excellent cut grade, IGI certificate. Page-level shape attribute is blank/`other` — use listing title + capture `shape` field.  
Use: **primary white Portuguese IGI ladder (1-3ct, D VS1)**. IGI often reports these stones as Round Modified Brilliant; treat as Portuguese for pricing, not round baseline. High confidence for captured rows.

| Carat | VS1 | $/ct | Confidence |
|---:|---:|---:|---|
| 1.00 | $260 | $260 | High |
| 2.00 | $460 | $230 | High |
| 3.00 | $890 | $297 | High |

**Notes:** 4.00ct and 5.00ct selectors exist but no reliable SKU price rows were captured yet. E-color option is on the page but only D VS1 rows were captured in this session.

### Portuguese Cut, D/E, VS/VVS2, IGI - Mishang Diamond (2ct+ specialty)

Product ID: `1601570156930`  
URL: `https://www.alibaba.com/product-detail/HPHT-CVD-VVS-VS-Excellent-Portuguese_1601570156930.html`  
Source file: `data/portuguese-cut-1-00-carat-cvd-lab-grown-diamond-with-igi-sku-prices.json`  
Supplier: Mishang Diamond  
Evidence: listing title and `Model Number = Portuguese Cut Lab Grown Diamond`; SKU row labels embed carat/color/clarity/growth (e.g. `2.13CT E VVS2 CVD`); page `Diamond Shape` says Round Brilliant Cut — **use row labels + title as shape authority** (same pattern as multi-shape Messi listings).  
Use: corroborating Portuguese ladder for ~2ct+ singles, especially E VVS2 and D VVS2 CVD. Medium-high confidence.

| Carat | Color | Clarity | Price | $/ct | Confidence |
|---:|---|---|---:|---:|---|
| 2.08 | D | VS1 | $600 | $288 | Medium-high |
| 2.12 | D | VVS2 | $650 | $307 | Medium-high |
| 2.13 | E | VVS2 | $600 | $281 | Medium-high |
| 2.16 | E | VS1 | $580 | $269 | Medium-high |
| 2.22 | D | VVS2 | $650 | $293 | Medium-high |
| 3.86 | E | VVS2 | $850 | $220 | Medium |

**IGI mapping:** Stones certified as **Round Modified Brilliant** (e.g. LG783630596, 1.75ct E VVS2) should match `shape = portuguese` in the app and nearest-comp against rows above — not the round Messi ladder.

### Fancy Vivid Pink Heart, IGI

Product ID: `10000038791251`  
URL: `https://www.alibaba.com/product-detail/IGI-Certified-Lab-Grown-Fancy-Vivid_10000038791251.html`  
Source file: `data/alibaba-com-manufacturers-suppliers-exporters-importers--sku-prices.json`  
Evidence: title says Fancy Vivid Pink Heart 1.00-4.00CT; row labels show VS1/VS2 but price is identical within each carat band. Use carat-level prices only; do not model a clarity spread from this listing.  
Corroborating URL (`1601561025630`, 2.08ct vivid pink heart): `https://www.alibaba.com/product-detail/IGI-Certificate-Fancy-Light-Pink-Loose_1601561025630.html`  
Use: first vivid pink heart carat ladder. Medium-high confidence for $/ct by carat; corroborates the 2.08ct `$770` heart row from `1601561025630` (~$370/ct).

| Carat | VS1/VS2 (same price) | $/ct | Confidence |
|---:|---:|---:|---|
| 1.00 | $200 | $200 | Medium-high |
| 2.00 | $420 | $210 | Medium-high |
| 3.00 | $770 | $257 | Medium-high |
| 4.00 | $1,020 | $255 | Medium-high |

### Fancy Pink Heart, IGI - VS1 Ladder

Product ID: `1601392704741`  
URL: `https://www.alibaba.com/product-detail/Heart-Shape-IGI-Certified-1ct-2ct_1601392704741.html`  
Source file: `data/alibaba-com-manufacturers-suppliers-exporters-importers--sku-prices.json`  
Evidence: selector says `D Color Pink` with 1-6ct VS1 rows; intensity not stated beyond pink color in title.  
Use: pink heart VS1 ladder guardrail. Medium confidence until fancy intensity is confirmed on-page.

| Carat | VS1 | $/ct | Confidence |
|---:|---:|---:|---|
| 1.00 | $500 | $500 | Medium |
| 2.00 | $571.50 | $286 | Medium |
| 3.00 | $643 | $214 | Medium |
| 4.00 | $714.30 | $179 | Medium |
| 6.00 | $1,000 | $167 | Medium |

### Fancy Pink Mixed Shapes, IGI - Mishang Diamond

Product ID: `1601561025630`  
URL: `https://www.alibaba.com/product-detail/IGI-Certificate-Fancy-Light-Pink-Loose_1601561025630.html`  
Evidence: exact SKU rows from `data/igi-certificate-fancy-light-pink-loose-lab-diamond-hpht--sku-prices.json` and `data/1ct-2ct-fancy-cut-lab-grown-diamond-radiant-cut-d-vs1-ig-sku-prices.json`; page attributes show lab-grown, IGI, Fancy color, Excellent cut grade, and certificate sample `LG555269066`. Princess row is also listed under white princess corroboration context above.  
Use: medium-high confidence pink lab-grown IGI row comps. The page-level `Diamond Shape` says Radiant Cut, but the SKU row labels contain the actual row-level shapes; use the row labels for shape, color intensity, carat, and clarity.

| Shape | Fancy Color | Carat | Clarity | Cut Grade | Price | $/ct | Confidence |
|---|---|---:|---|---|---:|---:|---|
| Cushion | Fancy Pink | 4.13 | VS1 | Excellent | $1,471 | $356 | Medium-high |
| Princess | Fancy Light Pink | 3.03 | VS1 | Excellent | $1,126 | $372 | Medium-high |
| Heart | Fancy Vivid Pink | 2.08 | VVS2 | Excellent | $770 | $370 | Medium-high ([vivid pink heart ladder](https://www.alibaba.com/product-detail/IGI-Certified-Lab-Grown-Fancy-Vivid_10000038791251.html) `10000038791251`) |
| Pear | Fancy Intense Pink | 1.55 | VS1 | Excellent | $534 | $345 | Medium-high |
| Emerald | Fancy Intense Pink | 1.06 | VS1 | Excellent | $331 | $312 | Medium-high |
| Radiant | Fancy Intense Brownish Pink | 0.89 | VS2 | Excellent | $262 | $294 | Medium-high |

### Fancy Color Oval Rows, IGI - Goldleaf

Product ID: `1601734031607`  
URL: `https://www.alibaba.com/product-detail/Goldleaf-Lab-Grown-Oval-Cut-Diamond-Red_1601734031607.html`  
Source file: `data/starsgem-oval-diamante-1ct-2ct-3ct-d-vs1-vvs2-hpht-cvd-i-sku-prices.json`  
Evidence: exact SKU rows with row-level fancy color, carat, clarity, and price; title and flags support lab-grown fancy oval context.  
Use: first clean exact fancy yellow/blue/red/pink oval rows. Medium confidence until more shapes and intensities are captured.

| Fancy Color | Carat | Clarity | Cut Grade | Price | $/ct | Confidence |
|---|---|---:|---|---|---:|---:|---|
| Fancy Vivid Yellow | 2.57 | VS1 | Very Good | $1,072 | $417 | Medium |
| Fancy Intense Pink | 2.01 | VS1 | Very Good | $840 | $418 | Medium |
| Fancy Intense Blue | 2.59 | VS1 | Very Good | $876 | $338 | Medium |
| Fancy Red | 1.05 | VS1 | Very Good | $531 | $506 | Medium |

### Fancy Pink Oval, IGI

Product ID: `1601610517231`  
URL: `https://www.alibaba.com/product-detail/High-Quality-IGI-Certificate-Loose-CVD_1601610517231.html`  
Source file: `data/1ct-2ct-fancy-cut-lab-grown-diamond-radiant-cut-d-vs1-ig-sku-prices.json`  
Evidence: exact row `fancy pink oval`, 1ct, VVS2, $300.  
Use: thin pink oval corroboration. Medium confidence.

| Shape | Fancy Color | Carat | Clarity | Price | Confidence |
|---|---|---:|---|---:|---|
| Oval | Fancy Pink | 1.00 | VVS2 | $300 | Medium |

### Fancy Blue Asscher, IGI

Product IDs: `1601560999395`, `1601643180823`, `1601643284183`  
URLs: `https://www.alibaba.com/product-detail/Blue-Color-Lab-Grown-Diamonds-Loose-Asscher_1601560999395.html`, `https://www.alibaba.com/product-detail/Messi-Jewelry-IGI-Certificate-Fancy-Intenese_1601643180823.html`, `https://www.alibaba.com/product-detail/Diamonds-Blue-Color-Loose-Emerald-Princess_1601643284183.html`  
Source files: `data/1ct-2ct-fancy-cut-lab-grown-diamond-radiant-cut-d-vs1-ig-sku-prices.json`, `data/in-stock-asscher-shape-igi-cvd-htpt-diamond-1ct-5ct-high-sku-prices.json`, `data/hpht-cvd-loose-lab-grown-diamond-cushion-def-gh-vvs-vs-i-sku-prices.json`  
Evidence: exact row `Asscher Fancy Blue 5.23ct VS1` with Excellent cut grade; same row price repeats across three product captures.  
Use: first clean exact fancy blue asscher row. Medium confidence; large carat specialty anchor only until 1-3ct blue asscher rows are captured.

| Shape | Fancy Color | Carat | Clarity | Cut Grade | Price | $/ct | Confidence |
|---|---|---:|---|---|---:|---:|---|
| Asscher | Fancy Blue | 5.23 | VS1 | Excellent | $1,668 | $319 | Medium |

### Fancy Green Emerald, IGI

Product ID: `1601126748817`  
URL: `https://www.alibaba.com/product-detail/Fancy-Intense-Greyish-Green-Lab-Diamonds_1601126748817.html`  
Source file: `data/hpht-cvd-loose-lab-grown-diamond-cushion-def-gh-vvs-vs-i-sku-prices.json`  
Evidence: exact row `Emeralds Fancy Intense Green 6.61ct VS1`; page-level shape says Oval but row label uses emerald cut style.  
Use: first clean exact fancy green row. Medium confidence; large specialty carat only.

| Shape | Fancy Color | Carat | Clarity | Price | $/ct | Confidence |
|---|---|---:|---|---:|---:|---|
| Emerald | Fancy Intense Green | 6.61 | VS1 | $2,108 | $319 | Medium |

### Fancy Vivid Yellow Cushion, IGI

Product ID: `1601643214939`  
URL: `https://www.alibaba.com/product-detail/Messi-Jewelry-Lab-Created-Diamond-Fancy_1601643214939.html`  
Source file: `data/hpht-cvd-loose-lab-grown-diamond-cushion-def-gh-vvs-vs-i-sku-prices.json`  
Evidence: listing title says Fancy Vivid Yellow Cushion; selector text bundles `1.05ct fancy vivid yellow VVS2 CTI` into the Color field, so carat/clarity come from selector text rather than separate row labels.  
Use: first vivid yellow cushion anchor. Medium confidence until recaptured with cleaner row labels.

| Shape | Fancy Color | Carat | Clarity | Price | $/ct | Confidence |
|---|---|---:|---|---:|---:|---|
| Cushion | Fancy Vivid Yellow | ~1.05 | VVS2 (selector text) | $999 | ~$951 | Medium |

## Clean But Broad Or Specialty

These can be used as guardrails, but not as exact one-to-one comps.

| Product ID | Listing | Why Broad |
|---|---|---|
| `1600092144781` | Messi pear 1-5ct, White, VS/VVS, Excellent | Rows captured with price but the exported rows lost per-row carat labels in some captures. Use product page again with v3 extension. |
| `10000030952345` | Round Portuguese Cut, DEF, VVS-VS | Superseded for pricing by `10000040044944` and `1601570156930`; legacy capture had clarity-only row labels. |
| `1601132548922` | Fancy light pink, mixed fancy shapes | Uses `Diamond Cut` for shape/size labels; use only after recapture with page-source evidence. |
| `1601646366748` | HPHT CVD cushion DEF/GH, one `0.5ct-E-VVS2` row | Single specialty row from `igi-certified-elongated-cushion-cut` capture; not a full ladder. |
| `1601459739835` | Anster cushion `3MM` size row | Millimeter sizing without clean 1ct+ carat mapping. |
| `1601575557334` | Chang Lai cushion `IGI 1.0-1.09CT` band | Carat band only, not single-carat exact. |
| `1601451173234` | Qianjian 0.5ct / 4.25mm princess | Sub-1ct millimeter listing; specialty size only. |
| `1601638374081` | Redleaf mixed round/oval/princess listing | Selector uses round-style labels; not a clean princess-only ladder. |
| `1601434529184` | Hot Sale heart rows with per-stone mm measurements | Specific inventory stones, not a standard carat/clarity ladder. |
| `1601630272909` | Heart mm-size rows 0.3-0.7ct plus one 1ct | Sub-1ct specialty sizing mixed with one 1ct row. |
| `1601568763063` | Chang Lai heart `IGI 1.0-1.09CT` band | Carat band only. |

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
| `1601296423601` | Repeats $1,622 across Asscher Fancy Intense Yellow 4.02ct VS1 and Oval Fancy Vivid Yellow 1.41ct VVS2 incompatible rows. |
| `1601716135080` | Repeats $286.35-$372.62 across different emerald fancy-color carat rows without row-level price separation. |
| `11000034592294` | Yellow princess repeats $324 across 1ct-5ct incompatible carat rows. |
| `1601661832444` | Fancy vivid blue princess repeats $430 across 1.59ct and 3.53ct rows. |
| `1601657600745` | Repeats $154.20 across 1ct and 2ct D VVS2 rows. |
| `1601651485112` | Repeats $225 across 1ct D VVS1 and VVS2 rows. |
| `1601715266105` | 4ct and 5ct VS1 both $1,168; use 1-3ct rows only or recapture. |
| `11000034678719` | Title says asscher blue, but selector is `Heart VS 2.0CT`; not a clean asscher row. |
| `11000034576964` | Pink heart repeats $369 across 1ct, 1.5ct, and 2ct. |
| `1601653353359` | White heart repeats $220 across 1ct, 2ct, and 3ct. |
| `10000038791251` | Vivid pink heart shows identical price for VS1 vs VS2 at each carat; use carat prices only. |

## Recapture Checklist

For future captures, trust a row when the extension saves:

- `normalized.shape.value`
- `normalized.color.value`
- `normalized.clarity.value`
- `normalized.carat.value` or a row-level `priceRows[].carat`
- `normalized.certificate.type` when IGI is claimed
- `sourceContext.keyAttributes` with `Diamond Shape`, `White Diamond Color`, `Fancy Diamond Color`, or certificate fields when the title is vague

If any of those are missing, manually fill the prompt only when the value is visible on the page or certificate. Otherwise leave it blank and mark the row provisional.
