// Called directly by Paystack's servers, not by any client — so this
// function must have JWT verification DISABLED when deployed (Paystack
// has no Supabase auth token to send). Its own security comes entirely
// from verifying the x-paystack-signature header: HMAC-SHA512 of the
// exact raw request body, keyed with the secret key. Anything that
// fails that check is rejected before a single byte of the payload is
// trusted. After the signature passes, it still re-confirms with
// Paystack's own verify endpoint before updating anything.
//
// A reference can cover several months (one row each). If the
// confirmed amount exactly matches what they all add up to, every row
// is marked fully paid. If it's short (or over), the actual amount
// received is divided EQUALLY across the covered months — each row's
// paid/owed amounts reflect its real share, never a guess.

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

// Constant-time string comparison so the signature can't be probed by timing.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

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

serve(async (req) => {
  try {
    if (!PAYSTACK_SECRET_KEY) {
      // Never run with a missing secret: the signature check would be meaningless.
      console.error("PAYSTACK_SECRET_KEY is not configured.");
      return new Response("not configured", { status: 500 });
    }

    const rawBody = await req.text();
    const signature = req.headers.get("x-paystack-signature");

    if (!signature) {
      console.log("Rejected: no signature header.");
      return new Response("no signature", { status: 401 });
    }

    const expected = await computeHmacSha512(PAYSTACK_SECRET_KEY, rawBody);
    if (!safeEqual(expected, signature)) {
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

    if (reference.startsWith("POOL-")) {
      const { data: row } = await admin.from("pool_payments").select("*").eq("reference", reference).maybeSingle();
      if (!row || row.status !== "pending") return new Response("ok", { status: 200 });

      const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
      });
      const verifyJson = await verifyRes.json();
      const paystackStatus = verifyJson?.data?.status;
      if (paystackStatus === "success" || paystackStatus === "failed" || paystackStatus === "abandoned") {
        await admin.from("pool_payments").update({
          status: paystackStatus, channel: verifyJson.data.channel, paid_at: verifyJson.data.paid_at, raw_event: verifyJson.data,
        }).eq("reference", reference).eq("status", "pending");
      }
      return new Response("ok", { status: 200 });
    }

    const { data: rows } = await admin.from("dues_payments").select("*").eq("reference", reference);
    if (!rows || rows.length === 0 || rows.every((r: any) => r.status !== "pending")) {
      // Already processed (e.g. by verify-dues-payment on redirect) —
      // idempotent no-op, this is expected on Paystack's retries.
      return new Response("ok", { status: 200 });
    }

    const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
    });
    const verifyJson = await verifyRes.json();
    const paystackStatus = verifyJson?.data?.status;

    if (paystackStatus === "success") {
      await applySplitAndNotify(admin, rows, verifyJson.data);
    } else if (paystackStatus === "failed" || paystackStatus === "abandoned") {
      await admin.from("dues_payments").update({ status: paystackStatus, raw_event: verifyJson.data }).eq("reference", reference).eq("status", "pending");
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
