const { expect } = require('@playwright/test');

async function resetBrowserState(page) {
  await page.goto('/index.html');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
}

async function signIn(page) {
  await page.goto('/index.html');
  await page.fill('#login-username', 'Eshwar');
  await page.fill('#login-password', '110495');
  await page.locator('#login-form button[type="submit"]').click();

  await expect(page.locator('#main-header')).toBeVisible();
  await expect(page.locator('#main-content')).toBeVisible();
}

module.exports = {
  resetBrowserState,
  signIn,
};
