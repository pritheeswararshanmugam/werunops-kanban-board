const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const DEFAULT_BASE_URL = 'https://pritheeswararshanmugam.github.io/werunops-kanban-board/index.html';
const DEFAULT_USERNAME = 'Eshwar';
const DEFAULT_PASSWORD = '110495';

function runtimeConfig() {
  return {
    baseUrl: process.env.WERUNOPS_E2E_BASE_URL || DEFAULT_BASE_URL,
    username: process.env.WERUNOPS_E2E_USERNAME || DEFAULT_USERNAME,
    password: process.env.WERUNOPS_E2E_PASSWORD || DEFAULT_PASSWORD,
  };
}

async function selectFirstAvailableOption(page, selector) {
  const value = await page.evaluate((selectSelector) => {
    const select = document.querySelector(selectSelector);
    if (!select) return null;
    const options = Array.from(select.options || []);
    const first = options.find((option) => option.value && !option.disabled);
    return first ? first.value : null;
  }, selector);

  if (!value) throw new Error(`No available option for ${selector}`);
  await page.selectOption(selector, value);
}

async function signIn(page, cfg) {
  await page.goto(cfg.baseUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#login-form')).toBeVisible();
  await page.fill('#login-username', cfg.username);
  await page.fill('#login-password', cfg.password);
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page.locator('#main-header')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#main-content')).toBeVisible({ timeout: 30_000 });
}

async function createTaskFromAllTasks(page, taskName) {
  const dueDate = new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0];

  await page.locator('.nav-tab[data-target="view-tasks"]').click();
  await expect(page.locator('#view-tasks')).toBeVisible();

  await page.locator('#view-tasks .btn-add-task').first().click();
  await expect(page.locator('#modal-task')).toBeVisible();

  await selectFirstAvailableOption(page, '#task-client');
  await page.fill('#task-project', 'Prod Debug Flow');
  await page.fill('#task-name', taskName);
  await selectFirstAvailableOption(page, '#task-staff');
  await page.fill('#task-due-date', dueDate);

  await page.click('#btn-save-task');
  await expect(page.locator('#modal-task')).toBeHidden({ timeout: 30_000 });
}

async function taskVisibleInTable(page, taskName) {
  await page.locator('.nav-tab[data-target="view-tasks"]').click();
  await expect(page.locator('#view-tasks')).toBeVisible();
  await page.fill('#tasks-search', taskName);
  const row = page.locator('#tasks-table-body tr', { hasText: taskName }).first();
  return row.isVisible().catch(() => false);
}

test('forensic check: created task should not disappear after sync and reload', async ({ page }) => {
  test.setTimeout(240_000);

  const cfg = runtimeConfig();
  const runId = Date.now();
  const taskName = `PW-PROD-DISAPPEAR-${runId}`;
  const forensicDir = path.resolve(process.cwd(), 'test-results', 'live-run');
  fs.mkdirSync(forensicDir, { recursive: true });

  const tasksSnapshots = [];
  const visibilitySamples = [];
  let stillVisibleAfterWait = false;
  let stillVisibleAfterReload = false;
  const streamSnapshotFile = path.join(forensicDir, 'tasks-snapshots-stream.json');

  const writeStreamSnapshot = () => {
    fs.writeFileSync(streamSnapshotFile, JSON.stringify({
      runId,
      taskName,
      at: new Date().toISOString(),
      snapshots: tasksSnapshots,
    }, null, 2), 'utf8');
  };

  writeStreamSnapshot();

  page.on('response', async (response) => {
    const url = response.url();
    if (!url.includes('/api/v1/tasks') || response.request().method() !== 'GET') return;

    try {
      const body = await response.json();
      const size = Array.isArray(body?.data) ? body.data.length : -1;
      tasksSnapshots.push({
        at: new Date().toISOString(),
        status: response.status(),
        url,
        count: size,
      });
      writeStreamSnapshot();
    } catch (error) {
      tasksSnapshots.push({
        at: new Date().toISOString(),
        status: response.status(),
        url,
        count: -1,
        parseError: String(error),
      });
      writeStreamSnapshot();
    }
  });

  try {
    await signIn(page, cfg);
    await createTaskFromAllTasks(page, taskName);

    await expect
      .poll(async () => taskVisibleInTable(page, taskName), {
        timeout: 20_000,
        intervals: [500, 1000, 2000],
      })
      .toBe(true);

    for (let index = 1; index <= 9; index++) {
      await page.waitForTimeout(10_000);
      const visible = await taskVisibleInTable(page, taskName);
      visibilitySamples.push({
        step: index,
        at: new Date().toISOString(),
        visible,
      });
      if (!visible) break;
    }

    stillVisibleAfterWait = visibilitySamples.length > 0
      ? visibilitySamples[visibilitySamples.length - 1].visible
      : await taskVisibleInTable(page, taskName);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#main-content')).toBeVisible({ timeout: 30_000 });
    stillVisibleAfterReload = await taskVisibleInTable(page, taskName);

    expect(
      stillVisibleAfterWait && stillVisibleAfterReload,
      `Task ${taskName} disappeared. Snapshot attached for /tasks responses.`
    ).toBe(true);
  } finally {
    const payload = JSON.stringify({
      runId,
      taskName,
      createdAt: new Date().toISOString(),
      snapshots: tasksSnapshots,
      visibilitySamples,
      stillVisibleAfterWait,
      stillVisibleAfterReload,
    }, null, 2);

    fs.writeFileSync(path.join(forensicDir, 'tasks-snapshots-latest.json'), payload, 'utf8');

    await test.info().attach('tasks-snapshots.json', {
      body: payload,
      contentType: 'application/json',
    });

    await test.info().attach('task-visibility-samples.json', {
      body: JSON.stringify(visibilitySamples, null, 2),
      contentType: 'application/json',
    });
  }
});
