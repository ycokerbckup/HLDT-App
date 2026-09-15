-- Phase 58: Support paying for multiple months (current, future, or
-- owed past months) in a single transaction. One Paystack reference
-- can now cover several months — one ledger row per month, all
-- sharing the same reference, so each row still represents exactly
-- one month for reporting/export purposes, but they're confirmed or
-- rejected together as a single transaction.
--
-- Also adds an explicit 'amount_mismatch' status: if Paystack ever
-- reports a different completed amount than what was actually
-- expected for the selected months, nothing gets credited on a
-- guess — it's flagged for a human to look at, not silently marked
-- paid and not silently lost either.
-- Run after 64_dues_payment_ledger.sql.

alter table dues_payments drop constraint dues_payments_reference_key;
alter table dues_payments add constraint dues_payments_reference_month_key unique (reference, month);

alter table dues_payments drop constraint dues_payments_status_check;
alter table dues_payments add constraint dues_payments_status_check
  check (status in ('pending', 'success', 'failed', 'abandoned', 'amount_mismatch'));

-- Replaces the old per-row trigger (which would have fired once per
-- month in a multi-month payment, spamming several notifications for
-- one transaction) — notifications for success/mismatch are now sent
-- once per transaction directly by the edge functions instead.
drop trigger if exists on_dues_payment_success on dues_payments;
drop function if exists public.notify_dues_payment_success();
