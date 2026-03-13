const { test, expect } = require('@playwright/test');
const { resetBrowserState, signIn } = require('./ui.helpers');

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

  const rows = page.locator('#tasks-table-body tr');
  await expect
    .poll(async () => rows.count(), {
      timeout: 15_000,
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

  await page.click('#btn-undo');
  await expect(idCellLocator(page, taskIdA)).toHaveCount(1);
  await expect(idCellLocator(page, taskIdB)).toHaveCount(1);

  await page.click('#btn-redo');
  await expect(idCellLocator(page, taskIdA)).toHaveCount(0);
  await expect(idCellLocator(page, taskIdB)).toHaveCount(0);
});
