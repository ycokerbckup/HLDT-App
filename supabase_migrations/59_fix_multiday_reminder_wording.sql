-- Phase 52: Reminder wording — a multi-day event whose upcoming date
-- isn't its first day should say "continues", not "is", since the
-- event has already started by that point.
-- Run after 58_edit_event_role_date.sql.

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
  first_date date;
  verb text;
begin
  for ev in select * from special_events loop
    select min((e->>'date')::date) into first_date from jsonb_array_elements(ev.event_dates) e;

    for elem in select * from jsonb_array_elements(ev.event_dates) loop
      match_date := (elem->>'date')::date;
      match_time := elem->>'time';

      if match_date in (current_date + 7, current_date + 1) then
        days_until := match_date - current_date;
        day_word := case when days_until = 1 then 'day' else 'days' end;
        verb := case when match_date = first_date then 'is' else 'continues' end;

        insert into public.notifications (type, title, body, link_tab, target_role)
        values ('special_event_reminder',
          ev.title || ' ' || verb || ' in ' || days_until || ' ' || day_word,
          coalesce(ev.description || ' — ', '') || to_char(match_date, 'Mon DD') ||
            coalesce(' at ' || match_time, '') || coalesce(', ' || ev.location, ''),
          'events', 'all');

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
