-- Phase 49: Per-date role assignment for multi-day events. Nullable
-- event_date on a role means "applies to every date" (matches the old
-- behavior, so existing roles keep working); a specific date scopes
-- that assignment to just that one occurrence — so reminders only go
-- to the days someone is actually needed, not the whole event.
-- Run after 55_profile_self_edit.sql.

alter table special_event_roles add column event_date date;

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

  if new.event_date is not null then
    ev_date := new.event_date;
  else
    select min((elem->>'date')::date) into ev_date
      from special_events e, jsonb_array_elements(e.event_dates) elem
      where e.id = new.event_id;
  end if;

  select profile_id into target_profile from members where id = new.assigned_member_id;

  if target_profile is not null then
    insert into public.notifications (type, title, body, link_tab, target_role, target_profile_id)
    values ('assignment', 'New assignment: ' || ev_title,
      'You''ve been assigned as ' || new.role_name || ' for ' || ev_title ||
        coalesce(' on ' || to_char(ev_date, 'Mon DD'), '') ||
        case when new.event_date is null then ' (all dates)' else '' end || '.',
      'events', 'all', target_profile);
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.run_special_event_reminders()
returns void language plpgsql security definer set search_path = public as $$
declare
  ev record;
  elem jsonb;
  match_date date;
  match_time text;
  role_rec record;
  days_until int;
  day_word text;
begin
  for ev in select * from special_events loop
    for elem in select * from jsonb_array_elements(ev.event_dates) loop
      match_date := (elem->>'date')::date;
      match_time := elem->>'time';

      if match_date in (current_date + 7, current_date + 1) then
        days_until := match_date - current_date;
        day_word := case when days_until = 1 then 'day' else 'days' end;

        insert into public.notifications (type, title, body, link_tab, target_role)
        values ('special_event_reminder',
          ev.title || ' is in ' || days_until || ' ' || day_word,
          coalesce(ev.description || ' — ', '') || to_char(match_date, 'Mon DD') ||
            coalesce(' at ' || match_time, '') || coalesce(', ' || ev.location, ''),
          'events', 'all');

        -- Only assignees whose role applies to THIS specific date (or
        -- to every date, via a null event_date) get the personal nudge.
        for role_rec in
          select ser.role_name, m.profile_id
          from special_event_roles ser
          join members m on m.id = ser.assigned_member_id
          where ser.event_id = ev.id and ser.assigned_member_id is not null
            and (ser.event_date is null or ser.event_date = match_date)
        loop
          if role_rec.profile_id is not null then
            insert into public.notifications (type, title, body, link_tab, target_role, target_profile_id)
            values ('special_event_assignee_reminder',
              'You''re on for ' || ev.title,
              'Reminder: you''re assigned as ' || role_rec.role_name || ' for ' || ev.title ||
                ' on ' || to_char(match_date, 'Mon DD') || ' — in ' || days_until || ' ' || day_word || '.',
              'events', 'all', role_rec.profile_id);
          end if;
        end loop;
      end if;
    end loop;
  end loop;
end;
$$;
