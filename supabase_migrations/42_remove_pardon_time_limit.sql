-- Phase 35: Remove the 24-hour limit on excusing/pardoning an absence.
-- Valid excuses that surface off-platform aren't bound to a 24-hour
-- window, so the restriction worked against the actual purpose of this
-- feature. Operations/Admin can now pardon an absence at any time.
-- Run after 41_fix_tour_persistence.sql.

create or replace function public.excuse_attendance(p_record_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  rec record;
begin
  if not public.is_roster_manager() then
    raise exception 'Only Operations or Admin can pardon an absence.';
  end if;

  select * into rec from attendance_records where id = p_record_id;
  if rec is null then
    raise exception 'Record not found.';
  end if;
  if rec.status <> 'absent' then
    raise exception 'Only an absence can be pardoned.';
  end if;

  update attendance_records set status = 'excused' where id = p_record_id;
end;
$$;
