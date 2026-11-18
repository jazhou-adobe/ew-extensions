import { createSdkStub } from '../../../../test/support/sdk-stub.js';
import { mountPicker } from '../../multi-dam-picker-render.js';
import { WORKERS } from '../../config.js';

export const STAGE = WORKERS.stage;

/** Lets promise chains and microtasks settle. */
export const flush = async (n = 4) => {
  for (let i = 0; i < n; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => { setTimeout(r, 0); });
  }
};

/** Manual clock standing in for window timers. */
export function fakeTimers() {
  let now = 0;
  let seq = 0;
  const pending = new Map();
  return {
    setTimeout(fn, ms) {
      seq += 1;
      pending.set(seq, { at: now + ms, fn });
      return seq;
    },
    clearTimeout(id) { pending.delete(id); },
    get pending() { return pending.size; },
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        const due = [...pending.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at;
        pending.delete(due[0]);
        due[1].fn();
        // eslint-disable-next-line no-await-in-loop
        await flush();
      }
      now = target;
      await flush();
    },
  };
}

export const json = (status, body, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', ...headers },
});

export const ID = (n) => n.toString(16).padStart(32, '0');

export const item = (n, extra = {}) => ({
  id: ID(n), provider: 'cloudinary', name: `asset-${n}`, type: 'image', warnings: [], ...extra,
});

export const caps = (extra = {}) => ({
  assetTypes: ['image', 'video', 'document', 'audio'],
  sorts: [
    { id: 'newest', label: 'Newest', requiresQuery: false },
    { id: 'oldest', label: 'Oldest', requiresQuery: false },
    { id: 'relevance', label: 'Relevance', requiresQuery: true },
  ],
  defaultSort: 'newest',
  window: 500,
  pageSize: { default: 24, max: 50 },
  ...extra,
});

export const provider = (extra = {}) => ({
  id: 'cloudinary', label: 'Cloudinary', credentialKind: 'service', connection: { state: 'connected' }, capabilities: caps(), ...extra,
});

export const IMAGE = (extra = {}) => ({
  ...item(1, { width: 2000, height: 1333, extension: 'jpg' }),
  tags: [],
  alt: { value: 'A boat on a beach', source: 'property' },
  renditions: [
    {
      id: 'web', label: 'Web, up to 1200 px', url: 'https://cdn.example.com/web.jpg', kind: 'derivative', width: 1200, height: 800,
    },
    {
      id: 'small', label: 'Small, up to 400 px', url: 'https://cdn.example.com/small.jpg', kind: 'derivative', width: 400, height: 267,
    },
  ],
  defaultRenditionId: 'web',
  insertable: { ok: true },
  ...extra,
});

/**
 * A scripted worker: `respond(path, init)` returns a Response (or a promise of one). Every call is recorded with its
 * path, query and Authorization header.
 */
export function fakeWorker(respond) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const call = {
      url: String(url),
      path: u.pathname.replace(/^\/api\/v1\/web\/multi-dam-picker\/api/, ''),
      query: Object.fromEntries(u.searchParams),
      authorization: init.headers?.authorization,
      signal: init.signal,
    };
    calls.push(call);
    return respond(call, init);
  };
  return { calls, fetchImpl, searches: () => calls.filter((c) => /^\/dam\/[^/]+\/assets$/.test(c.path)) };
}

/** Mounts the picker with a stub SDK; returns the root, the recorded SDK calls and helpers. */
export async function mount({
  worker, token = 'sdk-token-xyz', hostname = 'localhost', timers = fakeTimers(), standalone = false, ...options
}) {
  const root = document.createElement('main');
  document.body.append(root);
  const sdk = createSdkStub({ token });
  const sdkPromise = standalone ? new Promise(() => {}) : Promise.resolve(sdk);
  const done = mountPicker(root, sdkPromise, {
    fetchImpl: worker.fetchImpl, hostname, timers, timeoutMs: 5000, ...options,
  });
  if (standalone) {
    await flush();
    await timers.advance(5000);
  }
  await done;
  await flush();
  return {
    root,
    sdk,
    timers,
    flush,
    $: (selector) => root.querySelector(selector),
    $$: (selector) => [...root.querySelectorAll(selector)],
    byText: (tag, text) => [...root.querySelectorAll(tag)].find((n) => n.textContent.includes(text)),
    type(value) {
      const input = root.querySelector('input[type=search]');
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    },
  };
}
