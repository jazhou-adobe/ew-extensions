// Opt-in live tier: drives the `proxy` helper against the Cloudinary Admin API with HTTP Basic auth.
// Needs CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET (untracked .env). Never loops: the plan allows 500 Admin API calls/hour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proxy, mapUpstream } from '../src/index.js';
import { setting, skipUnless } from './env.js';

const skip = skipUnless('CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET');
const cloud = () => setting('CLOUDINARY_CLOUD_NAME') || 'yifoe45l';
const OPTIONS = {
  allowedHosts: ['api.cloudinary.com'],
  auth: { scheme: 'basic', usernameSecret: 'CLOUDINARY_API_KEY', secret: 'CLOUDINARY_API_SECRET' },
  retry: { rateLimitStatuses: [420], rateLimitResetHeader: 'X-FeatureRateLimit-Reset' },
};

function harness(secrets = { CLOUDINARY_API_KEY: setting('CLOUDINARY_API_KEY'), CLOUDINARY_API_SECRET: setting('CLOUDINARY_API_SECRET') }) {
  const sent = [];
  return {
    sent,
    deps: {
      secret: (name) => secrets[name],
      fetch: (url, init) => {
        sent.push({ url: String(url), headers: init.headers });
        return fetch(url, init);
      },
    },
  };
}

test('CL1: GET /ping -> 200 {"status":"ok"}; Basic auth is key:secret and the secret is not in the output', { skip }, async () => {
  const h = harness();
  const res = await proxy(`https://api.cloudinary.com/v1_1/${cloud()}/ping`, {}, OPTIONS, h.deps);
  assert.equal(res.status, 200);
  assert.deepEqual(res.json(), { status: 'ok' });
  assert.equal(h.sent[0].headers.authorization, `Basic ${Buffer.from(`${setting('CLOUDINARY_API_KEY')}:${setting('CLOUDINARY_API_SECRET')}`).toString('base64')}`);
  assert.ok(!res.text().includes(setting('CLOUDINARY_API_SECRET')));
});

test('CL2: one small listing under samples/ -> 200 JSON; rate-limit headers reach the mapper', { skip }, async () => {
  const h = harness();
  const root = setting('CLOUDINARY_ROOT_FOLDER') || 'samples';
  const res = await proxy(`https://api.cloudinary.com/v1_1/${cloud()}/resources/image/upload?prefix=${root}/&max_results=1`, {}, OPTIONS, h.deps);
  assert.equal(res.status, 200);
  assert.equal(typeof res.json(), 'object');
  assert.equal(mapUpstream(res, OPTIONS), res);
  assert.ok('x-featureratelimit-limit' in res.headers || 'x-featureratelimit-remaining' in res.headers, 'rate-limit headers surfaced');
});

test('CL3: a wrong secret -> 401 from Cloudinary, one call, mapped without echoing upstream text', { skip }, async () => {
  const h = harness({ CLOUDINARY_API_KEY: setting('CLOUDINARY_API_KEY'), CLOUDINARY_API_SECRET: 'definitely-wrong' });
  const res = await proxy(`https://api.cloudinary.com/v1_1/${cloud()}/ping`, {}, OPTIONS, h.deps);
  assert.equal(res.status, 401);
  assert.equal(h.sent.length, 1);
  assert.throws(() => mapUpstream(res, OPTIONS), (e) => e.code === 'upstream_unavailable' && e.status === 502 && !/invalid|credential|api/i.test(e.message));
});
