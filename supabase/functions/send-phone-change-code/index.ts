// Sends the phone-change verification code by email, reusing the
// same Gmail SMTP setup already configured for regular notification
// emails. Only ever sends to the requesting person's OWN email —
// the code and destination are fetched server-side via a
// security-definer function, never trusted from the client.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GMAIL_ADDRESS = Deno.env.get("GMAIL_ADDRESS")!;
const GMAIL_APP_PASSWORD = Deno.env.get("GMAIL_APP_PASSWORD")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Not authenticated." }), { status: 401, headers: CORS_HEADERS });

    const userClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Not authenticated." }), { status: 401, headers: CORS_HEADERS });

    const { verification_id } = await req.json();
    if (!verification_id) return new Response(JSON.stringify({ error: "Missing verification_id." }), { status: 400, headers: CORS_HEADERS });

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: rows, error: rpcErr } = await admin.rpc("get_phone_change_code_for_sending", { p_verification_id: verification_id });
    if (rpcErr || !rows || rows.length === 0) {
      return new Response(JSON.stringify({ error: "Could not find that verification request." }), { status: 404, headers: CORS_HEADERS });
    }
    const { code, new_phone, profile_email } = rows[0];

    const client = new SMTPClient({
      connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: GMAIL_ADDRESS, password: GMAIL_APP_PASSWORD } },
    });
    try {
      await client.send({
        from: `Display Team Ops <${GMAIL_ADDRESS}>`,
        to: profile_email,
        subject: "Confirm your withdrawal OTP phone number change",
        html: `<p>Your verification code is <strong>${code}</strong>.</p><p>This confirms changing the withdrawal OTP phone number to ${new_phone}. Valid for 10 minutes. If you didn't request this, ignore this email.</p>`,
        content: `Your verification code is ${code}. This confirms changing the withdrawal OTP phone number to ${new_phone}. Valid for 10 minutes.`,
      });
    } finally {
      await client.close();
    }

    return new Response(JSON.stringify({ sent: true }), { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: CORS_HEADERS });
  }
});
