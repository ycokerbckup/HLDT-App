// Fires instantly on INSERT into the notifications table (via a Supabase
// Database Webhook), instead of waiting for the GitHub Actions poller.
// Mirrors scripts/send_roster_emails.py's recipient logic exactly — same
// rules, just event-driven instead of polled.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GMAIL_ADDRESS = Deno.env.get("GMAIL_ADDRESS")!;
const GMAIL_APP_PASSWORD = Deno.env.get("GMAIL_APP_PASSWORD")!;
const APP_URL = (Deno.env.get("APP_URL") || "").replace(/\/$/, "");
const FROM_NAME = "Display Team Ops";

const EMAILABLE_TYPES = ["roster", "assignment", "signup", "chat", "announcement", "birthday", "milestone", "graduation", "cover_request", "saturday_roster_reminder", "tuesday_roster_reminder", "attendance_warning", "attendance_suspension", "monthly_digest", "suspension_action_needed", "mention", "attendance_marking_reminder", "suspension_lifted", "special_event_reminder", "special_event_assignee_reminder"];

const PRESENCE_TYPES = ["chat", "mention"];
const PRESENCE_WINDOW_MS = 90 * 1000;

const HIGHLIGHT_BY_TYPE: Record<string, string> = {
  saturday_roster_reminder: "saturday-roster-section",
  tuesday_roster_reminder: "tuesday-roster-section",
};

function ctaButton(linkTab?: string, dmWith?: string, highlightId?: string): string {
  if (!APP_URL) return "";
  let url = `${APP_URL}/?tab=${linkTab || "dashboard"}`;
  if (dmWith) url += `&dm=${dmWith}`;
  if (highlightId) url += `&highlight=${highlightId}`;
  return `<p><a href="${url}" style="display:inline-block;padding:10px 16px;background:#E8A33D;color:#14171C;text-decoration:none;border-radius:6px;font-weight:600;">Open in app</a></p>`;
}

const THREAD_ROOT_ID = `<hldt-notifications-root@${(GMAIL_ADDRESS || "display-team-ops").split("@").pop()}>`;

async function sendEmail(to: string[], subject: string, html: string) {
  if (to.length === 0) return;
  const client = new SMTPClient({
    connection: {
      hostname: "smtp.gmail.com",
      port: 465,
      tls: true,
      auth: { username: GMAIL_ADDRESS, password: GMAIL_APP_PASSWORD },
    },
  });
  try {
    // One individual copy per recipient (their own address in "To:"),
    // not one bulk BCC message — a BCC blast with the sender's own
    // address in "To" is a known spam signal. Every message shares the
    // same In-Reply-To/References so Gmail stacks them into one ongoing
    // conversation per recipient instead of separate top-level emails.
    for (const recipient of to) {
      try {
        await client.send({
          from: `${FROM_NAME} <${GMAIL_ADDRESS}>`,
          to: recipient,
          subject,
          html,
          content: html.replace(/<[^>]+>/g, "").trim(),
          inReplyTo: THREAD_ROOT_ID,
          references: THREAD_ROOT_ID,
        });
      } catch (e) {
        console.log(`send to ${recipient} failed:`, String(e));
      }
    }
  } finally {
    await client.close();
  }
}

serve(async (req) => {
  try {
    const payload = await req.json();
    console.log("Webhook payload received, type:", payload?.record?.type, "| full:", JSON.stringify(payload).slice(0, 800));

    const record = payload?.record;
    if (!record || !EMAILABLE_TYPES.includes(record.type)) {
      console.log("Skipping — record.type is", record?.type, "which is not in EMAILABLE_TYPES");
      return new Response("skip", { status: 200 });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: profiles, error: profilesError } = await supabase.from("profiles").select("id,email,last_seen_at");
    if (profilesError) console.log("profiles query error:", JSON.stringify(profilesError));
    const emailById: Record<string, string> = {};
    const lastSeenById: Record<string, string> = {};
    (profiles || []).forEach((p: { id: string; email: string | null; last_seen_at: string | null }) => {
      if (p.email) emailById[p.id] = p.email;
      if (p.last_seen_at) lastSeenById[p.id] = p.last_seen_at;
    });
    const allEmails = Object.values(emailById);
    console.log("Total profiles with email on file:", allEmails.length);

    let to: string[] = [];

    if (record.type === "chat" && !record.target_profile_id) {
      // Team-channel broadcast (no target_profile_id) — stays silent.
      // Only DMs (always targeted to one recipient) email.
      console.log("Skipping — team-channel chat broadcast, DMs only");
      await supabase.from("notifications").update({ emailed: true }).eq("id", record.id);
      return new Response("skip-team-chat", { status: 200 });
    }

    if (PRESENCE_TYPES.includes(record.type) && record.target_profile_id) {
      const lastSeen = lastSeenById[record.target_profile_id];
      if (lastSeen && Date.now() - new Date(lastSeen).getTime() < PRESENCE_WINDOW_MS) {
        console.log("Skipping — recipient active on site within the last 90s");
        await supabase.from("notifications").update({ emailed: true }).eq("id", record.id);
        return new Response("skip-active-recipient", { status: 200 });
      }
    }

    if (record.target_profile_id) {
      const email = emailById[record.target_profile_id];
      to = email ? [email] : [];
      console.log("Targeted notification for profile", record.target_profile_id, "-> email found:", !!email);
    } else {
      to = allEmails;
    }

    console.log("Final recipient count:", to.length);

    if (to.length > 0) {
      const html = `<p>${record.body || ""}</p>` + ctaButton(record.link_tab, record.dm_with_profile_id, HIGHLIGHT_BY_TYPE[record.type]);
      try {
        await sendEmail(to, record.title, html);
        console.log("Email sent successfully to", to.length, "recipients");
      } catch (sendErr) {
        console.log("sendEmail threw:", String(sendErr));
        throw sendErr;
      }
    } else {
      console.log("No recipients resolved — nothing sent.");
    }

    await supabase.from("notifications").update({ emailed: true }).eq("id", record.id);

    return new Response("ok", { status: 200 });
  } catch (e) {
    console.error(e);
    return new Response("error: " + String(e), { status: 500 });
  }
});
