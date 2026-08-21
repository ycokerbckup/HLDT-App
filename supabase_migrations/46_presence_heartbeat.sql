-- Phase 39: Track presence so chat emails only send when the recipient
-- is actually away — if they're on the site right now, they'll see the
-- message live via the realtime subscription and don't need an email.
-- Only applies to chat notifications; other types are unaffected.
-- Run after 45_attendance_reminders_and_auto_unsuspend.sql.

alter table profiles add column if not exists last_seen_at timestamptz;

create or replace function public.heartbeat()
returns void language plpgsql security definer set search_path = public as $$
begin
  update profiles set last_seen_at = now() where id = auth.uid();
end;
$$;

grant execute on function public.heartbeat() to authenticated;
