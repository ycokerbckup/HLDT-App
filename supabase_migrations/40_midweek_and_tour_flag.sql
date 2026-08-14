-- Phase 33: Add mid-week service as an event type, and a flag to track
-- whether a user has seen the first-time walkthrough.
-- Run after 39_announcement_read_receipts.sql.

alter table attendance_records drop constraint attendance_records_event_type_check;
alter table attendance_records add constraint attendance_records_event_type_check
  check (event_type in ('sunday', 'tuesday', 'saturday', 'midweek'));

alter table cover_requests drop constraint cover_requests_event_type_check;
alter table cover_requests add constraint cover_requests_event_type_check
  check (event_type in ('sunday', 'tuesday', 'saturday', 'midweek'));

alter table profiles add column if not exists onboarding_tour_seen boolean not null default false;
