// Shell routes (SPEC D20): GET /dam/providers, GET /dam/{provider}/assets, GET /dam/{provider}/assets/{id}.
// The shell owns validation, the result cache, error mapping, the output URL policy and logging; a provider only
// maps its vendor API. The IMS token, request headers and cookies never reach a provider.
import { createHash } from 'node:crypto';
import { HttpError } from '../../../../shared/worker-template/src/index.js';
import {
  buildRegistry, ConfigError, ProviderError, HOSTED_KINDS, PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX, MAX_QUERY_LENGTH,
  CACHE_MAX_BYTES,
} from './provider.js';
import { normalizeDetail, normalizeList } from './policy.js';

const SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;
const NUMBER = /^[0-9]{1,6}$/;

const clampRetry = (n) => (Number.isFinite(n) ? Math.min(3600, Math.max(1, Math.ceil(n))) : 60);

/** Maps a provider failure class to the #2 error contract; anything untyped is left to become `500 internal`. */
function mapFailure(e, provider, ctx) {
  if (e instanceof ProviderError) {
    ctx.log('provider_error', { provider: provider.id, class: e.kind });
    switch (e.kind) {
      case 'bad_request': return new HttpError('bad_request');
      case 'not_found': return new HttpError('not_found');
      case 'forbidden': return new HttpError('forbidden');
      case 'rate_limited': return new HttpError('rate_limited', { retryAfterSeconds: clampRetry(e.retryAfterSeconds) });
      case 'misconfigured': return new HttpError('misconfigured');
      case 'upstream_unavailable': return new HttpError('upstream_unavailable');
      default: return new HttpError('internal');
    }
  }
  return e;
}

/** Best-effort store view for a provider: keys are suffixed with the provider id; a failing store is swallowed. */
function providerStore(store, id) {
  const guard = async (fn, fallback) => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof HttpError) return fallback;
      throw e;
    }
  };
  return Object.freeze({
    get: (key) => guard(() => store.get(`${key}.${id}`), undefined),
    put: (key, value, opts) => guard(() => store.put(`${key}.${id}`, value, opts), undefined),
    delete: (key) => guard(() => store.delete(`${key}.${id}`), undefined),
  });
}

function describeProvider({ provider, config }) {
  const account = provider.accountLabel ? provider.accountLabel(config) : undefined;
  return {
    id: provider.id,
    label: provider.label,
    credentialKind: provider.credentialKind,
    connection: { state: 'connected', ...(account ? { account } : {}) },
    capabilities: {
      assetTypes: provider.assetTypes,
      sorts: provider.sorts.map(({ id, label, requiresQuery }) => ({
        id, label, requiresQuery: requiresQuery === true,
      })),
      defaultSort: provider.defaultSort,
      window: provider.window,
      pageSize: { default: PAGE_SIZE_DEFAULT, max: PAGE_SIZE_MAX },
    },
  };
}

function parseSearch(request, provider) {
  const q = request.query.get('q') ?? '';
  if (q.length > MAX_QUERY_LENGTH) throw new HttpError('bad_request');
  const type = request.query.get('type') || 'all';
  if (type !== 'all' && !provider.assetTypes.includes(type)) throw new HttpError('bad_request');
  const sort = request.query.get('sort') || provider.defaultSort;
  const sortDef = provider.sorts.find((s) => s.id === sort);
  if (!sortDef || (sortDef.requiresQuery && !q.trim())) throw new HttpError('bad_request');
  const num = (name, fallback) => {
    const raw = request.query.get(name);
    if (raw === null || raw === '') return fallback;
    if (!NUMBER.test(raw)) throw new HttpError('bad_request');
    return Number(raw);
  };
  const page = num('page', 1);
  const pageSize = num('pageSize', PAGE_SIZE_DEFAULT);
  if (page < 1 || pageSize < 1 || pageSize > PAGE_SIZE_MAX) throw new HttpError('bad_request');
  if ((page - 1) * pageSize >= provider.window) throw new HttpError('bad_request');
  return {
    q, type, sort, page, pageSize,
  };
}

/**
 * Builds the route table for the worker.
 * @param {{ providers: object[], hostedKinds?: string[] }} options
 */
export function createRoutes({ providers, hostedKinds = HOSTED_KINDS }) {
  let registry;
  const getRegistry = (ctx) => {
    try {
      registry ||= buildRegistry(providers, { hostedKinds });
    } catch (e) {
      ctx.log('registry_invalid', { reason: e.message });
      throw new HttpError('misconfigured');
    }
    return registry;
  };

  /** Providers whose required inputs are present, with their validated config. Invalid present values fail. */
  function configured(ctx) {
    const out = new Map();
    getRegistry(ctx).forEach((provider) => {
      const present = provider.config.required.every((n) => typeof ctx.config[n] === 'string' && ctx.config[n].trim());
      if (!present) return;
      const secretsOk = provider.config.secrets.every((n) => {
        try {
          return Boolean(ctx.secret(n));
        } catch {
          return false;
        }
      });
      if (!secretsOk) return;
      let config;
      try {
        config = provider.config.resolve(ctx.config);
      } catch (e) {
        if (!(e instanceof ConfigError)) throw e;
        ctx.log('config_invalid', { provider: provider.id, setting: e.setting });
        throw new HttpError('misconfigured');
      }
      out.set(provider.id, { provider, config });
    });
    return out;
  }

  const callContext = (ctx, { provider, config }) => Object.freeze({
    config,
    now: ctx.now,
    requestId: ctx.requestId,
    secret: (name) => {
      if (!provider.config.secrets.includes(name)) throw new Error('secret not declared by the provider');
      return ctx.secret(name);
    },
    proxy: (url, init, opts = {}) => ctx.proxy(url, init, { ...opts, allowedHosts: provider.outboundHosts(config) }),
    store: providerStore(ctx.store, provider.id),
    log: (event, fields) => ctx.log(event, { ...fields, provider: provider.id }),
  });

  async function readCache(ctx, key) {
    try {
      return await ctx.store.get(key);
    } catch (e) {
      if (e instanceof HttpError) return null;
      throw e;
    }
  }

  async function search(ctx, entry, request) {
    const { provider, config } = entry;
    const query = parseSearch(request, provider);
    const ttl = provider.cacheSeconds(config);
    const hosts = provider.deliveryHosts(config).map((h) => h.toLowerCase());
    ctx.annotate({ provider: provider.id, op: 'search' });
    let key;
    let storeUp = true;
    if (ttl > 0) {
      const digest = createHash('sha256').update(JSON.stringify([provider.fingerprint(config), query])).digest('hex');
      key = `cache.${provider.id}.${digest}`;
      const hit = await readCache(ctx, key);
      if (hit === null) storeUp = false;
      else if (hit) {
        ctx.annotate({ cache: 'hit' });
        return hit;
      }
    }
    let raw;
    try {
      raw = await provider.search(callContext(ctx, entry), query);
    } catch (e) {
      throw mapFailure(e, provider, ctx);
    }
    const result = normalizeList(raw, provider, hosts, query);
    ctx.annotate({ cache: key ? 'miss' : 'off' });
    if (key && storeUp && Buffer.byteLength(JSON.stringify(result)) <= CACHE_MAX_BYTES) {
      try {
        await ctx.store.put(key, result, { ttlSeconds: Math.max(1, Math.ceil(ttl)) });
      } catch (e) {
        if (!(e instanceof HttpError)) throw e;
      }
    }
    return result;
  }

  async function detail(ctx, entry, id) {
    const { provider, config } = entry;
    if (!provider.assetIdPattern.test(id)) throw new HttpError('bad_request');
    ctx.annotate({ provider: provider.id, op: 'detail' });
    let raw;
    try {
      raw = await provider.getAsset(callContext(ctx, entry), id);
    } catch (e) {
      throw mapFailure(e, provider, ctx);
    }
    const hosts = provider.deliveryHosts(config).map((h) => h.toLowerCase());
    return { asset: normalizeDetail(raw, provider, hosts) };
  }

  return {
    'GET /dam/providers': async (ctx) => {
      const entries = [...configured(ctx).values()];
      return { providers: entries.map(describeProvider) };
    },
    'GET /dam/*': async (ctx) => {
      const segments = ctx.rest.split('/');
      const [providerId, resource, id, ...extra] = segments;
      if (!SEGMENT.test(providerId || '') || resource !== 'assets' || extra.length || (id !== undefined && id === '')
        || segments.length > 3) {
        throw new HttpError('not_found');
      }
      const entry = configured(ctx).get(providerId);
      if (!entry) throw new HttpError('not_found');
      if (id === undefined) return search(ctx, entry, ctx.request);
      return detail(ctx, entry, id);
    },
  };
}
