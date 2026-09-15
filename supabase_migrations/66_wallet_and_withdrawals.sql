-- Phase 59: Real financial controls for the wallet.
--
-- (1) The wallet balance stops being freely editable by any admin —
--     it's now driven entirely by real transactions: successful dues
--     payments add to it, completed withdrawals subtract from it.
-- (2) A withdrawal system: only Welfare/Operations can initiate one,
--     and completing it requires BOTH a PIN and an OTP sent by SMS —
--     neither alone is enough.
-- (3) The phone number that receives withdrawal OTPs can only ever be
--     changed by whichever single person is flagged as authorized to
--     do so (set manually below, targeting one specific account —
--     never inferred or guessed), and changing it requires verifying
--     a code sent to THEIR email first.
--
-- Run after 65_multi_month_dues_payment.sql.

create extension if not exists pgcrypto;

-- ============================================================
-- Wallet balance becomes computed, not manually set.
-- ============================================================
drop policy if exists "admins update wallet balance" on wallet_balance;
-- No update policy for regular clients at all now — only triggers
-- (via security definer functions) and the withdrawal-confirmation
-- RPC touch this table going forward.

create or replace function public.credit_wallet_on_payment_success()
returns trigger as $$
begin
  if new.status in ('success', 'partial') and old.status = 'pending' then
    update wallet_balance set balance = balance + coalesce(new.paid_kobo, new.amount_kobo) / 100.0, updated_at = now() where id = 1;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_dues_payment_credit_wallet on dues_payments;
create trigger on_dues_payment_credit_wallet
  after update on dues_payments
  for each row execute procedure public.credit_wallet_on_payment_success();

-- ============================================================
-- Support for splitting a real but short/over payment equally
-- across the months it was meant to cover, instead of flagging it
-- for manual review. paid_kobo is what was actually credited to
-- THIS specific month; owed_kobo is what's still outstanding on it.
-- ============================================================
alter table dues_payments add column if not exists paid_kobo integer;
alter table dues_payments add column if not exists owed_kobo integer default 0;

alter table dues_payments drop constraint dues_payments_status_check;
alter table dues_payments add constraint dues_payments_status_check
  check (status in ('pending', 'success', 'partial', 'failed', 'abandoned'));

-- ============================================================
-- Withdrawal system.
-- ============================================================
create table withdrawal_config (
  id int primary key default 1,
  pin_hash text,
  otp_phone text not null default '09157443579',
  check (id = 1)
);
insert into withdrawal_config (id) values (1);
alter table withdrawal_config enable row level security;
create policy "welfare ops read withdrawal config" on withdrawal_config for select using (public.is_admin() and public.is_welfare_or_ops());
-- No general update policy — the PIN is set via a dedicated RPC
-- (hashed, never stored or read in plain text), and otp_phone is
-- only ever changed via the email-verified phone-change RPCs below.

create table withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid references profiles(id),
  amount numeric not null check (amount > 0),
  reason text,
  status text not null default 'pending_otp' check (status in ('pending_otp', 'completed', 'cancelled', 'expired')),
  otp_code text,
  otp_expires_at timestamptz,
  otp_attempts int not null default 0,
  completed_at timestamptz,
  created_at timestamptz default now()
);
alter table withdrawal_requests enable row level security;
create policy "welfare ops view withdrawal requests" on withdrawal_requests for select using (public.is_admin() and public.is_welfare_or_ops());
-- No client insert/update policy — all writes go through the
-- dedicated RPCs below, which enforce the PIN/OTP checks themselves.

create or replace function public.set_withdrawal_pin(p_new_pin text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() and public.is_welfare_or_ops()) then
    raise exception 'Only Welfare/Operations admins can set the withdrawal PIN.';
  end if;
  if length(p_new_pin) < 4 then
    raise exception 'PIN must be at least 4 digits.';
  end if;
  update withdrawal_config set pin_hash = crypt(p_new_pin, gen_salt('bf')) where id = 1;
end;
$$;
grant execute on function public.set_withdrawal_pin(text) to authenticated;

create or replace function public.initiate_withdrawal(p_amount numeric, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
  current_balance numeric;
begin
  if not (public.is_admin() and public.is_welfare_or_ops()) then
    raise exception 'Only Welfare/Operations admins can initiate a withdrawal.';
  end if;
  select balance into current_balance from wallet_balance where id = 1;
  if p_amount > current_balance then
    raise exception 'Amount exceeds the current wallet balance.';
  end if;

  insert into withdrawal_requests (requested_by, amount, reason, otp_code, otp_expires_at)
  values (
    auth.uid(), p_amount, p_reason,
    lpad((floor(random() * 1000000))::text, 6, '0'),
    now() + interval '10 minutes'
  )
  returning id into new_id;

  return new_id;
end;
$$;
grant execute on function public.initiate_withdrawal(numeric, text) to authenticated;

-- Called by a trusted backend (the SMS-sending edge function) to read
-- the OTP it needs to send out, and by nothing else — never exposed
-- to a general client read.
create or replace function public.get_withdrawal_otp_for_sending(p_request_id uuid)
returns table(otp_code text, otp_phone text) language plpgsql security definer set search_path = public as $$
begin
  return query
    select wr.otp_code, wc.otp_phone
    from withdrawal_requests wr, withdrawal_config wc
    where wr.id = p_request_id and wc.id = 1 and wr.status = 'pending_otp';
end;
$$;
grant execute on function public.get_withdrawal_otp_for_sending(uuid) to service_role;

create or replace function public.confirm_withdrawal(p_request_id uuid, p_pin text, p_otp text)
returns void language plpgsql security definer set search_path = public as $$
declare
  req record;
  stored_pin_hash text;
begin
  if not (public.is_admin() and public.is_welfare_or_ops()) then
    raise exception 'Only Welfare/Operations admins can confirm a withdrawal.';
  end if;

  select * into req from withdrawal_requests where id = p_request_id for update;
  if req is null or req.status != 'pending_otp' then
    raise exception 'This withdrawal request is no longer pending.';
  end if;
  if req.otp_expires_at < now() then
    update withdrawal_requests set status = 'expired' where id = p_request_id;
    raise exception 'This OTP has expired — start a new withdrawal request.';
  end if;
  if req.otp_attempts >= 5 then
    update withdrawal_requests set status = 'cancelled' where id = p_request_id;
    raise exception 'Too many incorrect attempts — this request has been cancelled. Start a new one.';
  end if;

  select pin_hash into stored_pin_hash from withdrawal_config where id = 1;
  if stored_pin_hash is null or crypt(p_pin, stored_pin_hash) != stored_pin_hash then
    update withdrawal_requests set otp_attempts = otp_attempts + 1 where id = p_request_id;
    raise exception 'Incorrect PIN.';
  end if;
  if p_otp != req.otp_code then
    update withdrawal_requests set otp_attempts = otp_attempts + 1 where id = p_request_id;
    raise exception 'Incorrect OTP.';
  end if;

  update withdrawal_requests set status = 'completed', completed_at = now() where id = p_request_id;
  update wallet_balance set balance = balance - req.amount, updated_at = now() where id = 1;
end;
$$;
grant execute on function public.confirm_withdrawal(uuid, text, text) to authenticated;

-- ============================================================
-- Phone-number-change permission — set this to exactly one real
-- person's account. Nothing here guesses who that is.
-- ============================================================
alter table profiles add column if not exists can_manage_withdrawal_otp boolean not null default false;
-- To grant this to yourself, run once, replacing the email:
--   update profiles set can_manage_withdrawal_otp = true where id = (select id from auth.users where email = 'your-email-here');

create table phone_change_verifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id),
  code text not null,
  new_phone text not null,
  expires_at timestamptz not null,
  used boolean not null default false,
  created_at timestamptz default now()
);
alter table phone_change_verifications enable row level security;
-- No client policies at all — only the dedicated RPCs (security
-- definer) touch this table.

create or replace function public.request_phone_change_code(p_new_phone text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
  am_authorized boolean;
begin
  select can_manage_withdrawal_otp into am_authorized from profiles where id = auth.uid();
  if not coalesce(am_authorized, false) then
    raise exception 'You are not authorized to change the withdrawal OTP phone number.';
  end if;

  insert into phone_change_verifications (profile_id, code, new_phone, expires_at)
  values (auth.uid(), lpad((floor(random() * 1000000))::text, 6, '0'), p_new_phone, now() + interval '10 minutes')
  returning id into new_id;

  return new_id;
end;
$$;
grant execute on function public.request_phone_change_code(text) to authenticated;

create or replace function public.get_phone_change_code_for_sending(p_verification_id uuid)
returns table(code text, new_phone text, profile_email text) language plpgsql security definer set search_path = public as $$
begin
  return query
    select pcv.code, pcv.new_phone, u.email
    from phone_change_verifications pcv
    join auth.users u on u.id = pcv.profile_id
    where pcv.id = p_verification_id and pcv.used = false;
end;
$$;
grant execute on function public.get_phone_change_code_for_sending(uuid) to service_role;

create or replace function public.confirm_phone_change(p_verification_id uuid, p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v record;
  am_authorized boolean;
begin
  select can_manage_withdrawal_otp into am_authorized from profiles where id = auth.uid();
  if not coalesce(am_authorized, false) then
    raise exception 'You are not authorized to change the withdrawal OTP phone number.';
  end if;

  select * into v from phone_change_verifications where id = p_verification_id and profile_id = auth.uid();
  if v is null or v.used then
    raise exception 'Invalid or already-used verification.';
  end if;
  if v.expires_at < now() then
    raise exception 'This code has expired — request a new one.';
  end if;
  if v.code != p_code then
    raise exception 'Incorrect code.';
  end if;

  update withdrawal_config set otp_phone = v.new_phone where id = 1;
  update phone_change_verifications set used = true where id = p_verification_id;
end;
$$;
grant execute on function public.confirm_phone_change(uuid, text) to authenticated;
