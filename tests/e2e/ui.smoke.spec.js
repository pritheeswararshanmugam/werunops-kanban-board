const { test, expect } = require('@playwright/test');
const { resetBrowserState, signIn, waitForNotificationsToClear } = require('./ui.helpers');

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
  await resetBrowserState(page);
});

test('user can sign in and land on dashboard', async ({ page }) => {
  await signIn(page);
  await expect(page.locator('#header-user-name')).toContainText('Pritheeswarar');
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
  await waitForNotificationsToClear(page);
  await expect(page.locator('#modal-task')).toBeHidden({ timeout: 30_000 });
  await page.fill('#tasks-search', taskName);
  const taskRow = page.locator('#tasks-table-body tr', { hasText: taskName }).first();
  await expect(taskRow).toBeVisible();

  const taskIdText = await taskRow.locator('td:nth-child(2)').innerText();
  const taskId = Number(taskIdText.replace('#', '').trim());
  await page.evaluate(() => {
    window.confirm = () => true;
  });
  await page.evaluate((id) => window.deleteSingleTask(id), taskId);
  await expect(page.locator('#tasks-table-body')).not.toContainText(taskName);
});

test('full end-to-end flow: add and remove client and task', async ({ page }) => {
  test.setTimeout(120_000);

  const runId = Date.now();
  const clientName = `PW Client ${runId}`;
  const taskName = `PW Task ${runId}`;
  const dueDate = new Date(Date.now() + 4 * 86400000).toISOString().split('T')[0];

  page.on('dialog', async (dialog) => {
    await dialog.accept();
  });

  await signIn(page);

  // 1) Add a new client
  await page.locator('.nav-tab[data-target="view-clients"]').click();
  await expect(page.locator('#view-clients')).toBeVisible();

  await page.click('#btn-add-client');
  await expect(page.locator('#modal-client')).toBeVisible();

  await page.fill('#client-name', clientName);
  await page.fill('#client-contact', 'Playwright User');
  await page.fill('#client-email', `pw_${runId}@example.com`);
  await page.fill('#client-phone', '555-9999');
  await page.click('#btn-save-client');

  await expect(page.locator('#modal-client')).toBeHidden();
  await expect(page.locator('#clients-table-body')).toContainText(clientName);

  // 2) Add a new task assigned to that client
  await page.locator('.nav-tab[data-target="view-tasks"]').click();
  await expect(page.locator('#view-tasks')).toBeVisible();

  await page.locator('#view-tasks .btn-add-task').first().click();
  await expect(page.locator('#modal-task')).toBeVisible();

  await page.selectOption('#task-client', { label: clientName });
  await page.fill('#task-project', 'E2E Project');
  await page.fill('#task-name', taskName);
  await selectFirstAvailableOption(page, '#task-staff');
  await page.fill('#task-due-date', dueDate);
  await page.click('#btn-save-task');

  await waitForNotificationsToClear(page);
  await expect(page.locator('#modal-task')).toBeHidden({ timeout: 30_000 });
  await page.fill('#tasks-search', taskName);
  const taskRow = page.locator('#tasks-table-body tr', { hasText: taskName }).first();
  await expect(taskRow).toBeVisible();

  // 3) Remove the task
  const taskIdText = await taskRow.locator('td:nth-child(2)').innerText();
  const taskId = Number(taskIdText.replace('#', '').trim());
  await page.evaluate((id) => window.deleteSingleTask(id), taskId);
  await expect(page.locator('#tasks-table-body')).not.toContainText(taskName);

  // 4) Remove the client
  await page.locator('.nav-tab[data-target="view-clients"]').click();
  await expect(page.locator('#view-clients')).toBeVisible();

  const clientRow = page.locator('#clients-table-body tr', { hasText: clientName }).first();
  await expect(clientRow).toBeVisible();
  await page.evaluate((name) => window.deleteClientAction(name), clientName);

  await expect(page.locator('#clients-table-body')).not.toContainText(clientName);
});
