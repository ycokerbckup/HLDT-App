-- Phase 36: Correct a mis-selected event on a recently marked
-- attendance batch (wrong date or wrong event type picked before
-- saving). Time-boxed to 24 hours — this is about catching a data-entry
-- mistake quickly, not forgiving something long after the fact the way
-- pardoning an individual absence is.
-- Run after 42_remove_pardon_time_limit.sql.

create or replace function public.edit_attendance_event(
  p_old_event_type text, p_old_event_date date, p_new_event_type text, p_new_event_date date
)
returns void language plpgsql security definer set search_path = public as $$
declare
  latest_created timestamptz;
begin
  if not public.is_roster_manager() then
    raise exception 'Only Operations or Admin can edit a marked event.';
  end if;

  select max(created_at) into latest_created
  from attendance_records
  where event_type = p_old_event_type and event_date = p_old_event_date;

  if latest_created is null then
    raise exception 'No matching attendance record found.';
  end if;
  if latest_created < now() - interval '24 hours' then
    raise exception 'Too late to edit this — it was marked more than 24 hours ago.';
  end if;

  update attendance_records
  set event_type = p_new_event_type, event_date = p_new_event_date
  where event_type = p_old_event_type and event_date = p_old_event_date;
end;
$$;

grant execute on function public.edit_attendance_event(text, date, text, date) to authenticated;
