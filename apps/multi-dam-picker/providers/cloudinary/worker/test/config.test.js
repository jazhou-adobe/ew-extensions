import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfig } from '../config.js';
import { pickerWorld, cloudInputs } from '../../../../worker/test/support/world.js';
import { stubService } from '../../../../worker/test/support/stubs.js';
import { canary } from '../../../../../../shared/worker-template/test-kit/index.js';

const VALID = {
  CLOUDINARY_CLOUD_NAME: 'yifoe45l',
  CLOUDINARY_ROOT_FOLDER: 'samples/',
  CLOUDINARY_FOLDER_MODE: 'dynamic',
  CLOUDINARY_SIGN_URLS: 'false',
  CLOUDINARY_API_HOST: 'api.cloudinary.com',
  CLOUDINARY_SIGNATURE_ALGORITHM: 'sha1',
  CLOUDINARY_ALT_CONTEXT_FIELD: 'alt',
  CLOUDINARY_CAPTION_CONTEXT_FIELD: 'caption',
  CLOUDINARY_ALT_METADATA_FIELD: '',
  CLOUDINARY_RENDITIONS: '',
  CLOUDINARY_DELIVERY_HOSTS: '',
  CLOUDINARY_CACHE_SECONDS: '30',
};

test('CF4: valid settings pass and resolve to the documented defaults', () => {
  const c = resolveConfig(VALID);
  assert.deepEqual([c.cloudName, c.root, c.folderMode, c.signUrls, c.apiHost, c.cacheSeconds], ['yifoe45l', 'samples', 'dynamic', false, 'api.cloudinary.com', 30]);
  const minimal = resolveConfig({ CLOUDINARY_CLOUD_NAME: 'x' });
  assert.deepEqual([minimal.root, minimal.altContextField, minimal.captionContextField, minimal.altMetadataField, minimal.signatureAlgorithm], ['', 'alt', 'caption', '', 'sha1']);
  assert.deepEqual(resolveConfig({ ...VALID, CLOUDINARY_API_HOST: 'api-ap.cloudinary.com' }).apiHost, 'api-ap.cloudinary.com');
});

test('CF4: invalid values fail naming the setting only; the value never appears in the message', () => {
  const bad = {
    CLOUDINARY_CLOUD_NAME: ['', 'a b', 'x/y', '../x'],
    CLOUDINARY_API_HOST: ['evil.example', 'api.cloudinary.com.evil.example', 'https://api.cloudinary.com'],
    CLOUDINARY_ROOT_FOLDER: ['..', 'a/../b', 'a\u0000b'],
    CLOUDINARY_FOLDER_MODE: ['both', 'DYNAMICALLY'],
    CLOUDINARY_SIGN_URLS: ['yes', '1', 'TRUE '.repeat(2)],
    CLOUDINARY_SIGNATURE_ALGORITHM: ['md5', 'sha512'],
    CLOUDINARY_CACHE_SECONDS: ['-1', 'abc', '1.5', '99999', '3601'],
    CLOUDINARY_DELIVERY_HOSTS: ['https://cdn.example.com', 'cdn.example.com/path', 'localhost', 'cdn.example.com:8080', 'a b.example.com'],
    CLOUDINARY_ALT_CONTEXT_FIELD: ['a b', 'x"y', 'a'.repeat(65)],
    CLOUDINARY_RENDITIONS: ['{bad json', '[]'],
  };
  Object.entries(bad).forEach(([setting, values]) => values.forEach((value) => {
    const canaryValue = `bad "${canary('val')}" \\ *`;
    [value, canaryValue].forEach((v) => {
      try {
        resolveConfig({ ...VALID, [setting]: v });
        assert.fail(`${setting}=${JSON.stringify(v)} should fail`);
      } catch (e) {
        if (e.code === 'ERR_ASSERTION') throw e;
        assert.equal(e.setting, setting);
        assert.ok(e.message.includes(setting));
        assert.ok(!e.message.includes(String(v)) || String(v) === '');
      }
    });
  }));
});

test('CF4: an invalid value is never logged (the action logs the setting name only)', async () => {
  const value = canary('bad-root');
  const w = await pickerWorld({ inputs: { CLOUDINARY_FOLDER_MODE: value } });
  const res = await w.search();
  assert.equal(res.statusCode, 500);
  assert.ok(!res.body.includes(value) && !w.logs.join('\n').includes(value));
  const line = w.logs.map((l) => JSON.parse(l)).find((l) => l.event === 'config_invalid');
  assert.deepEqual([line.provider, line.setting], ['cloudinary', 'CLOUDINARY_FOLDER_MODE']);
});

test('CF5: an empty key or cloud name omits the provider; /dam/providers is 200 and empty; other providers keep working', async () => {
  for (const missing of ['CLOUDINARY_API_KEY', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_SECRET']) {
    const w = await pickerWorld({ inputs: { [missing]: '' } });
    const res = await w.call({ path: '/dam/providers' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { providers: [] });
    assert.equal((await w.search()).statusCode, 404);
  }
  const stub = stubService();
  const w = await pickerWorld({
    providers: [(await import('../index.js')).default, stub],
    inputs: { CLOUDINARY_API_KEY: '', STUBDAM_TENANT: 't1', STUBDAM_TOKEN: canary('stub') },
  });
  assert.deepEqual((await w.call({ path: '/dam/providers' })).json().providers.map((p) => p.id), ['stubdam']);
  assert.equal((await w.call({ path: '/dam/stubdam/assets' })).statusCode, 200);
});

test('CF6: booleans and numbers are accepted as strings and as native values, with identical behaviour', async () => {
  const text = resolveConfig({ CLOUDINARY_CLOUD_NAME: 'x', CLOUDINARY_SIGN_URLS: 'true', CLOUDINARY_CACHE_SECONDS: '45' });
  const native = resolveConfig({ CLOUDINARY_CLOUD_NAME: 'x', CLOUDINARY_SIGN_URLS: true, CLOUDINARY_CACHE_SECONDS: 45 });
  assert.deepEqual(native, text);
  const viaAction = await pickerWorld({ inputs: { CLOUDINARY_SIGN_URLS: true, CLOUDINARY_CACHE_SECONDS: 45 } });
  const res = await viaAction.search();
  assert.equal(res.statusCode, 200);
  assert.ok(res.json().items.find((i) => i.thumbnailUrl).thumbnailUrl.includes('/s--'));
  assert.equal(viaAction.store.puts[0].ttl, 45);
});

test('the test environment inputs match the documented non-secret values', () => {
  assert.equal(cloudInputs().CLOUDINARY_CLOUD_NAME, 'yifoe45l');
});
