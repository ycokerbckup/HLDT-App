// Called by the client right after Paystack redirects back, so the
// person gets fast feedback instead of waiting on the webhook's
// timing. Still never trusts the client's word for it — always
// re-confirms the reference directly against Paystack's own verify
// endpoint before updating anything, and only lets someone check a
// reference that's actually theirs.
//
// A reference can cover several months (one row each). If the
// confirmed amount exactly matches what they all add up to, every
// row is marked fully paid. If it's short (or, symmetrically, more
// than expected), the actual amount received is divided EQUALLY
// across the covered months — each row's own paid/owed amounts
// reflect its real share, never a guess about which month "should"
// be favored.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function applySplitAndNotify(admin: any, rows: any[], verifyData: any) {
  const actualTotal = verifyData.amount;
  const numMonths = rows.length;
  const baseShare = Math.floor(actualTotal / numMonths);
  const remainder = actualTotal - baseShare * numMonths;

  for (let i = 0; i < rows.length; i++) {
    const paidForThisRow = baseShare + (i === rows.length - 1 ? remainder : 0);
    const owedForThisRow = Math.max(0, rows[i].amount_kobo - paidForThisRow);
    const rowStatus = owedForThisRow > 0 ? "partial" : "success";
    await admin.from("dues_payments").update({
      status: rowStatus, paid_kobo: paidForThisRow, owed_kobo: owedForThisRow,
      channel: verifyData.channel, paid_at: verifyData.paid_at, raw_event: verifyData,
    }).eq("id", rows[i].id);
  }

  const months = rows.map((r: any) => r.month).sort();
  const isFullyPaid = rows.every((r: any) => Math.max(0, r.amount_kobo - baseShare) <= 0);
  const { data: memberRow } = await admin.from("members").select("profile_id, name").eq("id", rows[0].member_id).single();
  if (memberRow?.profile_id) {
    if (isFullyPaid) {
      await admin.from("notifications").insert({
        type: "dues_payment_confirmed", title: "Payment received",
        body: `Your dues payment of ₦${(actualTotal / 100).toLocaleString()} for ${months.join(", ")} was confirmed.`,
        link_tab: "dues", target_role: "all", target_profile_id: memberRow.profile_id,
      });
    } else {
      await admin.from("notifications").insert({
        type: "dues_payment_confirmed", title: "Partial payment received",
        body: `Your payment of ₦${(actualTotal / 100).toLocaleString()} was applied evenly across ${months.join(", ")} — there's still a balance owing on these months.`,
        link_tab: "dues", target_role: "all", target_profile_id: memberRow.profile_id,
      });
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

  const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
  });
  const verifyJson = await verifyRes.json();
  const paystackStatus = verifyJson?.data?.status;

  if (paystackStatus === "success") {
    await applySplitAndNotify(admin, rows, verifyJson.data);
    return { status: "success" };
  } else if (paystackStatus === "failed" || paystackStatus === "abandoned") {
    await admin.from("dues_payments").update({ status: paystackStatus, raw_event: verifyJson.data }).eq("reference", reference).eq("status", "pending");
    return { status: paystackStatus };
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
