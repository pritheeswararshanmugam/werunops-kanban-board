# WeRunOps Complete App Overview

## 1) Purpose of the App

WeRunOps is an operations management platform for small teams that need a single workspace to:

- manage day-to-day tasks in a Kanban-style workflow,
- track clients and related work,
- monitor user activity, presence, and sessions,
- reduce data conflicts when multiple users edit at the same time,
- keep working even when internet connectivity is unstable.

The main business goal is operational visibility plus execution speed: users can create and move work quickly, while managers/admins get reporting, alerts, and control tools.

## 2) What the Product Includes

The product is split into two parts:

- Frontend web app (Vanilla JS + Tailwind via CDN) for daily operations.
- FastAPI backend for auth, persistence, syncing, locking, reporting, admin workflows, and exports.

It supports two practical runtime styles:

- Frontend-first/local mode for quick usage and offline support.
- Backend API mode for shared state, auth, multi-user consistency, session/presence tracking, and admin operations.

## 3) Core Functional Areas

### Authentication and User Identity

- Sign-in with username/password.
- Profile retrieval and token-based session handling.
- Logout and password change.
- Role-aware behavior (Admin, Manager, User).

### Task Management

- Create, read, update, delete tasks.
- Status transitions across workflow states:
  - New
  - In Progress
  - Waiting Client
  - Waiting Supplier
  - Follow Up
  - Completed
- Priority levels: High, Medium, Low.
- Activity log per task for traceability.
- Bulk delete support.
- Restore support for task snapshots.
- Optimistic concurrency with version checks to prevent silent overwrite.

### Task Locking and Multi-User Safety

- Task-level lock acquire/release endpoints.
- Lock conflict handling when another user owns a lock.
- Lock TTL and refresh behavior.
- UI lock awareness to avoid editing collisions.

### Kanban and Task Views
- Kanban board for drag-and-drop workflow movement.
- All Tasks view with filtering/search and quick actions.
- Today view for short-term execution focus.
- Undo/redo stack for recent task mutations.

### Client Management
- Create, edit, delete clients.
- Validation preventing client deletion when active tasks exist.
- Client-task relationship used throughout task creation and filtering.

### Presence and Session Tracking
- Set and list user presence (online/offline plus device/browser context).
- Session start, heartbeat, and end.
- Session duration split into active and idle seconds.
- Session-level reporting and CSV export support.

### Dashboard and Analytics
- Operational dashboard with metrics cards.
- Charts and summaries for team activity.
- Session analytics and performance-oriented indicators.
- Refreshable data panels for current status.

### Admin Portal
Admin users get a dedicated operations portal with:
- Overview metrics and heatmap/charts.
- Session filters and saved filter sets.
- Session/table exports (CSV/JSON).
- Task operations:
  - bulk update status/staff,
  - task comments,
  - task filtering/search.
- User role management.
- Automation rules list and toggle.
- Scheduled action trigger endpoint.
- Compliance/audit log view and export.
- Alerts endpoint for operational warnings (example: no login today, long sessions).
- Periodic reports (weekly summary, monthly attendance).

## 4) Data and Persistence Model

The backend store supports multiple drivers:
- file (local JSON state file),
- firebase (Realtime Database),
- supabase (REST table payload row).

Driver selection logic:
- explicit environment variable wins,
- otherwise auto-detects from available credentials,
- falls back to file mode when cloud credentials are missing.

Persisted entities include:
- users,
- tasks,
- clients,
- presence,
- sessions,
- task locks,
- admin audit logs,
- saved filters,
- automation rules,
- task comments,
- sequence counters (next task/client id).

## 5) Offline and Reliability Features

Frontend reliability features include:
- service worker registration,
- offline banner and status UI,
- offline action queue,
- failed-action retry/discard controls,
- replay of queued actions when connection returns.

This design allows users to keep working during connectivity issues and reconcile changes later.

## 6) Security and Access Control Behavior

- Bearer token auth for protected API routes.
- Admin-only endpoints enforced by role checks.
- Conflict and lock exceptions translated into API errors.
- Stateless token approach in backend store implementation.

Note: for production-grade hardening, teams typically add stronger token lifecycle controls, secrets rotation, and stricter password/auth policy.

## 7) API Surface (High-Level)

Primary API domains:
- Health and root discovery.
- Auth: login, me, logout, change-password.
- Tasks: CRUD, status patch, restore, bulk delete.
- Locks: list/acquire/release.
- Clients: CRUD.
- Presence: upsert/list.
- Sessions: start/heartbeat/end/list.
- Reports and dashboard metrics.
- Exports: sessions CSV, state export.
- Admin: operations data, alerts, users/roles, filters, bulk task updates, comments, automation rules, scheduled actions, reports, audit logs, portal page.

## 8) User Roles in Practice

- Admin:
  - full operational access,
  - admin portal access,
  - user role updates,
  - automation and compliance visibility.
- Manager:
  - operational task/client usage,
  - dashboard/monitoring participation.
- User:
  - day-to-day execution in tasks/kanban/sessions/presence.

## 9) Deployment and Environment Strategy

Typical intended setup:
- Frontend hosted as static site (GitHub Pages).
- Backend hosted on Vercel (Python serverless entrypoint).
- Data layer on Firebase or Supabase (file mode for local/dev and deterministic tests).

Runtime config allows team-level defaults for backend URL and feature flags, with optional restriction on user-side endpoint changes.

## 10) Testing Strategy

Automated E2E testing is set up using Playwright with:
- deterministic seeded backend state before runs,
- backend and frontend web servers started by Playwright,
- smoke and extended UI flows,
- targeted project splits for stability (bulk/timing/extended).

Covered scenarios include:
- sign-in and landing flow,
- creating and deleting tasks,
- full flow for adding/removing client and related task.

## 11) Overall Product Intent (Plain-English Summary)

WeRunOps is designed as a practical operations cockpit.
It combines task execution, collaboration safety, activity visibility, and admin governance in one app so teams can run daily work reliably, even with multi-user edits and occasional offline conditions.

If you want, this can be expanded into a second markdown file with:
- end-user SOPs by role,
- backend endpoint reference table,
- and a visual system architecture diagram.