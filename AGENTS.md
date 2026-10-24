# CLAUDE.md

Guidance for AI coding agents (Claude Code, Copilot, Cursor) working in **zpl-viewer**.

**Label Studio** (package name `zpl-viewer`, kept for extension-identity stability) is a VS Code extension for everything that happens to a thermal label before it reaches the printer: read, create, modify, analyze, import, merge and deploy. It supports two printer languages — ZPL II (`.zpl`, `.zpl2`, `.prn`, `.lbl`) and EPL2 (`.epl`, `.epl2`) — with syntax highlighting, hover docs and IntelliSense, snippets, formatters, diagnostics, a live label preview, PNG/PDF export, a 24-symbology barcode studio, CSV/JSON data merge, PNG and printer-capture import, and deployment over raw TCP 9100, a device path or a spool folder.

Everything except deployment runs fully offline and in-process: each language parses into the shared drawing-op IR (`src/renderer/ir.ts`), `src/renderer/draw.ts` renders it to Canvas 2D, and pure-JS libraries (`bwip-js` for barcodes, `pdf-lib` for PDF) do the rest. The only socket in the codebase is `src/deploy/transports.ts`, used when a user explicitly deploys. "Done" here means ESLint is clean, both webpack bundles (`dist/extension.js`, `dist/webview/`) build, and the test pipeline is green — unit plus renderer draw-call geometry, VS Code extension-host integration, and Playwright e2e — as run by the 3-OS CI matrix (`.github/workflows/ci.yml`, Node 20).

## Stack & commands

TypeScript + webpack (two configs: extension host, and a webview config with `preview` + `studio` entries); tests are mocha/chai + c8, `@vscode/test-electron`, and Playwright.

```bash
npm ci                       # install dependencies (Node 20)
npm run watch                # webpack watch for both bundles; then F5 to launch the Extension Development Host
npm run compile              # webpack build → dist/extension.js + dist/webview/
npm run lint                 # eslint src --ext ts
npm run test:unit            # pure unit + renderer draw-call tests (compile-tests + c8/mocha)
npm run test:integration     # VS Code extension-host suite (@vscode/test-electron)
npm run test:e2e             # Playwright webview tests (first: npx playwright install chromium)
npm test                     # full pipeline: unit + integration + e2e
```

## Architecture rules

- `src/README.md` is the module guide — read it before adding code.
- **Pure layer** (`core/`, `formats/`, `renderer/`, `barcode/`, `data/`, `emit/`, `analysis/`) must not import `vscode`, `fs`, `net` or `zlib`: it is compiled into the webview bundle and exercised directly by unit tests. Anything it needs goes in `tsconfig.webview.json`.
- **Node-only** code lives in `importers/` and `deploy/`; **VS Code** code in `extension.ts`, `config.ts`, `diagnostics.ts`, `previewPanel.ts`, `providers/` and `ui/`. Commands stay thin — logic belongs below them, where it can be unit-tested.
- Add a printer language by creating `src/formats/<id>/` and registering it in `src/core/formats.ts`; parse into the existing IR rather than inventing a second one.
- `src/barcode/symbologies.ts` is the single source of truth for symbologies (encoder id, ZPL command, EPL selector, charset, length, check digit). Never hard-code a symbology mapping elsewhere.
- Settings are read through `src/config.ts` so the legacy `zplViewer.*` keys keep working; new commands use the `labelStudio.*` namespace and keep an alias if they replace an old id.
- **Never add pixel goldens.** They were tried and removed: a rendered label depends on the host's fonts and on the exact Skia build behind the canvas, so a golden can only be regenerated on the machine that made it — and the environment noise they had to tolerate hid a broken barcode encoder for as long as they existed, with the rendered error message baked into every committed image. Cover rendering by recording Canvas 2D calls instead (`src/test/helpers/recordingContext.ts`, used by `src/test/unit/render.test.ts` and `src/test/renderer/draw.test.ts`).
- The pure layer has no `zlib` and no `Buffer`: `core/inflate.ts` and `core/base64.ts` exist so decompression and base64 work in the webview too. Reach for those, not the Node built-ins, anywhere under the pure layer.
- Graphics decoding belongs in `src/renderer/graphics.ts` and image decoding in `src/image/`; both are registries, so a new encoding or file format is one entry plus its decoder.

## Conventions

- Conventional Commits: `type(scope): description` (`feat`/`fix`/`docs`/`refactor`/`test`/`chore`/`ci`).
- Default branch is `main` — branch from it and open a PR; never push to it directly.
- README-First, README-Last: read the nearest `README.md` before changing a directory, and update it after.
- Markdown is one paragraph per line (`python3 tools/unwrap-prose.py --write`); CI enforces it.
- Don't suppress type errors (`as any`, `@ts-ignore`, `# type: ignore`) or leave empty exception handlers.

## Fleet context

This repo is one of ~40 managed by the [bamr87/bamr87 dash](https://github.com/bamr87/bamr87) (registry: `_data/projects.yml`; tiered baseline: `docs/STANDARDS.md`). It is vendored there as a git submodule: commit and push changes **here** first — the hub only bumps its pointer afterwards. Shared CI, release, schema, and agent kits are seeded from the hub's `templates/`; prefer adopting those over hand-rolling equivalents.

## Governance

Read [`docs/constitution.md`](docs/constitution.md) before changing anything: it is the highest-precedence rule set here and wins over this file when they disagree. It changes only through a numbered record in [`docs/amendments/`](docs/amendments/), ratified by the maintainer merging the PR; agents propose, never merge. Every user-facing feature has a stable id in [`features/features.yml`](features/features.yml) with `status`, location and the PRD requirement ids it serves; the PRD's "Feature catalog" block is generated from it (`python3 <bamr87/bamr87>/tools/governance_lint.py prd-sync . --write`; check with `… check .`). Never hand-edit that block or `CHANGELOG.md`.
