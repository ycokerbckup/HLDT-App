import React, { useState, useEffect, useCallback } from "react";
import {
  LayoutDashboard, Users, GraduationCap, Wrench, CalendarDays,
  Wallet, MessageSquare, Plus, X, ChevronRight, Shield, User,
  CheckCircle2, Clock, Trash2, Save, LogOut, RefreshCw, Download
} from "lucide-react";
import { supabase } from "./supabaseClient";

const COLORS = {
  bg: "#14171C",
  surface1: "#1C2027",
  surface2: "#242933",
  border: "#2E3440",
  borderStrong: "#3A4150",
  textPrimary: "#EDEEF2",
  textSecondary: "#9AA2B1",
  textMuted: "#656D7C",
  amber: "#E8A33D",
  amberDim: "#4A3A1F",
  green: "#3DDC97",
  greenDim: "#173A2C",
  red: "#E5484D",
  redDim: "#3D1E20",
};

const UNITS = ["Admin", "Welfare", "Technical", "Operations"];
const TIERS = ["Trainee", "Member", "Leader", "HOD"];
const RATING_WORDS = ["Poor", "Average", "Good", "Very good"];
const TICKET_STATUSES = ["Open", "Assigned", "In progress", "Resolved"];
const SYSTEMS = ["proPresenter", "vmix", "resolume", "monitors", "screens", "network"];
const MONTHS = () => {
  const out = [];
  const d = new Date();
  for (let i = -2; i <= 2; i++) {
    const dt = new Date(d.getFullYear(), d.getMonth() + i, 1);
    out.push(dt.toISOString().slice(0, 7));
  }
  return out;
};

const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  background: COLORS.surface2,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 6,
  color: COLORS.textPrimary,
  padding: "8px 10px",
  fontSize: 13,
  fontFamily: "inherit",
};

/* ---------------- shared UI ---------------- */

function StatusDot({ tone }) {
  const map = { green: COLORS.green, amber: COLORS.amber, red: COLORS.red, gray: COLORS.textMuted };
  return <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 999, background: map[tone] || map.gray, marginRight: 6, flexShrink: 0 }} />;
}

function Badge({ children, tone = "gray" }) {
  const bgMap = { green: COLORS.greenDim, amber: COLORS.amberDim, red: COLORS.redDim, gray: COLORS.surface2 };
  const fgMap = { green: COLORS.green, amber: COLORS.amber, red: COLORS.red, gray: COLORS.textSecondary };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.03em", textTransform: "uppercase", padding: "3px 8px", borderRadius: 4, background: bgMap[tone], color: fgMap[tone] }}>
      {children}
    </span>
  );
}

function Panel({ title, right, children, style }) {
  return (
    <div style={{ background: COLORS.surface1, border: `1px solid ${COLORS.border}`, borderRadius: 8, overflow: "hidden", ...style }}>
      {title && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: `1px solid ${COLORS.border}`, background: COLORS.surface2 }}>
          <h3 style={{ margin: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600, fontSize: 15, letterSpacing: "0.02em", textTransform: "uppercase", color: COLORS.textPrimary }}>{title}</h3>
          {right}
        </div>
      )}
      <div style={{ padding: 16 }}>{children}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 4 }}>{label}</div>
      {children}
    </label>
  );
}

function Btn({ children, onClick, tone = "default", small, type = "button", disabled }) {
  const toneStyles = {
    default: { background: COLORS.surface2, color: COLORS.textPrimary, border: `1px solid ${COLORS.borderStrong}` },
    amber: { background: COLORS.amber, color: "#14171C", border: `1px solid ${COLORS.amber}` },
    ghost: { background: "transparent", color: COLORS.textSecondary, border: `1px solid ${COLORS.border}` },
    danger: { background: "transparent", color: COLORS.red, border: `1px solid ${COLORS.redDim}` },
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{ ...toneStyles[tone], borderRadius: 6, padding: small ? "5px 10px" : "8px 14px", fontSize: small ? 12 : 13, fontWeight: 500, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, display: "inline-flex", alignItems: "center", gap: 6 }}>
      {children}
    </button>
  );
}

function SectionHeader({ title, subtitle, right }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 18 }}>
      <div>
        <h2 style={{ margin: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600, fontSize: 26, letterSpacing: "0.01em" }}>{title}</h2>
        {subtitle && <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 2 }}>{subtitle}</div>}
      </div>
      {right}
    </div>
  );
}

function EmptyRow({ text }) {
  return <div style={{ fontSize: 12, color: COLORS.textMuted, padding: "8px 0" }}>{text}</div>;
}

function RowLine({ children, onClick }) {
  return (
    <div onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 4px", borderBottom: `1px solid ${COLORS.border}`, fontSize: 13, cursor: onClick ? "pointer" : "default" }}>
      {children}
    </div>
  );
}

function Metric({ label, value, tone }) {
  return (
    <div style={{ background: COLORS.surface2, borderRadius: 8, padding: "14px 16px", flex: 1, minWidth: 120 }}>
      <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600, fontSize: 28, color: tone === "amber" ? COLORS.amber : tone === "red" ? COLORS.red : COLORS.textPrimary }}>{value}</div>
    </div>
  );
}

/* ---------------- auth screen ---------------- */

function AuthScreen() {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    } else if (mode === "signup") {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      });
      if (error) setError(error.message);
      else setNotice("Account created. Check your email to confirm, then sign in.");
    } else if (mode === "forgot") {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      if (error) setError(error.message);
      else setNotice("If that email has an account, a reset link is on its way. Check your inbox.");
    }
    setBusy(false);
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: COLORS.bg }}>
      <div style={{ width: 340, background: COLORS.surface1, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: 24 }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600, fontSize: 20, color: COLORS.textPrimary, marginBottom: 2 }}>DISPLAY TEAM</div>
        <div style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: "'IBM Plex Mono', monospace", marginBottom: 20 }}>OPS CONSOLE</div>

        <form onSubmit={submit}>
          {mode === "signup" && (
            <Field label="Full name">
              <input style={inputStyle} value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </Field>
          )}
          <Field label="Email">
            <input type="email" style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          {mode !== "forgot" && (
            <Field label="Password">
              <input type="password" style={inputStyle} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
            </Field>
          )}
          {error && <div style={{ fontSize: 12, color: COLORS.red, marginBottom: 10 }}>{error}</div>}
          {notice && <div style={{ fontSize: 12, color: COLORS.green, marginBottom: 10 }}>{notice}</div>}
          <Btn tone="amber" type="submit" disabled={busy}>
            {busy ? "Working..." : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}
          </Btn>
        </form>

        <div style={{ marginTop: 16, fontSize: 12, color: COLORS.textMuted, display: "flex", flexDirection: "column", gap: 6 }}>
          {mode === "signin" && (
            <>
              <div>New here? <span style={{ color: COLORS.amber, cursor: "pointer" }} onClick={() => { setMode("signup"); setError(""); setNotice(""); }}>Create an account</span></div>
              <div>Forgot your password? <span style={{ color: COLORS.amber, cursor: "pointer" }} onClick={() => { setMode("forgot"); setError(""); setNotice(""); }}>Reset it</span></div>
            </>
          )}
          {mode === "signup" && (
            <div>Already have an account? <span style={{ color: COLORS.amber, cursor: "pointer" }} onClick={() => { setMode("signin"); setError(""); setNotice(""); }}>Sign in</span></div>
          )}
          {mode === "forgot" && (
            <div>Remembered it? <span style={{ color: COLORS.amber, cursor: "pointer" }} onClick={() => { setMode("signin"); setError(""); setNotice(""); }}>Back to sign in</span></div>
          )}
        </div>
        {mode === "signup" && (
          <div style={{ marginTop: 10, fontSize: 11, color: COLORS.textMuted }}>
            New accounts start as members. An existing admin has to promote you from the Members tab.
          </div>
        )}
      </div>
    </div>
  );
}

function ResetPasswordScreen() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) setError(error.message);
    else setDone(true);
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: COLORS.bg }}>
      <div style={{ width: 340, background: COLORS.surface1, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: 24 }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600, fontSize: 20, color: COLORS.textPrimary, marginBottom: 20 }}>Set a new password</div>
        {done ? (
          <>
            <div style={{ fontSize: 12, color: COLORS.green, marginBottom: 14 }}>Password updated. You can sign in with it now.</div>
            <Btn tone="amber" onClick={() => { supabase.auth.signOut(); window.location.href = window.location.origin; }}>Go to sign in</Btn>
          </>
        ) : (
          <form onSubmit={submit}>
            <Field label="New password">
              <input type="password" style={inputStyle} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
            </Field>
            <Field label="Confirm new password">
              <input type="password" style={inputStyle} value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={6} />
            </Field>
            {error && <div style={{ fontSize: 12, color: COLORS.red, marginBottom: 10 }}>{error}</div>}
            <Btn tone="amber" type="submit" disabled={busy}>{busy ? "Saving..." : "Update password"}</Btn>
          </form>
        )}
      </div>
    </div>
  );
}

/* ---------------- root app ---------------- */

export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [recoveryMode, setRecoveryMode] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      setSession(sess);
      if (event === "PASSWORD_RECOVERY") setRecoveryMode(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    supabase.from("profiles").select("*").eq("id", session.user.id).single().then(({ data, error }) => {
      if (!cancelled && !error) setProfile(data);
    });
    return () => { cancelled = true; };
  }, [session]);

  if (authLoading) {
    return <div style={{ minHeight: "100vh", background: COLORS.bg, color: COLORS.textMuted, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, sans-serif", fontSize: 13 }}>Loading...</div>;
  }

  if (recoveryMode) return <ResetPasswordScreen />;

  if (!session) return <AuthScreen />;

  if (!profile) {
    return <div style={{ minHeight: "100vh", background: COLORS.bg, color: COLORS.textMuted, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, sans-serif", fontSize: 13 }}>Setting up your profile...</div>;
  }

  return <Dashboard_Shell session={session} profile={profile} setProfile={setProfile} />;
}

/* ---------------- authenticated shell ---------------- */

function Dashboard_Shell({ session, profile, setProfile }) {
  const [tab, setTab] = useState("dashboard");
  const [data, setData] = useState({ members: [], onboarding: [], tickets: [], feedback: [] });
  const [loaded, setLoaded] = useState(false);
  const isAdmin = profile.role === "admin";

  const load = useCallback(async () => {
    const membersPromise = isAdmin
      ? supabase.from("members").select("*").order("name")
      : supabase.from("members_directory").select("*").order("name");

    const [membersRes, onboardingRes, historyRes, ticketsRes, feedbackRes] = await Promise.all([
      membersPromise,
      supabase.from("onboarding").select("*").order("start_date", { ascending: false }),
      supabase.from("onboarding_history").select("*").order("changed_at", { ascending: true }),
      supabase.from("tickets").select("*").order("created_at", { ascending: false }),
      supabase.from("feedback").select("*").order("created_at", { ascending: false }),
    ]);

    let ownMemberRow = null;
    if (!isAdmin) {
      const { data: own } = await supabase.from("members").select("*").eq("profile_id", session.user.id).maybeSingle();
      ownMemberRow = own;
    }

    const historyByOnboarding = {};
    (historyRes.data || []).forEach((h) => {
      if (!historyByOnboarding[h.onboarding_id]) historyByOnboarding[h.onboarding_id] = [];
      historyByOnboarding[h.onboarding_id].push({
        field: h.field, newValue: h.new_value, admin: h.changed_by_name || "Admin", timestamp: h.changed_at,
      });
    });

    setData({
      members: (membersRes.data || []).map((m) => {
        const isSelf = ownMemberRow && m.id === ownMemberRow.id;
        const source = isSelf ? ownMemberRow : m;
        return {
          id: m.id, name: m.name, email: m.email, phone: m.phone, unit: m.unit, tier: m.tier,
          team: m.team, joinDate: m.join_date, skills: source.skills || {}, dues: source.dues || {},
          profileId: m.profile_id,
        };
      }),
      onboarding: (onboardingRes.data || []).map((o) => ({
        id: o.id, memberId: o.member_id, name: o.name, startDate: o.start_date,
        weeks: o.weeks || [false, false, false, false], scores: o.scores || {},
        status: o.status, history: historyByOnboarding[o.id] || [],
      })),
      tickets: (ticketsRes.data || []).map((t) => ({
        id: t.id, reporter: t.reporter, date: t.ticket_date, systems: t.systems || {},
        description: t.description, status: t.status, assignedTo: t.assigned_to, createdAt: t.created_at,
      })),
      feedback: (feedbackRes.data || []).map((f) => ({
        id: f.id, name: f.name, engagement: f.engagement, impact: f.impact, atmosphere: f.atmosphere,
        suggestions: f.suggestions, complaints: f.complaints, requests: f.requests, timestamp: f.created_at,
      })),
    });
    setLoaded(true);
  }, [isAdmin, session.user.id]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("displayteam-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "members" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "onboarding" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "onboarding_history" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "feedback" }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [load]);

  const myMember = data.members.find((m) => m.profileId === session.user.id) || null;
  const myOnboarding = myMember ? data.onboarding.find((o) => o.memberId === myMember.id) || null : null;

  async function exportAllData() {
    const [m, o, h, t, f] = await Promise.all([
      supabase.from("members").select("*"),
      supabase.from("onboarding").select("*"),
      supabase.from("onboarding_history").select("*"),
      supabase.from("tickets").select("*"),
      supabase.from("feedback").select("*"),
    ]);
    const payload = {
      exported_at: new Date().toISOString(),
      members: m.data, onboarding: o.data, onboarding_history: h.data, tickets: t.data, feedback: f.data,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `display-team-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const nav = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "members", label: "Members", icon: Users },
    { id: "onboarding", label: "Onboarding", icon: GraduationCap },
    { id: "equipment", label: "Equipment", icon: Wrench },
    { id: "roster", label: "Roster", icon: CalendarDays },
    { id: "dues", label: "Dues", icon: Wallet },
    { id: "feedback", label: "Feedback", icon: MessageSquare },
  ];

  return (
    <div style={{ minHeight: "100vh", background: COLORS.bg, color: COLORS.textPrimary, fontFamily: "'Inter', sans-serif", display: "flex" }}>
      <div style={{ width: 190, flexShrink: 0, background: COLORS.surface1, borderRight: `1px solid ${COLORS.border}`, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "18px 16px 14px", borderBottom: `1px solid ${COLORS.border}` }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600, fontSize: 19, letterSpacing: "0.02em", lineHeight: 1.1 }}>DISPLAY TEAM</div>
          <div style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: "'IBM Plex Mono', monospace", marginTop: 4 }}>OPS CONSOLE</div>
        </div>

        <div style={{ flex: 1, padding: "10px 8px" }}>
          {nav.map((n) => {
            const Icon = n.icon;
            const active = tab === n.id;
            return (
              <div key={n.id} onClick={() => setTab(n.id)} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", marginBottom: 2, borderRadius: 6, cursor: "pointer", fontSize: 13, color: active ? COLORS.textPrimary : COLORS.textSecondary, background: active ? COLORS.surface2 : "transparent", borderLeft: active ? `2px solid ${COLORS.amber}` : "2px solid transparent" }}>
                <Icon size={15} strokeWidth={1.8} />
                {n.label}
              </div>
            );
          })}
        </div>

        <div style={{ padding: 12, borderTop: `1px solid ${COLORS.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            {isAdmin ? <Shield size={13} color={COLORS.amber} /> : <User size={13} color={COLORS.textMuted} />}
            <div style={{ fontSize: 12, color: COLORS.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {profile.full_name || session.user.email}
            </div>
          </div>
          <Badge tone={isAdmin ? "amber" : "gray"}>{profile.role}</Badge>
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            {isAdmin && <Btn small tone="ghost" onClick={exportAllData}><Download size={12} /> Export data</Btn>}
            <Btn small tone="ghost" onClick={() => supabase.auth.signOut()}><LogOut size={12} /> Sign out</Btn>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, padding: 24, minWidth: 0, overflowY: "auto" }}>
        {!loaded ? (
          <div style={{ color: COLORS.textMuted, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}><RefreshCw size={14} /> Loading data...</div>
        ) : (
          <>
            {tab === "dashboard" && <DashboardTab data={data} setTab={setTab} isAdmin={isAdmin} myMember={myMember} myOnboarding={myOnboarding} />}
            {tab === "members" && <MembersTab data={data} isAdmin={isAdmin} reload={load} currentUserId={session.user.id} />}
            {tab === "onboarding" && <OnboardingTab data={data} isAdmin={isAdmin} reload={load} adminName={profile.full_name || session.user.email} />}
            {tab === "equipment" && <EquipmentTab data={data} isAdmin={isAdmin} reload={load} />}
            {tab === "roster" && <RosterTab data={data} isAdmin={isAdmin} reload={load} />}
            {tab === "dues" && <DuesTab data={data} isAdmin={isAdmin} reload={load} myMemberId={myMember?.id} />}
            {tab === "feedback" && <FeedbackTab data={data} isAdmin={isAdmin} reload={load} />}
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------- dashboard ---------------- */

function DashboardTab({ data, setTab, isAdmin, myMember, myOnboarding }) {
  const openTickets = data.tickets.filter((t) => t.status !== "Resolved");
  const inTraining = data.onboarding.filter((o) => o.status !== "Graduated");
  const readyToGraduate = data.onboarding.filter((o) => o.status === "Independently ready" || o.status === "Ready");
  const owingCount = data.members.filter((m) => Object.values(m.dues || {}).includes("owing")).length;

  return (
    <div>
      <SectionHeader title="Dashboard" subtitle="Live overview, synced in real time across all admins" />
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <Metric label="Active members" value={data.members.length} />
        {isAdmin && <Metric label="In onboarding" value={inTraining.length} tone={inTraining.length ? "amber" : undefined} />}
        <Metric label="Open tickets" value={openTickets.length} tone={openTickets.length ? "red" : undefined} />
        {isAdmin && <Metric label="Owing dues" value={owingCount} tone={owingCount ? "amber" : undefined} />}
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <Panel title="Open equipment tickets" style={{ flex: 1, minWidth: 280 }}>
          {openTickets.length === 0 ? (
            <EmptyRow text="No open tickets." />
          ) : (
            openTickets.slice(0, 6).map((t) => (
              <RowLine key={t.id} onClick={() => setTab("equipment")}>
                <StatusDot tone={t.status === "Open" ? "red" : "amber"} />
                <span style={{ flex: 1 }}>{t.description || SYSTEMS.find((s) => t.systems[s] === "Issue") || "Issue reported"}</span>
                <Badge tone={t.status === "Open" ? "red" : "amber"}>{t.status}</Badge>
              </RowLine>
            ))
          )}
        </Panel>

        {isAdmin ? (
          <Panel title="Onboarding ready for review" style={{ flex: 1, minWidth: 280 }}>
            {readyToGraduate.length === 0 ? (
              <EmptyRow text="No trainees flagged ready yet." />
            ) : (
              readyToGraduate.map((o) => (
                <RowLine key={o.id} onClick={() => setTab("onboarding")}>
                  <StatusDot tone="green" />
                  <span style={{ flex: 1 }}>{o.name}</span>
                  <Badge tone="green">{o.status}</Badge>
                </RowLine>
              ))
            )}
          </Panel>
        ) : (
          <Panel title="Your status" style={{ flex: 1, minWidth: 280 }}>
            {!myMember ? (
              <EmptyRow text="No member record is linked to your account yet — ask an admin." />
            ) : (
              <>
                <RowLine><span style={{ flex: 1 }}>Team</span><span style={{ color: COLORS.textSecondary }}>{myMember.team || "—"}</span></RowLine>
                <RowLine><span style={{ flex: 1 }}>Unit</span><span style={{ color: COLORS.textSecondary }}>{myMember.unit || "—"}</span></RowLine>
                <RowLine><span style={{ flex: 1 }}>Tier</span><span style={{ color: COLORS.textSecondary }}>{myMember.tier || "—"}</span></RowLine>
                {myOnboarding && (
                  <RowLine onClick={() => setTab("onboarding")}>
                    <span style={{ flex: 1 }}>Onboarding status</span>
                    <Badge tone={myOnboarding.status.toLowerCase().includes("ready") ? "green" : "amber"}>{myOnboarding.status}</Badge>
                  </RowLine>
                )}
              </>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}

/* ---------------- members ---------------- */

function MembersTab({ data, isAdmin, reload, currentUserId }) {
  const [showForm, setShowForm] = useState(false);
  const [showRoles, setShowRoles] = useState(false);
  const [profiles, setProfiles] = useState([]);
  const blank = () => ({ id: null, name: "", email: "", phone: "", unit: "Technical", tier: "Member", team: "A", joinDate: new Date().toISOString().slice(0, 10), skills: { proPresenter: 3, vmix: 3, resolume: 3, technical: 3 }, dues: {} });
  const [form, setForm] = useState(blank());

  async function loadProfiles() {
    const { data } = await supabase.from("profiles").select("*").order("email");
    setProfiles(data || []);
  }

  async function saveMember() {
    if (!form.name.trim()) return;
    const payload = { name: form.name, email: form.email, phone: form.phone, unit: form.unit, tier: form.tier, team: form.team, join_date: form.joinDate, skills: form.skills, dues: form.dues };
    if (form.id) await supabase.from("members").update(payload).eq("id", form.id);
    else await supabase.from("members").insert(payload);
    setShowForm(false);
    setForm(blank());
    reload();
  }

  async function removeMember(id) {
    await supabase.from("members").delete().eq("id", id);
    reload();
  }

  async function setRole(userId, role) {
    await supabase.from("profiles").update({ role }).eq("id", userId);
    loadProfiles();
  }

  return (
    <div>
      <SectionHeader
        title="Members"
        subtitle={`${data.members.length} on record`}
        right={isAdmin && (
          <div style={{ display: "flex", gap: 8 }}>
            <Btn tone="ghost" onClick={() => { setShowRoles(!showRoles); if (!showRoles) loadProfiles(); }}><Shield size={14} /> Manage admins</Btn>
            <Btn tone="amber" onClick={() => { setForm(blank()); setShowForm(true); }}><Plus size={14} /> Add member</Btn>
          </div>
        )}
      />

      {showRoles && (
        <Panel title="Account roles" style={{ marginBottom: 16 }} right={<X size={16} style={{ cursor: "pointer" }} onClick={() => setShowRoles(false)} />}>
          <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 10 }}>
            Promoting someone here gives them admin access everywhere in the app. Demoting yourself will lock you out of admin views immediately.
          </div>
          {profiles.map((p) => (
            <RowLine key={p.id}>
              <span style={{ flex: 1 }}>{p.full_name || p.email || p.id.slice(0, 8)}</span>
              <span style={{ fontSize: 11, color: COLORS.textMuted, marginRight: 10 }}>{p.email}</span>
              <Btn small tone={p.role === "admin" ? "amber" : "ghost"} onClick={() => setRole(p.id, p.role === "admin" ? "member" : "admin")}>
                {p.role === "admin" ? "Admin" : "Member"}
              </Btn>
            </RowLine>
          ))}
        </Panel>
      )}

      {showForm && (
        <Panel title="Member record" style={{ marginBottom: 16 }} right={<X size={16} style={{ cursor: "pointer" }} onClick={() => setShowForm(false)} />}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Full name"><input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Phone"><input style={inputStyle} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="Email"><input style={inputStyle} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Join date"><input type="date" style={inputStyle} value={form.joinDate || ""} onChange={(e) => setForm({ ...form, joinDate: e.target.value })} /></Field>
            <Field label="Functional unit"><select style={inputStyle} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>{UNITS.map((u) => <option key={u} value={u}>{u}</option>)}</select></Field>
            <Field label="Tier"><select style={inputStyle} value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })}>{TIERS.map((t) => <option key={t} value={t}>{t}</option>)}</select></Field>
            <Field label="Rotation team"><select style={inputStyle} value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })}><option value="A">Team A</option><option value="B">Team B</option></select></Field>
          </div>
          <div style={{ fontSize: 12, color: COLORS.textSecondary, margin: "10px 0 6px" }}>Self-reported proficiency (1-5)</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
            {["proPresenter", "vmix", "resolume", "technical"].map((k) => (
              <Field key={k} label={k}><input type="number" min={1} max={5} style={inputStyle} value={form.skills[k]} onChange={(e) => setForm({ ...form, skills: { ...form.skills, [k]: Number(e.target.value) } })} /></Field>
            ))}
          </div>
          <Btn tone="amber" onClick={saveMember}><Save size={13} /> Save member</Btn>
        </Panel>
      )}

      <Panel>
        {data.members.length === 0 ? <EmptyRow text="No members yet." /> : (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr 0.7fr 0.9fr 0.6fr", fontSize: 11, color: COLORS.textMuted, padding: "0 4px 8px", textTransform: "uppercase", letterSpacing: "0.03em" }}>
              <div>Name</div><div>Unit</div><div>Tier</div><div>Team</div><div>Account</div><div></div>
            </div>
            {data.members.map((m) => (
              <div key={m.id} style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr 0.7fr 0.9fr 0.6fr", alignItems: "center", padding: "8px 4px", borderTop: `1px solid ${COLORS.border}`, fontSize: 13 }}>
                <div>{m.name}</div>
                <div style={{ color: COLORS.textSecondary }}>{m.unit}</div>
                <div style={{ color: COLORS.textSecondary }}>{m.tier}</div>
                <div style={{ color: COLORS.textSecondary }}>{m.team}</div>
                <div>{m.profileId ? <Badge tone="green">Linked</Badge> : <Badge tone="gray">No login</Badge>}</div>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  {isAdmin && (<>
                    <ChevronRight size={14} style={{ cursor: "pointer", color: COLORS.textMuted }} onClick={() => { setForm(m); setShowForm(true); }} />
                    <Trash2 size={14} style={{ cursor: "pointer", color: COLORS.textMuted }} onClick={() => removeMember(m.id)} />
                  </>)}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

/* ---------------- onboarding ---------------- */

function OnboardingTab({ data, isAdmin, reload, adminName }) {
  const [showForm, setShowForm] = useState(false);
  const blank = () => ({ memberId: "", name: "", startDate: new Date().toISOString().slice(0, 10), weeks: [false, false, false, false], scores: { proPres: "Average", vmix: "Average", resolume: "Average", hardware: "Average", attention: "Average", responsiveness: "Average", reliability: "Average" }, status: "In training" });
  const [form, setForm] = useState(blank());

  async function addTrainee() {
    if (!form.name.trim()) return;
    await supabase.from("onboarding").insert({ member_id: form.memberId || null, name: form.name, start_date: form.startDate, weeks: form.weeks, scores: form.scores, status: form.status });
    setForm(blank());
    setShowForm(false);
    reload();
  }

  async function updateScore(record, field, value) {
    if (!isAdmin) return;
    await supabase.from("onboarding").update({ scores: { ...record.scores, [field]: value } }).eq("id", record.id);
    await supabase.from("onboarding_history").insert({ onboarding_id: record.id, field, new_value: value, changed_by: (await supabase.auth.getUser()).data.user.id, changed_by_name: adminName });
    reload();
  }

  async function toggleWeek(record, idx) {
    if (!isAdmin) return;
    const weeks = [...record.weeks];
    weeks[idx] = !weeks[idx];
    await supabase.from("onboarding").update({ weeks }).eq("id", record.id);
    reload();
  }

  async function setStatus(record, status) {
    if (!isAdmin) return;
    await supabase.from("onboarding").update({ status }).eq("id", record.id);
    await supabase.from("onboarding_history").insert({ onboarding_id: record.id, field: "status", new_value: status, changed_by: (await supabase.auth.getUser()).data.user.id, changed_by_name: adminName });
    reload();
  }

  return (
    <div>
      <SectionHeader title="Onboarding" subtitle="Week-by-week tracking. Scores are admin-only, database-enforced, and logged." right={isAdmin && <Btn tone="amber" onClick={() => setShowForm(true)}><Plus size={14} /> Add trainee</Btn>} />

      {showForm && (
        <Panel title="New trainee" style={{ marginBottom: 16 }} right={<X size={16} style={{ cursor: "pointer" }} onClick={() => setShowForm(false)} />}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Full name"><input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Start date"><input type="date" style={inputStyle} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field>
            <Field label="Link to existing member (optional)">
              <select style={inputStyle} value={form.memberId} onChange={(e) => setForm({ ...form, memberId: e.target.value })}>
                <option value="">None</option>
                {data.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
          </div>
          <Btn tone="amber" onClick={addTrainee}><Save size={13} /> Start tracking</Btn>
        </Panel>
      )}

      {data.onboarding.length === 0 ? <Panel><EmptyRow text="No trainees currently onboarding." /></Panel> : data.onboarding.map((o) => (
        <Panel key={o.id} style={{ marginBottom: 14 }} title={o.name} right={<Badge tone={o.status.toLowerCase().includes("ready") ? "green" : "amber"}>{o.status}</Badge>}>
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            {["Week 1", "Week 2", "Week 3", "Week 4"].map((w, i) => (
              <div key={w} onClick={() => toggleWeek(o, i)} style={{ flex: 1, textAlign: "center", padding: "8px 0", borderRadius: 6, fontSize: 12, cursor: isAdmin ? "pointer" : "default", background: o.weeks[i] ? COLORS.greenDim : COLORS.surface2, color: o.weeks[i] ? COLORS.green : COLORS.textMuted, border: `1px solid ${o.weeks[i] ? COLORS.green : COLORS.border}` }}>
                {w} {o.weeks[i] ? "✓" : ""}
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 10 }}>
            {Object.keys(o.scores).map((k) => (
              <Field key={k} label={k}>
                <select style={{ ...inputStyle, opacity: isAdmin ? 1 : 0.7 }} value={o.scores[k]} disabled={!isAdmin} onChange={(e) => updateScore(o, k, e.target.value)}>
                  {RATING_WORDS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </Field>
            ))}
          </div>
          {isAdmin && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: COLORS.textSecondary }}>Status:</span>
              {["In training", "Fairly ready", "Ready", "Independently ready", "Graduated"].map((s) => (
                <Btn key={s} small tone={o.status === s ? "amber" : "ghost"} onClick={() => setStatus(o, s)}>{s}</Btn>
              ))}
            </div>
          )}
          {o.history && o.history.length > 0 && (
            <details style={{ fontSize: 11, color: COLORS.textMuted }}>
              <summary style={{ cursor: "pointer" }}>Edit log ({o.history.length})</summary>
              <div style={{ marginTop: 6 }}>
                {o.history.slice().reverse().slice(0, 10).map((h, i) => (
                  <div key={i} style={{ padding: "3px 0", fontFamily: "'IBM Plex Mono', monospace" }}>
                    {new Date(h.timestamp).toLocaleString()} — {h.admin} set {h.field} to "{h.newValue}"
                  </div>
                ))}
              </div>
            </details>
          )}
        </Panel>
      ))}
    </div>
  );
}

/* ---------------- equipment ---------------- */

function EquipmentTab({ data, isAdmin, reload }) {
  const [showForm, setShowForm] = useState(false);
  const blank = () => ({ reporter: "", date: new Date().toISOString().slice(0, 10), systems: Object.fromEntries(SYSTEMS.map((s) => [s, "OK"])), description: "" });
  const [form, setForm] = useState(blank());

  async function submit() {
    if (!form.reporter.trim()) return;
    const hasIssue = Object.values(form.systems).includes("Issue");
    await supabase.from("tickets").insert({ reporter: form.reporter, ticket_date: form.date, systems: form.systems, description: form.description, status: hasIssue ? "Open" : "Resolved" });
    setForm(blank());
    setShowForm(false);
    reload();
  }

  async function updateStatus(t, status) {
    await supabase.from("tickets").update({ status }).eq("id", t.id);
    reload();
  }

  async function assign(t, name) {
    await supabase.from("tickets").update({ assigned_to: name }).eq("id", t.id);
    reload();
  }

  return (
    <div>
      <SectionHeader title="Equipment" subtitle="Pre/post-service system checks and incident tickets" right={<Btn tone="amber" onClick={() => setShowForm(true)}><Plus size={14} /> New check</Btn>} />

      {showForm && (
        <Panel title="System check" style={{ marginBottom: 16 }} right={<X size={16} style={{ cursor: "pointer" }} onClick={() => setShowForm(false)} />}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Your name"><input style={inputStyle} value={form.reporter} onChange={(e) => setForm({ ...form, reporter: e.target.value })} /></Field>
            <Field label="Date"><input type="date" style={inputStyle} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, margin: "6px 0" }}>
            {SYSTEMS.map((s) => (
              <Field key={s} label={s}>
                <select style={inputStyle} value={form.systems[s]} onChange={(e) => setForm({ ...form, systems: { ...form.systems, [s]: e.target.value } })}>
                  <option value="OK">OK</option><option value="Issue">Issue</option>
                </select>
              </Field>
            ))}
          </div>
          <Field label="Describe issue(s)"><textarea style={{ ...inputStyle, minHeight: 60 }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <Btn tone="amber" onClick={submit}><Save size={13} /> Submit</Btn>
        </Panel>
      )}

      {data.tickets.length === 0 ? <Panel><EmptyRow text="No checks logged yet." /></Panel> : data.tickets.map((t) => {
        const issues = SYSTEMS.filter((s) => t.systems[s] === "Issue");
        return (
          <Panel key={t.id} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{t.reporter} <span style={{ color: COLORS.textMuted, fontWeight: 400 }}>· {t.date}</span></div>
                {issues.length > 0 ? <div style={{ fontSize: 12, color: COLORS.red, marginTop: 2 }}>Issues: {issues.join(", ")}</div> : <div style={{ fontSize: 12, color: COLORS.green, marginTop: 2 }}>All systems OK</div>}
              </div>
              <Badge tone={t.status === "Resolved" ? "green" : t.status === "Open" ? "red" : "amber"}>{t.status}</Badge>
            </div>
            {t.description && <div style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 8 }}>{t.description}</div>}
            {isAdmin && issues.length > 0 && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {TICKET_STATUSES.map((s) => <Btn key={s} small tone={t.status === s ? "amber" : "ghost"} onClick={() => updateStatus(t, s)}>{s}</Btn>)}
                <input placeholder="Assign to..." defaultValue={t.assignedTo || ""} onBlur={(e) => assign(t, e.target.value)} style={{ ...inputStyle, width: 140, fontSize: 12, padding: "5px 8px" }} />
              </div>
            )}
          </Panel>
        );
      })}
    </div>
  );
}

/* ---------------- roster ---------------- */

function RosterTab({ data, isAdmin, reload }) {
  const teamA = data.members.filter((m) => m.team === "A");
  const teamB = data.members.filter((m) => m.team === "B");

  async function moveTeam(m) {
    if (!isAdmin) return;
    await supabase.from("members").update({ team: m.team === "A" ? "B" : "A" }).eq("id", m.id);
    reload();
  }

  const services = ["Sunday services (x4)", "Wednesday midweek", "Saturday training", "Tuesday 8PM meeting (mandatory)"];

  return (
    <div>
      <SectionHeader title="Roster" subtitle="Team A / Team B rotation. Reporting time: 1 hour before service." />
      <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
        <Panel title="Team A" style={{ flex: 1 }}>
          {teamA.length === 0 ? <EmptyRow text="No members assigned." /> : teamA.map((m) => (
            <RowLine key={m.id} onClick={isAdmin ? () => moveTeam(m) : undefined}>
              <span style={{ flex: 1 }}>{m.name}</span><span style={{ fontSize: 11, color: COLORS.textMuted }}>{m.unit}</span>
              {isAdmin && <ChevronRight size={13} style={{ color: COLORS.textMuted }} />}
            </RowLine>
          ))}
        </Panel>
        <Panel title="Team B" style={{ flex: 1 }}>
          {teamB.length === 0 ? <EmptyRow text="No members assigned." /> : teamB.map((m) => (
            <RowLine key={m.id} onClick={isAdmin ? () => moveTeam(m) : undefined}>
              <span style={{ flex: 1 }}>{m.name}</span><span style={{ fontSize: 11, color: COLORS.textMuted }}>{m.unit}</span>
              {isAdmin && <ChevronRight size={13} style={{ color: COLORS.textMuted }} />}
            </RowLine>
          ))}
        </Panel>
      </div>
      <Panel title="Weekly commitment">
        {services.map((s) => <RowLine key={s}><Clock size={13} style={{ color: COLORS.textMuted, marginRight: 4 }} />{s}</RowLine>)}
      </Panel>
    </div>
  );
}

/* ---------------- dues ---------------- */

function DuesTab({ data, isAdmin, reload, myMemberId }) {
  const months = MONTHS();
  const rate = (m) => (m.tier === "Leader" || m.tier === "HOD" ? 5500 : 3500);

  if (!isAdmin) {
    const mine = data.members.find((m) => m.id === myMemberId);
    return (
      <div>
        <SectionHeader title="Dues" subtitle="Your dues record" />
        <Panel>
          {!mine ? (
            <EmptyRow text="No member record is linked to your account yet — ask an admin." />
          ) : (
            <>
              <div style={{ fontSize: 13, marginBottom: 10, color: COLORS.textSecondary }}>{mine.name} · ₦{rate(mine)}/month</div>
              {months.map((mo) => {
                const status = (mine.dues || {})[mo] || "unset";
                const tone = status === "paid" ? "green" : status === "owing" ? "red" : status === "free" ? "amber" : "gray";
                return (
                  <RowLine key={mo}>
                    <span style={{ flex: 1 }}>{mo}</span>
                    <Badge tone={tone}>{status === "unset" ? "Not set" : status}</Badge>
                  </RowLine>
                );
              })}
            </>
          )}
        </Panel>
      </div>
    );
  }

  async function setDue(m, month, status) {
    const dues = { ...(m.dues || {}), [month]: status };
    await supabase.from("members").update({ dues }).eq("id", m.id);
    reload();
  }

  return (
    <div>
      <SectionHeader title="Dues" subtitle="Members ₦3,500 · Leaders ₦5,500. First month free after graduation." />
      <Panel>
        <div style={{ overflowX: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: `1.4fr repeat(${months.length}, 0.8fr)`, fontSize: 11, color: COLORS.textMuted, padding: "0 4px 8px", textTransform: "uppercase" }}>
            <div>Member</div>{months.map((mo) => <div key={mo} style={{ textAlign: "center" }}>{mo}</div>)}
          </div>
          {data.members.length === 0 ? <EmptyRow text="No members yet." /> : data.members.map((m) => (
            <div key={m.id} style={{ display: "grid", gridTemplateColumns: `1.4fr repeat(${months.length}, 0.8fr)`, alignItems: "center", padding: "8px 4px", borderTop: `1px solid ${COLORS.border}`, fontSize: 12 }}>
              <div>{m.name} <span style={{ color: COLORS.textMuted }}>· ₦{rate(m)}</span></div>
              {months.map((mo) => {
                const status = (m.dues || {})[mo] || "unset";
                const tone = status === "paid" ? "green" : status === "owing" ? "red" : status === "free" ? "amber" : "gray";
                return (
                  <div key={mo} style={{ textAlign: "center" }}>
                    <select disabled={!isAdmin} value={status} onChange={(e) => setDue(m, mo, e.target.value)} style={{ background: "transparent", border: "none", fontSize: 11, textAlign: "center", color: tone === "green" ? COLORS.green : tone === "red" ? COLORS.red : tone === "amber" ? COLORS.amber : COLORS.textMuted, cursor: isAdmin ? "pointer" : "default" }}>
                      <option value="unset">—</option><option value="paid">Paid</option><option value="owing">Owing</option><option value="free">Free</option>
                    </select>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

/* ---------------- feedback ---------------- */

function FeedbackTab({ data, isAdmin, reload }) {
  const [showForm, setShowForm] = useState(false);
  const blank = () => ({ name: "", engagement: 3, impact: 3, atmosphere: 3, suggestions: "", complaints: "", requests: "" });
  const [form, setForm] = useState(blank());

  async function submit() {
    await supabase.from("feedback").insert({ name: form.name, engagement: form.engagement, impact: form.impact, atmosphere: form.atmosphere, suggestions: form.suggestions, complaints: form.complaints, requests: form.requests });
    setForm(blank());
    setShowForm(false);
    reload();
  }

  return (
    <div>
      <SectionHeader title="Feedback" subtitle="Engagement, atmosphere, and welfare input" right={<Btn tone="amber" onClick={() => setShowForm(true)}><Plus size={14} /> Give feedback</Btn>} />

      {showForm && (
        <Panel title="Submit feedback" style={{ marginBottom: 16 }} right={<X size={16} style={{ cursor: "pointer" }} onClick={() => setShowForm(false)} />}>
          <Field label="Name (optional)"><input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            {[["engagement", "Engagement"], ["impact", "Department impact"], ["atmosphere", "Atmosphere"]].map(([k, label]) => (
              <Field key={k} label={`${label} (1-5)`}><input type="number" min={1} max={5} style={inputStyle} value={form[k]} onChange={(e) => setForm({ ...form, [k]: Number(e.target.value) })} /></Field>
            ))}
          </div>
          <Field label="Suggestions"><textarea style={{ ...inputStyle, minHeight: 50 }} value={form.suggestions} onChange={(e) => setForm({ ...form, suggestions: e.target.value })} /></Field>
          <Field label="Complaints"><textarea style={{ ...inputStyle, minHeight: 50 }} value={form.complaints} onChange={(e) => setForm({ ...form, complaints: e.target.value })} /></Field>
          <Field label="Requests"><textarea style={{ ...inputStyle, minHeight: 50 }} value={form.requests} onChange={(e) => setForm({ ...form, requests: e.target.value })} /></Field>
          <Btn tone="amber" onClick={submit}><Save size={13} /> Submit</Btn>
        </Panel>
      )}

      {!isAdmin ? <Panel><EmptyRow text="Feedback is only visible to admins and the Welfare unit." /></Panel> : data.feedback.length === 0 ? <Panel><EmptyRow text="No feedback submitted yet." /></Panel> : data.feedback.map((f) => (
        <Panel key={f.id} style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>{f.name || "Anonymous"}</span>
            <span style={{ fontSize: 11, color: COLORS.textMuted }}>{new Date(f.timestamp).toLocaleDateString()}</span>
          </div>
          <div style={{ display: "flex", gap: 14, fontSize: 11, color: COLORS.textSecondary, marginBottom: 8 }}>
            <span>Engagement {f.engagement}/5</span><span>Impact {f.impact}/5</span><span>Atmosphere {f.atmosphere}/5</span>
          </div>
          {f.suggestions && <div style={{ fontSize: 12, marginBottom: 4 }}><b style={{ color: COLORS.textMuted, fontWeight: 500 }}>Suggestions:</b> {f.suggestions}</div>}
          {f.complaints && <div style={{ fontSize: 12, marginBottom: 4 }}><b style={{ color: COLORS.textMuted, fontWeight: 500 }}>Complaints:</b> {f.complaints}</div>}
          {f.requests && <div style={{ fontSize: 12 }}><b style={{ color: COLORS.textMuted, fontWeight: 500 }}>Requests:</b> {f.requests}</div>}
        </Panel>
      ))}
    </div>
  );
}
