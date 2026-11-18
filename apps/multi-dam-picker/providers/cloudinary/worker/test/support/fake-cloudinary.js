// Fake Cloudinary Admin API (test double). Checks the Basic credential, records every request (method, path, headers,
// JSON body), answers `resources/search` and `resources/{asset_id}` from a resource list, and can replay scripted
// responses (rate limits, HTML error pages, malformed bodies, network failures) in front of the default behaviour.
// Usable as an injected `fetch` (layered like `fakeUpstream`) or as a real HTTP server for e2e and the emulator tier.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FIXTURES = fileURLToPath(new URL('../../fixtures/', import.meta.url));

export const loadFixture = (name) => JSON.parse(readFileSync(`${FIXTURES}${name}.json`, 'utf8'));

const AUDIO = ['mp3', 'wav', 'aac', 'flac', 'ogg', 'oga', 'm4a', 'opus', 'aiff', 'aif', 'amr', 'wma'];

function typeOf(row) {
  if (row.resource_type === 'image') return row.format === 'pdf' ? 'document' : 'image';
  if (row.resource_type === 'video') return AUDIO.includes(row.format) ? 'audio' : 'video';
  return 'document';
}

/** Very small evaluator for the expressions this worker builds: root clause, type clause and quoted keywords. */
const folderOf = (r) => r.asset_folder ?? r.folder ?? (r.public_id.includes('/') ? r.public_id.slice(0, r.public_id.lastIndexOf('/')) : '');

function filterRows(all, expression) {
  // Non-object rows are passed through untouched so tests can feed junk to the mapper.
  const junk = all.filter((r) => r === null || typeof r !== 'object');
  const rows = all.filter((r) => r !== null && typeof r === 'object' && typeof r.public_id === 'string');
  let out = rows;
  const root = /\((?:asset_folder|folder)=("?)([^"\s)]+)\1 OR /.exec(expression)?.[2];
  if (root) out = out.filter((r) => folderOf(r) === root || folderOf(r).startsWith(`${root}/`));
  const quotedExpr = expression.replace(/"[^"]*"/g, '""');
  let kind;
  if (quotedExpr.includes('resource_type=video AND NOT (')) kind = 'video';
  else if (quotedExpr.includes('resource_type=video AND (')) kind = 'audio';
  else if (quotedExpr.includes('resource_type=image AND NOT format=pdf')) kind = 'image';
  else if (quotedExpr.includes('resource_type=raw')) kind = 'document';
  if (kind) out = out.filter((r) => typeOf(r) === kind);
  const words = [...expression.matchAll(/"([^"]+)"/g)].map((m) => m[1].toLowerCase())
    .filter((w) => !root || !expression.includes(`"${root}`) || w !== root.toLowerCase());
  words.forEach((w) => {
    out = out.filter((r) => `${r.public_id} ${r.display_name ?? ''}`.toLowerCase().includes(w));
  });
  return [...out, ...junk];
}

/**
 * @param {{ cloudName?: string, key: string, secret: string, resources?: object[], details?: object,
 *           script?: object[], rateLimit?: object, now?: () => number }} options
 *   script: steps replayed in order (the last one repeats) before the default behaviour: `{ status, headers, body }`,
 *           `{ throws }`, `{ hang }`, or `{ pass: true }` to fall through to the default answer.
 *   details: asset_id -> detail response (defaults to the matching search row).
 */
export function fakeCloudinary({
  cloudName = 'yifoe45l', key, secret, resources = loadFixture('search').resources, details = {}, script = [],
  rateLimit = {}, now = Date.now,
}) {
  const requests = [];
  const expected = `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`;
  const state = {
    limit: rateLimit.limit ?? 500, remaining: rateLimit.remaining ?? 480, resetAt: rateLimit.resetAt,
  };

  const rateHeaders = () => ({
    'x-featureratelimit-limit': String(state.limit),
    'x-featureratelimit-remaining': String(state.remaining),
    'x-featureratelimit-reset': new Date(state.resetAt ?? now() + 3600_000).toUTCString(),
  });
  const json = (status, body, extra = {}) => ({
    status, headers: { 'content-type': 'application/json', ...rateHeaders(), ...extra }, body: JSON.stringify(body),
  });

  const pick = (row, fields) => (Array.isArray(fields) && row !== null && typeof row === 'object'
    ? Object.fromEntries(Object.entries(row).filter(([k]) => fields.includes(k))) : row);

  function respond(req) {
    const url = new URL(req.url);
    const prefix = `/v1_1/${cloudName}/`;
    if (req.headers.authorization !== expected) {
      return { status: 401, headers: { 'content-type': 'text/html' }, body: '<html><body>401 Unauthorized</body></html>' };
    }
    if (!url.pathname.startsWith(prefix)) return json(404, { error: { message: 'Invalid cloud_name' } });
    const path = url.pathname.slice(prefix.length);
    if (path === 'resources/search') {
      if (req.method !== 'POST' || !/application\/json/.test(req.headers['content-type'] || '')) {
        return json(400, { error: { message: 'bad request' } });
      }
      state.remaining = Math.max(0, state.remaining - 1);
      const body = req.json;
      const matched = filterRows(resources, body.expression || '');
      const rows = matched.slice(0, body.max_results ?? 50);
      return json(200, { total_count: matched.length, time: 10, resources: rows.map((r) => pick(r, body.fields)) });
    }
    const m = /^resources\/([0-9a-f]{32})$/.exec(path);
    if (m && req.method === 'GET') {
      state.remaining = Math.max(0, state.remaining - 1);
      const found = details[m[1]] ?? resources.find((r) => r.asset_id === m[1]);
      return found ? json(200, found) : json(404, { error: { message: 'Resource not found' } });
    }
    return json(404, { error: { message: 'not found' } });
  }

  async function handle(req, signal) {
    requests.push(req);
    const step = script.length ? script[Math.min(requests.length - 1, script.length - 1)] : undefined;
    if (step && !step.pass) {
      if (step.throws) throw step.throws;
      if (step.hang) {
        await new Promise((resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      }
      if (step.delayMs) await new Promise((r) => { setTimeout(r, step.delayMs); });
      return {
        status: step.status ?? 200,
        headers: step.headers ?? { 'content-type': 'application/json' },
        body: step.body ?? '{}',
      };
    }
    return respond(req);
  }

  const double = {
    requests,
    get calls() { return requests.length; },
    /** Injected `fetch` (compatible with the template's test kit). */
    fetch: async (url, init = {}) => {
      const headers = {};
      Object.entries(init.headers || {}).forEach(([k, v]) => { headers[k.toLowerCase()] = v; });
      const raw = init.body === undefined ? undefined : Buffer.from(init.body);
      let parsed;
      try {
        parsed = raw ? JSON.parse(raw.toString('utf8')) : undefined;
      } catch {
        parsed = undefined;
      }
      const req = {
        url: String(url), method: init.method || 'GET', headers, body: raw, json: parsed, redirect: init.redirect,
      };
      const out = await handle(req, init.signal);
      return new Response(out.body, { status: out.status, headers: out.headers });
    },
    /** Real HTTP server on a random localhost port; the worker's API host is overridden to reach it. */
    async listen() {
      const server = createServer(async (incoming, res) => {
        const chunks = [];
        incoming.on('data', (c) => chunks.push(c));
        incoming.on('end', async () => {
          const raw = Buffer.concat(chunks);
          let parsed;
          try {
            parsed = raw.length ? JSON.parse(raw.toString('utf8')) : undefined;
          } catch {
            parsed = undefined;
          }
          const headers = {};
          Object.entries(incoming.headers).forEach(([k, v]) => { headers[k.toLowerCase()] = String(v); });
          try {
            const out = await handle({
              url: `http://127.0.0.1${incoming.url}`,
              method: incoming.method,
              headers,
              body: raw.length ? raw : undefined,
              json: parsed,
            });
            res.writeHead(out.status, out.headers);
            res.end(out.body);
          } catch {
            res.destroy();
          }
        });
      });
      await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
      return {
        origin: `http://127.0.0.1:${server.address().port}`,
        host: '127.0.0.1',
        port: server.address().port,
        close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }),
      };
    },
  };
  return double;
}
