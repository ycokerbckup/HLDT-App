-- Phase 15: Auto-delete tickets stuck in "Assigned" status for 24 hours.
-- Run after 19_fix_ticket_member_fk.sql.

alter table tickets add column assigned_at timestamptz;

-- Stamps assigned_at the moment status becomes "Assigned"; clears it if
-- the ticket moves on to any other status before the 24h window is up,
-- so the clock only ever measures continuous time spent in "Assigned".
create or replace function public.track_ticket_assigned_at()
returns trigger as $$
begin
  if new.status = 'Assigned' and old.status is distinct from 'Assigned' then
    new.assigned_at := now();
  elsif new.status is distinct from 'Assigned' then
    new.assigned_at := null;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_ticket_status_change
  before update on tickets
  for each row execute procedure public.track_ticket_assigned_at();

select cron.schedule(
  'cleanup-stale-assigned-tickets',
  '0 * * * *',
  $$ delete from tickets where status = 'Assigned' and assigned_at is not null and assigned_at < now() - interval '24 hours'; $$
);
