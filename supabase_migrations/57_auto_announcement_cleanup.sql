-- Phase 50: Reasonable, type-specific auto-delete timers for automated
-- announcements (dues reminders, seasonal greetings). Previously all
-- announcements — automated or not — shared one generic 7-day cleanup.
-- These are more time-sensitive and stale much faster; nothing here is
-- visible to users, it's purely a backend cleanup schedule.
--
-- Chosen windows (adjust anytime by editing run_auto_announcement_cleanup):
--   Dues reminder   -> 3 days  (fires every 4 days on the 25th/29th —
--                                short enough that one clears before the next arrives)
--   Good Friday     -> 3 days  (a single-day observance, stale fast)
--   Happy New Month -> 4 days
--   Happy Mid-Year  -> 4 days
--   Merry Christmas -> 4 days
--   Happy Easter    -> 4 days
--   Happy New Year  -> 5 days  (a bit more notable, allowed to linger slightly longer)
--
-- Run after 56_per_date_role_assignment.sql.

alter table announcements add column if not exists auto_type text;

create or replace function public.post_system_announcement(p_title text, p_body text, p_auto_type text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.announcements (title, body, created_by_name, auto_type)
  values (p_title, p_body, 'Display Team Ops (automated)', p_auto_type);
end;
$$;

create or replace function public.run_dues_reminder()
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.post_system_announcement(
    'Dues reminder',
    'Friendly reminder to settle your dues for this month if you haven''t already. Check the Dues tab, or reach out to Welfare/Operations with any questions.',
    'dues_reminder'
  );
end;
$$;

create or replace function public.run_seasonal_announcements()
returns void language plpgsql security definer set search_path = public as $$
declare
  today date := current_date;
  this_easter date;
  this_good_friday date;
begin
  select easter_sunday into this_easter from easter_dates where year = extract(year from today)::int;
  this_good_friday := this_easter - 2;

  if this_easter is not null and today = this_good_friday then
    perform public.post_system_announcement('Good Friday', 'Wishing the whole team a meaningful Good Friday as we reflect on this Holy Week.', 'good_friday');
  elsif this_easter is not null and today = this_easter then
    perform public.post_system_announcement('Happy Easter!', 'He is risen! Happy Easter to the whole Display Team.', 'easter');
  elsif extract(month from today) = 1 and extract(day from today) = 1 then
    perform public.post_system_announcement('Happy New Year!', 'Wishing the entire Display Team a blessed and productive new year ahead.', 'new_year');
  elsif extract(month from today) = 7 and extract(day from today) = 1 then
    perform public.post_system_announcement('Happy Mid-Year!', 'We''re halfway through the year — thank you for all you''ve put in so far. Here''s to the rest of it.', 'mid_year');
  elsif extract(month from today) = 12 and extract(day from today) = 25 then
    perform public.post_system_announcement('Merry Christmas!', 'Wishing the whole team a joyful Christmas celebrating the birth of Christ.', 'christmas');
  elsif extract(day from today) = 1 then
    perform public.post_system_announcement('Happy New Month!', 'Wishing the whole team a great new month ahead.', 'new_month');
  end if;
end;
$$;

create or replace function public.run_auto_announcement_cleanup()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from announcements where auto_type = 'dues_reminder' and created_at < now() - interval '3 days';
  delete from announcements where auto_type = 'good_friday' and created_at < now() - interval '3 days';
  delete from announcements where auto_type = 'new_month' and created_at < now() - interval '4 days';
  delete from announcements where auto_type = 'mid_year' and created_at < now() - interval '4 days';
  delete from announcements where auto_type = 'christmas' and created_at < now() - interval '4 days';
  delete from announcements where auto_type = 'easter' and created_at < now() - interval '4 days';
  delete from announcements where auto_type = 'new_year' and created_at < now() - interval '5 days';
end;
$$;

select cron.schedule('auto-announcement-cleanup', '0 * * * *', $$ select public.run_auto_announcement_cleanup(); $$);
