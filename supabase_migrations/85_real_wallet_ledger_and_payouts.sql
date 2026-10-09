-- Phase 85: Withdrawals move real money; the wallet holds it until then.
--
-- Builds on what production already has (applied 2026-10-09, see 84a-84c):
--   * credits are net of the real Paystack fee (wallet_tracks_net_cash_after_paystack_fees)
--   * withdrawal OTPs are stored hashed (harden_withdrawal_otp)
--   * every balance change is written to the append-only audit table wallet_ledger
--
-- This migration adds:
--   * A payout bank account (a Paystack transfer recipient). Only an Operations
--     admin with the withdrawal PIN can change it; 5 wrong PINs lock it for an hour.
--   * Withdrawals that pay out for real: after the PIN + OTP check the request
--     becomes 'processing', the amount and Paystack's transfer fee are held (taken
--     off the balance), and the confirm-withdrawal Edge Function sends a Paystack
--     Transfer. paystack-webhook then marks it completed, or failed/reversed, in
--     which case the held money goes back on the balance.
--   * withdrawn_total, and labelled wallet_ledger entries so the app can show
--     what each movement was.
--   * The old confirm_withdrawal_v2 (subtracts money without sending any) leaves the API.
--
-- Paystack transfer fees (checked 2026-10-09):
--   NGN 10 (<= 5,000), NGN 25 (5,001 - 50,000), NGN 50 (> 50,000).

create or replace function public.paystack_transfer_fee_kobo(p_amount_kobo numeric)
returns numeric language sql immutable set search_path = public as $$
  select case when p_amount_kobo <= 500000 then 1000 when p_amount_kobo <= 5000000 then 2500 else 5000 end::numeric
$$;
revoke execute on function public.paystack_transfer_fee_kobo(numeric) from public, anon;
grant execute on function public.paystack_transfer_fee_kobo(numeric) to authenticated, service_role;

-- ============================================================
-- Running total of money sent out.
-- ============================================================
-- Counts only payouts sent through Paystack. Withdrawals recorded before this
-- (which only subtracted a number, no money moved) are not included.
alter table public.wallet_balance add column if not exists withdrawn_total numeric not null default 0;

-- ============================================================
-- Labelled audit entries. A function that moves money can set a label for
-- the current transaction; otherwise the label is worked out from which
-- total changed.
-- ============================================================
create or replace function public.log_wallet_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  label text := nullif(current_setting('wallet.note', true), '');
begin
  if new.balance is distinct from old.balance then
    if label is null then
      label := case
        when new.dues_total > old.dues_total then
          'Dues payment: NGN ' || to_char(new.dues_total - old.dues_total, 'FM999G999G990D00')
          || ' less NGN ' || to_char(new.fees_total - old.fees_total, 'FM999G999G990D00') || ' Paystack fee'
        when new.pool_total > old.pool_total then
          'Pool funding: NGN ' || to_char(new.pool_total - old.pool_total, 'FM999G999G990D00')
          || ' less NGN ' || to_char(new.fees_total - old.fees_total, 'FM999G999G990D00') || ' Paystack fee'
        when new.balance > old.balance then 'credit'
        else 'debit'
      end;
    end if;
    insert into public.wallet_ledger (delta, balance_before, balance_after, actor, note)
    values (new.balance - old.balance, old.balance, new.balance, auth.uid(), label);
  end if;
  return new;
end;
$$;

-- ============================================================
-- Payout account.
-- ============================================================
alter table public.withdrawal_config add column if not exists payout_recipient_code text;
alter table public.withdrawal_config add column if not exists payout_bank_name text;
alter table public.withdrawal_config add column if not exists payout_account_name text;
alter table public.withdrawal_config add column if not exists payout_account_last4 text;
alter table public.withdrawal_config add column if not exists payout_updated_by uuid references public.profiles(id);
alter table public.withdrawal_config add column if not exists payout_updated_at timestamptz;
alter table public.withdrawal_config add column if not exists pin_failures int not null default 0;
alter table public.withdrawal_config add column if not exists pin_locked_until timestamptz;

create or replace function public._is_ops_admin(p_actor uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = p_actor and role = 'admin')
     and exists (select 1 from members where profile_id = p_actor and unit = 'Operations')
$$;
revoke execute on function public._is_ops_admin(uuid) from public, anon, authenticated;
grant execute on function public._is_ops_admin(uuid) to service_role;

-- Called only by the wallet-admin Edge Function after it has resolved the account
-- with Paystack and created the transfer recipient.
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
    return jsonb_build_object('ok', false, 'error', 'Too many wrong PINs. Try again after '
      || to_char(cfg.pin_locked_until at time zone 'Africa/Lagos', 'HH24:MI') || '.');
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
  -- A withdrawal waiting for its OTP was started against the old account.
  delete from withdrawal_otp_secrets where request_id in (select id from withdrawal_requests where status = 'pending_otp');
  update withdrawal_requests set status = 'cancelled' where status = 'pending_otp';
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.set_payout_account(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.set_payout_account(uuid, text, text, text, text, text) to service_role;

-- Alert on payout account changes, alongside the existing PIN / OTP-email alerts.
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
  if old.payout_recipient_code is distinct from new.payout_recipient_code then
    perform public.audit_security_event('withdrawal_payout_account_changed', 'withdrawal_config',
      jsonb_build_object('bank', new.payout_bank_name, 'last4', new.payout_account_last4, 'name', new.payout_account_name),
      'Payout bank account changed',
      'Withdrawals will now be sent to ' || coalesce(new.payout_bank_name, '?') || ' ending ' ||
        coalesce(new.payout_account_last4, '????') || ' (' || coalesce(new.payout_account_name, '?') ||
        '). If this was not you, act immediately.');
  end if;
  return new;
end;
$$;

-- ============================================================
-- Withdrawals become real transfers.
-- ============================================================
alter table public.withdrawal_requests add column if not exists transfer_fee_kobo numeric;
alter table public.withdrawal_requests add column if not exists recipient_code text;
alter table public.withdrawal_requests add column if not exists payout_label text;
alter table public.withdrawal_requests add column if not exists paystack_transfer_code text;
alter table public.withdrawal_requests add column if not exists processing_at timestamptz;
alter table public.withdrawal_requests add column if not exists failure_reason text;

alter table public.withdrawal_requests drop constraint if exists withdrawal_requests_status_check;
alter table public.withdrawal_requests add constraint withdrawal_requests_status_check
  check (status in ('pending_otp', 'processing', 'completed', 'failed', 'reversed', 'cancelled', 'expired'));

grant select (transfer_fee_kobo, payout_label, processing_at, failure_reason) on public.withdrawal_requests to authenticated;

-- Same as production's version (hashed OTP kept in withdrawal_otp_secrets),
-- plus: a payout account is required and the transfer fee counts against the balance.
create or replace function public.initiate_withdrawal(p_amount numeric, p_reason text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  new_id uuid;
  current_balance numeric;
  reserved numeric;
  v_otp text;
  fee_kobo numeric;
  cfg record;
begin
  if not (public.is_admin() and public.my_unit() = 'Operations') then
    raise exception 'Only Operations admins can initiate a withdrawal.';
  end if;
  if p_amount is null or p_amount < 100 then
    raise exception 'The smallest withdrawal is NGN 100.';
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

  delete from withdrawal_otp_secrets where created_at < now() - interval '1 day';

  fee_kobo := public.paystack_transfer_fee_kobo(round(p_amount * 100));
  select coalesce(sum(amount + coalesce(transfer_fee_kobo, 0) / 100.0), 0) into reserved
    from withdrawal_requests where status = 'pending_otp' and otp_expires_at > now();
  if p_amount + fee_kobo / 100.0 > current_balance - reserved then
    raise exception 'Amount plus the NGN % transfer fee is more than the available balance.', (fee_kobo / 100)::int;
  end if;

  v_otp := public._gen_otp();
  insert into withdrawal_requests (requested_by, amount, reason, otp_code, otp_expires_at, transfer_fee_kobo, recipient_code, payout_label)
  values (auth.uid(), p_amount, p_reason, crypt(v_otp, gen_salt('bf')), now() + interval '10 minutes', fee_kobo,
          cfg.payout_recipient_code, cfg.payout_bank_name || ' ••' || cfg.payout_account_last4)
  returning id into new_id;

  insert into withdrawal_otp_secrets (request_id, otp_plain) values (new_id, v_otp);
  return new_id;
end;
$$;
revoke execute on function public.initiate_withdrawal(numeric, text) from public, anon;
grant execute on function public.initiate_withdrawal(numeric, text) to authenticated, service_role;

-- PIN + OTP check, then hold the money. Service role only: the confirm-withdrawal
-- Edge Function calls it and sends the Paystack transfer straight after, so money
-- is never held without a transfer behind it.
create or replace function public.confirm_withdrawal_v3(p_actor uuid, p_request_id uuid, p_pin text, p_otp text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  req record;
  stored_pin_hash text;
  bal numeric;
  attempts int;
  fee numeric;
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
    delete from withdrawal_otp_secrets where request_id = p_request_id;
    return jsonb_build_object('ok', false, 'error', 'This OTP has expired. Start a new withdrawal request.');
  end if;
  if req.otp_attempts >= 5 then
    update withdrawal_requests set status = 'cancelled' where id = p_request_id;
    delete from withdrawal_otp_secrets where request_id = p_request_id;
    return jsonb_build_object('ok', false, 'error', 'Too many incorrect attempts. This request has been cancelled. Start a new one.');
  end if;

  select pin_hash into stored_pin_hash from withdrawal_config where id = 1;
  if stored_pin_hash is null
     or crypt(coalesce(p_pin, ''), stored_pin_hash) <> stored_pin_hash
     or req.otp_code is null
     or crypt(coalesce(p_otp, ''), req.otp_code) <> req.otp_code then
    attempts := req.otp_attempts + 1;
    update withdrawal_requests
      set otp_attempts = attempts, status = case when attempts >= 5 then 'cancelled' else status end
      where id = p_request_id;
    if attempts >= 5 then
      delete from withdrawal_otp_secrets where request_id = p_request_id;
    end if;
    return jsonb_build_object('ok', false, 'error',
      case when attempts >= 5 then 'Too many incorrect attempts. This request has been cancelled. Start a new one.'
           else 'Incorrect PIN or OTP.' end);
  end if;

  if req.recipient_code is null then
    update withdrawal_requests set status = 'cancelled' where id = p_request_id;
    delete from withdrawal_otp_secrets where request_id = p_request_id;
    return jsonb_build_object('ok', false, 'error', 'No payout account on this request. Start a new one.');
  end if;

  fee := coalesce(req.transfer_fee_kobo, 0) / 100.0;
  if req.amount + fee > bal then
    update withdrawal_requests set status = 'cancelled' where id = p_request_id;
    delete from withdrawal_otp_secrets where request_id = p_request_id;
    return jsonb_build_object('ok', false, 'error', 'Insufficient wallet balance. This request has been cancelled.');
  end if;

  update withdrawal_requests set status = 'processing', processing_at = now() where id = p_request_id;
  delete from withdrawal_otp_secrets where request_id = p_request_id;
  perform set_config('wallet.note',
    'Withdrawal to ' || coalesce(req.payout_label, 'bank') || ': NGN ' || to_char(req.amount, 'FM999G999G990D00')
    || ' + NGN ' || to_char(fee, 'FM990D00') || ' transfer fee' || coalesce(' (' || req.reason || ')', ''), true);
  update wallet_balance set
    balance = balance - req.amount - fee,
    withdrawn_total = withdrawn_total + req.amount,
    fees_total = fees_total + fee,
    updated_at = now()
  where id = 1;
  perform set_config('wallet.note', '', true);

  return jsonb_build_object('ok', true, 'amount_kobo', round(req.amount * 100)::bigint,
    'recipient_code', req.recipient_code, 'reason', req.reason);
end;
$$;
revoke execute on function public.confirm_withdrawal_v3(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.confirm_withdrawal_v3(uuid, uuid, text, text) to service_role;

-- Records what Paystack said about a transfer. Idempotent (webhooks retry):
--   'pending'   — accepted/queued; store the transfer code and a status note
--   'completed' — money arrived
--   'failed' / 'reversed' — money came back; the held amount and fee are released once
create or replace function public.finalize_withdrawal(p_request_id uuid, p_outcome text, p_transfer_code text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  req record;
  fee numeric;
begin
  perform 1 from wallet_balance where id = 1 for update;
  select * into req from withdrawal_requests where id = p_request_id for update;
  if req is null then
    return jsonb_build_object('ok', false, 'error', 'Unknown withdrawal.');
  end if;
  if req.processing_at is null then
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
      fee := coalesce(req.transfer_fee_kobo, 0) / 100.0;
      perform set_config('wallet.note',
        'Withdrawal ' || p_outcome || ', returned: NGN ' || to_char(req.amount, 'FM999G999G990D00')
        || ' + NGN ' || to_char(fee, 'FM990D00') || ' fee', true);
      update wallet_balance set
        balance = balance + req.amount + fee,
        withdrawn_total = withdrawn_total - req.amount,
        fees_total = fees_total - fee,
        updated_at = now()
      where id = 1;
      perform set_config('wallet.note', '', true);
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

-- Alert when a payout fails or is reversed, alongside the existing withdrawal alerts.
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
      jsonb_build_object('amount', new.amount, 'reason', new.reason, 'to', new.payout_label),
      'Withdrawal completed', 'NGN ' || to_char(new.amount, 'FM999G999G999D00') || ' was withdrawn from the wallet by '
        || coalesce(who, 'an admin') || coalesce(' to ' || new.payout_label, '') || '.');
  elsif new.status in ('failed', 'reversed') and old.status is distinct from new.status then
    perform public.audit_security_event('withdrawal_' || new.status, new.id::text,
      jsonb_build_object('amount', new.amount, 'reason', new.failure_reason),
      'Withdrawal ' || new.status, 'The payout of NGN ' || to_char(new.amount, 'FM999G999G999D00')
        || ' did not go through (' || coalesce(new.failure_reason, 'no reason given') || '). The money is back in the wallet.');
  elsif new.status = 'cancelled' and old.status is distinct from 'cancelled' and new.otp_attempts >= 5 then
    perform public.audit_security_event('withdrawal_failed_attempts', new.id::text,
      jsonb_build_object('amount', new.amount, 'attempts', new.otp_attempts),
      'Withdrawal blocked: too many wrong PIN/OTP attempts',
      'A withdrawal of NGN ' || to_char(new.amount, 'FM999G999G999D00') || ' was cancelled after 5 incorrect PIN/OTP attempts.');
  end if;
  return new;
end;
$$;

-- The old confirm paths subtract money without sending any.
revoke execute on function public.confirm_withdrawal_v2(uuid, text, text) from public, anon, authenticated;
do $$ begin
  revoke execute on function public.confirm_withdrawal(uuid, text, text) from public, anon, authenticated;
exception when undefined_function then null;
end $$;

-- ============================================================
-- Everything the wallet panel shows, in one call.
-- ============================================================
create or replace function public.get_wallet_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  wb record;
  cfg record;
  processing numeric;
begin
  if not public.is_admin() then
    return null;
  end if;
  select * into wb from wallet_balance where id = 1;
  select * into cfg from withdrawal_config where id = 1;
  select coalesce(sum(amount + coalesce(transfer_fee_kobo, 0) / 100.0), 0) into processing
    from withdrawal_requests where status = 'processing';
  return jsonb_build_object(
    'balance', wb.balance,
    'dues_total', wb.dues_total,
    'pool_total', wb.pool_total,
    'fees_total', wb.fees_total,
    'withdrawn_total', wb.withdrawn_total,
    'processing', processing,
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
