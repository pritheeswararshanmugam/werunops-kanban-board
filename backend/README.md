# WeRunOps Backend (Vercel + Firebase / Supabase Ready)

FastAPI backend for WeRunOps frontend deployed on GitHub Pages.

## Production target

- Frontend: GitHub Pages.
- Backend: Vercel (Python serverless runtime).
- Database: Firebase Realtime Database (recommended) or Supabase.

## Implemented API scope

- Auth: login, me, logout, change-password.
- Task APIs: CRUD, status patch, bulk delete, restore.
- Lock APIs: list, acquire, release with lock conflict enforcement.
- Presence APIs: set current user presence + list presence.
- Session APIs: start, heartbeat, end, list.
- Reporting APIs: session summary, dashboard metrics.
- Export APIs: sessions CSV, full state JSON.

## Storage drivers

- `firebase`: production mode using Firebase Realtime Database REST API.
- `supabase`: production mode using Supabase REST API.
- `file`: local development mode (`backend/data/state_store.json`).

Driver auto-selection (when `WERUNOPS_STATE_DRIVER` is not set):

1. If `FIREBASE_DATABASE_URL` + `FIREBASE_AUTH_SECRET` are present → `firebase`
2. Else if `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are present → `supabase`
3. Else → `file`

## Firebase Realtime Database setup

1. Go to [Firebase Console](https://console.firebase.google.com/) and open your project (`werun-ops-backoffice`).
2. Navigate to **Project Settings → Service accounts → Database secrets**.
3. Generate (or copy) the **Database secret** — this is your `FIREBASE_AUTH_SECRET`.
4. The database URL is already known: `https://werun-ops-backoffice-default-rtdb.firebaseio.com`

## Supabase setup

1. Create a Supabase project.
2. Open SQL Editor and run `backend/supabase_setup.sql`.
3. Copy `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

## Vercel deploy (backend)

1. Create a new Vercel project pointing to this repo.
1. Set project Root Directory to `backend`.
1. Vercel will use `backend/vercel.json` and `backend/api/index.py`.
1. Add environment variables from `backend/.env.example`:

**With Firebase (recommended):**

- `WERUNOPS_STATE_DRIVER=firebase`
- `FIREBASE_DATABASE_URL=https://werun-ops-backoffice-default-rtdb.firebaseio.com`
- `FIREBASE_AUTH_SECRET=<your-database-secret>`
- `FIREBASE_STATE_PATH=werunops_state`
- `CORS_ALLOW_ORIGINS=https://pritheeswararshanmugam.github.io`

**With Supabase (alternative):**

- `WERUNOPS_STATE_DRIVER=supabase`
- `SUPABASE_URL=...`
- `SUPABASE_SERVICE_ROLE_KEY=...`
- `SUPABASE_STATE_TABLE=werunops_state`
- `SUPABASE_STATE_ROW_ID=1`
- `CORS_ALLOW_ORIGINS=https://pritheeswararshanmugam.github.io`

1. Deploy and note the backend URL.

Expected API base URL format:

- `https://<your-backend>.vercel.app/api/v1`

## Frontend connection

In the app: `Settings -> Backend API`, set backend base URL to your Vercel URL (`.../api/v1`).

## Local development

```powershell
C:/Users/sprit/OneDrive/Desktop/WeRunOps/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
C:/Users/sprit/OneDrive/Desktop/WeRunOps/.venv/Scripts/python.exe backend/scripts/run_auto_port.py
```

Docs endpoint:

- `http://127.0.0.1:9000/docs`

## Smoke test

```powershell
C:/Users/sprit/OneDrive/Desktop/WeRunOps/.venv/Scripts/python.exe backend/tests/smoke_test.py
```
