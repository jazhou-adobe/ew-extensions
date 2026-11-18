import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createAction, memoryStore } from '../src/index.js';
import {
  fakeIms, startEmulator, makeInputs, canary,
} from '../test-kit/index.js';

const SECRET = canary();
const received = [];
let upstreamHits = 0;
let upstream;
let ims;
let imsServer;
let emulator;
let platformEmulator;

before(async () => {
  upstream = createServer((req, res) => {
    upstreamHits += 1;
    received.push(req.headers);
    if (upstreamHits === 1) {
      res.writeHead(429, { 'retry-after': '0' });
      res.end('slow down');
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ upstream: 'ok' }));
    }
  });
  await new Promise((resolve) => {
    upstream.listen(0, '127.0.0.1', resolve);
  });
  const upstreamPort = upstream.address().port;
  ims = await fakeIms();
  imsServer = await ims.listen();
  const routes = {
    'GET /v': async ({ proxy }) => {
      const res = await proxy(`http://127.0.0.1:${upstreamPort}/thing`, { headers: { authorization: 'Bearer callers' } }, {
        allowedHosts: ['127.0.0.1'],
        auth: { secret: 'VENDOR_KEY', scheme: 'header', name: 'x-api-key' },
        retry: { baseMs: 1, capMs: 5 },
      });
      return res.json();
    },
    'GET /huge': async () => ({ statusCode: 200, body: 'x'.repeat(1_200_000) }),
    'POST /echo-size': async ({ request }) => ({ size: request.bytes().length }),
  };
  const inputs = makeInputs({ IMS_ORIGIN: imsServer.origin, VENDOR_KEY: SECRET, ALLOWED_LOCAL_ORIGINS: 'http://localhost:3100' });
  const main = createAction({ name: 'fixture', routes, secrets: ['VENDOR_KEY'] }, { store: memoryStore() });
  emulator = await startEmulator({ main, inputs });
  // Same action without the template's result cap, to see the platform's own result limit.
  platformEmulator = await startEmulator({
    main: async (p) => ({ ...(await main(p)), body: 'x'.repeat(1_200_000) }),
    inputs,
  });
});

after(async () => {
  await emulator.close();
  await platformEmulator.close();
  await imsServer.close();
  await new Promise((resolve) => {
    upstream.close(resolve);
    upstream.closeAllConnections();
  });
});

const get = async (path, {
  token, origin = 'https://da.live', method = 'GET', body,
} = {}) => {
  const headers = { ...(origin ? { origin } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const res = await fetch(`${emulator.origin}${path}`, { method, headers, body });
  return { status: res.status, headers: res.headers, text: await res.text() };
};

test('EM1: a bare request over real HTTP gets 401 (the deployed-liveness signal)', async () => {
  const res = await get('/v');
  assert.equal(res.status, 401);
  assert.equal(JSON.parse(res.text).error.code, 'unauthorized');
});

test('EM3: proxy retries 429 with real timers; upstream sees the injected secret and no inbound Authorization', async () => {
  upstreamHits = 0;
  received.length = 0;
  const res = await get('/v', { token: await ims.signToken() });
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.text), { upstream: 'ok' });
  assert.equal(upstreamHits, 2);
  received.forEach((h) => {
    assert.equal(h['x-api-key'], SECRET);
    assert.equal(h.authorization, undefined);
  });
});

test('preflight over real HTTP: allowed and disallowed origins; local origin only when configured', async () => {
  const ok = await get('/v', { method: 'OPTIONS', origin: 'https://da.live' });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://da.live');
  const local = await get('/v', { method: 'OPTIONS', origin: 'http://localhost:3100' });
  assert.equal(local.status, 204);
  const bad = await get('/v', { method: 'OPTIONS', origin: 'https://evil.example' });
  assert.equal(bad.status, 403);
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
});

test('EM4: the canary secret is absent from all responses over real HTTP', async () => {
  const token = await ims.signToken();
  const responses = await Promise.all([
    get('/v', { token }), get('/v'), get('/nope', { token }), get('/v', { token, origin: 'https://evil.example' }),
  ]);
  responses.forEach((r) => {
    assert.ok(!r.text.includes(SECRET));
    assert.ok(![...r.headers.values()].some((v) => v.includes(SECRET)));
  });
});

test('EM5: platform limits answer without CORS headers; the template caps trigger first for realistic sizes', async () => {
  const token = await ims.signToken();
  const tooBigForPlatform = await get('/echo-size', { token, method: 'POST', body: 'x'.repeat(1_100_000) }).catch((e) => ({ error: e }));
  if (tooBigForPlatform.error) {
    assert.ok(tooBigForPlatform.error, 'connection reset by the platform-style limit');
  } else {
    assert.equal(tooBigForPlatform.status, 413);
    assert.equal(tooBigForPlatform.headers.get('access-control-allow-origin'), null);
  }
  const mine = await get('/echo-size', { token, method: 'POST', body: 'x'.repeat(600 * 1024) });
  assert.equal(mine.status, 413);
  assert.equal(JSON.parse(mine.text).error.code, 'payload_too_large');
  assert.equal(mine.headers.get('access-control-allow-origin'), 'https://da.live');
  const huge = await get('/huge', { token });
  assert.equal(huge.status, 500);
  assert.equal(JSON.parse(huge.text).error.code, 'internal');
  const platform = await fetch(`${platformEmulator.origin}/huge`, { headers: { origin: 'https://da.live', authorization: `Bearer ${token}` } });
  assert.equal(platform.status, 502);
  assert.equal(platform.headers.get('access-control-allow-origin'), null);
});
