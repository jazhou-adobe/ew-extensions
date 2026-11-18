import { test, expect } from '@playwright/test';
import { generateKeyPair } from 'jose';
import { stubSdk } from '../../../../test/support/e2e.js';
import { SDK_URL } from '../../../../test/support/sdk-stub.js';
import { createAction, memoryStore } from '../../../../shared/worker-template/src/index.js';
import { fakeIms, startEmulator, makeInputs } from '../../../../shared/worker-template/test-kit/index.js';
import { createRoutes } from '../../worker/shell/routes.js';
import { providers } from '../../worker/providers.js';
import { fakeCloudinary, loadFixture } from '../../providers/cloudinary/worker/test/support/fake-cloudinary.js';
import {
  cloudInputs, KEY, SECRET, BASIC, ID,
} from '../../worker/test/support/world.js';
import { WORKERS } from '../../config.js';

const PAGE = '/apps/multi-dam-picker/multi-dam-picker.html';
const PREFIX = '/api/v1/web/multi-dam-picker/api';
const PAGE_ORIGIN = `http://localhost:${process.env.E2E_PORT || '3100'}`;
const STAGE_ORIGIN = new URL(WORKERS.stage).origin;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const SAMPLES = loadFixture('search').resources;

let ims;
let imsServer;
const running = [];

test.beforeAll(async () => {
  ims = await fakeIms();
  imsServer = await ims.listen();
});

test.afterAll(async () => {
  await imsServer.close();
});

test.afterEach(async () => {
  await Promise.all(running.splice(0).map((close) => close()));
});

/** The real action behind the emulator, Cloudinary reached over real HTTP (the API host is redirected to the fake). */
async function startWorker({ cloudOptions = {}, inputs = {} } = {}) {
  const cloud = fakeCloudinary({ key: KEY, secret: SECRET, ...cloudOptions });
  const cloudServer = await cloud.listen();
  const rewrite = (url, init) => (String(url).startsWith('https://api.cloudinary.com/')
    ? fetch(String(url).replace('https://api.cloudinary.com', cloudServer.origin), init) : fetch(url, init));
  const main = createAction({
    name: 'multi-dam-picker',
    routes: createRoutes({ providers }),
    secrets: providers.flatMap((p) => p.config.secrets),
  }, { store: memoryStore({ workerName: 'multi-dam-picker' }), fetch: rewrite, log: () => {} });
  const emulator = await startEmulator({
    main,
    inputs: makeInputs({
      IMS_ORIGIN: imsServer.origin, ALLOWED_LOCAL_ORIGINS: PAGE_ORIGIN, ...cloudInputs(), ...inputs,
    }),
    prefix: PREFIX,
  });
  running.push(async () => { await emulator.close(); await cloudServer.close(); });
  return { cloud, emulator };
}

/** Opens the picker: hermetic SDK stub, Stage worker URL forwarded to the emulator, delivery images answered locally. */
async function open(page, worker, { token, query = '' } = {}) {
  const bearer = token ?? await ims.signToken();
  const sdk = await stubSdk(page, { token: bearer });
  const seen = [];
  const delivery = [];
  const hosts = new Set();
  page.on('request', (req) => hosts.add(new URL(req.url()).host));
  await page.route('https://res.cloudinary.com/**', (route) => {
    delivery.push(route.request().url());
    return route.fulfill({ contentType: 'image/png', body: PNG });
  });
  await page.route(`${STAGE_ORIGIN}/**`, async (route) => {
    const req = route.request();
    const target = req.url().replace(STAGE_ORIGIN, worker.emulator.origin);
    const headers = { ...req.headers() };
    delete headers.host;
    const res = await fetch(target, { method: req.method(), headers });
    const body = Buffer.from(await res.arrayBuffer());
    seen.push({
      method: req.method(), url: req.url(), status: res.status, body: body.toString('utf8'), headers: Object.fromEntries(res.headers),
    });
    await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body });
  });
  await page.goto(`${PAGE}${query}`);
  return {
    sdk, seen, delivery, hosts, token: bearer,
  };
}

const grid = (page) => page.locator('button.item');
const withWords = (n) => Array.from({ length: n }, (_, i) => ({
  ...SAMPLES[0],
  asset_id: ID(i + 1),
  public_id: `samples/landscapes/photo-${i}`,
  display_name: `photo-${i}`,
  secure_url: `https://res.cloudinary.com/yifoe45l/image/upload/v1/samples/landscapes/photo-${i}.jpg`,
}));

test('E2E1: the grid loads with no connect prompt; the fake saw the default expression, max_results and the Basic header', async ({ page }) => {
  const worker = await startWorker();
  await open(page, worker);
  await expect(grid(page).first()).toBeVisible();
  await expect(page.getByText(/connect/i)).toHaveCount(0);
  const [req] = worker.cloud.requests;
  expect(req.json.expression).toBe('type=upload AND (asset_folder=samples OR asset_folder:samples/*)');
  expect(req.json.max_results).toBe(24);
  expect(req.headers.authorization).toBe(BASIC);
  expect(req.json.sort_by).toBeUndefined();
});

test('E2E2: search, type filter and "Load more" (appends, stops at hasMore:false)', async ({ page }) => {
  const worker = await startWorker({ cloudOptions: { resources: withWords(60) } });
  await open(page, worker);
  await expect(grid(page)).toHaveCount(24);
  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(grid(page)).toHaveCount(48);
  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(grid(page)).toHaveCount(60);
  await expect(page.getByRole('button', { name: 'Load more' })).toBeHidden();
  const before = worker.cloud.calls;
  await page.getByRole('searchbox', { name: 'Search' }).fill('photo-7');
  await expect(grid(page)).toHaveCount(1);
  await page.getByLabel('Type').selectOption('video');
  await expect(page.getByText('No assets found.')).toBeVisible();
  const last = worker.cloud.requests.at(-1).json.expression;
  expect(last).toContain('("photo-7")');
  expect(last).toContain('resource_type=video AND NOT (format=mp3');
  expect(worker.cloud.calls).toBeGreaterThan(before);
});

test('E2E3: select, change rendition, edit alt, Insert: one <img src alt> via sendHTML, then closeLibrary', async ({ page }) => {
  const worker = await startWorker();
  const ui = await open(page, worker);
  await page.getByRole('button', { name: /beach-boat/ }).click();
  await expect(page.getByRole('heading', { name: 'beach-boat' })).toBeFocused();
  await page.getByLabel('Rendition').selectOption('small');
  await page.getByLabel('Alt text', { exact: true }).fill('A boat, edited');
  await page.getByRole('button', { name: 'Insert image' }).click();
  const calls = await ui.sdk.getCalls();
  expect(calls.map((c) => c[0])).toEqual(['sendHTML', 'closeLibrary']);
  const html = calls[0][1];
  expect(html).toBe('<img src="https://res.cloudinary.com/yifoe45l/image/upload/c_limit,w_400/f_auto/q_auto/v1700000011/samples/landscapes/beach-boat.jpg" alt="A boat, edited">');
});

test('E2E4: the key, the secret and the Basic value appear nowhere in the browser; the page never calls the Cloudinary API host', async ({ page }) => {
  const worker = await startWorker();
  const ui = await open(page, worker);
  await page.getByRole('button', { name: /beach-boat/ }).click();
  await expect(page.getByLabel('Alt text', { exact: true })).toBeVisible();
  const html = await page.content();
  const storage = await page.evaluate(() => JSON.stringify([localStorage, sessionStorage, document.cookie]));
  const bodies = ui.seen.map((s) => s.body + JSON.stringify(s.headers)).join('\n');
  [KEY, SECRET, BASIC, Buffer.from(`${KEY}:${SECRET}`).toString('base64')].forEach((secret) => {
    expect(html).not.toContain(secret);
    expect(storage).not.toContain(secret);
    expect(bodies).not.toContain(secret);
  });
  expect(html).not.toContain(ui.token);
  expect([...ui.hosts]).not.toContain('api.cloudinary.com');
});

test('E2E5: a Cloudinary 420 shows the rate-limit message and waits; no reconnect prompt', async ({ page }) => {
  const worker = await startWorker({
    cloudOptions: { script: [{ status: 420, headers: { 'content-type': 'application/json', 'x-featureratelimit-reset': new Date(Date.now() + 120_000).toUTCString() }, body: '{}' }] },
  });
  await open(page, worker);
  await expect(page.getByRole('status').first()).toContainText(/limiting requests/);
  await expect(page.getByRole('searchbox', { name: 'Search' })).toBeDisabled();
  await expect(page.getByText(/reconnect/i)).toHaveCount(0);
});

test('E2E6: unauthenticated and foreign-key calls get a readable 401; ?worker= is ignored', async ({ page }) => {
  const worker = await startWorker();
  const other = await generateKeyPair('RS256');
  const forged = await ims.signToken({ key: other.privateKey });
  const ui = await open(page, worker, { query: '?worker=https://evil.example' });
  await expect(grid(page).first()).toBeVisible();
  expect(ui.seen.every((s) => s.url.startsWith(STAGE_ORIGIN))).toBe(true);
  const direct = await page.evaluate(async ({ base, forgedToken }) => {
    const bare = await fetch(`${base}/dam/cloudinary/assets`);
    const wrong = await fetch(`${base}/dam/cloudinary/assets`, { headers: { authorization: `Bearer ${forgedToken}` } });
    return [bare.status, (await bare.json()).error.code, wrong.status];
  }, { base: WORKERS.stage, forgedToken: forged });
  expect(direct).toEqual([401, 'unauthorized', 401]);
});

test('E2E7: a PDF and an MP3 insert one <a href> with the asset name; an access-controlled asset cannot be inserted', async ({ page }) => {
  const worker = await startWorker();
  const ui = await open(page, worker);
  await page.getByRole('button', { name: /annual report 2025/ }).click();
  await page.getByRole('button', { name: 'Insert link' }).click();
  const first = (await ui.sdk.getCalls())[0][1];
  expect(first).toMatch(/^<a href="https:\/\/res\.cloudinary\.com\/yifoe45l\/image\/upload\/v1700000015\/samples\/docs\/annual%20report%202025\.pdf">annual report 2025<\/a>$/);
  await page.reload();
  await page.getByRole('button', { name: /podcast-intro/ }).click();
  await page.getByRole('button', { name: 'Insert link' }).click();
  const mp3 = (await ui.sdk.getCalls()).find((c) => c[0] === 'sendHTML')[1];
  expect(mp3).toContain('>podcast-intro</a>');
  await page.reload();
  await page.getByRole('button', { name: /premium-view/ }).click();
  await expect(page.getByRole('button', { name: 'Insert image' })).toBeDisabled();
  await expect(page.getByText('Access-restricted in Cloudinary.').first()).toBeVisible();
});

test('E2E8: signing on -> every thumbnail request and the inserted src carry s--...--; signing off -> none', async ({ page, browser }) => {
  const on = await startWorker({ inputs: { CLOUDINARY_SIGN_URLS: 'true' } });
  const ui = await open(page, on);
  await expect(grid(page).first()).toBeVisible();
  await expect.poll(() => ui.delivery.length).toBeGreaterThan(0);
  ui.delivery.forEach((url) => expect(url).toMatch(/\/upload\/s--[A-Za-z0-9_-]{8}--\//));
  await page.getByRole('button', { name: /beach-boat/ }).click();
  await page.getByRole('button', { name: 'Insert image' }).click();
  const html = (await ui.sdk.getCalls())[0][1];
  expect(html).toMatch(/src="https:\/\/res\.cloudinary\.com\/yifoe45l\/image\/upload\/s--[A-Za-z0-9_-]{8}--\/c_limit,w_1200\/f_auto\/q_auto\/samples\/landscapes\/beach-boat\.jpg"/);
  const off = await startWorker();
  const page2 = await (await browser.newContext()).newPage();
  const ui2 = await open(page2, off);
  await expect(grid(page2).first()).toBeVisible();
  await expect.poll(() => ui2.delivery.length).toBeGreaterThan(0);
  ui2.delivery.forEach((url) => expect(url).not.toContain('s--'));
});

test('E2E9: ten rapid keystrokes produce one search; an identical search within the TTL hits the cache; the early stop shows the rate-limit message without a request', async ({ page, browser }) => {
  const worker = await startWorker({ inputs: { CLOUDINARY_CACHE_SECONDS: '60' } });
  await open(page, worker);
  await expect(grid(page).first()).toBeVisible();
  const box = page.getByRole('searchbox', { name: 'Search' });
  const base = worker.cloud.calls;
  await box.pressSequentially('beach-boat', { delay: 40 });
  await expect(grid(page)).toHaveCount(1);
  expect(worker.cloud.calls - base).toBe(1);
  await box.fill('');
  await expect(grid(page).first()).toBeVisible();
  const afterClear = worker.cloud.calls;
  await box.fill('beach-boat');
  await expect(grid(page)).toHaveCount(1);
  expect(worker.cloud.calls).toBe(afterClear);

  const low = await startWorker({ cloudOptions: { rateLimit: { remaining: 21, resetAt: Date.now() + 300_000 } } });
  const page2 = await (await browser.newContext()).newPage();
  await open(page2, low);
  await expect(page2.locator('button.item').first()).toBeVisible();
  const { calls } = low.cloud;
  await page2.getByRole('searchbox', { name: 'Search' }).fill('anything');
  await expect(page2.getByRole('status').first()).toContainText(/limiting requests/);
  expect(low.cloud.calls).toBe(calls);
});

test('E2E10: the browser contacts only the page, the worker, the SDK stub and the delivery host', async ({ page }) => {
  const worker = await startWorker();
  const ui = await open(page, worker);
  await expect(grid(page).first()).toBeVisible();
  await page.getByRole('button', { name: /beach-boat/ }).click();
  await expect(page.getByLabel('Alt text', { exact: true })).toBeVisible();
  const allowed = new Set([new URL(PAGE_ORIGIN).host, new URL(STAGE_ORIGIN).host, new URL(SDK_URL).host, 'res.cloudinary.com']);
  expect([...ui.hosts].filter((h) => !allowed.has(h))).toEqual([]);
  expect(ui.sdk.external).toEqual([SDK_URL]);
});
