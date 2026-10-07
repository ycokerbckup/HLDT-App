-- Money-movement hardening. (Applied to production on 2026-10-07.)
-- 1) Wallet can never go negative.
alter table public.wallet_balance add constraint wallet_balance_nonneg check (balance >= 0);

-- 2) Cryptographically secure 6-digit codes (random() is not secure).
create or replace function public._gen_otp() returns text
language sql volatile set search_path = public, extensions as $$
  select lpad(((get_byte(b,0)::bigint*16777216 + get_byte(b,1)*65536 + get_byte(b,2)*256 + get_byte(b,3)) % 1000000)::text, 6, '0')
  from (select gen_random_bytes(4) as b) t
$$;
revoke execute on function public._gen_otp() from public, anon, authenticated;

-- 3) Phone/OTP-email change verification gets an attempts counter.
alter table public.phone_change_verifications add column if not exists attempts int not null default 0;

-- 4) initiate_withdrawal: serialize on the wallet row, count other pending requests against the
--    balance, cancel the caller's older pending requests, and rate-limit to 5 requests/hour/user.
create or replace function public.initiate_withdrawal(p_amount numeric, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
  current_balance numeric;
  reserved numeric;
begin
  if not (public.is_admin() and public.my_unit() = 'Operations') then
    raise exception 'Only Operations admins can initiate a withdrawal.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter a valid amount.';
  end if;
  p_amount := round(p_amount, 2);

  select balance into current_balance from wallet_balance where id = 1 for update;

  if (select count(*) from withdrawal_requests where requested_by = auth.uid() and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many withdrawal requests. Please wait before trying again.';
  end if;

  update withdrawal_requests set status = 'cancelled'
    where requested_by = auth.uid() and status = 'pending_otp';

  select coalesce(sum(amount), 0) into reserved
    from withdrawal_requests where status = 'pending_otp' and otp_expires_at > now();
  if p_amount > current_balance - reserved then
    raise exception 'Amount exceeds the available wallet balance.';
  end if;

  insert into withdrawal_requests (requested_by, amount, reason, otp_code, otp_expires_at)
  values (auth.uid(), p_amount, p_reason, public._gen_otp(), now() + interval '10 minutes')
  returning id into new_id;
  return new_id;
end;
$$;

-- 5) New confirm functions. Wrong guesses are RETURNED (not raised) so the attempt counter is
--    actually saved; raising rolled the counter back, giving unlimited guesses.
--    PIN and OTP failures share one message so each cannot be guessed separately.
create or replace function public.confirm_withdrawal_v2(p_request_id uuid, p_pin text, p_otp text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  req record;
  stored_pin_hash text;
  bal numeric;
  attempts int;
begin
  if not (public.is_admin() and public.my_unit() = 'Operations') then
    raise exception 'Only Operations admins can confirm a withdrawal.';
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

  if req.amount > bal then
    update withdrawal_requests set status = 'cancelled' where id = p_request_id;
    return jsonb_build_object('ok', false, 'error', 'Insufficient wallet balance. This request has been cancelled.');
  end if;

  update withdrawal_requests set status = 'completed', completed_at = now() where id = p_request_id;
  update wallet_balance set balance = balance - req.amount, updated_at = now() where id = 1;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.confirm_pin_change_v2(p_request_id uuid, p_otp text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  req record;
  attempts int;
begin
  if not (public.is_admin() and public.my_unit() = 'Operations') then
    raise exception 'Only Operations admins can change the withdrawal PIN.';
  end if;
  select * into req from pin_change_requests where id = p_request_id and requested_by = auth.uid() for update;
  if req is null or req.status <> 'pending_otp' then
    return jsonb_build_object('ok', false, 'error', 'This PIN change request is no longer pending.');
  end if;
  if req.otp_expires_at < now() then
    update pin_change_requests set status = 'expired' where id = p_request_id;
    return jsonb_build_object('ok', false, 'error', 'This OTP has expired. Start again.');
  end if;
  if req.otp_attempts >= 5 then
    update pin_change_requests set status = 'cancelled' where id = p_request_id;
    return jsonb_build_object('ok', false, 'error', 'Too many incorrect attempts. Start again.');
  end if;
  if coalesce(p_otp, '') <> req.otp_code then
    attempts := req.otp_attempts + 1;
    update pin_change_requests set otp_attempts = attempts, status = case when attempts >= 5 then 'cancelled' else status end where id = p_request_id;
    return jsonb_build_object('ok', false, 'error', case when attempts >= 5 then 'Too many incorrect attempts. Start again.' else 'Incorrect OTP.' end);
  end if;
  update withdrawal_config set pin_hash = req.new_pin_hash where id = 1;
  update pin_change_requests set status = 'completed' where id = p_request_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.confirm_phone_change_v2(p_verification_id uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v record;
  am_authorized boolean;
  n int;
begin
  select can_manage_withdrawal_otp into am_authorized from profiles where id = auth.uid();
  if not coalesce(am_authorized, false) then
    raise exception 'You are not authorized to change the withdrawal OTP recipient.';
  end if;
  select * into v from phone_change_verifications where id = p_verification_id and profile_id = auth.uid() for update;
  if v is null or v.used then
    return jsonb_build_object('ok', false, 'error', 'Invalid or already-used verification.');
  end if;
  if v.expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'This code has expired. Request a new one.');
  end if;
  if v.attempts >= 5 then
    update phone_change_verifications set used = true where id = p_verification_id;
    return jsonb_build_object('ok', false, 'error', 'Too many incorrect attempts. Request a new code.');
  end if;
  if coalesce(p_code, '') <> v.code then
    n := v.attempts + 1;
    update phone_change_verifications set attempts = n, used = (n >= 5) where id = p_verification_id;
    return jsonb_build_object('ok', false, 'error', case when n >= 5 then 'Too many incorrect attempts. Request a new code.' else 'Incorrect code.' end);
  end if;
  update withdrawal_config set otp_email = v.new_phone where id = 1;
  update phone_change_verifications set used = true where id = p_verification_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- 6) Secure codes for the two request functions (same behaviour, CSPRNG instead of random()).
create or replace function public.request_pin_change(p_new_pin text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare new_id uuid;
begin
  if not (public.is_admin() and public.my_unit() = 'Operations') then
    raise exception 'Only Operations admins can change the withdrawal PIN.';
  end if;
  if length(p_new_pin) < 4 then
    raise exception 'PIN must be at least 4 digits.';
  end if;
  insert into pin_change_requests (requested_by, new_pin_hash, otp_code, otp_expires_at)
  values (auth.uid(), crypt(p_new_pin, gen_salt('bf')), public._gen_otp(), now() + interval '10 minutes')
  returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.request_phone_change_code(p_new_phone text)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid; am_authorized boolean;
begin
  select can_manage_withdrawal_otp into am_authorized from profiles where id = auth.uid();
  if not coalesce(am_authorized, false) then
    raise exception 'You are not authorized to change the withdrawal OTP phone number.';
  end if;
  insert into phone_change_verifications (profile_id, code, new_phone, expires_at)
  values (auth.uid(), public._gen_otp(), p_new_phone, now() + interval '10 minutes')
  returning id into new_id;
  return new_id;
end;
$$;

-- 7) Grants for the new functions (same pattern as migration 78).
revoke execute on function public.confirm_withdrawal_v2(uuid, text, text), public.confirm_pin_change_v2(uuid, text),
  public.confirm_phone_change_v2(uuid, text) from public, anon, authenticated;
grant execute on function public.confirm_withdrawal_v2(uuid, text, text), public.confirm_pin_change_v2(uuid, text),
  public.confirm_phone_change_v2(uuid, text) to authenticated, service_role;
revoke execute on function public.initiate_withdrawal(numeric, text), public.request_pin_change(text),
  public.request_phone_change_code(text) from public, anon;
grant execute on function public.initiate_withdrawal(numeric, text), public.request_pin_change(text),
  public.request_phone_change_code(text) to authenticated, service_role;

-- 8) (Applied right after the app switched to the v2 functions.) The old confirm_* functions
--    raise errors, which rolls back the attempt counter. Remove them from the API.
-- revoke execute on function public.confirm_withdrawal(uuid, text, text), public.confirm_pin_change(uuid, text),
--   public.confirm_phone_change(uuid, text) from authenticated;
