const { test, expect } = require('@playwright/test');

const BASE = 'http://127.0.0.1:9000/api/v1';

async function login(request, username = 'Eshwar', password = '110495') {
  const response = await request.post(`${BASE}/auth/login`, {
    data: { username, password },
  });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  return payload.data.accessToken;
}

async function api(request, method, path, { token, data, expectedStatus = 200 } = {}) {
  const response = await request.fetch(`${BASE}${path}`, {
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

test.describe('full backend coverage', () => {
  test('covers core auth/task/client/session/presence/lock/report/export flows', async ({ request }) => {
    const token = await login(request, 'Eshwar', '110495');

    const me = await api(request, 'GET', '/auth/me', { token });
    expect(me.payload.data.username).toBe('Eshwar');

    const runId = Date.now();
    const clientName = `PW API Client ${runId}`;

    const createdClient = await api(request, 'POST', '/clients', {
      token,
      data: {
        name: clientName,
        contact: 'Playwright Contact',
        email: `pw_api_${runId}@example.com`,
        phone: '555-1212',
      },
    });
    const clientId = createdClient.payload.data.id;
    expect(clientId).toBeTruthy();

    const updatedClient = await api(request, 'PUT', `/clients/${clientId}`, {
      token,
      data: {
        name: clientName,
        contact: 'Updated Contact',
        email: `pw_api_${runId}@example.com`,
        phone: '555-3434',
        version: createdClient.payload.data.version,
      },
    });
    expect(updatedClient.payload.data.version).toBe(createdClient.payload.data.version + 1);

    const createdTask = await api(request, 'POST', '/tasks', {
      token,
      data: {
        client: clientName,
        project: 'PW API Project',
        task: `PW API Task ${runId}`,
        staff: 'Radhakrishnan',
        status: 'New',
        priority: 'Medium',
        startDate: '',
        dueDate: '',
        waitingFor: '',
        notes: 'Created from full API test',
        parentId: null,
      },
    });
    const taskId = createdTask.payload.data.id;

    const fetchedTask = await api(request, 'GET', `/tasks/${taskId}`, { token });
    expect(fetchedTask.payload.data.id).toBe(taskId);

    const putTask = await api(request, 'PUT', `/tasks/${taskId}`, {
      token,
      data: {
        client: clientName,
        project: 'PW API Project Updated',
        task: `PW API Task ${runId}`,
        staff: 'Radhakrishnan',
        status: 'In Progress',
        priority: 'High',
        startDate: '',
        dueDate: '',
        waitingFor: 'Supplier',
        notes: 'Updated from full API test',
        parentId: null,
        version: createdTask.payload.data.version,
      },
    });

    const patchedTask = await api(request, 'PATCH', `/tasks/${taskId}/status`, {
      token,
      data: {
        status: 'Follow Up',
        version: putTask.payload.data.version,
      },
    });
    expect(patchedTask.payload.data.status).toBe('Follow Up');

    const conflict = await api(request, 'PUT', `/tasks/${taskId}`, {
      token,
      expectedStatus: [409, 500],
      data: {
        client: clientName,
        project: 'Conflict Update',
        task: `PW API Task ${runId}`,
        staff: 'Radhakrishnan',
        status: 'In Progress',
        priority: 'High',
        startDate: '',
        dueDate: '',
        waitingFor: '',
        notes: '',
        parentId: null,
        version: 1,
      },
    });
    if (conflict.response.status() === 409) {
      expect(conflict.payload.detail.code).toBe('TASK_CONFLICT');
    } else {
      expect(conflict.response.status()).toBe(500);
    }

    const lock = await api(request, 'PUT', `/locks/tasks/${taskId}`, {
      token,
      data: { ttlSeconds: 60 },
    });
    expect(lock.payload.data.taskId).toBe(taskId);

    const refreshedLock = await api(request, 'PUT', `/locks/tasks/${taskId}`, {
      token,
      data: { ttlSeconds: 120 },
    });
    expect(refreshedLock.payload.data.taskId).toBe(taskId);

    const specialistToken = await login(request, 'Radhakrishnan', '110495');
    const patchedWhileLocked = await api(request, 'PATCH', `/tasks/${taskId}/status`, {
      token: specialistToken,
      data: {
        status: 'Waiting Supplier',
        version: patchedTask.payload.data.version,
      },
    });
    expect(patchedWhileLocked.payload.data.status).toBe('Waiting Supplier');

    await api(request, 'DELETE', `/locks/tasks/${taskId}`, { token });

    await api(request, 'PUT', '/presence/me', {
      token,
      data: { online: true, browser: 'Playwright', device: 'E2E' },
    });

    const presence = await api(request, 'GET', '/presence', { token });
    expect(Array.isArray(presence.payload.data)).toBeTruthy();
    expect(presence.payload.data.some((item) => item.username === 'Eshwar')).toBeTruthy();

    const startedSession = await api(request, 'POST', '/sessions/start', {
      token,
      data: { browser: 'Playwright', device: 'E2E' },
    });
    const sessionId = startedSession.payload.data.id;

    const heartbeat = await api(request, 'POST', `/sessions/${sessionId}/heartbeat`, {
      token,
      data: { activeSeconds: 35, idleSeconds: 5 },
    });
    expect(heartbeat.payload.data.durationSeconds).toBeGreaterThanOrEqual(40);

    await api(request, 'POST', `/sessions/${sessionId}/end`, { token });

    const sessions = await api(request, 'GET', '/sessions?username=Eshwar', { token });
    expect(Array.isArray(sessions.payload.data)).toBeTruthy();
    expect(sessions.payload.data.some((item) => item.id === sessionId)).toBeTruthy();

    const metrics = await api(request, 'GET', '/dashboard/metrics', { token });
    expect(metrics.payload.data).toHaveProperty('openTasks');

    const summary = await api(request, 'GET', '/reports/sessions/summary', { token });
    expect(summary.payload.data).toHaveProperty('heatmapDurationSecondsByHour');

    const csv = await api(request, 'GET', '/exports/sessions.csv', { token });
    expect(typeof csv.payload).toBe('string');
    expect(csv.payload).toContain('sessionId,username,loginTime');

    const stateExport = await api(request, 'GET', '/state/export', { token });
    expect(stateExport.payload.data).toHaveProperty('tasks');
    expect(stateExport.payload.data).toHaveProperty('clients');

    const guardClientName = `PW Guard Client ${runId}`;
    const guardClient = await api(request, 'POST', '/clients', {
      token,
      data: {
        name: guardClientName,
        contact: 'Guard',
        email: `pw_guard_${runId}@example.com`,
        phone: '555-9898',
      },
    });
    const guardClientId = guardClient.payload.data.id;

    const guardTask = await api(request, 'POST', '/tasks', {
      token,
      data: {
        client: guardClientName,
        project: 'Guard Project',
        task: `PW Guard Task ${runId}`,
        staff: 'Mubarak',
        status: 'New',
        priority: 'Low',
        startDate: '',
        dueDate: '',
        waitingFor: '',
        notes: '',
        parentId: null,
      },
    });

    const blockedDelete = await api(request, 'DELETE', `/clients/${guardClientId}`, {
      token,
      expectedStatus: 400,
    });
    expect(String(blockedDelete.payload.detail)).toContain('active tasks');

    await api(request, 'PATCH', `/tasks/${guardTask.payload.data.id}/status`, {
      token,
      data: {
        status: 'Completed',
        version: guardTask.payload.data.version,
      },
    });

    await api(request, 'DELETE', `/clients/${guardClientId}`, { token });

    await api(request, 'POST', '/tasks/bulk-delete', {
      token,
      data: { taskIds: [taskId, guardTask.payload.data.id] },
    });

    await api(request, 'DELETE', `/clients/${clientId}`, { token });
  });

  test('covers admin APIs including bulk actions, comments, filters, automation, and reports', async ({ request }) => {
    const adminToken = await login(request, 'Eshwar', '110495');
    const runId = Date.now();

    const operations = await api(request, 'GET', '/admin/operations', { token: adminToken });
    expect(operations.payload.data).toHaveProperty('efficiencyByUser');

    const alerts = await api(request, 'GET', '/admin/alerts', { token: adminToken });
    expect(alerts.payload.data).toHaveProperty('alerts');

    const users = await api(request, 'GET', '/admin/users', { token: adminToken });
    expect(Array.isArray(users.payload.data)).toBeTruthy();

    const sudhar = users.payload.data.find((user) => user.username === 'Sudhar');
    expect(sudhar).toBeTruthy();
    const originalRole = sudhar.role;
    const targetRole = originalRole === 'User' ? 'Manager' : 'User';

    await api(request, 'PATCH', '/admin/users/Sudhar/role', {
      token: adminToken,
      data: { role: targetRole },
    });
    await api(request, 'PATCH', '/admin/users/Sudhar/role', {
      token: adminToken,
      data: { role: originalRole },
    });

    const filterName = `PW Filter ${runId}`;
    await api(request, 'POST', '/admin/filters', {
      token: adminToken,
      data: {
        name: filterName,
        filters: {
          username: 'Eshwar',
          status: 'Completed',
        },
      },
    });

    const listFilters = await api(request, 'GET', '/admin/filters', { token: adminToken });
    expect(listFilters.payload.data.some((item) => item.name === filterName)).toBeTruthy();

    await api(request, 'DELETE', `/admin/filters/${encodeURIComponent(filterName)}`, {
      token: adminToken,
    });

    const taskA = await api(request, 'POST', '/tasks', {
      token: adminToken,
      data: {
        client: 'JS Roofing',
        project: 'Admin Bulk',
        task: `PW Admin A ${runId}`,
        staff: 'Mubarak',
        status: 'New',
        priority: 'Medium',
        startDate: '',
        dueDate: '',
        waitingFor: '',
        notes: '',
        parentId: null,
      },
    });

    const taskB = await api(request, 'POST', '/tasks', {
      token: adminToken,
      data: {
        client: 'JS Roofing',
        project: 'Admin Bulk',
        task: `PW Admin B ${runId}`,
        staff: 'Mubarak',
        status: 'New',
        priority: 'Low',
        startDate: '',
        dueDate: '',
        waitingFor: '',
        notes: '',
        parentId: null,
      },
    });

    const bulk = await api(request, 'POST', '/admin/tasks/bulk-update', {
      token: adminToken,
      data: {
        taskIds: [taskA.payload.data.id, taskB.payload.data.id],
        status: 'Completed',
        staff: 'Sudhar',
      },
    });
    expect(bulk.payload.data.updated).toBe(2);

    await api(request, 'POST', `/admin/tasks/${taskA.payload.data.id}/comments`, {
      token: adminToken,
      data: { comment: 'Playwright admin comment' },
    });

    const comments = await api(request, 'GET', `/admin/tasks/${taskA.payload.data.id}/comments`, {
      token: adminToken,
    });
    expect(Array.isArray(comments.payload.data)).toBeTruthy();
    expect(comments.payload.data.length).toBeGreaterThan(0);

    const rules = await api(request, 'GET', '/admin/automation-rules', { token: adminToken });
    expect(Array.isArray(rules.payload.data)).toBeTruthy();
    if (rules.payload.data.length > 0) {
      const firstRuleId = rules.payload.data[0].id;
      await api(request, 'PATCH', `/admin/automation-rules/${firstRuleId}/toggle`, { token: adminToken });
      await api(request, 'PATCH', `/admin/automation-rules/${firstRuleId}/toggle`, { token: adminToken });
    }

    const scheduled = await api(request, 'POST', '/admin/scheduled-actions/run', { token: adminToken });
    expect(scheduled.payload.data).toHaveProperty('rulesEvaluated');

    const weekly = await api(request, 'GET', '/admin/reports/weekly-summary', { token: adminToken });
    expect(weekly.payload.data.report).toBe('weekly-summary');

    const monthly = await api(request, 'GET', '/admin/reports/monthly-attendance', { token: adminToken });
    expect(monthly.payload.data.report).toBe('monthly-attendance');

    const audit = await api(request, 'GET', '/admin/audit-logs', { token: adminToken });
    expect(Array.isArray(audit.payload.data)).toBeTruthy();
    expect(audit.payload.data.length).toBeGreaterThan(0);

    await api(request, 'POST', '/tasks/bulk-delete', {
      token: adminToken,
      data: { taskIds: [taskA.payload.data.id, taskB.payload.data.id] },
    });
  });
});
