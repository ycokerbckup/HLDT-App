-- Phase 45: Add Admin unit to special event management. Treated the
-- same as Operations/Welfare — can create and manage events, but still
-- locked to their own unit's events, not a bypass of the cross-unit
-- rule already in place between Operations and Welfare.
-- Run after 51_events_permissions_and_reminders.sql.

create or replace function public.can_manage_events()
returns boolean language sql security definer stable as $$
  select public.is_admin() and (public.is_welfare_or_ops() or public.my_unit() = 'Admin');
$$;
