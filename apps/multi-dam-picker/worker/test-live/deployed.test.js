// Opt-in live tier (LV1-LV6): the deployed picker worker. Not run in CI.
//   WORKER_BASE_URL=<worker url> WORKER_ENV=stage IMS_TOKEN=<token from DevTools on da.live> npm run test:picker:live
// CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET (from the environment or the worker's untracked .env) are only used for
// the leak scan; the check prints pass or fail, never a value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setting, skipUnless } from './env.js';

const base = () => setting('WORKER_BASE_URL').replace(/\/+$/, '');
const call = (path, {
  token, origin, method = 'GET', headers = {},
} = {}) => fetch(`${base()}${path}`, {
  method,
  headers: {
    ...(origin ? { origin } : {}),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...headers,
  },
});
const seen = [];
const record = async (res) => {
  seen.push(JSON.stringify([...res.headers]), await res.clone().text());
  return res;
};
const live = skipUnless('WORKER_BASE_URL', 'IMS_TOKEN');

test('LV1: bare GET /dam/providers and /dam/cloudinary/assets -> 401 with the documented error JSON', { skip: skipUnless('WORKER_BASE_URL') }, async () => {
  for (const path of ['/dam/providers', '/dam/cloudinary/assets']) {
    const res = await record(await call(path));
    assert.equal(res.status, 401, path);
    const { error } = await res.json();
    assert.equal(error.code, 'unauthorized');
    assert.deepEqual(Object.keys(error).sort(), ['code', 'message', 'requestId']);
  }
});

test('LV2: real token and Origin https://da.live -> cloudinary is connected; an empty search returns items from the root only', { skip: live }, async () => {
  const providers = await record(await call('/dam/providers', { token: setting('IMS_TOKEN'), origin: 'https://da.live' }));
  assert.equal(providers.status, 200);
  const list = (await providers.json()).providers;
  assert.equal(list.find((p) => p.id === 'cloudinary')?.connection.state, 'connected');
  const search = await record(await call('/dam/cloudinary/assets?pageSize=50', { token: setting('IMS_TOKEN'), origin: 'https://da.live' }));
  assert.equal(search.status, 200);
  const { items } = await search.json();
  assert.ok(Array.isArray(items));
  assert.ok(items.every((i) => typeof i.id === 'string' && /^[0-9a-f]{32}$/.test(i.id)));
});

test('LV3: a disallowed origin with the real token -> 403 and no Access-Control-Allow-Origin at all', { skip: live }, async () => {
  const res = await record(await call('/dam/providers', { token: setting('IMS_TOKEN'), origin: 'https://evil.example' }));
  assert.equal(res.status, 403);
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});

test('LV4: preflight from https://da.live -> 204 with the origin echoed; the demo site origin -> 403', { skip: skipUnless('WORKER_BASE_URL') }, async () => {
  const headers = { 'access-control-request-headers': 'authorization', 'access-control-request-method': 'GET' };
  const ok = await record(await call('/dam/cloudinary/assets', { method: 'OPTIONS', origin: 'https://da.live', headers }));
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://da.live');
  const demo = await record(await call('/dam/cloudinary/assets', { method: 'OPTIONS', origin: 'https://main--ew-extensions-demo--jazhou-adobe.aem.live', headers }));
  assert.equal(demo.status, 403);
});

test('LV5: preflight from http://localhost:3000 -> 204 on Stage, 403 on Production', { skip: skipUnless('WORKER_BASE_URL', 'WORKER_ENV') }, async () => {
  const res = await record(await call('/dam/cloudinary/assets', { method: 'OPTIONS', origin: 'http://localhost:3000' }));
  assert.equal(res.status, setting('WORKER_ENV') === 'production' ? 403 : 204);
});

test('LV6: the Cloudinary key and secret appear nowhere in any response of this run', { skip: skipUnless('CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET') }, () => {
  const text = seen.join('\n');
  assert.ok(seen.length > 0, 'run together with LV1-LV5');
  assert.equal(text.includes(setting('CLOUDINARY_API_KEY')), false);
  assert.equal(text.includes(setting('CLOUDINARY_API_SECRET')), false);
});
