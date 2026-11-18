import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError, REDACTED } from '../src/index.js';
import { makeWorld, canary } from '../test-kit/index.js';

const SECRET = canary();

function routes() {
  return {
    'GET /ok': async ({ secret }) => ({ ok: true, len: secret('HELLO_SECRET').length }),
    'GET /leak-throw': async ({ secret }) => { throw new Error(`failed with ${secret('HELLO_SECRET')}`); },
    'GET /leak-return': async ({ secret }) => ({ debug: `key=${secret('HELLO_SECRET')}` }),
    'GET /leak-params': async ({ secret, config }) => ({ cfg: config, s: secret('HELLO_SECRET') }),
    'GET /leak-header': async ({ secret }) => ({ statusCode: 200, headers: { 'x-debug': secret('HELLO_SECRET') }, body: {} }),
    'GET /missing': async ({ secret }) => ({ v: secret('NOT_SET') }),
    'GET /upstream-echo': async ({ proxy }) => proxy('https://vendor.test/x', {}, { allowedHosts: ['vendor.test'], auth: { secret: 'HELLO_SECRET', scheme: 'bearer' } }),
    'GET /upstream-error': async ({ proxy }) => {
      const res = await proxy('https://vendor.test/x', {}, { allowedHosts: ['vendor.test'], auth: { secret: 'HELLO_SECRET', scheme: 'bearer' } });
      throw new Error(res.text());
    },
    'GET /http-error': async () => { throw new HttpError('forbidden'); },
  };
}

test('US1: the canary secret never appears in any response or log line, on any path', async () => {
  const w = await makeWorld({
    routes: routes(),
    secrets: ['HELLO_SECRET'],
    inputs: { HELLO_SECRET: SECRET },
    upstream: [{ status: 400, body: JSON.stringify({ error: `bad key ${SECRET}` }) }],
  });
  const results = [];
  for (const path of ['/ok', '/leak-throw', '/leak-return', '/leak-params', '/leak-header', '/missing', '/upstream-echo', '/upstream-error', '/http-error', '/nope']) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await w.call({ path }), await w.call({ path, token: null }), await w.call({ path, origin: 'https://evil.example' }));
  }
  const dump = JSON.stringify(results) + w.logs.join('\n');
  assert.ok(!dump.includes(SECRET), 'canary leaked');
  assert.ok(dump.includes(REDACTED), 'the redaction path was exercised');
});

test('US2: a missing or empty secret -> 500 misconfigured, name logged, never a value', async () => {
  const w = await makeWorld({ routes: routes(), secrets: ['HELLO_SECRET', 'NOT_SET'], inputs: { HELLO_SECRET: '' } });
  for (const path of ['/ok', '/missing']) {
    // eslint-disable-next-line no-await-in-loop
    const res = await w.call({ path });
    assert.equal(res.statusCode, 500);
    assert.equal(res.json().error.code, 'misconfigured');
  }
  assert.ok(w.logs.some((l) => JSON.parse(l).event === 'missing_secret' && JSON.parse(l).name === 'HELLO_SECRET'));
});

test('US3: raw params or secrets inside a thrown/returned object are redacted', async () => {
  const w = await makeWorld({ routes: routes(), secrets: ['HELLO_SECRET'], inputs: { HELLO_SECRET: SECRET } });
  const res = await w.call({ path: '/leak-return' });
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes(REDACTED));
  assert.ok(!res.body.includes(SECRET));
  const hdr = await w.call({ path: '/leak-header' });
  assert.equal(hdr.headers['x-debug'], REDACTED);
});

test('US4: every error has the documented shape, no-store and x-request-id; unknown throws are generic', async () => {
  const w = await makeWorld({ routes: routes(), secrets: ['HELLO_SECRET'], inputs: { HELLO_SECRET: SECRET } });
  const codes = new Map();
  for (const call of [{ path: '/nope' }, { path: '/ok', token: null }, { path: '/http-error' }, { path: '/leak-throw' }, { path: '/ok', origin: 'https://evil.example' }]) {
    // eslint-disable-next-line no-await-in-loop
    const res = await w.call(call);
    const { error } = res.json();
    assert.deepEqual(Object.keys(error).sort(), ['code', 'message', 'requestId']);
    assert.equal(error.requestId, res.headers['x-request-id']);
    assert.equal(res.headers['cache-control'], 'no-store');
    codes.set(error.code, res.statusCode);
  }
  assert.deepEqual([...codes.entries()].sort(), [['forbidden', 403], ['forbidden_origin', 403], ['internal', 500], ['not_found', 404], ['unauthorized', 401]].sort());
  const internal = await w.call({ path: '/leak-throw' });
  assert.equal(internal.json().error.message, 'Internal error.');
});

test('US5: one structured log line per request with the documented fields and nothing sensitive', async () => {
  const w = await makeWorld({
    routes: routes(), secrets: ['HELLO_SECRET'], inputs: { HELLO_SECRET: SECRET }, deps: { env: { __OW_ACTIVATION_ID: 'act-123' } },
  });
  const token = await w.ims.signToken();
  await w.call({ path: '/ok', token, query: 'x=secret-query-value' });
  const lines = w.logs.map((l) => JSON.parse(l)).filter((l) => l.event === 'request');
  assert.equal(lines.length, 1);
  const [line] = lines;
  ['requestId', 'activationId', 'route', 'status', 'durationMs', 'outcome', 'method', 'userId', 'retries'].forEach((k) => assert.ok(k in line, k));
  assert.equal(line.activationId, 'act-123');
  assert.equal(line.route, 'GET /ok');
  assert.equal(line.outcome, 'ok');
  const dump = w.logs.join('\n');
  [token, SECRET, 'secret-query-value', 'Bearer', 'authorization'].forEach((s) => assert.ok(!dump.toLowerCase().includes(s.toLowerCase()), s));
});

test('US5: a denied origin is logged by origin only', async () => {
  const w = await makeWorld({ routes: routes() });
  await w.call({ path: '/ok', origin: 'https://evil.example' });
  const line = w.logs.map((l) => JSON.parse(l)).find((l) => l.event === 'request');
  assert.equal(line.outcome, 'forbidden_origin');
  assert.equal(line.deniedOrigin, 'https://evil.example');
});

test('US6/US7: config exposes only non-secret inputs; declared and secret-looking inputs are excluded', async () => {
  const w = await makeWorld({
    routes: routes(),
    secrets: ['HELLO_SECRET', 'VENDOR_CRED'],
    inputs: { VENDOR_CRED: 'cred-value', OTHER_API_KEY: 'key-value', PLAIN: 'visible' },
  });
  const res = await w.call({ path: '/leak-params' });
  const { cfg } = res.json();
  assert.equal(cfg.PLAIN, 'visible');
  assert.equal(cfg.ORG, 'jazhou-adobe');
  ['HELLO_SECRET', 'VENDOR_CRED', 'OTHER_API_KEY'].forEach((n) => assert.ok(!(n in cfg), n));
  assert.ok(!res.body.includes('cred-value'));
  assert.ok(!res.body.includes('key-value'));
});

test('a very short secret value cannot corrupt the template-controlled headers', async () => {
  const w = await makeWorld({ routes: routes(), secrets: ['HELLO_SECRET'], inputs: { HELLO_SECRET: 'x' } });
  const res = await w.call({ path: '/ok' });
  assert.equal(res.headers['access-control-expose-headers'], 'x-request-id, Retry-After');
  assert.match(res.headers['x-request-id'], /^[0-9a-f-]{36}$/);
});
