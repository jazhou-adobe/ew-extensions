import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRegistry, validateProvider } from '../shell/provider.js';
import { connKeyOf } from '../shell/connections.js';
import dropbox from '../../providers/dropbox/worker/index.js';
import cloudinary from '../../providers/cloudinary/worker/index.js';
import { oauthWorld } from './support/oauth-world.js';
import { stubOAuth } from './support/stubs.js';
import {
  fakeOAuthDam, stubInputs, stubOAuthA, stubOAuthB,
} from './support/stub-oauth.js';

const MEMBERS = ['scopes', 'authorizeHosts', 'buildAuthorizeUrl', 'exchangeCode', 'refresh', 'accountName'];

async function world() {
  const clock = { now: Date.now() };
  const a = fakeOAuthDam({ hosts: ['t1.stuba.example'], rotating: true, now: () => clock.now });
  const b = fakeOAuthDam({ hosts: ['api.stubb.example'], rotating: false, now: () => clock.now });
  const w = await oauthWorld({
    providers: [cloudinary, dropbox, stubOAuthA(), stubOAuthB()],
    inputs: stubInputs,
    now: clock.now,
    extraVendors: [{ hosts: a.hosts, fake: a }, { hosts: b.hosts, fake: b }],
  });
  clock.now = w.clock.now;
  const fakes = { 'stub-oauth-a': a, 'stub-oauth-b': b };
  const codeParams = { 'stub-oauth-a': 'code', 'stub-oauth-b': 'authorization_code' };
  const signIn = (provider, user) => w.signIn({
    provider,
    user,
    authorize: (location) => {
      const url = new URL(location);
      const back = new URL(url.searchParams.get('redirect_uri'));
      back.searchParams.set('state', url.searchParams.get('state'));
      back.searchParams.set(codeParams[provider], fakes[provider].newCode());
      return back.href;
    },
  });
  // the fakes follow the world's clock
  Object.defineProperty(clock, 'now', { get: () => w.clock.now, set: (v) => { w.clock.now = v; } });
  return { w, a, b, signIn };
}

test('PO1: a complete user-oauth declaration registers; each missing or malformed member fails naming provider and member', () => {
  assert.doesNotThrow(() => buildRegistry([stubOAuth({ authorizeHosts: () => ['x.example'] })]));
  MEMBERS.forEach((member) => {
    const p = stubOAuth({ authorizeHosts: () => ['x.example'] });
    delete p[member];
    assert.throws(() => validateProvider(p), (e) => e.message.includes('"oauthdam"') && e.message.includes(`"${member}"`), member);
  });
  const bad = [{ callbackCodeParam: 'Bad-Param' }, { maxStateBytes: 10 }, { maxStateBytes: 99999 }, { rotatesRefreshToken: 'yes' },
    { requiresRefreshToken: 1 }, { revoke: 'nope' }, { scopes: [] }];
  bad.forEach((o) => assert.throws(() => validateProvider(stubOAuth({ authorizeHosts: () => ['x.example'], ...o })), /provider "oauthdam"/, JSON.stringify(o)));
});

test('PO4: two more OAuth providers join with one registry entry each and no shell change; they connect, browse, refresh and disconnect in isolation', async () => {
  const { w, a, b, signIn } = await world();
  const list = await w.call({ path: '/dam/providers' });
  assert.deepEqual(list.json().providers.map((p) => [p.id, p.connection.state]), [
    ['cloudinary', 'connected'], ['dropbox', 'not_connected'], ['stub-oauth-a', 'not_connected'], ['stub-oauth-b', 'not_connected']]);
  for (const id of ['stub-oauth-a', 'stub-oauth-b']) {
    // eslint-disable-next-line no-await-in-loop
    const flow = await signIn(id);
    assert.equal(flow.callback.statusCode, 200, id);
    assert.match(flow.cookie, new RegExp(`^dam_oauth_${id}=`), 'the cookie is bound to the provider');
  }
  assert.deepEqual((await w.call({ path: '/dam/stub-oauth-a/session' })).json().connection, { state: 'connected', account: 'Alex Rotating' });
  assert.deepEqual((await w.call({ path: '/dam/stub-oauth-b/session' })).json().connection, { state: 'connected', account: 'Sam Steady' });
  assert.equal((await w.call({ path: '/dam/dropbox/session' })).json().connection.state, 'not_connected', 'records are isolated');
  const found = await w.call({ path: '/dam/stub-oauth-a/assets' });
  assert.deepEqual(found.json().items.map((i) => i.id), ['a1', 'a2']);
  assert.equal((await w.call({ path: '/dam/stub-oauth-b/assets/a1' })).json().asset.renditions[0].url, 'https://cdn.stub-oauth-b.example/a1.jpg');
  const stateKeys = [...w.store.entries.keys()].filter((k) => k.includes('conn.v1'));
  assert.equal(stateKeys.length, 2);
  assert.notEqual(connKeyOf('user-1@AdobeID', 'stub-oauth-a'), connKeyOf('user-1@AdobeID', 'stub-oauth-b'));

  // rotating provider: the new refresh token replaces the old; non-rotating keeps its own
  const oldA = [...a.refreshTokens][0];
  const oldB = [...b.refreshTokens][0];
  w.clock.now += 2 * 3600_000;
  assert.equal((await w.call({ path: '/dam/stub-oauth-a/assets' })).statusCode, 200);
  assert.equal((await w.call({ path: '/dam/stub-oauth-b/assets' })).statusCode, 200);
  assert.deepEqual([...a.refreshTokens].filter((t) => t === oldA), [], 'rotated');
  assert.deepEqual([...b.refreshTokens], [oldB]);
  w.clock.now += 2 * 3600_000;
  assert.equal((await w.call({ path: '/dam/stub-oauth-a/assets' })).statusCode, 200, 'the stored rotated token works for the next refresh');
  assert.equal(a.count('/token'), 3);

  assert.equal((await w.call({ method: 'POST', path: '/dam/stub-oauth-a/disconnect' })).statusCode, 200);
  assert.equal(a.count('/revoke'), 1);
  assert.equal((await w.call({ path: '/dam/stub-oauth-a/session' })).json().connection.state, 'not_connected');
  assert.equal((await w.call({ path: '/dam/stub-oauth-b/session' })).json().connection.state, 'connected');
});

test('PO6: the provider never receives a refresh token, the IMS token, cookies or the inbound headers', async () => {
  const seen = [];
  const spy = stubOAuthA();
  const original = spy.search;
  spy.search = async (ctx, query) => { seen.push(ctx); return original(ctx, query); };
  const clock = { now: Date.now() };
  const a = fakeOAuthDam({ hosts: ['t1.stuba.example'], rotating: true, now: () => clock.now });
  const w = await oauthWorld({ providers: [spy], inputs: stubInputs, extraVendors: [{ hosts: a.hosts, fake: a }], now: clock.now });
  Object.defineProperty(clock, 'now', { get: () => w.clock.now });
  await w.signIn({
    provider: 'stub-oauth-a',
    authorize: (location) => {
      const url = new URL(location);
      const back = new URL(url.searchParams.get('redirect_uri'));
      back.searchParams.set('state', url.searchParams.get('state'));
      back.searchParams.set('code', a.newCode());
      return back.href;
    },
  });
  const token = await w.token();
  await w.call({ path: '/dam/stub-oauth-a/assets', token, headers: { cookie: 'session=abc', 'x-custom': 'y' } });
  const [ctx] = seen;
  assert.deepEqual(Object.keys(ctx.credentials).sort(), ['accessToken', 'account', 'scope']);
  const dump = JSON.stringify(ctx, (k, v) => (typeof v === 'function' ? undefined : v));
  [token, 'session=abc', 'x-custom', ...a.refreshTokens].forEach((s) => assert.ok(!dump.includes(s), s));
  assert.equal(ctx.identity, undefined);
  assert.equal(ctx.request, undefined);
  await assert.rejects(async () => ctx.proxy('https://evil.example/x', {}), /host is not allowed/);
});

test('PO8: with requiresRefreshToken false a connection without a refresh token is stored and becomes "reconnect" at expiry', async () => {
  const noRefresh = { ...stubOAuthB(), requiresRefreshToken: false };
  const clock = { now: Date.now() };
  const b = fakeOAuthDam({ hosts: ['api.stubb.example'], rotating: false, now: () => clock.now });
  const original = b.fetch.bind(b);
  b.fetch = async (url, init) => {
    const res = await original(url, init);
    if (!new URL(url).pathname.endsWith('/token')) return res;
    const body = await res.json();
    delete body.refresh_token;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const w = await oauthWorld({ providers: [noRefresh], inputs: stubInputs, extraVendors: [{ hosts: b.hosts, fake: b }], now: clock.now });
  Object.defineProperty(clock, 'now', { get: () => w.clock.now });
  const flow = await w.signIn({
    provider: 'stub-oauth-b',
    authorize: (location) => {
      const url = new URL(location);
      const back = new URL(url.searchParams.get('redirect_uri'));
      back.searchParams.set('state', url.searchParams.get('state'));
      back.searchParams.set('authorization_code', b.newCode());
      return back.href;
    },
  });
  assert.equal(flow.callback.statusCode, 200);
  assert.equal((await w.call({ path: '/dam/stub-oauth-b/assets' })).statusCode, 200);
  w.clock.now += 2 * 3600_000;
  const res = await w.call({ path: '/dam/stub-oauth-b/assets' });
  assert.equal(res.json().error.code, 'provider_reauth_required');
});

test('PO9: a rotating provider never refreshes without the lock: a held lock ends in 502, not in a lost refresh token', async () => {
  const { w, a, signIn } = await world();
  await signIn('stub-oauth-a');
  w.clock.now += 2 * 3600_000;
  await w.store.put(`lock.v1.${connKeyOf('user-1@AdobeID', 'stub-oauth-a')}`, 'other', { ttlSeconds: 600 });
  const res = await w.call({ path: '/dam/stub-oauth-a/assets' });
  assert.equal(res.statusCode, 502);
  assert.equal(a.count('/token'), 1, 'only the original exchange');
});

test('PO10: a flow for a provider that is not configured, or not an OAuth provider, goes nowhere', async () => {
  const { w } = await world();
  const noBegin = await w.oauthCall({ path: '/cloudinary/begin', query: 'ticket=x' });
  assert.equal(noBegin.statusCode, 400);
  assert.equal(noBegin.headers['set-cookie'], undefined);
  const w2 = await oauthWorld({ providers: [cloudinary, dropbox, stubOAuthA()], inputs: {} });
  assert.deepEqual((await w2.call({ path: '/dam/providers' })).json().providers.map((p) => p.id), ['cloudinary', 'dropbox']);
});

test('PO11: an authorize URL that leaves the declared hosts, drops the state or carries a secret is never redirected to', async () => {
  const mk = (build) => ({ ...stubOAuthA(), buildAuthorizeUrl: build });
  const bad = [
    () => 'https://evil.example/authorize',
    (ctx, { state }) => `https://auth.stuba.example/authorize?state=${state}x&redirect_uri=x`,
    (ctx, { state, redirectUri }) => `http://auth.stuba.example/authorize?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    (ctx, { state, redirectUri }) => `https://auth.stuba.example/authorize?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=zzz`,
    (ctx, { state, redirectUri }) => `https://auth.stuba.example/authorize?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}&k=${ctx.secret('STUBOAUTHA_SECRET')}`,
    () => { throw new Error('boom'); },
  ];
  for (const build of bad) {
    // eslint-disable-next-line no-await-in-loop
    const w = await oauthWorld({ providers: [mk(build)], inputs: stubInputs });
    // eslint-disable-next-line no-await-in-loop
    const flow = await w.signIn({ provider: 'stub-oauth-a', until: 'begin' });
    assert.equal(flow.beginRes.statusCode, 400);
    assert.equal(flow.beginRes.headers['set-cookie'], undefined);
    assert.equal(flow.beginRes.headers.location, undefined);
  }
});
