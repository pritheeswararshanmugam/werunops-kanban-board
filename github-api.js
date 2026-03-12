/**
 * Firebase Realtime Database & Data Persistence Layer
 * Handles fetching and saving data to Firebase, with localStorage fallback.
 */

const CONFIG = {
    // Firebase Realtime Database URL — hardcoded for production
    // Can be overridden via Settings UI (stored in localStorage)
    firebaseUrl: localStorage.getItem('werunops_firebase_url') || 'https://werun-ops-backoffice-default-rtdb.firebaseio.com',
    dataPath: 'state', // The path in the database where state is stored
    firebaseWebApiKey: localStorage.getItem('werunops_firebase_web_api_key') || ''
};

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

const DEFAULT_STATE = {
    authUsers: [
        { username: 'Eshwar', passwordHash: 'f91b043302878951ce9258214033bd206ea0a92bb88931ba8bb6edb01b57d020', name: 'Pritheeswarar', role: 'Admin', initials: 'P' },
        { username: 'Mubarak', passwordHash: '23fece5f1a2a4452cba0113271736a16d241201bef2fd15b72819582e13fb267', name: 'Mubarak', role: 'Manager', initials: 'M' },
        { username: 'Sudhar', passwordHash: '56e89b1d6436fc86deea34dbb0306af59c40d29f20bc20b6efcb001cee9ae71b', name: 'Sudharshan', role: 'User', initials: 'S' }
    ],
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
            staff: "Eswar",
            status: "New",
            priority: "Medium",
            startDate: "",
            dueDate: new Date(Date.now() + 86400000).toISOString().split('T')[0],
            waitingFor: "",
            notes: "Need to check recent material prices.",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            activityLog: [
                { action: 'Task created', user: 'Eswar', timestamp: new Date().toISOString() }
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
        staff: ["Mubarak", "Eswar", "Pritheeswarar", "Sudharshan"],
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

    isFirebaseReady() {
        return !!CONFIG.firebaseUrl;
    }

    startPresenceHeartbeat(username) {
        if (!this.state) return;

        const pingPresence = async () => {
            if (!this.isFirebaseReady()) return;
            // PATCH only this user's presence entry — tiny payload, no conflicts
            try {
                const url = `${CONFIG.firebaseUrl}/${CONFIG.dataPath}/livePresence/${username}.json`;
                await fetch(url, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        online: true,
                        lastSeen: new Date().toISOString()
                    })
                });
            } catch (e) { /* heartbeat is non-critical */ }
        };

        pingPresence();
        if (this.presenceInterval) clearInterval(this.presenceInterval);
        this.presenceInterval = setInterval(pingPresence, 20000); // every 20s
    }

    // Lightweight presence polling — reads only livePresence node
    startPresenceListener(onPresenceUpdate) {
        const pollPresence = async () => {
            if (!this.isFirebaseReady()) return;
            try {
                const url = `${CONFIG.firebaseUrl}/${CONFIG.dataPath}/livePresence.json`;
                const res = await fetch(url);
                if (res.ok) {
                    const data = await res.json();
                    if (data && this.state) {
                        this.state.livePresence = data;
                        if (onPresenceUpdate) onPresenceUpdate(data);
                    }
                }
            } catch (e) { /* ignore */ }
        };

        pollPresence();
        if (this.presenceListenerInterval) clearInterval(this.presenceListenerInterval);
        this.presenceListenerInterval = setInterval(pollPresence, 10000); // every 10s
    }

    stopPresenceHeartbeat() {
        if (this.presenceInterval) {
            clearInterval(this.presenceInterval);
            this.presenceInterval = null;
        }
        if (this.presenceListenerInterval) {
            clearInterval(this.presenceListenerInterval);
            this.presenceListenerInterval = null;
        }
    }

    stopRealtimeStateListener() {
        if (this.remoteEventSource) {
            this.remoteEventSource.close();
            this.remoteEventSource = null;
        }
    }

    startRealtimeStateListener(onStateUpdate) {
        this.stopRealtimeStateListener();
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
            const localData = localStorage.getItem('backoffice_state');
            if (localData) {
                this.state = JSON.parse(localData);
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
            localStorage.setItem('backoffice_state', JSON.stringify(this.state));
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
                localStorage.setItem('backoffice_state_backup', JSON.stringify(this.state));
                this.lastRemoteSyncAt = Date.now();
            } else {
                // Database is empty — initialize with default state
                this.state = JSON.parse(JSON.stringify(DEFAULT_STATE));
                await this.saveToFirebase({ forceWithoutEtag: true });
            }
        } catch (error) {
            console.error("Failed to fetch from Firebase, falling back to local:", error);
            const backup = localStorage.getItem('backoffice_state_backup');
            this.state = backup ? JSON.parse(backup) : JSON.parse(JSON.stringify(DEFAULT_STATE));
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
            localStorage.setItem('backoffice_state_backup', JSON.stringify(this.state));
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
            this.state.authUsers = DEFAULT_STATE.authUsers;
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
        if (!this.state.livePresence) this.state.livePresence = {};
        if (!this.state.loginHistory) this.state.loginHistory = [];

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
                    if (oldTask.staff !== taskData.staff) {
                        log.push({ action: `Assigned to ${taskData.staff}`, user: getCurrentUser(), timestamp: now });
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

        await this.runWithConflictRetry(async () => {
            this.state.tasks = this.state.tasks.filter(t => !taskIds.includes(t.id.toString()) && !taskIds.includes(t.id));
        });
    }

    async saveClient(clientData) {
        if (!this.state) return;

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

        const isUsed = this.state.tasks.some(t => t.client === clientName);
        if (isUsed) {
            throw new Error(`Cannot delete client "${clientName}" because it is currently assigned to active tasks.`);
        }

        await this.runWithConflictRetry(async () => {
            this.state.config.clients = this.state.config.clients.filter(c => c.name !== clientName);
        });
    }
}

// Auth helper
function getCurrentUser() {
    try {
        const u = JSON.parse(localStorage.getItem('currentUser'));
        return u ? u.name : 'Unknown';
    } catch (e) {
        return 'Unknown';
    }
}

const store = new DataStore();
