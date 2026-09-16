-- Phase 62: A way for the UI to know whether a withdrawal PIN has
-- already been set, without ever exposing the actual hash to a
-- client. security_invoker means this view still respects the
-- underlying table's own RLS (Welfare/Operations only) rather than
-- running with elevated view-owner privileges.
-- Run after 68_fix_pgcrypto_schema.sql.

create view withdrawal_pin_status with (security_invoker = true) as
  select (pin_hash is not null) as has_pin from withdrawal_config where id = 1;

grant select on withdrawal_pin_status to authenticated;
