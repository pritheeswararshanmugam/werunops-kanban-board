const { test, expect } = require('@playwright/test');
const { resetBrowserState, signIn, waitForNotificationsToClear } = require('./ui.helpers');

async function openTasksView(page) {
  await page.locator('.nav-tab[data-target="view-tasks"]').click();
  await expect(page.locator('#view-tasks')).toBeVisible();
}

async function createTaskFromTasksView(page, taskName, dueDate) {
  await page.locator('#view-tasks .btn-add-task').first().click();
  await expect(page.locator('#modal-task')).toBeVisible();

  await page.selectOption('#task-client', { index: 0 });
  await page.fill('#task-project', 'Realtime Sync Project');
  await page.fill('#task-name', taskName);
  await page.selectOption('#task-staff', { index: 0 });
  await page.fill('#task-due-date', dueDate);
  await page.click('#btn-save-task');

  await waitForNotificationsToClear(page);
  await expect(page.locator('#modal-task')).toBeHidden({ timeout: 30_000 });
  await page.fill('#tasks-search', taskName);

  const taskRow = page.locator('#tasks-table-body tr', { hasText: taskName }).first();
  await expect(taskRow).toBeVisible();
  const taskIdText = await taskRow.locator('td:nth-child(2)').innerText();
  return Number(taskIdText.replace('#', '').trim());
}

test('task changes sync quickly between signed-in sessions', async ({ browser }) => {
  test.setTimeout(120_000);

  const taskName = `Realtime Task ${Date.now()}`;
  const dueDate = new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0];

  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  await resetBrowserState(pageA);

  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();

  await signIn(pageA);
  await signIn(pageB);

  await openTasksView(pageA);
  await openTasksView(pageB);

  await pageB.fill('#tasks-search', taskName);
  await expect(pageB.locator('#tasks-table-body')).not.toContainText(taskName);

  const taskId = await createTaskFromTasksView(pageA, taskName, dueDate);

  const syncedRow = pageB.locator('#tasks-table-body tr', { hasText: taskName }).first();
  await expect(syncedRow).toBeVisible({ timeout: 8_000 });

  await pageA.evaluate(() => {
    window.confirm = () => true;
  });
  await pageA.evaluate((id) => window.deleteSingleTask(id), taskId);

  await expect(pageB.locator('#tasks-table-body')).not.toContainText(taskName, { timeout: 8_000 });

  await contextA.close();
  await contextB.close();
});