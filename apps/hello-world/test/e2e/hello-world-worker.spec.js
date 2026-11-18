import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { generateKeyPair } from 'jose';
import { routes } from '../../worker/routes/hello.js';
import { stubSdk } from '../../../../test/support/e2e.js';
import { SDK_URL } from '../../../../test/support/sdk-stub.js';
import { createAction, memoryStore } from '../../../../shared/worker-template/src/index.js';
import {
  fakeIms, startEmulator, makeInputs, canary,
} from '../../../../shared/worker-template/test-kit/index.js';
import { WORKERS } from '../../hello-world-worker.js';

const PAGE = '/apps/hello-world/hello-world.html';
const PREFIX = '/api/v1/web/hello-world/api';
const PAGE_ORIGIN = `http://localhost:${process.env.E2E_PORT || '3100'}`;
const SECRET = canary();

test.describe.configure({ mode: 'serial' });

let ims;
let imsServer;
let emulator;
let seen;

test.beforeAll(async () => {
  ims = await fakeIms();
  imsServer = await ims.listen();
  const main = createAction(
    { name: 'hello-world', routes, secrets: ['HELLO_SECRET'] },
    { store: memoryStore({ workerName: 'hello-world' }) },
  );
  emulator = await startEmulator({
    main,
    inputs: makeInputs({ IMS_ORIGIN: imsServer.origin, HELLO_SECRET: SECRET, ALLOWED_LOCAL_ORIGINS: PAGE_ORIGIN }),
    prefix: PREFIX,
  });
});

test.afterAll(async () => {
  await emulator.close();
  await imsServer.close();
});

/** Test seam: requests to the Stage worker URL are forwarded to the local emulator; CORS is still enforced by the browser. */
async function routeStageWorker(page) {
  seen = [];
  await page.route(`${new URL(WORKERS.stage).origin}/**`, async (route) => {
    const req = route.request();
    const target = req.url().replace(new URL(WORKERS.stage).origin, emulator.origin);
    const headers = { ...req.headers() };
    delete headers.host;
    const res = await fetch(target, { method: req.method(), headers });
    const body = Buffer.from(await res.arrayBuffer());
    seen.push({
      method: req.method(), status: res.status, origin: req.headers().origin, body: body.toString('utf8'), acao: res.headers.get('access-control-allow-origin'),
    });
    await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body });
  });
}

test('E2E1: "Call worker" shows the signature computed independently', async ({ page }) => {
  const token = await ims.signToken();
  const sdk = await stubSdk(page, { token });
  await routeStageWorker(page);
  await page.goto(PAGE);
  await page.getByRole('button', { name: 'Call worker' }).click();
  const expected = createHmac('sha256', SECRET).update('hello world').digest('hex');
  await expect(page.getByText(expected)).toBeVisible();
  expect(seen.map((s) => s.status)).toContain(200);
  expect(seen.find((s) => s.status === 200).origin).toBe(PAGE_ORIGIN);
  expect(sdk.external).toEqual([SDK_URL]);
});

test('E2E2: "Call without token" shows 401 and the CORS headers let the page read it', async ({ page }) => {
  await stubSdk(page, { token: await ims.signToken() });
  await routeStageWorker(page);
  await page.goto(PAGE);
  await page.getByRole('button', { name: /Call without token/ }).click();
  await expect(page.getByText(/answered 401 \(unauthorized\)/)).toBeVisible();
  const answer = seen.find((s) => s.status === 401);
  expect(answer.acao).toBe(PAGE_ORIGIN);
});

test('E2E3: neither the token nor the secret appears in the page or any network response', async ({ page }) => {
  const token = await ims.signToken();
  await stubSdk(page, { token });
  await routeStageWorker(page);
  await page.goto(PAGE);
  await page.getByRole('button', { name: 'Call worker' }).click();
  await page.getByRole('button', { name: /Call without token/ }).click();
  await expect(page.getByText(/answered 401/)).toBeVisible();
  const html = await page.content();
  expect(html).not.toContain(token);
  expect(html).not.toContain(SECRET);
  seen.forEach((s) => {
    expect(s.body).not.toContain(token);
    expect(s.body).not.toContain(SECRET);
  });
});

test('E2E4: a token signed by a different key gets 401 through the full browser path; only expected hosts are contacted', async ({ page }) => {
  const other = await generateKeyPair('RS256');
  const forged = await ims.signToken({ key: other.privateKey });
  const sdk = await stubSdk(page, { token: forged });
  await routeStageWorker(page);
  await page.goto(PAGE);
  await page.getByRole('button', { name: 'Call worker' }).click();
  await expect(page.getByText(/answered 401 \(unauthorized\)/)).toBeVisible();
  expect(seen.every((s) => s.status === 401)).toBe(true);
  expect(sdk.external).toEqual([SDK_URL]);
  expect(await page.content()).not.toContain(forged);
});
