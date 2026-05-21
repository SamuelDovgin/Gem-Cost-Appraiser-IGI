# Extension Commands

After every extension code change:

1. Bump `version` in `manifest.json`.
2. Validate files:

   ```sh
   node --check content.js
   node --check popup.js
   python3 -m json.tool manifest.json >/dev/null
   ```

3. Reload in Chrome:

   - Open `chrome://extensions`
   - Find **Gem Appraise Alibaba Capture**
   - Click the reload icon
   - Refresh any open Alibaba listing tabs

4. If capture output shape changed, click **Clear saved** in the extension before collecting new data.
