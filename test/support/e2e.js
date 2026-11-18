import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { SDK_URL } from './sdk-stub.js';

const stubSource = await readFile(fileURLToPath(new URL('./sdk-stub.js', import.meta.url)), 'utf8');

/**
 * Hermetic page setup: seeds the SDK stub, serves it for the real SDK URL, aborts every other
 * external request. Returns `requests` (external URLs attempted) and `getCalls()` (SDK action log).
 */
export async function stubSdk(page, { context, token, standalone } = {}) {
  const external = [];
  await page.addInitScript((opts) => {
    window.__sdkStub = opts;
  }, { context, token, standalone });
  await page.route(/^https?:\/\/(?!localhost[:/])/, (route) => {
    const url = route.request().url();
    external.push(url);
    if (url === SDK_URL) {
      return route.fulfill({ contentType: 'text/javascript', body: stubSource });
    }
    return route.abort();
  });
  return {
    external,
    getCalls: () => page.evaluate(() => window.__sdkCalls),
  };
}
