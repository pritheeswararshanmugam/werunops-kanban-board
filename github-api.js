/**
 * GitHub API & Data Persistence Layer
 * Handles fetching and saving data to GitHub Repository, with localStorage fallback.
 */

const CONFIG = {
    // If true, uses GitHub API. If false, uses localStorage (for development/testing without tokens)
    useGithub: true,
    repo: 'pritheeswararshanmugam/werunops-kanban-board',
    branch: 'main',
    token: '', // STOP! You MUST paste your GitHub Personal Access Token (PAT) here for multi-user sync to work
    dataFile: 'data/state.json'
};

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
            dueDate: new Date().toISOString().split('T')[0], // Today
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
            dueDate: new Date(Date.now() + 86400000).toISOString().split('T')[0], // Tomorrow
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

    // Subscribe to state changes
    subscribe(listener) {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    notify() {
        this.listeners.forEach(listener => listener(this.state));
    }

    startPresenceHeartbeat(username) {
        if (!this.state) return;

        const pingPresence = async () => {
            if (CONFIG.useGithub && CONFIG.token) {
                try {
                    await this.fetchFromGithub(); // Sync latest remote state
                } catch(e) { console.warn('Heartbeat fetch failed', e); }
            }
            if(!this.state) return;
            if(!this.state.livePresence) this.state.livePresence = {};
            
            this.state.livePresence[username] = {
                online: true,
                lastSeen: new Date().toISOString()
            };
            
            if (CONFIG.useGithub && CONFIG.token) {
                try { await this.saveToGithub(); } catch(e) {}
            } else {
                this.saveToLocal();
            }
        };

        pingPresence();
        if(this.presenceInterval) clearInterval(this.presenceInterval);
        this.presenceInterval = setInterval(pingPresence, 30000);
    }

    stopPresenceHeartbeat() {
        if(this.presenceInterval) {
            clearInterval(this.presenceInterval);
            this.presenceInterval = null;
        }
    }

    async init() {
        if (CONFIG.useGithub && CONFIG.token) {
            await this.fetchFromGithub();
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

    async fetchFromGithub() {
        try {
            const url = `https://api.github.com/repos/${CONFIG.repo}/contents/${CONFIG.dataFile}?ref=${CONFIG.branch}`;
            const response = await fetch(url, {
                headers: {
                    'Authorization': `token ${CONFIG.token}`,
                    'Accept': 'application/vnd.github.v3.raw'
                }
            });

            if (response.ok) {
                this.state = await response.json();
                // Also cache locally
                localStorage.setItem('backoffice_state_backup', JSON.stringify(this.state));
            } else if (response.status === 404) {
                // File doesn't exist yet, use default
                this.state = JSON.parse(JSON.stringify(DEFAULT_STATE));
                await this.saveToGithub(); // Create the file
            } else {
                throw new Error(`GitHub API error: ${response.status}`);
            }
        } catch (error) {
            console.error("Failed to fetch from GitHub, falling back to local:", error);
            // Fallback to local backup or default
            const backup = localStorage.getItem('backoffice_state_backup');
            this.state = backup ? JSON.parse(backup) : JSON.parse(JSON.stringify(DEFAULT_STATE));
            this.migrateData();
        }
        this.notify();
    }

    async saveToGithub() {
        try {
            // First get the file sha to update it
            let sha = null;
            const getUrl = `https://api.github.com/repos/${CONFIG.repo}/contents/${CONFIG.dataFile}?ref=${CONFIG.branch}`;

            try {
                const getRes = await fetch(getUrl, {
                    headers: { 'Authorization': `token ${CONFIG.token}` }
                });
                if (getRes.ok) {
                    const getData = await getRes.json();
                    sha = getData.sha;
                }
            } catch (e) { /* File might not exist */ }

            // Encode content to base64
            const content = btoa(unescape(encodeURIComponent(JSON.stringify(this.state, null, 2))));

            const putUrl = `https://api.github.com/repos/${CONFIG.repo}/contents/${CONFIG.dataFile}`;
            const body = {
                message: `Update state: ${new Date().toISOString()}`,
                content: content,
                branch: CONFIG.branch
            };

            if (sha) body.sha = sha;

            const response = await fetch(putUrl, {
                method: 'PUT',
                headers: {
                    'Authorization': `token ${CONFIG.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                throw new Error(`Failed to save to GitHub: ${response.status}`);
            }

            // Cache locally on success
            localStorage.setItem('backoffice_state_backup', JSON.stringify(this.state));
            this.notify();
            return true;
        } catch (error) {
            console.error("Error saving to GitHub:", error);
            // Fallback save to local so data isn't lost
            this.saveToLocal();
            throw error;
        }
    }

    // --- Action Methods ---

    migrateData() {
        if (!this.state) return;
        // Migrate string clients to objects
        if (this.state.config.clients && this.state.config.clients.length > 0 && typeof this.state.config.clients[0] === 'string') {
            let nextId = 1;
            this.state.config.clients = this.state.config.clients.map(c => ({
                id: nextId++,
                name: c,
                contact: "", email: "", phone: ""
            }));
            this.state.config.nextClientId = nextId;
        }
        if (!this.state.config.nextClientId) this.state.config.nextClientId = this.state.config.clients.length ? Math.max(...this.state.config.clients.map(c => c.id || 0)) + 1 : 1;
    }

    async saveTask(taskData) {
        if (!this.state) return;

        const now = new Date().toISOString();
        let isNew = false;

        if (!taskData.id) {
            // New task
            isNew = true;
            taskData.id = this.state.config.nextTaskId++;
            taskData.createdAt = now;
            taskData.updatedAt = now;
            taskData.activityLog = [
                { action: 'Task created', user: getCurrentUser(), timestamp: now }
            ];
            this.state.tasks.push(taskData);
        } else {
            // Update existing
            const index = this.state.tasks.findIndex(t => t.id === parseInt(taskData.id));
            if (index !== -1) {
                const oldTask = this.state.tasks[index];
                taskData.id = parseInt(taskData.id);
                taskData.createdAt = oldTask.createdAt;
                taskData.updatedAt = now;

                // Track changes for activity log
                const log = oldTask.activityLog || [];

                if (oldTask.status !== taskData.status) {
                    log.push({ action: `Status changed to "${taskData.status}"`, user: getCurrentUser(), timestamp: now });
                }
                if (oldTask.staff !== taskData.staff) {
                    log.push({ action: `Assigned to ${taskData.staff}`, user: getCurrentUser(), timestamp: now });
                }

                // If it was just a general edit without specific tracked changes
                if (log.length === oldTask.activityLog?.length) {
                    log.push({ action: 'Task updated', user: getCurrentUser(), timestamp: now });
                }

                taskData.activityLog = log;
                this.state.tasks[index] = taskData;
            }
        }

        if (CONFIG.useGithub && CONFIG.token) {
            await this.saveToGithub();
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

                if (CONFIG.useGithub && CONFIG.token) {
                    await this.saveToGithub();
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
            if (CONFIG.useGithub && CONFIG.token) {
                await this.saveToGithub();
            } else {
                this.saveToLocal();
            }
        }
    }

    async saveClient(clientData) {
        if (!this.state) return;

        if (clientData.originalName) {
            // Edit existing
            const index = this.state.config.clients.findIndex(c => c.name === clientData.originalName);
            if (index !== -1) {
                // Update task references
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
            // Add new
            clientData.id = this.state.config.nextClientId++;
            this.state.config.clients.push(clientData);
        }

        if (CONFIG.useGithub && CONFIG.token) {
            await this.saveToGithub();
        } else {
            this.saveToLocal();
        }
    }

    async deleteClient(clientName) {
        if (!this.state) return;

        // Validation happens in UI, but we perform it here safely anyway
        const isUsed = this.state.tasks.some(t => t.client === clientName);
        if (isUsed) {
            throw new Error(`Cannot delete client "${clientName}" because it is currently assigned to active tasks.`);
        }

        const initialLength = this.state.config.clients.length;
        this.state.config.clients = this.state.config.clients.filter(c => c.name !== clientName);

        if (this.state.config.clients.length !== initialLength) {
            if (CONFIG.useGithub && CONFIG.token) {
                await this.saveToGithub();
            } else {
                this.saveToLocal();
            }
        }
    }
}

// Mock auth
function getCurrentUser() {
    return "Mubarak"; // Hardcoded for prototype
}

const store = new DataStore();
