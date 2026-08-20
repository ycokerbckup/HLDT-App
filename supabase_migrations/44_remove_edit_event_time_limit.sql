-- Phase 37: Remove the 24-hour limit on correcting an attendance
-- batch's event type/date. Operations/Admin can now do this anytime.
-- Run after 43_edit_attendance_event.sql.

create or replace function public.edit_attendance_event(
  p_old_event_type text, p_old_event_date date, p_new_event_type text, p_new_event_date date
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_roster_manager() then
    raise exception 'Only Operations or Admin can edit a marked event.';
  end if;

  if not exists (
    select 1 from attendance_records
    where event_type = p_old_event_type and event_date = p_old_event_date
  ) then
    raise exception 'No matching attendance record found.';
  end if;

  update attendance_records
  set event_type = p_new_event_type, event_date = p_new_event_date
  where event_type = p_old_event_type and event_date = p_old_event_date;
end;
$$;
