// Called by the client right after Paystack redirects back for a
// pool funding payment, for fast feedback ahead of the webhook.
// Always re-confirms against Paystack's own verify endpoint before
// updating anything — never trusts the client's word for it.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY")!;

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

    const { reference } = await req.json();
    if (!reference) return new Response(JSON.stringify({ error: "Missing reference." }), { status: 400, headers: CORS_HEADERS });

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: row } = await admin.from("pool_payments").select("*").eq("reference", reference).maybeSingle();
    if (!row) return new Response(JSON.stringify({ error: "Payment not found." }), { status: 404, headers: CORS_HEADERS });

    if (row.status !== "pending") {
      return new Response(JSON.stringify({ status: row.status }), { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
    });
    const verifyJson = await verifyRes.json();
    const paystackStatus = verifyJson?.data?.status;

    if (paystackStatus === "success" || paystackStatus === "failed" || paystackStatus === "abandoned") {
      await admin.from("pool_payments").update({
        status: paystackStatus, channel: verifyJson.data.channel, paid_at: verifyJson.data.paid_at, raw_event: verifyJson.data,
      }).eq("reference", reference).eq("status", "pending");
      return new Response(JSON.stringify({ status: paystackStatus }), { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ status: "pending" }), { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: CORS_HEADERS });
  }
});
