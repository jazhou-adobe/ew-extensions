import { HttpError } from './errors.js';

export const PROXY_DEFAULTS = {
  retries: 3,
  baseMs: 250,
  capMs: 2000,
  attemptTimeoutMs: 8000,
  deadlineMs: 15000,
  maxRequestBytes: 512 * 1024,
  maxResponseBytes: 900 * 1024,
  invocationMarginMs: 2000,
};

const IDEMPOTENT = new Set(['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']);
const STRIPPED_HEADERS = new Set([
  'authorization', 'cookie', 'host', 'forwarded', 'x-real-ip', 'proxy-authorization',
  'connection', 'content-length', 'transfer-encoding', 'x-request-id',
]);
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

const defaultSleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

/** Retry-After as milliseconds (delta-seconds or HTTP-date); NaN when absent or unparsable. */
export function retryAfterMs(value, now) {
  if (typeof value !== 'string' || !value.trim()) return NaN;
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? NaN : Math.max(0, at - now);
}

function checkUrl(input, allowedHosts) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error('proxy: invalid URL');
  }
  if (url.username || url.password) throw new Error('proxy: URL must not carry credentials');
  const loopback = LOOPBACK.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('proxy: only https URLs are allowed');
  }
  if (!Array.isArray(allowedHosts) || !allowedHosts.length) throw new Error('proxy: allowedHosts is required');
  if (!allowedHosts.includes(url.hostname)) throw new Error('proxy: host is not allowed for this route');
  return url;
}

function buildBody(init) {
  const { body } = init;
  if (body === undefined || body === null) return { bytes: undefined, json: false };
  if (typeof body === 'string') return { bytes: Buffer.from(body, 'utf8'), json: false };
  if (body instanceof Uint8Array) return { bytes: Buffer.from(body), json: false };
  return { bytes: Buffer.from(JSON.stringify(body), 'utf8'), json: true };
}

function buildHeaders(init, { json }) {
  const headers = {};
  Object.entries(init.headers || {}).forEach(([k, v]) => {
    const name = k.toLowerCase();
    if (STRIPPED_HEADERS.has(name) || name.startsWith('x-forwarded-') || typeof v !== 'string') return;
    headers[name] = v;
  });
  if (json && !headers['content-type']) headers['content-type'] = 'application/json';
  return headers;
}

/** Resolves the credential to inject: `{ header: [name, value] }` or `{ query: [name, value] }`. */
function authFor(auth, secret) {
  if (!auth) return {};
  switch (auth.scheme) {
    case 'bearer':
      // A per-call token (a user's access token) or the value of a named secret input.
      return {
        header: ['authorization', `Bearer ${typeof auth.token === 'string' ? auth.token : secret(auth.secret)}`],
      };
    case 'header':
      return { header: [String(auth.name).toLowerCase(), secret(auth.secret)] };
    case 'query':
      return { query: [auth.name, secret(auth.secret)] };
    case 'basic': {
      const user = auth.usernameSecret ? secret(auth.usernameSecret) : (auth.username || '');
      return { header: ['authorization', `Basic ${Buffer.from(`${user}:${secret(auth.secret)}`).toString('base64')}`] };
    }
    default:
      throw new Error('proxy: unknown auth scheme');
  }
}

async function readCapped(response, max) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) throw new HttpError('upstream_too_large');
  if (!response.body) return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  const reader = response.body.getReader();
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      reader.cancel().catch(() => {});
      throw new HttpError('upstream_too_large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function headersToObject(headers) {
  const out = {};
  headers.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

/**
 * Outbound proxy helper: injects the secret named in `options.auth`, retries 429 and 5xx with exponential
 * backoff and full jitter, honours Retry-After, refuses hosts that are not allow-listed and never follows
 * redirects. Returns the last upstream response (retry exhaustion is mapped by `mapUpstream`).
 *
 * @param {string} target
 * @param {{ method?: string, headers?: object, body?: string | Uint8Array | object }} init
 * @param {object} options { allowedHosts, auth, retry, maxRequestBytes, maxResponseBytes }
 * @param {object} deps { fetch, sleep, random, now, secret, deadline, onRetry }
 */
export async function proxy(target, init = {}, options = {}, deps = {}) {
  const {
    fetch: fetchImpl = fetch, sleep = defaultSleep, random = Math.random, now = Date.now,
    secret = () => { throw new Error('proxy: no secret accessor'); }, deadline, onRetry,
  } = deps;
  const retry = { ...PROXY_DEFAULTS, ...options.retry };
  const maxRequestBytes = options.maxRequestBytes ?? PROXY_DEFAULTS.maxRequestBytes;
  const maxResponseBytes = options.maxResponseBytes ?? PROXY_DEFAULTS.maxResponseBytes;
  const method = String(init.method || 'GET').toUpperCase();

  const url = checkUrl(target, options.allowedHosts);
  const { bytes, json } = buildBody(init);
  if (bytes && bytes.length > maxRequestBytes) throw new HttpError('payload_too_large');
  const credential = authFor(options.auth, secret);
  const headers = buildHeaders(init, { json });
  if (credential.header) {
    const [name, value] = credential.header;
    headers[name] = value;
  }
  if (credential.query) url.searchParams.set(...credential.query);

  const rateLimitStatuses = new Set(retry.rateLimitStatuses || []);
  const extraRetry = new Set(retry.extraRetryStatuses || []);
  const idempotent = retry.idempotent === true || IDEMPOTENT.has(method);
  const start = now();
  const budgetEnd = Math.min(
    start + retry.deadlineMs,
    deadline ? deadline - retry.invocationMarginMs : Infinity,
  );

  const retryableStatus = (status) => {
    if (rateLimitStatuses.has(status)) return false;
    if (status === 429) return true;
    return idempotent && ((status >= 500 && status < 600) || extraRetry.has(status));
  };

  let attempts = 0;
  let last;
  for (;;) {
    attempts += 1;
    const controller = new AbortController();
    const remaining = Math.max(1, budgetEnd - now());
    const timer = setTimeout(() => controller.abort(), Math.min(retry.attemptTimeoutMs, remaining));
    let response;
    let failure;
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetchImpl(url.href, {
        method, headers, body: bytes, redirect: 'manual', signal: controller.signal,
      });
      // eslint-disable-next-line no-await-in-loop
      const body = await readCapped(res, maxResponseBytes);
      response = {
        status: res.status, headers: headersToObject(res.headers), body, attempts,
      };
    } catch (e) {
      if (e instanceof HttpError) throw e;
      failure = e;
    } finally {
      clearTimeout(timer);
    }

    const canRetry = attempts <= retry.retries
      && (failure ? idempotent : retryableStatus(response.status));
    if (!canRetry) {
      if (failure) throw new HttpError('upstream_unavailable', { cause: failure });
      last = response;
      break;
    }
    const exp = Math.min(retry.capMs, retry.baseMs * 2 ** (attempts - 1));
    let delay = random() * exp;
    if (response) {
      const ra = retryAfterMs(response.headers['retry-after'], now());
      if (!Number.isNaN(ra)) delay = Math.max(delay, Math.min(ra, retry.capMs));
    }
    if (now() + delay >= budgetEnd) {
      if (failure) throw new HttpError('upstream_unavailable', { cause: failure });
      last = response;
      break;
    }
    if (onRetry) onRetry();
    // eslint-disable-next-line no-await-in-loop
    await sleep(delay);
  }
  return Object.assign(last, {
    ok: last.status >= 200 && last.status < 300,
    text: () => last.body.toString('utf8'),
    json: () => JSON.parse(last.body.toString('utf8')),
  });
}

/**
 * Maps an exhausted or rate-limited upstream response (and a vendor 401/403) to the error contract; returns the
 * response when it should be handled by the route (success and other 4xx). Never carries upstream text.
 */
export function mapUpstream(res, options = {}, now = Date.now) {
  const retry = options.retry || {};
  const rateLimited = res.status === 429 || (retry.rateLimitStatuses || []).includes(res.status);
  if (rateLimited) {
    const header = retry.rateLimitResetHeader && res.headers[String(retry.rateLimitResetHeader).toLowerCase()];
    const ms = retryAfterMs(res.headers['retry-after'] ?? header, now());
    throw new HttpError('rate_limited', {
      retryAfterSeconds: Number.isNaN(ms) ? undefined : Math.ceil(ms / 1000),
    });
  }
  // 5xx / exhausted retryable statuses, and the vendor rejecting *our* credential (401/403), are the worker's
  // problem, not the caller's: they never reach the browser as vendor text.
  if (res.status >= 500 || res.status === 401 || res.status === 403
    || (retry.extraRetryStatuses || []).includes(res.status)) {
    throw new HttpError('upstream_unavailable');
  }
  return res;
}

const TEXTUAL = /^(text\/|application\/(json|xml|javascript)|[^;]*\+(json|xml))/i;

/** Turns an upstream response into a web-action result (binary bodies base64, content type preserved). */
export function fromUpstream(res, { headers: allow = [] } = {}) {
  const type = res.headers['content-type'] || 'application/octet-stream';
  const out = { 'content-type': type };
  allow.forEach((h) => {
    if (res.headers[h.toLowerCase()]) out[h.toLowerCase()] = res.headers[h.toLowerCase()];
  });
  return {
    statusCode: res.status,
    headers: out,
    body: TEXTUAL.test(type) ? res.body.toString('utf8') : res.body,
  };
}
