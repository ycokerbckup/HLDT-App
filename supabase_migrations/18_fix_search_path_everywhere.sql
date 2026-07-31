-- Phase 13: Fix the real bug behind "no notification, no email."
--
-- Root cause: security definer functions in Postgres do NOT automatically
-- inherit their owner's search_path — they inherit it from whatever
-- context calls them, unless the function explicitly sets its own. The
-- auth trigger (fires as supabase_auth_admin) does not have `public` in
-- its search_path by design (a Supabase security measure), so any
-- function reachable from that trigger with an unqualified table
-- reference (e.g. `from profiles` instead of `from public.profiles`)
-- fails silently in that context, even though it works fine everywhere
-- else — exactly why this was invisible until we checked the logs.
--
-- Fix: pin search_path = public on every security definer function in
-- this project, not just the one that broke, since any of them could
-- have the same latent issue waiting for the wrong calling context.
-- Run after 17_fix_signup_500.sql.

alter function public.is_admin() set search_path = public;
alter function public.mark_message_seen(uuid) set search_path = public;
alter function public.handle_new_user() set search_path = public;
alter function public.notify_new_announcement() set search_path = public;
alter function public.my_unit() set search_path = public;
alter function public.is_operations() set search_path = public;
alter function public.is_welfare() set search_path = public;
alter function public.is_ops_or_tech() set search_path = public;
alter function public.is_welfare_or_ops() set search_path = public;
alter function public.submit_kym(text, text, text, text, text) set search_path = public;
alter function public.notify_new_message() set search_path = public;
alter function public.is_roster_manager() set search_path = public;
alter function public.notify_tuesday_roster_change() set search_path = public;
alter function public.notify_saturday_roster_change() set search_path = public;
alter function public.notify_graduation() set search_path = public;
alter function public.notify_all_except(uuid, text, text, text, text, uuid, uuid) set search_path = public;
alter function public.notify_units(text[], text, text, text, text) set search_path = public;
alter function public.run_daily_celebrations() set search_path = public;
alter function public.notify_ticket_assignment() set search_path = public;
alter function public.notify_tuesday_item_assignment() set search_path = public;
alter function public.notify_saturday_trainer_assignment() set search_path = public;
alter function public.mark_message_read(uuid) set search_path = public;
