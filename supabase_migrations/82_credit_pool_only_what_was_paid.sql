-- (Applied to production on 2026-10-07.)
-- Pool contributions: credit the wallet with the LESSER of the amount recorded at checkout and the
-- amount Paystack actually confirmed (raw_event.amount), never more. Missing/invalid confirmation
-- data credits nothing instead of trusting the stored amount.
create or replace function public.credit_wallet_on_pool_payment_success()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  confirmed_kobo numeric;
  credit_kobo numeric;
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
    update wallet_balance set
      balance = balance + credit_kobo / 100.0,
      pool_total = pool_total + credit_kobo / 100.0,
      updated_at = now()
    where id = 1;
  end if;
  return new;
end;
$$;
revoke execute on function public.credit_wallet_on_pool_payment_success() from public, anon, authenticated;
grant execute on function public.credit_wallet_on_pool_payment_success() to service_role;
