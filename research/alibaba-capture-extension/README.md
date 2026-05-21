# Gem Appraise Alibaba Capture Extension

Local Chrome extension for capturing Alibaba lab diamond listing data after you solve any captcha yourself.

## Install

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder:

   `/Users/samueldovgin/Developer/Gem Appraise/research/alibaba-capture-extension`

## Use

1. Open an Alibaba product listing.
2. Solve any captcha and let the page finish loading.
3. Click **Select now** if Alibaba has a SKU side panel.
4. Leave **Watching** on in the floating **Gem Capture** panel.
5. Manually click options such as **VVS2** and **VS1**. The extension records the selected options and the visible carat/price rows after each click.
6. Click **Capture** if you want to force-save the current SKU state. If shape, cut grade, color, clarity, or carat is still missing, the page will ask for any visible values before saving.
7. Click **Download** or **Copy JSON**, then send that JSON for parsing.

## Notes

- There is no automatic clicker. You control Alibaba; the extension only watches and records after your clicks.
- Auto-capture stays quiet. Missing-value prompts only appear when you press **Capture** manually.
- The saved JSON includes normalized fields, source/evidence snippets, visible key attributes, selected SKU options, range/MOQ, price rows, inventory, and shipping.
- For vague titles, check `sourceContext.keyAttributes` and `normalized.*.source`. Alibaba often hides values like `Diamond Shape` in key attributes or `window.detailData`.
- Captures are stored in Chrome extension storage until you press **Clear saved**.
- For update/reload steps after extension edits, see `COMMANDS.md`.
