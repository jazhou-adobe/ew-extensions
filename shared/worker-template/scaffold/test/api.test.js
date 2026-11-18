import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from '__SHARED__/test-kit/index.js';
import { routes } from '../routes/index.js';

test('whoami returns the verified identity; no token -> 401', async () => {
  const w = await makeWorld({ name: '__EXT__', routes, secrets: ['VENDOR_API_KEY'] });
  const res = await w.call({ path: '/__EXT__/whoami' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().userId, 'user-1@AdobeID');
  assert.equal((await w.call({ path: '/__EXT__/whoami', token: null })).statusCode, 401);
});
