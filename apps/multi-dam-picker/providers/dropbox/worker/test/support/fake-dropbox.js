// Fake Dropbox (test double): the OAuth endpoints, the RPC endpoints the provider uses and an in-memory file tree.
// Used as an injected `fetch` (layered like `fakeUpstream`). It records every request (host, path, headers, JSON or form
// body), enforces bearer tokens and token expiry against an injected clock, and can inject failures per endpoint.
// Shapes follow the documented Dropbox API; they are hand-written, not recorded (see fixtures/README.md).
import { randomBytes } from 'node:crypto';

export const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', ...headers },
});
const tagged = (name, extra = {}) => ({ '.tag': name, ...extra });

/** A file entry as Dropbox's metadata objects look. */
export const file = (n, name, extra = {}) => ({
  '.tag': 'file',
  id: `id:file${n}`,
  name,
  path_lower: `/brand/${name.toLowerCase()}`,
  path_display: `/Brand/${name}`,
  server_modified: `2026-01-${String(10 + (n % 18)).padStart(2, '0')}T10:00:00Z`,
  size: 1000 + n,
  is_downloadable: true,
  ...extra,
});

const CATEGORY = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'heic', 'tif'],
  video: ['mp4', 'mov'],
  audio: ['mp3', 'wav'],
  document: ['doc', 'docx'],
  pdf: ['pdf'],
  spreadsheet: ['xlsx'],
  presentation: ['pptx'],
};
const categoryOf = (name) => {
  const ext = name.split('.').pop().toLowerCase();
  return Object.keys(CATEGORY).find((c) => CATEGORY[c].includes(ext)) || 'others';
};

export const DEFAULT_FILES = [
  file(1, 'Beach Boat.jpg', { media_info: tagged('metadata', { metadata: tagged('photo', { dimensions: { width: 2000, height: 1333 } }) }) }),
  file(2, 'Hero_Banner-2024.png'),
  file(3, 'Brand Guide.pdf'),
  file(4, 'Intro.mp4'),
  file(5, 'Jingle.mp3'),
  file(6, 'Scan.heic'),
  file(7, 'Logo.svg'),
  file(8, 'Notes.docx'),
];

/**
 * @param {{ clientId: string, clientSecret: string, files?: object[], now?: () => number, accessSeconds?: number,
 *           displayName?: string, linkAudience?: string, links?: object }} options
 */
export function fakeDropbox({
  clientId, clientSecret, files = DEFAULT_FILES, now = Date.now, accessSeconds = 14400, displayName = 'Pat Example',
  linkAudience = 'public', links = {},
}) {
  const requests = [];
  const codes = new Map();
  const accessTokens = new Map(); // token -> { refresh, expiresAt }
  const refreshTokens = new Set();
  const linkStore = new Map(Object.entries(links));
  const cursors = new Map();
  const injected = [];
  const state = {
    linkAudience, createSettingsError: undefined, accessSeconds, thumbnails: true, duplicateFirst: false, thumbnail: PNG_1PX,
  };
  const expectedBasic = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;

  const issue = ({ withRefresh, refresh, scope }) => {
    const access = `AT-${randomBytes(9).toString('hex')}`;
    const rt = withRefresh ? `RT-${randomBytes(9).toString('hex')}` : refresh;
    if (withRefresh) refreshTokens.add(rt);
    accessTokens.set(access, { refresh: rt, expiresAt: now() + state.accessSeconds * 1000 });
    return {
      access_token: access,
      token_type: 'bearer',
      expires_in: state.accessSeconds,
      ...(withRefresh ? { refresh_token: rt } : {}),
      scope,
      account_id: 'dbid:AAAfake',
    };
  };

  /** The authorize page: given the worker's redirect, returns the callback URL the browser would be sent to. */
  function authorize(location, { deny = false, scope } = {}) {
    const url = new URL(location);
    if (url.hostname !== 'www.dropbox.com' || url.pathname !== '/oauth2/authorize') throw new Error('not a Dropbox authorize URL');
    if (url.searchParams.get('client_id') !== clientId) throw new Error('unknown client');
    const back = new URL(url.searchParams.get('redirect_uri'));
    back.searchParams.set('state', url.searchParams.get('state'));
    if (deny) {
      back.searchParams.set('error', 'access_denied');
      return back.href;
    }
    const code = `CODE-${randomBytes(9).toString('hex')}`;
    codes.set(code, {
      redirectUri: url.searchParams.get('redirect_uri'),
      scope: scope ?? url.searchParams.get('scope'),
      offline: url.searchParams.get('token_access_type') === 'offline',
    });
    back.searchParams.set('code', code);
    return back.href;
  }

  const meta = (f) => ({ ...f });
  const byId = (id) => files.find((f) => f.id === id);

  function token(form, headers) {
    if (headers.authorization !== expectedBasic) return json(400, { error: 'invalid_client: Invalid client_id or client_secret' });
    if (form.get('grant_type') === 'authorization_code') {
      const entry = codes.get(form.get('code'));
      if (!entry || entry.redirectUri !== form.get('redirect_uri')) {
        return json(400, { error: 'invalid_grant: code has expired or been revoked' });
      }
      codes.delete(form.get('code'));
      return json(200, issue({ withRefresh: entry.offline, scope: entry.scope }));
    }
    if (form.get('grant_type') === 'refresh_token') {
      if (!refreshTokens.has(form.get('refresh_token'))) {
        return json(400, { error: 'invalid_grant: refresh token is invalid or revoked' });
      }
      return json(200, issue({ withRefresh: false, refresh: form.get('refresh_token'), scope: undefined }));
    }
    return json(400, { error: 'unsupported_grant_type: nope' });
  }

  const linkMeta = (f, audience) => ({
    '.tag': 'file',
    url: `https://www.dropbox.com/scl/fi/${randomBytes(5).toString('hex')}/${encodeURIComponent(f.name)}?rlkey=${randomBytes(8).toString('hex')}&st=abc12345&dl=0`,
    name: f.name,
    path_lower: f.path_lower,
    link_permissions: {
      resolved_visibility: tagged(audience === 'public' ? 'public' : 'team_only'),
      requested_visibility: tagged('public'),
      effective_audience: tagged(audience),
      link_access_level: tagged('viewer'),
      allow_download: true,
    },
  });

  /** The first `limit` of `all` plus a cursor (holding the rest) when more remain. */
  function chunk(all, limit, prefix) {
    const first = all.slice(0, limit);
    if (all.length <= limit) return { first, has_more: false };
    const cursor = `${prefix}-${randomBytes(4).toString('hex')}`;
    cursors.set(cursor, all.slice(limit));
    return { first, has_more: true, cursor };
  }

  function search(body) {
    let hits;
    let max = 100;
    if (body.cursor) {
      hits = cursors.get(body.cursor) ?? [];
    } else {
      const opts = body.options || {};
      max = opts.max_results || 100;
      const cats = (opts.file_categories || []).map((c) => c['.tag']);
      hits = files.filter((f) => f.name.toLowerCase().includes(String(body.query).toLowerCase()));
      if (cats.length) hits = hits.filter((f) => f['.tag'] !== 'file' || cats.includes(categoryOf(f.name)));
      if (opts.path) hits = hits.filter((f) => String(f.path_lower).startsWith(`${opts.path.toLowerCase()}/`));
      if (opts.order_by?.['.tag'] === 'last_modified_time') {
        hits = [...hits].sort((a, b) => String(b.server_modified).localeCompare(String(a.server_modified)));
      }
      if (state.duplicateFirst && hits.length) hits = [hits[0], ...hits];
    }
    const { first, has_more: more, cursor } = chunk(hits, max, 'scur');
    return json(200, {
      matches: first.map((f) => ({ match_type: tagged('filename'), metadata: tagged('metadata', { metadata: meta(f) }) })),
      has_more: more,
      ...(cursor ? { cursor } : {}),
    });
  }

  function listFolder(body) {
    let children;
    let limit = 200;
    if (body.cursor) {
      children = cursors.get(body.cursor) ?? [];
    } else {
      const root = String(body.path || '').toLowerCase();
      limit = body.limit || 200;
      children = files.filter((f) => {
        const parent = String(f.path_lower).slice(0, String(f.path_lower).lastIndexOf('/'));
        return parent === root && (body.include_non_downloadable_files !== false || f.is_downloadable !== false);
      });
    }
    const { first, has_more: more, cursor } = chunk(children, limit, 'lcur');
    return json(200, { entries: first.map(meta), has_more: more, ...(cursor ? { cursor } : {}) });
  }

  const revokeContext = {};
  function rpc(path, body) {
    switch (path) {
      case 'users/get_current_account':
        return json(200, { account_id: 'dbid:AAAfake', name: { display_name: displayName }, email: 'pat@example.com' });
      case 'auth/token/revoke':
        refreshTokens.delete(revokeContext.access?.refresh);
        return new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
      case 'files/search_v2': return search(body);
      case 'files/search/continue_v2': return search(body);
      case 'files/list_folder': return listFolder(body);
      case 'files/list_folder/continue': return listFolder(body);
      case 'files/get_metadata': {
        const f = byId(body.path);
        if (!f) return json(409, { error_summary: 'path/not_found/..', error: tagged('path', { path: tagged('not_found') }) });
        const out = meta(f);
        if (body.include_property_groups) out.property_groups = f.property_groups || [];
        if (!body.include_media_info) delete out.media_info;
        return json(200, out);
      }
      case 'files/get_thumbnail_batch':
        return json(200, {
          entries: body.entries.map((e) => {
            const f = byId(e.path);
            if (!state.thumbnails || !f || ['heic'].includes(f.name.split('.').pop())) {
              return tagged('failure', { failure: tagged('path', { path: tagged('not_found') }) });
            }
            return tagged('success', { metadata: meta(f), thumbnail: state.thumbnail });
          }),
        });
      case 'sharing/list_shared_links':
        return json(200, { links: linkStore.get(body.path) || [], has_more: false });
      case 'sharing/create_shared_link_with_settings': {
        const f = byId(body.path);
        if (!f) return json(409, { error_summary: 'path/not_found/..', error: tagged('path', { path: tagged('not_found') }) });
        if (state.createSettingsError) {
          const [kind, sub] = state.createSettingsError.split(':');
          return json(409, { error_summary: `${kind}/`, error: sub ? tagged(kind, { [kind]: tagged(sub) }) : tagged(kind) });
        }
        const existing = linkStore.get(f.id);
        if (existing?.length) {
          return json(409, { error_summary: 'shared_link_already_exists/..', error: tagged('shared_link_already_exists', { shared_link_already_exists: tagged('metadata', { metadata: existing[0] }) }) });
        }
        const link = linkMeta(f, state.linkAudience);
        linkStore.set(f.id, [link]);
        return json(200, link);
      }
      default: return json(404, { error_summary: 'unknown endpoint' });
    }
  }

  async function handle(url, init) {
    const u = new URL(url);
    const headers = {};
    Object.entries(init.headers || {}).forEach(([k, v]) => { headers[k.toLowerCase()] = v; });
    const text = init.body === undefined ? undefined : Buffer.from(init.body).toString('utf8');
    const record = { url: String(url), host: u.hostname, path: u.pathname, method: init.method || 'GET', headers, text };
    requests.push(record);
    const step = injected.find((s) => u.pathname.includes(s.match) && s.times > 0);
    if (step) {
      step.times -= 1;
      if (step.throws) throw step.throws;
      return new Response(step.body ?? '', { status: step.status, headers: step.headers });
    }
    if (u.hostname !== 'api.dropboxapi.com' && u.hostname !== 'content.dropboxapi.com') {
      throw new Error(`fake Dropbox: unexpected host ${u.hostname}`);
    }
    if (u.pathname === '/oauth2/token') {
      return token(new URLSearchParams(text), headers);
    }
    if (!u.pathname.startsWith('/2/')) return json(404, {});
    const bearer = /^Bearer (.+)$/.exec(headers.authorization || '')?.[1];
    const access = bearer ? accessTokens.get(bearer) : undefined;
    if (!access || !refreshTokens.has(access.refresh)) {
      return json(401, { error_summary: 'invalid_access_token/', error: tagged('invalid_access_token') }, { 'www-authenticate': 'Bearer realm="Dropbox-API"' });
    }
    if (access.expiresAt <= now()) {
      return json(401, { error_summary: 'expired_access_token/', error: tagged('expired_access_token') });
    }
    revokeContext.access = access;
    record.json = text ? JSON.parse(text) : undefined;
    return rpc(u.pathname.slice(3), record.json || {});
  }

  return {
    requests,
    state,
    codes,
    accessTokens,
    refreshTokens,
    links: linkStore,
    authorize,
    /** Answers the next `times` requests whose path contains `match` with the given response (or a thrown error). */
    inject(match, response, { times = 1 } = {}) { injected.push({ match, times, ...response }); },
    /** How many requests hit a path (substring). */
    count: (match) => requests.filter((r) => r.path.includes(match)).length,
    /** Revokes every token of the current grant, as the author does in Dropbox's connected-apps settings. */
    revokeAll() { refreshTokens.clear(); },
    expireAccessTokens() { [...accessTokens.keys()].forEach((k) => accessTokens.set(k, { ...accessTokens.get(k), expiresAt: 0 })); },
    fetch: (url, init = {}) => handle(url, init),
  };
}
