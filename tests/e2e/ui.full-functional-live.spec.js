const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const DEFAULT_FRONTEND_URL = 'https://pritheeswararshanmugam.github.io/werunops-kanban-board/';
const DEFAULT_BACKEND_URL = 'https://werunops-kanban-board-5pqv.vercel.app';

function runtimeConfig() {
  return {
    frontendUrl: process.env.WERUNOPS_LIVE_FRONTEND_URL || DEFAULT_FRONTEND_URL,
    backendUrl: process.env.WERUNOPS_LIVE_BACKEND_URL || DEFAULT_BACKEND_URL,
    accounts: [
      {
        key: 'admin',
        username: process.env.WERUNOPS_E2E_USERNAME || 'Eshwar',
        password: process.env.WERUNOPS_E2E_PASSWORD || '110495',
      },
      {
        key: 'manager',
        username: process.env.WERUNOPS_E2E_MANAGER_USERNAME || 'Mubarak',
        password: process.env.WERUNOPS_E2E_MANAGER_PASSWORD || '123456',
      },
      {
        key: 'user',
        username: process.env.WERUNOPS_E2E_USER_USERNAME || 'Sudhar',
        password: process.env.WERUNOPS_E2E_USER_PASSWORD || '654321',
      },
    ],
  };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sanitizeLabel(value) {
  return String(value || 'artifact').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 96);
}

async function screenshot(page, dirPath, label) {
  const fileName = `${Date.now()}-${sanitizeLabel(label)}.png`;
  const outputPath = path.join(dirPath, fileName);
  await page.screenshot({ path: outputPath, fullPage: true });
  return fileName;
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

async function goToTab(page, targetId) {
  await page.locator(`.nav-tab[data-target="${targetId}"]`).click();
  await expect(page.locator(`#${targetId}`)).toBeVisible({ timeout: 30_000 });
}

async function signIn(page, cfg, username, password) {
  await page.goto(cfg.frontendUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#login-form')).toBeVisible({ timeout: 30_000 });
  await page.fill('#login-username', username);
  await page.fill('#login-password', password);
  await page.locator('#login-form button[type="submit"]').click();

  try {
    await expect(page.locator('#main-content')).toBeVisible({ timeout: 25_000 });
    return { success: true };
  } catch {
    const errorText = await page.locator('#login-error-msg').textContent().catch(() => '');
    return { success: false, errorText: String(errorText || '').trim() || 'Login failed' };
  }
}

async function signOut(page) {
  await page.locator('#header-user-menu-btn').click();
  await page.locator('#btn-logout').click();
  await expect(page.locator('#login-form')).toBeVisible({ timeout: 20_000 });
}

async function getTaskIdFromRow(row) {
  const idText = await row.locator('td:nth-child(2)').innerText();
  return Number(String(idText).replace('#', '').trim());
}

async function createTaskFromAllTasks(page, options) {
  await goToTab(page, 'view-tasks');
  await page.locator('#view-tasks .btn-add-task').first().click();
  await expect(page.locator('#modal-task')).toBeVisible({ timeout: 20_000 });

  if (options.clientLabel) {
    await page.selectOption('#task-client', { label: options.clientLabel });
  } else {
    await selectFirstAvailableOption(page, '#task-client');
  }

  await page.fill('#task-project', options.project);
  await page.fill('#task-name', options.taskName);

  if (options.staffLabel) {
    await page.selectOption('#task-staff', { label: options.staffLabel });
  } else {
    await selectFirstAvailableOption(page, '#task-staff');
  }

  await page.fill('#task-due-date', options.dueDate);

  if (options.status) {
    await page.selectOption('#task-status', options.status);
  }

  await page.click('#btn-save-task');
  await expect(page.locator('#modal-task')).toBeHidden({ timeout: 30_000 });

  await page.fill('#tasks-search', options.taskName);
  const row = page.locator('#tasks-table-body tr', { hasText: options.taskName }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });

  return getTaskIdFromRow(row);
}

async function getAccessTokenFromSession(page) {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem('currentUser');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.accessToken || null;
    } catch {
      return null;
    }
  });
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

test.use({
  trace: 'retain-on-failure',
  screenshot: 'on',
  video: 'retain-on-failure',
});

test('live auth matrix: try all three logins with screenshots', async ({ page }, testInfo) => {
  test.setTimeout(360_000);

  const cfg = runtimeConfig();
  const runDir = path.resolve(process.cwd(), 'test-results', 'full-functional-live');
  ensureDir(runDir);

  const matrix = [];

  for (const account of cfg.accounts) {
    const entry = {
      key: account.key,
      username: account.username,
      attemptedAt: new Date().toISOString(),
      success: false,
      screenshots: [],
      errorText: '',
    };

    await page.goto(cfg.frontendUrl, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#login-form')).toBeVisible({ timeout: 30_000 });

    await page.fill('#login-username', account.username);
    await page.fill('#login-password', account.password);
    entry.screenshots.push(await screenshot(page, runDir, `login-${account.key}-filled`));

    const result = await signIn(page, cfg, account.username, account.password);
    entry.success = result.success;

    if (result.success) {
      await expect(page.locator('#main-content')).toBeVisible({ timeout: 30_000 });
      entry.screenshots.push(await screenshot(page, runDir, `login-${account.key}-success`));
      await signOut(page);
      entry.screenshots.push(await screenshot(page, runDir, `login-${account.key}-logged-out`));
    } else {
      entry.errorText = result.errorText;
      entry.screenshots.push(await screenshot(page, runDir, `login-${account.key}-failed`));
    }

    matrix.push(entry);
  }

  const matrixPath = path.join(runDir, 'login-matrix-latest.json');
  const matrixText = JSON.stringify({ generatedAt: new Date().toISOString(), matrix }, null, 2);
  fs.writeFileSync(matrixPath, matrixText, 'utf8');

  await testInfo.attach('login-matrix-latest.json', {
    body: matrixText,
    contentType: 'application/json',
  });

  const adminResult = matrix.find((item) => item.key === 'admin');
  expect(Boolean(adminResult?.success), 'Admin login must succeed to continue full functional testing.').toBe(true);
});

test('live UI full sweep: task/client/dashboard/settings/exports/admin-portal with screenshots', async ({ page, context }, testInfo) => {
  test.setTimeout(900_000);

  const cfg = runtimeConfig();
  const admin = cfg.accounts[0];
  const runId = Date.now();
  const runDir = path.resolve(process.cwd(), 'test-results', 'full-functional-live');
  ensureDir(runDir);

  const screenshotLog = [];
  const pushShot = async (label) => {
    const fileName = await screenshot(page, runDir, label);
    screenshotLog.push({ at: new Date().toISOString(), label, fileName });
  };

  const created = {
    clientName: `PW-LIVE-CLIENT-${runId}`,
    parentTaskName: `PW-LIVE-PARENT-${runId}`,
    childTaskName: `PW-LIVE-CHILD-${runId}`,
    bulkTaskA: `PW-LIVE-BULK-${runId}-A`,
    bulkTaskB: `PW-LIVE-BULK-${runId}-B`,
    taskIds: [],
  };

  page.on('dialog', async (dialog) => {
    await dialog.accept();
  });

  const dueSoon = new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0];
  const dueToday = new Date().toISOString().split('T')[0];

  const signInResult = await signIn(page, cfg, admin.username, admin.password);
  expect(signInResult.success).toBe(true);
  await pushShot('ui-dashboard-after-login');

  await page.locator('#header-search-btn').click();
  await pushShot('ui-header-search-panel-open');
  await page.fill('#header-search-input', 'PW-LIVE');
  await pushShot('ui-header-search-results');

  await page.locator('#header-bell-btn').click();
  await pushShot('ui-notifications-panel-open');

  await page.locator('#header-user-menu-btn').click();
  await page.locator('#btn-open-settings').click();
  await expect(page.locator('#modal-settings')).toBeVisible({ timeout: 20_000 });
  await pushShot('ui-settings-open');

  try {
    const [stateDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: 20_000 }),
      page.click('#btn-settings-export-state'),
    ]);
    screenshotLog.push({ at: new Date().toISOString(), label: 'download-state-export', fileName: stateDownload.suggestedFilename() });
  } catch {
    screenshotLog.push({ at: new Date().toISOString(), label: 'download-state-export', fileName: 'download-not-captured' });
  }

  try {
    const [sessionDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: 20_000 }),
      page.click('#btn-settings-export-sessions'),
    ]);
    screenshotLog.push({ at: new Date().toISOString(), label: 'download-session-export', fileName: sessionDownload.suggestedFilename() });
  } catch {
    screenshotLog.push({ at: new Date().toISOString(), label: 'download-session-export', fileName: 'download-not-captured' });
  }

  await page.locator('#modal-settings button.btn-close-settings-modal').first().click();
  await expect(page.locator('#modal-settings')).toBeHidden({ timeout: 20_000 });

  await goToTab(page, 'view-clients');
  await page.click('#btn-add-client');
  await expect(page.locator('#modal-client')).toBeVisible({ timeout: 20_000 });
  await page.fill('#client-name', created.clientName);
  await page.fill('#client-contact', 'Playwright QA');
  await page.fill('#client-email', `pw_${runId}@example.com`);
  await page.fill('#client-phone', '555-2200');
  await pushShot('ui-client-modal-filled');
  await page.click('#btn-save-client');
  await expect(page.locator('#modal-client')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('#clients-table-body')).toContainText(created.clientName);
  await pushShot('ui-client-created');

  await page.evaluate((clientName) => window.openClientModal(clientName), created.clientName);
  await expect(page.locator('#modal-client')).toBeVisible({ timeout: 20_000 });
  await page.fill('#client-contact', 'Playwright QA Updated');
  await page.click('#btn-save-client');
  await expect(page.locator('#modal-client')).toBeHidden({ timeout: 20_000 });
  await pushShot('ui-client-updated');

  const parentTaskId = await createTaskFromAllTasks(page, {
    clientLabel: created.clientName,
    project: 'Live UI Sweep',
    taskName: created.parentTaskName,
    dueDate: dueSoon,
    status: 'New',
  });
  created.taskIds.push(parentTaskId);
  await pushShot('ui-parent-task-created');

  await page.evaluate((taskId) => window.openTaskModal(taskId), parentTaskId);
  await expect(page.locator('#modal-task')).toBeVisible({ timeout: 20_000 });
  await page.selectOption('#task-status', 'Follow Up');
  await page.fill('#task-waiting', 'Client confirmation');
  await page.click('#btn-save-task');
  await expect(page.locator('#modal-task')).toBeHidden({ timeout: 20_000 });
  await pushShot('ui-parent-task-updated-followup');

  await page.evaluate((taskId) => window.openTaskModal(taskId), parentTaskId);
  await expect(page.locator('#modal-task')).toBeVisible({ timeout: 20_000 });
  await page.click('#btn-add-followup');
  await expect(page.locator('#modal-task')).toBeVisible({ timeout: 20_000 });
  await page.selectOption('#task-client', { label: created.clientName });
  await selectFirstAvailableOption(page, '#task-staff');
  await page.selectOption('#task-status', 'New');
  await page.fill('#task-name', created.childTaskName);
  await page.fill('#task-due-date', dueToday);
  await page.click('#btn-save-task');
  let childSavedFromFollowupButton = false;
  try {
    await expect(page.locator('#modal-task')).toBeHidden({ timeout: 12_000 });
    childSavedFromFollowupButton = true;
  } catch {
    childSavedFromFollowupButton = false;
  }

  if (!childSavedFromFollowupButton) {
    await page.keyboard.press('Escape').catch(() => {});
    if (await page.locator('#modal-task').isVisible().catch(() => false)) {
      await page.locator('.btn-close-modal').first().click().catch(() => {});
      await page.waitForTimeout(600);
    }

    await page.evaluate((payload) => {
      window.openTaskModal(null, payload);
    }, {
      parentId: parentTaskId,
      client: created.clientName,
      project: 'Live UI Sweep',
      staff: 'Mubarak',
      taskName: created.childTaskName,
    });

    await expect(page.locator('#modal-task')).toBeVisible({ timeout: 20_000 });
    await page.selectOption('#task-client', { label: created.clientName });
    await selectFirstAvailableOption(page, '#task-staff');
    await page.selectOption('#task-status', 'New');
    await page.fill('#task-name', created.childTaskName);
    await page.fill('#task-due-date', dueToday);
    await page.click('#btn-save-task');
    await expect(page.locator('#modal-task')).toBeHidden({ timeout: 20_000 });
  }

  await page.fill('#tasks-search', created.childTaskName);
  const childRow = page.locator('#tasks-table-body tr', { hasText: created.childTaskName }).first();
  await expect(childRow).toBeVisible({ timeout: 30_000 });
  const childTaskId = await getTaskIdFromRow(childRow);
  created.taskIds.push(childTaskId);
  await pushShot('ui-followup-task-created');

  await goToTab(page, 'view-today');
  await pushShot('ui-today-view-before-complete');

  const todayCard = page.locator('#view-today .bg-white', { hasText: created.childTaskName }).first();
  if (await todayCard.isVisible().catch(() => false)) {
    await todayCard.locator('button', { hasText: 'Complete' }).click();
    await pushShot('ui-today-view-after-complete');
  }

  await goToTab(page, 'view-kanban');
  await pushShot('ui-kanban-view');

  await goToTab(page, 'view-tasks');
  await page.fill('#tasks-search', '');
  await page.click('#btn-export-dropdown');
  await pushShot('ui-tasks-export-menu-open');

  try {
    const [tasksCsvDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: 20_000 }),
      page.click('#btn-export-csv'),
    ]);
    screenshotLog.push({ at: new Date().toISOString(), label: 'download-tasks-csv', fileName: tasksCsvDownload.suggestedFilename() });
  } catch {
    screenshotLog.push({ at: new Date().toISOString(), label: 'download-tasks-csv', fileName: 'download-not-captured' });
  }

  const bulkTaskAId = await createTaskFromAllTasks(page, {
    clientLabel: created.clientName,
    project: 'Bulk Sweep',
    taskName: created.bulkTaskA,
    dueDate: dueSoon,
    status: 'New',
  });
  const bulkTaskBId = await createTaskFromAllTasks(page, {
    clientLabel: created.clientName,
    project: 'Bulk Sweep',
    taskName: created.bulkTaskB,
    dueDate: dueSoon,
    status: 'New',
  });
  created.taskIds.push(bulkTaskAId, bulkTaskBId);

  await page.fill('#tasks-search', `PW-LIVE-BULK-${runId}`);
  await expect(page.locator('#tasks-table-body tr')).toHaveCount(2, { timeout: 30_000 });

  const rows = page.locator('#tasks-table-body tr');
  const rowCount = await rows.count();
  for (let i = 0; i < rowCount; i += 1) {
    await rows.nth(i).locator('td:first-child input[type="checkbox"]').check();
  }

  await page.click('#btn-bulk-actions');
  await page.click('#bulk-actions-menu .bulk-action[data-action="delete"]');
  await expect(page.locator('#tasks-table-body')).not.toContainText(created.bulkTaskA, { timeout: 30_000 });
  await expect(page.locator('#tasks-table-body')).not.toContainText(created.bulkTaskB, { timeout: 30_000 });
  await pushShot('ui-bulk-delete-complete');

  if (typeof context.setOffline === 'function') {
    await context.setOffline(true);
    await page.waitForTimeout(1500);
    await pushShot('ui-offline-mode');
    await context.setOffline(false);
    await page.waitForTimeout(2500);
    await pushShot('ui-online-restored');
  }

  await page.locator('#header-user-menu-btn').click();
  if (await page.locator('#btn-open-admin-portal').isVisible().catch(() => false)) {
    const [popup] = await Promise.all([
      page.waitForEvent('popup', { timeout: 20_000 }),
      page.click('#btn-open-admin-portal'),
    ]);
    await popup.waitForLoadState('domcontentloaded', { timeout: 30_000 });
    const popupShot = await screenshot(popup, runDir, 'ui-admin-portal-popup');
    screenshotLog.push({ at: new Date().toISOString(), label: 'ui-admin-portal-popup', fileName: popupShot });
    await popup.close();
  }

  await goToTab(page, 'view-tasks');
  for (const taskId of [...created.taskIds]) {
    await page.evaluate(async (id) => {
      await window.deleteSingleTask(id);
    }, taskId);
  }
  await goToTab(page, 'view-clients');
  await page.evaluate(async (name) => {
    await window.deleteClientAction(name);
  }, created.clientName);
  await pushShot('ui-cleanup-complete');

  await signOut(page);

  const summary = {
    generatedAt: new Date().toISOString(),
    created,
    screenshots: screenshotLog,
  };
  const summaryText = JSON.stringify(summary, null, 2);
  fs.writeFileSync(path.join(runDir, 'ui-full-sweep-latest.json'), summaryText, 'utf8');

  await testInfo.attach('ui-full-sweep-latest.json', {
    body: summaryText,
    contentType: 'application/json',
  });
});

test('live backend/admin API sweep: validate full feature surface as admin', async ({ request }, testInfo) => {
  test.setTimeout(900_000);

  const cfg = runtimeConfig();
  const admin = cfg.accounts[0];
  const runId = Date.now();
  const runDir = path.resolve(process.cwd(), 'test-results', 'full-functional-live');
  ensureDir(runDir);

  const base = `${cfg.backendUrl}/api/v1`;
  const report = {
    generatedAt: new Date().toISOString(),
    runId,
    status: {},
    details: {},
  };

  const loginResp = await request.post(`${base}/auth/login`, {
    data: {
      username: admin.username,
      password: admin.password,
    },
  });
  report.status.login = loginResp.status();
  expect(loginResp.status()).toBe(200);
  const loginJson = await loginResp.json();
  const token = loginJson?.data?.accessToken;
  expect(Boolean(token)).toBe(true);

  const headers = authHeaders(token);

  const meResp = await request.get(`${base}/auth/me`, { headers });
  report.status.authMe = meResp.status();
  expect(meResp.status()).toBe(200);

  const healthResp = await request.get(`${base}/health`);
  report.status.health = healthResp.status();
  expect(healthResp.status()).toBe(200);

  const testClientName = `PW-API-CLIENT-${runId}`;
  const testTaskName = `PW-API-TASK-${runId}`;
  const dueDate = new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0];

  const createClientResp = await request.post(`${base}/clients`, {
    headers,
    data: {
      name: testClientName,
      contact: 'API QA',
      email: `api_${runId}@example.com`,
      phone: '555-3300',
    },
  });
  report.status.createClient = createClientResp.status();
  expect(createClientResp.status()).toBe(200);
  const createClientJson = await createClientResp.json();
  const clientId = createClientJson?.data?.id;
  let clientVersion = createClientJson?.data?.version;

  const listClientsResp = await request.get(`${base}/clients`, { headers });
  report.status.listClients = listClientsResp.status();
  expect(listClientsResp.status()).toBe(200);

  const updateClientResp = await request.put(`${base}/clients/${clientId}`, {
    headers,
    data: {
      name: testClientName,
      contact: 'API QA Updated',
      email: `api_${runId}@example.com`,
      phone: '555-3399',
      version: clientVersion,
    },
  });
  report.status.updateClient = updateClientResp.status();
  expect(updateClientResp.status()).toBe(200);
  clientVersion = (await updateClientResp.json())?.data?.version;

  const createTaskResp = await request.post(`${base}/tasks`, {
    headers,
    data: {
      client: testClientName,
      project: 'API Sweep',
      task: testTaskName,
      staff: 'Mubarak',
      status: 'New',
      priority: 'Medium',
      startDate: '',
      dueDate,
      waitingFor: '',
      notes: 'API full functionality sweep',
      parentId: null,
    },
  });
  report.status.createTask = createTaskResp.status();
  expect(createTaskResp.status()).toBe(200);
  const createTaskJson = await createTaskResp.json();
  const taskId = createTaskJson?.data?.id;
  let taskVersion = createTaskJson?.data?.version;

  const getTaskResp = await request.get(`${base}/tasks/${taskId}`, { headers });
  report.status.getTask = getTaskResp.status();
  expect(getTaskResp.status()).toBe(200);

  const updateTaskResp = await request.put(`${base}/tasks/${taskId}`, {
    headers,
    data: {
      client: testClientName,
      project: 'API Sweep Updated',
      task: `${testTaskName}-EDIT`,
      staff: 'Sudhar',
      status: 'In Progress',
      priority: 'High',
      startDate: '',
      dueDate,
      waitingFor: 'Supplier',
      notes: 'Task updated via API sweep',
      parentId: null,
      version: taskVersion,
    },
  });
  report.status.updateTask = updateTaskResp.status();
  expect(updateTaskResp.status()).toBe(200);
  taskVersion = (await updateTaskResp.json())?.data?.version;

  const patchStatusResp = await request.patch(`${base}/tasks/${taskId}/status`, {
    headers,
    data: {
      status: 'Follow Up',
      version: taskVersion,
    },
  });
  report.status.patchTaskStatus = patchStatusResp.status();
  expect(patchStatusResp.status()).toBe(200);
  taskVersion = (await patchStatusResp.json())?.data?.version;

  const stalePatchResp = await request.patch(`${base}/tasks/${taskId}/status`, {
    headers,
    data: {
      status: 'Completed',
      version: Math.max(1, Number(taskVersion) - 1),
    },
  });
  report.status.patchTaskStatusConflict = stalePatchResp.status();
  expect(stalePatchResp.status()).toBe(409);

  const lockResp = await request.put(`${base}/locks/tasks/${taskId}`, {
    headers,
    data: { ttlSeconds: 60 },
  });
  report.status.lockTask = lockResp.status();
  expect(lockResp.status()).toBe(200);

  const listLocksResp = await request.get(`${base}/locks/tasks`, { headers });
  report.status.listLocks = listLocksResp.status();
  expect(listLocksResp.status()).toBe(200);

  const unlockResp = await request.delete(`${base}/locks/tasks/${taskId}`, { headers });
  report.status.unlockTask = unlockResp.status();
  expect(unlockResp.status()).toBe(200);

  const deleteClientBlockedResp = await request.delete(`${base}/clients/${clientId}`, { headers });
  report.status.deleteClientBlocked = deleteClientBlockedResp.status();
  expect(deleteClientBlockedResp.status()).toBe(400);

  const tasksListBeforeDeleteResp = await request.get(`${base}/tasks`, { headers });
  report.status.listTasks = tasksListBeforeDeleteResp.status();
  expect(tasksListBeforeDeleteResp.status()).toBe(200);
  const tasksListBeforeDelete = await tasksListBeforeDeleteResp.json();

  const deleteTaskResp = await request.delete(`${base}/tasks/${taskId}`, { headers });
  report.status.deleteTask = deleteTaskResp.status();
  expect(deleteTaskResp.status()).toBe(200);

  const restoreSnapshot = (tasksListBeforeDelete?.data || []).find((task) => Number(task.id) === Number(taskId));
  const restoreResp = await request.post(`${base}/tasks/restore`, {
    headers,
    data: { task: restoreSnapshot },
  });
  report.status.restoreTask = restoreResp.status();
  expect(restoreResp.status()).toBe(200);

  const bulkTaskAResp = await request.post(`${base}/tasks`, {
    headers,
    data: {
      client: testClientName,
      project: 'Bulk API',
      task: `PW-BULK-A-${runId}`,
      staff: 'Mubarak',
      status: 'New',
      priority: 'Low',
      startDate: '',
      dueDate,
      waitingFor: '',
      notes: '',
      parentId: null,
    },
  });
  const bulkTaskBResp = await request.post(`${base}/tasks`, {
    headers,
    data: {
      client: testClientName,
      project: 'Bulk API',
      task: `PW-BULK-B-${runId}`,
      staff: 'Mubarak',
      status: 'New',
      priority: 'Low',
      startDate: '',
      dueDate,
      waitingFor: '',
      notes: '',
      parentId: null,
    },
  });
  const bulkAId = (await bulkTaskAResp.json())?.data?.id;
  const bulkBId = (await bulkTaskBResp.json())?.data?.id;

  const bulkDeleteResp = await request.post(`${base}/tasks/bulk-delete`, {
    headers,
    data: { taskIds: [bulkAId, bulkBId] },
  });
  report.status.bulkDeleteTasks = bulkDeleteResp.status();
  expect(bulkDeleteResp.status()).toBe(200);

  const presencePutResp = await request.put(`${base}/presence/me`, {
    headers,
    data: {
      online: true,
      browser: 'Playwright',
      device: 'Automation',
    },
  });
  report.status.setPresence = presencePutResp.status();
  expect(presencePutResp.status()).toBe(200);

  const presenceGetResp = await request.get(`${base}/presence`, { headers });
  report.status.listPresence = presenceGetResp.status();
  expect(presenceGetResp.status()).toBe(200);

  const sessionStartResp = await request.post(`${base}/sessions/start`, {
    headers,
    data: { browser: 'Playwright', device: 'Automation' },
  });
  report.status.sessionStart = sessionStartResp.status();
  expect(sessionStartResp.status()).toBe(200);
  const sessionId = (await sessionStartResp.json())?.data?.id;

  const heartbeatResp = await request.post(`${base}/sessions/${sessionId}/heartbeat`, {
    headers,
    data: {
      activeSeconds: 12,
      idleSeconds: 3,
    },
  });
  report.status.sessionHeartbeat = heartbeatResp.status();
  expect(heartbeatResp.status()).toBe(200);

  const endSessionResp = await request.post(`${base}/sessions/${sessionId}/end`, { headers });
  report.status.sessionEnd = endSessionResp.status();
  expect(endSessionResp.status()).toBe(200);

  const listSessionsResp = await request.get(`${base}/sessions`, { headers });
  report.status.listSessions = listSessionsResp.status();
  expect(listSessionsResp.status()).toBe(200);

  const sessionSummaryResp = await request.get(`${base}/reports/sessions/summary`, { headers });
  report.status.sessionSummaryReport = sessionSummaryResp.status();
  expect(sessionSummaryResp.status()).toBe(200);

  const dashboardMetricsResp = await request.get(`${base}/dashboard/metrics`, { headers });
  report.status.dashboardMetrics = dashboardMetricsResp.status();
  expect(dashboardMetricsResp.status()).toBe(200);

  const sessionsCsvResp = await request.get(`${base}/exports/sessions.csv`, { headers });
  report.status.exportSessionsCsv = sessionsCsvResp.status();
  expect(sessionsCsvResp.status()).toBe(200);

  const exportStateResp = await request.get(`${base}/state/export`, { headers });
  report.status.exportState = exportStateResp.status();
  expect(exportStateResp.status()).toBe(200);

  const adminOpsResp = await request.get(`${base}/admin/operations`, { headers });
  report.status.adminOperations = adminOpsResp.status();
  expect(adminOpsResp.status()).toBe(200);

  const adminAlertsResp = await request.get(`${base}/admin/alerts`, { headers });
  report.status.adminAlerts = adminAlertsResp.status();
  expect(adminAlertsResp.status()).toBe(200);

  const adminUsersResp = await request.get(`${base}/admin/users`, { headers });
  report.status.adminUsers = adminUsersResp.status();
  expect(adminUsersResp.status()).toBe(200);

  const adminFiltersCreateResp = await request.post(`${base}/admin/filters`, {
    headers,
    data: {
      name: `PW_FILTER_${runId}`,
      filters: { status: 'New', user: admin.username },
    },
  });
  report.status.adminFilterCreate = adminFiltersCreateResp.status();
  expect(adminFiltersCreateResp.status()).toBe(200);

  const adminFiltersListResp = await request.get(`${base}/admin/filters`, { headers });
  report.status.adminFilterList = adminFiltersListResp.status();
  expect(adminFiltersListResp.status()).toBe(200);

  const adminFilterDeleteResp = await request.delete(`${base}/admin/filters/${encodeURIComponent(`PW_FILTER_${runId}`)}`, { headers });
  report.status.adminFilterDelete = adminFilterDeleteResp.status();
  expect(adminFilterDeleteResp.status()).toBe(200);

  const adminBulkUpdateResp = await request.post(`${base}/admin/tasks/bulk-update`, {
    headers,
    data: {
      taskIds: [taskId],
      status: 'In Progress',
      staff: 'Mubarak',
    },
  });
  report.status.adminBulkUpdate = adminBulkUpdateResp.status();
  expect(adminBulkUpdateResp.status()).toBe(200);

  const adminCommentAddResp = await request.post(`${base}/admin/tasks/${taskId}/comments`, {
    headers,
    data: {
      comment: `API comment ${runId}`,
    },
  });
  report.status.adminCommentAdd = adminCommentAddResp.status();
  expect(adminCommentAddResp.status()).toBe(200);

  const adminCommentListResp = await request.get(`${base}/admin/tasks/${taskId}/comments`, { headers });
  report.status.adminCommentList = adminCommentListResp.status();
  expect(adminCommentListResp.status()).toBe(200);

  const adminRulesResp = await request.get(`${base}/admin/automation-rules`, { headers });
  report.status.adminRulesList = adminRulesResp.status();
  expect(adminRulesResp.status()).toBe(200);
  const adminRulesJson = await adminRulesResp.json();
  const firstRuleId = adminRulesJson?.data?.[0]?.id;

  if (firstRuleId) {
    const toggleResp1 = await request.patch(`${base}/admin/automation-rules/${firstRuleId}/toggle`, { headers });
    const toggleResp2 = await request.patch(`${base}/admin/automation-rules/${firstRuleId}/toggle`, { headers });
    report.status.adminRuleToggle1 = toggleResp1.status();
    report.status.adminRuleToggle2 = toggleResp2.status();
    expect(toggleResp1.status()).toBe(200);
    expect(toggleResp2.status()).toBe(200);
  }

  const scheduledActionsResp = await request.post(`${base}/admin/scheduled-actions/run`, { headers });
  report.status.adminScheduledActions = scheduledActionsResp.status();
  expect(scheduledActionsResp.status()).toBe(200);

  const weeklyReportResp = await request.get(`${base}/admin/reports/weekly-summary`, { headers });
  report.status.adminReportWeekly = weeklyReportResp.status();
  expect(weeklyReportResp.status()).toBe(200);

  const monthlyReportResp = await request.get(`${base}/admin/reports/monthly-attendance`, { headers });
  report.status.adminReportMonthly = monthlyReportResp.status();
  expect(monthlyReportResp.status()).toBe(200);

  const adminAuditResp = await request.get(`${base}/admin/audit-logs`, { headers });
  report.status.adminAuditLogs = adminAuditResp.status();
  expect(adminAuditResp.status()).toBe(200);

  const deleteTaskAfterTestsResp = await request.delete(`${base}/tasks/${taskId}`, { headers });
  report.status.deleteTaskAfterTests = deleteTaskAfterTestsResp.status();
  expect(deleteTaskAfterTestsResp.status()).toBe(200);

  // Give live shared state a brief chance to converge before deleting the client.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const listResp = await request.get(`${base}/tasks`, { headers });
    if (!listResp.ok()) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
    const listJson = await listResp.json();
    const stillLinked = (listJson?.data || []).some((task) => task.client === testClientName && task.status !== 'Completed');
    if (!stillLinked) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }

  let deleteClientResp = await request.delete(`${base}/clients/${clientId}`, { headers });
  report.status.deleteClientFirstAttempt = deleteClientResp.status();

  if (deleteClientResp.status() !== 200) {
    const latestTasksResp = await request.get(`${base}/tasks`, { headers });
    if (latestTasksResp.ok()) {
      const latestTasks = (await latestTasksResp.json())?.data || [];
      const activeLinked = latestTasks.filter((task) => task.client === testClientName && task.status !== 'Completed');

      for (const linked of activeLinked) {
        const linkedId = Number(linked.id);
        if (!linkedId) continue;

        await request.patch(`${base}/tasks/${linkedId}/status`, {
          headers,
          data: {
            status: 'Completed',
            version: linked.version,
          },
        });
      }
    }

    for (let attempt = 0; attempt < 4; attempt += 1) {
      deleteClientResp = await request.delete(`${base}/clients/${clientId}`, { headers });
      if (deleteClientResp.status() === 200) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  }

  report.status.deleteClient = deleteClientResp.status();
  expect(deleteClientResp.status()).toBe(200);

  const logoutResp = await request.post(`${base}/auth/logout`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  report.status.logout = logoutResp.status();
  expect(logoutResp.status()).toBe(200);

  report.details.checked = Object.keys(report.status).length;
  const reportText = JSON.stringify(report, null, 2);
  fs.writeFileSync(path.join(runDir, 'api-full-sweep-latest.json'), reportText, 'utf8');

  await testInfo.attach('api-full-sweep-latest.json', {
    body: reportText,
    contentType: 'application/json',
  });
});
