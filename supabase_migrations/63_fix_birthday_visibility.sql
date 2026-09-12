-- Phase 56: Fix birthday celebration indicators not showing for
-- regular members viewing colleagues — DOB is deliberately excluded
-- from members_directory (it's sensitive), so there was nothing for
-- the celebration check to compare against for anyone except an
-- admin. Fix: expose only a computed yes/no ("is today their
-- birthday"), never the actual date — same narrow-scope approach as
-- the security audit's other fixes.
-- Run after 62_fix_cover_request_permission.sql.

drop view if exists members_directory;
create view members_directory as
  select
    id, name, unit, tier, team, join_date, email, phone, profile_id, unavailable, suspended,
    (dob = to_char((now() at time zone 'Africa/Lagos')::date, 'DD/MM')) as is_birthday_today
  from members;
grant select on members_directory to authenticated;
