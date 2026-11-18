import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createStore, memoryStore, HttpError, StoreUsageError,
} from '../src/index.js';

/** A State client that, like the real one, only accepts strings. */
function fakeState() {
  const data = new Map();
  const calls = [];
  return {
    calls,
    data,
    async get(key) {
      calls.push(['get', key]);
      const v = data.get(key);
      return v === undefined ? undefined : { value: v };
    },
    async put(key, value, opts) {
      calls.push(['put', key, opts]);
      if (typeof value !== 'string') throw new TypeError('value must be a string');
      data.set(key, value);
    },
    async delete(key) {
      calls.push(['delete', key]);
      data.delete(key);
    },
  };
}

test('UT1: put/get round-trips JSON through a string-only client; TTL in seconds; default TTL applied', async () => {
  const state = fakeState();
  const store = createStore({ workerName: 'w', clientFactory: () => state });
  await store.put('a', { n: 1, s: ['x'] }, { ttlSeconds: 60 });
  await store.put('b', 'plain');
  assert.deepEqual(await store.get('a'), { n: 1, s: ['x'] });
  assert.equal(state.calls[0][2].ttl, 60);
  assert.equal(state.calls[1][2].ttl, 86400);
  assert.equal(await store.get('missing'), undefined);
  await store.delete('a');
  assert.equal(await store.get('a'), undefined);
  for (const ttl of [0, -1, 1.5, 365 * 86400 + 1]) {
    // eslint-disable-next-line no-await-in-loop
    await assert.rejects(store.put('c', 1, { ttlSeconds: ttl }), StoreUsageError);
  }
});

test('UT2: invalid keys are rejected before any State call; keys are prefixed per worker', async () => {
  const state = fakeState();
  const a = createStore({ workerName: 'alpha', clientFactory: () => state });
  const b = createStore({ workerName: 'beta', clientFactory: () => state });
  for (const key of ['', 'has space', 'slash/key', 'ünï', 'x'.repeat(1030), undefined]) {
    // eslint-disable-next-line no-await-in-loop
    await assert.rejects(a.get(key), StoreUsageError, String(key));
  }
  assert.equal(state.calls.length, 0);
  await a.put('k', 1);
  await b.put('k', 2);
  assert.equal(await a.get('k'), 1);
  assert.equal(await b.get('k'), 2);
  assert.deepEqual([...state.data.keys()].sort(), ['alpha.k', 'beta.k']);
});

test('UT3: values over 1 MB are rejected with a clear internal error', async () => {
  const state = fakeState();
  const store = createStore({ workerName: 'w', clientFactory: () => state });
  await assert.rejects(store.put('big', 'x'.repeat(1_100_000)), /too large/);
  await assert.rejects(store.put('undef', undefined), StoreUsageError);
  assert.equal(state.calls.length, 0);
});

test('UT4: rate-limit and storage-limit failures -> store_unavailable', async () => {
  for (const status of [429, 403]) {
    const client = {
      get: async () => {
        throw Object.assign(new Error('limit'), { status });
      }, put: async () => { throw Object.assign(new Error('limit'), { status }); }, delete: async () => {} };
    const store = createStore({ workerName: 'w', clientFactory: () => client });
    // eslint-disable-next-line no-await-in-loop
    await assert.rejects(store.put('k', 1), (e) => e instanceof HttpError && e.code === 'store_unavailable' && e.status === 503);
    // eslint-disable-next-line no-await-in-loop
    await assert.rejects(store.get('k'), (e) => e.code === 'store_unavailable');
  }
  const broken = createStore({
    workerName: 'w', clientFactory: () => {
      throw new Error('no credentials');
    } });
  await assert.rejects(broken.get('k'), (e) => e.code === 'store_unavailable');
});

test('UT5: the memory twin behaves like the adapter, with TTL expiry from an injected clock', async () => {
  let t = 1000;
  const store = memoryStore({ workerName: 'w', now: () => t });
  await store.put('k', { a: 1 }, { ttlSeconds: 10 });
  assert.deepEqual(await store.get('k'), { a: 1 });
  t += 9_999;
  assert.deepEqual(await store.get('k'), { a: 1 });
  t += 2;
  assert.equal(await store.get('k'), undefined);
  assert.deepEqual(store.puts, [{ key: 'w.k', ttl: 10 }]);
  await assert.rejects(store.put('bad key', 1), StoreUsageError);
});

test('UT5: without an injected store a worker uses the real State client, never a silent memory fallback', async () => {
  const { makeWorld } = await import('../test-kit/index.js');
  const w = await makeWorld({
    routes: {
      'GET /s': async ({ store }) => {
        await store.put('k', 1); return { ok: true };
      } },
    deps: { store: undefined },
  });
  // `deps.store: undefined` overrides the memory store; State cannot initialise without Runtime credentials.
  const res = await w.call({ path: '/s' });
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().error.code, 'store_unavailable');
});
