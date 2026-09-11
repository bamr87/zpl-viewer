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
- **Importers**: PNG decoder over `zlib` with threshold/Floyd-Steinberg conversion to `^GF`/`GW` graphic fields, and a printer-capture importer that strips control characters and splits a stream into editable labels.
- **Deployment**: printer profiles in settings, raw TCP 9100 / file-device / spool-directory transports, language conversion on send, dry run, and an output-channel log.
- **Label Studio views**: activity-bar trees for labels, data sources, printers and starter templates.
- **Starter templates**: shipping, product, asset tag, shelf and GS1 carton labels in ZPL, plus basic and shipping labels in EPL.

### Changed

- Renamed to **Label Studio**; commands moved to the `labelStudio.*` namespace with `Label:` titles, and settings to `labelStudio.*`. The old `zplViewer.*` command ids stay registered as aliases and explicitly-set legacy settings keys are still honoured.
- Diagnostics now combine syntax checks with semantic lint rules and carry stable rule ids.
- Providers (hover, completion, symbols, folding, formatting) dispatch on the document's printer language.
- Drawing ops carry the source range that produced them, so findings point at the right line.

### Fixed

- `^B9` is UPC-E, not Codabar; Codabar is `^BK`. ZPL barcode commands are now table-driven from the shared catalog, which also adds `^BA`, `^B1`, `^B2`, `^B5`, `^BD`, `^BF`, `^BI`, `^BJ`, `^BK`, `^BM`, `^BO`, `^BP` and `^BR`.

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
