# Change Log

All notable changes to the Label Studio extension (formerly ZPL Viewer) will be documented in this file.

## [Unreleased] - Label Studio

The extension grew from a ZPL viewer into a general label, barcode and data-integration toolkit.

### Added

- **EPL2 support**: tokenizer, command reference, interpreter, validator and formatter, plus a TextMate grammar, language configuration and snippets for `.epl`/`.epl2`. EPL parses into the same IR as ZPL, so preview, export, analysis and deployment work for both.
- **Format conversion** (`Label: Convert Label to Another Printer Language`): IR-based ZPL ↔ EPL conversion that reports every approximation it makes.
- **Barcode subsystem**: a catalog of 24 symbologies (encoder id, ZPL command, EPL selector, character set, length and check-digit rules) with payload validation — character set, length, mod-10/mod-43/flat mod-10 check digits, GS1 AI syntax and 2-D capacity.
- **Barcode Studio** webview: build a symbol interactively, see the validation state, and insert the resulting ZPL or EPL field.
- **Data integration**: dependency-free CSV/TSV reader, JSON/JSONL loader, `{{field|filter}}` templating with a filter pipeline, forgiving field matching, automatic `^FH` hex escaping, merge with a row cap, and a placeholder ↔ column mapping report.
- **Analysis**: label metrics (geometry, op inventory, estimated ink coverage, barcode inventory) and a Markdown report, backed by semantic lint rules for barcode payloads, field bounds and scannability (bar width, bar height, quiet zone).
- **Importers**: PNG and BMP decoders with threshold/Floyd-Steinberg conversion to `^GF`/`GW` graphic fields, and a printer-capture importer that strips control characters and splits a stream into editable labels.
- **Graphics decoding**: `^GF` now reads every encoding ZPL uses — plain ASCII hex, Zebra's ACS compressed hex (`G`-`Y`/`g`-`z` run counts with the `,`, `!` and `:` row operators), `:B64:`, `:Z64:` and raw binary — backed by a dependency-free DEFLATE implementation (`core/inflate.ts`) so decompression works in the webview, where `zlib` does not exist. A graphic whose CRC or declared length disagrees with its payload renders as far as it decodes, with a warning.
- **Stored graphics**: `~DG` and `~DY` downloads are held in a graphic store that outlives each `^XA … ^XZ`, as printer memory does, and are drawn by `^XG` (with 1-10x magnification) or `^IM`; `^ID` forgets one. A `^XG` naming a graphic the file never downloaded is reported instead of silently skipped. `~DY` also accepts a stored PNG, which the preview decodes.
- **SVG export** (`Label: Export Label as SVG`): vector export rendered in the extension host, so it needs no preview panel and rasterizes nothing. Barcodes come from the same encoder the preview uses and bitmaps become runs of rectangles, so the whole document stays vector.
- **Printer management**: `Label: Edit Printer` and `Label: Remove Printer`, the latter removing the profile from whichever settings scope actually defines it rather than silently leaving a shadowed copy behind.
- **Quick settings**: `Label: Set Print Density` and `Label: Set Label Size` (stock presets or custom), plus `Label: Open Label Studio Settings`.
- **Image import options**: `labelStudio.import.invert`, `labelStudio.import.trim` (crop blank margins) and `labelStudio.import.rotate` (quarter turns). Imported `^GF` payloads are ACS-compressed, which is typically an order of magnitude smaller than plain hex.
- **Interlaced PNG** (Adam7) is decoded, as are BMPs at 1/4/8/16/24/32 bits, RLE-compressed or not, in either scan direction.
- **Deployment**: printer profiles in settings, raw TCP 9100 / file-device / spool-directory transports, language conversion on send, dry run, and an output-channel log.
- **Label Studio views**: activity-bar trees for labels, data sources, printers and starter templates.
- **Starter templates**: shipping, product, asset tag, shelf and GS1 carton labels in ZPL, plus basic and shipping labels in EPL.

### Changed

- **The whole extension is reachable without the Command Palette.** A new **Actions** tree groups every command in the activity bar; label, data-source, printer and template rows get context menus and inline icons; the editor title bar, editor context menu and explorer context menu share a **Label Studio** submenu; a status-bar item reports the label's language, stock size and density and opens the full action list; the preview toolbar gained PNG/PDF/SVG export; and *New Label from Template* appears in **File → New File…**. `Ctrl/Cmd+K L` opens the action list.
- **Commands act on what you invoked them on.** Every label command now accepts a target — a tree node, an explorer URI — and falls back to the active editor, then to the one visible label editor. Exporting from a tree item no longer exports whatever happened to be in the editor, and commands run from the preview panel (where there is no active text editor) work instead of reporting that no label is open.
- **Pixel goldens retired.** The renderer's cover is now recorded Canvas 2D calls (`src/test/renderer/draw.test.ts`), which pin the same geometry without depending on the host's fonts or Skia build — the environment noise goldens had to tolerate is what let a broken barcode encoder sit in them unnoticed. This drops the `test:visual` scripts, the Linux-only CI step, and the `@napi-rs/canvas`, `pixelmatch` and `pngjs` dev dependencies, leaving the suite with no native build step.
- Renamed to **Label Studio**; commands moved to the `labelStudio.*` namespace with `Label:` titles, and settings to `labelStudio.*`. The old `zplViewer.*` command ids stay registered as aliases and explicitly-set legacy settings keys are still honoured.
- Diagnostics now combine syntax checks with semantic lint rules and carry stable rule ids.
- Providers (hover, completion, symbols, folding, formatting) dispatch on the document's printer language.
- Drawing ops carry the source range that produced them, so findings point at the right line.

### Fixed

- `^B9` is UPC-E, not Codabar; Codabar is `^BK`. ZPL barcode commands are now table-driven from the shared catalog, which also adds `^BA`, `^B1`, `^B2`, `^B5`, `^BD`, `^BF`, `^BI`, `^BJ`, `^BK`, `^BM`, `^BO`, `^BP` and `^BR`.
- **Graphics ignored the canvas transform.** Bitmaps were painted with `putImageData`, which writes device pixels and bypasses the current transform, so every `^GF` landed at the canvas origin with the label's home offset, the field rotation and the preview zoom discarded. They are now drawn as runs of filled rectangles, which go through the transform like every other op.
- **Scalable fonts were stretched by about 80%.** `^CF0,40` and `^A0N,40,40` were read as a 40-dot-square character cell, when a scalable font draws at its own proportions at that height. Text now matches what a printer produces, which also stops the preview reporting overflow on labels that fit. Bitmap fonts (A-H), which do have a fixed cell, are unchanged.
- **EPL `GW` graphics previewed as negatives.** EPL burns a dot for a `0` bit — the inverse of ZPL — and the importer wrote them that way, but the EPL parser read them without inverting, so artwork imported through Label Studio previewed inverted. Polarity is now normalized at the parser, so the IR has one convention.
- **The visual regression suite never rendered a barcode.** Its Node barcode renderer called `toCanvas`, which only bwip-js's browser build has; `drawPage` caught the failure and painted the message onto the label, so every committed golden held an error string where its barcode should have been — and the suite passed while asserting a broken render.

## [0.2.0] - Local rendering

- Removed the Labelary HTTP dependency. All label rendering is now performed locally inside a VS Code webview using pure-JavaScript libraries.
- Added a ZPL → IR interpreter (`src/renderer/parser.ts`) with support for labels, fields, fonts, text blocks, boxes/lines/ellipses/diagonals, `^GF` bitmaps, and 10+ barcode symbologies.
- Added an isomorphic Canvas 2D draw routine (`src/renderer/draw.ts`) shared between preview and export.
- Barcode rendering via [`bwip-js`](https://github.com/metafloor/bwip-js).
- PDF export via [`pdf-lib`](https://pdf-lib.js.org/); all pages in a document are emitted into a single multi-page PDF.
- Preview toolbar now supports zoom in / out / reset in addition to page navigation and refresh.
- Configuration renamed: `zplViewer.labelary.*` removed; `zplViewer.renderer.density` and `zplViewer.preview.initialZoom` added.

## [0.1.0] - Initial release

- Syntax highlighting, language configuration, and folding for ZPL/ZPL II files.
- Hover documentation + IntelliSense for common ZPL commands.
- Document outline and code snippets.
- ZPL formatter.
- Diagnostics: unknown commands, unmatched labels, unterminated fields.
- Label preview via the Labelary rendering API (removed in 0.2.0).
