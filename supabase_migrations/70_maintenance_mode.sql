-- Phase 63: App-wide maintenance mode. A single boolean, checked
-- before login even loads — when on, every visitor sees the
-- maintenance screen and nothing else, no exceptions. To lift it
-- later, just flip the flag back:
--   update app_status set maintenance_mode = false where id = 1;
-- To re-enable it:
--   update app_status set maintenance_mode = true where id = 1;
-- Run after 69_withdrawal_pin_status.sql.

create table app_status (
  id int primary key default 1,
  maintenance_mode boolean not null default false,
  check (id = 1)
);
insert into app_status (id) values (1);

alter table app_status enable row level security;
-- Must be readable even by a visitor who hasn't logged in yet — this
-- is deliberately not sensitive data (a single flag), so unrestricted
-- read access is fine.
create policy "anyone reads app status" on app_status for select using (true);
create policy "admins update app status" on app_status for update using (public.is_admin());
