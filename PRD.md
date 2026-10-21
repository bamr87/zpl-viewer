# PRD — Label Studio (zpl-viewer)

> Product requirements for [`bamr87/zpl-viewer`](https://github.com/bamr87/zpl-viewer).
> Derived from the README, agent docs, config and code in this repo. Anything not
> stated in those sources is marked **TBD**; success metrics are proposals.

## 1. Overview / problem

Label Studio is an offline VS Code extension to read, preview, create, modify, analyze, import, merge and deploy ZPL II and EPL2 thermal labels. Everything except deployment runs locally — no HTTP calls, external services, Docker or binaries.

## 2. Target users

- Developers and integrators writing ZPL/EPL labels (shipping, product, asset tags)
- Warehouse/IT staff troubleshooting printer captures

## 3. Goals and non-goals

**Goals**

- Accurate live preview and export (PNG/PDF/SVG)
- Validate barcodes before printing
- Convert between ZPL II and EPL2 via one shared IR
- Fully offline except explicit deploy

**Non-goals**

- Cloud rendering services
- Telemetry or network calls during editing

## 4. Core features (current)

- Syntax highlighting, hover docs, IntelliSense, outline/folding
- Live canvas preview with zoom and paging
- Templates, snippets and Barcode Studio (24 symbologies via bwip-js)
- Formatters, image import, format conversion; all ZPL graphic encodings
- Analysis: metrics, ink coverage, lint rules
- Data merge of `{{placeholder}}` templates from CSV/TSV/JSON/JSONL
- Deploy via raw TCP 9100, device path or spool directory

## 5. Requirements

**Functional**

- `.prn`/`.lbl` files sniffed to detect language
- Barcode payloads validated for charset, length, check digits, GS1 AI syntax and capacity

**Non-functional**

- VS Code ^1.85
- Unit, integration and e2e test suites
- No network access except deploy

## 6. Success metrics (proposed — not defined in sources)

- Rendering fidelity vs. printed output: TBD
- Marketplace installs/ratings: TBD

## 7. Roadmap / open questions

- Marketplace publishing plan (see RELEASING.md): TBD

## 8. Links

- [README.md](README.md) · [AGENTS.md](AGENTS.md) · [RELEASING.md](RELEASING.md) · [CHANGELOG.md](CHANGELOG.md)
