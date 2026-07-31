-- Phase 12: Fix signup 500 errors.
-- The previous handle_new_user() let a failure in the "notify Operations"
-- step take down the entire signup. A secondary notification must never
-- block the primary action (creating the account). Wrapping it so any
-- failure there is caught and ignored — signup always succeeds regardless.
-- Run after 16_chat_windows_and_cron_fix.sql.

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

  begin
    perform public.notify_units(
      array['Operations'], 'signup',
      'New signup: ' || coalesce(new.raw_user_meta_data->>'full_name', new.email),
      'Review and assign their unit/tier/team', 'members'
    );
  exception when others then
    raise warning 'notify_units failed during signup for %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$ language plpgsql security definer;
