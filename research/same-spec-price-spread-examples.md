# Same-Spec Price Spread Examples — Why Identical Diamonds Have Different Prices

**Generated:** 2026-05-30  
**Source:** StarGem XLS stock file (May 2026, 28,394 rows)  
**Purpose:** Document specific IGI-certified stones with identical grades but wildly different prices

---

## The Core Pattern

Every single high-spread case shows the **same structure**:

- **Expensive stones → early row numbers (rows ~8,000–13,000)** — old rate card
- **Cheap stones → late row numbers (rows ~17,000–21,000)** — new rate card
- The physical stone attributes (cut grade, polish, symmetry, fluorescence, measurements) are **nearly identical**

The price difference is 100% temporal. It is not caused by stone quality differences. It is caused by StarGem updating its rate cards over time and both vintages living in the same stock file.

There is also a distinctive tell: expensive early-period stones often have `cut = '传统切'` (Chinese for "Traditional Cut") — a data-entry format used during the old rate card period that was later switched to `'-'`. This character appears **only in expensive rows** and is a reliable marker of old-rate-card data.

---

## Example 1 — 1.03ct Oval D VVS2 (x1.86 price ratio)

**Price range: $116–$216/ct** | 35 stones

| IGI Report | Row | $/ct | vs cheapest | Cut | Pol | Sym | Fl | Type | Tbl% | Dep% | Measurement |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 789613953 | 12141 | **$216** | +86% | *(blank)* | EX | EX | N | HPHT | 60.0 | 61.9 | 8.03-5.72-3.54 |
| 784653078 | 12142 | **$216** | +86% | *(blank)* | EX | EX | N | HPHT | 58.0 | 62.1 | 8.17-5.72-3.55 |
| 754515332 | 12302 | **$206** | +77% | 传统切 | EX | EX | N | HPHT | 61.0 | 61.5 | 8.05-5.69-3.50 |
| 770640619 | 12308 | **$206** | +77% | 传统切 | EX | EX | N | HPHT | 59.0 | 63.3 | 7.87-5.72-3.62 |
| 754514877 | 12316 | **$206** | +77% | 传统切 | EX | EX | N | HPHT | 61.0 | 62.5 | 8.17-5.66-3.54 |
| 778633208 | 12324 | **$206** | +77% | 传统切 | EX | EX | N | HPHT | 61.0 | 63.0 | 7.81-5.68-3.58 |
| *(11 more at $206)* | ~12,300s | $206 | +77% | 传统切 | EX | EX | N | HPHT | varies | varies | — |
| 793627630 | 19703 | **$118** | +2% | *(blank)* | EX | EX | N | HPHT | 62.0 | 62.0 | 8.16-5.69-3.53 |
| 791623177 | 20002 | **$117** | +0% | `-` | EX | EX | N | CVD | 61.0 | 63.2 | 8.08-5.57-3.52 |
| 791625446 | 20008 | **$117** | +0% | `-` | EX | EX | N | CVD | 60.0 | 59.7 | 8.50-5.66-3.38 |
| 777609969 | 20253 | **$116** | +0% | *(blank)* | EX | EX | N | HPHT | 61.0 | 61.8 | 8.33-5.65-3.49 |

**What differs:** `cut` field shows `传统切` on expensive stones vs `'-'` or blank on cheap ones. TypeName varies (HPHT vs CVD) but at the same price point — HPHT and CVD stones at row ~20,000 both price at $116–$118/ct. So neither HPHT nor CVD causes the $206 vs $117 gap. Row number (time) does.

**Verdict: 100% temporal.** The `传统切` label is a time marker, not a quality marker.

---

## Example 2 — 1.09ct Princess D VVS2 (x2.21 price ratio)

**Price range: $113–$250/ct** | 53 stones

| IGI Report | Row | $/ct | vs cheapest | Cut | Pol | Sym | Fl | Type | Tbl% | Dep% | Measurement |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 768648507 | 8963 | **$250** | +121% | *(blank)* | EX | EX | N | CVD | 65.0 | 69.5 | 5.64-5.61-3.90 |
| 762527698 | 10645 | **$225** | +99% | *(blank)* | EX | EX | N | CVD | 67.0 | 69.6 | 5.62-5.52-3.84 |
| 768648478 | 10646 | **$225** | +99% | *(blank)* | EX | EX | N | CVD | 69.0 | 63.2 | 5.72-5.70-3.60 |
| 768648506 | 10651 | **$225** | +99% | *(blank)* | EX | EX | N | CVD | 67.0 | 71.0 | 5.57-5.55-3.94 |
| 719501293 | 17757 | **$119** | +5% | `-` | EX | EX | N | CVD | 68.0 | 70.4 | 5.73-5.67-3.99 |
| 741528372 | 17758 | **$119** | +5% | `-` | EX | EX | N | CVD | 69.0 | 72.9 | 5.53-5.50-4.01 |
| 712580548 | 17760 | **$119** | +5% | `-` | EX | EX | N | CVD | 70.0 | 68.3 | 5.74-5.65-3.86 |
| *(33 more stones ~$115–$119)* | 17,757–18,508 | ~$117 | ~+4% | `-` | EX | EX | N | CVD | varies | varies | — |
| 768627175 | 19413 | **$113** | +0% | *(blank)* | EX | EX | N | CVD | 69.0 | 69.1 | 5.79-5.70-3.94 |

**What differs:** Nothing except row number (time). Same polish, symmetry, fluorescence, type (all CVD), all EX grades throughout. The 4 expensive stones are in rows 8,963–10,651. The 49 cheap stones are in rows 17,757–19,413.

**Verdict: 100% temporal.** A Princess D VVS2 stone dropped from $250/ct to $113/ct over this period — a **55% wholesale price crash** — and both ends of the crash are in the training data simultaneously.

---

## Example 3 — 1.00ct Oval D VS1 (x1.77 price ratio)

**Price range: $116–$206/ct** | 43 stones

| IGI Report | Row | $/ct | vs cheapest | Cut | Pol | Sym | Fl | Type | Tbl% | Dep% | Measurement |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 770650433 | 12442 | **$206** | +77% | 传统切 | EX | EX | N | HPHT | 61.0 | 61.6 | 8.25-5.63-3.47 |
| 761553185 | 12445 | **$206** | +77% | 传统切 | EX | EX | N | HPHT | 59.0 | 62.9 | 7.96-5.58-3.51 |
| 761553324 | 12447 | **$206** | +77% | 传统切 | EX | EX | N | HPHT | 58.0 | 61.7 | 8.09-5.66-3.49 |
| 770649054 | 12448 | **$206** | +77% | 传统切 | EX | EX | N | HPHT | 68.0 | 62.5 | 8.10-5.52-3.45 |
| *(11 more at $206)* | ~12,440–12,483 | $206 | +77% | 传统切 | EX | EX | N | HPHT | varies | varies | — |
| 791661040 | 20783 | **$117** | +1% | `-` | EX | EX | N | CVD | 63.0 | 61.9 | 8.33-5.57-3.45 |
| 776640487 | 20785 | **$117** | +1% | `-` | EX | EX | N | CVD | 63.0 | 63.8 | 7.81-5.52-3.52 |
| 793627650 | 20853 | **$117** | +1% | *(blank)* | EX | EX | N | HPHT | 64.0 | 61.4 | 7.78-5.73-3.52 |
| 779634342 | 21131 | **$116** | +0% | `-` | EX | EX | N | HPHT | 62.0 | 62.0 | 7.93-5.55-3.44 |

**What differs:** `cut = 传统切` in all expensive rows. TypeName HPHT in expensive rows, but late-period HPHT stones also price at $116 — confirming HPHT is not the cause.

**Verdict: 100% temporal.** 

---

## Example 4 — 1.00ct Oval D VVS2 (x1.81 price ratio)

**Price range: $118–$212/ct** | 55 stones

| IGI Report | Row | $/ct | vs cheapest | Cut | Type | Note |
|---|---|---|---|---|---|---|
| 783641710 | 12297 | **$212** | +81% | 传统切 | HPHT | Old rate card |
| 778633209 | 12305 | **$212** | +81% | 传统切 | HPHT | Old rate card |
| 786635409 | 12307 | **$212** | +81% | 传统切 | HPHT | Old rate card |
| *(5 more at $212)* | ~12,297–12,335 | $212 | +81% | 传统切 | HPHT | Old rate card |
| 776698833 | 17896 | **$130** | +10% | `-` | HPHT | Transition |
| 778684723 | 18633 | **$125** | +6% | *(blank)* | CVD | Transition |
| 794652976 | 19699 | **$122** | +4% | *(blank)* | HPHT | New rate card |
| 779660874 | 19990 | **$120** | +2% | `-` | CVD | New rate card |
| 787608736 | 20059 | **$120** | +2% | `-` | HPHT | New rate card |
| 766692835 | 20091 | **$118** | +0% | *(blank)* | CVD | New rate card |

**Additional detail visible here:** The price decay happens *gradually* as row number increases — $212 → $130 → $125 → $122 → $120 → $118. This is not a single step change; it's a market sliding down over time with the stock file capturing every stage.

**Verdict: 100% temporal, with visible gradual decay.**

---

## Example 5 — 1.09ct Princess D VVS1 (very sparse, but extreme)

This is the spec cited in the MAPE analysis as the flagship example.

| IGI Report | Row | $/ct | vs cheapest | Cut | Pol | Sym | Type |
|---|---|---|---|---|---|---|---|
| *(early stones)* | ~8,000–11,000 | **~$275** | +115% | *(blank)* | EX | EX | CVD/HPHT |
| *(late stones)* | ~17,000–19,000 | **~$128** | +0% | `-` | EX | EX | CVD/HPHT |

The group is small (n<5 at exact 1.09ct VVS1) which is why the model has such high variance here — too few stones to identify the temporal pattern.

---

## What `传统切` Means

`传统切` is Mandarin for **"Traditional Cut"**. It appears in the `Cut` column for early-inventory stones and seems to be a data-entry label used by a different operator or system during an earlier period. It was later replaced with standardized values (`EX`, `VG`, `ID`, `-`).

**It is NOT a diamond characteristic that affects quality.** It is purely a data artifact. Its presence is a reliable proxy for "this stone was priced under an old rate card."

Stones with `cut = 传统切`: all priced **$77–$86% above** current rate card prices for the same spec.

---

## The "Always Take the Lowest Price" Cleanup Strategy

You suggested: *if all stats are the same, always take the lowest price.*

Here is the analysis of that approach:

### What it would do
For each unique `(carat_2dp, shape, color, clarity)` group, keep only the row(s) at or near the minimum price. This effectively discards all old-rate-card data and trains only on current pricing.

### Expected MAPE impact
- The noise floor for the full dataset is **4.32% MAPE**
- This strategy would bring the noise floor down to roughly **~1.5–2.5%**
- Equivalent in effect to the S18 temporal cutoff (which went from 4.53% → 3.26% MAPE)

### The risk: sample size collapse
| Spec | Current n | After dedup (lowest price) | Lost |
|---|---|---|---|
| 1.09ct Princess D VVS2 | 53 stones | ~8–9 stones (all at $113–$115/ct) | 83% |
| 1.03ct Oval D VVS2 | 35 stones | ~14 stones | 60% |
| 1.00ct Oval D VS1 | 43 stones | ~13 stones | 70% |

You'd go from ~28,000 training rows to roughly **8,000–12,000 rows**. The model would still train fine for common specs, but sparse specs (specialty shapes, large carats, unusual clarity) would have even fewer training examples.

### Better alternative: row-number cutoff
Instead of "keep cheapest," use "keep most recent N rows." This preserves sample size within the current rate card period without collapsing to 1 example per spec.

- **`keep last 30% of rows`** (rows 19,880+): ~8,500 rows, cleanest pricing, estimated MAPE ~2.5%
- **`keep last 50% of rows`** (rows 14,197+): ~14,000 rows, slightly more noise, estimated MAPE ~3.0%

The row-number cutoff and the "lowest price" strategy are solving the same problem. Row cutoff is strictly better because it:
1. Preserves variation in physical stone measurements for the current rate card
2. Keeps sample size higher for sparse specs
3. Is easy to update (just change the cutoff row each time you get new data)

### One case where "lowest price" IS useful
For detecting **data entry errors** — stones where the price is implausibly low relative to their spec neighbors (e.g., the 5.06ct Round E VVS2 ID at $19/ct vs $127/ct). A price that is >3x below spec median is almost certainly a data entry mistake (missing a digit). A "flag anything below 0.4× spec median" filter would catch these without affecting the majority of the data.

---

## Summary Table

| Spec | n stones | Min $/ct | Max $/ct | Ratio | Root cause | 传统切 present? |
|---|---|---|---|---|---|---|
| 1.09ct Princess D VVS2 | 53 | $113 | $250 | x2.21 | Temporal rate shift | No |
| 1.03ct Oval D VVS2 | 35 | $116 | $216 | x1.86 | Temporal rate shift | Yes (expensive stones) |
| 1.00ct Oval D VVS2 | 55 | $118 | $212 | x1.81 | Temporal rate shift | Yes (expensive stones) |
| 1.00ct Oval D VS1 | 43 | $116 | $206 | x1.77 | Temporal rate shift | Yes (expensive stones) |
| 1.10ct Princess D VVS1 | n/a | $128 | $275 | x2.15 | Temporal rate shift | Likely |
| 1.10ct Princess D VVS2 | n/a | $119 | $232 | x1.95 | Temporal rate shift | Likely |

In **every single case**, the expensive stones have low row numbers (early inventory) and the cheap stones have high row numbers (recent inventory). No quality attribute explains the difference.
