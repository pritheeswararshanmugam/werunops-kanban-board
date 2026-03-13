const { expect } = require('@playwright/test');

async function resetBrowserState(page) {
  const resetResponse = await page.request.post('http://127.0.0.1:9000/api/v1/testing/reset-state');
  expect(resetResponse.ok()).toBeTruthy();

  await page.goto('/index.html');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
}

async function waitForNotificationsToClear(page) {
  try {
    await expect(page.locator('#notification-container .pointer-events-auto')).toHaveCount(0, {
      timeout: 10_000,
    });
  } catch {
    // Toasts are non-blocking for most flows; continue even if one lingers.
  }
}

async function signIn(page) {
  await page.goto('/index.html');
  await expect(page.locator('#login-form')).toBeVisible();
  await page.fill('#login-username', 'Eshwar');
  await page.fill('#login-password', '110495');
  await page.locator('#login-form button[type="submit"]').click();

  const mainHeader = page.locator('#main-header');
  try {
    await expect(mainHeader).toBeVisible({ timeout: 20_000 });
  } catch {
    const submitButton = page.locator('#login-form button[type="submit"]');
    if (await submitButton.isVisible()) {
      await submitButton.click();
    }
    await expect(mainHeader).toBeVisible({ timeout: 20_000 });
  }

  await expect(page.locator('#main-content')).toBeVisible();
}

module.exports = {
  resetBrowserState,
  signIn,
  waitForNotificationsToClear,
};
