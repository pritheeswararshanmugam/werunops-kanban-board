from __future__ import annotations

import difflib
import uuid
import os
import json
import hashlib
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, cast

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, PlainTextResponse, Response
from starlette.middleware.base import RequestResponseEndpoint

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
    PresenceStatus,
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

ROLE_ACCESS_LABELS = {
    "Admin": "System Administrator",
    "Manager": "Operations Manager",
    "User": "Operations Specialist",
}

ROLE_NAME_ALIASES = {
    "admin": "Admin",
    "administrator": "Admin",
    "super admin": "Admin",
    "super_admin": "Admin",
    "system administrator": "Admin",
    "system_administrator": "Admin",
    "level 3": "Admin",
    "level3": "Admin",
    "manager": "Manager",
    "operations manager": "Manager",
    "operations_manager": "Manager",
    "level 2": "Manager",
    "level2": "Manager",
    "operator": "User",
    "operations specialist": "User",
    "operations_specialist": "User",
    "user": "User",
    "level 1": "User",
    "level1": "User",
}

PRESENCE_STATUS_ALIASES = {
    "online": "online",
    "away": "away",
    "away / break": "away",
    "away/break": "away",
    "break": "away",
    "in a meeting": "meeting",
    "meeting": "meeting",
    "offline": "offline",
}

ROLE_CAPABILITIES = {
    "Admin": {
        "viewOverview": True,
        "manageUsers": True,
        "manageRoles": True,
        "manageTasks": True,
        "approveTasks": True,
        "manageAutomation": True,
        "viewAudit": True,
        "scheduleReports": True,
    },
    "Manager": {
        "viewOverview": True,
        "manageUsers": False,
        "manageRoles": False,
        "manageTasks": True,
        "approveTasks": True,
        "manageAutomation": False,
        "viewAudit": True,
        "scheduleReports": True,
    },
    "User": {
        "viewOverview": False,
        "manageUsers": False,
        "manageRoles": False,
        "manageTasks": False,
        "approveTasks": False,
        "manageAutomation": False,
        "viewAudit": False,
        "scheduleReports": False,
    },
}

ADMIN_PORTAL_TEMPLATE = Path(__file__).with_name("admin_portal_template.html")


LEGACY_PORTAL_TEMPLATE = """


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
            <h3 style='margin-top:16px'>Report Schedules</h3>
            <div class='row'>
                <div class='field'><label>Schedule Name</label><input id='schedule-name' type='text' placeholder='Daily Login Digest'/></div>
                <div class='field'><label>Trigger</label><input id='schedule-trigger' type='text' placeholder='weekday_1800'/></div>
                <div class='field'><label>Report</label><select id='schedule-report'><option value='weekly-summary'>Weekly Summary</option><option value='monthly-attendance'>Monthly Attendance</option><option value='login-history'>Login History</option><option value='staff-utilization'>Staff Utilization</option><option value='project-billing'>Project Billing</option><option value='task-approvals'>Task Approvals</option></select></div>
                <div class='field'><label>Format</label><select id='schedule-format'><option value='json'>JSON</option><option value='csv'>CSV</option></select></div>
                <div class='field' style='min-width:260px'><label>Recipients</label><input id='schedule-recipients' type='text' placeholder='ops@example.com, admin@example.com'/></div>
                <button class='btn primary' id='btn-create-schedule'>Create Schedule</button>
            </div>
            <div class='table-wrap' style='margin-top:10px'><table><thead><tr><th>ID</th><th>Name</th><th>Trigger</th><th>Report</th><th>Format</th><th>Enabled</th><th>Delete</th></tr></thead><tbody id='tbl-schedules'></tbody></table></div>
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
            const header = 'id,username,loginTime,logoutTime,durationSeconds,activeSeconds,idleSeconds\\n';
            const body = sessions.map(s => [s.id, s.username, s.loginTime, s.logoutTime || '', toNum(s.durationSeconds), toNum(s.activeSeconds), toNum(s.idleSeconds)]
                .map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\\n');
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
if False:
    legacy_html = LEGACY_PORTAL_TEMPLATE
    legacy_html = legacy_html.replace("__BOOTSTRAP_JSON__", "disabled")
    legacy_html = legacy_html.replace("__WERUNOPS_ADMIN_TOKEN__", "disabled")


@app.middleware("http")
async def refresh_remote_state_middleware(request: Request, call_next: RequestResponseEndpoint) -> Response:
    path = request.url.path or ""
    should_refresh = path.startswith("/api/v1/") and path not in {"/api/v1/health", "/api/v1"}

    if should_refresh:
        try:
            store.refresh_remote_state_if_needed(min_interval_seconds=1.5)
        except Exception as error:
            store.state_driver_note = f"remote refresh failed before request: {error}"

    return await call_next(request)


def _get_env_compat(names: tuple[str, ...], suffixes: tuple[str, ...], default: str = "") -> str:
    for name in names:
        value = (os.getenv(name) or "").strip()
        if value:
            return value

    env_items = sorted(os.environ.items(), key=lambda item: item[0])
    for suffix in suffixes:
        expected = suffix.upper()
        for key, raw_value in env_items:
            if not key.upper().endswith(expected):
                continue
            value = (raw_value or "").strip()
            if value:
                return value

    return default


cors_origins_raw = _get_env_compat(
    names=("CORS_ALLOW_ORIGINS",),
    suffixes=("_CORS_ALLOW_ORIGINS",),
    default="*",
)
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


def normalized_role(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        return "User"
    mapped = ROLE_NAME_ALIASES.get(raw.lower())
    if mapped:
        return mapped
    titled = raw.title()
    return titled if titled in ROLE_CAPABILITIES else "User"


def role_access_label(role: Any) -> str:
    return ROLE_ACCESS_LABELS.get(normalized_role(role), ROLE_ACCESS_LABELS["User"])


def role_capabilities(role: Any) -> dict[str, bool]:
    normalized = normalized_role(role)
    return dict(ROLE_CAPABILITIES.get(normalized, ROLE_CAPABILITIES["User"]))


def normalized_presence_status(value: Any) -> PresenceStatus:
    raw = str(value or "").strip().lower()
    if not raw:
        return "online"
    return cast(PresenceStatus, PRESENCE_STATUS_ALIASES.get(raw, "online"))


def user_has_global_visibility(user: UserProfile) -> bool:
    return role_capabilities(user.role).get("viewOverview", False)


def normalized_identity_key(value: Any) -> str:
    return "".join(character for character in str(value or "").strip().lower() if character.isalnum())


def resolve_known_username(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""

    if raw in store.users:
        return raw

    lowered = raw.lower()
    lookup_key = normalized_identity_key(raw)
    alias_map: dict[str, str] = {}

    for username, raw_user in store.users.items():
        if lowered == str(username or "").strip().lower():
            return username
        if lowered == str(raw_user.get("name") or "").strip().lower():
            return username

        username_key = normalized_identity_key(username)
        name_key = normalized_identity_key(raw_user.get("name"))
        if lookup_key and lookup_key in {username_key, name_key}:
            return username
        if username_key:
            alias_map.setdefault(username_key, username)
        if name_key:
            alias_map.setdefault(name_key, username)

    if lookup_key and alias_map:
        close_matches = difflib.get_close_matches(lookup_key, list(alias_map.keys()), n=1, cutoff=0.88)
        if close_matches:
            return alias_map[close_matches[0]]

    return raw


def usernames_match(left: Any, right: Any) -> bool:
    return resolve_known_username(left).lower() == resolve_known_username(right).lower()


def normalize_task_staff_value(value: Any) -> str:
    return resolve_known_username(value)


def visible_tasks_for_user(user: UserProfile) -> list[TaskOut]:
    tasks = list(store.tasks.values())
    if user_has_global_visibility(user):
        return tasks
    return [task for task in tasks if usernames_match(task.staff, user.username)]


def is_operations_specialist(user: UserProfile) -> bool:
    return normalized_role(user.role) == "User"


def user_matches_identity(user: UserProfile, value: Any) -> bool:
    raw = str(value or "").strip()
    if not raw:
        return False
    if usernames_match(raw, user.username):
        return True
    return raw.lower() == str(user.name or "").strip().lower()


def task_created_by_user(task: TaskOut, user: UserProfile) -> bool:
    return user_matches_identity(user, task.createdBy)


def user_can_create_tasks(user: UserProfile) -> bool:
    return user_has_global_visibility(user) or is_operations_specialist(user)


def user_can_edit_task_details(task: TaskOut, user: UserProfile) -> bool:
    if user_has_global_visibility(user):
        return True
    return task_created_by_user(task, user)


def user_can_delete_task(task: TaskOut, user: UserProfile) -> bool:
    if user_has_global_visibility(user):
        return True
    return task_created_by_user(task, user)


def user_can_update_task_status(task: TaskOut, user: UserProfile, next_status: str | None = None) -> bool:
    if user_has_global_visibility(user):
        return True
    if not usernames_match(task.staff, user.username):
        return False
    if task_created_by_user(task, user):
        return True
    if next_status is None:
        return True
    return next_status == task.status or next_status == "Completed"


def normalize_specialist_task_staff(staff_value: Any, user: UserProfile) -> str:
    if is_operations_specialist(user):
        return user.username
    return normalize_task_staff_value(staff_value)


def visible_clients_for_user(user: UserProfile, tasks: list[TaskOut] | None = None) -> list[ClientOut]:
    clients = list(store.clients.values())
    if user_has_global_visibility(user):
        return clients
    task_records = visible_tasks_for_user(user) if tasks is None else tasks
    allowed_client_names = {task.client for task in task_records if task.client}
    return [client for client in clients if client.name in allowed_client_names]


def visible_presence_for_user(user: UserProfile) -> list[PresenceOut]:
    presence = list(store.presence.values())
    if user_has_global_visibility(user):
        return presence
    return [item for item in presence if usernames_match(item.username, user.username)]


def scoped_sessions_for_user(user: UserProfile, username: str | None = None) -> list[SessionOut]:
    sessions = list(store.sessions.values())
    requested_username = str(username or "").strip()
    if user_has_global_visibility(user):
        if requested_username:
            return [item for item in sessions if usernames_match(item.username, requested_username)]
        return sessions
    if requested_username and not usernames_match(requested_username, user.username):
        raise HTTPException(status_code=403, detail="Operations Specialist access is limited to your own session history")
    return [item for item in sessions if usernames_match(item.username, user.username)]


def ensure_user_can_access_task(task: TaskOut, user: UserProfile) -> None:
    if user_has_global_visibility(user) or usernames_match(task.staff, user.username):
        return
    raise HTTPException(status_code=403, detail="Operations Specialist access is limited to your own tasks")


def require_privileged_user(user: UserProfile, detail: str) -> None:
    if user_has_global_visibility(user):
        return
    raise HTTPException(status_code=403, detail=detail)


def require_admin_capability(user: UserProfile, capability: str) -> None:
    capabilities = role_capabilities(user.role)
    if not capabilities.get(capability, False):
        raise HTTPException(status_code=403, detail=f"Missing capability: {capability}")


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def coerce_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    return str(value or "").strip().lower() in {"1", "true", "yes", "y", "on", "active"}


def serialize_admin_user(username: str, raw_user: dict[str, Any] | None) -> dict[str, Any] | None:
    if raw_user is None:
        return None

    role = normalized_role(raw_user.get("role"))
    sessions = [session for session in store.sessions.values() if session.username == username]
    last_login = max((session.loginTime for session in sessions), default=None)
    open_task_count = sum(1 for task in store.tasks.values() if usernames_match(task.staff, username) and task.status != "Completed")
    completed_task_count = sum(1 for task in store.tasks.values() if usernames_match(task.staff, username) and task.status == "Completed")
    name = str(raw_user.get("name") or username).strip() or username
    initials = str(raw_user.get("initials") or name[:1] or username[:1]).strip()[:1].upper() or username[:1].upper()

    return {
        "username": username,
        "name": name,
        "role": role,
        "accessLevel": role_access_label(role),
        "capabilities": role_capabilities(role),
        "initials": initials,
        "department": str(raw_user.get("department") or "").strip(),
        "timezone": str(raw_user.get("timezone") or "UTC").strip() or "UTC",
        "isActive": coerce_bool(raw_user.get("isActive", True)),
        "sessionCount": len(sessions),
        "openTaskCount": open_task_count,
        "completedTaskCount": completed_task_count,
        "lastLoginTime": last_login.isoformat() if last_login else None,
    }


def build_user_directory() -> list[dict[str, Any]]:
    rank = {"Admin": 0, "Manager": 1, "User": 2}
    rows = [
        serialized
        for username, raw_user in store.users.items()
        for serialized in [serialize_admin_user(username, raw_user)]
        if serialized is not None
    ]
    return sorted(rows, key=lambda item: (rank.get(str(item.get("role") or "User"), 99), str(item.get("name") or item.get("username") or "").lower()))


def build_project_map(tasks: list[TaskOut]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    for task in tasks:
        project = (task.project or "").strip() or "Unmapped"
        category = (task.operationalCategory or "").strip() or "General"
        key = (project, category)
        bucket = grouped.setdefault(
            key,
            {
                "project": project,
                "category": category,
                "taskCount": 0,
                "openTaskCount": 0,
                "completedTaskCount": 0,
                "pendingApprovalCount": 0,
                "staff": set(),
            },
        )
        bucket["taskCount"] += 1
        if task.status == "Completed":
            bucket["completedTaskCount"] += 1
        else:
            bucket["openTaskCount"] += 1
        if task.approvalStatus == "Pending":
            bucket["pendingApprovalCount"] += 1
        cast(set[str], bucket["staff"]).add(task.staff)

    return [
        {
            **{key: value for key, value in bucket.items() if key != "staff"},
            "staff": sorted(cast(set[str], bucket["staff"])),
        }
        for _, bucket in sorted(grouped.items(), key=lambda item: (item[0][0].lower(), item[0][1].lower()))
    ]


def list_report_schedules() -> list[dict[str, Any]]:
    schedules = [
        rule
        for rule in store.automation_rules
        if str(rule.get("action") or "") == "send_report"
    ]
    return sorted(schedules, key=lambda item: str(item.get("name") or item.get("id") or "").lower())


def build_operations_snapshot(sessions: list[SessionOut], tasks: list[TaskOut]) -> dict[str, Any]:
    total_duration = sum(session.durationSeconds for session in sessions)
    active_duration = sum(session.activeSeconds for session in sessions)
    idle_duration = sum(session.idleSeconds for session in sessions)
    billable_duration = sum(session.billableSeconds for session in sessions)
    administrative_duration = sum(session.administrativeSeconds for session in sessions)
    completed_tasks = sum(1 for task in tasks if task.status == "Completed")
    open_tasks = sum(1 for task in tasks if task.status != "Completed")
    pending_approvals = sum(1 for task in tasks if task.approvalStatus == "Pending")

    overdue_tasks = 0
    today = datetime.now(UTC).date()
    for task in tasks:
        if task.status == "Completed" or not task.dueDate:
            continue
        try:
            if datetime.fromisoformat(task.dueDate).date() < today:
                overdue_tasks += 1
        except ValueError:
            continue

    by_user: dict[str, dict[str, Any]] = {}
    for session in sessions:
        bucket = by_user.setdefault(
            session.username,
            {
                "sessionCount": 0,
                "durationSeconds": 0,
                "activeDurationSeconds": 0,
                "idleDurationSeconds": 0,
                "billableSeconds": 0,
                "administrativeSeconds": 0,
            },
        )
        bucket["sessionCount"] += 1
        bucket["durationSeconds"] += session.durationSeconds
        bucket["activeDurationSeconds"] += session.activeSeconds
        bucket["idleDurationSeconds"] += session.idleSeconds
        bucket["billableSeconds"] += session.billableSeconds
        bucket["administrativeSeconds"] += session.administrativeSeconds

    efficiency_by_user: dict[str, dict[str, Any]] = {}
    for username, bucket in by_user.items():
        user_completed_tasks = sum(1 for task in tasks if usernames_match(task.staff, username) and task.status == "Completed")
        efficiency_by_user[username] = {
            **bucket,
            "completedTasks": user_completed_tasks,
            "durationHours": round(bucket["durationSeconds"] / 3600, 2),
            "activeRatio": round((bucket["activeDurationSeconds"] / max(1, bucket["durationSeconds"])) * 100, 2),
            "efficiencyScore": round(((user_completed_tasks * 3600) + bucket["activeDurationSeconds"]) / max(1, bucket["durationSeconds"]), 2),
        }

    return {
        "sessionCount": len(sessions),
        "taskCount": len(tasks),
        "durationSeconds": total_duration,
        "activeDurationSeconds": active_duration,
        "idleDurationSeconds": idle_duration,
        "billableSeconds": billable_duration,
        "administrativeSeconds": administrative_duration,
        "completedTasks": completed_tasks,
        "openTasks": open_tasks,
        "pendingApprovalTasks": pending_approvals,
        "overdueTasks": overdue_tasks,
        "efficiencyByUser": efficiency_by_user,
    }


def reassign_tasks(source_username: str, target_username: str, actor_name: str, include_completed: bool) -> list[int]:
    changed_ids: list[int] = []
    changed_at = datetime.now(UTC)
    for task_id, task in list(store.tasks.items()):
        if not usernames_match(task.staff, source_username):
            continue
        if not include_completed and task.status == "Completed":
            continue
        updated = task.model_copy(
            update={
                "staff": normalize_task_staff_value(target_username),
                "updatedAt": changed_at,
                "version": task.version + 1,
            }
        )
        updated.activityLog.append(
            ActivityEntry(
                action=f"Reassigned from {source_username} to {target_username}",
                user=actor_name,
                timestamp=changed_at,
            )
        )
        store.tasks[task_id] = updated
        changed_ids.append(task_id)
    return changed_ids


def resolve_admin_user(access_token: str | None, authorization: str | None) -> tuple[UserProfile, str]:
    token = ""
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    if not token and access_token:
        token = access_token.strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")

    try:
        user = store.user_from_token(token)
    except UnauthorizedError as error:
        raise HTTPException(status_code=401, detail=str(error)) from error

    if not role_capabilities(user.role).get("viewOverview", False):
        raise HTTPException(status_code=403, detail="Admin or manager role required")

    return user, token


def current_admin_user(authorization: str | None = Header(default=None, alias="Authorization")) -> UserProfile:
    user, _ = resolve_admin_user(None, authorization)
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
    return build_response(
        {
            "status": "ok",
            "stateDriver": store.state_driver,
            "stateDriverNote": store.state_driver_note,
            "stateDriverDebug": store.env_debug,
        },
        request,
    )


@app.post("/api/v1/testing/reset-state", response_model=APIResponse)
def testing_reset_state(request: Request):
    if store.state_driver != "file":
        raise HTTPException(status_code=400, detail="State reset is supported only in file mode")

    seed_path = store.state_file.with_name("state_store.seed.json")
    if not seed_path.exists():
        raise HTTPException(status_code=404, detail="Seed state file not found")

    store.state_file.write_text(seed_path.read_text(encoding="utf-8"), encoding="utf-8")
    store.reload_state()
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
    authorization: str | None = Header(default=None, alias="Authorization"),
    access_token: str | None = Query(default=None, alias="accessToken"),
):
    admin, token = resolve_admin_user(access_token, authorization)
    now = datetime.now(UTC)
    sessions = sorted(store.sessions.values(), key=lambda item: item.loginTime, reverse=True)[:2000]
    tasks = sorted(store.tasks.values(), key=lambda item: item.updatedAt, reverse=True)[:2000]
    bootstrap: dict[str, Any] = {
        "generatedAt": now.isoformat(),
        "currentAdmin": {
            "username": admin.username,
            "name": admin.name,
            "role": normalized_role(admin.role),
            "accessLevel": role_access_label(admin.role),
            "capabilities": role_capabilities(admin.role),
        },
        "snapshot": build_operations_snapshot(sessions, tasks),
        "sessions": [item.model_dump(mode="json") for item in sessions],
        "tasks": [item.model_dump(mode="json") for item in tasks],
        "presence": [item.model_dump(mode="json") for item in store.presence.values()],
        "users": build_user_directory(),
        "savedFilters": store.saved_filter_sets,
        "automationRules": store.automation_rules,
        "reportSchedules": list_report_schedules(),
    }
    bootstrap_json = json.dumps(bootstrap).replace("</", "<\\/")

    html = ADMIN_PORTAL_TEMPLATE.read_text(encoding="utf-8")
    html = html.replace("__BOOTSTRAP_JSON__", bootstrap_json)
    html = html.replace("__WERUNOPS_ADMIN_TOKEN__", token)
    return HTMLResponse(content=html)


@app.get("/admin/portal", response_class=HTMLResponse)
def admin_portal_alias(
    authorization: str | None = Header(default=None, alias="Authorization"),
    access_token: str | None = Query(default=None, alias="accessToken"),
):
    return admin_portal(authorization=authorization, access_token=access_token)


@app.get("/api/v1/admin/operations", response_model=APIResponse)
def admin_operations(
    request: Request,
    username: str | None = Query(default=None),
    from_date: str | None = Query(default=None),
    to_date: str | None = Query(default=None),
    status: str | None = Query(default=None),
    task_search: str | None = Query(default=None),
    project: str | None = Query(default=None),
    category: str | None = Query(default=None),
    approval_status: str | None = Query(default=None),
    _: UserProfile = Depends(current_admin_user),
):
    sessions = sorted(store.sessions.values(), key=lambda item: item.loginTime, reverse=True)
    tasks = list(store.tasks.values())

    if username:
        sessions = [item for item in sessions if item.username == username]
        tasks = [item for item in tasks if usernames_match(item.staff, username)]

    if from_date:
        start = datetime.fromisoformat(from_date)
        sessions = [item for item in sessions if item.loginTime.replace(tzinfo=None) >= start]

    if to_date:
        end = datetime.fromisoformat(to_date)
        sessions = [item for item in sessions if item.loginTime.replace(tzinfo=None) <= end]

    if status:
        tasks = [item for item in tasks if item.status == status]

    if project:
        tasks = [item for item in tasks if (item.project or "") == project]
        sessions = [item for item in sessions if (item.projectTag or "") == project]

    if category:
        tasks = [item for item in tasks if (item.operationalCategory or "") == category]
        sessions = [item for item in sessions if (item.operationalCategory or "") == category]

    if approval_status:
        tasks = [item for item in tasks if item.approvalStatus == approval_status]

    if task_search:
        needle = task_search.lower()
        tasks = [
            item
            for item in tasks
            if needle in item.task.lower()
            or needle in item.client.lower()
            or needle in item.staff.lower()
            or needle in (item.project or "").lower()
            or needle in (item.operationalCategory or "").lower()
        ]

    payload = build_operations_snapshot(sessions, tasks)
    payload.update(
        {
            "recentSessions": [session.model_dump(mode="json") for session in sessions[:200]],
            "tasks": [task.model_dump(mode="json") for task in tasks[:300]],
        }
    )
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
    return build_response(build_user_directory(), request)


@app.patch("/api/v1/admin/users/{username}/role", response_model=APIResponse)
async def admin_update_user_role(username: str, request: Request, admin: UserProfile = Depends(current_admin_user)):
    require_admin_capability(admin, "manageRoles")
    payload = await request.json()
    role = normalized_role(str(payload.get("role") or "").strip())
    allowed = {"Admin", "Manager", "User"}
    if role not in allowed:
        raise HTTPException(status_code=400, detail="Invalid role")

    user = store.users.get(username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if username == admin.username and role != "Admin":
        raise HTTPException(status_code=400, detail="You cannot remove your own super admin access")

    previous = user.get("role")
    user["role"] = role
    store.save_state()
    admin_log_event(admin, "user_role_updated", {"username": username, "from": previous, "to": role})
    return build_response({"ok": True, "username": username, "role": role, "accessLevel": role_access_label(role)}, request)


@app.post("/api/v1/admin/users", response_model=APIResponse)
async def admin_create_user(request: Request, admin: UserProfile = Depends(current_admin_user)):
    require_admin_capability(admin, "manageUsers")
    payload = await request.json()
    username = str(payload.get("username") or "").strip()
    name = str(payload.get("name") or "").strip()
    password = str(payload.get("password") or "").strip()
    role = normalized_role(str(payload.get("role") or "User"))
    department = str(payload.get("department") or "").strip()
    timezone = str(payload.get("timezone") or "UTC").strip() or "UTC"
    initials_source = str(payload.get("initials") or name or username).strip()

    if not username or not name or not password:
        raise HTTPException(status_code=400, detail="Username, name, and password are required")
    if username in store.users:
        raise HTTPException(status_code=409, detail="User already exists")

    store.users[username] = {
        "username": username,
        "passwordHash": sha256_hex(password),
        "name": name,
        "role": role,
        "initials": (initials_source[:1] or username[:1]).upper(),
        "department": department,
        "timezone": timezone,
        "isActive": True,
    }
    store.save_state()
    admin_log_event(admin, "user_created", {"username": username, "role": role, "department": department})
    return build_response(serialize_admin_user(username, store.users[username]), request)


@app.patch("/api/v1/admin/users/{username}", response_model=APIResponse)
async def admin_update_user_profile(username: str, request: Request, admin: UserProfile = Depends(current_admin_user)):
    require_admin_capability(admin, "manageUsers")
    user = store.users.get(username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    payload = await request.json()
    reassign_to = str(payload.get("reassignTo") or "").strip()
    password = str(payload.get("password") or "").strip()
    deactivating = "isActive" in payload and not coerce_bool(payload.get("isActive"))
    if deactivating and username == admin.username:
        raise HTTPException(status_code=400, detail="You cannot deactivate your own account")

    reassigned_task_ids: list[int] = []
    open_tasks = [task.id for task in store.tasks.values() if usernames_match(task.staff, username) and task.status != "Completed"]
    if deactivating and open_tasks:
        if not reassign_to:
            raise HTTPException(status_code=400, detail="Reassign target required before deactivating a user with open tasks")
        if reassign_to not in store.users:
            raise HTTPException(status_code=404, detail="Reassign target not found")
        reassigned_task_ids = reassign_tasks(username, reassign_to, admin.name, include_completed=False)

    if "name" in payload:
        user["name"] = str(payload.get("name") or user.get("name") or username).strip() or username
    if "department" in payload:
        user["department"] = str(payload.get("department") or "").strip()
    if "timezone" in payload:
        user["timezone"] = str(payload.get("timezone") or "UTC").strip() or "UTC"
    if "initials" in payload:
        initials = str(payload.get("initials") or "").strip()
        user["initials"] = (initials[:1] or str(user.get("name") or username)[:1]).upper()
    if "isActive" in payload:
        user["isActive"] = coerce_bool(payload.get("isActive"))
    if password:
        user["passwordHash"] = sha256_hex(password)

    store.save_state()
    admin_log_event(
        admin,
        "user_profile_updated",
        {"username": username, "reassignedTaskIds": reassigned_task_ids, "isActive": user.get("isActive", True)},
    )
    response = serialize_admin_user(username, user)
    if response is None:
        raise HTTPException(status_code=500, detail="Unable to serialize user")
    response["reassignedTaskIds"] = reassigned_task_ids
    return build_response(response, request)


@app.post("/api/v1/admin/users/{username}/reassign", response_model=APIResponse)
async def admin_reassign_user_tasks(username: str, request: Request, admin: UserProfile = Depends(current_admin_user)):
    require_admin_capability(admin, "manageTasks")
    if username not in store.users:
        raise HTTPException(status_code=404, detail="Source user not found")

    payload = await request.json()
    target_username = str(payload.get("reassignTo") or "").strip()
    include_completed = coerce_bool(payload.get("includeCompleted", False))
    if not target_username:
        raise HTTPException(status_code=400, detail="Reassign target is required")
    if target_username not in store.users:
        raise HTTPException(status_code=404, detail="Reassign target not found")

    changed_ids = reassign_tasks(username, target_username, admin.name, include_completed=include_completed)
    store.save_state()
    admin_log_event(admin, "tasks_reassigned", {"from": username, "to": target_username, "taskIds": changed_ids})
    return build_response({"from": username, "to": target_username, "taskIds": changed_ids, "count": len(changed_ids)}, request)


@app.get("/api/v1/admin/project-map", response_model=APIResponse)
def admin_project_map(request: Request, _: UserProfile = Depends(current_admin_user)):
    return build_response(build_project_map(list(store.tasks.values())), request)


@app.patch("/api/v1/admin/tasks/{task_id}/approval", response_model=APIResponse)
async def admin_update_task_approval(task_id: int, request: Request, admin: UserProfile = Depends(current_admin_user)):
    require_admin_capability(admin, "approveTasks")
    task = store.tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    payload = await request.json()
    approval_status = str(payload.get("approvalStatus") or "").strip()
    allowed = {"Pending", "Approved", "Rejected", "Not Required"}
    if approval_status not in allowed:
        raise HTTPException(status_code=400, detail="Invalid approval status")

    now = datetime.now(UTC)
    updated = task.model_copy(
        update={
            "approvalStatus": approval_status,
            "approvedBy": admin.name if approval_status in {"Approved", "Rejected"} else None,
            "approvedAt": now if approval_status in {"Approved", "Rejected"} else None,
            "updatedAt": now,
            "version": task.version + 1,
        }
    )
    updated.activityLog.append(ActivityEntry(action=f"Approval set to {approval_status}", user=admin.name, timestamp=now))
    store.tasks[task_id] = updated
    store.save_state()
    admin_log_event(admin, "task_approval_updated", {"taskId": task_id, "approvalStatus": approval_status})
    return build_response(updated.model_dump(), request)


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
    require_admin_capability(admin, "manageTasks")
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
    project = str(payload.get("project") or "").strip()
    category = str(payload.get("operationalCategory") or "").strip()
    approval_status = str(payload.get("approvalStatus") or "").strip()

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
            updates["staff"] = normalize_task_staff_value(staff)
        if project:
            updates["project"] = project
        if category:
            updates["operationalCategory"] = category
        if approval_status:
            updates["approvalStatus"] = approval_status
            updates["approvedBy"] = admin.name if approval_status in {"Approved", "Rejected"} else None
            updates["approvedAt"] = datetime.now(UTC) if approval_status in {"Approved", "Rejected"} else None
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


@app.get("/api/v1/admin/report-schedules", response_model=APIResponse)
def admin_report_schedules(request: Request, _: UserProfile = Depends(current_admin_user)):
    return build_response(list_report_schedules(), request)


@app.post("/api/v1/admin/report-schedules", response_model=APIResponse)
async def admin_create_report_schedule(request: Request, admin: UserProfile = Depends(current_admin_user)):
    require_admin_capability(admin, "scheduleReports")
    payload = cast(dict[str, Any], await request.json())
    name = str(payload.get("name") or "").strip()
    trigger = str(payload.get("trigger") or "manual").strip() or "manual"
    report_name = str(payload.get("reportName") or "weekly-summary").strip() or "weekly-summary"
    fmt = str(payload.get("format") or "json").strip() or "json"
    recipients_raw: Any = payload.get("recipients")
    recipients_source = cast(list[Any], recipients_raw) if isinstance(recipients_raw, list) else []
    recipients = [str(item).strip() for item in recipients_source if str(item).strip()]
    if not name:
        raise HTTPException(status_code=400, detail="Schedule name is required")

    schedule: dict[str, Any] = {
        "id": f"report_schedule_{uuid.uuid4().hex[:10]}",
        "name": name,
        "trigger": trigger,
        "action": "send_report",
        "enabled": True,
        "reportName": report_name,
        "format": fmt,
        "recipients": recipients,
    }
    store.automation_rules.append(schedule)
    store.save_state()
    admin_log_event(admin, "report_schedule_created", {"id": schedule["id"], "reportName": report_name})
    return build_response(schedule, request)


@app.delete("/api/v1/admin/report-schedules/{schedule_id}", response_model=APIResponse)
def admin_delete_report_schedule(schedule_id: str, request: Request, admin: UserProfile = Depends(current_admin_user)):
    require_admin_capability(admin, "scheduleReports")
    before = len(store.automation_rules)
    store.automation_rules = [
        rule for rule in store.automation_rules if not (str(rule.get("id") or "") == schedule_id and str(rule.get("action") or "") == "send_report")
    ]
    deleted = len(store.automation_rules) != before
    if deleted:
        store.save_state()
        admin_log_event(admin, "report_schedule_deleted", {"id": schedule_id})
    return build_response({"deleted": deleted, "id": schedule_id}, request)


@app.patch("/api/v1/admin/automation-rules/{rule_id}/toggle", response_model=APIResponse)
def admin_toggle_rule(rule_id: str, request: Request, admin: UserProfile = Depends(current_admin_user)):
    require_admin_capability(admin, "manageAutomation")
    for rule in store.automation_rules:
        if str(rule.get("id")) == rule_id:
            rule["enabled"] = not bool(rule.get("enabled"))
            store.save_state()
            admin_log_event(admin, "automation_rule_toggled", {"ruleId": rule_id, "enabled": rule["enabled"]})
            return build_response(rule, request)
    raise HTTPException(status_code=404, detail="Rule not found")


@app.post("/api/v1/admin/scheduled-actions/run", response_model=APIResponse)
def admin_run_scheduled_actions(request: Request, admin: UserProfile = Depends(current_admin_user)):
    require_admin_capability(admin, "manageAutomation")
    archived = 0
    threshold = datetime.now(UTC) - timedelta(days=30)
    for task in store.tasks.values():
        if task.status == "Completed" and task.updatedAt < threshold:
            archived += 1

    result: dict[str, Any] = {
        "archivedCandidates": archived,
        "rulesEvaluated": len(store.automation_rules),
        "scheduledReportsQueued": sum(
            1 for rule in store.automation_rules if str(rule.get("action") or "") == "send_report" and bool(rule.get("enabled", True))
        ),
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

    if report_name == "login-history":
        username = str(request.query_params.get("username") or "").strip()
        scoped_sessions = [item for item in sessions if not username or item.username == username]
        payload = build_operations_snapshot(scoped_sessions, tasks)
        payload.update(
            {
                "report": report_name,
                "username": username or None,
                "sessions": [item.model_dump(mode="json") for item in scoped_sessions[:500]],
            }
        )
        return build_response(payload, request)

    if report_name == "staff-utilization":
        days = max(1, min(90, int(request.query_params.get("days") or "30")))
        from_day = today - timedelta(days=days)
        scoped_sessions = [item for item in sessions if item.loginTime.date() >= from_day]
        by_user: dict[str, dict[str, Any]] = {}
        for item in scoped_sessions:
            bucket = by_user.setdefault(
                item.username,
                {"durationSeconds": 0, "activeSeconds": 0, "billableSeconds": 0, "administrativeSeconds": 0, "sessionCount": 0},
            )
            bucket["durationSeconds"] += item.durationSeconds
            bucket["activeSeconds"] += item.activeSeconds
            bucket["billableSeconds"] += item.billableSeconds
            bucket["administrativeSeconds"] += item.administrativeSeconds
            bucket["sessionCount"] += 1
        for username, bucket in by_user.items():
            bucket["activeRatio"] = round((bucket["activeSeconds"] / max(1, bucket["durationSeconds"])) * 100, 2)
            bucket["durationHours"] = round(bucket["durationSeconds"] / 3600, 2)
            bucket["billableHours"] = round(bucket["billableSeconds"] / 3600, 2)
            bucket["administrativeHours"] = round(bucket["administrativeSeconds"] / 3600, 2)
            bucket["openTasks"] = sum(1 for task in tasks if usernames_match(task.staff, username) and task.status != "Completed")
        return build_response({"report": report_name, "from": from_day.isoformat(), "to": today.isoformat(), "byUser": by_user}, request)

    if report_name == "project-billing":
        scoped_sessions = sessions
        by_project: dict[str, dict[str, Any]] = {}
        for item in scoped_sessions:
            project = (item.projectTag or "").strip() or "Unmapped"
            bucket = by_project.setdefault(
                project,
                {"sessionCount": 0, "durationSeconds": 0, "billableSeconds": 0, "administrativeSeconds": 0, "categories": set()},
            )
            bucket["sessionCount"] += 1
            bucket["durationSeconds"] += item.durationSeconds
            bucket["billableSeconds"] += item.billableSeconds
            bucket["administrativeSeconds"] += item.administrativeSeconds
            if item.operationalCategory:
                cast(set[str], bucket["categories"]).add(item.operationalCategory)
        for task in tasks:
            project = (task.project or "").strip() or "Unmapped"
            bucket = by_project.setdefault(
                project,
                {"sessionCount": 0, "durationSeconds": 0, "billableSeconds": 0, "administrativeSeconds": 0, "categories": set()},
            )
            if task.operationalCategory:
                cast(set[str], bucket["categories"]).add(task.operationalCategory)
        normalized = {
            project: {
                **{key: value for key, value in bucket.items() if key != "categories"},
                "durationHours": round(cast(int, bucket["durationSeconds"]) / 3600, 2),
                "billableHours": round(cast(int, bucket["billableSeconds"]) / 3600, 2),
                "administrativeHours": round(cast(int, bucket["administrativeSeconds"]) / 3600, 2),
                "categories": sorted(cast(set[str], bucket["categories"])),
            }
            for project, bucket in by_project.items()
        }
        return build_response({"report": report_name, "byProject": normalized}, request)

    if report_name == "task-approvals":
        grouped = {
            "Pending": [task.model_dump(mode="json") for task in tasks if task.approvalStatus == "Pending"],
            "Approved": [task.model_dump(mode="json") for task in tasks if task.approvalStatus == "Approved"],
            "Rejected": [task.model_dump(mode="json") for task in tasks if task.approvalStatus == "Rejected"],
            "Not Required": [task.model_dump(mode="json") for task in tasks if task.approvalStatus == "Not Required"],
        }
        return build_response({"report": report_name, "counts": {key: len(value) for key, value in grouped.items()}, "groups": grouped}, request)

    raise HTTPException(status_code=404, detail="Unknown report")


@app.get("/api/v1/admin/audit-logs", response_model=APIResponse)
def admin_audit_logs(request: Request, admin: UserProfile = Depends(current_admin_user)):
    require_admin_capability(admin, "viewAudit")
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
    user: UserProfile = Depends(current_user),
):
    records = visible_tasks_for_user(user)
    if status:
        records = [task for task in records if task.status == status]
    if staff:
        records = [task for task in records if usernames_match(task.staff, staff)]
    if client:
        records = [task for task in records if task.client == client]
    return build_response([task.model_dump() for task in records], request)


@app.get("/api/v1/tasks/{task_id}", response_model=APIResponse)
def get_task(task_id: int, request: Request, user: UserProfile = Depends(current_user)):
    task = store.tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    ensure_user_can_access_task(task, user)
    return build_response(task.model_dump(), request)


@app.post("/api/v1/tasks", response_model=APIResponse)
def create_task(payload: TaskCreate, request: Request, user: UserProfile = Depends(current_user)):
    if not user_can_create_tasks(user):
        raise HTTPException(status_code=403, detail="You do not have access to create tasks")

    if payload.parentId is not None:
        parent_task = store.tasks.get(payload.parentId)
        if not parent_task:
            raise HTTPException(status_code=404, detail="Parent task not found")
        ensure_user_can_access_task(parent_task, user)

    task_id = store.next_task_id
    store.next_task_id += 1
    now = datetime.now(UTC)
    task_payload = payload.model_dump()
    task_payload["staff"] = normalize_specialist_task_staff(task_payload.get("staff"), user)
    task = TaskOut(
        id=task_id,
        **task_payload,
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
def restore_task(payload: TaskRestoreRequest, request: Request, user: UserProfile = Depends(current_user)):
    require_privileged_user(user, "Only system administrators and operations managers can restore tasks")
    task = payload.task.model_copy(update={"staff": normalize_task_staff_value(payload.task.staff)})
    store.mark_task_restored(task.id)
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
    ensure_user_can_access_task(task, user)
    if not user_can_edit_task_details(task, user):
        raise HTTPException(status_code=403, detail="Operations Specialists can only edit tasks they created")
    ensure_task_not_locked_by_other(task_id, user)
    if task.version != payload.version:
        raise HTTPException(status_code=409, detail={"code": "TASK_CONFLICT", "latest": jsonable_encoder(task.model_dump())})

    update_payload = payload.model_dump(exclude={"version"})
    if update_payload.get("parentId") is not None:
        parent_task = store.tasks.get(cast(int, update_payload.get("parentId")))
        if not parent_task:
            raise HTTPException(status_code=404, detail="Parent task not found")
        ensure_user_can_access_task(parent_task, user)
    update_payload["staff"] = normalize_specialist_task_staff(update_payload.get("staff"), user)
    updated = task.model_copy(update={**update_payload, "version": task.version + 1, "updatedAt": datetime.now(UTC)})
    updated.activityLog.append(ActivityEntry(action="Task updated", user=user.name, timestamp=datetime.now(UTC)))
    store.tasks[task_id] = updated
    store.save_state()
    return build_response(updated.model_dump(), request)


@app.patch("/api/v1/tasks/{task_id}/status", response_model=APIResponse)
def patch_task_status(task_id: int, payload: TaskStatusPatch, request: Request, user: UserProfile = Depends(current_user)):
    task = store.tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    ensure_user_can_access_task(task, user)
    if not user_can_update_task_status(task, user, payload.status):
        raise HTTPException(status_code=403, detail="Operations Specialists can only mark assigned tasks as completed unless they created the task")
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
    task = store.tasks.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    ensure_user_can_access_task(task, user)
    if not user_can_delete_task(task, user):
        raise HTTPException(status_code=403, detail="Operations Specialists can only delete tasks they created")
    ensure_task_not_locked_by_other(task_id, user)
    store.mark_task_deleted(task_id)
    store.tasks.pop(task_id)
    store.task_locks.pop(task_id, None)
    store.save_state()
    return build_response({"deleted": True, "taskId": task_id}, request)


@app.post("/api/v1/tasks/bulk-delete", response_model=APIResponse)
def bulk_delete_tasks(payload: BulkDeleteRequest, request: Request, user: UserProfile = Depends(current_user)):
    deleted = 0
    for task_id in payload.taskIds:
        task = store.tasks.get(task_id)
        if not task:
            continue
        ensure_user_can_access_task(task, user)
        if not user_can_delete_task(task, user):
            raise HTTPException(status_code=403, detail="Operations Specialists can only delete tasks they created")
        ensure_task_not_locked_by_other(task_id, user)
        store.mark_task_deleted(task_id)
        store.tasks.pop(task_id)
        store.task_locks.pop(task_id, None)
        deleted += 1
    if deleted:
        store.save_state()
    return build_response({"deleted": deleted}, request)


@app.get("/api/v1/clients", response_model=APIResponse)
def list_clients(request: Request, user: UserProfile = Depends(current_user)):
    return build_response([client.model_dump() for client in visible_clients_for_user(user)], request)


@app.post("/api/v1/clients", response_model=APIResponse)
def create_client(payload: ClientCreate, request: Request, user: UserProfile = Depends(current_user)):
    require_privileged_user(user, "Only system administrators and operations managers can create clients")
    client_id = store.next_client_id
    store.next_client_id += 1
    client = ClientOut.model_validate({"id": client_id, "version": 1, **payload.model_dump()})
    store.clients[client_id] = client
    store.save_state()
    return build_response(client.model_dump(), request)


@app.put("/api/v1/clients/{client_id}", response_model=APIResponse)
def update_client(client_id: int, payload: ClientUpdate, request: Request, user: UserProfile = Depends(current_user)):
    require_privileged_user(user, "Only system administrators and operations managers can edit clients")
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
def delete_client(client_id: int, request: Request, user: UserProfile = Depends(current_user)):
    require_privileged_user(user, "Only system administrators and operations managers can delete clients")
    client = store.clients.get(client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    has_tasks = any(task.client == client.name and task.status != "Completed" for task in store.tasks.values())
    if has_tasks:
        raise HTTPException(status_code=400, detail="Client has active tasks")

    store.mark_client_deleted(client_id)
    store.clients.pop(client_id)
    store.save_state()
    return build_response({"deleted": True, "clientId": client_id}, request)


@app.put("/api/v1/presence/me", response_model=APIResponse)
def set_presence(payload: PresenceMeRequest, request: Request, user: UserProfile = Depends(current_user)):
    status = normalized_presence_status(payload.status)
    if status == "online" and not coerce_bool(payload.online):
        status = "offline"
    record = PresenceOut(
        username=user.username,
        online=status != "offline",
        status=status,
        lastSeen=datetime.now(UTC),
        browser=payload.browser,
        device=payload.device,
    )
    store.presence[user.username] = record
    store.save_state()
    return build_response(record.model_dump(), request)


@app.get("/api/v1/presence", response_model=APIResponse)
def list_presence(request: Request, user: UserProfile = Depends(current_user)):
    return build_response([value.model_dump() for value in visible_presence_for_user(user)], request)


@app.post("/api/v1/sessions/start", response_model=APIResponse)
def start_session(payload: SessionStartRequest, request: Request, user: UserProfile = Depends(current_user)):
    session_id = f"sess_{uuid.uuid4().hex[:12]}"
    session = SessionOut(
        id=session_id,
        username=user.username,
        loginTime=datetime.now(UTC),
        browser=payload.browser,
        device=payload.device,
        projectTag=payload.projectTag,
        operationalCategory=payload.operationalCategory,
        billableSeconds=payload.billableSeconds,
        administrativeSeconds=payload.administrativeSeconds,
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
    user: UserProfile = Depends(current_user),
):
    sessions = scoped_sessions_for_user(user, username)
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
    user: UserProfile = Depends(current_user),
):
    sessions = scoped_sessions_for_user(user, username)

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
def dashboard_metrics(request: Request, user: UserProfile = Depends(current_user)):
    tasks = visible_tasks_for_user(user)
    open_count = sum(1 for item in tasks if item.status != "Completed")
    in_progress_count = sum(1 for item in tasks if item.status == "In Progress")
    completed_count = sum(1 for item in tasks if item.status == "Completed")

    now_date = datetime.now(UTC).date().isoformat()
    overdue_count = sum(1 for item in tasks if item.status != "Completed" and item.dueDate and item.dueDate < now_date)

    presence = visible_presence_for_user(user)
    online_users = sum(1 for item in presence if item.online)

    today = datetime.now(UTC).date()
    hours_by_user: dict[str, int] = {}
    for session in scoped_sessions_for_user(user):
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
def export_sessions_csv(user: UserProfile = Depends(current_user)):
    lines = ["sessionId,username,loginTime,logoutTime,durationSeconds,activeSeconds,idleSeconds,browser,device"]
    for session in scoped_sessions_for_user(user):
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
def export_state(request: Request, user: UserProfile = Depends(current_user)):
    visible_tasks = visible_tasks_for_user(user)
    visible_clients = visible_clients_for_user(user, visible_tasks)
    payload = {
        "tasks": [item.model_dump(mode="json") for item in visible_tasks],
        "clients": [item.model_dump(mode="json") for item in visible_clients],
        "presence": [item.model_dump(mode="json") for item in visible_presence_for_user(user)],
        "sessions": [item.model_dump(mode="json") for item in scoped_sessions_for_user(user)],
    }
    return build_response(payload, request)
