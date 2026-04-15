const { test, expect } = require('@playwright/test');
const { resetBrowserState } = require('./ui.helpers');

const API_BASE = 'http://127.0.0.1:9000/api/v1';

async function apiLogin(request, username = 'Eshwar', password = '110495') {
  const response = await request.post(`${API_BASE}/auth/login`, {
    data: { username, password },
  });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  return payload?.data?.accessToken;
}

async function api(request, method, path, { token, data, expectedStatus = 200 } = {}) {
  const response = await request.fetch(`${API_BASE}${path}`, {
    method,
    headers: token
      ? {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }
      : {
          'Content-Type': 'application/json',
        },
    data,
  });

  const allowedStatuses = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  expect(allowedStatuses).toContain(response.status());

  let payload = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  return { response, payload };
}

async function createOperationsSpecialist(request, adminToken, username, password) {
  const response = await request.post(`${API_BASE}/admin/users`, {
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
    data: {
      username,
      name: 'Playwright Operations Specialist',
      password,
      role: 'Operations Specialist',
      department: 'Operations',
      timezone: 'UTC',
    },
  });

  expect(response.ok()).toBeTruthy();
}

async function signInAs(page, username, password) {
  await page.goto('/index.html');
  await expect(page.locator('#login-form')).toBeVisible();
  await page.fill('#login-username', username);
  await page.fill('#login-password', password);
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page.locator('#main-header')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#main-content')).toBeVisible();
}

async function openUserMenu(page) {
  await page.locator('#header-user-menu-btn').click();
  await expect(page.locator('#header-user-panel')).toBeVisible({ timeout: 15_000 });
}

async function closeModal(page, selector) {
  await page.locator(`${selector} button[class*="btn-close"]`).first().click();
  await expect(page.locator(selector)).toBeHidden({ timeout: 15_000 });
}

async function searchTasks(page, value) {
  await page.fill('#tasks-search', value);
}

test.beforeEach(async ({ page }) => {
  await resetBrowserState(page);
});

test('operations and staff management flows honor the new auth, presence, and RBAC rules', async ({ page, request }) => {
  test.setTimeout(180_000);

  const adminToken = await apiLogin(request);
  const specialistUsername = `OpsSpec${Date.now()}`;
  const specialistPassword = 'OpsSpec!123';
  const runId = Date.now();
  const clientName = `PW Specialist Client ${runId}`;
  const adminTaskName = `PW Admin Assigned Task ${runId}`;
  const specialistTaskName = `PW Specialist Task ${runId}`;
  const followUpTaskName = `PW Specialist Follow Up ${runId}`;
  const followUpDueDate = new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0];
  const specialistDueDate = new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0];

  await createOperationsSpecialist(request, adminToken, specialistUsername, specialistPassword);

  const createdClient = await api(request, 'POST', '/clients', {
    token: adminToken,
    data: {
      name: clientName,
      contact: 'Playwright Specialist Flow',
      email: `ops_spec_${runId}@example.com`,
      phone: '555-0101',
    },
  });

  const adminAssignedTask = await api(request, 'POST', '/tasks', {
    token: adminToken,
    data: {
      client: clientName,
      project: 'Specialist Access Validation',
      task: adminTaskName,
      staff: specialistUsername,
      status: 'In Progress',
      priority: 'High',
      startDate: '',
      dueDate: '',
      waitingFor: '',
      notes: 'Created by admin for specialist RBAC validation',
      parentId: null,
    },
  });

  await signInAs(page, 'ESHWAR', '110495');
  await expect(page.locator('#header-user-role')).toHaveText('System Administrator');

  await openUserMenu(page);
  await expect(page.locator('#header-work-status')).toHaveValue('online');
  await expect(page.locator('#header-work-status option')).toHaveCount(3);
  await expect(page.locator('#header-work-status')).toContainText('Away / Break');
  await expect(page.locator('#header-work-status')).toContainText('In a Meeting');
  await expect(page.locator('#btn-open-admin-portal')).toBeVisible();

  const [popup] = await Promise.all([
    page.waitForEvent('popup', { timeout: 20_000 }),
    page.click('#btn-open-admin-portal'),
  ]);
  await expect.poll(() => popup.url(), { timeout: 20_000 }).toMatch(/\/admin\/portal$/i);
  expect(popup.url()).not.toContain('accessToken=');
  await popup.close();

  await openUserMenu(page);
  await page.click('#btn-open-profile');
  await expect(page.locator('#modal-profile')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#profile-role')).toBeDisabled();
  await expect(page.locator('#profile-role')).toHaveValue('System Administrator');
  await closeModal(page, '#modal-profile');

  await openUserMenu(page);
  const sessionsResponsePromise = page.waitForResponse(
    (response) => response.url().includes('/api/v1/sessions?username=Eshwar') && response.request().method() === 'GET',
    { timeout: 20_000 }
  );
  await page.click('#btn-open-settings');
  await expect(page.locator('#modal-settings')).toBeVisible({ timeout: 15_000 });
  const sessionsResponse = await sessionsResponsePromise;
  expect(sessionsResponse.ok()).toBeTruthy();
  const renderedUsers = await page.locator('#login-history-list tr td:first-child').allTextContents();
  expect(renderedUsers.every((value) => value.trim() === 'Eshwar')).toBeTruthy();
  await closeModal(page, '#modal-settings');

  await openUserMenu(page);
  const awayRequestPromise = page.waitForRequest(
    (requestEvent) => requestEvent.url().includes('/api/v1/presence/me')
      && requestEvent.method() === 'PUT'
      && requestEvent.postData()?.includes('"status":"away"'),
    { timeout: 20_000 }
  );
  await page.selectOption('#header-work-status', 'away');
  await awayRequestPromise;
  await expect(page.locator('#header-work-status')).toHaveValue('away');

  await page.locator('.nav-tab[data-target="view-tasks"]').click();
  await expect(page.locator('#view-tasks')).toBeVisible();
  let awayDialogMessage = '';
  page.once('dialog', async (dialog) => {
    awayDialogMessage = dialog.message();
    await dialog.accept();
  });
  await page.locator('#tasks-table-body tr td:nth-child(5) div').first().click();
  await expect.poll(() => awayDialogMessage, { timeout: 20_000 }).toContain('Away / Break');
  await expect(page.locator('#header-work-status')).toHaveValue('online');
  await page.locator('#modal-task .btn-close-modal').first().click().catch(() => {});

  await openUserMenu(page);
  await page.click('#btn-logout');
  await expect(page.locator('#login-form')).toBeVisible({ timeout: 20_000 });

  await signInAs(page, specialistUsername.toLowerCase(), specialistPassword);
  await expect(page.locator('#header-user-role')).toHaveText('Operations Specialist');
  await expect(page.locator('#chart-staff-title')).toHaveText('My Workload Overview');
  await expect(page.locator('#chart-client-title')).toHaveText('My Client Activity');

  await api(request, 'PUT', '/presence/me', {
    token: adminToken,
    data: {
      online: true,
      status: 'online',
      browser: 'Playwright Admin Browser',
      device: 'Admin Browser',
    },
  });

  await openUserMenu(page);
  await expect(page.locator('#btn-open-admin-portal')).toBeHidden();
  const adminPresenceRow = page.locator('#header-presence-list > div').filter({ hasText: 'Pritheeswarar' }).first();
  await expect.poll(async () => adminPresenceRow.textContent(), { timeout: 20_000 }).toContain('Online');
  await page.click('#btn-open-profile');
  await expect(page.locator('#profile-role')).toBeDisabled();
  await expect(page.locator('#profile-role')).toHaveValue('Operations Specialist');
  await closeModal(page, '#modal-profile');

  await page.locator('.nav-tab[data-target="view-tasks"]').click();
  await expect(page.locator('#view-tasks .btn-add-task').first()).toBeVisible();
  await page.locator('.nav-tab[data-target="view-clients"]').click();
  await expect(page.locator('#btn-add-client')).toBeHidden();

  await page.locator('.nav-tab[data-target="view-tasks"]').click();
  await searchTasks(page, adminTaskName);

  const adminTaskRow = page.locator('#tasks-table-body tr').filter({ hasText: adminTaskName }).first();
  await expect(adminTaskRow).toBeVisible();
  await expect(adminTaskRow.locator('button[title="Update Status"]')).toHaveCount(1);
  await expect(adminTaskRow.locator('button[title="Delete"]')).toHaveCount(0);
  await adminTaskRow.locator('td:nth-child(5) div').click();
  await expect(page.locator('#modal-task')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#modal-task-title')).toHaveText('Update Task Status');
  await expect(page.locator('#task-name')).toBeDisabled();
  await expect(page.locator('#task-status')).toBeEnabled();
  await expect(page.locator('#btn-add-followup')).toBeVisible();
  const assignedTaskStatusOptions = await page.locator('#task-status option').allTextContents();
  expect(assignedTaskStatusOptions).toEqual(expect.arrayContaining(['In Progress', 'Waiting Client', 'Completed']));
  await page.selectOption('#task-status', 'Waiting Client');
  await page.click('#btn-save-task');
  await expect(page.locator('#modal-task')).toBeHidden({ timeout: 20_000 });
  await expect(adminTaskRow).toContainText('Waiting Client');

  const assignedTasksAfterStatusUpdate = await api(request, 'GET', `/tasks?client=${encodeURIComponent(clientName)}`, {
    token: adminToken,
  });
  const assignedPrimaryTask = (assignedTasksAfterStatusUpdate.payload.data || []).find((task) => task.id === adminAssignedTask.payload.data.id);
  expect(assignedPrimaryTask?.status).toBe('Waiting Client');

  await adminTaskRow.locator('td:nth-child(5) div').click();
  await expect(page.locator('#btn-add-followup')).toBeVisible();

  await page.click('#btn-add-followup');
  await expect(page.locator('#modal-task')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#modal-task-title')).toHaveText('Add New Task');
  await page.fill('#task-name', followUpTaskName);
  await page.fill('#task-due-date', followUpDueDate);
  await page.fill('#task-notes', 'Created as a specialist follow-up');
  await page.click('#btn-save-task');
  await expect(page.locator('#modal-task')).toBeHidden({ timeout: 20_000 });

  await searchTasks(page, followUpTaskName);
  const followUpRow = page.locator('#tasks-table-body tr').filter({ hasText: followUpTaskName }).first();
  await expect(followUpRow).toBeVisible();
  await expect(followUpRow.locator('button[title="Edit"]')).toHaveCount(1);
  await expect(followUpRow.locator('button[title="Delete"]')).toHaveCount(1);

  await searchTasks(page, '');
  await page.locator('#view-tasks .btn-add-task').first().click();
  await expect(page.locator('#modal-task')).toBeVisible({ timeout: 15_000 });
  await page.selectOption('#task-client', clientName);
  await page.fill('#task-name', specialistTaskName);
  await page.fill('#task-due-date', specialistDueDate);
  await page.fill('#task-notes', 'Created directly by the specialist');
  await page.click('#btn-save-task');
  await expect(page.locator('#modal-task')).toBeHidden({ timeout: 20_000 });

  await searchTasks(page, specialistTaskName);
  const specialistTaskRow = page.locator('#tasks-table-body tr').filter({ hasText: specialistTaskName }).first();
  await expect(specialistTaskRow).toBeVisible();
  await expect(specialistTaskRow.locator('button[title="Edit"]')).toHaveCount(1);
  await expect(specialistTaskRow.locator('button[title="Delete"]')).toHaveCount(1);
  await specialistTaskRow.locator('td:nth-child(5) div').click();
  await expect(page.locator('#modal-task-title')).toHaveText('Edit Task');
  await expect(page.locator('#task-name')).toBeEnabled();
  await page.fill('#task-notes', 'Updated by the specialist after creation');
  await page.click('#btn-save-task');
  await expect(page.locator('#modal-task')).toBeHidden({ timeout: 20_000 });

  const specialistToken = await page.evaluate(() => {
    try {
      const raw = sessionStorage.getItem('currentUser') || localStorage.getItem('currentUser') || 'null';
      return JSON.parse(raw)?.accessToken || null;
    } catch (error) {
      return null;
    }
  });
  expect(specialistToken).toBeTruthy();

  const forbiddenTaskEdit = await api(request, 'PUT', `/tasks/${adminAssignedTask.payload.data.id}`, {
    token: specialistToken,
    expectedStatus: 403,
    data: {
      client: clientName,
      project: 'Specialist Access Validation',
      task: `${adminTaskName} edited`,
      staff: specialistUsername,
      status: 'In Progress',
      priority: 'High',
      startDate: '',
      dueDate: '',
      waitingFor: '',
      notes: 'This edit should be rejected',
      parentId: null,
      version: adminAssignedTask.payload.data.version,
    },
  });
  expect(String(forbiddenTaskEdit.payload.detail)).toContain('only edit tasks they created');

  const forbiddenDelete = await api(request, 'DELETE', `/tasks/${adminAssignedTask.payload.data.id}`, {
    token: specialistToken,
    expectedStatus: 403,
  });
  expect(String(forbiddenDelete.payload.detail)).toContain('only delete tasks they created');

  await searchTasks(page, adminTaskName);
  await page.locator('#tasks-table-body tr').filter({ hasText: adminTaskName }).first().locator('td:nth-child(5) div').click();
  await page.selectOption('#task-status', 'Completed');
  await page.click('#btn-save-task');
  await expect(page.locator('#modal-task')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('#tasks-table-body tr').filter({ hasText: adminTaskName }).first()).toContainText('Completed');

  const forbiddenRoleChange = await request.patch(`${API_BASE}/admin/users/Eshwar/role`, {
    headers: {
      Authorization: `Bearer ${specialistToken}`,
    },
    data: { role: 'Operations Manager' },
    failOnStatusCode: false,
  });
  expect(forbiddenRoleChange.status()).toBe(403);

  await api(request, 'DELETE', `/tasks/${adminAssignedTask.payload.data.id}`, {
    token: adminToken,
    expectedStatus: [200, 404],
  });

  const visibleTasksAfterSpecFlow = await api(request, 'GET', `/tasks?client=${encodeURIComponent(clientName)}`, {
    token: adminToken,
  });

  for (const task of visibleTasksAfterSpecFlow.payload.data || []) {
    await api(request, 'DELETE', `/tasks/${task.id}`, {
      token: adminToken,
      expectedStatus: [200, 404],
    });
  }

  await api(request, 'DELETE', `/clients/${createdClient.payload.data.id}`, {
    token: adminToken,
    expectedStatus: [200, 404],
  });

  await api(request, 'PUT', '/presence/me', {
    token: adminToken,
    data: {
      online: false,
      status: 'offline',
      browser: 'Playwright Admin Browser',
      device: 'Admin Browser',
    },
  });
});