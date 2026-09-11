# CLAUDE.md

Guidance for AI coding agents (Claude Code, Copilot, Cursor) working in **zpl-viewer**.

**Label Studio** (package name `zpl-viewer`, kept for extension-identity stability) is a VS Code extension for everything that happens to a thermal label before it reaches the printer: read, create, modify, analyze, import, merge and deploy. It supports two printer languages — ZPL II (`.zpl`, `.zpl2`, `.prn`, `.lbl`) and EPL2 (`.epl`, `.epl2`) — with syntax highlighting, hover docs and IntelliSense, snippets, formatters, diagnostics, a live label preview, PNG/PDF export, a 24-symbology barcode studio, CSV/JSON data merge, PNG and printer-capture import, and deployment over raw TCP 9100, a device path or a spool folder.

Everything except deployment runs fully offline and in-process: each language parses into the shared drawing-op IR (`src/renderer/ir.ts`), `src/renderer/draw.ts` renders it to Canvas 2D, and pure-JS libraries (`bwip-js` for barcodes, `pdf-lib` for PDF) do the rest. The only socket in the codebase is `src/deploy/transports.ts`, used when a user explicitly deploys. "Done" here means ESLint is clean, both webpack bundles (`dist/extension.js`, `dist/webview/`) build, and the four-layer test pipeline is green — unit, visual regression against committed golden PNGs, VS Code extension-host integration, and Playwright e2e — as run by the 3-OS CI matrix (`.github/workflows/ci.yml`, Node 20).

## Stack & commands

TypeScript + webpack (two configs: extension host, and a webview config with `preview` + `studio` entries); tests are mocha/chai + c8, `@vscode/test-electron`, and Playwright.

```bash
npm ci                       # install dependencies (Node 20)
npm run watch                # webpack watch for both bundles; then F5 to launch the Extension Development Host
npm run compile              # webpack build → dist/extension.js + dist/webview/
npm run lint                 # eslint src --ext ts
npm run test:unit            # pure unit + renderer smoke tests (compile-tests + c8/mocha)
npm run test:visual          # renderer visual regression vs golden PNGs (test:visual:update regenerates them)
npm run test:integration     # VS Code extension-host suite (@vscode/test-electron)
npm run test:e2e             # Playwright webview tests (first: npx playwright install chromium)
npm test                     # full pipeline: unit + visual + integration + e2e
```

## Architecture rules

- `src/README.md` is the module guide — read it before adding code.
- **Pure layer** (`core/`, `formats/`, `renderer/`, `barcode/`, `data/`, `emit/`, `analysis/`) must not import `vscode`, `fs`, `net` or `zlib`: it is compiled into the webview bundle and exercised directly by unit tests. Anything it needs goes in `tsconfig.webview.json`.
- **Node-only** code lives in `importers/` and `deploy/`; **VS Code** code in `extension.ts`, `config.ts`, `diagnostics.ts`, `previewPanel.ts`, `providers/` and `ui/`. Commands stay thin — logic belongs below them, where it can be unit-tested.
- Add a printer language by creating `src/formats/<id>/` and registering it in `src/core/formats.ts`; parse into the existing IR rather than inventing a second one.
- `src/barcode/symbologies.ts` is the single source of truth for symbologies (encoder id, ZPL command, EPL selector, charset, length, check digit). Never hard-code a symbology mapping elsewhere.
- Settings are read through `src/config.ts` so the legacy `zplViewer.*` keys keep working; new commands use the `labelStudio.*` namespace and keep an alias if they replace an old id.
- Visual goldens are bound to the machine that produced them — system fonts differ per OS, and the Skia build behind `@napi-rs/canvas` differs per platform and per CI runner image, so even a text-free label's box and barcode edges move. Cover rendering geometry portably in `src/test/unit/render.test.ts` (which records Canvas 2D calls); treat the pixel goldens as a same-machine net, and never add a golden you cannot regenerate where CI runs.

## Conventions

- Conventional Commits: `type(scope): description` (`feat`/`fix`/`docs`/`refactor`/`test`/`chore`/`ci`).
- Default branch is `main` — branch from it and open a PR; never push to it directly.
- README-First, README-Last: read the nearest `README.md` before changing a directory, and update it after.
- Markdown is one paragraph per line (`python3 tools/unwrap-prose.py --write`); CI enforces it.
- Don't suppress type errors (`as any`, `@ts-ignore`, `# type: ignore`) or leave empty exception handlers.

## Fleet context

This repo is one of ~40 managed by the [bamr87/bamr87 dash](https://github.com/bamr87/bamr87) (registry: `_data/projects.yml`; tiered baseline: `docs/STANDARDS.md`). It is vendored there as a git submodule: commit and push changes **here** first — the hub only bumps its pointer afterwards. Shared CI, release, schema, and agent kits are seeded from the hub's `templates/`; prefer adopting those over hand-rolling equivalents.
