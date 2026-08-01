-- Phase 17: Equipment inventory, scoped to Technical-unit members.
-- Run after 21_chat_reactions_and_pins.sql.

create or replace function public.is_technical()
returns boolean language sql security definer stable set search_path = public as $$
  select public.my_unit() = 'Technical';
$$;

create table equipment_inventory (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  quantity int not null default 1,
  condition text default 'Good',
  purchase_date date,
  purchase_price numeric,
  estimated_value numeric,
  notes text,
  added_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table equipment_inventory enable row level security;

create policy "technical unit read inventory" on equipment_inventory for select using (public.is_technical());
create policy "technical unit insert inventory" on equipment_inventory for insert with check (public.is_technical());
create policy "technical unit update inventory" on equipment_inventory for update using (public.is_technical());
create policy "technical unit delete inventory" on equipment_inventory for delete using (public.is_technical());

alter publication supabase_realtime add table equipment_inventory;
