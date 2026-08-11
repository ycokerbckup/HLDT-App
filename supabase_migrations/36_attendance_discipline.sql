-- Phase 29: Automated attendance discipline (warnings + suspension
-- notices) and a monthly Operations digest reminder.
-- Run after 35_roster_reminders.sql.

-- ============================================================
-- Tracks which warning tier has already been sent, so each tier fires
-- exactly once per person per month regardless of how many more
-- absences get marked afterward.
-- ============================================================
create table attendance_warnings (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references members(id) on delete cascade,
  month text not null,
  tier text not null check (tier in ('consecutive_2', 'total_3', 'total_4')),
  sent_at timestamptz default now(),
  unique (member_id, month, tier)
);

alter table attendance_warnings enable row level security;
create policy "roster managers read warnings" on attendance_warnings for select using (public.is_roster_manager());

-- Email-only notification helper (targets one member's linked profile).
create or replace function public.notify_member_only(p_member_id uuid, p_type text, p_title text, p_body text, p_link_tab text)
returns void language plpgsql security definer set search_path = public as $$
declare
  prof uuid;
begin
  select profile_id into prof from members where id = p_member_id;
  if prof is not null then
    insert into public.notifications (type, title, body, link_tab, target_role, target_profile_id)
    values (p_type, p_title, p_body, p_link_tab, 'all', prof);
  end if;
end;
$$;

-- ============================================================
-- Fires after any attendance record is marked "absent". Checks the two
-- distinct rules: 2-in-a-row (consecutive), and cumulative 3/4 this
-- month (any spacing). Each tier only ever sends once per month —
-- the unique constraint + exception handler enforces that reliably
-- even if this fires many times in quick succession.
-- ============================================================
create or replace function public.check_attendance_discipline()
returns trigger as $$
declare
  this_month text := to_char(new.event_date, 'YYYY-MM');
  total_absent int;
  recent_statuses text[];
  member_name text;
begin
  if new.status <> 'absent' then
    return new;
  end if;

  select name into member_name from members where id = new.member_id;

  select count(*) into total_absent from attendance_records
  where member_id = new.member_id and status = 'absent' and to_char(event_date, 'YYYY-MM') = this_month;

  select array_agg(status order by event_date desc) into recent_statuses
  from (
    select status, event_date from attendance_records
    where member_id = new.member_id and status in ('present', 'absent') and to_char(event_date, 'YYYY-MM') = this_month
    order by event_date desc limit 2
  ) x;

  if recent_statuses is not null and array_length(recent_statuses, 1) = 2
     and recent_statuses[1] = 'absent' and recent_statuses[2] = 'absent' then
    begin
      insert into attendance_warnings (member_id, month, tier) values (new.member_id, this_month, 'consecutive_2');
      perform public.notify_member_only(new.member_id, 'attendance_warning', 'Attendance warning',
        coalesce(member_name, 'Hi') || ', you''ve missed 2 events in a row. Please reach out if something''s come up — we''d rather know than guess.', 'attendance');
    exception when unique_violation then null;
    end;
  end if;

  if total_absent >= 3 then
    begin
      insert into attendance_warnings (member_id, month, tier) values (new.member_id, this_month, 'total_3');
      perform public.notify_member_only(new.member_id, 'attendance_warning', 'Attendance warning (2nd notice)',
        coalesce(member_name, 'Hi') || ', this is your 3rd missed event this month. Please reach out to your team lead.', 'attendance');
    exception when unique_violation then null;
    end;
  end if;

  if total_absent >= 4 then
    begin
      insert into attendance_warnings (member_id, month, tier) values (new.member_id, this_month, 'total_4');
      perform public.notify_member_only(new.member_id, 'attendance_suspension', 'Attendance: suspension notice',
        coalesce(member_name, 'Hi') || ', you''ve missed 4 events this month. Per team policy, this results in suspension. Please reach out to Operations to discuss.', 'attendance');
    exception when unique_violation then null;
    end;
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_attendance_absent_check
  after insert or update on attendance_records
  for each row execute procedure public.check_attendance_discipline();

-- ============================================================
-- Monthly digest to Operations, on the 1st of each month.
-- ============================================================
create or replace function public.run_monthly_ops_attendance_digest()
returns void language plpgsql security definer set search_path = public as $$
declare
  prof record;
begin
  for prof in
    select p.id from profiles p join members m on m.profile_id = p.id where m.unit = 'Operations'
  loop
    insert into public.notifications (type, title, body, link_tab, target_role, target_profile_id)
    values ('monthly_digest', 'Monthly performance check-in',
      'A new month has started — good time to review last month''s attendance dashboard.', 'attendance', 'all', prof.id);
  end loop;
end;
$$;

select cron.schedule('monthly-ops-attendance-digest', '0 8 1 * *', $$ select public.run_monthly_ops_attendance_digest(); $$);
