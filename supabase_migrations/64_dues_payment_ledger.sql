-- Phase 57: Real payment integration for dues, via Paystack. An
-- immutable transaction ledger sits alongside the existing manual
-- dues jsonb field rather than replacing it — cash/direct-transfer
-- payments still get recorded manually by Welfare/Operations, but
-- anything paid through the app is now a verifiable, tamper-proof
-- record instead of a manually-clicked cell.
--
-- Deliberately has NO insert/update/delete policy for regular
-- authenticated users at all — the only ways a row can ever be
-- created or change status are: the initialize-dues-payment Edge
-- Function (creates the pending row, using the server-computed
-- amount, never a client-supplied one) and the paystack-webhook
-- Edge Function (confirms success/failure, only after verifying
-- Paystack's signature). A member can look, never touch.
-- Run after 63_fix_birthday_visibility.sql.

create table dues_payments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references members(id) on delete cascade,
  month text not null,
  amount_kobo integer not null,
  reference text not null unique,
  status text not null default 'pending' check (status in ('pending', 'success', 'failed', 'abandoned')),
  channel text,
  paid_at timestamptz,
  raw_event jsonb,
  created_at timestamptz default now()
);

alter table dues_payments enable row level security;

create policy "members view own dues payments" on dues_payments for select using (
  exists (select 1 from members m where m.id = member_id and m.profile_id = auth.uid())
  or public.is_welfare_or_ops()
);

-- Notify the member the moment their payment is confirmed successful.
create or replace function public.notify_dues_payment_success()
returns trigger as $$
declare
  target_profile uuid;
begin
  if new.status = 'success' and (old.status is distinct from 'success') then
    select profile_id into target_profile from members where id = new.member_id;
    if target_profile is not null then
      insert into public.notifications (type, title, body, link_tab, target_role, target_profile_id)
      values ('dues_payment_confirmed', 'Payment received',
        'Your dues payment of ₦' || to_char(new.amount_kobo / 100.0, 'FM999,999,990') || ' for ' || new.month || ' was confirmed.',
        'dues', 'all', target_profile);
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_dues_payment_success
  after update on dues_payments
  for each row execute procedure public.notify_dues_payment_success();
