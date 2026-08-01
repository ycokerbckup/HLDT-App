-- Phase 19: Ticket deletion for Technical and Operations unit members.
-- Reuses the is_ops_or_tech() helper already built for feed management.
-- Run after 23_ai_quota_tracking.sql.

create policy "tech or ops delete tickets" on tickets for delete using (public.is_ops_or_tech());
