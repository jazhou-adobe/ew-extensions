// What the two actions (`api` and `oauth`) share: the provider registry, the "which providers are configured"
// rule, the OAuth host settings, and the per-call context handed to a provider. Nothing here knows any vendor.
import { HttpError } from '../../../../shared/worker-template/src/index.js';
import { buildRegistry, ConfigError, HOSTED_KINDS } from './provider.js';
import { createSealer, parseKey } from './seal.js';

const BASE_URL_PATH = /^\/.*\/oauth$/;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
export const DEFAULT_CONNECTION_TTL_DAYS = 180;

// A `$NAME` the deploy could not substitute (the name is missing from `.env`) arrives as the literal reference text:
// it counts as "not set", never as a value.
const UNSUBSTITUTED = /^\$[A-Za-z_][A-Za-z0-9_]*$/;
const present = (v) => typeof v === 'string' && v.trim() !== '' && !UNSUBSTITUTED.test(v.trim());

/**
 * The OAuth host settings (SPEC D16), or undefined when the host is not configured (no `user-oauth` provider is then
 * offered). An invalid present value throws ConfigError naming the setting.
 */
export function readOAuthSettings(ctx) {
  const base = ctx.config.OAUTH_PUBLIC_BASE_URL;
  const tokenKey = ctx.optionalSecret('TOKEN_ENC_KEY');
  const stateKey = ctx.optionalSecret('OAUTH_STATE_KEY');
  if (!present(base) || !present(tokenKey) || !present(stateKey)) return undefined;

  let url;
  try {
    url = new URL(base.trim());
  } catch {
    throw new ConfigError('OAUTH_PUBLIC_BASE_URL');
  }
  const local = present(ctx.config.ALLOWED_LOCAL_ORIGINS) && LOOPBACK.has(url.hostname) && url.protocol === 'http:';
  const hostOk = url.protocol === 'https:' && url.hostname.endsWith('.adobeioruntime.net');
  const oddParts = url.username || url.password || url.search || url.hash || (url.port && !local);
  if (!(hostOk || local) || oddParts || !BASE_URL_PATH.test(url.pathname)) {
    throw new ConfigError('OAUTH_PUBLIC_BASE_URL');
  }
  const current = parseKey(tokenKey, 'TOKEN_ENC_KEY');
  const previousRaw = ctx.optionalSecret('TOKEN_ENC_KEY_PREVIOUS');
  const previous = present(previousRaw) ? parseKey(previousRaw, 'TOKEN_ENC_KEY_PREVIOUS') : undefined;
  const state = parseKey(stateKey, 'OAUTH_STATE_KEY');
  if (current.equals(state) || (previous && previous.equals(state))) throw new ConfigError('OAUTH_STATE_KEY');
  let days = DEFAULT_CONNECTION_TTL_DAYS;
  if (present(ctx.config.CONNECTION_TTL_DAYS)) {
    if (!/^\d{1,3}$/.test(ctx.config.CONNECTION_TTL_DAYS.trim())) throw new ConfigError('CONNECTION_TTL_DAYS');
    days = Number(ctx.config.CONNECTION_TTL_DAYS);
    if (days < 1 || days > 365) throw new ConfigError('CONNECTION_TTL_DAYS');
  }
  const baseUrl = `${url.origin}${url.pathname}`;
  return Object.freeze({
    baseUrl,
    cookiePath: url.pathname,
    secureCookie: url.protocol === 'https:',
    redirectUri: (providerId) => `${baseUrl}/${providerId}/callback`,
    state: createSealer({ current: state }),
    tokens: createSealer({ current, previous }),
    ttlSeconds: days * 86400,
  });
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

const WORK_BUDGET_MS = 20000;
const SAFETY_MARGIN_MS = 4000;

export function createHost({ providers, hostedKinds = HOSTED_KINDS }) {
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

  /** The OAuth host settings; an invalid present value is a misconfiguration (names the setting only). */
  function oauthSettings(ctx) {
    try {
      return readOAuthSettings(ctx);
    } catch (e) {
      if (!(e instanceof ConfigError)) throw e;
      ctx.log('config_invalid', { setting: e.setting });
      throw new HttpError('misconfigured');
    }
  }

  /**
   * Providers whose required inputs are present, with their validated config. An invalid present value fails; a
   * `user-oauth` provider is offered only when the OAuth host itself is configured.
   */
  function configured(ctx) {
    const out = new Map();
    let settings;
    let settingsRead = false;
    getRegistry(ctx).forEach((provider) => {
      const present2 = provider.config.required.every((n) => present(ctx.config[n]));
      if (!present2) return;
      const secretsOk = provider.config.secrets.every((n) => {
        try {
          return present(ctx.secret(n));
        } catch {
          return false;
        }
      });
      if (!secretsOk) return;
      if (provider.credentialKind === 'user-oauth') {
        if (!settingsRead) {
          settings = oauthSettings(ctx);
          settingsRead = true;
        }
        if (!settings) {
          ctx.log('oauth_host_unconfigured', { provider: provider.id });
          return;
        }
      }
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

  /**
   * The per-call context a provider receives: validated config, secret accessor, a proxy pinned to its outbound hosts,
   * its namespaced store, the clock and, for `user-oauth`, the author's credentials. Never the IMS token, the inbound
   * headers or cookies.
   */
  const callContext = (ctx, { provider, config }, { credentials } = {}) => Object.freeze({
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
    // Milliseconds this request can still spend before the invocation deadline (minus a safety margin).
    timeLeftMs: () => {
      const spent = ctx.now() - ctx.startedAt;
      const left = ctx.deadline ? ctx.deadline - SAFETY_MARGIN_MS - ctx.now() : WORK_BUDGET_MS - spent;
      return Math.max(0, left);
    },
    ...(credentials ? { credentials: Object.freeze({ ...credentials }) } : {}),
  });

  return {
    getRegistry, configured, callContext, oauthSettings,
  };
}
