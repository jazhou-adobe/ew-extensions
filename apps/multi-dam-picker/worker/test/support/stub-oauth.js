// Two stub `user-oauth` providers with different token styles, and the fake DAM behind them. They prove the plumbing is
// provider-agnostic: each is added with one registry entry and no shell change.
//   stub-oauth-a  rotating refresh token, JSON token requests, per-tenant API host
//   stub-oauth-b  non-rotating, form-encoded token requests, a differently named callback parameter
import { randomBytes } from 'node:crypto';
import { ProviderError } from '../../shell/provider.js';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The fake vendor: `fetch(url, init)` for a set of hosts. `rotating` issues a new refresh token on every refresh. */
export function fakeOAuthDam({ hosts, rotating, now = Date.now, accessSeconds = 3600 }) {
  const requests = [];
  const refreshTokens = new Set();
  const accessTokens = new Map();
  const codes = new Set();
  const issue = (refresh) => {
    const access = `${rotating ? 'A' : 'B'}T-${randomBytes(6).toString('hex')}`;
    accessTokens.set(access, now() + accessSeconds * 1000);
    return { access_token: access, expires_in: accessSeconds, refresh_token: refresh };
  };
  return {
    requests,
    refreshTokens,
    hosts,
    newCode() { const code = `C-${randomBytes(6).toString('hex')}`; codes.add(code); return code; },
    count: (path) => requests.filter((r) => r.path === path).length,
    async fetch(url, init = {}) {
      const u = new URL(url);
      if (!hosts.includes(u.hostname)) throw new Error(`unexpected host ${u.hostname}`);
      const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
      const text = init.body === undefined ? '' : Buffer.from(init.body).toString('utf8');
      requests.push({ path: u.pathname, headers, text });
      if (u.pathname === '/token') {
        const body = headers['content-type']?.includes('json') ? JSON.parse(text) : Object.fromEntries(new URLSearchParams(text));
        if (body.grant_type === 'authorization_code') {
          if (!codes.delete(body.code)) return json(400, { error: 'invalid_grant' });
          const refresh = `R-${randomBytes(6).toString('hex')}`;
          refreshTokens.add(refresh);
          return json(200, issue(refresh));
        }
        if (!refreshTokens.has(body.refresh_token)) return json(400, { error: 'invalid_grant' });
        if (!rotating) return json(200, issue(undefined));
        refreshTokens.delete(body.refresh_token);
        const next = `R-${randomBytes(6).toString('hex')}`;
        refreshTokens.add(next);
        return json(200, issue(next));
      }
      const bearer = /^Bearer (.+)$/.exec(headers.authorization || '')?.[1];
      if (!bearer || !(accessTokens.get(bearer) > now())) return json(401, { error: 'invalid_token' });
      if (u.pathname === '/me') return json(200, { name: rotating ? 'Alex Rotating' : 'Sam Steady' });
      if (u.pathname === '/search') {
        return json(200, { items: [{ id: 'a1', name: 'one.jpg' }, { id: 'a2', name: 'two.jpg' }], more: false });
      }
      if (u.pathname === '/revoke') { refreshTokens.clear(); return json(200, {}); }
      return json(404, {});
    },
  };
}

function oauthProvider({ id, label, host, authHost, rotating, form, codeParam }) {
  const upper = id.replace(/-/g, '').toUpperCase();
  const call = async (ctx, path, { method = 'POST', body, headers = {} } = {}) => {
    const res = await ctx.proxy(`https://${host}${path}`, { method, headers, ...(body ? { body } : {}) }, {
      ...(ctx.credentials ? { auth: { scheme: 'bearer', token: ctx.credentials.accessToken } } : {}),
      retry: { idempotent: path !== '/token' },
      mapErrors: false,
    });
    if (res.status === 401) throw new ProviderError('reauth_required');
    if (res.status >= 500) throw new ProviderError('upstream_unavailable');
    if (res.status !== 200) throw new ProviderError(res.status === 400 && path === '/token' ? 'reauth_required' : 'misconfigured');
    return res.json();
  };
  const tokenRequest = (ctx, fields) => (form
    ? call(ctx, '/token', { body: new URLSearchParams(fields).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } })
    : call(ctx, '/token', { body: fields }));
  const toResult = (t) => ({ accessToken: t.access_token, expiresInSeconds: t.expires_in, refreshToken: t.refresh_token });
  return {
    id,
    label,
    credentialKind: 'user-oauth',
    assetTypes: ['image'],
    sorts: [{ id: 'newest', label: 'Newest' }],
    defaultSort: 'newest',
    window: 100,
    assetIdPattern: /^a[0-9]{1,6}$/,
    outboundHosts: () => [host],
    authorizeHosts: () => [authHost],
    deliveryHosts: () => [`cdn.${id}.example`],
    cacheSeconds: () => 0,
    fingerprint: (config) => ({ tenant: config.tenant }),
    config: {
      required: [`${upper}_TENANT`],
      secrets: [`${upper}_SECRET`],
      resolve: (raw) => ({ tenant: raw[`${upper}_TENANT`] }),
    },
    scopes: ['assets.read'],
    rotatesRefreshToken: rotating,
    callbackCodeParam: codeParam,
    maxStateBytes: 1500,
    buildAuthorizeUrl: (ctx, { state, redirectUri }) => `https://${authHost}/authorize?${new URLSearchParams({
      response_type: 'code', client_id: 'stub', redirect_uri: redirectUri, state, scope: 'assets.read',
    })}`,
    exchangeCode: async (ctx, { code, redirectUri }) => {
      ctx.secret(`${upper}_SECRET`);
      return toResult(await tokenRequest(ctx, { grant_type: 'authorization_code', code, redirect_uri: redirectUri }));
    },
    refresh: async (ctx, { refreshToken }) => toResult(await tokenRequest(ctx, { grant_type: 'refresh_token', refresh_token: refreshToken })),
    accountName: async (ctx) => (await call(ctx, '/me', { method: 'GET' })).name,
    revoke: (ctx) => call(ctx, '/revoke'),
    search: async (ctx) => {
      const data = await call(ctx, '/search', { method: 'GET' });
      return {
        items: data.items.map((i) => ({ id: i.id, name: i.name, type: 'image', warnings: [] })), hasMore: false,
      };
    },
    getAsset: async (ctx, assetId) => ({
      id: assetId,
      name: `${assetId}.jpg`,
      type: 'image',
      warnings: [],
      alt: { value: 'stub', source: 'name' },
      renditions: [{ id: 'original', label: 'Original', url: `https://cdn.${id}.example/${assetId}.jpg`, kind: 'original' }],
      defaultRenditionId: 'original',
      insertable: { ok: true },
    }),
  };
}

export const stubOAuthA = () => oauthProvider({
  id: 'stub-oauth-a', label: 'Stub A', host: 't1.stuba.example', authHost: 'auth.stuba.example', rotating: true, form: false, codeParam: 'code',
});
export const stubOAuthB = () => oauthProvider({
  id: 'stub-oauth-b', label: 'Stub B', host: 'api.stubb.example', authHost: 'login.stubb.example', rotating: false, form: true, codeParam: 'authorization_code',
});

export const stubInputs = {
  STUBOAUTHA_TENANT: 't1',
  STUBOAUTHA_SECRET: `stuba-secret-${randomBytes(4).toString('hex')}`,
  STUBOAUTHB_TENANT: 'tb',
  STUBOAUTHB_SECRET: `stubb-secret-${randomBytes(4).toString('hex')}`,
};
