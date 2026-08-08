-- Phase 27: Attendance tracking + swap/cover requests.
-- Run after 33_feed_channel_tracking.sql.

-- ============================================================
-- Attendance: who actually showed up, separate from who was scheduled.
-- Marked by roster managers (Operations/Admin unit), same access model
-- as roster management itself.
-- ============================================================
create table attendance_records (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('sunday', 'tuesday', 'saturday')),
  event_date date not null,
  member_id uuid references members(id) on delete cascade,
  status text not null check (status in ('present', 'absent', 'excused')),
  marked_by uuid references profiles(id),
  created_at timestamptz default now(),
  unique (event_type, event_date, member_id)
);

alter table attendance_records enable row level security;

create policy "anyone reads attendance" on attendance_records for select using (auth.role() = 'authenticated');
create policy "roster managers mark attendance" on attendance_records for insert with check (public.is_roster_manager());
create policy "roster managers update attendance" on attendance_records for update using (public.is_roster_manager());
create policy "roster managers delete attendance" on attendance_records for delete using (public.is_roster_manager());

alter publication supabase_realtime add table attendance_records;

-- ============================================================
-- Cover requests: "I can't make it, need someone to cover" — open
-- marketplace, anyone can post their own, anyone else can claim it.
-- ============================================================
create table cover_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid references members(id) on delete cascade,
  event_type text not null check (event_type in ('sunday', 'tuesday', 'saturday')),
  event_date date not null,
  reason text,
  status text not null default 'open' check (status in ('open', 'claimed', 'cancelled')),
  claimed_by uuid references members(id) on delete set null,
  created_at timestamptz default now()
);

alter table cover_requests enable row level security;

create policy "anyone reads cover requests" on cover_requests for select using (auth.role() = 'authenticated');
create policy "members post own cover request" on cover_requests for insert with check (
  exists (select 1 from members m where m.id = requester_id and m.profile_id = auth.uid())
);
create policy "requester or claimant updates cover request" on cover_requests for update using (
  exists (select 1 from members m where m.id = requester_id and m.profile_id = auth.uid())
  or auth.role() = 'authenticated'
);
create policy "requester cancels own cover request" on cover_requests for delete using (
  exists (select 1 from members m where m.id = requester_id and m.profile_id = auth.uid())
);

alter publication supabase_realtime add table cover_requests;

-- Notify everyone when a cover request is posted, and the requester
-- specifically once it's claimed.
create or replace function public.notify_cover_request()
returns trigger as $$
declare
  requester_name text;
  claimer_name text;
  requester_profile uuid;
begin
  if tg_op = 'INSERT' then
    select name into requester_name from members where id = new.requester_id;
    insert into public.notifications (type, title, body, link_tab, target_role)
    values ('cover_request', requester_name || ' needs cover', 'For ' || new.event_type || ' on ' || to_char(new.event_date, 'Mon DD'), 'roster', 'all');
  elsif tg_op = 'UPDATE' and new.status = 'claimed' and old.status = 'open' then
    select name into claimer_name from members where id = new.claimed_by;
    select profile_id into requester_profile from members where id = new.requester_id;
    if requester_profile is not null then
      insert into public.notifications (type, title, body, link_tab, target_role, target_profile_id)
      values ('cover_request', coalesce(claimer_name, 'Someone') || ' covered you', 'For ' || new.event_type || ' on ' || to_char(new.event_date, 'Mon DD'), 'roster', 'all', requester_profile);
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_cover_request_change
  after insert or update on cover_requests
  for each row execute procedure public.notify_cover_request();
