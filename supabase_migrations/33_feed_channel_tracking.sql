-- Phase 26: Track channel on feed_posts for channel filtering.
-- Run after 32_message_delete_window.sql.

alter table feed_posts add column channel_id text;
alter table feed_posts add column channel_name text;
