import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../../../shared/worker-template/src/index.js';
import { canary, makeParams } from '../../../../shared/worker-template/test-kit/index.js';
import { ProviderError } from '../shell/provider.js';
import cloudinary from '../../providers/cloudinary/worker/index.js';
import { loadFixture } from '../../providers/cloudinary/worker/test/support/fake-cloudinary.js';
import { stubService } from './support/stubs.js';
import { pickerWorld, ID, KEY, BASIC } from './support/world.js';
import { assertDetail, assertSummary } from './support/schema.js';

const stubInputs = { STUBDAM_TENANT: 't1', STUBDAM_TOKEN: canary('stub') };
const stubWorld = (overrides = {}, extra = {}) => {
  const stub = stubService(overrides);
  return pickerWorld({ providers: [stub], inputs: { ...stubInputs, ...extra.inputs }, ...extra }).then((w) => Object.assign(w, { stub }));
};
const BEACH = loadFixture('search').resources[0];
const cloud = (inputs = {}, opts = {}) => pickerWorld({ inputs: { CLOUDINARY_CACHE_SECONDS: '0', ...inputs }, ...opts });

test('SH1: /dam/providers lists configured providers with kind, connection, account and capabilities; no secrets', async () => {
  const w = await cloud();
  assert.equal((await w.call({ path: '/dam/providers', token: null })).statusCode, 401);
  const res = await w.call({ path: '/dam/providers' });
  assert.equal(res.statusCode, 200);
  const [p] = res.json().providers;
  assert.deepEqual([p.id, p.label, p.credentialKind, p.connection], ['cloudinary', 'Cloudinary', 'service', { state: 'connected', account: 'yifoe45l' }]);
  assert.deepEqual(p.capabilities.assetTypes, ['image', 'video', 'document', 'audio']);
  assert.equal(p.capabilities.defaultSort, 'newest');
  assert.equal(p.capabilities.window, 500);
  assert.equal(p.capabilities.sorts.find((s) => s.id === 'relevance').requiresQuery, true);
  assert.deepEqual(p.capabilities.pageSize, { default: 24, max: 50 });
  assert.ok(!res.body.includes(KEY) && !res.body.includes('samples'));
});

test('SH2: auth before routing; unknown -> 404; wrong method -> 405; reserved routes are not routed', async () => {
  const w = await cloud();
  const paths = ['/dam/providers', '/dam/cloudinary/assets', '/dam/nope', '/dam/x/y/z/w', '/dam', '/dam/', '/other', '/oauth/cloudinary/begin', '/dam/cloudinary/connect'];
  for (const path of paths) {
    assert.equal((await w.call({ path, token: null })).statusCode, 401, path);
  }
  for (const path of ['/dam/nope', '/dam/x/y/z/w', '/dam', '/dam/', '/other', '/dam/cloudinary/connect', '/dam/cloudinary/assets/a/b', '/dam/cloudinary/other']) {
    assert.equal((await w.call({ path })).statusCode, 404, path);
  }
  assert.equal((await w.call({ path: '/dam/providers', method: 'POST' })).statusCode, 405);
  assert.equal((await w.call({ path: '/dam/cloudinary/assets', method: 'DELETE' })).statusCode, 405);
  assert.equal(w.cloud.calls, 0);
});

test('SH3: provider ids are validated against the registry; caller identity fields are ignored; empty segments are 404', async () => {
  const w = await cloud();
  for (const id of ['__proto__', 'constructor', 'toString', '%5f%5fproto%5f%5f', 'CLOUDINARY', 'cloudinary%00', '..', 'unknown']) {
    assert.equal((await w.call({ path: `/dam/${id}/assets` })).statusCode, 404, id);
  }
  assert.equal((await w.call({ path: '/dam//assets' })).statusCode, 404);
  assert.equal((await w.call({ path: '/dam/cloudinary/assets/' })).statusCode, 200, 'trailing slash is normalised');
  const res = await w.search({ userId: 'someone-else', user: 'x' }, { headers: { 'x-user-id': 'evil', 'x-forwarded-user': 'evil' } });
  assert.equal(res.statusCode, 200);
  w.cloud.requests.forEach((r) => assert.ok(!JSON.stringify([r.headers, r.json]).includes('someone-else')));
  assert.ok(w.logs.some((l) => l.includes('user-1@AdobeID')));
  assert.ok(!w.logs.join('\n').includes('someone-else'));
});

test('SH4: query validation rejects bad input before any upstream call; page size defaults to 24 and is capped at 50', async () => {
  const w = await cloud();
  const bad = [{ type: 'spreadsheet' }, { sort: 'bogus' }, { sort: 'relevance' }, { sort: 'relevance', q: '   ' }, { page: 'x' }, { page: '0' }, { page: '-1' }, { page: '1.5' },
    { pageSize: '0' }, { pageSize: '51' }, { pageSize: 'abc' }, { pageSize: '-5' }, { q: 'x'.repeat(201) }, { page: '9999999' }];
  for (const query of bad) {
    const res = await w.search(query);
    assert.equal(res.statusCode, 400, JSON.stringify(query));
    assert.equal(res.json().error.code, 'bad_request');
  }
  assert.equal(w.cloud.calls, 0);
  const ok = await w.search({ q: 'x'.repeat(200), pageSize: '50' });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().pageSize, 50);
  assert.equal((await w.search()).json().pageSize, 24);
  assert.equal((await w.search({ sort: 'relevance', q: 'beach' })).statusCode, 200);
});

test('SH5: window and hasMore', async () => {
  const w = await stubWorld({ window: 100, async search() { return { items: [], hasMore: false }; } });
  assert.equal((await w.call({ path: '/dam/stubdam/assets', query: { page: '3', pageSize: '50' } })).statusCode, 400);
  assert.equal((await w.call({ path: '/dam/stubdam/assets', query: { page: '2', pageSize: '50' } })).statusCode, 200);
  const small = await stubWorld({ async search() { return { items: [{ id: ID(1), name: 'a', type: 'image' }], total: 1, hasMore: false }; } });
  assert.equal((await small.call({ path: '/dam/stubdam/assets' })).json().hasMore, false);
});

test('SH6: output URL policy drops bad renditions and links and makes the asset not insertable with a fixed reason', async () => {
  const good = 'https://cdn.stub.example/ok.jpg';
  const bads = ['http://cdn.stub.example/a.jpg', 'javascript:alert(1)', 'data:text/html,hi', 'https://evil.example/a.jpg', 'https://api.stub.example/a.jpg', '', 'https://cdn.stub.example.evil.example/a.jpg', 'https://u:p@cdn.stub.example/a.jpg'];
  for (const bad of bads) {
    const w = await stubWorld({
      async getAsset(ctx, id) {
        return {
          id, name: 'n', type: 'image', alt: { value: '', source: 'none' }, defaultRenditionId: 'a',
          renditions: [{ id: 'a', label: 'A', url: bad, kind: 'derivative' }, { id: 'b', label: 'B', url: good, kind: 'derivative' }],
          insertable: { ok: true },
        };
      },
    });
    const a = (await w.call({ path: `/dam/stubdam/assets/${ID(1)}` })).json().asset;
    assert.deepEqual(a.renditions.map((r) => r.id), ['b'], bad);
    assert.deepEqual(a.insertable, { ok: false, reason: 'The asset URL is not allowed.' });
    assert.equal(a.defaultRenditionId, 'b');
    const link = await stubWorld({
      async getAsset(ctx, id) { return { id, name: 'n', type: 'document', linkUrl: bad, insertable: { ok: true } }; },
    });
    const l = (await link.call({ path: `/dam/stubdam/assets/${ID(1)}` })).json().asset;
    assert.equal(l.linkUrl, undefined);
    assert.equal(l.insertable.ok, false);
  }
  const png = `data:image/png;base64,${'A'.repeat(1000)}`;
  const mk = (thumbnailUrl) => stubWorld({ async search() { return { items: [{ id: ID(1), name: 'n', type: 'image', thumbnailUrl }], hasMore: false }; } });
  const kept = (await (await mk(png)).call({ path: '/dam/stubdam/assets' })).json().items[0].thumbnailUrl;
  assert.equal(kept, png);
  for (const t of [`data:image/png;base64,${'A'.repeat(70 * 1024)}`, 'data:image/svg+xml;base64,AAAA', 'data:text/html;base64,AAAA', 'http://cdn.stub.example/t.jpg', 'https://evil.example/t.jpg', 'javascript:1']) {
    assert.equal((await (await mk(t)).call({ path: '/dam/stubdam/assets' })).json().items[0].thumbnailUrl, undefined, t.slice(0, 40));
  }
  assert.equal((await (await mk('https://cdn.stub.example/t.jpg')).call({ path: '/dam/stubdam/assets' })).json().items[0].thumbnailUrl, 'https://cdn.stub.example/t.jpg');
});

test('SH7: unknown provider fields never appear in the response, including secret-looking names', async () => {
  const w = await stubWorld({
    async search() {
      return {
        items: [{ id: ID(1), name: 'n', type: 'image', apiSecret: 'LEAK1', token: 'LEAK2', extra: { a: 1 } }], hasMore: false, nextCursor: 'LEAK3', debug: 'LEAK4',
      };
    },
    async getAsset(ctx, id) {
      return {
        id, name: 'n', type: 'document', linkUrl: 'https://cdn.stub.example/a.pdf', insertable: { ok: true, secret: 'LEAK5' }, alt: { value: 'a', source: 'name', key: 'LEAK6' }, internal: 'LEAK7',
      };
    },
  });
  const a = await w.call({ path: '/dam/stubdam/assets' });
  const b = await w.call({ path: `/dam/stubdam/assets/${ID(1)}` });
  assert.ok(!/LEAK/.test(a.body + b.body));
  assert.deepEqual(Object.keys(a.json()).sort(), ['hasMore', 'items', 'page', 'pageSize']);
});

test('SH8/PC6: provider failure classes map to the error contract with fixed messages', async () => {
  const cases = [['bad_request', 400, 'bad_request'], ['not_found', 404, 'not_found'], ['forbidden', 403, 'forbidden'], ['misconfigured', 500, 'misconfigured'],
    ['upstream_unavailable', 502, 'upstream_unavailable'], ['rate_limited', 429, 'rate_limited'], ['reauth_required', 409, 'provider_reauth_required'], ['not_connected', 409, 'provider_not_connected']];
  for (const [kind, status, code] of cases) {
    const w = await stubWorld({ async search() { throw new ProviderError(kind, { retryAfterSeconds: 30 }); }, async getAsset() { throw new ProviderError(kind); } });
    for (const path of ['/dam/stubdam/assets', `/dam/stubdam/assets/${ID(1)}`]) {
      const res = await w.call({ path });
      assert.equal(res.statusCode, status, `${kind} ${path}`);
      assert.equal(res.json().error.code, code);
      assert.deepEqual(Object.keys(res.json().error).sort(), ['code', 'message', 'requestId']);
      assert.equal(res.headers['cache-control'], 'no-store');
      assert.ok(res.headers['x-request-id']);
    }
  }
  const retry = async (retryAfterSeconds) => (await (await stubWorld({ async search() { throw new ProviderError('rate_limited', { retryAfterSeconds }); } })).call({ path: '/dam/stubdam/assets' })).headers['retry-after'];
  assert.deepEqual([await retry(undefined), await retry(0), await retry(-5), await retry(90), await retry(99999)], ['60', '1', '1', '90', '3600']);
});

test('PC6: untyped errors -> 500 internal with no message; malformed provider shapes -> 502, never a thrown error', async () => {
  const boom = await stubWorld({ async search() { throw new Error('SECRET-DETAIL'); } });
  const res = await boom.call({ path: '/dam/stubdam/assets' });
  assert.equal(res.statusCode, 500);
  assert.equal(res.json().error.code, 'internal');
  assert.ok(!res.body.includes('SECRET-DETAIL'));
  const shapes = [null, 'x', [], {}, { items: 'x', hasMore: false }, { items: [], hasMore: 'no' }, { items: [null], hasMore: false },
    { items: [{ id: 'bad', name: 'n', type: 'image' }], hasMore: false }, { items: [{ id: ID(1), name: '', type: 'image' }], hasMore: false },
    { items: [{ id: ID(1), name: 'n', type: 'spreadsheet' }], hasMore: false }, { items: Array.from({ length: 30 }, (_, i) => ({ id: ID(i + 1), name: 'n', type: 'image' })), hasMore: false }];
  for (const shape of shapes) {
    const w = await stubWorld({ async search() { return shape; } });
    const r = await w.call({ path: '/dam/stubdam/assets', query: { pageSize: '24' } });
    assert.equal(r.statusCode, 502, JSON.stringify(shape)?.slice(0, 60));
    assert.equal(r.json().error.code, 'upstream_unavailable');
  }
  const detail = await stubWorld({ async getAsset() { return 'nope'; } });
  assert.equal((await detail.call({ path: `/dam/stubdam/assets/${ID(1)}` })).statusCode, 502);
});

test('PC3: search and detail outputs validate against the schema on every Cloudinary fixture and the stub', async () => {
  const w = await cloud();
  const { items } = (await w.search({ pageSize: '50' })).json();
  assert.ok(items.length >= 10);
  const ctx = { provider: 'cloudinary', idPattern: cloudinary.assetIdPattern };
  items.forEach((i) => assertSummary(i, ctx));
  for (const i of items) {
    const res = await w.detail(i.id);
    if (res.statusCode === 200) assertDetail(res.json().asset, ctx);
  }
  const stub = await stubWorld();
  const sctx = { provider: 'stubdam', idPattern: stub.stub.assetIdPattern };
  (await stub.call({ path: '/dam/stubdam/assets' })).json().items.forEach((i) => assertSummary(i, sctx));
  assertDetail((await stub.call({ path: `/dam/stubdam/assets/${ID(1)}` })).json().asset, sctx);
});

test('PC4: a second service provider appears, routes and caches under its own id with no shell change and no OAuth artefacts', async () => {
  const stub = stubService();
  const w = await pickerWorld({ providers: [cloudinary, stub], inputs: { ...stubInputs, CLOUDINARY_CACHE_SECONDS: '30' } });
  assert.deepEqual((await w.call({ path: '/dam/providers' })).json().providers.map((p) => p.id), ['cloudinary', 'stubdam']);
  assert.equal((await w.call({ path: '/dam/stubdam/assets' })).statusCode, 200);
  assert.equal((await w.search()).statusCode, 200);
  const keys = w.store.puts.map((p) => p.key);
  assert.ok(keys.some((k) => k.startsWith('multi-dam-picker.cache.stubdam.')));
  assert.ok(keys.some((k) => k.startsWith('multi-dam-picker.cache.cloudinary.')));
  assert.equal((await w.call({ path: '/dam/stubdam/connect' })).statusCode, 404);
  assert.ok(keys.every((k) => /\.cache\./.test(k)), 'only cache entries are written');
  await w.call({ path: '/dam/stubdam/assets' });
  assert.equal(stub.calls.length, 1, 'cached per provider');
});

test('PC7: a provider never receives the IMS token, Authorization, cookies or the request', async () => {
  const token = 'ims-token-canary-xyz';
  const w = await stubWorld();
  const tok = await w.ims.signToken();
  await w.call({ path: '/dam/stubdam/assets', token: tok, headers: { cookie: 'session=abc' } });
  await w.call({ path: `/dam/stubdam/assets/${ID(1)}`, token: tok });
  w.stub.calls.forEach(({ ctx }) => {
    assert.deepEqual(Object.keys(ctx).sort(), ['config', 'log', 'now', 'proxy', 'requestId', 'secret', 'store', 'timeLeftMs']);
    assert.throws(() => ctx.secret('SOME_OTHER_SECRET'));
    assert.equal(typeof ctx.secret('STUBDAM_TOKEN'), 'string');
    const seen = JSON.stringify({ config: ctx.config, requestId: ctx.requestId });
    assert.ok(!seen.includes(tok) && !seen.toLowerCase().includes('cookie') && !seen.includes(token));
  });
});

test('PC8: the proxy handed to a provider is pinned to its outboundHosts and never follows redirects', async () => {
  const attempts = [];
  const w = await stubWorld({
    async search(ctx) {
      await ctx.proxy('https://api.stub.example/ok', {}, { mapErrors: false });
      for (const [url, opts] of [['https://evil.example/x', {}], ['https://api.stub.example.evil.example/x', {}], ['https://evil.example/x', { allowedHosts: ['evil.example'] }]]) {
        try {
          await ctx.proxy(url, {}, opts);
          attempts.push('allowed');
        } catch (e) {
          attempts.push(e.message);
        }
      }
      return { items: [], hasMore: false };
    },
  });
  assert.equal((await w.call({ path: '/dam/stubdam/assets' })).statusCode, 200);
  assert.deepEqual(attempts, Array(3).fill('proxy: host is not allowed for this route'));
  assert.equal(w.cloud.calls, 1);
  assert.equal(w.cloud.requests[0].redirect, 'manual');
});

test('SH9: result cache hits, keys, expiry, TTL 0, no caching of detail or errors, size cap, valid keys', async () => {
  const w = await cloud({ CLOUDINARY_CACHE_SECONDS: '30' });
  await w.search({ q: 'a' });
  await w.search({ q: 'a' });
  assert.equal(w.cloud.calls, 1);
  const variants = [{ q: 'b' }, { q: 'a', type: 'image' }, { q: 'a', sort: 'oldest' }, { q: 'a', page: '2' }, { q: 'a', pageSize: '10' }];
  for (const v of variants) await w.search(v);
  assert.equal(w.cloud.calls, 1 + variants.length);
  w.clock.now += 31_000;
  await w.search({ q: 'a' });
  assert.equal(w.cloud.calls, 2 + variants.length, 'expired');
  const before = w.cloud.calls;
  await w.detail(BEACH.asset_id);
  await w.detail(BEACH.asset_id);
  assert.equal(w.cloud.calls, before + 2, 'detail is never cached');
  w.store.puts.forEach(({ key, ttl }) => {
    assert.match(key, /^[A-Za-z0-9._-]+$/);
    assert.ok(Buffer.byteLength(key) <= 1024);
    assert.equal(ttl, 30);
  });
  const shared = { deps: { store: w.store } };
  for (const inputs of [{ CLOUDINARY_ROOT_FOLDER: 'samples/animals' }, { CLOUDINARY_SIGN_URLS: 'true' }, { CLOUDINARY_FOLDER_MODE: 'fixed' }, { CLOUDINARY_RENDITIONS: '[{"id":"x","label":"X","transformation":"w_1"}]' }]) {
    const other = await cloud({ CLOUDINARY_CACHE_SECONDS: '30', ...inputs }, shared);
    await other.search({ q: 'a' });
    assert.equal(other.cloud.calls, 1, JSON.stringify(inputs));
  }
});

test('SH9: errors are not cached; TTL 0 disables; entries over 64 KB are not stored', async () => {
  const failing = await cloud({ CLOUDINARY_CACHE_SECONDS: '30' }, {});
  failing.cloud.fetch = async () => new Response('x', { status: 400 });
  await failing.search();
  assert.equal(failing.store.puts.length, 0);
  const off = await cloud({ CLOUDINARY_CACHE_SECONDS: '0' });
  await off.search();
  await off.search();
  assert.equal(off.cloud.calls, 2);
  const thumb = `data:image/png;base64,${'A'.repeat(40 * 1024)}`;
  const big = await stubWorld({ async search() { return { items: [1, 2].map((n) => ({ id: ID(n), name: 'n', type: 'image', thumbnailUrl: thumb })), hasMore: false }; } });
  assert.equal((await big.call({ path: '/dam/stubdam/assets' })).statusCode, 200);
  assert.equal(big.store.puts.length, 0);
});

test('SH10: an invalid present setting makes every /dam call (after auth) 500 misconfigured; the log names the setting only', async () => {
  const bad = canary('bad-host');
  const w = await cloud({ CLOUDINARY_API_HOST: bad });
  for (const path of ['/dam/providers', '/dam/cloudinary/assets', `/dam/cloudinary/assets/${BEACH.asset_id}`, '/dam/unknown/assets']) {
    const res = await w.call({ path });
    assert.equal(res.statusCode, 500, path);
    assert.equal(res.json().error.code, 'misconfigured');
    assert.ok(!res.body.includes(bad));
  }
  assert.equal((await w.call({ path: '/dam/providers', token: null })).statusCode, 401);
  const logs = w.logs.join('\n');
  assert.ok(logs.includes('CLOUDINARY_API_HOST') && !logs.includes(bad));
  assert.equal(w.cloud.calls, 0);
});

test('SH11: one request line per request with provider, op, status and retries; no tokens, secrets, search text or bodies', async () => {
  const w = await cloud({}, {});
  const token = await w.ims.signToken();
  await w.call({ path: '/dam/cloudinary/assets', token, query: { q: 'very-private-search-text' } });
  await w.call({ path: `/dam/cloudinary/assets/${BEACH.asset_id}`, token });
  const lines = w.logs.map((l) => JSON.parse(l)).filter((l) => l.event === 'request');
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((l) => [l.provider, l.op, l.status, l.retries]), [['cloudinary', 'search', 200, 0], ['cloudinary', 'detail', 200, 0]]);
  const all = w.logs.join('\n');
  [token, 'very-private-search-text', BASIC, KEY, 'beach-boat', 'Bearer'].forEach((s) => assert.ok(!all.includes(s), s));
});

test('SH12/CX4: CORS and origin rules hold on /dam routes', async () => {
  const w = await cloud();
  for (const origin of ['https://da.live', 'https://main--ew-extensions--jazhou-adobe.aem.live', 'https://feature--ew-extensions--jazhou-adobe.aem.page', 'https://main--ew-extensions--jazhou-adobe.preview.da.live']) {
    for (const [path, token] of [['/dam/providers', undefined], ['/dam/providers', null], ['/dam/nope', undefined]]) {
      const res = await w.call({ path, origin, token });
      assert.equal(res.headers['access-control-allow-origin'], origin);
      assert.match(res.headers['access-control-expose-headers'], /Retry-After/);
      assert.match(res.headers['access-control-expose-headers'], /x-request-id/);
    }
  }
  const before = w.cloud.calls;
  for (const origin of ['https://main--ew-extensions-demo--jazhou-adobe.aem.live', 'https://evil.example', 'http://localhost:3000', 'null']) {
    const res = await w.search({}, { origin });
    assert.equal(res.statusCode, 403, origin);
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  }
  assert.equal(w.cloud.calls, before);
  const pre = await w.call({ path: '/dam/cloudinary/assets', method: 'OPTIONS', token: null, headers: { 'access-control-request-method': 'GET' } });
  assert.equal(pre.statusCode, 204);
  assert.match(pre.headers['access-control-allow-methods'], /GET/);
});

test('SH13: a failing store never fails a request; no cache write is attempted twice; the early stop is skipped', async () => {
  let writes = 0;
  const base = createStore({ workerName: 'multi-dam-picker', clientFactory: () => { throw new Error('state down'); } });
  const store = { ...base, put: async (...a) => { writes += 1; return base.put(...a); } };
  const w = await cloud({ CLOUDINARY_CACHE_SECONDS: '30' }, { deps: { store } });
  assert.equal((await w.search()).statusCode, 200);
  assert.equal((await w.detail(BEACH.asset_id)).statusCode, 200);
  assert.ok(writes <= 2, `writes: ${writes}`);
  const low = await cloud({ CLOUDINARY_CACHE_SECONDS: '30' }, { deps: { store }, cloud: { rateLimit: { remaining: 1, resetAt: Date.now() + 60_000 } } });
  assert.equal((await low.search()).statusCode, 200);
  assert.equal((await low.search({ q: 'again' })).statusCode, 200);
});

test('the shell does not treat the request line as a different route (raw path with query is not a path)', async () => {
  const w = await cloud();
  const params = makeParams({ path: '/dam/providers?x=1', inputs: w.inputs, headers: { authorization: `Bearer ${await w.ims.signToken()}`, origin: 'https://da.live' } });
  assert.notEqual((await w.main(params)).statusCode, 500);
});
