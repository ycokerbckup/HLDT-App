-- Phase 85: The wallet holds the real money until it's withdrawn.
--
-- Before this, the wallet was a number that drifted from reality in two ways:
--   (a) every Paystack payment was credited at its GROSS amount, but Paystack
--       keeps its fee, so the money actually received was always less; and
--   (b) a "withdrawal" only subtracted a number. No money moved anywhere.
--
-- After this:
--   * Every movement is an immutable row in wallet_ledger. wallet_balance is a
--     cached running total kept in step by a trigger on that ledger (so the
--     app's existing realtime subscription on wallet_balance keeps working).
--   * Payments are credited NET of the fee Paystack actually charged (the
--     `fees` field Paystack returns on verify). If that field is ever missing,
--     the fee is estimated from Paystack's published pricing instead of being
--     ignored.
--   * Existing balance is corrected once for fees on payments already credited.
--   * A withdrawal now pays out for real: after the PIN + OTP check it becomes
--     'processing', the amount and the Paystack transfer fee are held (taken off
--     the balance), and an Edge Function sends a Paystack Transfer to the team's
--     saved payout account. Paystack's webhook then marks it completed, or
--     failed/reversed, in which case the held money goes back on the balance.
--   * The payout account can only be changed by an Operations admin who enters
--     the withdrawal PIN, with a lockout after repeated wrong PINs.
--
-- Paystack pricing used for estimates (Nigeria, checked 2026-10-09):
--   Local charges: 1.5% + NGN 100, the NGN 100 waived under NGN 2,500, capped at NGN 2,000.
--   Transfers: NGN 10 (<= 5,000), NGN 25 (5,001 - 50,000), NGN 50 (> 50,000).
--
-- Run after 84_celebrations_at_8am.sql.

-- ============================================================
-- Fee estimators (kobo in, kobo out).
-- ============================================================
create or replace function public.paystack_charge_fee_kobo(p_amount_kobo bigint)
returns bigint language sql immutable set search_path = public as $$
  select case when coalesce(p_amount_kobo, 0) <= 0 then 0
    else least(200000, round(p_amount_kobo * 0.015)::bigint + case when p_amount_kobo >= 250000 then 10000 else 0 end)
  end
$$;

create or replace function public.paystack_transfer_fee_kobo(p_amount_kobo bigint)
returns bigint language sql immutable set search_path = public as $$
  select case when p_amount_kobo <= 500000 then 1000 when p_amount_kobo <= 5000000 then 2500 else 5000 end
$$;

grant execute on function public.paystack_charge_fee_kobo(bigint), public.paystack_transfer_fee_kobo(bigint) to authenticated, service_role;

-- ============================================================
-- wallet_balance: extra running totals.
-- ============================================================
alter table wallet_balance add column if not exists fees_total numeric not null default 0;
alter table wallet_balance add column if not exists withdrawn_total numeric not null default 0;

-- ============================================================
-- The ledger.
-- amount_kobo is the signed effect on the balance.
-- ============================================================
create table if not exists wallet_ledger (
  id bigserial primary key,
  entry_type text not null check (entry_type in (
    'opening_balance', 'fee_correction',
    'dues_credit', 'pool_credit',
    'withdrawal', 'transfer_fee',
    'withdrawal_reversal', 'transfer_fee_reversal'
  )),
  amount_kobo bigint not null,
  gross_kobo bigint,
  fee_kobo bigint,
  source_ref text not null,
  withdrawal_id uuid references withdrawal_requests(id),
  note text,
  created_at timestamptz not null default now(),
  unique (entry_type, source_ref)
);

alter table wallet_ledger enable row level security;
drop policy if exists "admins read wallet ledger" on wallet_ledger;
create policy "admins read wallet ledger" on wallet_ledger for select using (public.is_admin());
revoke all on public.wallet_ledger from anon;
revoke insert, update, delete, truncate, references, trigger on public.wallet_ledger from authenticated;
grant select on public.wallet_ledger to authenticated;
do $$ begin
  alter publication supabase_realtime add table wallet_ledger;
exception when duplicate_object then null;
end $$;

-- The ledger is append-only.
create or replace function public.wallet_ledger_immutable()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'wallet_ledger rows cannot be changed or deleted.';
end;
$$;
drop trigger if exists wallet_ledger_no_update on wallet_ledger;
create trigger wallet_ledger_no_update before update or delete on wallet_ledger
  for each row execute procedure public.wallet_ledger_immutable();

-- Every new ledger row moves the cached balance and totals.
create or replace function public.apply_wallet_ledger_entry()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.entry_type = 'opening_balance' then
    return new; -- records the balance that already existed; nothing to move
  end if;
  update wallet_balance set
    balance = balance + new.amount_kobo / 100.0,
    dues_total = dues_total + case when new.entry_type = 'dues_credit' then coalesce(new.gross_kobo, 0) / 100.0 else 0 end,
    pool_total = pool_total + case when new.entry_type = 'pool_credit' then coalesce(new.gross_kobo, 0) / 100.0 else 0 end,
    fees_total = fees_total + case
      when new.entry_type in ('dues_credit', 'pool_credit') then coalesce(new.fee_kobo, 0) / 100.0
      when new.entry_type in ('fee_correction', 'transfer_fee', 'transfer_fee_reversal') then -new.amount_kobo / 100.0
      else 0 end,
    withdrawn_total = withdrawn_total + case
      when new.entry_type in ('withdrawal', 'withdrawal_reversal') then -new.amount_kobo / 100.0
      else 0 end,
    updated_at = now()
  where id = 1;
  return new;
end;
$$;
revoke execute on function public.apply_wallet_ledger_entry() from public, anon, authenticated;
drop trigger if exists on_wallet_ledger_insert on wallet_ledger;
create trigger on_wallet_ledger_insert after insert on wallet_ledger
  for each row execute procedure public.apply_wallet_ledger_entry();

-- ============================================================
-- Credits: net of the Paystack fee.
-- ============================================================

-- Dues: one Paystack transaction can cover several months (one row each).
-- The transaction's fee is split equally across its rows, any remainder kobo
-- going to the latest month, so the rows add up to exactly the real fee.
create or replace function public.credit_wallet_on_payment_success()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  paid bigint;
  txn_amount bigint;
  txn_fee bigint;
  n int;
  last_month text;
  row_fee bigint;
begin
  if new.status in ('success', 'partial') and old.status = 'pending' then
    paid := coalesce(new.paid_kobo, new.amount_kobo);
    txn_amount := coalesce(nullif(new.raw_event->>'amount', '')::bigint, paid);
    txn_fee := coalesce(nullif(new.raw_event->>'fees', '')::bigint, public.paystack_charge_fee_kobo(txn_amount));
    select count(*), max(month) into n, last_month from dues_payments where reference = new.reference;
    n := greatest(n, 1);
    row_fee := txn_fee / n + case when new.month = last_month then txn_fee % n else 0 end;
    row_fee := least(row_fee, paid);
    insert into wallet_ledger (entry_type, amount_kobo, gross_kobo, fee_kobo, source_ref, note)
    values ('dues_credit', paid - row_fee, paid, row_fee, new.reference || ':' || new.month, 'Dues ' || new.month)
    on conflict (entry_type, source_ref) do nothing;
  end if;
  return new;
end;
$$;
revoke execute on function public.credit_wallet_on_payment_success() from public, anon, authenticated;

-- Pool: credit the lesser of what was requested and what Paystack confirmed
-- (unchanged from migration 82), minus the fee Paystack kept.
create or replace function public.credit_wallet_on_pool_payment_success()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  confirmed_kobo bigint;
  credit_kobo bigint;
  fee bigint;
begin
  if new.status = 'success' and old.status = 'pending' then
    confirmed_kobo := nullif(new.raw_event->>'amount', '')::bigint;
    if confirmed_kobo is null or coalesce(new.raw_event->>'currency', 'NGN') <> 'NGN' then
      raise warning 'Pool payment % marked success without a valid confirmed amount; wallet not credited', new.reference;
      return new;
    end if;
    credit_kobo := least(confirmed_kobo, new.amount_kobo);
    fee := least(coalesce(nullif(new.raw_event->>'fees', '')::bigint, public.paystack_charge_fee_kobo(confirmed_kobo)), credit_kobo);
    insert into wallet_ledger (entry_type, amount_kobo, gross_kobo, fee_kobo, source_ref, note)
    values ('pool_credit', credit_kobo - fee, credit_kobo, fee, new.reference, 'Pool: ' || new.contributor_name)
    on conflict (entry_type, source_ref) do nothing;
  end if;
  return new;
end;
$$;
revoke execute on function public.credit_wallet_on_pool_payment_success() from public, anon, authenticated;

-- ============================================================
-- One-time correction of the existing balance.
-- ============================================================
do $$
declare
  current_kobo bigint;
  historic_fees bigint;
  correction bigint;
begin
  if exists (select 1 from wallet_ledger where entry_type = 'opening_balance' and source_ref = 'migration-85') then
    return; -- already run
  end if;

  select round(balance * 100)::bigint into current_kobo from wallet_balance where id = 1 for update;
  insert into wallet_ledger (entry_type, amount_kobo, source_ref, note)
  values ('opening_balance', current_kobo, 'migration-85', 'Balance before the ledger existed (fees not yet deducted)');

  -- Fees Paystack kept on payments that were credited gross, one per transaction.
  select coalesce(sum(fee), 0) into historic_fees from (
    select distinct on (reference)
      coalesce(nullif(raw_event->>'fees', '')::bigint,
               public.paystack_charge_fee_kobo(nullif(raw_event->>'amount', '')::bigint)) as fee
    from dues_payments where status in ('success', 'partial') and raw_event is not null
    union all
    select coalesce(nullif(raw_event->>'fees', '')::bigint,
                    public.paystack_charge_fee_kobo(nullif(raw_event->>'amount', '')::bigint))
    from pool_payments where status = 'success' and raw_event is not null
  ) t;

  -- Never drive the balance below zero; anything left over shows up in reconciliation
  -- against the Paystack balance.
  correction := least(historic_fees, greatest(current_kobo, 0));
  if correction > 0 then
    insert into wallet_ledger (entry_type, amount_kobo, fee_kobo, source_ref, note)
    values ('fee_correction', -correction, correction, 'migration-85', 'Paystack fees on payments credited before fees were tracked');
  end if;

  update wallet_balance set withdrawn_total = coalesce((select sum(amount) from withdrawal_requests where status = 'completed'), 0) where id = 1;
end $$;

-- ============================================================
-- Payout account (where withdrawals are sent).
-- ============================================================
alter table withdrawal_config add column if not exists payout_recipient_code text;
alter table withdrawal_config add column if not exists payout_bank_name text;
alter table withdrawal_config add column if not exists payout_account_name text;
alter table withdrawal_config add column if not exists payout_account_last4 text;
alter table withdrawal_config add column if not exists payout_updated_by uuid references profiles(id);
alter table withdrawal_config add column if not exists payout_updated_at timestamptz;
alter table withdrawal_config add column if not exists pin_failures int not null default 0;
alter table withdrawal_config add column if not exists pin_locked_until timestamptz;

create or replace function public._is_ops_admin(p_actor uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = p_actor and role = 'admin')
     and exists (select 1 from members where profile_id = p_actor and unit = 'Operations')
$$;
revoke execute on function public._is_ops_admin(uuid) from public, anon, authenticated;
grant execute on function public._is_ops_admin(uuid) to service_role;

-- Called only by the wallet-admin Edge Function, after it has resolved the
-- account with Paystack and created the transfer recipient.
create or replace function public.set_payout_account(
  p_actor uuid, p_pin text, p_recipient_code text, p_bank_name text, p_account_name text, p_last4 text
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  cfg record;
  fails int;
begin
  if not public._is_ops_admin(p_actor) then
    return jsonb_build_object('ok', false, 'error', 'Only Operations admins can change the payout account.');
  end if;
  select * into cfg from withdrawal_config where id = 1 for update;
  if cfg.pin_locked_until is not null and cfg.pin_locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'Too many wrong PINs. Try again after ' || to_char(cfg.pin_locked_until at time zone 'Africa/Lagos', 'HH24:MI') || '.');
  end if;
  if cfg.pin_hash is null then
    return jsonb_build_object('ok', false, 'error', 'Set the withdrawal PIN first.');
  end if;
  if crypt(coalesce(p_pin, ''), cfg.pin_hash) <> cfg.pin_hash then
    fails := cfg.pin_failures + 1;
    update withdrawal_config set
      pin_failures = case when fails >= 5 then 0 else fails end,
      pin_locked_until = case when fails >= 5 then now() + interval '1 hour' else pin_locked_until end
    where id = 1;
    return jsonb_build_object('ok', false, 'error',
      case when fails >= 5 then 'Too many wrong PINs. Payout account changes are locked for an hour.' else 'Incorrect PIN.' end);
  end if;

  update withdrawal_config set
    payout_recipient_code = p_recipient_code,
    payout_bank_name = p_bank_name,
    payout_account_name = p_account_name,
    payout_account_last4 = p_last4,
    payout_updated_by = p_actor,
    payout_updated_at = now(),
    pin_failures = 0,
    pin_locked_until = null
  where id = 1;
  -- Any withdrawal waiting for its OTP was started against the old account.
  update withdrawal_requests set status = 'cancelled' where status = 'pending_otp';
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.set_payout_account(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.set_payout_account(uuid, text, text, text, text, text) to service_role;

-- ============================================================
-- Withdrawals become real transfers.
-- ============================================================
alter table withdrawal_requests add column if not exists transfer_fee_kobo bigint;
alter table withdrawal_requests add column if not exists recipient_code text;
alter table withdrawal_requests add column if not exists payout_label text;
alter table withdrawal_requests add column if not exists paystack_transfer_code text;
alter table withdrawal_requests add column if not exists processing_at timestamptz;
alter table withdrawal_requests add column if not exists failure_reason text;

alter table withdrawal_requests drop constraint if exists withdrawal_requests_status_check;
alter table withdrawal_requests add constraint withdrawal_requests_status_check
  check (status in ('pending_otp', 'processing', 'completed', 'failed', 'reversed', 'cancelled', 'expired'));

grant select (transfer_fee_kobo, payout_label, processing_at, failure_reason) on public.withdrawal_requests to authenticated;

create or replace function public.initiate_withdrawal(p_amount numeric, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
  current_balance numeric;
  reserved numeric;
  fee_kobo bigint;
  cfg record;
begin
  if not (public.is_admin() and public.my_unit() = 'Operations') then
    raise exception 'Only Operations admins can initiate a withdrawal.';
  end if;
  if p_amount is null or p_amount < 100 then
    raise exception 'The smallest withdrawal is ₦100.';
  end if;
  p_amount := round(p_amount, 2);

  select * into cfg from withdrawal_config where id = 1;
  if cfg.payout_recipient_code is null then
    raise exception 'Add the payout bank account before withdrawing.';
  end if;

  select balance into current_balance from wallet_balance where id = 1 for update;

  if (select count(*) from withdrawal_requests where requested_by = auth.uid() and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many withdrawal requests. Please wait before trying again.';
  end if;

  update withdrawal_requests set status = 'cancelled'
    where requested_by = auth.uid() and status = 'pending_otp';

  fee_kobo := public.paystack_transfer_fee_kobo(round(p_amount * 100)::bigint);
  select coalesce(sum(amount + coalesce(transfer_fee_kobo, 0) / 100.0), 0) into reserved
    from withdrawal_requests where status = 'pending_otp' and otp_expires_at > now();
  if p_amount + fee_kobo / 100.0 > current_balance - reserved then
    raise exception 'Amount plus the ₦% transfer fee is more than the available balance.', fee_kobo / 100;
  end if;

  insert into withdrawal_requests (requested_by, amount, reason, otp_code, otp_expires_at, transfer_fee_kobo, recipient_code, payout_label)
  values (auth.uid(), p_amount, p_reason, public._gen_otp(), now() + interval '10 minutes', fee_kobo,
          cfg.payout_recipient_code, cfg.payout_bank_name || ' ••' || cfg.payout_account_last4)
  returning id into new_id;
  return new_id;
end;
$$;
revoke execute on function public.initiate_withdrawal(numeric, text) from public, anon;
grant execute on function public.initiate_withdrawal(numeric, text) to authenticated, service_role;

-- PIN + OTP check, then hold the money. Called only by the confirm-withdrawal
-- Edge Function, which sends the Paystack transfer straight after; a client
-- calling it directly could otherwise hold money with no transfer behind it.
create or replace function public.confirm_withdrawal_v3(p_actor uuid, p_request_id uuid, p_pin text, p_otp text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  req record;
  stored_pin_hash text;
  bal numeric;
  attempts int;
  amt_kobo bigint;
begin
  if not public._is_ops_admin(p_actor) then
    return jsonb_build_object('ok', false, 'error', 'Only Operations admins can confirm a withdrawal.');
  end if;

  select balance into bal from wallet_balance where id = 1 for update;
  select * into req from withdrawal_requests where id = p_request_id for update;
  if req is null or req.status <> 'pending_otp' then
    return jsonb_build_object('ok', false, 'error', 'This withdrawal request is no longer pending.');
  end if;
  if req.otp_expires_at < now() then
    update withdrawal_requests set status = 'expired' where id = p_request_id;
    return jsonb_build_object('ok', false, 'error', 'This OTP has expired. Start a new withdrawal request.');
  end if;
  if req.otp_attempts >= 5 then
    update withdrawal_requests set status = 'cancelled' where id = p_request_id;
    return jsonb_build_object('ok', false, 'error', 'Too many incorrect attempts. This request has been cancelled. Start a new one.');
  end if;

  select pin_hash into stored_pin_hash from withdrawal_config where id = 1;
  if stored_pin_hash is null
     or crypt(coalesce(p_pin, ''), stored_pin_hash) <> stored_pin_hash
     or coalesce(p_otp, '') <> req.otp_code then
    attempts := req.otp_attempts + 1;
    update withdrawal_requests
      set otp_attempts = attempts, status = case when attempts >= 5 then 'cancelled' else status end
      where id = p_request_id;
    return jsonb_build_object('ok', false, 'error',
      case when attempts >= 5 then 'Too many incorrect attempts. This request has been cancelled. Start a new one.'
           else 'Incorrect PIN or OTP.' end);
  end if;

  if req.recipient_code is null then
    update withdrawal_requests set status = 'cancelled' where id = p_request_id;
    return jsonb_build_object('ok', false, 'error', 'No payout account on this request. Start a new one.');
  end if;

  amt_kobo := round(req.amount * 100)::bigint;
  if (amt_kobo + coalesce(req.transfer_fee_kobo, 0)) / 100.0 > bal then
    update withdrawal_requests set status = 'cancelled' where id = p_request_id;
    return jsonb_build_object('ok', false, 'error', 'Insufficient wallet balance. This request has been cancelled.');
  end if;

  update withdrawal_requests set status = 'processing', processing_at = now(), otp_code = null where id = p_request_id;
  insert into wallet_ledger (entry_type, amount_kobo, source_ref, withdrawal_id, note)
  values ('withdrawal', -amt_kobo, p_request_id::text, p_request_id, coalesce(req.reason, 'Withdrawal'));
  if coalesce(req.transfer_fee_kobo, 0) > 0 then
    insert into wallet_ledger (entry_type, amount_kobo, fee_kobo, source_ref, withdrawal_id, note)
    values ('transfer_fee', -req.transfer_fee_kobo, req.transfer_fee_kobo, p_request_id::text, p_request_id, 'Paystack transfer fee');
  end if;

  return jsonb_build_object('ok', true, 'amount_kobo', amt_kobo, 'recipient_code', req.recipient_code, 'reason', req.reason);
end;
$$;
revoke execute on function public.confirm_withdrawal_v3(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.confirm_withdrawal_v3(uuid, uuid, text, text) to service_role;

-- Records what Paystack said about a transfer. Idempotent: webhooks retry.
--   'pending'   — transfer accepted/queued; just store the code/note.
--   'completed' — money arrived.
--   'failed' / 'reversed' — money came back; the held amount and fee are released.
create or replace function public.finalize_withdrawal(p_request_id uuid, p_outcome text, p_transfer_code text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  req record;
  amt_kobo bigint;
begin
  select * into req from withdrawal_requests where id = p_request_id for update;
  if req is null then
    return jsonb_build_object('ok', false, 'error', 'Unknown withdrawal.');
  end if;
  if not exists (select 1 from wallet_ledger where entry_type = 'withdrawal' and source_ref = p_request_id::text) then
    return jsonb_build_object('ok', false, 'error', 'This withdrawal never held any money.');
  end if;

  if p_outcome = 'pending' then
    update withdrawal_requests set
      paystack_transfer_code = coalesce(p_transfer_code, paystack_transfer_code),
      failure_reason = p_reason
    where id = p_request_id and status = 'processing';
  elsif p_outcome = 'completed' then
    update withdrawal_requests set status = 'completed', completed_at = now(), failure_reason = null,
      paystack_transfer_code = coalesce(p_transfer_code, paystack_transfer_code)
    where id = p_request_id and status = 'processing';
  elsif p_outcome in ('failed', 'reversed') then
    if req.status in ('processing', 'completed') then
      amt_kobo := round(req.amount * 100)::bigint;
      insert into wallet_ledger (entry_type, amount_kobo, source_ref, withdrawal_id, note)
      values ('withdrawal_reversal', amt_kobo, p_request_id::text, p_request_id, 'Withdrawal ' || p_outcome)
      on conflict (entry_type, source_ref) do nothing;
      if coalesce(req.transfer_fee_kobo, 0) > 0 then
        insert into wallet_ledger (entry_type, amount_kobo, fee_kobo, source_ref, withdrawal_id, note)
        values ('transfer_fee_reversal', req.transfer_fee_kobo, -req.transfer_fee_kobo, p_request_id::text, p_request_id, 'Transfer fee returned')
        on conflict (entry_type, source_ref) do nothing;
      end if;
      update withdrawal_requests set status = p_outcome, failure_reason = p_reason,
        paystack_transfer_code = coalesce(p_transfer_code, paystack_transfer_code)
      where id = p_request_id;
    end if;
  else
    return jsonb_build_object('ok', false, 'error', 'Unknown outcome.');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.finalize_withdrawal(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.finalize_withdrawal(uuid, text, text, text) to service_role;

-- The old confirm paths subtract money without sending any. Take them out of the API.
do $$ begin
  revoke execute on function public.confirm_withdrawal_v2(uuid, text, text) from public, anon, authenticated;
exception when undefined_function then null;
end $$;
do $$ begin
  revoke execute on function public.confirm_withdrawal(uuid, text, text) from public, anon, authenticated;
exception when undefined_function then null;
end $$;

-- ============================================================
-- What the wallet panel shows, in one call.
-- ============================================================
create or replace function public.get_wallet_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  wb record;
  cfg record;
  processing_kobo bigint;
begin
  if not public.is_admin() then
    return null;
  end if;
  select * into wb from wallet_balance where id = 1;
  select * into cfg from withdrawal_config where id = 1;
  select coalesce(sum(round(amount * 100)::bigint + coalesce(transfer_fee_kobo, 0)), 0) into processing_kobo
    from withdrawal_requests where status = 'processing';
  return jsonb_build_object(
    'balance', wb.balance,
    'dues_total', wb.dues_total,
    'pool_total', wb.pool_total,
    'fees_total', wb.fees_total,
    'withdrawn_total', wb.withdrawn_total,
    'processing', processing_kobo / 100.0,
    'updated_at', wb.updated_at,
    'payout', case when cfg.payout_recipient_code is null then null else jsonb_build_object(
      'bank_name', cfg.payout_bank_name,
      'account_name', cfg.payout_account_name,
      'last4', cfg.payout_account_last4,
      'updated_at', cfg.payout_updated_at) end
  );
end;
$$;
revoke execute on function public.get_wallet_overview() from public, anon, authenticated;
grant execute on function public.get_wallet_overview() to authenticated, service_role;
