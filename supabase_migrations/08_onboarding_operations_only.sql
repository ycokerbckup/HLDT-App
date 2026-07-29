-- Phase 4c: Onboarding full access restricted to Operations-unit admins.
-- Everyone else gets a read-only view: trainee name, weeks, status — no
-- scores, no edit history. Run after 06_phase4_fixes_and_permissions.sql.

-- Public view: safe columns only, visible to everyone regardless of the
-- restrictive base-table RLS below (same pattern as members_directory).
create view onboarding_public as
  select id, member_id, name, start_date, weeks, status
  from onboarding;

grant select on onboarding_public to authenticated;

-- Tighten writes to Operations-unit admins only.
drop policy "admins write onboarding" on onboarding;
drop policy "admins update onboarding" on onboarding;
create policy "operations admins write onboarding" on onboarding for insert with check (
  public.is_admin() and public.is_operations()
);
create policy "operations admins update onboarding" on onboarding for update using (
  public.is_admin() and public.is_operations()
);

drop policy "admins insert history" on onboarding_history;
create policy "operations admins insert history" on onboarding_history for insert with check (
  public.is_admin() and public.is_operations()
);
