-- Phase 87: dues are no longer marked by hand. From October 2026 a month counts as
-- paid only when there is a successful Paystack payment for it, so the reminder
-- ignores any hand-entered status and checks the payment records alone.
-- It runs on the 25th and 29th and is about the month it runs in.

create or replace function public.run_dues_reminder()
returns void language plpgsql security definer set search_path = public as $$
declare
  this_month text := to_char(now() at time zone 'Africa/Lagos', 'YYYY-MM');
  month_label text := trim(to_char(now() at time zone 'Africa/Lagos', 'FMMonth YYYY'));
  rec record;
  v_owed int;
  rate int;
begin
  if this_month < '2026-10' then
    return; -- dues are tracked from October 2026
  end if;

  for rec in
    select m.id, m.profile_id, m.tier
    from members m
    where m.profile_id is not null
      and coalesce(m.unavailable, false) = false
      and m.tier is distinct from 'Trainee'
  loop
    -- Paid in full for this month?
    if exists (select 1 from dues_payments where member_id = rec.id and month = this_month and status = 'success') then
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
        else 'You haven''t paid your NGN ' || to_char(rate, 'FM999G999G990') || ' dues for ' || month_label || ' yet. You can pay in the Dues tab.'
      end,
      'dues', 'all', rec.profile_id);
  end loop;
end;
$$;
revoke execute on function public.run_dues_reminder() from public, anon, authenticated;
