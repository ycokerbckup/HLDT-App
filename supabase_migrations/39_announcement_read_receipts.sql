-- Phase 32: Announcement read receipts for Welfare/Operations admins.
-- Adds an additional SELECT policy on notification_reads, scoped
-- narrowly to announcement-type notifications only — this does not
-- expose read state for DMs or any other notification type, just
-- announcements specifically.
-- Run after 38_chat_mentions.sql.

create policy "welfare ops view announcement read receipts" on notification_reads for select using (
  public.is_admin() and (public.is_operations() or public.is_welfare())
  and exists (
    select 1 from notifications n where n.id = notification_reads.notification_id and n.type = 'announcement'
  )
);
