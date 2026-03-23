/**
 * Application Logic for BackOffice Pro
 */

// Global State refs
let charts = {};
let sortableInstances = [];
let currentUser = null;
const SESSION_KEY = 'currentUser';
let renderQueued = false;
let pendingRenderState = null;
let lastDashboardFingerprint = '';
let sessionHeartbeatTimer = null;
let sessionActivityBound = false;
let sessionActiveSecondsBucket = 0;
let sessionIdleSecondsBucket = 0;
let lastActivityAt = Date.now();
let lastHeartbeatAt = Date.now();
let dashboardOpsInFlight = null;
let dashboardOpsLastFetchAt = 0;
let currentLockedTaskId = null;
let taskLockRefreshTimer = null;
const undoStack = [];
const redoStack = [];
let historyReplay = false;
const selectedTaskIds = new Set();
const APP_RUNTIME_CONFIG = (typeof window !== 'undefined' && window.WERUNOPS_CONFIG)
    ? window.WERUNOPS_CONFIG
    : {};
const ALLOW_USER_ENDPOINT_CONFIG = APP_RUNTIME_CONFIG.allowUserEndpointConfig === true;
const SHOW_SESSION_OPS_IN_DASHBOARD = APP_RUNTIME_CONFIG.showSessionOpsInDashboard !== false;

function escapeHTML(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function safe(value) {
    return escapeHTML(value);
}

function debounce(fn, wait = 120) {
    let timeoutId = null;
    return (...args) => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), wait);
    };
}

const debouncedRenderAllViews = debounce((state) => {
    renderAllViews(state);
}, 80);

function scheduleRender(state) {
    pendingRenderState = state;
    if (renderQueued) return;
    renderQueued = true;

    requestAnimationFrame(() => {
        renderQueued = false;
        debouncedRenderAllViews(pendingRenderState);
    });
}

function cloneTask(task) {
    return task ? JSON.parse(JSON.stringify(task)) : null;
}

function updateUndoRedoButtons() {
    const undoBtn = document.getElementById('btn-undo');
    const redoBtn = document.getElementById('btn-redo');
    if (undoBtn) undoBtn.disabled = undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}

function pushHistoryEntry(entry) {
    if (historyReplay) return;
    undoStack.push(entry);
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
    updateUndoRedoButtons();
}

async function replayHistoryEntry(entry, direction = 'undo') {
    historyReplay = true;
    try {
        if (entry.type === 'create') {
            if (direction === 'undo') {
                await store.deleteTasks([entry.task.id]);
            } else {
                await store.restoreTaskSnapshot(entry.task);
            }
        }

        if (entry.type === 'update') {
            if (direction === 'undo') {
                await store.restoreTaskSnapshot(entry.before);
            } else {
                await store.restoreTaskSnapshot(entry.after);
            }
        }

        if (entry.type === 'status') {
            if (direction === 'undo') {
                await store.updateTaskStatus(entry.taskId, entry.beforeStatus);
            } else {
                await store.updateTaskStatus(entry.taskId, entry.afterStatus);
            }
        }

        if (entry.type === 'delete') {
            if (direction === 'undo') {
                for (const task of entry.tasks) {
                    await store.restoreTaskSnapshot(task);
                }
            } else {
                await store.deleteTasks(entry.tasks.map(task => task.id));
            }
        }
    } finally {
        historyReplay = false;
    }
}

async function undoLastMutation() {
    const entry = undoStack.pop();
    if (!entry) return;
    try {
        await replayHistoryEntry(entry, 'undo');
        redoStack.push(entry);
        showNotification('Undo', 'Last task change reverted.', 'success');
    } catch (error) {
        undoStack.push(entry);
        showNotification('Undo Failed', 'Could not revert the last change.', 'error');
    }
    updateUndoRedoButtons();
}

async function redoLastMutation() {
    const entry = redoStack.pop();
    if (!entry) return;
    try {
        await replayHistoryEntry(entry, 'redo');
        undoStack.push(entry);
        showNotification('Redo', 'Change applied again.', 'success');
    } catch (error) {
        redoStack.push(entry);
        showNotification('Redo Failed', 'Could not re-apply the change.', 'error');
    }
    updateUndoRedoButtons();
}

function getTaskLockInfo(taskId) {
    if (!store?.state?.taskLocks) return null;
    const lock = store.state.taskLocks[parseInt(taskId)];
    if (!lock) return null;
    if (lock.lockedBy === currentUser?.username) return null;
    return lock;
}

function refreshOfflineSyncControls() {
    const status = store.getOfflineQueueStatus ? store.getOfflineQueueStatus() : { pendingCount: 0, failedCount: 0 };
    const pendingCount = Number(status.pendingCount || 0);
    const failedCount = Number(status.failedCount || 0);

    const bannerText = document.getElementById('offline-banner-text');
    const retryBannerBtn = document.getElementById('btn-retry-offline-sync');
    const discardBannerBtn = document.getElementById('btn-discard-offline-failed');

    if (bannerText) {
        if (!navigator.onLine) {
            bannerText.textContent = `Offline mode active. ${pendingCount} change(s) queued for sync.`;
        } else if (failedCount > 0) {
            bannerText.textContent = `${failedCount} change(s) failed to sync. Retry or discard failed actions.`;
        } else {
            bannerText.textContent = 'Offline mode active. Changes are saved locally and will sync when online.';
        }
    }

    if (retryBannerBtn) retryBannerBtn.classList.toggle('hidden', failedCount === 0);
    if (discardBannerBtn) discardBannerBtn.classList.toggle('hidden', failedCount === 0);

    const queueCountEl = document.getElementById('settings-offline-queue-count');
    const failedCountEl = document.getElementById('settings-offline-failed-count');
    if (queueCountEl) queueCountEl.textContent = String(pendingCount);
    if (failedCountEl) failedCountEl.textContent = String(failedCount);

    const retrySettingsBtn = document.getElementById('btn-settings-retry-failed-sync');
    const discardSettingsBtn = document.getElementById('btn-settings-discard-failed-sync');
    if (retrySettingsBtn) retrySettingsBtn.disabled = failedCount === 0;
    if (discardSettingsBtn) discardSettingsBtn.disabled = failedCount === 0;
}

async function retryFailedOfflineSync() {
    if (!store.retryFailedOfflineQueue) return;
    store.retryFailedOfflineQueue();
    refreshOfflineSyncControls();
    if (!navigator.onLine) {
        showNotification('Still Offline', 'Queued failed actions. Sync will retry when connection is restored.', 'info');
        return;
    }
    const result = await store.flushOfflineQueue?.().catch(() => null);
    refreshOfflineSyncControls();
    if (result?.failed > 0) {
        showNotification('Partial Sync', `${result.failed} action(s) still failed.`, 'warning');
    } else {
        showNotification('Sync Complete', 'Failed actions were replayed successfully.', 'success');
    }
}

function discardFailedOfflineSync() {
    if (!store.discardFailedOfflineQueue) return;
    store.discardFailedOfflineQueue();
    refreshOfflineSyncControls();
    showNotification('Failed Actions Cleared', 'Discarded failed offline actions.', 'warning');
}

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Initialize UI Elements
    initNavigation();
    initModals();
    setupProfileModal();
    setupSettingsModal();
    setupHeaderFeatures();
    initFilters();

    // Show Loading
    const globalLoader = document.getElementById('global-loader');
    globalLoader.classList.remove('hidden');

    let startupReady = false;
    try {
        // 2. Initialize Data Store
        await store.init();

        // 3. Setup Auth now that store is ready
        await setupAuth();
        startupReady = true;
    } catch (error) {
        console.error('Startup initialization failed:', error);
        showNotification('Startup Recovery', 'Backend sync failed during startup. Loaded local fallback state.', 'warning');

        try {
            if (!store.state && typeof store.fetchFromLocal === 'function') {
                store.fetchFromLocal();
            }
        } catch (fallbackError) {
            console.error('Local fallback failed:', fallbackError);
        }
    }

    window.addEventListener('werunops-auth-invalid', () => {
        if (!currentUser) return;
        store.stopPresenceHeartbeat();
        store.stopTaskLockListener();
        store.stopBackendSyncPolling?.();
        stopSessionActivityTracking();
        currentUser = null;
        localStorage.removeItem(SESSION_KEY);
        window.location.hash = '#/login';
        showNotification('Session Expired', 'Please sign in again.', 'warning');
    });

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    const offlineBanner = document.getElementById('offline-banner');
    const updateOfflineUI = async () => {
        if (!offlineBanner) return;
        if (navigator.onLine) {
            offlineBanner.classList.add('hidden');
            const result = await store.flushOfflineQueue?.().catch(() => null);
            if (result?.failed > 0) {
                offlineBanner.classList.remove('hidden');
                showNotification('Sync Attention Needed', `${result.failed} offline action(s) need retry or discard.`, 'warning');
            }
        } else {
            offlineBanner.classList.remove('hidden');
        }
        refreshOfflineSyncControls();
    };
    window.addEventListener('online', () => { updateOfflineUI(); });
    window.addEventListener('offline', () => { updateOfflineUI(); });

    document.getElementById('btn-retry-offline-sync')?.addEventListener('click', () => retryFailedOfflineSync());
    document.getElementById('btn-discard-offline-failed')?.addEventListener('click', () => discardFailedOfflineSync());

    updateOfflineUI();

    document.getElementById('btn-undo')?.addEventListener('click', () => undoLastMutation());
    document.getElementById('btn-redo')?.addEventListener('click', () => redoLastMutation());
    document.addEventListener('keydown', (event) => {
        if (event.ctrlKey && event.key.toLowerCase() === 'z' && !event.shiftKey) {
            event.preventDefault();
            undoLastMutation();
        }
        if ((event.ctrlKey && event.key.toLowerCase() === 'y') || (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'z')) {
            event.preventDefault();
            redoLastMutation();
        }
    });
    updateUndoRedoButtons();

    // Start realtime state stream for multi-user consistency
    store.startRealtimeStateListener();

    // Subscribe to state changes to update UI
    store.subscribe((state) => {
        scheduleRender(state);
        refreshOfflineSyncControls();
    });

    // Initial Render (or fallback render)
    if (store.state) {
        scheduleRender(store.state);
    }
    refreshOfflineSyncControls();

    // Hide Loading (always)
    globalLoader.classList.add('hidden');

    // First-run: alert if no Firebase URL is configured
    if (!CONFIG.firebaseUrl) {
        setTimeout(() => {
            showNotification(
                'Firebase Not Configured',
                'Go to Settings → Firebase Database and paste your Firebase Realtime Database URL to enable multi-user sync.',
                'info'
            );
        }, 2000);
    }

    // 3. Setup form handlers
    setupFormHandlers();

    // 4. Show a startup notification
    if (startupReady) {
        showNotification('Success', 'Connected to data source successfully.', 'success');
    }

    window.addEventListener('beforeunload', () => {
        if (!store.isBackendReady() || !currentUser?.accessToken || !currentUser?.sessionId) return;
        const headers = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${currentUser.accessToken}`
        };
        fetch(`${CONFIG.backendApiBase}/sessions/${currentUser.sessionId}/heartbeat`, {
            method: 'POST',
            keepalive: true,
            headers,
            body: JSON.stringify({ activeSeconds: sessionActiveSecondsBucket, idleSeconds: sessionIdleSecondsBucket })
        }).catch(() => {});
        fetch(`${CONFIG.backendApiBase}/sessions/${currentUser.sessionId}/end`, {
            method: 'POST',
            keepalive: true,
            headers
        }).catch(() => {});
    });
});

// --- View Rendering Engine ---

function renderAllViews(state) {
    if (!state) return;

    renderDashboard(state);
    renderKanban(state);
    renderAllTasksList(state);
    renderTodayTasks(state);
    renderClientsList(state);
    populateSelects(state.config);
    updateNotifications();
    updateHeaderProfile();
}

// --- Navigation & Routing ---

function initNavigation() {
    const navTabs = document.querySelectorAll('.nav-tab');
    const views = document.querySelectorAll('.view-section');
    const mainHeader = document.getElementById('main-header');
    const mainContent = document.getElementById('main-content');
    const viewLogin = document.getElementById('view-login');

    function handleRoute() {
        let hash = window.location.hash;
        if (!hash || hash === '#/') {
            hash = localStorage.getItem(SESSION_KEY) ? '#/dashboard' : '#/login';
        }

        const hasSession = !!currentUser || !!readSession();
        if (hash !== '#/login' && !hasSession) {
            window.location.hash = '#/login';
            return;
        }
        
        let targetId = 'view-dashboard';
        if (hash === '#/kanban') targetId = 'view-kanban';
        else if (hash === '#/tasks') targetId = 'view-tasks';
        else if (hash === '#/today') targetId = 'view-today';
        else if (hash === '#/clients') targetId = 'view-clients';
        else if (hash === '#/login') targetId = 'view-login';

        if (targetId === 'view-login') {
            viewLogin.classList.remove('hidden');
            mainHeader.classList.add('hidden');
            mainContent.classList.add('hidden');
            return;
        } else {
            viewLogin.classList.add('hidden');
            mainHeader.classList.remove('hidden');
            mainContent.classList.remove('hidden');
        }

        // Process tabs
        navTabs.forEach(t => {
            t.classList.remove('active', 'text-primary');
            t.classList.add('text-gray-500');
            t.style.borderBottomColor = 'transparent';
        });

        const activeTab = Array.from(navTabs).find(t => t.getAttribute('data-target') === targetId);
        if (activeTab) {
            activeTab.classList.add('active', 'text-primary');
            activeTab.classList.remove('text-gray-500');
            activeTab.style.borderBottomColor = 'var(--primary-blue)';
        }

        views.forEach(view => {
            if (view.id === targetId) {
                view.classList.remove('hidden');
                if (targetId === 'view-dashboard') {
                    Object.values(charts).forEach(chart => chart.resize());
                }
            } else {
                view.classList.add('hidden');
            }
        });

        if (window.innerWidth < 768) {
            document.getElementById('main-nav').classList.add('hidden');
        }
    }

    window.addEventListener('hashchange', handleRoute);

    navTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetId = tab.getAttribute('data-target');
            const route = targetId.replace('view-', '');
            window.location.hash = '#/' + route;
        });
    });

    document.getElementById('mobile-menu-btn').addEventListener('click', () => {
        const nav = document.getElementById('main-nav');
        nav.classList.toggle('hidden');
        if (!nav.classList.contains('hidden')) {
            nav.classList.add('flex', 'flex-col', 'absolute', 'top-16', 'left-0', 'w-full', 'bg-white', 'shadow-md', 'z-40');
        } else {
            nav.classList.remove('flex', 'flex-col', 'absolute', 'top-16', 'left-0', 'w-full', 'bg-white', 'shadow-md', 'z-40');
        }
    });

    handleRoute();
}

// --- UI Utilities ---

function getStatusColorClass(status) {
    const map = {
        'New': 'status-badge-new',
        'In Progress': 'status-badge-progress',
        'Waiting Client': 'status-badge-waitingClient',
        'Waiting Supplier': 'status-badge-waitingSupplier',
        'Follow Up': 'status-badge-followup',
        'Completed': 'status-badge-completed'
    };
    return map[status] || 'bg-gray-100 text-gray-800';
}

function getStatusIcon(status) {
    const map = {
        'New': 'sparkles',
        'In Progress': 'settings-2',
        'Waiting Client': 'users',
        'Waiting Supplier': 'package',
        'Follow Up': 'phone-call',
        'Completed': 'check-circle'
    };
    return map[status] || 'circle';
}

function getPriorityColor(priority) {
    const map = {
        'High': 'var(--priority-high)',
        'Medium': 'var(--priority-medium)',
        'Low': 'var(--priority-low)'
    };
    return map[priority] || 'gray';
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function isToday(dateString) {
    if (!dateString) return false;
    const date = new Date(dateString);
    const today = new Date();
    return date.getDate() === today.getDate() &&
        date.getMonth() === today.getMonth() &&
        date.getFullYear() === today.getFullYear();
}

function isOverdue(dateString) {
    if (!dateString) return false;
    const date = new Date(dateString);
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Start of today
    return date < today;
}

function formatDurationCompact(totalSeconds) {
    const safeSeconds = Math.max(0, Number(totalSeconds) || 0);
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

function renderDashboardHoursWidget(hoursByUser = {}) {
    const container = document.getElementById('dashboard-hours-logged');
    if (!container) return;

    const entries = Object.entries(hoursByUser).sort((a, b) => (b[1] || 0) - (a[1] || 0));
    if (!entries.length) {
        container.innerHTML = '<p class="text-gray-500">No one has logged session time today.</p>';
        return;
    }

    container.innerHTML = entries
        .map(([user, seconds]) => {
            const label = safe(user);
            const value = safe(formatDurationCompact(seconds));
            return `<div class="flex items-center justify-between rounded-md border border-gray-100 px-3 py-2"><span class="text-gray-700">${label}</span><span class="font-semibold text-gray-900">${value}</span></div>`;
        })
        .join('');
}

function renderDashboardHeatmap(hourMap = {}) {
    const container = document.getElementById('dashboard-hours-heatmap');
    if (!container) return;

    const values = [];
    for (let hour = 0; hour < 24; hour++) {
        values.push(Number(hourMap[String(hour)] || 0));
    }
    const maxValue = Math.max(...values, 0);

    if (maxValue === 0) {
        container.innerHTML = '<p class="text-gray-500 col-span-6">No activity heatmap available.</p>';
        return;
    }

    container.innerHTML = values
        .map((value, hour) => {
            const intensity = Math.max(0.15, value / maxValue);
            const bg = `rgba(37, 99, 235, ${intensity.toFixed(2)})`;
            const textClass = intensity > 0.5 ? 'text-white' : 'text-gray-700';
            return `<div class="rounded px-2 py-2 text-center font-medium ${textClass}" style="background:${bg}" title="${hour}:00 - ${formatDurationCompact(value)}">${String(hour).padStart(2, '0')}</div>`;
        })
        .join('');
}

async function refreshDashboardOperationalData(force = false) {
    if (!store.isBackendReady() || !currentUser?.accessToken) return;
    const now = Date.now();
    if (!force && now - dashboardOpsLastFetchAt < 20000) return;
    if (dashboardOpsInFlight) return dashboardOpsInFlight;

    dashboardOpsInFlight = (async () => {
        try {
            const token = currentUser.accessToken;
            const [metricsRes, summaryRes] = await Promise.all([
                backendApiFetch('/dashboard/metrics', {}, token),
                backendApiFetch('/reports/sessions/summary', {}, token)
            ]);

            if (metricsRes?.ok) {
                const metricsPayload = await metricsRes.json();
                renderDashboardHoursWidget(metricsPayload?.data?.todayDurationSecondsByUser || {});
            }

            if (summaryRes?.ok) {
                const summaryPayload = await summaryRes.json();
                renderDashboardHeatmap(summaryPayload?.data?.heatmapDurationSecondsByHour || {});
            }
            dashboardOpsLastFetchAt = Date.now();
        } catch (error) {
            console.warn('Dashboard operational data refresh failed:', error);
        } finally {
            dashboardOpsInFlight = null;
        }
    })();

    return dashboardOpsInFlight;
}

function showNotification(title, message, type = 'info') {
    const container = document.getElementById('notification-container');
    const toast = document.createElement('div');
    const safeTitle = safe(title);
    const safeMessage = safe(message);

    let icon = 'info';
    let colorClass = 'bg-blue-50 text-blue-800 border-blue-200';
    let iconClass = 'text-blue-500';

    if (type === 'success') {
        icon = 'check-circle';
        colorClass = 'bg-green-50 text-green-800 border-green-200';
        iconClass = 'text-green-500';
    } else if (type === 'error') {
        icon = 'alert-circle';
        colorClass = 'bg-red-50 text-red-800 border-red-200';
        iconClass = 'text-red-500';
    } else if (type === 'warning') {
        icon = 'alert-triangle';
        colorClass = 'bg-amber-50 text-amber-800 border-amber-200';
        iconClass = 'text-amber-500';
    }

    toast.className = `flex items-start p-4 mb-2 border rounded-lg shadow-lg pointer-events-auto toast-enter ${colorClass} w-80`;
    toast.innerHTML = `
        <div class="inline-flex items-center justify-center flex-shrink-0 w-6 h-6 mr-3">
            <i data-lucide="${icon}" class="w-5 h-5 ${iconClass}"></i>
        </div>
        <div class="flex-1">
            <h4 class="font-semibold text-sm">${safeTitle}</h4>
            <div class="text-sm mt-1 opacity-90">${safeMessage}</div>
        </div>
        <button class="ml-auto -mx-1.5 -my-1.5 p-1.5 rounded-lg focus:ring-2 focus:ring-gray-300 hover:bg-black/5 inline-flex h-8 w-8 justify-center items-center transition" aria-label="Close" onclick="this.parentElement.remove()">
            <i data-lucide="x" class="w-4 h-4"></i>
        </button>
    `;

    container.appendChild(toast);
    lucide.createIcons({ root: toast });

    // Auto remove after 5 secs
    setTimeout(() => {
        if (toast.parentElement) {
            toast.classList.remove('toast-enter');
            toast.classList.add('toast-leave');
            setTimeout(() => {
                if (toast.parentElement) toast.remove();
            }, 300);
        }
    }, 5000);
}

// --- Module 1: Dashboard Rendering ---

function renderDashboard(state) {
    const tasks = state.tasks;

    // 1. Calculate Metrics
    let openCount = 0, inProgressCount = 0, completedCount = 0, overdueCount = 0;

    tasks.forEach(t => {
        if (t.status === 'Completed') completedCount++;
        else {
            openCount++;
            if (t.status === 'In Progress') inProgressCount++;
            if (isOverdue(t.dueDate)) overdueCount++;
        }
    });

    const currentFingerprint = `${tasks.length}|${openCount}|${inProgressCount}|${completedCount}|${overdueCount}|${tasks.map(t => t.updatedAt || '').join('|')}`;
    const metricsContainer = document.getElementById('dashboard-metrics');

    if (lastDashboardFingerprint !== currentFingerprint) {
        metricsContainer.innerHTML = `
            ${createMetricCard('Open Tasks', openCount, 'folder-open', 'bg-blue-500')}
            ${createMetricCard('In Progress', inProgressCount, 'settings-2', 'bg-amber-500')}
            ${createMetricCard('Completed', completedCount, 'check-circle', 'bg-gray-500')}
            ${createMetricCard('Overdue', overdueCount, 'alert-circle', overdueCount > 0 ? 'bg-red-500 animate-pulse' : 'bg-red-500')}
        `;
        lucide.createIcons({ root: metricsContainer });
        lastDashboardFingerprint = currentFingerprint;
    }

    // 2. Charts
    updateStatusChart(tasks, state.config.statuses);
    updatePriorityChart(tasks, state.config.priorities);
    updateStaffChart(tasks, state.config.staff);
    updateClientChart(tasks);

    // 3. Activity Feed
    renderActivityFeed(tasks);

    const sessionAnalyticsSection = document.getElementById('dashboard-session-analytics');
    if (sessionAnalyticsSection) {
        sessionAnalyticsSection.classList.toggle('hidden', !SHOW_SESSION_OPS_IN_DASHBOARD);
    }

    if (SHOW_SESSION_OPS_IN_DASHBOARD && store.isBackendReady() && currentUser?.accessToken) {
        refreshDashboardOperationalData(false);
    }
}

function createMetricCard(title, value, icon, iconBgClass) {
    return `
        <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow flex items-center gap-4">
            <div class="w-12 h-12 rounded-full ${iconBgClass} text-white flex items-center justify-center flex-shrink-0 shadow-inner">
                <i data-lucide="${icon}" class="w-6 h-6"></i>
            </div>
            <div>
                <p class="text-sm font-medium text-gray-500">${title}</p>
                <p class="text-3xl font-bold text-gray-800">${value}</p>
            </div>
        </div>
    `;
}

// Chart Configurations
function getChartColors() {
    const style = getComputedStyle(document.body);
    return {
        new: style.getPropertyValue('--status-new').trim(),
        progress: style.getPropertyValue('--status-progress').trim(),
        waitingClient: style.getPropertyValue('--status-waiting-client').trim(),
        waitingSupplier: style.getPropertyValue('--status-waiting-supplier').trim(),
        followup: style.getPropertyValue('--status-followup').trim(),
        completed: style.getPropertyValue('--status-completed').trim(),
        high: style.getPropertyValue('--priority-high').trim(),
        medium: style.getPropertyValue('--priority-medium').trim(),
        low: style.getPropertyValue('--priority-low').trim(),
    };
}

function areArraysEqual(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let index = 0; index < a.length; index++) {
        if (a[index] !== b[index]) return false;
    }
    return true;
}

function updateStatusChart(tasks, statusList) {
    const ctx = document.getElementById('chart-status').getContext('2d');
    const colors = getChartColors();

    const counts = statusList.map(status => tasks.filter(t => t.status === status).length);
    const bgColors = [colors.new, colors.progress, colors.waitingClient, colors.waitingSupplier, colors.followup, colors.completed];

    if (!charts.status) {
        charts.status = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: statusList,
                datasets: [{
                    data: counts,
                    backgroundColor: bgColors,
                    borderWidth: 2,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'right', labels: { usePointStyle: true, padding: 15, font: { family: 'Inter' } } }
                },
                cutout: '70%'
            }
        });
        return;
    }

    const chart = charts.status;
    const dataChanged = !areArraysEqual(chart.data.datasets[0].data, counts) || !areArraysEqual(chart.data.labels, statusList);
    if (!dataChanged) return;
    chart.data.labels = [...statusList];
    chart.data.datasets[0].data = [...counts];
    chart.data.datasets[0].backgroundColor = bgColors;
    chart.update('none');
}

function updatePriorityChart(tasks, priorityList) {
    const ctx = document.getElementById('chart-priority').getContext('2d');
    const colors = getChartColors();

    const counts = priorityList.map(prio => tasks.filter(t => t.priority === prio && t.status !== 'Completed').length);
    const bgColors = [colors.high, colors.medium, colors.low];

    if (!charts.priority) {
        charts.priority = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: priorityList,
                datasets: [{
                    label: 'Open Tasks',
                    data: counts,
                    backgroundColor: bgColors,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: { beginAtZero: true, grid: { borderDash: [2, 4], color: '#f3f4f6' }, ticks: { stepSize: 1, font: { family: 'Inter' } } },
                    x: { grid: { display: false }, ticks: { font: { family: 'Inter' } } }
                }
            }
        });
        return;
    }

    const chart = charts.priority;
    const dataChanged = !areArraysEqual(chart.data.datasets[0].data, counts) || !areArraysEqual(chart.data.labels, priorityList);
    if (!dataChanged) return;
    chart.data.labels = [...priorityList];
    chart.data.datasets[0].data = [...counts];
    chart.data.datasets[0].backgroundColor = bgColors;
    chart.update('none');
}

function updateStaffChart(tasks, staffList) {
    const ctx = document.getElementById('chart-staff').getContext('2d');

    // Filter staffList to only show valid users based on our hardcoded list
    const validUsersList = ['Pritheeswarar', 'Mubarak', 'Sudharshan'];
    const filteredStaff = staffList.filter(s => validUsersList.includes(s));

    // Sort staff by workload
    const workloads = filteredStaff.map(staff => ({
        name: staff,
        count: tasks.filter(t => t.staff === staff && t.status !== 'Completed').length
    })).sort((a, b) => b.count - a.count);

    const labels = workloads.map(w => w.name);
    const data = workloads.map(w => w.count);

    if (!charts.staff) {
        charts.staff = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Active Tasks',
                    data,
                    backgroundColor: '#3b82f6',
                    borderRadius: 4
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { beginAtZero: true, grid: { borderDash: [2, 4] }, ticks: { stepSize: 1 } },
                    y: { grid: { display: false } }
                }
            }
        });
        return;
    }

    const chart = charts.staff;
    const dataChanged = !areArraysEqual(chart.data.labels, labels) || !areArraysEqual(chart.data.datasets[0].data, data);
    if (!dataChanged) return;
    chart.data.labels = labels;
    chart.data.datasets[0].data = data;
    chart.update('none');
}

function updateClientChart(tasks) {
    const ctx = document.getElementById('chart-client').getContext('2d');

    // Get unique clients and count active tasks
    const clientMap = {};
    tasks.forEach(t => {
        if (t.status !== 'Completed') {
            clientMap[t.client] = (clientMap[t.client] || 0) + 1;
        }
    });

    // Sort and get top 5 + others
    const sortedClients = Object.keys(clientMap).map(client => ({
        name: client, count: clientMap[client]
    })).sort((a, b) => b.count - a.count);

    const labels = [];
    const counts = [];
    let otherCount = 0;

    sortedClients.forEach((c, idx) => {
        if (idx < 5) {
            labels.push(c.name);
            counts.push(c.count);
        } else {
            otherCount += c.count;
        }
    });

    if (otherCount > 0) {
        labels.push('Others');
        counts.push(otherCount);
    }

    const finalLabels = labels.length > 0 ? labels : ['No active tasks'];
    const finalData = counts.length > 0 ? counts : [1];
    const finalColors = counts.length > 0
        ? ['#2563eb', '#7c3aed', '#059669', '#d97706', '#dc2626', '#6b7280']
        : ['#e5e7eb'];

    if (!charts.client) {
        charts.client = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: finalLabels,
                datasets: [{
                    data: finalData,
                    backgroundColor: finalColors,
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'right', labels: { boxWidth: 12, font: { family: 'Inter' } } }
                }
            }
        });
        return;
    }

    const chart = charts.client;
    const dataChanged = !areArraysEqual(chart.data.labels, finalLabels) || !areArraysEqual(chart.data.datasets[0].data, finalData);
    if (!dataChanged) return;
    chart.data.labels = finalLabels;
    chart.data.datasets[0].data = finalData;
    chart.data.datasets[0].backgroundColor = finalColors;
    chart.update('none');
}

function renderActivityFeed(tasks) {
    const feedContainer = document.getElementById('activity-feed');

    // Extract all activity logs, attach task data
    let allActivities = [];
    tasks.forEach(task => {
        if (task.activityLog) {
            task.activityLog.forEach(log => {
                allActivities.push({
                    ...log,
                    taskId: task.id,
                    taskName: task.task
                });
            });
        }
    });

    // Sort descending by timestamp
    allActivities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Take top 15
    const recentActivities = allActivities.slice(0, 15);

    if (recentActivities.length === 0) {
        feedContainer.innerHTML = `<p class="text-sm text-gray-500 text-center py-4">No recent activity.</p>`;
        return;
    }

    let html = '<div class="space-y-4 relative">';
    // Add timeline line
    html += '<div class="absolute top-0 bottom-0 left-[19px] w-px bg-gray-200"></div>';

    recentActivities.forEach(act => {
        const timeAgo = getTimeAgo(act.timestamp);
        let icon = 'activity';
        let bg = 'bg-gray-100 text-gray-600';
        const safeUser = safe(act.user);
        const safeAction = safe((act.action || '').toLowerCase());
        const safeTaskName = safe(act.taskName);
        const safeTaskId = Number(act.taskId) || 0;

        if (act.action.includes('created')) { icon = 'plus'; bg = 'bg-blue-100 text-blue-600'; }
        else if (act.action.includes('Status changed') || act.action.includes('via drag')) { icon = 'arrow-right-left'; bg = 'bg-amber-100 text-amber-600'; }
        else if (act.action.toLowerCase().includes('completed')) { icon = 'check'; bg = 'bg-green-100 text-green-600'; }

        html += `
            <div class="flex gap-4 relative z-10">
                <div class="w-10 h-10 rounded-full ${bg} flex items-center justify-center flex-shrink-0 border-4 border-white">
                    <i data-lucide="${icon}" class="w-4 h-4"></i>
                </div>
                <div class="flex-1 pt-2 pb-1">
                    <p class="text-sm text-gray-800"><span class="font-medium">${safeUser}</span> ${safeAction}</p>
                    <p class="text-xs text-primary font-medium mt-0.5 hover:underline cursor-pointer" onclick="openTaskModal(${safeTaskId})">#${safeTaskId} ${safeTaskName}</p>
                    <p class="text-xs text-gray-400 mt-1">${timeAgo}</p>
                </div>
            </div>
        `;
    });
    html += '</div>';

    feedContainer.innerHTML = html;
    lucide.createIcons({ root: feedContainer });
}

function getTimeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);

    let interval = Math.floor(seconds / 31536000);
    if (interval >= 1) return interval + " year" + (interval > 1 ? "s" : "") + " ago";
    interval = Math.floor(seconds / 2592000);
    if (interval >= 1) return interval + " month" + (interval > 1 ? "s" : "") + " ago";
    interval = Math.floor(seconds / 86400);
    if (interval >= 1) return interval + " day" + (interval > 1 ? "s" : "") + " ago";
    interval = Math.floor(seconds / 3600);
    if (interval >= 1) return interval + " hour" + (interval > 1 ? "s" : "") + " ago";
    interval = Math.floor(seconds / 60);
    if (interval >= 1) return interval + " min" + (interval > 1 ? "s" : "") + " ago";
    return "just now";
}

// --- Module 2: Kanban Rendering ---
function renderKanban(state) {
    const board = document.getElementById('kanban-board');
    if (!board) return;

    // Cleanup old sortable instances
    sortableInstances.forEach(instance => instance.destroy());
    sortableInstances = [];

    const statuses = state.config.statuses;
    let html = '';

    // Build columns
    statuses.forEach(status => {
        const columnTasks = state.tasks.filter(t => t.status === status);
        const icon = getStatusIcon(status);
        const colorClass = getStatusColorClass(status);
        const headClass = `kanban-col-head-${status.replace(/\s+/g, '')}`;

        html += `
            <div class="flex flex-col bg-gray-50 rounded-xl w-72 flex-shrink-0 ${headClass} shadow-sm border border-gray-200 max-h-full overflow-hidden pb-1">
                <div class="p-4 flex justify-between items-center border-b border-gray-200 sticky top-0 bg-gray-50 z-10 rounded-t-xl shrink-0">
                    <h3 class="font-bold text-gray-700 flex items-center gap-2">
                        <div class="w-6 h-6 rounded-md ${colorClass} flex items-center justify-center">
                            <i data-lucide="${icon}" class="w-3.5 h-3.5"></i>
                        </div>
                        ${status}
                    </h3>
                    <span class="bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full text-xs font-semibold">${columnTasks.length}</span>
                </div>
                
                <div class="p-3 flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-3 min-h-[50px] sortable-col" data-status="${status}">
                    ${columnTasks.map(task => createKanbanCard(task)).join('')}
                </div>
            </div>
        `;
    });

    board.innerHTML = html;
    lucide.createIcons({ root: board });

    // Initialize Drag & Drop
    const cols = document.querySelectorAll('.sortable-col');
    cols.forEach(col => {
        const instance = new Sortable(col, {
            group: 'kanban', // set both lists to same group
            animation: 150,
            ghostClass: 'sortable-ghost',
            delay: window.innerWidth < 768 ? 200 : 0, // delay on mobile to allow scrolling
            delayOnTouchOnly: true,
            onEnd: async function (evt) {
                const itemEl = evt.item;  // dragged HTMLElement
                const toCol = evt.to;    // target list

                const newStatus = toCol.getAttribute('data-status');
                const taskId = itemEl.getAttribute('data-id');

                if (taskId && newStatus && evt.from !== toCol) {
                    try {
                        const beforeTask = store.state.tasks.find(item => parseInt(item.id) === parseInt(taskId));
                        const beforeStatus = beforeTask?.status;
                        await store.updateTaskStatus(taskId, newStatus);
                        if (beforeStatus && beforeStatus !== newStatus) {
                            pushHistoryEntry({
                                type: 'status',
                                taskId: parseInt(taskId),
                                beforeStatus,
                                afterStatus: newStatus
                            });
                        }
                    } catch (error) {
                        if (error?.detail?.code === 'TASK_LOCKED') {
                            showNotification('Task Locked', error.detail.message || 'Another user is editing this task.', 'warning');
                            await store.fetchTaskLocks().catch(() => {});
                        } else {
                            showNotification('Update Failed', 'Unable to change task status right now.', 'error');
                        }
                        await store.fetchFromBackend(true).catch(() => {});
                    }
                }
            },
        });
        sortableInstances.push(instance);
    });

}

function createKanbanCard(task) {
    const priorityColor = `border-priority-${task.priority}`;
    const safeTaskId = Number(task.id) || 0;
    const safeClient = safe(task.client);
    const safeTaskName = safe(task.task);
    const safeProject = safe(task.project || '');
    const safeNotes = safe(task.notes || '');
    const safeStaff = safe(task.staff || 'Unknown');
    const safeWaitingFor = safe(task.waitingFor || '');
    const safeStaffInitial = safe((task.staff || 'U').charAt(0));
    const lock = getTaskLockInfo(task.id);
    const lockBadge = lock
        ? `<div class="absolute top-2 left-2 text-[10px] px-2 py-1 rounded-full bg-red-50 text-red-600 border border-red-200">Editing: ${safe(lock.lockedByName || lock.lockedBy)}</div>`
        : '';
    const lockClass = lock ? 'opacity-75 border-red-200' : '';

    return `
        <div class="bg-white p-3 rounded-lg shadow-sm hover:shadow-md cursor-grab active:cursor-grabbing border items-center border-l-4 border-y-gray-200 border-r-gray-200 ${priorityColor} ${lockClass} transition group relative" data-id="${safeTaskId}" onclick="openTaskModal(${safeTaskId})">
            ${lockBadge}
            
            <!-- Quick actions on hover -->
            <div class="absolute ${lock ? 'top-10' : 'top-2'} right-2 opacity-0 group-hover:opacity-100 transition flex gap-1 bg-white rounded-md shadow-sm border border-gray-100 p-0.5 z-10">
                <button class="p-1 text-gray-400 hover:text-primary rounded" onclick="event.stopPropagation(); openTaskModal(${safeTaskId})"><i data-lucide="edit-2" class="w-3.5 h-3.5"></i></button>
            </div>

            <div class="flex justify-between items-start mb-1.5 pr-6">
                <span class="text-xs font-semibold text-gray-500">#${safeTaskId} &bull; ${safeClient}</span>
            </div>
            
            <h4 class="text-sm font-semibold text-gray-800 leading-tight mb-1">${safeTaskName}</h4>
            ${task.project ? `<p class="text-xs text-gray-500 mb-2 truncate"><i data-lucide="home" class="w-3 h-3 inline mr-1 pb-0.5"></i>${safeProject}</p>` : ''}
            
            ${task.notes ? `<p class="text-xs text-gray-500 mb-3 line-clamp-2 italic border-l-2 pl-2">"${safeNotes}"</p>` : '<div class="mb-3"></div>'}
            
            <div class="flex items-center justify-between mt-auto">
                <div class="flex items-center gap-1.5">
                    <div class="w-6 h-6 rounded-full bg-primary-light text-primary flex items-center justify-center text-xs font-bold" title="${safeStaff}">
                        ${safeStaffInitial}
                    </div>
                </div>
                
                <div class="flex gap-2 text-xs">
                    ${task.waitingFor ? `<span class="text-red-500 font-medium" title="Waiting for: ${safeWaitingFor}"><i data-lucide="clock" class="w-3.5 h-3.5 inline"></i></span>` : ''}
                    <span class="${isOverdue(task.dueDate) ? 'text-red-600 font-bold bg-red-100 px-1.5 rounded' : 'text-gray-500'}">
                        ${formatDate(task.dueDate).replace(/, 202./, '')}
                    </span>
                </div>
            </div>
        </div>
    `;
}

// --- Module 3: All Tasks List ---
let currentSort = { column: 'id', dir: 'asc' };
let currentSearch = '';

function renderAllTasksList(state) {
    const tbody = document.getElementById('tasks-table-body');
    if (!tbody) return;

    let tasks = [...state.tasks];

    // Search filter
    if (currentSearch) {
        const lowerSearch = currentSearch.toLowerCase();
        tasks = tasks.filter(t =>
            t.task.toLowerCase().includes(lowerSearch) ||
            t.client.toLowerCase().includes(lowerSearch) ||
            (t.project && t.project.toLowerCase().includes(lowerSearch)) ||
            t.id.toString().includes(lowerSearch) ||
            t.staff.toLowerCase().includes(lowerSearch)
        );
    }

    // Sort
    tasks.sort((a, b) => {
        let valA = a[currentSort.column];
        let valB = b[currentSort.column];

        if (currentSort.column === 'dueDate' || currentSort.column === 'startDate') {
            valA = valA ? new Date(valA).getTime() : 0;
            valB = valB ? new Date(valB).getTime() : 0;
        } else if (typeof valA === 'string') {
            valA = valA.toLowerCase();
            valB = valB.toLowerCase();
        }

        if (valA < valB) return currentSort.dir === 'asc' ? -1 : 1;
        if (valA > valB) return currentSort.dir === 'asc' ? 1 : -1;
        return 0;
    });

    document.getElementById('tasks-count-display').textContent = `Showing ${tasks.length} task${tasks.length !== 1 ? 's' : ''}`;

    const visibleTaskIds = new Set(tasks.map(task => Number(task.id) || 0));
    Array.from(selectedTaskIds).forEach(taskId => {
        if (!visibleTaskIds.has(taskId)) {
            selectedTaskIds.delete(taskId);
        }
    });

    let html = '';
    tasks.forEach(task => {
        const safeTaskId = Number(task.id) || 0;
        const isChecked = selectedTaskIds.has(safeTaskId) ? 'checked' : '';
        const safeClient = safe(task.client);
        const safeProject = safe(task.project || '-');
        const safeTaskName = safe(task.task);
        const safeStaff = safe(task.staff || 'Unknown');
        const safeStaffInitial = safe((task.staff || 'U').charAt(0));
        const safeStatus = safe(task.status);
        const safePriority = safe(task.priority);

        html += `
            <tr class="hover:bg-gray-50 transition border-b border-gray-100 group">
                <td class="px-4 py-3 whitespace-nowrap">
                    <input type="checkbox" class="task-checkbox rounded border-gray-300 text-primary cursor-pointer w-4 h-4 focus:ring-primary" value="${safeTaskId}" ${isChecked}>
                </td>
                <td class="px-4 py-3 whitespace-nowrap font-mono text-xs text-gray-500">
                    #${safeTaskId}
                </td>
                <td class="px-4 py-3 whitespace-nowrap">
                    <div class="font-medium text-gray-800">${safeClient}</div>
                </td>
                <td class="px-4 py-3 whitespace-nowrap text-gray-600">
                    ${safeProject}
                </td>
                <td class="px-4 py-3 min-w-[200px]">
                    <div class="font-medium text-gray-800 w-full truncate max-w-xs cursor-pointer hover:text-primary hover:underline hover-active" onclick="openTaskModal(${safeTaskId}, {viewOnly: true})">${safeTaskName}</div>
                </td>
                <td class="px-4 py-3 whitespace-nowrap">
                    <div class="flex items-center gap-2 text-gray-700">
                        <div class="w-6 h-6 rounded-full bg-primary-light text-primary flex items-center justify-center text-xs font-bold">
                            ${safeStaffInitial}
                        </div>
                        ${safeStaff}
                    </div>
                </td>
                <td class="px-4 py-3 whitespace-nowrap">
                    <span class="status-badge ${getStatusColorClass(task.status)}">
                        <i data-lucide="${getStatusIcon(task.status)}" class="w-3 h-3 mr-1 inline-block"></i> ${safeStatus}
                    </span>
                </td>
                <td class="px-4 py-3 whitespace-nowrap">
                    <span class="text-xs font-bold px-2 py-1 rounded bg-priority-${safePriority} border border-priority-${safePriority} border-opacity-20 text-priority-${safePriority}">
                        ${safePriority}
                    </span>
                </td>
                <td class="px-4 py-3 whitespace-nowrap ${isOverdue(task.dueDate) && task.status !== 'Completed' ? 'text-red-600 font-semibold bg-red-50 rounded px-2' : 'text-gray-600'}">
                    ${formatDate(task.dueDate)}
                </td>
                <td class="px-4 py-3 whitespace-nowrap text-right text-sm font-medium">
                    <div class="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button class="text-gray-400 hover:text-primary transition p-1" onclick="openTaskModal(${safeTaskId})" title="Edit">
                            <i data-lucide="edit" class="w-4 h-4"></i>
                        </button>
                        <button class="text-gray-400 hover:text-red-500 transition p-1" onclick="deleteSingleTask(${safeTaskId})" title="Delete">
                            <i data-lucide="trash-2" class="w-4 h-4"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });

    if (tasks.length === 0) {
        html = `<tr><td colspan="10" class="px-4 py-8 text-center text-gray-500">No tasks found. Try adjusting your search/filters.</td></tr>`;
    }

    tbody.innerHTML = html;
    lucide.createIcons({ root: tbody });

    // Sort logic setup
    document.querySelectorAll('.sort-header').forEach(header => {
        // Clear old listeners
        const newHeader = header.cloneNode(true);
        header.parentNode.replaceChild(newHeader, header);

        newHeader.addEventListener('click', () => {
            const col = newHeader.getAttribute('data-sort');
            if (currentSort.column === col) {
                currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.column = col;
                currentSort.dir = 'asc';
            }

            // Update icons
            document.querySelectorAll('.sort-icon').forEach(icon => icon.classList.add('hidden'));
            const icon = newHeader.querySelector('.sort-icon');
            icon.classList.remove('hidden');
            if (currentSort.dir === 'desc') icon.setAttribute('data-lucide', 'chevron-up');
            else icon.setAttribute('data-lucide', 'chevron-down');
            lucide.createIcons();

            renderAllTasksList(store.state);
        });
    });

    // Checkbox logic
    const selectAll = document.getElementById('selectAllTasks');

    // Clear old listener
    const newSelectAll = selectAll.cloneNode(true);
    selectAll.parentNode.replaceChild(newSelectAll, selectAll);

    newSelectAll.addEventListener('change', (e) => {
        document.querySelectorAll('.task-checkbox').forEach(cb => {
            cb.checked = e.target.checked;
            const taskId = parseInt(cb.value);
            if (Number.isFinite(taskId)) {
                if (e.target.checked) selectedTaskIds.add(taskId);
                else selectedTaskIds.delete(taskId);
            }
            updateRowHighlight(cb);
        });
        updateBulkActionsState();
    });

    const allChecked = tasks.length > 0 && tasks.every(task => selectedTaskIds.has(Number(task.id) || 0));
    const someChecked = tasks.some(task => selectedTaskIds.has(Number(task.id) || 0));
    newSelectAll.checked = allChecked;
    newSelectAll.indeterminate = someChecked && !allChecked;

    document.querySelectorAll('.task-checkbox').forEach(cb => updateRowHighlight(cb));
    updateBulkActionsState();

    // Delegated listener for individual checkboxes
    tbody.removeEventListener('change', handleCheckboxChange);
    tbody.addEventListener('change', handleCheckboxChange);
}

function handleCheckboxChange(e) {
    if (e.target.classList.contains('task-checkbox')) {
        const taskId = parseInt(e.target.value);
        if (Number.isFinite(taskId)) {
            if (e.target.checked) selectedTaskIds.add(taskId);
            else selectedTaskIds.delete(taskId);
        }
        updateRowHighlight(e.target);
        updateBulkActionsState();

        // update selectAll state
        const allChecked = Array.from(document.querySelectorAll('.task-checkbox')).every(c => c.checked);
        const someChecked = Array.from(document.querySelectorAll('.task-checkbox')).some(c => c.checked);
        const selectAll = document.getElementById('selectAllTasks');
        selectAll.checked = allChecked;
        selectAll.indeterminate = someChecked && !allChecked;
    }
}

function updateRowHighlight(checkbox) {
    const row = checkbox.closest('tr');
    if (checkbox.checked) row.classList.add('selected-row');
    else row.classList.remove('selected-row');
}

function updateBulkActionsState() {
    const checkedCount = selectedTaskIds.size;
    const btn = document.getElementById('btn-bulk-actions');
    btn.disabled = checkedCount === 0;
    if (checkedCount === 0) {
        document.getElementById('bulk-actions-menu').classList.add('hidden');
    }
}

// --- Module 5: Client Management ---

function renderClientsList(state) {
    const tbody = document.getElementById('clients-table-body');
    if (!tbody) return;

    let html = '';
    const clients = state.config.clients;

    clients.forEach(client => {
        const activeTasks = state.tasks.filter(t => t.client === client.name && t.status !== 'Completed').length;
        const totalTasks = state.tasks.filter(t => t.client === client.name).length;
        const safeName = safe(client.name);
        const safeContact = safe(client.contact || '');
        const safeEmail = safe(client.email || '');
        const safePhone = safe(client.phone || '');
        const encodedName = encodeURIComponent(client.name);
        const deleteDisabledClass = activeTasks > 0 ? 'opacity-30 cursor-not-allowed' : '';
        const deleteDisabledAttr = activeTasks > 0 ? 'disabled' : '';

        html += `
            <tr class="hover:bg-gray-50 transition border-b border-gray-100 group">
                <td class="px-6 py-4">
                    <div class="font-bold text-gray-800">${safeName}</div>
                    ${client.contact ? `<div class="text-xs text-gray-500 mt-1"><i data-lucide="user" class="w-3 h-3 inline mr-1"></i>${safeContact}</div>` : ''}
                    ${client.email ? `<div class="text-xs text-gray-400 mt-0.5"><i data-lucide="mail" class="w-3 h-3 inline mr-1"></i>${safeEmail}</div>` : ''}
                    ${client.phone ? `<div class="text-xs text-gray-400 mt-0.5"><i data-lucide="phone" class="w-3 h-3 inline mr-1"></i>${safePhone}</div>` : ''}
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                    <span class="status-badge ${activeTasks > 0 ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-100 text-gray-600 border-gray-200'}">
                        ${activeTasks > 0 ? 'Active' : 'Inactive'}
                    </span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                    <div class="text-sm font-medium text-gray-700">${activeTasks} <span class="text-gray-400 font-normal">/ ${totalTasks} total</span></div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-right">
                    <div class="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button class="text-gray-400 hover:text-primary transition p-1" onclick="openClientModalByEncoded('${encodedName}')" title="Edit Client">
                            <i data-lucide="edit-2" class="w-4 h-4"></i>
                        </button>
                        <button class="text-gray-400 hover:text-red-500 transition p-1 ${deleteDisabledClass}" onclick="deleteClientActionByEncoded('${encodedName}')" title="Delete Client" ${deleteDisabledAttr}>
                            <i data-lucide="trash-2" class="w-4 h-4"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });

    if (clients.length === 0) {
        html = `<tr><td colspan="4" class="px-6 py-8 text-center text-gray-500">No clients found. Click Add Client to begin.</td></tr>`;
    }

    tbody.innerHTML = html;
    lucide.createIcons({ root: tbody });
}

window.openClientModalByEncoded = function (encodedClientName) {
    window.openClientModal(decodeURIComponent(encodedClientName));
}

window.deleteClientActionByEncoded = function (encodedClientName) {
    window.deleteClientAction(decodeURIComponent(encodedClientName));
}

window.deleteClientAction = async function (clientName) {
    if (confirm(`Are you sure you want to delete the client "${clientName}"? This action cannot be undone.`)) {
        try {
            await store.deleteClient(clientName);
            showNotification('Deleted', `Client "${clientName}" deleted successfully.`, 'success');
        } catch (error) {
            showNotification('Error', error.message, 'error');
        }
    }
}

// --- Module 4: Today's Tasks ---

function renderTodayTasks(state) {
    const todayList = document.getElementById('list-today');
    const overdueList = document.getElementById('list-overdue');
    const followupList = document.getElementById('list-followup');

    let dueToday = [], overdue = [], followUp = [];

    state.tasks.forEach(task => {
        if (task.status === 'Completed') return;

        if (isOverdue(task.dueDate)) {
            overdue.push(task);
        } else if (isToday(task.dueDate)) {
            dueToday.push(task);
        }

        if (task.status === 'Follow Up') {
            followUp.push(task);
        }
    });

    // Sort High to Low Priority
    const priorityWeight = { 'High': 3, 'Medium': 2, 'Low': 1 };
    const sortPrio = (a, b) => priorityWeight[b.priority] - priorityWeight[a.priority];

    dueToday.sort(sortPrio);
    followUp.sort(sortPrio);
    overdue.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)); // Oldest first

    // Update metrics
    document.getElementById('metric-today-due').textContent = dueToday.length;
    document.getElementById('metric-today-overdue').textContent = overdue.length;
    document.getElementById('metric-today-followup').textContent = followUp.length;

    document.getElementById('badge-today').textContent = `${dueToday.length} task${dueToday.length !== 1 ? 's' : ''}`;
    document.getElementById('badge-overdue').textContent = `${overdue.length} task${overdue.length !== 1 ? 's' : ''}`;
    document.getElementById('badge-followup').textContent = `${followUp.length} task${followUp.length !== 1 ? 's' : ''}`;

    document.getElementById('today-date-display').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    todayList.innerHTML = dueToday.length ? dueToday.map(createTodayCard).join('') : emptyState('No tasks due today. Awesome!');
    overdueList.innerHTML = overdue.length ? overdue.map(createTodayCard).join('') : emptyState('All caught up! No overdue tasks.', 'check-circle', 'text-green-500');
    followupList.innerHTML = followUp.length ? followUp.map(createTodayCard).join('') : emptyState('No follow-ups needed today.');

    lucide.createIcons({ root: document.getElementById('view-today') });
}

function emptyState(message, icon = 'smile', colorClass = 'text-gray-400') {
    return `
        <div class="bg-gray-50 border border-gray-200 border-dashed rounded-lg p-6 text-center text-gray-500 flex flex-col items-center justify-center gap-2">
            <i data-lucide="${icon}" class="w-8 h-8 ${colorClass} mb-1"></i>
            <p>${message}</p>
        </div>
    `;
}

function createTodayCard(task) {
    const isOverdueTask = isOverdue(task.dueDate);
    const safeTaskId = Number(task.id) || 0;
    const safePriority = safe(task.priority);
    const safeStatus = safe(task.status);
    const safeTaskName = safe(task.task);
    const safeClient = safe(task.client);
    const safeProject = safe(task.project || '');
    const safeNotes = safe(task.notes || '');
    const safeStaff = safe(task.staff || 'Unknown');

    return `
        <div class="bg-white p-4 rounded-xl shadow-sm hover:shadow-md transition-shadow border items-center border-l-4 border-y-gray-200 border-r-gray-200 border-priority-${task.priority}">
            <div class="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                
                <div class="flex-1">
                    <div class="flex items-center gap-2 mb-1">
                        <span class="text-xs font-mono text-gray-500">#${safeTaskId}</span>
                        <span class="text-xs font-bold px-2 py-0.5 rounded bg-priority-${safePriority} text-priority-${safePriority}">${safePriority}</span>
                        <span class="status-badge ${getStatusColorClass(task.status)}">${safeStatus}</span>
                    </div>
                    
                    <h4 class="text-lg font-bold text-gray-800 leading-tight mb-1 cursor-pointer hover:text-primary hover:underline" onclick="openTaskModal(${safeTaskId})">${safeTaskName}</h4>
                    <p class="text-sm text-gray-600 font-medium"><i data-lucide="home" class="w-4 h-4 inline mr-1 text-gray-400"></i>${safeClient} ${task.project ? `&rsaquo; ${safeProject}` : ''}</p>
                    ${task.notes ? `<p class="text-sm text-gray-500 mt-2 line-clamp-1 italic bg-gray-50 p-2 rounded">"${safeNotes}"</p>` : ''}
                </div>
                
                <div class="flex flex-row sm:flex-col items-end gap-3 sm:gap-2 justify-between w-full sm:w-auto mt-2 sm:mt-0 pt-3 sm:pt-0 border-t border-gray-100 sm:border-0">
                    <div class="flex gap-4 sm:gap-2">
                        <div class="flex items-center text-sm text-gray-600" title="${safeStaff}">
                            <i data-lucide="user" class="w-4 h-4 mr-1 text-gray-400"></i> ${safeStaff}
                        </div>
                        <div class="flex items-center text-sm ${isOverdueTask ? 'text-red-600 font-bold' : 'text-gray-600'}">
                            <i data-lucide="calendar" class="w-4 h-4 mr-1 ${isOverdueTask ? 'text-red-500' : 'text-gray-400'}"></i> ${formatDate(task.dueDate)}
                        </div>
                    </div>
                    
                    <div class="flex gap-2 w-full sm:w-auto mt-2 sm:mt-0">
                        <button onclick="markAsComplete(${safeTaskId})" class="flex-1 sm:flex-none px-3 py-1.5 bg-green-50 text-green-700 hover:bg-green-100 border border-green-200 rounded-md text-sm font-medium transition flex items-center justify-center gap-1">
                            <i data-lucide="check" class="w-4 h-4"></i> Complete
                        </button>
                        <button onclick="openTaskModal(${safeTaskId})" class="flex-1 sm:flex-none px-3 py-1.5 bg-white text-gray-700 hover:bg-gray-50 border border-gray-300 rounded-md text-sm font-medium transition flex items-center justify-center gap-1">
                            <i data-lucide="eye" class="w-4 h-4"></i> View
                        </button>
                    </div>
                </div>
                
            </div>
        </div>
    `;
}

// Global action handler
window.markAsComplete = async function (taskId) {
    if (confirm('Mark this task as completed?')) {
        const task = store.state.tasks.find(item => parseInt(item.id) === parseInt(taskId));
        const previousStatus = task?.status;
        try {
            await store.updateTaskStatus(taskId, 'Completed');
            if (previousStatus && previousStatus !== 'Completed') {
                pushHistoryEntry({
                    type: 'status',
                    taskId: parseInt(taskId),
                    beforeStatus: previousStatus,
                    afterStatus: 'Completed'
                });
            }
            showNotification('Task Completed', `Task #${taskId} has been marked as completed.`, 'success');
        } catch (error) {
            const message = error?.detail?.message || 'Unable to update this task now.';
            showNotification('Update Failed', message, 'warning');
        }
    }
}

// --- Forms and Setup ---

function populateSelects(config) {
    const selectors = [
        { id: 'task-client', options: config.clients.map(c => c.name).sort() },
        { id: 'task-staff', options: config.staff },
        { id: 'task-status', options: config.statuses },
    ];

    selectors.forEach(sel => {
        const el = document.getElementById(sel.id);
        if (!el) return;
        el.innerHTML = '';
        sel.options.forEach(opt => {
            const optionEl = document.createElement('option');
            optionEl.value = String(opt ?? '');
            optionEl.textContent = String(opt ?? '');
            el.appendChild(optionEl);
        });
    });
}

function setupFormHandlers() {
    // Search input
    const searchInput = document.getElementById('tasks-search');
    const searchClear = document.getElementById('tasks-search-clear');

    // Header Menus
    const headerSearchBtn = document.getElementById('header-search-btn');
    const headerSearchPanel = document.getElementById('header-search-panel');
    const headerBellBtn = document.getElementById('header-bell-btn');
    const headerNotifPanel = document.getElementById('header-notifications-panel');
    const headerUserBtn = document.getElementById('header-user-menu-btn');
    const headerUserPanel = document.getElementById('header-user-panel');

    function closeAllHeaderMenus() {
        headerSearchPanel?.classList.add('hidden');
        headerNotifPanel?.classList.add('hidden');
        headerUserPanel?.classList.add('hidden');
    }

    headerSearchBtn?.addEventListener('click', (e) => { e.stopPropagation(); const isHidden = headerSearchPanel.classList.contains('hidden'); closeAllHeaderMenus(); if (isHidden) headerSearchPanel.classList.remove('hidden'); });
    headerBellBtn?.addEventListener('click', (e) => { e.stopPropagation(); const isHidden = headerNotifPanel.classList.contains('hidden'); closeAllHeaderMenus(); if (isHidden) headerNotifPanel.classList.remove('hidden'); });
    headerUserBtn?.addEventListener('click', (e) => { e.stopPropagation(); const isHidden = headerUserPanel.classList.contains('hidden'); closeAllHeaderMenus(); if (isHidden) headerUserPanel.classList.remove('hidden'); });

    // Close menus on outside click globally
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#header-search-panel') && !e.target.closest('#header-search-btn')) headerSearchPanel?.classList.add('hidden');
        if (!e.target.closest('#header-notifications-panel') && !e.target.closest('#header-bell-btn')) headerNotifPanel?.classList.add('hidden');
        if (!e.target.closest('#header-user-panel') && !e.target.closest('#header-user-menu-btn')) headerUserPanel?.classList.add('hidden');
    });

    searchInput.addEventListener('input', (e) => {
        currentSearch = e.target.value;
        if (currentSearch) searchClear.classList.remove('hidden');
        else searchClear.classList.add('hidden');
        renderAllTasksList(store.state);
    });

    searchClear.addEventListener('click', () => {
        searchInput.value = '';
        currentSearch = '';
        searchClear.classList.add('hidden');
        renderAllTasksList(store.state);
    });

    // Refresh Dashboard button
    document.getElementById('refresh-dashboard-btn').addEventListener('click', () => {
        document.getElementById('global-loader').classList.remove('hidden');
        store.init().then(() => {
            refreshDashboardOperationalData(true);
            document.getElementById('global-loader').classList.add('hidden');
            showNotification('Refreshed', 'Dashboard data has been synchronized.', 'success');
        });
    });

    document.getElementById('btn-export-sessions-csv')?.addEventListener('click', async () => {
        document.getElementById('btn-settings-export-sessions')?.click();
    });

    // Bulk actions
    document.getElementById('btn-bulk-actions').addEventListener('click', () => {
        document.getElementById('bulk-actions-menu').classList.toggle('hidden');
    });

    // Hide bulk menu on outside click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#btn-bulk-actions') && !e.target.closest('#bulk-actions-menu')) {
            document.getElementById('bulk-actions-menu')?.classList.add('hidden');
        }
    });

    document.querySelectorAll('.bulk-action').forEach(action => {
        action.addEventListener('click', async (e) => {
            e.preventDefault();
            document.getElementById('bulk-actions-menu').classList.add('hidden');
            const type = e.target.getAttribute('data-action');
            const selectedIds = Array.from(selectedTaskIds.values());

            if (type === 'delete' && selectedIds.length > 0) {
                if (confirm(`Are you sure you want to delete ${selectedIds.length} tasks?`)) {
                    const deletedSnapshots = store.state.tasks
                        .filter(task => selectedIds.includes(parseInt(task.id)))
                        .map(task => cloneTask(task));
                    try {
                        await store.deleteTasks(selectedIds);
                        selectedIds.forEach(id => selectedTaskIds.delete(id));
                        if (deletedSnapshots.length) {
                            pushHistoryEntry({ type: 'delete', tasks: deletedSnapshots });
                        }
                        showNotification('Deleted', `${selectedIds.length} tasks deleted successfully.`, 'success');
                    } catch (error) {
                        const message = error?.detail?.message || 'Bulk delete failed due to a conflict.';
                        showNotification('Delete Failed', message, 'warning');
                    }
                }
            }
        });
    });

    // Export actions
    document.getElementById('btn-export-dropdown')?.addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('export-actions-menu').classList.toggle('hidden');
    });

    document.getElementById('btn-export-csv')?.addEventListener('click', (e) => {
        e.preventDefault();
        exportTasksCSV(store.state.tasks);
        document.getElementById('export-actions-menu').classList.add('hidden');
    });

    document.getElementById('btn-export-pdf')?.addEventListener('click', (e) => {
        e.preventDefault();

        const tasks = store.state.tasks;
        const printWindow = window.open('', '', 'width=1000,height=800');

        let printHtml = `
            <html><head><title>WeRunOps Tasks Export</title>
            <style>
                body { font-family: system-ui, sans-serif; padding: 20px; color: #333; }
                h1 { border-bottom: 2px solid #eee; padding-bottom: 10px; margin-bottom: 20px; }
                table { border-collapse: collapse; width: 100%; font-size: 13px; }
                th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
                th { background-color: #f9fafb; font-weight: 600; color: #4B5563; }
                .meta { color: #666; font-size: 13px; margin-bottom: 20px; }
            </style>
            </head><body>
            <h1>WeRunOps Task Export</h1>
            <div class="meta">Exported on: ${new Date().toLocaleString()} &bull; Total Tasks: ${tasks.length}</div>
            <table>
            <thead><tr>
                <th>ID</th><th>Client</th><th>Project</th><th>Task Name</th><th>Staff</th><th>Status</th><th>Priority</th><th>Due Date</th>
            </tr></thead><tbody>
        `;

        tasks.sort((a, b) => a.id - b.id).forEach(t => {
            printHtml += `<tr>
                <td style="color:#6B7280">#${t.id}</td>
                <td><strong>${t.client}</strong></td>
                <td>${t.project || '-'}</td>
                <td>${t.task}</td>
                <td>${t.staff}</td>
                <td>${t.status}</td>
                <td>${t.priority}</td>
                <td>${formatDate(t.dueDate)}</td>
            </tr>`;
        });

        printHtml += '</tbody></table></body></html>';

        printWindow.document.open();
        printWindow.document.write(printHtml);
        printWindow.document.close();

        printWindow.setTimeout(() => {
            printWindow.print();
        }, 500);

        document.getElementById('export-actions-menu').classList.add('hidden');
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#btn-export-dropdown') && !e.target.closest('#export-actions-menu')) {
            document.getElementById('export-actions-menu')?.classList.add('hidden');
        }
    });
}

window.deleteSingleTask = async function (taskId) {
    if (confirm(`Are you sure you want to delete Task #${taskId}?`)) {
        const snapshot = cloneTask(store.state.tasks.find(task => parseInt(task.id) === parseInt(taskId)));
        try {
            await store.deleteTasks([taskId]);
            if (snapshot) {
                pushHistoryEntry({ type: 'delete', tasks: [snapshot] });
            }
            showNotification('Deleted', `Task #${taskId} deleted successfully.`, 'success');
        } catch (error) {
            const message = error?.detail?.message || 'Could not delete task right now.';
            showNotification('Delete Failed', message, 'warning');
        }
    }
}

function exportTasksCSV(tasks) {
    const csvSafe = (value) => {
        const raw = String(value ?? '');
        const neutralized = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
        return `"${neutralized.replace(/"/g, '""')}"`;
    };

    let csv = 'ID,Client,Project,Task,Staff,Status,Priority,Due Date\\n';
    tasks.forEach(t => {
        csv += [
            csvSafe(t.id),
            csvSafe(t.client),
            csvSafe(t.project || ''),
            csvSafe(t.task),
            csvSafe(t.staff),
            csvSafe(t.status),
            csvSafe(t.priority),
            csvSafe(t.dueDate)
        ].join(',') + '\\n';
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `werunops-export-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
}

function initModals() {
    const modalBackdrop = document.getElementById('modal-backdrop');
    const taskModal = document.getElementById('modal-task');
    const form = document.getElementById('task-form');

    // Open standard task modal
    document.querySelectorAll('.btn-add-task').forEach(btn => {
        btn.addEventListener('click', () => openTaskModal(null));
    });

    // Close Modals
    document.querySelectorAll('.btn-close-modal').forEach(btn => {
        btn.addEventListener('click', closeTaskModal);
    });

    // Close on backdrop click
    modalBackdrop.addEventListener('click', (e) => {
        if (e.target === modalBackdrop) closeTaskModal();
    });

    // Form Submit
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        // UI Loading State
        const submitBtn = document.getElementById('btn-save-task');
        const spinner = document.getElementById('save-task-spinner');
        submitBtn.disabled = true;
        spinner.classList.remove('hidden');
        document.getElementById('save-task-text').textContent = 'Saving...';

        const formData = new FormData(form);
        const taskData = Object.fromEntries(formData.entries());
        const existingTask = taskData.id
            ? cloneTask(store.state.tasks.find(item => parseInt(item.id) === parseInt(taskData.id)))
            : null;

        try {
            const savedTask = await store.saveTask(taskData);

            if (savedTask && !existingTask) {
                pushHistoryEntry({ type: 'create', task: cloneTask(savedTask) });
            }

            if (savedTask && existingTask) {
                const latest = cloneTask(store.state.tasks.find(item => parseInt(item.id) === parseInt(savedTask.id)));
                pushHistoryEntry({ type: 'update', before: existingTask, after: latest || cloneTask(savedTask) });
            }

            closeTaskModal();
            showNotification('Success', `Task successfully saved.`, 'success');
        } catch (error) {
            if (error?.detail?.code === 'TASK_LOCKED') {
                showNotification('Task Locked', error.detail.message || 'Another user is editing this task.', 'warning');
            } else {
                showNotification('Error', 'Failed to save task. Please try again.', 'error');
            }
            console.error(error);
        } finally {
            submitBtn.disabled = false;
            spinner.classList.add('hidden');
            document.getElementById('save-task-text').textContent = 'Save Task';
        }
    });

    // Client Form Handlers
    const clientModalBackdrop = document.getElementById('modal-client');
    const clientForm = document.getElementById('client-form');

    document.getElementById('btn-add-client')?.addEventListener('click', () => openClientModal(null));

    document.querySelectorAll('.btn-close-client-modal').forEach(btn => {
        btn.addEventListener('click', closeClientModal);
    });

    clientForm?.addEventListener('submit', async (e) => {
        e.preventDefault();

        const submitBtn = document.getElementById('btn-save-client');
        const spinner = document.getElementById('save-client-spinner');
        submitBtn.disabled = true;
        spinner.classList.remove('hidden');
        document.getElementById('save-client-text').textContent = 'Saving...';

        const formData = new FormData(clientForm);
        const submitData = Object.fromEntries(formData.entries());
        submitData.originalName = document.getElementById('client-original-name').value;

        try {
            await store.saveClient(submitData);
            closeClientModal();
            showNotification('Success', `Client successfully saved.`, 'success');
        } catch (error) {
            showNotification('Error', 'Failed to save client.', 'error');
            console.error(error);
        } finally {
            submitBtn.disabled = false;
            spinner.classList.add('hidden');
            document.getElementById('save-client-text').textContent = 'Save Client';
        }
    });

    // Follow-up Clear Action
    document.getElementById('btn-clear-relationship')?.addEventListener('click', () => {
        document.getElementById('task-parent-id').value = '';
        document.getElementById('task-relationship-container').classList.add('hidden');
    });

    // Trigger Add Follow-up from within task modal
    document.getElementById('btn-add-followup')?.addEventListener('click', () => {
        const currentTaskId = parseInt(document.getElementById('task-id').value);
        const task = store.state.tasks.find(t => t.id === currentTaskId);
        if (task) {
            closeTaskModal();
            setTimeout(() => {
                openTaskModal(null, {
                    parentId: task.id,
                    client: task.client,
                    project: task.project || '',
                    staff: task.staff,
                    taskName: `Follow up on: ${task.task}`
                });
            }, 350); // wait for modal close transition
        }
    });
}

window.openTaskModal = async function (taskId = null, defaults = {}) {
    const modalBackdrop = document.getElementById('modal-backdrop');
    const taskModal = document.getElementById('modal-task');
    const form = document.getElementById('task-form');
    form.reset();

    if (currentLockedTaskId && (!taskId || parseInt(taskId) !== parseInt(currentLockedTaskId))) {
        await store.releaseTaskLock(currentLockedTaskId);
        currentLockedTaskId = null;
    }
    if (taskLockRefreshTimer) {
        clearInterval(taskLockRefreshTimer);
        taskLockRefreshTimer = null;
    }

    const fields = ['task-client', 'task-project', 'task-name', 'task-staff', 'task-status', 'task-priority', 'task-start-date', 'task-due-date', 'task-waiting', 'task-notes'];
    fields.forEach(f => {
        const el = document.getElementById(f);
        if (el) {
            el.disabled = false;
            el.classList.remove('bg-gray-50', 'text-gray-500', 'cursor-not-allowed', 'border-transparent');
            el.classList.add('border-gray-300');
        }
    });
    document.getElementById('btn-save-task').classList.remove('hidden');

    document.getElementById('task-activity-container').classList.add('hidden');
    document.getElementById('task-children-container').classList.add('hidden');
    document.getElementById('modal-priority-display').classList.add('hidden');
    document.getElementById('task-relationship-container').classList.add('hidden');
    document.getElementById('btn-add-followup')?.classList.add('hidden');
    document.getElementById('task-parent-id').value = '';

    if (taskId) {
        if (!defaults.viewOnly && store.isBackendReady()) {
            try {
                await store.acquireTaskLock(taskId, 75);
                currentLockedTaskId = parseInt(taskId);
                taskLockRefreshTimer = setInterval(() => {
                    store.acquireTaskLock(taskId, 75).catch(() => {});
                }, 30000);
            } catch (error) {
                defaults.viewOnly = true;
                const lockMessage = error?.detail?.message || 'Another user is editing this task right now.';
                showNotification('Task Locked', lockMessage, 'warning');
            }
        }

        // Edit mode
        document.getElementById('modal-task-title').textContent = 'Edit Task';
        document.getElementById('modal-task-id').textContent = `#${taskId}`;
        document.getElementById('modal-task-id').classList.remove('hidden');

        const task = store.state.tasks.find(t => t.id === parseInt(taskId));
        if (task) {
            document.getElementById('btn-add-followup')?.classList.remove('hidden');

            // Link visualization check
            if (task.parentId) {
                document.getElementById('task-parent-id').value = task.parentId;
                document.getElementById('task-relationship-text').textContent = `Following up on task #${task.parentId}`;
                document.getElementById('task-relationship-container').classList.remove('hidden');
            }

            // Populate form
            document.getElementById('task-id').value = task.id;
            document.getElementById('task-client').value = task.client;
            document.getElementById('task-project').value = task.project || '';
            document.getElementById('task-name').value = task.task;
            document.getElementById('task-staff').value = task.staff;
            document.getElementById('task-status').value = task.status;
            document.getElementById('task-priority').value = task.priority;

            if (task.startDate) document.getElementById('task-start-date').value = task.startDate.split('T')[0];
            if (task.dueDate) document.getElementById('task-due-date').value = task.dueDate.split('T')[0];

            document.getElementById('task-waiting').value = task.waitingFor || '';
            document.getElementById('task-notes').value = task.notes || '';

            // Priority badge
            const prioDisplay = document.getElementById('modal-priority-display');
            const safePriority = safe(task.priority);
            prioDisplay.innerHTML = `<span class="bg-priority-${safePriority} text-priority-${safePriority} px-3 py-1 rounded-full text-xs font-bold border border-priority-${safePriority} border-opacity-20">${safePriority}</span>`;
            prioDisplay.classList.remove('hidden');

            // Activity Log
            if (task.activityLog && task.activityLog.length > 0) {
                const logContainer = document.getElementById('task-activity-container');
                const logList = document.getElementById('task-activity-log');

                let logHtml = '';
                [...task.activityLog].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).forEach(log => {
                    const safeLogUser = safe(log.user);
                    const safeLogAction = safe(log.action);
                    logHtml += `
                        <li class="relative pl-6 md:pl-0">
                            <div class="hidden md:block absolute left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-primary border-4 border-white"></div>
                            <div class="md:w-[calc(50%-1.5rem)] md:ml-auto bg-gray-50 border border-gray-100 p-3 rounded shadow-sm text-sm">
                                <span class="font-semibold text-gray-800">${safeLogUser}</span>: ${safeLogAction}
                                <div class="text-xs text-gray-400 mt-1">${formatDate(log.timestamp)} at ${new Date(log.timestamp).toLocaleTimeString()}</div>
                            </div>
                        </li>
                    `;
                });
                logList.innerHTML = logHtml;
                logContainer.classList.remove('hidden');
            }

            // Follow up children logic
            const childrenTasks = store.state.tasks.filter(t => t.parentId == task.id);
            if (childrenTasks.length > 0) {
                const childContainer = document.getElementById('task-children-container');
                const childList = document.getElementById('task-children-list');

                childList.innerHTML = childrenTasks.map(c => `
                    <div class="bg-gray-50 border border-gray-100 p-2.5 rounded text-sm hover:border-primary border-opacity-40 hover:bg-white transition cursor-pointer flex justify-between items-center" onclick="closeTaskModal(); setTimeout(() => openTaskModal(${Number(c.id) || 0}, {viewOnly: true}), 350)">
                        <div class="flex items-center gap-3">
                            <span class="status-badge ${getStatusColorClass(c.status)}">${safe(c.status)}</span>
                            <span class="font-semibold text-gray-800">#${Number(c.id) || 0} ${safe(c.task)}</span>
                        </div>
                        <i data-lucide="chevron-right" class="w-4 h-4 text-gray-400"></i>
                    </div>
                `).join('');
                childContainer.classList.remove('hidden');
                lucide.createIcons({ root: childList });
            }
        }
    } else {
        // Add mode
        document.getElementById('modal-task-title').textContent = 'Add New Task';
        document.getElementById('modal-task-id').classList.add('hidden');
        document.getElementById('task-id').value = '';

        // Defaults
        if (defaults.status) {
            document.getElementById('task-status').value = defaults.status;
        }
        if (defaults.parentId) {
            document.getElementById('task-parent-id').value = defaults.parentId;
            document.getElementById('task-relationship-text').textContent = `Following up on task #${defaults.parentId}`;
            document.getElementById('task-relationship-container').classList.remove('hidden');

            document.getElementById('task-client').value = defaults.client;
            document.getElementById('task-project').value = defaults.project;
            document.getElementById('task-staff').value = defaults.staff;
            document.getElementById('task-name').value = defaults.taskName;
        }
    }

    if (defaults.viewOnly) {
        document.getElementById('modal-task-title').textContent = 'Task Details (Read-only)';
        document.getElementById('btn-save-task').classList.add('hidden');

        fields.forEach(f => {
            const el = document.getElementById(f);
            if (el) {
                el.disabled = true;
                el.classList.add('bg-gray-50', 'text-gray-500', 'cursor-not-allowed', 'border-transparent');
                el.classList.remove('border-gray-300');
            }
        });
    }

    // Show modal with animation
    modalBackdrop.classList.remove('hidden');
    // slight delay for transition class to take effect
    setTimeout(() => {
        modalBackdrop.classList.remove('opacity-0');
        taskModal.classList.remove('hidden');
        setTimeout(() => taskModal.classList.remove('scale-95'), 10);
    }, 10);

    document.body.classList.add('modal-open');
}

function closeTaskModal() {
    const modalBackdrop = document.getElementById('modal-backdrop');
    const taskModal = document.getElementById('modal-task');

    taskModal.classList.add('scale-95');
    modalBackdrop.classList.add('opacity-0');

    setTimeout(() => {
        modalBackdrop.classList.add('hidden');
        taskModal.classList.add('hidden');
        document.body.classList.remove('modal-open');
    }, 300); // match duration-300

    if (currentLockedTaskId) {
        store.releaseTaskLock(currentLockedTaskId).catch(() => {});
        currentLockedTaskId = null;
    }
    if (taskLockRefreshTimer) {
        clearInterval(taskLockRefreshTimer);
        taskLockRefreshTimer = null;
    }
}

window.openClientModal = function (clientName = null) {
    const modalBackdrop = document.getElementById('modal-client');
    const form = document.getElementById('client-form');
    form.reset();
    document.getElementById('client-original-name').value = '';

    if (clientName) {
        document.getElementById('modal-client-title').textContent = 'Edit Client';
        const client = store.state.config.clients.find(c => c.name === clientName);
        if (client) {
            document.getElementById('client-original-name').value = client.name;
            document.getElementById('client-name').value = client.name;
            document.getElementById('client-contact').value = client.contact || '';
            document.getElementById('client-email').value = client.email || '';
            document.getElementById('client-phone').value = client.phone || '';
        }
    } else {
        document.getElementById('modal-client-title').textContent = 'Add New Client';
    }

    modalBackdrop.classList.remove('hidden');
    setTimeout(() => {
        modalBackdrop.classList.remove('opacity-0');
        modalBackdrop.querySelector('.bg-white').classList.remove('scale-95');
    }, 10);
    document.body.classList.add('modal-open');
}

function closeClientModal() {
    const modalBackdrop = document.getElementById('modal-client');
    const modalBox = modalBackdrop.querySelector('.bg-white');

    modalBox.classList.add('scale-95');
    modalBackdrop.classList.add('opacity-0');

    setTimeout(() => {
        modalBackdrop.classList.add('hidden');
        document.body.classList.remove('modal-open');
    }, 300);
}

function initFilters() {
    // Side panel toggle
    const filterOverlay = document.getElementById('side-panel-overlay');
    const filterPanel = document.getElementById('filter-panel');

    function openFilters() {
        filterOverlay.classList.remove('hidden');
        setTimeout(() => {
            filterOverlay.classList.remove('opacity-0');
            filterPanel.classList.remove('translate-x-full');
        }, 10);
        document.body.classList.add('modal-open');
    }

    function closeFilters() {
        filterPanel.classList.add('translate-x-full');
        filterOverlay.classList.add('opacity-0');
        setTimeout(() => {
            filterOverlay.classList.add('hidden');
            document.body.classList.remove('modal-open');
        }, 300);
    }

    document.querySelectorAll('.btn-filter-toggle').forEach(btn => btn.addEventListener('click', openFilters));
    document.querySelectorAll('.btn-close-filters').forEach(btn => btn.addEventListener('click', closeFilters));
    filterOverlay.addEventListener('click', closeFilters);

    const controls = document.getElementById('filter-controls');
    if (controls) {
        controls.innerHTML = `
            <p class="text-sm text-gray-500">Filter criteria can be customized here to refine task views across the application.</p>
        `;
    }
}

// --- Auth & Header Features ---
async function sha256Hex(input) {
    const payload = String(input ?? '');
    const encoder = new TextEncoder();
    const bytes = encoder.encode(payload);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const arr = Array.from(new Uint8Array(digest));
    return arr.map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function signInWithFirebaseAuth(email, password) {
    if (!CONFIG.firebaseWebApiKey) return null;

    const endpoint = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(CONFIG.firebaseWebApiKey)}`;
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email,
            password,
            returnSecureToken: true
        })
    });

    if (!response.ok) return null;
    return response.json();
}

function buildSafeSession(user, options = {}) {
    const now = new Date().toISOString();
    return {
        username: user.username,
        name: user.name,
        role: user.role,
        initials: user.initials,
        sessionStart: options.sessionStart || now,
        provider: options.provider || 'legacy',
        accessToken: options.accessToken || null,
        firebaseUid: options.firebaseUid || null,
        idToken: options.idToken || null,
        refreshToken: options.refreshToken || null,
        email: options.email || user.email || null
    };
}

async function backendApiFetch(path, options = {}, token = null) {
    if (!CONFIG.backendApiBase) return null;
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(`${CONFIG.backendApiBase}${path}`, {
        ...options,
        headers
    });
    return response;
}

async function ensureBackendSession() {
    if (!store.isBackendReady() || !currentUser?.accessToken) return false;
    if (currentUser.sessionId) return true;

    try {
        const sessionResponse = await backendApiFetch(
            '/sessions/start',
            {
                method: 'POST',
                body: JSON.stringify({ browser: navigator.userAgent, device: 'Web' })
            },
            currentUser.accessToken
        );
        if (!sessionResponse || !sessionResponse.ok) return false;

        const payload = await sessionResponse.json();
        const sessionId = payload?.data?.id || null;
        if (!sessionId) return false;

        currentUser.sessionId = sessionId;
        persistSession(currentUser);
        return true;
    } catch (error) {
        return false;
    }
}

function persistSession(session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function readSession() {
    try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !parsed.username || !parsed.name) return null;
        return parsed;
    } catch (error) {
        return null;
    }
}

async function authenticateLegacyUser(usernameInput, passwordInput) {
    const validUsers = store.state.authUsers || [];
    const user = validUsers.find(u => u.username.toLowerCase() === usernameInput.toLowerCase());
    if (!user || !user.passwordHash) return null;

    const incomingHash = await sha256Hex(passwordInput);
    if (incomingHash !== user.passwordHash) return null;
    return buildSafeSession(user, { provider: 'legacy' });
}

async function authenticateWithBackend(usernameInput, passwordInput) {
    if (!store.isBackendReady()) return null;

    const response = await backendApiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
            username: usernameInput,
            password: passwordInput,
            deviceInfo: { browser: navigator.userAgent, device: 'Web' }
        })
    });

    if (!response || !response.ok) return null;
    const payload = await response.json();
    const data = payload?.data;
    if (!data?.profile || !data?.accessToken) return null;

    const session = buildSafeSession(data.profile, {
        provider: 'backend',
        accessToken: data.accessToken
    });

    const sessionResponse = await backendApiFetch(
        '/sessions/start',
        {
            method: 'POST',
            body: JSON.stringify({ browser: navigator.userAgent, device: 'Web' })
        },
        data.accessToken
    );

    if (sessionResponse && sessionResponse.ok) {
        const sessionPayload = await sessionResponse.json();
        session.sessionId = sessionPayload?.data?.id || null;
    }

    return session;
}

async function authenticateWithFirebaseOrLegacy(usernameInput, passwordInput) {
    if (store.isBackendReady()) {
        return authenticateWithBackend(usernameInput, passwordInput);
    }

    const validUsers = store.state.authUsers || [];
    const matchedUser = validUsers.find(u => u.username.toLowerCase() === usernameInput.toLowerCase() || (u.email && u.email.toLowerCase() === usernameInput.toLowerCase()));

    if (CONFIG.firebaseWebApiKey && matchedUser && matchedUser.email) {
        const authData = await signInWithFirebaseAuth(matchedUser.email, passwordInput);
        if (authData && authData.localId) {
            return buildSafeSession(matchedUser, {
                provider: 'firebase',
                firebaseUid: authData.localId,
                idToken: authData.idToken,
                refreshToken: authData.refreshToken,
                email: matchedUser.email
            });
        }
    }

    return authenticateLegacyUser(usernameInput, passwordInput);
}

function bindSessionActivityListeners() {
    if (sessionActivityBound) return;
    const markActive = () => {
        lastActivityAt = Date.now();
    };

    ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'].forEach(eventName => {
        window.addEventListener(eventName, markActive, { passive: true });
    });
    document.addEventListener('visibilitychange', markActive, { passive: true });
    sessionActivityBound = true;
}

async function flushSessionHeartbeat(force = false) {
    if (!store.isBackendReady() || !currentUser?.accessToken || !currentUser?.sessionId) return;

    const now = Date.now();
    const elapsedSeconds = Math.max(1, Math.floor((now - lastHeartbeatAt) / 1000));
    lastHeartbeatAt = now;

    const isIdle = (now - lastActivityAt) > 15 * 60 * 1000;
    if (isIdle) {
        sessionIdleSecondsBucket += elapsedSeconds;
    } else {
        sessionActiveSecondsBucket += elapsedSeconds;
    }

    const shouldSend = force || (sessionActiveSecondsBucket + sessionIdleSecondsBucket >= 60);
    if (!shouldSend) return;

    const payload = {
        activeSeconds: sessionActiveSecondsBucket,
        idleSeconds: sessionIdleSecondsBucket
    };

    sessionActiveSecondsBucket = 0;
    sessionIdleSecondsBucket = 0;

    try {
        const heartbeatResponse = await backendApiFetch(`/sessions/${currentUser.sessionId}/heartbeat`, {
            method: 'POST',
            body: JSON.stringify(payload)
        }, currentUser.accessToken);

        if (heartbeatResponse && heartbeatResponse.status === 404) {
            currentUser.sessionId = null;
            persistSession(currentUser);
            await ensureBackendSession();
        }
    } catch (error) {
        console.warn('Session heartbeat failed:', error);
    }
}

function startSessionActivityTracking() {
    if (!store.isBackendReady() || !currentUser?.sessionId) return;
    bindSessionActivityListeners();

    lastActivityAt = Date.now();
    lastHeartbeatAt = Date.now();
    sessionActiveSecondsBucket = 0;
    sessionIdleSecondsBucket = 0;

    if (sessionHeartbeatTimer) clearInterval(sessionHeartbeatTimer);
    sessionHeartbeatTimer = setInterval(() => {
        flushSessionHeartbeat(false);
    }, 15000);
}

function stopSessionActivityTracking() {
    if (sessionHeartbeatTimer) {
        clearInterval(sessionHeartbeatTimer);
        sessionHeartbeatTimer = null;
    }
    sessionActiveSecondsBucket = 0;
    sessionIdleSecondsBucket = 0;
}

async function validateBackendSessionToken(session) {
    if (!session?.accessToken) return false;
    try {
        const response = await backendApiFetch('/auth/me', {}, session.accessToken);
        return !!(response && response.ok);
    } catch (error) {
        return false;
    }
}

async function setupAuth() {
    const loginForm = document.getElementById('login-form');
    const errorMsg = document.getElementById('login-error-msg');

    // Check for existing session
    const storedSession = readSession();
    if (storedSession) {
        if (store.isBackendReady()) {
            const validBackendSession = await validateBackendSessionToken(storedSession);
            if (!validBackendSession) {
                localStorage.removeItem(SESSION_KEY);
                currentUser = null;
                window.location.hash = '#/login';
            } else {
                currentUser = { ...storedSession };
                if (!store.hasLoadedBackendState) {
                    store.fetchFromBackend(true).catch(() => {});
                }
                await ensureBackendSession();
                store.startPresenceHeartbeat(currentUser.username);
                store.startPresenceListener(() => updateHeaderProfile());
                store.startTaskLockListener();
                store.startBackendSyncPolling?.();
                startSessionActivityTracking();
                updateHeaderProfile();
            }
        } else {
            const validUsers = store.state.authUsers || [];
            const user = validUsers.find(u => u.username === storedSession.username);
            if (user) {
                currentUser = { ...storedSession, ...user, passwordHash: undefined };
                store.startPresenceHeartbeat(currentUser.username);
                store.startPresenceListener(() => updateHeaderProfile());
                updateHeaderProfile();
            } else {
                localStorage.removeItem(SESSION_KEY);
                window.location.hash = '#/login';
            }
        }
    }

    loginForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const usernameInput = document.getElementById('login-username').value.trim();
        const passwordInput = document.getElementById('login-password').value;
        const spinner = document.getElementById('login-spinner');
        const loginText = document.getElementById('login-text');
        const submitBtn = loginForm.querySelector('button[type="submit"]');

        // Prevent double clicks
        if (submitBtn.disabled) return;

        submitBtn.disabled = true;
        spinner.classList.remove('hidden');
        loginText.textContent = 'Signing In...';
        if (errorMsg) errorMsg.classList.add('hidden');

        try {
            const session = await authenticateWithFirebaseOrLegacy(usernameInput, passwordInput);

            if (session) {
                currentUser = { ...session };
                persistSession(currentUser);

                if (store.isBackendReady()) {
                    await store.fetchFromBackend();
                    store.startTaskLockListener();
                    store.startBackendSyncPolling?.();
                }

                store.startPresenceHeartbeat(currentUser.username);
                store.startPresenceListener(() => updateHeaderProfile());
                startSessionActivityTracking();

                window.location.hash = '#/dashboard';
                updateHeaderProfile();
                showNotification('Welcome', `Successfully signed in as ${currentUser.name}.`, 'success');
            } else if (errorMsg) {
                errorMsg.textContent = 'Invalid username or password.';
                errorMsg.classList.remove('hidden');
            } else {
                showNotification('Login Failed', 'Invalid username or password.', 'error');
            }
        } catch (error) {
            console.error(error);
            if (errorMsg) {
                errorMsg.textContent = 'Login failed. Please retry.';
                errorMsg.classList.remove('hidden');
            }
        } finally {
            submitBtn.disabled = false;
            spinner.classList.add('hidden');
            loginText.textContent = 'Sign In';
        }
    });

    document.getElementById('btn-logout')?.addEventListener('click', async (e) => {
        e.preventDefault();
        
        if (!store.isBackendReady() && currentUser && currentUser.sessionStart) {
            logSessionHistory(currentUser.username, currentUser.name, currentUser.sessionStart);
        }
        
        store.stopPresenceHeartbeat();
        store.stopTaskLockListener();
        store.stopBackendSyncPolling?.();
        if (currentLockedTaskId) {
            await store.releaseTaskLock(currentLockedTaskId);
            currentLockedTaskId = null;
        }
        if (taskLockRefreshTimer) {
            clearInterval(taskLockRefreshTimer);
            taskLockRefreshTimer = null;
        }
        await flushSessionHeartbeat(true);
        stopSessionActivityTracking();
        if (store.isBackendReady() && currentUser?.accessToken) {
            try {
                if (currentUser.sessionId) {
                    await backendApiFetch(`/sessions/${currentUser.sessionId}/end`, { method: 'POST' }, currentUser.accessToken);
                }
                await backendApiFetch('/auth/logout', { method: 'POST' }, currentUser.accessToken);
            } catch (error) { }
        } else if (store.state && store.state.livePresence && currentUser) {
            store.state.livePresence[currentUser.username] = { online: false, lastSeen: new Date().toISOString() };
            if (store.isFirebaseReady()) {
                try { await store.saveToFirebase(); } catch(err) {}
            } else {
                store.saveToLocal();
            }
        }
        
        currentUser = null;
        localStorage.removeItem(SESSION_KEY);
        
        window.location.hash = '#/login';
        document.getElementById('login-password').value = '';
    });
}

function logSessionHistory(username, name, startTime) {
    if (!store.state) return;
    if (!store.state.loginHistory) store.state.loginHistory = [];
    
    let history = store.state.loginHistory;
    
    const endTime = new Date();
    const start = new Date(startTime);
    const durationMs = endTime - start;
    
    // Format duration e.g. "2h 15m" or "5m 30s"
    const hours = Math.floor(durationMs / 3600000);
    const mins = Math.floor((durationMs % 3600000) / 60000);
    const secs = Math.floor((durationMs % 60000) / 1000);
    
    let durationStr = '';
    if (hours > 0) durationStr += `${hours}h `;
    if (mins > 0 || hours > 0) durationStr += `${mins}m `;
    durationStr += `${secs}s`;
    
    history.unshift({
        username,
        name,
        loginTime: startTime,
        logoutTime: endTime.toISOString(),
        duration: durationStr
    });
    
    // Keep max 200 logs globally
    if (history.length > 200) store.state.loginHistory = history.slice(0, 200);
    
    if (store.isFirebaseReady()) {
        store.saveToFirebase().catch(e=>console.warn(e));
    } else {
        store.saveToLocal();
    }
}

function updateHeaderProfile() {
    if (!currentUser) return;
    const nameEl = document.getElementById('header-user-name');
    const roleEl = document.getElementById('header-user-role');
    const avatarEl = document.getElementById('header-avatar');
    if (nameEl) nameEl.textContent = currentUser.name;
    if (roleEl) roleEl.textContent = currentUser.role;
    if (avatarEl) avatarEl.textContent = currentUser.initials;

    const adminPortalBtn = document.getElementById('btn-open-admin-portal');
    if (adminPortalBtn) {
        const isAdmin = String(currentUser.role || '').toLowerCase() === 'admin';
        adminPortalBtn.classList.toggle('hidden', !isAdmin);
    }
    
    const presenceList = document.getElementById('header-presence-list');
    if (presenceList) {
        const authUsers = Array.isArray(store?.state?.authUsers) ? store.state.authUsers : [];
        const live = store.state.livePresence || {};
        const userMap = new Map();

        authUsers.forEach((user) => {
            if (!user?.username) return;
            userMap.set(String(user.username), user);
        });

        Object.keys(live || {}).forEach((username) => {
            if (!username) return;
            if (!userMap.has(username)) {
                userMap.set(username, { username, name: username, role: 'User', initials: String(username).charAt(0).toUpperCase() });
            }
        });

        if (currentUser?.username && !userMap.has(currentUser.username)) {
            userMap.set(currentUser.username, {
                username: currentUser.username,
                name: currentUser.name || currentUser.username,
                role: currentUser.role || 'User',
                initials: currentUser.initials || String(currentUser.username).charAt(0).toUpperCase()
            });
        }

        const validUsers = Array.from(userMap.values());
        const now = Date.now();
        
        presenceList.innerHTML = validUsers.map(u => {
            const isMe = u.username === currentUser.username;
            const presence = live[u.username];
            let isOnline = false;
            
            if (presence && presence.online && presence.lastSeen) {
                const diffObj = now - new Date(presence.lastSeen).getTime();
                // online if pinged within last 60 seconds
                if (diffObj < 60000) isOnline = true;
            }
            if (isMe) isOnline = true; // Always show self as online

            const dotClass = isOnline ? 'bg-green-500' : 'bg-gray-300';
            const textClass = isOnline ? 'text-gray-800 font-medium' : 'text-gray-500';
            const meLabel = isMe ? ' <span class="text-[10px] text-gray-400 font-normal ml-1">(me)</span>' : '';
            return `
                <div class="flex items-center gap-2 py-1 px-2">
                    <span class="w-2 h-2 rounded-full ${dotClass}"></span>
                    <span class="text-xs ${textClass}">${safe(u.name)}${meLabel}</span>
                    <span class="text-[10px] text-gray-400 ml-auto border border-gray-200 px-1.5 py-0.5 rounded-full bg-white">${isOnline ? 'Online' : 'Offline'}</span>
                </div>
            `;
        }).join('');
    }
}

function openAdminPortal() {
    if (!currentUser || String(currentUser.role || '').toLowerCase() !== 'admin') {
        showNotification('Access Denied', 'Admin role is required to open backend portal.', 'warning');
        return;
    }
    if (!store.isBackendReady() || !currentUser.accessToken) {
        showNotification('Backend Not Connected', 'Connect backend API to open admin portal.', 'warning');
        return;
    }

    const baseApi = (CONFIG.backendApiBase || '').replace(/\/+$/, '');
    const url = `${baseApi}/admin/portal`;

    const portalWindow = window.open('about:blank', '_blank', 'noopener,noreferrer');
    if (!portalWindow) {
        showNotification('Popup Blocked', 'Allow popups for this site to open Admin Portal in a new tab.', 'warning');
        return;
    }

    portalWindow.document.open();
    portalWindow.document.write('<!doctype html><title>Loading Admin Portal...</title><p style="font-family:Segoe UI,Arial,sans-serif;padding:16px;color:#334155;">Loading Admin Portal...</p>');
    portalWindow.document.close();

    fetch(url, {
        headers: { Authorization: `Bearer ${currentUser.accessToken}` }
    })
        .then(async (response) => {
            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    window.dispatchEvent(new CustomEvent('werunops-auth-invalid', { detail: { status: response.status } }));
                }
                throw new Error(`Admin portal request failed (${response.status})`);
            }
            const html = await response.text();
            portalWindow.document.open();
            portalWindow.document.write(html);
            portalWindow.document.close();
        })
        .catch(() => {
            if (portalWindow) portalWindow.close();
            showNotification('Portal Error', 'Unable to open backend admin portal.', 'error');
        });
}

function setupProfileModal() {
    const modalProfile = document.getElementById('modal-profile');
    const btnOpen = document.getElementById('btn-open-profile');
    const form = document.getElementById('profile-form');
    const adminPortalBtn = document.getElementById('btn-open-admin-portal');
    if (!modalProfile || !btnOpen) return;

    adminPortalBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('header-user-panel')?.classList.add('hidden');
        openAdminPortal();
    });

    function closeProfile() {
        const modalBox = modalProfile.querySelector('.bg-white');
        modalBox.classList.add('scale-95');
        modalProfile.classList.add('opacity-0');
        setTimeout(() => {
            modalProfile.classList.add('hidden');
            document.body.classList.remove('modal-open');
        }, 300);
    }

    btnOpen.addEventListener('click', async (e) => {
        e.preventDefault();
        document.getElementById('header-user-panel').classList.add('hidden');
        if (currentUser) {
            document.getElementById('profile-name').value = currentUser.name;
            document.getElementById('profile-role').value = currentUser.role;
            document.getElementById('profile-modal-avatar').textContent = currentUser.initials;
        }

        modalProfile.classList.remove('hidden');
        setTimeout(() => {
            modalProfile.classList.remove('opacity-0');
            modalProfile.querySelector('.bg-white').classList.remove('scale-95');
        }, 10);
        document.body.classList.add('modal-open');
    });

    document.querySelectorAll('.btn-close-profile-modal').forEach(btn => {
        btn.addEventListener('click', closeProfile);
    });

    form?.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('profile-name').value;
        const role = document.getElementById('profile-role').value;
        const spinner = document.getElementById('profile-save-spinner');

        spinner.classList.remove('hidden');
        document.getElementById('profile-save-text').textContent = 'Saving...';

        setTimeout(() => {
            if (currentUser) {
                currentUser.name = name;
                currentUser.role = role;
                currentUser.initials = name.charAt(0).toUpperCase();
            }
            updateHeaderProfile();

            spinner.classList.add('hidden');
            document.getElementById('profile-save-text').textContent = 'Save';
            closeProfile();
            showNotification('Profile Updated', 'Your profile info has been saved.', 'success');
        }, 500);
    });
}

function setupSettingsModal() {
    const modalSettings = document.getElementById('modal-settings');
    const btnOpen = document.getElementById('btn-open-settings');
    const form = document.getElementById('password-form');
    if (!modalSettings || !btnOpen) return;
    
    function closeSettings() {
        const modalBox = modalSettings.querySelector('.bg-white');
        modalBox.classList.add('scale-95');
        modalSettings.classList.add('opacity-0');
        setTimeout(() => {
            modalSettings.classList.add('hidden');
            document.body.classList.remove('modal-open');
        }, 300);
    }

    btnOpen.addEventListener('click', async (e) => {
        e.preventDefault();
        document.getElementById('header-user-panel').classList.add('hidden');
        
        // Reset Password form
        if(form) {
            form.reset();
            const errorMsg = document.getElementById('password-error-msg');
            if(errorMsg) errorMsg.classList.add('hidden');
        }
        
        // Populate History
        const listEl = document.getElementById('login-history-list');
        let historyData = store.state.loginHistory || [];

        if (store.isBackendReady() && currentUser?.accessToken) {
            try {
                const sessionsResponse = await backendApiFetch('/sessions', {}, currentUser.accessToken);
                if (sessionsResponse?.ok) {
                    const payload = await sessionsResponse.json();
                    const sessions = payload?.data || [];
                    historyData = sessions.map(session => ({
                        name: session.username,
                        loginTime: session.loginTime,
                        logoutTime: session.logoutTime || session.loginTime,
                        duration: formatDurationCompact(session.durationSeconds || 0)
                    }));
                }
            } catch (error) {
                console.warn('Failed to fetch backend sessions for settings:', error);
            }
        }

        refreshOfflineSyncControls();

        if (listEl) {
            if (historyData.length > 0) {
                listEl.innerHTML = historyData.map(h => `
                    <tr class="hover:bg-gray-50">
                        <td class="px-4 py-3 font-medium text-gray-900">${safe(h.name)}</td>
                        <td class="px-4 py-3">${new Date(h.loginTime).toLocaleString()}</td>
                        <td class="px-4 py-3">${new Date(h.logoutTime).toLocaleString()}</td>
                        <td class="px-4 py-3 text-gray-500">${safe(h.duration)}</td>
                    </tr>
                `).join('');
            } else {
                listEl.innerHTML = '<tr><td colspan="4" class="px-4 py-6 text-center text-gray-500">No login history recorded yet.</td></tr>';
            }
        }
        
        modalSettings.classList.remove('hidden');
        setTimeout(() => {
            modalSettings.classList.remove('opacity-0');
            modalSettings.querySelector('.bg-white').classList.remove('scale-95');
        }, 10);
        document.body.classList.add('modal-open');
    });

    document.querySelectorAll('.btn-close-settings-modal').forEach(btn => {
        btn.addEventListener('click', closeSettings);
    });

    form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentUser) return;
        
        const currentP = document.getElementById('current-password').value;
        const newP = document.getElementById('new-password').value;
        const confirmP = document.getElementById('confirm-password').value;
        const errorMsg = document.getElementById('password-error-msg');
        const spinner = document.getElementById('password-save-spinner');
        
        if (newP !== confirmP) {
            errorMsg.textContent = 'New passwords do not match.';
            errorMsg.classList.remove('hidden');
            return;
        }
        
        errorMsg.classList.add('hidden');
        spinner.classList.remove('hidden');
        document.getElementById('password-save-text').textContent = 'Updating...';
        
        try {
            if (store.isBackendReady() && currentUser?.accessToken) {
                const response = await backendApiFetch('/auth/change-password', {
                    method: 'POST',
                    body: JSON.stringify({
                        currentPassword: currentP,
                        newPassword: newP
                    })
                }, currentUser.accessToken);

                if (!response || !response.ok) {
                    errorMsg.textContent = 'Failed to update password on backend.';
                    errorMsg.classList.remove('hidden');
                    spinner.classList.add('hidden');
                    document.getElementById('password-save-text').textContent = 'Update Password';
                    return;
                }

                showNotification('Success', 'Password updated successfully.', 'success');
                closeSettings();
                return;
            }

            const validUsers = store.state.authUsers || [];
            const userIndex = validUsers.findIndex(u => u.username === currentUser.username);

            if (userIndex !== -1) {
                const currentHash = await sha256Hex(currentP);
                if (validUsers[userIndex].passwordHash !== currentHash) {
                    errorMsg.textContent = 'Incorrect current password.';
                    errorMsg.classList.remove('hidden');
                    spinner.classList.add('hidden');
                    document.getElementById('password-save-text').textContent = 'Update Password';
                    return;
                }

                if (currentUser.provider === 'firebase' && CONFIG.firebaseWebApiKey && currentUser.idToken) {
                    const endpoint = `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${encodeURIComponent(CONFIG.firebaseWebApiKey)}`;
                    const response = await fetch(endpoint, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            idToken: currentUser.idToken,
                            password: newP,
                            returnSecureToken: true
                        })
                    });

                    if (!response.ok) {
                        throw new Error('Firebase password update failed.');
                    }

                    const authData = await response.json();
                    currentUser.idToken = authData.idToken || currentUser.idToken;
                    currentUser.refreshToken = authData.refreshToken || currentUser.refreshToken;
                }

                validUsers[userIndex].passwordHash = await sha256Hex(newP);
                persistSession(currentUser);

                if (store.isFirebaseReady()) {
                    await store.saveToFirebase();
                } else {
                    store.saveToLocal();
                }

                showNotification('Success', 'Password updated successfully.', 'success');
                closeSettings();
            }
        } catch (error) {
            console.error(error);
            errorMsg.textContent = 'Failed to update password.';
            errorMsg.classList.remove('hidden');
        } finally {
            spinner.classList.add('hidden');
            document.getElementById('password-save-text').textContent = 'Update Password';
        }
    });

    // --- Firebase Configuration ---
    const fbUrlInput = document.getElementById('firebase-url-input');
    const fbMsg = document.getElementById('firebase-msg');
    const fbBadge = document.getElementById('firebase-status-badge');
    const fbApiKeyInput = document.getElementById('firebase-api-key-input');
    const backendApiInput = document.getElementById('backend-api-base-input');
    const backendApiMsg = document.getElementById('backend-api-msg');
    const firebaseSection = document.getElementById('settings-firebase-config-section');
    const backendSection = document.getElementById('settings-backend-api-section');

    if (!ALLOW_USER_ENDPOINT_CONFIG) {
        if (firebaseSection) firebaseSection.classList.add('hidden');
        if (backendSection) backendSection.classList.add('hidden');
    }

    function updateFirebaseBadge() {
        if (!fbBadge) return;
        if (CONFIG.firebaseUrl) {
            fbBadge.textContent = 'Connected';
            fbBadge.className = 'text-xs font-medium px-2 py-1 rounded-full bg-green-100 text-green-700';
        } else {
            fbBadge.textContent = 'Not Connected';
            fbBadge.className = 'text-xs font-medium px-2 py-1 rounded-full bg-red-100 text-red-600';
        }
    }

    // Populate URL field when settings opens
    btnOpen.addEventListener('click', () => {
        if (fbUrlInput) fbUrlInput.value = CONFIG.firebaseUrl || '';
        if (fbApiKeyInput) fbApiKeyInput.value = CONFIG.firebaseWebApiKey || '';
        if (backendApiInput) backendApiInput.value = CONFIG.backendApiBase || '';
        updateFirebaseBadge();
        if (typeof lucide !== 'undefined') setTimeout(() => lucide.createIcons(), 50);
    });

    document.getElementById('btn-save-firebase-url')?.addEventListener('click', async () => {
        const url = fbUrlInput?.value?.trim();
        if (!url || !url.startsWith('https://')) {
            if (fbMsg) {
                fbMsg.textContent = 'Please enter a valid Firebase URL (starts with https://)';
                fbMsg.className = 'text-sm font-medium mt-1 text-red-500';
                fbMsg.classList.remove('hidden');
            }
            return;
        }

        if (fbMsg) {
            fbMsg.textContent = 'Testing connection...';
            fbMsg.className = 'text-sm font-medium mt-1 text-blue-500';
            fbMsg.classList.remove('hidden');
        }

        try {
            // Test by reading from Firebase
            const testUrl = `${url.replace(/\/+$/, '')}/.json?shallow=true`;
            const res = await fetch(testUrl);

            if (res.ok) {
                setFirebaseUrl(url);
                if (fbMsg) {
                    fbMsg.textContent = '✅ Connected! Syncing data...';
                    fbMsg.className = 'text-sm font-medium mt-1 text-green-600';
                }
                updateFirebaseBadge();
                await store.init();
                showNotification('Firebase', 'Connected successfully! Data is now synced across users.', 'success');
            } else {
                if (fbMsg) {
                    fbMsg.textContent = `❌ Firebase responded with error: ${res.status}. Check the URL and database rules.`;
                    fbMsg.className = 'text-sm font-medium mt-1 text-red-500';
                }
            }
        } catch (err) {
            if (fbMsg) {
                fbMsg.textContent = `❌ Network error: ${err.message}`;
                fbMsg.className = 'text-sm font-medium mt-1 text-red-500';
            }
        }
    });

    document.getElementById('btn-clear-firebase-url')?.addEventListener('click', () => {
        clearFirebaseUrl();
        if (fbUrlInput) fbUrlInput.value = '';
        if (fbMsg) {
            fbMsg.textContent = 'Disconnected. App will use local storage only.';
            fbMsg.className = 'text-sm font-medium mt-1 text-yellow-600';
            fbMsg.classList.remove('hidden');
        }
        updateFirebaseBadge();
        showNotification('Firebase', 'Disconnected. Data will only be saved locally.', 'info');
    });

    document.getElementById('btn-save-firebase-api-key')?.addEventListener('click', () => {
        const apiKey = fbApiKeyInput?.value?.trim() || '';
        setFirebaseWebApiKey(apiKey);
        if (fbMsg) {
            fbMsg.textContent = apiKey
                ? 'Firebase Web API Key saved. Firebase Auth migration is enabled.'
                : 'Firebase Web API Key cleared. Legacy hashed login fallback only.';
            fbMsg.className = 'text-sm font-medium mt-1 text-blue-600';
            fbMsg.classList.remove('hidden');
        }
    });

    document.getElementById('btn-save-backend-api')?.addEventListener('click', async () => {
        const url = backendApiInput?.value?.trim() || '';
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            if (backendApiMsg) {
                backendApiMsg.textContent = 'Please enter a valid backend API URL.';
                backendApiMsg.className = 'text-sm font-medium mt-1 text-red-500';
                backendApiMsg.classList.remove('hidden');
            }
            return;
        }

        setBackendApiBase(url);
        if (backendApiMsg) {
            backendApiMsg.textContent = 'Backend API base saved. Sign in again to activate backend mode.';
            backendApiMsg.className = 'text-sm font-medium mt-1 text-green-600';
            backendApiMsg.classList.remove('hidden');
        }
    });

    document.getElementById('btn-clear-backend-api')?.addEventListener('click', () => {
        clearBackendApiBase();
        if (backendApiInput) backendApiInput.value = '';
        if (backendApiMsg) {
            backendApiMsg.textContent = 'Backend API disconnected.';
            backendApiMsg.className = 'text-sm font-medium mt-1 text-yellow-600';
            backendApiMsg.classList.remove('hidden');
        }
    });

    document.getElementById('btn-settings-export-state')?.addEventListener('click', async () => {
        try {
            let data = null;
            if (store.isBackendReady() && currentUser?.accessToken) {
                const response = await backendApiFetch('/state/export', {}, currentUser.accessToken);
                data = response?.ok ? (await response.json())?.data : null;
            } else {
                data = store.state;
            }

            const blob = new Blob([JSON.stringify(data || {}, null, 2)], { type: 'application/json' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `werunops-state-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            window.URL.revokeObjectURL(url);
            showNotification('Export Complete', 'Full data exported as JSON.', 'success');
        } catch (error) {
            showNotification('Export Failed', 'Unable to export full data.', 'error');
        }
    });

    document.getElementById('btn-settings-export-sessions')?.addEventListener('click', async () => {
        if (store.isBackendReady() && currentUser?.accessToken) {
            try {
                const response = await fetch(`${CONFIG.backendApiBase}/exports/sessions.csv`, {
                    headers: { Authorization: `Bearer ${currentUser.accessToken}` }
                });
                if (!response.ok) throw new Error('Failed to download CSV');
                const csv = await response.text();
                const blob = new Blob([csv], { type: 'text/csv' });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `werunops-sessions-${new Date().toISOString().split('T')[0]}.csv`;
                a.click();
                window.URL.revokeObjectURL(url);
                showNotification('Export Complete', 'Session history CSV downloaded.', 'success');
            } catch (error) {
                showNotification('Export Failed', 'Unable to download session history CSV.', 'error');
            }
            return;
        }

        const rows = (store.state.loginHistory || []).map(item => ({
            username: item.username || '',
            name: item.name || '',
            loginTime: item.loginTime || '',
            logoutTime: item.logoutTime || '',
            duration: item.duration || ''
        }));
        const header = 'username,name,loginTime,logoutTime,duration\n';
        const body = rows.map(row => [row.username, row.name, row.loginTime, row.logoutTime, row.duration].map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob([header + body], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `werunops-login-history-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
        showNotification('Export Complete', 'Login history exported from local data.', 'success');
    });

    document.getElementById('btn-settings-retry-failed-sync')?.addEventListener('click', async () => {
        await retryFailedOfflineSync();
    });

    document.getElementById('btn-settings-discard-failed-sync')?.addEventListener('click', () => {
        discardFailedOfflineSync();
    });
}

function setupHeaderFeatures() {
    const searchInput = document.getElementById('header-search-input');
    const resultsContainer = document.getElementById('header-search-results');

    searchInput?.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        if (!query) {
            resultsContainer.innerHTML = '';
            resultsContainer.classList.add('hidden');
            return;
        }

        const matches = store.state.tasks.filter(t =>
            t.task.toLowerCase().includes(query) ||
            t.id.toString().includes(query) ||
            t.client.toLowerCase().includes(query)
        ).slice(0, 5);

        if (matches.length > 0) {
            resultsContainer.innerHTML = matches.map(t => `
                <div class="p-2 hover:bg-gray-50 cursor-pointer rounded border-b border-gray-50 border-last-none" onclick="openTaskModal(${Number(t.id) || 0}, {viewOnly: true})">
                    <p class="text-xs text-primary font-medium">#${Number(t.id) || 0} &bull; ${safe(t.client)}</p>
                    <p class="text-sm font-semibold text-gray-800 truncate">${safe(t.task)}</p>
                </div>
            `).join('');
        } else {
            resultsContainer.innerHTML = '<div class="p-3 text-center text-xs text-gray-500">No matching tasks found</div>';
        }
        resultsContainer.classList.remove('hidden');
    });
}

function updateNotifications() {
    const list = document.getElementById('notifications-list');
    const countBadge = document.getElementById('notification-count');
    const dot = document.getElementById('notification-dot');

    if (!list || !store.state || !store.state.tasks) return;

    const actionableTasks = store.state.tasks.filter(t =>
        t.status !== 'Completed' && (isOverdue(t.dueDate) || t.status === 'Follow Up')
    );

    if (actionableTasks.length > 0) {
        if (countBadge) countBadge.textContent = actionableTasks.length;
        if (dot) dot.classList.remove('hidden');

        list.innerHTML = actionableTasks.map(t => {
            const isOv = isOverdue(t.dueDate);
            return `
            <div class="px-4 py-3 hover:bg-gray-50 cursor-pointer border-b border-gray-50 transition" onclick="openTaskModal(${Number(t.id) || 0}, {viewOnly: true})">
                <div class="flex items-start gap-3">
                    <div class="mt-0.5 w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${isOv ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}">
                        <i data-lucide="${isOv ? 'alert-circle' : 'corner-down-right'}" class="w-3 h-3"></i>
                    </div>
                    <div>
                        <p class="text-xs font-semibold ${isOv ? 'text-red-600' : 'text-green-600'} mb-0.5">${isOv ? 'Overdue Task' : 'Follow Up Required'}</p>
                        <p class="text-sm text-gray-800 font-medium leading-tight mb-1">${safe(t.task)}</p>
                        <p class="text-xs text-gray-500">Due: ${formatDate(t.dueDate)} &bull; ${safe(t.client)}</p>
                    </div>
                </div>
            </div>
        `}).join('');
    } else {
        if (countBadge) countBadge.textContent = '0';
        if (dot) dot.classList.add('hidden');
        list.innerHTML = `
            <div class="p-4 text-center text-sm text-gray-500">
                <i data-lucide="inbox" class="w-8 h-8 mx-auto text-gray-300 mb-2"></i>
                No new notifications.
            </div>
        `;
    }
    lucide.createIcons({ root: list });
}
