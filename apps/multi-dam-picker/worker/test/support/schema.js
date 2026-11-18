// Strict wire-contract checks shared by the conformance suite and the shell tests (SPEC D13).
import assert from 'node:assert/strict';

const TYPES = ['image', 'video', 'document', 'audio', 'other'];
const SUMMARY_KEYS = ['id', 'provider', 'name', 'type', 'thumbnailUrl', 'width', 'height', 'extension', 'fileSize', 'dateModified', 'warnings'];
const DETAIL_KEYS = [...SUMMARY_KEYS, 'description', 'tags', 'copyright', 'alt', 'renditions', 'defaultRenditionId', 'insertable', 'linkUrl'];

const onlyKeys = (obj, allowed) => Object.keys(obj).forEach((k) => assert.ok(allowed.includes(k), `unexpected key ${k}`));
const httpsUrl = (u) => assert.equal(new URL(u).protocol, 'https:', u);

export function assertSummary(item, { provider, idPattern }) {
  onlyKeys(item, SUMMARY_KEYS);
  ['id', 'provider', 'name', 'type', 'warnings'].forEach((k) => assert.ok(k in item, `missing ${k}`));
  assert.match(item.id, idPattern);
  assert.equal(item.provider, provider);
  assert.ok(TYPES.includes(item.type));
  assert.ok(Array.isArray(item.warnings));
  if (item.thumbnailUrl !== undefined) {
    if (item.thumbnailUrl.startsWith('data:')) assert.match(item.thumbnailUrl, /^data:image\/(jpeg|png|webp);base64,/);
    else httpsUrl(item.thumbnailUrl);
  }
  ['width', 'height', 'fileSize'].forEach((k) => item[k] === undefined || assert.ok(Number.isInteger(item[k]) && item[k] >= 0));
}

export function assertDetail(asset, ctx) {
  onlyKeys(asset, DETAIL_KEYS);
  assertSummary(Object.fromEntries(Object.entries(asset).filter(([k]) => SUMMARY_KEYS.includes(k))), ctx);
  assert.ok(['property', 'description', 'name', 'none'].includes(asset.alt.source));
  assert.equal(typeof asset.alt.value, 'string');
  assert.equal(typeof asset.insertable.ok, 'boolean');
  if (!asset.insertable.ok) assert.equal(typeof asset.insertable.reason, 'string');
  assert.ok(Array.isArray(asset.renditions));
  asset.renditions.forEach((r) => {
    onlyKeys(r, ['id', 'label', 'url', 'kind', 'width', 'height']);
    httpsUrl(r.url);
    assert.ok(['derivative', 'original'].includes(r.kind));
  });
  if (asset.renditions.length) assert.ok(asset.renditions.some((r) => r.id === asset.defaultRenditionId));
  if (asset.linkUrl !== undefined) httpsUrl(asset.linkUrl);
  if (asset.insertable.ok) assert.ok(asset.renditions.length || asset.linkUrl);
}
