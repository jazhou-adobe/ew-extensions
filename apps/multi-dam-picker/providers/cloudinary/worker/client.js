// Cloudinary Admin API calls (SPEC D6, D16, D17): Basic credential through the proxy, status mapping to failure
// classes, rate-limit headers and the early stop. Upstream bodies are only ever parsed on 2xx and never echoed.
import { ProviderError } from '../../../worker/shell/provider.js';

export const RATE_LIMIT_RESET_HEADER = 'x-featureratelimit-reset';
export const RATE_LIMIT_REMAINING_HEADER = 'x-featureratelimit-remaining';
/** Requests left in the hourly window at which the worker stops calling Cloudinary until the reset. */
export const RESERVE = 20;
const DEFAULT_RETRY_SECONDS = 60;
const MAX_RETRY_SECONDS = 3600;
const RECORD_KEY = 'ratelimit';

const clampSeconds = (ms) => Math.min(MAX_RETRY_SECONDS, Math.max(1, Math.ceil(ms / 1000)));

/** Seconds to wait from the reset header (an HTTP date): 1..3600, 60 when absent or unreadable. */
export function retryAfterSeconds(headers, now) {
  const at = Date.parse(headers[RATE_LIMIT_RESET_HEADER] || '');
  return Number.isNaN(at) ? DEFAULT_RETRY_SECONDS : clampSeconds(at - now);
}

async function recordQuota(ctx, headers, status) {
  const now = ctx.now();
  const remaining = Number(headers[RATE_LIMIT_REMAINING_HEADER]);
  const limited = status === 420 || status === 429;
  let resetAt = Date.parse(headers[RATE_LIMIT_RESET_HEADER] || '');
  if (!limited && !(Number.isFinite(remaining) && remaining <= RESERVE)) return;
  if (Number.isNaN(resetAt)) {
    if (!limited) return;
    resetAt = now + DEFAULT_RETRY_SECONDS * 1000;
  }
  if (resetAt <= now) return;
  const ttlSeconds = clampSeconds(resetAt - now);
  const record = {
    remaining: limited ? 0 : remaining, resetAt: Math.min(resetAt, now + MAX_RETRY_SECONDS * 1000),
  };
  await ctx.store.put(RECORD_KEY, record, { ttlSeconds });
}

async function earlyStop(ctx) {
  const record = await ctx.store.get(RECORD_KEY);
  const now = ctx.now();
  if (record && Number.isFinite(record.resetAt) && record.resetAt > now) {
    throw new ProviderError('rate_limited', { retryAfterSeconds: clampSeconds(record.resetAt - now) });
  }
}

/**
 * One Admin API call. Resolves to the parsed JSON object of a 2xx answer, otherwise throws a ProviderError:
 * 400 bad request, 404 not found, 401/403 misconfigured, 420/429 rate limited, everything else upstream unavailable.
 */
export async function adminRequest(ctx, { method = 'GET', path, body }) {
  await earlyStop(ctx);
  const { config } = ctx;
  const res = await ctx.proxy(
    `https://${config.apiHost}/v1_1/${config.cloudName}/${path}`,
    { method, ...(body ? { body } : {}) },
    {
      auth: { scheme: 'basic', usernameSecret: 'CLOUDINARY_API_KEY', secret: 'CLOUDINARY_API_SECRET' },
      // Search is a read-only POST: retrying it on 5xx is safe. 420 (hourly window) and 429 are never retried.
      retry: { idempotent: true, rateLimitStatuses: [420, 429] },
      mapErrors: false,
    },
  );
  await recordQuota(ctx, res.headers, res.status);
  const { status } = res;
  if (status >= 200 && status < 300) {
    let json;
    try {
      json = res.json();
    } catch {
      throw new ProviderError('upstream_unavailable');
    }
    if (json === null || typeof json !== 'object' || Array.isArray(json)) {
      throw new ProviderError('upstream_unavailable');
    }
    return json;
  }
  if (status === 420 || status === 429) {
    throw new ProviderError('rate_limited', { retryAfterSeconds: retryAfterSeconds(res.headers, ctx.now()) });
  }
  if (status === 401 || status === 403) throw new ProviderError('misconfigured');
  if (status === 400) throw new ProviderError('bad_request');
  if (status === 404 && method === 'GET') throw new ProviderError('not_found');
  throw new ProviderError('upstream_unavailable');
}
