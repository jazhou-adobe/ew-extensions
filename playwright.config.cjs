const { defineConfig, devices } = require('@playwright/test');

const PORT = process.env.E2E_PORT || '3100';

module.exports = defineConfig({
  testDir: 'apps',
  testMatch: '**/test/e2e/**/*.spec.js',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  webServer: {
    // Plain static server: `aem up` proxies content from the remote origin and needs network/site setup.
    command: 'node scripts/static-server.mjs',
    env: { PORT },
    url: `http://localhost:${PORT}/apps/hello-world/hello-world.html`,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
