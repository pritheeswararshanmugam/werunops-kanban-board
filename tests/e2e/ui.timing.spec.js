const { test, expect } = require('@playwright/test');
const { resetBrowserState, signIn } = require('./ui.helpers');

test.beforeEach(async ({ page }) => {
  await resetBrowserState(page);
});

test('timing coverage for presence and dashboard refresh intervals', async ({ page }) => {
  test.setTimeout(120_000);

  let presenceHits = 0;
  let metricsHits = 0;

  page.on('request', (req) => {
    const url = req.url();
    if (req.method() === 'PUT' && url.includes('/api/v1/presence/me')) {
      presenceHits += 1;
    }
    if (req.method() === 'GET' && url.includes('/api/v1/dashboard/metrics')) {
      metricsHits += 1;
    }
  });

  await signIn(page);
  await page.locator('.nav-tab[data-target="view-dashboard"]').click();
  await expect(page.locator('#view-dashboard')).toBeVisible();

  await expect
    .poll(() => presenceHits, {
      timeout: 15_000,
      intervals: [500, 1000, 2000],
    })
    .toBeGreaterThanOrEqual(1);

  await page.waitForTimeout(22_000);
  expect(presenceHits).toBeGreaterThanOrEqual(2);

  const beforeManualRefresh = metricsHits;
  await page.click('#refresh-dashboard-btn');
  await page.waitForTimeout(1_500);
  expect(metricsHits).toBeGreaterThanOrEqual(beforeManualRefresh + 1);
});
