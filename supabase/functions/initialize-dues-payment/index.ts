// Starts a dues payment covering one or more months. The amount for
// each month is ALWAYS computed here from the caller's actual tier —
// never taken from the client — and the total charged is always the
// exact sum of the selected months, never a guessed or arbitrary
// figure. One Paystack reference, one row per month, all linked.

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

function rateFor(tier: string): number {
  return tier === "Leader" || tier === "HOD" ? 5500 : 3500;
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

    const { months } = await req.json();
    if (!Array.isArray(months) || months.length === 0 || !months.every((m: string) => /^\d{4}-\d{2}$/.test(m))) {
      return new Response(JSON.stringify({ error: "Invalid months." }), { status: 400, headers: CORS_HEADERS });
    }
    const uniqueMonths = [...new Set(months)];

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: member } = await admin.from("members").select("id, tier, email, name").eq("profile_id", user.id).single();
    if (!member) return new Response(JSON.stringify({ error: "No member record linked to your account." }), { status: 400, headers: CORS_HEADERS });

    const perMonthKobo = rateFor(member.tier) * 100;
    const totalKobo = perMonthKobo * uniqueMonths.length;
    const reference = `DUES-${member.id}-${Date.now()}`;

    const rows = uniqueMonths.map((month) => ({ member_id: member.id, month, amount_kobo: perMonthKobo, reference, status: "pending" }));
    const { error: insertErr } = await admin.from("dues_payments").insert(rows);
    if (insertErr) return new Response(JSON.stringify({ error: insertErr.message }), { status: 500, headers: CORS_HEADERS });

    const paystackRes = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: member.email || `${user.id}@placeholder.local`,
        amount: totalKobo,
        reference,
        channels: ["card", "bank_transfer", "ussd"],
        callback_url: `${APP_URL}/?tab=dues&payment_ref=${reference}`,
        metadata: { member_id: member.id, member_name: member.name, months: uniqueMonths },
      }),
    });
    const paystackData = await paystackRes.json();

    if (!paystackData.status) {
      await admin.from("dues_payments").update({ status: "failed" }).eq("reference", reference);
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
