# Display Team Ops

Internal tool for the Display Team: members, onboarding, equipment tickets, roster, dues, feedback.
Backed by Supabase (auth + Postgres + row-level security).

## First-time setup

1. Run `supabase_schema.sql` in your Supabase project's SQL Editor (Anthropic delivered this separately).
2. Run `supabase_schema_addon.sql` after it — adds email tracking and in-app admin management.
3. Run the files under `supabase_migrations/` in numeric order (01 through 06) — each adds a feature phase (linking, dedupe guard, announcements/notifications, chat, feed, and the phase 4 fixes/permissions model).
4. Install dependencies:
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

## Automated backups

A GitHub Action (`.github/workflows/backup.yml`) runs daily at 03:00 UTC, pulls every table from Supabase, and commits the result into the `backups/YYYY-MM-DD/` folder in this repo. This is independent of Supabase itself — if Supabase's own data were ever lost, these backups live in GitHub instead.

**One-time setup required:**

1. In Supabase: **Project Settings → API Keys**, copy the `service_role` (or `secret`) key. Treat this like a database root password — it bypasses every access rule in the app.
2. In GitHub: this repo's **Settings → Secrets and variables → Actions → New repository secret**.
3. Name: `SUPABASE_SERVICE_ROLE_KEY`. Value: the key from step 1. Save.
4. That's it — the workflow will run automatically from the next scheduled time onward. To test it immediately instead of waiting: go to the **Actions** tab in this repo, select "Daily Supabase Backup," click **Run workflow**.

**To restore from a backup**: each JSON file under `backups/<date>/` is a full dump of one table, in the same shape Supabase returns it. Restoring means re-inserting that data into a fresh or recovered Supabase project — this isn't a one-click restore, it's raw material for a manual recovery. If you're ever in that situation, come back to this conversation (or a new one) and ask for help walking through it rather than guessing.

## Known limitations

- Email confirmation is on by default in Supabase — new members need to click the confirmation link before their account works. You can turn this off in Supabase under Authentication → Providers → Email if it's more friction than you want for a small team.
- No password reset flow is wired into the UI yet — Supabase supports it, this app doesn't expose the button.
- No SMS/push notifications for reporting-time reminders or dues follow-ups. Everything is in-app only.

## Wallet and payouts (migration 85)

The wallet holds the team's real money in the Paystack balance until an Operations admin withdraws it to the saved payout bank account.

- Every movement is a row in `wallet_ledger` (append-only). The balance shown is net of the fee Paystack actually kept on each payment.
- A withdrawal needs the PIN and the emailed OTP, then sends a real Paystack Transfer. The amount plus Paystack's transfer fee is held while it's processing, and returned automatically if the transfer fails or is reversed.

**One-time setup:**

1. Run `supabase_migrations/85_real_wallet_ledger_and_payouts.sql`.
2. Deploy the new and changed functions: `supabase functions deploy confirm-withdrawal wallet-admin paystack-webhook`.
3. In Paystack: **Settings → Preferences**, turn off "Confirm transfers before sending" (OTP for transfers), or every payout waits for approval in the Paystack dashboard. Make sure transfers are enabled on the account.
4. In Paystack: set settlements to stay in the **Paystack balance** rather than being paid out to a bank automatically, so the money stays in the wallet until withdrawn.
5. Confirm the webhook URL in Paystack still points at `paystack-webhook`; it now also handles `transfer.success`, `transfer.failed` and `transfer.reversed`.
6. In the app: Dashboard → Wallet → **Add account** (needs the withdrawal PIN).
