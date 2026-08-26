-- Phase 41: Special (one-off) events — flexible per-event roles rather
-- than a fixed weekly template, with countdown reminders and personal
-- assignee reminders as the date approaches.
-- Run after 47_push_subscriptions.sql.

create table special_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  event_date date not null,
  event_time text,
  location text,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

create table special_event_roles (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references special_events(id) on delete cascade,
  role_name text not null,
  assigned_member_id uuid references members(id) on delete set null,
  created_at timestamptz default now()
);

alter table special_events enable row level security;
alter table special_event_roles enable row level security;

create policy "anyone reads special events" on special_events for select using (auth.role() = 'authenticated');
create policy "roster managers manage special events" on special_events for insert with check (public.is_roster_manager());
create policy "roster managers update special events" on special_events for update using (public.is_roster_manager());
create policy "roster managers delete special events" on special_events for delete using (public.is_roster_manager());

create policy "anyone reads special event roles" on special_event_roles for select using (auth.role() = 'authenticated');
create policy "roster managers manage special event roles" on special_event_roles for insert with check (public.is_roster_manager());
create policy "roster managers update special event roles" on special_event_roles for update using (public.is_roster_manager());
create policy "roster managers delete special event roles" on special_event_roles for delete using (public.is_roster_manager());

alter publication supabase_realtime add table special_events;
alter publication supabase_realtime add table special_event_roles;

-- Immediate notice the moment someone gets assigned to a role.
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

  select title, event_date into ev_title, ev_date from special_events where id = new.event_id;
  select profile_id into target_profile from members where id = new.assigned_member_id;

  if target_profile is not null then
    insert into public.notifications (type, title, body, link_tab, target_role, target_profile_id)
    values ('assignment', 'New assignment: ' || ev_title,
      'You''ve been assigned as ' || new.role_name || ' for ' || ev_title || ' on ' || to_char(ev_date, 'Mon DD') || '.',
      'events', 'all', target_profile);
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_special_event_role_assigned
  after insert or update on special_event_roles
  for each row execute procedure public.notify_special_event_assignment();

-- Countdown reminders at two thresholds: 7 days out and 1 day out. A
-- general heads-up to everyone, plus a personal nudge to each assignee
-- specifically. Daily schedule naturally fires each threshold exactly
-- once per event, no extra dedup tracking needed.
create or replace function public.run_special_event_reminders()
returns void language plpgsql security definer set search_path = public as $$
declare
  ev record;
  role_rec record;
  days_until int;
  day_word text;
begin
  for ev in select * from special_events where event_date in (current_date + 7, current_date + 1) loop
    days_until := ev.event_date - current_date;
    day_word := case when days_until = 1 then 'day' else 'days' end;

    insert into public.notifications (type, title, body, link_tab, target_role)
    values ('special_event_reminder',
      ev.title || ' is in ' || days_until || ' ' || day_word,
      coalesce(ev.description || ' — ', '') || to_char(ev.event_date, 'Mon DD') || coalesce(', ' || ev.location, ''),
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
          'Reminder: you''re assigned as ' || role_rec.role_name || ' for ' || ev.title || ' in ' || days_until || ' ' || day_word || '.',
          'events', 'all', role_rec.profile_id);
      end if;
    end loop;
  end loop;
end;
$$;

select cron.schedule('special-event-reminders', '0 7 * * *', $$ select public.run_special_event_reminders(); $$);
