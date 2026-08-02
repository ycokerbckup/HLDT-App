-- Phase 21: Automated calendar-driven announcements.
-- Run after 25_inventory_operations_access.sql.

-- Helper: post a system-generated announcement (no human author).
create or replace function public.post_system_announcement(p_title text, p_body text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.announcements (title, body, created_by_name)
  values (p_title, p_body, 'Display Team Ops (automated)');
end;
$$;

-- ============================================================
-- Dues reminders: 25th and 29th of every month.
-- ============================================================
create or replace function public.run_dues_reminder()
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.post_system_announcement(
    'Dues reminder',
    'Friendly reminder to settle your dues for this month if you haven''t already. Check the Dues tab, or reach out to Welfare/Operations with any questions.'
  );
end;
$$;

select cron.schedule('dues-reminder-25', '0 8 25 * *', $$ select public.run_dues_reminder(); $$);
select cron.schedule('dues-reminder-29', '0 8 29 * *', $$ select public.run_dues_reminder(); $$);

-- ============================================================
-- Seasonal announcements: new month, new year, mid-year, Christmas,
-- Good Friday, Easter Sunday. Easter/Good Friday move every year, so a
-- verified lookup table is used instead of computing them live —
-- these dates were cross-checked against confirmed sources for
-- 2026-2029, then extended with the standard Gregorian Easter
-- algorithm for 2030-2035. Extend this table again before 2036.
-- ============================================================
create table easter_dates (
  year int primary key,
  easter_sunday date not null
);

insert into easter_dates (year, easter_sunday) values
  (2026, '2026-04-05'),
  (2027, '2027-03-28'),
  (2028, '2028-04-16'),
  (2029, '2029-04-01'),
  (2030, '2030-04-21'),
  (2031, '2031-04-13'),
  (2032, '2032-03-28'),
  (2033, '2033-04-17'),
  (2034, '2034-04-09'),
  (2035, '2035-03-25');

-- No policies attached deliberately — this table is only ever read by
-- the security-definer function below (which bypasses RLS), never by
-- the client app directly. Enabling RLS with zero policies fully locks
-- it from the public API.
alter table easter_dates enable row level security;

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
    perform public.post_system_announcement('Good Friday', 'Wishing the whole team a meaningful Good Friday as we reflect on this Holy Week.');
  elsif this_easter is not null and today = this_easter then
    perform public.post_system_announcement('Happy Easter!', 'He is risen! Happy Easter to the whole Display Team.');
  elsif extract(month from today) = 1 and extract(day from today) = 1 then
    perform public.post_system_announcement('Happy New Year!', 'Wishing the entire Display Team a blessed and productive new year ahead.');
  elsif extract(month from today) = 7 and extract(day from today) = 1 then
    perform public.post_system_announcement('Happy Mid-Year!', 'We''re halfway through the year — thank you for all you''ve put in so far. Here''s to the rest of it.');
  elsif extract(month from today) = 12 and extract(day from today) = 25 then
    perform public.post_system_announcement('Merry Christmas!', 'Wishing the whole team a joyful Christmas celebrating the birth of Christ.');
  elsif extract(day from today) = 1 then
    perform public.post_system_announcement('Happy New Month!', 'Wishing the whole team a great new month ahead.');
  end if;
end;
$$;

select cron.schedule('seasonal-announcements', '0 7 * * *', $$ select public.run_seasonal_announcements(); $$);
