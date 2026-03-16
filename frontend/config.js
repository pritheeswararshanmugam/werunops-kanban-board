// Shared runtime config for all users. Update once here for team-wide defaults.
const isLocalHost = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);

window.WERUNOPS_CONFIG = {
    // Default backend API base used by all browsers unless a user overrides in Settings.
    backendApiBase: isLocalHost
        ? 'http://127.0.0.1:9000/api/v1'
        : 'https://werunops-kanban-board-5pqv-mbfjb7o8r.vercel.app/api/v1',

    // Optional Firebase defaults.
    firebaseUrl: 'https://werun-ops-backoffice-default-rtdb.firebaseio.com',
    firebaseWebApiKey: '',

    // Team rollout defaults.
    allowUserEndpointConfig: false,
    showSessionOpsInDashboard: false
};
