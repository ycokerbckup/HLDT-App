-- Phase 66: "Pool funder" — a second Paystack-backed payment channel
-- for funding the wallet directly, separate from dues (e.g. for
-- sponsor/donor contributions or catching up on historically
-- unrecorded funds). Welfare/Ops/Admin-initiated, arbitrary amount
-- (unlike dues, there's no per-member rate to validate against —
-- the admin deliberately chooses the amount here).
--
-- GL treatment: wallet_balance.balance remains the single spendable
-- total, exactly as before (fed by both channels, reduced only by
-- withdrawals). Two new columns, dues_total and pool_total, are
-- pure cumulative "money in" trackers per source — they never
-- decrease on withdrawal, since a withdrawal doesn't belong to one
-- source specifically. dues_total + pool_total will exceed balance
-- once any withdrawal has happened, by design: gross inflow by
-- source vs. net spendable total are two different, both useful,
-- numbers.
--
-- Run after 73_paystack_demo_account.sql.

-- ============================================================
-- pool_payments — mirrors dues_payments' shape and security model
-- (no client write path; only service role, via the edge functions).
-- ============================================================
create table pool_payments (
  id uuid primary key default gen_random_uuid(),
  contributor_name text not null,
  note text,
  amount_kobo integer not null check (amount_kobo > 0),
  reference text not null,
  status text not null default 'pending' check (status in ('pending', 'success', 'failed', 'abandoned')),
  channel text,
  paid_at timestamptz,
  raw_event jsonb,
  initiated_by uuid references profiles(id),
  created_at timestamptz default now()
);
alter table pool_payments enable row level security;
create policy "welfare ops admin read pool payments" on pool_payments for select using (public.is_admin() and (public.is_welfare_or_ops() or exists (select 1 from members where profile_id = auth.uid() and unit = 'Admin')));

-- ============================================================
-- wallet_balance gets per-source gross-inflow tracking.
-- ============================================================
alter table wallet_balance add column if not exists dues_total numeric not null default 0;
alter table wallet_balance add column if not exists pool_total numeric not null default 0;
-- Backfill: every credit so far came from dues (pool didn't exist
-- until now), so the current balance is entirely dues-sourced.
update wallet_balance set dues_total = balance where id = 1;

create or replace function public.credit_wallet_on_payment_success()
returns trigger as $$
begin
  if new.status in ('success', 'partial') and old.status = 'pending' then
    update wallet_balance set
      balance = balance + coalesce(new.paid_kobo, new.amount_kobo) / 100.0,
      dues_total = dues_total + coalesce(new.paid_kobo, new.amount_kobo) / 100.0,
      updated_at = now()
    where id = 1;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.credit_wallet_on_pool_payment_success()
returns trigger as $$
begin
  if new.status = 'success' and old.status = 'pending' then
    update wallet_balance set
      balance = balance + new.amount_kobo / 100.0,
      pool_total = pool_total + new.amount_kobo / 100.0,
      updated_at = now()
    where id = 1;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_pool_payment_credit_wallet on pool_payments;
create trigger on_pool_payment_credit_wallet
  after update on pool_payments
  for each row execute procedure public.credit_wallet_on_pool_payment_success();
