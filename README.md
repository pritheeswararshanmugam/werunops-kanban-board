# WeRunOps - Operations Dashboard

Modern, mobile-first operations dashboard with Kanban workflow, client management, analytics, and optional backend API mode.

## Features

- Dashboard metrics and charts with activity feed.
- Kanban drag-and-drop workflow with task status transitions.
- Task list search, sort, bulk delete, and exports.
- Real-time task lock indicators and collision-safe task updates.
- Undo and redo stack for task mutations.
- Offline mode with service worker caching.
- Offline action queue with replay, failed-action retry, and discard controls.
- Presence and session reporting support when backend mode is enabled.

## Deployment Model

- Frontend deploy: GitHub Pages.
- Backend deploy: Vercel (`backend/` as Vercel root directory).
- Database: Supabase (recommended for backend persistence).

## Runtime Modes

- Local/Firebase mode: Uses local storage and optional Firebase sync.
- Backend mode: Uses `backend` FastAPI API (configure in Settings -> Backend API).

## Frontend Stack

- HTML5 and Vanilla JS.
- Tailwind CSS via CDN.
- Chart.js via CDN.
- SortableJS via CDN.
- Lucide icons via CDN.

## Local Development

1. Open `frontend/index.html` in a browser for frontend-only mode.
1. Optionally start backend API and configure its URL in Settings:

```powershell
C:/Users/sprit/OneDrive/Desktop/WeRunOps/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
C:/Users/sprit/OneDrive/Desktop/WeRunOps/.venv/Scripts/python.exe backend/scripts/run_auto_port.py
```

1. In the app, open `Settings -> Backend API` and set base URL (example: `http://127.0.0.1:9000/api/v1`).

## Automated Testing (Playwright)

Playwright E2E smoke tests are configured to start both services automatically:

- Backend API: `http://127.0.0.1:9000`
- Frontend static server: `http://127.0.0.1:4173`

### One-time setup

```powershell
npm install
npx playwright install chromium
```

### Run tests

```powershell
npm run test:e2e
```

Deterministic UI flow (clean state each run):

- Test startup restores `backend/data/state_store.json` from `backend/data/state_store.seed.json`.
- Backend test server runs in file-state mode so UI tests use the same seeded source of truth.
- Playwright UI projects are split for stability and targeted reruns:
	- `ui-bulk`
	- `ui-timing`
	- `ui-extended`

Run the consolidated stabilized UI set:

```powershell
cmd /c npx playwright test --project=ui-bulk --project=ui-timing --project=ui-extended
```

Optional modes:

```powershell
npm run test:e2e:headed
npm run test:e2e:ui
npm run test:e2e:report
```

## Production Setup (GitHub + Vercel + Supabase)

1. Run `backend/supabase_setup.sql` in Supabase SQL editor.
1. Deploy backend to Vercel with root directory `backend`.
1. Add env vars from `backend/.env.example` in Vercel.
1. Deploy frontend to GitHub Pages.
1. In the app settings, set Backend API base to:

`https://<your-vercel-backend>.vercel.app/api/v1`

## Backend Notes

Backend implementation is in `backend/` with task/client APIs, lock endpoints, session reports, and state export.

See `backend/README.md` for endpoint and run details.
