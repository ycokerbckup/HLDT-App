-- Phase 18: AI quota status tracking (greys out AI features when
-- exhausted, shared across the whole team since it's one Google API
-- key) + a daily notification to Technical unit when it should reset.
-- Run after 22_equipment_inventory.sql.

create table ai_quota_status (
  id int primary key default 1,
  exhausted_at timestamptz,
  next_reset_at timestamptz,
  constraint singleton check (id = 1)
);
insert into ai_quota_status (id) values (1);

alter table ai_quota_status enable row level security;
create policy "logged in read ai quota status" on ai_quota_status for select using (auth.role() = 'authenticated');

alter publication supabase_realtime add table ai_quota_status;

-- Notifies every Technical-unit member (any role, not just admins —
-- unlike notify_units(), which is admin-only) about the daily quota
-- reset. Approximate: Gemini resets at midnight Pacific Time, which
-- drifts by an hour twice a year with US daylight saving — this fires
-- at a fixed 07:00 UTC (~8am Nigeria time), close enough to be useful,
-- not perfectly exact year-round.
create or replace function public.notify_technical_unit(p_type text, p_title text, p_body text, p_link_tab text)
returns void language plpgsql security definer set search_path = public as $$
declare
  prof record;
begin
  for prof in
    select p.id from profiles p
    join members m on m.profile_id = p.id
    where m.unit = 'Technical'
  loop
    insert into public.notifications (type, title, body, link_tab, target_role, target_profile_id)
    values (p_type, p_title, p_body, p_link_tab, 'all', prof.id);
  end loop;
end;
$$;

create or replace function public.run_ai_quota_reset_notice()
returns void language plpgsql security definer set search_path = public as $$
declare
  status record;
begin
  select * into status from ai_quota_status where id = 1;
  if status.exhausted_at is not null and status.exhausted_at > now() - interval '20 hours' then
    perform public.notify_technical_unit(
      'ai_quota',
      'AI equipment suggestions should be available again',
      'The free daily quota has likely reset.',
      'equipment'
    );
    update ai_quota_status set exhausted_at = null, next_reset_at = null where id = 1;
  end if;
end;
$$;

select cron.schedule(
  'ai-quota-reset-notice',
  '0 7 * * *',
  $$ select public.run_ai_quota_reset_notice(); $$
);
