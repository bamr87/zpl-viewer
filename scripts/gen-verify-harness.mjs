#!/usr/bin/env node
// Generates src/test/e2e/harness.generated.html from the shipped
// src/webview/preview.html, so the Playwright e2e suite (src/test/e2e/harness.ts)
// and the verify kit (verify/verify.yml `app.build`) drive the same page.
//
// The webview placeholders are filled in so the page loads over file:// or a
// static server, and the shipped Content-Security-Policy is KEPT: `{{cspSource}}`
// becomes 'self' and `{{nonce}}` a fixed test nonce, which the acquireVsCodeApi
// stub carries too. The stub records every message the webview posts to the host
// in window.__hostMessages.
//
// Usage: node scripts/gen-verify-harness.mjs   (run from the repository root)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const HARNESS_NONCE = 'test';

export function generateHarness(root = process.cwd()) {
  const previewHtml = fs.readFileSync(path.resolve(root, 'src/webview/preview.html'), 'utf8');

  const stub = `<script nonce="${HARNESS_NONCE}">
    window.__hostMessages = [];
    window.acquireVsCodeApi = function () {
      return {
        postMessage(msg) { window.__hostMessages.push(msg); },
        setState() {},
        getState() { return undefined; },
      };
    };
  </script>`;

  const html = previewHtml
    .replace(/\{\{cspSource\}\}/g, "'self'")
    .replace(/\{\{nonce\}\}/g, HARNESS_NONCE)
    .replace('{{scriptUri}}', '../../../dist/webview/preview.js')
    .replace(`<script nonce="${HARNESS_NONCE}"`, `${stub}\n    <script nonce="${HARNESS_NONCE}"`);

  // Written beside the source harness so the relative script path resolves. The
  // write is atomic: parallel Playwright workers may all call this at once.
  const generated = path.resolve(root, 'src/test/e2e/harness.generated.html');
  const temp = `${generated}.${process.pid}.tmp`;
  fs.writeFileSync(temp, html);
  fs.renameSync(temp, generated);
  return generated;
}

// Compare URLs, not `file://${argv[1]}`: on Windows argv[1] is `D:\...`, which
// never equals import.meta.url (`file:///D:/...`).
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(generateHarness());
}
