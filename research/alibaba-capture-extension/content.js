(() => {
  const STORAGE_KEY = "gemAppraiseAlibabaCaptures";
  const PANEL_ID = "gem-appraise-capture-panel";
  const TOAST_ID = "gem-appraise-capture-toast";
  const MUTATION_CAPTURE_DELAY_MS = 90;
  const CLICK_FALLBACK_DELAY_MS = 300;
  const SOURCE_SNIPPET_KEYWORDS = [
    "Diamond Shape",
    "Diamond Cut",
    "White Diamond Color",
    "Fancy Diamond Color",
    "Diamond Carat Weight",
    "Diamond Clarity",
    "Certificate Type",
    "Certificate NO"
  ];
  const SHAPE_TERMS = [
    "round brilliant",
    "round",
    "moval",
    "oval",
    "emerald",
    "pear",
    "radiant",
    "cushion",
    "princess",
    "marquise",
    "heart",
    "asscher",
    "portuguese"
  ];

  if (window.__gemAppraiseAlibabaCaptureLoaded) return;
  window.__gemAppraiseAlibabaCaptureLoaded = true;

  let autoCaptureEnabled = true;
  let autoCaptureTimer = null;
  let lastSignature = "";

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function unique(values) {
    return [...new Set(values.map(normalizeText).filter(Boolean))];
  }

  function titleCase(value) {
    return normalizeText(value).toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
  }

  function limitText(value, maxLength = 900) {
    const text = normalizeText(value);
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  }

  function moneyToNumber(value) {
    const cleaned = normalizeText(value).replace(/[^\d.]/g, "");
    return cleaned ? Number(cleaned) : null;
  }

  function getStorage() {
    return new Promise((resolve) => {
      chrome.storage.local.get({ [STORAGE_KEY]: [] }, (result) => {
        resolve(Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : []);
      });
    });
  }

  function setStorage(captures) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEY]: captures }, resolve);
    });
  }

  function showToast(message) {
    document.getElementById(TOAST_ID)?.remove();
    const toast = document.createElement("div");
    toast.id = TOAST_ID;
    toast.textContent = message;
    document.body.append(toast);
    setTimeout(() => toast.remove(), 2200);
  }

  function setStatus(message) {
    const status = document.querySelector(`#${PANEL_ID} .ga-status`);
    if (status) status.textContent = message;
  }

  function updateCount(count) {
    const countEl = document.querySelector(`#${PANEL_ID} .ga-count`);
    if (countEl) countEl.textContent = `${count} saved`;
  }

  function getTitle() {
    const candidates = [
      document.querySelector("h1"),
      document.querySelector('[class*="product-title"]'),
      document.querySelector('[class*="ProductTitle"]'),
      document.querySelector('meta[property="og:title"]')
    ];

    for (const el of candidates) {
      const value = el?.content || el?.innerText;
      const title = normalizeText(value).replace(/\s*[-|].*Alibaba.*$/i, "");
      if (title) return title.slice(0, 240);
    }

    return normalizeText(document.title).slice(0, 240);
  }

  function getSupplier() {
    const selectors = [
      'a[href*="company_profile"]',
      '[class*="company-name"]',
      '[class*="CompanyName"]',
      '[class*="supplier"]',
      '[class*="Supplier"]',
      '[class*="seller"]',
      '[class*="Seller"]'
    ];

    for (const selector of selectors) {
      const text = normalizeText(document.querySelector(selector)?.innerText);
      if (text && text.length < 140) return text;
    }

    const match = document.body.innerText.match(/(?:Sold by|Supplier|Company)[:\s]*([^\n]{4,90})/i);
    return normalizeText(match?.[1]).slice(0, 120);
  }

  function getProductId() {
    const urlMatch = location.href.match(/(?:product-detail\/[^/]*_|productId=)(\d{8,})/i);
    if (urlMatch) return urlMatch[1];
    const formValue = document.querySelector('input[name="productId"]')?.value;
    return normalizeText(formValue);
  }

  function getShapeFromTitle(title) {
    const match = title.match(/\b(oval|round|emerald|pear|radiant|cushion|princess|marquise|heart|asscher|portuguese)\b/i);
    return match ? match[1].toLowerCase() : "";
  }

  function readMeta(name) {
    return normalizeText(
      document.querySelector(`meta[name="${name}"]`)?.content
      || document.querySelector(`meta[property="${name}"]`)?.content
    );
  }

  function extractBalancedObject(text, startIndex) {
    if (startIndex < 0 || text[startIndex] !== "{") return "";
    let depth = 0;
    let quote = "";
    let escaped = false;

    for (let i = startIndex; i < text.length; i += 1) {
      const char = text[i];
      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === quote) {
          quote = "";
        }
        continue;
      }

      if (char === '"' || char === "'") {
        quote = char;
      } else if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) return text.slice(startIndex, i + 1);
      }
    }

    return "";
  }

  function extractDetailData() {
    const marker = "window.detailData";
    for (const script of document.scripts) {
      const text = script.textContent || "";
      const markerIndex = text.indexOf(marker);
      if (markerIndex < 0) continue;
      const equalsIndex = text.indexOf("=", markerIndex);
      const objectStart = text.indexOf("{", equalsIndex);
      const objectText = extractBalancedObject(text, objectStart);
      if (!objectText) continue;
      try {
        return { data: JSON.parse(objectText), found: true, parseError: "" };
      } catch (error) {
        return { data: null, found: true, parseError: String(error.message || error) };
      }
    }

    return { data: null, found: false, parseError: "" };
  }

  function addAttribute(target, name, value, source) {
    const cleanName = normalizeText(name);
    const cleanValue = normalizeText(value);
    if (!cleanName || !cleanValue) return;
    const duplicate = target.some((item) => item.name === cleanName && item.value === cleanValue && item.source === source);
    if (!duplicate) target.push({ name: cleanName, value: cleanValue, source });
  }

  function collectAttributeList(target, list, source) {
    if (!Array.isArray(list)) return;
    list.forEach((item) => {
      if (!item || typeof item !== "object") return;
      addAttribute(
        target,
        item.attribute || item.attrName || item.name || item.title || item.key,
        item.value || item.attrValue || item.text || item.val,
        source
      );
    });
  }

  function collectDetailDataAttributes(detailData) {
    const attributes = [];
    const globalProduct = detailData?.globalData?.product || detailData?.product || {};
    collectAttributeList(attributes, globalProduct.productBasicProperties, "detailData.productBasicProperties");
    collectAttributeList(attributes, globalProduct.productKeyIndustryProperties, "detailData.productKeyIndustryProperties");
    collectAttributeList(attributes, globalProduct.productOtherProperties, "detailData.productOtherProperties");
    collectAttributeList(attributes, globalProduct.productProperties, "detailData.productProperties");

    const sortedGroups = detailData?.nodeMap?.module_sorted_attribute?.privateData?.productSortedProperties;
    if (Array.isArray(sortedGroups)) {
      sortedGroups.forEach((group) => collectAttributeList(attributes, group?.attributeList, "detailData.module_sorted_attribute"));
    }

    collectAttributeList(
      attributes,
      detailData?.nodeMap?.module_3_tab_key_attribute?.privateData?.attributeList,
      "detailData.module_3_tab_key_attribute"
    );

    return attributes;
  }

  function collectDomAttributes() {
    const attributes = [];

    document.querySelectorAll('[data-testid="module-attribute-row"]').forEach((row) => {
      addAttribute(
        attributes,
        row.querySelector('[data-testid="module-attribute-name"]')?.getAttribute("title")
          || row.querySelector('[data-testid="module-attribute-name"]')?.innerText,
        row.querySelector('[data-testid="module-attribute-value"]')?.getAttribute("title")
          || row.querySelector('[data-testid="module-attribute-value"]')?.innerText,
        "dom.module_attribute"
      );
    });

    document.querySelectorAll('[data-testid="three-column-key-attributes-row"] > div').forEach((cell) => {
      const lines = [...cell.querySelectorAll("p")].map((el) => normalizeText(el.getAttribute("title") || el.innerText));
      if (lines.length >= 2) addAttribute(attributes, lines[0], lines[1], "dom.three_column_key_attributes");
    });

    return attributes;
  }

  function collectSkuAttrsFromDetailData(detailData) {
    const globalProduct = detailData?.globalData?.product || detailData?.product || {};
    const skuAttrs = globalProduct?.sku?.skuAttrs || [];
    if (!Array.isArray(skuAttrs)) return [];

    return skuAttrs.map((attr) => ({
      name: normalizeText(attr.name || attr.skuAttrName || attr.attributeName),
      values: unique((attr.valueList || attr.values || []).map((value) => (
        value.name || value.value || value.skuAttrValue || value.skuValue
      )))
    })).filter((attr) => attr.name || attr.values.length);
  }

  function collectSourceSnippets() {
    const html = document.documentElement.outerHTML || "";
    return SOURCE_SNIPPET_KEYWORDS.map((keyword) => {
      const index = html.toLowerCase().indexOf(keyword.toLowerCase());
      if (index < 0) return null;
      const start = Math.max(0, index - 420);
      const end = Math.min(html.length, index + keyword.length + 720);
      return {
        keyword,
        snippet: limitText(html.slice(start, end), 1200)
      };
    }).filter(Boolean);
  }

  function collectTextSnippets() {
    const text = document.body?.innerText || "";
    return SOURCE_SNIPPET_KEYWORDS.map((keyword) => {
      const index = text.toLowerCase().indexOf(keyword.toLowerCase());
      if (index < 0) return null;
      const start = Math.max(0, index - 180);
      const end = Math.min(text.length, index + keyword.length + 360);
      return {
        keyword,
        snippet: limitText(text.slice(start, end), 650)
      };
    }).filter(Boolean);
  }

  function collectSourceContext(root, selectedOptions) {
    const detailDataResult = extractDetailData();
    const detailDataAttributes = collectDetailDataAttributes(detailDataResult.data);
    const domAttributes = collectDomAttributes();
    const attributes = [...detailDataAttributes, ...domAttributes];

    return {
      meta: {
        documentTitle: normalizeText(document.title).slice(0, 300),
        title: readMeta("title") || readMeta("og:title"),
        description: readMeta("description") || readMeta("og:description"),
        keywords: readMeta("keywords"),
        ogUrl: readMeta("og:url"),
        ogImage: readMeta("og:image")
      },
      detailData: {
        found: detailDataResult.found,
        parseError: detailDataResult.parseError,
        skuAttrs: collectSkuAttrsFromDetailData(detailDataResult.data),
        attributeCount: detailDataAttributes.length
      },
      keyAttributes: attributes,
      selectedOptionsText: Object.entries(selectedOptions || {}).map(([name, value]) => `${name}: ${value}`),
      skuPanelText: limitText(root?.innerText || "", 2400),
      pageTextSnippets: collectTextSnippets(),
      pageSourceSnippets: collectSourceSnippets()
    };
  }

  function firstAttributeValue(sourceContext, tests) {
    const attributes = sourceContext?.keyAttributes || [];
    const match = attributes.find((item) => tests.some((test) => test.test(item.name)));
    return match ? { value: match.value, source: match.source, name: match.name } : null;
  }

  function firstPatternValue(candidates, pattern, source) {
    for (const candidate of candidates) {
      const match = normalizeText(candidate).match(pattern);
      if (match) return { value: match[1] || match[0], source };
    }
    return null;
  }

  function normalizeShapeValue(value) {
    const text = normalizeText(value);
    if (!text || /fancy\s+shape/i.test(text)) return "";
    if (/round\s+brilliant/i.test(text)) return "Round Brilliant Cut";
    const lower = text.toLowerCase();
    const term = SHAPE_TERMS.find((shape) => new RegExp(`\\b${shape.replace(/\s+/g, "\\s+")}\\b`, "i").test(lower));
    if (!term) return "";
    if (term === "portuguese") return "Portuguese Cut";
    return `${titleCase(term)} Cut`;
  }

  function normalizeCutGradeValue(value) {
    const text = normalizeText(value);
    if (!text) return "";
    if (/\b3\s*ex\b|\btriple\s+excellent\b/i.test(text)) return "3EX";
    if (/\b2\s*ex\b|\bdouble\s+excellent\b/i.test(text)) return "2EX";
    if (/\bexcellent\b|\bex\b/i.test(text)) return "Excellent";
    if (/\bideal\b/i.test(text)) return "Ideal";
    if (/\bvery\s+good\b|\bvg\b/i.test(text)) return "Very Good";
    if (/\bgood\b/i.test(text)) return "Good";
    return "";
  }

  function normalizeClarityValue(value) {
    const text = normalizeText(value).toUpperCase();
    const match = text.match(/\b(FL|IF|VVS1|VVS2|VVS|VS1|VS2|VS|SI1|SI2|SI|I1|I2|I3)\b/);
    return match ? match[1] : "";
  }

  function normalizeColorValue(value) {
    const text = normalizeText(value);
    if (!text) return "";
    const fancy = text.match(/\bfancy(?:\s+(?:light|intense|vivid|deep|dark))?\s+(pink|blue|yellow|green|orange|purple|red|brown|gray|grey)\b/i);
    if (fancy) return titleCase(fancy[0].replace(/\bgrey\b/i, "gray"));
    const plainFancy = text.match(/\b(pink|blue|yellow|green|orange|purple|red|brown|gray|grey)\b/i);
    if (plainFancy) return titleCase(plainFancy[1].replace(/\bgrey\b/i, "gray"));
    const colorRange = text.match(/\b(D(?:EF|E|F)?|E(?:F)?|F|G(?:H|HI|I)?|H(?:I)?|I|J|K)\b(?:\s*color)?\b/i);
    if (colorRange) return colorRange[1].toUpperCase();
    if (/\bwhite\b/i.test(text)) return "White";
    return "";
  }

  function normalizeCaratValue(value) {
    const text = normalizeText(value);
    const match = text.match(/\b(\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?)\s*(?:ct|carat)\b/i);
    return match ? `${match[1].replace(/\s+/g, "")}ct` : "";
  }

  function confidence(value, source) {
    if (!value) return "missing";
    if (/detailData|dom\.module_attribute|dom\.three_column/i.test(source || "")) return "high";
    if (/selected/i.test(source || "")) return "medium";
    return "low";
  }

  function deriveNormalizedFields({ title, selectedOptions, priceRows, sourceContext }) {
    const selectedText = Object.entries(selectedOptions || {}).map(([name, value]) => `${name}: ${value}`);
    const caratRows = (priceRows || []).map((row) => row.carat);
    const metaText = Object.values(sourceContext?.meta || {});
    const searchText = [title, ...selectedText, ...caratRows, ...metaText];

    const shapeAttr = firstAttributeValue(sourceContext, [/^diamond shape$/i, /^shape$/i]);
    const shapeSelected = firstPatternValue(selectedText, /\b(round brilliant|oval|round|emerald|pear|radiant|cushion|princess|marquise|heart|asscher|portuguese)\b/i, "selectedOptions");
    const shapeText = firstPatternValue(searchText, /\b(round brilliant|oval|round|emerald|pear|radiant|cushion|princess|marquise|heart|asscher|portuguese)\b/i, "page text/title/meta");
    const shapeSource = shapeSelected || shapeAttr || shapeText || { value: "" };
    const shape = normalizeShapeValue(shapeSource.value);

    const cutAttr = firstAttributeValue(sourceContext, [/^diamond cut$/i, /cut grade/i, /^cut$/i]);
    const cutSelected = selectedOptions?.["Diamond Cut"] ? { value: selectedOptions["Diamond Cut"], source: "selectedOptions.Diamond Cut" } : null;
    const cutText = firstPatternValue(searchText, /\b(3\s*ex|2\s*ex|triple\s+excellent|double\s+excellent|excellent|ideal|very\s+good|vg|good)\b/i, "page text/title/meta");
    const cutSource = cutAttr || cutSelected || cutText || { value: "" };
    const cutGrade = normalizeCutGradeValue(cutSource.value);

    const colorAttr = firstAttributeValue(sourceContext, [/white diamond color/i, /^color$/i, /fancy diamond color/i]);
    const colorSelected = selectedOptions?.Color ? { value: selectedOptions.Color, source: "selectedOptions.Color" } : null;
    const colorText = firstPatternValue(searchText, /\b(fancy(?:\s+(?:light|intense|vivid|deep|dark))?\s+(?:pink|blue|yellow|green|orange|purple|red|brown|gray|grey)|D(?:EF|E|F)?|E(?:F)?|F|G(?:H|HI|I)?|H(?:I)?|I|J|K)\b(?:\s*color)?\b/i, "page text/title/meta");
    const colorCandidates = [colorText, colorSelected, colorAttr].filter(Boolean);
    const colorSource = colorCandidates.find((candidate) => normalizeColorValue(candidate.value)) || { value: "" };
    const color = normalizeColorValue(colorSource.value);

    const clarityAttr = firstAttributeValue(sourceContext, [/clarity/i]);
    const claritySelected = selectedOptions?.["Diamond Clarity"] ? { value: selectedOptions["Diamond Clarity"], source: "selectedOptions.Diamond Clarity" } : null;
    const clarityText = firstPatternValue(searchText, /\b(FL|IF|VVS1|VVS2|VVS|VS1|VS2|VS|SI1|SI2|SI|I1|I2|I3)\b/i, "page text/title/meta");
    const claritySource = clarityAttr || claritySelected || clarityText || { value: "" };
    const clarity = normalizeClarityValue(claritySource.value);

    const caratSelected = selectedOptions?.["Diamond Carat Weight"] || selectedOptions?.Carat;
    const caratSource = caratSelected
      ? { value: caratSelected, source: "selectedOptions.Diamond Carat Weight" }
      : firstPatternValue(searchText, /\b(\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?)\s*(?:ct|carat)\b/i, "page text/title/meta") || { value: "" };
    const carat = normalizeCaratValue(caratSource.value);

    const certificateType = firstAttributeValue(sourceContext, [/certificate type/i, /diamond certificates/i]);
    const certificateNumber = firstAttributeValue(sourceContext, [/certificate\s*(no|number)/i]);

    return {
      shape: { value: shape, raw: shapeSource.value || "", source: shapeSource.source || shapeSource.name || "", confidence: confidence(shape, shapeSource.source) },
      cutGrade: { value: cutGrade, raw: cutSource.value || "", source: cutSource.source || cutSource.name || "", confidence: confidence(cutGrade, cutSource.source) },
      color: { value: color, raw: colorSource.value || "", source: colorSource.source || colorSource.name || "", confidence: confidence(color, colorSource.source) },
      clarity: { value: clarity, raw: claritySource.value || "", source: claritySource.source || claritySource.name || "", confidence: confidence(clarity, claritySource.source) },
      carat: { value: carat, raw: caratSource.value || "", source: caratSource.source || "", confidence: confidence(carat, caratSource.source) },
      certificate: {
        type: certificateType?.value || "",
        number: certificateNumber?.value || ""
      },
      labGrown: /lab(?:oratory)?[-\s]*grown|lab diamond|synthetic/i.test(searchText.join(" "))
    };
  }

  function parseManualOverrides(input) {
    const overrides = {};
    normalizeText(input).split(/[;,]\s*/).forEach((part) => {
      const match = part.match(/^\s*([a-zA-Z ]+)\s*[:=]\s*(.+?)\s*$/);
      if (!match) return;
      const key = match[1].toLowerCase().replace(/\s+/g, "");
      const value = normalizeText(match[2]);
      const normalizedKey = {
        shape: "shape",
        cut: "cutGrade",
        cutgrade: "cutGrade",
        color: "color",
        clarity: "clarity",
        carat: "carat",
        ct: "carat"
      }[key];
      if (normalizedKey && value) overrides[normalizedKey] = value;
    });
    return overrides;
  }

  function applyManualOverrides(capture, overrides) {
    const entries = Object.entries(overrides || {});
    if (!entries.length) return capture;
    capture.manualOverrides = Object.fromEntries(entries);
    entries.forEach(([field, value]) => {
      const normalizedValue = field === "shape" ? normalizeShapeValue(value) || value
        : field === "cutGrade" ? normalizeCutGradeValue(value) || value
        : field === "color" ? normalizeColorValue(value) || value
        : field === "clarity" ? normalizeClarityValue(value) || value
        : field === "carat" ? normalizeCaratValue(value) || value
        : value;
      capture.normalized[field] = {
        value: normalizedValue,
        raw: value,
        source: "manualOverride",
        confidence: "manual"
      };
    });
    capture.shape = capture.normalized.shape?.value || capture.shape;
    capture.attributes.color = capture.normalized.color?.value || capture.attributes.color;
    capture.attributes.clarity = capture.normalized.clarity?.value || capture.attributes.clarity;
    capture.attributes.caratSelected = capture.normalized.carat?.value || capture.attributes.caratSelected;
    capture.attributes.cutGrade = capture.normalized.cutGrade?.value || capture.attributes.cutGrade;
    return capture;
  }

  function promptForMissingValues(capture) {
    const missing = ["shape", "cutGrade", "color", "clarity", "carat"]
      .filter((field) => !capture.normalized?.[field]?.value);
    if (!missing.length) return {};

    const response = window.prompt(
      `Missing gem fields: ${missing.join(", ")}.\nEnter any known values as key=value pairs, for example:\nshape=round, cut=excellent, color=D, clarity=VS1, carat=1.5ct\nLeave blank to save anyway.`
    );
    return response ? parseManualOverrides(response) : {};
  }

  function getSkuRoot() {
    const openDialog = [...document.querySelectorAll('[role="dialog"][data-state="open"]')]
      .find((dialog) => dialog.querySelector('[data-testid="sku-panel-sku"], [data-module-name="module_skuPanel"]'));
    if (openDialog) return { root: openDialog, mode: "skuPanel" };

    const panelSku = document.querySelector('[data-testid="sku-panel-sku"], [data-module-name="module_skuPanel"]');
    if (panelSku) return { root: panelSku.closest('[role="dialog"]') || panelSku, mode: "skuPanel" };

    const rightRail = document.querySelector('[data-testid="three-col-right-floating-scroll-body"]');
    if (rightRail) return { root: rightRail, mode: "rightRail" };

    const moduleSku = document.querySelector('[data-testid="module-sku"], [data-module-name="module_sku"]');
    if (moduleSku) return { root: moduleSku.parentElement || moduleSku, mode: "rightRail" };

    return { root: document, mode: "page" };
  }

  function parsePriceRange(root) {
    const priceEl = root.querySelector('[data-testid="product-price"] [data-testid="range-price"]')
      || root.querySelector('[data-testid="range-price"]')
      || root.querySelector('[data-testid="product-price"]');
    const text = normalizeText(priceEl?.innerText);
    const prices = [...text.matchAll(/\$\s*[\d,]+(?:\.\d{1,2})?/g)].map((match) => match[0]);
    const minOrder = normalizeText((text.match(/Minimum order quantity:\s*[^$]+/i) || [])[0]);

    return {
      text,
      min: prices[0] ? moneyToNumber(prices[0]) : null,
      max: prices[1] ? moneyToNumber(prices[1]) : prices[0] ? moneyToNumber(prices[0]) : null,
      currency: prices.length ? "USD" : "",
      minOrder
    };
  }

  function labelFromSkuOption(option) {
    const imageAlt = normalizeText(option.querySelector("img[alt]")?.getAttribute("alt"));
    const text = normalizeText(option.innerText);
    return text || imageAlt;
  }

  function isSelectedOption(el) {
    if (!el) return false;
    const classNames = String(el.className || "").split(/\s+/);
    return el.getAttribute("aria-selected") === "true"
      || classNames.includes("selected")
      || classNames.includes("Selected");
  }

  function selectedValueInGroup(group) {
    const titleText = normalizeText(group.querySelector("h4")?.innerText);
    const titleMatch = titleText.match(/^[^:]+:\s*(.+)$/);
    if (titleMatch) return normalizeText(titleMatch[1]);

    const selected = [...group.querySelectorAll('[data-testid="double-bordered-box"], [aria-selected]')]
      .find(isSelectedOption);
    return normalizeText(selected ? labelFromSkuOption(selected) : "");
  }

  function parseSkuGroups(root) {
    const options = {};
    const optionLists = {};

    root.querySelectorAll('[data-testid="sku-panel-sku-group"]').forEach((group) => {
      const name = normalizeText(group.getAttribute("data-sku-group-name"))
        || normalizeText(group.querySelector("h4")?.innerText).replace(/:.+$/, "");
      if (!name) return;

      const selected = selectedValueInGroup(group);
      if (selected) options[name] = selected;

      const values = [...group.querySelectorAll('[data-testid="double-bordered-box"]')]
        .map(labelFromSkuOption)
        .filter(Boolean);
      if (values.length) optionLists[name] = [...new Set(values)];
    });

    root.querySelectorAll('[data-testid="sku-list"]').forEach((group) => {
      const name = normalizeText(group.querySelector('[data-testid="sku-list-title"], h4')?.innerText);
      if (!name || options[name]) return;

      const selected = selectedValueInGroup(group);
      if (selected) options[name] = selected;

      const values = [...group.querySelectorAll('[data-testid="double-bordered-box"]')]
        .map(labelFromSkuOption)
        .filter(Boolean);
      if (values.length && !optionLists[name]) optionLists[name] = [...new Set(values)];
    });

    return { selected: options, available: optionLists };
  }

  function parsePriceRows(root) {
    return [...root.querySelectorAll('[data-testid="last-sku-item"]')].map((row) => {
      const carat = normalizeText(
        row.querySelector('[data-testid="last-sku-first-item"] span')?.innerText
        || row.querySelector('[data-testid="last-sku-first-item"]')?.innerText
      );
      const priceText = normalizeText(row.querySelector('[data-testid="price"]')?.innerText);
      const inventory = normalizeText(row.querySelector('[data-testid="module-sku-inventory-info"]')?.innerText);
      const maxQty = row.querySelector('input[aria-valuemax]')?.getAttribute("aria-valuemax") || "";
      const selected = [...row.querySelectorAll('[data-testid="double-bordered-box"], [aria-selected]')]
        .some(isSelectedOption);

      return {
        carat,
        price: priceText,
        priceValue: moneyToNumber(priceText),
        inventory,
        maxQty: maxQty ? Number(maxQty) : null,
        selected
      };
    }).filter((row) => row.carat || row.price);
  }

  function parseShipping(root) {
    const method = normalizeText(root.querySelector('[data-testid="logistics-shipping-method"] span')?.innerText);
    const fee = normalizeText(root.querySelector('[data-testid="logistics-total-price"]')?.innerText);
    const delivery = normalizeText(root.querySelector('[data-testid="logistics-delivery-date"]')?.innerText);

    return { method, fee, delivery };
  }

  function slugKey(value) {
    return normalizeText(value).toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-|-$/g, "") || "unknown";
  }

  function stableSelectedOptions(selectedOptions) {
    return Object.fromEntries(
      Object.entries(selectedOptions || {})
        .map(([name, value]) => [normalizeText(name), normalizeText(value)])
        .filter(([name, value]) => name && value)
        .sort(([a], [b]) => a.localeCompare(b))
    );
  }

  function buildCaptureKey({ productId, title, selectedOptions }) {
    const stableOptions = stableSelectedOptions(selectedOptions);
    const productPart = slugKey(productId || title || location.pathname);
    const optionPart = Object.entries(stableOptions)
      .map(([name, value]) => `${slugKey(name)}=${slugKey(value)}`)
      .join("|");
    return `${productPart}::${optionPart || "no-options"}`;
  }

  function captureIdentity(capture) {
    return capture.captureKey || buildCaptureKey(capture);
  }

  async function addCapture(capture, { dedupe = true } = {}) {
    const key = captureIdentity(capture);
    if (dedupe && key === lastSignature) return { capture, saved: false, total: (await getStorage()).length };

    const captures = await getStorage();
    const duplicate = captures.some((existing) => captureIdentity(existing) === key);
    if (dedupe && duplicate) {
      lastSignature = key;
      return { capture, saved: false, total: captures.length };
    }

    captures.push(capture);
    lastSignature = key;
    await setStorage(captures);
    updateCount(captures.length);
    return { capture, saved: true, total: captures.length };
  }

  function captureCurrentState(source = "manual", { promptForMissing = false } = {}) {
    const { root, mode } = getSkuRoot();
    const title = getTitle();
    const skuGroups = parseSkuGroups(root);
    const selectedOptions = skuGroups.selected;
    const productId = getProductId();
    const captureKey = buildCaptureKey({ productId, title, selectedOptions });
    const priceRows = parsePriceRows(root);
    const sourceContext = collectSourceContext(root, selectedOptions);
    const normalized = deriveNormalizedFields({ title, selectedOptions, priceRows, sourceContext });

    const capture = {
      schemaVersion: 3,
      captureKey,
      capturedAt: new Date().toISOString(),
      source,
      mode,
      url: location.href,
      productId,
      title,
      shape: normalized.shape.value || getShapeFromTitle(title),
      supplier: getSupplier(),
      attributes: {
        color: normalized.color.value || selectedOptions.Color || "",
        clarity: normalized.clarity.value || selectedOptions["Diamond Clarity"] || selectedOptions.Clarity || "",
        caratSelected: normalized.carat.value || selectedOptions["Diamond Carat Weight"] || selectedOptions.Carat || "",
        cutGrade: normalized.cutGrade.value || ""
      },
      normalized,
      selectedOptions,
      availableOptions: skuGroups.available,
      priceRange: parsePriceRange(root),
      priceRows,
      shipping: parseShipping(root),
      sourceContext,
      flags: {
        igiMentioned: /IGI/i.test(document.body.innerText),
        labDiamondMentioned: /lab(?:oratory)?[-\s]*grown|lab diamond/i.test(document.body.innerText)
      }
    };

    if (promptForMissing) applyManualOverrides(capture, promptForMissingValues(capture));
    return capture;
  }

  async function captureManual() {
    const result = await addCapture(captureCurrentState("manual", { promptForMissing: true }), { dedupe: true });
    showToast(result.saved ? `Captured SKU snapshot. Saved ${result.total}.` : "Already saved this SKU combo.");
    setStatus(result.saved ? `Captured ${result.capture.priceRows.length} price rows` : "Already saved this combo");
    return result.capture;
  }

  async function captureAuto(reason = "sku-change") {
    if (!autoCaptureEnabled) return null;
    const capture = captureCurrentState(reason);
    if (!capture.priceRows.length && Object.keys(capture.selectedOptions).length === 0) {
      setStatus("Waiting for SKU panel");
      return null;
    }

    const result = await addCapture(capture, { dedupe: true });
    if (result.saved) {
      showToast(`Auto-saved ${capture.selectedOptions["Diamond Clarity"] || "SKU"} prices.`);
      setStatus(`Auto-saved ${capture.priceRows.length} rows`);
    } else {
      setStatus("Already saved");
    }
    return result.capture;
  }

  function scheduleAutoCapture(reason = "sku-change", delayMs = MUTATION_CAPTURE_DELAY_MS) {
    if (!autoCaptureEnabled) return;
    clearTimeout(autoCaptureTimer);
    autoCaptureTimer = setTimeout(() => {
      captureAuto(reason).catch((error) => {
        console.error("[Gem Appraise Capture]", error);
        setStatus(error.message || "Auto capture failed");
      });
    }, delayMs);
  }

  function isSkuClickTarget(target) {
    const el = target instanceof Element ? target : null;
    if (!el || el.closest(`#${PANEL_ID}`)) return false;
    return Boolean(el.closest('[data-testid="double-bordered-box"], [data-testid="sku-action"], [data-testid="last-sku-item"]'));
  }

  function watchSkuChanges() {
    document.addEventListener("click", (event) => {
      if (isSkuClickTarget(event.target)) scheduleAutoCapture("user-sku-click", CLICK_FALLBACK_DELAY_MS);
    }, true);

    const observer = new MutationObserver((mutations) => {
      if (!autoCaptureEnabled) return;
      const hasSkuChange = mutations.some((mutation) => {
        const node = mutation.target instanceof Element ? mutation.target : null;
        return node?.closest?.('[role="dialog"], [data-testid="module-sku"], [data-testid="sku-panel-sku"]');
      });
      if (hasSkuChange && getSkuRoot().mode === "skuPanel") {
        scheduleAutoCapture("sku-panel-change", MUTATION_CAPTURE_DELAY_MS);
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "data-state", "aria-selected"]
    });
  }

  async function copyJson() {
    const captures = await getStorage();
    await navigator.clipboard.writeText(JSON.stringify(captures, null, 2));
    showToast(`Copied ${captures.length} SKU snapshots as JSON.`);
  }

  async function downloadJson() {
    const captures = await getStorage();
    const slug = normalizeText(getTitle())
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 56) || "alibaba-listing";
    const blob = new Blob([JSON.stringify(captures, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}-sku-prices.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`Downloaded ${captures.length} SKU snapshots.`);
  }

  async function clearCaptures() {
    await setStorage([]);
    lastSignature = "";
    updateCount(0);
    setStatus("Cleared");
    showToast("Cleared saved snapshots.");
  }

  async function toggleAutoCapture() {
    autoCaptureEnabled = !autoCaptureEnabled;
    const button = document.querySelector(`#${PANEL_ID} [data-action="watch"]`);
    if (button) button.textContent = autoCaptureEnabled ? "Watching" : "Paused";
    setStatus(autoCaptureEnabled ? "Watching SKU clicks" : "Auto capture paused");
    return { enabled: autoCaptureEnabled };
  }

  async function renderPanel() {
    if (document.getElementById(PANEL_ID)) return;
    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="ga-title">
        <span>Gem Capture</span>
        <button type="button" data-action="toggle" title="Minimize">-</button>
      </div>
      <div class="ga-count">0 saved</div>
      <div class="ga-grid">
        <button type="button" class="ga-primary" data-action="capture">Capture</button>
        <button type="button" class="ga-primary" data-action="watch">Watching</button>
        <button type="button" data-action="copy">Copy JSON</button>
        <button type="button" data-action="download">Download</button>
        <button type="button" class="ga-wide" data-action="clear">Clear saved</button>
      </div>
      <div class="ga-status">Watching SKU clicks</div>
    `;
    document.body.append(panel);
    updateCount((await getStorage()).length);

    panel.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      const action = button.dataset.action;
      try {
        if (action === "toggle") {
          panel.classList.toggle("ga-minimized");
          button.textContent = panel.classList.contains("ga-minimized") ? "+" : "-";
        } else if (action === "capture") {
          await captureManual();
        } else if (action === "watch") {
          await toggleAutoCapture();
        } else if (action === "copy") {
          await copyJson();
        } else if (action === "download") {
          await downloadJson();
        } else if (action === "clear") {
          await clearCaptures();
        }
      } catch (error) {
        console.error("[Gem Appraise Capture]", error);
        setStatus(error.message || "Something went wrong");
        showToast("Capture extension hit an error. See console for details.");
      }
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const run = async () => {
      if (message?.type === "capture") return captureManual();
      if (message?.type === "watch") return toggleAutoCapture();
      if (message?.type === "copy") return copyJson();
      if (message?.type === "download") return downloadJson();
      if (message?.type === "clear") return clearCaptures();
      if (message?.type === "count") return { count: (await getStorage()).length, autoCaptureEnabled };
      return null;
    };
    run()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });

  renderPanel();
  watchSkuChanges();
})();
