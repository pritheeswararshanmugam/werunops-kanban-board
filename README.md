# BackOffice Pro - Operations Dashboard

A modern, intuitive, mobile-first web application for managing back-office operations and tasks.

## 🚀 Features

- **Dashboard Intelligence**: Visual metrics, Chart.js graphs, and recent activity tracking.
- **Interactive Kanban Board**: Drag-and-drop tasks across statuses natively.
- **Detailed Task List**: Sort, filter, and search through all operational data.
- **Today's Focus View**: Prioritizes overdue and due-today tasks.
- **Zero-Cost Data Storage**: Uses the GitHub REST API to persist state in a JSON file without a backend server, falling back to `localStorage` for seamless local development.

## 🛠 Technology Stack

- **HTML5 & Vanilla JS (ES6+)**
- **Tailwind CSS** (via CDN for zero-build rapid styling)
- **Chart.js** (via CDN)
- **SortableJS** (via CDN for Kanban DND)
- **Lucide Icons** (via CDN)

## 💻 Local Setup & Development

You can run this project locally without any complex build tools.

1. Clone or download this directory.
2. Simply open `index.html` in your favorite modern browser.
3. By default, the app uses `localStorage` for its data state, so you can immediately begin creating tasks, moving them around, and seeing the UI react.

## 🌐 Deploying to GitHub Pages (Zero-Cost Hosting)

1. Create a new repository on GitHub (e.g., `backoffice-dashboard`).
2. Upload these files (`index.html`, `styles.css`, `app.js`, `github-api.js`, `README.md`) to the main branch.
3. Go to your repository **Settings** > **Pages**.
4. Set the Source to `Deploy from a branch` and select `main` (or master).
5. Your app will be live at `https://[your-username].github.io/[repo-name]`.

### Enabling Permanent GitHub Storage

To allow the deployed application to save data to the repository:

1. Generate a **Personal Access Token (PAT)** in GitHub with `repo` scopes.
2. Open `github-api.js` and modify the `CONFIG` object:
   ```javascript
   const CONFIG = {
       useGithub: true, // Switch to true
       repo: 'username/backoffice-dashboard', // your actual repo
       branch: 'main',
       token: 'ghp_XXXXXXXXXXX', // Provide token securely (ideally via a login prompt in V2)
       dataFile: 'data/state.json'
   };
   ```
3. Commit the changes. The app will now read/write state continuously to `data/state.json`.

*(Note: Storing a PAT directly in client-side code is a temporary workaround for personal use. For production with multiple users, implement GitHub OAuth login.)*
