// Per-author connections of `user-oauth` providers (SPEC D6, D8, D9, D11): the encrypted record, refresh
// orchestration (single flight per container, a State lock across containers, one refresh and one retry when the
// provider reports a rejected token) and disconnect. Provider-agnostic: a provider only maps its vendor's token API.
import { randomUUID } from 'node:crypto';
import { HttpError } from '../../../../shared/worker-template/src/index.js';
import { ProviderError } from './provider.js';
import { sha256Base64Url } from './seal.js';

export const REFRESH_MARGIN_MS = 60_000;
const DEFAULT_EXPIRES_SECONDS = 3600;
const MAX_EXPIRES_SECONDS = 30 * 86400;
const LOCK_TTL_SECONDS = 20;
const LOCK_POLL_MS = 250;
const LOCK_POLLS = 20;
const MAX_TOKEN_LENGTH = 4096;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;

/** One in-flight refresh per connection inside a warm container (the cross-container case uses the State lock). */
const inflight = new Map();

/** The identity of a connection: a hash of the verified IMS user id and the provider id; never the raw user id. */
export const connKeyOf = (userId, providerId) => sha256Base64Url('conn.v1', userId, providerId);
const recordKey = (connKey) => `conn.v1.${connKey}`;
const lockKey = (connKey) => `lock.v1.${connKey}`;

const isText = (v, max = MAX_TOKEN_LENGTH) => typeof v === 'string' && v.length > 0 && v.length <= max;

/** Validates the provider's token result and returns the shell's shape; anything odd is a misconfiguration. */
export function normalizeToken(raw) {
  if (raw === null || typeof raw !== 'object' || !isText(raw.accessToken)) throw new ProviderError('misconfigured');
  let expires = raw.expiresInSeconds;
  if (expires === undefined || expires === null) expires = DEFAULT_EXPIRES_SECONDS;
  if (!Number.isFinite(expires) || expires <= 0) throw new ProviderError('misconfigured');
  const out = {
    accessToken: raw.accessToken,
    expiresInSeconds: Math.min(Math.floor(expires), MAX_EXPIRES_SECONDS),
  };
  if (raw.refreshToken !== undefined && raw.refreshToken !== null) {
    if (!isText(raw.refreshToken)) throw new ProviderError('misconfigured');
    out.refreshToken = raw.refreshToken;
  }
  if (typeof raw.scope === 'string') out.scope = raw.scope.slice(0, 1000);
  if (typeof raw.accountId === 'string') out.accountId = raw.accountId.slice(0, 200);
  return out;
}

/** Display name of the connected account: plain text, one line, at most 100 characters. */
export function cleanAccountName(value) {
  const raw = typeof value === 'string' ? value : value?.displayName;
  if (typeof raw !== 'string') return undefined;
  const text = raw.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
  return text || undefined;
}

/** True when the granted scope text (space or comma separated) contains every required scope. */
export const scopeCovers = (granted, required) => {
  const have = new Set(String(granted).split(/[\s,]+/).filter(Boolean));
  return required.every((s) => have.has(s));
};

export const connectionOf = (record) => {
  if (!record) return { state: 'not_connected' };
  const account = record.account?.displayName;
  return {
    state: record.reauth ? 'reauth_required' : 'connected',
    ...(account ? { account } : {}),
  };
};

function track(ctx, record) {
  if (record?.accessToken) ctx.addSensitive(record.accessToken);
  if (record?.refreshToken) ctx.addSensitive(record.refreshToken);
  return record;
}

/** Reads and decrypts one connection record; undefined when absent or unreadable (wrong key or tampered). */
export async function readRecord(ctx, settings, connKey) {
  const key = recordKey(connKey);
  const sealed = await ctx.store.get(key);
  if (sealed === undefined) return undefined;
  const record = settings.tokens.open(sealed, key);
  if (!record || record.v !== 1) {
    ctx.log('record_unreadable', {});
    return undefined;
  }
  return track(ctx, record);
}

export async function writeRecord(ctx, settings, connKey, record, { when } = {}) {
  const key = recordKey(connKey);
  const sealed = settings.tokens.seal(record, key);
  if (when) return ctx.store.putIf(key, sealed, { when, ttlSeconds: settings.ttlSeconds });
  await ctx.store.put(key, sealed, { ttlSeconds: settings.ttlSeconds });
  return true;
}

export const deleteRecord = (ctx, connKey) => ctx.store.delete(recordKey(connKey));

/** A record is usable without a refresh when more than the margin remains on the access token. */
const fresh = (ctx, record) => Number.isFinite(record.accessExpiresAt)
  && record.accessExpiresAt - ctx.now() > REFRESH_MARGIN_MS;

/** Wraps an unclassified provider failure: never reauth (a vocabulary surprise must not delete a connection). */
function classify(ctx, entry, e, step) {
  if (e instanceof ProviderError) return e;
  if (e instanceof HttpError) return e;
  ctx.log('provider_error', { provider: entry.provider.id, class: 'unclassified', step });
  return new ProviderError('misconfigured');
}

async function markReauth(ctx, settings, connKey, record) {
  const marker = {
    v: 1, reauth: true, account: { displayName: record?.account?.displayName }, at: ctx.now(),
  };
  // Only if the connection still exists: a concurrent disconnect must not be resurrected as a marker.
  await writeRecord(ctx, settings, connKey, marker, { when: 'present' });
}

async function refreshLocked(ctx, host, entry, settings, connKey, staleToken) {
  const { provider } = entry;
  const current = await readRecord(ctx, settings, connKey);
  if (!current) throw new ProviderError('not_connected');
  if (current.reauth) throw new ProviderError('reauth_required');
  // Another container may have refreshed while this request waited for the lock.
  if (current.accessToken !== staleToken && fresh(ctx, current)) return current;

  if (!current.refreshToken) {
    // A connection that cannot refresh (the provider does not require a refresh token) ends at expiry.
    await markReauth(ctx, settings, connKey, current);
    throw new ProviderError('reauth_required');
  }
  let result;
  try {
    const raw = await provider.refresh(host.callContext(ctx, entry), { refreshToken: current.refreshToken });
    result = normalizeToken(raw);
  } catch (e) {
    const failure = classify(ctx, entry, e, 'refresh');
    if (failure instanceof ProviderError && failure.kind === 'reauth_required') {
      // Before destroying anything: storage may now hold a newer record written by another container.
      const latest = await readRecord(ctx, settings, connKey);
      if (latest && !latest.reauth && latest.accessToken !== staleToken) return latest;
      ctx.log('connection_reauth', { provider: provider.id });
      await markReauth(ctx, settings, connKey, current);
      throw failure;
    }
    throw failure;
  }
  track(ctx, { accessToken: result.accessToken, refreshToken: result.refreshToken });
  const next = {
    ...current,
    accessToken: result.accessToken,
    accessExpiresAt: ctx.now() + result.expiresInSeconds * 1000,
    refreshToken: result.refreshToken ?? current.refreshToken,
    scope: result.scope ?? current.scope,
  };
  let written;
  try {
    written = await writeRecord(ctx, settings, connKey, next, { when: 'present' });
  } catch (e) {
    if (!(e instanceof HttpError)) throw e;
    // The provider may already have invalidated the old refresh token: try once more before giving up.
    written = await writeRecord(ctx, settings, connKey, next, { when: 'present' });
  }
  // Disconnected while the refresh was in flight: the record is not resurrected.
  if (!written) throw new ProviderError('not_connected');
  return next;
}

async function refreshWithLock(ctx, host, entry, settings, connKey, staleToken) {
  const owner = randomUUID();
  const key = lockKey(connKey);
  const have = await ctx.store.putIf(key, owner, { when: 'absent', ttlSeconds: LOCK_TTL_SECONDS });
  if (!have) {
    for (let i = 0; i < LOCK_POLLS; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await ctx.sleep(LOCK_POLL_MS);
      // eslint-disable-next-line no-await-in-loop
      const record = await readRecord(ctx, settings, connKey);
      if (!record) throw new ProviderError('not_connected');
      if (record.reauth) throw new ProviderError('reauth_required');
      if (record.accessToken !== staleToken && fresh(ctx, record)) return record;
    }
    // A provider whose refresh token never changes can refresh without the lock; one that rotates it cannot.
    if (entry.provider.rotatesRefreshToken !== false) throw new ProviderError('upstream_unavailable');
  }
  try {
    return await refreshLocked(ctx, host, entry, settings, connKey, staleToken);
  } finally {
    if (have) {
      try {
        if (await ctx.store.get(key) === owner) await ctx.store.delete(key);
      } catch {
        // the lock expires on its own
      }
    }
  }
}

/**
 * The author's usable credentials: the stored record, refreshed first when the access token is about to expire (or
 * `force`, after the provider rejected it). Throws ProviderError `not_connected` / `reauth_required`.
 */
export async function credentialsFor(ctx, host, entry, settings, { force = false, staleToken } = {}) {
  const connKey = connKeyOf(ctx.identity.userId, entry.provider.id);
  const record = await readRecord(ctx, settings, connKey);
  if (!record) throw new ProviderError('not_connected');
  if (record.reauth) throw new ProviderError('reauth_required');
  if (!force && fresh(ctx, record)) return record;
  const stale = staleToken ?? record.accessToken;
  // A force with a token that is no longer the stored one means someone already refreshed: use the stored record.
  if (force && record.accessToken !== stale && fresh(ctx, record)) return record;
  const flightKey = `${connKey}.${sha256Base64Url(stale)}`;
  if (!inflight.has(flightKey)) {
    const flight = refreshWithLock(ctx, host, entry, settings, connKey, stale)
      .finally(() => inflight.delete(flightKey));
    inflight.set(flightKey, flight);
  }
  return inflight.get(flightKey);
}

/** What a provider may see of a connection: the access token, the granted scope and the account. No refresh token. */
export const credentialsOf = (record) => ({
  accessToken: record.accessToken, scope: record.scope, account: record.account?.displayName,
});

/**
 * Runs `fn(credentials)`. When the provider reports the access token as rejected (`reauth_required`), forces exactly
 * one refresh and retries once; a second rejection is definitive: the connection is marked for reconnection.
 */
export async function withCredentials(ctx, host, entry, settings, fn) {
  const record = await credentialsFor(ctx, host, entry, settings);
  try {
    return await fn(credentialsOf(record));
  } catch (e) {
    if (!(e instanceof ProviderError) || e.kind !== 'reauth_required') throw e;
    const renewed = await credentialsFor(ctx, host, entry, settings, {
      force: true, staleToken: record.accessToken,
    });
    try {
      return await fn(credentialsOf(renewed));
    } catch (second) {
      if (second instanceof ProviderError && second.kind === 'reauth_required') {
        const connKey = connKeyOf(ctx.identity.userId, entry.provider.id);
        ctx.log('connection_reauth', { provider: entry.provider.id });
        await markReauth(ctx, settings, connKey, await readRecord(ctx, settings, connKey));
      }
      throw second;
    }
  }
}
