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
  return String(value || 'artifact').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 96);
}

async function saveScreenshot(page, dirPath, label) {
  const fileName = `${Date.now()}-${sanitizeLabel(label)}.png`;
  const outputPath = path.join(dirPath, fileName);
  await page.screenshot({ path: outputPath, fullPage: true });
  return fileName;
}

async function signIn(page, cfg) {
  await page.goto(cfg.frontendUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#login-form')).toBeVisible({ timeout: 30_000 });
  await page.fill('#login-username', cfg.username);
  await page.fill('#login-password', cfg.password);
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page.locator('#main-content')).toBeVisible({ timeout: 30_000 });
}

async function openAdminPortal(page) {
  await page.locator('#header-user-menu-btn').click();
  await expect(page.locator('#btn-open-admin-portal')).toBeVisible({ timeout: 15_000 });

  const [popup] = await Promise.all([
    page.waitForEvent('popup', { timeout: 20_000 }),
    page.click('#btn-open-admin-portal'),
  ]);

  await popup.waitForLoadState('domcontentloaded', { timeout: 30_000 });
  await expect(popup.locator('#tabs')).toBeVisible({ timeout: 30_000 });
  return popup;
}

async function clickPortalTab(page, tabLabel) {
  await page.locator(`#tabs .tab:text-is("${tabLabel}")`).click();
}

test.use({
  trace: 'retain-on-failure',
  screenshot: 'on',
  video: 'retain-on-failure',
});

test('live admin portal audit captures current UX behavior with screenshots', async ({ page }, testInfo) => {
  test.setTimeout(420_000);

  const cfg = runtimeConfig();
  const runDir = path.resolve(process.cwd(), 'test-results', 'admin-portal-live-audit');
  ensureDir(runDir);

  const report = {
    generatedAt: new Date().toISOString(),
    screenshots: [],
    observations: {},
  };

  await signIn(page, cfg);
  const popup = await openAdminPortal(page);

  report.screenshots.push(await saveScreenshot(popup, runDir, 'live-admin-portal-overview'));

  report.observations.chart = await popup.evaluate(() => ({
    usesCanvas: Boolean(document.querySelector('#chart-hours')?.tagName === 'CANVAS'),
    rowMarkupCount: document.querySelectorAll('[data-hours-chart-row]').length,
    canvasTextHint: document.querySelector('#chart-hours')?.getAttribute('aria-label') || '',
  }));

  report.observations.heatmap = await popup.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('#heatmap .heat')).slice(0, 5);
    return {
      cellCount: document.querySelectorAll('#heatmap .heat').length,
      dateLabelCount: document.querySelectorAll('[data-heatmap-date]').length,
      sampleTitles: cells.map((cell) => cell.getAttribute('title') || ''),
    };
  });

  await clickPortalTab(popup, 'Sessions & Reports');
  await expect(popup.locator('#sec-sessions')).toBeVisible({ timeout: 15_000 });
  const [weeklyDownload] = await Promise.all([
    popup.waitForEvent('download', { timeout: 20_000 }),
    popup.click('#btn-report-weekly'),
  ]);
  report.observations.weeklyReportDownload = weeklyDownload.suggestedFilename();

  await clickPortalTab(popup, 'Users');
  await expect(popup.locator('#sec-users')).toBeVisible({ timeout: 15_000 });
  report.screenshots.push(await saveScreenshot(popup, runDir, 'live-admin-portal-users'));
  report.observations.usernamesVisible = await popup.locator('#tbl-users tr td:first-child').allTextContents();

  await clickPortalTab(popup, 'Task Ops');
  await expect(popup.locator('#sec-tasks')).toBeVisible({ timeout: 15_000 });
  report.screenshots.push(await saveScreenshot(popup, runDir, 'live-admin-portal-task-ops'));

  await clickPortalTab(popup, 'Compliance');
  await expect(popup.locator('#sec-compliance')).toBeVisible({ timeout: 15_000 });
  const beforeRefresh = await popup.locator('#tbl-audit').textContent().catch(() => '');
  const auditResponsePromise = popup.waitForResponse((response) => response.url().includes('/api/v1/admin/audit-logs') && response.request().method() === 'GET', { timeout: 20_000 }).catch(() => null);
  await popup.click('#btn-refresh-audit');
  const auditResponse = await auditResponsePromise;
  const afterRefresh = await popup.locator('#tbl-audit').textContent().catch(() => '');
  report.screenshots.push(await saveScreenshot(popup, runDir, 'live-admin-portal-compliance'));
  report.observations.auditRefresh = {
    networkStatus: auditResponse ? auditResponse.status() : null,
    visibleContentChanged: String(beforeRefresh || '') !== String(afterRefresh || ''),
  };

  const reportPath = path.join(runDir, 'admin-portal-live-audit-latest.json');
  const reportText = JSON.stringify(report, null, 2);
  fs.writeFileSync(reportPath, reportText, 'utf8');

  await testInfo.attach('admin-portal-live-audit-latest.json', {
    body: reportText,
    contentType: 'application/json',
  });

  await popup.close();
});