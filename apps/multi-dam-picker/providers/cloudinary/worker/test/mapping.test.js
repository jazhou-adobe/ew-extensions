import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickerWorld, KEY, SECRET, BASIC, ID } from '../../../../worker/test/support/world.js';
import { loadFixture } from './support/fake-cloudinary.js';
import { cleanText, nameToAlt } from '../alt.js';

const rows = loadFixture('search').resources;
const byPid = (pid) => rows.find((r) => r.public_id === pid);
const BEACH = byPid('samples/landscapes/beach-boat');
const world = (inputs = {}, cloud = {}) => pickerWorld({ inputs: { CLOUDINARY_CACHE_SECONDS: '0', ...inputs }, cloud });
const list = async (w, q = {}) => (await w.search({ pageSize: '50', ...q })).json().items;
const detail = async (w, row) => (await w.detail(row.asset_id)).json().asset;

test('CM1: image summary mapping', async () => {
  const item = (await list(await world())).find((i) => i.name === 'beach-boat');
  assert.equal(item.id, BEACH.asset_id);
  assert.equal(item.provider, 'cloudinary');
  assert.equal(item.type, 'image');
  assert.deepEqual([item.width, item.height, item.extension, item.fileSize], [2000, 1333, 'jpg', 1233456]);
  assert.equal(item.dateModified, '2026-11-10T09:15:00Z');
  assert.deepEqual(item.warnings, []);
});

test('CM2: type mapping (pdf, mp3, mp4, raw document, font)', async () => {
  const types = Object.fromEntries((await list(await world())).map((i) => [i.name, i.type]));
  assert.equal(types['annual report 2025'], 'document');
  assert.equal(types['podcast-intro'], 'audio');
  assert.equal(types['sea-turtle'], 'video');
  assert.equal(types['handbook.docx'], 'document');
  assert.equal(types['brand.ttf'], 'other');
});

test('CM3: fixed folder mode: no display_name -> name from the last public ID segment; folder from the public ID', async () => {
  const fixed = rows.filter((r) => r.type === 'upload').map(({ display_name: _d, asset_folder: _f, ...r }) => r);
  const w = await world({ CLOUDINARY_FOLDER_MODE: 'fixed' }, { resources: fixed });
  const items = await list(w);
  assert.ok(items.some((i) => i.name === 'beach-boat'));
  assert.ok(!items.some((i) => i.name === 'sample'), 'root-level asset is outside the root');
  assert.equal((await w.detail(BEACH.asset_id)).statusCode, 200);
  assert.equal(w.cloud.requests[0].json.expression.includes('(folder=samples OR folder:samples/*)'), true);
});

test('CM4: rows that are not active uploads are dropped', async () => {
  const bad = [
    { ...BEACH, asset_id: ID(901), type: 'private' }, { ...BEACH, asset_id: ID(902), status: 'pending' },
    { ...BEACH, asset_id: ID(903), asset_id_: 1, public_id: undefined }, null, 5, { ...BEACH, asset_id: undefined },
  ];
  const w = await world({}, { resources: [...bad, BEACH] });
  assert.deepEqual((await list(w)).map((i) => i.id), [BEACH.asset_id]);
});

test('CM5: access_control and rejected moderation are listed but not insertable; access_mode is ignored', async () => {
  const w = await world();
  const restricted = byPid('samples/landscapes/premium-view');
  const rejected = byPid('samples/people/needs-review');
  const items = await list(w);
  assert.ok(items.find((i) => i.id === restricted.asset_id).warnings[0].match(/access-restricted/i));
  const a = await detail(w, restricted);
  assert.equal(a.insertable.ok, false);
  assert.match(a.insertable.reason, /access-restricted/i);
  assert.deepEqual(a.renditions, []);
  const r = await detail(w, rejected);
  assert.equal(r.insertable.ok, false);
  assert.match(r.insertable.reason, /moderation/i);
  const modeOnly = await detail(await world({}, { details: { [BEACH.asset_id]: { ...BEACH, access_mode: 'authenticated' } } }), BEACH);
  assert.equal(modeOnly.insertable.ok, true);
});

test('CM6/CX5: non-https or non-allow-listed hosts are not insertable; CLOUDINARY_DELIVERY_HOSTS extends exactly the listed hosts', async () => {
  const mk = (secure_url) => ({ ...BEACH, secure_url });
  const check = async (secure_url, inputs = {}) => {
    const w = await world(inputs, { details: { [BEACH.asset_id]: mk(secure_url) } });
    return detail(w, BEACH);
  };
  const bads = ['http://res.cloudinary.com/yifoe45l/image/upload/v1/a.jpg', 'https://evil.example/yifoe45l/image/upload/v1/a.jpg',
    'javascript:alert(1)', 'data:text/html,hi', 'https://res.cloudinary.com.evil.example/image/upload/v1/a.jpg', 'https://user:pw@res.cloudinary.com/yifoe45l/image/upload/v1/a.jpg'];
  for (const url of bads) {
    const a = await check(url);
    assert.equal(a.insertable.ok, false, url);
    assert.deepEqual(a.renditions, []);
    assert.equal(a.linkUrl, undefined);
  }
  const cdn = 'https://media.example.com/image/upload/v1/a.jpg';
  assert.equal((await check(cdn)).insertable.ok, false);
  assert.equal((await check(cdn, { CLOUDINARY_DELIVERY_HOSTS: 'media.example.com' })).insertable.ok, true);
  assert.equal((await check(cdn, { CLOUDINARY_DELIVERY_HOSTS: 'other.example.com' })).insertable.ok, false);
});

test('CM7: non-image with a good URL -> linkUrl, insertable, no renditions; no thumbnail for audio and raw', async () => {
  const w = await world();
  const pdf = await detail(w, byPid('samples/docs/annual report 2025'));
  assert.equal(pdf.linkUrl, byPid('samples/docs/annual report 2025').secure_url);
  assert.deepEqual(pdf.renditions, []);
  assert.deepEqual(pdf.insertable, { ok: true });
  const mp3 = await detail(w, byPid('samples/audio/podcast-intro'));
  assert.equal(mp3.linkUrl, byPid('samples/audio/podcast-intro').secure_url);
  assert.equal(mp3.thumbnailUrl, undefined);
  const docx = await detail(w, byPid('samples/docs/handbook.docx'));
  assert.equal(docx.extension, 'docx');
  assert.equal(docx.linkUrl.endsWith('handbook.docx'), true);
});

test('CM9: missing optional fields, nulls, empty arrays; a large derived array is dropped; a 500-item search normalises', async () => {
  const sparse = { asset_id: ID(77), public_id: 'samples/sparse', resource_type: 'image', type: 'upload', secure_url: 'https://res.cloudinary.com/yifoe45l/image/upload/v1/samples/sparse.jpg', asset_folder: 'samples', width: null, tags: [], access_control: null, format: null };
  const w = await world({}, { resources: [sparse], details: { [sparse.asset_id]: { ...sparse, derived: Array.from({ length: 2000 }, () => ({ url: 'x'.repeat(100) })), context: null, metadata: null } } });
  const [item] = await list(w);
  assert.equal(item.name, 'sparse');
  assert.equal(item.width, undefined);
  const d = await detail(w, sparse);
  assert.equal(d.derived, undefined);
  assert.ok(JSON.stringify(d).length < 8000);
  const base = loadFixture('search').resources[0];
  const many = Array.from({ length: 500 }, (_, i) => ({ ...base, asset_id: ID(i + 1), public_id: `samples/n${i}` }));
  const big = await world({}, { resources: many });
  const res = await big.search({ page: '21', pageSize: '24' });
  assert.equal(res.statusCode, 200);
  assert.ok(Buffer.byteLength(JSON.stringify(big.cloud.requests[0].json)) < 5000);
});

test('CS1: outbound Authorization is exactly Basic key:secret; nothing inbound is forwarded', async () => {
  const w = await world();
  await w.search({}, { headers: { cookie: 'a=b', 'x-forwarded-for': '1.2.3.4' } });
  const [req] = w.cloud.requests;
  assert.equal(req.headers.authorization, BASIC);
  assert.equal(req.headers.cookie, undefined);
  assert.equal(req.headers.host, undefined);
  assert.equal(Object.keys(req.headers).some((h) => h.startsWith('x-forwarded')), false);
  const token = await w.ims.signToken();
  await w.call({ path: '/dam/cloudinary/assets', token });
  w.cloud.requests.forEach((r) => assert.ok(!JSON.stringify(r.headers).includes(token)));
});

test('CS2: outbound host is the configured API host only; others fail config validation; redirects are not followed', async () => {
  const eu = await world({ CLOUDINARY_API_HOST: 'api-eu.cloudinary.com' });
  await eu.search();
  assert.ok(eu.cloud.requests[0].url.startsWith('https://api-eu.cloudinary.com/v1_1/yifoe45l/'));
  assert.equal(eu.cloud.requests[0].redirect, 'manual');
  const evil = await world({ CLOUDINARY_API_HOST: 'evil.example' });
  const res = await evil.search();
  assert.equal(res.statusCode, 500);
  assert.equal(res.json().error.code, 'misconfigured');
  assert.equal(evil.cloud.calls, 0);
  const redirect = await world({}, { script: [{ status: 302, headers: { location: 'https://evil.example/x' }, body: '' }] });
  assert.equal((await redirect.search()).statusCode, 502);
  assert.equal(redirect.cloud.calls, 1);
});

test('CS3: detail validates the asset id; zero upstream calls on rejection', async () => {
  const w = await world();
  for (const bad of ['..', '%2f', `${BEACH.asset_id}/extra`, BEACH.asset_id.toUpperCase(), 'abc', 'samples%2Flandscapes%2Fbeach-boat', `${BEACH.asset_id}%00`]) {
    const res = await w.call({ path: `/dam/cloudinary/assets/${bad}` });
    assert.ok([400, 404].includes(res.statusCode), `${bad} -> ${res.statusCode}`);
  }
  assert.equal((await w.detail('..')).statusCode, 400);
  assert.equal((await w.detail('%2f')).statusCode, 400);
  assert.equal((await w.detail(BEACH.asset_id.toUpperCase())).statusCode, 400);
  assert.equal(w.cloud.calls, 0);
  const ok = await w.detail(BEACH.asset_id);
  assert.equal(ok.statusCode, 200);
  assert.equal(w.cloud.requests[0].method, 'GET');
  assert.equal(w.cloud.requests[0].url, `https://api.cloudinary.com/v1_1/yifoe45l/resources/${BEACH.asset_id}`);
  assert.equal(w.cloud.requests[0].headers.authorization, BASIC);
});

test('CS4: detail outside the root or not a public upload -> 404 with no asset data', async () => {
  const w = await world();
  const outside = byPid('sample');
  const res = await w.detail(outside.asset_id);
  assert.equal(res.statusCode, 404);
  assert.ok(!res.body.includes('sample.jpg') && !res.body.includes(outside.asset_id));
  const priv = { ...BEACH, type: 'private' };
  const w2 = await world({}, { details: { [BEACH.asset_id]: priv } });
  assert.equal((await w2.detail(BEACH.asset_id)).statusCode, 404);
  const mismatch = await world({}, { details: { [BEACH.asset_id]: { ...BEACH, asset_id: ID(5) } } });
  assert.equal((await mismatch.detail(BEACH.asset_id)).statusCode, 404);
});

test('CS5: a non-JSON body (HTML) on 200, 401, 403 or 5xx is never parsed or echoed', async () => {
  const html = '<html><body>SECRET-PAGE <script>x</script></body></html>';
  for (const status of [200, 401, 403, 500, 502]) {
    const w = await world({}, { script: [{ status, headers: { 'content-type': 'text/html' }, body: html }, { status, headers: { 'content-type': 'text/html' }, body: html }, { status, headers: { 'content-type': 'text/html' }, body: html }, { status, headers: { 'content-type': 'text/html' }, body: html }, { status, headers: { 'content-type': 'text/html' }, body: html }] });
    const res = await w.search();
    assert.equal(res.statusCode, status === 401 || status === 403 ? 500 : 502, `status ${status}`);
    assert.ok(!res.body.includes('SECRET-PAGE') && !res.body.includes('<'));
  }
});

// ---- alt text ----
const withContext = async (context, inputs = {}, extra = {}) => {
  const w = await world(inputs, { details: { [BEACH.asset_id]: { ...BEACH, context, ...extra } } });
  return detail(w, BEACH);
};

test('CT1: context.custom.alt -> property; the context.alt shape is accepted too', async () => {
  assert.deepEqual((await withContext({ custom: { alt: 'Boat on a beach' } })).alt, { value: 'Boat on a beach', source: 'property' });
  assert.deepEqual((await withContext({ alt: 'Direct alt' })).alt, { value: 'Direct alt', source: 'property' });
});

test('CT2: a custom context field and the structured metadata field are honoured (strings only)', async () => {
  assert.equal((await withContext({ custom: { alt_text: 'Custom field' } }, { CLOUDINARY_ALT_CONTEXT_FIELD: 'alt_text' })).alt.value, 'Custom field');
  const meta = await withContext({ custom: { alt: 'ctx' } }, { CLOUDINARY_ALT_METADATA_FIELD: 'alt_md' }, { metadata: { alt_md: 'From metadata' } });
  assert.deepEqual(meta.alt, { value: 'From metadata', source: 'property' });
  const notString = await withContext({ custom: { alt: 'ctx' } }, { CLOUDINARY_ALT_METADATA_FIELD: 'alt_md' }, { metadata: { alt_md: ['x'] } });
  assert.equal(notString.alt.value, 'ctx');
});

test('CT3: no alt but a caption -> description', async () => {
  const a = await withContext({ custom: { caption: 'Beach with boat' } });
  assert.deepEqual(a.alt, { value: 'Beach with boat', source: 'description' });
  assert.equal(a.description, 'Beach with boat');
  const c = await withContext({ caption: 'Top-level caption' });
  assert.equal(c.alt.source, 'description');
});

test('CT4: neither -> the name without extension, separators to spaces', async () => {
  assert.equal(nameToAlt('Hero_Banner-2024.jpg'), 'Hero Banner 2024');
  const a = await withContext({}, {}, { display_name: 'Hero_Banner-2024' });
  assert.deepEqual(a.alt, { value: 'Hero Banner 2024', source: 'name' });
});

test('CT5: nothing usable -> empty value, source none', async () => {
  const a = await withContext({}, {}, { display_name: '___', public_id: '___', filename: '___' });
  assert.deepEqual(a.alt, { value: '', source: 'none' });
});

test('CT6/CT7: markup, entities and control characters are stripped; whitespace collapsed; no angle brackets survive', async () => {
  assert.equal(cleanText('  <b>Bold</b>\u0000 &amp; \n\t   text&#39; '), 'Bold text');
  const a = await withContext({ custom: { alt: '"><script>alert(1)</script> nice' } });
  assert.ok(!/[<>]/.test(a.alt.value));
  assert.equal(a.alt.source, 'property');
});

// ---- canary: the credentials never leak across statuses ----
test('CX3: canary scan across a matrix of scenarios', async () => {
  const scenarios = [{}, { CLOUDINARY_SIGN_URLS: 'true' }];
  const seen = [];
  for (const inputs of scenarios) {
    for (const status of [400, 401, 403, 404, 409, 420, 429, 500, 503]) {
      const w = await world(inputs, { script: [{ status, headers: { 'content-type': 'application/json', 'x-featureratelimit-reset': new Date(Date.now() + 90_000).toUTCString() }, body: JSON.stringify({ error: { message: `echo ${KEY} ${SECRET} ${BASIC}` } }) }] });
      const res = await w.search();
      seen.push(res.body, JSON.stringify(res.headers), w.logs.join('\n'));
      const d = await w.detail(BEACH.asset_id);
      seen.push(d.body, JSON.stringify(d.headers), w.logs.join('\n'));
    }
    const ok = await world(inputs);
    seen.push((await ok.search()).body, (await ok.detail(BEACH.asset_id)).body, ok.logs.join('\n'));
  }
  const text = seen.join('\n');
  [KEY, SECRET, BASIC].forEach((s) => assert.ok(!text.includes(s)));
});
