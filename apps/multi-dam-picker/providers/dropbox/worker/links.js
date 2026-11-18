// Detail: link resolution, rendition and alt text (SPEC D21). Dropbox has no CDN-style rendition URLs; the only stable
// URL that works for visitors is a shared link. The provider reuses an existing public link (never modifies or revokes
// one) and creates one only when the file has none; what Dropbox resolved is checked, and a team policy that does not
// allow a public link makes the asset not insertable, never an error. No URL is ever built from a file id or path.
import { ProviderError } from '../../../worker/shell/provider.js';
import { rpc } from './client.js';
import { dimensionsOf, readFile, toSummary } from './mapping.js';
import { altFor } from './alt.js';
import { isImageInsertable } from './types.js';

const LINK_HOST = 'www.dropbox.com';

export const REASONS = Object.freeze({
  policy: 'Dropbox does not allow a public link for this file.',
  notAuthorized: 'You are not allowed to share this file in Dropbox.',
  invalidSettings: 'Dropbox does not allow a public link with these settings for this file.',
  accessDenied: 'Dropbox denied access to share this file.',
  emailNotVerified: 'Verify your email address in Dropbox to share files.',
  password: 'The existing Dropbox link for this file is password-protected.',
  expiring: 'The existing Dropbox link for this file expires.',
  noDownload: 'The existing Dropbox link for this file does not allow downloads.',
  format: 'This image format cannot be shown in a web page. Use a JPEG, PNG, GIF, WebP, AVIF or SVG file.',
  badLink: 'Dropbox returned a link that cannot be used.',
});

const tag = (v) => (v && typeof v === 'object' ? v['.tag'] : undefined);

/** Why an existing link cannot be used as a public link (`undefined` when it can). */
function linkProblem(link) {
  if (!link || link['.tag'] !== 'file' || typeof link.url !== 'string') return REASONS.badLink;
  if (link.expires) return REASONS.expiring;
  const perms = link.link_permissions || {};
  if (tag(perms.resolved_visibility) === 'password') return REASONS.password;
  if (perms.allow_download === false) return REASONS.noDownload;
  const audience = tag(perms.effective_audience) ?? tag(perms.resolved_visibility);
  return audience === 'public' ? undefined : REASONS.policy;
}

function safeLink(link) {
  let url;
  try {
    url = new URL(link);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || url.hostname !== LINK_HOST || url.username || url.password) return undefined;
  return url;
}

/**
 * The link as the image URL: parsed, `dl` removed, `raw=1` set, every other parameter kept byte for byte. Only an
 * `https:` link on the Dropbox link host without credentials qualifies.
 */
export function rawImageUrl(link) {
  const url = safeLink(link);
  if (!url) return undefined;
  url.searchParams.delete('dl');
  url.searchParams.set('raw', '1');
  return url.href;
}

/** Existing links of this file, `direct_only` so a link to a parent folder is never used. */
async function existingLinks(ctx, id) {
  const answer = await rpc(ctx, 'sharing/list_shared_links', { path: id, direct_only: true });
  return Array.isArray(answer.links) ? answer.links : [];
}

const CREATE_FAILURES = {
  not_authorized: REASONS.notAuthorized,
  invalid_settings: REASONS.invalidSettings,
};

/** Creates the public link, or says why Dropbox will not. Repeating it is safe: Dropbox answers "already exists". */
async function createLink(ctx, id) {
  try {
    const link = await rpc(ctx, 'sharing/create_shared_link_with_settings', {
      path: id,
      settings: {
        requested_visibility: { '.tag': 'public' },
        audience: { '.tag': 'public' },
        access: { '.tag': 'viewer' },
        allow_download: true,
      },
    });
    return { link, created: true };
  } catch (e) {
    const tags = e instanceof ProviderError ? e.conflict?.tags : undefined;
    if (!tags) throw e;
    if (tags[0] === 'shared_link_already_exists') {
      // A concurrent request created it: judge the embedded metadata like any existing link.
      const existing = e.conflict.body.error.shared_link_already_exists;
      return { link: tag(existing) === 'metadata' ? existing.metadata : undefined, created: false, raced: true };
    }
    if (tags[0] === 'settings_error') return { problem: CREATE_FAILURES[tags[1]] || REASONS.invalidSettings };
    if (tags[0] === 'access_denied') return { problem: REASONS.accessDenied };
    if (tags[0] === 'email_not_verified') return { problem: REASONS.emailNotVerified };
    throw e;
  }
}

/** Finds or creates the public link: `{ link }`, or `{ problem }` with a fixed reason; `created` when new. */
async function resolveLink(ctx, id) {
  const links = await existingLinks(ctx, id);
  const usable = links.find((l) => !linkProblem(l));
  if (usable) return { link: usable };
  // A non-public link exists: Dropbox would refuse a second one and the existing one is never modified.
  if (links.length) return { problem: linkProblem(links[0]) };
  const made = await createLink(ctx, id);
  if (made.problem) return { problem: made.problem };
  if (made.raced && !made.link) {
    // Another request created it a moment ago and Dropbox did not say which: read it back.
    const again = await existingLinks(ctx, id);
    const found = again.find((l) => !linkProblem(l));
    if (found) return { link: found };
    return { problem: again.length ? linkProblem(again[0]) : REASONS.badLink };
  }
  const problem = linkProblem(made.link);
  return problem ? { problem } : { link: made.link, created: made.created };
}

function propertyFilter(config) {
  return config.alt
    ? { include_property_groups: { '.tag': 'filter_some', filter_some: [config.alt.templateId] } }
    : {};
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export async function getAsset(ctx, id) {
  const { config } = ctx;
  if (config.altIncomplete) ctx.log('alt_unconfigured', { settings: ['DROPBOX_ALT_TEMPLATE_ID', 'DROPBOX_ALT_FIELD'] });
  const meta = await rpc(ctx, 'files/get_metadata', { path: id, include_media_info: true, ...propertyFilter(config) });
  const file = readFile(meta);
  if (!file || file.id !== id) throw new ProviderError('not_found');
  if (config.root && !(file.pathLower === config.root.toLowerCase()
    || file.pathLower?.startsWith(`${config.root.toLowerCase()}/`))) {
    throw new ProviderError('not_found');
  }
  const { width, height } = dimensionsOf(file);
  const asset = {
    ...toSummary(file),
    ...(width ? { width, height } : {}),
    alt: altFor(file, config),
    renditions: [],
  };
  const isImage = file.type === 'image';
  if (isImage && !isImageInsertable(file.extension)) {
    return { ...asset, insertable: { ok: false, reason: REASONS.format } };
  }
  const resolved = await resolveLink(ctx, id);
  if (resolved.problem) return { ...asset, insertable: { ok: false, reason: resolved.problem } };
  if (resolved.created) asset.warnings = ['A public Dropbox link was created for this file.'];

  if (isImage) {
    const url = rawImageUrl(resolved.link.url);
    if (!url) return { ...asset, insertable: { ok: false, reason: REASONS.badLink } };
    const size = file.size !== undefined ? ` (${formatBytes(file.size)})` : '';
    return {
      ...asset,
      renditions: [{
        id: 'original', label: `Original${size}`, url, kind: 'original', ...(width ? { width, height } : {}),
      }],
      defaultRenditionId: 'original',
      insertable: { ok: true },
    };
  }
  // Non-image files are inserted as a link, exactly as Dropbox returned it.
  if (!safeLink(resolved.link.url)) return { ...asset, insertable: { ok: false, reason: REASONS.badLink } };
  return { ...asset, linkUrl: resolved.link.url, insertable: { ok: true } };
}
