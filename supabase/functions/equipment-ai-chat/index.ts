// Multi-turn conversational assistant for equipment planning — describe
// what you need or an upcoming event, get tailored suggestions grounded
// in current inventory, open tickets, and live Google Search for real
// pricing. Technical-unit only, checked server-side.

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
    if (memberRow?.unit !== "Technical") {
      return new Response(JSON.stringify({ error: "Technical unit only." }), { status: 403, headers: CORS_HEADERS });
    }

    const body = await req.json();
    const userMessage: string = body?.message || "";
    const history: { role: "user" | "model"; text: string }[] = Array.isArray(body?.history) ? body.history : [];

    if (!userMessage.trim()) {
      return new Response(JSON.stringify({ error: "Empty message." }), { status: 400, headers: CORS_HEADERS });
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

    const systemContext = `You are an equipment planning assistant for a church AV/Display team in Nigeria. You have access to live Google Search — use it to find real, current prices in Naira (₦) wherever relevant, rather than guessing.

Current inventory (JSON):
${JSON.stringify(inventory || [], null, 2)}

Recent unresolved equipment issues/tickets (JSON):
${JSON.stringify(tickets || [], null, 2)}

The user will describe what they need — an upcoming event, a requirement, a problem — in their own words. Have a natural conversation: ask clarifying questions if genuinely useful, but default to giving concrete, actionable suggestions (what to buy, approximate cost, why) grounded in the inventory and tickets above. Keep replies concise — a few short paragraphs or a short list, not an essay.`;

    const contents = [
      { role: "user", parts: [{ text: systemContext }] },
      { role: "model", parts: [{ text: "Understood — I have the current inventory and open tickets. What do you need help with?" }] },
      ...history.map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
      { role: "user", parts: [{ text: userMessage }] },
    ];

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          tools: [{ google_search: {} }],
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Gemini API error:", geminiRes.status, errText);
      return new Response(JSON.stringify({ error: `AI request failed (${geminiRes.status}). Try again shortly.` }), { status: 502, headers: CORS_HEADERS });
    }

    const geminiData = await geminiRes.json();
    const reply = geminiData?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") || "Sorry, I didn't get a usable response — try rephrasing.";

    return new Response(JSON.stringify({ reply }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: CORS_HEADERS });
  }
});
