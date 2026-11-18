import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, canary } from '../test-kit/index.js';

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
