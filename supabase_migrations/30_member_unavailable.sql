-- Phase 23: Temporarily-unavailable members.
-- Toggleable by Operations-unit admins only (same access as editing any
-- other member field — no new RLS policy needed, the existing members
-- UPDATE policy already restricts to admin+Operations).
-- Run after 29_checkin_hardcoded_ids.sql.

alter table members add column unavailable boolean not null default false;

drop view if exists members_directory;
create view members_directory as
  select id, name, unit, tier, team, join_date, email, phone, profile_id, unavailable
  from members;
grant select on members_directory to authenticated;
