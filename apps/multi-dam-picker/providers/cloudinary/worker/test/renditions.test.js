import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { signature } from '../renditions.js';
import { pickerWorld, KEY, SECRET, BASIC } from '../../../../worker/test/support/world.js';
import { loadFixture } from './support/fake-cloudinary.js';

const rows = loadFixture('search').resources;
const byPid = (pid) => rows.find((r) => r.public_id === pid);
const BEACH = byPid('samples/landscapes/beach-boat');
const world = (inputs = {}, cloud = {}) => pickerWorld({ inputs: { CLOUDINARY_CACHE_SECONDS: '0', ...inputs }, cloud });
const asset = async (w, row) => (await w.detail(row.asset_id)).json().asset;
const SIGNED = /\/upload\/s--[A-Za-z0-9_-]{8}--\//;

test('CR8: known-answer vector from the Cloudinary documentation (SHA-1)', () => {
  assert.equal(signature({
    transformation: 'c_fill,w_300,h_250/e_grayscale', tail: 'sample-authenticated.png', secret: 'abcd',
  }), 'iDy_JeBq');
});

test('CR9: SHA-256 mode gives rSONCRLG for the same input; SHA-1 is the default', () => {
  const input = { transformation: 'c_fill,w_300,h_250/e_grayscale', tail: 'sample-authenticated.png', secret: 'abcd' };
  assert.equal(signature({ ...input, algorithm: 'sha256' }), 'rSONCRLG');
  assert.equal(signature(input), signature({ ...input, algorithm: 'sha1' }));
});

test('CR10: the signed string is <transformation>/<public id>.<ext> + secret, without the version', () => {
  const sig = createHash('sha1').update('c_limit,w_1200/f_auto/q_auto/samples/landscapes/beach-boat.jpgSECRET')
    .digest('base64').replace(/\+/g, '-')
    .replace(/\//g, '_')
    .slice(0, 8);
  assert.equal(signature({
    transformation: 'c_limit,w_1200/f_auto/q_auto', tail: 'samples/landscapes/beach-boat.jpg', secret: 'SECRET',
  }), sig);
});

test('CR1: default set built from the API-returned URL; web is the default; the rest of the URL is unchanged', async () => {
  const a = await asset(await world(), BEACH);
  assert.deepEqual(a.renditions.map((r) => r.id), ['web', 'large', 'medium', 'small', 'original']);
  assert.equal(a.defaultRenditionId, 'web');
  const web = a.renditions[0];
  assert.equal(web.url, 'https://res.cloudinary.com/yifoe45l/image/upload/c_limit,w_1200/f_auto/q_auto/v1700000011/samples/landscapes/beach-boat.jpg');
  assert.ok(a.renditions[1].url.includes('/c_limit,w_2000/'));
  assert.ok(a.renditions[3].url.includes('/c_limit,w_400/'));
  assert.deepEqual(a.insertable, { ok: true });
});

test('CR2: original only for displayable formats and equals the returned secure_url', async () => {
  const w = await world();
  const jpg = await asset(w, BEACH);
  assert.equal(jpg.renditions.find((r) => r.id === 'original').url, BEACH.secure_url);
  const gif = await asset(w, byPid('samples/animals/kitten-playing'));
  assert.ok(gif.renditions.some((r) => r.id === 'original'));
  const tiff = await asset(w, byPid('samples/landscapes/scan'));
  assert.deepEqual(tiff.renditions.map((r) => r.id), ['web', 'large', 'medium', 'small']);
  assert.ok(tiff.renditions.every((r) => r.url.includes('f_auto')));
});

test('CR3: a URL shape mismatch makes the asset not insertable; no URL is synthesised', async () => {
  const noVersion = { ...BEACH, secure_url: 'https://res.cloudinary.com/yifoe45l/image/upload/samples/landscapes/beach-boat.jpg' };
  const w = await world({}, { details: { [BEACH.asset_id]: noVersion } });
  const a = await asset(w, BEACH);
  assert.equal(a.insertable.ok, false);
  assert.match(a.insertable.reason, /unrecognised/i);
  assert.deepEqual(a.renditions, []);
  const wrongType = { ...BEACH, secure_url: 'https://res.cloudinary.com/yifoe45l/video/upload/v1/x.jpg' };
  const w2 = await world({}, { details: { [BEACH.asset_id]: wrongType } });
  assert.equal((await asset(w2, BEACH)).insertable.ok, false);
});

test('CR4: public IDs with folders, spaces, unicode and dots survive byte-for-byte in unsigned URLs', async () => {
  const w = await world();
  const spaced = await asset(w, byPid('samples/people/with space ü'));
  assert.ok(spaced.renditions[0].url.endsWith('/v1700000022/samples/people/with%20space%20%C3%BC.jpg'));
  const dotted = { ...BEACH, public_id: 'samples/a.b/c.d', secure_url: 'https://res.cloudinary.com/yifoe45l/image/upload/v7/samples/a.b/c.d.jpg' };
  const w2 = await world({}, { details: { [BEACH.asset_id]: dotted } });
  assert.ok((await asset(w2, BEACH)).renditions[0].url.endsWith('/v7/samples/a.b/c.d.jpg'));
});

test('CR5: CLOUDINARY_RENDITIONS replaces the defaults; invalid entries fail config validation', async () => {
  const custom = JSON.stringify([{ id: 'hero', label: 'Hero', transformation: 'c_limit,w_1600', width: 1600 }]);
  const a = await asset(await world({ CLOUDINARY_RENDITIONS: custom }), BEACH);
  assert.deepEqual(a.renditions.map((r) => r.id), ['hero', 'original']);
  assert.equal(a.defaultRenditionId, 'hero');
  const { resolveConfig } = await import('../config.js');
  const base = { CLOUDINARY_CLOUD_NAME: 'c' };
  const bad = [
    '[{"id":"x","label":"X","transformation":"c_limit w_1"}]',
    `[{"id":"x","label":"X","transformation":"${'a'.repeat(201)}"}]`,
    JSON.stringify(Array.from({ length: 9 }, (_, i) => ({ id: `r${i}`, label: 'R', transformation: 'w_1' }))),
    '[{"id":"x","label":"X","transformation":"w_1"},{"id":"x","label":"Y","transformation":"w_2"}]',
    '[{"id":"original","label":"X","transformation":"w_1"}]',
    '[{"id":"x","label":"X","transformation":"a/../b"}]',
    'not json', '[]', '{}',
  ];
  bad.forEach((raw) => assert.throws(() => resolveConfig({ ...base, CLOUDINARY_RENDITIONS: raw }), (e) => e.setting === 'CLOUDINARY_RENDITIONS'));
});

test('CR6: signing off -> no s-- component anywhere; the version segment is kept', async () => {
  const w = await world();
  const a = await asset(w, BEACH);
  a.renditions.forEach((r) => assert.ok(!r.url.includes('s--') && r.url.includes('/v1700000011/')));
  const list = (await w.search()).json();
  list.items.forEach((i) => i.thumbnailUrl && assert.ok(!i.thumbnailUrl.includes('s--')));
});

test('CR7: signing on -> signed, version-less transformed URLs; the original is unaltered', async () => {
  const w = await world({ CLOUDINARY_SIGN_URLS: 'true' });
  const a = await asset(w, BEACH);
  a.renditions.filter((r) => r.kind === 'derivative').forEach((r) => {
    assert.match(r.url, SIGNED);
    assert.ok(!/\/v\d+\//.test(r.url));
  });
  assert.equal(a.renditions.find((r) => r.kind === 'original').url, BEACH.secure_url);
  const expected = signature({
    transformation: 'c_limit,w_1200/f_auto/q_auto', tail: 'samples/landscapes/beach-boat.jpg', secret: SECRET,
  });
  assert.equal(a.renditions[0].url, `https://res.cloudinary.com/yifoe45l/image/upload/s--${expected}--/c_limit,w_1200/f_auto/q_auto/samples/landscapes/beach-boat.jpg`);
  const list = (await w.search()).json();
  list.items.filter((i) => i.thumbnailUrl).forEach((i) => assert.match(i.thumbnailUrl, SIGNED));
  const sha256 = await world({ CLOUDINARY_SIGN_URLS: 'true', CLOUDINARY_SIGNATURE_ALGORITHM: 'sha256' });
  const b = await asset(sha256, BEACH);
  assert.notEqual(b.renditions[0].url, a.renditions[0].url);
});

test('CR11: a public ID needing percent-encoding is not insertable when signing is on, allowed when off', async () => {
  const spaced = byPid('samples/people/with space ü');
  const on = await asset(await world({ CLOUDINARY_SIGN_URLS: 'true' }), spaced);
  assert.equal(on.insertable.ok, false);
  assert.ok(on.insertable.reason);
  const off = await asset(await world(), spaced);
  assert.equal(off.insertable.ok, true);
});

test('CR12: the secret, the Basic value and the digest input never appear in any response, header or log', async () => {
  const w = await world({ CLOUDINARY_SIGN_URLS: 'true' });
  const responses = [
    await w.search(), await w.search({ type: 'video' }), await asset(w, BEACH).then(() => w.detail(BEACH.asset_id)),
    await w.detail(byPid('samples/people/with space ü').asset_id), await w.detail('f'.repeat(32)),
    await w.call({ path: '/dam/providers' }),
  ];
  const digestInput = 'c_limit,w_1200/f_auto/q_auto/samples/landscapes/beach-boat.jpg';
  const haystack = [
    ...responses.flatMap((r) => [r.body, JSON.stringify(r.headers)]), w.logs.join('\n'),
  ].join('\n');
  [KEY, SECRET, BASIC, Buffer.from(`${KEY}:${SECRET}`).toString('base64'), `${digestInput}${SECRET}`]
    .forEach((s) => assert.ok(!haystack.includes(s)));
});

test('CR13: thumbnails for image, video poster and PDF page; none for audio and raw; signed when signing is on', async () => {
  const w = await world();
  const items = Object.fromEntries((await w.search({ pageSize: '50' })).json().items.map((i) => [i.name, i]));
  assert.ok(items['beach-boat'].thumbnailUrl.includes('/c_limit,w_320/f_auto/q_auto/'));
  assert.ok(items['sea-turtle'].thumbnailUrl.endsWith('/samples/video/sea-turtle.jpg'));
  assert.ok(items['annual report 2025'].thumbnailUrl.endsWith('/samples/docs/annual%20report%202025.jpg'));
  assert.equal(items['podcast-intro'].thumbnailUrl, undefined);
  assert.equal(items['handbook.docx'].thumbnailUrl, undefined);
  assert.equal(items['brand.ttf'].thumbnailUrl, undefined);
  const signed = await world({ CLOUDINARY_SIGN_URLS: 'true' });
  const s = Object.fromEntries((await signed.search({ pageSize: '50' })).json().items.map((i) => [i.name, i]));
  assert.match(s['sea-turtle'].thumbnailUrl, SIGNED);
  assert.equal(s['annual report 2025'].thumbnailUrl, undefined, 'percent-encoded id cannot be signed');
});

test('CM8: dimensions are min(asset width, rendition width), proportional; missing width -> no dimensions', async () => {
  const a = await asset(await world(), BEACH);
  assert.deepEqual([a.renditions[0].width, a.renditions[0].height], [1200, 800]);
  assert.deepEqual([a.renditions[1].width, a.renditions[1].height], [2000, 1333], 'never upscaled');
  assert.deepEqual([a.renditions[3].width, a.renditions[3].height], [400, 267]);
  const noWidth = { ...BEACH };
  delete noWidth.width;
  const b = await asset(await world({}, { details: { [BEACH.asset_id]: noWidth } }), BEACH);
  assert.ok(b.renditions.every((r) => r.width === undefined && r.height === undefined));
});
