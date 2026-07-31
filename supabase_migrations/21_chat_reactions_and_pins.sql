-- Phase 16: Chat reactions + pinned messages.
-- Run after 20_auto_delete_stale_assigned_tickets.sql.

-- ============================================================
-- Reactions: any thread participant can react; multiple different
-- emoji per person per message allowed, same emoji twice is a toggle.
-- ============================================================
create table message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references messages(id) on delete cascade,
  profile_id uuid references profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz default now(),
  unique (message_id, profile_id, emoji)
);

alter table message_reactions enable row level security;

create policy "reactions visible to message participants" on message_reactions for select using (
  exists (
    select 1 from messages m
    where m.id = message_reactions.message_id
    and (
      m.conversation_id is null
      or exists (select 1 from conversations c where c.id = m.conversation_id and (c.user_a = auth.uid() or c.user_b = auth.uid()))
    )
  )
);
create policy "add own reaction" on message_reactions for insert with check (profile_id = auth.uid());
create policy "remove own reaction" on message_reactions for delete using (profile_id = auth.uid());

alter publication supabase_realtime add table message_reactions;

-- ============================================================
-- Pinned messages: up to 3 per thread (team channel or a DM), each with
-- an expiry the pinner chooses (24h / 7d / 30d). Any thread participant
-- can pin or unpin.
-- ============================================================
create table message_pins (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references messages(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete cascade, -- null = team channel
  pinned_by uuid references profiles(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

alter table message_pins enable row level security;

create or replace function public.enforce_max_pins()
returns trigger as $$
declare
  current_count int;
begin
  select count(*) into current_count
  from message_pins
  where conversation_id is not distinct from new.conversation_id;
  if current_count >= 3 then
    raise exception 'Only 3 messages can be pinned at a time in this thread. Unpin one first.';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_pin_insert
  before insert on message_pins
  for each row execute procedure public.enforce_max_pins();

create policy "pins visible to thread participants" on message_pins for select using (
  conversation_id is null
  or exists (select 1 from conversations c where c.id = message_pins.conversation_id and (c.user_a = auth.uid() or c.user_b = auth.uid()))
);
create policy "thread participants can pin" on message_pins for insert with check (
  pinned_by = auth.uid()
  and (
    conversation_id is null
    or exists (select 1 from conversations c where c.id = message_pins.conversation_id and (c.user_a = auth.uid() or c.user_b = auth.uid()))
  )
);
create policy "thread participants can unpin" on message_pins for delete using (
  conversation_id is null
  or exists (select 1 from conversations c where c.id = message_pins.conversation_id and (c.user_a = auth.uid() or c.user_b = auth.uid()))
);

alter publication supabase_realtime add table message_pins;

select cron.schedule(
  'cleanup-expired-pins',
  '0 * * * *',
  $$ delete from message_pins where expires_at < now(); $$
);
