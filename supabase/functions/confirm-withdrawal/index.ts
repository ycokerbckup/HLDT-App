// Confirms a withdrawal and sends the money for real.
//
// Record mode (withdrawal_config.payout_mode = 'record', the default while the
// Paystack account can't send transfers): after the PIN + OTP check the amount
// comes off the wallet and the withdrawal is marked completed straight away. No
// transfer is sent; it records money taken out of the team bank account that
// Paystack settles into. Steps 3 and 4 below apply to 'paystack' mode only.
//
// 1. Checks the caller is signed in.
// 2. confirm_withdrawal_v3 checks the PIN + emailed OTP and, only if both are
//    right, holds the amount and the transfer fee (takes them off the balance)
//    and marks the request 'processing'. That RPC is callable by the service
//    role only, so the hold can never happen without the transfer below.
// 3. Sends a Paystack Transfer from the Paystack balance to the saved payout
//    account, using the withdrawal's id as the transfer reference (so Paystack
//    refuses a duplicate if this is ever retried).
// 4. If Paystack rejects it outright, the held money goes straight back. If it
//    accepts it, paystack-webhook marks it completed (or failed/reversed) when
//    Paystack reports the result.
//
// Paystack requirement: transfers must be enabled on the account, and the
// "confirm transfers with OTP" setting must be OFF for API transfers, or every
// transfer waits for an OTP approval in the Paystack dashboard.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Not authenticated." }, 401);
    const userClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not authenticated." }, 401);

    const { request_id, pin, otp } = await req.json();
    if (!request_id || !pin || !otp) return json({ error: "Enter both the PIN and OTP." }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: held, error: rpcErr } = await admin.rpc("confirm_withdrawal_v3", {
      p_actor: user.id, p_request_id: request_id, p_pin: String(pin), p_otp: String(otp).trim(),
    });
    if (rpcErr) return json({ error: rpcErr.message }, 400);
    if (!held?.ok) return json({ ok: false, error: held?.error || "Couldn't confirm the withdrawal." });

    // Record mode (until real payouts are available): Paystack already paid the
    // money into the team bank account, so this only records what was taken out.
    if (held.mode === "record") {
      await admin.rpc("finalize_withdrawal", { p_request_id: request_id, p_outcome: "completed", p_transfer_code: null, p_reason: "Recorded: paid from the team bank account." });
      return json({ ok: true, status: "completed", message: "Withdrawal recorded." });
    }
    if (!held.recipient_code) {
      await admin.rpc("finalize_withdrawal", { p_request_id: request_id, p_outcome: "failed", p_transfer_code: null, p_reason: "No payout account." });
      return json({ ok: false, error: "Add the payout bank account first. Nothing was taken from the wallet." });
    }

    if (!PAYSTACK_SECRET_KEY) {
      await admin.rpc("finalize_withdrawal", { p_request_id: request_id, p_outcome: "failed", p_transfer_code: null, p_reason: "Payments are not configured." });
      return json({ ok: false, error: "Payments are not configured. Nothing was taken from the wallet." }, 500);
    }

    // Money is now held. Send it.
    let transferJson: any = null;
    try {
      const res = await fetch("https://api.paystack.co/transfer", {
        method: "POST",
        headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "balance",
          amount: held.amount_kobo,
          recipient: held.recipient_code,
          reference: request_id,
          currency: "NGN",
          reason: (held.reason || "Display Team withdrawal").slice(0, 100),
        }),
      });
      transferJson = await res.json();
    } catch (e) {
      // We don't know whether Paystack received it. Leave it processing; the
      // webhook (or "Refresh" in the app, which asks Paystack) settles it.
      console.error("Transfer request failed in flight", e);
      await admin.rpc("finalize_withdrawal", { p_request_id: request_id, p_outcome: "pending", p_transfer_code: null, p_reason: "Waiting for Paystack to confirm." });
      return json({ ok: true, status: "processing", message: "Withdrawal sent for processing. Paystack hasn't confirmed it yet." });
    }

    if (!transferJson?.status) {
      // Rejected before any money moved (e.g. not enough in the Paystack balance).
      const raw = String(transferJson?.message || "Paystack rejected the transfer").trim();
      const reason = /[.!?]$/.test(raw) ? raw : raw + ".";
      await admin.rpc("finalize_withdrawal", { p_request_id: request_id, p_outcome: "failed", p_transfer_code: null, p_reason: reason });
      return json({ ok: false, error: `Paystack didn't send it: ${reason} Nothing was taken from the wallet.` });
    }

    const t = transferJson.data || {};
    if (t.status === "success") {
      await admin.rpc("finalize_withdrawal", { p_request_id: request_id, p_outcome: "completed", p_transfer_code: t.transfer_code, p_reason: null });
      return json({ ok: true, status: "completed", message: "Withdrawal sent." });
    }
    if (t.status === "failed" || t.status === "reversed") {
      await admin.rpc("finalize_withdrawal", { p_request_id: request_id, p_outcome: t.status, p_transfer_code: t.transfer_code, p_reason: t.reason || "Transfer failed." });
      return json({ ok: false, error: "Paystack couldn't complete the transfer. Nothing was taken from the wallet." });
    }
    const note = t.status === "otp"
      ? "Paystack is waiting for OTP approval in its dashboard. Turn off transfer OTP in Paystack settings for instant payouts."
      : "Waiting for the bank to confirm.";
    await admin.rpc("finalize_withdrawal", { p_request_id: request_id, p_outcome: "pending", p_transfer_code: t.transfer_code, p_reason: note });
    return json({ ok: true, status: "processing", message: `Withdrawal is processing. ${note}` });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
