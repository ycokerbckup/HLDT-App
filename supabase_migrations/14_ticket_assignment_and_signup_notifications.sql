-- Phase 9: Ticket assignment notifications, new-signup alerts to Operations.
-- Run after 13_roster_assignment_emails.sql.

-- Notify the assignee when a ticket gets assigned to them.
create or replace function public.notify_ticket_assignment()
returns trigger as $$
declare
  assignee_profile uuid;
begin
  if new.assigned_to_id is not null and new.assigned_to_id is distinct from old.assigned_to_id then
    select profile_id into assignee_profile from members where id = new.assigned_to_id;
    if assignee_profile is not null then
      insert into public.notifications (type, title, body, link_tab, target_role, target_profile_id)
      values ('assignment', 'You''ve been assigned a ticket', coalesce(new.description, 'Check the Equipment tab'), 'equipment', 'all', assignee_profile);
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_ticket_assigned
  after update on tickets
  for each row execute procedure public.notify_ticket_assignment();

-- Notify Operations-unit admins when a new member signs up, linking to Members.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, role, email)
  values (new.id, new.raw_user_meta_data->>'full_name', 'member', new.email);

  begin
    insert into public.members (name, email, profile_id)
    values (coalesce(new.raw_user_meta_data->>'full_name', new.email), new.email, new.id);
  exception when unique_violation then
    null;
  end;

  perform public.notify_units(
    array['Operations'], 'signup',
    'New signup: ' || coalesce(new.raw_user_meta_data->>'full_name', new.email),
    'Review and assign their unit/tier/team', 'members'
  );

  return new;
end;
$$ language plpgsql security definer;
