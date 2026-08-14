-- Phase 33: Add "midweek" as a valid event_type — the app already
-- offered it as an option, but the database constraint never allowed
-- it, so marking midweek attendance would have failed silently at the
-- database level.
-- Run after 39_announcement_read_receipts.sql.

alter table attendance_records drop constraint attendance_records_event_type_check;
alter table attendance_records add constraint attendance_records_event_type_check
  check (event_type in ('sunday', 'midweek', 'tuesday', 'saturday'));

alter table cover_requests drop constraint cover_requests_event_type_check;
alter table cover_requests add constraint cover_requests_event_type_check
  check (event_type in ('sunday', 'midweek', 'tuesday', 'saturday'));
