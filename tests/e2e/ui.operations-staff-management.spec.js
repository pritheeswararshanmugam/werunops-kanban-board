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

test.beforeEach(async ({ page }) => {
  await resetBrowserState(page);
});

test('operations and staff management flows honor the new auth, presence, and RBAC rules', async ({ page, request }) => {
  test.setTimeout(180_000);

  const adminToken = await apiLogin(request);
  const specialistUsername = `OpsSpec${Date.now()}`;
  const specialistPassword = 'OpsSpec!123';
  await createOperationsSpecialist(request, adminToken, specialistUsername, specialistPassword);

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
  await expect.poll(() => popup.url(), { timeout: 20_000 }).toMatch(/\/admin\/portal\?accessToken=/i);
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

  await openUserMenu(page);
  await expect(page.locator('#btn-open-admin-portal')).toBeHidden();
  await page.click('#btn-open-profile');
  await expect(page.locator('#profile-role')).toBeDisabled();
  await expect(page.locator('#profile-role')).toHaveValue('Operations Specialist');
  await closeModal(page, '#modal-profile');

  await page.locator('.nav-tab[data-target="view-tasks"]').click();
  await expect(page.locator('#view-tasks .btn-add-task').first()).toBeHidden();
  await page.locator('.nav-tab[data-target="view-clients"]').click();
  await expect(page.locator('#btn-add-client')).toBeHidden();

  const specialistToken = await page.evaluate(() => {
    try {
      const raw = sessionStorage.getItem('currentUser') || localStorage.getItem('currentUser') || 'null';
      return JSON.parse(raw)?.accessToken || null;
    } catch (error) {
      return null;
    }
  });
  expect(specialistToken).toBeTruthy();

  const forbiddenRoleChange = await request.patch(`${API_BASE}/admin/users/Eshwar/role`, {
    headers: {
      Authorization: `Bearer ${specialistToken}`,
    },
    data: { role: 'Operations Manager' },
    failOnStatusCode: false,
  });
  expect(forbiddenRoleChange.status()).toBe(403);
});