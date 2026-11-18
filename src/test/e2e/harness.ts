import { Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { makeExportMessage, makeRenderMessage } from '../helpers/messages';

/**
 * Builds the harness page from the real `preview.html`.
 *
 * The harness used to hand-copy the preview's toolbar, which meant a button
 * added to the preview did not exist in the tests — the markup silently drifted
 * until a test tried to click something that was never there. Generating the
 * page from the shipped HTML makes that impossible: the e2e suite always drives
 * the toolbar users actually get.
 *
 * The webview placeholders are filled in so it loads over `file://`, and the
 * shipped Content-Security-Policy is KEPT: `{{cspSource}}` becomes `'self'`
 * and `{{nonce}}` a fixed test nonce, which the host-API stub carries too. So
 * every e2e spec proves the bundle runs under the real policy — no
 * `'unsafe-eval'`, scripts only by nonce.
 */
export const HARNESS_NONCE = 'test';

export function harnessFileUrl(): string {
  const previewHtml = fs.readFileSync(
    path.resolve(process.cwd(), 'src/webview/preview.html'),
    'utf8',
  );

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

  // Written beside the source harness so the relative script path resolves.
  const generated = path.resolve(process.cwd(), 'src/test/e2e/harness.generated.html');
  fs.writeFileSync(generated, html);
  return `file://${generated}`;
}

export function readFixture(name: string): string {
  return fs.readFileSync(
    path.resolve(process.cwd(), 'src/test/fixtures/valid', name),
    'utf8',
  );
}

export async function openHarness(page: Page): Promise<void> {
  await page.goto(harnessFileUrl());
  // The preview hides its canvas until the first render, so wait for the
  // element to exist rather than for it to be visible.
  await page.waitForSelector('#label', { state: 'attached' });
}

export async function postRender(
  page: Page,
  zpl: string,
  overrides?: Parameters<typeof makeRenderMessage>[1],
): Promise<void> {
  const message = makeRenderMessage(zpl, overrides);
  await page.evaluate((msg) => {
    window.dispatchEvent(new MessageEvent('message', { data: msg }));
  }, message);
}

export async function postExport(
  page: Page,
  zpl: string,
  format: 'png' | 'pdf',
  requestId: string,
  pageIndex?: number,
): Promise<void> {
  const message = makeExportMessage(zpl, format, requestId, pageIndex);
  await page.evaluate((msg) => {
    window.dispatchEvent(new MessageEvent('message', { data: msg }));
  }, message);
}

export async function hostMessages(page: Page): Promise<unknown[]> {
  return page.evaluate(() => (window as unknown as { __hostMessages: unknown[] }).__hostMessages || []);
}
