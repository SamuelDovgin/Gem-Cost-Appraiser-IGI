# Research

This folder keeps supporting research and capture tooling out of the published app root.

## Start here (white-diamond ML)

- **[`latest-models-comprehensive-evaluation-report.md`](latest-models-comprehensive-evaluation-report.md)** — multi-split evaluation of S26, S28, S29, S30, S31 (MAPE by holdout type, per-model recommendations, literature).
- **[`white-diamond-ml-pricing-research-report.md`](white-diamond-ml-pricing-research-report.md)** — consolidated report: cleaned dataset, full model history (S7–S31), S28 v0.4 re-fit, production decision, constraints, comprehensive benchmarks, and tiered hybrid architecture.
- **[`white-diamond-ml-pricing-improvement-plan.md`](white-diamond-ml-pricing-improvement-plan.md)** — highest-value implementation order for the anchor + fixed S28 surface + shrunk residual direction.
- **[`S30-bounded-smooth-median-prototype.md`](S30-bounded-smooth-median-prototype.md)** — research-only bounded smooth median curve prototype inspired by the clean rolling-median chart behavior.
- Charts: `npm run research:ml-explainer` → [`ml-model-explainer.html`](ml-model-explainer.html) (after `npm run serve`).

## Contents

- `alibaba-capture.html` - bookmarklet capture page for quick Alibaba listing notes.
- `alibaba-capture-extension/` - local Chrome extension for Alibaba SKU capture.
- `data/` - raw Alibaba capture JSON files.
- `data/alibaba-comps-index.json` - machine-readable promoted comp rows (shape, color, clarity, carat, price, product URL) for search/bot matching.
- `alibaba-clean-source-of-truth.md` - promoted Alibaba comps with evidence notes.
- `alibaba-listing-confidence-gaps.md` - missing or weak comp areas to revisit.
- `alibaba-source-of-truth-maintenance.md` - rules for maintaining raw and promoted capture data.
- `alibaba-llm-agent-intake-guide.md` - operational guide for future LLM agents parsing capture JSON and updating confidence gaps.
- `alibaba-comp-matcher-igi-app-implementation.md` - how to wire stone search → Alibaba link + price in `index.html`, including assumptions and phases.
- `data/igi-certified-elongated-cushion-cut-lab-grown-diamond-1--sku-prices.json` - white cushion and elongated cushion captures.
- `data/hpht-cvd-loose-lab-grown-diamond-cushion-def-gh-vvs-vs-i-sku-prices.json` - cushion/fancy-color mixed capture session.
- `data/fancy-color-yellow-princess-cut-def-vvs-vs-1ct-2ct-3ct-4-sku-prices.json` - white princess ladders, DE bands, and fancy yellow princess session.
- `data/in-stock-asscher-shape-igi-cvd-htpt-diamond-1ct-5ct-high-sku-prices.json` - white asscher D/DEF ladders, E bands, and fancy blue asscher corroboration.
- `data/alibaba-com-manufacturers-suppliers-exporters-importers--sku-prices.json` - heart-cut session: white D partial ladder, vivid pink heart ladder, pink VS1 ladder.
- `data/0-3ct-0-5ct-1ct-1-5ct-2ct-3ct-4ct-cvd-diamond-starsgem-r-sku-prices.json` - large Starsgem/Messi multi-shape capture; **resolves white radiant D VS/VVS 1-5ct ladder** (`1601715356045`). No marquise selector on that listing.
- `data/1ct-2ct-3ct-lab-loose-diamond-white-d-e-vvs-vs-igi-certi-sku-prices.json` - white marquise session; **primary D marquise VS/VVS ladder** (`1601406519145`) plus Starsgem corroboration.
- `*-pricing.md`, `*-comps.md`, and `*-reference.md` - pricing model research notes.
- `igi-shape-verification-progress.md` - resume log for slow IGI PDF shape checks on Starsgem/Messi round stock (FDR slug prefix, rate-limit safe).
- `igi-enrichment-progress.md` - full IGI PDF enrichment (all shapes): dimensions, ratio, 4Cs, mapped cut (`igi-enrich-all.py`).
- `data/igi-report-enrichment.json` - machine store for per-report IGI fields (resume-safe).
- `archive/` - older app snapshots used during pricing migration.
- `assets/` - screenshots and other research support files.
