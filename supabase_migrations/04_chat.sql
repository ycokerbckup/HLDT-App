-- Phase 2: Chat (team channel + 1:1 direct messages)
-- Run after all previous migration files.

-- DM conversations: one row per unique pair of users, canonically ordered
-- (user_a always the smaller UUID) so the same pair can't create two rows.
create table conversations (
  id uuid primary key default gen_random_uuid(),
  user_a uuid references profiles(id) on delete cascade not null,
  user_b uuid references profiles(id) on delete cascade not null,
  created_at timestamptz default now(),
  constraint ordered_pair check (user_a < user_b),
  unique (user_a, user_b)
);

alter table conversations enable row level security;

create policy "participants read own conversations" on conversations for select using (
  auth.uid() = user_a or auth.uid() = user_b
);
create policy "authenticated create conversations" on conversations for insert with check (
  auth.uid() = user_a or auth.uid() = user_b
);

-- Messages: conversation_id null = team channel message; set = DM message.
create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  sender_id uuid references profiles(id) on delete cascade not null,
  sender_name text,
  body text not null,
  created_at timestamptz default now(),
  edited_at timestamptz,
  seen_at timestamptz
);

alter table messages enable row level security;

-- Team channel (conversation_id is null): any logged-in user reads and posts
create policy "read team channel" on messages for select using (
  conversation_id is null and auth.role() = 'authenticated'
);
create policy "send team channel" on messages for insert with check (
  conversation_id is null and sender_id = auth.uid()
);

-- DMs: only the two participants of that conversation can read or post
create policy "read own dm messages" on messages for select using (
  conversation_id is not null and exists (
    select 1 from conversations c where c.id = messages.conversation_id and (c.user_a = auth.uid() or c.user_b = auth.uid())
  )
);
create policy "send own dm messages" on messages for insert with check (
  conversation_id is not null and sender_id = auth.uid() and exists (
    select 1 from conversations c where c.id = messages.conversation_id and (c.user_a = auth.uid() or c.user_b = auth.uid())
  )
);

-- Edit: sender only, within 30 minutes of sending. Applies to both channel types.
create policy "sender edit own message within 30 minutes" on messages for update using (
  sender_id = auth.uid() and created_at > now() - interval '30 minutes'
);

-- Admin moderation: delete any message, any time.
create policy "admins delete any message" on messages for delete using (public.is_admin());

-- Marking a message "seen" is handled through this function instead of a
-- generic UPDATE policy, so a viewer can only ever touch seen_at — never
-- sneak past the 30-minute edit window or change someone else's message body.
create or replace function public.mark_message_seen(msg_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  update messages
  set seen_at = now()
  where id = msg_id
    and seen_at is null
    and sender_id != auth.uid()
    and (
      conversation_id is null
      or exists (
        select 1 from conversations c
        where c.id = messages.conversation_id and (c.user_a = auth.uid() or c.user_b = auth.uid())
      )
    );
end;
$$;

grant execute on function public.mark_message_seen(uuid) to authenticated;

-- Scheduled cleanup: messages get removed 24 hours after being seen.
select cron.schedule(
  'cleanup-old-messages',
  '0 * * * *',
  $$ delete from messages where seen_at is not null and seen_at < now() - interval '24 hours'; $$
);
