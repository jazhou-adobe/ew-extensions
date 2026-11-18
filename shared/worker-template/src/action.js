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

/**
 * Route table: exact paths plus prefix routes (`GET /dam/*` matches every path below `/dam/`; the handler reads the
 * remainder from `ctx.rest` and must validate it). Exact routes win over prefix routes; the longest prefix wins.
 */
function parseRoutes(routes) {
  const table = new Map();
  const prefixes = new Map();
  Object.entries(routes).forEach(([key, handler]) => {
    const m = /^([A-Z]+) (\/\S*)$/.exec(key);
    if (!m || typeof handler !== 'function') throw new Error(`invalid route "${key}" (expected "METHOD /path")`);
    const wildcard = m[2].endsWith('/*');
    const target = wildcard ? prefixes : table;
    let path = m[2];
    if (wildcard) path = path.slice(0, -1);
    else if (path.length > 1) path = path.replace(/\/+$/, '');
    if (!target.has(path)) target.set(path, new Map());
    target.get(path).set(m[1], { handler, pattern: `${m[1]} ${path}${wildcard ? '*' : ''}` });
  });
  const ordered = [...prefixes.keys()].sort((a, b) => b.length - a.length);
  return {
    table,
    prefixes,
    methods: [...new Set([...table.values(), ...prefixes.values()].flatMap((mm) => [...mm.keys()]))].sort(),
    find(path) {
      if (table.has(path)) return { byMethod: table.get(path) };
      const prefix = ordered.find((p) => path.startsWith(p));
      return prefix ? { byMethod: prefixes.get(prefix), rest: path.slice(prefix.length) } : undefined;
    },
  };
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
 *   mode      'authenticated' (default: origin gate, CORS, IMS bearer token) or 'public' (no token, no CORS: for
 *             browser navigations such as an OAuth redirect; the routes authenticate themselves)
 * @param {object} [deps] injectable seams: fetch, sleep, random, now, store, log, env, requestId, jwksCooldownMs
 */
export function createAction({
  name, routes, secrets: declaredSecrets = [], authorize, mode = 'authenticated',
}, deps = {}) {
  if (!name) throw new Error('createAction: name is required');
  if (mode !== 'authenticated' && mode !== 'public') throw new Error('createAction: unknown mode');
  const { methods, find } = parseRoutes(routes);
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
      origin: undefined, allowed: false, route: 'unmatched', outcome: 'ok', userId: undefined, retries: 0, extra: {},
    };
    let result;

    try {
      const { config } = secrets;
      if (!config.ORG || !config.SITE) throw new HttpError('misconfigured');
      const request = decodeRequest(params);
      state.origin = request.header('origin');

      // (5) routing and (6) handler: shared by the authenticated and the public variant.
      const dispatch = async (identity, claims) => {
        if (request.rawBodyLength > MAX_REQUEST_BODY) throw new HttpError('payload_too_large');
        const found = find(request.path);
        if (!found) throw new HttpError('not_found');
        const entry = found.byMethod.get(request.method);
        if (!entry) throw new HttpError('method_not_allowed');
        state.route = entry.pattern;

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
          identity: identity ? Object.freeze(identity) : undefined,
          claims,
          config,
          secret: secrets.secret,
          // Like `secret`, but a missing input is `undefined` and not an error (optional settings).
          optionalSecret: secrets.optionalSecret,
          // Registers a value that only exists at runtime (a user's access token, a sealed value) for redaction.
          addSensitive: secrets.addSensitive,
          store: storeInstance,
          requestId,
          rest: found.rest,
          now,
          startedAt,
          deadline,
          sleep: sleep || ((ms) => new Promise((resolve) => { setTimeout(resolve, ms); })),
          log: (event, fields) => logger(event, fields),
          // Adds safe fields (ids, enums, counts; never user text) to the request's final log line.
          annotate: (fields) => { Object.assign(state.extra, fields); },
          proxy: async (url, init, opts = {}) => {
            if (opts.auth?.scheme === 'basic') {
              // The composed Basic value is derived data: register it so it is redacted if an upstream echoes it.
              const { usernameSecret, username = '' } = opts.auth;
              const user = usernameSecret ? secrets.secret(usernameSecret) : username;
              secrets.addSensitive(Buffer.from(`${user}:${secrets.secret(opts.auth.secret)}`).toString('base64'));
            }
            if (typeof opts.auth?.token === 'string') secrets.addSensitive(opts.auth.token);
            const res = await rawProxy(url, init, opts, proxyDeps);
            return opts.mapErrors === false ? res : mapUpstream(res, opts, now);
          },
          fromUpstream,
        };
        return toResult(await entry.handler(ctx));
      };

      if (mode === 'public') {
        // Public variant (browser navigations that cannot carry a token): no origin gate, no IMS check, CORS is
        // never enabled. Every handler must authenticate its own request (sealed values).
        result = await dispatch(undefined, undefined);
      } else {
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
          result = await dispatch(identity, claims);
        }
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
      ...state.extra,
      ...(state.outcome === 'forbidden_origin' ? { deniedOrigin: String(state.origin).slice(0, 200) } : {}),
    });
    return response;
  };
}

export { HttpError, splitList };
