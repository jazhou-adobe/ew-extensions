import { randomBytes } from 'node:crypto';

/** A random canary secret: if it shows up anywhere outside the action, something leaked. */
export function canary(prefix = 'canary-s3cr3t') {
  return `${prefix}-${randomBytes(8).toString('hex')}`;
}

/** Production-like worker inputs (`ALLOWED_LOCAL_ORIGINS` empty). Override any input. */
export function makeInputs(overrides = {}) {
  return {
    ORG: 'jazhou-adobe',
    SITE: 'ew-extensions',
    IMS_ORIGIN: 'https://ims.test',
    ALLOWED_LOCAL_ORIGINS: '',
    ALLOWED_IMS_CLIENT_IDS: '',
    STATE_REGION: 'amer',
    HELLO_SECRET: canary(),
    ...overrides,
  };
}

/**
 * Builds raw web-action params exactly as the platform does in `web: raw` mode:
 * lower-case header names, `__ow_*` keys, JSON/binary bodies base64-encoded, text bodies as strings,
 * inputs as top-level properties.
 */
export function makeParams({
  method = 'GET', path = '/', query = '', headers = {}, body, inputs = makeInputs(),
} = {}) {
  const lower = {};
  Object.entries(headers).forEach(([k, v]) => {
    if (v !== undefined) lower[k.toLowerCase()] = v;
  });
  const params = {
    ...inputs, __ow_method: method.toLowerCase(), __ow_headers: lower, __ow_path: path,
  };
  const q = typeof query === 'string' ? query : new URLSearchParams(query).toString();
  if (q) params.__ow_query = q;
  if (body !== undefined) {
    if (typeof body === 'string') {
      lower['content-type'] ||= 'text/plain';
      params.__ow_body = body;
    } else if (body instanceof Uint8Array) {
      lower['content-type'] ||= 'application/octet-stream';
      params.__ow_body = Buffer.from(body).toString('base64');
    } else {
      lower['content-type'] ||= 'application/json';
      params.__ow_body = Buffer.from(JSON.stringify(body)).toString('base64');
    }
  }
  return params;
}
