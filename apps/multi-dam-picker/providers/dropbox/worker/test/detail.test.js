import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropboxWorld } from './support/dropbox-world.js';
import { file, DEFAULT_FILES } from './support/fake-dropbox.js';
import { assertDetail } from '../../../../worker/test/support/schema.js';
import { rawImageUrl, REASONS } from '../links.js';

const ID_PATTERN = /^id:[A-Za-z0-9_-]{1,64}$/;
const asset = (res) => res.json().asset;
const publicLink = (extra = {}) => ({
  '.tag': 'file',
  url: 'https://www.dropbox.com/scl/fi/abc123/beach.jpg?rlkey=KEY123&st=zz99&dl=0',
  name: 'Beach Boat.jpg',
  link_permissions: {
    resolved_visibility: { '.tag': 'public' }, effective_audience: { '.tag': 'public' }, allow_download: true,
  },
  ...extra,
});
const WRITES = ['modify_shared_link_settings', 'revoke_shared_link', 'get_temporary_link', 'delete', 'move', 'copy', 'upload', 'create_folder'];

test('DBX-LK1: a file with a public link uses it: metadata and list only, no create call', async () => {
  const w = await dropboxWorld({ links: { 'id:file1': [publicLink()] } });
  const res = await w.detail('id:file1');
  assert.equal(res.statusCode, 200);
  assertDetail(asset(res), { provider: 'dropbox', idPattern: ID_PATTERN });
  assert.equal(w.rpcs('create_shared_link_with_settings').length, 0);
  assert.equal(w.rpcs('list_shared_links')[0].json.direct_only, true);
  assert.equal(asset(res).insertable.ok, true);
  assert.equal(asset(res).renditions[0].url, 'https://www.dropbox.com/scl/fi/abc123/beach.jpg?rlkey=KEY123&st=zz99&raw=1');
});

test('DBX-LK2: a file without a link gets exactly one public link; opening it again creates no second', async () => {
  const w = await dropboxWorld();
  const first = await w.detail('id:file1');
  assert.equal(first.statusCode, 200);
  const [create] = w.rpcs('create_shared_link_with_settings');
  assert.deepEqual(create.json.settings, {
    requested_visibility: { '.tag': 'public' }, audience: { '.tag': 'public' }, access: { '.tag': 'viewer' }, allow_download: true,
  });
  assert.equal(asset(first).insertable.ok, true);
  assert.deepEqual(asset(first).warnings, ['A public Dropbox link was created for this file.']);
  const again = await w.detail('id:file1');
  assert.equal(w.rpcs('create_shared_link_with_settings').length, 1);
  assert.equal(asset(again).renditions[0].url, asset(first).renditions[0].url);
  assert.deepEqual(asset(again).warnings, []);
});

test('DBX-LK3: a team policy that resolves the new link to a non-public audience: not insertable with the policy reason, still a 200', async () => {
  const w = await dropboxWorld();
  w.dbx.state.linkAudience = 'team';
  const res = await w.detail('id:file1');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(asset(res).insertable, { ok: false, reason: REASONS.policy });
  assert.deepEqual(asset(res).renditions, []);
});

test('DBX-LK4: link-creation errors are a 200 with a fixed reason and never upstream text', async () => {
  const cases = [['settings_error:not_authorized', REASONS.notAuthorized], ['settings_error:invalid_settings', REASONS.invalidSettings],
    ['access_denied', REASONS.accessDenied], ['email_not_verified', REASONS.emailNotVerified]];
  for (const [error, reason] of cases) {
    // eslint-disable-next-line no-await-in-loop
    const w = await dropboxWorld();
    w.dbx.state.createSettingsError = error;
    // eslint-disable-next-line no-await-in-loop
    const res = await w.detail('id:file1');
    assert.equal(res.statusCode, 200, error);
    assert.deepEqual(asset(res).insertable, { ok: false, reason });
    assert.ok(!res.body.includes('error_summary') && !res.body.includes('settings_error'));
  }
});

test('DBX-LK5: shared_link_already_exists on create (a race) is judged like an existing link; no second create, no modification', async () => {
  const w = await dropboxWorld();
  const created = publicLink({ url: 'https://www.dropbox.com/scl/fi/race/beach.jpg?rlkey=RACE&dl=0' });
  w.dbx.inject('list_shared_links', { status: 200, headers: { 'content-type': 'application/json' }, body: '{"links":[],"has_more":false}' });
  w.dbx.links.set('id:file1', [created]);
  const res = await w.detail('id:file1');
  assert.equal(res.statusCode, 200);
  assert.equal(asset(res).renditions[0].url, 'https://www.dropbox.com/scl/fi/race/beach.jpg?rlkey=RACE&raw=1');
  assert.equal(w.rpcs('create_shared_link_with_settings').length, 1);
  WRITES.forEach((name) => assert.equal(w.rpcs(name).length, 0, name));
  // the same race with a non-public winner
  const w2 = await dropboxWorld();
  w2.dbx.inject('list_shared_links', { status: 200, headers: { 'content-type': 'application/json' }, body: '{"links":[],"has_more":false}' });
  w2.dbx.links.set('id:file1', [publicLink({ link_permissions: { effective_audience: { '.tag': 'team' }, resolved_visibility: { '.tag': 'team_only' } } })]);
  assert.deepEqual(asset(await w2.detail('id:file1')).insertable, { ok: false, reason: REASONS.policy });
});

test('DBX-LK6: unusable existing links are skipped; when none qualifies the asset is not insertable and the link is never touched', async () => {
  const team = publicLink({ link_permissions: { effective_audience: { '.tag': 'team' }, resolved_visibility: { '.tag': 'team_only' } } });
  const password = publicLink({ link_permissions: { effective_audience: { '.tag': 'public' }, resolved_visibility: { '.tag': 'password' } } });
  const expiring = publicLink({ expires: '2030-01-01T00:00:00Z' });
  const noDownload = publicLink({ link_permissions: { effective_audience: { '.tag': 'public' }, resolved_visibility: { '.tag': 'public' }, allow_download: false } });
  for (const [link, reason] of [[team, REASONS.policy], [password, REASONS.password], [expiring, REASONS.expiring], [noDownload, REASONS.noDownload]]) {
    // eslint-disable-next-line no-await-in-loop
    const w = await dropboxWorld({ links: { 'id:file1': [link] } });
    // eslint-disable-next-line no-await-in-loop
    const res = await w.detail('id:file1');
    assert.deepEqual(asset(res).insertable, { ok: false, reason });
    assert.equal(w.rpcs('create_shared_link_with_settings').length, 0);
    WRITES.forEach((name) => assert.equal(w.rpcs(name).length, 0, name));
  }
  const w = await dropboxWorld({ links: { 'id:file1': [team, publicLink()] } });
  assert.equal(asset(await w.detail('id:file1')).insertable.ok, true, 'a later qualifying link is used');
});

test('DBX-LK7/LK8: only direct file links are considered, and across everything no write endpoint but create is ever called', async () => {
  const folderLink = publicLink({ '.tag': 'folder' });
  const w = await dropboxWorld({ links: { 'id:file1': [folderLink] } });
  const res = await w.detail('id:file1');
  assert.equal(asset(res).insertable.ok, false);
  assert.equal(w.rpcs('create_shared_link_with_settings').length, 0);
  const all = await dropboxWorld();
  for (const f of DEFAULT_FILES) {
    // eslint-disable-next-line no-await-in-loop
    await all.detail(f.id);
  }
  await all.search({ q: 'a' });
  const allowed = ['search_v2', 'get_metadata', 'list_shared_links', 'create_shared_link_with_settings', 'get_thumbnail_batch'];
  all.dbx.requests.filter((r) => r.path.startsWith('/2/')).forEach((r) => assert.ok(allowed.some((a) => r.path.endsWith(a)), r.path));
});

test('DBX-RD1/RD2: the image URL is the returned link with dl removed and raw=1 set, parameters untouched; foreign, http, credentialed or malformed links are dropped', () => {
  assert.equal(rawImageUrl('https://www.dropbox.com/scl/fi/a/b%20c.jpg?rlkey=k%2B1&st=s&dl=1'), 'https://www.dropbox.com/scl/fi/a/b%20c.jpg?rlkey=k%2B1&st=s&raw=1');
  assert.equal(rawImageUrl('https://www.dropbox.com/scl/fi/a/x.jpg?raw=0&rlkey=k'), 'https://www.dropbox.com/scl/fi/a/x.jpg?raw=1&rlkey=k');
  for (const bad of ['http://www.dropbox.com/scl/fi/a/x.jpg', 'https://evil.example/x.jpg', 'https://www.dropbox.com.evil.example/x', 'https://u:p@www.dropbox.com/x', 'javascript:alert(1)', 'not a url', '', undefined]) {
    assert.equal(rawImageUrl(bad), undefined, String(bad));
  }
});

test('DBX-RD2/RD3: a link on another host makes the file not insertable; a non-image file is a link exactly as returned, with no rendition', async () => {
  const evil = await dropboxWorld({ links: { 'id:file1': [publicLink({ url: 'https://evil.example/x.jpg' })] } });
  assert.deepEqual(asset(await evil.detail('id:file1')).insertable, { ok: false, reason: REASONS.badLink });
  const link = 'https://www.dropbox.com/scl/fi/pdf1/Brand%20Guide.pdf?rlkey=PDFKEY&dl=0';
  const w = await dropboxWorld({ links: { 'id:file3': [publicLink({ url: link })] } });
  const res = await w.detail('id:file3');
  assert.equal(asset(res).linkUrl, link, 'unmodified, dl=0 kept');
  assert.deepEqual(asset(res).renditions, []);
  assert.equal(asset(res).insertable.ok, true);
  assert.equal(asset(res).type, 'document');
});

test('DBX-RD4/RD5: one "original" rendition with its size and dimensions when ready; none are built from ids or paths', async () => {
  const w = await dropboxWorld({ links: { 'id:file1': [publicLink()], 'id:file2': [publicLink({ url: 'https://www.dropbox.com/scl/fi/h/h.png?rlkey=h&dl=0' })] } });
  const a = asset(await w.detail('id:file1'));
  assert.equal(a.renditions.length, 1);
  assert.equal(a.defaultRenditionId, 'original');
  assert.match(a.renditions[0].label, /^Original \(\d+ B\)$/);
  assert.deepEqual([a.renditions[0].width, a.renditions[0].height, a.width, a.height], [2000, 1333, 2000, 1333]);
  const pending = asset(await w.detail('id:file2'));
  assert.equal(pending.renditions[0].width, undefined);
  assert.equal(pending.width, undefined);
  // a file id without any link yields no URL when Dropbox refuses to create one
  const none = await dropboxWorld();
  none.dbx.state.createSettingsError = 'access_denied';
  const r = asset(await none.detail('id:file1'));
  assert.equal(r.renditions.length + (r.linkUrl ? 1 : 0), 0);
  assert.ok(!JSON.stringify(r).includes('file1') || !/https?:/.test(JSON.stringify(r)));
});

test('DBX-TY2: browser-renderable images are insertable; HEIC, TIFF, BMP and RAW are images but not insertable, and no link is created for them', async () => {
  const files = ['a.jpg', 'a.jpeg', 'a.png', 'a.gif', 'a.webp', 'a.avif', 'a.svg', 'a.heic', 'a.tif', 'a.tiff', 'a.bmp', 'a.cr2'].map((n, i) => file(i + 1, n));
  const w = await dropboxWorld({ files });
  for (const f of files) {
    // eslint-disable-next-line no-await-in-loop
    const res = await w.detail(f.id);
    const ok = /\.(jpe?g|png|gif|webp|avif|svg)$/.test(f.name);
    assert.equal(asset(res).insertable.ok, ok, f.name);
    assert.equal(asset(res).type, 'image');
    if (!ok) assert.equal(asset(res).insertable.reason, REASONS.format);
  }
  assert.equal(w.rpcs('create_shared_link_with_settings').length, 7, 'links only for the insertable formats');
});

test('DBX-AL1: with a property template and field configured the value is the alt text and only that template is requested', async () => {
  const props = [{ template_id: 'ptid:T1', fields: [{ name: 'Alt Text', value: 'A boat <b>on</b> a beach &amp; sea' }] }];
  const files = DEFAULT_FILES.map((f) => (f.id === 'id:file1' ? { ...f, property_groups: props } : f));
  const w = await dropboxWorld({ files, inputs: { DROPBOX_ALT_TEMPLATE_ID: 'ptid:T1', DROPBOX_ALT_FIELD: 'Alt Text' }, links: { 'id:file1': [publicLink()] } });
  const res = await w.detail('id:file1');
  assert.deepEqual(asset(res).alt, { value: 'A boat on a beach sea', source: 'property' });
  assert.deepEqual(w.rpcs('get_metadata')[0].json.include_property_groups, { '.tag': 'filter_some', filter_some: ['ptid:T1'] });
  const plain = await dropboxWorld({ links: { 'id:file1': [publicLink()] } });
  await plain.detail('id:file1');
  assert.equal('include_property_groups' in plain.rpcs('get_metadata')[0].json, false);
});

test('DBX-AL2/AL3: absent field -> cleaned file name; nothing usable -> none; one of the two settings -> unconfigured and logged by name only', async () => {
  const w = await dropboxWorld({ files: [file(1, 'Hero_Banner-2024.jpg'), file(2, '<script>.jpg'), file(3, '___.jpg')], inputs: { DROPBOX_ALT_TEMPLATE_ID: 'ptid:T1', DROPBOX_ALT_FIELD: 'Alt Text' } });
  assert.deepEqual(asset(await w.detail('id:file1')).alt, { value: 'Hero Banner 2024', source: 'name' });
  assert.deepEqual(asset(await w.detail('id:file2')).alt, { value: '', source: 'none' }, 'markup is stripped, nothing left');
  assert.deepEqual(asset(await w.detail('id:file3')).alt, { value: '', source: 'none' });
  const half = await dropboxWorld({ inputs: { DROPBOX_ALT_TEMPLATE_ID: 'ptid:T1' } });
  const res = await half.detail('id:file1');
  assert.equal(asset(res).alt.source, 'name');
  assert.equal('include_property_groups' in half.rpcs('get_metadata')[0].json, false);
  const line = half.logs.find((l) => l.includes('alt_unconfigured'));
  assert.ok(line.includes('DROPBOX_ALT_FIELD') && !line.includes('ptid:T1'));
});

test('detail of a file outside the configured root, a missing file or a folder is a 404', async () => {
  const files = [file(1, 'in.jpg'), file(2, 'out.jpg', { path_lower: '/other/out.jpg' }), { '.tag': 'folder', id: 'id:dir', name: 'dir', path_lower: '/brand/dir' }];
  const w = await dropboxWorld({ files });
  assert.equal((await w.detail('id:file2')).statusCode, 404);
  assert.equal((await w.detail('id:dir')).statusCode, 404);
  assert.equal((await w.detail('id:missing')).statusCode, 404);
  assert.equal((await w.detail('id:file1')).statusCode, 200);
});
