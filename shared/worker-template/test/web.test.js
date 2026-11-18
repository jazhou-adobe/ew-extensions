import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from '../test-kit/index.js';

async function build(extra = {}) {
  return makeWorld({
    routes: {
      'POST /echo': async ({ request }) => ({ body: request.json(), q: [...request.query.entries()], text: undefined }),
      'POST /text': async ({ request }) => ({ text: request.text() }),
      'GET /q': async ({ request }) => ({ all: request.query.getAll('k'), v: request.query.get('v'), config: Object.keys(request.headers).length }),
      'GET /cfg': async ({ config, secret }) => ({ config, secret: secret('MY_VALUE') }),
      'GET /async': async () => {
        await new Promise((r) => {
          setTimeout(r, 1);
        }); throw new Error('late');
      },
      'GET /bin': async () => ({ statusCode: 200, headers: { 'content-type': 'application/octet-stream' }, body: Buffer.from([1, 2, 3, 250]) }),
      'GET /text-body': async () => ({ statusCode: 201, headers: { 'content-type': 'text/plain' }, body: 'hi' }),
      'GET /obj': async () => ({ statusCode: 202, body: { a: 1 } }),
      'GET /': async () => ({ root: true }),
    },
    ...extra,
  });
}

test('UW1: JSON bodies are base64-decoded once; text bodies are not; malformed -> 400', async () => {
  const w = await build();
  const json = await w.call({ method: 'POST', path: '/echo', body: { hello: 'wörld' } });
  assert.deepEqual(json.json().body, { hello: 'wörld' });
  const text = await w.call({ method: 'POST', path: '/text', body: 'dGVzdA==' });
  assert.equal(text.json().text, 'dGVzdA==');
  const badB64 = await w.call({
    method: 'POST', path: '/echo', headers: { 'content-type': 'application/json' }, body: undefined,
  });
  assert.equal(badB64.json().error.code, 'bad_request');
  const p = (await import('../test-kit/index.js')).makeParams({
    method: 'POST', path: '/echo', headers: { 'content-type': 'application/json', authorization: `Bearer ${await w.ims.signToken()}`, origin: 'https://da.live' }, inputs: w.inputs,
  });
  p.__ow_body = '%%%not base64%%%';
  assert.equal((await w.main(p)).statusCode, 400);
  p.__ow_body = Buffer.from('{not json').toString('base64');
  assert.equal((await w.main(p)).statusCode, 400);
});

test('UW2: header lookup is case-insensitive', async () => {
  const w = await build();
  const res = await w.call({ path: '/q', token: null, headers: { Authorization: `Bearer ${await w.ims.signToken()}` } });
  assert.equal(res.statusCode, 200);
});

test('UW3: routes from __ow_path (trailing slash, empty path); query parsing', async () => {
  const w = await build();
  assert.equal((await w.call({ path: '/q/', query: 'k=1&k=2&v=a%20b' })).json().all.length, 2);
  assert.equal((await w.call({ path: '/q', query: 'v=a%20b' })).json().v, 'a b');
  assert.equal((await w.call({ path: '' })).json().root, true);
  assert.equal((await w.call({ path: '/' })).json().root, true);
  assert.equal((await w.call({ path: '/q' })).json().v, null);
});

test('UW4: callers cannot shadow secrets through the query string or body', async () => {
  const w = await build();
  const res = await w.call({
    method: 'POST', path: '/echo', query: 'HELLO_SECRET=x&MY_VALUE=x', body: { HELLO_SECRET: 'x' },
  });
  assert.equal(res.statusCode, 200);
  const cfg = await w.call({ path: '/cfg', query: 'MY_VALUE=hijack', inputs: undefined });
  assert.equal(cfg.statusCode, 500, 'MY_VALUE is not an input, so the accessor refuses (query is not an input)');
  assert.equal(cfg.json().error.code, 'misconfigured');
});

test('UW5: result shape; expected errors never use the platform { error } form; binary is base64', async () => {
  const w = await build();
  for (const call of [{ path: '/q' }, { path: '/nope' }, { path: '/q', token: null }, { path: '/bin' }, { path: '/obj' }]) {
    // eslint-disable-next-line no-await-in-loop
    const res = await w.call(call);
    assert.ok(Number.isInteger(res.statusCode));
    Object.values(res.headers).forEach((v) => assert.equal(typeof v, 'string'));
    assert.equal(typeof res.body, 'string');
    assert.equal(res.error, undefined);
  }
  const bin = await w.call({ path: '/bin' });
  assert.equal(bin.body, Buffer.from([1, 2, 3, 250]).toString('base64'));
  assert.equal(bin.headers['content-type'], 'application/octet-stream');
  const text = await w.call({ path: '/text-body' });
  assert.equal(text.statusCode, 201);
  assert.equal(text.body, 'hi');
  const obj = await w.call({ path: '/obj' });
  assert.equal(obj.statusCode, 202);
  assert.deepEqual(obj.json(), { a: 1 });
  assert.equal(obj.headers['content-type'], 'application/json');
});

test('UW6: asynchronous handler failure -> 500 internal; the action keeps working; no stack in the body', async () => {
  const w = await build();
  const res = await w.call({ path: '/async' });
  assert.equal(res.statusCode, 500);
  assert.equal(res.json().error.code, 'internal');
  assert.ok(!res.body.includes('late'));
  assert.ok(!res.body.includes(' at '));
  assert.equal((await w.call({ path: '/q' })).statusCode, 200);
});
