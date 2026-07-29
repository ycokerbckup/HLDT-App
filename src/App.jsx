import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  LayoutDashboard, Users, GraduationCap, Wrench, CalendarDays,
  Wallet, MessageSquare, Plus, X, ChevronRight, Shield, User,
  CheckCircle2, Clock, Trash2, Save, LogOut, RefreshCw, Download,
  Sun, Moon, Bell, Megaphone, MessageCircle, Rss, Link2, Settings, Pencil
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { supabase } from "./supabaseClient";

const DARK_COLORS = {
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

const LIGHT_COLORS = {
  bg: "#F7F7F5",
  surface1: "#FFFFFF",
  surface2: "#F1F1EE",
  border: "#E3E3DE",
  borderStrong: "#CFCFC8",
  textPrimary: "#191A1C",
  textSecondary: "#5B5D62",
  textMuted: "#8C8E92",
  amber: "#B8710A",
  amberDim: "#FBEAD2",
  green: "#158055",
  greenDim: "#E1F5EB",
  red: "#C0292E",
  redDim: "#FBE7E6",
};

const COLORS = { ...DARK_COLORS };

function applyTheme(mode) {
  Object.assign(COLORS, mode === "light" ? LIGHT_COLORS : DARK_COLORS);
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = mode;
    document.body.style.background = COLORS.bg;
  }
}

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

function monthsRange(n) {
  const out = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const dt = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(dt.toISOString().slice(0, 7));
  }
  return out;
}

function rate(m) {
  return m.tier === "Leader" || m.tier === "HOD" ? 5500 : 3500;
}

// Reads a due entry for a given month, tolerant of the old string-only
// format ("paid") as well as the current { status, amount } object shape.
function getDue(m, month) {
  const raw = (m.dues || {})[month];
  if (!raw) return { status: "unset", amount: 0 };
  if (typeof raw === "string") return { status: raw, amount: raw === "paid" ? null : 0 };
  return { status: raw.status || "unset", amount: typeof raw.amount === "number" ? raw.amount : 0 };
}

function currency(n) {
  return `₦${Math.round(n || 0).toLocaleString()}`;
}

const AVATAR_PALETTE = ["#E8A33D", "#3DDC97", "#5B9BE0", "#D4537E", "#7F77DD", "#E24B4A", "#0F6E56", "#B87A1F"];

function hashColor(id) {
  let hash = 0;
  const s = String(id || "");
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

// First-letter initials by default; if two people in the same list share a
// first letter, both fall back to their first two letters instead.
function computeAvatarLabels(people) {
  const counts = {};
  people.forEach((p) => {
    const letter = (p.name || "?").trim()[0]?.toUpperCase() || "?";
    counts[letter] = (counts[letter] || 0) + 1;
  });
  const labels = {};
  people.forEach((p) => {
    const name = (p.name || "?").trim();
    const letter = name[0]?.toUpperCase() || "?";
    labels[p.id] = counts[letter] > 1 ? name.slice(0, 2).toUpperCase() : letter;
  });
  return labels;
}

function Avatar({ label, color, size = 28 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: 999, background: color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.4, fontWeight: 600, flexShrink: 0 }}>
      {label}
    </div>
  );
}

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
  return <span className={tone === "red" ? "hldt-pulse" : undefined} style={{ display: "inline-block", width: 8, height: 8, borderRadius: 999, background: map[tone] || map.gray, marginRight: 6, flexShrink: 0 }} />;
}

function Badge({ children, tone = "gray" }) {
  const bgMap = { green: COLORS.greenDim, amber: COLORS.amberDim, red: COLORS.redDim, gray: COLORS.surface2 };
  const fgMap = { green: COLORS.green, amber: COLORS.amber, red: COLORS.red, gray: COLORS.textSecondary };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", fontSize: 11, fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.03em", textTransform: "uppercase", padding: "3px 8px", borderRadius: 4, background: bgMap[tone], color: fgMap[tone] }}>
      {children}
    </span>
  );
}

function Panel({ title, right, children, style }) {
  return (
    <div className="hldt-panel" style={{ background: COLORS.surface1, border: `1px solid ${COLORS.border}`, borderRadius: 8, overflow: "hidden", ...style }}>
      {title && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: `1px solid ${COLORS.border}`, background: COLORS.surface2 }}>
          <h3 style={{ margin: 0, fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600, fontSize: 15, letterSpacing: "0.02em", textTransform: "uppercase", color: COLORS.textPrimary }}>{title}</h3>
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
    <button className="hldt-btn" type={type} onClick={onClick} disabled={disabled} style={{ ...toneStyles[tone], borderRadius: 6, padding: small ? "5px 10px" : "8px 14px", fontSize: small ? 12 : 13, fontWeight: 500, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, display: "inline-flex", alignItems: "center", gap: 6 }}>
      {children}
    </button>
  );
}

function SectionHeader({ title, subtitle, right }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
      <div>
        <h2 style={{ margin: 0, fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600, fontSize: 26, letterSpacing: "0.01em" }}>{title}</h2>
        {subtitle && <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 2 }}>{subtitle}</div>}
      </div>
      {right}
    </div>
  );
}

function EmptyRow({ text }) {
  return <div style={{ fontSize: 12, color: COLORS.textMuted, padding: "8px 0" }}>{text}</div>;
}

function ToastStack({ toasts }) {
  return (
    <div style={{ position: "fixed", bottom: 20, right: 20, display: "flex", flexDirection: "column", gap: 8, zIndex: 1000 }}>
      {toasts.map((t) => (
        <div
          key={t.id}
          className="hldt-toast"
          style={{
            display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 8,
            background: t.type === "error" ? COLORS.redDim : COLORS.surface2,
            border: `1px solid ${t.type === "error" ? COLORS.red : COLORS.borderStrong}`,
            color: t.type === "error" ? COLORS.red : COLORS.textPrimary,
            fontSize: 13, minWidth: 200, maxWidth: 320,
          }}
        >
          {t.type === "error" ? <span style={{ fontSize: 15 }}>⚠</span> : <CheckCircle2 size={15} color={COLORS.green} />}
          {t.message}
        </div>
      ))}
    </div>
  );
}

function useToasts() {
  const [toasts, setToasts] = useState([]);
  const notify = useCallback((message, type = "success") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3200);
  }, []);
  return { toasts, notify };
}

function RowLine({ children, onClick }) {
  return (
    <div className="hldt-row" data-clickable={!!onClick} onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 4px", borderBottom: `1px solid ${COLORS.border}`, fontSize: 13, cursor: onClick ? "pointer" : "default" }}>
      {children}
    </div>
  );
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth <= 768);
  useEffect(() => {
    function handler() { setIsMobile(window.innerWidth <= 768); }
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

function useCountUp(target) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let raf;
    const start = performance.now();
    const from = display;
    const duration = 500;
    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (target - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return display;
}

function Metric({ label, value, tone, isCurrency, onClick }) {
  const animated = useCountUp(typeof value === "number" ? value : 0);
  const display = isCurrency ? currency(animated) : animated;
  return (
    <div
      onClick={onClick}
      style={{
        background: COLORS.surface2, borderRadius: 8, padding: "14px 16px", flex: 1, minWidth: 120,
        cursor: onClick ? "pointer" : "default",
        transition: "background-color 150ms ease, transform 150ms ease",
      }}
      onMouseEnter={(e) => { if (onClick) e.currentTarget.style.background = COLORS.border; }}
      onMouseLeave={(e) => { if (onClick) e.currentTarget.style.background = COLORS.surface2; }}
    >
      <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600, fontSize: isCurrency ? 22 : 28, color: tone === "amber" ? COLORS.amber : tone === "red" ? COLORS.red : tone === "green" ? COLORS.green : COLORS.textPrimary }}>{display}</div>
    </div>
  );
}

function Modal({ title, onClose, children, width = 480, footer, dismissable = true }) {
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 20 }}
      onClick={dismissable ? onClose : undefined}
    >
      <div
        className="hldt-modal"
        style={{ width, maxWidth: "100%", maxHeight: "85vh", overflowY: "auto", background: COLORS.surface1, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600, fontSize: 17, color: COLORS.textPrimary }}>{title}</h3>
          {dismissable && <X size={18} style={{ cursor: "pointer", color: COLORS.textMuted }} onClick={onClose} />}
        </div>
        {children}
        {footer && <div style={{ marginTop: 16, display: "flex", gap: 8, justifyContent: "flex-end" }}>{footer}</div>}
      </div>
    </div>
  );
}

function ThemeToggle({ mode, onToggle }) {
  const isMobile = useIsMobile();
  return (
    <button
      onClick={onToggle}
      aria-label="Toggle light/dark mode"
      style={{
        position: "fixed", top: isMobile ? 8 : 16, right: isMobile ? 8 : 16, zIndex: 1500,
        width: isMobile ? 32 : 36, height: isMobile ? 32 : 36, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center",
        background: COLORS.surface2, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, cursor: "pointer",
        transition: "transform 150ms ease, background-color 150ms ease",
      }}
    >
      {mode === "light" ? <Moon size={14} /> : <Sun size={14} />}
    </button>
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
    <div className="hldt-app" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: COLORS.bg, padding: 16 }}>
      <div className="hldt-auth-card" style={{ width: 340, maxWidth: "100%", background: COLORS.surface1, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: 24 }}>
        <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600, fontSize: 20, color: COLORS.textPrimary, marginBottom: 2 }}>DISPLAY TEAM</div>
        <div style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: "'JetBrains Mono', monospace", marginBottom: 20 }}>OPS CONSOLE</div>

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
            {busy ? (<><RefreshCw size={13} className="hldt-spin" /> Working...</>) : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}
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
    <div className="hldt-app" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: COLORS.bg, padding: 16 }}>
      <div className="hldt-auth-card" style={{ width: 340, maxWidth: "100%", background: COLORS.surface1, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: 24 }}>
        <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600, fontSize: 20, color: COLORS.textPrimary, marginBottom: 20 }}>Set a new password</div>
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
  const [themeMode, setThemeMode] = useState(() => {
    if (typeof window === "undefined") return "dark";
    const saved = localStorage.getItem("hldt-theme");
    if (saved) return saved;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  });

  applyTheme(themeMode);

  useEffect(() => {
    localStorage.setItem("hldt-theme", themeMode);
  }, [themeMode]);

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

  const toggle = <ThemeToggle mode={themeMode} onToggle={() => setThemeMode((m) => (m === "dark" ? "light" : "dark"))} />;

  let content;
  if (authLoading) {
    content = <div className="hldt-app" style={{ minHeight: "100vh", background: COLORS.bg, color: COLORS.textMuted, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, sans-serif", fontSize: 13 }}><RefreshCw size={14} className="hldt-spin" style={{ marginRight: 8 }} /> Loading...</div>;
  } else if (recoveryMode) {
    content = <ResetPasswordScreen />;
  } else if (!session) {
    content = <AuthScreen />;
  } else if (!profile) {
    content = <div className="hldt-app" style={{ minHeight: "100vh", background: COLORS.bg, color: COLORS.textMuted, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, sans-serif", fontSize: 13 }}><RefreshCw size={14} className="hldt-spin" style={{ marginRight: 8 }} /> Setting up your profile...</div>;
  } else {
    content = <Dashboard_Shell session={session} profile={profile} setProfile={setProfile} />;
  }

  return (
    <>
      {toggle}
      {content}
    </>
  );
}

/* ---------------- authenticated shell ---------------- */

function Dashboard_Shell({ session, profile, setProfile }) {
  const [tab, setTab] = useState("dashboard");
  const [data, setData] = useState({ members: [], onboarding: [], tickets: [], feedback: [], announcements: [], notifications: [], readIds: [] });
  const [loaded, setLoaded] = useState(false);
  const isAdmin = profile.role === "admin";
  const { toasts, notify } = useToasts();

  useEffect(() => {
    const name = profile.full_name?.split(" ")[0] || session.user.email.split("@")[0];
    notify(`Welcome back, ${name}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    const membersPromise = isAdmin
      ? supabase.from("members").select("*").order("name")
      : supabase.from("members_directory").select("*").order("name");

    const membersRes = await membersPromise;

    let ownMemberRow = null;
    if (!isAdmin) {
      const { data: own } = await supabase.from("members").select("*").eq("profile_id", session.user.id).maybeSingle();
      ownMemberRow = own;
    }

    const myUnitNow = isAdmin
      ? (membersRes.data || []).find((m) => m.profile_id === session.user.id)?.unit
      : ownMemberRow?.unit;
    const canManageOnboardingNow = isAdmin && myUnitNow === "Operations";

    const onboardingPromise = canManageOnboardingNow
      ? supabase.from("onboarding").select("*").order("start_date", { ascending: false })
      : supabase.from("onboarding_public").select("*").order("start_date", { ascending: false });
    const historyPromise = canManageOnboardingNow
      ? supabase.from("onboarding_history").select("*").order("changed_at", { ascending: true })
      : Promise.resolve({ data: [] });

    const [onboardingRes, historyRes, ticketsRes, feedbackRes, announcementsRes, notificationsRes, readsRes] = await Promise.all([
      onboardingPromise,
      historyPromise,
      supabase.from("tickets").select("*").order("created_at", { ascending: false }),
      supabase.from("feedback").select("*").order("created_at", { ascending: false }),
      supabase.from("announcements").select("*").order("created_at", { ascending: false }),
      supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(50),
      supabase.from("notification_reads").select("notification_id").eq("profile_id", session.user.id),
    ]);

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
          homeAddress: source.home_address, sex: source.sex, dob: source.dob, occupation: source.occupation, kymCompletedAt: source.kym_completed_at,
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
      announcements: (announcementsRes.data || []).map((a) => ({
        id: a.id, title: a.title, body: a.body, createdBy: a.created_by, createdByName: a.created_by_name, createdAt: a.created_at,
      })),
      notifications: (notificationsRes.data || []).map((n) => ({
        id: n.id, type: n.type, title: n.title, body: n.body, linkTab: n.link_tab, targetRole: n.target_role, createdAt: n.created_at,
      })),
      readIds: (readsRes.data || []).map((r) => r.notification_id),
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
      .on("postgres_changes", { event: "*", schema: "public", table: "announcements" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "notification_reads" }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [load]);

  const myMember = data.members.find((m) => m.profileId === session.user.id) || null;
  const myOnboarding = myMember ? data.onboarding.find((o) => o.memberId === myMember.id) || null : null;
  const myUnit = myMember?.unit;
  const canManageMembers = isAdmin && myUnit === "Operations";
  const canManageFeed = isAdmin && (myUnit === "Operations" || myUnit === "Technical");
  const canManageOnboarding = isAdmin && myUnit === "Operations";
  const canSeeDues = myUnit === "Welfare" || myUnit === "Operations";

  const [showKym, setShowKym] = useState(false);
  const kymPromptedRef = useRef(false);
  useEffect(() => {
    if (!loaded || !myMember || myMember.kymCompletedAt || kymPromptedRef.current) return;
    kymPromptedRef.current = true;
    const t = setTimeout(() => setShowKym(true), 3000);
    return () => clearTimeout(t);
  }, [loaded, myMember]);

  async function markNotificationRead(id) {
    if (data.readIds.includes(id)) return;
    await supabase.from("notification_reads").insert({ notification_id: id, profile_id: session.user.id });
  }

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
    { id: "announcements", label: "Announcements", icon: Megaphone },
    { id: "feed", label: "Feed", icon: Rss },
    { id: "chat", label: "Chat", icon: MessageCircle },
    { id: "members", label: "Members", icon: Users },
    { id: "onboarding", label: "Onboarding", icon: GraduationCap },
    { id: "equipment", label: "Equipment", icon: Wrench },
    { id: "roster", label: "Roster", icon: CalendarDays },
    ...(canSeeDues ? [{ id: "dues", label: "Dues", icon: Wallet }] : []),
    { id: "feedback", label: "Feedback", icon: MessageSquare },
  ];

  const isMobile = useIsMobile();
  const [showAccountMenu, setShowAccountMenu] = useState(false);

  return (
    <div className="hldt-app" style={{ minHeight: "100vh", background: COLORS.bg, color: COLORS.textPrimary, fontFamily: "'Inter', sans-serif", display: "flex", flexDirection: isMobile ? "column" : "row" }}>
      <ToastStack toasts={toasts} />
      <NotificationBell
        notifications={data.notifications}
        readIds={data.readIds}
        onRead={markNotificationRead}
        onNavigate={setTab}
      />
      {showKym && <KYMModal onClose={() => { setShowKym(false); load(); }} notify={notify} />}

      {isMobile ? (
        <>
          {/* Compact top bar: hamburger opens account menu */}
          <div style={{ position: "fixed", top: 8, left: 8, zIndex: 1500 }}>
            <button
              onClick={() => setShowAccountMenu(!showAccountMenu)}
              aria-label="Account menu"
              style={{ width: 32, height: 32, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", background: COLORS.surface2, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, cursor: "pointer" }}
            >
              {isAdmin ? <Shield size={14} color={COLORS.amber} /> : <User size={14} />}
            </button>
            {showAccountMenu && (
              <div className="hldt-modal" style={{ position: "absolute", top: 38, left: 0, width: 220, background: COLORS.surface1, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 12, color: COLORS.textPrimary, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{profile.full_name || session.user.email}</div>
                <Badge tone={isAdmin ? "amber" : "gray"}>{profile.role}</Badge>
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                  {isAdmin && <Btn small tone="ghost" onClick={() => { exportAllData(); notify("Backup downloaded"); setShowAccountMenu(false); }}><Download size={12} /> Export data</Btn>}
                  <Btn small tone="ghost" onClick={() => supabase.auth.signOut()}><LogOut size={12} /> Sign out</Btn>
                </div>
              </div>
            )}
          </div>

          <div style={{ padding: "56px 14px 70px", minWidth: 0, flex: 1, overflowY: "auto" }}>
            {!loaded ? (
              <SkeletonLoader />
            ) : (
              <div key={tab} className="hldt-tab-content">
                {tab === "dashboard" && <DashboardTab data={data} setTab={setTab} isAdmin={isAdmin} myMember={myMember} myOnboarding={myOnboarding} canSeeWelfareInfo={canSeeDues} />}
                {tab === "members" && <MembersTab data={data} isAdmin={isAdmin} canManage={canManageMembers} reload={load} currentUserId={session.user.id} notify={notify} />}
                {tab === "onboarding" && <OnboardingTab data={data} isAdmin={isAdmin} canManage={canManageOnboarding} reload={load} adminName={profile.full_name || session.user.email} notify={notify} />}
                {tab === "equipment" && <EquipmentTab data={data} isAdmin={isAdmin} reload={load} notify={notify} />}
                {tab === "roster" && <RosterTab data={data} isAdmin={isAdmin} reload={load} />}
                {tab === "dues" && (canSeeDues ? <DuesTab data={data} isAdmin={isAdmin} reload={load} myMemberId={myMember?.id} notify={notify} /> : <Panel><EmptyRow text="Dues is only visible to Welfare and Operations." /></Panel>)}
                {tab === "announcements" && <AnnouncementsTab data={data} isAdmin={isAdmin} canPost={isAdmin || myUnit === "Welfare"} reload={load} notify={notify} adminId={session.user.id} adminName={profile.full_name || session.user.email} />}
                {tab === "feed" && <FeedTab session={session} profile={profile} isAdmin={isAdmin} canManage={canManageFeed} notify={notify} />}
                {tab === "chat" && <ChatTab session={session} profile={profile} members={data.members} notify={notify} />}
                {tab === "feedback" && <FeedbackTab data={data} isAdmin={isAdmin} reload={load} notify={notify} />}
              </div>
            )}
          </div>

          {/* Bottom tab bar */}
          <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, display: "flex", overflowX: "auto", background: COLORS.surface1, borderTop: `1px solid ${COLORS.border}`, zIndex: 1400 }}>
            {nav.map((n) => {
              const Icon = n.icon;
              const active = tab === n.id;
              return (
                <div
                  key={n.id}
                  onClick={() => setTab(n.id)}
                  style={{
                    flex: "0 0 auto", minWidth: 62, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    gap: 3, padding: "8px 6px", cursor: "pointer",
                    color: active ? COLORS.amber : COLORS.textMuted,
                    borderTop: active ? `2px solid ${COLORS.amber}` : "2px solid transparent",
                  }}
                >
                  <Icon size={17} strokeWidth={1.8} />
                  <span style={{ fontSize: 9, textAlign: "center", lineHeight: 1.1 }}>{n.label}</span>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <div style={{ width: 190, flexShrink: 0, background: COLORS.surface1, borderRight: `1px solid ${COLORS.border}`, display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "18px 16px 14px", borderBottom: `1px solid ${COLORS.border}` }}>
              <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600, fontSize: 19, letterSpacing: "0.02em", lineHeight: 1.1 }}>DISPLAY TEAM</div>
              <div style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: "'JetBrains Mono', monospace", marginTop: 4 }}>OPS CONSOLE</div>
            </div>

            <div style={{ flex: 1, padding: "10px 8px" }}>
              {nav.map((n) => {
                const Icon = n.icon;
                const active = tab === n.id;
                return (
                  <div key={n.id} className="hldt-nav-item" onClick={() => setTab(n.id)} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", marginBottom: 2, borderRadius: 6, cursor: "pointer", fontSize: 13, color: active ? COLORS.textPrimary : COLORS.textSecondary, background: active ? COLORS.surface2 : "transparent", borderLeft: active ? `2px solid ${COLORS.amber}` : "2px solid transparent" }}>
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
                {isAdmin && <Btn small tone="ghost" onClick={() => { exportAllData(); notify("Backup downloaded"); }}><Download size={12} /> Export data</Btn>}
                <Btn small tone="ghost" onClick={() => supabase.auth.signOut()}><LogOut size={12} /> Sign out</Btn>
              </div>
            </div>
          </div>

          <div style={{ flex: 1, padding: 24, minWidth: 0, overflowY: "auto" }}>
            {!loaded ? (
              <SkeletonLoader />
            ) : (
              <div key={tab} className="hldt-tab-content">
                {tab === "dashboard" && <DashboardTab data={data} setTab={setTab} isAdmin={isAdmin} myMember={myMember} myOnboarding={myOnboarding} canSeeWelfareInfo={canSeeDues} />}
                {tab === "members" && <MembersTab data={data} isAdmin={isAdmin} canManage={canManageMembers} reload={load} currentUserId={session.user.id} notify={notify} />}
                {tab === "onboarding" && <OnboardingTab data={data} isAdmin={isAdmin} canManage={canManageOnboarding} reload={load} adminName={profile.full_name || session.user.email} notify={notify} />}
                {tab === "equipment" && <EquipmentTab data={data} isAdmin={isAdmin} reload={load} notify={notify} />}
                {tab === "roster" && <RosterTab data={data} isAdmin={isAdmin} reload={load} />}
                {tab === "dues" && (canSeeDues ? <DuesTab data={data} isAdmin={isAdmin} reload={load} myMemberId={myMember?.id} notify={notify} /> : <Panel><EmptyRow text="Dues is only visible to Welfare and Operations." /></Panel>)}
                {tab === "announcements" && <AnnouncementsTab data={data} isAdmin={isAdmin} canPost={isAdmin || myUnit === "Welfare"} reload={load} notify={notify} adminId={session.user.id} adminName={profile.full_name || session.user.email} />}
                {tab === "feed" && <FeedTab session={session} profile={profile} isAdmin={isAdmin} canManage={canManageFeed} notify={notify} />}
                {tab === "chat" && <ChatTab session={session} profile={profile} members={data.members} notify={notify} />}
                {tab === "feedback" && <FeedbackTab data={data} isAdmin={isAdmin} reload={load} notify={notify} />}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SkeletonBar({ width = "100%", height = 14 }) {
  return <div className="hldt-skeleton" style={{ width, height, marginBottom: 8 }} />;
}

function SkeletonLoader() {
  return (
    <div>
      <SkeletonBar width={160} height={26} />
      <div style={{ height: 10 }} />
      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ background: COLORS.surface2, borderRadius: 8, padding: "14px 16px", flex: 1, minWidth: 120 }}>
            <SkeletonBar width={70} height={10} />
            <SkeletonBar width={40} height={22} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 16 }}>
        {[0, 1].map((i) => (
          <div key={i} style={{ flex: 1, background: COLORS.surface1, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: 16 }}>
            <SkeletonBar width={140} height={16} />
            <SkeletonBar />
            <SkeletonBar />
            <SkeletonBar width="60%" />
          </div>
        ))}
      </div>
    </div>
  );
}

function NotificationBell({ notifications, readIds, onRead, onNavigate }) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const unread = notifications.filter((n) => !readIds.includes(n.id));

  function handleClick(n) {
    onRead(n.id);
    if (n.linkTab) onNavigate(n.linkTab);
    setOpen(false);
  }

  function timeAgo(ts) {
    const mins = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60000));
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  }

  return (
    <div style={{ position: "fixed", top: isMobile ? 8 : 16, right: isMobile ? 46 : 64, zIndex: 1500 }}>
      <button
        onClick={() => setOpen(!open)}
        aria-label="Notifications"
        style={{
          width: isMobile ? 32 : 36, height: isMobile ? 32 : 36, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center",
          background: COLORS.surface2, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, cursor: "pointer", position: "relative",
        }}
      >
        <Bell size={14} />
        {unread.length > 0 && (
          <span style={{ position: "absolute", top: -2, right: -2, minWidth: 15, height: 15, borderRadius: 999, background: COLORS.red, color: "#fff", fontSize: 9, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px" }}>
            {unread.length > 9 ? "9+" : unread.length}
          </span>
        )}
      </button>
      {open && (
        <div
          className="hldt-modal"
          style={{ position: "absolute", top: 40, right: 0, width: isMobile ? "calc(100vw - 32px)" : 320, maxWidth: 320, maxHeight: 400, overflowY: "auto", background: COLORS.surface1, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 8 }}
        >
          <div style={{ fontSize: 12, fontWeight: 500, color: COLORS.textSecondary, padding: "6px 8px" }}>Notifications</div>
          {notifications.length === 0 ? (
            <div style={{ padding: "16px 8px", fontSize: 12, color: COLORS.textMuted }}>Nothing yet.</div>
          ) : (
            notifications.slice(0, 20).map((n) => {
              const isUnread = !readIds.includes(n.id);
              return (
                <div
                  key={n.id}
                  onClick={() => handleClick(n)}
                  style={{
                    padding: "8px 8px", borderRadius: 6, cursor: "pointer", marginBottom: 2,
                    background: isUnread ? COLORS.surface2 : "transparent",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                    {isUnread && <span style={{ width: 6, height: 6, borderRadius: 999, background: COLORS.amber, marginTop: 5, flexShrink: 0 }} />}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, color: COLORS.textPrimary, fontWeight: isUnread ? 500 : 400 }}>{n.title}</div>
                      {n.body && <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2 }}>{n.body}</div>}
                      <div style={{ fontSize: 10, color: COLORS.textMuted, marginTop: 3, fontFamily: "'JetBrains Mono', monospace" }}>{timeAgo(n.createdAt)}</div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------- announcements ---------------- */

function AnnouncementsTab({ data, isAdmin, canPost, reload, notify, adminId, adminName }) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const blank = () => ({ title: "", body: "" });
  const [form, setForm] = useState(blank());

  function withinEditWindow(a) {
    return Date.now() - new Date(a.createdAt).getTime() < 30 * 60 * 1000;
  }

  async function submit() {
    if (!form.title.trim() || !form.body.trim()) return;
    if (editingId) {
      const { error } = await supabase.from("announcements").update({ title: form.title, body: form.body }).eq("id", editingId);
      if (error) { notify?.(error.message, "error"); return; }
      notify?.("Announcement updated");
    } else {
      const { error } = await supabase.from("announcements").insert({ title: form.title, body: form.body, created_by: adminId, created_by_name: adminName });
      if (error) { notify?.(error.message, "error"); return; }
      notify?.("Announcement posted");
    }
    setForm(blank());
    setEditingId(null);
    setShowForm(false);
    reload();
  }

  async function remove(id) {
    const { error } = await supabase.from("announcements").delete().eq("id", id);
    if (error) { notify?.(error.message, "error"); return; }
    notify?.("Announcement deleted");
    reload();
  }

  function startEdit(a) {
    setForm({ title: a.title, body: a.body });
    setEditingId(a.id);
    setShowForm(true);
  }

  function timeLeft(a) {
    const msLeft = 30 * 60 * 1000 - (Date.now() - new Date(a.createdAt).getTime());
    if (msLeft <= 0) return null;
    return `${Math.ceil(msLeft / 60000)}m left to edit`;
  }

  return (
    <div>
      <SectionHeader
        title="Announcements"
        subtitle="Auto-removed after 7 days. Editable for 30 minutes after posting."
        right={canPost && <Btn tone="amber" onClick={() => { setForm(blank()); setEditingId(null); setShowForm(true); }}><Plus size={14} /> New announcement</Btn>}
      />

      {showForm && (
        <Panel title={editingId ? "Edit announcement" : "New announcement"} style={{ marginBottom: 16 }} right={<X size={16} style={{ cursor: "pointer" }} onClick={() => setShowForm(false)} />}>
          <Field label="Title">
            <input style={inputStyle} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="Message">
            <textarea style={{ ...inputStyle, minHeight: 80 }} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          </Field>
          <Btn tone="amber" onClick={submit}><Save size={13} /> {editingId ? "Save changes" : "Post announcement"}</Btn>
        </Panel>
      )}

      {data.announcements.length === 0 ? (
        <Panel><EmptyRow text="No announcements yet." /></Panel>
      ) : (
        data.announcements.map((a) => (
          <Panel key={a.id} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
              <div style={{ fontSize: 15, fontWeight: 500, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{a.title}</div>
              {(canPost || isAdmin) && (
                <div style={{ display: "flex", gap: 10, flexShrink: 0, marginLeft: 10 }}>
                  {canPost && withinEditWindow(a) && <ChevronRight size={14} style={{ cursor: "pointer", color: COLORS.textMuted }} onClick={() => startEdit(a)} />}
                  {isAdmin && <Trash2 size={14} style={{ cursor: "pointer", color: COLORS.textMuted }} onClick={() => remove(a.id)} />}
                </div>
              )}
            </div>
            <div style={{ fontSize: 13, color: COLORS.textSecondary, whiteSpace: "pre-wrap", marginBottom: 8 }}>{a.body}</div>
            <div style={{ fontSize: 11, color: COLORS.textMuted, display: "flex", gap: 10 }}>
              <span>{a.createdByName || "Admin"} · {new Date(a.createdAt).toLocaleString()}</span>
              {canPost && withinEditWindow(a) && <span style={{ color: COLORS.amber }}>{timeLeft(a)}</span>}
            </div>
          </Panel>
        ))
      )}
    </div>
  );
}

/* ---------------- chat ---------------- */

function ChatTab({ session, profile, members, notify }) {
  const isMobile = useIsMobile();
  const [mobileShowThread, setMobileShowThread] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [thread, setThread] = useState({ type: "team" });
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState("");
  const [showNewDm, setShowNewDm] = useState(false);
  const bottomRef = useRef(null);

  const dmCandidates = members.filter((m) => m.profileId && m.profileId !== session.user.id);

  const avatarLabels = useMemo(() => {
    const people = [{ id: session.user.id, name: "You" }, ...dmCandidates.map((m) => ({ id: m.profileId, name: m.name }))];
    return computeAvatarLabels(people);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members]);

  async function loadConversations() {
    const { data } = await supabase.from("conversations").select("*").or(`user_a.eq.${session.user.id},user_b.eq.${session.user.id}`);
    setConversations(data || []);
  }

  useEffect(() => { loadConversations(); }, []);

  const loadMessages = useCallback(async () => {
    let query = supabase.from("messages").select("*").order("created_at", { ascending: true });
    query = thread.type === "team" ? query.is("conversation_id", null) : query.eq("conversation_id", thread.conversationId);
    const { data } = await query;
    setMessages(data || []);
    (data || []).filter((m) => m.sender_id !== session.user.id && !m.seen_at).forEach((m) => {
      supabase.rpc("mark_message_seen", { msg_id: m.id });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.type, thread.conversationId]);

  useEffect(() => {
    loadMessages();
    const channel = supabase
      .channel(`chat-${thread.type}-${thread.conversationId || "team"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, loadMessages)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    if (!text.trim()) return;
    const payload = {
      sender_id: session.user.id,
      sender_name: profile.full_name || session.user.email,
      body: text.trim(),
      conversation_id: thread.type === "dm" ? thread.conversationId : null,
    };
    const { error } = await supabase.from("messages").insert(payload);
    if (error) { notify?.(error.message, "error"); return; }
    setText("");
  }

  function startEdit(m) {
    setEditingId(m.id);
    setEditText(m.body);
  }

  async function saveEdit(m) {
    const { error } = await supabase.from("messages").update({ body: editText, edited_at: new Date().toISOString() }).eq("id", m.id);
    if (error) { notify?.(error.message, "error"); return; }
    setEditingId(null);
    loadMessages();
  }

  async function startDm(member) {
    const a = session.user.id < member.profileId ? session.user.id : member.profileId;
    const b = session.user.id < member.profileId ? member.profileId : session.user.id;
    let existing = null;
    const { data: found } = await supabase.from("conversations").select("*").eq("user_a", a).eq("user_b", b).maybeSingle();
    existing = found;
    if (!existing) {
      const { data: created, error } = await supabase.from("conversations").insert({ user_a: a, user_b: b }).select().single();
      if (error) { notify?.(error.message, "error"); return; }
      existing = created;
      loadConversations();
    }
    setThread({ type: "dm", conversationId: existing.id, otherName: member.name });
    setShowNewDm(false);
  }

  function withinEditWindow(m) {
    return Date.now() - new Date(m.created_at).getTime() < 30 * 60 * 1000;
  }

  return (
    <div>
      <SectionHeader title="Chat" subtitle="Messages are removed 24 hours after being seen. Editable for 30 minutes after sending." />
      <div style={{ display: "flex", gap: 16, height: isMobile ? "calc(100vh - 200px)" : "65vh" }}>
        {(!isMobile || !mobileShowThread) && (
          <div style={{ width: isMobile ? "100%" : 210, flexShrink: 0, display: "flex", flexDirection: "column", gap: 4, overflowY: "auto" }}>
            <div
              className="hldt-row" data-clickable="true"
              onClick={() => { setThread({ type: "team" }); setMobileShowThread(true); }}
              style={{ padding: "8px 10px", borderRadius: 6, cursor: "pointer", background: thread.type === "team" ? COLORS.surface2 : "transparent", fontSize: 13 }}
            >
              # Team channel
            </div>
            <div style={{ fontSize: 11, color: COLORS.textMuted, textTransform: "uppercase", padding: "10px 10px 4px" }}>Direct messages</div>
            {conversations.map((c) => {
              const otherId = c.user_a === session.user.id ? c.user_b : c.user_a;
              const otherMember = dmCandidates.find((m) => m.profileId === otherId);
              return (
                <div
                  key={c.id}
                  className="hldt-row" data-clickable="true"
                  onClick={() => { setThread({ type: "dm", conversationId: c.id, otherName: otherMember?.name || "Member" }); setMobileShowThread(true); }}
                  style={{ padding: "8px 10px", borderRadius: 6, cursor: "pointer", background: thread.type === "dm" && thread.conversationId === c.id ? COLORS.surface2 : "transparent", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}
                >
                  <Avatar label={avatarLabels[otherId] || "?"} color={hashColor(otherId)} size={22} />
                  {otherMember?.name || "Member"}
                </div>
              );
            })}
            <Btn small tone="ghost" onClick={() => setShowNewDm(true)}><Plus size={12} /> New DM</Btn>
          </div>
        )}

        {(!isMobile || mobileShowThread) && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", border: `1px solid ${COLORS.border}`, borderRadius: 8, background: COLORS.surface1, minWidth: 0 }}>
          <div style={{ padding: "10px 16px", borderBottom: `1px solid ${COLORS.border}`, fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 8 }}>
            {isMobile && (
              <button onClick={() => setMobileShowThread(false)} aria-label="Back" style={{ background: "transparent", border: "none", cursor: "pointer", color: COLORS.textMuted, padding: 0, display: "flex" }}>
                <ChevronRight size={16} style={{ transform: "rotate(180deg)" }} />
              </button>
            )}
            {thread.type === "team" ? "Team channel" : thread.otherName}
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            {messages.length === 0 ? (
              <EmptyRow text="No messages yet." />
            ) : (
              messages.map((m) => {
                const mine = m.sender_id === session.user.id;
                return (
                  <div key={m.id} style={{ display: "flex", gap: 8, flexDirection: mine ? "row-reverse" : "row" }}>
                    <Avatar label={avatarLabels[m.sender_id] || m.sender_name?.[0] || "?"} color={hashColor(m.sender_id)} size={26} />
                    <div style={{ maxWidth: "70%" }}>
                      {!mine && <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 2 }}>{m.sender_name}</div>}
                      {editingId === m.id ? (
                        <div style={{ display: "flex", gap: 6 }}>
                          <input style={{ ...inputStyle, fontSize: 12 }} value={editText} onChange={(e) => setEditText(e.target.value)} />
                          <Btn small tone="amber" onClick={() => saveEdit(m)}>Save</Btn>
                          <Btn small tone="ghost" onClick={() => setEditingId(null)}>Cancel</Btn>
                        </div>
                      ) : (
                        <div style={{ display: "flex", alignItems: "flex-end", gap: 4, flexDirection: mine ? "row-reverse" : "row" }}>
                          <div
                            style={{
                              background: mine ? COLORS.amberDim : COLORS.surface2, color: mine ? COLORS.amber : COLORS.textPrimary,
                              padding: "8px 12px", borderRadius: 10, fontSize: 13,
                            }}
                          >
                            {m.body}
                            {m.edited_at && <span style={{ fontSize: 10, opacity: 0.6, marginLeft: 6 }}>(edited)</span>}
                          </div>
                          {mine && withinEditWindow(m) && (
                            <button
                              onClick={() => startEdit(m)}
                              aria-label="Edit message"
                              style={{ background: "transparent", border: "none", cursor: "pointer", color: COLORS.textMuted, padding: 4, display: "flex" }}
                            >
                              <Pencil size={12} />
                            </button>
                          )}
                        </div>
                      )}
                      <div style={{ fontSize: 10, color: COLORS.textMuted, marginTop: 2 }}>
                        {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>
          <div style={{ padding: 12, borderTop: `1px solid ${COLORS.border}`, display: "flex", gap: 8 }}>
            <input style={{ ...inputStyle, flex: 1 }} placeholder="Type a message..." value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
            <Btn tone="amber" onClick={send}>Send</Btn>
          </div>
        </div>
        )}
      </div>

      {showNewDm && (
        <Modal title="Start a conversation" onClose={() => setShowNewDm(false)} width={320}>
          {dmCandidates.length === 0 ? (
            <EmptyRow text="No other members with accounts yet." />
          ) : (
            dmCandidates.map((m) => (
              <RowLine key={m.id} onClick={() => startDm(m)}>
                <Avatar label={avatarLabels[m.profileId] || "?"} color={hashColor(m.profileId)} size={22} />
                <span style={{ marginLeft: 8 }}>{m.name}</span>
              </RowLine>
            ))
          )}
        </Modal>
      )}
    </div>
  );
}

/* ---------------- feed ---------------- */

function extractYoutubeThumb(url) {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{6,})/);
  return m ? `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg` : null;
}

function ManageSourcesModal({ sources, onClose, reload, notify }) {
  const [channelId, setChannelId] = useState("");
  const [channelName, setChannelName] = useState("");

  async function addSource() {
    if (!channelId.trim()) return;
    const { error } = await supabase.from("feed_sources").insert({ channel_id: channelId.trim(), channel_name: channelName.trim() || null });
    if (error) { notify?.(error.message, "error"); return; }
    notify?.("Source added — new videos appear on the next sync");
    setChannelId("");
    setChannelName("");
    reload();
  }

  async function removeSource(id) {
    await supabase.from("feed_sources").delete().eq("id", id);
    reload();
  }

  return (
    <Modal title="YouTube sources" onClose={onClose} width={440}>
      <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 14 }}>
        New videos from these channels are pulled in automatically once a day. To find a channel ID: open the channel on YouTube, view page source (Ctrl+U), and search for <code>"channelId"</code> — or search "[channel name] channel ID finder" for a free lookup tool.
      </div>
      <Field label="Channel ID (starts with UC...)">
        <input style={inputStyle} value={channelId} onChange={(e) => setChannelId(e.target.value)} placeholder="UCWQhr5G-3wwenYIB6ubdtoQ" />
      </Field>
      <Field label="Label (optional)">
        <input style={inputStyle} value={channelName} onChange={(e) => setChannelName(e.target.value)} placeholder="e.g. Resolume" />
      </Field>
      <Btn tone="amber" onClick={addSource}><Plus size={13} /> Add source</Btn>
      <div style={{ marginTop: 16, borderTop: `1px solid ${COLORS.border}`, paddingTop: 10 }}>
        {sources.length === 0 ? <EmptyRow text="No sources configured." /> : sources.map((s) => (
          <RowLine key={s.id}>
            <span style={{ flex: 1 }}>{s.channelName || s.channelId}</span>
            <Trash2 size={13} style={{ cursor: "pointer", color: COLORS.textMuted }} onClick={() => removeSource(s.id)} />
          </RowLine>
        ))}
      </div>
    </Modal>
  );
}

function FeedTab({ session, profile, isAdmin, canManage, notify }) {
  const [posts, setPosts] = useState([]);
  const [sources, setSources] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [showAddLink, setShowAddLink] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const blankLink = () => ({ title: "", url: "", description: "" });
  const [linkForm, setLinkForm] = useState(blankLink());

  async function loadPosts() {
    const { data } = await supabase.from("feed_posts").select("*").order("created_at", { ascending: false });
    setPosts((data || []).map((p) => ({
      id: p.id, source: p.source, title: p.title, url: p.url, thumbnailUrl: p.thumbnail_url,
      description: p.description, postedByName: p.posted_by_name, createdAt: p.created_at,
    })));
    setLoaded(true);
  }

  async function loadSources() {
    const { data } = await supabase.from("feed_sources").select("*").order("channel_name");
    setSources((data || []).map((s) => ({ id: s.id, channelId: s.channel_id, channelName: s.channel_name })));
  }

  useEffect(() => {
    loadPosts();
    loadSources();
    const channel = supabase
      .channel("feed-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "feed_posts" }, loadPosts)
      .on("postgres_changes", { event: "*", schema: "public", table: "feed_sources" }, loadSources)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  async function submitLink() {
    if (!linkForm.title.trim() || !linkForm.url.trim()) return;
    const thumb = extractYoutubeThumb(linkForm.url);
    const { error } = await supabase.from("feed_posts").insert({
      source: "manual", title: linkForm.title, url: linkForm.url, description: linkForm.description,
      thumbnail_url: thumb, posted_by: session.user.id, posted_by_name: profile.full_name || session.user.email,
    });
    if (error) { notify?.(error.message, "error"); return; }
    notify?.("Link shared");
    setLinkForm(blankLink());
    setShowAddLink(false);
    loadPosts();
  }

  async function removePost(id) {
    const { error } = await supabase.from("feed_posts").delete().eq("id", id);
    if (error) { notify?.(error.message, "error"); return; }
    notify?.("Post removed");
    loadPosts();
  }

  function timeAgo(ts) {
    const days = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
    if (days < 1) return "today";
    if (days === 1) return "yesterday";
    return `${days}d ago`;
  }

  return (
    <div>
      <SectionHeader
        title="Feed"
        subtitle="Educational content auto-pulled from YouTube, plus curated links. Removed 30 days after posting."
        right={canManage && (
          <div style={{ display: "flex", gap: 8 }}>
            <Btn tone="ghost" onClick={() => setShowSources(true)}><Settings size={13} /> Sources</Btn>
            <Btn tone="amber" onClick={() => setShowAddLink(true)}><Link2 size={14} /> Share a link</Btn>
          </div>
        )}
      />

      {showAddLink && (
        <Panel title="Share a link" style={{ marginBottom: 16 }} right={<X size={16} style={{ cursor: "pointer" }} onClick={() => setShowAddLink(false)} />}>
          <Field label="Title"><input style={inputStyle} value={linkForm.title} onChange={(e) => setLinkForm({ ...linkForm, title: e.target.value })} /></Field>
          <Field label="URL"><input style={inputStyle} value={linkForm.url} onChange={(e) => setLinkForm({ ...linkForm, url: e.target.value })} placeholder="https://..." /></Field>
          <Field label="Note (optional)"><textarea style={{ ...inputStyle, minHeight: 50 }} value={linkForm.description} onChange={(e) => setLinkForm({ ...linkForm, description: e.target.value })} /></Field>
          <Btn tone="amber" onClick={submitLink}><Save size={13} /> Post</Btn>
        </Panel>
      )}

      {!loaded ? (
        <SkeletonLoader />
      ) : posts.length === 0 ? (
        <Panel><EmptyRow text="Nothing in the feed yet." /></Panel>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14 }}>
          {posts.map((p) => (
            <div key={p.id} className="hldt-panel" style={{ background: COLORS.surface1, border: `1px solid ${COLORS.border}`, borderRadius: 10, overflow: "hidden" }}>
              <a href={p.url} target="_blank" rel="noopener noreferrer">
                {p.thumbnailUrl ? (
                  <img src={p.thumbnailUrl} alt="" style={{ width: "100%", height: 130, objectFit: "cover", display: "block" }} />
                ) : (
                  <div style={{ width: "100%", height: 130, background: COLORS.surface2, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Link2 size={22} color={COLORS.textMuted} />
                  </div>
                )}
              </a>
              <div style={{ padding: 12 }}>
                <a href={p.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: COLORS.textPrimary, marginBottom: 4, lineHeight: 1.3 }}>{p.title}</div>
                </a>
                {p.description && <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 6 }}>{p.description}</div>}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Badge tone={p.source === "youtube_auto" ? "gray" : "amber"}>{p.source === "youtube_auto" ? "Auto" : "Shared"}</Badge>
                  <span style={{ fontSize: 10, color: COLORS.textMuted }}>{timeAgo(p.createdAt)}</span>
                </div>
                {canManage && (
                  <div style={{ marginTop: 8, textAlign: "right" }}>
                    <Trash2 size={13} style={{ cursor: "pointer", color: COLORS.textMuted }} onClick={() => removePost(p.id)} />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showSources && <ManageSourcesModal sources={sources} onClose={() => setShowSources(false)} reload={loadSources} notify={notify} />}
    </div>
  );
}

/* ---------------- KYM (Know Your Member) ---------------- */

function KYMModal({ onClose, notify }) {
  const [phone, setPhone] = useState("");
  const [homeAddress, setHomeAddress] = useState("");
  const [sex, setSex] = useState("");
  const [dob, setDob] = useState("");
  const [occupation, setOccupation] = useState("");
  const [error, setError] = useState("");

  async function submit() {
    if (!phone.trim() || !sex || !dob.trim()) {
      setError("Phone number, sex, and date of birth are required.");
      return;
    }
    if (!/^\d{1,2}\/\d{1,2}$/.test(dob.trim())) {
      setError("Date of birth should be in dd/mm format, e.g. 14/03");
      return;
    }
    const { error: err } = await supabase.rpc("submit_kym", {
      p_phone: phone, p_home_address: homeAddress, p_sex: sex, p_dob: dob.trim(), p_occupation: occupation,
    });
    if (err) { notify?.(err.message, "error"); return; }
    notify?.("Thanks — your details are saved");
    onClose();
  }

  return (
    <Modal title="A few details about you" onClose={onClose} width={380} dismissable={false} footer={<Btn tone="amber" onClick={submit}><Save size={13} /> Save</Btn>}>
      <div style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 14 }}>
        One-time — helps the team reach you and know who's who. This is required before you can continue.
      </div>
      <Field label="Phone number *">
        <input style={inputStyle} value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      <Field label="Home address">
        <input style={inputStyle} value={homeAddress} onChange={(e) => setHomeAddress(e.target.value)} />
      </Field>
      <Field label="Sex *">
        <select style={inputStyle} value={sex} onChange={(e) => setSex(e.target.value)}>
          <option value="">Select</option>
          <option value="M">Male</option>
          <option value="F">Female</option>
        </select>
      </Field>
      <Field label="Date of birth (dd/mm) *">
        <input style={inputStyle} placeholder="14/03" value={dob} onChange={(e) => setDob(e.target.value)} />
      </Field>
      <Field label="Occupation">
        <input style={inputStyle} value={occupation} onChange={(e) => setOccupation(e.target.value)} />
      </Field>
      {error && <div style={{ fontSize: 12, color: COLORS.red }}>{error}</div>}
    </Modal>
  );
}

/* ---------------- dashboard ---------------- */

function OwingDuesModal({ data, onClose }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const owing = data.members
    .map((m) => ({ m, due: getDue(m, month) }))
    .filter((x) => x.due.status === "owing");

  return (
    <Modal title="Members owing dues" onClose={onClose} width={520}>
      <Field label="Month">
        <select style={inputStyle} value={month} onChange={(e) => setMonth(e.target.value)}>
          {monthsRange(12).map((mo) => <option key={mo} value={mo}>{mo}</option>)}
        </select>
      </Field>
      {owing.length === 0 ? (
        <EmptyRow text="No one owing for this month." />
      ) : (
        owing.map(({ m, due }) => {
          const owed = Math.max(0, rate(m) - (due.amount || 0));
          return (
            <RowLine key={m.id}>
              <span style={{ flex: 1 }}>{m.name}</span>
              <span style={{ color: COLORS.red, fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>{currency(owed)}</span>
            </RowLine>
          );
        })
      )}
    </Modal>
  );
}

function WalletPanel({ data, isAdmin }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [totalBalance, setTotalBalance] = useState(0);
  const [editingBalance, setEditingBalance] = useState(false);
  const [balanceInput, setBalanceInput] = useState("");

  async function loadBalance() {
    const { data: row } = await supabase.from("wallet_balance").select("*").eq("id", 1).maybeSingle();
    if (row) setTotalBalance(row.balance);
  }

  useEffect(() => {
    loadBalance();
    const channel = supabase
      .channel("wallet-balance-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "wallet_balance" }, loadBalance)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  async function saveBalance() {
    const value = Number(balanceInput);
    if (Number.isNaN(value)) return;
    await supabase.from("wallet_balance").update({ balance: value, updated_by: null, updated_at: new Date().toISOString() }).eq("id", 1);
    setEditingBalance(false);
  }

  function statsFor(mo) {
    let expected = 0, collected = 0;
    if (mo === "all") {
      data.members.forEach((m) => {
        Object.keys(m.dues || {}).forEach((recordedMonth) => {
          const due = getDue(m, recordedMonth);
          if (due.status !== "free") expected += rate(m);
          collected += due.amount || 0;
        });
      });
      return { expected, collected };
    }
    data.members.forEach((m) => {
      const due = getDue(m, mo);
      if (due.status !== "free") expected += rate(m);
      collected += due.amount || 0;
    });
    return { expected, collected };
  }

  const current = statsFor(month);
  const chartData = monthsRange(6).map((mo) => {
    const s = statsFor(mo);
    return { month: mo.slice(5), Expected: s.expected, Collected: s.collected };
  });

  return (
    <Panel
      title="Wallet"
      right={
        <select style={{ ...inputStyle, width: 130, padding: "5px 8px", fontSize: 12 }} value={month} onChange={(e) => setMonth(e.target.value)}>
          <option value="all">All time</option>
          {monthsRange(12).map((mo) => <option key={mo} value={mo}>{mo}</option>)}
        </select>
      }
    >
      <div style={{ display: "flex", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <div
          onClick={() => isAdmin && !editingBalance && (setBalanceInput(String(totalBalance)), setEditingBalance(true))}
          style={{ background: COLORS.surface2, borderRadius: 8, padding: "14px 16px", flex: 1, minWidth: 140, cursor: isAdmin ? "pointer" : "default" }}
        >
          <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>Total balance {isAdmin && !editingBalance && <span style={{ opacity: 0.6 }}>· click to edit</span>}</div>
          {editingBalance ? (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
              <input type="number" autoFocus style={{ ...inputStyle, width: 110, padding: "4px 8px" }} value={balanceInput} onChange={(e) => setBalanceInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveBalance()} />
              <Btn small tone="amber" onClick={saveBalance}>Save</Btn>
              <Btn small tone="ghost" onClick={() => setEditingBalance(false)}>Cancel</Btn>
            </div>
          ) : (
            <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600, fontSize: 22, color: COLORS.textPrimary }}>{currency(totalBalance)}</div>
          )}
        </div>
        <Metric label={month === "all" ? "Expected (all time)" : "Expected balance"} value={current.expected} isCurrency tone="amber" />
        <Metric label={month === "all" ? "Collected (all time)" : "Total collected"} value={current.collected} isCurrency tone="green" />
      </div>
      <div style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
            <XAxis dataKey="month" stroke={COLORS.textMuted} fontSize={11} tickLine={false} axisLine={false} />
            <YAxis stroke={COLORS.textMuted} fontSize={11} tickLine={false} axisLine={false} />
            <Tooltip
              contentStyle={{ background: COLORS.surface2, border: `1px solid ${COLORS.border}`, borderRadius: 8, fontSize: 12, color: COLORS.textPrimary }}
              labelStyle={{ color: COLORS.textSecondary }}
              formatter={(v) => currency(v)}
            />
            <Bar dataKey="Expected" fill={COLORS.amber} radius={[4, 4, 0, 0]} maxBarSize={22} />
            <Bar dataKey="Collected" fill={COLORS.green} radius={[4, 4, 0, 0]} maxBarSize={22} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {month !== "all" && <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 8 }}>Chart always shows the last 6 months, regardless of the filter above.</div>}
    </Panel>
  );
}

function DashboardTab({ data, setTab, isAdmin, myMember, myOnboarding, canSeeWelfareInfo }) {
  const [showOwingModal, setShowOwingModal] = useState(false);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const openTickets = data.tickets.filter((t) => t.status !== "Resolved");
  const inTraining = data.onboarding.filter((o) => o.status !== "Graduated");
  const readyToGraduate = data.onboarding.filter((o) => o.status === "Independently ready" || o.status === "Ready");
  const owingCount = data.members.filter((m) => getDue(m, currentMonth).status === "owing").length;

  const todayKey = (() => {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  })();
  const todaysBirthdays = data.members.filter((m) => m.dob === todayKey);
  const upcomingBirthdays = data.members.filter((m) => {
    if (!m.dob || m.dob === todayKey) return false;
    const [dd, mm] = m.dob.split("/").map(Number);
    if (!dd || !mm) return false;
    const now = new Date();
    const thisYear = new Date(now.getFullYear(), mm - 1, dd);
    const diffDays = Math.ceil((thisYear - now) / 86400000);
    return diffDays > 0 && diffDays <= 14;
  });

  return (
    <div>
      <SectionHeader title="Dashboard" subtitle="Live overview, synced in real time across all admins" />
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <Metric label="Active members" value={data.members.length} />
        {isAdmin && <Metric label="In onboarding" value={inTraining.length} tone={inTraining.length ? "amber" : undefined} />}
        <Metric label="Open tickets" value={openTickets.length} tone={openTickets.length ? "red" : undefined} />
        {canSeeWelfareInfo && <Metric label="Owing dues" value={owingCount} tone={owingCount ? "amber" : undefined} onClick={() => setShowOwingModal(true)} />}
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
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

      {isAdmin && <WalletPanel data={data} isAdmin={isAdmin} />}

      {canSeeWelfareInfo && (todaysBirthdays.length > 0 || upcomingBirthdays.length > 0) && (
        <Panel title="Birthdays" style={{ marginTop: 16 }}>
          {todaysBirthdays.length > 0 && (
            <div style={{ marginBottom: upcomingBirthdays.length > 0 ? 10 : 0 }}>
              <div style={{ fontSize: 11, color: COLORS.textMuted, textTransform: "uppercase", marginBottom: 4 }}>Today</div>
              {todaysBirthdays.map((m) => (
                <RowLine key={m.id}><span style={{ flex: 1 }}>{m.name}</span><Badge tone="green">Today</Badge></RowLine>
              ))}
            </div>
          )}
          {upcomingBirthdays.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: COLORS.textMuted, textTransform: "uppercase", marginBottom: 4 }}>Next 14 days</div>
              {upcomingBirthdays.map((m) => (
                <RowLine key={m.id}><span style={{ flex: 1 }}>{m.name}</span><span style={{ fontSize: 11, color: COLORS.textMuted }}>{m.dob}</span></RowLine>
              ))}
            </div>
          )}
        </Panel>
      )}

      {showOwingModal && <OwingDuesModal data={data} onClose={() => setShowOwingModal(false)} />}
    </div>
  );
}

/* ---------------- members ---------------- */

function MembersTab({ data, isAdmin, canManage, reload, currentUserId, notify }) {
  const [showForm, setShowForm] = useState(false);
  const [showRoles, setShowRoles] = useState(false);
  const [profiles, setProfiles] = useState([]);
  const blank = () => ({ id: null, name: "", email: "", phone: "", unit: "", tier: "", team: "", joinDate: new Date().toISOString().slice(0, 10), skills: { proPresenter: 3, vmix: 3, resolume: 3, technical: 3 }, dues: {} });
  const [form, setForm] = useState(blank());

  async function loadProfiles() {
    const { data } = await supabase.from("profiles").select("*").order("email");
    setProfiles(data || []);
  }

  async function saveMember() {
    if (!form.name.trim()) return;
    const payload = { name: form.name, email: form.email, phone: form.phone, unit: form.unit || null, tier: form.tier || null, team: form.team || null, join_date: form.joinDate, skills: form.skills, dues: form.dues };
    const isNew = !form.id;
    const { error } = form.id
      ? await supabase.from("members").update(payload).eq("id", form.id)
      : await supabase.from("members").insert(payload);
    if (error) { notify?.(error.message, "error"); return; }
    notify?.(isNew ? "Member added" : "Member updated");
    setShowForm(false);
    setForm(blank());
    reload();
  }

  async function removeMember(id) {
    const { error } = await supabase.from("members").delete().eq("id", id);
    if (error) { notify?.(error.message, "error"); return; }
    notify?.("Member removed");
    reload();
  }

  async function setRole(userId, role) {
    const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);
    if (error) { notify?.(error.message, "error"); return; }
    notify?.(role === "admin" ? "Promoted to admin" : "Moved to member");
    loadProfiles();
  }

  return (
    <div>
      <SectionHeader
        title="Members"
        subtitle={`${data.members.length} on record`}
        right={canManage && (
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
            <Field label="Functional unit">
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {UNITS.map((u) => (
                  <Btn key={u} small tone={form.unit === u ? "amber" : "ghost"} onClick={() => setForm({ ...form, unit: form.unit === u ? "" : u })}>{u}</Btn>
                ))}
              </div>
              {!form.unit && <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 4 }}>Unassigned</div>}
            </Field>
            <Field label="Tier">
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {TIERS.map((t) => (
                  <Btn key={t} small tone={form.tier === t ? "amber" : "ghost"} onClick={() => setForm({ ...form, tier: form.tier === t ? "" : t })}>{t}</Btn>
                ))}
              </div>
              {!form.tier && <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 4 }}>Unassigned</div>}
            </Field>
            <Field label="Rotation team">
              <div style={{ display: "flex", gap: 6 }}>
                {["A", "B"].map((t) => (
                  <Btn key={t} small tone={form.team === t ? "amber" : "ghost"} onClick={() => setForm({ ...form, team: form.team === t ? "" : t })}>Team {t}</Btn>
                ))}
              </div>
              {!form.team && <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 4 }}>Unassigned</div>}
            </Field>
          </div>
          <div style={{ fontSize: 12, color: COLORS.textSecondary, margin: "10px 0 6px" }}>Self-reported proficiency (1-5)</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
            {["proPresenter", "vmix", "resolume", "technical"].map((k) => (
              <Field key={k} label={k}><input type="number" min={1} max={5} style={inputStyle} value={form.skills[k]} onChange={(e) => setForm({ ...form, skills: { ...form.skills, [k]: Number(e.target.value) } })} /></Field>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Btn tone="amber" onClick={saveMember}><Save size={13} /> Save member</Btn>
            {form.id && <Btn tone="danger" onClick={() => { removeMember(form.id); setShowForm(false); }}><Trash2 size={13} /> Delete member</Btn>}
          </div>
        </Panel>
      )}

      <Panel>
        {data.members.length === 0 ? <EmptyRow text="No members yet." /> : (
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 560 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr 0.7fr 0.9fr 0.6fr", fontSize: 11, color: COLORS.textMuted, padding: "0 4px 8px", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                <div>Name</div><div>Unit</div><div>Tier</div><div>Team</div><div>Account</div><div></div>
              </div>
              {data.members.map((m) => (
                <div
                  key={m.id}
                  onClick={() => canManage && (setForm(m), setShowForm(true))}
                  className={canManage ? "hldt-row" : undefined}
                  data-clickable={canManage}
                  style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr 0.7fr 0.9fr 0.6fr", alignItems: "center", padding: "8px 4px", borderTop: `1px solid ${COLORS.border}`, fontSize: 13, cursor: canManage ? "pointer" : "default" }}
                >
                  <div>{m.name}</div>
                  <div style={{ color: COLORS.textSecondary }}>{m.unit}</div>
                  <div style={{ color: COLORS.textSecondary }}>{m.tier}</div>
                  <div style={{ color: COLORS.textSecondary }}>{m.team}</div>
                  <div>{m.profileId ? <Badge tone="green">Linked</Badge> : <Badge tone="gray">No login</Badge>}</div>
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    {canManage && <ChevronRight size={14} style={{ color: COLORS.textMuted }} />}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}

/* ---------------- onboarding ---------------- */

function OnboardingTab({ data, isAdmin, canManage, reload, adminName, notify }) {
  const [showForm, setShowForm] = useState(false);
  const blank = () => ({ memberId: "", name: "", startDate: new Date().toISOString().slice(0, 10), weeks: [false, false, false, false], scores: { proPres: "Average", vmix: "Average", resolume: "Average", hardware: "Average", attention: "Average", responsiveness: "Average", reliability: "Average" }, status: "In training" });
  const [form, setForm] = useState(blank());

  async function addTrainee() {
    if (!form.name.trim()) return;
    const { error } = await supabase.from("onboarding").insert({ member_id: form.memberId || null, name: form.name, start_date: form.startDate, weeks: form.weeks, scores: form.scores, status: form.status });
    if (error) { notify?.(error.message, "error"); return; }
    notify?.("Trainee added");
    setForm(blank());
    setShowForm(false);
    reload();
  }

  async function updateScore(record, field, value) {
    if (!canManage) return;
    await supabase.from("onboarding").update({ scores: { ...record.scores, [field]: value } }).eq("id", record.id);
    await supabase.from("onboarding_history").insert({ onboarding_id: record.id, field, new_value: value, changed_by: (await supabase.auth.getUser()).data.user.id, changed_by_name: adminName });
    reload();
  }

  async function toggleWeek(record, idx) {
    if (!canManage) return;
    const weeks = [...record.weeks];
    weeks[idx] = !weeks[idx];
    await supabase.from("onboarding").update({ weeks }).eq("id", record.id);
    reload();
  }

  async function setStatus(record, status) {
    if (!canManage) return;
    await supabase.from("onboarding").update({ status }).eq("id", record.id);
    await supabase.from("onboarding_history").insert({ onboarding_id: record.id, field: "status", new_value: status, changed_by: (await supabase.auth.getUser()).data.user.id, changed_by_name: adminName });
    notify?.(`Status set to "${status}"`);
    reload();
  }

  return (
    <div>
      <SectionHeader
        title="Onboarding"
        subtitle={canManage ? "Week-by-week tracking. Scores are Operations-only, database-enforced, and logged." : "Trainee progress. Detailed scores are visible to Operations only."}
        right={canManage && <Btn tone="amber" onClick={() => setShowForm(true)}><Plus size={14} /> Add trainee</Btn>}
      />

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
          <div style={{ display: "flex", gap: 10, marginBottom: canManage ? 14 : 0 }}>
            {["Week 1", "Week 2", "Week 3", "Week 4"].map((w, i) => (
              <div key={w} className="hldt-week-toggle" onClick={() => toggleWeek(o, i)} style={{ flex: 1, textAlign: "center", padding: "8px 0", borderRadius: 6, fontSize: 12, cursor: canManage ? "pointer" : "default", background: o.weeks[i] ? COLORS.greenDim : COLORS.surface2, color: o.weeks[i] ? COLORS.green : COLORS.textMuted, border: `1px solid ${o.weeks[i] ? COLORS.green : COLORS.border}` }}>
                {w} {o.weeks[i] ? "✓" : ""}
              </div>
            ))}
          </div>

          {canManage && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10, marginBottom: 10, marginTop: 14 }}>
                {Object.keys(o.scores).map((k) => (
                  <Field key={k} label={k}>
                    <select style={inputStyle} value={o.scores[k]} onChange={(e) => updateScore(o, k, e.target.value)}>
                      {RATING_WORDS.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </Field>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: COLORS.textSecondary }}>Status:</span>
                {["In training", "Fairly ready", "Ready", "Independently ready", "Graduated"].map((s) => (
                  <Btn key={s} small tone={o.status === s ? "amber" : "ghost"} onClick={() => setStatus(o, s)}>{s}</Btn>
                ))}
              </div>
              {o.history && o.history.length > 0 && (
                <details style={{ fontSize: 11, color: COLORS.textMuted }}>
                  <summary style={{ cursor: "pointer" }}>Edit log ({o.history.length})</summary>
                  <div style={{ marginTop: 6 }}>
                    {o.history.slice().reverse().slice(0, 10).map((h, i) => (
                      <div key={i} style={{ padding: "3px 0", fontFamily: "'JetBrains Mono', monospace" }}>
                        {new Date(h.timestamp).toLocaleString()} — {h.admin} set {h.field} to "{h.newValue}"
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </Panel>
      ))}
    </div>
  );
}

/* ---------------- equipment ---------------- */

function EquipmentTab({ data, isAdmin, reload, notify }) {
  const [showForm, setShowForm] = useState(false);
  const blank = () => ({ reporter: "", date: new Date().toISOString().slice(0, 10), systems: Object.fromEntries(SYSTEMS.map((s) => [s, "OK"])), description: "" });
  const [form, setForm] = useState(blank());

  async function submit() {
    if (!form.reporter.trim()) return;
    const hasIssue = Object.values(form.systems).includes("Issue");
    const { error } = await supabase.from("tickets").insert({ reporter: form.reporter, ticket_date: form.date, systems: form.systems, description: form.description, status: hasIssue ? "Open" : "Resolved" });
    if (error) { notify?.(error.message, "error"); return; }
    notify?.(hasIssue ? "Check submitted — issue logged" : "Check submitted — all clear");
    setForm(blank());
    setShowForm(false);
    reload();
  }

  async function updateStatus(t, status) {
    await supabase.from("tickets").update({ status }).eq("id", t.id);
    notify?.(`Ticket set to "${status}"`);
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

function DueEditModal({ member, month, onClose, onSaved, notify }) {
  const existing = getDue(member, month);
  const [status, setStatus] = useState(existing.status === "unset" ? "paid" : existing.status);
  const [amount, setAmount] = useState(existing.amount ?? (existing.status === "paid" ? rate(member) : 0));

  async function save() {
    const dues = { ...(member.dues || {}), [month]: { status, amount: Number(amount) || 0 } };
    const { error } = await supabase.from("members").update({ dues }).eq("id", member.id);
    if (error) { notify?.(error.message, "error"); return; }
    notify?.(`${member.name}'s ${month} dues updated`);
    onSaved();
    onClose();
  }

  return (
    <Modal
      title={`${member.name} — ${month}`}
      onClose={onClose}
      width={360}
      footer={<><Btn tone="ghost" onClick={onClose}>Cancel</Btn><Btn tone="amber" onClick={save}><Save size={13} /> Save</Btn></>}
    >
      <Field label="Status">
        <select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="unset">Not set</option>
          <option value="paid">Paid</option>
          <option value="owing">Owing</option>
          <option value="free">Free</option>
        </select>
      </Field>
      <Field label={`Amount paid (expected ${currency(rate(member))})`}>
        <input type="number" min={0} step={100} style={inputStyle} value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <div style={{ fontSize: 11, color: COLORS.textMuted }}>
        Paying above the expected amount is fine — the extra just shows in the collected total.
      </div>
    </Modal>
  );
}

function DuesTab({ data, isAdmin, reload, myMemberId, notify }) {
  const months = MONTHS();
  const [editing, setEditing] = useState(null);

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
              <div style={{ fontSize: 13, marginBottom: 10, color: COLORS.textSecondary }}>{mine.name} · {currency(rate(mine))}/month</div>
              {months.map((mo) => {
                const due = getDue(mine, mo);
                const tone = due.status === "paid" ? "green" : due.status === "owing" ? "red" : due.status === "free" ? "amber" : "gray";
                return (
                  <RowLine key={mo}>
                    <span style={{ flex: 1 }}>{mo}</span>
                    {due.amount ? <span style={{ fontSize: 11, color: COLORS.textMuted, marginRight: 8 }}>{currency(due.amount)}</span> : null}
                    <Badge tone={tone}>{due.status === "unset" ? "Not set" : due.status}</Badge>
                  </RowLine>
                );
              })}
            </>
          )}
        </Panel>
      </div>
    );
  }

  return (
    <div>
      <SectionHeader title="Dues" subtitle="Members ₦3,500 · Leaders ₦5,500 expected. Click a cell to record what was actually paid." />
      <Panel>
        <div style={{ overflowX: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: `1.4fr repeat(${months.length}, 0.9fr)`, fontSize: 11, color: COLORS.textMuted, padding: "0 4px 8px", textTransform: "uppercase" }}>
            <div>Member</div>{months.map((mo) => <div key={mo} style={{ textAlign: "center" }}>{mo}</div>)}
          </div>
          {data.members.length === 0 ? <EmptyRow text="No members yet." /> : data.members.map((m) => (
            <div key={m.id} style={{ display: "grid", gridTemplateColumns: `1.4fr repeat(${months.length}, 0.9fr)`, alignItems: "center", padding: "8px 4px", borderTop: `1px solid ${COLORS.border}`, fontSize: 12 }}>
              <div>{m.name} <span style={{ color: COLORS.textMuted }}>· {currency(rate(m))}</span></div>
              {months.map((mo) => {
                const due = getDue(m, mo);
                const tone = due.status === "paid" ? "green" : due.status === "owing" ? "red" : due.status === "free" ? "amber" : "gray";
                return (
                  <div key={mo} style={{ textAlign: "center", cursor: "pointer" }} onClick={() => setEditing({ member: m, month: mo })}>
                    <Badge tone={tone}>{due.status === "unset" ? "—" : due.amount ? currency(due.amount) : due.status}</Badge>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </Panel>
      {editing && (
        <DueEditModal
          member={editing.member}
          month={editing.month}
          notify={notify}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}

/* ---------------- feedback ---------------- */

function FeedbackTab({ data, isAdmin, reload, notify }) {
  const [showForm, setShowForm] = useState(false);
  const blank = () => ({ name: "", engagement: 3, impact: 3, atmosphere: 3, suggestions: "", complaints: "", requests: "" });
  const [form, setForm] = useState(blank());

  async function submit() {
    const { error } = await supabase.from("feedback").insert({ name: form.name, engagement: form.engagement, impact: form.impact, atmosphere: form.atmosphere, suggestions: form.suggestions, complaints: form.complaints, requests: form.requests });
    if (error) { notify?.(error.message, "error"); return; }
    notify?.("Feedback submitted — thank you");
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
