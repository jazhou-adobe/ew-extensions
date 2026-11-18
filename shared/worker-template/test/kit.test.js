import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jwtVerify, createLocalJWKSet, decodeProtectedHeader } from 'jose';
import {
  fakeIms, fakeUpstream, makeParams, makeInputs, canary,
} from '../test-kit/index.js';

test('UK1: a kit-signed token verifies with real jose and has the claim shape da-admin reads', async () => {
  const ims = await fakeIms();
  const token = await ims.signToken();
  const { payload } = await jwtVerify(token, createLocalJWKSet(ims.keySet), { algorithms: ['RS256'] });
  const header = decodeProtectedHeader(token);
  assert.equal(header.alg, 'RS256');
  assert.equal(header.kid, ims.kid);
  assert.equal(payload.type, 'access_token');
  assert.equal(typeof payload.user_id, 'string');
  assert.equal(typeof payload.client_id, 'string');
  assert.match(payload.created_at, /^\d+$/);
  assert.match(payload.expires_in, /^\d+$/);
});

test('UK1: the fake key endpoint is served through the injected fetch', async () => {
  const ims = await fakeIms();
  const res = await ims.fetch('https://ims.test/ims/keys');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).keys[0].kid, ims.kid);
  assert.equal(ims.keyRequests, 1);
});

test('UK2: the fake upstream records requests and replays the script in order', async () => {
  const up = fakeUpstream([{ status: 429 }, { status: 200, body: 'ok' }]);
  assert.equal((await up.fetch('https://v.test/a', { method: 'POST', headers: { 'X-Key': 'k' }, body: 'x' })).status, 429);
  const second = await up.fetch('https://v.test/b');
  assert.equal(await second.text(), 'ok');
  assert.equal(up.calls, 2);
  assert.deepEqual(up.requests[0].headers, { 'x-key': 'k' });
  assert.equal(up.requests[0].body.toString(), 'x');
});

test('UK3: makeParams matches the documented raw web-action shapes', () => {
  const p = makeParams({
    method: 'POST',
    path: '/hello/sign',
    query: { a: '1', b: 'x y' },
    headers: { Origin: 'https://da.live', Authorization: 'Bearer t' },
    body: { hello: 'world' },
    inputs: { SECRET: 's' },
  });
  assert.equal(p.__ow_method, 'post');
  assert.equal(p.__ow_path, '/hello/sign');
  assert.equal(p.__ow_query, 'a=1&b=x+y');
  assert.deepEqual(Object.keys(p.__ow_headers).sort(), ['authorization', 'content-type', 'origin']);
  assert.equal(Buffer.from(p.__ow_body, 'base64').toString(), '{"hello":"world"}');
  assert.equal(p.SECRET, 's');
  const text = makeParams({ method: 'POST', body: 'plain' });
  assert.equal(text.__ow_body, 'plain');
});

test('makeInputs defaults are production-like and carry a canary', () => {
  const a = makeInputs();
  assert.equal(a.ALLOWED_LOCAL_ORIGINS, '');
  assert.match(a.HELLO_SECRET, /^canary-s3cr3t-/);
  assert.notEqual(canary(), canary());
});
