<!-- kit: sdlc v0.1.0 · AGENTS.md is the CANONICAL agent instructions file (decision D4, UPS-AGENT-07/08). -->

# zpl-viewer

> Label Studio (`zpl-viewer`), an offline VS Code extension for ZPL II and EPL2 thermal labels — the commands, layout, conventions and layering rules for working on it.

## What this repo is

**Label Studio** (package name `zpl-viewer`, kept for extension-identity stability) is a VS Code extension for everything that happens to a thermal label before it reaches the printer: read, create, modify, analyze, import, merge and deploy, in ZPL II (`.zpl`, `.zpl2`, `.prn`, `.lbl`) and EPL2 (`.epl`, `.epl2`). Everything except deployment runs offline and in-process: each language parses into the shared drawing-op IR (`src/renderer/ir.ts`), `src/renderer/draw.ts` renders it to Canvas 2D, and pure-JS libraries (`bwip-js` for barcodes, `pdf-lib` for PDF) do the rest. The only socket in the codebase is `src/deploy/transports.ts`, used when a user explicitly deploys. It serves developers and warehouse/IT staff who write or troubleshoot labels.

"Done" means ESLint is clean, both webpack bundles (`dist/extension.js`, `dist/webview/`) build, and the test pipeline is green — unit plus renderer draw-call geometry (which also checks the generated reference docs), VS Code extension-host integration, and Playwright e2e — as run by the 3-OS CI matrix (`.github/workflows/ci.yml`, Node 20).

## Stack & commands

TypeScript + webpack (two configs: the extension host, and a webview config with `preview` + `studio` entries); tests are mocha/chai + c8, `@vscode/test-electron`, and Playwright.

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

Docs gates: `python3 tools/unwrap-prose.py --check` (one paragraph per line) and `python3 tools/docs_index.py --check` (the `docs/README.md` index).

## Layout

| Path | What lives there |
| --- | --- |
| `src/` | Extension source; [`src/README.md`](src/README.md) is the module guide. Tests in `src/test/{unit,renderer,integration,e2e}` with fixtures in `src/test/fixtures/` |
| `syntaxes/`, `snippets/`, `language-configuration*.json` | TextMate grammars, snippets and editor behaviour for ZPL and EPL |
| `samples/` | Example labels and a sample data source (opened by the Run Extension launch config) |
| `docs/` | Docs index, ADRs (`docs/adr/`), the testing guide, and generated reference (`docs/reference/`) |
| `scripts/` | Node maintenance scripts: `gen-reference-docs.mjs`, `smoke-test.mjs` |
| `tools/` | Vendored fleet tools (`unwrap-prose.py`, `docs_index.py`) |
| `features/`, `verify/` | Feature index (`features/v1`) and the user-scenario verification kit |
| `public/` | Vendored fleet feedback widget scripts |
| `images/` | Extension and file icons |

## Conventions

- **Backlog of record:** GitHub Issues with the fleet labels (`.github/sdlc.yml` `backlog.mode: issues`). Pick up issues labelled `agent:ready`; never touch `agent:hold` or `human-review`.
- **Definition of Done:** the fleet default PR checklist (this repo has no `.github/pull_request_template.md`), plus the "done" bar above.
- **Decisions:** ADRs in `docs/adr/NNNN-slug.md`, indexed in `docs/adr/README.md`. Add one for anything hard to reverse.
- **Commits:** Conventional Commits (`feat fix docs style refactor test chore perf ci build`). The PR title is the squash subject.
- **Branches:** `feature/`, `fix/`, `docs/`, `refactor/`, `test/` or `chore/` off `main`; open a PR, never push to `main` directly.
- **Releases:** release-please (`.github/workflows/release.yml` → `bamr87/.github`) opens a release PR from the Conventional Commit titles; merging it tags `vX.Y.Z`, creates the GitHub Release and runs the shared publish workflow. Version source is `package.json` (`.release-please-manifest.json`, `release-please-config.json`). Needs the `NPM_TOKEN` secret, plus an optional `RELEASE_PLEASE_TOKEN` PAT so the release PR triggers CI. Never edit `CHANGELOG.md` or a version number by hand.
- **Generated:** `docs/reference/{commands,settings,keybindings}.md` come from `package.json` `contributes` — after changing a command, setting or keybinding run `npm run docs:reference`; `src/test/unit/referenceDocs.test.ts` fails `npm run test:unit` while they are stale. The `docs/README.md` index span comes from each document's summary line (`python3 tools/docs_index.py --write`).
- **Vendored, never edited here:** `tools/unwrap-prose.py`, `tools/docs_index.py`, `public/fleet-feedback*.js` — change them in the hub and re-vendor.
- **README-First, README-Last:** read the nearest `README.md` before changing a directory, and update it after.
- **Markdown** is one paragraph per line (`python3 tools/unwrap-prose.py --write`); CI enforces it.
- **Never:** suppress type errors (`as any`, `@ts-ignore`, `# type: ignore`), leave empty exception handlers, or hand-edit generated files.

## Architecture rules

- `src/README.md` is the module guide — read it before adding code.
- **Pure layer** (`core/`, `formats/`, `renderer/`, `barcode/`, `data/`, `emit/`, `analysis/`) must not import `vscode`, `fs`, `net` or `zlib`: it is compiled into the webview bundle and exercised directly by unit tests. Anything it needs goes in `tsconfig.webview.json`.
- **Node-only** code lives in `importers/` and `deploy/`; **VS Code** code in `extension.ts`, `config.ts`, `diagnostics.ts`, `previewPanel.ts`, `providers/` and `ui/`. Commands stay thin — logic belongs below them, where it can be unit-tested.
- Add a printer language by creating `src/formats/<id>/` and registering it in `src/core/formats.ts`; parse into the existing IR rather than inventing a second one.
- `src/barcode/symbologies.ts` is the single source of truth for symbologies (encoder id, ZPL command, EPL selector, charset, length, check digit). Never hard-code a symbology mapping elsewhere.
- Settings are read through `src/config.ts` so the legacy `zplViewer.*` keys keep working; new commands use the `labelStudio.*` namespace and keep an alias if they replace an old id.
- **Never add pixel goldens.** A rendered label depends on the host's fonts and the Skia build behind the canvas, and the goldens once hid a broken barcode encoder ([why](docs/testing.md#why-there-are-no-golden-images)). Cover rendering by recording Canvas 2D calls instead (`src/test/helpers/recordingContext.ts`, used by `src/test/unit/render.test.ts` and `src/test/renderer/draw.test.ts`).
- The pure layer has no `zlib` and no `Buffer`: `core/inflate.ts` and `core/base64.ts` exist so decompression and base64 work in the webview too. Reach for those, not the Node built-ins, anywhere under the pure layer.
- Graphics decoding belongs in `src/renderer/graphics.ts` and image decoding in `src/image/`; both are registries, so a new encoding or file format is one entry plus its decoder.
- The `labelStudio._test.waitForPreviewReady` hook (and its `zplViewer.*` alias) is registered only when `VSCODE_ZPL_TEST=1`, which `npm run test:integration` sets; keep test-only surfaces behind that flag.

## Fleet context

Member of the bamr87 fleet, managed by the [bamr87/bamr87 hub](https://github.com/bamr87/bamr87) (registry `_data/projects.yml`; standards in [`specs/`](https://github.com/bamr87/bamr87/tree/main/specs), the Universal Project Standard). It is vendored there as a git submodule: commit and push changes **here** first — the hub only bumps its pointer afterwards. Shared CI, release, schema, and agent kits are seeded from the hub's `templates/`; prefer adopting those over hand-rolling equivalents. Loops that act on this repo: `@claude` mentions (`claude.yml`), the shared conformance check (`conformance.yml`, advisory), the user-scenario verify pass (`verify.yml`), the markdown one-line gate (`markdown-oneline.yml`), release-please (`release.yml`) and Dependabot.

## Standard deviations

none (`.github/sdlc.yml` declares `deviations: []`)

## Governance

Read [`docs/constitution.md`](docs/constitution.md) before changing anything: it is the highest-precedence rule set here and wins over this file when they disagree. It changes only through a numbered record in [`docs/amendments/`](docs/amendments/), ratified by the maintainer merging the PR; agents propose, never merge. Every user-facing feature has a stable id in [`features/features.yml`](features/features.yml) with `status`, location and the PRD requirement ids it serves; the PRD's "Feature catalog" block is generated from it (`python3 <bamr87/bamr87>/tools/governance_lint.py prd-sync . --write`; check with `… check .`). Never hand-edit that block or `CHANGELOG.md`.
