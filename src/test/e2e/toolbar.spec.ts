import { expect, test } from '@playwright/test';
import { openHarness, postRender, readFixture } from './harness';

test('zoom toolbar changes canvas dimensions', async ({ page }) => {
  await openHarness(page);
  await postRender(page, readFixture('hello.zpl'));

  await expect
    .poll(async () => page.locator('#label').evaluate((c) => (c as HTMLCanvasElement).width))
    .toBeGreaterThan(10);

  const widthBefore = await page
    .locator('#label')
    .evaluate((c) => (c as HTMLCanvasElement).width);

  await page.click('button[data-cmd="zoom-in"]');
  const widthAfterZoomIn = await page
    .locator('#label')
    .evaluate((c) => (c as HTMLCanvasElement).width);
  expect(widthAfterZoomIn).toBeGreaterThan(widthBefore);

  await page.click('button[data-cmd="zoom-out"]');
  const widthAfterZoomOut = await page
    .locator('#label')
    .evaluate((c) => (c as HTMLCanvasElement).width);
  expect(widthAfterZoomOut).toBeLessThan(widthAfterZoomIn);
});
