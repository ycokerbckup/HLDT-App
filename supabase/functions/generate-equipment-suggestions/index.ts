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

    const { data: inventory } = await supabase
      .from("equipment_inventory")
      .select("name,category,quantity,condition,purchase_date,estimated_value,notes");

    const { data: tickets } = await supabase
      .from("tickets")
      .select("description,systems,status,created_at")
      .neq("status", "Resolved")
      .order("created_at", { ascending: false })
      .limit(20);

    const prompt = `You are helping a church AV/Display team decide what equipment to request, replace, or repair.

Current inventory (JSON):
${JSON.stringify(inventory || [], null, 2)}

Recent unresolved equipment issues/tickets (JSON):
${JSON.stringify(tickets || [], null, 2)}

Based on this, suggest up to 6 concrete equipment requests. For each, give:
- "item": short name
- "reason": 1-2 sentences, referencing specific inventory condition or reported issues where relevant
- "priority": "High", "Medium", or "Low"
- "estimatedCost": a rough Nigerian Naira (₦) range if you can reasonably infer one, otherwise "Unknown"

Respond with ONLY a JSON array, no other text, in this exact shape:
[{"item": "...", "reason": "...", "priority": "High", "estimatedCost": "..."}]`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Gemini API error:", geminiRes.status, errText);
      return new Response(JSON.stringify({ error: `AI request failed (${geminiRes.status}). Try again shortly.` }), { status: 502, headers: CORS_HEADERS });
    }

    const geminiData = await geminiRes.json();
    const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "[]";

    let suggestions;
    try {
      suggestions = JSON.parse(text);
    } catch {
      console.error("Failed to parse Gemini output as JSON:", text);
      suggestions = [];
    }

    return new Response(JSON.stringify({ suggestions }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: CORS_HEADERS });
  }
});
