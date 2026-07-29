-- Phase 6: Ticket improvements (real member references, notifications, photos)
-- Run after 10_feedback_visibility_and_roster_notifications.sql.

alter table tickets add column reporter_id uuid references members(id);
alter table tickets add column assigned_to_id uuid references members(id);
alter table tickets add column photo_url text;

-- Notify everyone when a ticket with an actual issue is created.
create or replace function public.notify_new_ticket()
returns trigger as $$
begin
  if new.status = 'Open' then
    insert into public.notifications (type, title, body, link_tab, target_role)
    values ('ticket', 'New equipment issue reported', coalesce(new.description, 'Check the Equipment tab'), 'equipment', 'all');
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_ticket_created
  after insert on tickets
  for each row execute procedure public.notify_new_ticket();

-- Storage bucket for ticket photos: public read (so thumbnails just work),
-- upload restricted to logged-in users.
insert into storage.buckets (id, name, public)
values ('ticket-photos', 'ticket-photos', true)
on conflict (id) do nothing;

create policy "public read ticket photos" on storage.objects for select using (bucket_id = 'ticket-photos');
create policy "authenticated upload ticket photos" on storage.objects for insert with check (
  bucket_id = 'ticket-photos' and auth.role() = 'authenticated'
);
