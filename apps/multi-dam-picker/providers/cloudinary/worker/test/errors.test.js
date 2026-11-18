import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickerWorld, KEY, SECRET, BASIC } from '../../../../worker/test/support/world.js';
import { loadFixture } from './support/fake-cloudinary.js';

const NOW = Date.UTC(2026, 10, 18, 12, 0, 0);
const BEACH = loadFixture('search').resources[0];
const world = (cloud = {}, inputs = {}, extra = {}) => pickerWorld({
  now: NOW, inputs: { CLOUDINARY_CACHE_SECONDS: '0', ...inputs }, cloud, ...extra,
});
const JSON_HEAD = { 'content-type': 'application/json' };
const resetIn = (seconds) => ({ ...JSON_HEAD, 'x-featureratelimit-reset': new Date(NOW + seconds * 1000).toUTCString() });

test('CE1: upstream 401/403 (JSON or HTML) -> 500 misconfigured, fixed message, one call, no credential or upstream text', async () => {
  for (const status of [401, 403]) {
    for (const [type, body] of [['application/json', JSON.stringify({ error: { message: `bad ${KEY}` } })], ['text/html', '<html>Unauthorized</html>']]) {
      const w = await world({ script: [{ status, headers: { 'content-type': type }, body }] });
      const res = await w.search();
      assert.equal(res.statusCode, 500);
      assert.equal(res.json().error.code, 'misconfigured');
      assert.equal(res.json().error.message, 'The service is not configured correctly.');
      assert.ok(!/reauth/i.test(res.body));
      assert.equal(w.cloud.calls, 1);
      const line = w.logs.map((l) => JSON.parse(l)).find((l) => l.event === 'provider_error');
      assert.deepEqual([line.provider, line.class], ['cloudinary', 'misconfigured']);
      assert.ok(!w.logs.join('\n').includes(KEY));
    }
  }
});

test('CE2: upstream 420 -> 429 rate_limited with Retry-After from X-FeatureRateLimit-Reset; no retry', async () => {
  const cases = [
    [resetIn(90), '90'], [JSON_HEAD, '60'], [resetIn(-30), '1'], [resetIn(7200), '3600'],
    [{ ...JSON_HEAD, 'x-featureratelimit-reset': 'garbage' }, '60'],
  ];
  for (const [headers, expected] of cases) {
    const w = await world({ script: [{ status: 420, headers, body: '{}' }] });
    const res = await w.search();
    assert.equal(res.statusCode, 429);
    assert.equal(res.json().error.code, 'rate_limited');
    assert.equal(res.headers['retry-after'], expected);
    assert.equal(w.cloud.calls, 1);
    assert.deepEqual(w.sleeps, []);
  }
});

test('CE3: upstream 429 behaves like 420 (one call)', async () => {
  const w = await world({ script: [{ status: 429, headers: resetIn(45), body: '{}' }] });
  const res = await w.search();
  assert.equal(res.statusCode, 429);
  assert.equal(res.headers['retry-after'], '45');
  assert.equal(w.cloud.calls, 1);
});

test('CE4: 5xx and network failures are retried on the template schedule, then 502 with no upstream body', async () => {
  const w = await world({ script: [{ status: 503, body: '{"x":"UPSTREAM-TEXT"}' }] });
  const res = await w.search();
  assert.equal(res.statusCode, 502);
  assert.equal(res.json().error.code, 'upstream_unavailable');
  assert.ok(!res.body.includes('UPSTREAM-TEXT'));
  assert.equal(w.cloud.calls, 4);
  assert.equal(w.sleeps.length, 3);
  const net = await world({ script: [{ throws: new TypeError('fetch failed') }] });
  assert.equal((await net.search()).statusCode, 502);
  assert.equal(net.cloud.calls, 4);
  const recovers = await world({ script: [{ status: 500, body: '{}' }, { pass: true }] });
  assert.equal((await recovers.search()).statusCode, 200);
});

test('CE5: 400 -> 400; 404 on detail -> 404; 409 -> 502', async () => {
  assert.equal((await (await world({ script: [{ status: 400, body: '{}' }] })).search()).json().error.code, 'bad_request');
  assert.equal((await (await world({ script: [{ status: 404, body: '{}' }] })).detail(BEACH.asset_id)).json().error.code, 'not_found');
  assert.equal((await (await world({ script: [{ status: 409, body: '{}' }] })).search()).statusCode, 502);
  assert.equal((await (await world({ script: [{ status: 409, body: '{}' }] })).detail(BEACH.asset_id)).statusCode, 502);
});

test('CE6: low Remaining stores a record until Reset; the next request stops early; service resumes after the reset', async () => {
  const w = await world({ rateLimit: { remaining: 21, resetAt: NOW + 120_000 } });
  assert.equal((await w.search()).statusCode, 200);
  const put = w.store.puts.find((p) => p.key === 'multi-dam-picker.ratelimit.cloudinary');
  assert.ok(put, 'record stored');
  assert.equal(put.ttl, 120);
  const { calls } = w.cloud;
  const early = await w.search();
  assert.equal(early.statusCode, 429);
  assert.equal(early.headers['retry-after'], '120');
  assert.equal(w.cloud.calls, calls, 'no upstream call while stopped');
  w.clock.now = NOW + 121_000;
  assert.equal((await w.search()).statusCode, 200);
  assert.equal(w.cloud.calls, calls + 1);
});

test('CE6: plenty of quota left -> nothing is stored', async () => {
  const w = await world({ rateLimit: { remaining: 400, resetAt: NOW + 120_000 } });
  await w.search();
  assert.equal(w.store.puts.some((p) => p.key.includes('ratelimit')), false);
});

test('CE6: a 420 records the window so the next request stops early', async () => {
  const w = await world({ script: [{ status: 420, headers: resetIn(300), body: '{}' }] });
  assert.equal((await w.search()).statusCode, 429);
  assert.equal((await w.search()).statusCode, 429);
  assert.equal(w.cloud.calls, 1);
});

test('CE7: 2xx with invalid JSON or the wrong shape -> 502, never a thrown error', async () => {
  for (const body of ['not json', '[]', '{"resources":"x"}', 'null', '"str"', '']) {
    const w = await world({ script: [{ status: 200, headers: JSON_HEAD, body }] });
    const res = await w.search();
    assert.equal(res.statusCode, 502, body);
    assert.equal(res.json().error.code, 'upstream_unavailable');
  }
  const d = await world({ script: [{ status: 200, headers: JSON_HEAD, body: '[1]' }] });
  assert.equal((await d.detail(BEACH.asset_id)).statusCode, 502);
});

test('CE8: the cache setting reaches the shell cache; 0 disables; the key includes cloud name and root', async () => {
  const on = await world({}, { CLOUDINARY_CACHE_SECONDS: '30' });
  await on.search({ q: 'x' });
  await on.search({ q: 'x' });
  assert.equal(on.cloud.calls, 1);
  assert.equal(on.store.puts[0].ttl, 30);
  const dflt = await world({}, { CLOUDINARY_CACHE_SECONDS: '' });
  await dflt.search();
  assert.equal(dflt.store.puts[0].ttl, 30);
  const off = await world();
  await off.search();
  await off.search();
  assert.equal(off.cloud.calls, 2);
  assert.equal(off.store.puts.length, 0);
  const otherRoot = await world({}, { CLOUDINARY_CACHE_SECONDS: '30', CLOUDINARY_ROOT_FOLDER: 'samples/animals' }, { deps: { store: on.store } });
  await otherRoot.search({ q: 'x' });
  assert.equal(otherRoot.cloud.calls, 1, 'a different root never reads the cached entry');
  const otherCloud = await world({}, { CLOUDINARY_CACHE_SECONDS: '30', CLOUDINARY_CLOUD_NAME: 'other-cloud' }, { deps: { store: on.store } });
  await otherCloud.search({ q: 'x' });
  assert.equal(otherCloud.cloud.calls, 1, 'a different cloud name never reads the cached entry');
});

test('CX2: cloud name and API host come only from configuration; nothing from the request reaches upstream', async () => {
  const w = await world();
  await w.search({ cloud_name: 'evil', host: 'evil.example', CLOUDINARY_CLOUD_NAME: 'evil' }, { headers: { host: 'evil.example', 'x-forwarded-host': 'evil.example', referer: 'https://evil.example' } });
  await w.detail(BEACH.asset_id, { headers: { host: 'evil.example' } });
  w.cloud.requests.forEach((r) => {
    assert.ok(r.url.startsWith('https://api.cloudinary.com/v1_1/yifoe45l/'));
    assert.ok(!JSON.stringify(r.headers).includes('evil'));
    assert.ok(!(r.body ?? '').toString().includes('evil'));
  });
});

test('CX6: a Cloudinary response that echoes the Basic value is redacted in the response and the logs', async () => {
  const resources = [{ ...BEACH, display_name: `leak ${BASIC} ${SECRET}` }];
  const w = await world({ resources });
  const res = await w.search();
  assert.equal(res.statusCode, 200);
  assert.ok(!res.body.includes(BASIC) && !res.body.includes(SECRET));
  assert.ok(res.body.includes('[redacted]'));
  assert.ok(!w.logs.join('\n').includes(BASIC));
});

test('CX7: caller-supplied fields named like inputs never override the configured ones', async () => {
  const w = await world({}, { CLOUDINARY_SIGN_URLS: 'false' });
  const evil = {
    CLOUDINARY_API_SECRET: 'attacker', CLOUDINARY_ROOT_FOLDER: '', CLOUDINARY_SIGN_URLS: 'true', CLOUDINARY_FOLDER_MODE: 'fixed',
  };
  const res = await w.search({ ...evil });
  assert.equal(res.statusCode, 200);
  assert.ok(w.cloud.requests[0].json.expression.includes('asset_folder=samples'));
  assert.equal(w.cloud.requests[0].headers.authorization, BASIC);
  res.json().items.forEach((i) => i.thumbnailUrl && assert.ok(!i.thumbnailUrl.includes('s--')));
  const post = await w.call({ path: '/dam/cloudinary/assets', method: 'POST', body: evil });
  assert.equal(post.statusCode, 405);
});
