-- (Applied to production on 2026-10-07.)
-- The directory/onboarding views run with owner privileges (bypass RLS) and were readable by
-- signed-out visitors. The app only reads them after sign-in, so remove anon access.
revoke all on public.members_directory from anon;
revoke all on public.onboarding_public from anon;
revoke insert, update, delete, truncate, references, trigger on public.members_directory, public.onboarding_public from authenticated;

-- Pin the search_path on the remaining functions that lacked one (prevents schema-shadowing attacks).
alter function public.owns_event(uuid) set search_path = public;
alter function public.can_delete_any_event() set search_path = public;
alter function public.can_manage_events() set search_path = public;
alter function public.notify_new_ticket() set search_path = public;
