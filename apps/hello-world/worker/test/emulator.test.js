import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createAction, memoryStore } from '../../../../shared/worker-template/src/index.js';
import {
  fakeIms, startEmulator, makeInputs, canary,
} from '../../../../shared/worker-template/test-kit/index.js';
import { routes } from '../routes/hello.js';

const SECRET = canary();
let ims;
let imsServer;
let emulator;

before(async () => {
  ims = await fakeIms();
  imsServer = await ims.listen();
  const main = createAction({ name: 'hello-world', routes, secrets: ['HELLO_SECRET'] }, { store: memoryStore({ workerName: 'hello-world' }) });
  emulator = await startEmulator({
    main,
    inputs: makeInputs({ IMS_ORIGIN: imsServer.origin, HELLO_SECRET: SECRET }),
    prefix: '/api/v1/web/hello-world/api',
  });
});

after(async () => {
  await emulator.close();
  await imsServer.close();
});

const call = async (path, { token, origin, method = 'GET' } = {}) => {
  const res = await fetch(`${emulator.origin}/api/v1/web/hello-world/api${path}`, {
    method,
    headers: { ...(origin ? { origin } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  return { status: res.status, headers: res.headers, text: await res.text() };
};

test('EM1: the hello action answers a bare request with 401', async () => {
  const res = await call('/hello/sign?message=x');
  assert.equal(res.status, 401);
});

test('EM2: a valid token yields the independently computed signature; preflight behaves as in UC4/UC5', async () => {
  const res = await call('/hello/sign?message=hello%20world', { token: await ims.signToken(), origin: 'https://da.live' });
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.text).signature, createHmac('sha256', SECRET).update('hello world').digest('hex'));
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://da.live');
  const pre = await call('/hello/sign', { method: 'OPTIONS', origin: 'https://da.live' });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), 'https://da.live');
  const evil = await call('/hello/sign', { method: 'OPTIONS', origin: 'https://evil.example' });
  assert.equal(evil.status, 403);
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
});

test('EM4: the hello secret never appears in any response', async () => {
  const token = await ims.signToken();
  const all = await Promise.all([
    call('/hello/sign?message=a', { token, origin: 'https://da.live' }),
    call('/hello/sign', { token, origin: 'https://da.live' }),
    call('/hello/sign?message=a'),
    call('/hello/state', { token }),
  ]);
  all.forEach((r) => assert.ok(!r.text.includes(SECRET) && ![...r.headers.values()].some((v) => v.includes(SECRET))));
  assert.deepEqual(JSON.parse(all[3].text), { ok: true });
});
