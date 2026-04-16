const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

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

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sanitizeLabel(value) {
  return String(value || 'screen').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96);
}

async function signIn(page, cfg) {
  await page.goto(cfg.frontendUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#login-form')).toBeVisible({ timeout: 30_000 });

  await page.fill('#login-username', cfg.username);
  await page.fill('#login-password', cfg.password);
  await page.locator('#login-form button[type="submit"]').click();

  await expect(page.locator('#main-content')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#main-header')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#global-loader')).toBeHidden({ timeout: 30_000 }).catch(() => {});
}

async function goToTab(page, targetId) {
  await page.locator(`.nav-tab[data-target="${targetId}"]`).click();
  await expect(page.locator(`#${targetId}`)).toBeVisible({ timeout: 30_000 });
}

async function waitForDashboardReady(page) {
  await expect(page.locator('#dashboard-metrics')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#chart-staff-title')).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => page.evaluate(() => {
    const chart = typeof Chart !== 'undefined' ? Chart.getChart(document.getElementById('chart-staff')) : null;
    return Array.isArray(chart?.data?.labels) ? chart.data.labels.length : 0;
  }), { timeout: 30_000 }).toBeGreaterThan(0);
}

async function waitForKanbanReady(page) {
  await expect(page.locator('#kanban-board')).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => page.locator('#kanban-board > *').count(), { timeout: 30_000 }).toBeGreaterThan(0);
}

async function waitForAllTasksReady(page) {
  await expect(page.locator('#table-container')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#tasks-count-display')).toContainText('Showing', { timeout: 30_000 });
}

async function waitForTodayReady(page) {
  await expect(page.locator('#today-metrics')).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => {
    const text = await page.locator('#today-date-display').textContent();
    return String(text || '').trim().length;
  }, { timeout: 30_000 }).toBeGreaterThan(0);
}

async function waitForClientsReady(page) {
  await expect(page.locator('#view-clients h2')).toHaveText('Manage Clients', { timeout: 30_000 });
  await expect(page.locator('#clients-table-body')).toBeVisible({ timeout: 30_000 });
}

async function capture(page, dirPath, label, index, testInfo) {
  const fileName = `${String(index).padStart(2, '0')}-${sanitizeLabel(label)}.png`;
  const outputPath = path.join(dirPath, fileName);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: outputPath, fullPage: true });
  await testInfo.attach(label, { path: outputPath, contentType: 'image/png' });

  return { label, fileName, path: outputPath, capturedAt: new Date().toISOString() };
}

test.use({
  trace: 'retain-on-failure',
  screenshot: 'on',
  video: 'retain-on-failure',
  viewport: { width: 1720, height: 1200 },
});

test('live app screen capture for core views', async ({ page }, testInfo) => {
  test.setTimeout(240_000);

  const cfg = runtimeConfig();
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.resolve(process.cwd(), 'test-results', `live-screen-capture-${runId}`);
  const reportPath = path.join(runDir, 'screen-capture-report.json');
  const report = {
    capturedAt: new Date().toISOString(),
    frontendUrl: cfg.frontendUrl,
    username: cfg.username,
    screenshots: [],
  };

  ensureDir(runDir);

  await signIn(page, cfg);
  await waitForDashboardReady(page);
  report.screenshots.push(await capture(page, runDir, 'dashboard', 1, testInfo));

  await goToTab(page, 'view-kanban');
  await waitForKanbanReady(page);
  report.screenshots.push(await capture(page, runDir, 'kanban-board', 2, testInfo));

  await goToTab(page, 'view-tasks');
  await waitForAllTasksReady(page);
  report.screenshots.push(await capture(page, runDir, 'all-tasks', 3, testInfo));

  await goToTab(page, 'view-today');
  await waitForTodayReady(page);
  report.screenshots.push(await capture(page, runDir, 'todays-tasks', 4, testInfo));

  await goToTab(page, 'view-clients');
  await waitForClientsReady(page);
  report.screenshots.push(await capture(page, runDir, 'clients', 5, testInfo));

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  await testInfo.attach('screen-capture-report', { path: reportPath, contentType: 'application/json' });

  console.log(`Live screen capture artifacts: ${runDir}`);
});