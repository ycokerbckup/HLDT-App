-- Applied directly to production on 2026-10-09 (version 20261009183745); recorded here so the repo matches.
-- The wallet balance holds actual cash: what was paid minus the Paystack fee on it.
-- dues_total / pool_total mean gross collected; fees_total records the fees.
-- Credit triggers (credit_wallet_on_payment_success / credit_wallet_on_pool_payment_success) were
-- replaced in production to credit net of raw_event.fees, falling back to estimate_paystack_fee_kobo.
alter table public.wallet_balance add column if not exists fees_total numeric not null default 0;

create or replace function public.estimate_paystack_fee_kobo(p_amount_kobo numeric)
returns numeric language sql immutable set search_path to 'public' as $$
  select case when p_amount_kobo is null or p_amount_kobo <= 0 then 0
    else least(round(p_amount_kobo * 0.015 + case when p_amount_kobo >= 250000 then 10000 else 0 end), 200000) end;
$$;
grant execute on function public.estimate_paystack_fee_kobo(numeric) to authenticated;
revoke execute on function public.estimate_paystack_fee_kobo(numeric) from anon;

create or replace function public.estimate_net_kobo(p_amount_kobo numeric)
returns numeric language sql immutable set search_path to 'public' as $$
  select greatest(p_amount_kobo - public.estimate_paystack_fee_kobo(p_amount_kobo), 0);
$$;
grant execute on function public.estimate_net_kobo(numeric) to authenticated;
revoke execute on function public.estimate_net_kobo(numeric) from anon;
