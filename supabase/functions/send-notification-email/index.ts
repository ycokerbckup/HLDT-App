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

const EMAILABLE_TYPES = ["roster", "assignment", "signup", "chat", "announcement"];

function ctaButton(linkTab?: string, dmWith?: string): string {
  if (!APP_URL) return "";
  let url = `${APP_URL}/?tab=${linkTab || "dashboard"}`;
  if (dmWith) url += `&dm=${dmWith}`;
  return `<p><a href="${url}" style="display:inline-block;padding:10px 16px;background:#E8A33D;color:#14171C;text-decoration:none;border-radius:6px;font-weight:600;">Open in app</a></p>`;
}

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
    await client.send({
      from: `${FROM_NAME} <${GMAIL_ADDRESS}>`,
      to: GMAIL_ADDRESS, // visible header stays generic; real recipients via bcc
      bcc: to,
      subject,
      html,
    });
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

    const { data: profiles, error: profilesError } = await supabase.from("profiles").select("id,email");
    if (profilesError) console.log("profiles query error:", JSON.stringify(profilesError));
    const emailById: Record<string, string> = {};
    (profiles || []).forEach((p: { id: string; email: string | null }) => {
      if (p.email) emailById[p.id] = p.email;
    });
    const allEmails = Object.values(emailById);
    console.log("Total profiles with email on file:", allEmails.length);

    let to: string[] = [];

    if (record.type === "chat" && !record.target_profile_id) {
      // Team-channel broadcast: everyone except whoever sent it.
      let senderId: string | null = null;
      if (record.message_id) {
        const { data: msg } = await supabase
          .from("messages")
          .select("sender_id")
          .eq("id", record.message_id)
          .maybeSingle();
        senderId = msg?.sender_id ?? null;
      }
      to = Object.entries(emailById)
        .filter(([pid]) => pid !== senderId)
        .map(([, email]) => email);
    } else if (record.target_profile_id) {
      const email = emailById[record.target_profile_id];
      to = email ? [email] : [];
      console.log("Targeted notification for profile", record.target_profile_id, "-> email found:", !!email);
    } else {
      to = allEmails;
    }

    console.log("Final recipient count:", to.length);

    if (to.length > 0) {
      const html = `<p>${record.body || ""}</p>` + ctaButton(record.link_tab, record.dm_with_profile_id);
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
