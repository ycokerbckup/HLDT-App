// Generates equipment purchase/replacement suggestions from current
// inventory + recent unresolved tickets, using Google Gemini's free API
// tier. Called on-demand by the app (not a webhook) — requires the caller
// to be a logged-in, Technical-unit user, checked here server-side too,
// not just hidden in the UI.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function nextResetUTC(): string {
  const now = new Date();
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 7, 0, 0, 0));
  if (reset.getTime() <= now.getTime()) reset.setUTCDate(reset.getUTCDate() + 1);
  return reset.toISOString();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not signed in." }), { status: 401, headers: CORS_HEADERS });
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Not signed in." }), { status: 401, headers: CORS_HEADERS });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: memberRow } = await supabase.from("members").select("unit").eq("profile_id", user.id).maybeSingle();
    if (memberRow?.unit !== "Technical" && memberRow?.unit !== "Operations") {
      return new Response(JSON.stringify({ error: "Technical or Operations unit only." }), { status: 403, headers: CORS_HEADERS });
    }

    const { data: inventory } = await supabase
      .from("equipment_inventory")
      .select("name,category,quantity,condition,purchase_date,estimated_value,notes");

    const { data: tickets } = await supabase
      .from("tickets")
      .select("description,systems,status,created_at")
      .neq("status", "Resolved")
      .order("created_at", { ascending: false })
      .limit(20);

    const prompt = `You are an equipment advisor for a church AV/Display team in Nigeria. You have access to live Google Search — use it to find real, current prices and repair-shop rates in Nigeria (Naira ₦) wherever possible, rather than guessing.

Current inventory (JSON):
${JSON.stringify(inventory || [], null, 2)}

Recent unresolved equipment issues/tickets (JSON):
${JSON.stringify(tickets || [], null, 2)}

For each faulty/poor-condition inventory item and each unresolved ticket, and for any clear gaps in the inventory, produce a suggestion with:
- "item": short name of the equipment or fix
- "issue": what's actually wrong (diagnosis), in plain terms
- "recommendedAction": "Repair", "Replace", or "New Purchase"
- "repairCostEstimate": realistic Naira range to repair, using real prices where you can find them via search, or "N/A" if not repairable
- "replacementCostEstimate": realistic Naira range to replace/buy new, using real prices where you can find them via search
- "priority": "High", "Medium", or "Low"
- "notes": brief reasoning for the recommendation (repair vs replace), 1-2 sentences

Suggest up to 6 items, ranked by priority. Respond with ONLY a JSON array (no markdown fences, no other text), in this exact shape:
[{"item": "...", "issue": "...", "recommendedAction": "Repair", "repairCostEstimate": "...", "replacementCostEstimate": "...", "priority": "High", "notes": "..."}]`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Gemini API error:", geminiRes.status, errText);
      if (geminiRes.status === 429) {
        await supabase.from("ai_quota_status").update({
          exhausted_at: new Date().toISOString(),
          next_reset_at: nextResetUTC(),
        }).eq("id", 1);
      }
      return new Response(JSON.stringify({ error: `AI request failed (${geminiRes.status}). Try again shortly.` }), { status: 502, headers: CORS_HEADERS });
    }

    const geminiData = await geminiRes.json();
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") || "[]";

    let suggestions;
    try {
      // Grounded responses aren't always pure JSON (may include stray text
      // or markdown fences) — extract the first [...] block defensively.
      const match = rawText.match(/\[[\s\S]*\]/);
      suggestions = match ? JSON.parse(match[0]) : [];
    } catch {
      console.error("Failed to parse Gemini output as JSON:", rawText);
      suggestions = [];
    }

    return new Response(JSON.stringify({ suggestions }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: CORS_HEADERS });
  }
});
