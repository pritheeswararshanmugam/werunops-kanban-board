# WeRunOps Backend (Vercel + Supabase Ready)

FastAPI backend for WeRunOps frontend deployed on GitHub Pages.

## Production target

- Frontend: GitHub Pages.
- Backend: Vercel (Python serverless runtime).
- Database: Supabase (recommended for persistent backend state in cloud).

## Implemented API scope

- Auth: login, me, logout, change-password.
- Task APIs: CRUD, status patch, bulk delete, restore.
- Lock APIs: list, acquire, release with lock conflict enforcement.
- Presence APIs: set current user presence + list presence.
- Session APIs: start, heartbeat, end, list.
- Reporting APIs: session summary, dashboard metrics.
- Export APIs: sessions CSV, full state JSON.

## Storage drivers

- `supabase`: production mode for Vercel deploys.
- `file`: local development mode (`backend/data/state_store.json`).

Driver selection:

- If `WERUNOPS_STATE_DRIVER=supabase`, backend uses Supabase REST.
- If `WERUNOPS_STATE_DRIVER=file`, backend uses local JSON file.
- If not set, backend auto-selects `supabase` when Supabase env vars exist, else `file`.

## Supabase setup

1. Create a Supabase project.
2. Open SQL Editor and run `backend/supabase_setup.sql`.
3. Copy `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

## Vercel deploy (backend)

1. Create a new Vercel project pointing to this repo.
1. Set project Root Directory to `backend`.
1. Vercel will use `backend/vercel.json` and `backend/api/index.py`.
1. Add environment variables from `backend/.env.example`:

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
