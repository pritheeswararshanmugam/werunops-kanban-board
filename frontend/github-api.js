/**
 * Firebase Realtime Database & Data Persistence Layer
 * Handles fetching and saving data to Firebase, with IndexedDB-backed local fallback.
 */

const RUNTIME_CONFIG = (typeof window !== 'undefined' && window.WERUNOPS_CONFIG)
    ? window.WERUNOPS_CONFIG
    : {};

const isLocalHost = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
const savedBackendApiBase = (localStorage.getItem('werunops_backend_api_base') || '').trim();
const shouldIgnoreSavedLocalBackend = !isLocalHost && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\b/i.test(savedBackendApiBase);
const shouldForceRuntimeBackendInProd = !isLocalHost;

const CONFIG = {
    // Firebase Realtime Database URL — hardcoded for production
    // Can be overridden via Settings UI (stored in localStorage)
    firebaseUrl: localStorage.getItem('werunops_firebase_url') || RUNTIME_CONFIG.firebaseUrl || 'https://werun-ops-backoffice-default-rtdb.firebaseio.com',
    dataPath: 'state', // The path in the database where state is stored
    firebaseWebApiKey: localStorage.getItem('werunops_firebase_web_api_key') || RUNTIME_CONFIG.firebaseWebApiKey || '',
    backendApiBase: shouldForceRuntimeBackendInProd
        ? (RUNTIME_CONFIG.backendApiBase || '')
        : (shouldIgnoreSavedLocalBackend ? (RUNTIME_CONFIG.backendApiBase || '') : (savedBackendApiBase || RUNTIME_CONFIG.backendApiBase || ''))
};

if (!isLocalHost && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\b/i.test(savedBackendApiBase)) {
    localStorage.removeItem('werunops_backend_api_base');
}

// Helper to set the Firebase URL at runtime (called from Settings UI)
function setFirebaseUrl(url) {
    // Normalize: remove trailing slash
    url = url.replace(/\/+$/, '');
    CONFIG.firebaseUrl = url;
    localStorage.setItem('werunops_firebase_url', url);
}

function clearFirebaseUrl() {
    CONFIG.firebaseUrl = '';
    localStorage.removeItem('werunops_firebase_url');
}

function setFirebaseWebApiKey(apiKey) {
    CONFIG.firebaseWebApiKey = (apiKey || '').trim();
    if (CONFIG.firebaseWebApiKey) {
        localStorage.setItem('werunops_firebase_web_api_key', CONFIG.firebaseWebApiKey);
    } else {
        localStorage.removeItem('werunops_firebase_web_api_key');
    }
}

function setBackendApiBase(url) {
    CONFIG.backendApiBase = (url || '').trim().replace(/\/+$/, '');
    if (CONFIG.backendApiBase) {
        localStorage.setItem('werunops_backend_api_base', CONFIG.backendApiBase);
    } else {
        localStorage.removeItem('werunops_backend_api_base');
    }
}

function clearBackendApiBase() {
    CONFIG.backendApiBase = '';
    localStorage.removeItem('werunops_backend_api_base');
}

function readCurrentSession() {
    try {
        const raw = sessionStorage.getItem('currentUser');
        if (!raw) {
            localStorage.removeItem('currentUser');
            return null;
        }
        return JSON.parse(raw);
    } catch (error) {
        return null;
    }
}

function clearCurrentSession() {
    sessionStorage.removeItem('currentUser');
    localStorage.removeItem('currentUser');
}

function normalizePresenceStatusValue(status, online = true) {
    const raw = String(status || '').trim().toLowerCase();
    if (raw === 'away' || raw === 'break' || raw === 'away / break' || raw === 'away/break') return 'away';
    if (raw === 'meeting' || raw === 'in a meeting') return 'meeting';
    if (raw === 'offline') return 'offline';
    if (!online) return 'offline';
    return 'online';
}

function normalizePresenceRecord(record = {}) {
    const online = record.online !== false;
    return {
        online,
        status: normalizePresenceStatusValue(record.status, online),
        lastSeen: record.lastSeen || new Date().toISOString(),
        browser: record.browser || navigator.userAgent,
        device: record.device || 'Web'
    };
}

function getRuntimePresenceState() {
    if (typeof window !== 'undefined' && typeof window.getWeRunOpsPresenceState === 'function') {
        return normalizePresenceRecord(window.getWeRunOpsPresenceState());
    }
    return normalizePresenceRecord({ online: true, status: 'online', browser: navigator.userAgent, device: 'Web' });
}

const ADAPTIVE_POLLING_IDLE_AFTER_MS = 60 * 1000;
const ADAPTIVE_POLLING_INTERVALS = {
    taskLocks: { active: 5000, idle: 20000, hidden: 60000 },
    backendSync: { active: 8000, idle: 25000, hidden: 90000 },
    presenceHeartbeat: { active: 20000, idle: 30000, hidden: 60000 },
    presenceListener: { active: 10000, idle: 25000, hidden: 60000 }
};
const LOCAL_STATE_CACHE_KEY = 'backoffice_state';
const LOCAL_STATE_BACKUP_KEY = 'backoffice_state_backup';

const DEFAULT_AUTH_USERS = [
    { username: 'Eshwar', passwordHash: 'f91b043302878951ce9258214033bd206ea0a92bb88931ba8bb6edb01b57d020', name: 'Pritheeswarar', role: 'Admin', initials: 'P', isActive: true },
    { username: 'Sudhar', passwordHash: '56e89b1d6436fc86deea34dbb0306af59c40d29f20bc20b6efcb001cee9ae71b', name: 'Sudharshan', role: 'Manager', initials: 'S', isActive: true },
    { username: 'Mubarak', passwordHash: '23fece5f1a2a4452cba0113271736a16d241201bef2fd15b72819582e13fb267', name: 'Mubarak', role: 'User', initials: 'M', isActive: true },
    { username: 'Radhakrishnan', passwordHash: 'f91b043302878951ce9258214033bd206ea0a92bb88931ba8bb6edb01b57d020', name: 'Radhakrishnan', role: 'User', initials: 'R', isActive: true },
];

function normalizeIdentityToken(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function calculateEditDistance(left, right) {
    const start = String(left || '');
    const end = String(right || '');
    const rows = Array.from({ length: end.length + 1 }, (_, index) => index);

    for (let startIndex = 1; startIndex <= start.length; startIndex += 1) {
        let previousDiagonal = rows[0];
        rows[0] = startIndex;

        for (let endIndex = 1; endIndex <= end.length; endIndex += 1) {
            const temp = rows[endIndex];
            if (start[startIndex - 1] === end[endIndex - 1]) {
                rows[endIndex] = previousDiagonal;
            } else {
                rows[endIndex] = Math.min(previousDiagonal, rows[endIndex - 1], rows[endIndex]) + 1;
            }
            previousDiagonal = temp;
        }
    }

    return rows[end.length];
}

function resolveUserDirectoryEntry(users, value) {
    const rawValue = String(value || '').trim();
    if (!rawValue) return null;

    const entries = Array.isArray(users) ? users : [];
    const lowered = rawValue.toLowerCase();
    const exact = entries.find((user) => {
        const username = String(user?.username || '').trim().toLowerCase();
        const name = String(user?.name || '').trim().toLowerCase();
        return username === lowered || name === lowered;
    });
    if (exact) return exact;

    const normalizedValue = normalizeIdentityToken(rawValue);
    if (!normalizedValue) return null;

    const normalizedExact = entries.find((user) => {
        const username = normalizeIdentityToken(user?.username);
        const name = normalizeIdentityToken(user?.name);
        return username === normalizedValue || name === normalizedValue;
    });
    if (normalizedExact) return normalizedExact;

    let bestMatch = null;
    let bestScore = 0;

    entries.forEach((user) => {
        [user?.username, user?.name].forEach((candidate) => {
            const candidateToken = normalizeIdentityToken(candidate);
            if (!candidateToken) return;

            const distance = calculateEditDistance(normalizedValue, candidateToken);
            const maxLength = Math.max(normalizedValue.length, candidateToken.length, 1);
            const score = 1 - (distance / maxLength);
            if ((distance <= 1 || score >= 0.88) && score > bestScore) {
                bestScore = score;
                bestMatch = user;
            }
        });
    });

    return bestMatch;
}

function normalizeStaffIdentityFromUsers(users, value) {
    const match = resolveUserDirectoryEntry(users, value);
    return match ? String(match.username || '').trim() : String(value || '').trim();
}

function getStaffDisplayNameFromUsers(users, value) {
    const match = resolveUserDirectoryEntry(users, value);
    return match ? String(match.name || match.username || '').trim() : (String(value || '').trim() || 'Unknown');
}

function buildStaffDirectoryEntries(users, tasks = []) {
    const directory = new Map();

    (Array.isArray(users) ? users : []).forEach((user) => {
        const username = String(user?.username || '').trim();
        if (!username) return;
        directory.set(username.toLowerCase(), {
            username,
            name: String(user?.name || username).trim() || username,
        });
    });

    (Array.isArray(tasks) ? tasks : []).forEach((task) => {
        const username = normalizeStaffIdentityFromUsers(users, task?.staff);
        if (!username) return;
        if (directory.has(username.toLowerCase())) return;
        const label = getStaffDisplayNameFromUsers(users, task?.staff);
        directory.set(username.toLowerCase(), { username, name: label || username });
    });

    return Array.from(directory.values()).sort((left, right) => left.name.localeCompare(right.name));
}

function mergeAuthUsers(users, existingUsers = []) {
    const existingByUsername = new Map(
        (Array.isArray(existingUsers) ? existingUsers : [])
            .map((user) => [String(user?.username || '').trim().toLowerCase(), user])
            .filter(([username]) => Boolean(username))
    );

    return (Array.isArray(users) ? users : []).map((user) => {
        const username = String(user?.username || '').trim();
        const existing = existingByUsername.get(username.toLowerCase());
        return {
            username,
            passwordHash: existing?.passwordHash || user?.passwordHash || null,
            name: String(user?.name || username).trim() || username,
            role: String(user?.role || existing?.role || 'User'),
            initials: String(user?.initials || existing?.initials || username.charAt(0) || 'U').trim().charAt(0).toUpperCase(),
            department: String(user?.department || existing?.department || ''),
            timezone: String(user?.timezone || existing?.timezone || 'UTC'),
            isActive: user?.isActive !== false,
        };
    });
}

function applyUserDirectoryState(state, users) {
    if (!state) return;
    if (!state.config) state.config = {};

    const normalizedUsers = mergeAuthUsers(users, state.authUsers || DEFAULT_AUTH_USERS);
    state.authUsers = normalizedUsers;
    state.config.staff = buildStaffDirectoryEntries(normalizedUsers, state.tasks || []).map((entry) => entry.username);
}

const DEFAULT_STATE = {
    authUsers: DEFAULT_AUTH_USERS,
    taskLocks: {},
    livePresence: {},
    loginHistory: [],
    tasks: [
        {
            id: 1,
            client: "JS Roofing",
            project: "House 12",
            task: "Create PO fascia",
            staff: "Mubarak",
            status: "In Progress",
            priority: "High",
            startDate: "2026-03-09",
            dueDate: new Date().toISOString().split('T')[0],
            waitingFor: "Supplier",
            notes: "Waiting for supplier pricing",
            createdAt: new Date(Date.now() - 86400000).toISOString(),
            updatedAt: new Date().toISOString(),
            activityLog: [
                { action: 'Status changed to "In Progress"', user: 'Mubarak', timestamp: new Date(Date.now() - 7200000).toISOString() },
                { action: 'Task created', user: 'Pritheeswarar', timestamp: new Date(Date.now() - 86400000).toISOString() }
            ]
        },
        {
            id: 2,
            client: "A to Z Roofing",
            project: "House 5",
            task: "Prepare quote",
            staff: "Eshwar",
            status: "New",
            priority: "Medium",
            startDate: "",
            dueDate: new Date(Date.now() + 86400000).toISOString().split('T')[0],
            waitingFor: "",
            notes: "Need to check recent material prices.",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            activityLog: [
                { action: 'Task created', user: 'Pritheeswarar', timestamp: new Date().toISOString() }
            ]
        }
    ],
    config: {
        clients: [
            { id: 1, name: "JS Roofing", contact: "John Smith", email: "john@jsroofing.com", phone: "555-0100" },
            { id: 2, name: "A to Z Roofing", contact: "Alice", email: "alice@atoz.com", phone: "555-0101" },
            { id: 3, name: "Allvent", contact: "Bob", email: "bob@allvent.com", phone: "555-0102" },
            { id: 4, name: "Malligai Sweets", contact: "Charlie", email: "charlie@malligai.com", phone: "555-0103" }
        ],
        staff: buildStaffDirectoryEntries(DEFAULT_AUTH_USERS).map((entry) => entry.username),
        statuses: ["New", "In Progress", "Waiting Client", "Waiting Supplier", "Follow Up", "Completed"],
        priorities: ["High", "Medium", "Low"],
        nextTaskId: 3,
        nextClientId: 5
    }
};

class DataStore {
    constructor() {
        this.state = null;
        this.listeners = [];
        this.remoteEtag = null;
        this.saveQueue = Promise.resolve();
        this.remoteEventSource = null;
        this.lastRemoteSyncAt = 0;
        this.hasLoadedBackendState = false;
        this.taskLocksInterval = null;
        this.backendSyncInterval = null;
        this.backendSyncInFlight = null;
        this.presenceInterval = null;
        this.presenceListenerInterval = null;
        this.offlineQueueKey = 'werunops_offline_actions';
        this.failedOfflineQueueKey = 'werunops_offline_failed_actions';
        this.persistence = typeof window !== 'undefined' ? window.WERUNOPS_PERSISTENCE || null : null;
        this.persistenceReady = null;
        this.lastUserActivityAt = Date.now();
        this.pollingLifecycleBound = false;
        this.bindAdaptivePollingLifecycle();
    }

    subscribe(listener) {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    notify() {
        this.listeners.forEach(listener => listener(this.state));
    }

    async preparePersistence() {
        if (this.persistenceReady) {
            return this.persistenceReady;
        }

        const hydrate = this.persistence?.hydrate?.bind(this.persistence);
        const keys = [LOCAL_STATE_CACHE_KEY, LOCAL_STATE_BACKUP_KEY, this.offlineQueueKey, this.failedOfflineQueueKey];
        this.persistenceReady = Promise.resolve(hydrate ? hydrate(keys) : undefined).catch((error) => {
            console.warn('IndexedDB hydration failed, continuing with localStorage fallback:', error);
        });

        return this.persistenceReady;
    }

    readPersistedJson(key, fallbackValue = null) {
        try {
            if (this.persistence?.getJSON) {
                const value = this.persistence.getJSON(key, fallbackValue);
                return value === undefined ? fallbackValue : value;
            }

            const raw = localStorage.getItem(key);
            if (!raw) return fallbackValue;
            return JSON.parse(raw);
        } catch (error) {
            return fallbackValue;
        }
    }

    persistJson(key, value) {
        try {
            if (this.persistence?.setJSON) {
                void this.persistence.setJSON(key, value);
                return;
            }

            localStorage.setItem(key, JSON.stringify(value));
        } catch (error) {
            console.warn(`Failed to persist ${key}:`, error);
        }
    }

    bindAdaptivePollingLifecycle() {
        if (this.pollingLifecycleBound || typeof window === 'undefined' || typeof document === 'undefined') return;

        const markActivity = () => {
            this.lastUserActivityAt = Date.now();
        };

        ['pointerdown', 'keydown', 'touchstart'].forEach((eventName) => {
            window.addEventListener(eventName, markActivity, { passive: true });
        });

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                this.lastUserActivityAt = Date.now();
                this.flushOfflineQueue().catch(() => {});
                this.refreshAdaptivePolling({ immediate: true });
                this.refreshBackendSharedState().catch(() => {});
                return;
            }
            this.refreshAdaptivePolling();
        }, { passive: true });

        window.addEventListener('online', () => {
            this.lastUserActivityAt = Date.now();
            this.flushOfflineQueue().catch(() => {});
            this.refreshAdaptivePolling({ immediate: true });
            this.refreshBackendSharedState().catch(() => {});
        });

        window.addEventListener('offline', () => {
            this.refreshAdaptivePolling();
        });

        this.pollingLifecycleBound = true;
    }

    getAdaptivePollingMode() {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            return 'offline';
        }
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
            return 'hidden';
        }
        return (Date.now() - this.lastUserActivityAt) > ADAPTIVE_POLLING_IDLE_AFTER_MS ? 'idle' : 'active';
    }

    getAdaptivePollingInterval(kind, fallbackMs = 10000) {
        const mode = this.getAdaptivePollingMode();
        if (mode === 'offline') {
            return null;
        }

        const profile = ADAPTIVE_POLLING_INTERVALS[kind] || {};
        const candidate = profile[mode] || profile.active || fallbackMs;
        return Math.max(1000, Number(candidate) || 10000);
    }

    scheduleAdaptiveLoop(timerKey, task, kind, fallbackMs = 10000, runImmediately = true) {
        this.stopAdaptiveLoop(timerKey);

        const loop = {
            stopped: false,
            running: false,
            timeoutId: null,
            kind,
            fallbackMs,
            schedule: (delayOverride = null) => {
                if (loop.stopped) return;
                if (loop.timeoutId) clearTimeout(loop.timeoutId);

                const delay = delayOverride === null
                    ? this.getAdaptivePollingInterval(kind, fallbackMs)
                    : delayOverride;

                if (delay === null || delay === undefined) {
                    loop.timeoutId = null;
                    return;
                }

                loop.timeoutId = setTimeout(loop.runner, Math.max(0, delay));
            },
            runner: async () => {
                if (loop.stopped) return;
                if (loop.running) return;

                loop.running = true;
                try {
                    await task();
                } finally {
                    loop.running = false;
                    if (!loop.stopped) {
                        loop.schedule();
                    }
                }
            }
        };

        this[timerKey] = loop;

        if (runImmediately && this.getAdaptivePollingMode() !== 'offline') {
            loop.runner();
        } else {
            loop.schedule();
        }
    }

    stopAdaptiveLoop(timerKey) {
        const loop = this[timerKey];
        if (loop?.timeoutId) {
            clearTimeout(loop.timeoutId);
        }
        if (loop) {
            loop.stopped = true;
        }
        this[timerKey] = null;
    }

    refreshAdaptivePolling(options = {}) {
        const immediate = options.immediate === true;
        ['taskLocksInterval', 'backendSyncInterval', 'presenceInterval', 'presenceListenerInterval'].forEach((timerKey) => {
            const loop = this[timerKey];
            if (!loop || loop.stopped || loop.running) return;
            loop.schedule(immediate ? 0 : null);
        });
    }

    isFirebaseReady() {
        return !!CONFIG.firebaseUrl;
    }

    isBackendReady() {
        return !!CONFIG.backendApiBase;
    }

    getBackendToken() {
        try {
            const currentUser = readCurrentSession();
            if (!currentUser) return null;
            return currentUser?.accessToken || null;
        } catch (error) {
            return null;
        }
    }

    hasBackendAuth() {
        return !!this.getBackendToken();
    }

    async validateBackendToken() {
        const token = this.getBackendToken();
        if (!token || !this.isBackendReady()) return false;

        try {
            const response = await fetch(`${CONFIG.backendApiBase}/auth/me`, {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            });
            if (response.ok) return true;
        } catch (error) { }

        clearCurrentSession();
        return false;
    }

    async backendFetch(path, options = {}) {
        const token = this.getBackendToken();
        const isAuthLoginRoute = path === '/auth/login';
        if (!token && !isAuthLoginRoute) {
            const err = new Error('Backend auth token missing');
            err.code = 401;
            throw err;
        }

        const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }

        const response = await fetch(`${CONFIG.backendApiBase}${path}`, {
            ...options,
            headers
        });

        if (!response.ok) {
            const text = await response.text();
            let parsed = null;
            try {
                parsed = JSON.parse(text);
            } catch (error) { }
            const detail = parsed?.detail || parsed || text;
            const err = new Error(`Backend API error ${response.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
            err.code = response.status;
            err.detail = detail;

            if (response.status === 401) {
                clearCurrentSession();
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('werunops-auth-invalid', { detail: { status: response.status } }));
                }
            }
            throw err;
        }

        return response;
    }

    async fetchFromBackend(allowUnauthorized = false) {
        try {
            const [tasksResponse, clientsResponse, usersResponse] = await Promise.all([
                this.backendFetch('/tasks'),
                this.backendFetch('/clients'),
                this.backendFetch('/admin/users').catch((error) => {
                    if (error?.code === 403) {
                        return null;
                    }
                    throw error;
                })
            ]);

            const tasksPayload = await tasksResponse.json();
            const clientsPayload = await clientsResponse.json();
            const usersPayload = usersResponse ? await usersResponse.json() : null;

            const tasks = tasksPayload?.data || [];
            const clients = clientsPayload?.data || [];
            const users = Array.isArray(usersPayload?.data) ? usersPayload.data : null;

            if (!this.state) {
                this.state = JSON.parse(JSON.stringify(DEFAULT_STATE));
            }

            this.state.tasks = tasks;
            this.state.config.clients = clients;
            this.state.config.nextTaskId = Math.max(...tasks.map(item => Number(item.id) || 0), 0) + 1;
            this.state.config.nextClientId = Math.max(...clients.map(item => Number(item.id) || 0), 0) + 1;
            applyUserDirectoryState(this.state, users || this.state.authUsers || DEFAULT_AUTH_USERS);
            if (!this.state.taskLocks) this.state.taskLocks = {};
            this.hasLoadedBackendState = true;

            this.migrateData();
            this.notify();
        } catch (error) {
            if (allowUnauthorized && (error?.code === 401 || error?.code === 403)) {
                if (!this.state) {
                    this.state = JSON.parse(JSON.stringify(DEFAULT_STATE));
                    this.migrateData();
                    this.notify();
                }
                return;
            }
            if (!navigator.onLine || error?.message?.toLowerCase().includes('failed to fetch')) {
                const localData = this.readPersistedJson(LOCAL_STATE_CACHE_KEY, null);
                if (localData) {
                    this.state = localData;
                    this.migrateData();
                    this.notify();
                    return;
                }
            }
            throw error;
        }
    }

    readOfflineQueue() {
        const parsed = this.readPersistedJson(this.offlineQueueKey, []);
        return Array.isArray(parsed) ? parsed : [];
    }

    writeOfflineQueue(queue) {
        this.persistJson(this.offlineQueueKey, Array.isArray(queue) ? queue : []);
    }

    readFailedOfflineQueue() {
        const parsed = this.readPersistedJson(this.failedOfflineQueueKey, []);
        return Array.isArray(parsed) ? parsed : [];
    }

    writeFailedOfflineQueue(queue) {
        this.persistJson(this.failedOfflineQueueKey, Array.isArray(queue) ? queue : []);
    }

    getOfflineQueueStatus() {
        return {
            pendingCount: this.readOfflineQueue().length,
            failedCount: this.readFailedOfflineQueue().length
        };
    }

    retryFailedOfflineQueue() {
        const failed = this.readFailedOfflineQueue();
        if (!failed.length) return;
        const pending = this.readOfflineQueue();
        const merged = [...pending, ...failed.map(item => ({ ...item, retriedAt: new Date().toISOString() }))];
        this.writeOfflineQueue(merged);
        this.writeFailedOfflineQueue([]);
    }

    discardFailedOfflineQueue() {
        this.writeFailedOfflineQueue([]);
    }

    parseTaskId(value) {
        const parsed = parseInt(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    resolveQueuedTaskId(taskId, idMap = {}) {
        const normalized = this.parseTaskId(taskId);
        if (normalized === null) return null;
        const mapped = idMap[String(normalized)] ?? normalized;
        return this.parseTaskId(mapped);
    }

    taskSnapshotById(...candidateIds) {
        if (!this.state?.tasks?.length) return null;
        const normalized = candidateIds
            .map(value => this.parseTaskId(value))
            .filter(value => value !== null);
        if (!normalized.length) return null;

        const match = this.state.tasks.find(task => normalized.includes(this.parseTaskId(task.id)));
        return match ? JSON.parse(JSON.stringify(match)) : null;
    }

    replaceTaskIdInQueue(queue, fromId, toId) {
        queue.forEach(item => {
            if (item?.payload?.taskId !== undefined && this.parseTaskId(item.payload.taskId) === fromId) {
                item.payload.taskId = toId;
            }
            if (Array.isArray(item?.payload?.taskIds)) {
                item.payload.taskIds = item.payload.taskIds.map(value => (this.parseTaskId(value) === fromId ? toId : value));
            }
            if (item?.payload?.task?.id !== undefined && this.parseTaskId(item.payload.task.id) === fromId) {
                item.payload.task.id = toId;
            }
            if (item?.payload?.id !== undefined && this.parseTaskId(item.payload.id) === fromId) {
                item.payload.id = toId;
            }
            if (item?.payload?.clientTaskId !== undefined && this.parseTaskId(item.payload.clientTaskId) === fromId) {
                item.payload.clientTaskId = toId;
            }
        });
    }

    enqueueOfflineAction(action) {
        const queue = this.readOfflineQueue();
        queue.push({
            ...action,
            actionId: action.actionId || `offline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            queuedAt: new Date().toISOString()
        });
        this.writeOfflineQueue(queue);
    }

    async flushOfflineQueue() {
        if (!this.isBackendReady() || !navigator.onLine) {
            return this.getOfflineQueueStatus();
        }

        const queue = this.readOfflineQueue();
        if (!queue.length) {
            return this.getOfflineQueueStatus();
        }

        const idMap = {};
        const failed = [];
        let processed = 0;

        for (const item of queue) {
            try {
                if (item.type === 'saveTask') {
                    const payload = JSON.parse(JSON.stringify(item.payload || {}));
                    if (payload.__offlineCreate) {
                        const localId = this.parseTaskId(payload.clientTaskId ?? payload.id);
                        const localSnapshot = this.taskSnapshotById(localId);

                        if (!localSnapshot) {
                            processed += 1;
                            continue;
                        }

                        const response = await this.backendFetch('/tasks', {
                            method: 'POST',
                            body: JSON.stringify({
                                client: localSnapshot.client,
                                project: localSnapshot.project || '',
                                task: localSnapshot.task,
                                staff: localSnapshot.staff,
                                status: localSnapshot.status,
                                priority: localSnapshot.priority,
                                startDate: localSnapshot.startDate || '',
                                dueDate: localSnapshot.dueDate || '',
                                waitingFor: localSnapshot.waitingFor || '',
                                notes: localSnapshot.notes || '',
                                parentId: localSnapshot.parentId ? parseInt(localSnapshot.parentId) : null
                            })
                        });

                        const createdPayload = await response.json();
                        const serverId = this.parseTaskId(createdPayload?.data?.id);
                        if (localId !== null && serverId !== null) {
                            idMap[String(localId)] = serverId;
                            this.replaceTaskIdInQueue(queue, localId, serverId);
                        }

                        const latestSnapshot = this.taskSnapshotById(localId, serverId);
                        if (latestSnapshot && serverId !== null) {
                            latestSnapshot.id = serverId;
                            await this.backendFetch('/tasks/restore', {
                                method: 'POST',
                                body: JSON.stringify({ task: latestSnapshot })
                            });
                        }
                    } else {
                        const targetId = this.resolveQueuedTaskId(payload.id, idMap);
                        const latestSnapshot = this.taskSnapshotById(targetId, payload.id);
                        if (latestSnapshot && targetId !== null) {
                            latestSnapshot.id = targetId;
                            await this.backendFetch('/tasks/restore', {
                                method: 'POST',
                                body: JSON.stringify({ task: latestSnapshot })
                            });
                        }
                    }
                } else if (item.type === 'updateTaskStatus') {
                    const targetId = this.resolveQueuedTaskId(item?.payload?.taskId, idMap);
                    const latestSnapshot = this.taskSnapshotById(targetId, item?.payload?.taskId);
                    if (latestSnapshot && targetId !== null) {
                        latestSnapshot.id = targetId;
                        await this.backendFetch('/tasks/restore', {
                            method: 'POST',
                            body: JSON.stringify({ task: latestSnapshot })
                        });
                    }
                } else if (item.type === 'deleteTasks') {
                    const normalizedIds = (item?.payload?.taskIds || [])
                        .map(value => this.resolveQueuedTaskId(value, idMap))
                        .filter(value => value !== null);
                    if (normalizedIds.length) {
                        await this.backendFetch('/tasks/bulk-delete', {
                            method: 'POST',
                            body: JSON.stringify({ taskIds: normalizedIds })
                        });
                    }
                } else if (item.type === 'restoreTask') {
                    const snapshot = JSON.parse(JSON.stringify(item?.payload?.task || null));
                    if (snapshot) {
                        const targetId = this.resolveQueuedTaskId(snapshot.id, idMap);
                        if (targetId !== null) snapshot.id = targetId;
                        await this.backendFetch('/tasks/restore', {
                            method: 'POST',
                            body: JSON.stringify({ task: snapshot })
                        });
                    }
                }
                processed += 1;
            } catch (error) {
                failed.push({
                    ...item,
                    lastError: error?.message || 'Offline replay failed',
                    lastTriedAt: new Date().toISOString()
                });
            }
        }

        this.writeOfflineQueue([]);
        if (failed.length) {
            const existingFailed = this.readFailedOfflineQueue();
            this.writeFailedOfflineQueue([...existingFailed, ...failed]);
        }

        await this.fetchFromBackend(true);
        return {
            processed,
            failed: failed.length,
            ...this.getOfflineQueueStatus()
        };
    }

    async fetchTaskLocks() {
        if (!this.isBackendReady() || !this.hasBackendAuth()) return {};
        const response = await this.backendFetch('/locks/tasks');
        const payload = await response.json();
        const list = payload?.data || [];
        const mapped = {};
        list.forEach(item => {
            mapped[item.taskId] = item;
        });
        if (this.state) this.state.taskLocks = mapped;
        return mapped;
    }

    startTaskLockListener(onLockUpdate) {
        if (!this.isBackendReady() || !this.hasBackendAuth()) return;
        const pollLocks = async () => {
            try {
                const locks = await this.fetchTaskLocks();
                if (onLockUpdate) onLockUpdate(locks);
                this.notify();
            } catch (error) { }
        };

        this.scheduleAdaptiveLoop('taskLocksInterval', pollLocks, 'taskLocks', 5000, true);
    }

    stopTaskLockListener() {
        this.stopAdaptiveLoop('taskLocksInterval');
    }

    async refreshBackendSharedState() {
        if (!this.isBackendReady() || !this.hasBackendAuth()) return;
        if (this.backendSyncInFlight) return this.backendSyncInFlight;

        this.backendSyncInFlight = (async () => {
            try {
                await this.fetchFromBackend(true);
                await this.fetchTaskLocks().catch(() => {});

                // Keep presence in sync for all logged-in users while backend mode is active.
                const response = await this.backendFetch('/presence');
                const payload = await response.json();
                const data = payload?.data || [];
                const mapped = {};
                data.forEach(item => {
                    mapped[item.username] = normalizePresenceRecord({
                        online: !!item.online,
                        status: item.status,
                        lastSeen: item.lastSeen,
                        browser: item.browser,
                        device: item.device
                    });
                });

                if (this.state) {
                    this.state.livePresence = mapped;
                    this.notify();
                }
            } catch (error) {
                // Best-effort background sync; avoid crashing UI flows.
            } finally {
                this.backendSyncInFlight = null;
            }
        })();

        return this.backendSyncInFlight;
    }

    startBackendSyncPolling(intervalMs = 8000) {
        if (!this.isBackendReady() || !this.hasBackendAuth()) return;
        this.scheduleAdaptiveLoop(
            'backendSyncInterval',
            () => this.refreshBackendSharedState(),
            'backendSync',
            Math.max(3000, Number(intervalMs) || 8000),
            true
        );
    }

    stopBackendSyncPolling() {
        this.stopAdaptiveLoop('backendSyncInterval');
    }

    async acquireTaskLock(taskId, ttlSeconds = 60) {
        if (!this.isBackendReady() || !this.hasBackendAuth()) return null;
        const response = await this.backendFetch(`/locks/tasks/${parseInt(taskId)}`, {
            method: 'PUT',
            body: JSON.stringify({ ttlSeconds })
        });
        const payload = await response.json();
        const lock = payload?.data || null;
        if (lock && this.state) {
            if (!this.state.taskLocks) this.state.taskLocks = {};
            this.state.taskLocks[lock.taskId] = lock;
        }
        return lock;
    }

    async releaseTaskLock(taskId) {
        if (!this.isBackendReady() || !this.hasBackendAuth()) return;
        try {
            await this.backendFetch(`/locks/tasks/${parseInt(taskId)}`, { method: 'DELETE' });
        } catch (error) { }
        if (this.state?.taskLocks) {
            delete this.state.taskLocks[parseInt(taskId)];
        }
    }

    startPresenceHeartbeat(username) {
        if (!this.state) return;

        // In backend mode, always use backend presence so auth/session rules
        // are consistent and we avoid silent Firebase permission failures.
        if (this.isBackendReady()) {
            if (!this.hasBackendAuth()) return;
            const pingPresence = async () => {
                if (!this.hasBackendAuth()) {
                    this.stopPresenceHeartbeat();
                    return;
                }
                try {
                    const presenceState = getRuntimePresenceState();
                    await this.backendFetch('/presence/me', {
                        method: 'PUT',
                        body: JSON.stringify(presenceState)
                    });
                } catch (error) { }
            };

            this.scheduleAdaptiveLoop('presenceInterval', pingPresence, 'presenceHeartbeat', 20000, true);
            return;
        }

        if (this.isFirebaseReady()) {
            const pingPresence = async () => {
                try {
                    const presenceState = getRuntimePresenceState();
                    const url = `${CONFIG.firebaseUrl}/${CONFIG.dataPath}/livePresence/${username}.json`;
                    await fetch(url, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            ...presenceState,
                            lastSeen: new Date().toISOString()
                        })
                    });
                } catch (e) { /* heartbeat is non-critical */ }
            };

            this.scheduleAdaptiveLoop('presenceInterval', pingPresence, 'presenceHeartbeat', 20000, true);
            return;
        }

        this.stopAdaptiveLoop('presenceInterval');
    }

    // Lightweight presence polling — reads only livePresence node
    startPresenceListener(onPresenceUpdate) {
        if (this.isBackendReady()) {
            if (!this.hasBackendAuth()) return;
            const pollPresence = async () => {
                if (!this.hasBackendAuth()) {
                    this.stopPresenceHeartbeat();
                    return;
                }
                try {
                    const response = await this.backendFetch('/presence');
                    const payload = await response.json();
                    const data = payload?.data || [];
                    const mapped = {};
                    data.forEach(item => {
                        mapped[item.username] = normalizePresenceRecord({
                            online: !!item.online,
                            status: item.status,
                            lastSeen: item.lastSeen,
                            browser: item.browser,
                            device: item.device
                        });
                    });
                    if (this.state) {
                        this.state.livePresence = mapped;
                        this.notify();
                        if (onPresenceUpdate) onPresenceUpdate(mapped);
                    }
                } catch (error) { }
            };

            this.scheduleAdaptiveLoop('presenceListenerInterval', pollPresence, 'presenceListener', 10000, true);
            return;
        }

        if (this.isFirebaseReady()) {
            const pollPresence = async () => {
                try {
                    const url = `${CONFIG.firebaseUrl}/${CONFIG.dataPath}/livePresence.json`;
                    const res = await fetch(url);
                    if (res.ok) {
                        const data = await res.json();
                        if (data && this.state) {
                            const normalized = Object.fromEntries(
                                Object.entries(data).map(([username, record]) => [username, normalizePresenceRecord(record)])
                            );
                            this.state.livePresence = normalized;
                            this.notify();
                            if (onPresenceUpdate) onPresenceUpdate(normalized);
                        }
                    }
                } catch (e) { /* ignore */ }
            };

            this.scheduleAdaptiveLoop('presenceListenerInterval', pollPresence, 'presenceListener', 10000, true);
            return;
        }

        this.stopAdaptiveLoop('presenceListenerInterval');
    }

    stopPresenceHeartbeat() {
        this.stopAdaptiveLoop('presenceInterval');
        this.stopAdaptiveLoop('presenceListenerInterval');
    }

    stopRealtimeStateListener() {
        if (this.remoteEventSource) {
            this.remoteEventSource.close();
            this.remoteEventSource = null;
        }
    }

    startRealtimeStateListener(onStateUpdate) {
        this.stopRealtimeStateListener();
        if (this.isBackendReady()) return;
        if (!this.isFirebaseReady()) return;

        const url = `${CONFIG.firebaseUrl}/${CONFIG.dataPath}.json`;
        const es = new EventSource(url);
        this.remoteEventSource = es;

        const applyPathUpdate = (target, path, data) => {
            if (!target) return;
            if (!path || path === '/') {
                this.state = data;
                this.migrateData();
                this.lastRemoteSyncAt = Date.now();
                this.notify();
                if (onStateUpdate) onStateUpdate(this.state);
                return;
            }

            const segments = path.split('/').filter(Boolean);
            let cursor = target;

            for (let index = 0; index < segments.length - 1; index++) {
                const key = segments[index];
                if (cursor[key] === undefined || cursor[key] === null || typeof cursor[key] !== 'object') {
                    cursor[key] = {};
                }
                cursor = cursor[key];
            }

            const finalKey = segments[segments.length - 1];
            if (data === null) {
                delete cursor[finalKey];
            } else {
                cursor[finalKey] = data;
            }

            this.migrateData();
            this.lastRemoteSyncAt = Date.now();
            this.notify();
            if (onStateUpdate) onStateUpdate(this.state);
        };

        const handleStreamEvent = (event) => {
            if (!event || !event.data) return;
            try {
                const payload = JSON.parse(event.data);
                applyPathUpdate(this.state || {}, payload.path, payload.data);
            } catch (error) {
                console.warn('Failed to parse realtime stream event:', error);
            }
        };

        es.addEventListener('put', handleStreamEvent);
        es.addEventListener('patch', handleStreamEvent);

        es.onerror = () => {
            this.stopRealtimeStateListener();
            setTimeout(() => this.startRealtimeStateListener(onStateUpdate), 2500);
        };
    }

    queueSave(work) {
        this.saveQueue = this.saveQueue
            .then(() => work())
            .catch((error) => {
                throw error;
            });
        return this.saveQueue;
    }

    async ensureRemoteFreshness(maxAgeMs = 5000) {
        if (!this.isFirebaseReady()) return;
        if (Date.now() - this.lastRemoteSyncAt > maxAgeMs) {
            await this.fetchFromFirebase();
        }
    }

    async init() {
        await this.preparePersistence();

        if (this.isBackendReady()) {
            this.stopRealtimeStateListener();
            const hasValidToken = await this.validateBackendToken();
            if (hasValidToken) {
                await this.fetchFromBackend(true);
            } else {
                if (!this.state) {
                    this.state = JSON.parse(JSON.stringify(DEFAULT_STATE));
                    this.migrateData();
                    this.notify();
                }
            }
            return this.state;
        }

        if (this.isFirebaseReady()) {
            await this.fetchFromFirebase();
            this.startRealtimeStateListener();
        } else {
            this.stopRealtimeStateListener();
            this.fetchFromLocal();
        }
        return this.state;
    }

    fetchFromLocal() {
        try {
            const localData = this.readPersistedJson(LOCAL_STATE_CACHE_KEY, null);
            if (localData) {
                this.state = localData;
                this.migrateData();
            } else {
                this.state = JSON.parse(JSON.stringify(DEFAULT_STATE));
                this.saveToLocal();
            }
        } catch (e) {
            console.error("Error reading from local storage:", e);
            this.state = JSON.parse(JSON.stringify(DEFAULT_STATE));
        }
        this.notify();
    }

    saveToLocal() {
        try {
            this.persistJson(LOCAL_STATE_CACHE_KEY, this.state);
            this.notify();
        } catch (e) {
            console.error("Error saving to local storage:", e);
        }
    }

    // ========== FIREBASE METHODS ==========

    async fetchFromFirebase() {
        try {
            const url = `${CONFIG.firebaseUrl}/${CONFIG.dataPath}.json`;
            const response = await fetch(url, {
                headers: { 'X-Firebase-ETag': 'true' }
            });

            if (!response.ok) {
                throw new Error(`Firebase fetch error: ${response.status}`);
            }

            this.remoteEtag = response.headers.get('ETag');
            const data = await response.json();

            if (data) {
                this.state = data;
                this.migrateData();
                this.persistJson(LOCAL_STATE_BACKUP_KEY, this.state);
                this.lastRemoteSyncAt = Date.now();
            } else {
                // Database is empty — initialize with default state
                this.state = JSON.parse(JSON.stringify(DEFAULT_STATE));
                await this.saveToFirebase({ forceWithoutEtag: true });
            }
        } catch (error) {
            console.error("Failed to fetch from Firebase, falling back to local:", error);
            const backup = this.readPersistedJson(LOCAL_STATE_BACKUP_KEY, null);
            this.state = backup || JSON.parse(JSON.stringify(DEFAULT_STATE));
            this.migrateData();
        }
        this.notify();
    }

    async saveToFirebase(options = {}) {
        const { forceWithoutEtag = false } = options;
        try {
            const url = `${CONFIG.firebaseUrl}/${CONFIG.dataPath}.json`;

            if (!forceWithoutEtag && !this.remoteEtag) {
                const etagResponse = await fetch(url, {
                    headers: { 'X-Firebase-ETag': 'true' }
                });
                if (etagResponse.ok) {
                    this.remoteEtag = etagResponse.headers.get('ETag');
                }
            }

            const headers = { 'Content-Type': 'application/json' };
            if (!forceWithoutEtag && this.remoteEtag) {
                headers['if-match'] = this.remoteEtag;
            }

            const response = await fetch(url, {
                method: 'PUT',
                headers,
                body: JSON.stringify(this.state)
            });

            if (response.status === 412) {
                const latestEtag = response.headers.get('ETag');
                if (latestEtag) this.remoteEtag = latestEtag;
                const conflictError = new Error('Write conflict: remote state changed by another user.');
                conflictError.code = 'WRITE_CONFLICT';
                throw conflictError;
            }

            if (!response.ok) {
                const errBody = await response.text();
                throw new Error(`Firebase save error: ${response.status} - ${errBody}`);
            }

            const latestEtag = response.headers.get('ETag');
            if (latestEtag) this.remoteEtag = latestEtag;
            this.lastRemoteSyncAt = Date.now();

            // Also cache locally
            this.persistJson(LOCAL_STATE_BACKUP_KEY, this.state);
            this.notify();
            return true;
        } catch (error) {
            console.error("Error saving to Firebase:", error);
            this.saveToLocal();
            throw error;
        }
    }

    // ========== DATA MIGRATION ==========

    migrateData() {
        if (!this.state) return;

        if (!this.state.authUsers || this.state.authUsers.length === 0) {
            this.state.authUsers = DEFAULT_AUTH_USERS;
        } else {
            this.state.authUsers = this.state.authUsers.map(user => {
                const cloned = { ...user };
                if (cloned.password && !cloned.passwordHash) {
                    cloned.passwordHash = null;
                }
                delete cloned.password;
                return cloned;
            });
        }
        applyUserDirectoryState(this.state, this.state.authUsers);
        if (!this.state.livePresence) this.state.livePresence = {};
        this.state.livePresence = Object.fromEntries(
            Object.entries(this.state.livePresence).map(([username, record]) => [username, normalizePresenceRecord(record)])
        );
        if (!this.state.loginHistory) this.state.loginHistory = [];
        if (!this.state.taskLocks) this.state.taskLocks = {};

        // Migrate string clients to objects
        if (this.state.config && this.state.config.clients && this.state.config.clients.length > 0 && typeof this.state.config.clients[0] === 'string') {
            let nextId = 1;
            this.state.config.clients = this.state.config.clients.map(c => ({
                id: nextId++,
                name: c,
                contact: "", email: "", phone: ""
            }));
            this.state.config.nextClientId = nextId;
        }

        if (this.state.config && !this.state.config.nextClientId) {
            this.state.config.nextClientId = this.state.config.clients.length
                ? Math.max(...this.state.config.clients.map(c => c.id || 0)) + 1
                : 1;
        }
    }

    // ========== ACTION METHODS ==========

    async runWithConflictRetry(mutator, retries = 1) {
        if (!this.state) return;

        if (this.isBackendReady()) {
            await mutator();
            return;
        }

        const attempt = async (remainingRetries) => {
            await this.ensureRemoteFreshness();
            await mutator();

            if (this.isFirebaseReady()) {
                try {
                    await this.saveToFirebase();
                } catch (error) {
                    if (error?.code === 'WRITE_CONFLICT' && remainingRetries > 0) {
                        await this.fetchFromFirebase();
                        return attempt(remainingRetries - 1);
                    }
                    throw error;
                }
            } else {
                this.saveToLocal();
            }
        };

        return this.queueSave(() => attempt(retries));
    }

    async saveTask(taskData) {
        if (!this.state) return;

        const now = new Date().toISOString();

        const applyLocalSaveTask = () => {
            if (!taskData.id) {
                taskData.id = this.state.config.nextTaskId++;
                taskData.createdAt = now;
                taskData.updatedAt = now;
                taskData.activityLog = [
                    { action: 'Task created', user: getCurrentUser(), timestamp: now }
                ];
                taskData.version = 1;
                this.state.tasks.push(taskData);
                return taskData;
            }

            const index = this.state.tasks.findIndex(t => t.id === parseInt(taskData.id));
            if (index !== -1) {
                const oldTask = this.state.tasks[index];
                taskData.id = parseInt(taskData.id);
                taskData.createdAt = oldTask.createdAt;
                taskData.updatedAt = now;
                taskData.version = (oldTask.version || 1) + 1;

                const log = oldTask.activityLog || [];
                if (oldTask.status !== taskData.status) {
                    log.push({ action: `Status changed to "${taskData.status}"`, user: getCurrentUser(), timestamp: now });
                }
                if (normalizeStaffIdentityFromUsers(this.state?.authUsers, oldTask.staff) !== normalizeStaffIdentityFromUsers(this.state?.authUsers, taskData.staff)) {
                    log.push({ action: `Assigned to ${getStaffDisplayNameFromUsers(this.state?.authUsers, taskData.staff)}`, user: getCurrentUser(), timestamp: now });
                }
                if (log.length === oldTask.activityLog?.length) {
                    log.push({ action: 'Task updated', user: getCurrentUser(), timestamp: now });
                }

                taskData.activityLog = log;
                this.state.tasks[index] = taskData;
                return taskData;
            }
            return null;
        };

        if (this.isBackendReady()) {
            if (!navigator.onLine) {
                const queuePayload = JSON.parse(JSON.stringify(taskData));
                const localTask = applyLocalSaveTask();
                if (!queuePayload.id) {
                    queuePayload.__offlineCreate = true;
                    queuePayload.clientTaskId = this.parseTaskId(localTask?.id);
                    queuePayload.id = this.parseTaskId(localTask?.id);
                }
                this.enqueueOfflineAction({ type: 'saveTask', payload: queuePayload });
                this.saveToLocal();
                return localTask;
            }

            if (!taskData.id) {
                const response = await this.backendFetch('/tasks', {
                    method: 'POST',
                    body: JSON.stringify({
                        client: taskData.client,
                        project: taskData.project || '',
                        task: taskData.task,
                        staff: taskData.staff,
                        status: taskData.status,
                        priority: taskData.priority,
                        startDate: taskData.startDate || '',
                        dueDate: taskData.dueDate || '',
                        waitingFor: taskData.waitingFor || '',
                        notes: taskData.notes || '',
                        parentId: taskData.parentId ? parseInt(taskData.parentId) : null
                    })
                });
                const payload = await response.json();
                await this.fetchFromBackend();
                return payload?.data;
            }

            const oldTask = this.state.tasks.find(item => item.id === parseInt(taskData.id));
            const response = await this.backendFetch(`/tasks/${parseInt(taskData.id)}`, {
                method: 'PUT',
                body: JSON.stringify({
                    client: taskData.client,
                    project: taskData.project || '',
                    task: taskData.task,
                    staff: taskData.staff,
                    status: taskData.status,
                    priority: taskData.priority,
                    startDate: taskData.startDate || '',
                    dueDate: taskData.dueDate || '',
                    waitingFor: taskData.waitingFor || '',
                    notes: taskData.notes || '',
                    parentId: taskData.parentId ? parseInt(taskData.parentId) : null,
                    version: oldTask?.version || 1
                })
            });
            const payload = await response.json();
            await this.fetchFromBackend();
            return payload?.data;
        }

        await this.runWithConflictRetry(async () => {
            if (!taskData.id) {
                taskData.id = this.state.config.nextTaskId++;
                taskData.createdAt = now;
                taskData.updatedAt = now;
                taskData.activityLog = [
                    { action: 'Task created', user: getCurrentUser(), timestamp: now }
                ];
                this.state.tasks.push(taskData);
            } else {
                const index = this.state.tasks.findIndex(t => t.id === parseInt(taskData.id));
                if (index !== -1) {
                    const oldTask = this.state.tasks[index];
                    taskData.id = parseInt(taskData.id);
                    taskData.createdAt = oldTask.createdAt;
                    taskData.updatedAt = now;

                    const log = oldTask.activityLog || [];
                    if (oldTask.status !== taskData.status) {
                        log.push({ action: `Status changed to "${taskData.status}"`, user: getCurrentUser(), timestamp: now });
                    }
                    if (normalizeStaffIdentityFromUsers(this.state?.authUsers, oldTask.staff) !== normalizeStaffIdentityFromUsers(this.state?.authUsers, taskData.staff)) {
                        log.push({ action: `Assigned to ${getStaffDisplayNameFromUsers(this.state?.authUsers, taskData.staff)}`, user: getCurrentUser(), timestamp: now });
                    }
                    if (log.length === oldTask.activityLog?.length) {
                        log.push({ action: 'Task updated', user: getCurrentUser(), timestamp: now });
                    }

                    taskData.activityLog = log;
                    this.state.tasks[index] = taskData;
                }
            }
        });

        return taskData;
    }

    async updateTaskStatus(taskId, newStatus) {
        if (!this.state) return;

        if (this.isBackendReady()) {
            const task = this.state.tasks.find(item => item.id === parseInt(taskId));
            if (!task) return;

            if (!navigator.onLine) {
                task.status = newStatus;
                task.updatedAt = new Date().toISOString();
                task.version = (task.version || 1) + 1;
                task.activityLog = task.activityLog || [];
                task.activityLog.push({
                    action: `Status changed to "${newStatus}" via drag`,
                    user: getCurrentUser(),
                    timestamp: task.updatedAt
                });
                this.enqueueOfflineAction({ type: 'updateTaskStatus', payload: { taskId: parseInt(taskId), newStatus } });
                this.saveToLocal();
                return;
            }

            await this.backendFetch(`/tasks/${parseInt(taskId)}/status`, {
                method: 'PATCH',
                body: JSON.stringify({ status: newStatus, version: task.version || 1 })
            });
            await this.fetchFromBackend();
            return;
        }

        await this.runWithConflictRetry(async () => {
            const index = this.state.tasks.findIndex(t => t.id === parseInt(taskId));
            if (index !== -1) {
                const task = this.state.tasks[index];
                if (task.status !== newStatus) {
                    task.status = newStatus;
                    task.updatedAt = new Date().toISOString();
                    task.activityLog = task.activityLog || [];
                    task.activityLog.push({
                        action: `Status changed to "${newStatus}" via drag`,
                        user: getCurrentUser(),
                        timestamp: task.updatedAt
                    });
                }
            }
        });
    }

    async deleteTasks(taskIds) {
        if (!this.state) return;

        if (this.isBackendReady()) {
            const normalizedIds = taskIds.map(item => parseInt(item));
            if (!navigator.onLine) {
                this.state.tasks = this.state.tasks.filter(t => !normalizedIds.includes(parseInt(t.id)));
                this.enqueueOfflineAction({ type: 'deleteTasks', payload: { taskIds: normalizedIds } });
                this.saveToLocal();
                return;
            }
            await this.backendFetch('/tasks/bulk-delete', {
                method: 'POST',
                body: JSON.stringify({ taskIds: normalizedIds })
            });
            await this.fetchFromBackend();
            return;
        }

        await this.runWithConflictRetry(async () => {
            this.state.tasks = this.state.tasks.filter(t => !taskIds.includes(t.id.toString()) && !taskIds.includes(t.id));
        });
    }

    async saveClient(clientData) {
        if (!this.state) return;

        if (this.isBackendReady()) {
            if (clientData.originalName) {
                const existing = this.state.config.clients.find(item => item.name === clientData.originalName);
                if (!existing) return;
                await this.backendFetch(`/clients/${existing.id}`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        name: clientData.name,
                        contact: clientData.contact || '',
                        email: clientData.email || '',
                        phone: clientData.phone || '',
                        version: existing.version || 1
                    })
                });
            } else {
                await this.backendFetch('/clients', {
                    method: 'POST',
                    body: JSON.stringify({
                        name: clientData.name,
                        contact: clientData.contact || '',
                        email: clientData.email || '',
                        phone: clientData.phone || ''
                    })
                });
            }

            await this.fetchFromBackend();
            return;
        }

        await this.runWithConflictRetry(async () => {
            if (clientData.originalName) {
                const index = this.state.config.clients.findIndex(c => c.name === clientData.originalName);
                if (index !== -1) {
                    if (clientData.name !== clientData.originalName) {
                        this.state.tasks.forEach(t => {
                            if (t.client === clientData.originalName) t.client = clientData.name;
                        });
                    }
                    const oldClient = this.state.config.clients[index];
                    this.state.config.clients[index] = { ...oldClient, ...clientData };
                    delete this.state.config.clients[index].originalName;
                }
            } else {
                clientData.id = this.state.config.nextClientId++;
                this.state.config.clients.push(clientData);
            }
        });
    }

    async deleteClient(clientName) {
        if (!this.state) return;

        if (this.isBackendReady()) {
            const existing = this.state.config.clients.find(item => item.name === clientName);
            if (!existing) {
                throw new Error(`Client "${clientName}" not found.`);
            }
            await this.backendFetch(`/clients/${existing.id}`, { method: 'DELETE' });
            await this.fetchFromBackend();
            return;
        }

        const isUsed = this.state.tasks.some(t => t.client === clientName);
        if (isUsed) {
            throw new Error(`Cannot delete client "${clientName}" because it is currently assigned to active tasks.`);
        }

        await this.runWithConflictRetry(async () => {
            this.state.config.clients = this.state.config.clients.filter(c => c.name !== clientName);
        });
    }

    async restoreTaskSnapshot(taskSnapshot) {
        if (!this.state || !taskSnapshot) return;

        if (this.isBackendReady()) {
            if (!navigator.onLine) {
                this.enqueueOfflineAction({ type: 'restoreTask', payload: { task: taskSnapshot } });
            } else {
                await this.backendFetch('/tasks/restore', {
                    method: 'POST',
                    body: JSON.stringify({ task: taskSnapshot })
                });
            }
            await this.fetchFromBackend(true);
            return;
        }

        const incomingId = parseInt(taskSnapshot.id);
        const index = this.state.tasks.findIndex(item => parseInt(item.id) === incomingId);
        if (index === -1) {
            this.state.tasks.push(taskSnapshot);
        } else {
            this.state.tasks[index] = taskSnapshot;
        }
        this.state.config.nextTaskId = Math.max(this.state.config.nextTaskId || 1, incomingId + 1);
        this.saveToLocal();
    }
}

// Auth helper
function getCurrentUser() {
    try {
        const u = readCurrentSession();
        return u ? u.name : 'Unknown';
    } catch (e) {
        return 'Unknown';
    }
}

const store = new DataStore();
