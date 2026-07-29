-- Phase 4b: Welfare-unit members can create and edit-within-window announcements.
-- Run after 06_phase4_fixes_and_permissions.sql.

drop policy "admins insert announcements" on announcements;
create policy "admins or welfare insert announcements" on announcements for insert with check (
  public.is_admin() or public.is_welfare()
);

drop policy "admins update announcements within 30 minutes" on announcements;
create policy "admins or welfare update announcements within 30 minutes" on announcements for update using (
  (public.is_admin() or public.is_welfare()) and created_at > now() - interval '30 minutes'
);

-- Delete-anytime stays admin-only (moderation power, unchanged).
