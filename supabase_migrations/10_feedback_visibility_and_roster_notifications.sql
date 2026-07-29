-- Phase 5b: feedback visibility restricted to Operations/Welfare; roster
-- publish/update/delete now notify everyone. Run after 09_rosters.sql.

-- ============================================================
-- 1. Feedback: only Operations/Welfare unit admins can read it
--    (previously any admin could).
-- ============================================================
drop policy "admins read feedback" on feedback;
create policy "operations or welfare read feedback" on feedback for select using (
  public.is_admin() and (public.is_operations() or public.is_welfare())
);

-- ============================================================
-- 2. Roster change notifications — fire when a roster becomes visible
--    to everyone (published), gets updated while published, or is
--    deleted. Draft-only edits stay silent.
-- ============================================================
create or replace function public.notify_tuesday_roster_change()
returns trigger as $$
begin
  if (tg_op = 'INSERT' and new.published) then
    insert into public.notifications (type, title, body, link_tab, target_role)
    values ('roster', 'New Tuesday prayer meeting roster', 'For ' || to_char(new.event_date, 'Mon DD'), 'roster', 'all');
  elsif (tg_op = 'UPDATE' and not old.published and new.published) then
    insert into public.notifications (type, title, body, link_tab, target_role)
    values ('roster', 'New Tuesday prayer meeting roster', 'For ' || to_char(new.event_date, 'Mon DD'), 'roster', 'all');
  elsif (tg_op = 'UPDATE' and old.published and new.published) then
    insert into public.notifications (type, title, body, link_tab, target_role)
    values ('roster', 'Tuesday roster updated', 'For ' || to_char(new.event_date, 'Mon DD'), 'roster', 'all');
  elsif (tg_op = 'DELETE' and old.published) then
    insert into public.notifications (type, title, body, link_tab, target_role)
    values ('roster', 'Tuesday roster removed', 'The roster for ' || to_char(old.event_date, 'Mon DD') || ' was taken down', 'roster', 'all');
  end if;
  return coalesce(new, old);
end;
$$ language plpgsql security definer;

create trigger on_tuesday_roster_change
  after insert or update or delete on tuesday_rosters
  for each row execute procedure public.notify_tuesday_roster_change();

create or replace function public.notify_saturday_roster_change()
returns trigger as $$
begin
  if (tg_op = 'INSERT' and new.published) then
    insert into public.notifications (type, title, body, link_tab, target_role)
    values ('roster', 'New Saturday training roster', 'For ' || to_char(new.event_date, 'Mon DD'), 'roster', 'all');
  elsif (tg_op = 'UPDATE' and not old.published and new.published) then
    insert into public.notifications (type, title, body, link_tab, target_role)
    values ('roster', 'New Saturday training roster', 'For ' || to_char(new.event_date, 'Mon DD'), 'roster', 'all');
  elsif (tg_op = 'UPDATE' and old.published and new.published) then
    insert into public.notifications (type, title, body, link_tab, target_role)
    values ('roster', 'Saturday roster updated', 'For ' || to_char(new.event_date, 'Mon DD'), 'roster', 'all');
  elsif (tg_op = 'DELETE' and old.published) then
    insert into public.notifications (type, title, body, link_tab, target_role)
    values ('roster', 'Saturday roster removed', 'The roster for ' || to_char(old.event_date, 'Mon DD') || ' was taken down', 'roster', 'all');
  end if;
  return coalesce(new, old);
end;
$$ language plpgsql security definer;

create trigger on_saturday_roster_change
  after insert or update or delete on saturday_rosters
  for each row execute procedure public.notify_saturday_roster_change();
