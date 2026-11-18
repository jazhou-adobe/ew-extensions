import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { makeWorld, canary } from '../../../../shared/worker-template/test-kit/index.js';
import { routes } from '../routes/hello.js';

const SECRET = canary();
const sign = (message, secret = SECRET) => createHmac('sha256', secret).update(message).digest('hex');
const world = (inputs = {}) => makeWorld({
  name: 'hello-world', routes, secrets: ['HELLO_SECRET'], inputs: { HELLO_SECRET: SECRET, ...inputs },
});

test('HW1: /hello/sign returns the independently computed HMAC-SHA-256', async () => {
  const w = await world();
  const res = await w.call({ path: '/hello/sign', query: { message: 'abc' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { message: 'abc', algorithm: 'HMAC-SHA-256', signature: sign('abc') });
});

test('HW2: the secret never appears, and changing it changes the signature', async () => {
  const w = await world();
  const res = await w.call({ path: '/hello/sign', query: { message: 'abc' } });
  assert.ok(!res.body.includes(SECRET));
  assert.ok(!w.logs.join('\n').includes(SECRET));
  const other = await world({ HELLO_SECRET: canary() });
  const res2 = await other.call({ path: '/hello/sign', query: { message: 'abc' } });
  assert.notEqual(res.json().signature, res2.json().signature);
});

test('HW3: no token -> 401, readable by the allowed origin', async () => {
  const w = await world();
  const res = await w.call({ path: '/hello/sign', query: { message: 'abc' }, token: null });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error.code, 'unauthorized');
  assert.equal(res.headers['access-control-allow-origin'], 'https://da.live');
});

test('HW4: missing or over-long message -> 400 bad_request', async () => {
  const w = await world();
  for (const query of [{}, { message: '' }, { message: 'x'.repeat(257) }]) {
    // eslint-disable-next-line no-await-in-loop
    const res = await w.call({ path: '/hello/sign', query });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'bad_request');
  }
  assert.equal((await w.call({ path: '/hello/sign', query: { message: 'x'.repeat(256) } })).statusCode, 200);
});

test('HW5: a missing HELLO_SECRET -> 500 misconfigured', async () => {
  const w = await world({ HELLO_SECRET: '' });
  const res = await w.call({ path: '/hello/sign', query: { message: 'abc' } });
  assert.equal(res.statusCode, 500);
  assert.equal(res.json().error.code, 'misconfigured');
});

test('HW6: a disallowed origin with a valid token -> 403', async () => {
  const w = await world();
  const res = await w.call({ path: '/hello/sign', query: { message: 'abc' }, origin: 'https://evil.example' });
  assert.equal(res.statusCode, 403);
});

test('HW7: /hello/state round-trips through the store; no token -> 401', async () => {
  const w = await world();
  const res = await w.call({ path: '/hello/state' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });
  assert.equal(w.store.puts.length, 1);
  assert.equal(w.store.puts[0].ttl, 60);
  assert.ok(w.store.puts[0].key.startsWith('hello-world.'));
  assert.equal((await w.call({ path: '/hello/state', token: null })).statusCode, 401);
});
