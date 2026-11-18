// Rendition, thumbnail and signed-URL construction (SPEC D13, D14). URLs are built only from the `secure_url` the API
// returned: the transformation (and signature) is inserted between the delivery type and the version. Nothing is
// derived from ids, the cloud name or user input.
import { createHash } from 'node:crypto';
import { THUMBNAIL_TRANSFORMATION } from './config.js';

export const DISPLAYABLE_ORIGINALS = Object.freeze(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg']);

/**
 * Cloudinary delivery signature: first 8 characters of the URL-safe base64 digest of
 * `<transformation>/<public id>[.<ext>]` followed by the API secret (no version segment).
 */
export function signature({
  transformation, tail, secret, algorithm = 'sha1',
}) {
  const digest = createHash(algorithm === 'sha256' ? 'sha256' : 'sha1')
    .update(`${transformation}/${tail}${secret}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return digest.slice(0, 8);
}

/**
 * Splits a returned URL into the parts a transformation is inserted between. Returns undefined when the URL does not
 * have the documented shape `<prefix>/<resource_type>/<type>/v<version>/<public id>[.<ext>]`.
 */
export function parseDelivery(secureUrl, { resourceType, deliveryType }) {
  let url;
  try {
    url = new URL(secureUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || url.search || url.hash) return undefined;
  const marker = `/${resourceType}/${deliveryType}/`;
  const at = url.pathname.indexOf(marker);
  if (at < 0) return undefined;
  const m = /^v(\d+)\/(.+)$/.exec(url.pathname.slice(at + marker.length));
  if (!m) return undefined;
  return {
    base: `${url.origin}${url.pathname.slice(0, at)}${marker}`,
    version: m[1],
    tail: m[2],
  };
}

export const needsEncoding = (tail) => /%/.test(tail);

/**
 * URL of `parts` with `transformation` applied. Unsigned URLs keep the version; signed URLs carry `s--sig--` after the
 * delivery type and drop the version segment so the signed string is exactly the documented form.
 * Returns undefined when signing is required but the public id needs percent-encoding (signing rule not proven).
 */
export function transformedUrl(parts, transformation, { config, secret, tail = parts.tail }) {
  if (!config.signUrls) return `${parts.base}${transformation}/v${parts.version}/${tail}`;
  if (needsEncoding(tail)) return undefined;
  const sig = signature({
    transformation, tail, secret: secret(), algorithm: config.signatureAlgorithm,
  });
  return `${parts.base}s--${sig}--/${transformation}/${tail}`;
}

function scaled(asset, width) {
  if (!Number.isInteger(asset.width) || asset.width <= 0) return {};
  if (!width || width >= asset.width) {
    return { width: asset.width, ...(Number.isInteger(asset.height) ? { height: asset.height } : {}) };
  }
  return {
    width,
    ...(Number.isInteger(asset.height) && asset.height > 0
      ? { height: Math.max(1, Math.round((asset.height * width) / asset.width)) } : {}),
  };
}

/**
 * Renditions of an image asset. `blocked` carries the not-insertable reason when the URL cannot be built.
 * @returns {{ renditions: object[], defaultRenditionId?: string, blocked?: string }}
 */
export function buildRenditions(asset, config, secret) {
  const parts = parseDelivery(asset.secureUrl, asset);
  if (!parts) return { renditions: [], blocked: 'Unrecognised Cloudinary URL.' };
  const renditions = [];
  const urls = config.renditions.map((r) => transformedUrl(parts, r.transformation, { config, secret }));
  if (urls.some((u) => !u)) return { renditions: [], blocked: 'The public ID cannot be signed.' };
  config.renditions.forEach((r, i) => {
    renditions.push({
      id: r.id, label: r.label, url: urls[i], kind: 'derivative', ...scaled(asset, r.width),
    });
  });
  if (DISPLAYABLE_ORIGINALS.includes(String(asset.format).toLowerCase())) {
    renditions.push({
      id: 'original',
      label: 'Original file',
      url: asset.secureUrl,
      kind: 'original',
      ...scaled(asset, undefined),
    });
  }
  const defaultRendition = renditions.find((r) => r.id === 'web') || renditions[0];
  return { renditions, defaultRenditionId: defaultRendition?.id };
}

/** Thumbnail URL for the summary: image, video poster and PDF first page; none for audio and raw files. */
export function thumbnailUrl(asset, config, secret) {
  if (!['image', 'video', 'document'].includes(asset.kind)) return undefined;
  if (asset.resourceType === 'raw') return undefined;
  const parts = parseDelivery(asset.secureUrl, asset);
  if (!parts) return undefined;
  let { tail } = parts;
  if (asset.resourceType === 'video' || asset.format === 'pdf') {
    if (!/\.[A-Za-z0-9]+$/.test(tail)) return undefined;
    tail = tail.replace(/\.[A-Za-z0-9]+$/, '.jpg');
  }
  return transformedUrl(parts, THUMBNAIL_TRANSFORMATION, { config, secret, tail });
}
