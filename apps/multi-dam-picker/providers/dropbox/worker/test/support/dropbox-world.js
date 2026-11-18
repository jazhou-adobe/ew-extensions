import assert from 'node:assert/strict';
import cloudinary from '../../../../cloudinary/worker/index.js';
import dropbox from '../../index.js';
import { oauthWorld } from '../../../../../worker/test/support/oauth-world.js';
import { file } from './fake-dropbox.js';

/** `n` JPEG files `photo-<i>.jpg` in /Brand, newest first by number. */
export const manyFiles = (n, { start = 100 } = {}) => Array.from({ length: n }, (_, i) => file(start + i, `photo-${i + 1}.jpg`, {
  server_modified: new Date(Date.UTC(2026, 0, 1) + (n - i) * 60_000).toISOString().replace('.000', ''),
}));

/** A world with Dropbox configured and one author already connected. */
export async function dropboxWorld({
  files, links, inputs = {}, ...rest
} = {}) {
  const w = await oauthWorld({
    providers: [cloudinary, dropbox], inputs, dropbox: { ...(files ? { files } : {}), ...(links ? { links } : {}) }, ...rest,
  });
  const flow = await w.signIn();
  assert.equal(flow.callback.statusCode, 200);
  w.dbx.requests.length = 0;
  return Object.assign(w, {
    search: (query = {}, extra = {}) => w.call({ path: '/dam/dropbox/assets', query, ...extra }),
    detail: (id, extra = {}) => w.call({ path: `/dam/dropbox/assets/${encodeURIComponent(id)}`, ...extra }),
    rpcs: (name) => w.dbx.requests.filter((r) => r.path.endsWith(name)),
  });
}
