# CLAUDE.md

Guidance for AI coding agents (Claude Code, Copilot, Cursor) working in **zpl-viewer**.

**zpl-viewer** is a VS Code extension ("ZPL Viewer") that gives developers full language support for Zebra Programming Language (ZPL/ZPL II) label files (`.zpl`, `.zpl2`, `.prn`, `.lbl`): syntax highlighting, hover docs + IntelliSense for 50+ commands, snippets, a formatter, diagnostics, a live label preview in a webview, and PNG/PDF export. Everything runs fully offline and in-process — `src/renderer/parser.ts` turns ZPL into a drawing-op IR and `src/renderer/draw.ts` renders it to Canvas 2D, with pure-JS libraries (`bwip-js` for barcodes, `pdf-lib` for PDF export); no HTTP calls, external services, or binaries. "Done" here means ESLint is clean, both webpack bundles (`dist/extension.js`, `dist/webview/`) build, and the four-layer test pipeline is green — unit, visual regression against committed golden PNGs, VS Code extension-host integration, and Playwright e2e — as run by the 3-OS CI matrix (`.github/workflows/ci.yml`, Node 20).

## Stack & commands

TypeScript + webpack (two bundles: extension host + webview); tests are mocha/chai + c8, `@vscode/test-electron`, and Playwright.

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

## Conventions

- Conventional Commits: `type(scope): description` (`feat`/`fix`/`docs`/`refactor`/`test`/`chore`/`ci`).
- Default branch is `main` — branch from it and open a PR; never push to it directly.
- README-First, README-Last: read the nearest `README.md` before changing a
  directory, and update it after.
- Don't suppress type errors (`as any`, `@ts-ignore`, `# type: ignore`) or
  leave empty exception handlers.

## Fleet context

This repo is one of ~40 managed by the [bamr87/bamr87 dash](https://github.com/bamr87/bamr87) (registry: `_data/projects.yml`; tiered baseline: `docs/STANDARDS.md`). It is vendored there as a git submodule: commit and push changes **here** first — the hub only bumps its pointer afterwards. Shared CI, release, schema, and agent kits are seeded from the hub's `templates/`; prefer adopting those over hand-rolling equivalents.
