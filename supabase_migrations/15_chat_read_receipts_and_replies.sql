-- Phase 10: Chat read receipts + reply-to-message.
-- Run after 14_ticket_assignment_and_signup_notifications.sql.

-- Read receipts: who has actually opened/read a message. Kept separate
-- from messages.seen_at (which only tracks "first seen by anyone" and
-- drives the 24h auto-delete timer) — this table tracks every reader,
-- for showing "Seen" / "Seen by N" in the UI.
create table message_reads (
  message_id uuid references messages(id) on delete cascade,
  profile_id uuid references profiles(id) on delete cascade,
  read_at timestamptz default now(),
  primary key (message_id, profile_id)
);

alter table message_reads enable row level security;

create policy "read receipts visible to message participants" on message_reads for select using (
  exists (
    select 1 from messages m
    where m.id = message_reads.message_id
    and (
      m.conversation_id is null
      or exists (select 1 from conversations c where c.id = m.conversation_id and (c.user_a = auth.uid() or c.user_b = auth.uid()))
    )
  )
);
create policy "insert own read receipt" on message_reads for insert with check (profile_id = auth.uid());

create or replace function public.mark_message_read(msg_id uuid)
returns void language plpgsql security definer as $$
begin
  insert into message_reads (message_id, profile_id) values (msg_id, auth.uid())
  on conflict do nothing;
end;
$$;

grant execute on function public.mark_message_read(uuid) to authenticated;

-- Reply-to-message. Set null automatically if the original message gets
-- deleted (e.g. the 24h-after-seen auto-cleanup) — the reply just loses
-- its quote instead of breaking.
alter table messages add column reply_to_id uuid references messages(id) on delete set null;

alter publication supabase_realtime add table message_reads;
