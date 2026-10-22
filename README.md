# Label Studio

> Label Studio: offline VS Code extension to read, preview, create, merge and deploy ZPL II and EPL2 thermal labels.

[![CI](https://github.com/bamr87/zpl-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/bamr87/zpl-viewer/actions/workflows/ci.yml) [![License](https://img.shields.io/github/license/bamr87/zpl-viewer)](LICENSE)

## Overview

A VS Code extension for everything that happens to a thermal label before it comes off the printer: **read** it, **create** it, **modify** it, **analyze** it, **import** artwork and captures into it, **merge** data through it, and **deploy** it to a printer.

**Fully offline for everything except deployment.** Labels are parsed, rendered, validated and exported locally — no HTTP calls, no external services, no Docker, no binaries to install. The one thing that leaves your machine is a label you explicitly deploy, sent to the printer you configured.

## Features

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

## Quick start

Build it from a clone and launch it in an Extension Development Host — the same commands as [AGENTS.md](AGENTS.md#stack--commands):

```bash
npm ci                       # install dependencies (Node 20)
npm run watch                # webpack watch for both bundles; then F5 to launch the Extension Development Host
npm run compile              # webpack build → dist/extension.js + dist/webview/
npm run lint                 # eslint src --ext ts
npm run test:unit            # unit + renderer draw-call tests (compile-tests + c8/mocha)
npm run test:integration     # VS Code extension-host suite (@vscode/test-electron)
npm run test:e2e             # Playwright webview tests (first: npx playwright install chromium)
npm test                     # full pipeline: unit + integration + e2e
npm run docs:reference       # regenerate docs/reference/*.md from package.json contributes
```

Then, in the Extension Development Host:

1. Open a folder with label files (`samples/` in this repo is a good start).
2. Open any `.zpl` or `.epl` file.
3. Press `Cmd+K V` / `Ctrl+K V`, or run **Label: Open Label Preview to the Side**.
4. Edit the file — the preview auto-refreshes.

The **Label Studio** view in the activity bar lists the labels, data sources, printers and templates in your workspace.

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

## Commands, settings and keybindings

All commands live under the `Label:` prefix in the Command Palette and in the surfaces above. The ones you will reach for first:

- **Label: Open Label Preview to the Side** (`Ctrl/Cmd+K V`) and **Label: Label Actions…** (`Ctrl/Cmd+K L`) — render the label, or pick any action that applies right now.
- **Label: Export Labels as PDF** / **as PNG** / **as SVG (vector)** — save the rendered labels.
- **Label: Analyze Label**, **Label: Open Barcode Studio**, **Label: Merge Data Into Labels** and **Label: Deploy Label to Printer** (with a **dry run** variant).

The most-used settings are `labelStudio.renderer.density` (6/8/12/24 dpmm, default `8dpmm`), `labelStudio.label.widthInches` / `heightInches` (default 4 × 6 in), the `labelStudio.validation.*` switches, and `labelStudio.printers` (see [Deployment](#deployment)).

The full lists are generated from `package.json`: [commands](docs/reference/commands.md), [settings](docs/reference/settings.md) and [keybindings](docs/reference/keybindings.md). Settings were renamed from `zplViewer.*` to `labelStudio.*`, and the old `zplViewer.*` command ids still work as aliases; an explicitly-set legacy key is still honoured, so nothing breaks until you get round to renaming it.

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

## Fidelity notes

- **Fonts**: ZPL fonts (A-H) and EPL fonts (1-5) are proprietary printer bitmaps. The renderer approximates with the system sans-serif scaled to the requested cell size — close to a real printer, not pixel-identical. Scalable fonts (`^A0`, `^A@`) are drawn at their natural proportions, which is what a printer does with `^CF0,40`; bitmap fonts keep their declared cell aspect.
- **Conversion is lossy in places**: EPL2 has no circle, ellipse or diagonal primitive and only five bitmap font sizes, so converting from ZPL reports every approximation instead of silently dropping geometry.
- **Graphics** decode from every encoding ZPL uses: plain ASCII hex, Zebra's compressed hex (`G`-`Y`/`g`-`z` run counts with `,`, `!` and `:` row operators), `:B64:` and `:Z64:`, and raw binary. A graphic whose CRC or declared length disagrees with its payload still renders as far as it decodes, with a warning — a partial logo beats a blank label when you are reading a capture.
- **Stored graphics** downloaded with `~DG`/`~DY` persist across labels in a file, as they do in printer memory, and are drawn by `^XG` (with magnification) or `^IM`. A `^XG` naming a graphic the file never downloaded is reported rather than silently skipped.
- **Image import** reads PNG (any bit depth, greyscale/RGB/palette/alpha, progressive or Adam7-interlaced) and BMP (1/4/8/16/24/32-bit, RLE-compressed or not, either scan direction).
- **SVG export** is vector throughout: barcodes come from the same encoder the preview uses, and bitmaps become runs of rectangles rather than an embedded raster.
- Unknown commands surface as diagnostics rather than aborting the render.

## Documentation

The [documentation index](docs/README.md) lists every document in the repository. Start with [docs/testing.md](docs/testing.md) for how the extension is tested, [src/README.md](src/README.md) for the module guide, and the generated [commands](docs/reference/commands.md), [settings](docs/reference/settings.md) and [keybindings](docs/reference/keybindings.md) reference.

## Project structure

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
├── docs/                                # Docs index, ADRs, testing guide, generated reference
├── scripts/                             # gen-reference-docs.mjs, smoke-test.mjs
├── tools/                               # Vendored fleet tools (prose gate, docs index)
├── features/, verify/                   # Feature index + user-scenario verification kit
├── .github/workflows/ci.yml             # 3-OS CI matrix
└── samples/                             # Example labels and a sample data source
```

## Development

The build, lint and test commands are the [Quick start](#quick-start) block; [AGENTS.md](AGENTS.md) is the canonical guide to working here (layering rules, conventions, what is generated). [docs/testing.md](docs/testing.md) explains the four test layers — unit, renderer draw-call geometry, extension-host integration and Playwright e2e — and why there are no golden images. Every document is listed in the [documentation index](docs/README.md).

## Contributing

Contributions are welcome via pull request. Use [Conventional Commits](https://www.conventionalcommits.org/) and keep the CI checks green. The fleet-wide workflow is described in the hub's [CONTRIBUTING.md](https://github.com/bamr87/bamr87/blob/main/CONTRIBUTING.md). AI agents should start with [AGENTS.md](AGENTS.md).

## Changelog

Notable changes are recorded in [CHANGELOG.md](CHANGELOG.md), written by release-please from the merged pull request titles.

## License

Released under the [MIT License](LICENSE).

---

<!-- bamr87-portfolio-footer -->
Part of the [bamr87 portfolio](https://github.com/bamr87) — browse every project on [Amr's GitHub profile](https://github.com/bamr87).
