import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair } from 'jose';
import { makeWorld } from '../test-kit/index.js';

const routes = { 'GET /ping': async (ctx) => ({ user: ctx.identity.userId, client: ctx.identity.clientId, exp: ctx.identity.expiresAt }) };

async function world(opts = {}) {
  const calls = [];
  const w = await makeWorld({
    routes: {
      'GET /ping': async (ctx) => {
        calls.push(ctx); return routes['GET /ping'](ctx);
      } },
    ...opts,
  });
  return Object.assign(w, { handlerCalls: calls });
}

function assertDenied(res, status = 401) {
  assert.equal(res.statusCode, status);
  return res.json().error.code;
}

test('UA1: no Authorization header -> 401 unauthorized, nothing else happens', async () => {
  const w = await world();
  const res = await w.call({ path: '/ping', token: null });
  assert.equal(assertDenied(res), 'unauthorized');
  assert.equal(res.headers['www-authenticate'], 'Bearer');
  assert.equal(w.handlerCalls.length, 0);
  assert.equal(w.ims.keyRequests, 0);
  assert.equal(w.vendor.calls, 0);
});

test('UA2: malformed Authorization headers -> 401', async () => {
  const w = await world();
  const token = await w.ims.signToken();
  const bad = ['Basic abc', 'Bearer ', 'Bearer', `Bearer ${token} extra`, `Bearer ${token}, Bearer ${token}`, token];
  for (const value of bad) {
    // eslint-disable-next-line no-await-in-loop
    const res = await w.call({ path: '/ping', token: null, headers: { authorization: value } });
    assert.equal(res.statusCode, 401, value);
  }
  const ok = await w.call({ path: '/ping', token: null, headers: { authorization: `bearer ${token}` } });
  assert.equal(ok.statusCode, 200);
});

test('UA3: tokens that are not JWTs -> 401, never 500', async () => {
  const w = await world();
  for (const t of ['garbage', 'a.b', '..', 'eyJhbGciOiJSUzI1NiJ9.e30', 'eyJ.eyJ.sig']) {
    // eslint-disable-next-line no-await-in-loop
    const res = await w.call({ path: '/ping', token: t });
    assert.equal(res.statusCode, 401, t);
  }
});

test('UA4: wrong key, alg none, HS256 key confusion, unknown kid -> 401', async () => {
  const w = await world();
  const other = await generateKeyPair('RS256');
  assert.equal((await w.call({ path: '/ping', token: await w.ims.signToken({ key: other.privateKey }) })).statusCode, 401);
  assert.equal((await w.call({ path: '/ping', token: await w.ims.signToken({ header: { kid: 'nope' } }) })).statusCode, 401);
  const none = `${Buffer.from('{"alg":"none","kid":"test-key-1"}').toString('base64url')}.${Buffer.from(JSON.stringify({
    type: 'access_token', user_id: 'u', client_id: 'c', created_at: String(Date.now()), expires_in: '86400000',
  })).toString('base64url')}.`;
  assert.equal((await w.call({ path: '/ping', token: none })).statusCode, 401);
  // HS256 signed with the public key material as the HMAC secret
  const { createHmac } = await import('node:crypto');
  const head = Buffer.from('{"alg":"HS256","kid":"test-key-1"}').toString('base64url');
  const body = Buffer.from(JSON.stringify({
    type: 'access_token', user_id: 'u', client_id: 'c', created_at: String(Date.now()), expires_in: '86400000',
  })).toString('base64url');
  const sig = createHmac('sha256', w.ims.keySet.keys[0].n).update(`${head}.${body}`).digest('base64url');
  assert.equal((await w.call({ path: '/ping', token: `${head}.${body}.${sig}` })).statusCode, 401);
  assert.equal(w.handlerCalls.length, 0);
});

test('UA5: expiry by created_at + expires_in (and exp); valid just before expiry', async () => {
  const now = 1_800_000_000_000;
  const w = await world({ now });
  const expired = await w.ims.signToken({ now, claims: { created_at: String(now - 2000), expires_in: '1000' } });
  assert.equal((await w.call({ path: '/ping', token: expired })).statusCode, 401);
  const justValid = await w.ims.signToken({ now, claims: { created_at: String(now - 999), expires_in: '1000' } });
  assert.equal((await w.call({ path: '/ping', token: justValid })).statusCode, 200);
  const expByExp = await w.ims.signToken({ now, claims: { exp: Math.floor(now / 1000) - 10 } });
  assert.equal((await w.call({ path: '/ping', token: expByExp })).statusCode, 401);
  const noTiming = await w.ims.signToken({ now, claims: { created_at: undefined } });
  assert.equal((await w.call({ path: '/ping', token: noTiming })).statusCode, 401);
});

test('UA6: type other than access_token -> 401', async () => {
  const w = await world();
  assert.equal((await w.call({ path: '/ping', token: await w.ims.signToken({ claims: { type: 'refresh_token' } }) })).statusCode, 401);
  assert.equal((await w.call({ path: '/ping', token: await w.ims.signToken({ claims: { type: undefined } }) })).statusCode, 401);
});

test('UA7: client id allowlist; empty allowlist is not checked', async () => {
  const w = await world({ inputs: { ALLOWED_IMS_CLIENT_IDS: 'darkalley, other' } });
  assert.equal((await w.call({ path: '/ping', token: await w.ims.signToken({ claims: { client_id: 'darkalley' } }) })).statusCode, 200);
  assert.equal((await w.call({ path: '/ping', token: await w.ims.signToken({ claims: { client_id: 'evil' } }) })).statusCode, 401);
  const open = await world();
  assert.equal((await open.call({ path: '/ping', token: await open.ims.signToken({ claims: { client_id: 'anything' } }) })).statusCode, 200);
});

test('UA8: valid token -> handler called once with identity and no raw token on it', async () => {
  const w = await world();
  const token = await w.ims.signToken();
  const res = await w.call({ path: '/ping', token });
  assert.equal(res.statusCode, 200);
  assert.equal(w.handlerCalls.length, 1);
  const { identity, claims } = w.handlerCalls[0];
  assert.deepEqual(Object.keys(identity).sort(), ['clientId', 'expiresAt', 'userId']);
  assert.equal(identity.userId, 'user-1@AdobeID');
  assert.ok(!JSON.stringify(identity).includes(token));
  assert.ok(!JSON.stringify(claims).includes(token));
  assert.throws(() => {
    claims.type = 'x';
  }, TypeError);
});

test('UA9: key set outage -> 503 auth_unavailable (fail closed), distinct from 401', async () => {
  for (const mode of [500, 'garbage', 'network']) {
    // eslint-disable-next-line no-await-in-loop
    const w = await world();
    w.ims.failWith = mode;
    // eslint-disable-next-line no-await-in-loop
    const res = await w.call({ path: '/ping' });
    assert.equal(res.statusCode, 503, String(mode));
    assert.equal(res.json().error.code, 'auth_unavailable');
    assert.equal(w.handlerCalls.length, 0);
  }
});

test('UA10: unknown kid refetches the key set after the cooldown, not within it', async () => {
  const cooling = await world({ deps: { jwksCooldownMs: 60_000 } });
  await cooling.call({ path: '/ping' });
  assert.equal(cooling.ims.keyRequests, 1);
  const rotated = await generateKeyPair('RS256', { extractable: true });
  assert.equal((await cooling.call({ path: '/ping', token: await cooling.ims.signToken({ header: { kid: 'new' }, key: rotated.privateKey }) })).statusCode, 401);
  assert.equal(cooling.ims.keyRequests, 1, 'no refetch within the cooldown');

  const open = await world({ deps: { jwksCooldownMs: 0 } });
  await open.call({ path: '/ping' });
  const { exportJWK } = await import('jose');
  open.ims.keySet = {
    keys: [...open.ims.keySet.keys, {
      ...(await exportJWK(rotated.publicKey)), kid: 'new', alg: 'RS256', use: 'sig',
    }],
  };
  const res = await open.call({ path: '/ping', token: await open.ims.signToken({ header: { kid: 'new' }, key: rotated.privateKey }) });
  assert.equal(res.statusCode, 200);
  assert.equal(open.ims.keyRequests, 2);
});

test('UA11: two valid requests in one container -> one key-set fetch', async () => {
  const w = await world();
  await w.call({ path: '/ping' });
  await w.call({ path: '/ping' });
  assert.equal(w.ims.keyRequests, 1);
});

test('UA12: pipeline order: 401 before 404 before 405', async () => {
  const w = await world();
  assert.equal((await w.call({ path: '/nope', token: null })).statusCode, 401);
  const notFound = await w.call({ path: '/nope' });
  assert.equal(notFound.statusCode, 404);
  assert.equal(notFound.json().error.code, 'not_found');
  const wrong = await w.call({ path: '/ping', method: 'POST' });
  assert.equal(wrong.statusCode, 405);
  assert.equal(wrong.json().error.code, 'method_not_allowed');
});

test('UA13: OPTIONS preflight from an allowed origin needs no token and never reaches a handler', async () => {
  const w = await world();
  const res = await w.call({ path: '/ping', method: 'OPTIONS', token: null });
  assert.equal(res.statusCode, 204);
  assert.equal(w.handlerCalls.length, 0);
  assert.equal(w.ims.keyRequests, 0);
});

test('UA14: the token never appears in any response or log line', async () => {
  const w = await world();
  const tokens = [
    await w.ims.signToken(),
    await w.ims.signToken({ claims: { type: 'x' } }),
    await w.ims.signToken({ claims: { created_at: '1', expires_in: '1' } }),
    await w.ims.signToken({ claims: { client_id: 'evil' } }),
  ];
  const w2 = await world({ inputs: { ALLOWED_IMS_CLIENT_IDS: 'only-this' } });
  const w3 = await world();
  w3.ims.failWith = 500;
  const all = [];
  for (const t of tokens) {
    // eslint-disable-next-line no-await-in-loop
    all.push(await w.call({ path: '/ping', token: t }), await w2.call({ path: '/ping', token: t }), await w3.call({ path: '/ping', token: t }));
  }
  const dump = JSON.stringify(all) + [w, w2, w3].flatMap((x) => x.logs).join('\n');
  tokens.forEach((t) => assert.ok(!dump.includes(t)));
});

test('UA15: authorize hook false -> 403 forbidden; not called for unauthenticated requests', async () => {
  const seen = [];
  const w = await world({
    authorize: async ({ identity }) => {
      seen.push(identity.userId); return false;
    } });
  assert.equal((await w.call({ path: '/ping', token: null })).statusCode, 401);
  assert.deepEqual(seen, []);
  const res = await w.call({ path: '/ping' });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error.code, 'forbidden');
  assert.equal(w.handlerCalls.length, 0);
});
