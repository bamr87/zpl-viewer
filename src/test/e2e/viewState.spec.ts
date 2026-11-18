import { expect, test } from '@playwright/test';
import { hostMessages, openHarness, postExport, postRender } from './harness';

/** Two labels of different sizes, so a wrong page shows up as wrong dimensions. */
const TWO_LABELS = [
  '^XA^PW400^LL200^FO10,10^A0N,30,30^FDFirst^FS^XZ',
  '^XA^PW600^LL300^FO10,10^A0N,30,30^FDSecond^FS^XZ',
].join('\n');

interface ViewState {
  type: string;
  page: number;
  scale: number;
}

async function lastViewState(page: import('@playwright/test').Page): Promise<ViewState | undefined> {
  const messages = (await hostMessages(page)) as ViewState[];
  return [...messages].reverse().find((m) => m.type === 'view-state');
}

async function canvasSize(page: import('@playwright/test').Page): Promise<[number, number]> {
  return page
    .locator('#label')
    .evaluate((c) => [(c as HTMLCanvasElement).width, (c as HTMLCanvasElement).height] as [number, number]);
}

test('the preview reports its page and zoom, and keeps them across a re-render', async ({ page }) => {
  await openHarness(page);
  await postRender(page, TWO_LABELS, { scale: 1 });
  await expect(page.locator('#page-indicator')).toHaveText('1 / 2');

  await page.click('button[data-cmd="next"]');
  await page.click('button[data-cmd="zoom-in"]');
  await expect(page.locator('#page-indicator')).toHaveText('2 / 2');
  const before = await canvasSize(page);
  expect(before).toEqual([750, 375]);

  // The host echoes the reported view state on every refresh.
  const reported = await lastViewState(page);
  expect(reported).toEqual({ type: 'view-state', page: 1, scale: 1.25 });

  await postRender(page, TWO_LABELS, { pageIndex: reported?.page, scale: reported?.scale });
  await expect(page.locator('#page-indicator')).toHaveText('2 / 2');
  expect(await canvasSize(page)).toEqual(before);
});

test('a restored page is clamped when the label count shrinks', async ({ page }) => {
  await openHarness(page);
  await postRender(page, TWO_LABELS, { scale: 1 });
  await page.click('button[data-cmd="next"]');
  await expect(page.locator('#page-indicator')).toHaveText('2 / 2');

  await postRender(page, '^XA^PW400^LL200^FDOnly^FS^XZ', { pageIndex: 1, scale: 1 });
  await expect(page.locator('#page-indicator')).toHaveText('1 / 1');
  expect((await lastViewState(page))?.page).toBe(0);
});

test('PNG export renders the requested label, not always the first', async ({ page }) => {
  await openHarness(page);
  await postExport(page, TWO_LABELS, 'png', 'second', 1);
  await expect
    .poll(async () =>
      ((await hostMessages(page)) as Array<{ type?: string; requestId?: string }>).some(
        (m) => m.type === 'export-result' && m.requestId === 'second',
      ),
    )
    .toBe(true);

  const result = ((await hostMessages(page)) as Array<{ type?: string; requestId?: string; data?: number[] }>).find(
    (m) => m.type === 'export-result' && m.requestId === 'second',
  );
  const data = result?.data ?? [];
  // IHDR width and height are big-endian words at byte offsets 16 and 20.
  const word = (at: number): number =>
    ((data[at] << 24) | (data[at + 1] << 16) | (data[at + 2] << 8) | data[at + 3]) >>> 0;
  expect([word(16), word(20)]).toEqual([600, 300]);
});
