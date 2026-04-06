-- Run this in Supabase SQL Editor before deploying backend to Vercel.
-- Relational schema: each entity has its own table (no singleton payload cell).

begin;

create table if not exists public.werunops_users (
  username text primary key,
  password_hash text not null,
  name text not null,
  role text not null,
  initials text not null
);

create table if not exists public.werunops_clients (
  id bigint primary key,
  name text not null,
  contact text not null default '',
  email text not null default '',
  phone text not null default '',
  version integer not null default 1
);

create table if not exists public.werunops_tasks (
  id bigint primary key,
  client text not null,
  project text not null default '',
  task text not null,
  staff text not null,
  status text not null,
  priority text not null,
  start_date text not null default '',
  due_date text not null default '',
  waiting_for text not null default '',
  notes text not null default '',
  parent_id bigint,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  created_by text not null,
  version integer not null default 1
);

create table if not exists public.werunops_task_activity (
  task_id bigint not null,
  seq integer not null,
  action text not null,
  user_name text not null,
  timestamp timestamptz not null,
  primary key (task_id, seq),
  foreign key (task_id) references public.werunops_tasks(id) on delete cascade
);

create table if not exists public.werunops_presence (
  username text primary key,
  online boolean not null,
  last_seen timestamptz not null,
  browser text,
  device text
);

create table if not exists public.werunops_sessions (
  id text primary key,
  username text not null,
  login_time timestamptz not null,
  logout_time timestamptz,
  duration_seconds integer not null default 0,
  active_seconds integer not null default 0,
  idle_seconds integer not null default 0,
  browser text,
  device text
);

create table if not exists public.werunops_task_locks (
  task_id bigint primary key,
  locked_by text not null,
  locked_by_name text not null,
  acquired_at timestamptz not null,
  expires_at timestamptz not null
);

create table if not exists public.werunops_admin_audit_logs (
  seq integer primary key,
  timestamp timestamptz not null,
  admin text,
  admin_name text,
  action text not null,
  details_json jsonb not null default '{}'::jsonb
);

create table if not exists public.werunops_saved_filters (
  name text primary key,
  filters_json jsonb not null default '{}'::jsonb,
  position integer not null default 0,
  saved_at timestamptz,
  saved_by text
);

create table if not exists public.werunops_automation_rules (
  id text primary key,
  name text not null,
  trigger text not null,
  action text not null,
  enabled boolean not null default true,
  position integer not null default 0,
  metadata_json jsonb not null default '{}'::jsonb
);

create table if not exists public.werunops_task_comments (
  task_id bigint not null,
  seq integer not null,
  id text not null,
  comment text not null,
  user_name text not null,
  username text,
  timestamp timestamptz not null,
  primary key (task_id, seq)
);

create table if not exists public.werunops_deleted_tasks (
  task_id bigint primary key,
  deleted_at timestamptz not null default now()
);

create table if not exists public.werunops_deleted_clients (
  client_id bigint primary key,
  deleted_at timestamptz not null default now()
);

create table if not exists public.werunops_state_meta (
  key text primary key,
  value_text text not null
);

create index if not exists werunops_tasks_updated_at_idx on public.werunops_tasks (updated_at desc);
create index if not exists werunops_sessions_login_time_idx on public.werunops_sessions (login_time desc);
create index if not exists werunops_comments_task_idx on public.werunops_task_comments (task_id, seq);

commit;
