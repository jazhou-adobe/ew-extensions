import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connKeyOf } from '../shell/connections.js';
import { oauthWorld, CLIENT_SECRET, TOKEN_ENC_KEY } from './support/oauth-world.js';

const HOUR = 3600_000;
const search = (w, extra = {}) => w.call({ path: '/dam/dropbox/assets', query: { q: 'beach' }, ...extra });
const refreshes = (w) => w.dbx.requests.filter((r) => r.path === '/oauth2/token' && r.text.includes('refresh_token'));
const records = (w) => [...w.store.entries.values()].map((e) => e.value);

async function connected(options) {
  const w = await oauthWorld(options);
  assert.equal((await w.signIn()).callback.statusCode, 200);
  return w;
}

test('RF1: an access token about to expire is refreshed once, silently, with the refresh token and the app credentials', async () => {
  const w = await connected();
  assert.equal((await search(w)).statusCode, 200);
  assert.equal(refreshes(w).length, 0, 'a fresh token is used as is');
  const refreshToken = [...w.dbx.refreshTokens][0];
  w.clock.now += 4 * HOUR - 30_000;
  const res = await search(w);
  assert.equal(res.statusCode, 200);
  assert.equal(refreshes(w).length, 1);
  const form = new URLSearchParams(refreshes(w)[0].text);
  assert.equal(form.get('refresh_token'), refreshToken);
  assert.ok(refreshes(w)[0].headers.authorization.startsWith('Basic '));
  assert.deepEqual([...w.dbx.refreshTokens], [refreshToken], 'the refresh token never changes');
  const searches = w.dbx.requests.filter((r) => r.path.endsWith('search_v2'));
  assert.notEqual(searches[0].headers.authorization, searches[1].headers.authorization, 'the new access token is used');
  assert.equal((await search(w)).statusCode, 200);
  assert.equal(refreshes(w).length, 1, 'the refreshed record was stored');
  assert.equal(w.store.puts.at(-1).ttl, 180 * 86400, 'retention is explicit');
});

test('RF2: parallel requests after expiry share one refresh', async () => {
  const w = await connected();
  w.clock.now += 5 * HOUR;
  const all = await Promise.all([1, 2, 3, 4, 5].map(() => search(w)));
  all.forEach((r) => assert.equal(r.statusCode, 200));
  assert.equal(refreshes(w).length, 1);
});

test('RF3: a token the vendor rejects forces exactly one refresh and one retry', async () => {
  const w = await connected();
  w.dbx.expireAccessTokens();
  const res = await search(w);
  assert.equal(res.statusCode, 200);
  assert.equal(refreshes(w).length, 1);
  assert.equal(w.dbx.requests.filter((r) => r.path.endsWith('search_v2')).length, 2);
  // a vendor that keeps rejecting: one refresh, one retry, then the connection must be renewed
  const w2 = await connected();
  w2.dbx.inject('search_v2', { status: 401, headers: { 'content-type': 'application/json' }, body: '{"error":{".tag":"invalid_access_token"}}' }, { times: 9 });
  const res2 = await search(w2);
  assert.equal(res2.statusCode, 409);
  assert.equal(res2.json().error.code, 'provider_reauth_required');
  assert.equal(refreshes(w2).length, 1);
  assert.equal(w2.dbx.requests.filter((r) => r.path.endsWith('search_v2')).length, 2);
  assert.equal((await w2.call({ path: '/dam/dropbox/session' })).json().connection.state, 'reauth_required');
});

test('RF4: a revoked grant makes the connection "reconnect": tokens destroyed, no loop, Connect works again', async () => {
  const w = await connected();
  const before = records(w)[0];
  w.dbx.revokeAll();
  w.clock.now += 5 * HOUR;
  const res = await search(w);
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().error.code, 'provider_reauth_required');
  assert.deepEqual((await w.call({ path: '/dam/dropbox/session' })).json().connection, { state: 'reauth_required', account: 'Pat Example' });
  assert.equal((await w.call({ path: '/dam/providers' })).json().providers[1].connection.state, 'reauth_required');
  const tokenCalls = w.dbx.count('/oauth2/token');
  assert.equal((await search(w)).json().error.code, 'provider_reauth_required');
  assert.equal(w.dbx.count('/oauth2/token'), tokenCalls, 'no refresh loop');
  assert.notEqual(records(w)[0], before, 'the tokens are gone');
  assert.equal((await w.signIn()).callback.statusCode, 200);
  assert.equal((await search(w)).statusCode, 200);
});

test('RF5: invalid_client on refresh is a misconfiguration: the record is kept and no reconnect is demanded', async () => {
  const w = await connected();
  w.clock.now += 5 * HOUR;
  w.dbx.inject('/oauth2/token', { status: 400, headers: { 'content-type': 'application/json' }, body: '{"error":"invalid_client: Invalid client_id or client_secret"}' });
  const res = await search(w);
  assert.equal(res.statusCode, 500);
  assert.equal(res.json().error.code, 'misconfigured');
  assert.equal((await w.call({ path: '/dam/dropbox/session' })).json().connection.state, 'connected');
  assert.equal((await search(w)).statusCode, 200, 'once the app credentials are fixed the connection works again');
});

test('RF6: a transient failure on refresh is a 502 and keeps the record', async () => {
  const w = await connected();
  w.clock.now += 5 * HOUR;
  w.dbx.inject('/oauth2/token', { status: 503, body: 'down' }, { times: 6 });
  const res = await search(w);
  assert.equal(res.statusCode, 502);
  assert.equal((await w.call({ path: '/dam/dropbox/session' })).json().connection.state, 'connected');
  assert.equal((await search(w)).statusCode, 200);
});

test('RF7: a refresh does not resurrect a connection that was disconnected meanwhile', async () => {
  const w = await connected();
  w.clock.now += 5 * HOUR;
  w.dbx.inject('/oauth2/token', { status: 200, headers: { 'content-type': 'application/json' }, body: '{"access_token":"AT-late","expires_in":14400}' });
  const original = w.store.putIf.bind(w.store);
  w.store.putIf = async (key, value, opts) => {
    if (key.startsWith('conn.') && opts.when === 'present') await w.store.delete(key);
    return original(key, value, opts);
  };
  const res = await search(w);
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().error.code, 'provider_not_connected');
  assert.ok(![...w.store.entries.keys()].some((k) => k.includes('conn.v1')));
});

test('RF8: the refresh lock: a held lock is waited for; a provider with a stable refresh token then refreshes anyway', async () => {
  const w = await connected();
  w.clock.now += 5 * HOUR;
  await w.store.put(`lock.v1.${connKeyOf('user-1@AdobeID', 'dropbox')}`, 'another-container', { ttlSeconds: 600 });
  const res = await search(w);
  assert.equal(res.statusCode, 200);
  assert.ok(w.sleeps.length >= 10, 'it polled for the other container');
  assert.equal(refreshes(w).length, 1);
  assert.equal(await w.store.get(`lock.v1.${connKeyOf('user-1@AdobeID', 'dropbox')}`), 'another-container', 'a lock that is not ours is never released');
});

test('RF9: the lock is taken for the refresh and released afterwards', async () => {
  const w = await connected();
  w.clock.now += 5 * HOUR;
  await search(w);
  assert.equal([...w.store.entries.keys()].filter((k) => k.includes('lock.v1')).length, 0);
  assert.ok(w.store.puts.some((p) => p.key.includes('lock.v1') && p.ttl === 20));
});

test('SC1: no secret, token or sealed value ever reaches a response or a log line', async () => {
  const w = await connected();
  const seen = [];
  const record = async (p) => { const r = await p; seen.push(r.body, JSON.stringify(r.headers)); return r; };
  await record(w.call({ path: '/dam/providers' }));
  await record(search(w));
  w.clock.now += 5 * HOUR;
  await record(search(w));
  await record(w.call({ path: '/dam/dropbox/assets/id%3Afile1' }));
  w.dbx.revokeAll();
  w.clock.now += 5 * HOUR;
  await record(search(w));
  await record(w.call({ method: 'POST', path: '/dam/dropbox/disconnect' }));
  const flow = await w.signIn();
  seen.push(flow.callback.body, JSON.stringify(flow.callback.headers), flow.beginRes.headers.location);
  const text = [...seen, ...w.logs].join('\n');
  const secrets = [CLIENT_SECRET, TOKEN_ENC_KEY, w.inputs.OAUTH_STATE_KEY, ...w.dbx.accessTokens.keys(), ...w.dbx.refreshTokens, w.dbx.requests.map((r) => r.headers.authorization).find((h) => h?.startsWith('Basic ')).slice(6)];
  secrets.forEach((s) => assert.ok(!text.includes(s), `leaked: ${s.slice(0, 8)}…`));
  assert.ok(!text.includes('Bearer AT-'));
});

test('TS1: records are bound to their key (a copied record does not open), a previous key still opens old records, tampering is "not connected"', async () => {
  const w = await connected();
  const [[key, entry]] = [...w.store.entries.entries()];
  const stored = entry.value;
  // moved to another user's key: authenticated data differs
  const other = connKeyOf('user-2@AdobeID', 'dropbox');
  w.store.entries.set(`multi-dam-picker.conn.v1.${other}`, { value: stored, expiresAt: Infinity });
  assert.equal((await w.call({ user: 'user-2@AdobeID', path: '/dam/dropbox/session' })).json().connection.state, 'not_connected');
  assert.ok(w.logs.some((l) => l.includes('record_unreadable')));
  // tampered ciphertext
  w.store.entries.set(key, { value: JSON.stringify(`${JSON.parse(stored).slice(0, -4)}AAAA`), expiresAt: Infinity });
  assert.equal((await w.call({ path: '/dam/dropbox/session' })).json().connection.state, 'not_connected');
  w.store.entries.set(key, { value: stored, expiresAt: Infinity });
  assert.equal((await w.call({ path: '/dam/dropbox/session' })).json().connection.state, 'connected');
});

test('TS2: rotating TOKEN_ENC_KEY: with the old key as TOKEN_ENC_KEY_PREVIOUS existing connections keep working; without it they do not', async () => {
  const w = await connected();
  const newKey = Buffer.alloc(32, 7).toString('base64');
  const rotate = async (inputs) => {
    const w2 = await oauthWorld({ inputs });
    w2.store.entries.clear();
    w.store.entries.forEach((v, k) => w2.store.entries.set(k, v));
    return w2.call({ path: '/dam/dropbox/session' });
  };
  assert.equal((await rotate({ TOKEN_ENC_KEY: newKey, TOKEN_ENC_KEY_PREVIOUS: TOKEN_ENC_KEY })).json().connection.state, 'connected');
  assert.equal((await rotate({ TOKEN_ENC_KEY: newKey })).json().connection.state, 'not_connected');
});

test('TS3: a store outage is a 503 with a fixed message and never a fake "not connected"', async () => {
  const w = await connected();
  w.store.get = async () => { const { HttpError } = await import('../../../../shared/worker-template/src/index.js'); throw new HttpError('store_unavailable'); };
  const res = await w.call({ path: '/dam/dropbox/session' });
  assert.equal(res.statusCode, 503);
  assert.equal((await w.call({ path: '/dam/cloudinary/assets' })).statusCode, 200, 'Cloudinary does not depend on the OAuth store');
});

test('CN1: the result cache of an OAuth provider is per author, in memory only, checked behind the connection, dropped on disconnect', async () => {
  const w = await oauthWorld({ inputs: { DROPBOX_CACHE_SECONDS: '30' } });
  await w.signIn({ user: 'a@AdobeID' });
  await w.signIn({ user: 'b@AdobeID' });
  const q = (user) => w.call({ user, path: '/dam/dropbox/assets', query: { q: 'beach' } });
  assert.equal((await q('a@AdobeID')).statusCode, 200);
  const calls = () => w.dbx.count('search_v2');
  const first = calls();
  assert.equal((await q('a@AdobeID')).statusCode, 200);
  assert.equal(calls(), first, 'second identical request is served from memory');
  assert.equal((await q('b@AdobeID')).statusCode, 200);
  assert.equal(calls(), first + 1, 'another author never shares an entry');
  assert.ok(![...w.store.entries.keys()].some((k) => k.includes('cache')), 'no result is ever written to State');
  await w.call({ user: 'a@AdobeID', method: 'POST', path: '/dam/dropbox/disconnect' });
  assert.equal((await q('a@AdobeID')).json().error.code, 'provider_not_connected', 'a cached answer is never served without a connection');
});
