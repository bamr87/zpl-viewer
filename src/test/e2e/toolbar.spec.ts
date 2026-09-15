import { expect, test } from '@playwright/test';
import { hostMessages, openHarness, postRender, readFixture } from './harness';

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

test('toolbar export buttons ask the host to run the export commands', async ({
  page,
}) => {
  // The preview is the one place a user is definitely looking at a label, so
  // its toolbar runs the same commands the menus do rather than a private
  // export path of its own.
  await openHarness(page);
  await postRender(page, readFixture('hello.zpl'));

  for (const [button, command] of [
    ['export-png', 'labelStudio.exportPng'],
    ['export-pdf', 'labelStudio.exportPdf'],
    ['export-svg', 'labelStudio.exportSvg'],
    ['actions', 'labelStudio.showActions'],
  ]) {
    await page.click(`button[data-cmd="${button}"]`);
    const messages = (await hostMessages(page)) as Array<{
      type?: string;
      command?: string;
    }>;
    expect(
      messages.some(
        (message) => message.type === 'run-command' && message.command === command,
      ),
      `clicking ${button} should request ${command}`,
    ).toBe(true);
  }
});
