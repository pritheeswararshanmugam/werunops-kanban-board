const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const DEFAULT_FRONTEND_URL = 'https://pritheeswararshanmugam.github.io/werunops-kanban-board/';
const DEFAULT_BACKEND_URL = 'https://werunops-kanban-board-5pqv.vercel.app/api/v1';
const DEFAULT_USERNAME = 'Eshwar';
const DEFAULT_PASSWORD = '110495';

function runtimeConfig() {
  return {
    frontendUrl: process.env.WERUNOPS_LIVE_FRONTEND_URL || DEFAULT_FRONTEND_URL,
    backendUrl: process.env.WERUNOPS_LIVE_BACKEND_URL || DEFAULT_BACKEND_URL,
    username: process.env.WERUNOPS_E2E_USERNAME || DEFAULT_USERNAME,
    password: process.env.WERUNOPS_E2E_PASSWORD || DEFAULT_PASSWORD,
    managerUsername: process.env.WERUNOPS_E2E_MANAGER_USERNAME || 'Sudhar',
    managerPassword: process.env.WERUNOPS_E2E_MANAGER_PASSWORD || '',
    userUsername: process.env.WERUNOPS_E2E_USER_USERNAME || 'Mubarak',
    userPassword: process.env.WERUNOPS_E2E_USER_PASSWORD || '',
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

async function gotoLogin(page, cfg) {
  await page.goto(cfg.frontendUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#login-form')).toBeVisible({ timeout: 30_000 });
}

async function submitLogin(page, username, password) {
  await page.fill('#login-username', username);
  await page.fill('#login-password', password);
  await page.locator('#login-form button[type="submit"]').click();
}

async function attemptUiLogin(page, cfg, username, password) {
  await gotoLogin(page, cfg);
  await submitLogin(page, username, password);

  const mainContent = page.locator('#main-content');
  const errorMsg = page.locator('#login-error-msg');

  const success = await mainContent.waitFor({ state: 'visible', timeout: 20_000 }).then(() => true).catch(() => false);
  if (success) {
    const roleText = await page.locator('#header-user-role').textContent().catch(() => '');
    return { success: true, roleText: String(roleText || '').trim(), errorText: '' };
  }

  const errorText = await errorMsg.textContent().catch(() => '');
  return { success: false, roleText: '', errorText: String(errorText || '').trim() };
}

async function signIn(page, cfg) {
  const result = await attemptUiLogin(page, cfg, cfg.username, cfg.password);
  expect(result.success).toBeTruthy();
  await expect(page.locator('#main-content')).toBeVisible({ timeout: 30_000 });
}

async function openUserMenu(page) {
  await page.locator('#header-user-menu-btn').click();
  await expect(page.locator('#header-user-panel')).toBeVisible({ timeout: 15_000 });
}

async function evaluateRoleAudit(page) {
  return page.evaluate(() => {
    const panel = document.getElementById('header-user-panel');
    const adminPortalBtn = document.getElementById('btn-open-admin-portal');
    const presenceList = document.getElementById('header-presence-list');
    const presenceBadges = Array.from(presenceList?.querySelectorAll('span') || [])
      .map((node) => String(node.textContent || '').trim())
      .filter(Boolean);
    const bodyText = String(document.body.innerText || '');

    return {
      headerRole: String(document.getElementById('header-user-role')?.textContent || '').trim(),
      portalVisible: !!adminPortalBtn && !adminPortalBtn.classList.contains('hidden'),
      portalHref: String(adminPortalBtn?.getAttribute('href') || ''),
      userStatusTitle: String(document.getElementById('user-status-dot')?.getAttribute('title') || ''),
      visiblePresenceBadges: presenceBadges,
      hasAwayText: bodyText.includes('Away'),
      hasBreakText: bodyText.includes('Break'),
      hasMeetingText: bodyText.includes('Meeting'),
      hasManualPresenceControl: Array.from(document.querySelectorAll('select, button, input[type="radio"], input[type="checkbox"], a'))
        .some((node) => /away|break|meeting/i.test(String(node.textContent || node.getAttribute('value') || ''))),
      panelVisible: !!panel && !panel.classList.contains('hidden'),
    };
  });
}

async function auditRoleVisibility(browser, cfg, username, password) {
  if (!username || !password) {
    return { success: false, roleText: '', portalVisible: null, errorText: 'Credentials not configured', skipped: true };
  }

  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const login = await attemptUiLogin(page, cfg, username, password);
    if (!login.success) {
      return { success: false, roleText: '', portalVisible: null, errorText: login.errorText };
    }
    await openUserMenu(page);
    const audit = await evaluateRoleAudit(page);
    return {
      success: true,
      roleText: audit.headerRole,
      portalVisible: audit.portalVisible,
      errorText: '',
    };
  } finally {
    await context.close();
  }
}

test.use({
  trace: 'retain-on-failure',
  screenshot: 'on',
  video: 'retain-on-failure',
});

test('live operations and staff management audit captures current auth, RBAC, profile, history, and presence behavior', async ({ page, request, browser }, testInfo) => {
  test.setTimeout(480_000);

  const cfg = runtimeConfig();
  const runDir = path.resolve(process.cwd(), 'test-results', 'operations-staff-management-live-audit');
  ensureDir(runDir);

  const report = {
    generatedAt: new Date().toISOString(),
    screenshots: [],
    observations: {
      auth: {},
      profile: {},
      settings: {},
      portal: {},
      presence: {},
      rbac: {},
    },
  };

  const variantUsername = cfg.username.toUpperCase();
  const variantResponse = await request.post(`${cfg.backendUrl}/auth/login`, {
    data: { username: variantUsername, password: cfg.password },
    failOnStatusCode: false,
  });
  const variantPayload = await variantResponse.json().catch(() => null);
  report.observations.auth.caseInsensitiveBackendLogin = {
    attemptedUsername: variantUsername,
    status: variantResponse.status(),
    ok: variantResponse.ok(),
    detail: variantPayload?.detail || variantPayload?.data || null,
  };

  await signIn(page, cfg);
  report.screenshots.push(await saveScreenshot(page, runDir, 'live-ops-dashboard-after-login'));

  await openUserMenu(page);
  const roleAudit = await evaluateRoleAudit(page);
  report.observations.rbac.primaryUser = {
    username: cfg.username,
    headerRole: roleAudit.headerRole,
    portalVisible: roleAudit.portalVisible,
    portalHref: roleAudit.portalHref,
  };
  report.observations.presence = {
    userStatusTitle: roleAudit.userStatusTitle,
    visiblePresenceBadges: roleAudit.visiblePresenceBadges,
    hasAwayText: roleAudit.hasAwayText,
    hasBreakText: roleAudit.hasBreakText,
    hasMeetingText: roleAudit.hasMeetingText,
    hasManualPresenceControl: roleAudit.hasManualPresenceControl,
  };
  report.screenshots.push(await saveScreenshot(page, runDir, 'live-ops-user-menu'));

  await expect(page.locator('#btn-open-admin-portal')).toBeVisible({ timeout: 15_000 });
  const [popup] = await Promise.all([
    page.waitForEvent('popup', { timeout: 20_000 }),
    page.click('#btn-open-admin-portal'),
  ]);
  await popup.waitForLoadState('domcontentloaded', { timeout: 30_000 });
  report.observations.portal = {
    popupUrl: popup.url(),
    usesAccessTokenQuery: /[?&]accessToken=/i.test(popup.url()),
  };
  report.screenshots.push(await saveScreenshot(popup, runDir, 'live-ops-admin-portal-launch'));
  await popup.close();

  await openUserMenu(page);
  await page.click('#btn-open-profile');
  await expect(page.locator('#modal-profile')).toBeVisible({ timeout: 15_000 });
  report.observations.profile = await page.evaluate(() => ({
    roleFieldExists: !!document.getElementById('profile-role'),
    roleFieldDisabled: !!document.getElementById('profile-role')?.hasAttribute('disabled'),
    roleFieldReadOnly: !!document.getElementById('profile-role')?.hasAttribute('readonly'),
    roleFieldValue: String(document.getElementById('profile-role')?.value || ''),
  }));
  report.screenshots.push(await saveScreenshot(page, runDir, 'live-ops-profile-modal'));
  await page.locator('#modal-profile button.btn-close-profile-modal').first().click();
  await expect(page.locator('#modal-profile')).toBeHidden({ timeout: 15_000 });

  await openUserMenu(page);
  const sessionsResponsePromise = page.waitForResponse(
    (response) => response.url().includes('/api/v1/sessions') && response.request().method() === 'GET',
    { timeout: 20_000 }
  ).catch(() => null);
  await page.click('#btn-open-settings');
  await expect(page.locator('#modal-settings')).toBeVisible({ timeout: 15_000 });
  const sessionsResponse = await sessionsResponsePromise;
  const sessionsPayload = sessionsResponse ? await sessionsResponse.json().catch(() => null) : null;
  const sessions = Array.isArray(sessionsPayload?.data) ? sessionsPayload.data : [];
  const uniqueUsernames = Array.from(new Set(sessions.map((entry) => String(entry?.username || '')).filter(Boolean))).sort();
  report.observations.settings = {
    requestUrl: sessionsResponse ? sessionsResponse.url() : '',
    requestIncludesUsernameFilter: sessionsResponse ? /[?&]username=/i.test(sessionsResponse.url()) : false,
    returnedSessionCount: sessions.length,
    uniqueUsernames,
    renderedUserColumnValues: await page.locator('#login-history-list tr td:first-child').allTextContents(),
  };
  report.screenshots.push(await saveScreenshot(page, runDir, 'live-ops-settings-modal'));

  report.observations.rbac.managerCandidate = await auditRoleVisibility(browser, cfg, cfg.managerUsername, cfg.managerPassword);
  report.observations.rbac.userCandidate = await auditRoleVisibility(browser, cfg, cfg.userUsername, cfg.userPassword);

  const reportPath = path.join(runDir, 'operations-staff-management-live-audit-latest.json');
  const reportText = JSON.stringify(report, null, 2);
  fs.writeFileSync(reportPath, reportText, 'utf8');

  await testInfo.attach('operations-staff-management-live-audit-latest.json', {
    body: reportText,
    contentType: 'application/json',
  });
});