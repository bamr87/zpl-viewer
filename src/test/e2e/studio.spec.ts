import { expect, test } from '@playwright/test';
import * as path from 'path';
import { hostMessages } from './harness';

function studioUrl(): string {
  return `file://${path.resolve(process.cwd(), 'src/test/e2e/studio-harness.html')}`;
}

async function setValue(
  page: import('@playwright/test').Page,
  selector: string,
  value: string,
): Promise<void> {
  await page.selectOption(selector, value).catch(async () => {
    await page.fill(selector, value);
  });
}

test('studio encodes a barcode and emits a printable field', async ({ page }) => {
  await page.goto(studioUrl());
  await page.waitForSelector('#barcode');

  await setValue(page, '#symbology', 'code128');
  await page.fill('#data', 'LABELSTUDIO-1');

  await expect
    .poll(async () =>
      page.locator('#barcode').evaluate((c) => (c as HTMLCanvasElement).width),
    )
    .toBeGreaterThan(10);

  await expect(page.locator('#snippet')).toContainText('^BC');
  await expect(page.locator('#snippet')).toContainText('LABELSTUDIO-1');
  await expect(page.locator('#issues')).toContainText('encodes cleanly');
});

test('studio reports a payload the symbology cannot encode', async ({ page }) => {
  await page.goto(studioUrl());
  await page.waitForSelector('#barcode');

  await setValue(page, '#symbology', 'ean13');
  await page.fill('#data', '5901234123458');

  // Two errors are expected: the validator's, and the encoder refusing to
  // build a symbol it cannot check-digit.
  await expect(page.locator('#issues .issue.error').first()).toContainText(
    'Check digit',
  );
  await expect(page.locator('#issues .issue.error')).toHaveCount(2);
});

test('studio switches the emitted field to EPL', async ({ page }) => {
  await page.goto(studioUrl());
  await page.waitForSelector('#barcode');

  await page.fill('#data', '12345678');
  await setValue(page, '#target', 'epl');

  await expect(page.locator('#snippet')).toContainText('B50,50,0,3,');
  await page.click('#insert');

  const messages = await hostMessages(page);
  const insert = messages.find(
    (message) => (message as { type?: string }).type === 'insert',
  ) as { snippet?: string } | undefined;
  expect(insert?.snippet).toContain('B50,50,0,3,');
});
