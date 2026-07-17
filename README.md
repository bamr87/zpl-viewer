# ZPL Viewer

A comprehensive VS Code extension for working with [Zebra Programming Language](https://www.zebra.com/content/dam/zebra/manuals/printers/common/programming/zpl-zbi2-pm-en.pdf) (ZPL/ZPL II) label files.

**Fully offline.** Labels are parsed, rendered, and exported locally — no HTTP calls, no external services, no Docker, no binaries to install. Rendering is handled inside a sandboxed VS Code webview using only pure JavaScript libraries.

## Features

- Syntax highlighting for `.zpl`, `.zpl2`, `.prn`, and `.lbl` files.
- Hover documentation + IntelliSense for 50+ ZPL II commands.
- Document outline, code folding, and rich snippets.
- Built-in formatter and diagnostics/validator.
- **Live local label preview** on a `<canvas>` with page navigation and zoom.
- **Export to PNG or PDF** — produced entirely in-process.
- No network access required.

### Supported ZPL commands (for rendering)

| Category | Commands |
|---|---|
| Label boundaries | `^XA`, `^XZ` |
| Fields | `^FO`, `^FT`, `^FD`, `^FS`, `^FB`, `^FR`, `^FH`, `^FW`, `^FX` |
| Fonts | `^A`, `^A0` … `^AH` (scalable/bitmapped), `^CF` |
| Graphics | `^GB` (box/line), `^GC` (circle), `^GD` (diagonal), `^GE` (ellipse), `^GF` (ASCII-hex bitmap) |
| Barcodes | `^BY`, `^BC` (Code 128), `^BQ` (QR), `^BX` (Data Matrix), `^B3` (Code 39), `^BE` (EAN-13), `^B8` (EAN-8), `^BU` (UPC-A), `^B7` (PDF417), `^B9` (Codabar) |
| Label config | `^LH`, `^LL`, `^PW` |

Unsupported or unknown commands surface as diagnostics but do not halt rendering.

### Rendering pipeline

```
 ZPL source
    │
    ▼
 parser.ts           # tokenize + interpret → IR (drawing ops)
    │
    ▼
 draw.ts             # ops → Canvas 2D (isomorphic)
    │
    ├──> HTMLCanvas in webview ─────► preview
    └──> offscreen canvas + pdf-lib ─► PNG / PDF bytes
```

Libraries in use (all pure JavaScript, MIT-licensed, bundled locally):

- [`bwip-js`](https://github.com/metafloor/bwip-js) — renders every barcode ZPL supports.
- [`pdf-lib`](https://pdf-lib.js.org/) — PDF construction for export.

## Getting started

1. Open a folder containing one or more `.zpl` files (the `samples/` folder in this repo is a good starting point).
2. Open any `.zpl` file.
3. Press `Cmd+K V` (macOS) / `Ctrl+K V` (Windows/Linux) or run **ZPL: Open Label Preview to the Side**.
4. Edit the file — the preview auto-refreshes.

## Commands

All commands are available from the Command Palette under the `ZPL:` prefix.

| Command | Description |
|---|---|
| `ZPL: Open Label Preview` | Open the rendered label preview. |
| `ZPL: Open Label Preview to the Side` | Open preview next to the editor. |
| `ZPL: Refresh Preview` | Re-render the current preview. |
| `ZPL: Export Label as PNG` | Save the rendered label as PNG. |
| `ZPL: Export Label as PDF` | Save all labels as a multi-page PDF. |
| `ZPL: Format Document` | Run the ZPL formatter. |
| `ZPL: Validate Document` | Re-run diagnostics. |
| `ZPL: Insert Label Template` | Insert a starter label snippet. |

## Settings

| Setting | Default | Description |
|---|---|---|
| `zplViewer.renderer.density` | `8dpmm` | Print density: `6dpmm`, `8dpmm`, `12dpmm`, `24dpmm`. |
| `zplViewer.label.widthInches` | `4` | Label width in inches. |
| `zplViewer.label.heightInches` | `6` | Label height in inches. |
| `zplViewer.preview.initialZoom` | `2` | Initial display scale (1 = 1 dot per pixel). |
| `zplViewer.preview.autoRefresh` | `true` | Re-render on document change. |
| `zplViewer.preview.autoRefreshDelay` | `400` | Debounce delay (ms). |
| `zplViewer.format.uppercaseCommands` | `true` | Uppercase commands when formatting. |
| `zplViewer.format.oneCommandPerLine` | `true` | Place each command on its own line when formatting. |
| `zplViewer.validation.enable` | `true` | Enable ZPL diagnostics. |

## Development

```bash
npm install
npm run watch      # in one terminal (webpack watch for both bundles)
# then press F5 in VS Code to launch the Extension Development Host
```

Useful scripts:

- `npm run compile` — webpack production build (produces `dist/extension.js` and `dist/webview/preview.js`).
- `npm run lint` — ESLint over `src/`.
- `npm run test:unit` — pure unit tests + renderer smoke tests.
- `npm run test:visual` — renderer visual regression against golden PNGs.
- `npm run test:visual:update` — regenerate visual golden PNGs.
- `npm run test:integration` — VS Code extension-host integration suite (`@vscode/test-electron`).
- `npm run test:e2e` — Playwright browser-level webview tests.
- `npm run test` — full test pipeline (`unit` + `visual` + `integration` + `e2e`).

## Testing framework

The test suite is layered so failures isolate quickly:

1. **Unit (`src/test/unit`)**  
   Fast, pure logic tests for tokenizer, parser, formatting, command metadata, and validation.
2. **Renderer (`src/test/renderer`)**  
   Headless canvas rendering tests and visual regression checks against committed golden PNGs.
3. **Integration (`src/test/integration`)**  
   Runs inside a real VS Code extension host and validates commands/providers/diagnostics/preview/export.
4. **E2E (`src/test/e2e`)**  
   Playwright tests that execute the compiled preview webview bundle in Chromium.

### Golden image workflow

- Golden files live in `src/test/renderer/visual/golden/<platform>/` (one set per `process.platform` — `linux`, `darwin`, … — because system-font text rendering differs between OSes). A missing golden for your platform is generated on first run.
- When rendering behavior changes intentionally:

```bash
npm run test:visual:update
```

- Re-run `npm run test:visual` and review updated PNG diffs in your Git diff before committing.

### Test-mode preview hook

The command `zplViewer._test.waitForPreviewReady` is registered only when:

```bash
VSCODE_ZPL_TEST=1
```

`npm run test:integration` sets this automatically via `cross-env`. The hook is test-only and not exposed in normal user sessions.

## Project layout

```
.
├── language-configuration.json        # Bracket / comment / folding config
├── syntaxes/zpl.tmLanguage.json       # TextMate grammar
├── snippets/zpl.code-snippets         # Code snippets
├── src/
│   ├── extension.ts                   # Activation + command wiring
│   ├── previewPanel.ts                # Webview host + export dispatch
│   ├── diagnostics.ts                 # Validation
│   ├── zplCommands.ts                 # Command reference dataset (hover/completion)
│   ├── zplParser.ts                   # Tokenizer
│   ├── providers/                     # Hover, completion, symbols, formatter, folding
│   ├── renderer/
│   │   ├── ir.ts                      # Drawing-op IR types
│   │   ├── parser.ts                  # ZPL → IR
│   │   └── draw.ts                    # IR → Canvas 2D (isomorphic)
│   └── webview/
│       ├── main.ts                    # Webview entry: renders + exports
│       ├── barcodeAdapter.ts          # bwip-js adapter
│       └── preview.html               # Webview shell
├── src/test/                          # Unit/renderer/integration/e2e tests + fixtures
├── .github/workflows/ci.yml           # Cross-platform CI matrix
└── samples/                           # Example ZPL labels
```

## Fidelity notes

- Fonts: ZPL font glyphs (A-H) are proprietary Zebra bitmaps. The renderer approximates using the system sans-serif, scaled to the requested width/height. Visual output is close to a real printer but not pixel-identical.
- `^GF` graphic fields support the ASCII-hex (A) and binary (B) formats. Run-length / LZ77 compression (C, Z64, B64) is not yet implemented.
- The parser tolerates unknown commands and surfaces them as diagnostics rather than aborting.

## License

MIT
