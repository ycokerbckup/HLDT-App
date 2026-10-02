-- Phase 67: Two changes.
-- (1) Restrict setting the PIN and withdrawing to Operations
--     specifically (not Welfare) — tightening who holds this.
-- (2) Replace the pin-status VIEW with a security-definer RPC,
--     matching the same proven pattern set_withdrawal_pin and
--     confirm_withdrawal already use successfully — the view's
--     security_invoker + RLS interaction was the likely source of
--     it never correctly reporting "a PIN is set."
-- Run after 74_pool_funder.sql.

drop view if exists withdrawal_pin_status;

create or replace function public.get_withdrawal_pin_status()
returns boolean language plpgsql security definer set search_path = public as $$
declare
  result boolean;
begin
  if not public.is_admin() then
    return false;
  end if;
  select (pin_hash is not null) into result from withdrawal_config where id = 1;
  return coalesce(result, false);
end;
$$;
grant execute on function public.get_withdrawal_pin_status() to authenticated;

create or replace function public.set_withdrawal_pin(p_new_pin text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not (public.is_admin() and public.my_unit() = 'Operations') then
    raise exception 'Only Operations admins can set the withdrawal PIN.';
  end if;
  if length(p_new_pin) < 4 then
    raise exception 'PIN must be at least 4 digits.';
  end if;
  update withdrawal_config set pin_hash = crypt(p_new_pin, gen_salt('bf')) where id = 1;
end;
$$;

create or replace function public.initiate_withdrawal(p_amount numeric, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
  current_balance numeric;
begin
  if not (public.is_admin() and public.my_unit() = 'Operations') then
    raise exception 'Only Operations admins can initiate a withdrawal.';
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

create or replace function public.confirm_withdrawal(p_request_id uuid, p_pin text, p_otp text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  req record;
  stored_pin_hash text;
begin
  if not (public.is_admin() and public.my_unit() = 'Operations') then
    raise exception 'Only Operations admins can confirm a withdrawal.';
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
