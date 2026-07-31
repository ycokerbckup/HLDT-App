-- Phase 14: Fix member deletion blocked by ticket foreign keys.
--
-- tickets.assigned_to_id and tickets.reporter_id were added without
-- specifying ON DELETE behavior, which defaults to blocking the delete
-- entirely (NO ACTION). Deleting a member who's ever been assigned a
-- ticket or submitted an equipment check would fail. Fixed to SET NULL
-- instead — the ticket record stays intact, it just loses that
-- particular link once the member is gone.
-- Run after 18_fix_search_path_everywhere.sql.

alter table tickets drop constraint tickets_assigned_to_id_fkey;
alter table tickets add constraint tickets_assigned_to_id_fkey
  foreign key (assigned_to_id) references members(id) on delete set null;

alter table tickets drop constraint tickets_reporter_id_fkey;
alter table tickets add constraint tickets_reporter_id_fkey
  foreign key (reporter_id) references members(id) on delete set null;
