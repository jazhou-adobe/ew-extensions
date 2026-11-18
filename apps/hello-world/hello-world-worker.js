/**
 * Worker-call logic for the hello app (no side effects at import time).
 *
 * The page sends the user's IMS token to the worker, so the worker origin is a constant keyed by the page's own
 * hostname and never taken from the URL: a crafted `?worker=` link must not be able to redirect the token.
 */

export const WORKERS = {
  stage: 'https://281295-ewextensions-stage.adobeioruntime.net/api/v1/web/hello-world/api',
  production: 'https://281295-ewextensions.adobeioruntime.net/api/v1/web/hello-world/api',
};

const CODE_SITE = /^([a-z0-9][a-z0-9-]*)--ew-extensions--jazhou-adobe\.(aem\.live|aem\.page|preview\.da\.live)$/;

/** Which worker serves this page: `main` pages use Production, other refs and `localhost` use Stage, others none. */
export function workerFor(hostname) {
  if (hostname === 'localhost') return { env: 'stage', base: WORKERS.stage };
  const m = CODE_SITE.exec(hostname);
  if (!m) return null;
  return m[1] === 'main' ? { env: 'production', base: WORKERS.production } : { env: 'stage', base: WORKERS.stage };
}

/**
 * Calls GET /hello/sign. Resolves to one of:
 *   { kind: 'signature', message, signature } | { kind: 'error', status, code } | { kind: 'unavailable' }
 * `unavailable` covers 5xx, rejected fetches (the platform's own errors carry no CORS headers, so the page sees a
 * network error) and timeouts. Nothing here ever returns or logs the token.
 */
export async function callWorker({
  fetchImpl, base, token, message = 'hello world', timeoutMs = 15000,
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${base}/hello/sign?message=${encodeURIComponent(message)}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      signal: controller.signal,
    });
    if (res.status >= 500) return { kind: 'unavailable' };
    let body = null;
    try {
      body = await res.json();
    } catch {
      return res.ok ? { kind: 'unavailable' } : { kind: 'error', status: res.status, code: 'unknown' };
    }
    if (res.ok && typeof body?.signature === 'string') {
      return { kind: 'signature', message: body.message, signature: body.signature };
    }
    const code = typeof body?.error?.code === 'string' ? body.error.code : 'unknown';
    return { kind: 'error', status: res.status, code };
  } catch {
    return { kind: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
}

/** Plain-language text for a result (never a stack trace, never the token). */
export function describe(result) {
  switch (result.kind) {
    case 'signature': return `Signature of "${result.message}": ${result.signature}`;
    case 'error': return `The worker answered ${result.status} (${result.code}).`;
    default: return 'The worker is unavailable. Try again in a moment.';
  }
}
