-- Phase 28: Roster creation reminders for Admin unit.
-- Friday morning: nudge about Saturday's roster, if it doesn't exist yet.
-- Monday morning: nudge about Tuesday's roster, if it doesn't exist yet.
-- Run after 34_attendance_and_cover_requests.sql.

create or replace function public.notify_admin_unit(p_type text, p_title text, p_body text, p_link_tab text)
returns void language plpgsql security definer set search_path = public as $$
declare
  prof record;
begin
  for prof in
    select p.id from profiles p join members m on m.profile_id = p.id where m.unit = 'Admin'
  loop
    insert into public.notifications (type, title, body, link_tab, target_role, target_profile_id)
    values (p_type, p_title, p_body, p_link_tab, 'all', prof.id);
  end loop;
end;
$$;

create or replace function public.run_saturday_roster_reminder()
returns void language plpgsql security definer set search_path = public as $$
declare
  upcoming date;
  existing_count int;
begin
  upcoming := current_date + ((6 - extract(dow from current_date)::int + 7) % 7);
  select count(*) into existing_count from saturday_rosters where event_date = upcoming;
  if existing_count = 0 then
    perform public.notify_admin_unit(
      'saturday_roster_reminder',
      'Saturday training roster needed',
      'Nothing set yet for ' || to_char(upcoming, 'Mon DD') || '. Time to put one together.',
      'roster'
    );
  end if;
end;
$$;

create or replace function public.run_tuesday_roster_reminder()
returns void language plpgsql security definer set search_path = public as $$
declare
  upcoming date;
  existing_count int;
begin
  upcoming := current_date + ((2 - extract(dow from current_date)::int + 7) % 7);
  select count(*) into existing_count from tuesday_rosters where event_date = upcoming;
  if existing_count = 0 then
    perform public.notify_admin_unit(
      'tuesday_roster_reminder',
      'Tuesday prayer meeting roster needed',
      'Nothing set yet for ' || to_char(upcoming, 'Mon DD') || '. Time to put one together.',
      'roster'
    );
  end if;
end;
$$;

-- Friday 08:00 WAT (07:00 UTC), Monday 08:00 WAT (07:00 UTC).
select cron.schedule('saturday-roster-reminder', '0 7 * * 5', $$ select public.run_saturday_roster_reminder(); $$);
select cron.schedule('tuesday-roster-reminder', '0 7 * * 1', $$ select public.run_tuesday_roster_reminder(); $$);
