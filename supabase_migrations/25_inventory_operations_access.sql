-- Phase 20: Give Operations unit the same inventory privileges as
-- Technical unit. Reuses the existing is_ops_or_tech() helper.
-- Run after 24_ticket_delete_permission.sql.

drop policy "technical unit read inventory" on equipment_inventory;
drop policy "technical unit insert inventory" on equipment_inventory;
drop policy "technical unit update inventory" on equipment_inventory;
drop policy "technical unit delete inventory" on equipment_inventory;

create policy "tech or ops read inventory" on equipment_inventory for select using (public.is_ops_or_tech());
create policy "tech or ops insert inventory" on equipment_inventory for insert with check (public.is_ops_or_tech());
create policy "tech or ops update inventory" on equipment_inventory for update using (public.is_ops_or_tech());
create policy "tech or ops delete inventory" on equipment_inventory for delete using (public.is_ops_or_tech());

-- The AI quota reset notification (built in phase 18) should reach
-- Operations unit too now that they share inventory/AI access.
create or replace function public.notify_technical_unit(p_type text, p_title text, p_body text, p_link_tab text)
returns void language plpgsql security definer set search_path = public as $$
declare
  prof record;
begin
  for prof in
    select p.id from profiles p
    join members m on m.profile_id = p.id
    where m.unit in ('Technical', 'Operations')
  loop
    insert into public.notifications (type, title, body, link_tab, target_role, target_profile_id)
    values (p_type, p_title, p_body, p_link_tab, 'all', prof.id);
  end loop;
end;
$$;
