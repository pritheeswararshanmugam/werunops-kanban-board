const { defineConfig, devices } = require('@playwright/test');

const isCI = !!process.env.CI;

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  retries: isCI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: '.\\.venv\\Scripts\\python.exe backend\\scripts\\run_dev.py',
      url: 'http://127.0.0.1:9000/api/v1/health',
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
    {
      command: 'node ./node_modules/http-server/bin/http-server frontend -p 4173 -c-1 --silent',
      url: 'http://127.0.0.1:4173/index.html',
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: 'msedge',
      use: {
        ...devices['Desktop Edge'],
        channel: 'msedge',
      },
    },
  ],
});
