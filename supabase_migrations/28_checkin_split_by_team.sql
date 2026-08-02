-- Phase 22b: Monthly check-in DM, split by team.
-- Team A gets checked in on by Orieh Chisom, Team B by Shazz — shown by
-- their real names, not a generic "Welfare Team" label, since these are
-- two specific named individuals now. Replaces the sender logic from
-- 27_monthly_checkin_dm.sql (same cron job, just a new function body).
-- Run after 27_monthly_checkin_dm.sql.

-- ============================================================
-- VERIFY FIRST — run this before anything else and check the output:
-- it should show exactly one row for each name, with the correct person.
--   select m.name, m.team, p.email
--   from members m join profiles p on p.id = m.profile_id
--   where m.name ilike '%orieh%chisom%' or m.name ilike '%shazz%';
-- If it shows zero rows, two rows for the same person, or the wrong
-- person, fix the ilike patterns below before running the rest of this
-- file — a silent mismatch here means check-ins go to/from the wrong
-- account with no error.
-- ============================================================

create or replace function public.run_monthly_checkin()
returns void language plpgsql security definer set search_path = public as $$
declare
  sender_a uuid; -- Orieh Chisom, checks in on Team A
  sender_b uuid; -- Shazz, checks in on Team B
  recipient record;
  chosen_sender uuid;
  chosen_name text;
  conv_id uuid;
  x uuid;
  y uuid;
  checkin_text text := 'Hey! Just checking in — how are you doing this month? If there''s anything on your mind, a question, a concern, or something you could use help with, feel free to share it here. Glad to have you on the team.';
begin
  select p.id into sender_a
  from profiles p join members m on m.profile_id = p.id
  where m.name ilike '%orieh%chisom%'
  limit 1;

  select p.id into sender_b
  from profiles p join members m on m.profile_id = p.id
  where m.name ilike '%shazz%'
  limit 1;

  if sender_a is null and sender_b is null then
    raise warning 'run_monthly_checkin: neither Orieh Chisom nor Shazz found by name match, skipping';
    return;
  end if;

  -- If one is missing, the other covers everyone rather than failing silently.
  sender_a := coalesce(sender_a, sender_b);
  sender_b := coalesce(sender_b, sender_a);

  for recipient in
    select p.id as profile_id, m.team
    from profiles p join members m on m.profile_id = p.id
  loop
    if recipient.profile_id = sender_a then
      chosen_sender := sender_b; -- Shazz checks on Orieh Chisom
    elsif recipient.profile_id = sender_b then
      chosen_sender := sender_a; -- Orieh Chisom checks on Shazz
    elsif recipient.team = 'A' then
      chosen_sender := sender_a;
    elsif recipient.team = 'B' then
      chosen_sender := sender_b;
    else
      chosen_sender := sender_a; -- no team assigned yet — defaults to Orieh Chisom
    end if;

    select m2.name into chosen_name from members m2 where m2.profile_id = chosen_sender;

    x := least(chosen_sender, recipient.profile_id);
    y := greatest(chosen_sender, recipient.profile_id);

    select id into conv_id from conversations where user_a = x and user_b = y;
    if conv_id is null then
      insert into conversations (user_a, user_b) values (x, y) returning id into conv_id;
    end if;

    insert into messages (conversation_id, sender_id, sender_name, body)
    values (conv_id, chosen_sender, coalesce(chosen_name, 'Welfare'), checkin_text);
  end loop;
end;
$$;
