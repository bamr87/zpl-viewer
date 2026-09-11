# `src/` — module guide

The extension is layered so that almost everything interesting is a pure function. Only the files that import `vscode` know they are running inside an editor; everything under `core/`, `barcode/`, `data/`, `emit/`, `analysis/`, `formats/` and `renderer/` is isomorphic and runs unchanged in the webview bundle and in unit tests.

```
vscode layer      extension.ts · config.ts · diagnostics.ts · previewPanel.ts · providers/ · ui/
                          │
pure layer        core/ · formats/ · renderer/ · barcode/ · data/ · emit/ · analysis/
                          │
node-only layer   importers/ (zlib) · deploy/ (net, fs)
```

## Pure modules

### `core/`
The keystone. `formats.ts` registers each printer language and detects which one a document is written in; `pipeline.ts` dispatches parse / format / emit / convert on that id; `validate.ts` combines a language's syntax checks with the shared lint rules; `units.ts` converts dots ↔ inches ↔ millimetres; `templates.ts` holds the starter labels; `diagnostics.ts` defines the format-neutral finding shape.

Nothing here may import `vscode` — the webview bundle compiles these files.

### `renderer/`
`ir.ts` is the intermediate representation every format parses into: a list of drawing ops in printer dots, each optionally carrying the source range that produced it. `parser.ts` interprets ZPL II into that IR; `draw.ts` paints IR onto any Canvas 2D context (webview canvas, `@napi-rs/canvas` in tests, offscreen canvas for PNG/PDF export).

### `formats/epl/`
EPL2 support, mirroring the ZPL modules at the repository root (`zplParser.ts`, `zplCommands.ts`, `validation.ts`, `formatting.ts`): `tokenizer.ts`, `commands.ts`, `parser.ts` (→ the same IR), `validation.ts`, `formatting.ts`. Adding a third language means adding a directory here and one entry in `core/formats.ts`.

### `barcode/`
`symbologies.ts` is the single source of truth for all 24 symbologies: the bwip-js encoder id, the ZPL command and EPL selector, the character set, length rules and check-digit scheme. `validate.ts` turns those rules into findings and computes check digits. The parser, the emitters, the renderer, the linter and the barcode studio all read this one catalog.

### `data/`
`csv.ts` is a dependency-free RFC 4180 reader/writer; `dataset.ts` normalizes CSV/TSV/JSON/JSONL into a common row model; `template.ts` implements `{{field|filter}}` substitution plus the per-language escaping that keeps data from being read as commands; `merge.ts` expands a template over a dataset and reports the placeholder ↔ column mapping.

### `emit/`
The inverse of the parsers: `zpl.ts` and `epl.ts` turn IR back into source. This is what makes "convert", "insert barcode" and "deploy to a printer that speaks the other language" possible. Emitters report every approximation they make rather than dropping geometry quietly.

### `analysis/`
`metrics.ts` measures a parsed label (geometry, op inventory, estimated ink coverage, barcode inventory); `lint.ts` holds the semantic rules that run on the IR, so they apply to every language at once; `report.ts` renders the Markdown report the analyze command opens.

## Node-only modules

### `importers/`
`png.ts` decodes non-interlaced PNG using Node's `zlib`; `imageToLabel.ts` converts a decoded image to 1 bit per pixel (threshold or Floyd-Steinberg) and emits `^GF` / `GW` fields; `capture.ts` cleans a raw printer capture into editable labels.

### `deploy/`
`printers.ts` models printer profiles from settings data; `transports.ts` implements raw TCP 9100, file/device and spool-directory delivery — the only place in the extension that opens a socket; `deploy.ts` orchestrates conversion + send and returns an outcome rather than throwing.

## VS Code layer

- `extension.ts` — activation: registers providers for every label language, diagnostics, the explorer views and all commands.
- `config.ts` — every settings read, with fallback to the legacy `zplViewer.*` keys.
- `previewPanel.ts` — owns the preview webview, pushes document text + render options, receives export bytes.
- `providers/` — hover, completion, symbols, folding, formatting; each one dispatches on the document's language.
- `ui/` — `commands.ts` (every command, kept thin), `labelExplorer.ts` (the four activity-bar trees), `barcodeStudio.ts` (studio webview host).
- `webview/` — `main.ts` + `preview.html` for the preview, `studio/main.ts` + `studio/studio.html` for the barcode studio. Both bundles are built by the `webview` webpack config.

## Conventions

- New pure code goes in the pure layer and gets unit tests; the `vscode` layer stays thin enough that integration tests only need to prove the wiring.
- A module that the webview needs must be listed in `tsconfig.webview.json` and must not import `vscode`, `fs`, `net` or `zlib`.
- Diagnostics carry a stable `rule` id (`barcode.check-digit`, `layout.clipped`, …) so users can search for or suppress one.
