-- Applied directly to production on 2026-10-09 (version 20261009181144); recorded here so the repo matches.
alter table public.dues_payments drop constraint dues_payments_status_check;
alter table public.dues_payments add constraint dues_payments_status_check
  check (status = any (array['pending'::text, 'success'::text, 'partial'::text, 'failed'::text, 'abandoned'::text, 'amount_mismatch'::text]));
