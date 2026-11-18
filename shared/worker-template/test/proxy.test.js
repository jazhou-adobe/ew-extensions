import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proxy, mapUpstream, HttpError } from '../src/index.js';
import { fakeUpstream, makeWorld, canary } from '../test-kit/index.js';

const HOST = ['vendor.test'];
const URL_ = 'https://vendor.test/v1/thing';

function deps(upstream, extra = {}) {
  const sleeps = [];
  return {
    sleeps,
    deps: {
      fetch: upstream.fetch, sleep: async (ms) => { sleeps.push(ms); }, random: () => 1, now: () => 1_000_000, secret: () => 'S3', ...extra,
    },
  };
}

const run = (up, init = {}, options = {}, extra) => {
  const d = deps(up, extra);
  return proxy(URL_, init, { allowedHosts: HOST, ...options }, d.deps).then((res) => ({ res, sleeps: d.sleeps }));
};

test('UP1: 200 on the first try -> exactly one upstream call, response passed through', async () => {
  const up = fakeUpstream([{ status: 200, headers: { 'content-type': 'application/json' }, body: '{"a":1}' }]);
  const { res } = await run(up);
  assert.equal(up.calls, 1);
  assert.equal(res.status, 200);
  assert.deepEqual(res.json(), { a: 1 });
  assert.equal(res.attempts, 1);
});

test('UP2: 429, 429, 200 -> three calls on the exponential schedule, respecting the cap', async () => {
  const up = fakeUpstream([{ status: 429 }, { status: 429 }, { status: 200 }]);
  const { res, sleeps } = await run(up);
  assert.equal(up.calls, 3);
  assert.equal(res.status, 200);
  assert.deepEqual(sleeps, [250, 500]);
  const up2 = fakeUpstream([{ status: 429 }, { status: 429 }, { status: 429 }, { status: 200 }]);
  const r2 = await run(up2, {}, { retry: { baseMs: 1000, capMs: 1500 } });
  assert.deepEqual(r2.sleeps, [1000, 1500, 1500]);
});

test('UP3: every 5xx is retried; client errors are not', async () => {
  for (const status of [500, 502, 503, 504]) {
    // eslint-disable-next-line no-await-in-loop
    const up = fakeUpstream([{ status }, { status: 200 }]);
    // eslint-disable-next-line no-await-in-loop
    const { res } = await run(up);
    assert.equal(up.calls, 2, String(status));
    assert.equal(res.status, 200);
  }
  for (const status of [400, 401, 403, 404, 409, 422]) {
    // eslint-disable-next-line no-await-in-loop
    const up = fakeUpstream([{ status }, { status: 200 }]);
    // eslint-disable-next-line no-await-in-loop
    const { res } = await run(up);
    assert.equal(up.calls, 1, String(status));
    assert.equal(res.status, status);
  }
});

test('UP4: exhausted retries return the last response; the mapper turns it into 502 / 429 without upstream text', async () => {
  const up = fakeUpstream([{ status: 503, body: 'vendor internals' }]);
  const { res } = await run(up);
  assert.equal(up.calls, 4);
  assert.equal(res.status, 503);
  assert.throws(() => mapUpstream(res), (e) => e instanceof HttpError && e.code === 'upstream_unavailable' && !e.message.includes('vendor'));
  const up429 = fakeUpstream([{ status: 429, headers: { 'retry-after': '1' } }]);
  const { res: r429 } = await run(up429);
  assert.equal(up429.calls, 4);
  assert.throws(() => mapUpstream(r429), (e) => e.code === 'rate_limited' && e.status === 429 && e.retryAfterSeconds === 1);
});

test('UP5: Retry-After seconds and HTTP-date are honoured, bounded by the cap', async () => {
  const seconds = await run(fakeUpstream([{ status: 429, headers: { 'retry-after': '1' } }, { status: 200 }]), {}, { retry: { capMs: 5000 } }, { random: () => 0 });
  assert.deepEqual(seconds.sleeps, [1000]);
  const date = new Date(1_000_000 + 2000).toUTCString();
  const http = await run(fakeUpstream([{ status: 429, headers: { 'retry-after': date } }, { status: 200 }]), {}, { retry: { capMs: 5000 } }, { random: () => 0 });
  assert.ok(http.sleeps[0] >= 1000 && http.sleeps[0] <= 2000, String(http.sleeps[0]));
  const huge = await run(fakeUpstream([{ status: 429, headers: { 'retry-after': '86400' } }, { status: 200 }]), {}, { retry: { capMs: 2000 } });
  assert.deepEqual(huge.sleeps, [2000]);
});

test('UP6: full jitter stays within [0, min(cap, base*2^n)]', async () => {
  const lo = await run(fakeUpstream([{ status: 503 }, { status: 503 }, { status: 200 }]), {}, {}, { random: () => 0 });
  assert.deepEqual(lo.sleeps, [0, 0]);
  for (const r of [0.1, 0.5, 0.999]) {
    // eslint-disable-next-line no-await-in-loop
    const { sleeps } = await run(fakeUpstream([{ status: 503 }, { status: 503 }, { status: 503 }, { status: 200 }]), {}, { retry: { baseMs: 400, capMs: 1000 } }, { random: () => r });
    sleeps.forEach((s, n) => assert.ok(s >= 0 && s <= Math.min(1000, 400 * 2 ** n), `${s} at ${n}`));
  }
});

test('UP7: POST body replays identically; POST 5xx not retried unless opted in; PUT 5xx retried', async () => {
  const body = { items: [1, 2, 3] };
  const post429 = fakeUpstream([{ status: 429 }, { status: 429 }, { status: 200 }]);
  await run(post429, { method: 'POST', body });
  assert.equal(post429.calls, 3);
  const [a, b, c] = post429.requests.map((r) => r.body.toString());
  assert.equal(a, JSON.stringify(body));
  assert.equal(a, b);
  assert.equal(b, c);
  assert.equal(post429.requests[0].headers['content-type'], 'application/json');
  const post503 = fakeUpstream([{ status: 503 }, { status: 200 }]);
  assert.equal((await run(post503, { method: 'POST', body: 'x' })).res.status, 503);
  assert.equal(post503.calls, 1);
  const opted = fakeUpstream([{ status: 503 }, { status: 200 }]);
  assert.equal((await run(opted, { method: 'POST', body: 'x' }, { retry: { idempotent: true } })).res.status, 200);
  const put = fakeUpstream([{ status: 503 }, { status: 200 }]);
  assert.equal((await run(put, { method: 'PUT', body: 'x' })).res.status, 200);
});

test('UP8: network errors and attempt timeouts are retried for idempotent methods, then 502; POST not retried', async () => {
  const net = fakeUpstream([{ throws: new TypeError('fetch failed') }, { status: 200 }]);
  assert.equal((await run(net)).res.status, 200);
  assert.equal(net.calls, 2);
  const always = fakeUpstream([{ throws: new TypeError('fetch failed') }]);
  await assert.rejects(run(always), (e) => e.code === 'upstream_unavailable');
  assert.equal(always.calls, 4);
  const post = fakeUpstream([{ throws: new TypeError('fetch failed') }, { status: 200 }]);
  await assert.rejects(run(post, { method: 'POST', body: 'x' }), (e) => e.code === 'upstream_unavailable');
  assert.equal(post.calls, 1);
  const hang = fakeUpstream([{ hang: true }, { status: 200 }]);
  const { res } = await run(hang, {}, { retry: { attemptTimeoutMs: 20 } });
  assert.equal(res.status, 200);
  assert.equal(hang.calls, 2);
});

test('UP9: stops retrying when the next delay would exceed the budget or the invocation deadline', async () => {
  let t = 1_000_000;
  const up = fakeUpstream([{ status: 503 }]);
  const sleeps = [];
  const base = {
    fetch: up.fetch, random: () => 1, secret: () => 's', sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    }, now: () => t,
  };
  const res = await proxy(URL_, {}, { allowedHosts: HOST, retry: { baseMs: 1000, capMs: 4000, deadlineMs: 2500 } }, base);
  assert.equal(res.status, 503);
  assert.deepEqual(sleeps, [1000]);
  assert.equal(up.calls, 2);
  t = 1_000_000;
  const up2 = fakeUpstream([{ status: 503 }]);
  const r2 = await proxy(URL_, {}, { allowedHosts: HOST }, { ...base, fetch: up2.fetch, deadline: 1_000_000 + 2200 });
  assert.equal(r2.status, 503);
  assert.equal(up2.calls, 1);
});

test('UP10: header hygiene and secret injection by scheme', async () => {
  const secret = canary();
  const inbound = {
    Authorization: 'Bearer callers-token', Cookie: 'a=b', Host: 'evil', 'X-Forwarded-For': '1.2.3.4', 'X-Custom': 'keep',
  };
  const cases = [
    [{ scheme: 'bearer' }, (r) => assert.equal(r.headers.authorization, `Bearer ${secret}`)],
    [{ scheme: 'header', name: 'X-Api-Key' }, (r) => assert.equal(r.headers['x-api-key'], secret)],
    [{ scheme: 'query', name: 'api_key' }, (r) => assert.equal(new URL(r.url).searchParams.get('api_key'), secret)],
    [{ scheme: 'basic', username: 'key123' }, (r) => assert.equal(r.headers.authorization, `Basic ${Buffer.from(`key123:${secret}`).toString('base64')}`)],
  ];
  for (const [auth, check] of cases) {
    const up = fakeUpstream([{ status: 200 }]);
    // eslint-disable-next-line no-await-in-loop
    await run(up, { headers: inbound }, { auth: { secret: 'V', ...auth } }, { secret: () => secret });
    const [req] = up.requests;
    check(req);
    assert.equal(req.headers.cookie, undefined);
    assert.equal(req.headers.host, undefined);
    assert.equal(req.headers['x-forwarded-for'], undefined);
    assert.equal(req.headers['x-custom'], 'keep');
    if (auth.scheme !== 'bearer' && auth.scheme !== 'basic') assert.equal(req.headers.authorization, undefined);
    assert.ok(!JSON.stringify(req.headers).includes('callers-token'));
  }
  const noAuth = fakeUpstream([{ status: 200 }]);
  await run(noAuth, { headers: inbound });
  assert.equal(noAuth.requests[0].headers.authorization, undefined);
  const user = fakeUpstream([{ status: 200 }]);
  await run(user, {}, { auth: { secret: 'V', scheme: 'basic', usernameSecret: 'K' } }, { secret: (n) => (n === 'K' ? 'api-key' : 'api-secret') });
  assert.equal(user.requests[0].headers.authorization, `Basic ${Buffer.from('api-key:api-secret').toString('base64')}`);
});

test('UP11: host safety; redirects are not followed', async () => {
  const up = fakeUpstream([{ status: 200 }]);
  const d = deps(up).deps;
  for (const target of ['https://evil.test/x', 'http://vendor.test/x', 'https://user:pw@vendor.test/x', 'ftp://vendor.test/x', 'not a url', 'https://vendor.test.evil.test/x']) {
    // eslint-disable-next-line no-await-in-loop
    await assert.rejects(proxy(target, {}, { allowedHosts: HOST }, d), /proxy:/, target);
  }
  await assert.rejects(proxy(URL_, {}, {}, d), /allowedHosts/);
  assert.equal(up.calls, 0);
  const local = fakeUpstream([{ status: 200 }]);
  await proxy('http://127.0.0.1:9/x', {}, { allowedHosts: ['127.0.0.1'] }, { ...d, fetch: local.fetch });
  assert.equal(local.calls, 1);
  const redirect = fakeUpstream([{ status: 302, headers: { location: 'https://evil.test/steal' } }, { status: 200 }]);
  const { res } = await run(redirect);
  assert.equal(res.status, 302);
  assert.equal(redirect.calls, 1);
  assert.equal(redirect.requests[0].redirect, 'manual');
});

test('UP12: an oversized request body -> 413 payload_too_large and no upstream call', async () => {
  const up = fakeUpstream([{ status: 200 }]);
  await assert.rejects(run(up, { method: 'POST', body: 'x'.repeat(2000) }, { maxRequestBytes: 1000 }), (e) => e.code === 'payload_too_large' && e.status === 413);
  assert.equal(up.calls, 0);
});

test('UP13: declared rate-limit statuses map to 429 via the reset header, without retrying; extra retry statuses retry', async () => {
  const reset = new Date(1_000_000 + 90_000).toUTCString();
  const up = fakeUpstream([{ status: 420, headers: { 'x-featureratelimit-reset': reset } }, { status: 200 }]);
  const options = { retry: { rateLimitStatuses: [420], rateLimitResetHeader: 'X-FeatureRateLimit-Reset' } };
  const { res } = await run(up, {}, options);
  assert.equal(up.calls, 1);
  assert.throws(() => mapUpstream(res, options, () => 1_000_000), (e) => e.code === 'rate_limited' && e.retryAfterSeconds === 90);
  const retried = fakeUpstream([{ status: 420 }, { status: 200 }]);
  const r = await run(retried, {}, { retry: { extraRetryStatuses: [420] } });
  assert.equal(retried.calls, 2);
  assert.equal(r.res.status, 200);
});

test('UP14: an oversized upstream response -> upstream_too_large; binary bodies are returned base64', async () => {
  const big = fakeUpstream([{ status: 200, body: 'x'.repeat(5000) }]);
  await assert.rejects(run(big, {}, { maxResponseBytes: 1000 }), (e) => e.code === 'upstream_too_large' && e.status === 502);
  const declared = fakeUpstream([{ status: 200, headers: { 'content-length': '999999' }, body: 'x' }]);
  await assert.rejects(run(declared, {}, { maxResponseBytes: 1000 }), (e) => e.code === 'upstream_too_large');

  const bytes = Buffer.from([0, 1, 2, 255, 254]);
  const w = await makeWorld({
    routes: { 'GET /img': async ({ proxy: p, fromUpstream }) => fromUpstream(await p(URL_, {}, { allowedHosts: HOST })) },
    upstream: [{ status: 200, headers: { 'content-type': 'image/png' }, body: bytes }],
  });
  const res = await w.call({ path: '/img' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'image/png');
  assert.equal(res.body, bytes.toString('base64'));
});

test('proxy through the action: secrets injected, caller token stripped, errors mapped, retries counted in the log', async () => {
  const secret = canary();
  const w = await makeWorld({
    routes: {
      'GET /v': async ({ proxy: p, request }) => {
        const res = await p(URL_, { headers: { authorization: request.header('authorization') } }, { allowedHosts: HOST, auth: { secret: 'VENDOR_KEY', scheme: 'bearer' } });
        return { upstream: res.status };
      },
    },
    inputs: { VENDOR_KEY: secret },
    upstream: [{ status: 429, headers: { 'retry-after': '3' } }, { status: 200 }],
  });
  const ok = await w.call({ path: '/v' });
  assert.equal(ok.statusCode, 200);
  assert.equal(w.vendor.requests[0].headers.authorization, `Bearer ${secret}`);
  assert.equal(JSON.parse(w.logs.find((l) => JSON.parse(l).event === 'request')).retries, 1);
  const down = await makeWorld({ routes: { 'GET /v': async ({ proxy: p }) => p(URL_, {}, { allowedHosts: HOST }) }, upstream: [{ status: 503 }] });
  const res = await down.call({ path: '/v' });
  assert.equal(res.statusCode, 502);
  assert.equal(res.json().error.code, 'upstream_unavailable');
  const limited = await makeWorld({ routes: { 'GET /v': async ({ proxy: p }) => p(URL_, {}, { allowedHosts: HOST }) }, upstream: [{ status: 429, headers: { 'retry-after': '2' } }] });
  const r429 = await limited.call({ path: '/v' });
  assert.equal(r429.statusCode, 429);
  assert.equal(r429.headers['retry-after'], '2');
});

test('a vendor 401/403 (our credential rejected) maps to 502 without upstream text; mapErrors:false hands it to the route', async () => {
  for (const status of [401, 403]) {
    const w = await makeWorld({
      routes: { 'GET /v': async ({ proxy: p }) => p(URL_, {}, { allowedHosts: HOST }) },
      upstream: [{ status, body: 'invalid api key for account 42' }],
    });
    const res = await w.call({ path: '/v' });
    assert.equal(res.statusCode, 502);
    assert.equal(res.json().error.code, 'upstream_unavailable');
    assert.ok(!res.body.includes('account 42'));
    assert.equal(w.vendor.calls, 1);
  }
  const raw = await makeWorld({
    routes: { 'GET /v': async ({ proxy: p }) => ({ upstream: (await p(URL_, {}, { allowedHosts: HOST, mapErrors: false })).status }) },
    upstream: [{ status: 403 }],
  });
  assert.equal((await raw.call({ path: '/v' })).json().upstream, 403);
});
