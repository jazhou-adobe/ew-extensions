import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oauthWorld, OAUTH_BASE, CLIENT_SECRET } from './support/oauth-world.js';

const state = (w) => [...w.store.entries.entries()];
const everything = (w, ...responses) => [...w.logs, ...responses.map((r) => JSON.stringify([r.body, r.headers]))].join('\n');

test('OA1: connect needs a token and an OAuth provider; it returns a one-time begin URL on the configured OAuth base', async () => {
  const w = await oauthWorld();
  assert.equal((await w.call({ method: 'POST', path: '/dam/dropbox/connect', token: null })).statusCode, 401);
  for (const path of ['/dam/cloudinary/connect', '/dam/unknown/connect', '/dam/__proto__/connect']) {
    assert.equal((await w.call({ method: 'POST', path })).statusCode, 404, path);
  }
  assert.equal((await w.call({ method: 'GET', path: '/dam/dropbox/connect' })).statusCode, 404);
  const res = await w.call({ method: 'POST', path: '/dam/dropbox/connect' });
  assert.equal(res.statusCode, 200);
  const url = new URL(res.json().beginUrl);
  assert.equal(`${url.origin}${url.pathname}`, `${OAUTH_BASE}/dropbox/begin`);
  assert.ok(url.searchParams.get('ticket').length > 40);
  assert.ok(!res.body.includes('user-1'), 'the user id is not in the ticket in clear');
  assert.equal(state(w).length, 0, 'connect stores nothing');
});

test('OA2: begin sets the binding cookie and redirects to the vendor with the exact state and redirect URI, no secret, no cache', async () => {
  const w = await oauthWorld();
  const { beginRes } = await w.signIn({ until: 'begin' });
  assert.equal(beginRes.statusCode, 302);
  const to = new URL(beginRes.headers.location);
  assert.equal(`${to.origin}${to.pathname}`, 'https://www.dropbox.com/oauth2/authorize');
  assert.equal(to.searchParams.get('response_type'), 'code');
  assert.equal(to.searchParams.get('token_access_type'), 'offline');
  assert.equal(to.searchParams.get('redirect_uri'), `${OAUTH_BASE}/dropbox/callback`);
  assert.equal(to.searchParams.get('scope'), 'account_info.read files.metadata.read files.content.read sharing.read sharing.write');
  assert.ok(Buffer.byteLength(to.searchParams.get('state')) <= 2000);
  assert.ok(!to.search.includes('client_secret') && !to.search.includes('code_challenge') && !beginRes.headers.location.includes(CLIENT_SECRET));
  const cookie = beginRes.headers['set-cookie'];
  assert.match(cookie, /^dam_oauth_dropbox=[A-Za-z0-9_-]{20,}; Max-Age=600; Path=\/api\/v1\/web\/multi-dam-picker\/oauth; HttpOnly; SameSite=Lax; Secure$/);
  assert.equal(beginRes.headers['cache-control'], 'no-store');
  assert.equal(beginRes.headers['referrer-policy'], 'no-referrer');
  assert.equal(beginRes.headers['access-control-allow-origin'], undefined);
  assert.equal(state(w).length, 0, 'begin stores nothing');
});

test('OA3: callback exchanges the code once, stores an encrypted record and the session reports the account', async () => {
  const w = await oauthWorld();
  assert.deepEqual((await w.call({ path: '/dam/dropbox/session' })).json(), { connection: { state: 'not_connected' } });
  const list = await w.call({ path: '/dam/providers' });
  assert.deepEqual(list.json().providers.map((p) => [p.id, p.credentialKind, p.connection.state]), [['cloudinary', 'service', 'connected'], ['dropbox', 'user-oauth', 'not_connected']]);

  const { callback } = await w.signIn();
  assert.equal(callback.statusCode, 200);
  assert.equal(callback.headers['content-type'], 'text/html; charset=utf-8');
  assert.match(callback.headers['content-security-policy'], /default-src 'none'/);
  assert.match(callback.headers['set-cookie'], /Max-Age=0/, 'the binding cookie is cleared');
  assert.equal(w.dbx.count('/oauth2/token'), 1);
  const exchange = w.dbx.requests.find((r) => r.path === '/oauth2/token');
  const form = new URLSearchParams(exchange.text);
  assert.equal(form.get('grant_type'), 'authorization_code');
  assert.equal(form.get('redirect_uri'), `${OAUTH_BASE}/dropbox/callback`);
  assert.ok(exchange.headers.authorization.startsWith('Basic '));
  assert.equal(w.dbx.count('get_current_account'), 1);

  assert.deepEqual((await w.call({ path: '/dam/dropbox/session' })).json(), { connection: { state: 'connected', account: 'Pat Example' } });
  const entries = state(w);
  assert.equal(entries.length, 1);
  assert.match(entries[0][0], /^multi-dam-picker\.conn\.v1\./);
  const refresh = [...w.dbx.refreshTokens][0];
  const access = [...w.dbx.accessTokens.keys()][0];
  entries.forEach(([, v]) => assert.ok(!v.value.includes(refresh) && !v.value.includes(access) && !v.value.includes('Pat'), 'ciphertext only'));
  assert.ok(everything(w, callback).indexOf(refresh) < 0);
  assert.ok(everything(w, callback).indexOf(access) < 0);
});

test('OA4: the callback refuses a missing or wrong cookie, a tampered, foreign or expired state and a vendor error; nothing is stored', async () => {
  const w = await oauthWorld();
  const ok = await w.signIn();
  assert.equal(ok.callback.statusCode, 200);
  w.store.entries.clear();

  const flow = await w.signIn({ until: 'authorize' });
  const q = flow.back.search.slice(1);
  const params = new URLSearchParams(q);
  const call = (query, headers) => w.oauthCall({ path: '/dropbox/callback', query, headers });
  const failures = [
    await call(q, {}),
    await call(q, { cookie: 'dam_oauth_dropbox=wrong' }),
    await call(q, { cookie: `dam_oauth_other=${flow.cookie.split('=')[1]}` }),
    await call(`code=${params.get('code')}&state=${params.get('state').slice(0, -3)}AAA`, { cookie: flow.cookie }),
    await call(`code=${params.get('code')}`, { cookie: flow.cookie }),
    await call(`error=access_denied&state=${params.get('state')}`, { cookie: flow.cookie }),
    await call(`state=${params.get('state')}`, { cookie: flow.cookie }),
  ];
  failures.forEach((r, i) => {
    assert.equal(r.statusCode, 400, `case ${i}`);
    assert.match(r.body, /Could not connect/);
    assert.ok(!r.body.includes(params.get('state')) && !r.body.includes(params.get('code')), 'nothing reflected');
  });
  assert.equal(state(w).length, 0);
  assert.equal(w.dbx.count('/oauth2/token'), 1, 'only the first, valid flow reached the token endpoint');
  w.clock.now += 11 * 60_000;
  const late = await call(q, { cookie: flow.cookie });
  assert.equal(late.statusCode, 400, 'an expired state is refused');
  w.clock.now -= 11 * 60_000;
  const good = await call(q, { cookie: flow.cookie });
  assert.equal(good.statusCode, 200, 'the untouched flow still completes');
});

test('OA5: login-CSRF: a flow started in one browser cannot be completed in another; the code is single use', async () => {
  const w = await oauthWorld();
  const attacker = await w.signIn({ user: 'attacker@AdobeID', until: 'authorize' });
  const query = attacker.back.search.slice(1);
  // the victim's browser follows the attacker's link: it has no binding cookie (or one of another flow)
  const victim = await w.signIn({ user: 'victim@AdobeID', until: 'begin' });
  for (const headers of [{}, { cookie: victim.cookie }]) {
    // eslint-disable-next-line no-await-in-loop
    const res = await w.oauthCall({ path: '/dropbox/callback', query, headers });
    assert.equal(res.statusCode, 400);
  }
  assert.equal(state(w).length, 0);
  assert.equal(w.dbx.count('/oauth2/token'), 0, 'the code never reached the token endpoint');
  const done = await w.oauthCall({ path: '/dropbox/callback', query, headers: { cookie: attacker.cookie } });
  assert.equal(done.statusCode, 200);
  const replay = await w.oauthCall({ path: '/dropbox/callback', query, headers: { cookie: attacker.cookie } });
  assert.equal(replay.statusCode, 400, 'the code is single use at the vendor');
  assert.equal(state(w).length, 1);
});

test('OA6: begin rejects a missing, tampered, expired or wrong-provider ticket and answers the same generic page', async () => {
  const w = await oauthWorld();
  const ticket = new URL((await w.call({ method: 'POST', path: '/dam/dropbox/connect' })).json().beginUrl).searchParams.get('ticket');
  const bad = [undefined, 'x', `${ticket.slice(0, -2)}zz`, ticket.replace(/^[^.]+/, '00000000')];
  for (const t of bad) {
    // eslint-disable-next-line no-await-in-loop
    const res = await w.oauthCall({ path: '/dropbox/begin', query: t ? `ticket=${encodeURIComponent(t)}` : '' });
    assert.equal(res.statusCode, 400);
    assert.equal(res.headers['set-cookie'], undefined, 'no cookie without a valid ticket');
  }
  assert.equal((await w.oauthCall({ path: '/cloudinary/begin', query: `ticket=${encodeURIComponent(ticket)}` })).statusCode, 400);
  w.clock.now += 61_000;
  assert.equal((await w.oauthCall({ path: '/dropbox/begin', query: `ticket=${encodeURIComponent(ticket)}` })).statusCode, 400);
  for (const path of ['/', '/dropbox', '/dropbox/other', '/dropbox/begin/x', '/__proto__/begin']) {
    // eslint-disable-next-line no-await-in-loop
    const res = await w.oauthCall({ path });
    assert.equal(res.statusCode, 400, path);
    assert.match(res.body, /Could not connect/);
  }
  assert.equal((await w.oauthCall({ path: '/dropbox/begin', method: 'POST' })).statusCode, 405);
  assert.equal((await w.oauthCall({ path: '/dropbox/callback', method: 'POST' })).statusCode, 405);
});

test('OA7: connections are per author and per provider; the key never contains the raw user id', async () => {
  const w = await oauthWorld();
  await w.signIn({ user: 'a@AdobeID' });
  assert.equal((await w.call({ user: 'a@AdobeID', path: '/dam/dropbox/session' })).json().connection.state, 'connected');
  assert.equal((await w.call({ user: 'b@AdobeID', path: '/dam/dropbox/session' })).json().connection.state, 'not_connected');
  assert.equal((await w.call({ user: 'b@AdobeID', path: '/dam/dropbox/assets' })).json().error.code, 'provider_not_connected');
  state(w).forEach(([k]) => assert.ok(!k.includes('a@') && !k.includes('AdobeID')));
  assert.equal((await w.call({ path: '/dam/cloudinary/session' })).statusCode, 404, 'a service provider has no session');
});

test('OA8: disconnect revokes upstream once (best effort), deletes the record and is idempotent', async () => {
  const w = await oauthWorld();
  await w.signIn();
  const res = await w.call({ method: 'POST', path: '/dam/dropbox/disconnect' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { connection: { state: 'not_connected' } });
  assert.equal(w.dbx.count('token/revoke'), 1);
  assert.equal(w.dbx.refreshTokens.size, 0, 'the grant is revoked at the vendor');
  assert.equal(state(w).length, 0);
  assert.equal((await w.call({ path: '/dam/dropbox/session' })).json().connection.state, 'not_connected');
  assert.equal((await w.call({ method: 'POST', path: '/dam/dropbox/disconnect' })).statusCode, 200);
  assert.equal(w.dbx.count('token/revoke'), 1, 'nothing left to revoke');
  // a failing revoke still deletes the record
  await w.signIn();
  w.dbx.inject('token/revoke', { status: 500, body: 'x' }, { times: 5 });
  assert.equal((await w.call({ method: 'POST', path: '/dam/dropbox/disconnect' })).statusCode, 200);
  assert.equal(state(w).length, 0);
});

test('OA9: a grant without a refresh token or with a missing scope is refused and revoked; nothing is stored', async () => {
  const w = await oauthWorld();
  const missing = await w.signIn({ scope: 'account_info.read files.metadata.read' });
  assert.equal(missing.callback.statusCode, 400);
  assert.equal(state(w).length, 0);
  assert.equal(w.dbx.count('token/revoke'), 1);
  const w2 = await oauthWorld();
  const flow = await w2.signIn({});
  assert.equal(flow.callback.statusCode, 200);
  const w3 = await oauthWorld({ dropbox: {} });
  // a vendor that ignores offline access: patch the fake so the exchange yields no refresh token
  w3.dbx.inject('/oauth2/token', {
    status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ access_token: 'AT-x', expires_in: 100, scope: 'account_info.read files.metadata.read files.content.read sharing.read sharing.write' }),
  });
  const norefresh = await w3.signIn();
  assert.equal(norefresh.callback.statusCode, 400);
  assert.equal(state(w3).length, 0);
});

test('OA10: when the account lookup fails after a good exchange nothing is stored and the grant is revoked', async () => {
  const w = await oauthWorld();
  w.dbx.inject('get_current_account', { status: 500, body: 'no' }, { times: 5 });
  const { callback } = await w.signIn();
  assert.equal(callback.statusCode, 400);
  assert.equal(state(w).length, 0);
  assert.equal(w.dbx.count('token/revoke'), 1);
});

test('OA11: the OAuth host needs all three settings; Cloudinary alone keeps working and Dropbox is simply absent', async () => {
  for (const blank of [{ OAUTH_PUBLIC_BASE_URL: '' }, { TOKEN_ENC_KEY: '' }, { OAUTH_STATE_KEY: '' }, { DROPBOX_CLIENT_ID: '' }, { DROPBOX_CLIENT_SECRET: '' }, { DROPBOX_CLIENT_ID: '$DROPBOX_CLIENT_ID' }]) {
    // eslint-disable-next-line no-await-in-loop
    const w = await oauthWorld({ inputs: blank });
    // eslint-disable-next-line no-await-in-loop
    const list = await w.call({ path: '/dam/providers' });
    assert.deepEqual(list.json().providers.map((p) => p.id), ['cloudinary'], JSON.stringify(blank));
    // eslint-disable-next-line no-await-in-loop
    assert.equal((await w.call({ path: '/dam/dropbox/assets' })).statusCode, 404);
    // eslint-disable-next-line no-await-in-loop
    assert.equal((await w.call({ method: 'POST', path: '/dam/dropbox/connect' })).statusCode, 404);
    // eslint-disable-next-line no-await-in-loop
    assert.equal((await w.oauthCall({ path: '/dropbox/begin' })).statusCode, 400);
  }
});

test('OA12: invalid present OAuth settings are a misconfiguration naming the setting, never the value', async () => {
  const bad = [
    { OAUTH_PUBLIC_BASE_URL: 'http://evil.example/api/v1/web/multi-dam-picker/oauth' },
    { OAUTH_PUBLIC_BASE_URL: 'https://evil.example/api/v1/web/multi-dam-picker/oauth' },
    { OAUTH_PUBLIC_BASE_URL: 'https://x.adobeioruntime.net/api/v1/web/multi-dam-picker/api' },
    { OAUTH_PUBLIC_BASE_URL: 'https://u:p@x.adobeioruntime.net/api/v1/web/multi-dam-picker/oauth' },
    { TOKEN_ENC_KEY: 'tooshort' },
    { OAUTH_STATE_KEY: 'tooshort' },
    { CONNECTION_TTL_DAYS: '0' },
    { CONNECTION_TTL_DAYS: 'x' },
  ];
  for (const inputs of bad) {
    // eslint-disable-next-line no-await-in-loop
    const w = await oauthWorld({ inputs });
    // eslint-disable-next-line no-await-in-loop
    const res = await w.call({ path: '/dam/providers' });
    assert.equal(res.statusCode, 500, JSON.stringify(inputs));
    assert.ok(w.logs.some((l) => l.includes('config_invalid')));
    const value = Object.values(inputs)[0];
    if (value.length > 8) assert.ok(!w.logs.join('\n').includes(value), 'the value is never logged');
  }
  const same = await oauthWorld();
  const w = await oauthWorld({ inputs: { OAUTH_STATE_KEY: same.inputs.TOKEN_ENC_KEY } });
  assert.equal((await w.call({ path: '/dam/providers' })).statusCode, 500, 'the two keys must differ');
});

test('TS4: the purge script prints exactly the State key a connection is stored under', async () => {
  const { stateKeyFor } = await import('../scripts/connection-key.mjs');
  const w = await oauthWorld();
  await w.signIn({ user: 'purge-me@AdobeID' });
  assert.ok(w.store.entries.has(stateKeyFor('purge-me@AdobeID', 'dropbox')));
  assert.ok(!w.store.entries.has(stateKeyFor('purge-me@AdobeID', 'cloudinary')));
});
