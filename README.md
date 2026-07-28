# Display Team Ops

Internal tool for the Display Team: members, onboarding, equipment tickets, roster, dues, feedback.
Backed by Supabase (auth + Postgres + row-level security).

## First-time setup

1. Run `supabase_schema.sql` in your Supabase project's SQL Editor (Anthropic delivered this separately).
2. Run `supabase_schema_addon.sql` after it — adds email tracking and in-app admin management.
3. Install dependencies:
   ```
   npm install
   ```
4. Copy the env file and confirm the values match your project:
   ```
   cp .env.example .env
   ```
5. Run it locally:
   ```
   npm run dev
   ```
6. Open the app, click "Create an account," and sign up with your own email. Every new signup starts as a `member`.
7. Promote yourself to the first admin. In the Supabase SQL Editor:
   ```sql
   update profiles set role = 'admin' where email = 'you@example.com';
   ```
8. Refresh the app — you're now an admin. From here, promote other admins from the **Members → Manage admins** panel instead of touching SQL again.

## Deploying so the team can use it

This is a static site after build — it can go on Vercel, Netlify, or Cloudflare Pages for free.

```
npm run build
```

This produces a `dist/` folder. Push this project to a GitHub repo and connect it to Vercel/Netlify, or drag the `dist/` folder into Netlify's manual deploy. Set the two environment variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) in the hosting platform's project settings — don't commit your `.env` file to a public repo.

## What's enforced where

- **Who can edit onboarding scores, equipment ticket status, dues, and the member directory**: enforced by Postgres row-level security, not by the app's UI. Even someone editing the browser's JavaScript can't bypass it — the database rejects the write.
- **Who can read feedback**: only admins, enforced the same way, so member-submitted feedback isn't visible to other members.
- **Onboarding score history**: insert-only. Nobody, including admins, can edit or delete a past entry through the app — this is a real audit trail, not a note anyone can overwrite.
- **Real-time sync**: if two admins have the app open at once, changes appear for both without a manual refresh.

## Known limitations

- Email confirmation is on by default in Supabase — new members need to click the confirmation link before their account works. You can turn this off in Supabase under Authentication → Providers → Email if it's more friction than you want for a small team.
- No password reset flow is wired into the UI yet — Supabase supports it, this app doesn't expose the button.
- No SMS/push notifications for reporting-time reminders or dues follow-ups. Everything is in-app only.
