-- Phase 61: Fix "function gen_salt(unknown) does not exist" — on
-- Supabase, pgcrypto's functions live in the extensions schema, not
-- public. These functions deliberately lock their search_path for
-- security, so they need extensions added explicitly rather than
-- relying on it being found automatically.
-- Run after 67_email_otp_instead_of_sms.sql.

create or replace function public.set_withdrawal_pin(p_new_pin text)
returns void language plpgsql security definer set search_path = public, extensions as $$
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

create or replace function public.confirm_withdrawal(p_request_id uuid, p_pin text, p_otp text)
returns void language plpgsql security definer set search_path = public, extensions as $$
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
