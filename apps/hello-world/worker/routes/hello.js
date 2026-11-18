import { createHmac, randomUUID } from 'node:crypto';
import { HttpError } from '../../../../shared/worker-template/src/index.js';

const MAX_MESSAGE = 256;

export const routes = {
  /** Signs `message` with HELLO_SECRET. Proves a secret is used server-side and never returned. */
  'GET /hello/sign': async ({ request, secret }) => {
    const message = request.query.get('message');
    if (!message || message.length > MAX_MESSAGE) throw new HttpError('bad_request');
    const signature = createHmac('sha256', secret('HELLO_SECRET')).update(message).digest('hex');
    return { message, algorithm: 'HMAC-SHA-256', signature };
  },

  /** Diagnostic: writes and reads back a short-lived value through the store (State when deployed). */
  'GET /hello/state': async ({ store }) => {
    const key = `probe-${randomUUID()}`;
    const value = randomUUID();
    await store.put(key, { value }, { ttlSeconds: 60 });
    const back = await store.get(key);
    await store.delete(key);
    if (back?.value !== value) throw new Error('store round trip failed');
    return { ok: true };
  },
};
