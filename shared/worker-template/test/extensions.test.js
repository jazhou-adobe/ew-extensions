import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, canary } from '../test-kit/index.js';
import { HttpError } from '../src/index.js';

const SECRET_KEY = canary('key');
const SECRET_PW = canary('pw');

const routes = {
  'GET /exact': async () => ({ via: 'exact' }),
  'GET /dam/*': async ({ rest }) => ({ via: 'prefix', rest }),
  'GET /dam/deep/*': async ({ rest }) => ({ via: 'deep', rest }),
  'GET /dam/providers': async () => ({ via: 'providers' }),
  'GET /now': async ({ now, annotate }) => {
    annotate({ provider: 'p1' });
    return { now: now() };
  },
  'GET /basic': async ({ proxy }) => {
    const res = await proxy('https://api.test/x', {}, {
      allowedHosts: ['api.test'],
      auth: { scheme: 'basic', usernameSecret: 'V_KEY', secret: 'V_SECRET' },
    });
    return { echoed: res.text() };
  },
  'GET /cfg': async ({ config }) => ({ config }),
};

const make = (extra = {}) => makeWorld({
  routes, secrets: ['V_KEY', 'V_SECRET'], inputs: { V_KEY: SECRET_KEY, V_SECRET: SECRET_PW }, ...extra,
});

test('prefix routes: remainder in ctx.rest, exact and longer prefixes win, 405 on other methods', async () => {
  const w = await make();
  assert.deepEqual((await w.call({ path: '/dam/a/b' })).json(), { via: 'prefix', rest: 'a/b' });
  assert.deepEqual((await w.call({ path: '/dam/providers' })).json(), { via: 'providers' });
  assert.deepEqual((await w.call({ path: '/dam/deep/x' })).json(), { via: 'deep', rest: 'x' });
  assert.equal((await w.call({ path: '/dam' })).statusCode, 404);
  assert.equal((await w.call({ path: '/dam/' })).statusCode, 404);
  assert.equal((await w.call({ path: '/dam/a', method: 'POST' })).statusCode, 405);
  assert.equal((await w.call({ path: '/dam/a', token: null })).statusCode, 401);
  assert.equal((await w.call({ path: '/exact' })).json().via, 'exact');
  const pre = await w.call({ path: '/dam/a', method: 'OPTIONS', token: null });
  assert.match(pre.headers['access-control-allow-methods'], /GET/);
});

test('ctx.now is the injected clock and annotate adds safe fields to the request log line', async () => {
  const w = await make();
  const res = await w.call({ path: '/now' });
  assert.equal(res.json().now, w.clock.now);
  const line = JSON.parse(w.logs.find((l) => l.includes('"event":"request"')));
  assert.equal(line.provider, 'p1');
});

test('a Basic credential composed by the proxy is registered for redaction', async () => {
  const composed = Buffer.from(`${SECRET_KEY}:${SECRET_PW}`).toString('base64');
  const w = await make({ upstream: [{ status: 200, body: `echo ${composed}` }] });
  const res = await w.call({ path: '/basic' });
  assert.equal(res.statusCode, 200);
  assert.ok(!res.body.includes(composed));
  assert.ok(res.body.includes('[redacted]'));
  assert.equal(w.vendor.requests[0].headers.authorization, `Basic ${composed}`);
});

test('numeric and boolean literal inputs reach ctx.config as text', async () => {
  const w = await make({ inputs: { V_KEY: SECRET_KEY, V_SECRET: SECRET_PW, N: 30, B: true } });
  const { config } = (await w.call({ path: '/cfg' })).json();
  assert.equal(config.N, '30');
  assert.equal(config.B, 'true');
});

test('putIf writes only when the key is absent (locks) or present (no resurrection); memory twin honours TTL', async () => {
  const { memoryStore } = await import('../src/store.js');
  const clock = { now: 1000 };
  const store = memoryStore({ workerName: 'w', now: () => clock.now });
  assert.equal(await store.putIf('lock', 'a', { when: 'absent', ttlSeconds: 20 }), true);
  assert.equal(await store.putIf('lock', 'b', { when: 'absent', ttlSeconds: 20 }), false);
  assert.equal(await store.get('lock'), 'a');
  clock.now += 21_000;
  assert.equal(await store.putIf('lock', 'b', { when: 'absent', ttlSeconds: 20 }), true);
  assert.equal(await store.putIf('missing', 1, { when: 'present' }), false);
  assert.equal(await store.get('missing'), undefined);
  await store.put('rec', 1);
  assert.equal(await store.putIf('rec', 2, { when: 'present' }), true);
  assert.equal(await store.get('rec'), 2);
  await assert.rejects(store.putIf('rec', 3, {}), /when/);
});

test('mode public: no IMS token, no origin gate, no CORS headers; handlers get no identity; secrets stay redacted', async () => {
  const world = await makeWorld({
    routes: {
      'GET /x/*': async ({
        identity, rest, addSensitive, optionalSecret, secret,
      }) => {
        addSensitive('runtime-value-123');
        return {
          statusCode: 200,
          headers: { 'content-type': 'text/html', 'set-cookie': 'a=b; HttpOnly', 'access-control-allow-origin': '*' },
          body: `<p>${rest} ${identity === undefined} ${optionalSecret('NOPE')} ${secret('V_KEY')} runtime-value-123</p>`,
        };
      },
    },
    secrets: ['V_KEY'],
    inputs: { V_KEY: SECRET_KEY },
    mode: 'public',
  });
  const res = await world.call({ path: '/x/y', token: null, origin: 'https://evil.example' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['set-cookie'], 'a=b; HttpOnly');
  assert.equal(res.headers['content-type'], 'text/html');
  assert.equal(res.headers['access-control-allow-origin'], undefined);
  assert.ok(res.body.includes('y true undefined [redacted] [redacted]'), res.body);
  assert.equal((await world.call({ path: '/nope', token: null })).statusCode, 404);
  assert.equal((await world.call({ path: '/x/y', token: null, method: 'POST' })).statusCode, 405);
  assert.equal((await world.call({ path: '/x/y', token: null, method: 'OPTIONS' })).statusCode, 405);
});

test('a per-call bearer token is sent and redacted; the new 409 provider error codes exist', async () => {
  const w = await make({ routes: {
    'GET /tok': async ({ proxy }) => {
      const res = await proxy('https://api.test/x', {}, { allowedHosts: ['api.test'], auth: { scheme: 'bearer', token: 'user-token-abc' } });
      return { echoed: res.text() };
    },
    'GET /nc': async () => { throw new HttpError('provider_not_connected'); },
    'GET /ra': async () => { throw new HttpError('provider_reauth_required'); },
  }, upstream: [{ status: 200, body: 'echo user-token-abc' }] });
  const res = await w.call({ path: '/tok' });
  assert.ok(!res.body.includes('user-token-abc'));
  assert.equal(w.vendor.requests[0].headers.authorization, 'Bearer user-token-abc');
  const nc = await w.call({ path: '/nc' });
  assert.deepEqual([nc.statusCode, nc.json().error.code], [409, 'provider_not_connected']);
  const ra = await w.call({ path: '/ra' });
  assert.deepEqual([ra.statusCode, ra.json().error.code], [409, 'provider_reauth_required']);
});
