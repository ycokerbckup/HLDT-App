-- Security hardening: lock down function execution and money-table privileges.
-- (Applied to production on 2026-10-07.)
-- Safe by construction: the app never calls the internal functions directly, scheduled jobs
-- and triggers run as the owner, and RLS policies only use the helper functions kept below.

do $$
declare
  f record;
  helper_fns text[] := array['can_delete_any_event','can_manage_events','is_admin','is_operations','is_ops_or_tech','is_roster_manager','is_technical','is_welfare','is_welfare_or_ops','my_unit','owns_event'];
  user_rpcs text[] := array['confirm_phone_change','confirm_pin_change','confirm_withdrawal','edit_attendance_event','excuse_attendance','get_withdrawal_pin_status','heartbeat','initiate_withdrawal','mark_message_read','mark_message_seen','mark_tour_seen','reassign_event_role_date','request_phone_change_code','request_pin_change','submit_kym','update_member_dues','update_own_member_info','update_own_profile'];
begin
  for f in
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef
  loop
    execute format('revoke execute on function public.%I(%s) from public, anon, authenticated', f.proname, f.args);
    execute format('grant execute on function public.%I(%s) to service_role', f.proname, f.args);
    if f.proname = any(helper_fns) then
      execute format('grant execute on function public.%I(%s) to anon, authenticated', f.proname, f.args);
    elsif f.proname = any(user_rpcs) then
      execute format('grant execute on function public.%I(%s) to authenticated', f.proname, f.args);
    end if;
  end loop;
end $$;

-- Money tables: the app only ever reads dues_payments. All writes go through
-- SECURITY DEFINER functions or Edge Functions (service role). Remove direct write grants.
revoke all on public.wallet_balance, public.withdrawal_requests, public.withdrawal_config,
  public.pin_change_requests, public.phone_change_verifications, public.dues_payments, public.pool_payments
  from anon;
revoke insert, update, delete, truncate, references, trigger on public.wallet_balance, public.withdrawal_requests,
  public.withdrawal_config, public.pin_change_requests, public.phone_change_verifications,
  public.dues_payments, public.pool_payments from authenticated;

-- Secrets must never be readable through the API, even by admins:
-- the PIN hash (a 4-digit PIN hash can be cracked offline in seconds) and the one-time codes.
revoke select on public.withdrawal_requests from authenticated;
grant select (id, requested_by, amount, reason, status, otp_expires_at, otp_attempts, completed_at, created_at)
  on public.withdrawal_requests to authenticated;
revoke select on public.withdrawal_config from authenticated;
grant select (id) on public.withdrawal_config to authenticated;
revoke select on public.pin_change_requests, public.phone_change_verifications from authenticated;

-- NOTE for future migrations: new SECURITY DEFINER functions are executable by anon/authenticated
-- by default in Supabase. Always follow a new function with:
--   revoke execute on function public.<fn>(<args>) from public, anon, authenticated;
--   grant execute on function public.<fn>(<args>) to authenticated;   -- only if the app calls it
