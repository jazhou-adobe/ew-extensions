const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const CORS_ALLOWED_HEADERS = 'Authorization, Content-Type';
export const CORS_EXPOSED_HEADERS = 'x-request-id, Retry-After';
export const CORS_MAX_AGE = '600';

function splitList(value) {
  return String(value || '').split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Builds the origin matcher (SPEC Decision 8): `https://da.live`, the code sites' own origins
 * `https://{ref}--{site}--{org}.{aem.live|aem.page|preview.da.live}` (`site` may be a comma list, e.g. the code repo
 * plus a DA test site that vendors the extension), and exact local origins.
 * Matching is exact and anchored; there is no wildcard or suffix matching.
 */
export function createOriginMatcher({ org, site, localOrigins }) {
  const local = new Set(splitList(localOrigins));
  const hosts = '(?:aem\\.live|aem\\.page|preview\\.da\\.live)';
  const sites = splitList(site).map(escape).join('|');
  const own = new RegExp(`^https://[a-z0-9][a-z0-9-]*--(?:${sites})--${escape(org)}\\.${hosts}$`);
  return (origin) => {
    if (typeof origin !== 'string' || !origin || origin === 'null' || origin === '*') return false;
    return origin === 'https://da.live' || local.has(origin) || own.test(origin);
  };
}

/** Headers added to every response for an allowed origin. Never `*`, never credentials. */
export function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin,
    'access-control-expose-headers': CORS_EXPOSED_HEADERS,
  };
}

export function preflightHeaders(origin, methods) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': methods.join(', '),
    'access-control-allow-headers': CORS_ALLOWED_HEADERS,
    'access-control-max-age': CORS_MAX_AGE,
  };
}

export { splitList };
