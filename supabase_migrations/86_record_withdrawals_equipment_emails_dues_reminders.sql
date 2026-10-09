-- Phase 86
--  (a) "Record" withdrawal mode, the default until real payouts are available.
--      Paystack Starter accounts can't send transfers, and pay all collections into
--      the team bank account automatically. In record mode a withdrawal still needs
--      the PIN + emailed OTP, but instead of a Paystack transfer it records money
--      taken out of that bank account: the balance drops immediately, no transfer fee.
--      Switch back with:  update withdrawal_config set payout_mode = 'paystack' where id = 1;
--  (b) Equipment alerts by email: a newly reported issue (ticket) or a new inventory
--      item notifies the HOD(s) and every Technical unit member who has a login.
--  (c) Dues reminders go only to members who haven't paid the current month
--      (dues tracked from October 2026), instead of an announcement to everyone.
--  (d) Wallet activity details: each ledger entry links to the payment or withdrawal
--      behind it; get_wallet_entry(id) returns who, note, fee and exact times.

-- ============================================================
-- (a) Record mode
-- ============================================================
alter table public.withdrawal_config add column if not exists payout_mode text not null default 'record'
  check (payout_mode in ('record', 'paystack'));

create or replace function public.initiate_withdrawal(p_amount numeric, p_reason text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  new_id uuid;
  current_balance numeric;
  reserved numeric;
  v_otp text;
  fee_kobo numeric;
  cfg record;
  is_record boolean;
begin
  if not (public.is_admin() and public.my_unit() = 'Operations') then
    raise exception 'Only Operations admins can initiate a withdrawal.';
  end if;
  if p_amount is null or p_amount < 100 then
    raise exception 'The smallest withdrawal is NGN 100.';
  end if;
  p_amount := round(p_amount, 2);

  select * into cfg from withdrawal_config where id = 1;
  is_record := coalesce(cfg.payout_mode, 'record') = 'record';
  if is_record and coalesce(btrim(p_reason), '') = '' then
    raise exception 'Say what the money was for.';
  end if;
  if not is_record and cfg.payout_recipient_code is null then
    raise exception 'Add the payout bank account before withdrawing.';
  end if;

  select balance into current_balance from wallet_balance where id = 1 for update;

  if (select count(*) from withdrawal_requests where requested_by = auth.uid() and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many withdrawal requests. Please wait before trying again.';
  end if;

  update withdrawal_requests set status = 'cancelled'
    where requested_by = auth.uid() and status = 'pending_otp';

  delete from withdrawal_otp_secrets where created_at < now() - interval '1 day';

  fee_kobo := case when is_record then 0 else public.paystack_transfer_fee_kobo(round(p_amount * 100)) end;
  select coalesce(sum(amount + coalesce(transfer_fee_kobo, 0) / 100.0), 0) into reserved
    from withdrawal_requests where status = 'pending_otp' and otp_expires_at > now();
  if p_amount + fee_kobo / 100.0 > current_balance - reserved then
    raise exception 'That is more than the available balance.';
  end if;

  v_otp := public._gen_otp();
  insert into withdrawal_requests (requested_by, amount, reason, otp_code, otp_expires_at, transfer_fee_kobo, recipient_code, payout_label)
  values (auth.uid(), p_amount, p_reason, crypt(v_otp, gen_salt('bf')), now() + interval '10 minutes', fee_kobo,
          case when is_record then null else cfg.payout_recipient_code end,
          case when is_record then 'Team bank account' else cfg.payout_bank_name || ' ••' || cfg.payout_account_last4 end)
  returning id into new_id;

  insert into withdrawal_otp_secrets (request_id, otp_plain) values (new_id, v_otp);
  return new_id;
end;
$$;
revoke execute on function public.initiate_withdrawal(numeric, text) from public, anon;
grant execute on function public.initiate_withdrawal(numeric, text) to authenticated, service_role;

create or replace function public.confirm_withdrawal_v3(p_actor uuid, p_request_id uuid, p_pin text, p_otp text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  req record;
  stored_pin_hash text;
  bal numeric;
  attempts int;
  fee numeric;
  mode text;
begin
  if not public._is_ops_admin(p_actor) then
    return jsonb_build_object('ok', false, 'error', 'Only Operations admins can confirm a withdrawal.');
  end if;

  select balance into bal from wallet_balance where id = 1 for update;
  select coalesce(payout_mode, 'record') into mode from withdrawal_config where id = 1;
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

  -- A request started in one mode can't be confirmed in the other.
  if (mode = 'paystack' and req.recipient_code is null) or (mode = 'record' and req.recipient_code is not null) then
    update withdrawal_requests set status = 'cancelled' where id = p_request_id;
    delete from withdrawal_otp_secrets where request_id = p_request_id;
    return jsonb_build_object('ok', false, 'error', 'Withdrawal settings changed since this was started. Start a new one.');
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
    case when mode = 'record'
      then 'Withdrawal recorded: NGN ' || to_char(req.amount, 'FM999G999G990D00') || coalesce(' (' || req.reason || ')', '')
      else 'Withdrawal to ' || coalesce(req.payout_label, 'bank') || ': NGN ' || to_char(req.amount, 'FM999G999G990D00')
        || ' + NGN ' || to_char(fee, 'FM990D00') || ' transfer fee' || coalesce(' (' || req.reason || ')', '')
    end, true);
  perform set_config('wallet.ref', 'withdrawal:' || p_request_id, true);
  update wallet_balance set
    balance = balance - req.amount - fee,
    withdrawn_total = withdrawn_total + req.amount,
    fees_total = fees_total + fee,
    updated_at = now()
  where id = 1;
  perform set_config('wallet.note', '', true);
  perform set_config('wallet.ref', '', true);

  return jsonb_build_object('ok', true, 'mode', mode, 'amount_kobo', round(req.amount * 100)::bigint,
    'recipient_code', req.recipient_code, 'reason', req.reason);
end;
$$;
revoke execute on function public.confirm_withdrawal_v3(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.confirm_withdrawal_v3(uuid, uuid, text, text) to service_role;

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
    'mode', coalesce(cfg.payout_mode, 'record'),
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

-- ============================================================
-- (b) Equipment alerts: HOD(s) + Technical unit, by email and in-app
-- ============================================================
create or replace function public.notify_equipment_team(p_title text, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare
  rec record;
begin
  for rec in
    select distinct m.profile_id
    from members m
    where m.profile_id is not null
      and (m.tier = 'HOD' or m.unit = 'Technical')
      and coalesce(m.suspended, false) = false
      and m.profile_id is distinct from auth.uid()   -- not the person who just did it
  loop
    insert into public.notifications (type, title, body, link_tab, target_role, target_profile_id)
    values ('equipment_alert', p_title, p_body, 'equipment', 'all', rec.profile_id);
  end loop;
end;
$$;
revoke execute on function public.notify_equipment_team(text, text) from public, anon, authenticated;

create or replace function public.notify_equipment_ticket()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  labels jsonb := '{"proPresenter":"ProPresenter","vmix":"vMix","resolume":"Resolume","monitors":"Monitors","screens":"Screens","network":"Network"}';
  problems text;
begin
  if new.status <> 'Open' then
    return new; -- an all-clear check isn't a ticket
  end if;
  select string_agg(coalesce(labels->>k, k), ', ' order by k) into problems
    from jsonb_each_text(coalesce(new.systems, '{}'::jsonb)) as s(k, v) where v = 'Issue';
  perform public.notify_equipment_team(
    'Equipment issue reported' || coalesce(': ' || problems, ''),
    coalesce(new.reporter, 'Someone') || ' reported a problem'
      || coalesce(' with ' || problems, '') || '.'
      || coalesce(' "' || left(new.description, 300) || '"', '')
  );
  return new;
end;
$$;
revoke execute on function public.notify_equipment_ticket() from public, anon, authenticated;

create or replace function public.notify_inventory_item()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  who text;
begin
  select coalesce(m.name, p.full_name) into who
    from profiles p left join members m on m.profile_id = p.id where p.id = new.added_by limit 1;
  perform public.notify_equipment_team(
    'New inventory item: ' || new.name,
    coalesce(who, 'Someone') || ' added ' || coalesce(new.quantity, 1) || ' × ' || new.name
      || coalesce(' (' || new.category || coalesce(', ' || lower(new.condition), '') || ')', '') || ' to the inventory.'
  );
  return new;
end;
$$;
revoke execute on function public.notify_inventory_item() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'on_ticket_created_email_team') then
    create trigger on_ticket_created_email_team after insert on public.tickets
      for each row execute procedure public.notify_equipment_ticket();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'on_inventory_item_added') then
    create trigger on_inventory_item_added after insert on public.equipment_inventory
      for each row execute procedure public.notify_inventory_item();
  end if;
end $$;

-- ============================================================
-- (c) Dues reminders only to members who haven't paid this month
-- ============================================================
create or replace function public.run_dues_reminder()
returns void language plpgsql security definer set search_path = public as $$
declare
  this_month text := to_char(now() at time zone 'Africa/Lagos', 'YYYY-MM');
  month_label text := trim(to_char(now() at time zone 'Africa/Lagos', 'FMMonth YYYY'));
  rec record;
  manual jsonb;
  manual_status text;
  v_owed int;
  rate int;
begin
  if this_month < '2026-10' then
    return; -- dues are tracked from October 2026
  end if;

  for rec in
    select m.id, m.profile_id, m.tier, m.dues
    from members m
    where m.profile_id is not null
      and coalesce(m.unavailable, false) = false
      and m.tier is distinct from 'Trainee'
  loop
    -- Paid online in full?
    if exists (select 1 from dues_payments where member_id = rec.id and month = this_month and status = 'success') then
      continue;
    end if;
    -- Recorded by hand as paid or waived?
    manual := rec.dues -> this_month;
    manual_status := case jsonb_typeof(manual) when 'object' then manual ->> 'status' when 'string' then manual #>> '{}' else null end;
    if manual_status in ('paid', 'free') then
      continue;
    end if;

    rate := case when rec.tier in ('Leader', 'HOD') then 5500 else 3500 end;
    v_owed := null;
    select dp.owed_kobo into v_owed from dues_payments dp
      where dp.member_id = rec.id and dp.month = this_month and dp.status = 'partial' order by dp.created_at desc limit 1;

    insert into public.notifications (type, title, body, link_tab, target_role, target_profile_id)
    values ('dues_reminder', 'Your dues for ' || month_label,
      case when v_owed is not null and v_owed > 0
        then 'You still owe NGN ' || to_char(v_owed / 100.0, 'FM999G999G990') || ' of your dues for ' || month_label || '. You can pay the rest in the Dues tab.'
        else 'You haven''t paid your NGN ' || to_char(rate, 'FM999G999G990') || ' dues for ' || month_label || ' yet. You can pay in the Dues tab, or reach out to Welfare or Operations.'
      end,
      'dues', 'all', rec.profile_id);
  end loop;
end;
$$;
revoke execute on function public.run_dues_reminder() from public, anon, authenticated;

-- ============================================================
-- (d) Wallet activity details: every ledger entry links to what caused it
--     (a dues payment row, a pool payment, or a withdrawal), so the app can show
--     who paid, the note, the fee and the exact time when an entry is tapped.
-- ============================================================
alter table public.wallet_ledger add column if not exists ref text;

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
    insert into public.wallet_ledger (delta, balance_before, balance_after, actor, note, ref)
    values (new.balance - old.balance, old.balance, new.balance, auth.uid(), label,
            nullif(current_setting('wallet.ref', true), ''));
  end if;
  return new;
end;
$$;

create or replace function public.credit_wallet_on_payment_success()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  total_kobo numeric;
  fee_total_kobo numeric;
  fee_share_kobo numeric;
  net_kobo numeric;
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

    -- One Paystack charge can cover several months (one row each); each row carries its
    -- proportional share of the charge's real fee.
    total_kobo := nullif(new.raw_event->>'amount', '')::numeric;
    fee_total_kobo := nullif(new.raw_event->>'fees', '')::numeric;
    if fee_total_kobo is null or total_kobo is null or total_kobo <= 0 then
      raise warning 'Dues payment %: Paystack fee not reported; using an estimate', new.reference;
      fee_share_kobo := public.estimate_paystack_fee_kobo(new.paid_kobo);
    else
      fee_share_kobo := round(fee_total_kobo * new.paid_kobo / total_kobo, 2);
    end if;
    net_kobo := greatest(new.paid_kobo - fee_share_kobo, 0);

    perform set_config('wallet.ref', 'dues:' || new.id, true);
    update wallet_balance set
      balance = balance + net_kobo / 100.0,
      dues_total = dues_total + new.paid_kobo / 100.0,
      fees_total = fees_total + fee_share_kobo / 100.0,
      updated_at = now()
    where id = 1;
    perform set_config('wallet.ref', '', true);
  end if;
  return new;
end;
$$;

create or replace function public.credit_wallet_on_pool_payment_success()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  confirmed_kobo numeric;
  credit_kobo numeric;
  fee_kobo numeric;
  net_kobo numeric;
begin
  if new.status = 'success' and old.status = 'pending' then
    confirmed_kobo := nullif(new.raw_event->>'amount', '')::numeric;
    if confirmed_kobo is null or coalesce(new.raw_event->>'currency', 'NGN') <> 'NGN' then
      raise warning 'Pool payment % marked success without a valid confirmed amount; wallet not credited', new.reference;
      return new;
    end if;
    credit_kobo := least(confirmed_kobo, new.amount_kobo);
    if credit_kobo <> new.amount_kobo then
      raise warning 'Pool payment %: confirmed % kobo differs from requested % kobo; crediting %', new.reference, confirmed_kobo, new.amount_kobo, credit_kobo;
    end if;

    fee_kobo := nullif(new.raw_event->>'fees', '')::numeric;
    if fee_kobo is null then
      raise warning 'Pool payment %: Paystack fee not reported; using an estimate', new.reference;
      fee_kobo := public.estimate_paystack_fee_kobo(credit_kobo);
    end if;
    net_kobo := greatest(credit_kobo - fee_kobo, 0);

    perform set_config('wallet.ref', 'pool:' || new.id, true);
    update wallet_balance set
      balance = balance + net_kobo / 100.0,
      pool_total = pool_total + credit_kobo / 100.0,
      fees_total = fees_total + fee_kobo / 100.0,
      updated_at = now()
    where id = 1;
    perform set_config('wallet.ref', '', true);
  end if;
  return new;
end;
$$;

-- Withdrawals: tag both the hold (confirm) and any refund (finalize).
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
      perform set_config('wallet.ref', 'withdrawal:' || p_request_id, true);
      update wallet_balance set
        balance = balance + req.amount + fee,
        withdrawn_total = withdrawn_total - req.amount,
        fees_total = fees_total - fee,
        updated_at = now()
      where id = 1;
      perform set_config('wallet.note', '', true);
      perform set_config('wallet.ref', '', true);
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

create or replace function public._person_name(p_profile uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select m.name from members m where m.profile_id = p_profile limit 1),
                  (select p.full_name from profiles p where p.id = p_profile));
$$;
revoke execute on function public._person_name(uuid) from public, anon, authenticated;

-- Full details of one wallet activity entry. Same audience as the ledger itself.
create or replace function public.get_wallet_entry(p_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  e record;
  kind text;
  rid text;
  amt_kobo numeric;
  pp record;
  dp record;
  wr record;
  d jsonb := '{}'::jsonb;
begin
  if not (public.is_admin() and public.is_operations()) then
    return null;
  end if;
  select * into e from wallet_ledger where id = p_id;
  if not found then
    return null;
  end if;

  kind := nullif(split_part(coalesce(e.ref, ''), ':', 1), '');
  rid := nullif(substr(coalesce(e.ref, ''), length(coalesce(kind, '')) + 2), '');

  -- Entries from before refs existed: find the record by amount and nearest time.
  if e.ref is null then
    amt_kobo := round(replace(substring(e.note from 'NGN ([0-9,]+\.[0-9]{2})'), ',', '')::numeric * 100);
    if e.note like 'Pool funding:%' then
      kind := 'pool';
      select id::text into rid from pool_payments
        where status = 'success' and least(coalesce(nullif(raw_event->>'amount', '')::numeric, amount_kobo), amount_kobo) = amt_kobo
        order by abs(extract(epoch from coalesce(paid_at, created_at) - e.created_at)) limit 1;
    elsif e.note like 'Dues payment:%' then
      kind := 'dues';
      select id::text into rid from dues_payments
        where status in ('success', 'partial') and paid_kobo = amt_kobo
        order by abs(extract(epoch from coalesce(paid_at, created_at) - e.created_at)) limit 1;
    elsif e.note like 'Withdrawal%' then
      kind := 'withdrawal';
      select id::text into rid from withdrawal_requests
        where round(amount * 100) = amt_kobo and processing_at is not null
        order by abs(extract(epoch from processing_at - e.created_at)) limit 1;
    end if;
  end if;

  if kind = 'pool' and rid is not null then
    select * into pp from pool_payments where id = rid::uuid;
    if found then
      d := jsonb_build_object(
        'from', pp.contributor_name,
        'description', pp.note,
        'paid', least(coalesce(nullif(pp.raw_event->>'amount', '')::numeric, pp.amount_kobo), pp.amount_kobo) / 100.0,
        'fee', nullif(pp.raw_event->>'fees', '')::numeric / 100.0,
        'channel', pp.channel,
        'paid_at', pp.paid_at,
        'reference', pp.reference,
        'started_by', public._person_name(pp.initiated_by));
    end if;
  elsif kind = 'dues' and rid is not null then
    select * into dp from dues_payments where id = rid::uuid;
    if found then
      d := jsonb_build_object(
        'member', (select name from members where id = dp.member_id),
        'month', dp.month,
        'months', (select jsonb_agg(month order by month) from dues_payments where reference = dp.reference),
        'paid', dp.paid_kobo / 100.0,
        'owed', nullif(dp.owed_kobo, 0) / 100.0,
        'channel', dp.channel,
        'paid_at', dp.paid_at,
        'reference', dp.reference);
    end if;
  elsif kind = 'withdrawal' and rid is not null then
    select * into wr from withdrawal_requests where id = rid::uuid;
    if found then
      d := jsonb_build_object(
        'by', public._person_name(wr.requested_by),
        'reason', wr.reason,
        'to', wr.payout_label,
        'amount', wr.amount,
        'fee', coalesce(wr.transfer_fee_kobo, 0) / 100.0,
        'status', wr.status,
        'failure_reason', wr.failure_reason,
        'requested_at', wr.created_at,
        'completed_at', wr.completed_at,
        'transfer_code', wr.paystack_transfer_code);
    end if;
  end if;

  return jsonb_build_object(
    'id', e.id, 'created_at', e.created_at, 'delta', e.delta, 'note', e.note,
    'balance_before', e.balance_before, 'balance_after', e.balance_after,
    'kind', coalesce(kind, case when e.delta >= 0 then 'credit' else 'debit' end),
    'actor', public._person_name(e.actor),
    'details', d);
end;
$$;
revoke execute on function public.get_wallet_entry(bigint) from public, anon;
grant execute on function public.get_wallet_entry(bigint) to authenticated;
