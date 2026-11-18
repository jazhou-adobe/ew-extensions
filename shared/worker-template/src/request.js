import { HttpError } from './errors.js';

const TEXT_TYPES = /^(text\/|application\/x-www-form-urlencoded)/i;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Raw web-action params use lower-case header names; normalise defensively anyway. */
function lowerHeaders(raw) {
  const headers = {};
  if (raw && typeof raw === 'object') {
    Object.entries(raw).forEach(([k, v]) => {
      if (typeof v === 'string') headers[k.toLowerCase()] = v;
    });
  }
  return headers;
}

function normalisePath(path) {
  const p = typeof path === 'string' ? path : '';
  const withSlash = p.startsWith('/') ? p : `/${p}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, '') || '/' : '/';
}

/** Decodes raw web-action params (the platform contract) into a request view. The body is decoded lazily. */
export function decodeRequest(params) {
  const headers = lowerHeaders(params.__ow_headers);
  const rawBody = typeof params.__ow_body === 'string' ? params.__ow_body : '';
  const contentType = headers['content-type'] || '';
  let bytes;
  const toBytes = () => {
    if (bytes) return bytes;
    if (TEXT_TYPES.test(contentType) || !contentType) {
      // Plain text bodies arrive as strings; an untyped body is treated the same way.
      bytes = Buffer.from(rawBody, 'utf8');
    } else {
      if (!BASE64.test(rawBody)) throw new HttpError('bad_request');
      bytes = Buffer.from(rawBody, 'base64');
    }
    return bytes;
  };
  return {
    method: String(params.__ow_method || 'get').toUpperCase(),
    path: normalisePath(params.__ow_path),
    query: new URLSearchParams(typeof params.__ow_query === 'string' ? params.__ow_query : ''),
    headers,
    header: (name) => headers[String(name).toLowerCase()],
    rawBodyLength: rawBody.length,
    bytes: toBytes,
    text: () => toBytes().toString('utf8'),
    json: () => {
      try {
        return JSON.parse(toBytes().toString('utf8'));
      } catch (e) {
        if (e instanceof HttpError) throw e;
        throw new HttpError('bad_request');
      }
    },
  };
}
