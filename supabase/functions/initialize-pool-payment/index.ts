// Starts a "Pool funder" payment — a wallet top-up that's separate
// from dues (sponsor/donor contributions, catching up on historically
// unrecorded funds, etc). Unlike dues, there's no per-member rate to
// validate the amount against — whoever initiates it deliberately
// chooses the amount, so the client-supplied amount is trusted here.
// Open to any signed-in member, unlike withdrawal — this only adds
// money, never removes it.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY")!;
const APP_URL = (Deno.env.get("APP_URL") || "").replace(/\/$/, "");

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

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { amount, contributor_name, note } = await req.json();
    const amountNaira = Number(amount);
    if (!amountNaira || amountNaira <= 0) {
      return new Response(JSON.stringify({ error: "Enter a valid amount." }), { status: 400, headers: CORS_HEADERS });
    }
    if (!contributor_name || !String(contributor_name).trim()) {
      return new Response(JSON.stringify({ error: "Enter who this contribution is from." }), { status: 400, headers: CORS_HEADERS });
    }
    const amountKobo = Math.round(amountNaira * 100);
    const reference = `POOL-${user.id}-${Date.now()}`;

    const { error: insertErr } = await admin.from("pool_payments").insert({
      contributor_name: String(contributor_name).trim(),
      note: note ? String(note).trim() : null,
      amount_kobo: amountKobo,
      reference,
      status: "pending",
      initiated_by: user.id,
    });
    if (insertErr) return new Response(JSON.stringify({ error: insertErr.message }), { status: 500, headers: CORS_HEADERS });

    const paystackRes = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: user.email || `${user.id}@placeholder.local`,
        amount: amountKobo,
        reference,
        channels: ["card", "bank_transfer", "ussd"],
        callback_url: `${APP_URL}/?tab=dashboard&pool_payment_ref=${reference}`,
        metadata: { contributor_name, initiated_by: user.id },
      }),
    });
    const paystackData = await paystackRes.json();

    if (!paystackData.status) {
      await admin.from("pool_payments").update({ status: "failed" }).eq("reference", reference);
      return new Response(JSON.stringify({ error: paystackData.message || "Could not start payment." }), { status: 502, headers: CORS_HEADERS });
    }

    return new Response(JSON.stringify({ authorization_url: paystackData.data.authorization_url, reference }), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: CORS_HEADERS });
  }
});
