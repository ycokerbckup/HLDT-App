-- PROPOSED, NOT YET APPLIED (awaiting owner approval, 2026-10-08). Security hardening, round 2.
-- 1) Least-privilege table grants  2) Dues crediting trusts only the confirmed amount
-- 3) Append-only wallet ledger     4) Audit log + alerts to Operations admins
-- 5) Approval gate: only approved team members (unit assigned) or admins can read team data
-- 6) Feed link validation          7) Per-request OTP email send counters

-- ============================================================
-- 1) Least privilege. RLS already blocks these, but the grants should not exist at all.
--    TRUNCATE ignores RLS entirely, so no API role should ever hold it.
-- ============================================================
do $$
declare t record;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format('revoke truncate, references, trigger on public.%I from anon, authenticated', t.relname);
    execute format('revoke insert, update, delete on public.%I from anon', t.relname);
  end loop;
end $$;

do $$
begin
  alter default privileges for role postgres in schema public
    revoke truncate, references, trigger on tables from anon, authenticated;
exception when others then
  raise notice 'default privileges not changed: %', sqlerrm;
end $$;

-- ============================================================
-- 2) Dues: credit the wallet ONLY with the amount Paystack confirmed (paid_kobo, set from the
--    verified transaction). The old fallback to the requested amount is removed.
-- ============================================================
create or replace function public.credit_wallet_on_payment_success()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('success', 'partial') and old.status = 'pending' then
    if new.paid_kobo is null or new.paid_kobo <= 0 then
      raise warning 'Dues payment % marked % without a confirmed paid amount; wallet not credited', new.reference, new.status;
      return new;
    end if;
    if coalesce(new.raw_event->>'currency', 'NGN') <> 'NGN' then
      raise warning 'Dues payment % was not in NGN; wallet not credited', new.reference;
      return new;
    end if;
    update wallet_balance set
      balance = balance + new.paid_kobo / 100.0,
      dues_total = dues_total + new.paid_kobo / 100.0,
      updated_at = now()
    where id = 1;
  end if;
  return new;
end;
$$;

-- ============================================================
-- 3) Append-only wallet ledger: every change to the balance, however it happens
--    (payment, withdrawal, or a manual edit in the SQL editor), leaves a row.
-- ============================================================
create table if not exists public.wallet_ledger (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  delta numeric not null,
  balance_before numeric not null,
  balance_after numeric not null,
  actor uuid,
  db_role text not null default current_user,
  txid bigint not null default txid_current(),
  note text
);
alter table public.wallet_ledger enable row level security;
revoke all on public.wallet_ledger from anon, authenticated;
grant select on public.wallet_ledger to authenticated;
drop policy if exists "operations admins read wallet ledger" on public.wallet_ledger;
create policy "operations admins read wallet ledger" on public.wallet_ledger
  for select using (public.is_admin() and public.is_operations());

insert into public.wallet_ledger (delta, balance_before, balance_after, note)
select 0, balance, balance, 'baseline when the ledger was introduced' from public.wallet_balance where id = 1
  and not exists (select 1 from public.wallet_ledger);

create or replace function public.log_wallet_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.balance is distinct from old.balance then
    insert into public.wallet_ledger (delta, balance_before, balance_after, actor, note)
    values (new.balance - old.balance, old.balance, new.balance, auth.uid(),
            case when new.balance > old.balance then 'credit' else 'debit' end);
  end if;
  return new;
end;
$$;
drop trigger if exists wallet_ledger_trg on public.wallet_balance;
create trigger wallet_ledger_trg after update on public.wallet_balance
  for each row execute function public.log_wallet_change();

create or replace function public.block_ledger_mutation()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'The wallet ledger is append-only.';
end;
$$;
drop trigger if exists wallet_ledger_immutable on public.wallet_ledger;
create trigger wallet_ledger_immutable before update or delete on public.wallet_ledger
  for each row execute function public.block_ledger_mutation();

-- ============================================================
-- 4) Audit log + alerts. Alerts go to Operations admins as in-app + email notifications.
-- ============================================================
create table if not exists public.security_audit_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor uuid,
  actor_role text,
  event text not null,
  target text,
  details jsonb
);
alter table public.security_audit_log enable row level security;
revoke all on public.security_audit_log from anon, authenticated;
grant select on public.security_audit_log to authenticated;
drop policy if exists "operations admins read audit log" on public.security_audit_log;
create policy "operations admins read audit log" on public.security_audit_log
  for select using (public.is_admin() and public.is_operations());

drop trigger if exists audit_log_immutable on public.security_audit_log;
create trigger audit_log_immutable before update or delete on public.security_audit_log
  for each row execute function public.block_ledger_mutation();

create or replace function public.audit_security_event(
  p_event text, p_target text, p_details jsonb, p_alert_title text default null, p_alert_body text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r text;
begin
  select role into r from profiles where id = auth.uid();
  insert into security_audit_log (actor, actor_role, event, target, details)
  values (auth.uid(), r, p_event, p_target, p_details);
  if p_alert_title is not null then
    begin
      perform public.notify_units(array['Operations'], 'security_alert', p_alert_title, p_alert_body, 'dashboard');
    exception when others then
      raise warning 'security alert failed: %', sqlerrm;
    end;
  end if;
end;
$$;
revoke execute on function public.audit_security_event(text, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.audit_security_event(text, text, jsonb, text, text) to service_role;

-- Privilege changes on accounts
create or replace function public.trg_audit_profiles()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.audit_security_event('profile_privilege_change', new.id::text,
    jsonb_build_object('name', new.full_name,
      'role', jsonb_build_array(old.role, new.role),
      'can_manage_withdrawal_otp', jsonb_build_array(old.can_manage_withdrawal_otp, new.can_manage_withdrawal_otp)),
    'Access change',
    coalesce(new.full_name, new.email, 'A user') || ': role ' || old.role || ' to ' || new.role ||
      ', OTP-recipient access ' || old.can_manage_withdrawal_otp::text || ' to ' || new.can_manage_withdrawal_otp::text);
  return new;
end;
$$;
drop trigger if exists audit_profiles_privileges on public.profiles;
create trigger audit_profiles_privileges after update on public.profiles
  for each row when (old.role is distinct from new.role
                     or old.can_manage_withdrawal_otp is distinct from new.can_manage_withdrawal_otp)
  execute function public.trg_audit_profiles();

-- Member changes that affect access or money records
create or replace function public.trg_audit_members()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public.audit_security_event('member_deleted', old.id::text, jsonb_build_object('name', old.name, 'unit', old.unit, 'tier', old.tier));
    return old;
  end if;
  if old.dues is distinct from new.dues then
    perform public.audit_security_event('member_dues_edit', new.id::text,
      jsonb_build_object('name', new.name, 'before', old.dues, 'after', new.dues));
  end if;
  if old.unit is distinct from new.unit or old.tier is distinct from new.tier or old.profile_id is distinct from new.profile_id then
    perform public.audit_security_event('member_access_change', new.id::text,
      jsonb_build_object('name', new.name, 'unit', jsonb_build_array(old.unit, new.unit),
                         'tier', jsonb_build_array(old.tier, new.tier),
                         'profile_linked', jsonb_build_array(old.profile_id is not null, new.profile_id is not null)),
      case when new.unit = 'Operations' and old.unit is distinct from new.unit then 'Operations access granted' end,
      case when new.unit = 'Operations' and old.unit is distinct from new.unit then coalesce(new.name, 'A member') || ' was added to the Operations unit.' end);
  end if;
  return new;
end;
$$;
drop trigger if exists audit_members_changes on public.members;
create trigger audit_members_changes after update or delete on public.members
  for each row execute function public.trg_audit_members();

-- Withdrawal PIN and OTP recipient changes (never log the PIN hash itself)
create or replace function public.trg_audit_withdrawal_config()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.pin_hash is distinct from new.pin_hash then
    perform public.audit_security_event('withdrawal_pin_changed', 'withdrawal_config', '{}'::jsonb,
      'Withdrawal PIN changed', 'The wallet withdrawal PIN was changed. If this was not you, act immediately.');
  end if;
  if old.otp_email is distinct from new.otp_email then
    perform public.audit_security_event('withdrawal_otp_email_changed', 'withdrawal_config',
      jsonb_build_object('old', old.otp_email, 'new', new.otp_email),
      'Withdrawal OTP email changed',
      'The email that receives withdrawal OTPs was changed to ' ||
        coalesce(left(new.otp_email, 2) || '***@' || split_part(new.otp_email, '@', 2), '(none)') ||
        '. If this was not you, act immediately.');
  end if;
  return new;
end;
$$;
drop trigger if exists audit_withdrawal_config on public.withdrawal_config;
create trigger audit_withdrawal_config after update on public.withdrawal_config
  for each row when (old.pin_hash is distinct from new.pin_hash or old.otp_email is distinct from new.otp_email)
  execute function public.trg_audit_withdrawal_config();

-- Every withdrawal: requested, completed, or cancelled after too many wrong attempts
create or replace function public.trg_audit_withdrawals()
returns trigger language plpgsql security definer set search_path = public as $$
declare who text;
begin
  select coalesce(m.name, 'An admin') into who from members m where m.profile_id = new.requested_by limit 1;
  if tg_op = 'INSERT' then
    perform public.audit_security_event('withdrawal_requested', new.id::text,
      jsonb_build_object('amount', new.amount, 'reason', new.reason),
      'Withdrawal requested', coalesce(who, 'An admin') || ' started a withdrawal of NGN ' || to_char(new.amount, 'FM999G999G999D00') || '.');
  elsif new.status = 'completed' and old.status is distinct from 'completed' then
    perform public.audit_security_event('withdrawal_completed', new.id::text,
      jsonb_build_object('amount', new.amount, 'reason', new.reason),
      'Withdrawal completed', 'NGN ' || to_char(new.amount, 'FM999G999G999D00') || ' was withdrawn from the wallet by ' || coalesce(who, 'an admin') || '.');
  elsif new.status = 'cancelled' and old.status is distinct from 'cancelled' and new.otp_attempts >= 5 then
    perform public.audit_security_event('withdrawal_failed_attempts', new.id::text,
      jsonb_build_object('amount', new.amount, 'attempts', new.otp_attempts),
      'Withdrawal blocked: too many wrong PIN/OTP attempts',
      'A withdrawal of NGN ' || to_char(new.amount, 'FM999G999G999D00') || ' was cancelled after 5 incorrect PIN/OTP attempts.');
  end if;
  return new;
end;
$$;
drop trigger if exists audit_withdrawals on public.withdrawal_requests;
create trigger audit_withdrawals after insert or update of status on public.withdrawal_requests
  for each row execute function public.trg_audit_withdrawals();

revoke execute on function public.trg_audit_profiles(), public.trg_audit_members(),
  public.trg_audit_withdrawal_config(), public.trg_audit_withdrawals(), public.log_wallet_change(),
  public.block_ledger_mutation() from public, anon, authenticated;

-- ============================================================
-- 5) Approval gate. Anyone can sign up, and sign-up creates a member row with no unit. Until an
--    Operations admin assigns a unit, that person must not read team data. Existing members all
--    have a unit; admins always pass.
-- ============================================================
create or replace function public.is_team_member()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or exists (select 1 from members m where m.profile_id = auth.uid() and m.unit is not null);
$$;
revoke execute on function public.is_team_member() from public;
grant execute on function public.is_team_member() to anon, authenticated, service_role;

do $$
declare
  p record;
  generic constant text := '(auth.role() = ''authenticated''::text)';
  clauses text;
begin
  for p in
    select tablename, policyname, qual, with_check from pg_policies
    where schemaname = 'public' and (qual = generic or with_check = generic)
  loop
    clauses := '';
    if p.qual = generic then clauses := clauses || ' using (public.is_team_member())'; end if;
    if p.with_check = generic then clauses := clauses || ' with check (public.is_team_member())'; end if;
    execute format('alter policy %I on public.%I%s', p.policyname, p.tablename, clauses);
  end loop;
end $$;

-- Broadcast notifications were readable by any signed-in account.
alter policy "read relevant notifications" on public.notifications
  using ((target_profile_id is null or target_profile_id = auth.uid()) and public.is_team_member());

-- The directory views run with owner privileges (they bypass RLS), so the gate lives in the view.
create or replace view public.members_directory as
  select id, name, unit, tier, team, join_date, email, phone, profile_id, unavailable, suspended,
         (dob = to_char(((now() at time zone 'Africa/Lagos'))::date::timestamp with time zone, 'DD/MM')) as is_birthday_today
  from public.members
  where public.is_team_member();

create or replace view public.onboarding_public as
  select id, member_id, name, start_date, weeks, status, graduated_at
  from public.onboarding
  where public.is_team_member();

-- ============================================================
-- 6) Shared feed links must be web links (blocks javascript: and similar). Existing rows are untouched.
-- ============================================================
alter table public.feed_posts drop constraint if exists feed_posts_url_is_http;
alter table public.feed_posts add constraint feed_posts_url_is_http check (url ~* '^https?://') not valid;

-- ============================================================
-- 7) OTP email send counters (the Edge Functions cap sends per request).
-- ============================================================
alter table public.withdrawal_requests add column if not exists emails_sent int not null default 0;
alter table public.pin_change_requests add column if not exists emails_sent int not null default 0;
alter table public.phone_change_verifications add column if not exists emails_sent int not null default 0;
