// Called directly by Paystack's servers, not by any client — so this
// function must have JWT verification DISABLED when deployed (Paystack
// has no Supabase auth token to send). Its own security comes entirely
// from verifying the x-paystack-signature header: HMAC-SHA512 of the
// exact raw request body, keyed with the secret key. Anything that
// fails that check is rejected before a single byte of the payload is
// trusted. After the signature passes, it still re-confirms with
// Paystack's own verify endpoint before updating anything.
//
// A reference can cover several months (one row each) — all rows for
// that reference are confirmed or rejected together. If the amount
// doesn't match what those months add up to, nothing is credited on
// a guess; every row is flagged 'amount_mismatch' and both the member
// and Welfare/Operations are notified to resolve it by hand.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY")!;

async function computeHmacSha512(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function notifyAdmins(admin: any, title: string, body: string) {
  const { data: adminMembers } = await admin.from("members").select("profile_id").in("unit", ["Welfare", "Operations"]);
  for (const m of adminMembers || []) {
    if (m.profile_id) {
      await admin.from("notifications").insert({ type: "dues_payment_mismatch", title, body, link_tab: "dues", target_role: "all", target_profile_id: m.profile_id });
    }
  }
}

serve(async (req) => {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-paystack-signature");

    if (!signature) {
      console.log("Rejected: no signature header.");
      return new Response("no signature", { status: 401 });
    }

    const expected = await computeHmacSha512(PAYSTACK_SECRET_KEY, rawBody);
    if (expected !== signature) {
      console.log("Rejected: signature mismatch.");
      return new Response("invalid signature", { status: 401 });
    }

    const payload = JSON.parse(rawBody);
    console.log("Verified webhook event:", payload.event);

    if (payload.event !== "charge.success" && payload.event !== "charge.failed") {
      return new Response("ok", { status: 200 });
    }

    const reference = payload.data?.reference;
    if (!reference) return new Response("ok", { status: 200 });

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: rows } = await admin.from("dues_payments").select("*").eq("reference", reference);
    if (!rows || rows.length === 0 || rows.every((r: any) => r.status !== "pending")) {
      // Already processed (e.g. by verify-dues-payment on redirect) —
      // idempotent no-op, this is expected on Paystack's retries.
      return new Response("ok", { status: 200 });
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

      const { data: memberRow } = await admin.from("members").select("profile_id, name").eq("id", rows[0].member_id).single();
      if (memberRow?.profile_id) {
        await admin.from("notifications").insert({
          type: "dues_payment_confirmed", title: "Payment received",
          body: `Your dues payment of ₦${(expectedTotal / 100).toLocaleString()} for ${months.join(", ")} was confirmed.`,
          link_tab: "dues", target_role: "all", target_profile_id: memberRow.profile_id,
        });
      }
    } else if (paystackStatus === "failed" || paystackStatus === "abandoned") {
      await admin.from("dues_payments").update({ status: paystackStatus, raw_event: verifyData.data }).eq("reference", reference).eq("status", "pending");
    } else if (paystackStatus === "success") {
      await admin.from("dues_payments").update({ status: "amount_mismatch", raw_event: verifyData.data }).eq("reference", reference).eq("status", "pending");
      const { data: memberRow } = await admin.from("members").select("profile_id, name").eq("id", rows[0].member_id).single();
      if (memberRow?.profile_id) {
        await admin.from("notifications").insert({
          type: "dues_payment_mismatch", title: "We need to check your payment",
          body: `Your payment for ${months.join(", ")} completed, but the amount doesn't match what's expected — Welfare/Operations will follow up.`,
          link_tab: "dues", target_role: "all", target_profile_id: memberRow.profile_id,
        });
        await notifyAdmins(admin, "Dues payment amount mismatch",
          `${memberRow.name}'s payment for ${months.join(", ")} (ref ${reference}) doesn't match the expected total — needs manual review.`);
      }
    }

    return new Response("ok", { status: 200 });
  } catch (e) {
    console.error(e);
    // Still 200 — Paystack retries on non-2xx, and a transient error
    // on our side shouldn't trigger a retry storm. Errors are visible
    // in the function logs for follow-up.
    return new Response("logged error", { status: 200 });
  }
});
