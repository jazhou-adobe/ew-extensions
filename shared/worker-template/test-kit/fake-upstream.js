/**
 * Fake vendor API. `script` is a list of steps replayed in order (the last step repeats):
 *   { status, headers, body, delayMs }   a response
 *   { throws: Error }                    a network failure
 *   { hang: true }                       never answers until the request is aborted
 * Every received request is recorded in `requests` ({ url, method, headers, body }).
 */
export function fakeUpstream(script = [{ status: 200, body: '{}' }]) {
  const steps = Array.isArray(script) ? script : [script];
  const requests = [];
  const upstream = {
    requests,
    get calls() { return requests.length; },
    fetch: async (url, init = {}) => {
      const headers = {};
      Object.entries(init.headers || {}).forEach(([k, v]) => {
        headers[k.toLowerCase()] = v;
      });
      requests.push({
        url: String(url),
        method: init.method || 'GET',
        headers,
        body: init.body === undefined ? undefined : Buffer.from(init.body),
        redirect: init.redirect,
      });
      const step = steps[Math.min(requests.length - 1, steps.length - 1)];
      if (step.throws) throw step.throws;
      if (step.hang) {
        await new Promise((resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      }
      if (step.delayMs) {
        await new Promise((r) => {
          setTimeout(r, step.delayMs);
        });
      }
      return new Response(step.body ?? '', { status: step.status ?? 200, headers: step.headers });
    },
  };
  return upstream;
}
