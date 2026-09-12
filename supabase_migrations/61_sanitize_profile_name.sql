-- Phase 54: Security hardening — strip newline characters from
-- full_name at the point it's saved, not just when it's later used in
-- an email subject line. A name is never legitimately multi-line, and
-- this closes the door on the same class of issue at its actual
-- source, not just one place it happens to be consumed.
-- Run after 60_fix_avatar_storage_vulnerability.sql.

create or replace function public.update_own_profile(p_full_name text, p_avatar_url text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update profiles
  set full_name = coalesce(regexp_replace(p_full_name, '[\r\n]+', ' ', 'g'), full_name),
      avatar_url = p_avatar_url
  where id = auth.uid();
end;
$$;
