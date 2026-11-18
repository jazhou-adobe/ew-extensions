// Dropbox OAuth (SPEC D17): authorization-code grant with `token_access_type=offline`, executed by the worker with the
// app key and secret (HTTP Basic). The shell owns state, cookies, storage and refresh orchestration; this file only
// maps Dropbox's endpoints.
import { ProviderError } from '../../../worker/shell/provider.js';
import { API_HOST, rpc } from './client.js';

export const AUTHORIZE_HOST = 'www.dropbox.com';
const SECRET = 'DROPBOX_CLIENT_SECRET';

export function buildAuthorizeUrl(ctx, { state, redirectUri }) {
  const url = new URL(`https://${AUTHORIZE_HOST}/oauth2/authorize`);
  url.searchParams.set('client_id', ctx.config.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('token_access_type', 'offline');
  url.searchParams.set('scope', ctx.config.scopes.join(' '));
  url.searchParams.set('state', state);
  return url.href;
}

/** Dropbox answers `{ "error": "invalid_grant: ...", "error_description": "..." }`: classify by the code prefix. */
function tokenFailure(res) {
  if (res.status >= 500) return new ProviderError('upstream_unavailable');
  if (res.status === 429) return new ProviderError('upstream_unavailable');
  let code = '';
  try {
    const body = res.json();
    code = typeof body?.error === 'string' ? body.error : '';
  } catch {
    code = '';
  }
  // Never delete a working connection on a vocabulary surprise: only an explicit invalid_grant is "reauth".
  if (res.status === 400 && code.startsWith('invalid_grant')) return new ProviderError('reauth_required');
  return new ProviderError('misconfigured');
}

async function tokenRequest(ctx, form, { retry }) {
  const res = await ctx.proxy(
    `https://${API_HOST}/oauth2/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    },
    {
      auth: { scheme: 'basic', username: ctx.config.clientId, secret: SECRET },
      retry: { idempotent: retry },
      mapErrors: false,
    },
  );
  if (res.status !== 200) throw tokenFailure(res);
  let body;
  try {
    body = res.json();
  } catch {
    throw new ProviderError('upstream_unavailable');
  }
  if (!body || typeof body.access_token !== 'string' || !body.access_token) {
    throw new ProviderError('upstream_unavailable');
  }
  return {
    accessToken: body.access_token,
    expiresInSeconds: Number(body.expires_in),
    ...(typeof body.refresh_token === 'string' && body.refresh_token ? { refreshToken: body.refresh_token } : {}),
    ...(typeof body.scope === 'string' ? { scope: body.scope } : {}),
    ...(typeof body.account_id === 'string' ? { accountId: body.account_id } : {}),
  };
}

/** The authorization code is single-use: the exchange is never retried. */
export const exchangeCode = (ctx, { code, redirectUri }) => tokenRequest(
  ctx,
  { grant_type: 'authorization_code', code, redirect_uri: redirectUri },
  { retry: false },
);

/** Dropbox never rotates the refresh token, so the refresh grant is safe to retry. */
export const refresh = (ctx, { refreshToken }) => tokenRequest(
  ctx,
  { grant_type: 'refresh_token', refresh_token: refreshToken },
  { retry: true },
);

export async function accountName(ctx) {
  const account = await rpc(ctx, 'users/get_current_account', undefined);
  const name = account?.name?.display_name;
  if (typeof name !== 'string' || !name.trim()) throw new ProviderError('upstream_unavailable');
  return name;
}

/** Revoking invalidates the refresh token and every access token derived from it. A 401 means "already invalid". */
export async function revoke(ctx) {
  try {
    await rpc(ctx, 'auth/token/revoke', undefined, { idempotent: false, emptyOk: true });
  } catch (e) {
    if (e instanceof ProviderError && e.status === 401) return;
    throw e;
  }
}
