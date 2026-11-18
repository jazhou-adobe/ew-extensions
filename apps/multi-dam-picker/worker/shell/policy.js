// The shell's output policy (SPEC D13): provider results are re-built from an allow-list, every URL is https and on a
// delivery host the provider declared, and malformed shapes become `502 upstream_unavailable`.
import { HttpError } from '../../../../shared/worker-template/src/index.js';
import { OUTPUT_TYPES } from './provider.js';

export const BLOCKED_REASON = 'The asset URL is not allowed.';
const NO_URL_REASON = 'The asset has no usable URL.';
const THUMB_DATA = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const MAX_DATA_THUMB = 64 * 1024;
const MAX_URL = 2048;
const ALT_SOURCES = ['property', 'description', 'name', 'none'];
const RENDITION_KINDS = ['derivative', 'original'];

const malformed = () => new HttpError('upstream_unavailable');
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const count = (v) => (Number.isInteger(v) && v >= 0 ? v : undefined);

/** `https:` URL on one of `hosts`, no credentials. Returns the URL text or undefined. */
export function safeUrl(value, hosts) {
  if (typeof value !== 'string' || !value || value.length > MAX_URL) return undefined;
  let url;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return undefined;
  return hosts.includes(url.hostname.toLowerCase()) ? value : undefined;
}

function thumbnail(value, hosts) {
  if (typeof value !== 'string') return undefined;
  if (value.startsWith('data:')) return value.length <= MAX_DATA_THUMB && THUMB_DATA.test(value) ? value : undefined;
  return safeUrl(value, hosts);
}

function summaryOf(raw, provider, hosts) {
  if (!isObject(raw)) throw malformed();
  const { id, name, type } = raw;
  if (typeof id !== 'string' || !provider.assetIdPattern.test(id)) throw malformed();
  if (typeof name !== 'string' || !name || !OUTPUT_TYPES.includes(type)) throw malformed();
  const extension = typeof raw.extension === 'string' && /^[A-Za-z0-9]{1,16}$/.test(raw.extension)
    ? raw.extension : undefined;
  const warnings = Array.isArray(raw.warnings)
    ? raw.warnings.filter((w) => typeof w === 'string').slice(0, 5).map((w) => w.slice(0, 200)) : [];
  const out = {
    id, provider: provider.id, name: name.slice(0, 300), type,
  };
  const thumb = thumbnail(raw.thumbnailUrl, hosts);
  if (thumb) out.thumbnailUrl = thumb;
  [['width', count(raw.width)], ['height', count(raw.height)], ['extension', extension],
    ['fileSize', count(raw.fileSize)], ['dateModified', text(raw.dateModified, 40)]].forEach(([k, v]) => {
    if (v !== undefined) out[k] = v;
  });
  out.warnings = warnings;
  return out;
}

/** Normalises a provider search result into the wire contract. */
export function normalizeList(raw, provider, hosts, { page, pageSize }) {
  if (!isObject(raw) || !Array.isArray(raw.items) || typeof raw.hasMore !== 'boolean') throw malformed();
  if (raw.items.length > pageSize) throw malformed();
  const out = {
    items: raw.items.map((item) => summaryOf(item, provider, hosts)), page, pageSize,
  };
  const total = count(raw.total);
  if (total !== undefined) out.total = total;
  out.hasMore = raw.hasMore;
  return out;
}

/** Normalises a provider detail into the wire contract, enforcing the URL policy. */
export function normalizeDetail(raw, provider, hosts) {
  const base = summaryOf(raw, provider, hosts);
  if (!Array.isArray(raw.renditions) && raw.renditions !== undefined) throw malformed();
  let blocked = false;
  const renditions = [];
  (raw.renditions || []).forEach((r) => {
    const url = isObject(r) ? safeUrl(r.url, hosts) : undefined;
    const idOk = isObject(r) && typeof r.id === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(r.id);
    if (!url || !idOk) {
      blocked = true;
      return;
    }
    const rendition = {
      id: r.id,
      label: typeof r.label === 'string' ? r.label.slice(0, 80) : r.id,
      url,
      kind: RENDITION_KINDS.includes(r.kind) ? r.kind : 'derivative',
    };
    if (count(r.width) !== undefined) rendition.width = r.width;
    if (count(r.height) !== undefined) rendition.height = r.height;
    renditions.push(rendition);
  });
  const asset = { ...base };
  const description = text(raw.description, 2000);
  if (description) asset.description = description;
  asset.tags = Array.isArray(raw.tags)
    ? raw.tags.filter((t) => typeof t === 'string' && t).slice(0, 30).map((t) => t.slice(0, 64)) : [];
  const copyright = text(raw.copyright, 300);
  if (copyright) asset.copyright = copyright;
  const alt = isObject(raw.alt) && typeof raw.alt.value === 'string' && ALT_SOURCES.includes(raw.alt.source)
    ? { value: raw.alt.value.slice(0, 500), source: raw.alt.source } : { value: '', source: 'none' };
  asset.alt = alt;
  asset.renditions = renditions;
  if (renditions.length) {
    asset.defaultRenditionId = renditions.some((r) => r.id === raw.defaultRenditionId)
      ? raw.defaultRenditionId : renditions[0].id;
  }
  let linkUrl;
  if (raw.linkUrl !== undefined && raw.linkUrl !== null) {
    linkUrl = safeUrl(raw.linkUrl, hosts);
    if (!linkUrl) blocked = true;
  }
  if (linkUrl) asset.linkUrl = linkUrl;

  const given = isObject(raw.insertable) && raw.insertable.ok === true;
  const reason = isObject(raw.insertable) ? text(raw.insertable.reason, 200) : undefined;
  if (blocked) {
    asset.insertable = { ok: false, reason: BLOCKED_REASON };
  } else if (!given) {
    asset.insertable = { ok: false, reason: reason || NO_URL_REASON };
  } else if (base.type === 'image' ? !renditions.length : !linkUrl) {
    asset.insertable = { ok: false, reason: NO_URL_REASON };
  } else {
    asset.insertable = { ok: true };
  }
  return asset;
}
