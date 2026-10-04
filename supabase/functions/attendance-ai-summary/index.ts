// Generates a short attendance summary + recommended disciplinary
// measure for one member. All the actual numbers (counts, streaks,
// prorated minimum) are computed here in code, not by the AI — an LLM
// should never be trusted to count accurately when the output drives
// real warnings/suspension notices. Gemini only writes the narrative
// framing around numbers we already know are correct.
// Roster-manager only (Operations/Admin unit), checked server-side.

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

const MIN_PRESENT_TARGET = 8;

// Hard cap on the Gemini call (including one possible retry). 1.3s was
// too tight — logs showed it aborting every time, so the AI text never
// arrived. This leaves room for a real response while still bounding
// the wait; the client shows instant rule-based stats meanwhile.
const GEMINI_BUDGET_MS = 3500;

// Gemini 3.x models think dynamically by default, which is the main
// source of latency on a task this simple (summarising a handful of
// numbers) — pin it to minimal. responseMimeType keeps the output as
// clean JSON with no markdown fences.
function callGemini(prompt: string, withThinkingConfig: boolean, signal: AbortSignal) {
  const generationConfig: Record<string, unknown> = { responseMimeType: "application/json" };
  if (withThinkingConfig) generationConfig.thinkingConfig = { thinkingLevel: "minimal" };
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig }),
      signal,
    }
  );
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

    const { data: callerMember } = await supabase.from("members").select("unit").eq("profile_id", user.id).maybeSingle();
    if (callerMember?.unit !== "Operations" && callerMember?.unit !== "Admin") {
      return new Response(JSON.stringify({ error: "Operations or Admin unit only." }), { status: 403, headers: CORS_HEADERS });
    }

    const body = await req.json();
    const memberId: string = body?.memberId;
    if (!memberId) {
      return new Response(JSON.stringify({ error: "memberId required." }), { status: 400, headers: CORS_HEADERS });
    }

    const { data: member } = await supabase.from("members").select("id,name,join_date").eq("id", memberId).maybeSingle();
    if (!member) {
      return new Response(JSON.stringify({ error: "Member not found." }), { status: 404, headers: CORS_HEADERS });
    }

    // WAT is UTC+1 — shift the timestamp once, then use only UTC
    // getters/constructors so this is correct regardless of the
    // server runtime's own local timezone setting.
    const watNow = new Date(Date.now() + 60 * 60 * 1000);
    const thisMonth = watNow.toISOString().slice(0, 7);
    const monthStart = `${thisMonth}-01`;
    const nextMonth = new Date(Date.UTC(watNow.getUTCFullYear(), watNow.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);

    const { data: memberRecords } = await supabase
      .from("attendance_records")
      .select("event_type,event_date,status")
      .eq("member_id", memberId)
      .gte("event_date", monthStart)
      .lt("event_date", nextMonth);

    const { data: allRecordsThisMonth } = await supabase
      .from("attendance_records")
      .select("event_type,event_date")
      .gte("event_date", monthStart)
      .lt("event_date", nextMonth);

    const records = memberRecords || [];
    const present = records.filter((r) => r.status === "present").length;
    const absent = records.filter((r) => r.status === "absent").length;
    const excused = records.filter((r) => r.status === "excused").length;

    const allEvents = new Set((allRecordsThisMonth || []).map((r) => `${r.event_type}|${r.event_date}`));
    const eventsSinceJoin = new Set(
      (allRecordsThisMonth || [])
        .filter((r) => !member.join_date || r.event_date >= member.join_date)
        .map((r) => `${r.event_type}|${r.event_date}`)
    );
    const totalEvents = allEvents.size;
    const proratedMin = totalEvents > 0
      ? Math.round((MIN_PRESENT_TARGET * eventsSinceJoin.size) / totalEvents)
      : MIN_PRESENT_TARGET;

    const nonExcused = records.filter((r) => r.status !== "excused").sort((a, b) => a.event_date.localeCompare(b.event_date));
    let currentStreak = 0;
    for (let i = nonExcused.length - 1; i >= 0; i--) {
      if (nonExcused[i].status === "absent") currentStreak++;
      else break;
    }

    const stats = {
      present, absent, excused,
      totalTrackedThisMonth: records.length,
      proratedMinimum: proratedMin,
      metMinimum: present >= proratedMin,
      currentConsecutiveAbsences: currentStreak,
    };

    // If the numbers haven't changed since the last AI summary for this
    // member this month, that summary is still correct — return it
    // straight from the database instead of calling Gemini again. Any
    // new attendance record changes the stats, which changes the key
    // and invalidates the cache automatically. (If the cache table
    // doesn't exist yet, this read just comes back empty and the
    // function carries on as normal.)
    const statsKey = JSON.stringify({ name: member.name, stats });
    const { data: cached } = await supabase
      .from("attendance_ai_cache")
      .select("stats_key,summary,recommendation,reasoning")
      .eq("member_id", memberId)
      .eq("month", thisMonth)
      .maybeSingle();
    if (cached && cached.stats_key === statsKey) {
      return new Response(
        JSON.stringify({ stats, summary: cached.summary, recommendation: cached.recommendation, reasoning: cached.reasoning, cached: true }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    let summary = "";
    let recommendation = "";
    let reasoning = "";
    let fromAi = false;

    if (GEMINI_API_KEY) {
      const prompt = `You are reviewing attendance for a church AV/Display team volunteer. Be direct, fair, and brief.

Name: ${member.name}
This month's attendance (already computed, treat as ground truth):
${JSON.stringify(stats, null, 2)}

Team policy:
- Prorated minimum presences this month for this person: ${proratedMin} (accounts for when they joined)
- Missing 2 events in a row triggers an automatic warning email
- 3 total absences this month (any spacing) triggers a second warning
- 4 total absences this month triggers automatic suspension

Respond with ONLY a JSON object, no markdown fences, no other text:
{"summary": "2-3 sentence plain-language summary of how they're doing this month, referencing the actual numbers", "recommendation": "one of: No action needed / Informal check-in recommended / Formal warning already triggered / Suspension already triggered / Suspension warranted", "reasoning": "1 sentence tying the recommendation to the specific numbers above"}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), GEMINI_BUDGET_MS);
      try {
        const startedAt = Date.now();
        let geminiRes = await callGemini(prompt, true, controller.signal);
        if (geminiRes.status === 400) {
          // If the API ever rejects the thinking config, don't let that
          // silently turn into "AI never works" — log the real reason
          // and retry once without it, within the same time budget.
          console.error("Gemini rejected thinkingConfig, retrying without it:", await geminiRes.text());
          geminiRes = await callGemini(prompt, false, controller.signal);
        }
        console.log("Gemini latency ms:", Date.now() - startedAt, "status:", geminiRes.status);
        if (geminiRes.ok) {
          const geminiData = await geminiRes.json();
          const rawText = geminiData?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") || "{}";
          const match = rawText.match(/\{[\s\S]*\}/);
          const parsed = match ? JSON.parse(match[0]) : {};
          // Only accept a complete response — a half-filled one would
          // show a blank recommendation in the UI.
          if (parsed.summary && parsed.recommendation && parsed.reasoning) {
            summary = parsed.summary;
            recommendation = parsed.recommendation;
            reasoning = parsed.reasoning;
            fromAi = true;
          } else {
            console.error("Gemini returned an incomplete response:", rawText);
          }
        } else {
          console.error("Gemini error:", geminiRes.status, await geminiRes.text());
        }
      } catch (e) {
        // Includes the abort from the time budget — either way, the
        // rule-based fallback below covers it.
        console.error("Gemini call failed or timed out:", e);
      } finally {
        clearTimeout(timeoutId);
      }
    }

    // Fallback if AI is unavailable (quota exhausted, no key, etc.) — the
    // hard numbers and rule-based recommendation still work without it.
    if (!summary) {
      summary = `${member.name}: ${present} present, ${absent} absent, ${excused} excused this month (target: ${proratedMin}+ present).`;
      recommendation = absent >= 4 ? "Suspension already triggered" : absent >= 3 ? "Formal warning already triggered" : currentStreak >= 2 ? "Formal warning already triggered" : stats.metMinimum ? "No action needed" : "Informal check-in recommended";
      reasoning = "Rule-based fallback (AI summary unavailable right now).";
    }

    // Only genuine AI output gets cached — never the rule-based
    // fallback, so a temporary Gemini hiccup can't get frozen in as
    // "the summary" until the stats next change.
    if (fromAi) {
      const { error: cacheErr } = await supabase.from("attendance_ai_cache").upsert(
        { member_id: memberId, month: thisMonth, stats_key: statsKey, summary, recommendation, reasoning, created_at: new Date().toISOString() },
        { onConflict: "member_id,month" }
      );
      if (cacheErr) console.error("Cache write failed:", cacheErr.message);
    }

    return new Response(
      JSON.stringify({ stats, summary, recommendation, reasoning }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: CORS_HEADERS });
  }
});
