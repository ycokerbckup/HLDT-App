-- Phase 48: Let users edit their own profile — name, avatar photo,
-- phone, and self-reported skills. Deliberately excludes anything
-- administrative (unit, tier, team, dues, availability, suspension,
-- role, email) — those stay admin-only, unchanged from before.
--
-- Uses dedicated RPCs rather than a general self-UPDATE policy on
-- profiles/members, so the set of editable columns is structurally
-- fixed by the function itself — no risk of a client somehow slipping
-- role/unit/etc. into a broader update.
-- Run after 54_fix_assignment_trigger_and_auto_delete.sql.

alter table profiles add column if not exists avatar_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy "anyone views avatars" on storage.objects for select using (bucket_id = 'avatars');
create policy "users upload own avatar" on storage.objects for insert with check (bucket_id = 'avatars' and auth.uid() is not null);
create policy "users delete own avatar" on storage.objects for delete using (bucket_id = 'avatars' and auth.uid() is not null);

create or replace function public.update_own_profile(p_full_name text, p_avatar_url text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update profiles set full_name = coalesce(p_full_name, full_name), avatar_url = p_avatar_url where id = auth.uid();
end;
$$;
grant execute on function public.update_own_profile(text, text) to authenticated;

create or replace function public.update_own_member_info(p_phone text, p_skills jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  update members set phone = coalesce(p_phone, phone), skills = coalesce(p_skills, skills) where profile_id = auth.uid();
end;
$$;
grant execute on function public.update_own_member_info(text, jsonb) to authenticated;
