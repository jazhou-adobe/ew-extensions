// Cloudinary settings (SPEC D21): parsing and validation. An invalid present value throws ConfigError naming the
// setting only; the value never appears in a message.
import { ConfigError } from '../../../worker/shell/provider.js';

export const API_HOSTS = ['api.cloudinary.com', 'api-eu.cloudinary.com', 'api-ap.cloudinary.com'];
export const DEFAULT_DELIVERY_HOST = 'res.cloudinary.com';
export const REQUIRED_INPUTS = ['CLOUDINARY_CLOUD_NAME'];
export const SECRET_INPUTS = ['CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];

const CLOUD_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const FIELD_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const RENDITION_ID = /^[a-z][a-z0-9-]{0,23}$/;
const TRANSFORMATION = /^[A-Za-z0-9_,:.\-/]{1,200}$/;
// eslint-disable-next-line no-control-regex
const ROOT_CHARS = /^[^\u0000-\u001f\u007f"\\*]+$/u;
const MAX_RENDITIONS = 8;
const MAX_CACHE_SECONDS = 3600;

export const DEFAULT_RENDITIONS = Object.freeze([
  {
    id: 'web', label: 'Web, up to 1200 px', transformation: 'c_limit,w_1200/f_auto/q_auto', width: 1200,
  },
  {
    id: 'large', label: 'Large, up to 2000 px', transformation: 'c_limit,w_2000/f_auto/q_auto', width: 2000,
  },
  {
    id: 'medium', label: 'Medium, up to 800 px', transformation: 'c_limit,w_800/f_auto/q_auto', width: 800,
  },
  {
    id: 'small', label: 'Small, up to 400 px', transformation: 'c_limit,w_400/f_auto/q_auto', width: 400,
  },
]);
export const THUMBNAIL_TRANSFORMATION = 'c_limit,w_320/f_auto/q_auto';

const blank = (v) => v === undefined || v === null || String(v).trim() === '';

function bool(raw, setting, fallback) {
  if (blank(raw)) return fallback;
  if (raw === true || raw === 'true') return true;
  if (raw === false || raw === 'false') return false;
  throw new ConfigError(setting);
}

function oneOf(raw, setting, allowed, fallback) {
  if (blank(raw)) return fallback;
  const v = String(raw).trim().toLowerCase();
  if (!allowed.includes(v)) throw new ConfigError(setting);
  return v;
}

function field(raw, setting, fallback) {
  if (blank(raw)) return fallback;
  const v = String(raw).trim();
  if (!FIELD_NAME.test(v)) throw new ConfigError(setting);
  return v;
}

/** Normalises the root folder: no leading/trailing slashes; empty means the whole environment. */
export function normalizeRoot(raw, setting = 'CLOUDINARY_ROOT_FOLDER') {
  if (blank(raw)) return '';
  const trimmed = String(raw).trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed) return '';
  if (trimmed.length > 200 || !ROOT_CHARS.test(trimmed)
    || trimmed.split('/').some((s) => s === '..' || s === '.' || s === '')) {
    throw new ConfigError(setting);
  }
  return trimmed;
}

function renditions(raw) {
  if (blank(raw)) return DEFAULT_RENDITIONS.map((r) => ({ ...r }));
  const setting = 'CLOUDINARY_RENDITIONS';
  let list;
  try {
    list = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    throw new ConfigError(setting);
  }
  if (!Array.isArray(list) || !list.length || list.length > MAX_RENDITIONS) throw new ConfigError(setting);
  const seen = new Set();
  return list.map((r) => {
    const ok = r && typeof r === 'object'
      && typeof r.id === 'string' && RENDITION_ID.test(r.id) && r.id !== 'original' && !seen.has(r.id)
      && typeof r.label === 'string' && r.label.length > 0 && r.label.length <= 60
      && typeof r.transformation === 'string' && TRANSFORMATION.test(r.transformation)
      && !r.transformation.split('/').some((s) => s === '' || s === '.' || s === '..')
      && (r.width === undefined || (Number.isInteger(r.width) && r.width > 0 && r.width <= 10000));
    if (!ok) throw new ConfigError(setting);
    seen.add(r.id);
    return {
      id: r.id, label: r.label, transformation: r.transformation, ...(r.width ? { width: r.width } : {}),
    };
  });
}

function deliveryHosts(raw) {
  if (blank(raw)) return [];
  const list = String(raw).split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (!list.length || list.length > 10 || list.some((h) => !HOST.test(h))) {
    throw new ConfigError('CLOUDINARY_DELIVERY_HOSTS');
  }
  return list;
}

function cacheSeconds(raw) {
  if (blank(raw)) return 30;
  const text = String(raw).trim();
  if (!/^\d{1,4}$/.test(text) || Number(text) > MAX_CACHE_SECONDS) throw new ConfigError('CLOUDINARY_CACHE_SECONDS');
  return Number(text);
}

/** Validates the raw worker inputs (strings or native values) and returns the resolved Cloudinary settings. */
export function resolveConfig(raw = {}) {
  const cloudName = String(raw.CLOUDINARY_CLOUD_NAME ?? '').trim();
  if (!CLOUD_NAME.test(cloudName)) throw new ConfigError('CLOUDINARY_CLOUD_NAME');
  const apiHost = blank(raw.CLOUDINARY_API_HOST) ? API_HOSTS[0] : String(raw.CLOUDINARY_API_HOST).trim().toLowerCase();
  if (!API_HOSTS.includes(apiHost)) throw new ConfigError('CLOUDINARY_API_HOST');
  return Object.freeze({
    cloudName,
    apiHost,
    root: normalizeRoot(raw.CLOUDINARY_ROOT_FOLDER),
    folderMode: oneOf(raw.CLOUDINARY_FOLDER_MODE, 'CLOUDINARY_FOLDER_MODE', ['dynamic', 'fixed'], 'dynamic'),
    signUrls: bool(raw.CLOUDINARY_SIGN_URLS, 'CLOUDINARY_SIGN_URLS', false),
    signatureAlgorithm: oneOf(
      raw.CLOUDINARY_SIGNATURE_ALGORITHM,
      'CLOUDINARY_SIGNATURE_ALGORITHM',
      ['sha1', 'sha256'],
      'sha1',
    ),
    altContextField: field(raw.CLOUDINARY_ALT_CONTEXT_FIELD, 'CLOUDINARY_ALT_CONTEXT_FIELD', 'alt'),
    captionContextField: field(raw.CLOUDINARY_CAPTION_CONTEXT_FIELD, 'CLOUDINARY_CAPTION_CONTEXT_FIELD', 'caption'),
    altMetadataField: field(raw.CLOUDINARY_ALT_METADATA_FIELD, 'CLOUDINARY_ALT_METADATA_FIELD', ''),
    renditions: Object.freeze(renditions(raw.CLOUDINARY_RENDITIONS)),
    extraDeliveryHosts: Object.freeze(deliveryHosts(raw.CLOUDINARY_DELIVERY_HOSTS)),
    cacheSeconds: cacheSeconds(raw.CLOUDINARY_CACHE_SECONDS),
  });
}

export const deliveryHostsOf = (config) => [DEFAULT_DELIVERY_HOST, ...config.extraDeliveryHosts];
