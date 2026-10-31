# Testing Label Studio

> The four test layers, what each one proves, why rendering is checked with recorded draw calls instead of golden images, and the test-only preview hook.

The commands that run each layer are in [AGENTS.md § Stack & commands](../AGENTS.md#stack--commands); CI runs all of them on Ubuntu, macOS and Windows (`.github/workflows/ci.yml`).

## Testing layers

1. **Unit (`src/test/unit`)** — parsers, emitters, graphics and image decoders, barcode rules, data pipeline, analysis, importers, deploy transports (including a real loopback socket), and the freshness of the generated `docs/reference/` files.
2. **Renderer (`src/test/renderer`)** — renders the sample labels and asserts the Canvas 2D calls they produce: positions, sizes, styles and the transform each was made under.
3. **Integration (`src/test/integration`)** — runs in a real VS Code host: commands, providers, diagnostics, merge and dry-run deploy.
4. **E2E (`src/test/e2e`)** — drives the compiled preview and barcode-studio webview bundles in Chromium.

Layers 1 and 2 both run under `npm run test:unit`.

## Why there are no golden images

The renderer is covered by recorded draw calls rather than by committed PNGs.

Pixel goldens were tried and removed. A rendered label is bound to the machine that produced it far more tightly than it looks: system fonts differ per OS, and the Skia build behind a headless canvas differs per platform *and* per CI runner image, which moves box and barcode edges as well as text. In practice that meant a golden could only be regenerated on the machine that made it, and each platform needed its own set that nobody could verify from anywhere else.

The failure mode that settled it: the goldens' own barcode encoder was calling a method that only exists in bwip-js's browser build. `drawPage` catches renderer errors and paints the message onto the label, so every committed golden had an error string where its barcode should have been — and the suite passed, for as long as the goldens existed, while asserting a broken render.

Draw-call assertions pin the same geometry with no environment dependence, and a barcode that fails to encode now fails a test instead of being frozen into an expected image. The recorder is `src/test/helpers/recordingContext.ts`.

## Test-mode preview hook

`zplViewer._test.waitForPreviewReady` / `labelStudio._test.waitForPreviewReady` are registered only when `VSCODE_ZPL_TEST=1`, which `npm run test:integration` sets via `cross-env`. The hook is test-only and never exposed in normal sessions.
