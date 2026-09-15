-- Phase 60: SMS costs money per message; email doesn't (we already
-- pay nothing extra for the Gmail SMTP used everywhere else in this
-- app). Withdrawal OTPs now go to an email address instead of a
-- phone number — same security properties (a separate channel only
-- an authorized person controls), zero ongoing cost.
-- Run after 66_wallet_and_withdrawals.sql.

alter table withdrawal_config add column if not exists otp_email text;
update withdrawal_config set otp_email = coalesce(otp_email, '') where id = 1;
alter table withdrawal_config drop column if exists otp_phone;

drop function if exists public.get_withdrawal_otp_for_sending(uuid);
create or replace function public.get_withdrawal_otp_for_sending(p_request_id uuid)
returns table(otp_code text, otp_email text) language plpgsql security definer set search_path = public as $$
begin
  return query
    select wr.otp_code, wc.otp_email
    from withdrawal_requests wr, withdrawal_config wc
    where wr.id = p_request_id and wc.id = 1 and wr.status = 'pending_otp';
end;
$$;
grant execute on function public.get_withdrawal_otp_for_sending(uuid) to service_role;

-- request_phone_change_code / confirm_phone_change already operate on
-- whatever new value is passed in — they never assumed it was a phone
-- number specifically, so no change needed there beyond what they
-- write now landing in otp_email instead of otp_phone.
create or replace function public.confirm_phone_change(p_verification_id uuid, p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v record;
  am_authorized boolean;
begin
  select can_manage_withdrawal_otp into am_authorized from profiles where id = auth.uid();
  if not coalesce(am_authorized, false) then
    raise exception 'You are not authorized to change the withdrawal OTP recipient.';
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

  update withdrawal_config set otp_email = v.new_phone where id = 1;
  update phone_change_verifications set used = true where id = p_verification_id;
end;
$$;
