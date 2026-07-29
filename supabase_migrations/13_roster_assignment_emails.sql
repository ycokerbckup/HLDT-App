-- Phase 8: Roster + assignment emails.
-- Run after 12_celebrations.sql (and after the birthday email setup from
-- the previous conversation turn, though that only touched GitHub, not SQL).

-- Queue flag so the email-sending script only processes each notification once.
alter table notifications add column emailed boolean not null default false;

-- Per-assignee "you're assigned" notification for Tuesday roster items.
-- Fires when an item is inserted for an already-published roster (covers
-- both a fresh publish and any later edit, same tradeoff as the general
-- roster-updated notification: an edit re-notifies, it doesn't diff).
create or replace function public.notify_tuesday_item_assignment()
returns trigger as $$
declare
  roster_row record;
  assignee_profile uuid;
begin
  if new.assigned_member_id is null then
    return new;
  end if;
  select * into roster_row from tuesday_rosters where id = new.roster_id;
  if roster_row.published then
    select profile_id into assignee_profile from members where id = new.assigned_member_id;
    if assignee_profile is not null then
      insert into public.notifications (type, title, body, link_tab, target_role, target_profile_id)
      values ('assignment', 'You''re assigned: ' || new.title, 'Tuesday ' || to_char(roster_row.event_date, 'Mon DD'), 'roster', 'all', assignee_profile);
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_tuesday_item_assignment
  after insert on tuesday_roster_items
  for each row execute procedure public.notify_tuesday_item_assignment();

-- Same for Saturday training trainers.
create or replace function public.notify_saturday_trainer_assignment()
returns trigger as $$
declare
  roster_row record;
  assignee_profile uuid;
begin
  if new.member_id is null then
    return new;
  end if;
  select * into roster_row from saturday_rosters where id = new.roster_id;
  if roster_row.published then
    select profile_id into assignee_profile from members where id = new.member_id;
    if assignee_profile is not null then
      insert into public.notifications (type, title, body, link_tab, target_role, target_profile_id)
      values ('assignment', 'You''re training this Saturday', to_char(roster_row.event_date, 'Mon DD'), 'roster', 'all', assignee_profile);
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_saturday_trainer_assignment
  after insert on saturday_roster_trainers
  for each row execute procedure public.notify_saturday_trainer_assignment();
