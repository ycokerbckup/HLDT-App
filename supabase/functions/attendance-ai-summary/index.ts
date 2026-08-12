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

    const now = new Date();
    const thisMonth = now.toISOString().slice(0, 7);
    const monthStart = `${thisMonth}-01`;
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().slice(0, 10);

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

    let summary = "";
    let recommendation = "";
    let reasoning = "";

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

      try {
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
          }
        );
        if (geminiRes.ok) {
          const geminiData = await geminiRes.json();
          const rawText = geminiData?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") || "{}";
          const match = rawText.match(/\{[\s\S]*\}/);
          const parsed = match ? JSON.parse(match[0]) : {};
          summary = parsed.summary || "";
          recommendation = parsed.recommendation || "";
          reasoning = parsed.reasoning || "";
        } else {
          console.error("Gemini error:", geminiRes.status, await geminiRes.text());
        }
      } catch (e) {
        console.error("Gemini call failed:", e);
      }
    }

    // Fallback if AI is unavailable (quota exhausted, no key, etc.) — the
    // hard numbers and rule-based recommendation still work without it.
    if (!summary) {
      summary = `${member.name}: ${present} present, ${absent} absent, ${excused} excused this month (target: ${proratedMin}+ present).`;
      recommendation = absent >= 4 ? "Suspension already triggered" : absent >= 3 ? "Formal warning already triggered" : currentStreak >= 2 ? "Formal warning already triggered" : stats.metMinimum ? "No action needed" : "Informal check-in recommended";
      reasoning = "Rule-based fallback (AI summary unavailable right now).";
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
