import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../src/index.js';
import { makeWorld } from '../test-kit/index.js';

function build(opts = {}) {
  const calls = [];
  return makeWorld({
    routes: {
      'GET /ping': async () => {
        calls.push(1);
        return { ok: true };
      },
      'GET /boom': async () => { throw new Error('boom'); },
      'GET /big': async () => ({ statusCode: 200, body: 'x'.repeat(2_000_000) }),
      'GET /star': async () => ({ statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: '{}' }),
      'GET /e502': async () => { throw new HttpError('upstream_unavailable'); },
      'GET /e503': async () => { throw new HttpError('store_unavailable'); },
      'GET /e403': async () => { throw new HttpError('forbidden'); },
      'POST /ping': async () => ({ ok: true }),
    },
    ...opts,
  }).then((w) => Object.assign(w, { handlerCalls: calls }));
}

const OWN = 'jazhou-adobe';
const SITE = 'ew-extensions';
const allowed = [
  'https://da.live',
  `https://main--${SITE}--${OWN}.aem.live`,
  `https://main--${SITE}--${OWN}.aem.page`,
  `https://main--${SITE}--${OWN}.preview.da.live`,
  `https://my-branch--${SITE}--${OWN}.aem.live`,
];
const rejected = [
  'https://evil.example',
  'https://da.live.evil.com',
  'https://notda.live',
  'http://da.live',
  'https://da.live:8443',
  `https://main--${SITE}-demo--${OWN}.aem.live`,
  `https://main--other-site--${OWN}.aem.live`,
  `https://main--${SITE}--other-org.aem.live`,
  `https://main--${SITE}--${OWN}.aem.live.evil.com`,
  `http://main--${SITE}--${OWN}.aem.live`,
  `https://main--${SITE}--${OWN}.aem.live:444`,
  'null',
  '*',
  '',
];

test('UC1: allowed origins are echoed in Access-Control-Allow-Origin', async () => {
  const w = await build();
  for (const origin of allowed) {
    // eslint-disable-next-line no-await-in-loop
    const res = await w.call({ path: '/ping', origin });
    assert.equal(res.statusCode, 200, origin);
    assert.equal(res.headers['access-control-allow-origin'], origin);
  }
});

test('UC2: look-alike and foreign origins are rejected with 403 and no CORS headers', async () => {
  const w = await build();
  for (const origin of rejected) {
    // eslint-disable-next-line no-await-in-loop
    const res = await w.call({ path: '/ping', headers: { origin }, origin: undefined });
    assert.equal(res.statusCode, 403, JSON.stringify(origin));
    assert.equal(res.json().error.code, 'forbidden_origin');
    assert.equal(Object.keys(res.headers).filter((h) => h.startsWith('access-control-')).length, 0);
  }
  assert.equal(w.handlerCalls.length, 0);
});

test('UC3: localhost only through the exact ALLOWED_LOCAL_ORIGINS list', async () => {
  const prod = await build();
  assert.equal((await prod.call({ path: '/ping', origin: 'http://localhost:3000' })).statusCode, 403);
  const stage = await build({ inputs: { ALLOWED_LOCAL_ORIGINS: 'http://localhost:3000, http://localhost:3100' } });
  assert.equal((await stage.call({ path: '/ping', origin: 'http://localhost:3000' })).statusCode, 200);
  assert.equal((await stage.call({ path: '/ping', origin: 'http://localhost:3100' })).statusCode, 200);
  for (const origin of ['http://localhost:3001', 'http://127.0.0.1:3000', 'https://localhost:3000', 'http://localhost:30000', 'http://localhost']) {
    // eslint-disable-next-line no-await-in-loop
    assert.equal((await stage.call({ path: '/ping', origin })).statusCode, 403, origin);
  }
});

test('UC4: preflight from an allowed origin', async () => {
  const w = await build();
  const res = await w.call({
    path: '/ping', method: 'OPTIONS', token: null, origin: 'https://da.live', headers: { 'access-control-request-method': 'GET' },
  });
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['access-control-allow-origin'], 'https://da.live');
  assert.match(res.headers['access-control-allow-headers'], /Authorization/);
  assert.match(res.headers['access-control-allow-headers'], /Content-Type/);
  assert.match(res.headers['access-control-allow-methods'], /GET/);
  assert.match(res.headers['access-control-allow-methods'], /POST/);
  assert.ok(res.headers['access-control-max-age']);
  assert.equal(res.headers.vary, 'Origin');
  assert.equal(res.headers['access-control-allow-credentials'], undefined);
  assert.equal(res.body, '');
});

test('UC5: preflight from a disallowed origin -> 403, no CORS headers at all', async () => {
  const w = await build();
  const res = await w.call({
    path: '/ping', method: 'OPTIONS', token: null, origin: 'https://evil.example',
  });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(Object.keys(res.headers).filter((h) => h.startsWith('access-control-')), []);
  assert.deepEqual(Object.keys(res.json().error).sort(), ['code', 'message', 'requestId']);
});

test('UC6: every status for an allowed origin carries ACAO and is never *', async () => {
  const w = await build();
  const cases = [
    ['/ping', 200, {}], ['/ping', 401, { token: null }], ['/e403', 403, {}], ['/nope', 404, {}],
    ['/ping', 405, { method: 'DELETE' }], ['/boom', 500, {}], ['/e502', 502, {}], ['/e503', 503, {}],
    ['/ping', 413, { method: 'POST', body: 'x'.repeat(600 * 1024) }], ['/big', 500, {}], ['/star', 200, {}],
  ];
  for (const [path, status, extra] of cases) {
    // eslint-disable-next-line no-await-in-loop
    const res = await w.call({ path, ...extra });
    assert.equal(res.statusCode, status, path);
    assert.equal(res.headers['access-control-allow-origin'], 'https://da.live', path);
  }
});

test('UC7: a disallowed origin with a valid token is refused and the handler is not called', async () => {
  const w = await build();
  const res = await w.call({ path: '/ping', origin: 'https://evil.example' });
  assert.equal(res.statusCode, 403);
  assert.equal(w.handlerCalls.length, 0);
  assert.equal(w.ims.keyRequests, 0);
});

test('UC8: no Origin header is not blocked by CORS; auth decides; no ACAO', async () => {
  const w = await build();
  const ok = await w.call({ path: '/ping', origin: null });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.headers['access-control-allow-origin'], undefined);
  assert.equal((await w.call({ path: '/ping', origin: null, token: null })).statusCode, 401);
});

test('UC9: exposed headers and Cache-Control: no-store on every response', async () => {
  const w = await build();
  for (const extra of [{}, { token: null }, { path: '/nope' }]) {
    // eslint-disable-next-line no-await-in-loop
    const res = await w.call({ path: '/ping', ...extra });
    assert.match(res.headers['access-control-expose-headers'], /x-request-id/);
    assert.match(res.headers['access-control-expose-headers'], /Retry-After/);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.headers.vary, 'Origin');
    assert.ok(res.headers['x-request-id']);
  }
});

test('missing ORG/SITE inputs -> 500 misconfigured (never a permissive default)', async () => {
  const w = await build({ inputs: { ORG: '' } });
  const res = await w.call({ path: '/ping' });
  assert.equal(res.statusCode, 500);
  assert.equal(res.json().error.code, 'misconfigured');
});
