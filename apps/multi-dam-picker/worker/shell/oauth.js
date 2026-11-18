// Routes of the public `oauth` action (SPEC D7, D12): the two browser navigations of the sign-in pop-up.
//   GET /{provider}/begin?ticket=...          verify the one-time ticket, set the binding cookie, redirect
//   GET /{provider}/callback?code=&state=     verify state + cookie, exchange the code once, store the encrypted record
// Neither route carries an IMS token (a browser redirect cannot), so each authenticates its own request with sealed
// values. Everything else gets the same generic failure page. Nothing from the request is ever reflected.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../../../../shared/worker-template/src/index.js';
import { HOSTED_KINDS, ProviderError } from './provider.js';
import { createHost } from './registry.js';
import {
  cleanAccountName, normalizeToken, scopeCovers, writeRecord,
} from './connections.js';
import { sha256Base64Url } from './seal.js';

const SEGMENT = /^[a-z][a-z0-9-]{0,31}$/;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const STATE_TTL_MS = 600_000;
const COOKIE_MAX_AGE = 600;
const MAX_CODE_LENGTH = 2048;

const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
};

const page = (statusCode, title, text, headers = {}) => ({
  statusCode,
  headers: { ...PAGE_HEADERS, ...headers },
  body: `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>`
    + '<style>body{font:16px system-ui,sans-serif;margin:3rem auto;max-width:28rem;padding:0 1rem}</style></head>'
    + `<body><h1>${title}</h1><p>${text}</p></body></html>`,
});

const failurePage = (headers) => page(400, 'Could not connect', 'The connection could not be completed. '
  + 'Close this window and try again from the picker.', headers);
const successPage = (headers) => page(200, 'Connected', 'You are connected. You can close this window.', headers);

const cookieName = (providerId) => `dam_oauth_${providerId}`;

function cookieHeader(settings, providerId, value, maxAge) {
  return `${cookieName(providerId)}=${value}; Max-Age=${maxAge}; Path=${settings.cookiePath}; HttpOnly; SameSite=Lax`
    + `${settings.secureCookie ? '; Secure' : ''}`;
}

function readCookie(header, name) {
  if (typeof header !== 'string') return undefined;
  const hit = header.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : undefined;
}

const sameText = (a, b) => typeof a === 'string' && typeof b === 'string'
  && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** The authorize URL must stay on the provider's declared hosts and carry the exact state and redirect URI. */
function checkAuthorizeUrl(value, {
  provider, config, state, redirectUri, secrets, localOrigins,
}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  const loopback = LOOPBACK.has(url.hostname) && url.protocol === 'http:' && localOrigins;
  if (url.protocol !== 'https:' && !loopback) return undefined;
  if (url.username || url.password) return undefined;
  if (!provider.authorizeHosts(config).includes(url.hostname)) return undefined;
  if (url.searchParams.get('state') !== state || url.searchParams.get('redirect_uri') !== redirectUri) return undefined;
  if (url.searchParams.has('client_secret') || secrets.some((s) => s && value.includes(s))) return undefined;
  return url.href;
}

/**
 * @param {{ providers: object[], hostedKinds?: string[] }} options
 */
export function createOAuthRoutes({ providers, hostedKinds = HOSTED_KINDS }) {
  const host = createHost({ providers, hostedKinds });

  /** Revokes a grant that will not be kept (best effort; never throws). */
  async function discard(ctx, entry, tokens) {
    if (!entry.provider.revoke) return;
    try {
      await entry.provider.revoke(host.callContext(ctx, entry, { credentials: { accessToken: tokens.accessToken } }));
    } catch {
      ctx.log('revoke_failed', { provider: entry.provider.id });
    }
  }

  function resolve(ctx, rest, action) {
    const [providerId, step, ...extra] = rest.split('/');
    if (step !== action || extra.length || !SEGMENT.test(providerId || '')) return undefined;
    const entry = host.configured(ctx).get(providerId);
    if (!entry || entry.provider.credentialKind !== 'user-oauth') return undefined;
    return entry;
  }

  async function begin(ctx) {
    const entry = resolve(ctx, ctx.rest, 'begin');
    const settings = host.oauthSettings(ctx);
    if (!entry || !settings) return failurePage();
    const { provider, config } = entry;
    const ticket = settings.state.open(ctx.request.query.get('ticket'), 'ticket');
    if (!ticket || ticket.p !== 'ticket' || ticket.provider !== provider.id || !(ticket.exp > ctx.now())
      || typeof ticket.conn !== 'string') {
      return failurePage();
    }
    const nonce = randomBytes(24).toString('base64url');
    const state = settings.state.seal({
      p: 'state', provider: provider.id, conn: ticket.conn, n: sha256Base64Url(nonce), exp: ctx.now() + STATE_TTL_MS,
    }, 'state');
    const redirectUri = settings.redirectUri(provider.id);
    const target = checkAuthorizeUrl(provider.buildAuthorizeUrl(host.callContext(ctx, entry), { state, redirectUri }), {
      provider,
      config,
      state,
      redirectUri,
      secrets: provider.config.secrets.map((n) => ctx.optionalSecret(n)),
      localOrigins: Boolean(ctx.config.ALLOWED_LOCAL_ORIGINS),
    });
    if (!target) {
      ctx.log('authorize_url_rejected', { provider: provider.id });
      return failurePage();
    }
    ctx.annotate({ provider: provider.id, op: 'begin' });
    return {
      statusCode: 302,
      headers: {
        ...PAGE_HEADERS,
        location: target,
        'set-cookie': cookieHeader(settings, provider.id, nonce, COOKIE_MAX_AGE),
      },
      body: '',
    };
  }

  async function callback(ctx) {
    const entry = resolve(ctx, ctx.rest, 'callback');
    const settings = host.oauthSettings(ctx);
    if (!entry || !settings) return failurePage();
    const { provider } = entry;
    const clear = { 'set-cookie': cookieHeader(settings, provider.id, '', 0) };
    const { query } = ctx.request;
    if (query.has('error')) return failurePage(clear);

    const state = settings.state.open(query.get('state'), 'state');
    if (!state || state.p !== 'state' || state.provider !== provider.id || !(state.exp > ctx.now())
      || typeof state.conn !== 'string') {
      return failurePage(clear);
    }
    const nonce = readCookie(ctx.request.header('cookie'), cookieName(provider.id));
    if (!nonce || !sameText(sha256Base64Url(nonce), state.n)) return failurePage(clear);
    ctx.addSensitive(nonce);

    const code = query.get(provider.callbackCodeParam || 'code');
    if (!code || code.length > MAX_CODE_LENGTH) return failurePage(clear);
    ctx.addSensitive(code);

    ctx.annotate({ provider: provider.id, op: 'callback' });
    let tokens;
    try {
      tokens = normalizeToken(await provider.exchangeCode(host.callContext(ctx, entry), {
        code, redirectUri: settings.redirectUri(provider.id),
      }));
    } catch (e) {
      ctx.log('oauth_exchange_failed', { provider: provider.id, class: e instanceof ProviderError ? e.kind : 'error' });
      return failurePage(clear);
    }
    ctx.addSensitive(tokens.accessToken);
    if (tokens.refreshToken) ctx.addSensitive(tokens.refreshToken);

    const needsRefresh = provider.requiresRefreshToken !== false;
    const scopeShort = tokens.scope !== undefined && !scopeCovers(tokens.scope, provider.scopes);
    if ((needsRefresh && !tokens.refreshToken) || scopeShort) {
      ctx.log('oauth_grant_refused', { provider: provider.id });
      await discard(ctx, entry, tokens);
      return failurePage(clear);
    }

    let name;
    try {
      name = cleanAccountName(await provider.accountName(host.callContext(ctx, entry, {
        credentials: { accessToken: tokens.accessToken, scope: tokens.scope },
      })));
    } catch (e) {
      ctx.log('oauth_account_failed', { provider: provider.id, class: e instanceof ProviderError ? e.kind : 'error' });
    }
    if (!name) {
      await discard(ctx, entry, tokens);
      return failurePage(clear);
    }
    try {
      await writeRecord(ctx, settings, state.conn, {
        v: 1,
        accessToken: tokens.accessToken,
        accessExpiresAt: ctx.now() + tokens.expiresInSeconds * 1000,
        refreshToken: tokens.refreshToken,
        scope: tokens.scope,
        account: { displayName: name, ...(tokens.accountId ? { id: tokens.accountId } : {}) },
        connectedAt: ctx.now(),
      });
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      await discard(ctx, entry, tokens);
      return failurePage(clear);
    }
    return successPage(clear);
  }

  /** Any failure of a route is the same generic page: nothing about the cause reaches the browser. */
  const safe = (handler) => async (ctx) => {
    try {
      return await handler(ctx);
    } catch (e) {
      ctx.log('oauth_route_failed', { class: e instanceof HttpError ? e.code : 'error' });
      return failurePage();
    }
  };

  return {
    'GET /*': safe(async (ctx) => {
      const step = ctx.rest.split('/')[1];
      if (step === 'begin') return begin(ctx);
      if (step === 'callback') return callback(ctx);
      return failurePage();
    }),
  };
}
