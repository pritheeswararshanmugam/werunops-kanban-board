// Shared runtime config for all users. Update once here for team-wide defaults.
const isLocalHost = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);

window.WERUNOPS_CONFIG = {
    // Default backend API base used by all browsers unless a user overrides in Settings.
<<<<<<< HEAD
    backendApiBase: isLocalHost
        ? 'http://127.0.0.1:9000/api/v1'
        : 'https://werunops-kanban-board-5pqv.vercel.app/api/v1',
=======
    backendApiBase: 'https://werunops-api.vercel.app/api/v1',
>>>>>>> 60024e3cc488c7416e83caeb48f5ed6eba82baed

    // Optional Firebase defaults.
    firebaseUrl: 'https://werun-ops-backoffice-default-rtdb.firebaseio.com',
    firebaseWebApiKey: '',

    // Team rollout defaults.
    allowUserEndpointConfig: true,
    showSessionOpsInDashboard: false
};
