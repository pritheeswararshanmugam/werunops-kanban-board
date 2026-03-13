-- Run this in Supabase SQL Editor before deploying backend to Vercel
create table if not exists public.werunops_state (
  id bigint primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

-- Keep one singleton row with id=1
insert into public.werunops_state (id, payload)
values (1, '{}'::jsonb)
on conflict (id) do nothing;

-- Optional index for JSON queries later
create index if not exists werunops_state_payload_gin
on public.werunops_state
using gin (payload);
