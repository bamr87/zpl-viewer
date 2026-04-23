import { Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { makeExportMessage, makeRenderMessage } from '../helpers/messages';

export function harnessFileUrl(): string {
  const harnessPath = path.resolve(process.cwd(), 'src/test/e2e/harness.html');
  return `file://${harnessPath}`;
}

export function readFixture(name: string): string {
  return fs.readFileSync(
    path.resolve(process.cwd(), 'src/test/fixtures/valid', name),
    'utf8',
  );
}

export async function openHarness(page: Page): Promise<void> {
  await page.goto(harnessFileUrl());
  await page.waitForSelector('#label');
}

export async function postRender(page: Page, zpl: string): Promise<void> {
  const message = makeRenderMessage(zpl);
  await page.evaluate((msg) => {
    window.dispatchEvent(new MessageEvent('message', { data: msg }));
  }, message);
}

export async function postExport(
  page: Page,
  zpl: string,
  format: 'png' | 'pdf',
  requestId: string,
): Promise<void> {
  const message = makeExportMessage(zpl, format, requestId);
  await page.evaluate((msg) => {
    window.dispatchEvent(new MessageEvent('message', { data: msg }));
  }, message);
}

export async function hostMessages(page: Page): Promise<unknown[]> {
  return page.evaluate(() => (window as unknown as { __hostMessages: unknown[] }).__hostMessages || []);
}
