/**
 * Firebase Realtime Database & Data Persistence Layer
 * Handles fetching and saving data to Firebase, with localStorage fallback.
 */

const CONFIG = {
    // Firebase Realtime Database URL — stored in localStorage, configured via Settings
    firebaseUrl: localStorage.getItem('werunops_firebase_url') || '',
    dataPath: 'state' // The path in the database where state is stored
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

const DEFAULT_STATE = {
    authUsers: [
        { username: 'Eshwar', password: '110495', name: 'Pritheeswarar', role: 'Admin', initials: 'P' },
        { username: 'Mubarak', password: '6544332211', name: 'Mubarak', role: 'Manager', initials: 'M' },
        { username: 'Sudhar', password: '19091997', name: 'Sudharshan', role: 'User', initials: 'S' }
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
            try {
                await this.fetchFromFirebase();
            } catch (e) { /* ignore heartbeat fetch errors */ }
            if (!this.state) return;
            if (!this.state.livePresence) this.state.livePresence = {};
            this.state.livePresence[username] = {
                online: true,
                lastSeen: new Date().toISOString()
            };
            try { await this.saveToFirebase(); } catch (e) { /* heartbeat is non-critical */ }
        };

        pingPresence();
        if (this.presenceInterval) clearInterval(this.presenceInterval);
        this.presenceInterval = setInterval(pingPresence, 30000);
    }

    stopPresenceHeartbeat() {
        if (this.presenceInterval) {
            clearInterval(this.presenceInterval);
            this.presenceInterval = null;
        }
    }

    async init() {
        if (this.isFirebaseReady()) {
            await this.fetchFromFirebase();
        } else {
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
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`Firebase fetch error: ${response.status}`);
            }

            const data = await response.json();

            if (data) {
                this.state = data;
                this.migrateData();
                localStorage.setItem('backoffice_state_backup', JSON.stringify(this.state));
            } else {
                // Database is empty — initialize with default state
                this.state = JSON.parse(JSON.stringify(DEFAULT_STATE));
                await this.saveToFirebase();
            }
        } catch (error) {
            console.error("Failed to fetch from Firebase, falling back to local:", error);
            const backup = localStorage.getItem('backoffice_state_backup');
            this.state = backup ? JSON.parse(backup) : JSON.parse(JSON.stringify(DEFAULT_STATE));
            this.migrateData();
        }
        this.notify();
    }

    async saveToFirebase() {
        try {
            const url = `${CONFIG.firebaseUrl}/${CONFIG.dataPath}.json`;
            const response = await fetch(url, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.state)
            });

            if (!response.ok) {
                const errBody = await response.text();
                throw new Error(`Firebase save error: ${response.status} - ${errBody}`);
            }

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

    async saveTask(taskData) {
        if (!this.state) return;

        const now = new Date().toISOString();

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

        if (this.isFirebaseReady()) {
            await this.saveToFirebase();
        } else {
            this.saveToLocal();
        }

        return taskData;
    }

    async updateTaskStatus(taskId, newStatus) {
        if (!this.state) return;

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

                if (this.isFirebaseReady()) {
                    await this.saveToFirebase();
                } else {
                    this.saveToLocal();
                }
            }
        }
    }

    async deleteTasks(taskIds) {
        if (!this.state) return;

        const initialLength = this.state.tasks.length;
        this.state.tasks = this.state.tasks.filter(t => !taskIds.includes(t.id.toString()) && !taskIds.includes(t.id));

        if (this.state.tasks.length !== initialLength) {
            if (this.isFirebaseReady()) {
                await this.saveToFirebase();
            } else {
                this.saveToLocal();
            }
        }
    }

    async saveClient(clientData) {
        if (!this.state) return;

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

        if (this.isFirebaseReady()) {
            await this.saveToFirebase();
        } else {
            this.saveToLocal();
        }
    }

    async deleteClient(clientName) {
        if (!this.state) return;

        const isUsed = this.state.tasks.some(t => t.client === clientName);
        if (isUsed) {
            throw new Error(`Cannot delete client "${clientName}" because it is currently assigned to active tasks.`);
        }

        const initialLength = this.state.config.clients.length;
        this.state.config.clients = this.state.config.clients.filter(c => c.name !== clientName);

        if (this.state.config.clients.length !== initialLength) {
            if (this.isFirebaseReady()) {
                await this.saveToFirebase();
            } else {
                this.saveToLocal();
            }
        }
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
