-- Phase 64: Attendance marking reminders now go to everyone in the
-- Admin unit, not one hardcoded person. Cron jobs renamed to match
-- (unscheduling the old "yemi-*" names, not just replacing them,
-- since the job name itself was specific to one person).
-- Run after 70_maintenance_mode.sql.

drop function if exists public.notify_attendance_marking_reminder(uuid, text, text);

create or replace function public.notify_attendance_marking_reminder(p_event_type text, p_event_label text)
returns void language plpgsql security definer set search_path = public as $$
declare
  already_marked boolean;
  admin_member record;
begin
  select exists(
    select 1 from attendance_records where event_type = p_event_type and event_date = current_date
  ) into already_marked;

  if not already_marked then
    for admin_member in select id from members where unit = 'Admin' loop
      perform public.notify_member_only(admin_member.id, 'attendance_marking_reminder',
        p_event_label || ' attendance reminder',
        'Don''t forget to mark attendance for today''s ' || p_event_label || '.', 'attendance');
    end loop;
  end if;
end;
$$;

select cron.unschedule('yemi-tuesday-attendance-reminder');
select cron.unschedule('yemi-saturday-attendance-reminder');
select cron.unschedule('yemi-wednesday-attendance-reminder');
select cron.unschedule('yemi-sunday-attendance-reminder');

select cron.schedule('admin-tuesday-attendance-reminder', '30 19 * * 2',
  $$ select public.notify_attendance_marking_reminder('tuesday', 'Tuesday meeting'); $$);

select cron.schedule('admin-saturday-attendance-reminder', '20 22 * * 6',
  $$ select public.notify_attendance_marking_reminder('saturday', 'Saturday training'); $$);

select cron.schedule('admin-wednesday-attendance-reminder', '0 18 * * 3',
  $$ select public.notify_attendance_marking_reminder('midweek', 'Wednesday midweek service'); $$);

select cron.schedule('admin-sunday-attendance-reminder', '0 11 * * 0',
  $$ select public.notify_attendance_marking_reminder('sunday', 'Sunday service'); $$);
