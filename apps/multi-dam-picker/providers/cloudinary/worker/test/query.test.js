import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExpression, buildSearch, keywordWords, SEARCH_FIELDS } from '../query.js';
import { assertStructure, FIXED, tokenize } from './support/expression.js';
import { resolveConfig } from '../config.js';
import { pickerWorld, ID } from '../../../../worker/test/support/world.js';
import { loadFixture } from './support/fake-cloudinary.js';

const cfg = (extra = {}) => resolveConfig({ CLOUDINARY_CLOUD_NAME: 'yifoe45l', CLOUDINARY_ROOT_FOLDER: 'samples/', ...extra });

test('CQ1: no query, type all -> fixed prefix plus root clause, no sort_by, max_results = page size', () => {
  const { body } = buildSearch(cfg(), { q: '', type: 'all', sort: 'newest', page: 1, pageSize: 24 });
  assert.equal(body.expression, FIXED);
  assert.equal('sort_by' in body, false);
  assert.equal(body.max_results, 24);
});

test('CQ2: keyword words are quoted and ANDed; at most 8 words and 200 characters', () => {
  assert.equal(buildExpression(cfg(), { q: 'red shoes', type: 'all' }), `${FIXED} AND ("red" AND "shoes")`);
  assert.equal(keywordWords('a b c d e f g h i j k').length, 8);
  assert.ok(keywordWords('x'.repeat(500)).join('').length <= 100);
  assert.ok(keywordWords(`${'a '.repeat(150)}zzz`).join(' ').length <= 200);
  assert.deepEqual(keywordWords('   '), []);
  assert.equal(buildExpression(cfg(), { q: '   ', type: 'all' }), FIXED);
});

const HOSTILE = ['"', '\\', '*', ')', 'OR', '-', ':', 'NOT', 'a\nb', 'a\u0000b', 'x'.repeat(5000), 'ünïcødé', '🙂 emoji',
  'x" OR type=private', ') OR (', 'public_id:*', 'a" AND "b', '" OR 1=1 --', '\\"', '(((', 'type=upload'];

test('CQ3: hostile text never produces unquoted user characters and the fixed prefix survives', () => {
  HOSTILE.forEach((q) => assertStructure(buildExpression(cfg(), { q, type: 'all' })));
  const e = buildExpression(cfg(), { q: '"x\\y*z\u0000w', type: 'all' });
  assert.ok(e.endsWith('("x" AND "y" AND "z" AND "w")'));
});

test('CQ4: injection corpus -> balanced, exactly one type=upload, root intact, no clause added or removed', () => {
  ['x" OR type=private', '*', ') OR (', 'public_id:*', 'a" AND "b'].forEach((q) => {
    const e = buildExpression(cfg(), { q, type: 'image' });
    assertStructure(e);
    const { tokens } = tokenize(e);
    assert.equal(tokens.filter((t) => t === 'resource_type=image').length, 1);
    assert.equal(tokens.filter((t) => typeof t === 'object' && /private/.test(t.quoted)).length <= 1, true);
  });
});

test('CQ5: type clauses', () => {
  const e = (type) => buildExpression(cfg(), { q: '', type });
  assert.match(e('image'), /resource_type=image AND NOT format=pdf$/);
  assert.match(e('video'), /resource_type=video AND NOT \(format=mp3 OR /);
  assert.match(e('audio'), /resource_type=video AND \(format=mp3 OR /);
  assert.match(e('document'), /\(\(resource_type=image AND format=pdf\) OR resource_type=raw\)$/);
  assert.throws(() => e('everything'), (err) => err.kind === 'bad_request');
});

test('CQ6: sorts', () => {
  const sort = (s, q = '') => buildSearch(cfg(), { q, type: 'all', sort: s, page: 1, pageSize: 24 }).body.sort_by;
  assert.equal(sort('newest'), undefined);
  assert.deepEqual(sort('oldest'), [{ created_at: 'asc' }]);
  assert.deepEqual(sort('name'), [{ public_id: 'asc' }]);
  assert.deepEqual(sort('relevance', 'beach'), [{ score: 'desc' }]);
  assert.throws(() => sort('relevance'), (e) => e.kind === 'bad_request');
  assert.throws(() => sort('relevance', '***'), (e) => e.kind === 'bad_request');
  assert.throws(() => sort('bogus'), (e) => e.kind === 'bad_request');
});

test('CQ7: root normalisation, dynamic and fixed mode, escaping, invalid roots', () => {
  assert.equal(cfg().root, 'samples');
  assert.equal(cfg({ CLOUDINARY_ROOT_FOLDER: '/samples/' }).root, 'samples');
  assert.match(buildExpression(cfg(), { q: '', type: 'all' }), /asset_folder=samples OR asset_folder:samples\/\*/);
  assert.match(buildExpression(cfg({ CLOUDINARY_FOLDER_MODE: 'fixed' }), { q: '', type: 'all' }), /\(folder=samples OR folder:samples\/\*\)/);
  const spaced = buildExpression(cfg({ CLOUDINARY_ROOT_FOLDER: 'my folder/(a):b' }), { q: '', type: 'all' });
  assert.ok(spaced.includes('asset_folder="my folder/(a):b"'));
  assert.ok(spaced.includes('asset_folder:"my folder/(a):b/*"'));
  assert.ok(tokenize(spaced).ok);
  assert.equal(buildExpression(cfg({ CLOUDINARY_ROOT_FOLDER: '' }), { q: '', type: 'all' }), 'type=upload');
  ['..', 'a/../b', 'a\u0000b', 'samples" OR type=private', 'a*', 'a\\b', './x'].forEach((bad) => {
    assert.throws(() => cfg({ CLOUDINARY_ROOT_FOLDER: bad }), (e) => e.setting === 'CLOUDINARY_ROOT_FOLDER');
  });
});

test('CQ8: paging -> max_results; window end; zero upstream calls on every rejection', async () => {
  const mr = (page, pageSize) => buildSearch(cfg(), { q: '', type: 'all', sort: 'newest', page, pageSize }).body.max_results;
  assert.equal(mr(1, 24), 24);
  assert.equal(mr(3, 24), 72);
  assert.equal(mr(21, 24), 500);
  assert.throws(() => mr(22, 24), (e) => e.kind === 'bad_request');
  const w = await pickerWorld();
  assert.equal((await w.search({ page: '22', pageSize: '24' })).statusCode, 400);
  assert.equal(w.cloud.calls, 0);
  assert.equal((await w.search({ page: '21', pageSize: '24' })).statusCode, 200);
  assert.equal(w.cloud.requests[0].json.max_results, 500);
});

function rows(n) {
  const base = loadFixture('search').resources[0];
  return Array.from({ length: n }, (_, i) => ({
    ...base, asset_id: ID(i + 1), public_id: `samples/item-${i}`, display_name: `item-${i}`,
    secure_url: `https://res.cloudinary.com/yifoe45l/image/upload/v1/samples/item-${i}.jpg`,
  }));
}

test('CQ9: slice and hasMore', async () => {
  const w = await pickerWorld({ cloud: { resources: rows(60), cacheSeconds: 0 }, inputs: { CLOUDINARY_CACHE_SECONDS: '0' } });
  const p2 = (await w.search({ page: '2' })).json();
  assert.deepEqual(p2.items.map((i) => i.name).slice(0, 1), ['item-24']);
  assert.equal(p2.items.length, 24);
  assert.equal(p2.items.at(-1).name, 'item-47');
  assert.equal(p2.hasMore, true);
  assert.equal(p2.total, 60);
  const p3 = (await w.search({ page: '3' })).json();
  assert.equal(p3.items.length, 12);
  assert.equal(p3.hasMore, false);
});

test('CQ9: at the window end with a larger total, hasMore is false and total is reported', async () => {
  const big = rows(500);
  const w = await pickerWorld({
    cloud: { resources: big }, inputs: { CLOUDINARY_CACHE_SECONDS: '0' },
  });
  // the fake reports total_count of what matched; script a 900 total through a wrapper
  const orig = w.cloud.fetch;
  w.cloud.fetch = async (url, init) => {
    const res = await orig(url, init);
    const body = await res.json();
    body.total_count = 900;
    return new Response(JSON.stringify(body), { status: 200, headers: res.headers });
  };
  const last = (await w.search({ page: '21' })).json();
  assert.equal(last.items.length, 20);
  assert.equal(last.hasMore, false);
  assert.equal(last.total, 900);
});

function seeded(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('CQ10 and CX1: seeded fuzz of 1,000 strings keeps the fixed prefix, balance and no unquoted user text', () => {
  const rand = seeded(23);
  const alphabet = ['"', '\\', '*', '(', ')', ' ', '\n', '\u0000', '\u007f', 'a', 'B', 'ü', '🙂', 'OR', 'AND', 'NOT', ':', '-', '=', '/', 'type=upload', "'", '%', '&'];
  for (let i = 0; i < 1000; i += 1) {
    const len = Math.floor(rand() * 60);
    const q = Array.from({ length: len }, () => alphabet[Math.floor(rand() * alphabet.length)]).join('');
    ['all', 'image', 'video', 'audio', 'document'].forEach((type) => assertStructure(buildExpression(cfg(), { q, type })));
  }
});

test('CQ11: case, unicode and emoji pass through quoted and JSON-encoded', async () => {
  const w = await pickerWorld({ inputs: { CLOUDINARY_CACHE_SECONDS: '0' } });
  await w.search({ q: 'Ünï 🙂 Shoes' });
  const sent = w.cloud.requests[0].body.toString('utf8');
  assert.ok(JSON.parse(sent).expression.endsWith('("Ünï" AND "🙂" AND "Shoes")'));
});

test('CQ12: POST with JSON to the pinned host and cloud path; exact fields; 5xx retried only via the opt-in', async () => {
  const w = await pickerWorld({ inputs: { CLOUDINARY_CACHE_SECONDS: '0' } });
  await w.search();
  const [req] = w.cloud.requests;
  assert.equal(req.method, 'POST');
  assert.equal(req.url, 'https://api.cloudinary.com/v1_1/yifoe45l/resources/search');
  assert.match(req.headers['content-type'], /^application\/json/);
  assert.deepEqual(req.json.fields, [...SEARCH_FIELDS]);
  assert.ok(!req.json.fields.includes('tags') && !req.json.fields.includes('context'));
  const flaky = await pickerWorld({
    cloud: { script: [{ status: 503, body: '{}' }, { pass: true }] }, inputs: { CLOUDINARY_CACHE_SECONDS: '0' },
  });
  assert.equal((await flaky.search()).statusCode, 200);
  assert.equal(flaky.cloud.calls, 2);
  const noRetry = await pickerWorld({ cloud: { script: [{ status: 409, body: '{}' }, { pass: true }] } });
  assert.equal((await noRetry.search()).statusCode, 502);
  assert.equal(noRetry.cloud.calls, 1);
});
