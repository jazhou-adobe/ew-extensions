// Shell routes of the authenticated `api` action (SPEC D20):
//   GET  /dam/providers                      the configured providers, their connection and capabilities
//   GET  /dam/{provider}/assets[/{id}]       search and detail
//   POST /dam/{provider}/connect             `user-oauth`: a one-time URL that starts the sign-in pop-up
//   GET  /dam/{provider}/session             `user-oauth`: the author's connection state
//   POST /dam/{provider}/disconnect          `user-oauth`: revoke upstream (best effort) and forget the connection
// The shell owns validation, the result cache, error mapping, the output URL policy, token storage and refresh, and
// logging; a provider only maps its vendor API. The IMS token, request headers and cookies never reach a provider.
import { createHash } from 'node:crypto';
import { HttpError } from '../../../../shared/worker-template/src/index.js';
import {
  ProviderError, HOSTED_KINDS, PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX, MAX_QUERY_LENGTH, CACHE_MAX_BYTES,
} from './provider.js';
import { normalizeDetail, normalizeList } from './policy.js';
import { createHost } from './registry.js';
import {
  connectionOf, connKeyOf, credentialsFor, credentialsOf, deleteRecord, readRecord, withCredentials,
} from './connections.js';
import { sha256Base64Url } from './seal.js';

const NUMBER = /^[0-9]{1,6}$/;
const SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;

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
      case 'reauth_required': return new HttpError('provider_reauth_required');
      case 'not_connected': return new HttpError('provider_not_connected');
      case 'upstream_unavailable': return new HttpError('upstream_unavailable');
      default: return new HttpError('internal');
    }
  }
  return e;
}

function describeProvider({ provider, config }, connection) {
  const account = provider.accountLabel ? provider.accountLabel(config) : undefined;
  return {
    id: provider.id,
    label: provider.label,
    credentialKind: provider.credentialKind,
    connection: connection || { state: 'connected', ...(account ? { account } : {}) },
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

const USER_CACHE_MAX_ENTRIES = 40;

/** The id segment as the provider's pattern sees it: a percent-encoded id (`id%3Aabc`) is decoded once. */
function decodeId(segment) {
  if (!segment.includes('%')) return segment;
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new HttpError('bad_request');
  }
}

/**
 * Builds the route table for the `api` action.
 * @param {{ providers: object[], hostedKinds?: string[] }} options
 */
export function createRoutes({ providers, hostedKinds = HOSTED_KINDS }) {
  const host = createHost({ providers, hostedKinds });
  const { configured, callContext, oauthSettings } = host;
  // Result cache of `user-oauth` providers: container memory only (file names of private files never go to State),
  // per author (the key includes the connection key), dropped on disconnect and on a reconnect demand.
  const userCache = new Map();
  const dropUserCache = (connKey) => {
    [...userCache.entries()].forEach(([k, v]) => {
      if (v.connKey === connKey) userCache.delete(k);
    });
  };

  async function readCache(ctx, key) {
    try {
      return await ctx.store.get(key);
    } catch (e) {
      if (e instanceof HttpError) return null;
      throw e;
    }
  }

  async function searchOAuth(ctx, entry, query) {
    const { provider, config } = entry;
    const settings = oauthSettings(ctx);
    const connKey = connKeyOf(ctx.identity.userId, provider.id);
    const ttl = provider.cacheSeconds(config);
    const hosts = provider.deliveryHosts(config).map((h) => h.toLowerCase());
    const key = sha256Base64Url(connKey, JSON.stringify([provider.fingerprint(config), query]));
    let hit;
    // The connection is checked (and refreshed when needed) before any cached answer is served.
    const raw = await withCredentials(ctx, host, entry, settings, async (credentials) => {
      const cached = ttl > 0 ? userCache.get(key) : undefined;
      if (cached && cached.expiresAt > ctx.now()) {
        hit = cached.value;
        return undefined;
      }
      return provider.search(callContext(ctx, entry, { credentials }), query);
    });
    if (hit) {
      ctx.annotate({ cache: 'hit' });
      return hit;
    }
    const result = normalizeList(raw, provider, hosts, query);
    ctx.annotate({ cache: ttl > 0 ? 'miss' : 'off' });
    if (ttl > 0 && Buffer.byteLength(JSON.stringify(result)) <= CACHE_MAX_BYTES * 8) {
      userCache.delete(key);
      userCache.set(key, { connKey, expiresAt: ctx.now() + ttl * 1000, value: result });
      if (userCache.size > USER_CACHE_MAX_ENTRIES) userCache.delete(userCache.keys().next().value);
    }
    return result;
  }

  async function search(ctx, entry, request) {
    const { provider, config } = entry;
    const query = parseSearch(request, provider);
    ctx.annotate({ provider: provider.id, op: 'search' });
    if (provider.credentialKind === 'user-oauth') {
      try {
        return await searchOAuth(ctx, entry, query);
      } catch (e) {
        throw mapFailure(e, provider, ctx);
      }
    }
    const ttl = provider.cacheSeconds(config);
    const hosts = provider.deliveryHosts(config).map((h) => h.toLowerCase());
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
      raw = provider.credentialKind === 'user-oauth'
        ? await withCredentials(ctx, host, entry, oauthSettings(ctx), (credentials) => provider.getAsset(
          callContext(ctx, entry, { credentials }),
          id,
        ))
        : await provider.getAsset(callContext(ctx, entry), id);
    } catch (e) {
      throw mapFailure(e, provider, ctx);
    }
    const hosts = provider.deliveryHosts(config).map((h) => h.toLowerCase());
    return { asset: normalizeDetail(raw, provider, hosts) };
  }

  /** Connection state of the calling author for one `user-oauth` provider. */
  async function connectionFor(ctx, entry) {
    const settings = oauthSettings(ctx);
    const record = await readRecord(ctx, settings, connKeyOf(ctx.identity.userId, entry.provider.id));
    return connectionOf(record);
  }

  async function connect(ctx, entry) {
    const { provider } = entry;
    const settings = oauthSettings(ctx);
    const connKey = connKeyOf(ctx.identity.userId, provider.id);
    // The sealed state the begin step will build is about this long: refuse here instead of truncating later.
    const sample = settings.state.seal({
      p: 'state', provider: provider.id, conn: connKey, n: sha256Base64Url('nonce'), exp: ctx.now() + 600_000,
    }, 'state');
    if (Buffer.byteLength(sample) > (provider.maxStateBytes ?? 2000)) {
      ctx.log('state_too_long', { provider: provider.id });
      throw new HttpError('bad_request');
    }
    const ticket = settings.state.seal({
      p: 'ticket', provider: provider.id, conn: connKey, exp: ctx.now() + 60_000,
    }, 'ticket');
    ctx.annotate({ provider: provider.id, op: 'connect' });
    return { beginUrl: `${settings.baseUrl}/${provider.id}/begin?ticket=${encodeURIComponent(ticket)}` };
  }

  async function disconnect(ctx, entry) {
    const { provider } = entry;
    const settings = oauthSettings(ctx);
    const connKey = connKeyOf(ctx.identity.userId, provider.id);
    ctx.annotate({ provider: provider.id, op: 'disconnect' });
    const record = await readRecord(ctx, settings, connKey);
    if (record && !record.reauth && provider.revoke) {
      // Best effort: the record is deleted whatever happens upstream (a stuck record cannot be fixed by the author).
      try {
        const fresh = await credentialsFor(ctx, host, entry, settings);
        await provider.revoke(callContext(ctx, entry, { credentials: credentialsOf(fresh) }));
      } catch (e) {
        ctx.log('revoke_failed', { provider: provider.id, class: e instanceof ProviderError ? e.kind : 'error' });
      }
    }
    await deleteRecord(ctx, connKey);
    dropUserCache(connKey);
    return { connection: connectionOf(undefined) };
  }

  const split = (ctx) => {
    const segments = ctx.rest.split('/');
    const [providerId, resource, id, ...extra] = segments;
    return {
      segments, providerId, resource, id, extra,
    };
  };
  const entryFor = (ctx, providerId) => {
    if (!SEGMENT.test(providerId || '')) throw new HttpError('not_found');
    const entry = configured(ctx).get(providerId);
    if (!entry) throw new HttpError('not_found');
    return entry;
  };
  const oauthEntryFor = (ctx, providerId) => {
    const entry = entryFor(ctx, providerId);
    if (entry.provider.credentialKind !== 'user-oauth') throw new HttpError('not_found');
    return entry;
  };

  return {
    'GET /dam/providers': async (ctx) => {
      const entries = [...configured(ctx).values()];
      const described = [];
      for (const entry of entries) {
        // eslint-disable-next-line no-await-in-loop
        const connection = entry.provider.credentialKind === 'user-oauth' ? await connectionFor(ctx, entry) : undefined;
        described.push(describeProvider(entry, connection));
      }
      return { providers: described };
    },
    'GET /dam/*': async (ctx) => {
      const {
        segments, providerId, resource, id, extra,
      } = split(ctx);
      if (resource === 'session' && segments.length === 2) {
        const entry = oauthEntryFor(ctx, providerId);
        ctx.annotate({ provider: providerId, op: 'session' });
        return { connection: await connectionFor(ctx, entry) };
      }
      if (!SEGMENT.test(providerId || '') || resource !== 'assets' || extra.length || (id !== undefined && id === '')
        || segments.length > 3) {
        throw new HttpError('not_found');
      }
      const entry = entryFor(ctx, providerId);
      if (id === undefined) return search(ctx, entry, ctx.request);
      return detail(ctx, entry, decodeId(id));
    },
    'POST /dam/*': async (ctx) => {
      const { segments, providerId, resource } = split(ctx);
      if ((segments.length === 1 && providerId === 'providers') || resource === 'assets' || resource === 'session') {
        throw new HttpError('method_not_allowed');
      }
      if (segments.length !== 2 || (resource !== 'connect' && resource !== 'disconnect')) {
        throw new HttpError('not_found');
      }
      const entry = oauthEntryFor(ctx, providerId);
      return resource === 'connect' ? connect(ctx, entry) : disconnect(ctx, entry);
    },
  };
}
