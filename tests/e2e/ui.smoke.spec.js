const { test, expect } = require('@playwright/test');

async function signIn(page) {
  await page.goto('/index.html');
  await page.fill('#login-username', 'Eshwar');
  await page.fill('#login-password', '110495');
  await page.locator('#login-form button[type="submit"]').click();

  await expect(page.locator('#main-header')).toBeVisible();
  await expect(page.locator('#main-content')).toBeVisible();
  await expect(page.locator('#header-user-name')).toContainText('Pritheeswarar');
}

async function selectFirstAvailableOption(page, selectSelector) {
  const value = await page.evaluate((selector) => {
    const select = document.querySelector(selector);
    if (!select) return null;
    const options = Array.from(select.options || []);
    const first = options.find((option) => option.value && !option.disabled);
    return first ? first.value : null;
  }, selectSelector);

  if (!value) {
    throw new Error(`No available option found for ${selectSelector}`);
  }

  await page.selectOption(selectSelector, value);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
});

test('user can sign in and land on dashboard', async ({ page }) => {
  await signIn(page);
  await expect(page.locator('#view-dashboard h2')).toHaveText('Dashboard');
});

test('user can create task from all tasks view', async ({ page }) => {
  const taskName = `Playwright E2E ${Date.now()}`;
  const dueDate = new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0];

  await signIn(page);

  await page.locator('.nav-tab[data-target="view-tasks"]').click();
  await expect(page.locator('#view-tasks')).toBeVisible();

  await page.locator('#view-tasks .btn-add-task').first().click();
  await expect(page.locator('#modal-task')).toBeVisible();

  await selectFirstAvailableOption(page, '#task-client');
  await page.fill('#task-project', 'E2E Project');
  await page.fill('#task-name', taskName);
  await selectFirstAvailableOption(page, '#task-staff');
  await page.fill('#task-due-date', dueDate);

  await page.click('#btn-save-task');

  await expect(page.locator('#modal-task')).toBeHidden();
  await page.fill('#tasks-search', taskName);
  await expect(page.locator('#tasks-table-body')).toContainText(taskName);
});
