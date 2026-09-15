// Sends the withdrawal OTP by SMS. Called right after
// initiate_withdrawal creates the pending request — this function
// never reads or trusts anything from the client except which
// request to send for; the actual OTP code and phone number are
// fetched server-side via a security-definer function that only this
// function (service role) can call.
//
// NOTE: the actual SMS-sending call below is written for Termii's API
// as a starting point — swap this section for whichever provider is
// actually configured. Nothing here works until TERMII_API_KEY (or
// the equivalent for your chosen provider) is set as a secret.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TERMII_API_KEY = Deno.env.get("TERMII_API_KEY") || "";
const SMS_SENDER_ID = Deno.env.get("SMS_SENDER_ID") || "HLDT";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sendSms(phone: string, message: string) {
  if (!TERMII_API_KEY) throw new Error("SMS provider not configured (TERMII_API_KEY missing).");
  const res = await fetch("https://api.ng.termii.com/api/sms/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: TERMII_API_KEY,
      to: phone,
      from: SMS_SENDER_ID,
      sms: message,
      type: "plain",
      channel: "generic",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "SMS send failed.");
  return data;
}

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
    const { otp_code, otp_phone } = rows[0];

    await sendSms(otp_phone, `Your Display Team Ops withdrawal OTP is ${otp_code}. Valid for 10 minutes. Do not share this code.`);

    return new Response(JSON.stringify({ sent: true }), { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: CORS_HEADERS });
  }
});
