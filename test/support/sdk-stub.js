/**
 * Shared DA App SDK stub, used by unit tests (import-map remap of
 * https://da.live/nx/utils/sdk.js) and e2e tests (page.route fulfils the same file).
 *
 * Shape mirrors the real SDK result: { ready, token, context, actions }.
 * Every action call is recorded as [name, ...args] in `calls`.
 */
export const SDK_URL = 'https://da.live/nx/utils/sdk.js';

export const DEFAULT_CONTEXT = {
  view: 'fullscreen',
  org: 'jazhou-adobe',
  repo: 'ew-extensions',
  ref: 'local',
  path: '/apps/hello-world/hello-world',
};

export function createSdkStub({
  context = DEFAULT_CONTEXT,
  token = 'stub-token',
  calls = [],
} = {}) {
  return {
    ready: true,
    token,
    context,
    actions: {
      sendText: (text) => calls.push(['sendText', text]),
      sendHTML: (html) => calls.push(['sendHTML', html]),
      closeLibrary: () => calls.push(['closeLibrary']),
    },
    calls,
  };
}

/**
 * Default export: a promise like the real SDK. `globalThis.__sdkStub` may carry
 * { context, token, standalone }; `standalone` makes it never resolve (page opened outside EW).
 * Calls are recorded in `globalThis.__sdkCalls`.
 */
const options = globalThis.__sdkStub || {};
globalThis.__sdkCalls = globalThis.__sdkCalls || [];

export default options.standalone
  ? new Promise(() => {})
  : Promise.resolve(createSdkStub({ ...options, calls: globalThis.__sdkCalls }));
