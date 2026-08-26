-- Phase 43: Adjustable thumbnail framing — stores a focus point (as a
-- percentage) so an uploaded image can be repositioned within its
-- display frame instead of a blind auto-crop.
-- Run after 49_flexible_event_dates_and_media.sql.

alter table special_events add column thumbnail_focus_x numeric not null default 50;
alter table special_events add column thumbnail_focus_y numeric not null default 50;
