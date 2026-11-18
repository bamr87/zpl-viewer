import { Page, expect, test } from '@playwright/test';
import { openHarness } from './harness';
import { makeRenderMessage } from '../helpers/messages';

async function postRender(
  page: Page,
  zpl: string,
  overrides: { scale: number },
): Promise<void> {
  await page.evaluate((msg) => {
    window.dispatchEvent(new MessageEvent('message', { data: msg }));
  }, makeRenderMessage(zpl, overrides));
}

const TWO_LABELS = [
  '^XA^PW400^LL200^FO10,10^A0N,30,30^FDFirst^FS^XZ',
  '^XA^PW600^LL300^FO10,10^A0N,30,30^FDSecond^FS^XZ',
].join('\n');

test('toolbar buttons have accessible names and the toolbar is labelled', async ({ page }) => {
  await openHarness(page);
  const toolbar = page.getByRole('toolbar', { name: 'Label preview' });
  await expect(toolbar).toBeVisible();
  for (const name of [
    'Previous label',
    'Next label',
    'Zoom out',
    'Reset zoom',
    'Zoom in',
    'More Label Studio actions',
  ]) {
    await expect(toolbar.getByRole('button', { name })).toHaveCount(1);
  }
});

test('status and page indicator are live regions', async ({ page }) => {
  await openHarness(page);
  await expect(page.locator('#status')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('#page-indicator')).toHaveAttribute('aria-live', 'polite');
});

test('the canvas describes the label showing and updates when it changes', async ({ page }) => {
  await openHarness(page);
  await postRender(page, TWO_LABELS, { scale: 1 });
  const canvas = page.getByRole('img', { name: /^Label 1 of 2, 400 × 200 dots/ });
  await expect(canvas).toBeAttached();
  await page.click('button[data-cmd="next"]');
  await expect(page.getByRole('img', { name: /^Label 2 of 2, 600 × 300 dots/ })).toBeAttached();
});

test('keyboard pages through labels and zooms', async ({ page }) => {
  await openHarness(page);
  await postRender(page, TWO_LABELS, { scale: 1 });
  await expect(page.locator('#page-indicator')).toHaveText('1 / 2');
  await page.keyboard.press('PageDown');
  await expect(page.locator('#page-indicator')).toHaveText('2 / 2');
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.locator('#page-indicator')).toHaveText('1 / 2');
  const before = await page.locator('#label').evaluate((c) => (c as HTMLCanvasElement).width);
  await page.keyboard.press('Control+=');
  const after = await page.locator('#label').evaluate((c) => (c as HTMLCanvasElement).width);
  expect(after).toBeGreaterThan(before);
});

test('buttons show a visible focus ring and a themed border', async ({ page }) => {
  await openHarness(page);
  // :focus-visible only matches keyboard focus, so Tab to the first button.
  await page.keyboard.press('Tab');
  const style = await page.locator('button:focus').evaluate((b) => {
    const s = getComputedStyle(b);
    return { outline: s.outlineStyle, border: s.borderTopStyle };
  });
  expect(style.outline).toBe('solid');
  expect(style.border).toBe('solid');
});
