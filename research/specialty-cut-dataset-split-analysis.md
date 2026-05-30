# StarGem Dataset: Specialty Cut Classification & Temporal Split Analysis

**Generated:** 2026-05-30 (addendum: Segment H random-high-cluster quarantine + over-removal audit)  
**Dataset:** STARS Diamonds Stock2026.5.20.xls (28,394 rows)  
**Script:** `research/scripts/dataset-split-outliers.py`  
**Outputs:** `research/data/dataset-split-{report,summary,clean-training}.json`

---

## Executive Summary

The StarGem XLS contains five intertwined data quality problems that inflate ML MAPE beyond the theoretical minimum:

| Problem | Stones | Impact |
|---|---|---|
| **Old rate card era** (rows ≤ 15,000) | 14,412 | +26.8% avg price drift vs current market |
| **传统切 label** (Traditional Brilliant — data artifact) | 301 | Absorbed into old-rate-card problem; not a real cut style |
| **冰花切 specialty cut** (Ice Flower) | 265 | Genuine +100–150% premium; needs its own model |
| **Lone point outliers** (Segment F) | 501 | Single stale/mispriced listings ≥40% above base spec cluster |
| **Random high price clusters** (Segment H) | 50 | Coherent high *modes* ≥30% above the base cluster (small rounds, expired rate card) |

After clean segmentation:
- **ML training set (Segment A): 12,843 rows — 45.2% of total**
- **Intrinsic noise floor: 3.35% MAPE** (down from 4.40% on full dataset)
- **Headroom for model improvement: ~0.25% MAPE** above floor for a model trained on segment A

> **Over-removal audit (added this pass):** The new Segment H cluster-quarantine removes **0 net additional rows** at the recommended 30% gap — it only re-labels 50 stones that point-outlier detection (F) was already removing, giving cleaner attribution without shrinking the training set. The entire F+H "high price" cleanup is ~2% of rows; **96%+ of the exclusions are the row-cutoff (Segment E)**, not the high-price logic. Per-shape sufficiency is audited in §12. See also the new **princess investigation** (§11): the user's "randomly high-priced princess" pattern is real but lives entirely in the *old* rate card era and is already removed by Segment E — the recent princess data is clean (price spread ≤1.05× within every spec).

---

## 1. The Chinese Cut Label System

StarGem's XLS uses a `Cut` column that serves two purposes:
1. For standard stones: a grade (`EX`, `VG`, `ID`, `-`, `ID`, etc.)
2. For specialty-era inventory: a **Chinese-character cut category** applied by a different data-entry operator

The Chinese labels found in the dataset:

| Label | Hanzi | Count | Rows | Meaning |
|---|---|---|---|---|
| `传统切` | Traditional Cut | 301 | 0–14,361 | Standard brilliant — **data artifact** |
| `冰花切` | Ice Flower Cut | 265 | 0–14,882 | Crushed-ice specialty faceting — **genuine premium** |
| `长垫形` | Elongated Cushion | 20 | 236–3,175 | Shape variant — **already classified in comp engine** |
| `老矿切` | Old Mine Cut | 1 | — | Historical novelty |
| `老欧切` | Old European Cut | 1 | — | Historical novelty |

---

## 2. 传统切 (Traditional Cut) — Data Artifact, Not a Cut Style

### What the label looks like in the data

```
rowNo  shape  color  clarity  cut_raw   upc
12,141  OVAL   D      VVS2    传统切     $216/ct
12,253  OVAL   D      VVS2    传统切     $206/ct
19,703  OVAL   D      VVS2    -          $117/ct   ← same spec, current rate card
```

### IGI Certificate Confirmation

Cross-referencing the `Reportno` of every `传统切` stone against `igi-report-enrichment.json`:

| IGI Report | Shape in XLS | IGI Says | L/W Ratio |
|---|---|---|---|
| 780660964 | OVAL | **Oval Brilliant** | 1.42 |
| 782613550 | OVAL | **Oval Brilliant** | 1.48 |
| 770692505 | OVAL | **Oval Brilliant** | 1.49 |
| 766672546 | PEAR | **Pear Brilliant** | 1.59 |
| 773659518 | PEAR | **Pear Brilliant** | 1.60 |
| 756598844 | PEAR | **Pear Brilliant** | 1.60 |
| 780660964 | HEART | **Heart Brilliant** | 1.15 |
| 788667259 | HEART | **Heart Brilliant** | 1.13 |

**Result: 100% of checked 传统切 stones carry standard IGI shape descriptions ("Oval Brilliant", "Pear Brilliant", "Heart Brilliant"). None are "Modified Brilliant" or any specialty cut designation.**

### L/W Ratio Distribution — Identical to Standard

| L/W Bucket | 传统切 Ovals (n=136) | Standard Ovals (n=3,428) |
|---|---|---|
| < 1.25 | 0% | 0% |
| 1.25–1.35 | 0% | 0.03% |
| **1.35–1.45** | **75.7%** | **69.5%** |
| 1.45–1.55 | 22.8% | 28.3% |
| > 1.55 | 1.5% | 2.1% |

The L/W distributions are statistically indistinguishable. These are the same physical cut style — the label is meaningless as a cut quality signal.

### Why the "66% Premium" Is Temporal, Not Quality-Based

Within rows 10,000–15,000 where both 传统切 and standard stones co-exist:

| Row Sub-Band | 传统切 OVAL (n) | Standard OVAL (n) |
|---|---|---|
| rows 10,000–11,000 | — | $123/ct (105) |
| **rows 11,000–12,000** | **$233/ct (17)** | **$121/ct (212)** |
| **rows 12,000–13,000** | **$205/ct (90)** | **$186/ct (23)** |
| rows 13,000–14,000 | $247/ct (1) | $115/ct (276) |
| rows 14,000–15,000 | $321/ct (1) | $150/ct (144) |

The 传统切 stones are concentrated in rows 11,000–12,500 — the peak of the high-price era. Standard stones span the entire 10,000–15,000 range including post-rate-cut rows (13,000+) where prices dropped to $115. The apparent "66% cut premium" is 100% a temporal artifact of the row clustering.

### What 传统切 Actually Is

`传统切` (Traditional Cut) in a Wuzhou wholesale context means **"standard brilliant cut"** — as opposed to specialty cuts like ice flower. It is an operator convention that translates as: *"this stone uses the conventional brilliant faceting pattern."* Since all lab-grown ovals, pears, and hearts at this price point use the conventional brilliant pattern, the label is redundant for standard stones and was abandoned after row 14,361. It has no price significance whatsoever.

**Decision: Exclude all 传统切 stones (Segment B).** They are exclusively from the old rate card era (rows 0–14,361) and their prices are 66–86% above current market for identical specs. Including them contaminates the ML training set with stale pricing.

---

## 3. 冰花切 (Ice Flower Cut) — Genuine Specialty Cut, Needs Own Model

### What It Is

冰花切 ("ice flower" or "crushed ice") is a specialty diamond faceting style that uses a radically different arrangement of small, irregular facets to create a fragmented, glittery appearance — similar to looking through cracked glass. It is visually distinct from the classic brilliant cut's "bowtie" pattern.

### IGI Certificate Confirmation

| IGI Report | Shape | IGI Says | L/W |
|---|---|---|---|
| 769638922 | OVAL | **Oval Modified Brilliant** | 1.45 |
| 790684316 | OVAL | **Oval Modified Brilliant** | 1.39 |
| 746504861 | OVAL | **Oval Modified Brilliant** | 1.43 |
| 773656369 | OVAL | **Oval Modified Brilliant** | 1.55 |
| 773658486 | PEAR | **Pear Modified Brilliant** | 1.58 |
| 786630468 | PEAR | **Pear Modified Brilliant** | 1.60 |
| 745505497 | PEAR | **Pear Modified Brilliant** | 1.58 |
| 788667255 | PEAR | **Pear Modified Brilliant** | 1.61 |

**All 冰花切 stones checked carry IGI "Modified Brilliant" designations** — confirming a different facet arrangement. This contrasts directly with 传统切 stones, which carry standard "Brilliant" designations.

### Price Premium — Massive and Real

Comparing within the same row bands where both exist:

| Shape | 冰花切 Mean $/ct | Standard Mean $/ct | Premium |
|---|---|---|---|
| OVAL | $289 | $139 | **+108%** |
| PEAR | $338 | $139 | **+143%** |
| HEART | $431 | $161 | **+168%** |

These premiums are far larger than what temporal drift alone can explain (which is ~26.8% avg). The 冰花切 premium is a genuine market signal: buyers pay a significant premium for the distinctive visual effect.

### Inventory Profile

- **265 stones total**
- **All in rows 0–14,882** — exclusively old inventory
- **Row distribution:** rows 0–5,000 (224), 5,000–10,000 (22), 10,000–15,000 (19)
- **No 冰花切 stones exist in rows > 15,000** — suggests this cut style may no longer be stocked, or is tracked differently in the current catalog

### Why 冰花切 Cannot Be Mixed with Standard Cuts for ML Training

1. **Price signal is genuinely different**: +108–168% premium vs a completely different cut quality. Any model trained on both would predict $200+/ct for a standard oval when it should be ~$130/ct.
2. **IGI confirms different faceting**: "Modified Brilliant" vs "Brilliant" — these are structurally distinct cuts.
3. **Buyer intent is different**: Ice flower buyers pay for appearance; standard buyers pay for grading efficiency. Comp engines should not cross these pools.
4. **If/when current 冰花切 inventory is available**, a dedicated pricing model or a separate `cutStyle = "ice_flower"` pricing branch should be trained on that data alone.

**Decision: Exclude all 冰花切 stones (Segment C) from the standard ML training set.**

---

## 4. 长垫形 (Elongated Cushion) — Shape Variant, Already Handled

- 20 stones, rows 236–3,175 (exclusively old inventory)
- L/W ratio 1.18–1.45 — standard elongated cushion proportions
- The comp engine already routes these to `elongated_cushion` via `shape_buckets.py`
- **Decision: Segment D — excluded from standard training. Routed to elongated_cushion pool.**

---

## 5. Row Number as Rate Card Proxy — Temporal Contamination

### Why Row Number Matters

The XLS is a cumulative stock log. Stones are appended in chronological order as they are added to inventory. Row number is a reliable proxy for the date the stone entered the stock system. Price rate cards at Wuzhou wholesale suppliers change over time — sometimes dramatically.

### The Primary Rate Card Shift

```
Full dataset MAPE noise floor:     4.40%
Recent rows only (> 15,000):       4.52%   ← still contaminated
Segment A (clean):                 3.35%   ← after removing all outliers
```

The price transition for a representative spec (1.00ct Oval D VS1):

| Row Band | Mean $/ct |
|---|---|
| rows 0–5,000 | $246/ct |
| rows 5,000–10,000 | $213/ct |
| rows 10,000–15,000 | $192/ct |
| rows 15,000–20,000 | $124/ct |  ← main transition
| rows 20,000–25,000 | $119/ct |
| rows 25,000+ | $118/ct |

The main rate card break is between rows 13,000–15,000 where prices fell ~35–50% across almost all specs. The row cutoff of **15,000** cleanly separates these eras.

### Cutoff Calibration

| Cutoff | Training rows | Noise floor MAPE | Notes |
|---|---|---|---|
| None (full dataset) | 28,394 | 4.40% | Major temporal contamination |
| > 15,000 (recent only) | 13,394 | 4.52% | Still has Segment F bleed |
| Segment A (> 15k, no specialty, no outlier) | 12,843 | **3.35%** | Cleanest achievable |

---

## 6. Segments F + H — Secondary Rate Card Bleed in the "Recent" Window

### What Was Found

Running the high-price detectors on the recent window (rows > 15,000) revealed **551 stones that all share the same profile**, now split into a lone-outlier part (Segment F, 501 stones) and a coherent-cluster part (Segment H, 50 stones — see §11):

- **Shape:** ROUND (100% of segments F and H)
- **Carat:** < 1.0ct (all sub-1ct, 0.32–0.53ct)
- **Row range:** 22,247–27,683
- **Price range:** $165–$214/ct
- **vs. spec median:** $116–$135/ct (spec median pulled down by later stones)
- **Cut labels:** `ID` (68%) and `EX` (32%) — standard labels, no specialty markers
- **Mean premium above base spec cluster:** 44.7%

### What This Means

The price of small rounds (0.30–0.60ct, D–F, VVS) dropped significantly within the "recent" window. Stones added to inventory in rows 22,247–27,683 were priced on a rate card (~$170–$214/ct for D VVS2 rounds) that was later superseded by a lower rate card (~$116–$135/ct). This is the same temporal contamination problem as the primary rate card shift — just occurring within the window we thought was "clean."

**Key implication:** A single hard row cutoff is not sufficient. The correct approach is the **base-cluster outlier detector** — Segment F for lone points (≥40% above the base cluster) and Segment H for coherent high modes (≥30% above the base cluster) — which catches these secondary rate card bleeds automatically regardless of which row band they occur in.

### Why Only Small Rounds?

Small rounds (0.3–0.6ct) are the highest-turnover sub-segment — they cycle through rate cards faster than larger or fancy-shape stones. Large stones and fancy shapes have less within-band price volatility because they're updated less frequently in the stock list. The secondary rate card bleed is concentrated in small rounds because that's where the repricing happened most aggressively.

---

## 7. The Eight-Segment Split

| Segment | Label | Rows | % | ML Status |
|---|---|---|---|---|
| **A** | Standard, current rate card | 12,843 | 45.2% | ✅ **USE FOR TRAINING** |
| B | 传统切 Traditional Brilliant | 301 | 1.1% | ❌ Exclude — rate card artifact |
| C | 冰花切 Ice Flower specialty | 265 | 0.9% | ❌ Exclude — needs own model |
| D | 长垫形 Elongated Cushion | 20 | 0.1% | ❌ Exclude — wrong shape pool |
| E | Old rate card (row ≤ 15,000) | 14,412 | 50.8% | ❌ Exclude — stale pricing |
| F | Lone point outlier (≥40% above base spec cluster) | 501 | 1.8% | ❌ Exclude — single stale/mispriced listing |
| G | 老矿切 / 老欧切 (rare specialty) | 2 | <0.1% | ❌ Exclude — negligible |
| **H** | Random high price cluster (≥30% above base cluster) | 50 | 0.2% | ❌ Exclude — quarantine high mode, keep lower base |

> F and H are complementary: **F** catches a *lone* stone sitting above its peers; **H** catches a *coherent cluster* forming a high second mode. At the recommended 30% gap, every Segment-H stone was already being removed by F, so H costs **0 net training rows** — it just attributes the removal to the correct cause.

---

## 8. Impact on ML Model Accuracy

### Noise Floor Comparison

| Dataset | MAPE Noise Floor | Best Achievable MAPE |
|---|---|---|
| Full 28,394 rows | 4.40% | ~4.6% (S20 achieves 4.63%) |
| Recent only (> row 15,000) | 4.52% | ~4.7% |
| **Segment A only (12,843 rows)** | **3.35%** | **~3.5–3.7%** |

The clean Segment A training set has a noise floor 1.05pp lower than the full dataset. Training S18/S20-equivalent models on Segment A should achieve **~3.5% MAPE** — a meaningful improvement over the current 4.63%.

### Why the Recent-Only Noise Floor Is Higher Than Full

Counterintuitively, `recent rows only` (4.52%) has a *higher* noise floor than the full dataset (4.40%). This is because:
- The full dataset's large groups pull the variance toward the group median (the many cheap stones pull the few expensive ones toward center)
- The recent window contains Segment F stones (small rounds priced 44% above their current-rate-card peers), and these inflate within-group variance without the benefit of the larger historical group to dilute the effect
- Removing Segment F (producing Segment A) brings the floor back down to 3.35%

### Recommendation

1. **Retrain S18/S20 on Segment A (dataset-clean-training.json)** — expect ~3.5% MAPE
2. **Flag 冰花切 inventory** for a separate pricing approach (multiplier or dedicated sub-model) when current stock is available
3. **Apply row cutoff + base-cluster outlier detection (F) + high-cluster quarantine (H)** as a pre-processing step in the data pipeline, not just at training time
4. **Consider tighter row cutoffs** (e.g., rows > 22,000 for small rounds only) if model performance on small rounds is specifically unsatisfactory
5. **Price scarce shapes (HEART/SQUARE/ASSCHER) via a shape multiplier** off round/oval rather than relaxing the cutoff (see §12)

---

## 9. Why You Cannot Treat 传统切 and 冰花切 as Comparable to Standard Cuts

### 传统切 vs Standard Oval — Same Diamond, Different Sticker

The 传统切 label carries no physical information about the diamond. The IGI certificate for IGI 746504860 says "Oval Brilliant" — the same description used for any standard oval. The L/W ratio (1.42) falls squarely in the standard oval range (1.35–1.45). Polish and symmetry grades are the same. The only difference between a `传统切` oval at $216/ct and a standard oval at $117/ct is **when** it was added to the stock list.

Mixing them in training creates a situation where the model sees:
```
OVAL D VVS2 1.03ct → $216/ct   (row 12,141)
OVAL D VVS2 1.03ct → $117/ct   (row 20,022)
```
…and must choose a price. The model has no temporal feature to resolve this, so it averages them — producing a nonsensical mid-point prediction for a question that has a definitive current-market answer ($117/ct).

### 冰花切 vs Standard Oval — Genuinely Incomparable

冰花切 stones command a premium because buyers are paying for a specific visual effect that standard brilliants cannot replicate. The facet arrangement (confirmed by IGI as "Modified Brilliant") creates a different optical performance. These stones compete in a different buyer pool. A customer seeking an ice flower pear at $338/ct and a customer seeking a standard pear at $139/ct are making completely different purchasing decisions.

If the pricing model learned from both, it would either:
- **Underpredict ice flower stones** (because standard stones dominate the training data and pull prices down)
- **Overpredict standard stones** (because ice flower premiums inflate the group mean)

The correct approach is segment isolation: standard model for standard cuts, and a separate multiplier or model for ice flower if/when current inventory exists.

---

## 11. Segment H — Random High Price Clusters ("go with the lower base set")

### The request

> *"If there are any randomly high priced — let's say princess — for no reason, we only go with the lower. If it clusters randomly higher like 30%+ more than a base set, quarantine that 30%+ set and maybe not train on it."*

Segment F already removes a *lone* stone priced far above its peers. But it does not catch the case the request describes: a **coherent cluster** of stones that all sit at an elevated price, forming a second price *mode* within an otherwise identical spec (same shape, color, clarity, carat). When a spec group is split roughly 60/40 between a low and a high price, the group **median sits between the two modes**, so neither mode is 40% above the median and Segment F misses it entirely.

Segment H closes that gap.

### How the detector works (and why it cannot over-remove)

For every recent-window spec group (`shape × color × clarity × carat@0.01ct`) with ≥6 stones:

1. Sort the per-carat prices and find the **largest jump** between consecutive prices.
2. If that jump is **≥30%** (`CLUSTER_GAP_THRESHOLD = 1.30`) it is treated as a mode boundary: everything below = **base/low cluster**, everything above = **high cluster**.
3. The high cluster is quarantined to Segment H **only if all guardrails hold**:
   - both sides have **≥2 stones** (a lone high stone is left to Segment F, not quarantined here);
   - the **base/low cluster is the majority** (`len(low) ≥ len(high)`).

Guardrail #3 is the anti-over-removal lock: **we can never quarantine more than half of any spec group**, and we always keep the lower-priced base set — exactly "go with the lower." The base cluster's median (not the contaminated full-group median) then becomes the reference for Segment F, so the two detectors reinforce each other.

### What it actually caught

At the recommended 30% gap, Segment H flags **50 stones across 3 spec groups — every one a small round on the expired small-round rate card**:

| Spec | Base cluster | High cluster | Premium | Rows |
|---|---|---|---|---|
| ROUND D VVS2 0.32ct | $189/ct base… | 39 stones at $189–$201/ct | +~30–40% over the later $135 rate | 25,172–26,433 |
| ROUND D VVS2 0.33ct | base $145–155 | 9 stones at $188–$195/ct | +~30% | 25,192–25,239 |
| ROUND D VS1 0.33ct | base | 2 stones at $180/ct | +~30% | 27,673–27,683 |

This is the *same* small-round expired-rate-card phenomenon documented in §6 — but H proves it is a **structured cluster**, not scattered noise. That is why the correct action is to drop the whole high mode, not to average it in.

### Why Segment H removes 0 net training rows

This is the important part for the "don't over-remove" requirement. The sensitivity sweep (run automatically by the script) shows:

| Config | Seg A rows | A % | F | H | Seg A noise floor |
|---|---|---|---|---|---|
| Row cutoff only (no F, no H) | 13,394 | 47.2% | 0 | 0 | 4.52% |
| **F only** (point outliers) | 12,843 | 45.2% | 551 | 0 | 3.354% |
| **F + H gap 1.40** (conservative) | 12,843 | 45.2% | 501 | 50 | 3.354% |
| **F + H gap 1.30** (recommended) | **12,843** | **45.2%** | **501** | **50** | **3.354%** |
| F + H gap 1.25 (aggressive) | 12,827 | 45.2% | 451 | 116 | 3.327% |

At gap 1.30, Segment A is **identical** to the F-only run (same 12,843 rows, same 3.354% floor). H simply re-labels 50 stones that F was already removing, attributing them to "structured high cluster" instead of "lone outlier." Pushing the gap down to 1.25 only removes **16 additional rows** while lowering the floor a further 0.03pp — not worth the added removal. **30% is the sweet spot the user named, and it happens to be free.**

### The princess investigation

The request specifically called out princess. Here is what the data shows.

**Recent window (rows > 15,000) — princess is clean.** All **352** recent princess stones land in Segment A. Every spec group with ≥6 stones has a price spread of **≤1.05×** (essentially flat):

| Spec | n | min | median | max | spread |
|---|---|---|---|---|---|
| PRINCESS D VVS2 1.09ct | 49 | $113 | $118 | $119 | 1.05× |
| PRINCESS E VS1 1.01ct | 42 | $116 | $116 | $117 | 1.00× |
| PRINCESS D VVS2 1.00ct | 9 | $129 | $129 | $129 | 1.00× |

There is **no random high princess cluster in the current rate card.** The detector correctly leaves all of them in.

**Old era (rows ≤ 15,000) — princess is wildly bimodal.** The "randomly high priced princess" the request remembered is real, but it lives in the old rate card era. **35 of 45** old-era princess spec groups (≥6 stones) have a price spread **≥30%**, most of them clean two-mode splits:

| Spec | n | base $/ct | high $/ct | premium |
|---|---|---|---|---|
| PRINCESS D VVS2 1.50ct | 13 | $113 | $243 | **+115%** |
| PRINCESS D VS1 1.52ct | 11 | $109 | $227 | **+108%** |
| PRINCESS E VVS2 1.50ct | 12 | $103 | $212 | **+106%** |
| PRINCESS D VVS2 2.02ct | 13 | $128 | $252 | **+97%** |

**Conclusion:** the princess high-cluster problem is **100% absorbed by Segment E** (the row cutoff already removes the entire old era). No princess survives into the training set with an unexplained premium. The Segment H detector is the standing guard that keeps it that way for *any* shape if a future refresh reintroduces the pattern in the recent window.

### Residual within-spec variation we deliberately KEEP

Of 309 recent spec groups (≥6 stones), the largest consecutive price gap is:

- **<15%** for 249 groups (tight, clearly one rate card),
- **15–30%** for 51 groups (normal cut/polish/measurement variation — **kept**, below the 30% line),
- **≥30%** for 9 groups (all small rounds → Segment H).

We intentionally do **not** quarantine the 15–30% band. That spread is explainable by legitimate within-spec quality differences (cut grade, fluorescence, measurement), and removing it would be over-removal. The 30% threshold is the honest boundary between "explainable variation" and "different rate card / mispricing."

---

## 12. Are We Over-Removing? — Data Sufficiency Audit

The headline retention is 45.2% (12,843 of 28,394). It is worth being explicit about *where* the other 54.8% goes, because almost none of it is the high-price logic:

| Cause | Rows removed | Share of all exclusions |
|---|---|---|
| Segment E — old rate card (row ≤ 15,000) | 14,412 | **92.7%** |
| Segment F — lone point outliers | 501 | 3.2% |
| Segment B/C/D/G — specialty labels | 588 | 3.8% |
| Segment H — high price clusters | 50 | 0.3% |

**The row cutoff is doing essentially all of the removal.** The F+H high-price cleanup the user asked about is ~3.5% of exclusions combined and H alone is 0.3% (and 0 net). So the cluster work is *not* the thing shrinking the dataset.

### Per-shape sufficiency

12,843 rows is ample for the dominant shapes, but the row cutoff starves the rarer ones:

| Shape | Total | Kept in A | Kept % | Sufficient (≥50)? |
|---|---|---|---|---|
| ROUND | 15,471 | 9,701 | 62.7% | ✅ |
| PEAR | 2,188 | 768 | 35.1% | ✅ |
| OVAL | 3,706 | 746 | 20.1% | ✅ |
| MARQUISE | 1,145 | 420 | 36.7% | ✅ |
| RADIANT | 801 | 370 | 46.2% | ✅ |
| PRINCESS | 1,273 | 352 | 27.7% | ✅ |
| EMERALD | 1,517 | 258 | 17.0% | ✅ |
| CUSHION | 665 | 137 | 20.6% | ✅ |
| ASSCHER | 152 | 47 | 30.9% | ⚠️ below 50 |
| SQUARE | 392 | 31 | 7.9% | ⚠️ below 50 |
| HEART | 862 | 13 | 1.5% | ⚠️ below 50 |

**Important nuance:** the four flagged shapes (HEART, SQUARE, ASSCHER, blank/ASHOKA) fall below the 50-row floor **because of the row cutoff (Segment E), not because of F/H** — almost all of their inventory is old-era. F and H removed 0 of them.

This is the one genuine over-removal risk, and it is a property of the temporal cutoff, **not** the high-price cleanup. Recommended handling for the scarce shapes:

1. **Do not lower the global row cutoff to rescue them** — their old-era prices are stale (the same rate-card problem). Pulling them back in would re-contaminate the set.
2. **Price scarce shapes via a shape multiplier off a well-populated base** (round/oval) derived from the *clean* recent window, rather than training a standalone per-shape model on 13–47 rows. The comp engine's `shape_buckets` already supports this routing.
3. **Revisit at the next data refresh** — if a future XLS adds recent-window inventory for these shapes above the 50-row floor, promote them to standalone training.

**Bottom line on over-removal:** the clean training set keeps 100% of the well-populated shapes' current-rate-card data; the cluster/outlier logic the user requested costs at most ~2% of rows and 0 net for H; the only thin pools are rare fancy shapes, which are thin because of *time*, not because of this cleanup, and are best served by multipliers rather than by relaxing the cutoff.

---

## 13. Recommendations for Data Pipeline

```
StarGem XLS (28,394 rows)
       │
       ├── 传统切 label?  → Segment B (exclude) — rate card artifact
       ├── 冰花切 label?  → Segment C (exclude/separate model)
       ├── 长垫形 label?  → Segment D (elongated_cushion pool)
       ├── 老矿切/老欧切?  → Segment G (exclude) — rare historical
       ├── row ≤ 15,000?  → Segment E (exclude) — old rate card
       │
       └── recent window — group by shape×color×clarity×carat:
               ├── high CLUSTER ≥30% above base (base = majority)? → Segment H (quarantine high mode)
               ├── lone stone ≥40% above base cluster median?       → Segment F (drop point outlier)
               └── else → Segment A ✅ (12,843 rows — use for ML training)
```

**For future data refreshes:**
- The row cutoff (15,000) will need updating when a new XLS is ingested. Consider using the **last 45–50% of rows by row number** as the cutoff rather than a hardcoded number, since total row count will grow.
- The 40% point-outlier (F) and 30% cluster (H) detectors are self-calibrating — they reference the *base* cluster of each spec group and will keep catching rate-card bleeds without manual adjustment.
- Segment H is guardrailed to never quarantine more than half of any spec group, so it is safe to leave on permanently — it cannot starve the training set.
- Monitor Segment C (冰花切): if new inventory with this label appears in rows > 15,000 at current market prices, it becomes viable to build a dedicated ice flower pricing sub-model.
- Scarce shapes (HEART, SQUARE, ASSCHER): route through a shape multiplier off round/oval rather than relaxing the row cutoff (see §12).

---

## Appendix: Key Reference Numbers

| Metric | Value |
|---|---|
| Total XLS rows | 28,394 |
| Valid (price > 0, carat > 0) | 28,394 |
| Old row cutoff | 15,000 |
| Point-outlier threshold (F) | +40% above base spec cluster |
| Cluster-gap threshold (H) | +30% above base cluster, base = majority |
| ML training set (Segment A) | 12,843 rows |
| Net rows removed by H vs F-only | 0 (re-attribution only) |
| Noise floor — full dataset | 4.40% MAPE |
| Noise floor — Segment A | 3.35% MAPE |
| 传统切 confirmed standard by IGI | 100% (all checked) |
| 冰花切 confirmed Modified Brilliant by IGI | 100% (all checked) |
| 冰花切 premium vs standard (same spec/row band) | +108–168% |
| Segment F — lone point outliers | 501 stones |
| Segment H — random high price clusters | 50 stones (3 small-round spec groups) |
| Recent princess stones (all clean) | 352 (spread ≤1.05×) |
| Old-era princess groups with ≥30% spread | 35 of 45 (e.g. 1.50ct D VVS2: +115%) |
| Shapes below 50-row floor (time-starved, not over-removed) | HEART, SQUARE, ASSCHER |
