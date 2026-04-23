import { expect, test } from '@playwright/test';
import { openHarness, postRender, readFixture } from './harness';

test('preview renders canvas content', async ({ page }) => {
  await openHarness(page);
  await postRender(page, readFixture('shipping.zpl'));

  await expect
    .poll(async () => page.locator('#label').evaluate((c) => (c as HTMLCanvasElement).width))
    .toBeGreaterThan(10);

  const screenshot = await page.locator('#label').screenshot();
  expect(screenshot.byteLength).toBeGreaterThan(1000);
});
