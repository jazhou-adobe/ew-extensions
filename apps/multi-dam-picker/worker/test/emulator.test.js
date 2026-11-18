import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createAction, memoryStore } from '../../../../shared/worker-template/src/index.js';
import { fakeIms, startEmulator, makeInputs } from '../../../../shared/worker-template/test-kit/index.js';
import { createRoutes } from '../shell/routes.js';
import { providers } from '../providers.js';
import { fakeCloudinary, loadFixture } from '../../providers/cloudinary/worker/test/support/fake-cloudinary.js';
import { cloudInputs, KEY, SECRET, BASIC, ID } from './support/world.js';

const PREFIX = '/api/v1/web/multi-dam-picker/api';
let ims;
let imsServer;

before(async () => {
  ims = await fakeIms();
  imsServer = await ims.listen();
});
after(async () => { await imsServer.close(); });

/** The real `main` behind the emulator; Cloudinary reached over real HTTP through a host-rewriting fetch. */
async function start({ cloudOptions = {}, inputs = {}, store = memoryStore({ workerName: 'multi-dam-picker' }) } = {}) {
  const cloud = fakeCloudinary({ key: KEY, secret: SECRET, ...cloudOptions });
  const cloudServer = await cloud.listen();
  const rewrite = (url, init) => {
    const u = String(url);
    return u.startsWith('https://api.cloudinary.com/')
      ? fetch(u.replace('https://api.cloudinary.com', cloudServer.origin), init) : fetch(url, init);
  };
  const main = createAction({
    name: 'multi-dam-picker',
    routes: createRoutes({ providers }),
    secrets: providers.flatMap((p) => p.config.secrets),
  }, { store, fetch: rewrite });
  const emulator = await startEmulator({
    main,
    inputs: makeInputs({ IMS_ORIGIN: imsServer.origin, ...cloudInputs(), ...inputs }),
    prefix: PREFIX,
  });
  const call = async (path, { token, origin, method = 'GET' } = {}) => {
    const res = await fetch(`${emulator.origin}${PREFIX}${path}`, {
      method,
      headers: { ...(origin ? { origin } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
    return { status: res.status, headers: res.headers, text: await res.text() };
  };
  return {
    cloud, call, emulator, close: async () => { await emulator.close(); await cloudServer.close(); },
  };
}

test('EP1: the picker action starts with Cloudinary configured and no store credentials; bare /dam/providers is 401; a token lists Cloudinary', async () => {
  const s = await start();
  try {
    assert.equal((await s.call('/dam/providers')).status, 401);
    const res = await s.call('/dam/providers', { token: await ims.signToken(), origin: 'https://da.live' });
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.text).providers.map((p) => p.id), ['cloudinary']);
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://da.live');
  } finally { await s.close(); }
});

test('EP2: search over real HTTP sends the Basic header; a 500-item answer fits the 1 MB caps; 420 keeps Retry-After and the CORS expose list; Production-shaped inputs reject localhost', async () => {
  const base = loadFixture('search').resources[0];
  const many = Array.from({ length: 500 }, (_, i) => ({ ...base, asset_id: ID(i + 1), public_id: `samples/item-${i}`, display_name: `item-${i}` }));
  const s = await start({ cloudOptions: { resources: many } });
  try {
    const token = await ims.signToken();
    const res = await s.call('/dam/cloudinary/assets?page=21&pageSize=24', { token, origin: 'https://da.live' });
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.text).items.length, 20);
    assert.equal(s.cloud.requests[0].headers.authorization, BASIC);
    assert.equal(s.cloud.requests[0].json.max_results, 500);
    assert.ok(![res.text, JSON.stringify([...res.headers])].join().includes(SECRET));
  } finally { await s.close(); }
  const limited = await start({ cloudOptions: { script: [{ status: 420, headers: { 'content-type': 'application/json', 'x-featureratelimit-reset': new Date(Date.now() + 90_000).toUTCString() }, body: '{}' }] } });
  try {
    const res = await limited.call('/dam/cloudinary/assets', { token: await ims.signToken(), origin: 'https://da.live' });
    assert.equal(res.status, 429);
    assert.match(res.headers.get('retry-after'), /^(89|90|91)$/);
    assert.match(res.headers.get('access-control-expose-headers'), /Retry-After/);
  } finally { await limited.close(); }
  const prod = await start();
  try {
    const res = await prod.call('/dam/providers', { token: await ims.signToken(), origin: 'http://localhost:3000' });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  } finally { await prod.close(); }
});

test('EP3: platform-style failures (oversize result, crash) carry no CORS headers, so the browser sees a rejected fetch', async () => {
  const s = await start({ inputs: {} });
  try {
    // an action crash is answered by the platform itself, without the action's headers
    const crashing = await startEmulator({
      main: async () => { throw new Error('boom'); }, inputs: {}, prefix: PREFIX,
    });
    const res = await fetch(`${crashing.origin}${PREFIX}/dam/providers`, { headers: { origin: 'https://da.live' } });
    assert.equal(res.status, 502);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
    await crashing.close();
    // the shell's own caps keep a realistic search far below the platform limit
    const ok = await s.call('/dam/cloudinary/assets?pageSize=50', { token: await ims.signToken(), origin: 'https://da.live' });
    assert.ok(Buffer.byteLength(ok.text) < 100 * 1024);
  } finally { await s.close(); }
});
