const { test, expect } = require('@playwright/test');

const DEFAULT_FRONTEND_URL = 'https://pritheeswararshanmugam.github.io/werunops-kanban-board/';

function runtimeConfig() {
  const managerPassword = process.env.WERUNOPS_E2E_MANAGER_PASSWORD || '';
  const userPassword = process.env.WERUNOPS_E2E_USER_PASSWORD || '';

  return {
    frontendUrl: process.env.WERUNOPS_LIVE_FRONTEND_URL || DEFAULT_FRONTEND_URL,
    accounts: [
      {
        key: 'pritheeswarar',
        username: process.env.WERUNOPS_E2E_USERNAME || 'Eshwar',
        password: process.env.WERUNOPS_E2E_PASSWORD || '110495',
        displayName: 'Pritheeswarar',
        roleLabel: 'System Administrator',
        staffChartTitle: 'Workload by Staff',
        clientChartTitle: 'Client Activity',
        canManageClients: true,
      },
      {
        key: 'sudharshan',
        username: process.env.WERUNOPS_E2E_MANAGER_USERNAME || 'Sudhar',
        password: managerPassword,
        displayName: 'Sudharshan',
        roleLabel: 'Operations Manager',
        staffChartTitle: 'Workload by Staff',
        clientChartTitle: 'Client Activity',
        canManageClients: true,
        missingCredentialMessage: managerPassword
          ? ''
          : 'Set WERUNOPS_E2E_MANAGER_PASSWORD to validate the live Sudharshan login.',
      },
      {
        key: 'radhakrishnan',
        username: process.env.WERUNOPS_E2E_USER_USERNAME || 'Radhakrishnan',
        password: userPassword,
        displayName: 'Radhakrishnan',
        roleLabel: 'Operations Specialist',
        staffChartTitle: 'My Workload Overview',
        clientChartTitle: 'My Client Activity',
        canManageClients: false,
        missingCredentialMessage: userPassword
          ? ''
          : 'Set WERUNOPS_E2E_USER_PASSWORD to validate the live Radhakrishnan login.',
      },
    ],
  };
}

async function signIn(page, cfg, account) {
  await page.goto(cfg.frontendUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#login-form')).toBeVisible({ timeout: 30_000 });
  await page.fill('#login-username', account.username);
  await page.fill('#login-password', account.password);
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page.locator('#main-content')).toBeVisible({ timeout: 30_000 });
}

async function waitForStaffChart(page) {
  await expect.poll(async () => page.evaluate(() => {
    const chart = typeof Chart !== 'undefined' ? Chart.getChart(document.getElementById('chart-staff')) : null;
    return Array.isArray(chart?.data?.labels) ? chart.data.labels.length : 0;
  }), { timeout: 30_000 }).toBeGreaterThan(0);
}

async function getStaffChartLabels(page) {
  return page.evaluate(() => {
    const chart = typeof Chart !== 'undefined' ? Chart.getChart(document.getElementById('chart-staff')) : null;
    return Array.isArray(chart?.data?.labels) ? [...chart.data.labels].map((label) => String(label)) : [];
  });
}

const cfg = runtimeConfig();

test.use({
  trace: 'retain-on-failure',
  screenshot: 'on',
  video: 'retain-on-failure',
});

for (const account of cfg.accounts) {
  test(`live profile login: ${account.displayName}`, async ({ page }) => {
    test.setTimeout(240_000);
    test.skip(Boolean(account.missingCredentialMessage), account.missingCredentialMessage);

    await signIn(page, cfg, account);

    await expect(page.locator('#header-user-name')).toContainText(account.displayName);
    await expect(page.locator('#header-user-role')).toHaveText(account.roleLabel);
    await expect(page.locator('#chart-staff-title')).toHaveText(account.staffChartTitle);
    await expect(page.locator('#chart-client-title')).toHaveText(account.clientChartTitle);

    await waitForStaffChart(page);

    const staffLabels = await getStaffChartLabels(page);
    if (account.key !== 'radhakrishnan') {
      const uniqueLabels = new Set(staffLabels);
      expect(uniqueLabels.size).toBe(staffLabels.length);
    }

    await page.locator('.nav-tab[data-target="view-tasks"]').click();
    await expect(page.locator('#view-tasks')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#view-tasks .btn-add-task').first()).toBeVisible();

    await page.locator('.nav-tab[data-target="view-clients"]').click();
    await expect(page.locator('#view-clients')).toBeVisible({ timeout: 20_000 });
    if (account.canManageClients) {
      await expect(page.locator('#btn-add-client')).toBeVisible();
    } else {
      await expect(page.locator('#btn-add-client')).toBeHidden();
    }
  });
}