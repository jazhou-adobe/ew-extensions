import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropboxWorld } from './support/dropbox-world.js';
import { oauthWorld, CLIENT_ID } from '../../../../worker/test/support/oauth-world.js';

const HOUR = 3600_000;
const reply = (status, error) => ({ status, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error }) });

test('DBX-AU1/AU3: the authorize URL asks for offline access and the exact scopes; the exchange is one form POST with Basic client auth, then one account lookup', async () => {
  const w = await oauthWorld();
  const { beginRes, callback } = await w.signIn();
  const to = new URL(beginRes.headers.location);
  assert.equal(to.searchParams.get('client_id'), CLIENT_ID);
  assert.equal(callback.statusCode, 200);
  const [exchange] = w.dbx.requests.filter((r) => r.path === '/oauth2/token');
  assert.equal(exchange.method, 'POST');
  assert.equal(exchange.headers['content-type'], 'application/x-www-form-urlencoded');
  const basic = Buffer.from(exchange.headers.authorization.slice(6), 'base64').toString();
  assert.ok(basic.startsWith(`${CLIENT_ID}:`));
  const form = new URLSearchParams(exchange.text);
  assert.deepEqual([...form.keys()].sort(), ['code', 'grant_type', 'redirect_uri']);
  const account = w.dbx.requests.filter((r) => r.path.endsWith('get_current_account'));
  assert.equal(account.length, 1);
  assert.match(account[0].headers.authorization, /^Bearer AT-/);
  assert.equal(account[0].text, undefined, 'a no-argument RPC sends no body');
  assert.equal(account[0].headers['content-type'], undefined);
});

test('DBX-AU7: refresh errors: invalid_grant is reauth, invalid_client and any other 400 are misconfigured, 5xx is transient', async () => {
  const cases = [
    [reply(400, 'invalid_grant: refresh token is invalid or revoked'), 409, 'provider_reauth_required', 'reauth_required'],
    [reply(400, 'invalid_client: Invalid client_id or client_secret'), 500, 'misconfigured', 'connected'],
    [reply(400, 'invalid_request: something new'), 500, 'misconfigured', 'connected'],
    [{ status: 400, body: 'not json' }, 500, 'misconfigured', 'connected'],
    [reply(503, 'down'), 502, 'upstream_unavailable', 'connected'],
  ];
  for (const [step, status, code, after] of cases) {
    // eslint-disable-next-line no-await-in-loop
    const w = await dropboxWorld();
    w.clock.now += 5 * HOUR;
    w.dbx.inject('/oauth2/token', step, { times: 9 });
    // eslint-disable-next-line no-await-in-loop
    const res = await w.search({ q: 'beach' });
    assert.equal(res.statusCode, status, JSON.stringify(step));
    assert.equal(res.json().error.code, code);
    // eslint-disable-next-line no-await-in-loop
    assert.equal((await w.call({ path: '/dam/dropbox/session' })).json().connection.state, after);
  }
});
