// Records sanitised fixtures from the real test environment (LC4). Owner step; needs CLOUDINARY_API_KEY and
// CLOUDINARY_API_SECRET in apps/multi-dam-picker/worker/.env. Makes 3 Admin API requests (Free plan: 500/hour).
//   node apps/multi-dam-picker/providers/cloudinary/worker/record-fixtures.mjs
// Output: fixtures/recorded/{search,detail,config}.json. The script fails, and writes nothing, if an output would
// contain the key or the secret.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setting } from '../../../worker/test-live/env.js';
import { SEARCH_FIELDS } from './query.js';

const key = setting('CLOUDINARY_API_KEY');
const secret = setting('CLOUDINARY_API_SECRET');
if (!key || !secret) {
  console.error('Set CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in apps/multi-dam-picker/worker/.env first.');
  process.exit(2);
}
const cloud = setting('CLOUDINARY_CLOUD_NAME') || 'yifoe45l';
const root = (setting('CLOUDINARY_ROOT_FOLDER') ?? 'samples/').replace(/^\/+|\/+$/g, '');
const mode = setting('CLOUDINARY_FOLDER_MODE') || 'dynamic';
const auth = `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`;
const api = (path, init = {}) => fetch(`https://api.cloudinary.com/v1_1/${cloud}/${path}`, {
  ...init, redirect: 'manual', headers: { authorization: auth, 'content-type': 'application/json' },
});

const field = mode === 'fixed' ? 'folder' : 'asset_folder';
const expression = ['type=upload', root && `(${field}=${root} OR ${field}:${root}/*)`].filter(Boolean).join(' AND ');
const outputs = {};

const search = await api('resources/search', {
  method: 'POST', body: JSON.stringify({ expression, max_results: 50, fields: [...SEARCH_FIELDS] }),
});
if (!search.ok) throw new Error(`search failed with HTTP ${search.status}`);
outputs.search = await search.json();
console.log(`search: HTTP ${search.status}; remaining ${search.headers.get('x-featureratelimit-remaining')}`);

const first = outputs.search.resources?.find((r) => r.resource_type === 'image');
if (first) {
  const detail = await api(`resources/${first.asset_id}`);
  if (!detail.ok) throw new Error(`detail failed with HTTP ${detail.status}`);
  const body = await detail.json();
  delete body.derived;
  outputs.detail = body;
}
const settings = await api('config?settings=true');
if (settings.ok) outputs.config = { folder_mode: (await settings.json())?.settings?.folder_mode };

const text = JSON.stringify(outputs);
if (text.includes(key) || text.includes(secret)) {
  throw new Error('a recorded fixture contains a credential; nothing was written');
}
const dir = fileURLToPath(new URL('./fixtures/recorded/', import.meta.url));
mkdirSync(dir, { recursive: true });
Object.entries(outputs).forEach(([name, value]) => {
  writeFileSync(`${dir}${name}.json`, `${JSON.stringify(value, null, 2)}\n`);
});
console.log(`wrote ${Object.keys(outputs).join(', ')} to fixtures/recorded/ (review before committing)`);
