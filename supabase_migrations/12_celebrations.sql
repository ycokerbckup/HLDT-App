-- Phase 7: Birthdays, service milestones, and graduation celebrations.
-- Run after 11_ticket_improvements.sql.

-- Notifications need to know: which DM to open on click, and (for
-- graduation only) which onboarding record they belong to, so they can be
-- deleted automatically if that graduation gets reversed.
alter table notifications add column dm_with_profile_id uuid references profiles(id) on delete cascade;
alter table notifications add column related_onboarding_id uuid references onboarding(id) on delete cascade;

alter table onboarding add column graduated_at timestamptz;

drop view if exists onboarding_public;
create view onboarding_public as
  select id, member_id, name, start_date, weeks, status, graduated_at
  from onboarding;
grant select on onboarding_public to authenticated;

-- ============================================================
-- Helper: notify every profile except one (each gets their own private
-- row, so read-state and the recipient-only RLS both work correctly).
-- ============================================================
create or replace function public.notify_all_except(
  p_exclude_profile_id uuid, p_type text, p_title text, p_body text, p_link_tab text,
  p_dm_with uuid default null, p_related_onboarding uuid default null
)
returns void language plpgsql security definer as $$
declare
  prof record;
begin
  for prof in select id from profiles where id is distinct from p_exclude_profile_id loop
    insert into public.notifications (type, title, body, link_tab, target_role, target_profile_id, dm_with_profile_id, related_onboarding_id)
    values (p_type, p_title, p_body, p_link_tab, 'all', prof.id, p_dm_with, p_related_onboarding);
  end loop;
end;
$$;

-- Helper: notify every profile whose linked member is in one of the given
-- functional units (used for Welfare/Operations/Admin-only birthday reminders).
create or replace function public.notify_units(
  p_units text[], p_type text, p_title text, p_body text, p_link_tab text
)
returns void language plpgsql security definer as $$
declare
  prof record;
begin
  for prof in
    select p.id from profiles p
    join members m on m.profile_id = p.id
    where m.unit = any(p_units) and p.role = 'admin'
  loop
    insert into public.notifications (type, title, body, link_tab, target_role, target_profile_id)
    values (p_type, p_title, p_body, p_link_tab, 'all', prof.id);
  end loop;
end;
$$;

-- ============================================================
-- Graduation: welcome-to-the-team notification for everyone (except the
-- new graduate), linking to a DM with them. Reversing the status deletes
-- every notification tied to that graduation event.
-- ============================================================
create or replace function public.notify_graduation()
returns trigger as $$
declare
  grad_profile uuid;
begin
  if (new.status = 'Graduated' and old.status is distinct from 'Graduated') then
    update onboarding set graduated_at = now() where id = new.id;
    select profile_id into grad_profile from members where id = new.member_id;
    if grad_profile is not null then
      perform public.notify_all_except(
        grad_profile, 'graduation',
        'Welcome ' || new.name || ' to the team!',
        'They just graduated from onboarding — say hi',
        'chat', grad_profile, new.id
      );
    else
      insert into public.notifications (type, title, body, link_tab, target_role, related_onboarding_id)
      values ('graduation', 'Welcome ' || new.name || ' to the team!', 'They just graduated from onboarding', 'onboarding', 'all', new.id);
    end if;
  elsif (old.status = 'Graduated' and new.status is distinct from 'Graduated') then
    delete from notifications where related_onboarding_id = new.id;
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_onboarding_graduation
  after update on onboarding
  for each row execute procedure public.notify_graduation();

-- ============================================================
-- Daily job: birthday reminders (7 days before, 1 day before, on the day)
-- and service-time milestones (every 6 months from join date, fired on
-- the 1st of the milestone month).
-- ============================================================
create or replace function public.run_daily_celebrations()
returns void language plpgsql security definer as $$
declare
  m record;
  today date := current_date;
  dob_day int;
  dob_month int;
  months_since int;
  years_part int;
  months_rem int;
  duration_text text;
  fun_templates text[] := array[
    '%s just hit %s on the team — still pressing the right buttons, mostly on purpose.',
    'Believe it or not, %s has survived %s of Sunday mornings with this team. Legend status: unlocked.',
    '%s: %s in, and still no major on-air disasters. We''re proud, and a little surprised.',
    'Cue the applause — %s clocks %s on the Display Team today!',
    '%s has officially kept our slides in order for %s. Someone give them a raise, or at least snacks.'
  ];
  chosen text;
begin
  -- Birthdays
  for m in select id, name, profile_id, dob from members where dob ~ '^[0-9]{1,2}/[0-9]{1,2}$' loop
    dob_day := split_part(m.dob, '/', 1)::int;
    dob_month := split_part(m.dob, '/', 2)::int;

    if extract(day from today + 7) = dob_day and extract(month from today + 7) = dob_month then
      perform public.notify_units(array['Welfare','Operations','Admin'], 'birthday_reminder',
        m.name || E'\'s birthday is in 7 days', null, 'dashboard');
    end if;

    if extract(day from today + 1) = dob_day and extract(month from today + 1) = dob_month then
      perform public.notify_units(array['Welfare','Operations','Admin'], 'birthday_reminder',
        m.name || E'\'s birthday is tomorrow', null, 'dashboard');
    end if;

    if extract(day from today) = dob_day and extract(month from today) = dob_month then
      perform public.notify_units(array['Welfare','Operations','Admin'], 'birthday_reminder',
        m.name || E'\'s birthday is today', null, 'dashboard');
      if m.profile_id is not null then
        perform public.notify_all_except(m.profile_id, 'birthday',
          E'It\'s ' || m.name || E'\'s birthday today!', 'Say happy birthday', 'chat', m.profile_id);
      end if;
    end if;
  end loop;

  -- Service milestones, every 6 months, fired on the 1st of the milestone month
  if extract(day from today) = 1 then
    for m in select id, name, join_date from members where join_date is not null loop
      months_since := (extract(year from today)::int - extract(year from m.join_date)::int) * 12
                     + (extract(month from today)::int - extract(month from m.join_date)::int);
      if months_since > 0 and months_since % 6 = 0 then
        years_part := months_since / 12;
        months_rem := months_since % 12;
        if months_rem = 0 then
          duration_text := years_part || case when years_part = 1 then ' year' else ' years' end;
        elsif years_part = 0 then
          duration_text := months_since || ' months';
        else
          duration_text := years_part || case when years_part = 1 then ' year ' else ' years ' end || months_rem || ' months';
        end if;
        chosen := fun_templates[1 + floor(random() * array_length(fun_templates, 1))::int];
        insert into public.notifications (type, title, body, link_tab, target_role)
        values ('milestone', format(chosen, m.name, duration_text), null, 'dashboard', 'all');
      end if;
    end loop;
  end if;
end;
$$;

select cron.schedule(
  'daily-celebrations',
  '0 6 * * *',
  $$ select public.run_daily_celebrations(); $$
);
