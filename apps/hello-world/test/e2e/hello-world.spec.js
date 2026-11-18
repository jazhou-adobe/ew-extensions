import { test, expect } from '@playwright/test';
import { stubSdk } from '../../../../test/support/e2e.js';

const PAGE = '/apps/hello-world/hello-world.html';

test('renders the stubbed SDK context as text and never the token', async ({ page }) => {
  const sdk = await stubSdk(page, {
    context: {
      view: 'fullscreen', org: 'acme', repo: 'site', ref: 'main', note: '<b>bold</b>',
    },
    token: 'secret-token-123',
  });
  await page.goto(PAGE);
  await expect(page.getByText('acme', { exact: true })).toBeVisible();
  await expect(page.getByText('<b>bold</b>')).toBeVisible();
  await expect(page.getByText(/token present/i)).toBeVisible();
  expect(await page.content()).not.toContain('secret-token-123');
  expect(sdk.external).toEqual(['https://da.live/nx/utils/sdk.js']);
});

test('shows the standalone state when the SDK never resolves', async ({ page }) => {
  await stubSdk(page, { standalone: true });
  await page.goto(PAGE);
  await expect(page.getByText(/waiting for experience workspace/i)).toBeVisible();
  await expect(page.getByText(/not running inside experience workspace/i)).toBeVisible({ timeout: 10000 });
});
