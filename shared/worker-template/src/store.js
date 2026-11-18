import { HttpError } from './errors.js';

export const DEFAULT_TTL_SECONDS = 86400;
export const MAX_TTL_SECONDS = 365 * 86400;
export const MAX_VALUE_BYTES = 1_000_000;
const MAX_KEY_BYTES = 1024;
const KEY_CHARS = /^[A-Za-z0-9._-]+$/;

/** Programming errors (bad key, oversized value) are plain errors: they surface as `500 internal`. */
export class StoreUsageError extends Error {}

function validate(workerName, key, ttlSeconds) {
  if (typeof key !== 'string' || !KEY_CHARS.test(key)) {
    throw new StoreUsageError('store key must be a non-empty string of letters, digits, "-", "_" or "."');
  }
  const full = `${workerName}.${key}`;
  if (Buffer.byteLength(full) > MAX_KEY_BYTES) throw new StoreUsageError('store key is too long');
  if (ttlSeconds !== undefined
    && (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_TTL_SECONDS)) {
    throw new StoreUsageError('ttlSeconds must be an integer between 1 and 365 days');
  }
  return full;
}

/**
 * Store adapter over a string-only State client: JSON values, per-worker key prefix, TTL in seconds.
 * `clientFactory` is called lazily on first use and its result reused (one client per container).
 * Any State failure maps to `503 store_unavailable`.
 */
export function createStore({ workerName, clientFactory }) {
  let clientPromise;
  const client = () => {
    clientPromise ||= Promise.resolve().then(clientFactory);
    return clientPromise;
  };
  const guard = async (fn) => {
    try {
      return await fn(await client());
    } catch (e) {
      if (e instanceof StoreUsageError) throw e;
      clientPromise = undefined;
      throw new HttpError('store_unavailable', { cause: e });
    }
  };
  return {
    async get(key) {
      const full = validate(workerName, key);
      const entry = await guard((c) => c.get(full));
      if (!entry || typeof entry.value !== 'string') return undefined;
      return JSON.parse(entry.value);
    },
    async put(key, value, { ttlSeconds = DEFAULT_TTL_SECONDS } = {}) {
      const full = validate(workerName, key, ttlSeconds);
      const text = JSON.stringify(value);
      if (text === undefined) throw new StoreUsageError('store value must be JSON-serialisable');
      if (Buffer.byteLength(text) > MAX_VALUE_BYTES) throw new StoreUsageError('store value is too large');
      await guard((c) => c.put(full, text, { ttl: ttlSeconds }));
    },
    async delete(key) {
      const full = validate(workerName, key);
      await guard((c) => c.delete(full));
    },
  };
}

/** In-memory twin of the store for tests and local runs. Same validation, TTL expiry with injected `now`. */
export function memoryStore({ workerName = 'memory', now = Date.now } = {}) {
  const entries = new Map();
  const puts = [];
  const store = createStore({
    workerName,
    clientFactory: () => ({
      get: async (key) => {
        const e = entries.get(key);
        if (!e) return undefined;
        if (e.expiresAt <= now()) {
          entries.delete(key);
          return undefined;
        }
        return { value: e.value };
      },
      put: async (key, value, { ttl }) => {
        puts.push({ key, ttl });
        entries.set(key, { value, expiresAt: now() + ttl * 1000 });
      },
      delete: async (key) => { entries.delete(key); },
    }),
  });
  return Object.assign(store, { puts, entries });
}

/** Real State client, created lazily inside a deployed action (credentials are implicit in Runtime). */
export function stateClientFactory(region) {
  return async () => {
    const { init } = await import('@adobe/aio-lib-state');
    return init(region ? { region } : undefined);
  };
}
