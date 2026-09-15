// Called by the client right after Paystack redirects back, so the
// person gets fast feedback instead of waiting on the webhook's
// timing. Still never trusts the client's word for it — always
// re-confirms the reference directly against Paystack's own verify
// endpoint before updating anything, and only lets someone check a
// reference that's actually theirs.

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
    const { data: row } = await admin.from("dues_payments").select("*, members(profile_id)").eq("reference", reference).single();
    if (!row) return new Response(JSON.stringify({ error: "Payment not found." }), { status: 404, headers: CORS_HEADERS });
    if (row.members?.profile_id !== user.id) {
      return new Response(JSON.stringify({ error: "This isn't your payment." }), { status: 403, headers: CORS_HEADERS });
    }

    if (row.status !== "pending") {
      return new Response(JSON.stringify({ status: row.status }), { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
    });
    const verifyData = await verifyRes.json();
    const paystackStatus = verifyData?.data?.status;

    if (paystackStatus === "success" && verifyData.data.amount === row.amount_kobo) {
      await admin.from("dues_payments").update({
        status: "success", channel: verifyData.data.channel, paid_at: verifyData.data.paid_at, raw_event: verifyData.data,
      }).eq("reference", reference).eq("status", "pending");
      return new Response(JSON.stringify({ status: "success" }), { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    } else if (paystackStatus === "failed" || paystackStatus === "abandoned") {
      await admin.from("dues_payments").update({ status: paystackStatus, raw_event: verifyData.data }).eq("reference", reference).eq("status", "pending");
      return new Response(JSON.stringify({ status: paystackStatus }), { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ status: "pending" }), { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: CORS_HEADERS });
  }
});
