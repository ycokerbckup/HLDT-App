-- Phase 22c: Monthly check-in, using exact profile IDs instead of name
-- matching — removes any risk of a mismatch. Same cron schedule as
-- before (15th of the month), this just replaces the function body.
-- Run after 28_checkin_split_by_team.sql.

create or replace function public.run_monthly_checkin()
returns void language plpgsql security definer set search_path = public as $$
declare
  sender_a uuid := 'f1ce9f82-3b42-4d63-a879-a2ea2946d720'; -- Orieh Chisom, checks in on Team A
  sender_b uuid := 'be54468b-6dd8-4b79-b67e-66a8f1060dd1'; -- Shazz, checks in on Team B
  recipient record;
  chosen_sender uuid;
  chosen_name text;
  conv_id uuid;
  x uuid;
  y uuid;
  checkin_text text := 'Hey! Just checking in — how are you doing this month? If there''s anything on your mind, a question, a concern, or something you could use help with, feel free to share it here. Glad to have you on the team.';
begin
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
