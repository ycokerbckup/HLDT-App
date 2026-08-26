-- Phase 42: Flexible event dates (ranges + discontiguous dates, each
-- with its own optional time) and thumbnail image/video uploads.
-- Run after 48_special_events.sql.

-- ============================================================
-- Storage bucket for event thumbnails (image or short video).
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-media', 'event-media', true, 52428800, array['image/png','image/jpeg','image/webp','image/gif','video/mp4','video/quicktime','video/webm'])
on conflict (id) do nothing;

create policy "anyone views event media" on storage.objects for select using (bucket_id = 'event-media');
create policy "roster managers upload event media" on storage.objects for insert with check (bucket_id = 'event-media' and public.is_roster_manager());
create policy "roster managers delete event media" on storage.objects for delete using (bucket_id = 'event-media' and public.is_roster_manager());

-- ============================================================
-- Replace the single event_date/event_time columns with a flexible
-- list — each element is {"date": "YYYY-MM-DD", "time": "..."}, so an
-- event can span "9th-11th & 13th" with a different time per date if
-- needed. Existing rows are migrated in, not dropped.
-- ============================================================
alter table special_events add column event_dates jsonb;
alter table special_events add column thumbnail_url text;

update special_events
set event_dates = jsonb_build_array(jsonb_build_object('date', event_date, 'time', event_time))
where event_dates is null;

alter table special_events alter column event_dates set not null;
alter table special_events drop column event_date;
alter table special_events drop column event_time;

-- ============================================================
-- Reminders now fire per matching date within an event, not once for
-- the whole event — a multi-date event gets its own 7-day/1-day
-- reminder cycle for each date independently.
-- ============================================================
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

        for role_rec in
          select ser.role_name, m.profile_id
          from special_event_roles ser
          join members m on m.id = ser.assigned_member_id
          where ser.event_id = ev.id and ser.assigned_member_id is not null
        loop
          if role_rec.profile_id is not null then
            insert into public.notifications (type, title, body, link_tab, target_role, target_profile_id)
            values ('special_event_assignee_reminder',
              'You''re on for ' || ev.title,
              'Reminder: you''re assigned as ' || role_rec.role_name || ' for ' || ev.title ||
                ' on ' || to_char(match_date, 'Mon DD') || coalesce(' at ' || match_time, '') ||
                ' — in ' || days_until || ' ' || day_word || '.',
              'events', 'all', role_rec.profile_id);
          end if;
        end loop;
      end if;
    end loop;
  end loop;
end;
$$;
