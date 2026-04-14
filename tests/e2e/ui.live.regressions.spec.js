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

async function getSessionData(page) {
  return page.evaluate(() => {
    try {
      const raw = sessionStorage.getItem('currentUser') || localStorage.getItem('currentUser');
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  });
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

async function selectNonDefaultStaff(page) {
  const choice = await page.evaluate(() => {
    const select = document.querySelector('#task-staff');
    if (!select) return null;

    const options = Array.from(select.options || []).filter((option) => option.value && !option.disabled);
    if (!options.length) return null;

    const first = options[0];
    const second = options.length > 1 ? options[1] : options[0];
    return {
      first: first.value,
      selected: second.value,
      selectedLabel: String(second.label || second.textContent || second.value).trim(),
    };
  });

  if (!choice || !choice.selected) {
    throw new Error('No staff options available in task form.');
  }

  await page.selectOption('#task-staff', choice.selected);
  return choice;
}

test.use({
  trace: 'retain-on-failure',
  screenshot: 'on',
  video: 'retain-on-failure',
});

test('live admin portal opens in a new tab', async ({ page }) => {
  const cfg = runtimeConfig();

  await signIn(page, cfg);
  const session = await getSessionData(page);
  expect(session?.role?.toLowerCase()).toBe('admin');

  await page.locator('#header-user-menu-btn').click();
  await expect(page.locator('#btn-open-admin-portal')).toBeVisible({ timeout: 15_000 });

  const [popup] = await Promise.all([
    page.waitForEvent('popup', { timeout: 20_000 }),
    page.click('#btn-open-admin-portal'),
  ]);

  await popup.waitForLoadState('domcontentloaded', { timeout: 30_000 });
  await expect.poll(() => popup.url(), { timeout: 20_000 }).toMatch(/\/admin\/portal\?accessToken=/i);

  await popup.close();
});

test('live auth session is scoped to the current browser session', async ({ page }) => {
  const cfg = runtimeConfig();

  await signIn(page, cfg);

  const storageState = await page.evaluate(() => ({
    sessionUser: sessionStorage.getItem('currentUser'),
    localUser: localStorage.getItem('currentUser'),
  }));

  expect(storageState.sessionUser).toBeTruthy();
  expect(storageState.localUser).toBeNull();

  await page.reload();
  await expect(page.locator('#main-content')).toBeVisible({ timeout: 30_000 });
});

test('live stale persistent localStorage session is ignored on first load', async ({ page }) => {
  const cfg = runtimeConfig();

  await page.goto(cfg.frontendUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#login-form')).toBeVisible({ timeout: 30_000 });

  await page.evaluate(() => {
    sessionStorage.clear();
    localStorage.setItem('currentUser', JSON.stringify({
      username: 'Eshwar',
      name: 'Pritheeswarar',
      role: 'Admin',
      initials: 'P',
      accessToken: 'stale-token',
    }));
  });

  await page.reload({ waitUntil: 'domcontentloaded' });

  await expect(page.locator('#login-form')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#main-header')).toBeHidden();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('currentUser'))).toBeNull();
});

test('live workload chart should not render duplicate staff labels', async ({ page }) => {
  const cfg = runtimeConfig();

  await signIn(page, cfg);

  await expect.poll(async () => page.evaluate(() => {
    const chart = typeof Chart !== 'undefined' ? Chart.getChart(document.getElementById('chart-staff')) : null;
    return Array.isArray(chart?.data?.labels) ? chart.data.labels.length : 0;
  }), { timeout: 30_000 }).toBeGreaterThan(0);

  const labels = await page.evaluate(() => {
    const chart = typeof Chart !== 'undefined' ? Chart.getChart(document.getElementById('chart-staff')) : null;
    return Array.isArray(chart?.data?.labels) ? [...chart.data.labels] : [];
  });

  const uniqueLabels = new Set(labels.map((label) => String(label)));
  expect(uniqueLabels.size).toBe(labels.length);
});

test('live task assignee should not reset during background sync', async ({ page }) => {
  const cfg = runtimeConfig();
  const runId = Date.now();
  const taskName = `PW-LIVE-ASSIGNEE-${runId}`;
  const dueDate = new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0];

  await signIn(page, cfg);

  await page.locator('.nav-tab[data-target="view-tasks"]').click();
  await expect(page.locator('#view-tasks')).toBeVisible({ timeout: 20_000 });

  await page.locator('#view-tasks .btn-add-task').first().click();
  await expect(page.locator('#modal-task')).toBeVisible({ timeout: 20_000 });

  await selectFirstAvailableOption(page, '#task-client');
  await page.fill('#task-project', 'Live Regression');
  await page.fill('#task-name', taskName);

  const staffChoice = await selectNonDefaultStaff(page);
  await page.fill('#task-due-date', dueDate);

  await page.waitForTimeout(11_000);

  const selectedAfterSync = await page.locator('#task-staff').inputValue();
  expect(
    selectedAfterSync,
    `Assignee changed during background sync. Expected ${staffChoice.selected}, got ${selectedAfterSync}`
  ).toBe(staffChoice.selected);

  await page.click('#btn-save-task');
  await expect(page.locator('#modal-task')).toBeHidden({ timeout: 30_000 });

  await page.fill('#tasks-search', taskName);
  const row = page.locator('#tasks-table-body tr', { hasText: taskName }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row).toContainText(staffChoice.selectedLabel);

  await row.locator('td:nth-child(5) .hover\\:underline, td:nth-child(5) div').first().click().catch(async () => {
    await page.evaluate((name) => {
      const rows = Array.from(document.querySelectorAll('#tasks-table-body tr'));
      const hit = rows.find((rowEl) => rowEl.textContent && rowEl.textContent.includes(name));
      if (!hit) return;
      const idCell = hit.querySelector('td:nth-child(2)');
      const raw = idCell ? idCell.textContent : '';
      const parsed = parseInt(String(raw || '').replace('#', '').trim(), 10);
      if (Number.isFinite(parsed) && typeof window.openTaskModal === 'function') {
        window.openTaskModal(parsed);
      }
    }, taskName);
  });

  await expect(page.locator('#modal-task')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#task-staff')).toHaveValue(staffChoice.selected);
  await page.locator('.btn-close-modal').first().click();

  const session = await getSessionData(page);
  const token = session?.accessToken;
  const taskId = Number((await row.locator('td:nth-child(2)').innerText()).replace('#', '').trim());

  if (token && Number.isFinite(taskId)) {
    await page.evaluate(async ({ id, accessToken }) => {
      const backendBase = String(window.WERUNOPS_CONFIG?.backendApiBase || '').replace(/\/+$/, '');
      if (!backendBase) return;
      await fetch(`${backendBase}/tasks/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    }, { id: taskId, accessToken: token });
  }
});
