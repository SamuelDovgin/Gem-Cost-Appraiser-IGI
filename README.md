# Gem Cost Appraiser IGI

A single-page lab-grown diamond price calculator for loose IGI-certified stones. It estimates wholesale cost, fair direct/auction pricing, and traditional retail range from carat, color, clarity, shape, cut, seller channel, growth method, and optional asking price.

**v3.1 (May 2026):** White diamonds re-anchored to **E/VS1** with steeper SI1/SI2 discounts, cert-auto modifiers (CVD, post-treatment, no cut grade), and IGI **LG563297279** calibration (**2.01ct F SI1 pear**, ~$100 TikTok). See `research/white-diamond-igi-wholesale-pricing.md`.

## Live Site

After GitHub Pages is enabled, the app will be available at:

https://samueldovgin.github.io/Gem-Cost-Appraiser-IGI/

## Files

- `index.html` - the full calculator app.
- `favicon.svg` / `apple-touch-icon.png` - published app icons.
- `research/` - Alibaba captures, source data, extension tooling, audit notes, and pricing research.
- `research/alibaba-capture.html` - one-click bookmarklet + inbox for recording Alibaba listing prices while you browse.
- `research/alibaba-capture-extension/` - local Chrome extension for deeper Alibaba SKU capture.

## GitHub Pages Setup

In the GitHub repository, go to **Settings -> Pages** and use:

- Source: `Deploy from a branch`
- Branch: `main`
- Folder: `/ (root)`

Save the setting, then GitHub will publish the site at the URL above.

## Local Preview

Open `index.html` directly in a browser, or run a tiny static server from this folder:

```sh
python3 -m http.server 8080
```

Then visit `http://localhost:8080`.

## Alibaba comp capture (one click)

1. Open `research/alibaba-capture.html` in your browser (file:// or via the local server above).
2. Drag **Capture Alibaba listing** to your bookmarks bar.
3. On Alibaba: open a product page (best) or a search/showroom page → click the bookmark → row copied.
4. Switch to the capture tab and paste once (<kbd>⌘V</kbd>) — it appends to the table.
5. **Export markdown table** when done, or paste the export into chat for cleanup.

On search pages, one click can grab up to ~8 visible listing snippets. Product pages grab title, supplier, prices, MOQ, promo, and selected SKU chips when Alibaba exposes them in the DOM.

## Notes

This tool is a pricing sanity check, not a formal appraisal. Always verify the IGI report number, inscription, measurements, seller return policy, and current market comps before buying.
