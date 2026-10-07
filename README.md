# Label Studio

A VS Code extension for everything that happens to a thermal label before it comes off the printer: **read** it, **create** it, **modify** it, **analyze** it, **import** artwork and captures into it, **merge** data through it, and **deploy** it to a printer.

**Fully offline for everything except deployment.** Labels are parsed, rendered, validated and exported locally — no HTTP calls, no external services, no Docker, no binaries to install. The one thing that leaves your machine is a label you explicitly deploy, sent to the printer you configured.

## What it does

| Verb | What you get |
|---|---|
| **Read** | Syntax highlighting, hover docs, IntelliSense, outline and folding for ZPL II and EPL2. |
| **View** | Live label preview on a `<canvas>`, page navigation, zoom, PNG/PDF/SVG export. |
| **Create** | Starter templates (shipping, product, asset tag, shelf, GS1 carton), snippets, a barcode studio. |
| **Modify** | Formatters for both languages, barcode field insertion, image import, format conversion. |
| **Graphics** | Every ZPL graphic encoding renders: ASCII hex, Zebra's compressed hex, `:B64:` and `:Z64:`, plus `~DG`/`~DY` downloads recalled with `^XG`/`^IM`. |
| **Analyze** | Label metrics, ink coverage, barcode inventory, and lint rules for data, bounds and scannability. |
| **Import** | PNG/BMP artwork → graphic fields, raw printer captures → clean editable labels, CSV/JSON → data sources. |
| **Integrate** | `{{placeholder}}` templates merged against CSV/TSV/JSON/JSONL with a filter pipeline and mapping checks. |
| **Deploy** | Send to a printer over raw TCP 9100, a device path, or a spool directory — converting the language if needed. |

## Supported printer languages

| Language | Extensions | Notes |
|---|---|---|
| **ZPL II** | `.zpl`, `.zpl2`, `.prn`, `.lbl` | Zebra and compatible printers (Honeywell ZSim, TSC ZPL emulation). |
| **EPL2** | `.epl`, `.epl2` | Eltron / Zebra LP-TLP series, TSC EPL emulation. |

`.prn` and `.lbl` files are sniffed: whichever language the content looks like wins.

Both languages parse into one shared intermediate representation, so preview, export, analysis, merge and deploy work identically for either — and a label written in one can be converted to the other.

## Barcodes

24 symbologies are supported end to end — rendered with [`bwip-js`](https://github.com/metafloor/bwip-js), validated against their own rules, and emitted as the right command for the target language:

| Family | Symbologies |
|---|---|
| Linear | Code 128, GS1-128, Code 39, Code 93, Code 11, Codabar, Interleaved 2 of 5, Industrial 2 of 5, ITF-14, MSI Plessey, Plessey, EAN-13, EAN-8, UPC-A, UPC-E, GS1 DataBar |
| Postal | POSTNET, PLANET |
| 2-D | QR Code, Data Matrix, PDF417, MicroPDF417, Aztec, MaxiCode |

Payloads are checked for character set, length, check digit (mod-10, mod-43, flat mod-10), GS1 AI syntax and capacity before you print a roll of unscannable labels. **Barcode Studio** (`Label: Open Barcode Studio`) builds one interactively and hands back the ZPL or EPL field.

## Getting started

1. Open a folder with label files (`samples/` in this repo is a good start).
2. Open any `.zpl` or `.epl` file.
3. Press `Cmd+K V` / `Ctrl+K V`, or run **Label: Open Label Preview to the Side**.
4. Edit the file — the preview auto-refreshes.

The **Label Studio** view in the activity bar lists the labels, data sources, printers and templates in your workspace.

## Data integration

Any label can be a template. Reference a data field with `{{field}}`, then run **Label: Merge Data Into Labels** against a CSV, TSV, JSON or JSONL file:

```zpl
^XA
^FO20,20^A0N,44,44^FD{{name}}^FS
^FO20,80^A0N,24,24^FDSKU: {{sku|upper}}^FS
^FO20,112^A0N,24,24^FDBin: {{aisle}}-{{bin|pad:3}}^FS
^FO20,150^BY2,3,80^BCN,80,Y,N,N^FD{{sku|upper}}^FS
^XZ
```

- **Filters**: `upper`, `lower`, `trim`, `title`, `digits`, `alnum`, `left:n`, `right:n`, `pad:n`, `padright:n`, `default:value`. Chain them with `|`.
- **Field matching is forgiving**: `{{Product Name}}`, `{{product name}}` and `{{productname}}` all find a `Product Name` column.
- **Nested JSON** flattens to dotted paths: `{{location.aisle}}`.
- **Escaping is automatic**: a value containing `^` or `~` is hex-escaped and the field gets a `^FH` prefix, so data can never be mistaken for commands.
- **Check before you print**: **Label: Check Data Mapping** reports which placeholders resolved, which did not, and which columns went unused.

The merge produces an ordinary label document, so it previews, analyzes, exports to PDF and deploys through the same commands as a hand-written one.

## Deployment

Configure printers once — in workspace settings, so the team shares them:

```jsonc
"labelStudio.printers": [
  {
    "name": "Warehouse ZT411",
    "transport": "tcp",          // raw TCP, the usual choice
    "host": "192.168.1.50",
    "port": 9100,
    "format": "zpl",
    "dpmm": 8
  },
  {
    "name": "Bench LP2844",
    "transport": "file",         // a device node or share
    "path": "/dev/usb/lp0",
    "format": "epl",
    "dpmm": 8
  },
  {
    "name": "Spool folder",
    "transport": "directory",    // drop a timestamped file for another system
    "path": "./spool",
    "format": "zpl",
    "dpmm": 12
  }
]
```

Then run **Label: Deploy Label to Printer**. If the document and the printer speak different languages, the label is converted on the way out and the approximations are reported. **Label: Deploy Label (dry run)** shows the exact bytes without opening a connection, and every send is logged to the *Label Studio: Deploy* output channel.

## Analysis

**Label: Analyze Label** opens a Markdown report with label geometry, an op inventory, estimated ink coverage, a barcode table with validation state, and every lint finding. The same rules run continuously as diagnostics:

| Rule | Catches |
|---|---|
| `barcode.charset` / `length` / `check-digit` | Payloads the symbology cannot encode. |
| `barcode.module-width` | Narrow bars below the X-dimension scanners need. |
| `barcode.bar-height` / `quiet-zone` | Symbols too short or too close to the edge to acquire. |
| `layout.out-of-bounds` / `clipped` | Fields that fall off the stock. |
| `epl.missing-clear` / `missing-print` | EPL formats that reprint the previous label, or never print. |

## Where to find things

Every action is reachable without the Command Palette.

| Surface | What it gives you |
|---|---|
| **Activity bar → Label Studio** | Five trees: **Actions** (every command, grouped), **Labels** (workspace label files by language), **Data sources**, **Printers**, **Templates**. |
| **Tree item menus** | Right-click a label, data source, printer or template for the actions that apply to it; the common ones are inline icons on the row. |
| **Editor title bar** | Preview and Analyze as buttons, with the rest under a **Label Studio** submenu. |
| **Editor right-click** | A **Label Studio** submenu with view, export, check, edit, data and deploy actions. |
| **Explorer right-click** | The same submenu on label files; preview/merge/mapping on `.csv`/`.json`; *Import Image as Label Graphic* on `.png`/`.bmp`. |
| **Status bar** | Shows the label's language, stock size and density; click it for the full action list. |
| **Preview toolbar** | Page navigation, zoom, refresh, PNG/PDF/SVG export, and `⋯` for everything else. |
| **File → New File…** | *New Label from Template*, so you can start one before any label file exists. |
| **Keyboard** | `Ctrl/Cmd+K V` opens the preview to the side, `Ctrl/Cmd+K L` opens the action list. |

Anything that acts on a label uses the label you invoked it on — the file you right-clicked in a tree, the editor you are in, or the preview you are looking at.

## Commands

All commands live under the `Label:` prefix in the Command Palette, and in the surfaces above.

| Command | Description |
|---|---|
| `Label: Open Label Preview` / `to the Side` | Render the label. |
| `Label: Refresh Preview` | Re-render. |
| `Label: Export Label as PNG` | Save the first label as PNG. |
| `Label: Export Labels as PDF` | Save every label as a multi-page PDF. |
| `Label: Export Label as SVG (vector)` | Save each label as vector SVG — no preview panel needed. |
| `Label: Format Label Document` | Run the language's formatter. |
| `Label: Validate Label` | Re-run diagnostics. |
| `Label: Analyze Label` | Metrics + findings report. |
| `Label: New Label from Template` | Start from a template, with samples or placeholders. |
| `Label: Insert Label Snippet` | Insert a minimal label at the cursor. |
| `Label: Convert Label to Another Printer Language` | ZPL ↔ EPL. |
| `Label: Open Barcode Studio` | Build and validate a barcode interactively. |
| `Label: Insert Barcode Field` | Pick a symbology, type data, insert the field. |
| `Label: Import Image as Label Graphic` | PNG or BMP → `^GF` / `GW`. |
| `Label: Import Printer Capture` | Clean a `.prn` capture into editable labels. |
| `Label: Preview Data Source` | Table preview of a CSV/JSON file. |
| `Label: Merge Data Into Labels` | Expand a template over every row. |
| `Label: Check Data Mapping` | Placeholder ↔ column report. |
| `Label: Deploy Label to Printer` | Send to a configured printer. |
| `Label: Deploy Label (dry run)` | Build the payload without sending. |
| `Label: Add Printer` | Guided printer configuration. |
| `Label: Edit Printer` | Open the printer profiles in settings JSON. |
| `Label: Remove Printer` | Delete a printer from whichever settings scope defines it. |
| `Label: Label Actions…` | Quick pick of every action that applies right now. |
| `Label: Set Print Density` | Switch the renderer between 6/8/12/24 dpmm. |
| `Label: Set Label Size` | Pick a stock size, or enter a custom one. |
| `Label: Open Label Studio Settings` | Every setting this extension contributes. |

The old `zplViewer.*` command ids still work as aliases, so existing keybindings and tasks keep running.

## Settings

| Setting | Default | Description |
|---|---|---|
| `labelStudio.defaultFormat` | `auto` | Language assumed for `.prn`/`.lbl` files. |
| `labelStudio.renderer.density` | `8dpmm` | Print density: `6dpmm`, `8dpmm`, `12dpmm`, `24dpmm`. |
| `labelStudio.label.widthInches` / `heightInches` | `4` / `6` | Stock size used when the label does not declare one. |
| `labelStudio.preview.autoRefresh` / `autoRefreshDelay` | `true` / `400` | Re-render on change, and how long to debounce. |
| `labelStudio.preview.initialZoom` | `2` | Initial display scale (1 = 1 dot per pixel). |
| `labelStudio.format.uppercaseCommands` | `true` | Uppercase ZPL commands when formatting (EPL case is never changed). |
| `labelStudio.format.oneCommandPerLine` | `true` | One ZPL command per line. |
| `labelStudio.validation.enable` | `true` | Master switch for diagnostics. |
| `labelStudio.validation.barcodeData` | `true` | Check barcode payloads. |
| `labelStudio.validation.bounds` | `true` | Report fields off the label. |
| `labelStudio.validation.scannability` | `true` | Report bar widths, heights and quiet zones. |
| `labelStudio.merge.maxRows` | `500` | Row cap for one merge. |
| `labelStudio.import.threshold` | `128` | Luminance cut-off for imported artwork. |
| `labelStudio.import.dither` | `none` | `none` for logos, `floyd-steinberg` for photos. |
| `labelStudio.import.maxWidthDots` | `600` | Downscale imported images to fit. |
| `labelStudio.import.invert` | `false` | Swap black and white — for light artwork on a dark field. |
| `labelStudio.import.trim` | `false` | Crop blank margins so the graphic starts where the ink does. |
| `labelStudio.import.rotate` | `0` | Rotate imported artwork clockwise: `0`, `90`, `180`, `270`. |
| `labelStudio.deploy.confirmBeforeSend` | `true` | Confirm before sending to a printer. |
| `labelStudio.deploy.timeoutMs` | `10000` | Network printer timeout. |
| `labelStudio.printers` | `[]` | Printer profiles (see [Deployment](#deployment)). |

Settings were renamed from `zplViewer.*` to `labelStudio.*`. An explicitly-set legacy key is still honoured, so nothing breaks until you get round to renaming it.

## Architecture

```
 label source (.zpl / .epl / .prn)      data (.csv / .json)     artwork (.png / .bmp)
        │                                     │                          │
        ▼                                     ▼                          ▼
 core/formats.ts  ──►  formats/<lang>/parser  data/dataset.ts      image/decode.ts
   (detect)                    │              data/template.ts     image/bitmap.ts
                               │                     │              importers/imageToLabel.ts
                               ▼                     │                     │
                    renderer/ir.ts  ◄────────────────┴─────────────────────┘
                    (shared drawing-op IR)
                               │
   ┌─────────────────┬─────────┴──────────┬──────────────────┬──────────────────┐
   ▼                 ▼                    ▼                  ▼                  ▼
renderer/draw.ts  emit/svg.ts    analysis/metrics.ts   emit/zpl.ts      deploy/deploy.ts
(canvas preview,  (vector SVG,   analysis/lint.ts      emit/epl.ts      (tcp / file /
 PNG, PDF)         host-side)    (findings + report)   (convert, create) directory)
```

Graphics take a short detour on the way into the IR: `renderer/graphics.ts` unwraps whichever encoding a `^GF`, `~DG` or `~DY` arrived in — plain hex, Zebra's compressed hex, `:B64:` or `:Z64:` — inflating the last of those with `core/inflate.ts`, a dependency-free DEFLATE that also backs the PNG decoder so both run in the webview.

`src/README.md` documents each module in detail.

## Development

```bash
npm ci                       # install dependencies (Node 20)
npm run watch                # webpack watch; then F5 for the Extension Development Host
npm run compile              # build dist/extension.js + dist/webview/
npm run lint                 # eslint src --ext ts
npm run test:unit            # pure unit tests + renderer draw-call geometry (mocha + c8)
npm run test:integration     # VS Code extension-host suite
npm run test:e2e             # Playwright webview tests
npm test                     # everything
```

### Testing layers

1. **Unit (`src/test/unit`)** — parsers, emitters, graphics and image decoders, barcode rules, data pipeline, analysis, importers, deploy transports (including a real loopback socket).
2. **Renderer (`src/test/renderer`)** — renders the sample labels and asserts the Canvas 2D calls they produce: positions, sizes, styles and the transform each was made under.
3. **Integration (`src/test/integration`)** — runs in a real VS Code host: commands, providers, diagnostics, merge and dry-run deploy.
4. **E2E (`src/test/e2e`)** — drives the compiled preview and barcode-studio webview bundles in Chromium.

Layers 1 and 2 both run under `npm run test:unit`.

### Why there are no golden images

The renderer is covered by recorded draw calls rather than by committed PNGs.

Pixel goldens were tried and removed. A rendered label is bound to the machine that produced it far more tightly than it looks: system fonts differ per OS, and the Skia build behind a headless canvas differs per platform *and* per CI runner image, which moves box and barcode edges as well as text. In practice that meant a golden could only be regenerated on the machine that made it, and each platform needed its own set that nobody could verify from anywhere else.

The failure mode that settled it: the goldens' own barcode encoder was calling a method that only exists in bwip-js's browser build. `drawPage` catches renderer errors and paints the message onto the label, so every committed golden had an error string where its barcode should have been — and the suite passed, for as long as the goldens existed, while asserting a broken render.

Draw-call assertions pin the same geometry with no environment dependence, and a barcode that fails to encode now fails a test instead of being frozen into an expected image.

### Test-mode preview hook

`zplViewer._test.waitForPreviewReady` / `labelStudio._test.waitForPreviewReady` are registered only when `VSCODE_ZPL_TEST=1`, which `npm run test:integration` sets via `cross-env`. The hook is test-only and never exposed in normal sessions.

## Project layout

```
.
├── language-configuration.json          # ZPL brackets / comments / folding
├── language-configuration-epl.json      # EPL equivalent
├── syntaxes/                            # TextMate grammars (zpl, epl)
├── snippets/                            # Code snippets (zpl, epl)
├── src/
│   ├── extension.ts                     # Activation + provider registration
│   ├── config.ts                        # Settings, with legacy-key fallback
│   ├── previewPanel.ts                  # Preview webview host + export dispatch
│   ├── diagnostics.ts                   # Diagnostic publishing
│   ├── core/                            # Format registry, pipeline, units, templates
│   ├── formats/epl/                     # EPL2 tokenizer, commands, parser, validator
│   ├── renderer/                        # Shared IR, ZPL parser, canvas renderer
│   ├── emit/                            # IR → ZPL / EPL
│   ├── barcode/                         # Symbology catalog + payload validation
│   ├── data/                            # CSV/JSON loading, templating, merge
│   ├── analysis/                        # Metrics, lint rules, markdown report
│   ├── image/                           # PNG/BMP decode, 1-bit conversion, transforms
│   ├── importers/                       # Bitmap → graphic field, printer captures
│   ├── deploy/                          # Printer profiles + transports
│   ├── ui/                              # Commands, tree views, barcode studio host
│   └── webview/                         # Preview + studio webview bundles
├── src/test/                            # Unit / renderer / integration / e2e + fixtures
├── .github/workflows/ci.yml             # 3-OS CI matrix
└── samples/                             # Example labels and a sample data source
```

## Fidelity notes

- **Fonts**: ZPL fonts (A-H) and EPL fonts (1-5) are proprietary printer bitmaps. The renderer approximates with the system sans-serif scaled to the requested cell size — close to a real printer, not pixel-identical. Scalable fonts (`^A0`, `^A@`) are drawn at their natural proportions, which is what a printer does with `^CF0,40`; bitmap fonts keep their declared cell aspect.
- **Conversion is lossy in places**: EPL2 has no circle, ellipse or diagonal primitive and only five bitmap font sizes, so converting from ZPL reports every approximation instead of silently dropping geometry.
- **Graphics** decode from every encoding ZPL uses: plain ASCII hex, Zebra's compressed hex (`G`-`Y`/`g`-`z` run counts with `,`, `!` and `:` row operators), `:B64:` and `:Z64:`, and raw binary. A graphic whose CRC or declared length disagrees with its payload still renders as far as it decodes, with a warning — a partial logo beats a blank label when you are reading a capture.
- **Stored graphics** downloaded with `~DG`/`~DY` persist across labels in a file, as they do in printer memory, and are drawn by `^XG` (with magnification) or `^IM`. A `^XG` naming a graphic the file never downloaded is reported rather than silently skipped.
- **Image import** reads PNG (any bit depth, greyscale/RGB/palette/alpha, progressive or Adam7-interlaced) and BMP (1/4/8/16/24/32-bit, RLE-compressed or not, either scan direction).
- **SVG export** is vector throughout: barcodes come from the same encoder the preview uses, and bitmaps become runs of rectangles rather than an embedded raster.
- Unknown commands surface as diagnostics rather than aborting the render.

## License

MIT
