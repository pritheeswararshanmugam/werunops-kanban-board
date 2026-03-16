from __future__ import annotations

import uuid
import os
import json
from datetime import UTC, datetime, timedelta
from typing import Any, cast

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, PlainTextResponse

from app.models import (
    ActivityEntry,
    APIResponse,
    APIMeta,
    BulkDeleteRequest,
    ChangePasswordRequest,
    ClientCreate,
    ClientOut,
    ClientUpdate,
    LoginRequest,
    LoginResponse,
    PresenceMeRequest,
    PresenceOut,
    SessionHeartbeatRequest,
    SessionOut,
    SessionStartRequest,
    TaskCreate,
    TaskLockRequest,
    TaskOut,
    TaskRestoreRequest,
    TaskStatusPatch,
    TaskUpdate,
    UserProfile,
)
from app.store import ConflictError, UnauthorizedError, store

app = FastAPI(title="WeRunOps Backend API", version="1.0.0")

cors_origins_raw = os.getenv("CORS_ALLOW_ORIGINS", "*").strip()
allow_origins = [item.strip() for item in cors_origins_raw.split(",") if item.strip()] or ["*"]
allow_credentials = allow_origins != ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)


def build_meta(request: Request) -> APIMeta:
    return APIMeta(
        requestId=request.headers.get("x-request-id", str(uuid.uuid4())),
        timestamp=datetime.now(UTC),
    )


def build_response(data: object, request: Request) -> APIResponse:
    return APIResponse(data=data, meta=build_meta(request))


def parse_bearer(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    return authorization.removeprefix("Bearer ").strip()


def current_user(authorization: str | None = Header(default=None, alias="Authorization")) -> UserProfile:
    token = parse_bearer(authorization)
    try:
        return store.user_from_token(token)
    except UnauthorizedError as error:
        raise HTTPException(status_code=401, detail=str(error)) from error


def ensure_task_not_locked_by_other(task_id: int, user: UserProfile) -> None:
    lock = store.lock_for_task(task_id)
    if lock and lock.lockedBy != user.username:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "TASK_LOCKED",
                "taskId": task_id,
                "lockedBy": lock.lockedBy,
                "lockedByName": lock.lockedByName,
                "expiresAt": lock.expiresAt.isoformat(),
            },
        )


def current_admin_user(authorization: str | None = Header(default=None, alias="Authorization")) -> UserProfile:
    token = parse_bearer(authorization)

    try:
        user = store.user_from_token(token)
    except UnauthorizedError as error:
        raise HTTPException(status_code=401, detail=str(error)) from error

    if user.role.lower() != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")

    return user


def admin_log_event(admin: UserProfile, action: str, details: dict[str, Any] | None = None) -> None:
    entry: dict[str, Any] = {
        "id": f"audit_{uuid.uuid4().hex[:10]}",
        "timestamp": datetime.now(UTC).isoformat(),
        "admin": admin.username,
        "adminName": admin.name,
        "action": action,
        "details": details or {},
    }
    store.admin_audit_logs.insert(0, entry)
    if len(store.admin_audit_logs) > 1000:
        store.admin_audit_logs = store.admin_audit_logs[:1000]
    store.save_state()


@app.get("/")
def root(request: Request):
    return build_response(
        {
            "service": "WeRunOps Backend API",
            "version": "1.0.0",
            "docs": "/docs",
            "health": "/api/v1/health",
        },
        request,
    )


@app.get("/api/v1/health")
def health(request: Request):
    return build_response({"status": "ok"}, request)

@app.post("/api/v1/testing/reset-state", response_model=APIResponse)
def testing_reset_state(request: Request):
    if store.state_driver != "file":
        raise HTTPException(status_code=400, detail="State reset is supported only in file mode")

    seed_path = store.state_file.with_name("state_store.seed.json")
    if not seed_path.exists():
        raise HTTPException(status_code=404, detail="Seed state file not found")

    store.state_file.write_text(seed_path.read_text(encoding="utf-8"), encoding="utf-8")
    store._load_state()
    return build_response(
        {
            "reset": True,
            "tasks": len(store.tasks),
            "clients": len(store.clients),
        },
        request,
    )


@app.get("/api/v1")
def api_root(request: Request):
    return build_response(
        {
            "service": "WeRunOps Backend API",
            "version": "1.0.0",
            "health": "/api/v1/health",
            "docs": "/docs",
            "auth": "/api/v1/auth/login",
        },
        request,
    )


@app.get("/api/v1/admin/portal", response_class=HTMLResponse)
def admin_portal(
    _: UserProfile = Depends(current_admin_user),
    authorization: str | None = Header(default=None, alias="Authorization"),
):
        now = datetime.now(UTC)
        bootstrap: dict[str, Any] = {
                "generatedAt": now.isoformat(),
                "sessions": [item.model_dump(mode="json") for item in sorted(store.sessions.values(), key=lambda x: x.loginTime, reverse=True)[:2000]],
                "tasks": [item.model_dump(mode="json") for item in sorted(store.tasks.values(), key=lambda x: x.updatedAt, reverse=True)[:2000]],
                "presence": [item.model_dump(mode="json") for item in store.presence.values()],
                "users": [
                        {
                                "username": value.get("username"),
                                "name": value.get("name"),
                                "role": value.get("role"),
                                "initials": value.get("initials"),
                        }
                        for value in store.users.values()
                ],
                "savedFilters": store.saved_filter_sets,
                "automationRules": store.automation_rules,
        }
        bootstrap_json = json.dumps(bootstrap).replace("</", "<\\/")

        html = """
<!doctype html>
<html lang='en'>
<head>
    <meta charset='utf-8' />
    <meta name='viewport' content='width=device-width, initial-scale=1' />
    <title>WeRunOps Admin Operations Portal</title>
    <style>
        :root { --bg:#f6f8fc; --ink:#1f2937; --muted:#6b7280; --line:#e5e7eb; --panel:#ffffff; --brand:#0f766e; --warn:#b45309; --danger:#b91c1c; }
        * { box-sizing: border-box; }
        body { margin:0; padding:18px; font-family: Segoe UI, Arial, sans-serif; color: var(--ink); background: var(--bg); }
        h1 { margin:0; font-size: 30px; }
        .muted { color: var(--muted); margin-top: 6px; }
        .tabs { margin-top: 12px; display:flex; gap:8px; flex-wrap:wrap; }
        .tab { border:1px solid #d1d5db; background:#fff; border-radius:8px; padding:8px 12px; cursor:pointer; font-weight:600; }
        .tab.active { background:var(--brand); color:#fff; border-color:var(--brand); }
        .section { display:none; margin-top: 12px; }
        .section.active { display:block; }
        .panel { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:12px; margin-top:10px; }
        .row { display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end; }
        .row.center { align-items:center; }
        .field { display:flex; flex-direction:column; gap:5px; min-width:170px; }
        .field label { font-size:12px; color:var(--muted); font-weight:600; }
        .field input,.field select,.field textarea { border:1px solid #d1d5db; border-radius:8px; padding:8px; font-size:14px; }
        .btn { border:1px solid #d1d5db; background:#fff; border-radius:8px; padding:8px 12px; min-height:36px; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; }
        .btn:hover { background:#f9fafb; }
        .btn:disabled { opacity:0.55; cursor:not-allowed; }
        .btn.primary { background:var(--brand); color:#fff; border-color:var(--brand); }
        .btn.primary:hover { background:#0c615a; }
        .btn.warn { background:#fff7ed; border-color:#fdba74; color:var(--warn); }
        .btn.danger { background:#fef2f2; border-color:#fecaca; color:var(--danger); }
        .cards { display:grid; grid-template-columns: repeat(auto-fit,minmax(160px,1fr)); gap:8px; margin-top:10px; }
        .card { background:#fff; border:1px solid var(--line); border-radius:10px; padding:10px; }
        .card small { color:var(--muted); text-transform:uppercase; font-size:11px; }
        .card div { font-size:24px; font-weight:700; margin-top:4px; }
        .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
        .table-wrap { max-height:340px; overflow:auto; border:1px solid var(--line); border-radius:10px; }
        table { width:100%; border-collapse:collapse; font-size:13px; }
        th,td { border:1px solid var(--line); padding:7px; text-align:left; }
        th { background:#f9fafb; position:sticky; top:0; }
        .pill { display:inline-block; border-radius:999px; padding:2px 8px; font-size:12px; border:1px solid #d1d5db; }
        .heatmap { display:grid; grid-template-columns:repeat(12,1fr); gap:4px; }
        .heat { height:20px; border-radius:4px; }
        canvas { width:100%; max-width:100%; height:260px; border:1px solid var(--line); border-radius:10px; background:#fff; }
        .notice { margin-top:10px; padding:10px 12px; border-radius:10px; border:1px solid #fecaca; background:#fef2f2; color:#991b1b; display:none; }
        @media (max-width:1000px){ .grid2 { grid-template-columns:1fr; } }
    </style>
</head>
<body>
    <h1>WeRunOps Admin Operations Portal</h1>
    <p class='muted'>Operations dashboard for sessions, tasks, users, automation rules, and audit activity.</p>
    <div class='notice' id='global-error'></div>

    <div class='tabs' id='tabs'></div>

    <section id='sec-overview' class='section active'>
        <div class='panel'>
            <div class='row'>
                <div class='field'><label>User</label><select id='flt-user'><option value=''>All users</option></select></div>
                <div class='field'><label>Session From</label><input id='flt-from' type='date'/></div>
                <div class='field'><label>Session To</label><input id='flt-to' type='date'/></div>
                <div class='field' style='min-width:220px'><label>Session Search</label><input id='flt-session-search' type='text' placeholder='User/device/session id'/></div>
                <button class='btn primary' id='btn-apply'>Apply</button>
                <button class='btn' id='btn-reset'>Reset</button>
            </div>
            <div class='row' style='margin-top:10px'>
                <div class='field' style='min-width:220px'><label>Save Current Session Filter</label><input id='save-filter-name' type='text' placeholder='My filter name'/></div>
                <button class='btn' id='btn-save-filter'>Save Filter</button>
                <div class='field' style='min-width:220px'><label>Saved Filters</label><select id='saved-filters-select'><option value=''>Select filter</option></select></div>
                <button class='btn' id='btn-load-filter'>Load Saved</button>
                <button class='btn danger' id='btn-delete-filter'>Delete Saved</button>
            </div>
        </div>
        <div class='cards'>
            <div class='card'><small>Filtered Sessions</small><div id='m-sessions'>0</div></div>
            <div class='card'><small>Duration Hours</small><div id='m-hours'>0</div></div>
            <div class='card'><small>Active Ratio %</small><div id='m-active-ratio'>0</div></div>
            <div class='card'><small>Open Tasks</small><div id='m-open'>0</div></div>
            <div class='card'><small>Completed Tasks</small><div id='m-complete'>0</div></div>
            <div class='card'><small>Efficiency Score</small><div id='m-eff'>0</div></div>
        </div>
        <div class='grid2'>
            <div class='panel'>
                <h3>Daily Hours by User</h3>
                <canvas id='chart-hours' width='700' height='260'></canvas>
            </div>
            <div class='panel'>
                <h3>Peak Activity Heatmap</h3>
                <div id='heatmap' class='heatmap'></div>
            </div>
        </div>
        <div class='grid2'>
            <div class='panel'>
                <h3>Session Summary by User</h3>
                <div class='table-wrap'><table><thead><tr><th>User</th><th>Sessions</th><th>Duration</th><th>Active</th><th>Idle</th><th>Efficiency</th></tr></thead><tbody id='tbl-summary'></tbody></table></div>
            </div>
            <div class='panel'>
                <h3>Live Monitoring & Alerts</h3>
                <div class='row center'>
                    <div class='pill' id='ticker-online'>Online: 0</div>
                    <div class='pill' id='ticker-hours'>Today Hours: 0</div>
                    <div class='pill' id='ticker-tasks'>Done Today: 0</div>
                    <button class='btn' id='btn-live-refresh'>Refresh Now</button>
                </div>
                <div class='table-wrap' style='margin-top:10px'><table><thead><tr><th>Alert</th><th>Severity</th><th>Details</th><th>When</th></tr></thead><tbody id='tbl-alerts'></tbody></table></div>
            </div>
        </div>
    </section>

    <section id='sec-sessions' class='section'>
        <div class='panel'>
            <div class='row'>
                <button class='btn' id='btn-export-csv'>Export Sessions CSV</button>
                <button class='btn' id='btn-export-json'>Export Filtered JSON</button>
                <button class='btn' id='btn-report-weekly'>Weekly Team Summary</button>
                <button class='btn' id='btn-report-monthly'>Monthly Attendance</button>
            </div>
            <div class='table-wrap' style='margin-top:10px'><table><thead><tr><th>ID</th><th>User</th><th>Login</th><th>Logout</th><th>Duration</th><th>Active</th><th>Idle</th><th>Device</th></tr></thead><tbody id='tbl-sessions'></tbody></table></div>
        </div>
    </section>

    <section id='sec-tasks' class='section'>
        <div class='panel'>
            <h3>Task Operations</h3>
            <div class='row'>
                <div class='field'><label>Task Status Filter</label><select id='task-status-filter'><option value=''>All statuses</option></select></div>
                <div class='field' style='min-width:260px'><label>Task Search</label><input id='task-search-filter' type='text' placeholder='Task/client/staff'/></div>
                <button class='btn' id='btn-task-apply'>Apply Task Filter</button>
                <button class='btn' id='btn-task-reset'>Reset Task Filter</button>
            </div>
            <div class='row' style='margin-top:10px'>
                <div class='field'><label>Task IDs (comma separated)</label><input id='bulk-task-ids' type='text' placeholder='1,2,3'/></div>
                <div class='field'><label>New Status</label><select id='bulk-status'><option value=''>No change</option></select></div>
                <div class='field'><label>Reassign Staff</label><input id='bulk-staff' type='text' placeholder='Mubarak'/></div>
                <button class='btn primary' id='btn-bulk-update'>Apply Bulk Update</button>
            </div>
            <div class='row' style='margin-top:10px'>
                <div class='field' style='min-width:120px'><label>Task ID</label><input id='comment-task-id' type='number'/></div>
                <div class='field' style='min-width:300px'><label>Add Comment</label><textarea id='comment-text' rows='2'></textarea></div>
                <button class='btn' id='btn-add-comment'>Add Comment</button>
                <button class='btn' id='btn-view-comments'>View Comments</button>
            </div>
            <div class='table-wrap' style='margin-top:10px'><table><thead><tr><th>ID</th><th>Client</th><th>Task</th><th>Staff</th><th>Status</th><th>Due</th></tr></thead><tbody id='tbl-tasks'></tbody></table></div>
            <div class='table-wrap' style='margin-top:10px'><table><thead><tr><th>Task</th><th>Comment</th><th>By</th><th>Time</th></tr></thead><tbody id='tbl-comments'></tbody></table></div>
        </div>
    </section>

    <section id='sec-users' class='section'>
        <div class='panel'>
            <h3>User Management & Profiles</h3>
            <div class='table-wrap'><table><thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Sessions</th><th>Total Hours</th><th>Update Role</th></tr></thead><tbody id='tbl-users'></tbody></table></div>
        </div>
    </section>

    <section id='sec-automation' class='section'>
        <div class='panel'>
            <h3>Automation & Scheduled Actions</h3>
            <div class='row'>
                <button class='btn' id='btn-refresh-rules'>Refresh Rules</button>
                <button class='btn warn' id='btn-run-actions'>Run Scheduled Actions Now</button>
            </div>
            <div class='table-wrap' style='margin-top:10px'><table><thead><tr><th>ID</th><th>Name</th><th>Trigger</th><th>Action</th><th>Enabled</th><th>Toggle</th></tr></thead><tbody id='tbl-rules'></tbody></table></div>
        </div>
    </section>

    <section id='sec-compliance' class='section'>
        <div class='panel'>
            <h3>Compliance & Audit</h3>
            <div class='row'>
                <button class='btn' id='btn-refresh-audit'>Refresh Audit</button>
                <button class='btn' id='btn-export-audit'>Export Audit JSON</button>
            </div>
            <div class='table-wrap' style='margin-top:10px'><table><thead><tr><th>Time</th><th>Admin</th><th>Action</th><th>Details</th></tr></thead><tbody id='tbl-audit'></tbody></table></div>
        </div>
    </section>

    <script id='portal-data' type='application/json'>__BOOTSTRAP_JSON__</script>
    <script>
        window.__ADMIN_TOKEN__ = '__WERUNOPS_ADMIN_TOKEN__';
        const RAW = JSON.parse(document.getElementById('portal-data').textContent);
        const API_BASE = '/api/v1/admin';
        const state = { user:'', from:'', to:'', sessionSearch:'', taskStatus:'', taskSearch:'' };
        const tabs = [
            ['overview','Overview'], ['sessions','Sessions & Reports'], ['tasks','Task Ops'], ['users','Users'], ['automation','Automation'], ['compliance','Compliance']
        ];
        const el = (id) => document.getElementById(id);
        const toNum = (v) => Number(v || 0);
        const fmt = (v) => v ? new Date(v).toLocaleString() : '-';
        function esc(v){ return String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

        function showError(message){
            const node = el('global-error');
            if (!node) return;
            node.textContent = message;
            node.style.display = 'block';
        }

        function clearError(){
            const node = el('global-error');
            if (!node) return;
            node.textContent = '';
            node.style.display = 'none';
        }

        async function apiFetch(path, opts = {}) {
            const res = await fetch(path, {
                ...opts,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${window.__ADMIN_TOKEN__}`,
                    ...(opts.headers || {})
                }
            });
            if (!res.ok) {
                if (res.status === 401 || res.status === 403) {
                    showError('Admin session is missing/expired. Re-open portal from dashboard after logging in again.');
                } else {
                    showError(`Request failed (${res.status}).`);
                }
                throw new Error(`API ${res.status}`);
            }
            clearError();
            return res;
        }

        function initTabs(){
            const host = el('tabs');
            host.innerHTML = tabs.map(([id, label], i) => `<button class='tab ${i===0?'active':''}' data-sec='${id}'>${label}</button>`).join('');
            host.addEventListener('click', (e) => {
                const btn = e.target.closest('.tab');
                if (!btn) return;
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                btn.classList.add('active');
                document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
                el(`sec-${btn.dataset.sec}`).classList.add('active');
            });
        }

        function filterSessions(){
            return (RAW.sessions || []).filter(s => {
                if (state.user && s.username !== state.user) return false;
                const login = s.loginTime ? new Date(s.loginTime) : null;
                if (state.from && login && login < new Date(state.from + 'T00:00:00')) return false;
                if (state.to && login && login > new Date(state.to + 'T23:59:59')) return false;
                const q = state.sessionSearch.toLowerCase();
                if (q) {
                    const hay = `${String(s.id || '')} ${String(s.username || '')} ${String(s.device || '')}`.toLowerCase();
                    if (!hay.includes(q)) return false;
                }
                return true;
            });
        }

        function filterTasks(){
            const q = state.taskSearch.toLowerCase();
            return (RAW.tasks || []).filter(t => {
                if (state.taskStatus && t.status !== state.taskStatus) return false;
                if (!q) return true;
                return String(t.task || '').toLowerCase().includes(q) || String(t.client || '').toLowerCase().includes(q) || String(t.staff || '').toLowerCase().includes(q);
            });
        }

        function renderCharts(sessions){
            const byDayUser = {};
            sessions.forEach(s => {
                const d = (s.loginTime || '').slice(0,10);
                const k = `${d}|${s.username}`;
                byDayUser[k] = (byDayUser[k] || 0) + toNum(s.durationSeconds);
            });
            const userTotals = {};
            Object.keys(byDayUser).forEach(k => {
                const user = k.split('|')[1];
                userTotals[user] = (userTotals[user] || 0) + byDayUser[k];
            });
            const canvas = el('chart-hours');
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0,0,canvas.width,canvas.height);
            const labels = Object.keys(userTotals);
            const vals = labels.map(u => userTotals[u] / 3600);
            const max = Math.max(1, ...vals);
            labels.forEach((u, i) => {
                const y = 20 + i * 35;
                const w = Math.round((vals[i] / max) * (canvas.width - 170));
                ctx.fillStyle = '#0f766e';
                ctx.fillRect(130, y, w, 20);
                ctx.fillStyle = '#1f2937';
                ctx.fillText(u, 10, y + 14);
                ctx.fillText(`${vals[i].toFixed(1)}h`, 135 + w, y + 14);
            });

            const heat = {};
            sessions.forEach(s => {
                const d = new Date(s.loginTime || Date.now());
                const key = `${d.getDay()}-${d.getHours()}`;
                heat[key] = (heat[key] || 0) + toNum(s.durationSeconds);
            });
            const values = Object.values(heat);
            const hmax = Math.max(1, ...values);
            const heatEl = el('heatmap');
            heatEl.innerHTML = '';
            for (let day = 0; day < 7; day++) {
                for (let hr = 0; hr < 12; hr++) {
                    const hour = hr * 2;
                    const v = heat[`${day}-${hour}`] || 0;
                    const alpha = Math.max(0.08, v / hmax);
                    const cell = document.createElement('div');
                    cell.className = 'heat';
                    cell.style.background = `rgba(15,118,110,${alpha.toFixed(2)})`;
                    cell.title = `Day ${day}, ${hour}:00 => ${Math.round(v/60)} min`;
                    heatEl.appendChild(cell);
                }
            }
        }

        function renderOverview(){
            const sessions = filterSessions();
            const tasks = filterTasks();
            const totalDuration = sessions.reduce((sum, s) => sum + toNum(s.durationSeconds), 0);
            const activeDuration = sessions.reduce((sum, s) => sum + toNum(s.activeSeconds), 0);
            const completed = tasks.filter(t => t.status === 'Completed').length;
            const open = tasks.filter(t => t.status !== 'Completed').length;
            const eff = totalDuration > 0 ? ((completed * 3600 + activeDuration) / Math.max(1,totalDuration)).toFixed(2) : '0.00';

            el('m-sessions').textContent = String(sessions.length);
            el('m-hours').textContent = (totalDuration / 3600).toFixed(1);
            el('m-active-ratio').textContent = totalDuration > 0 ? ((activeDuration/totalDuration)*100).toFixed(0) : '0';
            el('m-open').textContent = String(open);
            el('m-complete').textContent = String(completed);
            el('m-eff').textContent = eff;

            const byUser = {};
            sessions.forEach(s => {
                const k = s.username || 'Unknown';
                if (!byUser[k]) byUser[k] = { c:0, d:0, a:0, i:0 };
                byUser[k].c += 1;
                byUser[k].d += toNum(s.durationSeconds);
                byUser[k].a += toNum(s.activeSeconds);
                byUser[k].i += toNum(s.idleSeconds);
            });
            el('tbl-summary').innerHTML = Object.entries(byUser)
                .sort((a,b)=>b[1].d-a[1].d)
                .map(([u,v])=>`<tr><td>${esc(u)}</td><td>${v.c}</td><td>${v.d}</td><td>${v.a}</td><td>${v.i}</td><td>${((v.a/Math.max(1,v.d))*100).toFixed(0)}%</td></tr>`)
                .join('') || `<tr><td colspan='6' class='empty'>No data</td></tr>`;

            renderCharts(sessions);
        }

        function renderSessionsAndTasks(){
            const sessions = filterSessions();
            const tasks = filterTasks();
            el('tbl-sessions').innerHTML = sessions.slice(0,400).map(s=>`<tr><td>${esc(s.id)}</td><td>${esc(s.username)}</td><td>${fmt(s.loginTime)}</td><td>${fmt(s.logoutTime)}</td><td>${toNum(s.durationSeconds)}</td><td>${toNum(s.activeSeconds)}</td><td>${toNum(s.idleSeconds)}</td><td>${esc(s.device || '-')}</td></tr>`).join('') || `<tr><td colspan='8' class='empty'>No sessions</td></tr>`;
            el('tbl-tasks').innerHTML = tasks.slice(0,500).map(t=>`<tr><td>${t.id}</td><td>${esc(t.client)}</td><td>${esc(t.task)}</td><td>${esc(t.staff)}</td><td>${esc(t.status)}</td><td>${esc(t.dueDate || '-')}</td></tr>`).join('') || `<tr><td colspan='6' class='empty'>No tasks</td></tr>`;
        }

        async function renderMonitoring(){
            try {
                const res = await apiFetch(`${API_BASE}/alerts`);
                const payload = await res.json();
                const alerts = payload.data.alerts || [];
                el('tbl-alerts').innerHTML = alerts.map(a=>`<tr><td>${esc(a.title)}</td><td>${esc(a.severity)}</td><td>${esc(a.details)}</td><td>${fmt(a.timestamp)}</td></tr>`).join('') || `<tr><td colspan='4' class='empty'>No active alerts</td></tr>`;
                el('ticker-online').textContent = `Online: ${payload.data.onlineUsers}`;
                el('ticker-hours').textContent = `Today Hours: ${(payload.data.todayDurationSeconds/3600).toFixed(1)}`;
                el('ticker-tasks').textContent = `Done Today: ${payload.data.completedToday}`;
            } catch (e) { }
        }

        async function renderUsers(){
            const sessions = filterSessions();
            const byUser = {};
            sessions.forEach(s => {
                const k = s.username || 'Unknown';
                if (!byUser[k]) byUser[k] = { sessions:0, duration:0 };
                byUser[k].sessions += 1;
                byUser[k].duration += toNum(s.durationSeconds);
            });

            let users = [];
            try {
                const res = await apiFetch(`${API_BASE}/users`);
                users = (await res.json()).data || [];
            } catch (e) {
                el('tbl-users').innerHTML = `<tr><td colspan='6' class='empty'>Unable to load users.</td></tr>`;
                return;
            }
            el('tbl-users').innerHTML = users.map(u => {
                const perf = byUser[u.username] || { sessions: 0, duration: 0 };
                return `<tr><td>${esc(u.username)}</td><td>${esc(u.name)}</td><td>${esc(u.role)}</td><td>${perf.sessions}</td><td>${(perf.duration/3600).toFixed(1)}</td><td><select data-user='${esc(u.username)}' class='role-edit'><option ${u.role==='Admin'?'selected':''}>Admin</option><option ${u.role==='Manager'?'selected':''}>Manager</option><option ${u.role==='User'?'selected':''}>User</option></select> <button class='btn role-save' data-user='${esc(u.username)}'>Save</button></td></tr>`;
            }).join('') || `<tr><td colspan='6' class='empty'>No users</td></tr>`;
        }

        async function renderAutomation(){
            let rules = [];
            try {
                const res = await apiFetch(`${API_BASE}/automation-rules`);
                rules = (await res.json()).data || [];
            } catch (e) {
                el('tbl-rules').innerHTML = `<tr><td colspan='6' class='empty'>Unable to load rules.</td></tr>`;
                return;
            }
            el('tbl-rules').innerHTML = rules.map(r => `<tr><td>${esc(r.id)}</td><td>${esc(r.name)}</td><td>${esc(r.trigger)}</td><td>${esc(r.action)}</td><td>${r.enabled ? 'Yes' : 'No'}</td><td><button class='btn toggle-rule' data-rule='${esc(r.id)}'>Toggle</button></td></tr>`).join('') || `<tr><td colspan='6' class='empty'>No rules</td></tr>`;
        }

        async function renderAudit(){
            let logs = [];
            try {
                const res = await apiFetch(`${API_BASE}/audit-logs`);
                logs = (await res.json()).data || [];
            } catch (e) {
                el('tbl-audit').innerHTML = `<tr><td colspan='4' class='empty'>Unable to load audit logs.</td></tr>`;
                return;
            }
            el('tbl-audit').innerHTML = logs.map(l => `<tr><td>${fmt(l.timestamp)}</td><td>${esc(l.adminName || l.admin)}</td><td>${esc(l.action)}</td><td>${esc(JSON.stringify(l.details || {}))}</td></tr>`).join('') || `<tr><td colspan='4' class='empty'>No audit records</td></tr>`;
        }

        async function saveFilter(){
            const name = (el('save-filter-name').value || '').trim();
            if (!name) return;
            await apiFetch(`${API_BASE}/filters`, { method:'POST', body: JSON.stringify({ name, filters: state }) });
            el('save-filter-name').value = '';
            await refreshSavedFilterOptions();
            alert('Filter saved.');
        }

        async function loadSavedFilter(){
            const selectedName = el('saved-filters-select').value;
            if (!selectedName) return;
            const res = await apiFetch(`${API_BASE}/filters`);
            const items = (await res.json()).data || [];
            const match = items.find(i => i.name === selectedName);
            if (!match) return;
            Object.assign(state, match.filters || {});
            el('flt-user').value = state.user || '';
            el('flt-from').value = state.from || '';
            el('flt-to').value = state.to || '';
            el('flt-session-search').value = state.sessionSearch || '';
            el('task-status-filter').value = state.taskStatus || '';
            el('task-search-filter').value = state.taskSearch || '';
            applyFilters();
        }

        async function deleteSavedFilter(){
            const selectedName = el('saved-filters-select').value;
            if (!selectedName) return;
            await apiFetch(`${API_BASE}/filters/${encodeURIComponent(selectedName)}`, { method:'DELETE' });
            await refreshSavedFilterOptions();
        }

        async function refreshSavedFilterOptions(){
            const select = el('saved-filters-select');
            if (!select) return;
            const previous = select.value;
            select.innerHTML = `<option value=''>Select filter</option>`;
            const res = await apiFetch(`${API_BASE}/filters`);
            const items = (await res.json()).data || [];
            items.forEach(item => {
                const option = document.createElement('option');
                option.value = item.name;
                option.textContent = item.name;
                select.appendChild(option);
            });
            if (previous) select.value = previous;
        }

        function exportFilteredJson(){
            const payload = { generatedAt: RAW.generatedAt, filters: state, sessions: filterSessions(), tasks: filterTasks() };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = `werunops-admin-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(url);
        }

        function exportSessionsCsv(){
            const sessions = filterSessions();
            const header = 'id,username,loginTime,logoutTime,durationSeconds,activeSeconds,idleSeconds\n';
            const body = sessions.map(s => [s.id, s.username, s.loginTime, s.logoutTime || '', toNum(s.durationSeconds), toNum(s.activeSeconds), toNum(s.idleSeconds)]
                .map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
            const blob = new Blob([header + body], { type:'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = `werunops-sessions-${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(url);
        }

        async function applyFilters(){
            state.user = el('flt-user').value;
            state.from = el('flt-from').value;
            state.to = el('flt-to').value;
            state.sessionSearch = el('flt-session-search').value || '';
            state.taskStatus = el('task-status-filter').value;
            state.taskSearch = el('task-search-filter').value || '';
            renderOverview();
            renderSessionsAndTasks();
            await renderUsers();
            await renderMonitoring();
        }

        function bindActions(){
            el('btn-apply').addEventListener('click', applyFilters);
            el('btn-reset').addEventListener('click', () => {
                state.user=''; state.from=''; state.to=''; state.sessionSearch='';
                el('flt-user').value=''; el('flt-from').value=''; el('flt-to').value=''; el('flt-session-search').value='';
                applyFilters();
            });
            el('btn-task-apply').addEventListener('click', applyFilters);
            el('btn-task-reset').addEventListener('click', () => {
                state.taskStatus=''; state.taskSearch='';
                el('task-status-filter').value=''; el('task-search-filter').value='';
                applyFilters();
            });
            el('btn-save-filter').addEventListener('click', saveFilter);
            el('btn-load-filter').addEventListener('click', loadSavedFilter);
            el('btn-delete-filter').addEventListener('click', deleteSavedFilter);
            el('btn-export-json').addEventListener('click', exportFilteredJson);
            el('btn-export-csv').addEventListener('click', exportSessionsCsv);
            el('btn-live-refresh').addEventListener('click', renderMonitoring);
            el('btn-report-weekly').addEventListener('click', async () => { const r = await apiFetch(`${API_BASE}/reports/weekly-summary`); alert(JSON.stringify((await r.json()).data, null, 2)); });
            el('btn-report-monthly').addEventListener('click', async () => { const r = await apiFetch(`${API_BASE}/reports/monthly-attendance`); alert(JSON.stringify((await r.json()).data, null, 2)); });
            el('btn-bulk-update').addEventListener('click', async () => {
                const taskIds = String(el('bulk-task-ids').value || '').split(',').map(v => parseInt(v.trim(), 10)).filter(v => Number.isFinite(v));
                const status = el('bulk-status').value || null;
                const staff = (el('bulk-staff').value || '').trim() || null;
                await apiFetch(`${API_BASE}/tasks/bulk-update`, { method:'POST', body: JSON.stringify({ taskIds, status, staff }) });
                alert('Bulk update complete.');
                location.reload();
            });
            el('btn-add-comment').addEventListener('click', async () => {
                const taskId = parseInt(el('comment-task-id').value, 10);
                const text = (el('comment-text').value || '').trim();
                if (!Number.isFinite(taskId) || !text) return;
                await apiFetch(`${API_BASE}/tasks/${taskId}/comments`, { method:'POST', body: JSON.stringify({ comment: text }) });
                el('comment-text').value = '';
                alert('Comment added.');
            });
            el('btn-view-comments').addEventListener('click', async () => {
                const taskId = parseInt(el('comment-task-id').value, 10);
                if (!Number.isFinite(taskId)) return;
                const res = await apiFetch(`${API_BASE}/tasks/${taskId}/comments`);
                const rows = (await res.json()).data || [];
                el('tbl-comments').innerHTML = rows.map(c => `<tr><td>${taskId}</td><td>${esc(c.comment)}</td><td>${esc(c.user)}</td><td>${fmt(c.timestamp)}</td></tr>`).join('') || `<tr><td colspan='4' class='empty'>No comments</td></tr>`;
            });
            el('btn-refresh-rules').addEventListener('click', renderAutomation);
            el('btn-run-actions').addEventListener('click', async () => { const res = await apiFetch(`${API_BASE}/scheduled-actions/run`, { method:'POST' }); alert(JSON.stringify((await res.json()).data, null, 2)); await renderAudit(); });
            el('btn-refresh-audit').addEventListener('click', renderAudit);
            el('btn-export-audit').addEventListener('click', async () => {
                const res = await apiFetch(`${API_BASE}/audit-logs`);
                const logs = (await res.json()).data || [];
                const blob = new Blob([JSON.stringify(logs, null, 2)], { type:'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = `werunops-audit-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(url);
            });
            document.body.addEventListener('click', async (e) => {
                const roleSave = e.target.closest('.role-save');
                if (roleSave) {
                    const username = roleSave.getAttribute('data-user');
                    const select = document.querySelector(`select.role-edit[data-user='${username}']`);
                    if (!select) return;
                    await apiFetch(`${API_BASE}/users/${encodeURIComponent(username)}/role`, { method:'PATCH', body: JSON.stringify({ role: select.value }) });
                    alert('Role updated.');
                    await renderUsers();
                    await renderAudit();
                }
                const toggle = e.target.closest('.toggle-rule');
                if (toggle) {
                    const ruleId = toggle.getAttribute('data-rule');
                    await apiFetch(`${API_BASE}/automation-rules/${encodeURIComponent(ruleId)}/toggle`, { method:'PATCH' });
                    await renderAutomation();
                    await renderAudit();
                }
            });
            ['flt-user','flt-from','flt-to'].forEach(id => el(id).addEventListener('change', applyFilters));
            el('flt-session-search').addEventListener('input', applyFilters);
            el('task-status-filter').addEventListener('change', applyFilters);
            el('task-search-filter').addEventListener('input', applyFilters);
        }

        function initFilters(){
            const users = Array.from(new Set((RAW.users || []).map(u => u.username).filter(Boolean))).sort();
            const statuses = Array.from(new Set((RAW.tasks || []).map(t => t.status).filter(Boolean))).sort();
            users.forEach(u => { const o = document.createElement('option'); o.value = u; o.textContent = u; el('flt-user').appendChild(o); });
            statuses.forEach(s => {
                const o = document.createElement('option'); o.value = s; o.textContent = s; el('task-status-filter').appendChild(o);
                const o2 = document.createElement('option'); o2.value = s; o2.textContent = s; el('bulk-status').appendChild(o2);
            });
        }

        async function boot(){
            try {
                initTabs();
                initFilters();
                bindActions();
                await applyFilters();
                await refreshSavedFilterOptions();
                await renderAutomation();
                await renderAudit();
                setInterval(renderMonitoring, 30000);
            } catch (error) {
                showError('Portal initialization failed. Refresh and retry from dashboard.');
            }
        }

        boot();
    </script>
</body>
</html>
"""
        token = ""
        if authorization:
            lower = authorization.lower()
            if lower.startswith("bearer "):
                token = authorization[7:].strip()

        html = html.replace("__BOOTSTRAP_JSON__", bootstrap_json)
        html = html.replace("__WERUNOPS_ADMIN_TOKEN__", token)
        return HTMLResponse(content=html)


@app.get("/admin/portal", response_class=HTMLResponse)
def admin_portal_alias(
    user: UserProfile = Depends(current_admin_user),
    authorization: str | None = Header(default=None, alias="Authorization"),
):
    return admin_portal(user, authorization)


@app.get("/api/v1/admin/operations", response_model=APIResponse)
def admin_operations(
    request: Request,
    username: str | None = Query(default=None),
    from_date: str | None = Query(default=None),
    to_date: str | None = Query(default=None),
    status: str | None = Query(default=None),
    task_search: str | None = Query(default=None),
    _: UserProfile = Depends(current_admin_user),
):
    sessions = sorted(store.sessions.values(), key=lambda item: item.loginTime, reverse=True)
    tasks = list(store.tasks.values())

    if username:
        sessions = [item for item in sessions if item.username == username]
        tasks = [item for item in tasks if item.staff == username]

    if from_date:
        start = datetime.fromisoformat(from_date)
        sessions = [item for item in sessions if item.loginTime.replace(tzinfo=None) >= start]

    if to_date:
        end = datetime.fromisoformat(to_date)
        sessions = [item for item in sessions if item.loginTime.replace(tzinfo=None) <= end]

    if status:
        tasks = [item for item in tasks if item.status == status]

    if task_search:
        needle = task_search.lower()
        tasks = [
            item
            for item in tasks
            if needle in item.task.lower() or needle in item.client.lower() or needle in item.staff.lower()
        ]

    by_user: dict[str, dict[str, int]] = {}
    for item in sessions:
        bucket = by_user.setdefault(item.username, {"sessionCount": 0, "durationSeconds": 0, "activeSeconds": 0, "idleSeconds": 0})
        bucket["sessionCount"] += 1
        bucket["durationSeconds"] += item.durationSeconds
        bucket["activeSeconds"] += item.activeSeconds
        bucket["idleSeconds"] += item.idleSeconds

    payload: dict[str, Any] = {
        "summaryByUser": by_user,
        "recentSessions": [session.model_dump(mode="json") for session in sessions[:200]],
        "tasks": [task.model_dump(mode="json") for task in tasks[:300]],
        "efficiencyByUser": {
            user: round((bucket["activeSeconds"] / max(1, bucket["durationSeconds"])) * 100, 2)
            for user, bucket in by_user.items()
        },
        "totalSessions": len(sessions),
        "totalTasks": len(tasks),
        "openTasks": sum(1 for task in tasks if task.status != "Completed"),
        "onlineUsers": sum(1 for item in store.presence.values() if item.online),
    }
    return build_response(payload, request)


@app.get("/api/v1/admin/alerts", response_model=APIResponse)
def admin_alerts(request: Request, _: UserProfile = Depends(current_admin_user)):
    now = datetime.now(UTC)
    alerts: list[dict[str, Any]] = []
    online_users = sum(1 for item in store.presence.values() if item.online)
    today = now.date()
    today_duration_seconds = sum(item.durationSeconds for item in store.sessions.values() if item.loginTime.date() == today)
    completed_today = sum(
        1
        for task in store.tasks.values()
        if task.status == "Completed" and task.updatedAt.date() == today
    )

    for user in store.users.values():
        username = str(user.get("username") or "")
        has_today_session = any(sess.username == username and sess.loginTime.date() == today for sess in store.sessions.values())
        if not has_today_session:
            alerts.append(
                {
                    "title": "No login today",
                    "severity": "warning",
                    "details": f"{username} has not logged in today.",
                    "timestamp": now.isoformat(),
                }
            )

    for session in store.sessions.values():
        if session.durationSeconds > 10 * 3600:
            alerts.append(
                {
                    "title": "Long session detected",
                    "severity": "warning",
                    "details": f"{session.username} session {session.id} exceeded 10 hours.",
                    "timestamp": now.isoformat(),
                }
            )

    return build_response(
        {
            "alerts": alerts[:200],
            "onlineUsers": online_users,
            "todayDurationSeconds": today_duration_seconds,
            "completedToday": completed_today,
        },
        request,
    )


@app.get("/api/v1/admin/users", response_model=APIResponse)
def admin_users(request: Request, _: UserProfile = Depends(current_admin_user)):
    users = [
        {
            "username": value.get("username"),
            "name": value.get("name"),
            "role": value.get("role"),
            "initials": value.get("initials"),
        }
        for value in store.users.values()
    ]
    return build_response(users, request)


@app.patch("/api/v1/admin/users/{username}/role", response_model=APIResponse)
async def admin_update_user_role(username: str, request: Request, admin: UserProfile = Depends(current_admin_user)):
    payload = await request.json()
    role = str(payload.get("role") or "").strip()
    allowed = {"Admin", "Manager", "User"}
    if role not in allowed:
        raise HTTPException(status_code=400, detail="Invalid role")

    user = store.users.get(username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    previous = user.get("role")
    user["role"] = role
    store.save_state()
    admin_log_event(admin, "user_role_updated", {"username": username, "from": previous, "to": role})
    return build_response({"ok": True, "username": username, "role": role}, request)


@app.get("/api/v1/admin/filters", response_model=APIResponse)
def admin_list_filters(request: Request, _: UserProfile = Depends(current_admin_user)):
    return build_response(store.saved_filter_sets, request)


@app.post("/api/v1/admin/filters", response_model=APIResponse)
async def admin_save_filter(request: Request, admin: UserProfile = Depends(current_admin_user)):
    payload = await request.json()
    name = str(payload.get("name") or "").strip()
    raw_filters = payload.get("filters")
    filters: dict[str, Any] = {}
    if isinstance(raw_filters, dict):
        raw_filters_dict = cast(dict[Any, Any], raw_filters)
        filters = {str(key): value for key, value in raw_filters_dict.items()}
    if not name:
        raise HTTPException(status_code=400, detail="Filter name required")

    store.saved_filter_sets = [item for item in store.saved_filter_sets if item.get("name") != name]
    entry: dict[str, Any] = {"name": name, "filters": filters, "savedAt": datetime.now(UTC).isoformat(), "savedBy": admin.username}
    store.saved_filter_sets.insert(0, entry)
    store.saved_filter_sets = store.saved_filter_sets[:100]
    store.save_state()
    admin_log_event(admin, "filter_saved", {"name": name})
    return build_response(entry, request)


@app.delete("/api/v1/admin/filters/{name}", response_model=APIResponse)
def admin_delete_filter(name: str, request: Request, admin: UserProfile = Depends(current_admin_user)):
    before = len(store.saved_filter_sets)
    store.saved_filter_sets = [item for item in store.saved_filter_sets if item.get("name") != name]
    if len(store.saved_filter_sets) != before:
        store.save_state()
        admin_log_event(admin, "filter_deleted", {"name": name})
    return build_response({"deleted": len(store.saved_filter_sets) != before, "name": name}, request)


@app.post("/api/v1/admin/tasks/bulk-update", response_model=APIResponse)
async def admin_bulk_update_tasks(request: Request, admin: UserProfile = Depends(current_admin_user)):
    payload = await request.json()
    raw_task_ids = payload.get("taskIds")
    task_ids: list[int] = []
    if isinstance(raw_task_ids, list):
        raw_task_ids_list = cast(list[Any], raw_task_ids)
        for raw_id in raw_task_ids_list:
            try:
                task_ids.append(int(raw_id))
            except (TypeError, ValueError):
                continue
    status = payload.get("status")
    staff = payload.get("staff")

    updated = 0
    changed_ids: list[int] = []
    for task_id in task_ids:
        task = store.tasks.get(task_id)
        if not task:
            continue
        updates: dict[str, Any] = {"updatedAt": datetime.now(UTC), "version": task.version + 1}
        if status:
            updates["status"] = status
        if staff:
            updates["staff"] = staff
        mutated = task.model_copy(update=updates)
        mutated.activityLog.append(ActivityEntry(action="Bulk update from admin portal", user=admin.name, timestamp=datetime.now(UTC)))
        store.tasks[task_id] = mutated
        updated += 1
        changed_ids.append(task_id)

    if updated:
        store.save_state()
        admin_log_event(admin, "tasks_bulk_updated", {"count": updated, "taskIds": changed_ids})

    return build_response({"updated": updated, "taskIds": changed_ids}, request)


@app.get("/api/v1/admin/tasks/{task_id}/comments", response_model=APIResponse)
def admin_task_comments(task_id: int, request: Request, _: UserProfile = Depends(current_admin_user)):
    comments = store.task_comments.get(task_id, [])
    return build_response(comments, request)


@app.post("/api/v1/admin/tasks/{task_id}/comments", response_model=APIResponse)
async def admin_add_task_comment(task_id: int, request: Request, admin: UserProfile = Depends(current_admin_user)):
    payload = await request.json()
    comment = str(payload.get("comment") or "").strip()
    if not comment:
        raise HTTPException(status_code=400, detail="Comment is required")
    if task_id not in store.tasks:
        raise HTTPException(status_code=404, detail="Task not found")

    entry: dict[str, Any] = {
        "id": f"c_{uuid.uuid4().hex[:8]}",
        "taskId": task_id,
        "comment": comment,
        "user": admin.name,
        "username": admin.username,
        "timestamp": datetime.now(UTC).isoformat(),
    }
    bucket = store.task_comments.setdefault(task_id, [])
    bucket.insert(0, entry)
    store.task_comments[task_id] = bucket[:500]
    store.save_state()
    admin_log_event(admin, "task_comment_added", {"taskId": task_id, "commentId": entry["id"]})
    return build_response(entry, request)


@app.get("/api/v1/admin/automation-rules", response_model=APIResponse)
def admin_automation_rules(request: Request, _: UserProfile = Depends(current_admin_user)):
    return build_response(store.automation_rules, request)


@app.patch("/api/v1/admin/automation-rules/{rule_id}/toggle", response_model=APIResponse)
def admin_toggle_rule(rule_id: str, request: Request, admin: UserProfile = Depends(current_admin_user)):
    for rule in store.automation_rules:
        if str(rule.get("id")) == rule_id:
            rule["enabled"] = not bool(rule.get("enabled"))
            store.save_state()
            admin_log_event(admin, "automation_rule_toggled", {"ruleId": rule_id, "enabled": rule["enabled"]})
            return build_response(rule, request)
    raise HTTPException(status_code=404, detail="Rule not found")


@app.post("/api/v1/admin/scheduled-actions/run", response_model=APIResponse)
def admin_run_scheduled_actions(request: Request, admin: UserProfile = Depends(current_admin_user)):
    archived = 0
    threshold = datetime.now(UTC) - timedelta(days=30)
    for task in store.tasks.values():
        if task.status == "Completed" and task.updatedAt < threshold:
            archived += 1

    result: dict[str, Any] = {
        "archivedCandidates": archived,
        "rulesEvaluated": len(store.automation_rules),
        "ranAt": datetime.now(UTC).isoformat(),
    }
    admin_log_event(admin, "scheduled_actions_run", result)
    return build_response(result, request)


@app.get("/api/v1/admin/reports/{report_name}", response_model=APIResponse)
def admin_report(report_name: str, request: Request, _: UserProfile = Depends(current_admin_user)):
    sessions = list(store.sessions.values())
    tasks = list(store.tasks.values())
    today = datetime.now(UTC).date()

    if report_name == "weekly-summary":
        from_day = today - timedelta(days=7)
        scoped_sessions = [item for item in sessions if item.loginTime.date() >= from_day]
        scoped_tasks = [item for item in tasks if item.updatedAt.date() >= from_day]
        data: dict[str, Any] = {
            "report": report_name,
            "from": from_day.isoformat(),
            "to": today.isoformat(),
            "sessions": len(scoped_sessions),
            "durationHours": round(sum(item.durationSeconds for item in scoped_sessions) / 3600, 2),
            "completedTasks": sum(1 for item in scoped_tasks if item.status == "Completed"),
            "openTasks": sum(1 for item in scoped_tasks if item.status != "Completed"),
        }
        return build_response(data, request)

    if report_name == "monthly-attendance":
        from_day = today - timedelta(days=30)
        scoped_sessions = [item for item in sessions if item.loginTime.date() >= from_day]
        by_user: dict[str, dict[str, Any]] = {}
        for item in scoped_sessions:
            bucket = by_user.setdefault(item.username, {"daysWorked": set(), "durationSeconds": 0, "sessionCount": 0})
            bucket["daysWorked"].add(item.loginTime.date().isoformat())
            bucket["durationSeconds"] += item.durationSeconds
            bucket["sessionCount"] += 1
        normalized: dict[str, dict[str, Any]] = {
            user: {
                "daysWorked": len(value["daysWorked"]),
                "durationHours": round(value["durationSeconds"] / 3600, 2),
                "sessionCount": value["sessionCount"],
            }
            for user, value in by_user.items()
        }
        return build_response({"report": report_name, "from": from_day.isoformat(), "to": today.isoformat(), "byUser": normalized}, request)

    raise HTTPException(status_code=404, detail="Unknown report")


@app.get("/api/v1/admin/audit-logs", response_model=APIResponse)
def admin_audit_logs(request: Request, _: UserProfile = Depends(current_admin_user)):
    return build_response(store.admin_audit_logs[:500], request)


@app.post("/api/v1/auth/login", response_model=APIResponse)
def auth_login(payload: LoginRequest, request: Request):
    try:
        token, profile = store.authenticate(payload.username, payload.password)
    except UnauthorizedError as error:
        raise HTTPException(status_code=401, detail=str(error)) from error

    return build_response(
        LoginResponse(accessToken=token, profile=profile, expiresInSeconds=3600).model_dump(),
        request,
    )


@app.get("/api/v1/auth/me", response_model=APIResponse)
def auth_me(request: Request, user: UserProfile = Depends(current_user)):
    return build_response(user.model_dump(), request)


@app.post("/api/v1/auth/logout", response_model=APIResponse)
def auth_logout(request: Request, authorization: str | None = Header(default=None, alias="Authorization")):
    token = parse_bearer(authorization)
    store.logout(token)
    return build_response({"ok": True}, request)


@app.post("/api/v1/auth/change-password", response_model=APIResponse)
def auth_change_password(payload: ChangePasswordRequest, request: Request, user: UserProfile = Depends(current_user)):
    try:
        store.change_password(user.username, payload.currentPassword, payload.newPassword)
    except UnauthorizedError as error:
        raise HTTPException(status_code=401, detail=str(error)) from error
    return build_response({"ok": True, "message": "Password changed", "username": user.username}, request)


@app.get("/api/v1/tasks", response_model=APIResponse)
def list_tasks(
    request: Request,
    status: str | None = Query(default=None),
    staff: str | None = Query(default=None),
    client: str | None = Query(default=None),
    _: UserProfile = Depends(current_user),
):
    records = list(store.tasks.values())
    if status:
        records = [task for task in records if task.status == status]
    if staff:
        records = [task for task in records if task.staff == staff]
    if client:
        records = [task for task in records if task.client == client]
    return build_response([task.model_dump() for task in records], request)


@app.get("/api/v1/tasks/{task_id}", response_model=APIResponse)
def get_task(task_id: int, request: Request, _: UserProfile = Depends(current_user)):
    task = store.tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return build_response(task.model_dump(), request)


@app.post("/api/v1/tasks", response_model=APIResponse)
def create_task(payload: TaskCreate, request: Request, user: UserProfile = Depends(current_user)):
    task_id = store.next_task_id
    store.next_task_id += 1
    now = datetime.now(UTC)
    task = TaskOut(
        id=task_id,
        **payload.model_dump(),
        createdAt=now,
        updatedAt=now,
        createdBy=user.name,
        activityLog=[ActivityEntry(action="Task created", user=user.name, timestamp=now)],
        version=1,
    )
    store.tasks[task_id] = task
    store.save_state()
    return build_response(task.model_dump(), request)


@app.post("/api/v1/tasks/restore", response_model=APIResponse)
def restore_task(payload: TaskRestoreRequest, request: Request, _: UserProfile = Depends(current_user)):
    task = payload.task
    store.tasks[task.id] = task
    if task.id >= store.next_task_id:
        store.next_task_id = task.id + 1
    store.save_state()
    return build_response(task.model_dump(), request)


@app.put("/api/v1/tasks/{task_id}", response_model=APIResponse)
def update_task(task_id: int, payload: TaskUpdate, request: Request, user: UserProfile = Depends(current_user)):
    task = store.tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    ensure_task_not_locked_by_other(task_id, user)
    if task.version != payload.version:
        raise HTTPException(status_code=409, detail={"code": "TASK_CONFLICT", "latest": jsonable_encoder(task.model_dump())})

    updated = task.model_copy(update={**payload.model_dump(exclude={"version"}), "version": task.version + 1, "updatedAt": datetime.now(UTC)})
    updated.activityLog.append(ActivityEntry(action="Task updated", user=user.name, timestamp=datetime.now(UTC)))
    store.tasks[task_id] = updated
    store.save_state()
    return build_response(updated.model_dump(), request)


@app.patch("/api/v1/tasks/{task_id}/status", response_model=APIResponse)
def patch_task_status(task_id: int, payload: TaskStatusPatch, request: Request, user: UserProfile = Depends(current_user)):
    task = store.tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    ensure_task_not_locked_by_other(task_id, user)
    if task.version != payload.version:
        raise HTTPException(status_code=409, detail={"code": "TASK_CONFLICT", "latest": jsonable_encoder(task.model_dump())})

    now = datetime.now(UTC)
    updated = task.model_copy(update={"status": payload.status, "version": task.version + 1, "updatedAt": now})
    updated.activityLog.append(ActivityEntry(action=f'Status changed to "{payload.status}"', user=user.name, timestamp=now))
    store.tasks[task_id] = updated
    store.save_state()
    return build_response(updated.model_dump(), request)


@app.delete("/api/v1/tasks/{task_id}", response_model=APIResponse)
def delete_task(task_id: int, request: Request, user: UserProfile = Depends(current_user)):
    if task_id not in store.tasks:
        raise HTTPException(status_code=404, detail="Task not found")
    ensure_task_not_locked_by_other(task_id, user)
    store.tasks.pop(task_id)
    store.task_locks.pop(task_id, None)
    store.save_state()
    return build_response({"deleted": True, "taskId": task_id}, request)


@app.post("/api/v1/tasks/bulk-delete", response_model=APIResponse)
def bulk_delete_tasks(payload: BulkDeleteRequest, request: Request, user: UserProfile = Depends(current_user)):
    deleted = 0
    for task_id in payload.taskIds:
        if task_id in store.tasks:
            ensure_task_not_locked_by_other(task_id, user)
            store.tasks.pop(task_id)
            store.task_locks.pop(task_id, None)
            deleted += 1
    if deleted:
        store.save_state()
    return build_response({"deleted": deleted}, request)


@app.get("/api/v1/clients", response_model=APIResponse)
def list_clients(request: Request, _: UserProfile = Depends(current_user)):
    return build_response([client.model_dump() for client in store.clients.values()], request)


@app.post("/api/v1/clients", response_model=APIResponse)
def create_client(payload: ClientCreate, request: Request, _: UserProfile = Depends(current_user)):
    client_id = store.next_client_id
    store.next_client_id += 1
    client = ClientOut(id=client_id, version=1, **payload.model_dump())
    store.clients[client_id] = client
    store.save_state()
    return build_response(client.model_dump(), request)


@app.put("/api/v1/clients/{client_id}", response_model=APIResponse)
def update_client(client_id: int, payload: ClientUpdate, request: Request, _: UserProfile = Depends(current_user)):
    client = store.clients.get(client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    if client.version != payload.version:
        raise HTTPException(status_code=409, detail={"code": "CLIENT_CONFLICT", "latest": client.model_dump()})

    updated = client.model_copy(update={**payload.model_dump(exclude={"version"}), "version": client.version + 1})
    store.clients[client_id] = updated
    store.save_state()
    return build_response(updated.model_dump(), request)


@app.delete("/api/v1/clients/{client_id}", response_model=APIResponse)
def delete_client(client_id: int, request: Request, _: UserProfile = Depends(current_user)):
    client = store.clients.get(client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    has_tasks = any(task.client == client.name and task.status != "Completed" for task in store.tasks.values())
    if has_tasks:
        raise HTTPException(status_code=400, detail="Client has active tasks")

    store.clients.pop(client_id)
    store.save_state()
    return build_response({"deleted": True, "clientId": client_id}, request)


@app.put("/api/v1/presence/me", response_model=APIResponse)
def set_presence(payload: PresenceMeRequest, request: Request, user: UserProfile = Depends(current_user)):
    record = PresenceOut(
        username=user.username,
        online=payload.online,
        lastSeen=datetime.now(UTC),
        browser=payload.browser,
        device=payload.device,
    )
    store.presence[user.username] = record
    store.save_state()
    return build_response(record.model_dump(), request)


@app.get("/api/v1/presence", response_model=APIResponse)
def list_presence(request: Request, _: UserProfile = Depends(current_user)):
    return build_response([value.model_dump() for value in store.presence.values()], request)


@app.post("/api/v1/sessions/start", response_model=APIResponse)
def start_session(payload: SessionStartRequest, request: Request, user: UserProfile = Depends(current_user)):
    session_id = f"sess_{uuid.uuid4().hex[:12]}"
    session = SessionOut(
        id=session_id,
        username=user.username,
        loginTime=datetime.now(UTC),
        browser=payload.browser,
        device=payload.device,
    )
    store.sessions[session_id] = session
    store.save_state()
    return build_response(session.model_dump(), request)


@app.post("/api/v1/sessions/{session_id}/heartbeat", response_model=APIResponse)
def session_heartbeat(session_id: str, payload: SessionHeartbeatRequest, request: Request, user: UserProfile = Depends(current_user)):
    session = store.sessions.get(session_id)
    if not session or session.username != user.username:
        raise HTTPException(status_code=404, detail="Session not found")

    session.activeSeconds += payload.activeSeconds
    session.idleSeconds += payload.idleSeconds
    session.durationSeconds = session.activeSeconds + session.idleSeconds
    store.sessions[session_id] = session
    store.save_state()
    return build_response(session.model_dump(), request)


@app.post("/api/v1/sessions/{session_id}/end", response_model=APIResponse)
def end_session(session_id: str, request: Request, user: UserProfile = Depends(current_user)):
    session = store.sessions.get(session_id)
    if not session or session.username != user.username:
        raise HTTPException(status_code=404, detail="Session not found")

    session.logoutTime = datetime.now(UTC)
    store.sessions[session_id] = session
    store.save_state()
    return build_response(session.model_dump(), request)


@app.get("/api/v1/sessions", response_model=APIResponse)
def list_sessions(
    request: Request,
    username: str | None = Query(default=None),
    _: UserProfile = Depends(current_user),
):
    sessions = list(store.sessions.values())
    if username:
        sessions = [item for item in sessions if item.username == username]
    return build_response([session.model_dump() for session in sessions], request)


@app.get("/api/v1/locks/tasks", response_model=APIResponse)
def list_task_locks(request: Request, _: UserProfile = Depends(current_user)):
    locks = [item.model_dump() for item in store.list_task_locks()]
    return build_response(locks, request)


@app.put("/api/v1/locks/tasks/{task_id}", response_model=APIResponse)
def lock_task(task_id: int, payload: TaskLockRequest, request: Request, user: UserProfile = Depends(current_user)):
    if task_id not in store.tasks:
        raise HTTPException(status_code=404, detail="Task not found")
    try:
        lock = store.lock_task(task_id, user.username, user.name, payload.ttlSeconds)
    except ConflictError as error:
        raise HTTPException(status_code=409, detail={"code": "TASK_LOCKED", "message": str(error)}) from error
    return build_response(lock.model_dump(), request)


@app.delete("/api/v1/locks/tasks/{task_id}", response_model=APIResponse)
def unlock_task(task_id: int, request: Request, user: UserProfile = Depends(current_user)):
    try:
        store.unlock_task(task_id, user.username)
    except ConflictError as error:
        raise HTTPException(status_code=409, detail={"code": "TASK_LOCKED", "message": str(error)}) from error
    return build_response({"ok": True, "taskId": task_id}, request)


@app.get("/api/v1/reports/sessions/summary", response_model=APIResponse)
def session_summary(
    request: Request,
    username: str | None = Query(default=None),
    from_date: str | None = Query(default=None),
    to_date: str | None = Query(default=None),
    _: UserProfile = Depends(current_user),
):
    sessions = list(store.sessions.values())
    if username:
        sessions = [item for item in sessions if item.username == username]

    if from_date:
        start = datetime.fromisoformat(from_date)
        sessions = [item for item in sessions if item.loginTime.replace(tzinfo=None) >= start]
    if to_date:
        end = datetime.fromisoformat(to_date)
        sessions = [item for item in sessions if item.loginTime.replace(tzinfo=None) <= end]

    summary: dict[str, dict[str, int]] = {}
    heatmap_by_hour = {str(hour): 0 for hour in range(24)}
    by_day: dict[str, int] = {}
    longest_session: dict[str, Any] | None = None
    shortest_session: dict[str, Any] | None = None
    longest_duration = -1
    shortest_duration: int | None = None

    for item in sessions:
        if item.username not in summary:
            summary[item.username] = {"sessionCount": 0, "durationSeconds": 0, "activeSeconds": 0, "idleSeconds": 0}
        summary[item.username]["sessionCount"] += 1
        summary[item.username]["durationSeconds"] += item.durationSeconds
        summary[item.username]["activeSeconds"] += item.activeSeconds
        summary[item.username]["idleSeconds"] += item.idleSeconds

        hour_key = str(item.loginTime.hour)
        heatmap_by_hour[hour_key] = heatmap_by_hour.get(hour_key, 0) + item.durationSeconds

        day_key = item.loginTime.date().isoformat()
        by_day[day_key] = by_day.get(day_key, 0) + item.durationSeconds

        current_snapshot: dict[str, Any] = {
            "id": item.id,
            "username": item.username,
            "loginTime": item.loginTime.isoformat(),
            "logoutTime": item.logoutTime.isoformat() if item.logoutTime else None,
            "durationSeconds": item.durationSeconds,
            "activeSeconds": item.activeSeconds,
            "idleSeconds": item.idleSeconds,
        }
        if item.durationSeconds > longest_duration:
            longest_session = current_snapshot
            longest_duration = item.durationSeconds
        if shortest_duration is None or item.durationSeconds < shortest_duration:
            shortest_session = current_snapshot
            shortest_duration = item.durationSeconds

    payload: dict[str, Any] = {
        "byUser": summary,
        "byDayDurationSeconds": by_day,
        "heatmapDurationSecondsByHour": heatmap_by_hour,
        "longestSession": longest_session,
        "shortestSession": shortest_session,
        "totalSessions": len(sessions),
        "totalDurationSeconds": sum(item.durationSeconds for item in sessions),
    }

    return build_response(payload, request)


@app.get("/api/v1/dashboard/metrics", response_model=APIResponse)
def dashboard_metrics(request: Request, _: UserProfile = Depends(current_user)):
    tasks = list(store.tasks.values())
    open_count = sum(1 for item in tasks if item.status != "Completed")
    in_progress_count = sum(1 for item in tasks if item.status == "In Progress")
    completed_count = sum(1 for item in tasks if item.status == "Completed")

    now_date = datetime.now(UTC).date().isoformat()
    overdue_count = sum(1 for item in tasks if item.status != "Completed" and item.dueDate and item.dueDate < now_date)

    presence = list(store.presence.values())
    online_users = sum(1 for item in presence if item.online)

    today = datetime.now(UTC).date()
    hours_by_user: dict[str, int] = {}
    for session in store.sessions.values():
        if session.loginTime.date() == today:
            hours_by_user[session.username] = hours_by_user.get(session.username, 0) + session.durationSeconds

    return build_response(
        {
            "openTasks": open_count,
            "inProgressTasks": in_progress_count,
            "completedTasks": completed_count,
            "overdueTasks": overdue_count,
            "onlineUsers": online_users,
            "todayDurationSecondsByUser": hours_by_user,
        },
        request,
    )


@app.get("/api/v1/exports/sessions.csv")
def export_sessions_csv(_: UserProfile = Depends(current_user)):
    lines = ["sessionId,username,loginTime,logoutTime,durationSeconds,activeSeconds,idleSeconds,browser,device"]
    for session in store.sessions.values():
        lines.append(
            ",".join(
                [
                    session.id,
                    session.username,
                    session.loginTime.isoformat(),
                    session.logoutTime.isoformat() if session.logoutTime else "",
                    str(session.durationSeconds),
                    str(session.activeSeconds),
                    str(session.idleSeconds),
                    (session.browser or "").replace(",", " "),
                    (session.device or "").replace(",", " "),
                ]
            )
        )
    return PlainTextResponse("\n".join(lines), media_type="text/csv")


@app.get("/api/v1/state/export", response_model=APIResponse)
def export_state(request: Request, _: UserProfile = Depends(current_user)):
    payload = {
        "tasks": [item.model_dump(mode="json") for item in store.tasks.values()],
        "clients": [item.model_dump(mode="json") for item in store.clients.values()],
        "presence": [item.model_dump(mode="json") for item in store.presence.values()],
        "sessions": [item.model_dump(mode="json") for item in store.sessions.values()],
    }
    return build_response(payload, request)
