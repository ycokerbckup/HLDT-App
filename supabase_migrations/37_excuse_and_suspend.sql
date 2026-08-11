-- Phase 30: Excuse-within-24h, Operations suspension alert, member
-- suspension field.
-- Run after 36_attendance_discipline.sql.

-- ============================================================
-- Excusing an absence — separate from the general attendance UPDATE
-- policy (which stays unrestricted for the normal marking flow). This
-- one is deliberately narrower: Operations/Admin only, and only within
-- 24 hours of the record being created.
-- ============================================================
create or replace function public.excuse_attendance(p_record_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  rec record;
begin
  if not public.is_roster_manager() then
    raise exception 'Only Operations or Admin can excuse an absence.';
  end if;

  select * into rec from attendance_records where id = p_record_id;
  if rec is null then
    raise exception 'Record not found.';
  end if;
  if rec.status <> 'absent' then
    raise exception 'Only an absence can be excused.';
  end if;
  if rec.created_at < now() - interval '24 hours' then
    raise exception 'Too late to excuse this — the 24 hour window has passed.';
  end if;

  update attendance_records set status = 'excused' where id = p_record_id;
end;
$$;

grant execute on function public.excuse_attendance(uuid) to authenticated;

-- ============================================================
-- On the 4th miss this month, Operations admins get told to action a
-- suspension (separate from the member's own notice, which already
-- fires from the phase-29 trigger).
-- ============================================================
create or replace function public.check_attendance_discipline()
returns trigger as $$
declare
  this_month text := to_char(new.event_date, 'YYYY-MM');
  total_absent int;
  recent_statuses text[];
  member_name text;
begin
  if new.status <> 'absent' then
    return new;
  end if;

  select name into member_name from members where id = new.member_id;

  select count(*) into total_absent from attendance_records
  where member_id = new.member_id and status = 'absent' and to_char(event_date, 'YYYY-MM') = this_month;

  select array_agg(status order by event_date desc) into recent_statuses
  from (
    select status, event_date from attendance_records
    where member_id = new.member_id and status in ('present', 'absent') and to_char(event_date, 'YYYY-MM') = this_month
    order by event_date desc limit 2
  ) x;

  if recent_statuses is not null and array_length(recent_statuses, 1) = 2
     and recent_statuses[1] = 'absent' and recent_statuses[2] = 'absent' then
    begin
      insert into attendance_warnings (member_id, month, tier) values (new.member_id, this_month, 'consecutive_2');
      perform public.notify_member_only(new.member_id, 'attendance_warning', 'Attendance warning',
        coalesce(member_name, 'Hi') || ', you''ve missed 2 events in a row. Please reach out if something''s come up — we''d rather know than guess.', 'attendance');
    exception when unique_violation then null;
    end;
  end if;

  if total_absent >= 3 then
    begin
      insert into attendance_warnings (member_id, month, tier) values (new.member_id, this_month, 'total_3');
      perform public.notify_member_only(new.member_id, 'attendance_warning', 'Attendance warning (2nd notice)',
        coalesce(member_name, 'Hi') || ', this is your 3rd missed event this month. Please reach out to your team lead.', 'attendance');
    exception when unique_violation then null;
    end;
  end if;

  if total_absent >= 4 then
    begin
      insert into attendance_warnings (member_id, month, tier) values (new.member_id, this_month, 'total_4');
      perform public.notify_member_only(new.member_id, 'attendance_suspension', 'Attendance: suspension notice',
        coalesce(member_name, 'Hi') || ', you''ve missed 4 events this month. Per team policy, this results in suspension. Please reach out to Operations to discuss.', 'attendance');
      perform public.notify_units(array['Operations'], 'suspension_action_needed',
        coalesce(member_name, 'A member') || ' has hit 4 missed events this month',
        'Please review and action a suspension in the Members tab if appropriate.', 'attendance');
    exception when unique_violation then null;
    end;
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- ============================================================
-- Suspension field on members, sitting alongside "unavailable".
-- ============================================================
alter table members add column if not exists suspended boolean not null default false;

drop view if exists members_directory;
create view members_directory as
  select id, name, unit, tier, team, join_date, email, phone, profile_id, unavailable, suspended
  from members;
grant select on members_directory to authenticated;
