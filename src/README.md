# `src/` — module guide

The extension is layered so that almost everything interesting is a pure function. Only the files that import `vscode` know they are running inside an editor; everything under `core/`, `image/`, `barcode/`, `data/`, `emit/`, `analysis/`, `formats/` and `renderer/` is isomorphic and runs unchanged in the webview bundle and in unit tests.

```
vscode layer      extension.ts · config.ts · diagnostics.ts · previewPanel.ts · providers/ · ui/
                          │
pure layer        core/ · formats/ · renderer/ · image/ · barcode/ · data/ · emit/ · analysis/
                          │
node-only layer   importers/ · deploy/ (net, fs)
```

## Pure modules

### `core/`
The keystone. `formats.ts` registers each printer language and detects which one a document is written in; `pipeline.ts` dispatches parse / format / emit / convert on that id; `validate.ts` combines a language's syntax checks with the shared lint rules; `units.ts` converts dots ↔ inches ↔ millimetres; `templates.ts` holds the starter labels; `diagnostics.ts` defines the format-neutral finding shape.

`inflate.ts` and `base64.ts` are the codecs the rest of the pure layer needs but cannot get from Node: a dependency-free DEFLATE (RFC 1951/1950) and base64. Both exist because `zlib` and `Buffer` are unavailable in the webview, and both the `:Z64:` graphic encoding and the PNG decoder need them there.

Nothing here may import `vscode` — the webview bundle compiles these files.

### `renderer/`
`ir.ts` is the intermediate representation every format parses into: a list of drawing ops in printer dots, each optionally carrying the source range that produced it. `parser.ts` interprets ZPL II into that IR; `draw.ts` paints IR onto any Canvas 2D context (the webview canvas, an offscreen canvas for PNG/PDF export, or the recording stub the tests use).

`graphics.ts` decodes the four ways ZPL spells a bitmap — plain ASCII hex, the ACS compressed hex with letter run counts and `,` `!` `:` row operators, `:B64:` and `:Z64:` — and models the graphic store that `~DG`/`~DY` fill and `^XG`/`^IM` draw from. It also encodes: the ACS compressor is what keeps an imported logo's `^GF` field small.

`text.ts` holds the glyph metrics every renderer shares. ZPL sizes a character cell and CSS sizes an em; the conversion has to be identical in the canvas preview and the SVG exporter, or a label that fits on screen overflows in the exported file.

Bitmaps are drawn as runs of filled rectangles rather than through `putImageData`, which ignores the canvas transform and would drop the label's home offset, the field rotation and the preview zoom.

### `formats/epl/`
EPL2 support, mirroring the ZPL modules at the repository root (`zplParser.ts`, `zplCommands.ts`, `validation.ts`, `formatting.ts`): `tokenizer.ts`, `commands.ts`, `parser.ts` (→ the same IR), `validation.ts`, `formatting.ts`. Adding a third language means adding a directory here and one entry in `core/formats.ts`.

### `barcode/`
`symbologies.ts` is the single source of truth for all 24 symbologies: the bwip-js encoder id, the ZPL command and EPL selector, the character set, length rules and check-digit scheme. `validate.ts` turns those rules into findings and computes check digits. The parser, the emitters, the renderer, the linter and the barcode studio all read this one catalog.

### `data/`
`csv.ts` is a dependency-free RFC 4180 reader/writer; `dataset.ts` normalizes CSV/TSV/JSON/JSONL into a common row model; `template.ts` implements `{{field|filter}}` substitution plus the per-language escaping that keeps data from being read as commands; `merge.ts` expands a template over a dataset and reports the placeholder ↔ column mapping.

### `emit/`
The inverse of the parsers: `zpl.ts` and `epl.ts` turn IR back into source. This is what makes "convert", "insert barcode" and "deploy to a printer that speaks the other language" possible. Emitters report every approximation they make rather than dropping geometry quietly.

`svg.ts` is the odd one out — it emits a *rendering*, not source. It exists because SVG is the one export that needs no canvas: it runs in the extension host with no preview panel open and nothing rasterized, and the result stays vector, so a label can be placed in artwork, printed at any size, or diffed as text.

### `image/`
Everything between an image file and printable dots, and pure so the preview shares it. `png.ts` and `bmp.ts` decode (PNG at any bit depth, colour type and scan order, Adam7 included; BMP at 1/4/8/16/24/32 bits, RLE or not, either scan direction); `decode.ts` picks a decoder by magic bytes and is the one place a new format has to be registered; `bitmap.ts` does the conversion that decides what the head actually burns — box-average downscale, threshold or Floyd-Steinberg, trim and quarter-turn rotation.

### `analysis/`
`metrics.ts` measures a parsed label (geometry, op inventory, estimated ink coverage, barcode inventory); `lint.ts` holds the semantic rules that run on the IR, so they apply to every language at once; `report.ts` renders the Markdown report the analyze command opens.

## Node-only modules

### `importers/`
`imageToLabel.ts` is the label side of artwork import: it takes decoded pixels from `image/` and emits `^GF` / `GW` fields, reporting the judgement calls (a downscale, a trim, heavy ink coverage) the user should see. `capture.ts` cleans a raw printer capture into editable labels.

### `deploy/`
`printers.ts` models printer profiles from settings data; `transports.ts` implements raw TCP 9100, file/device and spool-directory delivery — the only place in the extension that opens a socket; `deploy.ts` orchestrates conversion + send and returns an outcome rather than throwing.

## VS Code layer

- `extension.ts` — activation: registers providers for every label language, diagnostics, the explorer views and all commands.
- `config.ts` — every settings read, with fallback to the legacy `zplViewer.*` keys.
- `previewPanel.ts` — owns the preview webview, pushes document text + render options, receives export bytes.
- `providers/` — hover, completion, symbols, folding, formatting; each one dispatches on the document's language. `formatter.ts` exports its edits as well as the provider, because `labelStudio.formatDocument` has to apply them to the document it was handed: VS Code's own `editor.action.formatDocument` formats whichever code editor has focus, and none does while the preview webview holds it.
- `ui/` — `commands.ts` (every command, kept thin, plus `LABEL_ACTIONS`: the single catalog the action quick pick and the Actions tree both read), `labelExplorer.ts` (the five activity-bar trees), `statusBar.ts` (the label's language/size/density, and the click target for the action list), `barcodeStudio.ts` (studio webview host).

  Commands take an optional target — a tree node, an explorer URI, or nothing — and resolve it to a document, so the same command works from a menu, the palette and the preview toolbar. A menu entry whose `when` clause cannot match any tree item's `contextValue` fails silently in VS Code, so `src/test/integration/ui.test.ts` asserts that every declared command, menu entry, submenu and `viewItem` actually connects to something.
- `webview/` — `main.ts` + `preview.html` for the preview, `studio/main.ts` + `studio/studio.html` for the barcode studio. Both bundles are built by the `webview` webpack config.

## Conventions

- New pure code goes in the pure layer and gets unit tests; the `vscode` layer stays thin enough that integration tests only need to prove the wiring.
- A module that the webview needs must be listed in `tsconfig.webview.json` and must not import `vscode`, `fs`, `net` or `zlib`. `core/inflate.ts` exists precisely so that decompression can cross that line.
- Diagnostics carry a stable `rule` id (`barcode.check-digit`, `layout.clipped`, …) so users can search for or suppress one.
