import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dropboxWorld } from './support/dropbox-world.js';
import dropbox from '../index.js';
import { buildRegistry } from '../../../../worker/shell/provider.js';
import { resolveConfig } from '../config.js';
import { CLIENT_SECRET, oauthWorld } from '../../../../worker/test/support/oauth-world.js';
import cloudinary from '../../../cloudinary/worker/index.js';

const json = (status, body, headers = {}) => ({
  status, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});
const tags = (...t) => ({ error_summary: t.join('/'), error: t.reduceRight((acc, tag) => ({ '.tag': tag, ...(acc ? { [tag]: acc } : {}) }), undefined) });

test('DBX-ER1: a 401 with a rejected-token tag is "reauth required": the shell refreshes once and retries', async () => {
  for (const tag of ['invalid_access_token', 'expired_access_token', 'missing_scope', 'user_suspended']) {
    // eslint-disable-next-line no-await-in-loop
    const w = await dropboxWorld();
    w.dbx.inject('search_v2', json(401, { error: { '.tag': tag } }));
    // eslint-disable-next-line no-await-in-loop
    const res = await w.search({ q: 'beach' });
    assert.equal(res.statusCode, 200, tag);
    assert.equal(w.dbx.requests.filter((r) => r.path === '/oauth2/token' && r.text.includes('refresh_token')).length, 1, tag);
  }
  const odd = await dropboxWorld();
  odd.dbx.inject('search_v2', json(401, { error: { '.tag': 'something_new' } }), { times: 5 });
  const res = await odd.search({ q: 'beach' });
  assert.equal(res.statusCode, 500, 'a vocabulary surprise is not "reconnect"');
  assert.equal(res.json().error.code, 'misconfigured');
});

test('DBX-ER2/ER3: 429 keeps Retry-After, 5xx is upstream unavailable, 403 is forbidden, path/not_found is 404; no upstream text anywhere', async () => {
  const check = async (inject, status, code, extra = {}) => {
    const w = await dropboxWorld();
    w.dbx.inject(extra.match || 'search_v2', inject, { times: 9 });
    const res = extra.detail ? await w.detail('id:file1') : await w.search({ q: 'beach' });
    assert.equal(res.statusCode, status);
    assert.equal(res.json().error.code, code);
    assert.ok(!/error_summary|too_many|no_permission|path\/not_found|boom/.test(res.body));
    return res;
  };
  const limited = await check(json(429, { error: { reason: { '.tag': 'too_many_requests' }, retry_after: 7 }, error_summary: 'too_many_requests/' }, { 'retry-after': '7' }), 429, 'rate_limited');
  assert.equal(limited.headers['retry-after'], '7');
  await check(json(500, { error_summary: 'boom' }), 502, 'upstream_unavailable');
  await check(json(403, tags('no_permission')), 403, 'forbidden');
  await check(json(409, tags('path', 'not_found')), 404, 'not_found', { detail: true, match: 'get_metadata' });
  await check(json(409, tags('invalid_argument')), 400, 'bad_request');
  await check({ status: 200, body: '<html>nope</html>', headers: { 'content-type': 'text/html' } }, 502, 'upstream_unavailable');
});

test('DBX-ER4: read-only RPCs and the refresh grant are retried on 5xx; the code exchange and revoke are not; link creation is retried without a second link', async () => {
  const w = await dropboxWorld();
  w.dbx.inject('search_v2', json(500, {}), { times: 2 });
  assert.equal((await w.search({ q: 'beach' })).statusCode, 200);
  assert.equal(w.rpcs('search_v2').length, 3);
  const links = await dropboxWorld();
  // the first create succeeds at Dropbox but the answer is lost; the retry gets "already exists"
  const real = links.dbx.fetch.bind(links.dbx);
  let lost = false;
  links.dbx.fetch = async (url, init) => {
    const res = await real(url, init);
    if (String(url).endsWith('create_shared_link_with_settings') && !lost) {
      lost = true;
      return new Response('boom', { status: 503 });
    }
    return res;
  };
  const res = await links.detail('id:file1');
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().asset.insertable.ok, true);
  assert.equal(links.dbx.links.get('id:file1').length, 1, 'one link only');
  const exchange = await oauthWorld();
  exchange.dbx.inject('/oauth2/token', json(503, {}), { times: 9 });
  const flow = await exchange.signIn();
  assert.equal(flow.callback.statusCode, 400);
  assert.equal(exchange.dbx.count('/oauth2/token'), 1, 'the single-use code exchange is never retried');
  const revoke = await dropboxWorld();
  revoke.dbx.inject('token/revoke', json(500, {}), { times: 9 });
  await revoke.call({ method: 'POST', path: '/dam/dropbox/disconnect' });
  assert.equal(revoke.dbx.count('token/revoke'), 1);
  const gone = await dropboxWorld();
  gone.dbx.inject('token/revoke', json(401, tags('invalid_access_token')));
  assert.equal((await gone.call({ method: 'POST', path: '/dam/dropbox/disconnect' })).statusCode, 200);
  assert.ok(!gone.logs.some((l) => l.includes('revoke_failed')), 'a 401 on revoke counts as success');
});

test('DBX-ER5/ER6: across connect, browse, detail, refresh, revoke and errors no secret or token leaks, and only the two API hosts are contacted', async () => {
  const w = await dropboxWorld();
  const bodies = [];
  const note = async (p) => { const r = await p; bodies.push(r.body, JSON.stringify(r.headers)); return r; };
  await note(w.search({ q: 'beach' }));
  await note(w.detail('id:file1'));
  w.dbx.inject('search_v2', json(500, { error_summary: `leak ${CLIENT_SECRET}` }), { times: 9 });
  await note(w.search({ q: 'beach' }));
  w.dbx.expireAccessTokens();
  await note(w.search({ q: 'x' }));
  await note(w.call({ method: 'POST', path: '/dam/dropbox/disconnect' }));
  const text = [...bodies, ...w.logs].join('\n');
  [CLIENT_SECRET, ...w.dbx.accessTokens.keys(), ...w.dbx.refreshTokens].forEach((s) => assert.ok(!text.includes(s)));
  const hosts = new Set(w.dbx.requests.map((r) => r.host));
  [...hosts].forEach((h) => assert.ok(['api.dropboxapi.com', 'content.dropboxapi.com'].includes(h), h));
  w.dbx.requests.forEach((r) => assert.ok(!/^Bearer eyJ/.test(r.headers.authorization || ''), 'never the IMS token'));
});

test('DBX-PC2: without a client id or secret Dropbox is absent and its routes are 404 while Cloudinary works', async () => {
  for (const blank of [{ DROPBOX_CLIENT_ID: '' }, { DROPBOX_CLIENT_SECRET: '' }]) {
    // eslint-disable-next-line no-await-in-loop
    const w = await oauthWorld({ providers: [cloudinary, dropbox], inputs: blank });
    // eslint-disable-next-line no-await-in-loop
    assert.deepEqual((await w.call({ path: '/dam/providers' })).json().providers.map((p) => p.id), ['cloudinary']);
    // eslint-disable-next-line no-await-in-loop
    assert.equal((await w.call({ path: '/dam/dropbox/assets' })).statusCode, 404);
    // eslint-disable-next-line no-await-in-loop
    assert.equal((await w.call({ path: '/dam/cloudinary/assets' })).statusCode, 200);
  }
});

test('DBX-PC3: hostile settings fail naming the setting only; no input can change a host', () => {
  const base = { DROPBOX_CLIENT_ID: 'dbxappkey12345' };
  const bad = [
    ['DROPBOX_ROOT_PATH', '/a/../b'], ['DROPBOX_ROOT_PATH', 'https://evil.example/x'], ['DROPBOX_ROOT_PATH', '/a\u0000b'], ['DROPBOX_ROOT_PATH', '/a/./b'], ['DROPBOX_ROOT_PATH', '/a?x'], ['DROPBOX_ROOT_PATH', '..'],
    ['DROPBOX_SCOPES', 'account_info.read evil.write'], ['DROPBOX_SCOPES', 'account_info.read'], ['DROPBOX_CLIENT_ID', 'a b'], ['DROPBOX_CLIENT_ID', 'ab'],
    ['DROPBOX_ALT_TEMPLATE_ID', 'nope'], ['DROPBOX_ALT_FIELD', '<x>'], ['DROPBOX_CACHE_SECONDS', '99999'], ['DROPBOX_CACHE_SECONDS', 'x'],
  ];
  bad.forEach(([name, value]) => {
    assert.throws(() => resolveConfig({ ...base, [name]: value }), (e) => e.setting === name && !e.message.includes(String(value).trim() || '#'), `${name}=${value}`);
  });
  assert.equal(resolveConfig({ ...base, DROPBOX_ROOT_PATH: 'Brand/Images/' }).root, '/Brand/Images');
  assert.equal(resolveConfig({ ...base, DROPBOX_ROOT_PATH: '/' }).root, '');
  assert.deepEqual(Object.keys(resolveConfig(base)).sort(), ['alt', 'altIncomplete', 'cacheSeconds', 'clientId', 'root', 'scopes']);
  assert.deepEqual(dropbox.outboundHosts(resolveConfig(base)), ['api.dropboxapi.com', 'content.dropboxapi.com']);
});

test('DBX-PC1: the provider registers with the interface helpers only (no deep imports) and appears with its capabilities', async () => {
  assert.equal(buildRegistry([dropbox]).size, 1);
  const here = fileURLToPath(new URL('../', import.meta.url));
  for (const name of readdirSync(here).filter((f) => f.endsWith('.js'))) {
    const imports = [...readFileSync(`${here}${name}`, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    imports.filter((i) => i.startsWith('..')).forEach((i) => assert.equal(i, '../../../worker/shell/provider.js', `${name}: ${i}`));
  }
  const w = await dropboxWorld();
  const p = (await w.call({ path: '/dam/providers' })).json().providers.find((x) => x.id === 'dropbox');
  assert.deepEqual([p.label, p.credentialKind, p.connection], ['Dropbox', 'user-oauth', { state: 'connected', account: 'Pat Example' }]);
  assert.deepEqual(p.capabilities.sorts.map((s) => [s.id, s.requiresQuery]), [['modified', false], ['relevance', true]]);
  assert.equal(p.capabilities.window, 300);
  assert.deepEqual(p.capabilities.assetTypes, ['image', 'video', 'document', 'audio']);
});
