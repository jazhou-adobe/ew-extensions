// Opt-in live tier (A3): the same core assertions against a deployed worker. Not run in CI.
//   npm run test:worker:deployed      (needs WORKER_BASE_URL and IMS_TOKEN)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { setting, skipUnless } from './env.js';

const base = () => setting('WORKER_BASE_URL').replace(/\/+$/, '');
const SIGN = '/hello/sign?message=live-check';
const get = (path, {
  token, origin, method = 'GET', headers = {},
} = {}) => fetch(`${base()}${path}`, {
  method,
  headers: {
    ...(origin ? { origin } : {}),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...headers,
  },
});

test('LV1: a bare request -> 401 with the documented error JSON', { skip: skipUnless('WORKER_BASE_URL') }, async () => {
  const res = await get(SIGN);
  assert.equal(res.status, 401);
  const { error } = await res.json();
  assert.equal(error.code, 'unauthorized');
  assert.deepEqual(Object.keys(error).sort(), ['code', 'message', 'requestId']);
});

test('LV2: a real token from da.live -> 200 and a signature', { skip: skipUnless('WORKER_BASE_URL', 'IMS_TOKEN') }, async () => {
  const res = await get(SIGN, { token: setting('IMS_TOKEN'), origin: 'https://da.live' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.algorithm, 'HMAC-SHA-256');
  assert.match(body.signature, /^[0-9a-f]{64}$/);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://da.live');
  if (setting('HELLO_SECRET_CHECK')) {
    assert.equal(body.signature, createHmac('sha256', setting('HELLO_SECRET_CHECK')).update('live-check').digest('hex'));
  }
});

test('LV3: a disallowed origin with the real token -> 403 and no Access-Control-Allow-Origin at all', { skip: skipUnless('WORKER_BASE_URL', 'IMS_TOKEN') }, async () => {
  const res = await get(SIGN, { token: setting('IMS_TOKEN'), origin: 'https://evil.example' });
  assert.equal(res.status, 403);
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});

test('LV4: preflight from https://da.live -> 204 with the origin echoed', { skip: skipUnless('WORKER_BASE_URL') }, async () => {
  const res = await get('/hello/sign', {
    method: 'OPTIONS', origin: 'https://da.live', headers: { 'access-control-request-headers': 'authorization', 'access-control-request-method': 'GET' },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://da.live');
  assert.notEqual(res.headers.get('access-control-allow-origin'), '*');
});

test('LV5: preflight from http://localhost:3000 -> 204 on Stage, 403 on Production', { skip: skipUnless('WORKER_BASE_URL', 'WORKER_ENV') }, async () => {
  const res = await get('/hello/sign', { method: 'OPTIONS', origin: 'http://localhost:3000' });
  assert.equal(res.status, setting('WORKER_ENV') === 'production' ? 403 : 204);
});

test('LV6: /hello/state with the token -> 200 {ok: true} (State works with real credentials)', { skip: skipUnless('WORKER_BASE_URL', 'IMS_TOKEN') }, async () => {
  const res = await get('/hello/state', { token: setting('IMS_TOKEN'), origin: 'https://da.live' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});
