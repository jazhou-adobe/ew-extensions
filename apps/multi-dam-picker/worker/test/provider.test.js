import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRegistry, validateProvider } from '../shell/provider.js';
import { stubOAuth, stubService } from './support/stubs.js';
import { pickerWorld } from './support/world.js';
import cloudinary from '../../providers/cloudinary/worker/index.js';
import { canary } from '../../../../shared/worker-template/test-kit/index.js';

const stubInputs = { STUBDAM_TENANT: 't1', STUBDAM_TOKEN: canary('stub') };

const MEMBERS = ['label', 'credentialKind', 'assetTypes', 'sorts', 'defaultSort', 'window', 'assetIdPattern',
  'outboundHosts', 'deliveryHosts', 'cacheSeconds', 'fingerprint', 'config', 'search', 'getAsset'];

test('PC1: a provider missing any required member fails the build naming the provider and member; a complete one registers', () => {
  MEMBERS.forEach((member) => {
    const p = stubService();
    delete p[member];
    assert.throws(() => buildRegistry([p]), (e) => e.message.includes('"stubdam"') && e.message.includes(`"${member}"`), member);
  });
  ['scopes', 'buildAuthorizeUrl', 'exchangeCode', 'refresh', 'accountName'].forEach((member) => {
    const p = stubOAuth();
    delete p[member];
    assert.throws(() => validateProvider(p), (e) => e.message.includes('"oauthdam"') && e.message.includes(`"${member}"`), member);
  });
  assert.equal(buildRegistry([stubService(), cloudinary]).size, 2);
});

test('PC1: the action answers 500 misconfigured after authentication when the registry is invalid', async () => {
  const broken = stubService();
  delete broken.search;
  const w = await pickerWorld({ providers: [broken], inputs: stubInputs });
  const res = await w.call({ path: '/dam/providers' });
  assert.equal(res.statusCode, 500);
  assert.equal(res.json().error.code, 'misconfigured');
  assert.equal((await w.call({ path: '/dam/providers', token: null })).statusCode, 401);
  assert.ok(w.logs.some((l) => l.includes('registry_invalid') && l.includes('missing member')));
});

test('PC2: malformed id, pattern, duplicates, empty types, bad default sort and too small a window throw', () => {
  const bad = [
    { id: 'Bad Id' }, { id: '' }, { id: '__proto__' }, { id: '1abc' }, { id: 'x'.repeat(40) },
    { assetIdPattern: /x/ }, { assetIdPattern: 'x' }, { assetIdPattern: /^x$/g },
    { assetTypes: [] }, { assetTypes: ['image', 'image'] }, { assetTypes: ['spreadsheet'] },
    { defaultSort: 'missing' }, { defaultSort: 'rel' }, { sorts: [] },
    { sorts: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }] },
    { window: 10 }, { window: 'many' }, { credentialKind: 'magic' },
  ];
  bad.forEach((o) => assert.throws(() => buildRegistry([stubService(o)]), Error, JSON.stringify(o)));
  assert.throws(() => buildRegistry([stubService(), stubService()]), /duplicate id/);
});

test('PC5: user-oauth is defined but not hosted: complete -> "not hosted", incomplete -> names the member; no OAuth route exists', async () => {
  assert.doesNotThrow(() => validateProvider(stubOAuth()));
  assert.throws(() => buildRegistry([stubOAuth()]), /credential kind not hosted by this build/);
  const incomplete = stubOAuth();
  delete incomplete.refresh;
  assert.throws(() => buildRegistry([incomplete]), /missing member "refresh"/);
  assert.doesNotThrow(() => buildRegistry([stubOAuth()], { hostedKinds: ['service', 'user-oauth'] }));
  const w = await pickerWorld({ providers: [stubService(), stubOAuth()], inputs: stubInputs });
  assert.equal((await w.call({ path: '/dam/providers' })).statusCode, 500, 'the build refuses to host it');
  const live = await pickerWorld({ inputs: stubInputs });
  const reserved = ['/dam/cloudinary/connect', '/dam/cloudinary/session', '/dam/cloudinary/disconnect', '/oauth/cloudinary/begin', '/oauth/cloudinary/callback'];
  for (const path of reserved) {
    assert.equal((await live.call({ path, token: null })).statusCode, 401, path);
    assert.equal((await live.call({ path })).statusCode, 404, path);
    assert.equal((await live.call({ path, method: 'POST' })).statusCode, path.startsWith('/dam') ? 405 : 404, path);
  }
  assert.equal(live.store.entries.size, 0, 'no token store or cookie is created');
});
