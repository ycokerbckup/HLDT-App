// Wallet helpers that need the Paystack secret key. Every action requires a
// signed-in admin; anything that changes where money goes requires an
// Operations admin plus the withdrawal PIN (checked in the database).
//
// Actions (POST body { action, ... }):
//   banks                — list Nigerian banks for the payout form
//   resolve_account      — { account_number, bank_code } → the account name Paystack has
//   save_payout_account  — { account_number, bank_code, pin } → resolves again server-side
//                          (the client's account name is never trusted), creates a Paystack
//                          transfer recipient and saves it as the payout account
//   paystack_balance     — the NGN balance Paystack is actually holding, for reconciliation
//   refresh_withdrawals  — asks Paystack about every 'processing' withdrawal and settles
//                          any whose result the webhook hasn't delivered yet

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

async function paystack(path: string, init: RequestInit = {}) {
  const res = await fetch(`https://api.paystack.co${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  return await res.json();
}

async function resolveAccount(accountNumber: string, bankCode: string) {
  if (!/^\d{10}$/.test(accountNumber)) return { error: "Account number must be 10 digits." };
  if (!/^[0-9A-Za-z]{2,10}$/.test(bankCode)) return { error: "Pick a bank." };
  const r = await paystack(`/bank/resolve?account_number=${accountNumber}&bank_code=${encodeURIComponent(bankCode)}`);
  if (!r?.status || !r.data?.account_name) return { error: r?.message || "Couldn't find that account." };
  return { account_name: r.data.account_name as string };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    if (!PAYSTACK_SECRET_KEY) return json({ error: "Payments are not configured." }, 500);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Not authenticated." }, 401);
    const userClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not authenticated." }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (profile?.role !== "admin") return json({ error: "Admins only." }, 403);
    const { data: isOpsAdmin } = await admin.rpc("_is_ops_admin", { p_actor: user.id });

    const body = await req.json().catch(() => ({}));
    const action = body?.action;

    if (action === "paystack_balance") {
      const r = await paystack("/balance");
      if (!r?.status) return json({ error: r?.message || "Couldn't reach Paystack." }, 502);
      const ngn = (r.data || []).find((b: any) => b.currency === "NGN");
      return json({ balance: ngn ? ngn.balance / 100 : 0 });
    }

    if (!isOpsAdmin) return json({ error: "Only Operations admins can do this." }, 403);

    if (action === "banks") {
      const r = await paystack("/bank?country=nigeria&currency=NGN&perPage=200");
      if (!r?.status) return json({ error: r?.message || "Couldn't load banks." }, 502);
      const seen = new Set<string>();
      const banks = (r.data || [])
        .filter((b: any) => b.active !== false && !b.is_deleted && b.code && !seen.has(b.code) && seen.add(b.code))
        .map((b: any) => ({ name: b.name, code: b.code }))
        .sort((a: any, b: any) => a.name.localeCompare(b.name));
      return json({ banks });
    }

    if (action === "resolve_account") {
      const r = await resolveAccount(String(body.account_number || ""), String(body.bank_code || ""));
      return r.error ? json({ error: r.error }, 400) : json(r);
    }

    if (action === "save_payout_account") {
      const accountNumber = String(body.account_number || "");
      const bankCode = String(body.bank_code || "");
      if (!body.pin) return json({ error: "Enter the withdrawal PIN." }, 400);
      const resolved = await resolveAccount(accountNumber, bankCode);
      if (resolved.error) return json({ error: resolved.error }, 400);

      const banks = await paystack("/bank?country=nigeria&currency=NGN&perPage=200");
      const bankName = (banks?.data || []).find((b: any) => b.code === bankCode)?.name || "Bank";

      const recipient = await paystack("/transferrecipient", {
        method: "POST",
        body: JSON.stringify({ type: "nuban", name: resolved.account_name, account_number: accountNumber, bank_code: bankCode, currency: "NGN" }),
      });
      if (!recipient?.status || !recipient.data?.recipient_code) {
        return json({ error: recipient?.message || "Paystack couldn't save that account." }, 502);
      }

      const { data: saved, error } = await admin.rpc("set_payout_account", {
        p_actor: user.id,
        p_pin: String(body.pin),
        p_recipient_code: recipient.data.recipient_code,
        p_bank_name: bankName,
        p_account_name: resolved.account_name,
        p_last4: accountNumber.slice(-4),
      });
      if (error) return json({ error: error.message }, 400);
      if (!saved?.ok) return json({ ok: false, error: saved?.error || "Couldn't save the payout account." });
      return json({ ok: true, account_name: resolved.account_name, bank_name: bankName });
    }

    if (action === "refresh_withdrawals") {
      const { data: rows } = await admin.from("withdrawal_requests").select("id, processing_at").eq("status", "processing");
      let settled = 0;
      for (const row of rows || []) {
        const r = await paystack(`/transfer/verify/${encodeURIComponent(row.id)}`);
        const s = r?.data?.status;
        if (!r?.status) {
          // Paystack has no transfer with this reference: it never left. Release the hold.
          // Only after 15 minutes, so a transfer still being created isn't released early.
          const ageMs = Date.now() - new Date(row.processing_at || 0).getTime();
          if (/not found/i.test(r?.message || "") && ageMs > 15 * 60 * 1000) {
            await admin.rpc("finalize_withdrawal", { p_request_id: row.id, p_outcome: "failed", p_transfer_code: null, p_reason: "Paystack has no record of this transfer." });
            settled++;
          }
          continue;
        }
        if (s === "success") {
          await admin.rpc("finalize_withdrawal", { p_request_id: row.id, p_outcome: "completed", p_transfer_code: r.data.transfer_code, p_reason: null });
          settled++;
        } else if (s === "failed" || s === "reversed") {
          await admin.rpc("finalize_withdrawal", { p_request_id: row.id, p_outcome: s, p_transfer_code: r.data.transfer_code, p_reason: r.data.reason || `Transfer ${s}.` });
          settled++;
        }
      }
      return json({ checked: (rows || []).length, settled });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
