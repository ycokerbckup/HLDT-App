-- Phase 34: Fix the tour re-appearing — track it server-side (tied to
-- the account, synced across devices) instead of localStorage (tied to
-- one browser, wiped by private mode / storage clearing / device
-- switching). Versioned so it can be deliberately re-shown for a
-- genuinely new feature later, without randomly reappearing otherwise.
-- Run after 40_midweek_event_type.sql.

alter table profiles add column if not exists tour_version_seen int not null default 0;

create or replace function public.mark_tour_seen(p_version int)
returns void language plpgsql security definer set search_path = public as $$
begin
  update profiles set tour_version_seen = p_version where id = auth.uid();
end;
$$;

grant execute on function public.mark_tour_seen(int) to authenticated;
