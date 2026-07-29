-- Phase 5: Structured rosters (Tuesday prayer meeting + Saturday training)
-- Sunday/Wednesday stays the existing simple Team A/B rotation, unchanged.
-- Run after 08_onboarding_operations_only.sql.

create or replace function public.is_roster_manager()
returns boolean language sql security definer stable as $$
  select public.is_admin() and public.my_unit() in ('Operations', 'Admin');
$$;

-- ============================================================
-- Tuesday prayer meeting: date + ordered flow of agenda items
-- ============================================================
create table tuesday_rosters (
  id uuid primary key default gen_random_uuid(),
  event_date date not null unique,
  published boolean not null default false,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

create table tuesday_roster_items (
  id uuid primary key default gen_random_uuid(),
  roster_id uuid references tuesday_rosters(id) on delete cascade,
  position int not null,
  title text not null,
  duration_minutes int,
  assigned_member_id uuid references members(id) on delete set null,
  assigned_name text
);

alter table tuesday_rosters enable row level security;
alter table tuesday_roster_items enable row level security;

create policy "read published or managed tuesday rosters" on tuesday_rosters for select using (
  published or public.is_roster_manager()
);
create policy "managers write tuesday rosters" on tuesday_rosters for insert with check (public.is_roster_manager());
create policy "managers update tuesday rosters" on tuesday_rosters for update using (public.is_roster_manager());
create policy "managers delete tuesday rosters" on tuesday_rosters for delete using (public.is_roster_manager());

create policy "read items of visible tuesday rosters" on tuesday_roster_items for select using (
  exists (select 1 from tuesday_rosters r where r.id = tuesday_roster_items.roster_id and (r.published or public.is_roster_manager()))
);
create policy "managers write tuesday items" on tuesday_roster_items for insert with check (public.is_roster_manager());
create policy "managers update tuesday items" on tuesday_roster_items for update using (public.is_roster_manager());
create policy "managers delete tuesday items" on tuesday_roster_items for delete using (public.is_roster_manager());

-- ============================================================
-- Saturday training: call time, duration, assigned trainer(s), notes
-- ============================================================
create table saturday_rosters (
  id uuid primary key default gen_random_uuid(),
  event_date date not null unique,
  call_time text default '9:50 AM',
  duration_minutes int default 120,
  focus_notes text,
  published boolean not null default false,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

create table saturday_roster_trainers (
  id uuid primary key default gen_random_uuid(),
  roster_id uuid references saturday_rosters(id) on delete cascade,
  member_id uuid references members(id) on delete set null,
  name text
);

alter table saturday_rosters enable row level security;
alter table saturday_roster_trainers enable row level security;

create policy "read published or managed saturday rosters" on saturday_rosters for select using (
  published or public.is_roster_manager()
);
create policy "managers write saturday rosters" on saturday_rosters for insert with check (public.is_roster_manager());
create policy "managers update saturday rosters" on saturday_rosters for update using (public.is_roster_manager());
create policy "managers delete saturday rosters" on saturday_rosters for delete using (public.is_roster_manager());

create policy "read trainers of visible saturday rosters" on saturday_roster_trainers for select using (
  exists (select 1 from saturday_rosters r where r.id = saturday_roster_trainers.roster_id and (r.published or public.is_roster_manager()))
);
create policy "managers write saturday trainers" on saturday_roster_trainers for insert with check (public.is_roster_manager());
create policy "managers delete saturday trainers" on saturday_roster_trainers for delete using (public.is_roster_manager());

-- ============================================================
-- Realtime + auto-cleanup after the event date has passed
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array['tuesday_rosters','tuesday_roster_items','saturday_rosters','saturday_roster_trainers'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;

select cron.schedule(
  'cleanup-past-rosters',
  '0 2 * * *',
  $$
    delete from tuesday_rosters where event_date < current_date;
    delete from saturday_rosters where event_date < current_date;
  $$
);
