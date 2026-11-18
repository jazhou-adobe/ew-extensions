// Dropbox settings (SPEC D16, D18): parsing and validation. An invalid present value throws ConfigError naming the
// setting only; the value never appears in a message. There is deliberately no input that changes a host.
import { ConfigError } from '../../../worker/shell/provider.js';

export const REQUIRED_INPUTS = ['DROPBOX_CLIENT_ID'];
export const SECRET_INPUTS = ['DROPBOX_CLIENT_SECRET'];
/** Every scope the provider's calls need; `DROPBOX_SCOPES` may only name these. */
export const SCOPES = Object.freeze([
  'account_info.read', 'files.metadata.read', 'files.content.read', 'sharing.read', 'sharing.write',
]);

const CLIENT_ID = /^[A-Za-z0-9_-]{4,64}$/;
const TEMPLATE_ID = /^ptid:[A-Za-z0-9_-]{1,64}$/;
const FIELD_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const MAX_CACHE_SECONDS = 3600;

// An input the deploy could not substitute arrives as the literal `$NAME`: it counts as blank.
const UNSUBSTITUTED = /^\$[A-Za-z_][A-Za-z0-9_]*$/;
const blank = (v) => v === undefined || v === null || String(v).trim() === '' || UNSUBSTITUTED.test(String(v).trim());

/** Normalises the browse root: empty (the whole Dropbox) or `/folder/sub`, no dot segments, no URL, no controls. */
export function normalizeRoot(raw) {
  if (blank(raw)) return '';
  const text = String(raw).trim();
  const path = text.startsWith('/') ? text : `/${text}`;
  const trimmed = path.replace(/\/+$/, '');
  if (!trimmed) return '';
  if (trimmed.length > 300 || CONTROL.test(trimmed) || /^\/*[A-Za-z][A-Za-z0-9+.-]*:/.test(trimmed)
    || /[?#\\]/.test(trimmed) || trimmed.split('/').slice(1).some((s) => s === '' || s === '.' || s === '..')) {
    throw new ConfigError('DROPBOX_ROOT_PATH');
  }
  return trimmed;
}

function scopes(raw) {
  if (blank(raw)) return [...SCOPES];
  const list = [...new Set(String(raw).split(/[\s,]+/).filter(Boolean))];
  if (list.some((s) => !SCOPES.includes(s)) || SCOPES.some((s) => !list.includes(s))) {
    throw new ConfigError('DROPBOX_SCOPES');
  }
  return [...SCOPES];
}

function cacheSeconds(raw) {
  if (blank(raw)) return 30;
  const text = String(raw).trim();
  if (!/^\d{1,4}$/.test(text) || Number(text) > MAX_CACHE_SECONDS) throw new ConfigError('DROPBOX_CACHE_SECONDS');
  return Number(text);
}

/** Validates the raw worker inputs and returns the resolved Dropbox settings. */
export function resolveConfig(raw = {}) {
  const clientId = String(raw.DROPBOX_CLIENT_ID ?? '').trim();
  if (!CLIENT_ID.test(clientId)) throw new ConfigError('DROPBOX_CLIENT_ID');
  const templateId = blank(raw.DROPBOX_ALT_TEMPLATE_ID) ? '' : String(raw.DROPBOX_ALT_TEMPLATE_ID).trim();
  const field = blank(raw.DROPBOX_ALT_FIELD) ? '' : String(raw.DROPBOX_ALT_FIELD).trim();
  if (templateId && !TEMPLATE_ID.test(templateId)) throw new ConfigError('DROPBOX_ALT_TEMPLATE_ID');
  if (field && !FIELD_NAME.test(field)) throw new ConfigError('DROPBOX_ALT_FIELD');
  return Object.freeze({
    clientId,
    scopes: Object.freeze(scopes(raw.DROPBOX_SCOPES)),
    root: normalizeRoot(raw.DROPBOX_ROOT_PATH),
    alt: templateId && field ? Object.freeze({ templateId, field }) : undefined,
    altIncomplete: Boolean(templateId) !== Boolean(field),
    cacheSeconds: cacheSeconds(raw.DROPBOX_CACHE_SECONDS),
  });
}
