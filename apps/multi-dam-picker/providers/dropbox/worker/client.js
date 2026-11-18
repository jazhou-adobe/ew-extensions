// Dropbox HTTP calls (SPEC D17, D22): RPC endpoints on the API host with the author's bearer token, status mapping
// onto the shell's failure classes, no upstream text ever surfaced. Hosts are fixed constants.
import { ProviderError } from '../../../worker/shell/provider.js';

export const API_HOST = 'api.dropboxapi.com';
export const CONTENT_HOST = 'content.dropboxapi.com';
const TOKEN_REJECTED = new Set(['invalid_access_token', 'expired_access_token', 'missing_scope', 'user_suspended']);
const DEFAULT_RETRY_SECONDS = 30;
const MAX_RETRY_SECONDS = 3600;

const clamp = (n) => Math.min(MAX_RETRY_SECONDS, Math.max(1, Math.ceil(n)));

function parseJson(res) {
  try {
    const value = res.json();
    return value !== null && typeof value === 'object' ? value : undefined;
  } catch {
    return undefined;
  }
}

/** The chain of union tags of a Dropbox error body, e.g. `['path', 'not_found']`. */
export function errorTags(body) {
  const tags = [];
  let node = body?.error;
  while (node && typeof node === 'object' && typeof node['.tag'] === 'string' && tags.length < 6) {
    tags.push(node['.tag']);
    node = node[node['.tag']];
  }
  return tags;
}

export function retryAfter(res) {
  const header = Number(res.headers['retry-after']);
  if (Number.isFinite(header) && header > 0) return clamp(header);
  const body = parseJson(res);
  const fromBody = Number(body?.error?.retry_after);
  return Number.isFinite(fromBody) && fromBody > 0 ? clamp(fromBody) : DEFAULT_RETRY_SECONDS;
}

/** Maps a non-2xx answer of a user-endpoint call to a ProviderError; a 409 carries its parsed body for callers. */
export function failureFor(res) {
  const { status } = res;
  const body = parseJson(res);
  const tags = errorTags(body);
  let failure;
  if (status === 401) {
    failure = new ProviderError(TOKEN_REJECTED.has(tags[0]) ? 'reauth_required' : 'misconfigured');
  } else if (status === 403) failure = new ProviderError('forbidden');
  else if (status === 429) failure = new ProviderError('rate_limited', { retryAfterSeconds: retryAfter(res) });
  else if (status === 400) failure = new ProviderError('bad_request');
  else if (status === 409) {
    if (tags[0] === 'path' && tags[1] === 'not_found') failure = new ProviderError('not_found');
    else if (tags[0] === 'path_lookup' && tags[1] === 'not_found') failure = new ProviderError('not_found');
    else if (tags[0] === 'invalid_argument') failure = new ProviderError('bad_request');
    else failure = new ProviderError('upstream_unavailable');
    failure.conflict = { tags, body };
  } else failure = new ProviderError('upstream_unavailable');
  failure.status = status;
  return failure;
}

/**
 * One RPC call as the signed-in author. `host` is one of the two constant hosts. `body` is a JSON object, or omitted
 * for endpoints without an argument. `idempotent` opts a POST in to retries on 5xx (read-only calls and link creation).
 * Resolves to the parsed JSON object.
 */
export async function rpc(ctx, path, body, { host = API_HOST, idempotent = true, emptyOk = false } = {}) {
  const res = await ctx.proxy(
    `https://${host}/2/${path}`,
    { method: 'POST', ...(body === undefined ? {} : { body }) },
    {
      auth: { scheme: 'bearer', token: ctx.credentials.accessToken },
      retry: { idempotent },
      mapErrors: false,
    },
  );
  if (res.status >= 200 && res.status < 300) {
    if (emptyOk && ['', 'null'].includes(res.text().trim())) return {};
    const json = parseJson(res);
    if (!json) throw new ProviderError('upstream_unavailable');
    return json;
  }
  throw failureFor(res);
}
