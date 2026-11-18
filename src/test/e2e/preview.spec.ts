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

test('preview renders under the shipped CSP, which forbids eval', async ({ page }) => {
  // Collect violations from before the first script runs.
  await page.addInitScript(() => {
    const w = window as unknown as { __cspViolations: string[] };
    w.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      w.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  await openHarness(page);

  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(csp).toContain("script-src 'nonce-");
  expect(csp).not.toContain('unsafe-eval');

  await postRender(page, readFixture('shipping.zpl'));
  await expect
    .poll(async () => page.locator('#label').evaluate((c) => (c as HTMLCanvasElement).width))
    .toBeGreaterThan(10);

  // Nothing the bundle does may violate the policy.
  const loadViolations = await page.evaluate(
    () => (window as unknown as { __cspViolations: string[] }).__cspViolations.slice(),
  );
  expect(loadViolations).toEqual([]);

  // And the policy is live, not decorative: a script without the nonce —
  // what injected markup would carry — never runs.
  const injectedRan = await page.evaluate(async () => {
    const s = document.createElement('script');
    s.textContent = '(window).__injected = true;';
    document.body.appendChild(s);
    await new Promise((r) => setTimeout(r, 50));
    return (window as unknown as { __injected?: boolean }).__injected === true;
  });
  expect(injectedRan).toBe(false);
  const violations = await page.evaluate(
    () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
  );
  expect(violations.some((v) => v.startsWith('script-src'))).toBe(true);
});
