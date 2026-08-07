-- Phase 25: Messages deletable within 5 minutes of sending, in addition
-- to the existing 5-minutes-after-being-seen window. Previously an
-- unseen message could never be deleted at all until someone viewed it.
-- Run after 31_fix_welfare_dues_write.sql.

drop policy "sender delete own message within 5 min of being seen" on messages;

create policy "sender delete own message within 5 min of send or seen" on messages for delete using (
  sender_id = auth.uid() and (
    created_at > now() - interval '5 minutes'
    or (seen_at is not null and seen_at > now() - interval '5 minutes')
  )
);
