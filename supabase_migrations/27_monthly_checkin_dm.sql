-- Phase 22: Monthly check-in DM (in-app stopgap until WhatsApp).
-- Sent on the 15th of every month, to every user, as an individual DM.
-- Run after 26_calendar_announcements.sql.

create or replace function public.run_monthly_checkin()
returns void language plpgsql security definer set search_path = public as $$
declare
  welfare_sender uuid;
  sender_display_name text := 'Welfare Team';
  recipient record;
  conv_id uuid;
  a uuid;
  b uuid;
  checkin_text text := 'Hey! Just checking in — how are you doing this month? If there''s anything on your mind, a question, a concern, or something you could use help with, feel free to share it here. Glad to have you on the team.';
begin
  -- Needs a real profile to satisfy the messages table's sender_id
  -- constraint; the display name below is what actually shows, not
  -- whichever person this happens to be.
  select p.id into welfare_sender
  from profiles p join members m on m.profile_id = p.id
  where m.unit = 'Welfare'
  limit 1;

  if welfare_sender is null then
    select id into welfare_sender from profiles where role = 'admin' limit 1;
  end if;

  if welfare_sender is null then
    raise warning 'run_monthly_checkin: no eligible sender profile found, skipping';
    return;
  end if;

  for recipient in select id from profiles where id != welfare_sender loop
    a := least(welfare_sender, recipient.id);
    b := greatest(welfare_sender, recipient.id);

    select id into conv_id from conversations where user_a = a and user_b = b;
    if conv_id is null then
      insert into conversations (user_a, user_b) values (a, b) returning id into conv_id;
    end if;

    insert into messages (conversation_id, sender_id, sender_name, body)
    values (conv_id, welfare_sender, sender_display_name, checkin_text);
  end loop;
end;
$$;

select cron.schedule('monthly-checkin', '0 8 15 * *', $$ select public.run_monthly_checkin(); $$);
