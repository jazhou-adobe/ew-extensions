import { playwrightLauncher } from '@web/test-runner-playwright';

const SDK_URL = 'https://da.live/nx/utils/sdk.js';

// Fails any test that reaches for an external URL (tests must be hermetic).
const fetchGuard = `
  <script>
    const realFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url, window.location.href);
      if (url.origin !== window.location.origin) {
        return Promise.reject(new Error('external fetch disallowed: ' + url.href));
      }
      return realFetch(input, init);
    };
  </script>`;

const importMap = `
  <script type="importmap">
    { "imports": { "${SDK_URL}": "/test/support/sdk-stub.js" } }
  </script>`;

export default {
  nodeResolve: true,
  rootDir: '.',
  files: ['apps/*/test/unit/**/*.test.js', 'test/unit/**/*.test.js'],
  browsers: [playwrightLauncher({
    product: 'chromium',
    launchOptions: { args: process.env.CI ? ['--no-sandbox'] : [] },
  })],
  testRunnerHtml: (testFramework) => `<!DOCTYPE html>
<html>
  <head>${importMap}${fetchGuard}</head>
  <body><script type="module" src="${testFramework}"></script></body>
</html>`,
  testsFinishTimeout: 60000,
  testFramework: { config: { timeout: 5000 } },
};
