// Mapping of Cloudinary resources to the shell's asset contract (SPEC D8, D11, D13). Allow-list based: only the fields
// named here are read, everything else (including `derived`) is dropped. Tolerates missing, null and empty fields.
import { AUDIO_FORMATS } from './query.js';
import { deliveryHostsOf } from './config.js';
import { buildRenditions, thumbnailUrl } from './renditions.js';
import { altFor } from './alt.js';

const FONT_FORMATS = ['ttf', 'otf', 'woff', 'woff2', 'eot'];
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' && v ? v : undefined);
const int = (v) => (Number.isInteger(v) && v >= 0 ? v : undefined);

const lastSegment = (path) => path.split('/').pop();
const dirname = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const extensionOf = (name) => {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name);
  return m ? m[1].toLowerCase() : undefined;
};

/** image / video / document / audio / other, from Cloudinary's resource type and format. */
export function assetKind(resourceType, format) {
  const f = String(format || '').toLowerCase();
  if (resourceType === 'image') return f === 'pdf' ? 'document' : 'image';
  if (resourceType === 'video') return AUDIO_FORMATS.includes(f) ? 'audio' : 'video';
  if (resourceType === 'raw') return FONT_FORMATS.includes(f) ? 'other' : 'document';
  return 'other';
}

/**
 * Reads one resource (search row or detail) into the provider's internal shape.
 * Returns undefined for rows that are not usable assets (no id, not an active `upload` asset).
 */
export function readResource(row, config) {
  if (!isObject(row)) return undefined;
  const id = str(row.asset_id);
  const publicId = str(row.public_id);
  const resourceType = str(row.resource_type);
  if (!id || !publicId || !resourceType) return undefined;
  if (row.type !== 'upload') return undefined;
  if (row.status !== undefined && row.status !== null && row.status !== 'active') return undefined;
  const format = (str(row.format) || (resourceType === 'raw' ? extensionOf(lastSegment(publicId)) : undefined));
  let folder;
  if (config.folderMode === 'fixed') folder = str(row.folder) ?? dirname(publicId);
  else folder = typeof row.asset_folder === 'string' ? row.asset_folder : '';
  const name = str(row.display_name) || (config.folderMode === 'fixed' ? undefined : str(row.filename))
    || lastSegment(publicId);
  return {
    id,
    publicId,
    name,
    resourceType,
    deliveryType: row.type,
    kind: assetKind(resourceType, format),
    format,
    version: row.version,
    width: int(row.width),
    height: int(row.height),
    bytes: int(row.bytes),
    secureUrl: str(row.secure_url),
    folder,
    dateModified: str(row.uploaded_at) || str(row.created_at),
    accessControl: Array.isArray(row.access_control) ? row.access_control : [],
    moderation: str(row.moderation_status),
  };
}

/** True when the asset sits at or below the configured root folder (always true without a root). */
export function inRoot(asset, config) {
  if (!config.root) return true;
  return asset.folder === config.root || asset.folder.startsWith(`${config.root}/`);
}

/** The reason an asset cannot be inserted (access control, moderation, delivery host), or undefined. */
export function restriction(asset, config) {
  if (asset.accessControl.length) return 'Access-restricted in Cloudinary.';
  if (asset.moderation === 'rejected') return 'Rejected by moderation in Cloudinary.';
  let host;
  try {
    const url = new URL(asset.secureUrl);
    host = url.protocol === 'https:' && !url.username && !url.password ? url.hostname.toLowerCase() : undefined;
  } catch {
    host = undefined;
  }
  if (!host || !deliveryHostsOf(config).includes(host)) return 'The asset URL is not on an allowed delivery host.';
  return undefined;
}

function summary(asset, config, secret) {
  const out = {
    id: asset.id, name: asset.name, type: asset.kind,
  };
  const reason = restriction(asset, config);
  const thumbnail = reason ? undefined : thumbnailUrl(asset, config, secret);
  if (thumbnail) out.thumbnailUrl = thumbnail;
  [['width', asset.width], ['height', asset.height], ['extension', asset.format], ['fileSize', asset.bytes],
    ['dateModified', asset.dateModified]].forEach(([k, v]) => {
    if (v !== undefined) out[k] = v;
  });
  out.warnings = reason ? [reason] : [];
  return out;
}

/** A search row as a summary; undefined when the row is not a usable asset. */
export function toSummary(row, config, secret) {
  const asset = readResource(row, config);
  return asset ? summary(asset, config, secret) : undefined;
}

/** A detail response as the detail contract; undefined when it is not usable. */
export function toDetail(row, config, secret) {
  const asset = readResource(row, config);
  if (!asset) return undefined;
  const out = summary(asset, config, secret);
  const { alt, description } = altFor(row, config, asset.name);
  out.alt = alt;
  if (description) out.description = description;
  out.tags = Array.isArray(row.tags) ? row.tags.filter((t) => typeof t === 'string' && t).slice(0, 30) : [];
  out.renditions = [];

  const reason = restriction(asset, config);
  if (reason) {
    out.insertable = { ok: false, reason };
    return out;
  }
  if (asset.kind === 'image') {
    const built = buildRenditions(asset, config, secret);
    out.renditions = built.renditions;
    if (built.blocked) {
      out.insertable = { ok: false, reason: built.blocked };
    } else {
      out.defaultRenditionId = built.defaultRenditionId;
      out.insertable = { ok: true };
    }
  } else {
    out.linkUrl = asset.secureUrl;
    out.insertable = { ok: true };
  }
  return out;
}
