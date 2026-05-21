# Gem shape icons (export)

Self-contained diamond **shape icon** renderer from [Gem Appraise](../index.html). Share this folder as-is.

## Contents

| File | Purpose |
|------|---------|
| `shape-icons.js` | All drawing code + `shapeIconSvg()` API |
| `gallery.html` | Open in a browser to preview every shape |
| `svgs/*.svg` | Pre-rendered 64×64 files (one per shape) |
| `manifest.json` | Shape keys, labels, colors, file paths |
| `generate-svgs.mjs` | Regenerate `svgs/` after editing the JS |

## Preview

```bash
open gallery.html
# or: python3 -m http.server 8765  →  http://localhost:8765/gallery.html
```

## Usage

**Browser** — include the script:

```html
<script src="shape-icons.js"></script>
<div id="icon"></div>
<script>
  document.getElementById('icon').innerHTML =
    GemShapeIcons.shapeIconSvg('oval', 32);
</script>
```

**Node** — require and write files:

```js
const icons = require('./shape-icons.js');
const fs = require('fs');

fs.writeFileSync('portuguese.svg', icons.shapeIconSvgFile('portuguese', 64));
console.log(icons.ALL_SHAPE_KEYS);
```

## API

- `shapeIconSvg(shapeKey, size?, certRatio?)` → HTML `<svg>...</svg>` string
- `shapeIconSvgFile(shapeKey, size?, certRatio?)` → XML file body for `.svg`
- `buildShapeIconInner(shapeKey, certRatio?)` → inner markup only (no wrapper)
- `resolveShapeIconKey(shapeKey, certRatio?)` → normalized key for drawing
- `mapReportShapeToState(shape, reportHint?)` → IGI text → shape key
- `ALL_SHAPE_KEYS` — array of 27 shape keys
- `shapeNames`, `SHAPE_ICON_COLORS`

Optional `certRatio` (length/width) stretches elongated cuts when `ratioGuides` defines that shape.

## Regenerate SVGs

```bash
node generate-svgs.mjs
```

## Shapes (27)

`round`, `oval`, `pear`, `marquise`, `moval`, `heart`, `cushion`, `cushion_brilliant`, `square_cushion`, `princess`, `emerald`, `radiant`, `asscher`, `sq_radiant`, `carre`, `baguette`, `tapered_baguette`, `trilliant`, `half_moon`, `shield`, `hexagonal`, `hexagonal_dutch`, `old_european`, `old_mine`, `rose`, `briolette`, `portuguese`, `flanders`

`portuguese` uses the round-brilliant outline with an extra inner facet ring (round modified / Portuguese cut).

## License

Same as parent Gem Appraise project.
