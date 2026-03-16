// Shared runtime config for all users. Update once here for team-wide defaults.
window.WERUNOPS_CONFIG = {
    // Default backend API base used by all browsers unless a user overrides in Settings.
    backendApiBase: 'https://werunops-api.vercel.app/api/v1',

    // Optional Firebase defaults.
    firebaseUrl: 'https://werun-ops-backoffice-default-rtdb.firebaseio.com',
    firebaseWebApiKey: '',

    // Team rollout defaults.
    allowUserEndpointConfig: false,
    showSessionOpsInDashboard: false
};
