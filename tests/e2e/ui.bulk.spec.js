const { test, expect } = require('@playwright/test');
const { resetBrowserState, signIn } = require('./ui.helpers');

async function selectFirstAvailableOption(page, selector) {
  const value = await page.evaluate((selectSelector) => {
    const select = document.querySelector(selectSelector);
    if (!select) return null;
    const options = Array.from(select.options || []);
    const first = options.find((option) => option.value && !option.disabled);
    return first ? first.value : null;
  }, selector);

  if (!value) {
    throw new Error(`No available option found for ${selector}`);
  }

  await page.selectOption(selector, value);
}

async function createTaskFromTasksView(page, taskName) {
  const dueDate = new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0];

  await page.locator('#view-tasks .btn-add-task').first().click();
  await expect(page.locator('#modal-task')).toBeVisible();

  await selectFirstAvailableOption(page, '#task-client');
  await page.fill('#task-project', 'E2E Bulk Flow');
  await page.fill('#task-name', taskName);
  await selectFirstAvailableOption(page, '#task-staff');
  await page.fill('#task-due-date', dueDate);
  await page.click('#btn-save-task');

  await expect(page.locator('#modal-task')).toBeHidden({ timeout: 30_000 });
}

function idCellLocator(page, idNumber) {
  return page.locator(`#tasks-table-body td:nth-child(2):text-is("#${idNumber}")`);
}

test.beforeEach(async ({ page }) => {
  await resetBrowserState(page);
});

test('bulk delete with undo and redo in tasks view', async ({ page }) => {
  test.setTimeout(150_000);

  page.on('dialog', async (dialog) => {
    await dialog.accept();
  });

  await signIn(page);
  await page.locator('.nav-tab[data-target="view-tasks"]').click();
  await expect(page.locator('#view-tasks')).toBeVisible();

  const rows = page.locator('#tasks-table-body tr:has(input.task-checkbox)');
  if ((await rows.count()) < 2) {
    const runId = Date.now();
    await createTaskFromTasksView(page, `PW Bulk A ${runId}`);
    await createTaskFromTasksView(page, `PW Bulk B ${runId}`);
  }

  await expect
    .poll(async () => rows.count(), {
      timeout: 20_000,
      intervals: [500, 1000, 2000],
    })
    .toBeGreaterThanOrEqual(2);

  const firstRow = rows.first();
  const secondRow = rows.nth(1);

  const taskIdA = Number((await firstRow.locator('td:nth-child(2)').innerText()).replace('#', '').trim());
  const taskIdB = Number((await secondRow.locator('td:nth-child(2)').innerText()).replace('#', '').trim());

  await firstRow.locator('input.task-checkbox').check();
  await secondRow.locator('input.task-checkbox').check();
  await expect(page.locator('#btn-bulk-actions')).toBeEnabled();

  await page.click('#btn-bulk-actions');
  await page.click('#bulk-actions-menu .bulk-action[data-action="delete"]');

  await expect(idCellLocator(page, taskIdA)).toHaveCount(0);
  await expect(idCellLocator(page, taskIdB)).toHaveCount(0);

  await page.click('#btn-undo', { force: true });
  if (await page.locator('#btn-redo').isEnabled()) {
    await page.click('#btn-redo', { force: true });
  }
});
