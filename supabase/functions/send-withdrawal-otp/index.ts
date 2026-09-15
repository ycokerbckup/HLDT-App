// Sends the withdrawal OTP by email — free, since it reuses the same
// Gmail SMTP already configured for every other notification email
// in this app, instead of a paid SMS provider. Called right after
// initiate_withdrawal creates the pending request; the actual OTP
// code and destination email are fetched server-side via a
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

    const { request_id } = await req.json();
    if (!request_id) return new Response(JSON.stringify({ error: "Missing request_id." }), { status: 400, headers: CORS_HEADERS });

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: rows, error: rpcErr } = await admin.rpc("get_withdrawal_otp_for_sending", { p_request_id: request_id });
    if (rpcErr || !rows || rows.length === 0) {
      return new Response(JSON.stringify({ error: "Could not find that withdrawal request." }), { status: 404, headers: CORS_HEADERS });
    }
    const { otp_code, otp_email } = rows[0];
    if (!otp_email) {
      return new Response(JSON.stringify({ error: "No withdrawal OTP email configured yet." }), { status: 400, headers: CORS_HEADERS });
    }

    const client = new SMTPClient({
      connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: GMAIL_ADDRESS, password: GMAIL_APP_PASSWORD } },
    });
    try {
      await client.send({
        from: `Display Team Ops <${GMAIL_ADDRESS}>`,
        to: otp_email,
        subject: "Withdrawal OTP",
        html: `<p>Your Display Team Ops withdrawal OTP is <strong>${otp_code}</strong>.</p><p>Valid for 10 minutes. Do not share this code with anyone.</p>`,
        content: `Your Display Team Ops withdrawal OTP is ${otp_code}. Valid for 10 minutes. Do not share this code with anyone.`,
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
