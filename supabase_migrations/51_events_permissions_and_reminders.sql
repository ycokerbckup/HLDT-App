-- Phase 44: Events permission rework, editability, new-event
-- broadcast, and personal reminder subscriptions with real email
-- delivery at chosen offsets.
-- Run after 50_thumbnail_framing.sql.

-- ============================================================
-- Permission rework: Operations + Welfare admins can create/edit
-- events, but only within their own unit — an event created by
-- someone in Operations can't be touched by Welfare, and vice versa.
-- Replaces the earlier is_roster_manager()-based policies entirely.
-- ============================================================
create or replace function public.can_manage_events()
returns boolean language sql security definer stable as $$
  select public.is_admin() and public.is_welfare_or_ops();
$$;

create or replace function public.owns_event(p_created_by uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1
    from members creator_m
    join members my_m on my_m.profile_id = auth.uid()
    where creator_m.profile_id = p_created_by
    and creator_m.unit = my_m.unit
  );
$$;

drop policy if exists "roster managers manage special events" on special_events;
drop policy if exists "roster managers update special events" on special_events;
drop policy if exists "roster managers delete special events" on special_events;

create policy "ops welfare create special events" on special_events for insert with check (public.can_manage_events());
create policy "same unit updates special events" on special_events for update using (public.can_manage_events() and public.owns_event(created_by));
create policy "same unit deletes special events" on special_events for delete using (public.can_manage_events() and public.owns_event(created_by));

drop policy if exists "roster managers manage special event roles" on special_event_roles;
drop policy if exists "roster managers update special event roles" on special_event_roles;
drop policy if exists "roster managers delete special event roles" on special_event_roles;

create policy "same unit manage event roles" on special_event_roles for insert with check (
  public.can_manage_events() and exists (select 1 from special_events e where e.id = event_id and public.owns_event(e.created_by))
);
create policy "same unit update event roles" on special_event_roles for update using (
  public.can_manage_events() and exists (select 1 from special_events e where e.id = event_id and public.owns_event(e.created_by))
);
create policy "same unit delete event roles" on special_event_roles for delete using (
  public.can_manage_events() and exists (select 1 from special_events e where e.id = event_id and public.owns_event(e.created_by))
);

-- ============================================================
-- Broadcast to everyone the moment a new event is created — separate
-- from the countdown reminders, which fire later as the date nears.
-- ============================================================
create or replace function public.notify_new_special_event()
returns trigger as $$
declare
  first_date date;
begin
  select min((elem->>'date')::date) into first_date from jsonb_array_elements(new.event_dates) elem;
  insert into public.notifications (type, title, body, link_tab, target_role)
  values ('new_special_event', 'New event: ' || new.title,
    coalesce(new.description || ' — ', '') || 'Starting ' || to_char(first_date, 'Mon DD') || coalesce(', ' || new.location, ''),
    'events', 'all');
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_special_event_created
  after insert on special_events
  for each row execute procedure public.notify_new_special_event();

-- ============================================================
-- Personal reminder subscriptions — a member can opt into up to two
-- reminders per event occurrence, sent by email at the chosen offset.
-- ============================================================
create table event_reminder_subscriptions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references special_events(id) on delete cascade,
  event_date date not null,
  profile_id uuid references profiles(id) on delete cascade,
  reminder_type text not null check (reminder_type in ('2_days_before', '1_day_before', 'day_of_9am', '2_hours_before', '1_hour_before')),
  sent boolean not null default false,
  created_at timestamptz default now(),
  unique (event_id, event_date, profile_id, reminder_type)
);

alter table event_reminder_subscriptions enable row level security;
create policy "users manage own event reminders" on event_reminder_subscriptions
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- Hourly check — fine-grained enough for the hour-based offsets while
-- staying cheap. One malformed subscription can't break the others'
-- reminders, thanks to the per-row exception handling.
create or replace function public.run_event_reminder_subscriptions()
returns void language plpgsql security definer set search_path = public as $$
declare
  sub record;
  ev record;
  occurrence_elem jsonb;
  occurrence_time text;
  target_ts timestamptz;
begin
  for sub in select * from event_reminder_subscriptions where sent = false loop
    begin
      select * into ev from special_events where id = sub.event_id;
      if ev is null then
        update event_reminder_subscriptions set sent = true where id = sub.id;
        continue;
      end if;

      select elem into occurrence_elem from jsonb_array_elements(ev.event_dates) elem where (elem->>'date')::date = sub.event_date limit 1;
      occurrence_time := nullif(occurrence_elem->>'time', '');

      if sub.reminder_type in ('2_hours_before', '1_hour_before') and occurrence_time is null then
        -- no time set for this occurrence — can't compute an hour offset, drop silently
        update event_reminder_subscriptions set sent = true where id = sub.id;
        continue;
      end if;

      target_ts := case sub.reminder_type
        when '2_days_before' then ((sub.event_date - 2)::text || ' 09:00')::timestamp at time zone 'Africa/Lagos'
        when '1_day_before' then ((sub.event_date - 1)::text || ' 09:00')::timestamp at time zone 'Africa/Lagos'
        when 'day_of_9am' then (sub.event_date::text || ' 09:00')::timestamp at time zone 'Africa/Lagos'
        when '2_hours_before' then ((sub.event_date::text || ' ' || occurrence_time)::timestamp at time zone 'Africa/Lagos') - interval '2 hours'
        when '1_hour_before' then ((sub.event_date::text || ' ' || occurrence_time)::timestamp at time zone 'Africa/Lagos') - interval '1 hours'
      end;

      if target_ts <= now() then
        insert into public.notifications (type, title, body, link_tab, target_role, target_profile_id)
        values ('event_personal_reminder', 'Reminder: ' || ev.title,
          ev.title || ' — ' || to_char(sub.event_date, 'Mon DD') || coalesce(' at ' || occurrence_time, '') || coalesce(', ' || ev.location, ''),
          'events', 'all', sub.profile_id);
        update event_reminder_subscriptions set sent = true where id = sub.id;
      end if;
    exception when others then
      -- don't let one bad row (e.g. an unparseable legacy free-text time)
      -- block everyone else's reminders
      update event_reminder_subscriptions set sent = true where id = sub.id;
    end;
  end loop;
end;
$$;

select cron.schedule('event-personal-reminders', '0 * * * *', $$ select public.run_event_reminder_subscriptions(); $$);
