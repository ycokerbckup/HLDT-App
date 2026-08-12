-- Phase 31: @-mentions in chat. Tagged people get a specific, personal
-- notification separate from the general "new message" one — a team
-- channel message is a single broadcast row, so without this, being
-- mentioned wouldn't actually stand out from any other message.
-- Run after 37_excuse_and_suspend.sql.

alter table messages add column tagged_profile_ids uuid[];

create or replace function public.notify_mentions()
returns trigger as $$
declare
  tagged_id uuid;
  thread_label text;
begin
  if new.tagged_profile_ids is null or array_length(new.tagged_profile_ids, 1) is null then
    return new;
  end if;

  thread_label := case when new.conversation_id is null then 'the team channel' else 'a DM' end;

  foreach tagged_id in array new.tagged_profile_ids loop
    if tagged_id is distinct from new.sender_id then
      insert into public.notifications (type, title, body, link_tab, target_role, target_profile_id, dm_with_profile_id)
      values ('mention', new.sender_name || ' tagged you', 'In ' || thread_label || ': "' || left(new.body, 80) || '"', 'chat', 'all', tagged_id,
        case when new.conversation_id is null then null else new.sender_id end);
    end if;
  end loop;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_message_mention
  after insert on messages
  for each row execute procedure public.notify_mentions();
