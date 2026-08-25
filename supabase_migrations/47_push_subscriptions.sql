-- Phase 40: Push notification subscriptions. Each device a person
-- enables push on gets its own row (endpoint is unique per browser
-- install) — a person using the app on both their phone and laptop
-- gets pushed to both.
-- Run after 46_presence_heartbeat.sql.

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now()
);

alter table push_subscriptions enable row level security;

create policy "users manage own push subscriptions" on push_subscriptions
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- Tracked separately from "emailed" — push and email are independent
-- delivery channels that can succeed or fail independently.
alter table notifications add column if not exists pushed boolean not null default false;
