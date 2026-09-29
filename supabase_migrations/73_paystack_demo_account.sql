-- Creates a demo login for Paystack's review team — bypasses email
-- verification entirely (the email doesn't need to be real or
-- deliverable), and the existing handle_new_user() trigger fires
-- automatically to create the matching profiles/members rows, same
-- as a normal signup would.
--
-- Replace 'paystack-review@example.com' and 'ChangeThisPassword123!'
-- with whatever you actually want to hand to Paystack before running
-- this. Requires pgcrypto, which this project already has enabled.

do $$
declare
  new_user_id uuid := gen_random_uuid();
  demo_email text := 'paystack-review@example.com';
  demo_password text := 'ChangeThisPassword123!';
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', new_user_id, 'authenticated', 'authenticated',
    demo_email, crypt(demo_password, gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', 'Paystack Review'),
    now(), now(), '', '', '', ''
  );

  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider, created_at, updated_at
  ) values (
    gen_random_uuid(), new_user_id, new_user_id::text,
    jsonb_build_object('sub', new_user_id::text, 'email', demo_email),
    'email', now(), now()
  );

  -- handle_new_user() has now fired automatically, creating
  -- profiles + members rows. Promote them to admin + Operations.
  update public.profiles set role = 'admin' where id = new_user_id;
  update public.members set unit = 'Operations', tier = 'HOD' where profile_id = new_user_id;

  raise notice 'Demo account created — email: %, password: %', demo_email, demo_password;
end $$;
