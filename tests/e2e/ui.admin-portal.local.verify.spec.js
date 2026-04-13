const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const { resetBrowserState, signIn } = require('./ui.helpers');

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
  await expect(page.locator(`#tabs .tab.active:text-is("${tabLabel}")`)).toBeVisible({ timeout: 10_000 });
}

async function captureCsvDownload(page, buttonSelector) {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20_000 }),
    page.click(buttonSelector),
  ]);
  return download.suggestedFilename();
}

test.use({
  trace: 'retain-on-failure',
  screenshot: 'on',
  video: 'retain-on-failure',
});

test('admin portal locally keeps context, refreshes widgets, and exports csv reports', async ({ page }, testInfo) => {
  test.setTimeout(420_000);

  const runDir = path.resolve(process.cwd(), 'test-results', 'admin-portal-local-verify');
  ensureDir(runDir);

  const report = {
    generatedAt: new Date().toISOString(),
    screenshots: [],
    downloads: {},
    observations: {},
  };

  await resetBrowserState(page);
  await signIn(page);
  const popup = await openAdminPortal(page);

  report.screenshots.push(await saveScreenshot(popup, runDir, 'local-admin-portal-overview'));
  report.observations.overview = await popup.evaluate(() => ({
    usesCanvas: Boolean(document.querySelector('#chart-hours')?.tagName === 'CANVAS'),
    chartRowCount: document.querySelectorAll('[data-hours-chart-row]').length,
    heatmapDateLabelCount: document.querySelectorAll('[data-heatmap-date]').length,
    heatmapCellCount: document.querySelectorAll('#heatmap .heat-cell').length,
  }));

  await clickPortalTab(popup, 'Sessions & Reports');
  report.screenshots.push(await saveScreenshot(popup, runDir, 'local-admin-portal-sessions'));
  report.downloads.weekly = await captureCsvDownload(popup, '#btn-report-weekly');
  report.downloads.monthly = await captureCsvDownload(popup, '#btn-report-monthly');
  report.downloads.loginHistory = await captureCsvDownload(popup, '#btn-report-login-history');
  report.downloads.utilization = await captureCsvDownload(popup, '#btn-report-utilization');
  report.downloads.billing = await captureCsvDownload(popup, '#btn-report-billing');
  report.downloads.approvals = await captureCsvDownload(popup, '#btn-report-approvals');

  await clickPortalTab(popup, 'Users');
  const createdUsername = `PortalVerify${Date.now()}`;
  await popup.fill('#new-user-username', createdUsername);
  await popup.fill('#new-user-name', 'Portal Verify User');
  await popup.fill('#new-user-password', 'verify123');
  await popup.fill('#new-user-department', 'QA');
  await popup.fill('#new-user-timezone', 'UTC');
  await popup.click('#btn-create-user');
  await expect(popup.locator('#tabs .tab.active:text-is("Users")')).toBeVisible({ timeout: 15_000 });
  await expect(popup.locator('#tbl-users')).toContainText(createdUsername, { timeout: 20_000 });
  report.screenshots.push(await saveScreenshot(popup, runDir, 'local-admin-portal-users'));
  report.observations.users = {
    createdUsername,
    activeTabAfterCreate: await popup.locator('#tabs .tab.active').textContent(),
  };

  await clickPortalTab(popup, 'Task Ops');
  await popup.fill('#comment-task-id', '1');
  await popup.fill('#comment-text', 'Portal verification comment');
  await popup.click('#btn-add-comment');
  await expect(popup.locator('#tabs .tab.active:text-is("Task Ops")')).toBeVisible({ timeout: 15_000 });
  await expect(popup.locator('#tbl-comments')).toContainText('Portal verification comment', { timeout: 20_000 });
  report.screenshots.push(await saveScreenshot(popup, runDir, 'local-admin-portal-task-ops'));
  report.observations.tasks = {
    activeTabAfterComment: await popup.locator('#tabs .tab.active').textContent(),
  };

  await popup.reload({ waitUntil: 'domcontentloaded' });
  await expect(popup.locator('#tabs')).toBeVisible({ timeout: 20_000 });
  await expect(popup.locator('#tabs .tab.active:text-is("Task Ops")')).toBeVisible({ timeout: 20_000 });
  report.observations.tabPersistenceAfterReload = await popup.locator('#tabs .tab.active').textContent();

  await clickPortalTab(popup, 'Compliance');
  await popup.click('#btn-refresh-audit');
  await expect(popup.locator('#audit-refresh-status')).toContainText('Refreshed', { timeout: 20_000 });
  report.screenshots.push(await saveScreenshot(popup, runDir, 'local-admin-portal-compliance'));
  report.observations.audit = {
    status: await popup.locator('#audit-refresh-status').textContent(),
    rows: await popup.locator('#tbl-audit tr').count(),
  };

  const reportPath = path.join(runDir, 'admin-portal-local-verify-latest.json');
  const reportText = JSON.stringify(report, null, 2);
  fs.writeFileSync(reportPath, reportText, 'utf8');

  await testInfo.attach('admin-portal-local-verify-latest.json', {
    body: reportText,
    contentType: 'application/json',
  });

  expect(report.observations.overview.usesCanvas).toBeFalsy();
  expect(report.observations.overview.chartRowCount).toBeGreaterThan(0);
  expect(report.observations.overview.heatmapDateLabelCount).toBeGreaterThanOrEqual(7);
  Object.values(report.downloads).forEach((fileName) => expect(fileName.endsWith('.csv')).toBeTruthy());

  await popup.close();
});