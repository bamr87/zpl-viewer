import { expect, test } from '@playwright/test';
import { hostMessages, openHarness, postExport, readFixture } from './harness';

test('webview emits PNG and PDF export results', async ({ page }) => {
  await openHarness(page);
  const zpl = readFixture('hello.zpl');

  await postExport(page, zpl, 'png', 'req-png');
  await expect
    .poll(async () => {
      const messages = (await hostMessages(page)) as Array<{ type?: string; requestId?: string }>;
      return messages.some((m) => m.type === 'export-result' && m.requestId === 'req-png');
    })
    .toBe(true);

  const pngMessage = (
    (await hostMessages(page)) as Array<{ type?: string; requestId?: string; data?: number[] }>
  ).find((m) => m.type === 'export-result' && m.requestId === 'req-png');
  expect(pngMessage?.data?.slice(0, 4)).toEqual([137, 80, 78, 71]);

  await postExport(page, zpl, 'pdf', 'req-pdf');
  await expect
    .poll(async () => {
      const messages = (await hostMessages(page)) as Array<{ type?: string; requestId?: string }>;
      return messages.some((m) => m.type === 'export-result' && m.requestId === 'req-pdf');
    })
    .toBe(true);

  const pdfMessage = (
    (await hostMessages(page)) as Array<{ type?: string; requestId?: string; data?: number[] }>
  ).find((m) => m.type === 'export-result' && m.requestId === 'req-pdf');
  expect(String.fromCharCode(...(pdfMessage?.data?.slice(0, 4) ?? []))).toBe('%PDF');
});
