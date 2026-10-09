-- Applied directly to production on 2026-10-09 (version 20261009181158); recorded here so the repo matches.
-- Plain-text OTPs live in withdrawal_otp_secrets (no client access); withdrawal_requests keeps only a bcrypt hash.
-- The full function bodies it installed (initiate_withdrawal, get_withdrawal_otp_for_sending,
-- confirm_withdrawal_v2) are superseded by migration 85; only the table is still needed.
create table if not exists public.withdrawal_otp_secrets (
  request_id uuid primary key references public.withdrawal_requests(id) on delete cascade,
  otp_plain text not null,
  created_at timestamptz not null default now()
);
alter table public.withdrawal_otp_secrets enable row level security;
revoke all on public.withdrawal_otp_secrets from anon, authenticated;
update public.withdrawal_requests set otp_code = null where otp_code is not null;
