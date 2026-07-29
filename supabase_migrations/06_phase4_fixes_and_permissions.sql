-- Phase 4: bug fixes + new permissions model
-- Run after all previous migration files.

-- ============================================================
-- 1. FIX: register tables for realtime (this was the actual bug
--    behind "only updates when I switch tabs and come back" —
--    postgres_changes subscriptions do nothing unless a table is
--    explicitly added to the supabase_realtime publication).
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array[
    'members','onboarding','onboarding_history','tickets','feedback',
    'announcements','notifications','notification_reads',
    'messages','conversations','feed_posts','feed_sources'
  ] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;

-- ============================================================
-- 2. Wallet total balance (admin-editable, real-time, singleton row)
-- ============================================================
create table wallet_balance (
  id int primary key default 1,
  balance numeric not null default 0,
  updated_by uuid references profiles(id),
  updated_at timestamptz default now(),
  constraint singleton check (id = 1)
);
insert into wallet_balance (id, balance) values (1, 0);

alter table wallet_balance enable row level security;
create policy "logged in read wallet balance" on wallet_balance for select using (auth.role() = 'authenticated');
create policy "admins update wallet balance" on wallet_balance for update using (public.is_admin());

alter publication supabase_realtime add table wallet_balance;

-- ============================================================
-- 3. Notifications: cascade-delete when the source record is gone
-- ============================================================
alter table notifications add column announcement_id uuid references announcements(id) on delete cascade;
alter table notifications add column message_id uuid references messages(id) on delete cascade;
alter table notifications add column target_profile_id uuid references profiles(id) on delete cascade;

-- Restrict SELECT so a targeted (DM) notification is only visible to its recipient.
drop policy "logged in read notifications" on notifications;
create policy "read relevant notifications" on notifications for select using (
  target_profile_id is null or target_profile_id = auth.uid()
);

-- Announcement trigger: link the notification so it cascades on delete
create or replace function public.notify_new_announcement()
returns trigger as $$
begin
  insert into public.notifications (type, title, body, link_tab, target_role, announcement_id)
  values ('announcement', 'New announcement: ' || new.title, left(new.body, 140), 'announcements', 'all', new.id);
  return new;
end;
$$ language plpgsql security definer;

-- New message trigger: notifies the other DM participant, or the whole
-- team channel (minus the sender, who is auto-marked read on their own message).
create or replace function public.notify_new_message()
returns trigger as $$
declare
  new_notif_id uuid;
  other_user uuid;
begin
  if new.conversation_id is null then
    insert into public.notifications (type, title, body, link_tab, target_role, message_id)
    values ('chat', coalesce(new.sender_name, 'Someone') || ' posted in Team channel', left(new.body, 100), 'chat', 'all', new.id)
    returning id into new_notif_id;
  else
    select case when c.user_a = new.sender_id then c.user_b else c.user_a end into other_user
    from conversations c where c.id = new.conversation_id;

    insert into public.notifications (type, title, body, link_tab, target_role, target_profile_id, message_id)
    values ('chat', coalesce(new.sender_name, 'Someone') || ' sent you a message', left(new.body, 100), 'chat', 'dm', other_user, new.id)
    returning id into new_notif_id;
  end if;

  insert into public.notification_reads (notification_id, profile_id) values (new_notif_id, new.sender_id)
  on conflict do nothing;

  return new;
end;
$$ language plpgsql security definer;

create trigger on_message_created
  after insert on messages
  for each row execute procedure public.notify_new_message();

-- ============================================================
-- 4. Unit-based permission helpers (security definer, avoids the
--    same recursive-RLS trap fixed earlier for is_admin())
-- ============================================================
create or replace function public.my_unit()
returns text language sql security definer stable as $$
  select unit from members where profile_id = auth.uid() limit 1;
$$;

create or replace function public.is_operations()
returns boolean language sql security definer stable as $$
  select public.my_unit() = 'Operations';
$$;

create or replace function public.is_welfare()
returns boolean language sql security definer stable as $$
  select public.my_unit() = 'Welfare';
$$;

create or replace function public.is_ops_or_tech()
returns boolean language sql security definer stable as $$
  select public.my_unit() in ('Operations', 'Technical');
$$;

create or replace function public.is_welfare_or_ops()
returns boolean language sql security definer stable as $$
  select public.my_unit() in ('Welfare', 'Operations');
$$;

-- Broaden member read access: Welfare and Operations see full member rows
-- (including dues + skills), not just their own.
drop policy "read own or admin members" on members;
create policy "read own or admin or welfare or ops members" on members for select using (
  public.is_admin() or profile_id = auth.uid() or public.is_welfare_or_ops()
);

-- Role assignment restricted to Operations-unit admins only.
drop policy "admins update profiles" on profiles;
create policy "operations admins update profiles" on profiles for update using (
  public.is_admin() and public.is_operations()
);

-- Member record management (add/edit/delete) restricted to Operations-unit admins only.
drop policy "admins write members" on members;
drop policy "admins update members" on members;
drop policy "admins delete members" on members;
create policy "operations admins write members" on members for insert with check (
  public.is_admin() and public.is_operations()
);
create policy "operations admins update members" on members for update using (
  public.is_admin() and public.is_operations()
);
create policy "operations admins delete members" on members for delete using (
  public.is_admin() and public.is_operations()
);

-- Feed management restricted to Operations or Technical unit admins.
drop policy "admins insert feed sources" on feed_sources;
drop policy "admins delete feed sources" on feed_sources;
create policy "ops or tech admins insert feed sources" on feed_sources for insert with check (
  public.is_admin() and public.is_ops_or_tech()
);
create policy "ops or tech admins delete feed sources" on feed_sources for delete using (
  public.is_admin() and public.is_ops_or_tech()
);

drop policy "admins insert manual feed posts" on feed_posts;
drop policy "admins delete feed posts" on feed_posts;
create policy "ops or tech admins insert feed posts" on feed_posts for insert with check (
  public.is_admin() and public.is_ops_or_tech()
);
create policy "ops or tech admins delete feed posts" on feed_posts for delete using (
  public.is_admin() and public.is_ops_or_tech()
);

-- ============================================================
-- 5. KYM (Know Your Member) fields + one-time self-submission
-- ============================================================
alter table members add column home_address text;
alter table members add column sex text check (sex in ('M', 'F'));
alter table members add column dob text; -- stored as 'dd/mm'
alter table members add column occupation text;
alter table members add column kym_completed_at timestamptz;

-- Self-submission goes through a function (not a broad UPDATE policy) so a
-- member can fill in only these specific fields on their own row, without
-- gaining general edit rights (which are now Operations-admin only above).
create or replace function public.submit_kym(
  p_phone text, p_home_address text, p_sex text, p_dob text, p_occupation text
)
returns void
language plpgsql
security definer
as $$
begin
  update members
  set phone = coalesce(nullif(p_phone, ''), phone),
      home_address = p_home_address,
      sex = p_sex,
      dob = p_dob,
      occupation = p_occupation,
      kym_completed_at = now()
  where profile_id = auth.uid();
end;
$$;

grant execute on function public.submit_kym(text, text, text, text, text) to authenticated;
