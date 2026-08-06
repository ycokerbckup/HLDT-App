-- Phase 24: Fix Welfare admins being silently unable to save dues.
--
-- Root cause: dues live on the members table, and the members UPDATE
-- policy only allows Operations admins (correct for general profile
-- edits — unit/tier/team — but wrong for dues specifically, which
-- Welfare is meant to manage too). A direct table update from Welfare
-- was being rejected by RLS with no visible error client-side, which is
-- exactly what "saved but nothing changed" looks like.
--
-- Fix: a dedicated function that only ever touches the dues column,
-- checked against Operations OR Welfare — it does not grant Welfare
-- any broader ability to edit member records.
-- Run after 30_member_unavailable.sql.

create or replace function public.update_member_dues(p_member_id uuid, p_dues jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() and (public.is_operations() or public.is_welfare())) then
    raise exception 'Only Operations or Welfare admins can update dues.';
  end if;
  update members set dues = p_dues where id = p_member_id;
end;
$$;

grant execute on function public.update_member_dues(uuid, jsonb) to authenticated;
