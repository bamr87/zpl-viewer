# Change Log

All notable changes to the ZPL Viewer extension will be documented in this file.

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
