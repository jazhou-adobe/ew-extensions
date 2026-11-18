import { randomUUID } from 'node:crypto';
import { HttpError, ERRORS } from './errors.js';
import { decodeRequest } from './request.js';
import {
  createOriginMatcher, corsHeaders, preflightHeaders, splitList,
} from './cors.js';
import { createAuthenticator, bearerToken } from './auth.js';
import { createSecrets } from './secrets.js';
import { createLogger, defaultSink } from './log.js';
import { createStore, stateClientFactory } from './store.js';
import { proxy as rawProxy, mapUpstream, fromUpstream } from './proxy.js';

export const MAX_REQUEST_BODY = 512 * 1024;
export const MAX_RESULT_BYTES = 950 * 1024;

function parseRoutes(routes) {
  const table = new Map();
  Object.entries(routes).forEach(([key, handler]) => {
    const m = /^([A-Z]+) (\/\S*)$/.exec(key);
    if (!m || typeof handler !== 'function') throw new Error(`invalid route "${key}" (expected "METHOD /path")`);
    const path = m[2].length > 1 ? m[2].replace(/\/+$/, '') : m[2];
    if (!table.has(path)) table.set(path, new Map());
    table.get(path).set(m[1], { handler, pattern: `${m[1]} ${path}` });
  });
  return table;
}

function isResponse(v) {
  return v && typeof v === 'object' && Number.isInteger(v.statusCode);
}

/** Normalises a handler result into `{ statusCode, headers, body }` with a string body. */
function toResult(value) {
  if (!isResponse(value)) {
    return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(value ?? null) };
  }
  const headers = {};
  Object.entries(value.headers || {}).forEach(([k, v]) => {
    headers[k.toLowerCase()] = String(v);
  });
  let { body } = value;
  if (body instanceof Uint8Array) {
    body = Buffer.from(body).toString('base64');
  } else if (body !== undefined && typeof body !== 'string') {
    body = JSON.stringify(body);
    headers['content-type'] ||= 'application/json';
  }
  if (body === undefined) return { statusCode: value.statusCode, headers, body: '' };
  headers['content-type'] ||= 'application/json';
  return { statusCode: value.statusCode, headers, body };
}

/**
 * Builds the web-action `main` for one worker.
 *
 * @param {object} options
 *   name      worker name (package name = extension folder name); prefixes store keys
 *   routes    { 'GET /path': async (ctx) => response | value }
 *   secrets   names of inputs that hold secrets (names that look like secrets are detected as well)
 *   authorize optional async ({ identity, claims, request }) => boolean
 * @param {object} [deps] injectable seams: fetch, sleep, random, now, store, log, env, requestId, jwksCooldownMs
 */
export function createAction({
  name, routes, secrets: declaredSecrets = [], authorize,
}, deps = {}) {
  if (!name) throw new Error('createAction: name is required');
  const table = parseRoutes(routes);
  const methods = [...new Set([...table.values()].flatMap((m) => [...m.keys()]))].sort();
  const {
    fetch: fetchImpl = (...a) => fetch(...a), sleep, random, now = Date.now,
    log: sink = defaultSink, env = process.env, jwksCooldownMs,
  } = deps;
  let storeInstance = deps.store;
  let authenticator;
  let authKey;

  return async function main(params = {}) {
    const startedAt = now();
    const requestId = deps.requestId ? deps.requestId() : randomUUID();
    let secrets;
    const logger = createLogger(sink, (text) => secrets.redact(text), {
      requestId, activationId: env.__OW_ACTIVATION_ID,
    });
    secrets = createSecrets(params, declaredSecrets, {
      onMissing: (n) => logger('missing_secret', { name: n }),
    });
    const state = {
      origin: undefined, allowed: false, route: 'unmatched', outcome: 'ok', userId: undefined, retries: 0,
    };
    let result;

    try {
      const { config } = secrets;
      if (!config.ORG || !config.SITE) throw new HttpError('misconfigured');
      const request = decodeRequest(params);
      state.origin = request.header('origin');

      // (2) origin gate
      const isAllowed = createOriginMatcher({
        org: config.ORG, site: config.SITE, localOrigins: config.ALLOWED_LOCAL_ORIGINS,
      });
      if (state.origin !== undefined) {
        state.allowed = isAllowed(state.origin);
        if (!state.allowed) throw new HttpError('forbidden_origin');
      }

      // (3) preflight short-circuit
      if (request.method === 'OPTIONS' && state.allowed) {
        state.route = 'preflight';
        state.preflight = true;
        result = { statusCode: 204, headers: {}, body: '' };
      } else {
        // (4) authentication
        const token = bearerToken(request.header('authorization'));
        if (!token) throw new HttpError('unauthorized');
        secrets.addSensitive(token);
        const key = `${config.IMS_ORIGIN}|${config.ALLOWED_IMS_CLIENT_IDS}`;
        if (!authenticator || authKey !== key) {
          authKey = key;
          authenticator = createAuthenticator({
            imsOrigin: config.IMS_ORIGIN,
            fetchImpl,
            now,
            cooldownMs: jwksCooldownMs,
            allowedClientIds: config.ALLOWED_IMS_CLIENT_IDS,
          });
        }
        const { identity, claims } = await authenticator(token);
        state.userId = identity.userId;
        if (authorize && !(await authorize({ identity, claims, request }))) throw new HttpError('forbidden');
        if (request.rawBodyLength > MAX_REQUEST_BODY) throw new HttpError('payload_too_large');

        // (5) routing
        const byMethod = table.get(request.path);
        if (!byMethod) throw new HttpError('not_found');
        const entry = byMethod.get(request.method);
        if (!entry) throw new HttpError('method_not_allowed');
        state.route = entry.pattern;

        // (6) handler
        storeInstance ||= createStore({
          workerName: name,
          clientFactory: stateClientFactory(config.STATE_REGION),
        });
        const deadline = Number(env.__OW_DEADLINE) || undefined;
        const proxyDeps = {
          fetch: fetchImpl,
          sleep,
          random,
          now,
          secret: secrets.secret,
          deadline,
          onRetry: () => { state.retries += 1; },
        };
        const ctx = {
          request,
          identity: Object.freeze(identity),
          claims,
          config,
          secret: secrets.secret,
          store: storeInstance,
          requestId,
          log: (event, fields) => logger(event, fields),
          proxy: async (url, init, opts = {}) => {
            const res = await rawProxy(url, init, opts, proxyDeps);
            return opts.mapErrors === false ? res : mapUpstream(res, opts, now);
          },
          fromUpstream,
        };
        result = toResult(await entry.handler(ctx));
      }
    } catch (e) {
      const known = e instanceof HttpError;
      const code = known ? e.code : 'internal';
      state.outcome = code;
      if (!known) logger('unhandled_error', { errorName: e?.name });
      else if (code === 'auth_unavailable') logger('auth_unavailable', { cause: e.cause?.name });
      result = {
        statusCode: ERRORS[code].status,
        headers: {
          'content-type': 'application/json',
          ...(code === 'unauthorized' ? { 'www-authenticate': 'Bearer' } : {}),
          ...(known && e.retryAfterSeconds !== undefined ? { 'retry-after': String(e.retryAfterSeconds) } : {}),
        },
        body: JSON.stringify({ error: { code, message: ERRORS[code].message, requestId } }),
      };
    }

    // Handler-supplied headers are redacted; the template's own headers are applied last so no handler can
    // override them (and a short secret value cannot corrupt them).
    const headers = {};
    Object.entries(result.headers).forEach(([k, v]) => {
      if (!k.startsWith('access-control-')) headers[k] = secrets.redact(String(v));
    });
    Object.assign(headers, {
      'cache-control': 'no-store',
      'x-request-id': requestId,
      vary: 'Origin',
    });
    if (state.allowed) {
      Object.assign(headers, state.preflight
        ? preflightHeaders(state.origin, [...methods, 'OPTIONS'])
        : corsHeaders(state.origin));
    }
    let { body } = result;
    if (Buffer.byteLength(body) > MAX_RESULT_BYTES) {
      state.outcome = 'internal';
      result.statusCode = ERRORS.internal.status;
      body = JSON.stringify({ error: { code: 'internal', message: ERRORS.internal.message, requestId } });
      headers['content-type'] = 'application/json';
    }
    const response = {
      statusCode: result.statusCode,
      headers,
      body: secrets.redact(body),
    };
    logger('request', {
      method: params.__ow_method,
      route: state.route,
      status: response.statusCode,
      durationMs: now() - startedAt,
      userId: state.userId,
      outcome: state.outcome,
      retries: state.retries,
      ...(state.outcome === 'forbidden_origin' ? { deniedOrigin: String(state.origin).slice(0, 200) } : {}),
    });
    return response;
  };
}

export { HttpError, splitList };
