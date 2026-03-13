const { defineConfig, devices } = require('@playwright/test');

const isCI = !!process.env.CI;

module.exports = defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.js',
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: isCI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'copy /Y backend\\data\\state_store.seed.json backend\\data\\state_store.json > NUL && set WERUNOPS_STATE_DRIVER=file && .\\.venv\\Scripts\\python.exe backend\\scripts\\run_dev.py',
      url: 'http://127.0.0.1:9000/api/v1/health',
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: 'node ./node_modules/http-server/bin/http-server frontend -p 4173 -c-1 --silent',
      url: 'http://127.0.0.1:4173/index.html',
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
  projects: [
    {
      name: 'msedge',
      use: {
        ...devices['Desktop Edge'],
        channel: 'msedge',
      },
      testIgnore: ['**/ui.bulk.spec.js', '**/ui.timing.spec.js'],
    },
    {
      name: 'ui-bulk',
      testMatch: ['**/ui.bulk.spec.js'],
      use: {
        ...devices['Desktop Edge'],
        channel: 'msedge',
      },
    },
    {
      name: 'ui-timing',
      testMatch: ['**/ui.timing.spec.js'],
      use: {
        ...devices['Desktop Edge'],
        channel: 'msedge',
      },
    },
    {
      name: 'ui-extended',
      testMatch: ['**/ui.extended.spec.js'],
      use: {
        ...devices['Desktop Edge'],
        channel: 'msedge',
      },
    },
  ],
});
