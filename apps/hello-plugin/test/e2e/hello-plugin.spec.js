import { test, expect } from '@playwright/test';
import { stubSdk } from '../../../../test/support/e2e.js';

const PAGE = '/apps/hello-plugin/hello-plugin.html';

test.use({ viewport: { width: 320, height: 640 } });

test('both buttons are visible in a narrow library panel', async ({ page }) => {
  await stubSdk(page, { context: { org: 'acme', repo: 'site' } });
  await page.goto(PAGE);
  await expect(page.getByRole('button', { name: 'Insert text', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Insert text and close' })).toBeVisible();
});

test('insert calls sendText only', async ({ page }) => {
  const sdk = await stubSdk(page);
  await page.goto(PAGE);
  await page.getByRole('button', { name: 'Insert text', exact: true }).click();
  const calls = await sdk.getCalls();
  expect(calls).toHaveLength(1);
  expect(calls[0][0]).toBe('sendText');
  expect(calls[0][1]).toBeTruthy();
});

test('insert and close calls sendText then closeLibrary', async ({ page }) => {
  const sdk = await stubSdk(page);
  await page.goto(PAGE);
  await page.getByRole('button', { name: 'Insert text and close' }).click();
  const calls = await sdk.getCalls();
  expect(calls.map((c) => c[0])).toEqual(['sendText', 'closeLibrary']);
});

test('shows the standalone state when the SDK never resolves', async ({ page }) => {
  await stubSdk(page, { standalone: true });
  await page.goto(PAGE);
  await expect(page.getByText(/not running inside experience workspace/i)).toBeVisible({ timeout: 10000 });
});
