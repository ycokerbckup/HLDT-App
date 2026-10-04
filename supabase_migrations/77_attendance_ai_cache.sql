-- Phase 69: Cache for AI attendance summaries. The AI text only
-- depends on the member's stats for the month, so as long as those
-- haven't changed, the last summary is still correct and can be served
-- straight from the database — no Gemini call, no waiting. Any new
-- attendance record changes the stats, which changes stats_key, which
-- invalidates the cache automatically.
--
-- RLS is enabled with no policies on purpose: only the edge function
-- (service role) reads or writes this table, never a client.
-- Run after 76_pin_change_otp.sql.

create table attendance_ai_cache (
  member_id uuid not null references members(id) on delete cascade,
  month text not null,
  stats_key text not null,
  summary text not null,
  recommendation text not null,
  reasoning text not null,
  created_at timestamptz default now(),
  primary key (member_id, month)
);
alter table attendance_ai_cache enable row level security;
