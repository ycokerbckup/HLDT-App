-- Phase 1: Announcements + Notifications
-- Run after all previous schema files.

-- Announcements
create table announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  created_by uuid references profiles(id),
  created_by_name text,
  created_at timestamptz default now()
);

alter table announcements enable row level security;

create policy "logged in read announcements" on announcements for select using (auth.role() = 'authenticated');
create policy "admins insert announcements" on announcements for insert with check (public.is_admin());
create policy "admins update announcements within 30 minutes" on announcements for update using (
  public.is_admin() and created_at > now() - interval '30 minutes'
);
create policy "admins delete announcements anytime" on announcements for delete using (public.is_admin());

-- Notifications (system-generated) + per-user read tracking
create table notifications (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  title text not null,
  body text,
  link_tab text,
  target_role text not null default 'all',
  created_at timestamptz default now()
);

create table notification_reads (
  notification_id uuid references notifications(id) on delete cascade,
  profile_id uuid references profiles(id) on delete cascade,
  read_at timestamptz default now(),
  primary key (notification_id, profile_id)
);

alter table notifications enable row level security;
alter table notification_reads enable row level security;

create policy "logged in read notifications" on notifications for select using (auth.role() = 'authenticated');
create policy "read own notification reads" on notification_reads for select using (profile_id = auth.uid());
create policy "insert own notification reads" on notification_reads for insert with check (profile_id = auth.uid());

-- Auto-create a notification whenever an announcement is posted
create function public.notify_new_announcement()
returns trigger as $$
begin
  insert into public.notifications (type, title, body, link_tab, target_role)
  values ('announcement', 'New announcement: ' || new.title, left(new.body, 140), 'announcements', 'all');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_announcement_created
  after insert on announcements
  for each row execute procedure public.notify_new_announcement();

-- Scheduled cleanup: announcements older than 7 days, delete automatically.
-- Requires the pg_cron extension. If the next line errors, enable pg_cron
-- first via Supabase Dashboard > Database > Extensions, then re-run just
-- the two statements below.
create extension if not exists pg_cron;

select cron.schedule(
  'cleanup-old-announcements',
  '0 * * * *',
  $$ delete from announcements where created_at < now() - interval '7 days'; $$
);
