// Opt-in live tier (LC1-LC3): the provider code against the real test environment. Not run in CI.
//   npm run test:picker:live       (credentials from the worker's untracked .env; never printed)
// Budget: at most 4 Admin API requests per run (the Free plan allows 500 per hour). Never loop these.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proxy } from '../../../../../../shared/worker-template/src/index.js';
import { setting, skipUnless } from '../../../../worker/test-live/env.js';
import provider from '../index.js';

const skip = skipUnless('CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET');
const rawConfig = () => ({
  CLOUDINARY_CLOUD_NAME: setting('CLOUDINARY_CLOUD_NAME') || 'yifoe45l',
  CLOUDINARY_ROOT_FOLDER: setting('CLOUDINARY_ROOT_FOLDER') ?? 'samples/',
  CLOUDINARY_FOLDER_MODE: setting('CLOUDINARY_FOLDER_MODE') || 'dynamic',
  CLOUDINARY_SIGN_URLS: 'false',
});

function context({ secret = (n) => setting(n), store } = {}) {
  const config = provider.config.resolve(rawConfig());
  const memory = new Map();
  const sent = [];
  return {
    sent,
    ctx: {
      config,
      now: Date.now,
      secret,
      log: () => {},
      requestId: 'live',
      store: store ?? {
        get: async (k) => memory.get(k),
        put: async (k, v) => { memory.set(k, v); },
        delete: async (k) => { memory.delete(k); },
      },
      proxy: (url, init, opts) => proxy(url, init, { ...opts, allowedHosts: provider.outboundHosts(config) }, {
        secret,
        fetch: (u, i) => { sent.push(String(u)); return fetch(u, i); },
      }),
    },
  };
}

test('LC1: search (empty query, image filter, page size 5) -> summaries inside the root with the documented shape', { skip }, async () => {
  const { ctx } = context();
  const result = await provider.search(ctx, {
    q: '', type: 'image', sort: 'newest', page: 1, pageSize: 5,
  });
  assert.ok(result.items.length <= 5);
  result.items.forEach((i) => {
    assert.match(i.id, /^[0-9a-f]{32}$/);
    assert.equal(i.type, 'image');
    assert.ok(i.thumbnailUrl.startsWith('https://res.cloudinary.com/'));
  });
  assert.equal(typeof result.hasMore, 'boolean');
});

test('LC2: getAsset for the first image -> renditions that answer 200 image bytes anonymously, plus an alt candidate', { skip }, async () => {
  const { ctx } = context();
  const { items } = await provider.search(ctx, {
    q: '', type: 'image', sort: 'newest', page: 1, pageSize: 1,
  });
  assert.ok(items.length, 'the test environment has at least one image under the root');
  const asset = await provider.getAsset(ctx, items[0].id);
  assert.equal(asset.insertable.ok, true);
  const web = asset.renditions.find((r) => r.id === 'web');
  const res = await fetch(web.url);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^image\//);
  assert.ok(['property', 'description', 'name', 'none'].includes(asset.alt.source));
});

test('LC3: a deliberately wrong secret -> Cloudinary 401 mapped to misconfigured, one call, no upstream text', { skip }, async () => {
  const wrong = (name) => (name === 'CLOUDINARY_API_SECRET' ? 'definitely-wrong' : setting(name));
  const { ctx, sent } = context({ secret: wrong });
  await assert.rejects(
    provider.search(ctx, {
      q: '', type: 'all', sort: 'newest', page: 1, pageSize: 1,
    }),
    (e) => e.kind === 'misconfigured' && !/invalid|credential|api/i.test(e.message),
  );
  assert.equal(sent.length, 1);
});
