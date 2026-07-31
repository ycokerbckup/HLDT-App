# Instant notification emails (Edge Function + Database Webhook)

This replaces polling with true event-driven delivery: the moment a
notification is created, an email goes out — no waiting for a scheduled
job. The GitHub Actions poller (every 5 minutes) stays in place as a
backup, in case the webhook ever fails silently.

## One-time setup

You'll need Node.js installed (same as for the main app). Run these from
a terminal, in the root of this project (where `package.json` lives):

1. Install the Supabase CLI:
   ```
   npm install -g supabase
   ```

2. Log in (opens a browser window to authenticate):
   ```
   supabase login
   ```

3. Link this project to your Supabase project:
   ```
   supabase link --project-ref jsxatpqdolmgcoyibbam
   ```
   It may ask for your database password — that's the one you set when
   you first created the Supabase project.

4. Deploy the function:
   ```
   supabase functions deploy send-notification-email --no-verify-jwt
   ```

5. Set the secrets the function needs (same Gmail credentials as the
   GitHub Actions workflows):
   ```
   supabase secrets set GMAIL_ADDRESS=your-email@gmail.com
   supabase secrets set GMAIL_APP_PASSWORD=your-16-character-app-password
   supabase secrets set APP_URL=https://hldt-app.vercel.app
   ```
   (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided
   automatically by Supabase — no need to set those yourself.)

6. Copy the function's URL — it printed after step 4, or find it under
   **Edge Functions** in the Supabase Dashboard. It looks like:
   ```
   https://jsxatpqdolmgcoyibbam.supabase.co/functions/v1/send-notification-email
   ```

## Connect the webhook

1. Supabase Dashboard → **Database → Webhooks** → **Create a new webhook**.
2. Name: `notify-on-insert` (or anything).
3. Table: `notifications`.
4. Events: check **Insert** only.
5. Type: **Supabase Edge Functions**, then select `send-notification-email`
   from the dropdown (or paste the URL from step 6 above if it asks for
   an HTTP endpoint instead).
6. Save.

## Test it

1. Trigger anything that creates a notification — post an announcement,
   send a chat message, publish a roster.
2. It should land in an inbox within seconds, not minutes.
3. If it doesn't, check **Edge Functions → send-notification-email →
   Logs** in the Supabase Dashboard for the error.

## If something goes wrong

The GitHub Actions poller (`roster-emails.yml`) is still running every 5
minutes as a safety net — even if the webhook is misconfigured, emails
will still go out, just not instantly. Nothing breaks while you're
setting this up.
