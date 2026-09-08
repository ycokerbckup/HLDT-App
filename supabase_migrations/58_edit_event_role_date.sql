-- Phase 51: Let a role's assigned date be corrected (mistakes happen),
-- but only while that date hasn't already occurred — once it's passed,
-- rewriting it would be rewriting something that already happened.
-- Enforced in the database itself, not just hidden in the UI.
-- Run after 57_auto_announcement_cleanup.sql.

create or replace function public.reassign_event_role_date(p_role_id uuid, p_new_date date)
returns void language plpgsql security definer set search_path = public as $$
declare
  rec record;
begin
  select ser.*, es.created_by as event_created_by, es.event_dates
  into rec
  from special_event_roles ser
  join special_events es on es.id = ser.event_id
  where ser.id = p_role_id;

  if rec is null then
    raise exception 'Role not found.';
  end if;

  if not (public.can_delete_any_event() or (public.can_manage_events() and public.owns_event(rec.event_created_by))) then
    raise exception 'You do not have permission to edit this role.';
  end if;

  if rec.event_date is not null and rec.event_date < current_date then
    raise exception 'This role''s date has already passed and can no longer be changed.';
  end if;

  if p_new_date is not null and not exists (
    select 1 from jsonb_array_elements(rec.event_dates) elem where (elem->>'date')::date = p_new_date
  ) then
    raise exception 'That date is not one of this event''s dates.';
  end if;

  update special_event_roles set event_date = p_new_date where id = p_role_id;
end;
$$;

grant execute on function public.reassign_event_role_date(uuid, date) to authenticated;
