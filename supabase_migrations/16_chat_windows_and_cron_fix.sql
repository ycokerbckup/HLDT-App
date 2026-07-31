-- Phase 11: Fix possibly-missing cron jobs, tighten edit window to 5
-- minutes, add a 5-minute post-seen delete window for senders.
-- Run after 15_chat_read_receipts_and_replies.sql.

-- ============================================================
-- Diagnostic: run this first and check the output before anything else.
-- If this returns zero rows, pg_cron was never actually enabled and
-- NONE of the scheduled cleanup jobs from earlier migrations exist —
-- that's very likely why messages/announcements/feed posts/rosters
-- haven't been auto-deleting.
--   select jobid, jobname, schedule, active from cron.job order by jobname;
-- ============================================================

-- Make sure the extension is actually there (safe to re-run).
create extension if not exists pg_cron;

-- Re-register every cleanup job. cron.schedule() upserts by job name, so
-- running this again is safe even if the jobs already existed correctly.
select cron.schedule('cleanup-old-announcements', '0 * * * *',
  $$ delete from announcements where created_at < now() - interval '7 days'; $$);

select cron.schedule('cleanup-old-messages', '0 * * * *',
  $$ delete from messages where seen_at is not null and seen_at < now() - interval '24 hours'; $$);

select cron.schedule('cleanup-old-feed-posts', '0 * * * *',
  $$ delete from feed_posts where created_at < now() - interval '30 days'; $$);

select cron.schedule('cleanup-past-rosters', '0 2 * * *',
  $$
    delete from tuesday_rosters where event_date < current_date;
    delete from saturday_rosters where event_date < current_date;
  $$);

select cron.schedule('daily-celebrations', '0 6 * * *',
  $$ select public.run_daily_celebrations(); $$);

-- ============================================================
-- Edit window: 5 minutes after sending (was 30).
-- ============================================================
drop policy "sender edit own message within 30 minutes" on messages;
create policy "sender edit own message within 5 minutes" on messages for update using (
  sender_id = auth.uid() and created_at > now() - interval '5 minutes'
);

-- ============================================================
-- New: sender can delete their own message, but only within 5 minutes
-- of it being seen (not 5 minutes after sending — after being *seen*).
-- Admin moderation delete (any message, any time) is unaffected.
-- ============================================================
create policy "sender delete own message within 5 min of being seen" on messages for delete using (
  sender_id = auth.uid() and seen_at is not null and seen_at > now() - interval '5 minutes'
);
