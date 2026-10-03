-- Phase 68: Changing the withdrawal PIN now requires OTP confirmation
-- too, not just typing a new PIN twice — the same security bar as an
-- actual withdrawal. The new PIN is hashed immediately on request
-- (never stored or sent in plain text) and only applied once the OTP
-- is confirmed.
-- Run after 75_ops_only_withdrawal_and_fix_pin_status.sql.

create table pin_change_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid references profiles(id),
  new_pin_hash text not null,
  otp_code text not null,
  otp_expires_at timestamptz not null,
  otp_attempts int not null default 0,
  status text not null default 'pending_otp' check (status in ('pending_otp', 'completed', 'cancelled', 'expired')),
  created_at timestamptz default now()
);
alter table pin_change_requests enable row level security;
-- No client policies at all — only the security-definer RPCs below
-- (and the service-role-only sending function) touch this table.

create or replace function public.request_pin_change(p_new_pin text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  new_id uuid;
begin
  if not (public.is_admin() and public.my_unit() = 'Operations') then
    raise exception 'Only Operations admins can change the withdrawal PIN.';
  end if;
  if length(p_new_pin) < 4 then
    raise exception 'PIN must be at least 4 digits.';
  end if;

  insert into pin_change_requests (requested_by, new_pin_hash, otp_code, otp_expires_at)
  values (
    auth.uid(), crypt(p_new_pin, gen_salt('bf')),
    lpad((floor(random() * 1000000))::text, 6, '0'),
    now() + interval '10 minutes'
  )
  returning id into new_id;

  return new_id;
end;
$$;
grant execute on function public.request_pin_change(text) to authenticated;

-- Called only by the sending edge function (service role) — reads the
-- OTP and the configured recipient, never exposed to a general client.
create or replace function public.get_pin_change_otp_for_sending(p_request_id uuid)
returns table(otp_code text, otp_email text) language plpgsql security definer set search_path = public as $$
begin
  return query
    select pcr.otp_code, wc.otp_email
    from pin_change_requests pcr, withdrawal_config wc
    where pcr.id = p_request_id and wc.id = 1 and pcr.status = 'pending_otp';
end;
$$;
grant execute on function public.get_pin_change_otp_for_sending(uuid) to service_role;

create or replace function public.confirm_pin_change(p_request_id uuid, p_otp text)
returns void language plpgsql security definer set search_path = public as $$
declare
  req record;
begin
  if not (public.is_admin() and public.my_unit() = 'Operations') then
    raise exception 'Only Operations admins can change the withdrawal PIN.';
  end if;

  select * into req from pin_change_requests where id = p_request_id and requested_by = auth.uid() for update;
  if req is null or req.status != 'pending_otp' then
    raise exception 'This PIN change request is no longer pending.';
  end if;
  if req.otp_expires_at < now() then
    update pin_change_requests set status = 'expired' where id = p_request_id;
    raise exception 'This OTP has expired — start again.';
  end if;
  if req.otp_attempts >= 5 then
    update pin_change_requests set status = 'cancelled' where id = p_request_id;
    raise exception 'Too many incorrect attempts — this request has been cancelled. Start again.';
  end if;
  if p_otp != req.otp_code then
    update pin_change_requests set otp_attempts = otp_attempts + 1 where id = p_request_id;
    raise exception 'Incorrect OTP.';
  end if;

  update withdrawal_config set pin_hash = req.new_pin_hash where id = 1;
  update pin_change_requests set status = 'completed' where id = p_request_id;
end;
$$;
grant execute on function public.confirm_pin_change(uuid, text) to authenticated;

-- set_withdrawal_pin is superseded by the request/confirm pair above.
drop function if exists public.set_withdrawal_pin(text);
