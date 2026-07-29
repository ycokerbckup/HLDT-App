-- Phase 3: Feed (YouTube auto-pull + manually curated links)
-- Run after all previous migration files.

-- Admin-managed list of YouTube channels to auto-pull from.
create table feed_sources (
  id uuid primary key default gen_random_uuid(),
  channel_id text not null unique,
  channel_name text,
  added_by uuid references profiles(id),
  created_at timestamptz default now()
);

alter table feed_sources enable row level security;
create policy "logged in read feed sources" on feed_sources for select using (auth.role() = 'authenticated');
create policy "admins insert feed sources" on feed_sources for insert with check (public.is_admin());
create policy "admins delete feed sources" on feed_sources for delete using (public.is_admin());

-- Seed: Renewed Vision (makers of ProPresenter) — verified channel.
insert into feed_sources (channel_id, channel_name) values ('UCWQhr5G-3wwenYIB6ubdtoQ', 'Renewed Vision (ProPresenter)');

-- Feed posts: auto-pulled videos + manually curated links, unified stream.
create table feed_posts (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'manual', -- 'youtube_auto' | 'manual'
  title text not null,
  url text not null,
  thumbnail_url text,
  description text,
  external_id text,
  posted_by uuid references profiles(id),
  posted_by_name text,
  created_at timestamptz default now(),
  unique (source, external_id)
);

alter table feed_posts enable row level security;
create policy "logged in read feed posts" on feed_posts for select using (auth.role() = 'authenticated');
create policy "admins insert manual feed posts" on feed_posts for insert with check (public.is_admin());
create policy "admins delete feed posts" on feed_posts for delete using (public.is_admin());

-- Scheduled cleanup: feed posts removed 30 days after posting.
select cron.schedule(
  'cleanup-old-feed-posts',
  '0 * * * *',
  $$ delete from feed_posts where created_at < now() - interval '30 days'; $$
);
