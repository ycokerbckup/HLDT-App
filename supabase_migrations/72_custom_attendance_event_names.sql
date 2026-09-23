-- Phase 65: Allow a custom event name for attendance marking, instead
-- of being limited to the 4 fixed types. Loosened from a fixed list
-- to a simple sanity check (non-empty, reasonable length) — the 4
-- existing types still satisfy this, nothing already recorded is
-- affected.
-- Run after 71_attendance_reminder_to_admin_unit.sql.

alter table attendance_records drop constraint attendance_records_event_type_check;
alter table attendance_records add constraint attendance_records_event_type_check
  check (length(trim(event_type)) > 0 and length(event_type) <= 60);
