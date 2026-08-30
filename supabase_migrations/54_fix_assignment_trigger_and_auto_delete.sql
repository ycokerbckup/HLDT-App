-- Phase 47: Fix a real regression — the assignment-notification trigger
-- still referenced the old single event_date column, which migration
-- 49 replaced with the flexible event_dates array. Every role
-- assignment was failing and rolling back because of this. Also adds
-- auto-deletion of events once every one of their dates has passed.
-- Run after 53_ops_event_override.sql.

create or replace function public.notify_special_event_assignment()
returns trigger as $$
declare
  ev_title text;
  ev_date date;
  target_profile uuid;
begin
  if new.assigned_member_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.assigned_member_id is not distinct from old.assigned_member_id then
    return new;
  end if;

  select title into ev_title from special_events where id = new.event_id;
  select min((elem->>'date')::date) into ev_date
    from special_events e, jsonb_array_elements(e.event_dates) elem
    where e.id = new.event_id;
  select profile_id into target_profile from members where id = new.assigned_member_id;

  if target_profile is not null then
    insert into public.notifications (type, title, body, link_tab, target_role, target_profile_id)
    values ('assignment', 'New assignment: ' || ev_title,
      'You''ve been assigned as ' || new.role_name || ' for ' || ev_title || coalesce(' on ' || to_char(ev_date, 'Mon DD'), '') || '.',
      'events', 'all', target_profile);
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- ============================================================
-- Auto-delete once every date on the event has passed. Roles and any
-- reminder subscriptions tied to the event cascade-delete along with
-- it (already set up via foreign keys).
-- ============================================================
create or replace function public.run_auto_delete_past_events()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from special_events
  where not exists (
    select 1 from jsonb_array_elements(event_dates) elem
    where (elem->>'date')::date >= current_date
  );
end;
$$;

select cron.schedule('auto-delete-past-events', '0 3 * * *', $$ select public.run_auto_delete_past_events(); $$);
