// Called by the client right after Paystack redirects back, so the
// person gets fast feedback instead of waiting on the webhook's
// timing. Still never trusts the client's word for it — always
// re-confirms the reference directly against Paystack's own verify
// endpoint before updating anything, and only lets someone check a
// reference that's actually theirs.
//
// A reference can now cover several months (one row each). All rows
// for that reference rise and fall together: if the confirmed amount
// exactly matches what all of them add up to, every row is marked
// success and one notification is sent covering all the months. If
// Paystack reports success but for a DIFFERENT amount than expected,
// nothing is credited on a guess — every row is flagged
// 'amount_mismatch' and both the member and Welfare/Operations are
// notified to sort it out by hand.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function notifyAdmins(admin: any, title: string, body: string) {
  const { data: adminMembers } = await admin.from("members").select("profile_id").in("unit", ["Welfare", "Operations"]);
  for (const m of adminMembers || []) {
    if (m.profile_id) {
      await admin.from("notifications").insert({ type: "dues_payment_mismatch", title, body, link_tab: "dues", target_role: "all", target_profile_id: m.profile_id });
    }
  }
}

async function resolveReference(admin: any, reference: string, memberProfileId: string | null) {
  const { data: rows } = await admin.from("dues_payments").select("*").eq("reference", reference);
  if (!rows || rows.length === 0) return { error: "Payment not found.", httpStatus: 404 };

  const firstRow = rows[0];
  if (memberProfileId) {
    const { data: member } = await admin.from("members").select("profile_id").eq("id", firstRow.member_id).single();
    if (member?.profile_id !== memberProfileId) return { error: "This isn't your payment.", httpStatus: 403 };
  }

  if (rows.every((r: any) => r.status !== "pending")) {
    return { status: rows[0].status };
  }

  const expectedTotal = rows.reduce((sum: number, r: any) => sum + r.amount_kobo, 0);
  const months = rows.map((r: any) => r.month).sort();

  const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
  });
  const verifyData = await verifyRes.json();
  const paystackStatus = verifyData?.data?.status;

  if (paystackStatus === "success" && verifyData.data.amount === expectedTotal) {
    await admin.from("dues_payments").update({
      status: "success", channel: verifyData.data.channel, paid_at: verifyData.data.paid_at, raw_event: verifyData.data,
    }).eq("reference", reference).eq("status", "pending");

    const { data: memberRow } = await admin.from("members").select("profile_id, name").eq("id", firstRow.member_id).single();
    if (memberRow?.profile_id) {
      await admin.from("notifications").insert({
        type: "dues_payment_confirmed", title: "Payment received",
        body: `Your dues payment of ₦${(expectedTotal / 100).toLocaleString()} for ${months.join(", ")} was confirmed.`,
        link_tab: "dues", target_role: "all", target_profile_id: memberRow.profile_id,
      });
    }
    return { status: "success" };
  } else if (paystackStatus === "failed" || paystackStatus === "abandoned") {
    await admin.from("dues_payments").update({ status: paystackStatus, raw_event: verifyData.data }).eq("reference", reference).eq("status", "pending");
    return { status: paystackStatus };
  } else if (paystackStatus === "success") {
    // Paystack says success, but the amount doesn't match what these
    // months add up to — never credit a guess, flag for a human.
    await admin.from("dues_payments").update({ status: "amount_mismatch", raw_event: verifyData.data }).eq("reference", reference).eq("status", "pending");
    const { data: memberRow } = await admin.from("members").select("profile_id, name").eq("id", firstRow.member_id).single();
    if (memberRow?.profile_id) {
      await admin.from("notifications").insert({
        type: "dues_payment_mismatch", title: "We need to check your payment",
        body: `Your payment for ${months.join(", ")} completed, but the amount doesn't match what's expected — Welfare/Operations will follow up.`,
        link_tab: "dues", target_role: "all", target_profile_id: memberRow.profile_id,
      });
      await notifyAdmins(admin, "Dues payment amount mismatch",
        `${memberRow.name}'s payment for ${months.join(", ")} (ref ${reference}) doesn't match the expected total — needs manual review.`);
    }
    return { status: "amount_mismatch" };
  }

  return { status: "pending" };
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

    const { reference } = await req.json();
    if (!reference) return new Response(JSON.stringify({ error: "Missing reference." }), { status: 400, headers: CORS_HEADERS });

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const result = await resolveReference(admin, reference, user.id);
    if (result.error) return new Response(JSON.stringify({ error: result.error }), { status: result.httpStatus || 400, headers: CORS_HEADERS });

    return new Response(JSON.stringify({ status: result.status }), { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: CORS_HEADERS });
  }
});
