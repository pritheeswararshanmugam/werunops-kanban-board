const { test, expect } = require('@playwright/test');

const DEFAULT_FRONTEND_URL = 'https://pritheeswararshanmugam.github.io/werunops-kanban-board/';
const DEFAULT_USERNAME = 'Eshwar';
const DEFAULT_PASSWORD = '110495';

function runtimeConfig() {
  return {
    frontendUrl: process.env.WERUNOPS_LIVE_FRONTEND_URL || DEFAULT_FRONTEND_URL,
    username: process.env.WERUNOPS_E2E_USERNAME || DEFAULT_USERNAME,
    password: process.env.WERUNOPS_E2E_PASSWORD || DEFAULT_PASSWORD,
  };
}

async function signIn(page, cfg) {
  await page.goto(cfg.frontendUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#login-form')).toBeVisible({ timeout: 30_000 });
  await page.fill('#login-username', cfg.username);
  await page.fill('#login-password', cfg.password);
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page.locator('#main-content')).toBeVisible({ timeout: 30_000 });
}

async function openTasksView(page) {
  await page.locator('.nav-tab[data-target="view-tasks"]').click();
  await expect(page.locator('#view-tasks')).toBeVisible({ timeout: 30_000 });
}

async function selectFirstAvailableOption(page, selector) {
  const value = await page.evaluate((selectSelector) => {
    const select = document.querySelector(selectSelector);
    if (!select) return null;
    const options = Array.from(select.options || []);
    const first = options.find((option) => option.value && !option.disabled);
    return first ? first.value : null;
  }, selector);

  if (!value) {
    throw new Error(`No available option for ${selector}`);
  }

  await page.selectOption(selector, value);
  return value;
}

async function createTask(page, taskName, dueDate) {
  await page.locator('#view-tasks .btn-add-task').first().click();
  await expect(page.locator('#modal-task')).toBeVisible({ timeout: 20_000 });

  await selectFirstAvailableOption(page, '#task-client');
  await page.fill('#task-project', 'Live SSE Validation');
  await page.fill('#task-name', taskName);
  await selectFirstAvailableOption(page, '#task-staff');
  await page.fill('#task-due-date', dueDate);
  await page.click('#btn-save-task');

  await expect(page.locator('#modal-task')).toBeHidden({ timeout: 30_000 });
  await page.fill('#tasks-search', taskName);
  const row = page.locator('#tasks-table-body tr', { hasText: taskName }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });

  const idText = await row.locator('td:nth-child(2)').innerText();
  return Number(String(idText).replace('#', '').trim());
}

test.use({
  trace: 'retain-on-failure',
  screenshot: 'on',
  video: 'retain-on-failure',
});

test('live task sync propagates quickly between two sessions', async ({ browser }) => {
  test.setTimeout(180_000);

  const cfg = runtimeConfig();
  const taskName = `PW-LIVE-SSE-${Date.now()}`;
  const dueDate = new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0];

  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();

  await signIn(pageA, cfg);
  await signIn(pageB, cfg);

  await openTasksView(pageA);
  await openTasksView(pageB);

  await pageB.fill('#tasks-search', taskName);
  await expect(pageB.locator('#tasks-table-body')).not.toContainText(taskName);

  const taskId = await createTask(pageA, taskName, dueDate);
  await expect(pageB.locator('#tasks-table-body tr', { hasText: taskName }).first()).toBeVisible({ timeout: 12_000 });

  await pageA.evaluate(() => {
    window.confirm = () => true;
  });
  await pageA.evaluate((id) => window.deleteSingleTask(id), taskId);

  await expect(pageB.locator('#tasks-table-body')).not.toContainText(taskName, { timeout: 12_000 });

  await contextA.close();
  await contextB.close();
});