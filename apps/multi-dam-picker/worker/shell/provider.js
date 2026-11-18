/* eslint-disable max-classes-per-file */
// The provider interface (SPEC D3/D4): what a DAM module must declare, how a declaration is validated, and the
// registry the shell routes against. Nothing in this file knows any vendor.

export const ASSET_TYPES = ['image', 'video', 'document', 'audio'];
export const OUTPUT_TYPES = [...ASSET_TYPES, 'other'];
export const CREDENTIAL_KINDS = ['service', 'user-oauth'];
/** The credential kinds this build hosts. #25 adds `user-oauth` together with its OAuth routes and token store. */
export const HOSTED_KINDS = Object.freeze(['service']);
export const PAGE_SIZE_DEFAULT = 24;
export const PAGE_SIZE_MAX = 50;
export const MAX_QUERY_LENGTH = 200;
export const CACHE_MAX_BYTES = 64 * 1024;

/** Failure classes a provider reports (SPEC D3). The last two are reserved for `user-oauth` and never emitted yet. */
export const FAILURE_KINDS = [
  'bad_request', 'not_found', 'forbidden', 'rate_limited', 'misconfigured', 'upstream_unavailable',
  'reauth_required', 'not_connected',
];

/** Thrown by a provider to report a failure class; the shell maps it to the error contract (no message is used). */
export class ProviderError extends Error {
  constructor(kind, { retryAfterSeconds } = {}) {
    super(`provider failure: ${kind}`);
    this.name = 'ProviderError';
    this.kind = FAILURE_KINDS.includes(kind) ? kind : 'upstream_unavailable';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Thrown by a provider's `config.resolve` for an invalid present setting. Names the setting, never the value. */
export class ConfigError extends Error {
  constructor(setting) {
    super(`invalid setting ${setting}`);
    this.name = 'ConfigError';
    this.setting = setting;
  }
}

const ID = /^[a-z][a-z0-9-]{0,31}$/;
const SORT_ID = /^[a-z][a-z0-9_-]{0,31}$/;
const isFn = (v) => typeof v === 'function';
const isStringList = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string' && s);

function fail(id, message) {
  throw new Error(`provider "${id}": ${message}`);
}

function requireMember(p, name, ok) {
  if (p[name] === undefined || p[name] === null) fail(p.id, `missing member "${name}"`);
  if (!ok(p[name])) fail(p.id, `invalid member "${name}"`);
}

/** Validates one declaration. Throws an Error naming the provider and the member; returns the provider. */
export function validateProvider(p) {
  if (!p || typeof p !== 'object') throw new Error('provider: declaration must be an object');
  if (typeof p.id !== 'string' || !ID.test(p.id)) {
    fail(String(p.id).slice(0, 40), 'invalid member "id" (lower-case slug)');
  }
  requireMember(p, 'label', (v) => typeof v === 'string' && v.length > 0 && v.length <= 60);
  requireMember(p, 'credentialKind', (v) => CREDENTIAL_KINDS.includes(v));
  requireMember(p, 'assetTypes', (v) => isStringList(v) && v.length > 0 && v.every((t) => ASSET_TYPES.includes(t))
    && new Set(v).size === v.length);
  requireMember(p, 'sorts', (v) => Array.isArray(v) && v.length > 0 && v.every((s) => s && SORT_ID.test(s.id)
    && typeof s.label === 'string' && s.label) && new Set(v.map((s) => s.id)).size === v.length);
  requireMember(p, 'defaultSort', (v) => p.sorts.some((s) => s.id === v && !s.requiresQuery));
  requireMember(p, 'window', (v) => Number.isInteger(v) && v >= PAGE_SIZE_MAX);
  requireMember(p, 'assetIdPattern', (v) => v instanceof RegExp && !v.global && !v.sticky
    && v.source.startsWith('^') && v.source.endsWith('$'));
  ['outboundHosts', 'deliveryHosts', 'cacheSeconds', 'fingerprint', 'search', 'getAsset'].forEach((name) => {
    requireMember(p, name, isFn);
  });
  if (p.accountLabel !== undefined && !isFn(p.accountLabel)) fail(p.id, 'invalid member "accountLabel"');
  requireMember(p, 'config', (v) => typeof v === 'object' && isStringList(v.required) && isStringList(v.secrets)
    && isFn(v.resolve));
  if (p.credentialKind === 'user-oauth') {
    requireMember(p, 'scopes', isStringList);
    ['buildAuthorizeUrl', 'exchangeCode', 'refresh', 'accountName'].forEach((name) => requireMember(p, name, isFn));
    if (p.revoke !== undefined && !isFn(p.revoke)) fail(p.id, 'invalid member "revoke"');
    if (p.maxStateLength !== undefined && !(Number.isInteger(p.maxStateLength) && p.maxStateLength > 0)) {
      fail(p.id, 'invalid member "maxStateLength"');
    }
  }
  return p;
}

/**
 * Validates every declaration and returns `Map<id, provider>`. Throws on a malformed or duplicate declaration and on
 * a credential kind this build does not host (a half-working OAuth provider can never ship).
 */
export function buildRegistry(providers, { hostedKinds = HOSTED_KINDS } = {}) {
  const registry = new Map();
  providers.forEach((p) => {
    validateProvider(p);
    if (registry.has(p.id)) fail(p.id, 'duplicate id');
    if (!hostedKinds.includes(p.credentialKind)) fail(p.id, 'credential kind not hosted by this build');
    registry.set(p.id, p);
  });
  return registry;
}
