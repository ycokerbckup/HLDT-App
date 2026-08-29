-- Phase 46: Operations gets an override — can delete any event and
-- manage roles (assign/add/remove) on any event, regardless of which
-- unit created it. Admin and Welfare remain scoped to their own
-- created events, as before. This also resolves events stuck with a
-- null created_by from before that column was actually being
-- populated — Operations can now clean those up without needing a
-- manual SQL fix each time.
-- Run after 52_admin_unit_events_access.sql.

create or replace function public.can_delete_any_event()
returns boolean language sql security definer stable as $$
  select public.is_admin() and public.is_operations();
$$;

drop policy if exists "same unit deletes special events" on special_events;
create policy "same unit or ops deletes special events" on special_events for delete using (
  public.can_delete_any_event() or (public.can_manage_events() and public.owns_event(created_by))
);

drop policy if exists "same unit manage event roles" on special_event_roles;
drop policy if exists "same unit update event roles" on special_event_roles;
drop policy if exists "same unit delete event roles" on special_event_roles;

create policy "same unit or ops insert event roles" on special_event_roles for insert with check (
  public.can_delete_any_event() or (public.can_manage_events() and exists (select 1 from special_events e where e.id = event_id and public.owns_event(e.created_by)))
);
create policy "same unit or ops update event roles" on special_event_roles for update using (
  public.can_delete_any_event() or (public.can_manage_events() and exists (select 1 from special_events e where e.id = event_id and public.owns_event(e.created_by)))
);
create policy "same unit or ops delete event roles" on special_event_roles for delete using (
  public.can_delete_any_event() or (public.can_manage_events() and exists (select 1 from special_events e where e.id = event_id and public.owns_event(e.created_by)))
);
