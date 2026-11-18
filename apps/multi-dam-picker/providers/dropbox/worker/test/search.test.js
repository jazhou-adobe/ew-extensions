import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropboxWorld, manyFiles } from './support/dropbox-world.js';
import { file, DEFAULT_FILES } from './support/fake-dropbox.js';
import { assertSummary } from '../../../../worker/test/support/schema.js';

const ID_PATTERN = /^id:[A-Za-z0-9_-]{1,64}$/;
const ids = (res) => res.json().items.map((i) => i.id);

test('DBX-SE1: a query is one search_v2 call with the mapped categories, order and root, as the author, on the API host only', async () => {
  const w = await dropboxWorld();
  const res = await w.search({ q: 'beach', type: 'document', sort: 'relevance' });
  assert.equal(res.statusCode, 200);
  const [call] = w.rpcs('search_v2');
  assert.equal(w.rpcs('search_v2').length, 1);
  assert.equal(call.host, 'api.dropboxapi.com');
  assert.match(call.headers.authorization, /^Bearer AT-/);
  assert.equal(call.json.query, 'beach');
  assert.deepEqual(call.json.options.file_categories.map((c) => c['.tag']), ['document', 'pdf', 'spreadsheet', 'presentation']);
  assert.deepEqual(call.json.options.order_by, { '.tag': 'relevance' });
  assert.deepEqual(call.json.options.file_status, { '.tag': 'active' });
  assert.equal(call.json.options.path, '/Brand');
  const all = await w.search({ q: 'beach' });
  assert.equal(all.statusCode, 200);
  const tags = w.rpcs('search_v2')[1].json.options.file_categories.map((c) => c['.tag']);
  assert.ok(tags.includes('others') && !tags.includes('folder') && !tags.includes('paper'));
  assert.deepEqual(w.rpcs('search_v2')[1].json.options.order_by, { '.tag': 'last_modified_time' });
  const noRoot = await dropboxWorld({ inputs: { DROPBOX_ROOT_PATH: '' }, files: DEFAULT_FILES.map((f) => ({ ...f })) });
  await noRoot.search({ q: 'beach' });
  assert.equal('path' in noRoot.rpcs('search_v2')[0].json.options, false);
  const hosts = new Set(w.dbx.requests.map((r) => r.host));
  assert.ok([...hosts].every((h) => ['api.dropboxapi.com', 'content.dropboxapi.com'].includes(h)));
  assert.ok(w.dbx.requests.every((r) => !r.headers.authorization?.includes('.') && r.headers.authorization !== w.ims.token));
});

test('DBX-SE2: pages continue the cursor within the caps, de-duplicate, drop folders, Paper and non-downloadable files, and slice exactly', async () => {
  const files = [
    ...manyFiles(250),
    { '.tag': 'folder', id: 'id:folder1', name: 'photo-folder', path_lower: '/brand/photo-folder' },
    file(900, 'photo-paper.paper', { '.tag': 'file', id: 'id:paper1', is_downloadable: false }),
    file(901, 'photo-locked.jpg', { is_downloadable: false }),
  ];
  const w = await dropboxWorld({ files });
  w.dbx.state.duplicateFirst = true;
  const p1 = await w.search({ q: 'photo', pageSize: '50' });
  assert.equal(p1.statusCode, 200);
  assert.equal(p1.json().items.length, 50);
  assert.equal(w.rpcs('search_v2').length, 1, 'page 1 needs one call');
  assert.equal(p1.json().hasMore, true);
  assert.equal(p1.json().total, undefined);
  p1.json().items.forEach((i) => assertSummary(i, { provider: 'dropbox', idPattern: ID_PATTERN }));
  const p3 = await w.search({ q: 'photo', pageSize: '50', page: '3' });
  assert.equal(w.rpcs('search/continue_v2').length, 1, 'page 3 continues the cursor once');
  assert.equal(p3.json().items.length, 50);
  const p5 = await w.search({ q: 'photo', pageSize: '50', page: '5' });
  const everything = [...ids(p1), ...ids(await w.search({ q: 'photo', pageSize: '50', page: '2' })), ...ids(p3), ...ids(await w.search({ q: 'photo', pageSize: '50', page: '4' })), ...ids(p5)];
  assert.equal(new Set(everything).size, everything.length, 'no duplicates across pages');
  assert.ok(!everything.some((i) => ['id:folder1', 'id:paper1', 'id:file901'].includes(i)));
  assert.equal(p5.json().items.length, 50);
  assert.equal(p5.json().hasMore, false, 'the last page of 250 matches');
  // a middle page of a short result
  const small = await dropboxWorld({ files: manyFiles(30) });
  const second = await small.search({ q: 'photo', pageSize: '24', page: '2' });
  assert.equal(second.json().items.length, 6);
  assert.equal(second.json().hasMore, false);
});

test('DBX-SE3: a page beyond the window is a 400 with no upstream call; an empty result is a 200 with no items', async () => {
  const w = await dropboxWorld();
  const res = await w.search({ q: 'x', page: '7', pageSize: '50' });
  assert.equal(res.statusCode, 400);
  assert.equal(w.dbx.requests.length, 0);
  const none = await w.search({ q: 'zzzzzz' });
  assert.equal(none.statusCode, 200);
  assert.deepEqual(none.json().items, []);
  assert.equal(none.json().hasMore, false);
});

test('DBX-SE4: an empty query lists the root (non-recursive), files only, filtered by type, newest first', async () => {
  const files = [...DEFAULT_FILES.map((f) => ({ ...f })), { '.tag': 'folder', id: 'id:f1', name: 'Sub', path_lower: '/brand/sub' }, file(50, 'deep.jpg', { path_lower: '/brand/sub/deep.jpg' })];
  const w = await dropboxWorld({ files });
  const res = await w.search();
  assert.equal(res.statusCode, 200);
  assert.equal(w.rpcs('search_v2').length, 0);
  const [call] = w.rpcs('list_folder');
  assert.deepEqual([call.json.path, call.json.recursive, call.json.include_non_downloadable_files], ['/Brand', false, false]);
  const names = res.json().items.map((i) => i.name);
  assert.ok(!names.includes('Sub') && !names.includes('deep.jpg'));
  const dates = res.json().items.map((i) => i.dateModified);
  assert.deepEqual(dates, [...dates].sort().reverse());
  const images = await w.search({ type: 'image' });
  assert.ok(images.json().items.length > 0 && images.json().items.every((i) => i.type === 'image'));
  const audio = await w.search({ type: 'audio' });
  assert.deepEqual(audio.json().items.map((i) => i.name), ['Jingle.mp3']);
  const big = await dropboxWorld({ files: manyFiles(450) });
  const page = await big.search({ pageSize: '50', page: '2' });
  assert.equal(page.json().items.length, 50);
  assert.ok(big.rpcs('list_folder').length + big.rpcs('list_folder/continue').length <= 3, 'a scan cap bounds the walk');
});

test('DBX-SE5: sorts map to Dropbox orders; relevance needs a query; an unknown sort is a 400 with no upstream call', async () => {
  const w = await dropboxWorld();
  assert.equal((await w.search({ sort: 'relevance' })).statusCode, 400);
  assert.equal((await w.search({ q: 'a', sort: 'name' })).statusCode, 400);
  assert.equal(w.dbx.requests.length, 0);
  await w.search({ q: 'a', sort: 'modified' });
  assert.deepEqual(w.rpcs('search_v2')[0].json.options.order_by, { '.tag': 'last_modified_time' });
});

test('DBX-SE6: special characters in q travel only inside the JSON body, unmodified', async () => {
  const w = await dropboxWorld();
  const q = `a&b=c#d+e "quoted" ünï \\ ${'x'.repeat(10)}`;
  assert.equal((await w.search({ q })).statusCode, 200);
  const [call] = w.rpcs('search_v2');
  assert.equal(call.json.query, q.trim());
  assert.equal(call.path, '/2/files/search_v2');
  assert.equal(new URL(call.url).search, '');
  assert.deepEqual(Object.keys(call.json).sort(), ['options', 'query']);
});

test('DBX-SE7: asset ids that do not match the Dropbox pattern are a 400 with no upstream call; a valid id is only ever sent in a JSON body', async () => {
  const w = await dropboxWorld();
  for (const id of ['..', '%2e%2e', '%2f', '/Brand/x.jpg', 'ns:123', 'file1', 'id:', `id:${'a'.repeat(80)}`, 'id:a/b', 'id:a%2fb', 'id:a b', 'ID:abc']) {
    // eslint-disable-next-line no-await-in-loop
    const res = await w.call({ path: `/dam/dropbox/assets/${id}` });
    assert.ok([400, 404].includes(res.statusCode), `${id} -> ${res.statusCode}`);
  }
  assert.equal(w.dbx.requests.length, 0);
  assert.equal((await w.detail('id:file1')).statusCode, 200);
  assert.ok(w.dbx.requests.every((r) => !r.url.includes('file1') && !r.url.includes('id:')));
  assert.equal(w.rpcs('get_metadata')[0].json.path, 'id:file1');
});

test('DBX-SE8: a slow Dropbox cannot push the walk past the invocation budget: it returns what it has with hasMore, never a timeout', async () => {
  const w = await dropboxWorld({ files: manyFiles(600) });
  w.latency.ms = 8000;
  const res = await w.search({ q: 'photo', pageSize: '50', page: '5' });
  assert.equal(res.statusCode, 200);
  assert.ok(w.rpcs('search_v2').length + w.rpcs('search/continue_v2').length < 3, 'it stopped before the call cap');
  assert.equal(res.json().hasMore, true);
  assert.ok(res.json().items.length < 50);
});

test('DBX-TY1: the extension table: representative extensions per type, unknown is other, case-insensitive, the last extension counts', async () => {
  const names = ['a.JPG', 'a.png', 'a.tiff', 'a.heic', 'b.MP4', 'b.mov', 'c.mp3', 'c.WAV', 'd.pdf', 'd.docx', 'd.xlsx', 'd.pptx', 'e.xyz', 'noext', 'f.tar.gz', 'f.jpg.txt', 'f.txt.jpg'];
  const w = await dropboxWorld({ files: names.map((n, i) => file(i + 1, n)) });
  const res = await w.search();
  const types = Object.fromEntries(res.json().items.map((i) => [i.name, i.type]));
  assert.deepEqual(types, {
    'a.JPG': 'image', 'a.png': 'image', 'a.tiff': 'image', 'a.heic': 'image', 'b.MP4': 'video', 'b.mov': 'video', 'c.mp3': 'audio', 'c.WAV': 'audio',
    'd.pdf': 'document', 'd.docx': 'document', 'd.xlsx': 'document', 'd.pptx': 'document', 'e.xyz': 'other', noext: 'other', 'f.tar.gz': 'other', 'f.jpg.txt': 'document', 'f.txt.jpg': 'image',
  });
});

test('DBX-TH1: thumbnails come in batches of at most 25 at w128h128 from the content host, for convertible files only; a 50-item page needs two calls', async () => {
  const w = await dropboxWorld({ files: [...manyFiles(48), file(500, 'doc.docx'), file(501, 'clip.mp4')] });
  const res = await w.search({ pageSize: '50' });
  assert.equal(res.statusCode, 200);
  const calls = w.rpcs('get_thumbnail_batch');
  assert.equal(calls.length, 2);
  calls.forEach((c) => {
    assert.equal(c.host, 'content.dropboxapi.com');
    assert.ok(c.json.entries.length <= 25);
    c.json.entries.forEach((e) => {
      assert.equal(e.size['.tag'], 'w128h128');
      assert.match(e.path, /^id:/);
    });
  });
  assert.equal(calls.reduce((n, c) => n + c.json.entries.length, 0), 48, 'documents and videos are not requested');
  const items = res.json().items.filter((i) => i.thumbnailUrl);
  assert.equal(items.length, 48);
  items.forEach((i) => assert.match(i.thumbnailUrl, /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/));
  assert.ok(res.json().items.filter((i) => !i.thumbnailUrl).every((i) => ['document', 'video'].includes(i.type)));
});

test('DBX-TH2/TH3: a failed entry, an unsupported format, a 5xx batch or a malformed payload leaves the page intact without thumbnails', async () => {
  const w = await dropboxWorld();
  const res = await w.search();
  const heic = res.json().items.find((i) => i.name === 'Scan.heic');
  assert.equal(heic.thumbnailUrl, undefined, 'heic is not convertible');
  const down = await dropboxWorld();
  down.dbx.inject('get_thumbnail_batch', { status: 503, body: 'x' }, { times: 9 });
  const r2 = await down.search();
  assert.equal(r2.statusCode, 200);
  assert.ok(r2.json().items.length > 0 && r2.json().items.every((i) => !i.thumbnailUrl));
  const bad = await dropboxWorld();
  bad.dbx.state.thumbnail = 'not base64 <script>';
  const r3 = await bad.search();
  assert.ok(r3.json().items.every((i) => !i.thumbnailUrl));
  assert.ok(!r3.body.includes('data:') && !r3.body.includes('<script>'));
  const huge = await dropboxWorld();
  huge.dbx.state.thumbnail = 'A'.repeat(70_000);
  assert.ok((await huge.search()).json().items.every((i) => !i.thumbnailUrl), 'over 64 KB is dropped');
  const none = await dropboxWorld();
  none.dbx.state.thumbnails = false;
  const r4 = await none.search();
  assert.equal(r4.statusCode, 200);
  assert.ok(r4.json().items.every((i) => !i.thumbnailUrl));
});

test('DBX-TH4: a response budget caps the inline thumbnails so the answer stays far below the 1 MB limit', async () => {
  const w = await dropboxWorld({ files: manyFiles(60) });
  w.dbx.state.thumbnail = 'A'.repeat(30_000);
  const res = await w.search({ pageSize: '50' });
  assert.equal(res.statusCode, 200);
  const withThumb = res.json().items.filter((i) => i.thumbnailUrl).length;
  assert.ok(withThumb > 0 && withThumb <= 17, `${withThumb} thumbnails`);
  assert.equal(res.json().items.length, 50);
  assert.ok(Buffer.byteLength(res.body) < 600 * 1024);
  // a batch so large that the proxy's own response cap trips: the page still arrives, without thumbnails
  const huge = await dropboxWorld({ files: manyFiles(60) });
  huge.dbx.state.thumbnail = 'A'.repeat(60_000);
  const r2 = await huge.search({ pageSize: '50' });
  assert.equal(r2.statusCode, 200);
  assert.equal(r2.json().items.length, 50);
  assert.ok(r2.json().items.every((i) => !i.thumbnailUrl));
});
