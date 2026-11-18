import { createServer } from 'node:http';

const PLATFORM_LIMIT = 1024 * 1024;
const TEXT = /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded)|[^;]*\+(json|xml))/i;

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('too large'), { tooLarge: true }));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Web-action contract emulator: a `node:http` adapter that mimics the documented I/O Runtime behaviour of a
 * `web: raw` action with `web-custom-options` — raw `__ow_*` params (header names lower-case, JSON and
 * binary request bodies base64, text bodies as strings), OPTIONS reaching the action, `statusCode`/`headers`/`body`
 * results (non-text bodies are base64), 1 MB request and result limits answered by the platform itself
 * (plain error, no action-supplied headers), and a platform-style 502 when the action fails.
 * Inputs are passed as top-level params; callers can never override them.
 *
 * @param {{ main: Function, inputs: object, prefix?: string }} options
 *   prefix: URL path prefix to strip before computing `__ow_path`, e.g. '/api/v1/web/ns/pkg/api'
 */
export async function startEmulator({ main, inputs, prefix = '' }) {
  const server = createServer(async (req, res) => {
    const platformError = (status, message) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: message }));
    };
    let body;
    try {
      body = await readBody(req, PLATFORM_LIMIT);
    } catch (e) {
      if (e.tooLarge) {
        platformError(413, 'The request content length exceeds the limit');
        req.destroy();
        return;
      }
      platformError(400, 'bad request');
      return;
    }
    const url = new URL(req.url, 'http://emulator');
    let path = url.pathname;
    if (prefix && path.startsWith(prefix)) path = path.slice(prefix.length);
    const headers = {};
    Object.entries(req.headers).forEach(([k, v]) => {
      headers[k.toLowerCase()] = Array.isArray(v) ? v.join(',') : v;
    });
    const params = {
      ...inputs,
      __ow_method: req.method.toLowerCase(),
      __ow_headers: headers,
      __ow_path: path,
    };
    if (url.search.length > 1) params.__ow_query = url.search.slice(1);
    if (body.length) {
      const type = headers['content-type'] || '';
      params.__ow_body = /^(text\/|application\/x-www-form-urlencoded)/i.test(type)
        ? body.toString('utf8') : body.toString('base64');
    }
    let result;
    try {
      result = await main(params);
    } catch {
      platformError(502, 'The action did not produce a valid response and exited unexpectedly.');
      return;
    }
    if (!result || typeof result !== 'object' || result.error) {
      platformError(502, 'The action did not produce a valid response.');
      return;
    }
    const resHeaders = result.headers || {};
    const typeEntry = Object.entries(resHeaders).find(([k]) => k.toLowerCase() === 'content-type');
    const type = typeEntry?.[1] || 'application/json';
    const payload = typeof result.body === 'string' && !TEXT.test(type)
      ? Buffer.from(result.body, 'base64')
      : Buffer.from(typeof result.body === 'string' ? result.body : JSON.stringify(result.body ?? ''));
    if (JSON.stringify(result).length > PLATFORM_LIMIT) {
      platformError(502, 'The action produced a response that exceeded the allowed length');
      return;
    }
    res.writeHead(result.statusCode || 200, { 'content-type': type, ...resHeaders });
    res.end(payload);
  });
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    port,
    close: () => new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    }),
  };
}
