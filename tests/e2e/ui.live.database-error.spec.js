const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const DEFAULT_FRONTEND_URL = 'https://pritheeswararshanmugam.github.io/werunops-kanban-board/';
const DEFAULT_BACKEND_URL = 'https://werunops-kanban-board-5pqv.vercel.app';
const DEFAULT_USERNAME = 'Eshwar';
const DEFAULT_PASSWORD = '110495';

function runtimeConfig() {
  return {
    frontendUrl: process.env.WERUNOPS_LIVE_FRONTEND_URL || DEFAULT_FRONTEND_URL,
    backendUrl: process.env.WERUNOPS_LIVE_BACKEND_URL || DEFAULT_BACKEND_URL,
    username: process.env.WERUNOPS_E2E_USERNAME || DEFAULT_USERNAME,
    password: process.env.WERUNOPS_E2E_PASSWORD || DEFAULT_PASSWORD,
  };
}

function sanitizeFileName(value) {
  return String(value || 'artifact').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80);
}

function compactText(value, maxLength = 1800) {
  const text = String(value ?? '');
  return text.length > maxLength ? `${text.slice(0, maxLength)}...<truncated>` : text;
}

async function selectFirstAvailableOption(page, selector) {
  const value = await page.evaluate((selectSelector) => {
    const select = document.querySelector(selectSelector);
    if (!select) return null;
    const options = Array.from(select.options || []);
    const candidate = options.find((option) => option.value && !option.disabled);
    return candidate ? candidate.value : null;
  }, selector);

  if (!value) {
    throw new Error(`No selectable option found for ${selector}. This often means upstream data did not load.`);
  }

  await page.selectOption(selector, value);
}

async function accessTokenFromSession(page) {
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

test.use({
  trace: 'on',
  screenshot: 'on',
  video: 'on',
});

test('live forensic: capture database-related runtime failures with console and trace evidence', async ({ page }, testInfo) => {
  test.setTimeout(300_000);

  const cfg = runtimeConfig();
  const runId = Date.now();
  const taskName = `PW-LIVE-DB-${runId}`;
  const dueDate = new Date(Date.now() + 4 * 86400000).toISOString().split('T')[0];
  const forensicDir = path.resolve(process.cwd(), 'test-results', 'live-db-debug');
  fs.mkdirSync(forensicDir, { recursive: true });

  const consoleEvents = [];
  const pageErrors = [];
  const requestFailures = [];
  const apiResponses = [];
  const healthSnapshots = [];
  const uiScreenshots = [];
  let screenshotCounter = 0;

  const captureUiScreenshot = async (label) => {
    screenshotCounter += 1;
    const fileName = `${String(screenshotCounter).padStart(2, '0')}-${sanitizeFileName(label)}.png`;
    const outputPath = path.join(forensicDir, fileName);
    await page.screenshot({ path: outputPath, fullPage: true });
    uiScreenshots.push({ at: new Date().toISOString(), label, fileName });
    return fileName;
  };

  page.on('console', async (message) => {
    const record = {
      at: new Date().toISOString(),
      type: message.type(),
      text: compactText(message.text(), 2000),
      location: message.location(),
    };
    consoleEvents.push(record);

    if (
      record.type === 'error'
      || record.type === 'warning'
      || /error|exception|failed|database|supabase|pgrst|table/i.test(record.text)
    ) {
      try {
        record.uiScreenshot = await captureUiScreenshot(`console-${record.type}-${consoleEvents.length}`);
      } catch {
        // Best-effort screenshot capture for console diagnostics.
      }
    }
  });

  page.on('pageerror', async (error) => {
    const record = {
      at: new Date().toISOString(),
      message: compactText(error?.stack || error?.message || String(error), 2500),
    };
    pageErrors.push(record);
    try {
      record.uiScreenshot = await captureUiScreenshot('pageerror');
    } catch {
      // Best-effort screenshot capture for runtime exceptions.
    }
  });

  page.on('requestfailed', (request) => {
    requestFailures.push({
      at: new Date().toISOString(),
      url: request.url(),
      method: request.method(),
      errorText: request.failure()?.errorText || 'unknown',
    });
  });

  page.on('response', async (response) => {
    const url = response.url();
    if (!url.startsWith(`${cfg.backendUrl}/api/v1/`)) return;

    const contentType = response.headers()['content-type'] || '';
    const record = {
      at: new Date().toISOString(),
      method: response.request().method(),
      status: response.status(),
      url,
      contentType,
    };

    try {
      if (contentType.includes('application/json')) {
        const body = await response.json();
        record.bodyPreview = compactText(JSON.stringify(body), 3500);
      } else {
        record.bodyPreview = compactText(await response.text(), 2000);
      }
    } catch (error) {
      record.parseError = compactText(String(error), 500);
    }

    apiResponses.push(record);
  });

  const captureHealth = async (stage) => {
    const response = await page.request.get(`${cfg.backendUrl}/api/v1/health`);
    const bodyText = await response.text();
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = bodyText;
    }

    const snapshot = {
      at: new Date().toISOString(),
      stage,
      status: response.status(),
      ok: response.ok(),
      body,
    };
    healthSnapshots.push(snapshot);
    return snapshot;
  };

  let runtimeWindowConfig = null;
  let createdTaskVisibleImmediately = false;
  let createdTaskVisibleAfterReload = false;
  let directTasksStatus = null;
  let directTasksCount = null;
  let directTasksBodyPreview = null;
  let directClientsStatus = null;
  let directClientsCount = null;
  let hasSessionAccessToken = false;
  let testErrorMessage = null;

  try {
    await captureHealth('before-open');

    await page.goto(cfg.frontendUrl, { waitUntil: 'domcontentloaded' });
    await captureUiScreenshot('frontend-login-screen');

    runtimeWindowConfig = await page.evaluate(() => ({
      locationHref: window.location.href,
      runtimeBackendApiBase: window.WERUNOPS_CONFIG?.backendApiBase || null,
      allowUserEndpointConfig: window.WERUNOPS_CONFIG?.allowUserEndpointConfig || null,
    }));

    await expect(page.locator('#login-form')).toBeVisible({ timeout: 30_000 });
    await page.fill('#login-username', cfg.username);
    await page.fill('#login-password', cfg.password);
    await page.locator('#login-form button[type="submit"]').click();

    await expect(page.locator('#main-content')).toBeVisible({ timeout: 45_000 });
    await captureUiScreenshot('after-login-dashboard');
    await captureHealth('after-login');

    await page.locator('.nav-tab[data-target="view-tasks"]').click();
    await expect(page.locator('#view-tasks')).toBeVisible({ timeout: 20_000 });
    await page.locator('#view-tasks .btn-add-task').first().click();
    await expect(page.locator('#modal-task')).toBeVisible({ timeout: 20_000 });
    await captureUiScreenshot('task-modal-open');

    await selectFirstAvailableOption(page, '#task-client');
    await selectFirstAvailableOption(page, '#task-staff');
    await page.fill('#task-project', 'Live Database Debug');
    await page.fill('#task-name', taskName);
    await page.fill('#task-due-date', dueDate);

    await page.click('#btn-save-task');
    await expect(page.locator('#modal-task')).toBeHidden({ timeout: 30_000 });
    await captureUiScreenshot('after-save-task');

    await page.fill('#tasks-search', taskName);
    const freshRow = page.locator('#tasks-table-body tr', { hasText: taskName }).first();
    createdTaskVisibleImmediately = await freshRow.isVisible().catch(() => false);

    await page.waitForTimeout(12_000);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#main-content')).toBeVisible({ timeout: 45_000 });
    try {
      await expect.poll(async () => {
        await page.locator('.nav-tab[data-target="view-tasks"]').click();
        await expect(page.locator('#view-tasks')).toBeVisible({ timeout: 20_000 });
        await page.fill('#tasks-search', taskName);
        const reloadRow = page.locator('#tasks-table-body tr', { hasText: taskName }).first();
        return reloadRow.isVisible().catch(() => false);
      }, {
        timeout: 20_000,
        intervals: [500, 1000, 2000],
      }).toBe(true);
      createdTaskVisibleAfterReload = true;
    } catch {
      createdTaskVisibleAfterReload = false;
    }
    await captureUiScreenshot('after-reload-check');

    const accessToken = await accessTokenFromSession(page);
    hasSessionAccessToken = Boolean(accessToken);
    const requestHeaders = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};

    const directTasksResponse = await page.request.get(`${cfg.backendUrl}/api/v1/tasks`, {
      headers: requestHeaders,
    });
    directTasksStatus = directTasksResponse.status();
    const directTasksText = await directTasksResponse.text();
    directTasksBodyPreview = compactText(directTasksText, 4000);
    try {
      const parsed = JSON.parse(directTasksText);
      directTasksCount = Array.isArray(parsed?.data) ? parsed.data.length : null;
    } catch {
      directTasksCount = null;
    }

    const directClientsResponse = await page.request.get(`${cfg.backendUrl}/api/v1/clients`, {
      headers: requestHeaders,
    });
    directClientsStatus = directClientsResponse.status();
    try {
      const parsed = await directClientsResponse.json();
      directClientsCount = Array.isArray(parsed?.data) ? parsed.data.length : null;
    } catch {
      directClientsCount = null;
    }

    await captureHealth('after-task-create');
  } catch (error) {
    testErrorMessage = compactText(error?.stack || error?.message || String(error), 3000);
    try {
      await captureUiScreenshot('exception-state');
    } catch {
      // Ignore screenshot failures after fatal test errors.
    }
    throw error;
  } finally {
    const dbSignalConsole = consoleEvents.filter((item) => /database|supabase|pgrst|table|relation|failed/i.test(item.text));
    const dbSignalApi = apiResponses.filter((item) => /\/api\/v1\/(health|tasks|clients)/i.test(item.url));

    const report = {
      runId,
      createdAt: new Date().toISOString(),
      frontendUrl: cfg.frontendUrl,
      backendUrl: cfg.backendUrl,
      taskName,
      runtimeWindowConfig,
      createdTaskVisibleImmediately,
      createdTaskVisibleAfterReload,
      directTasksStatus,
      directTasksCount,
      directTasksBodyPreview,
      directClientsStatus,
      directClientsCount,
      hasSessionAccessToken,
      testErrorMessage,
      healthSnapshots,
      consoleEvents,
      pageErrors,
      requestFailures,
      apiResponses,
      dbSignalConsole,
      dbSignalApi,
      uiScreenshots,
    };

    const reportText = JSON.stringify(report, null, 2);
    const reportPath = path.join(forensicDir, 'live-db-debug-latest.json');
    fs.writeFileSync(reportPath, reportText, 'utf8');

    await testInfo.attach('live-db-debug-latest.json', {
      body: reportText,
      contentType: 'application/json',
    });

    await testInfo.attach('console-events.json', {
      body: JSON.stringify(consoleEvents, null, 2),
      contentType: 'application/json',
    });
  }

  expect(directTasksStatus, 'Direct backend /tasks request failed.').toBe(200);
  expect(createdTaskVisibleImmediately, 'Task was never visible after save.').toBe(true);
  expect(createdTaskVisibleAfterReload, 'Task disappeared after reload, likely persistence/clobber issue.').toBe(true);
});
