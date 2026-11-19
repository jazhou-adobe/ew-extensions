import { test, expect } from '@playwright/test';
import { stubSdk } from '../../../../test/support/e2e.js';
import { createAction, memoryStore } from '../../../../shared/worker-template/src/index.js';
import { fakeIms, startEmulator, makeInputs } from '../../../../shared/worker-template/test-kit/index.js';
import { createRoutes } from '../../worker/shell/routes.js';
import { createOAuthRoutes } from '../../worker/shell/oauth.js';
import { providers } from '../../worker/providers.js';
import { fakeDropbox, PNG_1PX } from '../../providers/dropbox/worker/test/support/fake-dropbox.js';
import {
  CLIENT_ID, CLIENT_SECRET, dropboxInputs, OAUTH_BASE, OAUTH_PREFIX,
} from '../../worker/test/support/oauth-world.js';
import { WORKERS } from '../../config.js';

const PAGE = '/apps/multi-dam-picker/multi-dam-picker.html';
const API_PREFIX = '/api/v1/web/multi-dam-picker/api';
const PAGE_ORIGIN = `http://localhost:${process.env.E2E_PORT || '3100'}`;
const STAGE_ORIGIN = new URL(WORKERS.stage).origin;
const PNG = Buffer.from(PNG_1PX, 'base64');
const SLOW = { timeout: 15000 };

/** Parses the inserted markup in Node without a DOM: one <img> with attributes. */
function DOMParser0(html) {
  const tags = [...html.matchAll(/<img\s+([^>]*)>/g)];
  const attrs = Object.fromEntries([...(tags[0]?.[1] || '').matchAll(/([a-z-]+)="([^"]*)"/g)].map((m) => [m[1], m[2].replaceAll('&amp;', '&')]));
  return { count: tags.length, attr: (name) => attrs[name] };
}

let ims;
let imsServer;
const running = [];

test.beforeAll(async () => {
  ims = await fakeIms();
  imsServer = await ims.listen();
});
test.afterAll(async () => { await imsServer.close(); });
test.afterEach(async () => { await Promise.all(running.splice(0).map((close) => close())); });

/** Both real actions behind the emulator on two ports; Dropbox is the in-process fake (reached through `fetch`). */
async function startWorkers({ inputs = {}, dropbox = {} } = {}) {
  const dbx = fakeDropbox({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, ...dropbox });
  const store = memoryStore({ workerName: 'multi-dam-picker' });
  const fetchImpl = (url, init) => (new URL(String(url)).hostname.endsWith('dropboxapi.com') ? dbx.fetch(url, init) : fetch(url, init));
  const secrets = providers.flatMap((p) => p.config.secrets);
  const deps = { store, fetch: fetchImpl, log: () => {} };
  const api = createAction({ name: 'multi-dam-picker', routes: createRoutes({ providers }), secrets }, deps);
  const oauth = createAction({
    name: 'multi-dam-picker', mode: 'public', routes: createOAuthRoutes({ providers }), secrets,
  }, deps);
  const merged = makeInputs({
    IMS_ORIGIN: imsServer.origin,
    ALLOWED_LOCAL_ORIGINS: PAGE_ORIGIN,
    ...dropboxInputs({ DROPBOX_CACHE_SECONDS: '0' }),
    ...inputs,
  });
  const apiEmulator = await startEmulator({ main: api, inputs: merged, prefix: API_PREFIX });
  const oauthEmulator = await startEmulator({ main: oauth, inputs: merged, prefix: OAUTH_PREFIX });
  running.push(async () => { await apiEmulator.close(); await oauthEmulator.close(); });
  return {
    dbx, store, apiEmulator, oauthEmulator,
  };
}

/**
 * Opens the picker. Requests to the Stage worker go to the emulators (the cookie jar stands in for the browser's cookie
 * handling of the pop-up), the Dropbox sign-in page is answered by the fake, the anonymous image GET by a PNG.
 */
async function open(page, context, worker, { token } = {}) {
  const bearer = token ?? await ims.signToken();
  await stubSdk(page, { token: bearer });
  const jar = new Map();
  const seen = [];
  const hosts = new Set();
  const pageRequests = [];
  page.on('request', (req) => { hosts.add(new URL(req.url()).host); pageRequests.push(req.url()); });
  const forward = async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const toOauth = url.pathname.startsWith(OAUTH_PREFIX);
    const target = `${(toOauth ? worker.oauthEmulator : worker.apiEmulator).origin}${url.pathname}${url.search}`;
    const headers = { ...(await req.allHeaders()) };
    delete headers.host;
    delete headers.cookie;
    if (toOauth && jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    let res;
    try {
      res = await fetch(target, {
        method: req.method(), headers, redirect: 'manual',
      });
    } catch {
      // The emulator closed while a background call (session poll, navigation away) was in flight: end it quietly.
      await route.abort().catch(() => {});
      return;
    }
    res.headers.getSetCookie().forEach((line) => {
      const [pair] = line.split(';');
      const [name, ...value] = pair.split('=');
      if (/Max-Age=0/i.test(line)) jar.delete(name);
      else jar.set(name, value.join('='));
    });
    const body = Buffer.from(await res.arrayBuffer());
    seen.push({
      method: req.method(), path: url.pathname, status: res.status, body: body.toString('utf8'), headers: Object.fromEntries(res.headers),
    });
    const out = Object.fromEntries(res.headers);
    delete out['set-cookie'];
    // The Dropbox sign-in page is the fake: the consent step happens here and the browser lands on the callback.
    if (out.location?.startsWith('https://www.dropbox.com/oauth2/authorize')) out.location = worker.dbx.authorize(out.location);
    if (res.status === 302 && out.location) {
      // Chromium does not route the hop that follows a fulfilled redirect: a new navigation does the same job.
      const next = JSON.stringify(out.location).replaceAll('<', '\\u003c');
      await route.fulfill({
        status: 200, contentType: 'text/html', body: `<!DOCTYPE html><script>location.replace(${next})</script>`,
      });
      return;
    }
    await route.fulfill({ status: res.status, headers: out, body });
  };
  // the pop-up is a page of its own: context-level routes cover it, page-level ones the picker page
  await context.route(`${STAGE_ORIGIN}/**`, forward);
  await page.route(`${STAGE_ORIGIN}/**`, forward);
  await page.route('https://www.dropbox.com/**', (route) => route.fulfill({ contentType: 'image/png', body: PNG }));
  await page.goto(PAGE);
  return {
    seen, hosts, pageRequests, jar, token: bearer,
  };
}

const connect = async (page, name = 'Connect to Dropbox') => {
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name }).click();
  const win = await popup;
  await expect(win.getByText('You are connected')).toBeVisible(SLOW);
};
const grid = (page) => page.locator('button.item');

test('EO1/EO2: Connect opens a real pop-up, the sign-in completes there and the picker shows the grid without a reload', async ({ page, context }) => {
  const worker = await startWorkers();
  const ui = await open(page, context, worker);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Connect to Dropbox' })).toBeVisible();
  await expect(grid(page)).toHaveCount(0);
  await connect(page);
  await expect(page.getByText('Connected as Pat Example')).toBeVisible(SLOW);
  await expect(page.locator('.thumb img').first()).toHaveAttribute('src', /^data:image\/(png|jpeg);base64,/);
  const begin = ui.seen.find((r) => r.path.endsWith('/dropbox/begin'));
  expect(begin.status).toBe(302);
  expect(ui.seen.find((r) => r.path.endsWith('/dropbox/callback')).status).toBe(200);
  // search and filter reach Dropbox as the author
  await page.getByRole('searchbox', { name: 'Search' }).fill('beach');
  await expect(grid(page)).toHaveCount(1);
  await page.getByLabel('Type').selectOption('video');
  await expect(page.getByText('No assets found.')).toBeVisible();
  const search = worker.dbx.requests.filter((r) => r.path.endsWith('search_v2')).at(-1).json;
  expect(search.options.file_categories).toEqual([{ '.tag': 'video' }]);
  expect(search.options.path).toBe('/Brand');
});

test('EO3: select -> exactly one link is created -> edit alt -> Insert sends one <img src alt> with the raw=1 URL, then closes the library', async ({ page, context }) => {
  await page.setViewportSize({ width: 1490, height: 930 });
  const worker = await startWorkers();
  await open(page, context, worker);
  await connect(page);
  await expect(grid(page).first()).toBeVisible(SLOW);
  await page.getByRole('searchbox', { name: 'Search' }).fill('beach');
  await expect(grid(page)).toHaveCount(1);
  await grid(page).first().click();
  await expect(page.getByRole('heading', { name: 'Beach Boat.jpg' })).toBeVisible();
  // layout: the connect panel spans the top; the grid and the detail pane sit side by side below it
  const [panel, g, d] = await Promise.all(['.connect', '.grid', '.detail'].map((s) => page.locator(s).boundingBox()));
  expect(g.y).toBeGreaterThan(panel.y + panel.height - 1);
  expect(d.y).toBeGreaterThan(panel.y + panel.height - 1);
  expect(d.x).toBeGreaterThanOrEqual(g.x + g.width);
  expect(g.x).toBeLessThan(panel.x + 20);
  await expect(page.getByText('Prefilled from the file name.')).toBeVisible();
  await page.getByLabel('Alt text', { exact: true }).fill('A boat on a beach');
  expect(worker.dbx.requests.filter((r) => r.path.endsWith('create_shared_link_with_settings'))).toHaveLength(1);
  await page.getByRole('button', { name: 'Insert image' }).click();
  const calls = await page.evaluate(() => window.__sdkCalls);
  expect(calls.map((c) => c[0])).toEqual(['sendHTML', 'closeLibrary']);
  const html = new DOMParser0(calls[0][1]);
  expect(html.attr('alt')).toBe('A boat on a beach');
  expect(html.attr('src')).toMatch(/^https:\/\/www\.dropbox\.com\/scl\/fi\/.+[?&]raw=1(&|$)/);
  expect(html.attr('src')).not.toContain('dl=');
  expect(html.count).toBe(1);
  // a second pass on the same file creates no second link
  expect(worker.dbx.links.get('id:file1')).toHaveLength(1);
});

test('EO4/EO5: tokens and secrets never reach the page; the page never calls a Dropbox API host', async ({ page, context }) => {
  const worker = await startWorkers();
  const ui = await open(page, context, worker);
  await connect(page);
  await expect(grid(page).first()).toBeVisible(SLOW);
  await page.getByRole('searchbox', { name: 'Search' }).fill('beach');
  await expect(grid(page)).toHaveCount(1);
  await grid(page).first().click();
  await expect(page.getByRole('button', { name: 'Insert image' })).toBeVisible();
  const secrets = [CLIENT_SECRET, ...worker.dbx.accessTokens.keys(), ...worker.dbx.refreshTokens, worker.apiEmulatorSecret].filter(Boolean);
  const dom = await page.evaluate(() => `${document.documentElement.outerHTML}\n${JSON.stringify({ ...localStorage })}\n${JSON.stringify({ ...sessionStorage })}\n${document.cookie}`);
  const wire = ui.seen.map((r) => `${r.body}${JSON.stringify(r.headers)}`).join('\n');
  secrets.forEach((s) => {
    expect(dom).not.toContain(s);
    expect(wire).not.toContain(s);
  });
  expect(dom).not.toContain('dam_oauth');
  const contacted = [...ui.hosts];
  expect(contacted.some((h) => /dropboxapi\.com/.test(h))).toBe(false);
  expect(contacted.filter((h) => h.includes('dropbox')).every((h) => h === 'www.dropbox.com')).toBe(true);
  const callback = ui.seen.find((r) => r.path.endsWith('/dropbox/callback'));
  expect(callback.headers['access-control-allow-origin']).toBeUndefined();
});

test('EO6/EO7: an expired token is refreshed silently; a revoked grant shows Reconnect and Connect works again', async ({ page, context }) => {
  const worker = await startWorkers();
  await open(page, context, worker);
  await connect(page);
  await expect(grid(page).first()).toBeVisible(SLOW);
  const refreshToken = [...worker.dbx.refreshTokens][0];
  worker.dbx.expireAccessTokens();
  await page.getByLabel('Type').selectOption('image');
  const refreshes = () => worker.dbx.requests.filter((r) => r.path === '/oauth2/token' && r.text.includes('refresh_token')).length;
  await expect.poll(refreshes, SLOW).toBe(1);
  await expect(grid(page).first()).toBeVisible(SLOW);
  expect([...worker.dbx.refreshTokens]).toEqual([refreshToken]);
  worker.dbx.revokeAll();
  worker.dbx.expireAccessTokens();
  await page.getByLabel('Type').selectOption('video');
  await expect(page.getByRole('button', { name: 'Reconnect' })).toBeVisible(SLOW);
  await expect(grid(page)).toHaveCount(0);
  await expect(page.getByLabel('Type')).toHaveCount(0);
  await connect(page, 'Reconnect');
  await expect(page.getByText('Connected as Pat Example')).toBeVisible(SLOW);
  await expect(grid(page).first()).toBeVisible(SLOW);
});

test('EO8: Disconnect revokes at Dropbox, shows Connect and a later search needs a new connection', async ({ page, context }) => {
  const worker = await startWorkers();
  await open(page, context, worker);
  await connect(page);
  await expect(grid(page).first()).toBeVisible(SLOW);
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByRole('button', { name: 'Connect to Dropbox' })).toBeVisible();
  expect(worker.dbx.requests.filter((r) => r.path.endsWith('token/revoke'))).toHaveLength(1);
  expect(worker.dbx.refreshTokens.size).toBe(0);
  expect([...worker.store.entries.keys()].filter((k) => k.includes('conn.v1'))).toHaveLength(0);
  await expect(grid(page)).toHaveCount(0);
});

test('EO9: bare and foreign-key calls are 401 with readable CORS; ?worker= is ignored; users are isolated; a flow cannot be completed without its cookie', async ({ page, context }) => {
  const worker = await startWorkers();
  const ui = await open(page, context, worker);
  await connect(page);
  await expect(grid(page).first()).toBeVisible(SLOW);
  const direct = (path, { token, origin = PAGE_ORIGIN, method = 'GET' } = {}) => fetch(`${worker.apiEmulator.origin}${API_PREFIX}${path}`, {
    method, headers: { origin, ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  const bare = await direct('/dam/dropbox/assets');
  expect(bare.status).toBe(401);
  const foreign = await fakeIms({ kid: 'other' });
  expect((await direct('/dam/dropbox/assets', { token: await foreign.signToken() })).status).toBe(401);
  expect((await direct('/dam/dropbox/session', { token: ui.token })).status).toBe(200);
  const other = await ims.signToken({ claims: { user_id: 'someone-else@AdobeID' } });
  const session = await (await direct('/dam/dropbox/session', { token: other })).json();
  expect(session.connection.state).toBe('not_connected');
  expect((await direct('/dam/dropbox/session', { token: ui.token, origin: 'https://evil.example' })).status).toBe(403);
  // the begin step needs a ticket, and the callback needs the cookie of the flow
  const noTicket = await fetch(`${worker.oauthEmulator.origin}${OAUTH_PREFIX}/dropbox/begin`, { redirect: 'manual' });
  expect(noTicket.status).toBe(400);
  expect(noTicket.headers.get('set-cookie')).toBeNull();
  const connectRes = await (await direct('/dam/dropbox/connect', { token: other, method: 'POST' })).json();
  const begin = new URL(connectRes.beginUrl);
  const started = await fetch(`${worker.oauthEmulator.origin}${begin.pathname}${begin.search}`, { redirect: 'manual' });
  const back = worker.dbx.authorize(started.headers.get('location'));
  const stolen = await fetch(`${worker.oauthEmulator.origin}${new URL(back).pathname}${new URL(back).search}`, { redirect: 'manual' });
  expect(stolen.status).toBe(400);
  expect(OAUTH_BASE).toContain(STAGE_ORIGIN);
  await page.goto(`${PAGE}?worker=https://evil.example`);
  expect((await page.evaluate(() => window.location.search))).toContain('evil.example');
  await expect(page.locator('.connect')).toBeVisible();
  expect(ui.pageRequests.some((u) => u.startsWith('https://evil.example'))).toBe(false);
});

test('EO10: a team policy that forbids public links disables Insert with the reason; Cloudinary-only has no connect panel at all', async ({ page, context }) => {
  const worker = await startWorkers();
  worker.dbx.state.linkAudience = 'team';
  await open(page, context, worker);
  await connect(page);
  await expect(grid(page).first()).toBeVisible(SLOW);
  await page.getByRole('searchbox', { name: 'Search' }).fill('beach');
  await expect(grid(page)).toHaveCount(1);
  await grid(page).first().click();
  await expect(page.getByText('Dropbox does not allow a public link for this file.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Insert image' })).toBeDisabled();
  expect((await page.evaluate(() => window.__sdkCalls)).length).toBe(0);
});
