-- Phase 38: Personal attendance-marking reminders + auto-unsuspend.
-- Run after 44_remove_edit_event_time_limit.sql.

-- ============================================================
-- Reminds Yemi Coker to mark attendance, but only if it hasn't already
-- been marked for that event today — same "don't nag if it's already
-- done" logic as the Friday/Monday roster-creation reminders.
-- ============================================================
create or replace function public.notify_attendance_marking_reminder(p_member_id uuid, p_event_type text, p_event_label text)
returns void language plpgsql security definer set search_path = public as $$
declare
  already_marked boolean;
begin
  select exists(
    select 1 from attendance_records where event_type = p_event_type and event_date = current_date
  ) into already_marked;

  if not already_marked then
    perform public.notify_member_only(p_member_id, 'attendance_marking_reminder',
      p_event_label || ' attendance reminder',
      'Don''t forget to mark attendance for today''s ' || p_event_label || '.', 'attendance');
  end if;
end;
$$;

-- Tuesday 8:30pm WAT (19:30 UTC)
select cron.schedule('yemi-tuesday-attendance-reminder', '30 19 * * 2',
  $$ select public.notify_attendance_marking_reminder('1a748234-4ed1-4dec-af06-e8f0b40cd04a', 'tuesday', 'Tuesday meeting'); $$);

-- Saturday 11:20pm WAT (22:20 UTC)
select cron.schedule('yemi-saturday-attendance-reminder', '20 22 * * 6',
  $$ select public.notify_attendance_marking_reminder('1a748234-4ed1-4dec-af06-e8f0b40cd04a', 'saturday', 'Saturday training'); $$);

-- Wednesday 7:00pm WAT (18:00 UTC)
select cron.schedule('yemi-wednesday-attendance-reminder', '0 18 * * 3',
  $$ select public.notify_attendance_marking_reminder('1a748234-4ed1-4dec-af06-e8f0b40cd04a', 'midweek', 'Wednesday midweek service'); $$);

-- Sunday 12:00pm WAT (11:00 UTC)
select cron.schedule('yemi-sunday-attendance-reminder', '0 11 * * 0',
  $$ select public.notify_attendance_marking_reminder('1a748234-4ed1-4dec-af06-e8f0b40cd04a', 'sunday', 'Sunday service'); $$);

-- ============================================================
-- Auto-unsuspend after 30 days, or earlier via the manual toggle in
-- Members (which already works — this just adds the automatic side).
-- ============================================================
alter table members add column if not exists suspended_at timestamptz;

create or replace function public.track_suspension_timestamp()
returns trigger as $$
begin
  if new.suspended = true and (old.suspended is distinct from true) then
    new.suspended_at := now();
  elsif new.suspended = false and old.suspended = true then
    new.suspended_at := null;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_member_suspension_change
  before update on members
  for each row execute procedure public.track_suspension_timestamp();

create or replace function public.run_auto_unsuspend()
returns void language plpgsql security definer set search_path = public as $$
declare
  rec record;
begin
  for rec in select id, name, profile_id from members where suspended = true and suspended_at < now() - interval '30 days' loop
    update members set suspended = false, suspended_at = null where id = rec.id;
    if rec.profile_id is not null then
      insert into public.notifications (type, title, body, link_tab, target_role, target_profile_id)
      values ('suspension_lifted', 'Suspension lifted', 'Your 30-day suspension period has ended — welcome back.', 'dashboard', 'all', rec.profile_id);
    end if;
  end loop;
end;
$$;

select cron.schedule('daily-auto-unsuspend-check', '0 6 * * *', $$ select public.run_auto_unsuspend(); $$);
