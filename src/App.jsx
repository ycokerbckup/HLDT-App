import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  LayoutDashboard, Users, GraduationCap, Wrench, CalendarDays,
  Wallet, MessageSquare, Plus, X, ChevronRight, ChevronLeft, Shield, User,
  CheckCircle2, Clock, Trash2, Save, LogOut, RefreshCw, Download,
  Sun, Moon, Bell, Megaphone, MessageCircle, Rss, Link2, Settings, Pencil, GripVertical, Eye, EyeOff, Camera, Menu, CornerUpLeft, Check, CheckCheck, Boxes, DollarSign, Sparkles, ClipboardCheck, Search as SearchIcon, PartyPopper
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { supabase } from "./supabaseClient";

const DARK_COLORS = {
  bg: "#14171C",
  surface1: "#1C2027",
  surface2: "#242933",
  glass1: "rgba(28, 32, 39, 0.66)",
  glass2: "rgba(36, 41, 51, 0.55)",
  glassBorder: "rgba(255, 255, 255, 0.09)",
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
  glass1: "rgba(255, 255, 255, 0.6)",
  glass2: "rgba(241, 241, 238, 0.55)",
  glassBorder: "rgba(255, 255, 255, 0.7)",
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
const DUES_START_MONTH = "2026-06";

// The team operates on West Africa Time (UTC+1, no daylight saving).
// Pin all business-date calculations to this explicitly rather than
// each device's own local timezone, so every user — regardless of
// their phone/laptop's clock settings — sees the same "today". Always
// read these with getUTC* methods, never local getters or
// toDateString(), which would apply the browser's own offset on top of
// this and reintroduce the exact bug this fixes.
const WAT_OFFSET_MS = 60 * 60 * 1000;

function nowWAT() {
  return new Date(Date.now() + WAT_OFFSET_MS);
}

function todayStringWAT() {
  const d = nowWAT();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function currentMonthStringWAT() {
  return todayStringWAT().slice(0, 7);
}

function monthStringWAT(monthOffset) {
  const anchor = nowWAT();
  const dt = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + monthOffset, 1));
  return dt.toISOString().slice(0, 7);
}

const MONTHS = () => {
  const out = [];
  for (let i = -2; i <= 2; i++) {
    const mo = monthStringWAT(i);
    if (mo >= DUES_START_MONTH) out.push(mo);
  }
  return out;
};

function monthsRange(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const mo = monthStringWAT(-i);
    if (mo >= DUES_START_MONTH) out.push(mo);
  }
  return out;
}

function rate(m) {
  return m.tier === "Leader" || m.tier === "HOD" ? 5500 : 3500;
}

// Reads a due entry for a given month, tolerant of the old string-only
// format ("paid") as well as the current { status, amount } object shape.
// A successful online (Paystack) payment always takes precedence over
// whatever's in the manual entry — it's the tamper-proof source of truth
// when one exists.
function getDue(m, month, duesPayments) {
  const onlinePayment = (duesPayments || []).find((p) => p.memberId === m.id && p.month === month && p.status === "success");
  if (onlinePayment) return { status: "paid", amount: onlinePayment.amountKobo / 100, viaOnline: true };
  const raw = (m.dues || {})[month];
  if (!raw) return { status: "unset", amount: 0 };
  if (typeof raw === "string") return { status: raw, amount: raw === "paid" ? null : 0 };
  return { status: raw.status || "unset", amount: typeof raw.amount === "number" ? raw.amount : 0 };
}

function hexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function currency(n) {
  return `₦${Math.round(n || 0).toLocaleString()}`;
}

// Dues aren't expected from a trainee until they're promoted to full
// membership, or from a member marked temporarily unavailable — though
// either can still choose to pay (this only excludes them from the
// Expected/Owing totals, cells stay clickable for a voluntary payment).
function duesExempt(m) {
  return m.tier === "Trainee" || m.unavailable === true;
}

function skillSummary(m) {
  const s = m.skills || {};
  return `PP${s.proPresenter ?? 3} VM${s.vmix ?? 3} RS${s.resolume ?? 3} TC${s.technical ?? 3}`;
}

function renderTaggedBody(body, taggedProfileIds, members) {
  const names = (taggedProfileIds || [])
    .map((id) => members.find((m) => m.profileId === id)?.name)
    .filter(Boolean);
  const patterns = [...names, "everyone"];
  const escaped = patterns.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(@(?:${escaped.join("|")}))`, "g");
  return body.split(pattern).map((part, i) =>
    patterns.some((n) => part === "@" + n) ? (
      <span key={i} style={{ color: "#E8A33D", fontWeight: 600 }}>{part}</span>
    ) : (
      part
    )
  );
}

function todayDDMM() {
  const d = nowWAT();
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Returns 'birthday' | 'graduation' | 'milestone' | null for a member, today.
function getCelebrationForMember(member, onboardingList) {
  if (!member) return null;
  if (member.dob === todayDDMM() || member.isBirthdayToday) return "birthday";
  const todayStr = todayStringWAT();
  const gradToday = (onboardingList || []).some((o) => {
    if (o.memberId !== member.id || o.status !== "Graduated" || !o.graduatedAt) return false;
    const gradWAT = new Date(new Date(o.graduatedAt).getTime() + WAT_OFFSET_MS);
    const gradStr = `${gradWAT.getUTCFullYear()}-${String(gradWAT.getUTCMonth() + 1).padStart(2, "0")}-${String(gradWAT.getUTCDate()).padStart(2, "0")}`;
    return gradStr === todayStr;
  });
  if (gradToday) return "graduation";
  if (member.joinDate) {
    const today = nowWAT();
    if (today.getUTCDate() === 1) {
      const jd = new Date(member.joinDate + "T00:00:00Z");
      const monthsSince = (today.getUTCFullYear() - jd.getUTCFullYear()) * 12 + (today.getUTCMonth() - jd.getUTCMonth());
      if (monthsSince > 0 && monthsSince % 6 === 0) return "milestone";
    }
  }
  return null;
}

function celebrationEmoji(type) {
  if (type === "birthday") return "🎂";
  if (type === "graduation") return "🎓";
  if (type === "milestone") return "🎉";
  return null;
}

const AVATAR_PALETTE = ["#E8A33D", "#3DDC97", "#5B9BE0", "#D4537E", "#7F77DD", "#E24B4A", "#0F6E56", "#B87A1F"];

const TUESDAY_TEMPLATE = [
  { title: "Welcome Speech/Greeting", duration_minutes: 3 },
  { title: "Opening Prayer & Prayer 1", duration_minutes: 5 },
  { title: "Prayer 2 & 3", duration_minutes: 6 },
  { title: "Prayer 4 & 5", duration_minutes: 6 },
  { title: "Group discussion (Q&A, icebreaker etc.)", duration_minutes: 20 },
  { title: "Observations & announcements", duration_minutes: 4 },
  { title: "Closing prayer", duration_minutes: 2 },
];

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

function Avatar({ label, color, size = 28, celebration, photoUrl }) {
  const emoji = celebrationEmoji(celebration);
  const inner = emoji || !photoUrl ? (
    <div style={{ width: size, height: size, borderRadius: 999, background: emoji ? COLORS.amberDim : color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: emoji ? size * 0.55 : size * 0.4, fontWeight: 600, flexShrink: 0 }}>
      {emoji || label}
    </div>
  ) : (
    <img src={photoUrl} alt="" style={{ width: size, height: size, borderRadius: 999, objectFit: "cover", flexShrink: 0, display: "block" }} />
  );
  if (emoji) {
    return (
      <div title={celebration === "birthday" ? "Birthday today!" : celebration === "graduation" ? "Graduated today!" : "Service milestone today!"}>
        {inner}
      </div>
    );
  }
  return <div className="hldt-avatar-gradient-ring">{inner}</div>;
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
    <div className="hldt-panel hldt-panel-hover hldt-glass" style={{ background: COLORS.glass1, border: `1px solid ${COLORS.glassBorder}`, borderRadius: 14, overflow: "hidden", ...style }}>
      {title && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: `1px solid ${COLORS.border}`, background: COLORS.glass2 }}>
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

function Btn({ children, onClick, tone = "default", small, type = "button", disabled, style }) {
  const toneStyles = {
    default: { background: COLORS.glass2, color: COLORS.textPrimary, border: `1px solid ${COLORS.glassBorder}` },
    amber: { background: hexToRgba(COLORS.amber, 0.88), color: "#14171C", border: `1px solid ${hexToRgba(COLORS.amber, 0.95)}` },
    ghost: { background: hexToRgba(COLORS.textPrimary, 0.04), color: COLORS.textSecondary, border: `1px solid ${COLORS.glassBorder}` },
    danger: { background: hexToRgba(COLORS.red, 0.12), color: COLORS.red, border: `1px solid ${hexToRgba(COLORS.red, 0.3)}` },
  };
  return (
    <button className={`hldt-btn hldt-glass${tone === "amber" ? " hldt-shine" : ""}`} type={type} onClick={onClick} disabled={disabled} style={{ ...toneStyles[tone], borderRadius: 10, padding: small ? "5px 10px" : "8px 14px", fontSize: small ? 12 : 13, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, display: "inline-flex", alignItems: "center", gap: 6, ...style }}>
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

function RowLine({ children, onClick, style, title }) {
  return (
    <div className="hldt-row" data-clickable={!!onClick} onClick={onClick} title={title} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 4px", borderBottom: `1px solid ${COLORS.border}`, fontSize: 13, cursor: onClick ? "pointer" : "default", ...style }}>
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
  const useGradient = !tone;
  return (
    <div
      className="hldt-panel-hover"
      onClick={onClick}
      style={{
        background: COLORS.surface2, borderRadius: 12, padding: "14px 16px", flex: 1, minWidth: 120,
        cursor: onClick ? "pointer" : "default",
        transition: "background-color 150ms ease, transform 150ms ease",
      }}
      onMouseEnter={(e) => { if (onClick) e.currentTarget.style.background = COLORS.border; }}
      onMouseLeave={(e) => { if (onClick) e.currentTarget.style.background = COLORS.surface2; }}
    >
      <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div
        className={useGradient ? "hldt-gradient-text" : undefined}
        style={{
          fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: isCurrency ? 22 : 28,
          color: useGradient ? undefined : tone === "amber" ? COLORS.amber : tone === "red" ? COLORS.red : tone === "green" ? COLORS.green : COLORS.textPrimary,
        }}
      >
        {display}
      </div>
    </div>
  );
}

function Modal({ title, onClose, children, width = 480, footer, dismissable = true }) {
  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 20 }}
      onClick={dismissable ? onClose : undefined}
    >
      <div
        className="hldt-modal hldt-glass"
        style={{ width, maxWidth: "100%", maxHeight: "85vh", display: "flex", flexDirection: "column", background: COLORS.glass1, border: `1px solid ${COLORS.glassBorder}`, borderRadius: 16, overflow: "hidden" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 20px 12px", flexShrink: 0 }}>
          <h3 style={{ margin: 0, fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600, fontSize: 17, color: COLORS.textPrimary }}>{title}</h3>
          {dismissable && <X size={18} style={{ cursor: "pointer", color: COLORS.textMuted, flexShrink: 0 }} onClick={onClose} />}
        </div>
        <div style={{ overflowY: "auto", padding: "0 20px 20px" }}>
          {children}
        </div>
        {footer && <div style={{ padding: "0 20px 20px", display: "flex", gap: 8, justifyContent: "flex-end", flexShrink: 0 }}>{footer}</div>}
      </div>
    </div>,
    document.body
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
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) setError(error.message || "Something went wrong signing in. Please try again.");
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        });
        if (error) setError(error.message || "Something went wrong creating your account. Please try again in a moment.");
        else setNotice("Account created. Check your email to confirm, then sign in.");
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        });
        if (error) setError(error.message || "Something went wrong sending the reset link. Please try again.");
        else setNotice("If that email has an account, a reset link is on its way. Check your inbox.");
      }
    } catch (err) {
      setError((err && err.message) || "Something went wrong. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="hldt-app" style={{ minHeight: "100vh", position: "relative", display: "flex", alignItems: "center", justifyContent: "center", background: COLORS.bg, padding: 20, overflow: "hidden" }}>
      <div className="hldt-glow-field">
        <div className="hldt-glow-orb hldt-glow-warm" />
        <div className="hldt-glow-orb hldt-glow-cool" />
      </div>

      <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 64, flexWrap: "wrap", width: "100%", maxWidth: 920 }}>
        <div style={{ flex: "1 1 320px", minWidth: 260, maxWidth: 420, textAlign: "left" }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: "0.12em", color: COLORS.amber, marginBottom: 14, textTransform: "uppercase" }}>Ops Console</div>
          <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, fontSize: "clamp(36px, 6vw, 56px)", lineHeight: 1.02, color: COLORS.textPrimary, letterSpacing: "-0.02em" }}>
            Display<br />Team
          </div>
          <div style={{ fontSize: 15, color: COLORS.textSecondary, marginTop: 16, lineHeight: 1.5, maxWidth: 360 }}>
            Roster, equipment, dues, and the crew chat — everything backstage, in one place.
          </div>
        </div>

        <div className="hldt-auth-card" style={{ width: 360, maxWidth: "100%", background: "rgba(28, 32, 39, 0.72)", border: `1px solid ${COLORS.border}`, borderRadius: 20, padding: 28, boxShadow: "0 24px 60px rgba(0,0,0,0.35)" }}>
          <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 19, color: COLORS.textPrimary, marginBottom: 20 }}>
            {mode === "signin" ? "Welcome back" : mode === "signup" ? "Create your account" : "Reset password"}
          </div>

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

          <div style={{ marginTop: 18, fontSize: 12, color: COLORS.textMuted, display: "flex", flexDirection: "column", gap: 6 }}>
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
    <div className="hldt-app" style={{ minHeight: "100vh", position: "relative", display: "flex", alignItems: "center", justifyContent: "center", background: COLORS.bg, padding: 20, overflow: "hidden" }}>
      <div className="hldt-glow-field">
        <div className="hldt-glow-orb hldt-glow-warm" />
        <div className="hldt-glow-orb hldt-glow-cool" />
      </div>
      <div className="hldt-auth-card" style={{ position: "relative", zIndex: 1, width: 360, maxWidth: "100%", background: "rgba(28, 32, 39, 0.72)", border: `1px solid ${COLORS.border}`, borderRadius: 20, padding: 28, boxShadow: "0 24px 60px rgba(0,0,0,0.35)" }}>
        <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 19, color: COLORS.textPrimary, marginBottom: 20 }}>Set a new password</div>
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
  const [tab, setTab] = useState(() => {
    if (typeof window === "undefined") return "dashboard";
    const params = new URLSearchParams(window.location.search);
    return params.get("tab") || "dashboard";
  });
  const [data, setData] = useState({ members: [], onboarding: [], tickets: [], feedback: [], announcements: [], notifications: [], readIds: [], duesPayments: [] });
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
    const { data: avatarRows } = await supabase.from("profiles").select("id, avatar_url");
    const avatarByProfileId = {};
    (avatarRows || []).forEach((p) => { if (p.avatar_url) avatarByProfileId[p.id] = p.avatar_url; });
    const { data: duesPaymentRows } = await supabase.from("dues_payments").select("*").order("created_at", { ascending: false });

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
      duesPayments: (duesPaymentRows || []).map((p) => ({
        id: p.id, memberId: p.member_id, month: p.month, amountKobo: p.amount_kobo,
        reference: p.reference, status: p.status, channel: p.channel, paidAt: p.paid_at, createdAt: p.created_at,
      })),
      members: (membersRes.data || []).map((m) => {
        const isSelf = ownMemberRow && m.id === ownMemberRow.id;
        const source = isSelf ? ownMemberRow : m;
        return {
          id: m.id, name: m.name, email: m.email, phone: m.phone, unit: m.unit, tier: m.tier,
          team: m.team, joinDate: m.join_date, skills: source.skills || {}, dues: source.dues || {},
          profileId: m.profile_id,
          homeAddress: source.home_address, sex: source.sex, dob: source.dob, occupation: source.occupation, kymCompletedAt: source.kym_completed_at,
          unavailable: m.unavailable, suspended: m.suspended,
          avatarUrl: avatarByProfileId[m.profile_id] || null,
          isBirthdayToday: m.is_birthday_today === true,
        };
      }),
      onboarding: (onboardingRes.data || []).map((o) => ({
        id: o.id, memberId: o.member_id, name: o.name, startDate: o.start_date,
        weeks: o.weeks || [false, false, false, false], scores: o.scores || {},
        status: o.status, history: historyByOnboarding[o.id] || [], graduatedAt: o.graduated_at,
      })),
      tickets: (ticketsRes.data || []).map((t) => ({
        id: t.id, reporter: t.reporter, reporterId: t.reporter_id, date: t.ticket_date, systems: t.systems || {},
        description: t.description, status: t.status, assignedTo: t.assigned_to, assignedToId: t.assigned_to_id,
        photoUrl: t.photo_url, createdAt: t.created_at,
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
        dmWithProfileId: n.dm_with_profile_id, relatedOnboardingId: n.related_onboarding_id,
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
  const canAccessInventory = myUnit === "Technical" || myUnit === "Operations";
  const canDeleteTickets = myUnit === "Technical" || myUnit === "Operations";
  const canManageRosters = isAdmin && (myUnit === "Operations" || myUnit === "Admin");
  const canManageEvents = isAdmin && (myUnit === "Operations" || myUnit === "Welfare" || myUnit === "Admin");
  const canSeeDues = myUnit === "Welfare" || myUnit === "Operations";

  const unreadByTab = {};
  data.notifications.forEach((n) => {
    if (n.linkTab && !data.readIds.includes(n.id)) unreadByTab[n.linkTab] = (unreadByTab[n.linkTab] || 0) + 1;
  });

  const [showKym, setShowKym] = useState(false);
  const [pendingDm, setPendingDm] = useState(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("dm") || null;
  });
  const [pendingPaymentRef] = useState(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("payment_ref") || null;
  });
  const [pendingHighlight, setPendingHighlight] = useState(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const h = params.get("highlight");
    const t = params.get("tab");
    return h && t ? { tab: t, id: h } : null;
  });
  const [pendingMemberDetailId, setPendingMemberDetailId] = useState(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.search) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);
  const [celebrantType, setCelebrantType] = useState(null);
  const kymPromptedRef = useRef(false);
  useEffect(() => {
    if (!loaded || !myMember || myMember.kymCompletedAt || kymPromptedRef.current) return;
    kymPromptedRef.current = true;
    const t = setTimeout(() => setShowKym(true), 3000);
    return () => clearTimeout(t);
  }, [loaded, myMember]);

  const celebrantPromptedRef = useRef(false);
  useEffect(() => {
    if (!loaded || !myMember || celebrantPromptedRef.current) return;
    const type = getCelebrationForMember(myMember, data.onboarding);
    if (!type) return;
    const key = `hldt-celebrated-${session.user.id}-${new Date().toDateString()}-${type}`;
    if (localStorage.getItem(key)) return;
    celebrantPromptedRef.current = true;
    localStorage.setItem(key, "1");
    setCelebrantType(type);
  }, [loaded, myMember, data.onboarding, session.user.id]);

  useEffect(() => {
    function ping() {
      if (document.visibilityState === "visible") supabase.rpc("heartbeat");
    }
    ping();
    const interval = setInterval(ping, 25000);
    document.addEventListener("visibilitychange", ping);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", ping);
    };
  }, []);

  const [showProfile, setShowProfile] = useState(false);
  const [showTour, setShowTour] = useState(false);
  const tourPromptedRef = useRef(false);
  useEffect(() => {
    if (!loaded || !profile || tourPromptedRef.current) return;
    if ((profile.tour_version_seen || 0) >= TOUR_VERSION) return;
    tourPromptedRef.current = true;
    const t = setTimeout(async () => {
      setShowTour(true);
      const { error } = await supabase.rpc("mark_tour_seen", { p_version: TOUR_VERSION });
      if (error) {
        console.error("mark_tour_seen failed:", error.message);
      } else {
        setProfile((p) => (p ? { ...p, tour_version_seen: TOUR_VERSION } : p));
      }
    }, 5000);
    return () => clearTimeout(t);
  }, [loaded, profile]);

  function finishTour() {
    setShowTour(false);
  }

  async function markNotificationRead(id) {
    if (data.readIds.includes(id)) return;
    await supabase.from("notification_reads").insert({ notification_id: id, profile_id: session.user.id });
  }

  async function goToTab(tabId, dmProfileId, highlightId, memberDetailId) {
    setTab(tabId);
    if (dmProfileId) setPendingDm(dmProfileId);
    if (highlightId) setPendingHighlight({ tab: tabId, id: highlightId });
    if (memberDetailId) setPendingMemberDetailId(memberDetailId);
    const toMark = data.notifications.filter((n) => n.linkTab === tabId && !data.readIds.includes(n.id));
    if (toMark.length > 0) {
      await supabase.from("notification_reads").upsert(
        toMark.map((n) => ({ notification_id: n.id, profile_id: session.user.id })),
        { onConflict: "notification_id,profile_id", ignoreDuplicates: true }
      );
    }
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
    { id: "attendance", label: "Attendance", icon: ClipboardCheck },
    { id: "events", label: "Events", icon: PartyPopper },
    ...(canSeeDues ? [{ id: "dues", label: "Dues", icon: Wallet }] : []),
    { id: "feedback", label: "Feedback", icon: MessageSquare },
  ];

  const isMobile = useIsMobile();
  const [showAccountMenu, setShowAccountMenu] = useState(false);

  return (
    <div className="hldt-app" style={{ minHeight: "100vh", background: COLORS.bg, color: COLORS.textPrimary, fontFamily: "'Inter', sans-serif", display: "flex", flexDirection: isMobile ? "column" : "row" }}>
      <div style={{ position: "fixed", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 0 }}>
        <div className="hldt-glow-orb hldt-glow-warm hldt-glow-subtle" style={{ position: "fixed" }} />
        <div className="hldt-glow-orb hldt-glow-cool hldt-glow-subtle" style={{ position: "fixed" }} />
      </div>
      <ToastStack toasts={toasts} />
      <GlobalSearch data={data} goToTab={goToTab} isOperationsUser={myUnit === "Operations"} />
      <NotificationBell
        notifications={data.notifications}
        readIds={data.readIds}
        onRead={markNotificationRead}
        onNavigate={(tabId, dmProfileId, highlightId) => goToTab(tabId, dmProfileId, highlightId)}
      />
      {showKym && <KYMModal onClose={() => { setShowKym(false); load(); }} notify={notify} />}
      {celebrantType && <CelebrantPopup type={celebrantType} name={profile.full_name?.split(" ")[0] || "there"} onClose={() => setCelebrantType(null)} />}
      {showTour && !showKym && !celebrantType && <TourGuide onDone={finishTour} />}
      {showProfile && (
        <ProfileModal
          session={session}
          profile={profile}
          setProfile={setProfile}
          myMember={myMember}
          onClose={() => setShowProfile(false)}
          reload={load}
          notify={notify}
        />
      )}

      {isMobile ? (
        <>
          {/* Hamburger opens a full drawer with every tab, so nothing is scrolled off-screen */}
          <div style={{ position: "fixed", top: 8, left: 8, zIndex: 1500 }}>
            <button
              data-tour="nav"
              onClick={() => setShowAccountMenu(!showAccountMenu)}
              aria-label="Menu"
              style={{ width: 32, height: 32, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", background: COLORS.surface2, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, cursor: "pointer", position: "relative" }}
            >
              <Menu size={16} />
              {Object.keys(unreadByTab).length > 0 && <span style={{ position: "absolute", top: -2, right: -2, width: 8, height: 8, borderRadius: 999, background: COLORS.red, border: `1.5px solid ${COLORS.bg}` }} />}
            </button>
          </div>

          {showAccountMenu && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1600 }} onClick={() => setShowAccountMenu(false)}>
              <div
                className="hldt-modal hldt-glass"
                onClick={(e) => e.stopPropagation()}
                style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 250, background: COLORS.glass1, borderRight: `1px solid ${COLORS.glassBorder}`, display: "flex", flexDirection: "column", overflowY: "auto" }}
              >
                <div style={{ padding: "18px 16px 14px", borderBottom: `1px solid ${COLORS.border}` }}>
                  <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600, fontSize: 17 }}>DISPLAY TEAM</div>
                  <div style={{ fontSize: 10, color: COLORS.textMuted, fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>OPS CONSOLE</div>
                </div>

                <div style={{ flex: 1, padding: "8px" }}>
                  {nav.map((n) => {
                    const Icon = n.icon;
                    const active = tab === n.id;
                    const hasUnread = unreadByTab[n.id] > 0;
                    return (
                      <div
                        key={n.id}
                        onClick={() => { goToTab(n.id); setShowAccountMenu(false); }}
                        style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 10px", marginBottom: 2, borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: active || n.id === "events" ? 600 : 400, color: active ? COLORS.amber : n.id === "events" ? COLORS.green : COLORS.textSecondary, background: active ? `linear-gradient(135deg, ${COLORS.amberDim}, rgba(61,220,151,0.08))` : "transparent" }}
                      >
                        <div style={{ position: "relative", display: "flex" }}>
                          <Icon size={16} strokeWidth={1.8} />
                          {hasUnread && <span style={{ position: "absolute", top: -2, right: -3, width: 6, height: 6, borderRadius: 999, background: COLORS.red }} />}
                        </div>
                        {n.label}
                      </div>
                    );
                  })}
                </div>

                <div style={{ padding: 12, borderTop: `1px solid ${COLORS.border}` }}>
                  <div
                    className="hldt-row" data-clickable="true"
                    onClick={() => { setShowProfile(true); setShowAccountMenu(false); }}
                    style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "4px", borderRadius: 10, marginBottom: 10 }}
                  >
                    <Avatar label={(profile.full_name || session.user.email)?.[0]?.toUpperCase() || "?"} color={hashColor(session.user.id)} size={38} photoUrl={profile.avatar_url} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{profile.full_name || session.user.email}</div>
                      <Badge tone={isAdmin ? "amber" : "gray"}>{profile.role}</Badge>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <PushNotificationToggle session={session} />
                    {isAdmin && <Btn small tone="ghost" onClick={() => { exportAllData(); notify("Backup downloaded"); setShowAccountMenu(false); }}><Download size={12} /> Export data</Btn>}
                    <Btn small tone="ghost" onClick={() => supabase.auth.signOut()}><LogOut size={12} /> Sign out</Btn>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div style={{ padding: "56px 14px 20px", minWidth: 0, flex: 1, overflowY: "auto" }}>
            {!loaded ? (
              <SkeletonLoader />
            ) : (
              <div key={tab} className="hldt-tab-content">
                {tab === "dashboard" && <DashboardTab data={data} setTab={goToTab} isAdmin={isAdmin} myMember={myMember} myOnboarding={myOnboarding} canSeeWelfareInfo={canSeeDues} />}
                {tab === "members" && <MembersTab data={data} isAdmin={isAdmin} canManage={canManageMembers} reload={load} currentUserId={session.user.id} notify={notify} pendingMemberDetailId={pendingMemberDetailId} onPendingMemberDetailConsumed={() => setPendingMemberDetailId(null)} />}
                {tab === "onboarding" && <OnboardingTab data={data} isAdmin={isAdmin} canManage={canManageOnboarding} reload={load} adminName={profile.full_name || session.user.email} notify={notify} />}
                {tab === "equipment" && <EquipmentTab data={data} isAdmin={isAdmin} myMember={myMember} canAccessInventory={canAccessInventory} canDeleteTickets={canDeleteTickets} reload={load} notify={notify} pendingHighlight={pendingHighlight} onPendingHighlightConsumed={() => setPendingHighlight(null)} />}
                {tab === "roster" && <RosterTab data={data} isAdmin={isAdmin} canManageRosters={canManageRosters} myMember={myMember} reload={load} notify={notify} pendingHighlight={pendingHighlight} onPendingHighlightConsumed={() => setPendingHighlight(null)} />}
                {tab === "attendance" && <AttendanceTab data={data} canManageRosters={canManageRosters} myMember={myMember} notify={notify} />}
                {tab === "events" && <SpecialEventsTab data={data} canManageEvents={canManageEvents} myUnit={myUnit} session={session} notify={notify} />}
                {tab === "dues" && (canSeeDues ? <DuesTab data={data} isAdmin={isAdmin} reload={load} myMemberId={myMember?.id} notify={notify} pendingPaymentRef={pendingPaymentRef} /> : <Panel><EmptyRow text="Dues is only visible to Welfare and Operations." /></Panel>)}
                {tab === "announcements" && <AnnouncementsTab data={data} isAdmin={isAdmin} canPost={isAdmin || myUnit === "Welfare"} canSeeReadReceipts={isAdmin && (myUnit === "Operations" || myUnit === "Welfare")} reload={load} notify={notify} adminId={session.user.id} adminName={profile.full_name || session.user.email} pendingHighlight={pendingHighlight} onPendingHighlightConsumed={() => setPendingHighlight(null)} />}
                {tab === "feed" && <FeedTab session={session} profile={profile} isAdmin={isAdmin} canManage={canManageFeed} notify={notify} />}
                {tab === "chat" && <ChatTab session={session} profile={profile} members={data.members} onboarding={data.onboarding} notify={notify} pendingDmProfileId={pendingDm} onPendingDmConsumed={() => setPendingDm(null)} />}
                {tab === "feedback" && <FeedbackTab data={data} isAdmin={isAdmin} canReadFeedback={isAdmin && (myUnit === "Operations" || myUnit === "Welfare")} reload={load} notify={notify} />}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div data-tour="nav" className="hldt-glass" style={{ width: 190, flexShrink: 0, background: COLORS.glass1, borderRight: `1px solid ${COLORS.glassBorder}`, display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "18px 16px 14px", borderBottom: `1px solid ${COLORS.border}` }}>
              <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600, fontSize: 19, letterSpacing: "0.02em", lineHeight: 1.1 }}>DISPLAY TEAM</div>
              <div style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: "'JetBrains Mono', monospace", marginTop: 4 }}>OPS CONSOLE</div>
            </div>

            <div style={{ flex: 1, padding: "10px 8px" }}>
              {nav.map((n) => {
                const Icon = n.icon;
                const active = tab === n.id;
                const hasUnread = unreadByTab[n.id] > 0;
                return (
                  <div key={n.id} className="hldt-nav-item" onClick={() => goToTab(n.id)} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", marginBottom: 2, borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: active || n.id === "events" ? 600 : 400, color: active ? COLORS.amber : n.id === "events" ? COLORS.green : COLORS.textSecondary, background: active ? `linear-gradient(135deg, ${COLORS.amberDim}, rgba(61,220,151,0.08))` : "transparent", borderLeft: active ? `2px solid ${COLORS.amber}` : n.id === "events" ? `2px solid ${COLORS.green}` : "2px solid transparent" }}>
                    <div style={{ position: "relative", display: "flex" }}>
                      <Icon size={15} strokeWidth={1.8} />
                      {hasUnread && <span style={{ position: "absolute", top: -2, right: -3, width: 6, height: 6, borderRadius: 999, background: COLORS.red, border: `1.5px solid ${COLORS.surface1}` }} />}
                    </div>
                    {n.label}
                  </div>
                );
              })}
            </div>

            <div style={{ padding: 12, borderTop: `1px solid ${COLORS.border}` }}>
              <div
                className="hldt-row" data-clickable="true"
                onClick={() => setShowProfile(true)}
                style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "4px", borderRadius: 10, marginBottom: 10 }}
              >
                <Avatar label={(profile.full_name || session.user.email)?.[0]?.toUpperCase() || "?"} color={hashColor(session.user.id)} size={38} photoUrl={profile.avatar_url} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{profile.full_name || session.user.email}</div>
                  <Badge tone={isAdmin ? "amber" : "gray"}>{profile.role}</Badge>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <PushNotificationToggle session={session} />
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
                {tab === "dashboard" && <DashboardTab data={data} setTab={goToTab} isAdmin={isAdmin} myMember={myMember} myOnboarding={myOnboarding} canSeeWelfareInfo={canSeeDues} />}
                {tab === "members" && <MembersTab data={data} isAdmin={isAdmin} canManage={canManageMembers} reload={load} currentUserId={session.user.id} notify={notify} pendingMemberDetailId={pendingMemberDetailId} onPendingMemberDetailConsumed={() => setPendingMemberDetailId(null)} />}
                {tab === "onboarding" && <OnboardingTab data={data} isAdmin={isAdmin} canManage={canManageOnboarding} reload={load} adminName={profile.full_name || session.user.email} notify={notify} />}
                {tab === "equipment" && <EquipmentTab data={data} isAdmin={isAdmin} myMember={myMember} canAccessInventory={canAccessInventory} canDeleteTickets={canDeleteTickets} reload={load} notify={notify} pendingHighlight={pendingHighlight} onPendingHighlightConsumed={() => setPendingHighlight(null)} />}
                {tab === "roster" && <RosterTab data={data} isAdmin={isAdmin} canManageRosters={canManageRosters} myMember={myMember} reload={load} notify={notify} pendingHighlight={pendingHighlight} onPendingHighlightConsumed={() => setPendingHighlight(null)} />}
                {tab === "attendance" && <AttendanceTab data={data} canManageRosters={canManageRosters} myMember={myMember} notify={notify} />}
                {tab === "events" && <SpecialEventsTab data={data} canManageEvents={canManageEvents} myUnit={myUnit} session={session} notify={notify} />}
                {tab === "dues" && (canSeeDues ? <DuesTab data={data} isAdmin={isAdmin} reload={load} myMemberId={myMember?.id} notify={notify} pendingPaymentRef={pendingPaymentRef} /> : <Panel><EmptyRow text="Dues is only visible to Welfare and Operations." /></Panel>)}
                {tab === "announcements" && <AnnouncementsTab data={data} isAdmin={isAdmin} canPost={isAdmin || myUnit === "Welfare"} canSeeReadReceipts={isAdmin && (myUnit === "Operations" || myUnit === "Welfare")} reload={load} notify={notify} adminId={session.user.id} adminName={profile.full_name || session.user.email} pendingHighlight={pendingHighlight} onPendingHighlightConsumed={() => setPendingHighlight(null)} />}
                {tab === "feed" && <FeedTab session={session} profile={profile} isAdmin={isAdmin} canManage={canManageFeed} notify={notify} />}
                {tab === "chat" && <ChatTab session={session} profile={profile} members={data.members} onboarding={data.onboarding} notify={notify} pendingDmProfileId={pendingDm} onPendingDmConsumed={() => setPendingDm(null)} />}
                {tab === "feedback" && <FeedbackTab data={data} isAdmin={isAdmin} canReadFeedback={isAdmin && (myUnit === "Operations" || myUnit === "Welfare")} reload={load} notify={notify} />}
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

function Carousel({ children, itemWidth = 220, autoAdvanceMs = 3200 }) {
  const scrollerRef = useRef(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = React.Children.count(children);

  function handleScroll() {
    const el = scrollerRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / (itemWidth + 12));
    setActiveIdx(Math.min(count - 1, Math.max(0, idx)));
  }

  useEffect(() => {
    if (paused || count <= 1) return;
    const timer = setInterval(() => {
      setActiveIdx((cur) => {
        const next = (cur + 1) % count;
        scrollerRef.current?.scrollTo({ left: next * (itemWidth + 12), behavior: "smooth" });
        return next;
      });
    }, autoAdvanceMs);
    return () => clearInterval(timer);
  }, [paused, count, itemWidth, autoAdvanceMs]);

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={() => setPaused(true)}
      onTouchEnd={() => setTimeout(() => setPaused(false), 2500)}
    >
      <div ref={scrollerRef} className="hldt-carousel" onScroll={handleScroll}>
        {React.Children.map(children, (child) => (
          <div className="hldt-carousel-item" style={{ width: itemWidth }}>{child}</div>
        ))}
      </div>
      {count > 1 && (
        <div className="hldt-carousel-dots" style={{ color: COLORS.textMuted }}>
          {Array.from({ length: count }).map((_, i) => (
            <div key={i} className={`hldt-carousel-dot${i === activeIdx ? " active" : ""}`} />
          ))}
        </div>
      )}
    </div>
  );
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

function GlobalSearch({ data, goToTab, isOperationsUser }) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [memberChoiceId, setMemberChoiceId] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (q.length < 2) return { members: [], announcements: [], tickets: [] };
    return {
      members: data.members.filter((m) => m.name?.toLowerCase().includes(q)).slice(0, 6),
      announcements: data.announcements.filter((a) => a.title?.toLowerCase().includes(q) || a.body?.toLowerCase().includes(q)).slice(0, 6),
      tickets: data.tickets.filter((t) => t.description?.toLowerCase().includes(q) || t.reporter?.toLowerCase().includes(q)).slice(0, 6),
    };
  }, [q, data.members, data.announcements, data.tickets]);

  const totalResults = results.members.length + results.announcements.length + results.tickets.length;

  function closeSearch() {
    setOpen(false);
    setQuery("");
    setMemberChoiceId(null);
  }

  function clickMember(m) {
    if (isOperationsUser) {
      setMemberChoiceId(memberChoiceId === m.id ? null : m.id);
      return;
    }
    if (!m.profileId) return;
    goToTab("chat", m.profileId);
    closeSearch();
  }

  function messageMember(m) {
    if (!m.profileId) return;
    goToTab("chat", m.profileId);
    closeSearch();
  }

  function viewMemberDetails(m) {
    goToTab("members", null, null, m.id);
    closeSearch();
  }

  function clickAnnouncement(a) {
    goToTab("announcements", null, a.id);
    closeSearch();
  }

  function clickTicket(t) {
    goToTab("equipment", null, t.id);
    closeSearch();
  }

  return (
    <div style={{ position: "fixed", top: isMobile ? 8 : 16, right: isMobile ? 84 : 112, zIndex: 1500 }}>
      <button
        data-tour="search"
        onClick={() => setOpen(true)}
        aria-label="Search"
        style={{ width: isMobile ? 32 : 36, height: isMobile ? 32 : 36, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", background: COLORS.surface2, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, cursor: "pointer" }}
      >
        <SearchIcon size={14} />
      </button>
      {open && createPortal(
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 2100, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: isMobile ? 50 : 60 }} onClick={closeSearch}>
          <div
            className="hldt-modal hldt-glass"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 480, maxWidth: "calc(100vw - 32px)", maxHeight: "70vh", overflowY: "auto", background: COLORS.glass1, border: `1px solid ${COLORS.glassBorder}`, borderRadius: 16, padding: 16, boxShadow: "0 24px 60px rgba(0,0,0,0.4)" }}
          >
            <input
              ref={inputRef}
              className="hldt-composer-input"
              style={{ ...inputStyle, borderRadius: 10, marginBottom: 10 }}
              placeholder="Search members, announcements, tickets..."
              value={query}
              onChange={(e) => { setQuery(e.target.value); setMemberChoiceId(null); }}
            />
            {q.length < 2 ? (
              <div style={{ fontSize: 12, color: COLORS.textMuted, padding: "8px 4px" }}>Keep typing — at least 2 characters.</div>
            ) : totalResults === 0 ? (
              <div style={{ fontSize: 12, color: COLORS.textMuted, padding: "8px 4px" }}>Nothing found for "{query}".</div>
            ) : (
              <>
                {results.members.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", padding: "0 4px 4px" }}>Members</div>
                    {results.members.map((m) => (
                      <div key={m.id}>
                        <div className="hldt-row" data-clickable="true" onClick={() => clickMember(m)} style={{ padding: "8px 6px", borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                          <Avatar label={m.name?.[0] || "?"} color={hashColor(m.id)} size={22} photoUrl={m.avatarUrl} />
                          {m.name}
                        </div>
                        {memberChoiceId === m.id && (
                          <div style={{ display: "flex", gap: 6, padding: "2px 6px 8px 36px" }}>
                            <Btn small tone="amber" onClick={() => messageMember(m)}><MessageCircle size={11} /> Message</Btn>
                            <Btn small tone="ghost" onClick={() => viewMemberDetails(m)}><Users size={11} /> View details</Btn>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {results.announcements.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", padding: "0 4px 4px" }}>Announcements</div>
                    {results.announcements.map((a) => (
                      <div key={a.id} className="hldt-row" data-clickable="true" onClick={() => clickAnnouncement(a)} style={{ padding: "8px 6px", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>
                        {a.title}
                      </div>
                    ))}
                  </div>
                )}
                {results.tickets.length > 0 && (
                  <div>
                    <div style={{ fontSize: 10, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", padding: "0 4px 4px" }}>Equipment tickets</div>
                    {results.tickets.map((t) => (
                      <div key={t.id} className="hldt-row" data-clickable="true" onClick={() => clickTicket(t)} style={{ padding: "8px 6px", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>
                        {t.reporter} · {t.date} {t.description ? `— ${t.description.slice(0, 40)}` : ""}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

function ProfileModal({ session, profile, setProfile, myMember, onClose, reload, notify }) {
  const [fullName, setFullName] = useState(profile.full_name || "");
  const [phone, setPhone] = useState(myMember?.phone || "");
  const [skills, setSkills] = useState(myMember?.skills || { proPresenter: 3, vmix: 3, resolume: 3, technical: 3 });
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(profile.avatar_url || null);
  const [saving, setSaving] = useState(false);

  function handlePhotoChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  async function save() {
    setSaving(true);
    let avatarUrl = profile.avatar_url || null;
    if (photoFile) {
      const path = `${session.user.id}-${Date.now()}-${photoFile.name}`;
      const { error: upErr } = await supabase.storage.from("avatars").upload(path, photoFile);
      if (upErr) { notify?.(upErr.message, "error"); setSaving(false); return; }
      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
      avatarUrl = pub.publicUrl;
    }

    const { error: profErr } = await supabase.rpc("update_own_profile", { p_full_name: fullName.trim() || null, p_avatar_url: avatarUrl });
    if (profErr) { notify?.(profErr.message, "error"); setSaving(false); return; }

    if (myMember) {
      const { error: memErr } = await supabase.rpc("update_own_member_info", { p_phone: phone.trim() || null, p_skills: skills });
      if (memErr) { notify?.(memErr.message, "error"); setSaving(false); return; }
    }

    setSaving(false);
    notify?.("Profile updated");
    setProfile((p) => (p ? { ...p, full_name: fullName.trim() || p.full_name, avatar_url: avatarUrl } : p));
    onClose();
    reload();
  }

  return (
    <Modal title="My Profile" onClose={onClose} width={400}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 18 }}>
        <div style={{ position: "relative" }}>
          {photoPreview ? (
            <img src={photoPreview} alt="" style={{ width: 84, height: 84, borderRadius: 999, objectFit: "cover", border: `2px solid ${COLORS.amber}` }} />
          ) : (
            <Avatar label={(fullName || session.user.email)?.[0]?.toUpperCase() || "?"} color={hashColor(session.user.id)} size={84} />
          )}
        </div>
        <label style={{ marginTop: 10, fontSize: 12, color: COLORS.amber, cursor: "pointer" }}>
          Change photo
          <input type="file" accept="image/*" onChange={handlePhotoChange} style={{ display: "none" }} />
        </label>
      </div>

      <Field label="Full name"><input style={inputStyle} value={fullName} onChange={(e) => setFullName(e.target.value)} /></Field>
      <Field label="Email"><input style={{ ...inputStyle, opacity: 0.6 }} value={session.user.email} disabled /></Field>
      {myMember && <Field label="Phone"><input style={inputStyle} value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>}

      {myMember && (
        <>
          <div style={{ fontSize: 12, color: COLORS.textSecondary, margin: "10px 0 6px" }}>Self-reported proficiency (1-5)</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
            {["proPresenter", "vmix", "resolume", "technical"].map((k) => (
              <Field key={k} label={k}><input type="number" min={1} max={5} style={inputStyle} value={skills[k]} onChange={(e) => setSkills({ ...skills, [k]: Number(e.target.value) })} /></Field>
            ))}
          </div>
        </>
      )}

      <div style={{ marginTop: 16 }}>
        <Btn tone="amber" onClick={save} disabled={saving}>{saving ? "Saving..." : <><Save size={13} /> Save profile</>}</Btn>
      </div>
    </Modal>
  );
}

function PushNotificationToggle({ session }) {
  const [status, setStatus] = useState("checking"); // checking | unsupported | denied | off | on | working
  const supported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  useEffect(() => {
    if (!supported) { setStatus("unsupported"); return; }
    if (Notification.permission === "denied") { setStatus("denied"); return; }
    navigator.serviceWorker.ready.then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      setStatus(sub ? "on" : "off");
    }).catch(() => setStatus("off"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enable() {
    const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
    if (!vapidKey) { alert("Push isn't configured yet — ask an admin to set VITE_VAPID_PUBLIC_KEY."); return; }
    setStatus("working");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") { setStatus("denied"); return; }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    });
    const json = sub.toJSON();
    await supabase.from("push_subscriptions").upsert({
      profile_id: session.user.id,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    }, { onConflict: "endpoint" });
    setStatus("on");
  }

  async function disable() {
    setStatus("working");
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      await sub.unsubscribe();
    }
    setStatus("off");
  }

  if (status === "unsupported") return null;
  if (status === "checking") return null;

  return (
    <Btn
      small tone={status === "on" ? "amber" : "ghost"}
      disabled={status === "working" || status === "denied"}
      onClick={status === "on" ? disable : enable}
    >
      <Bell size={12} />
      {status === "on" ? "Push on" : status === "denied" ? "Push blocked (check browser settings)" : status === "working" ? "Working..." : "Enable push"}
    </Btn>
  );
}

function NotificationBell({ notifications, readIds, onRead, onNavigate }) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const unread = notifications.filter((n) => !readIds.includes(n.id));

  function handleClick(n) {
    onRead(n.id);
    if (n.linkTab) {
      const highlightId =
        n.type === "saturday_roster_reminder" ? "saturday-roster-section" :
        n.type === "tuesday_roster_reminder" ? "tuesday-roster-section" :
        null;
      onNavigate(n.linkTab, n.dmWithProfileId || null, highlightId);
    }
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
        data-tour="bell"
        onClick={() => setOpen(!open)}
        aria-label="Notifications"
        style={{
          width: isMobile ? 32 : 36, height: isMobile ? 32 : 36, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center",
          background: COLORS.surface2, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, cursor: "pointer", position: "relative",
        }}
      >
        <span className={unread.length > 0 ? "hldt-wiggle-on-hover" : undefined} style={{ display: "flex" }}><Bell size={14} /></span>
        {unread.length > 0 && (
          <span className="hldt-reaction-pop" style={{ position: "absolute", top: -2, right: -2, minWidth: 15, height: 15, borderRadius: 999, background: COLORS.red, color: "#fff", fontSize: 9, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px" }}>
            {unread.length > 9 ? "9+" : unread.length}
          </span>
        )}
      </button>
      {open && createPortal(
        <div style={{ position: "fixed", inset: 0, zIndex: 2100 }} onClick={() => setOpen(false)}>
          <div
            className="hldt-modal hldt-glass"
            onClick={(e) => e.stopPropagation()}
            style={{ position: "fixed", top: isMobile ? 46 : 58, right: isMobile ? 8 : 16, width: isMobile ? "calc(100vw - 16px)" : 320, maxWidth: 320, maxHeight: 400, overflowY: "auto", background: COLORS.glass1, border: `1px solid ${COLORS.glassBorder}`, borderRadius: 14, padding: 8, boxShadow: "0 24px 60px rgba(0,0,0,0.4)" }}
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
        </div>,
        document.body
      )}
    </div>
  );
}

/* ---------------- announcements ---------------- */

function AnnouncementsTab({ data, isAdmin, canPost, canSeeReadReceipts, reload, notify, adminId, adminName, pendingHighlight, onPendingHighlightConsumed }) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const blank = () => ({ title: "", body: "" });
  const [form, setForm] = useState(blank());
  const [highlightedId, setHighlightedId] = useState(null);
  const [readersByAnnouncement, setReadersByAnnouncement] = useState({});
  const [showReadersFor, setShowReadersFor] = useState(null);

  useEffect(() => {
    if (!canSeeReadReceipts) return;
    async function loadReaders() {
      const { data: rows } = await supabase
        .from("notification_reads")
        .select("read_at, profiles(id, full_name), notifications!inner(announcement_id, type)")
        .eq("notifications.type", "announcement");
      const grouped = {};
      (rows || []).forEach((r) => {
        const aid = r.notifications?.announcement_id;
        if (!aid) return;
        if (!grouped[aid]) grouped[aid] = [];
        grouped[aid].push({ name: r.profiles?.full_name || "Someone", readAt: r.read_at });
      });
      setReadersByAnnouncement(grouped);
    }
    loadReaders();
    const channel = supabase
      .channel("announcement-reads-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "notification_reads" }, loadReaders)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [canSeeReadReceipts]);

  useEffect(() => {
    if (!pendingHighlight || pendingHighlight.tab !== "announcements") return;
    const el = document.getElementById(`announcement-${pendingHighlight.id}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightedId(pendingHighlight.id);
      setTimeout(() => setHighlightedId((cur) => (cur === pendingHighlight.id ? null : cur)), 2200);
    }
    onPendingHighlightConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingHighlight]);

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
          <Panel key={a.id} style={{ marginBottom: 12, transition: "box-shadow 400ms ease", boxShadow: highlightedId === a.id ? `0 0 0 2px ${COLORS.amber}` : "none" }}>
            <div id={`announcement-${a.id}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
              <div style={{ fontSize: 15, fontWeight: 500, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{a.title}</div>
              {(canPost || isAdmin) && (
                <div style={{ display: "flex", gap: 10, flexShrink: 0, marginLeft: 10 }}>
                  {canPost && withinEditWindow(a) && <ChevronRight size={14} style={{ cursor: "pointer", color: COLORS.textMuted }} onClick={() => startEdit(a)} />}
                  {isAdmin && <Trash2 size={14} style={{ cursor: "pointer", color: COLORS.textMuted }} onClick={() => remove(a.id)} />}
                </div>
              )}
            </div>
            <div style={{ fontSize: 13, color: COLORS.textSecondary, whiteSpace: "pre-wrap", marginBottom: 8 }}>{a.body}</div>
            <div style={{ fontSize: 11, color: COLORS.textMuted, display: "flex", gap: 10, alignItems: "center" }}>
              <span>{a.createdByName || "Admin"} · {new Date(a.createdAt).toLocaleString()}</span>
              {canPost && withinEditWindow(a) && <span style={{ color: COLORS.amber }}>{timeLeft(a)}</span>}
              {canSeeReadReceipts && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3, cursor: "pointer", marginLeft: "auto" }} onClick={() => setShowReadersFor(a.id)}>
                  <Eye size={12} /> {(readersByAnnouncement[a.id] || []).length}
                </span>
              )}
            </div>
          </Panel>
        ))
      )}

      {showReadersFor && (
        <Modal title="Read by" onClose={() => setShowReadersFor(null)} width={320}>
          {(readersByAnnouncement[showReadersFor] || []).length === 0 ? (
            <EmptyRow text="No one has read this yet." />
          ) : (
            (readersByAnnouncement[showReadersFor] || [])
              .sort((x, y) => new Date(x.readAt) - new Date(y.readAt))
              .map((r, i) => (
                <RowLine key={i}>
                  <span style={{ flex: 1 }}>{r.name}</span>
                  <span style={{ fontSize: 11, color: COLORS.textMuted }}>{new Date(r.readAt).toLocaleString()}</span>
                </RowLine>
              ))
          )}
        </Modal>
      )}
    </div>
  );
}

function DateDivider({ date }) {
  const d = new Date(date);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  let label;
  if (d.toDateString() === today.toDateString()) label = "Today";
  else if (d.toDateString() === yesterday.toDateString()) label = "Yesterday";
  else label = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0" }}>
      <div style={{ flex: 1, height: 1, background: COLORS.border }} />
      <div style={{ fontSize: 10, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: "0.04em", flexShrink: 0 }}>{label}</div>
      <div style={{ flex: 1, height: 1, background: COLORS.border }} />
    </div>
  );
}

/* ---------------- chat ---------------- */

const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "🙏", "🎉"];
const PIN_DURATIONS = [
  { label: "24h", hours: 24 },
  { label: "7d", hours: 24 * 7 },
  { label: "30d", hours: 24 * 30 },
];

function ChatTab({ session, profile, members, onboarding, notify, pendingDmProfileId, onPendingDmConsumed }) {
  const isMobile = useIsMobile();
  const [mobileShowThread, setMobileShowThread] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [thread, setThread] = useState({ type: "team" });
  const [messages, setMessages] = useState([]);
  const [reads, setReads] = useState([]);
  const [reactions, setReactions] = useState([]);
  const [pins, setPins] = useState([]);
  const [replyingTo, setReplyingTo] = useState(null);
  const [text, setText] = useState("");
  const [taggedIds, setTaggedIds] = useState([]);
  const [tagQuery, setTagQuery] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState("");
  const [unreadByThread, setUnreadByThread] = useState({});
  const [latestActivityByThread, setLatestActivityByThread] = useState({});
  const [highlightedId, setHighlightedId] = useState(null);
  const [showReactionPickerFor, setShowReactionPickerFor] = useState(null);
  const [showPinPickerFor, setShowPinPickerFor] = useState(null);
  const [showReceiptsFor, setShowReceiptsFor] = useState(null);
  const bottomRef = useRef(null);

  const dmCandidates = members.filter((m) => m.profileId && m.profileId !== session.user.id);

  const sortedDmCandidates = useMemo(() => {
    return [...dmCandidates].sort((a, b) => {
      const convA = conversations.find((c) => (c.user_a === session.user.id ? c.user_b : c.user_a) === a.profileId);
      const convB = conversations.find((c) => (c.user_a === session.user.id ? c.user_b : c.user_a) === b.profileId);
      const tA = convA ? latestActivityByThread[convA.id] : null;
      const tB = convB ? latestActivityByThread[convB.id] : null;
      if (tA && tB) return tB.localeCompare(tA);
      if (tA) return -1;
      if (tB) return 1;
      return a.name.localeCompare(b.name);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dmCandidates.length, conversations, latestActivityByThread]);

  const avatarLabels = useMemo(() => {
    const people = [{ id: session.user.id, name: "You" }, ...dmCandidates.map((m) => ({ id: m.profileId, name: m.name }))];
    return computeAvatarLabels(people);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members]);

  function avatarPhotoFor(profileId) {
    return members.find((m) => m.profileId === profileId)?.avatarUrl || null;
  }

  function celebrationForProfile(profileId) {
    const m = members.find((mem) => mem.profileId === profileId);
    return getCelebrationForMember(m, onboarding);
  }

  async function loadConversations() {
    const { data } = await supabase.from("conversations").select("*").or(`user_a.eq.${session.user.id},user_b.eq.${session.user.id}`);
    setConversations(data || []);
    return data || [];
  }

  const loadUnreadStatus = useCallback(async (convList) => {
    const convIds = (convList || conversations).map((c) => c.id);
    let query = supabase.from("messages").select("id, conversation_id, sender_id, created_at");
    query = convIds.length > 0
      ? query.or(`conversation_id.is.null,conversation_id.in.(${convIds.join(",")})`)
      : query.is("conversation_id", null);
    const { data: allMsgs } = await query;
    const others = (allMsgs || []).filter((m) => m.sender_id !== session.user.id);
    let readSet = new Set();
    if (others.length) {
      const { data: readRows } = await supabase
        .from("message_reads")
        .select("message_id")
        .eq("profile_id", session.user.id)
        .in("message_id", others.map((m) => m.id));
      readSet = new Set((readRows || []).map((r) => r.message_id));
    }
    const map = {};
    others.forEach((m) => {
      if (readSet.has(m.id)) return;
      map[m.conversation_id || "team"] = true;
    });
    setUnreadByThread(map);

    const latest = {};
    (allMsgs || []).forEach((m) => {
      const key = m.conversation_id || "team";
      if (!latest[key] || m.created_at > latest[key]) latest[key] = m.created_at;
    });
    setLatestActivityByThread(latest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, session.user.id]);

  const loadUnreadStatusRef = useRef(loadUnreadStatus);
  useEffect(() => {
    loadUnreadStatusRef.current = loadUnreadStatus;
  }, [loadUnreadStatus]);

  useEffect(() => {
    loadConversations().then((data) => loadUnreadStatus(data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("chat-unread-tracker")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => loadUnreadStatus())
      .on("postgres_changes", { event: "*", schema: "public", table: "message_reads" }, () => loadUnreadStatus())
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => loadConversations().then((data) => loadUnreadStatus(data)))
      .subscribe();
    return () => supabase.removeChannel(channel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadUnreadStatus]);

  const loadMessages = useCallback(async () => {
    let query = supabase.from("messages").select("*").order("created_at", { ascending: true });
    query = thread.type === "team" ? query.is("conversation_id", null) : query.eq("conversation_id", thread.conversationId);
    const { data } = await query;
    setMessages(data || []);
    const ids = (data || []).map((m) => m.id);
    if (ids.length) {
      const [{ data: readRows }, { data: reactionRows }] = await Promise.all([
        supabase.from("message_reads").select("message_id, profile_id").in("message_id", ids),
        supabase.from("message_reactions").select("message_id, profile_id, emoji").in("message_id", ids),
      ]);
      setReads(readRows || []);
      setReactions(reactionRows || []);
    } else {
      setReads([]);
      setReactions([]);
    }
    const others = (data || []).filter((m) => m.sender_id !== session.user.id);
    await Promise.all(
      others.flatMap((m) => {
        const calls = [supabase.rpc("mark_message_read", { msg_id: m.id })];
        if (!m.seen_at) calls.push(supabase.rpc("mark_message_seen", { msg_id: m.id }));
        return calls;
      })
    );
    loadUnreadStatusRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.type, thread.conversationId]);

  async function loadPins() {
    let query = supabase.from("message_pins").select("*, messages(id, body, sender_name, sender_id)").order("created_at", { ascending: false });
    query = thread.type === "team" ? query.is("conversation_id", null) : query.eq("conversation_id", thread.conversationId);
    const { data } = await query;
    setPins(data || []);
  }

  useEffect(() => {
    loadMessages();
    loadPins();
    const channel = supabase
      .channel(`chat-${thread.type}-${thread.conversationId || "team"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, loadMessages)
      .on("postgres_changes", { event: "*", schema: "public", table: "message_reads" }, loadMessages)
      .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, loadMessages)
      .on("postgres_changes", { event: "*", schema: "public", table: "message_pins" }, loadPins)
      .subscribe();
    return () => supabase.removeChannel(channel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const composerRef = useRef(null);

  function autoGrowComposer() {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }

  async function send() {
    if (!text.trim()) return;
    const payload = {
      sender_id: session.user.id,
      sender_name: profile.full_name || session.user.email,
      body: text.trim(),
      conversation_id: thread.type === "dm" ? thread.conversationId : null,
      reply_to_id: replyingTo?.id || null,
      tagged_profile_ids: taggedIds.length > 0 ? taggedIds : null,
    };
    const { error } = await supabase.from("messages").insert(payload);
    if (error) { notify?.(error.message, "error"); return; }
    setText("");
    setReplyingTo(null);
    setTaggedIds([]);
    setTagQuery(null);
    if (composerRef.current) composerRef.current.style.height = "auto";
  }

  function handleTextChange(value) {
    setText(value);
    const lastAt = value.lastIndexOf("@");
    if (lastAt !== -1) {
      const afterAt = value.slice(lastAt + 1);
      if (afterAt.length <= 30 && !afterAt.includes(" ") && !afterAt.includes("\n")) {
        setTagQuery(afterAt);
        return;
      }
    }
    setTagQuery(null);
  }

  function selectTag(member) {
    const lastAt = text.lastIndexOf("@");
    const newText = text.slice(0, lastAt) + "@" + member.name + " ";
    setText(newText);
    if (member.isEveryone) {
      setTaggedIds((prev) => [...new Set([...prev, ...dmCandidates.map((m) => m.profileId)])]);
    } else {
      setTaggedIds((prev) => (prev.includes(member.profileId) ? prev : [...prev, member.profileId]));
    }
    setTagQuery(null);
  }

  const tagSuggestions = useMemo(() => {
    if (tagQuery === null) return [];
    const q = tagQuery.toLowerCase();
    const matches = dmCandidates.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 6);
    if (thread.type === "team" && "everyone".startsWith(q)) {
      return [{ id: "everyone", name: "everyone", isEveryone: true }, ...matches].slice(0, 7);
    }
    return matches;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagQuery, dmCandidates.length, thread.type]);

  function receiptFor(m) {
    if (m.sender_id !== session.user.id) return null;
    const readers = reads.filter((r) => r.message_id === m.id && r.profile_id !== session.user.id);
    if (readers.length === 0) return null;
    if (thread.type === "dm") return "Seen";
    return `Seen by ${readers.length}`;
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
  }

  useEffect(() => {
    if (!pendingDmProfileId) return;
    const target = dmCandidates.find((m) => m.profileId === pendingDmProfileId);
    if (target) {
      startDm(target);
      if (isMobile) setMobileShowThread(true);
    }
    onPendingDmConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDmProfileId, dmCandidates.length]);

  function withinEditWindow(m) {
    return Date.now() - new Date(m.created_at).getTime() < 5 * 60 * 1000;
  }

  function withinDeleteWindow(m) {
    const withinSendWindow = Date.now() - new Date(m.created_at).getTime() < 5 * 60 * 1000;
    const withinSeenWindow = m.seen_at && Date.now() - new Date(m.seen_at).getTime() < 5 * 60 * 1000;
    return withinSendWindow || withinSeenWindow;
  }

  async function deleteMessage(m) {
    const { error } = await supabase.from("messages").delete().eq("id", m.id);
    if (error) { notify?.(error.message, "error"); return; }
    loadMessages();
  }

  function scrollToMessage(id) {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedId(id);
    setTimeout(() => setHighlightedId((cur) => (cur === id ? null : cur)), 1600);
  }

  function reactionsFor(messageId) {
    const rows = reactions.filter((r) => r.message_id === messageId);
    const byEmoji = {};
    rows.forEach((r) => {
      if (!byEmoji[r.emoji]) byEmoji[r.emoji] = [];
      byEmoji[r.emoji].push(r.profile_id);
    });
    return byEmoji;
  }

  async function toggleReaction(messageId, emoji) {
    const mine = reactions.find((r) => r.message_id === messageId && r.profile_id === session.user.id && r.emoji === emoji);
    if (mine) {
      await supabase.from("message_reactions").delete().eq("message_id", messageId).eq("profile_id", session.user.id).eq("emoji", emoji);
    } else {
      await supabase.from("message_reactions").insert({ message_id: messageId, profile_id: session.user.id, emoji });
    }
    setShowReactionPickerFor(null);
    loadMessages();
  }

  async function pinMessage(messageId, hours) {
    const expiresAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();
    const { error } = await supabase.from("message_pins").insert({
      message_id: messageId,
      conversation_id: thread.type === "dm" ? thread.conversationId : null,
      pinned_by: session.user.id,
      expires_at: expiresAt,
    });
    if (error) { notify?.(error.message, "error"); setShowPinPickerFor(null); return; }
    notify?.("Message pinned");
    setShowPinPickerFor(null);
    loadPins();
  }

  async function unpinMessage(pinId) {
    await supabase.from("message_pins").delete().eq("id", pinId);
    loadPins();
  }

  return (
    <div>
      <SectionHeader title="Chat" subtitle="Messages are removed 24 hours after being seen. Editable for 5 minutes after sending, deletable for 5 minutes after being seen." />
      <div style={{ display: "flex", gap: 16, height: isMobile ? "calc(100vh - 200px)" : "65vh" }}>
        {(!isMobile || !mobileShowThread) && (
          <div style={{ width: isMobile ? "100%" : 210, flexShrink: 0, display: "flex", flexDirection: "column", gap: 4, overflowY: "auto" }}>
            <div
              className="hldt-row" data-clickable="true"
              onClick={() => { setThread({ type: "team" }); setMobileShowThread(true); }}
              style={{ padding: "9px 12px", borderRadius: 12, cursor: "pointer", background: thread.type === "team" ? COLORS.amberDim : "transparent", fontSize: 13, fontWeight: thread.type === "team" ? 600 : 400, display: "flex", alignItems: "center", gap: 6 }}
            >
              <span style={{ flex: 1, color: thread.type === "team" ? COLORS.amber : COLORS.textPrimary, display: "flex", alignItems: "center", gap: 6 }}><Users size={13} /> Team channel</span>
              {unreadByThread.team && <span className="hldt-pulse" style={{ width: 8, height: 8, borderRadius: 999, background: COLORS.red, flexShrink: 0 }} />}
            </div>
            <div style={{ fontSize: 11, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: "0.04em", padding: "12px 12px 4px" }}>Direct messages</div>
            {dmCandidates.length === 0 ? (
              <div style={{ fontSize: 11, color: COLORS.textMuted, padding: "4px 10px" }}>No other members with accounts yet.</div>
            ) : (
              sortedDmCandidates.map((m) => {
                const conv = conversations.find((c) => (c.user_a === session.user.id ? c.user_b : c.user_a) === m.profileId);
                const active = thread.type === "dm" && conv && thread.conversationId === conv.id;
                const hasUnread = conv && unreadByThread[conv.id];
                return (
                  <div
                    key={m.id}
                    className="hldt-row" data-clickable="true"
                    onClick={() => { startDm(m); setMobileShowThread(true); }}
                    style={{ padding: "8px 12px", borderRadius: 12, cursor: "pointer", background: active ? COLORS.amberDim : "transparent", fontSize: 13, fontWeight: active ? 600 : 400, display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <Avatar label={avatarLabels[m.profileId] || "?"} color={hashColor(m.profileId)} size={30} celebration={celebrationForProfile(m.profileId)} photoUrl={avatarPhotoFor(m.profileId)} />
                    <span style={{ flex: 1, color: active ? COLORS.amber : COLORS.textPrimary }}>{m.name}</span>
                    {hasUnread && <span className="hldt-pulse" style={{ width: 8, height: 8, borderRadius: 999, background: COLORS.red, flexShrink: 0 }} />}
                  </div>
                );
              })
            )}
          </div>
        )}

        {(!isMobile || mobileShowThread) && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", border: `1px solid ${COLORS.border}`, borderRadius: 18, background: COLORS.surface1, minWidth: 0, overflow: "hidden" }}>
          <div style={{ padding: "12px 18px", borderBottom: `1px solid ${COLORS.border}`, fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
            {isMobile && (
              <button onClick={() => setMobileShowThread(false)} aria-label="Back" style={{ background: "transparent", border: "none", cursor: "pointer", color: COLORS.textMuted, padding: 0, display: "flex" }}>
                <ChevronRight size={16} style={{ transform: "rotate(180deg)" }} />
              </button>
            )}
            {thread.type === "team" ? "Team channel" : thread.otherName}
          </div>

          {pins.length > 0 && (
            <div style={{ padding: "8px 16px", borderBottom: `1px solid ${COLORS.border}`, background: COLORS.surface2, display: "flex", flexDirection: "column", gap: 4 }}>
              {pins.map((p) => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                  <span style={{ flexShrink: 0 }}>📌</span>
                  <span style={{ cursor: p.messages ? "pointer" : "default", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: COLORS.textSecondary }} onClick={() => p.messages && scrollToMessage(p.messages.id)}>
                    <b style={{ color: COLORS.textPrimary, fontWeight: 500 }}>{p.messages?.sender_id === session.user.id ? "You" : p.messages?.sender_name}:</b> {p.messages?.body || "(message removed)"}
                  </span>
                  <X size={12} style={{ cursor: "pointer", color: COLORS.textMuted, flexShrink: 0 }} onClick={() => unpinMessage(p.id)} />
                </div>
              ))}
            </div>
          )}

          <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            {messages.length === 0 ? (
              <EmptyRow text="No messages yet — be the icebreaker. 👋" />
            ) : (
              messages.map((m, idx) => {
                const mine = m.sender_id === session.user.id;
                const quoted = m.reply_to_id ? messages.find((x) => x.id === m.reply_to_id) : null;
                const receipt = receiptFor(m);
                const prev = messages[idx - 1];
                const showDateDivider = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
                const readerNames = reads
                  .filter((r) => r.message_id === m.id && r.profile_id !== session.user.id)
                  .map((r) => members.find((mem) => mem.profileId === r.profile_id)?.name || "Someone");
                const msgReactions = reactionsFor(m.id);
                return (
                  <React.Fragment key={m.id}>
                    {showDateDivider && <DateDivider date={m.created_at} />}
                    <div
                      id={`msg-${m.id}`}
                      className="hldt-msg-row hldt-msg-pop"
                      style={{
                        display: "flex", gap: 9, flexDirection: mine ? "row-reverse" : "row",
                        borderRadius: 12, transition: "background-color 400ms ease",
                        background: highlightedId === m.id ? COLORS.amberDim : "transparent",
                        padding: highlightedId === m.id ? 6 : 0, margin: highlightedId === m.id ? -6 : 0,
                      }}
                    >
                    <Avatar label={avatarLabels[m.sender_id] || m.sender_name?.[0] || "?"} color={hashColor(m.sender_id)} size={30} celebration={celebrationForProfile(m.sender_id)} photoUrl={avatarPhotoFor(m.sender_id)} />
                    <div style={{ maxWidth: "70%" }}>
                      {!mine && <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 2, fontWeight: 500 }}>{m.sender_name}</div>}
                      {editingId === m.id ? (
                        <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 6, width: isMobile ? 220 : "auto" }}>
                          <textarea
                            style={{ ...inputStyle, fontSize: 12, flex: 1, minHeight: 60, resize: "vertical" }}
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                          />
                          <div style={{ display: "flex", gap: 6 }}>
                            <Btn small tone="amber" onClick={() => saveEdit(m)}>Save</Btn>
                            <Btn small tone="ghost" onClick={() => setEditingId(null)}>Cancel</Btn>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: "flex", alignItems: "flex-end", gap: 4, flexDirection: mine ? "row-reverse" : "row" }}>
                          <div
                            style={{
                              background: mine ? `linear-gradient(135deg, ${COLORS.amberDim}, rgba(232,163,61,0.14))` : COLORS.surface2,
                              color: mine ? COLORS.amber : COLORS.textPrimary,
                              padding: "9px 14px", borderRadius: 18,
                              borderBottomRightRadius: mine ? 6 : 18, borderBottomLeftRadius: mine ? 18 : 6,
                              fontSize: 13.5, lineHeight: 1.4, whiteSpace: "pre-wrap", wordBreak: "break-word",
                            }}
                          >
                            {quoted && (
                              <div
                                onClick={() => scrollToMessage(quoted.id)}
                                style={{ borderLeft: `2px solid ${mine ? COLORS.amber : COLORS.textMuted}`, paddingLeft: 8, marginBottom: 5, opacity: 0.75, fontSize: 11, cursor: "pointer" }}
                              >
                                <div style={{ fontWeight: 500 }}>{quoted.sender_id === session.user.id ? "You" : quoted.sender_name}</div>
                                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>{quoted.body}</div>
                              </div>
                            )}
                            {renderTaggedBody(m.body, m.tagged_profile_ids, members)}
                            {m.edited_at && <span style={{ fontSize: 10, opacity: 0.6, marginLeft: 6 }}>(edited)</span>}
                          </div>
                          <div className="hldt-msg-actions" style={{ display: "flex", position: "relative" }}>
                            <button onClick={() => setShowPinPickerFor(showPinPickerFor === m.id ? null : m.id)} aria-label="Pin" style={{ background: "transparent", border: "none", cursor: "pointer", color: COLORS.textMuted, padding: 4, display: "flex", fontSize: 12 }}>
                              📌
                            </button>
                            {showPinPickerFor === m.id && (
                              <div className="hldt-modal hldt-glass" style={{ position: "absolute", top: 0, [mine ? "right" : "left"]: "100%", background: COLORS.glass1, border: `1px solid ${COLORS.glassBorder}`, borderRadius: 12, padding: 6, display: "flex", flexDirection: "column", gap: 4, zIndex: 60, minWidth: 90 }}>
                                <div style={{ fontSize: 10, color: COLORS.textMuted, padding: "0 4px" }}>Pin for...</div>
                                {PIN_DURATIONS.map((d) => (
                                  <Btn key={d.label} small tone="ghost" onClick={() => pinMessage(m.id, d.hours)}>{d.label}</Btn>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      {!editingId && (
                        <div className="hldt-msg-actions" style={{ display: "flex", gap: 2, marginTop: 2, justifyContent: mine ? "flex-end" : "flex-start", position: "relative" }}>
                          {mine && withinEditWindow(m) && (
                            <button onClick={() => startEdit(m)} aria-label="Edit message" style={{ background: "transparent", border: "none", cursor: "pointer", color: COLORS.textMuted, padding: 4, display: "flex" }}>
                              <Pencil size={12} />
                            </button>
                          )}
                          {mine && withinDeleteWindow(m) && (
                            <button onClick={() => deleteMessage(m)} aria-label="Delete message" style={{ background: "transparent", border: "none", cursor: "pointer", color: COLORS.textMuted, padding: 4, display: "flex" }}>
                              <Trash2 size={12} />
                            </button>
                          )}
                          <button onClick={() => setReplyingTo(m)} aria-label="Reply" style={{ background: "transparent", border: "none", cursor: "pointer", color: COLORS.textMuted, padding: 4, display: "flex" }}>
                            <CornerUpLeft size={12} />
                          </button>
                          <button onClick={() => setShowReactionPickerFor(showReactionPickerFor === m.id ? null : m.id)} aria-label="React" style={{ background: "transparent", border: "none", cursor: "pointer", color: COLORS.textMuted, padding: 4, display: "flex", fontSize: 12 }}>
                            🙂
                          </button>
                          {showReactionPickerFor === m.id && (
                            <div className="hldt-modal hldt-glass" style={{ position: "absolute", bottom: "100%", [mine ? "right" : "left"]: 0, background: COLORS.glass1, border: `1px solid ${COLORS.glassBorder}`, borderRadius: 12, padding: 6, display: "flex", gap: 4, zIndex: 60, marginBottom: 4 }}>
                              {REACTION_EMOJIS.map((e) => (
                                <span key={e} onClick={() => toggleReaction(m.id, e)} style={{ cursor: "pointer", fontSize: 16, padding: 2 }}>{e}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {Object.keys(msgReactions).length > 0 && (
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 3, justifyContent: mine ? "flex-end" : "flex-start" }}>
                          {Object.entries(msgReactions).map(([emoji, profileIds]) => {
                            const reactedByMe = profileIds.includes(session.user.id);
                            return (
                              <span
                                key={emoji}
                                className="hldt-reaction-pop"
                                onClick={() => toggleReaction(m.id, emoji)}
                                style={{
                                  fontSize: 11, padding: "2px 8px", borderRadius: 999, cursor: "pointer",
                                  background: reactedByMe ? COLORS.amberDim : COLORS.surface2,
                                  border: `1px solid ${reactedByMe ? COLORS.amber : COLORS.border}`,
                                }}
                              >
                                {emoji} {profileIds.length}
                              </span>
                            );
                          })}
                        </div>
                      )}
                      <div style={{ fontSize: 10, color: COLORS.textMuted, marginTop: 2, display: "flex", alignItems: "center", gap: 4, justifyContent: mine ? "flex-end" : "flex-start", position: "relative" }}>
                        {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        {receipt && (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 3, cursor: "pointer" }} onClick={() => setShowReceiptsFor(showReceiptsFor === m.id ? null : m.id)}>
                            <CheckCheck size={11} color={COLORS.green} /> {receipt}
                          </span>
                        )}
                        {showReceiptsFor === m.id && readerNames.length > 0 && (
                          <div className="hldt-modal hldt-glass" style={{ position: "absolute", bottom: 18, [mine ? "right" : "left"]: 0, background: COLORS.glass1, border: `1px solid ${COLORS.glassBorder}`, borderRadius: 12, padding: 8, minWidth: 120, zIndex: 50 }}>
                            {readerNames.map((n, i) => (
                              <div key={i} style={{ fontSize: 11, color: COLORS.textSecondary, padding: "2px 4px", whiteSpace: "nowrap" }}>{n}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    </div>
                  </React.Fragment>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>
          {replyingTo && (
            <div style={{ padding: "8px 12px", borderTop: `1px solid ${COLORS.border}`, background: COLORS.surface2, display: "flex", alignItems: "center", gap: 8 }}>
              <CornerUpLeft size={12} color={COLORS.textMuted} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: COLORS.textSecondary, fontWeight: 500 }}>Replying to {replyingTo.sender_id === session.user.id ? "yourself" : replyingTo.sender_name}</div>
                <div style={{ fontSize: 11, color: COLORS.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{replyingTo.body}</div>
              </div>
              <X size={14} style={{ cursor: "pointer", color: COLORS.textMuted, flexShrink: 0 }} onClick={() => setReplyingTo(null)} />
            </div>
          )}
          <div style={{ padding: 12, borderTop: `1px solid ${COLORS.border}`, position: "relative" }}>
            {tagSuggestions.length > 0 && (
              <div className="hldt-modal hldt-glass" style={{ position: "absolute", bottom: "100%", left: 12, marginBottom: 4, background: COLORS.glass1, border: `1px solid ${COLORS.glassBorder}`, borderRadius: 12, padding: 6, zIndex: 60, minWidth: 160 }}>
                {tagSuggestions.map((m) => (
                  <div key={m.id} className="hldt-row" data-clickable="true" onClick={() => selectTag(m)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>
                    {m.isEveryone ? (
                      <div style={{ width: 20, height: 20, borderRadius: 999, background: COLORS.amberDim, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <MessageCircle size={11} color={COLORS.amber} />
                      </div>
                    ) : (
                      <Avatar label={avatarLabels[m.profileId] || "?"} color={hashColor(m.profileId)} size={20} photoUrl={avatarPhotoFor(m.profileId)} />
                    )}
                    {m.isEveryone ? <span>everyone <span style={{ color: COLORS.textMuted, fontSize: 11 }}>· tags the whole team channel</span></span> : m.name}
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <textarea
                ref={composerRef}
                className="hldt-composer-input"
                style={{ ...inputStyle, flex: 1, borderRadius: 20, padding: "10px 16px", resize: "none", maxHeight: 120, overflowY: "auto", lineHeight: 1.4, fontFamily: "inherit" }}
                placeholder="Type a message... (@ to tag someone)"
                value={text}
                onChange={(e) => { handleTextChange(e.target.value); autoGrowComposer(); }}
                rows={1}
              />
              <Btn tone="amber" onClick={send} style={{ borderRadius: 999 }}>Send</Btn>
            </div>
          </div>
        </div>
        )}
      </div>
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
  const [channelFilter, setChannelFilter] = useState("all");
  const [linkForm, setLinkForm] = useState(blankLink());

  async function loadPosts() {
    const { data } = await supabase.from("feed_posts").select("*").order("created_at", { ascending: false });
    setPosts((data || []).map((p) => ({
      id: p.id, source: p.source, title: p.title, url: p.url, thumbnailUrl: p.thumbnail_url,
      description: p.description, postedByName: p.posted_by_name, createdAt: p.created_at,
      channelId: p.channel_id, channelName: p.channel_name,
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

      {sources.length > 0 && (
        <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: COLORS.textMuted }}>Channel</span>
          <select style={{ ...inputStyle, width: "auto", minWidth: 160 }} value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)}>
            <option value="all">All channels</option>
            {sources.map((s) => <option key={s.channelId} value={s.channelId}>{s.channelName}</option>)}
          </select>
        </div>
      )}

      {!loaded ? (
        <SkeletonLoader />
      ) : posts.length === 0 ? (
        <Panel><EmptyRow text="Nothing in the feed yet — quiet in here. 🦗" /></Panel>
      ) : (() => {
        const filteredPosts = channelFilter === "all" ? posts : posts.filter((p) => p.channelId === channelFilter);
        return filteredPosts.length === 0 ? (
          <Panel><EmptyRow text="No posts from this channel yet." /></Panel>
        ) : (
        <>
        {filteredPosts.length > 2 && (
          <div style={{ marginBottom: 22 }}>
            <div style={{ fontSize: 11, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Recently added</div>
            <Carousel itemWidth={200}>
              {filteredPosts.slice(0, 8).map((p) => (
                <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", display: "block" }}>
                  <div className="hldt-panel-hover" style={{ background: COLORS.surface1, border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "hidden" }}>
                    {p.thumbnailUrl ? (
                      <img src={p.thumbnailUrl} alt="" style={{ width: "100%", height: 110, objectFit: "cover", display: "block" }} />
                    ) : (
                      <div style={{ width: "100%", height: 110, background: COLORS.surface2, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Link2 size={20} color={COLORS.textMuted} />
                      </div>
                    )}
                    <div style={{ padding: 10 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: COLORS.textPrimary, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{p.title}</div>
                    </div>
                  </div>
                </a>
              ))}
            </Carousel>
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14 }}>
          {filteredPosts.map((p) => (
            <div key={p.id} className="hldt-panel hldt-panel-hover" style={{ background: COLORS.surface1, border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "hidden" }}>
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
        </>
        );
      })()}

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

// Bump this whenever the tour content changes meaningfully — that's the
// only thing that re-shows it to everyone. Otherwise it's genuinely
// once per account, tracked server-side.
const TOUR_VERSION = 1;

const TOUR_STEPS = [
  { selector: '[data-tour="search"]', title: "Search", body: "Find members, announcements, and tickets in seconds." },
  { selector: '[data-tour="bell"]', title: "Notifications", body: "Anything that needs your attention shows up here first." },
  { selector: '[data-tour="nav"]', title: "Everything else", body: "Roster, Dues, Chat, Attendance — all your tools live here." },
];

function TourGuide({ onDone }) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState(null);
  const stepData = TOUR_STEPS[step];

  useEffect(() => {
    const el = document.querySelector(stepData.selector);
    if (!el) {
      if (step < TOUR_STEPS.length - 1) setStep((s) => s + 1);
      else onDone();
      return;
    }
    setRect(el.getBoundingClientRect());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  if (!rect) return null;

  function next() {
    if (step < TOUR_STEPS.length - 1) setStep((s) => s + 1);
    else onDone();
  }

  const pad = 8;
  const tooltipTop = Math.min(rect.bottom + 14, (typeof window !== "undefined" ? window.innerHeight : 800) - 170);
  const tooltipLeft = Math.min(Math.max(rect.left, 12), (typeof window !== "undefined" ? window.innerWidth : 400) - 252);

  return (
    <>
      <div className="hldt-tour-spotlight" style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
      <div
        className="hldt-glass"
        style={{ position: "fixed", top: tooltipTop, left: tooltipLeft, width: 240, background: COLORS.glass1, border: `1px solid ${COLORS.glassBorder}`, borderRadius: 14, padding: 14, zIndex: 3001, boxShadow: "0 16px 40px rgba(0,0,0,0.4)" }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.textPrimary, marginBottom: 4 }}>{stepData.title}</div>
        <div style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 12, lineHeight: 1.4 }}>{stepData.body}</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span onClick={onDone} style={{ fontSize: 11, color: COLORS.textMuted, cursor: "pointer" }}>Skip</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, color: COLORS.textMuted }}>{step + 1}/{TOUR_STEPS.length}</span>
            <Btn small tone="amber" onClick={next}>{step < TOUR_STEPS.length - 1 ? "Next" : "Done"}</Btn>
          </div>
        </div>
      </div>
    </>
  );
}

function CelebrantPopup({ type, name, onClose }) {
  const content = {
    birthday: { emoji: "🎂", title: "Happy Birthday!", body: `Wishing you an amazing day, ${name}. Thanks for everything you bring to the team.` },
    graduation: { emoji: "🎓", title: "Congratulations!", body: `You've graduated from onboarding, ${name} — welcome fully to the team!` },
    milestone: { emoji: "🎉", title: "Milestone reached!", body: `Cheers to your journey on the team so far, ${name}. Here's to more.` },
  }[type];
  if (!content) return null;
  return (
    <Modal title={content.title} onClose={onClose} width={340} footer={<Btn tone="amber" onClick={onClose}>Thanks!</Btn>}>
      <div style={{ textAlign: "center", fontSize: 48, marginBottom: 12 }}>{content.emoji}</div>
      <div style={{ textAlign: "center", fontSize: 13, color: COLORS.textSecondary }}>{content.body}</div>
    </Modal>
  );
}

/* ---------------- dashboard ---------------- */

function OwingDuesModal({ data, onClose }) {
  const [month, setMonth] = useState("all");

  const owing = month === "all"
    ? data.members
        .filter((m) => !duesExempt(m))
        .map((m) => {
          const owingMonths = Object.keys(m.dues || {}).filter((mo) => getDue(m, mo, data.duesPayments).status === "owing");
          const totalOwed = owingMonths.reduce((sum, mo) => sum + Math.max(0, rate(m) - (getDue(m, mo, data.duesPayments).amount || 0)), 0);
          return { m, owingMonths, totalOwed };
        })
        .filter((x) => x.owingMonths.length > 0)
    : data.members
        .filter((m) => !duesExempt(m))
        .map((m) => ({ m, due: getDue(m, month, data.duesPayments) }))
        .filter((x) => x.due.status === "owing")
        .map((x) => ({ m: x.m, owingMonths: [month], totalOwed: Math.max(0, rate(x.m) - (x.due.amount || 0)) }));

  return (
    <Modal title="Members owing dues" onClose={onClose} width={520}>
      <Field label="Month">
        <select style={inputStyle} value={month} onChange={(e) => setMonth(e.target.value)}>
          <option value="all">All months</option>
          {monthsRange(12).map((mo) => <option key={mo} value={mo}>{mo}</option>)}
        </select>
      </Field>
      {owing.length === 0 ? (
        <EmptyRow text={month === "all" ? "No one currently owing." : "No one owing for this month."} />
      ) : (
        owing.map(({ m, owingMonths, totalOwed }) => (
          <RowLine key={m.id}>
            <div style={{ flex: 1 }}>
              <div>{m.name}</div>
              {month === "all" && owingMonths.length > 1 && <div style={{ fontSize: 11, color: COLORS.textMuted }}>{owingMonths.length} months owing</div>}
            </div>
            <span style={{ color: COLORS.red, fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>{currency(totalOwed)}</span>
          </RowLine>
        ))
      )}
    </Modal>
  );
}

function WalletPanel({ data, isAdmin }) {
  const [month, setMonth] = useState(currentMonthStringWAT());
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
          const due = getDue(m, recordedMonth, data.duesPayments);
          if (due.status !== "free" && !duesExempt(m)) expected += rate(m);
          collected += due.amount || 0;
        });
      });
      return { expected, collected };
    }
    data.members.forEach((m) => {
      const due = getDue(m, mo);
      if (due.status !== "free" && !duesExempt(m)) expected += rate(m);
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
  const currentMonth = currentMonthStringWAT();
  const openTickets = data.tickets.filter((t) => t.status !== "Resolved");
  const inTraining = data.onboarding.filter((o) => o.status !== "Graduated");
  const readyToGraduate = data.onboarding.filter((o) => o.status === "Independently ready" || o.status === "Ready");
  const owingCount = data.members.filter((m) => !duesExempt(m) && Object.keys(m.dues || {}).some((mo) => getDue(m, mo, data.duesPayments).status === "owing")).length;

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

      {canSeeWelfareInfo && (
        <Panel
          title="Birthdays"
          style={{ marginTop: 16 }}
          right={
            <Btn small tone="ghost" onClick={() => {
              const rows = data.members.filter((m) => m.dob).sort((a, b) => a.dob.localeCompare(b.dob));
              const csv = ["Name,Date of Birth (dd/mm),Unit", ...rows.map((m) => `"${m.name}","${m.dob}","${m.unit || ""}"`)].join("\n");
              const blob = new Blob([csv], { type: "text/csv" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `birthdays-${new Date().toISOString().slice(0, 10)}.csv`;
              a.click();
              URL.revokeObjectURL(url);
            }}>
              <Download size={12} /> Export
            </Btn>
          }
        >
          {todaysBirthdays.length === 0 && upcomingBirthdays.length === 0 ? (
            <EmptyRow text="No birthdays today or in the next 14 days." />
          ) : (
            <>
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
            </>
          )}
        </Panel>
      )}

      {showOwingModal && <OwingDuesModal data={data} onClose={() => setShowOwingModal(false)} />}
    </div>
  );
}

/* ---------------- members ---------------- */

function MembersTab({ data, isAdmin, canManage, reload, currentUserId, notify, pendingMemberDetailId, onPendingMemberDetailConsumed }) {
  const [showForm, setShowForm] = useState(false);
  const [showRoles, setShowRoles] = useState(false);
  const [profiles, setProfiles] = useState([]);
  const blank = () => ({ id: null, name: "", email: "", phone: "", unit: "", tier: "", team: "", joinDate: new Date().toISOString().slice(0, 10), skills: { proPresenter: 3, vmix: 3, resolume: 3, technical: 3 }, dues: {} });
  const [form, setForm] = useState(blank());
  const [filterTeam, setFilterTeam] = useState("all");
  const [filterUnit, setFilterUnit] = useState("all");
  const [filterSkill, setFilterSkill] = useState("any");
  const [filterSkillMin, setFilterSkillMin] = useState(3);

  useEffect(() => {
    if (!pendingMemberDetailId) return;
    const member = data.members.find((m) => m.id === pendingMemberDetailId);
    if (member && canManage) {
      setForm(member);
      setShowForm(true);
    }
    onPendingMemberDetailConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingMemberDetailId, data.members.length]);

  async function loadProfiles() {
    const { data } = await supabase.from("profiles").select("*").order("email");
    setProfiles(data || []);
  }

  async function saveMember() {
    if (!form.name.trim()) return;
    const payload = { name: form.name, email: form.email, phone: form.phone, unit: form.unit || null, tier: form.tier || null, team: form.team || null, join_date: form.joinDate, skills: form.skills, dues: form.dues, unavailable: !!form.unavailable, suspended: !!form.suspended };
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
            <Field label="Availability">
              <Btn small tone={form.unavailable ? "danger" : "ghost"} onClick={() => setForm({ ...form, unavailable: !form.unavailable })}>
                {form.unavailable ? "Marked unavailable" : "Available"}
              </Btn>
              {form.unavailable && <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 4 }}>Can't be assigned tickets or roster duty. Dues not expected, chat/notifications unaffected.</div>}
            </Field>
            <Field label="Suspension">
              <Btn small tone={form.suspended ? "danger" : "ghost"} onClick={() => setForm({ ...form, suspended: !form.suspended })}>
                {form.suspended ? "Suspended" : "In good standing"}
              </Btn>
              {form.suspended && <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 4 }}>Can't be assigned tickets or roster duty. Chat/notifications unaffected.</div>}
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

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <select style={{ ...inputStyle, width: "auto" }} value={filterTeam} onChange={(e) => setFilterTeam(e.target.value)}>
          <option value="all">All teams</option>
          <option value="A">Team A</option>
          <option value="B">Team B</option>
          <option value="none">Unassigned</option>
        </select>
        <select style={{ ...inputStyle, width: "auto" }} value={filterUnit} onChange={(e) => setFilterUnit(e.target.value)}>
          <option value="all">All units</option>
          {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          <option value="none">Unassigned</option>
        </select>
        <select style={{ ...inputStyle, width: "auto" }} value={filterSkill} onChange={(e) => setFilterSkill(e.target.value)}>
          <option value="any">Any skill</option>
          <option value="proPresenter">ProPresenter</option>
          <option value="vmix">VMix</option>
          <option value="resolume">Resolume</option>
          <option value="technical">Technical</option>
        </select>
        {filterSkill !== "any" && (
          <select style={{ ...inputStyle, width: "auto" }} value={filterSkillMin} onChange={(e) => setFilterSkillMin(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}+</option>)}
          </select>
        )}
        {(filterTeam !== "all" || filterUnit !== "all" || filterSkill !== "any") && (
          <Btn small tone="ghost" onClick={() => { setFilterTeam("all"); setFilterUnit("all"); setFilterSkill("any"); }}>Clear filters</Btn>
        )}
      </div>

      <Panel>
        {(() => {
          const filteredMembers = data.members.filter((m) => {
            if (filterTeam === "A" && m.team !== "A") return false;
            if (filterTeam === "B" && m.team !== "B") return false;
            if (filterTeam === "none" && m.team) return false;
            if (filterUnit === "none" && m.unit) return false;
            if (filterUnit !== "all" && filterUnit !== "none" && m.unit !== filterUnit) return false;
            if (filterSkill !== "any" && (m.skills?.[filterSkill] ?? 3) < filterSkillMin) return false;
            return true;
          });
          return filteredMembers.length === 0 ? <EmptyRow text="No members match these filters." /> : (
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 560 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr 0.7fr 0.9fr 0.6fr", fontSize: 11, color: COLORS.textMuted, padding: "0 4px 8px", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                <div>Name</div><div>Unit</div><div>Tier</div><div>Team</div><div>Account</div><div></div>
              </div>
              {filteredMembers.map((m) => (
                <div
                  key={m.id}
                  onClick={() => canManage && (setForm(m), setShowForm(true))}
                  className={canManage ? "hldt-row" : undefined}
                  data-clickable={canManage}
                  title={m.unavailable ? "Temporarily unavailable" : undefined}
                  style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr 0.7fr 0.9fr 0.6fr", alignItems: "center", padding: "8px 4px", borderTop: `1px solid ${COLORS.border}`, fontSize: 13, cursor: canManage ? "pointer" : "default", opacity: m.unavailable ? 0.45 : 1 }}
                >
                  <div>
                    <div>{m.name}</div>
                    <div style={{ fontSize: 10, color: COLORS.textMuted, fontFamily: "'JetBrains Mono', monospace" }}>{skillSummary(m)}</div>
                  </div>
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
          );
        })()}
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
    if (!form.memberId) { notify?.("Pick an existing member to start tracking", "error"); return; }
    const member = data.members.find((m) => m.id === form.memberId);
    const { error } = await supabase.from("onboarding").insert({ member_id: form.memberId, name: member.name, start_date: form.startDate, weeks: form.weeks, scores: form.scores, status: form.status });
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
            <Field label="Member"><select style={inputStyle} value={form.memberId} onChange={(e) => setForm({ ...form, memberId: e.target.value })}><option value="">Select a member</option>{data.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
            <Field label="Start date"><input type="date" style={inputStyle} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field>
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

const INVENTORY_CATEGORIES = ["Screen", "Mixer", "Cable", "Computer", "CPU", "Mouse", "Keyboard", "Other"];
const CONDITIONS = ["New", "Good", "Fair", "Poor", "Faulty"];

function InventoryPanel({ notify }) {
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [suggestions, setSuggestions] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [quotaStatus, setQuotaStatus] = useState(null);

  async function loadQuotaStatus() {
    const { data } = await supabase.from("ai_quota_status").select("*").eq("id", 1).maybeSingle();
    setQuotaStatus(data);
  }

  useEffect(() => {
    loadQuotaStatus();
    const channel = supabase
      .channel("ai-quota-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "ai_quota_status" }, loadQuotaStatus)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  const quotaExhausted = quotaStatus?.next_reset_at && new Date(quotaStatus.next_reset_at) > new Date();
  const blank = () => ({ id: null, name: "", category: "Other", quantity: 1, condition: "Good", purchase_date: "", purchase_price: "", estimated_value: "", notes: "" });
  const [form, setForm] = useState(blank());

  async function load() {
    const { data } = await supabase.from("equipment_inventory").select("*").order("category").order("name");
    setItems(data || []);
    setLoaded(true);
  }

  useEffect(() => {
    load();
    const channel = supabase
      .channel("inventory-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "equipment_inventory" }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  async function save() {
    if (!form.name.trim()) return;
    const payload = {
      name: form.name, category: form.category, quantity: Number(form.quantity) || 1, condition: form.condition,
      purchase_date: form.purchase_date || null, purchase_price: form.purchase_price === "" ? null : Number(form.purchase_price),
      estimated_value: form.estimated_value === "" ? null : Number(form.estimated_value), notes: form.notes,
    };
    const { error } = form.id
      ? await supabase.from("equipment_inventory").update(payload).eq("id", form.id)
      : await supabase.from("equipment_inventory").insert(payload);
    if (error) { notify?.(error.message, "error"); return; }
    notify?.(form.id ? "Item updated" : "Item added");
    setForm(blank());
    setShowForm(false);
    load();
  }

  async function remove(id) {
    await supabase.from("equipment_inventory").delete().eq("id", id);
    notify?.("Item removed");
    load();
  }

  function exportCsv() {
    const rows = ["Name,Category,Quantity,Condition,Purchase Date,Purchase Price,Estimated Value,Notes"];
    items.forEach((it) => {
      rows.push([it.name, it.category, it.quantity, it.condition, it.purchase_date || "", it.purchase_price ?? "", it.estimated_value ?? "", (it.notes || "").replace(/"/g, "'")]
        .map((v) => `"${v}"`).join(","));
    });
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `equipment-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function generateSuggestions() {
    setGenerating(true);
    setSuggestions(null);
    const { data, error } = await supabase.functions.invoke("generate-equipment-suggestions");
    if (error || data?.error) {
      notify?.(data?.error || error?.message || "Couldn't generate suggestions", "error");
    } else {
      setSuggestions(data.suggestions || []);
    }
    setGenerating(false);
  }

  function exportRequestDoc() {
    if (!suggestions || suggestions.length === 0) return;
    const lines = [
      "EQUIPMENT REQUEST DOCUMENT",
      `Generated ${new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}`,
      "",
      "=".repeat(50),
      "",
    ];
    suggestions.forEach((s, i) => {
      lines.push(`${i + 1}. ${s.item} [${s.priority} priority] — ${s.recommendedAction}`);
      lines.push(`   Issue: ${s.issue}`);
      lines.push(`   Repair estimate: ${s.repairCostEstimate}`);
      lines.push(`   Replacement estimate: ${s.replacementCostEstimate}`);
      lines.push(`   Notes: ${s.notes}`);
      lines.push("");
    });
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `equipment-request-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function sendChatMessage() {
    const text = chatInput.trim();
    if (!text) return;
    const history = chatMessages.map((m) => ({ role: m.role, text: m.text }));
    setChatMessages((prev) => [...prev, { role: "user", text }]);
    setChatInput("");
    setChatSending(true);
    const { data, error } = await supabase.functions.invoke("equipment-ai-chat", { body: { message: text, history } });
    if (error || data?.error) {
      setChatMessages((prev) => [...prev, { role: "model", text: `⚠ ${data?.error || error?.message || "Something went wrong."}` }]);
    } else {
      setChatMessages((prev) => [...prev, { role: "model", text: data.reply }]);
    }
    setChatSending(false);
  }

  const totalPurchaseValue = items.reduce((sum, it) => sum + (Number(it.purchase_price) || 0) * (it.quantity || 1), 0);
  const totalEstimatedValue = items.reduce((sum, it) => sum + (Number(it.estimated_value) || 0) * (it.quantity || 1), 0);
  const totalItems = items.reduce((sum, it) => sum + (it.quantity || 1), 0);

  const byCategory = {};
  items.forEach((it) => {
    const cat = it.category || "Other";
    byCategory[cat] = (byCategory[cat] || 0) + (Number(it.estimated_value) || Number(it.purchase_price) || 0) * (it.quantity || 1);
  });
  const chartData = Object.entries(byCategory).map(([category, value]) => ({ category, value })).filter((d) => d.value > 0);

  if (!loaded) return <SkeletonLoader />;

  return (
    <div>
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <Metric label="Total items" value={totalItems} />
        <Metric label="Purchase value" value={totalPurchaseValue} isCurrency tone="amber" />
        <Metric label="Estimated value now" value={totalEstimatedValue} isCurrency tone="green" />
      </div>

      {chartData.length > 0 && (
        <Panel title="Value by category" style={{ marginBottom: 16 }}>
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
                <XAxis dataKey="category" stroke={COLORS.textMuted} fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke={COLORS.textMuted} fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: COLORS.surface2, border: `1px solid ${COLORS.border}`, borderRadius: 8, fontSize: 12, color: COLORS.textPrimary }} formatter={(v) => currency(v)} />
                <Bar dataKey="value" fill={COLORS.amber} radius={[4, 4, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
        <Btn tone="ghost" onClick={exportCsv}><Download size={13} /> Export CSV</Btn>
        <Btn tone="ghost" onClick={generateSuggestions} disabled={generating || quotaExhausted}>
          <Sparkles size={13} /> {generating ? "Thinking..." : "AI suggestions"}
        </Btn>
        <Btn tone="ghost" onClick={() => setShowChat(true)} disabled={quotaExhausted}><MessageCircle size={13} /> Ask AI</Btn>
        <Btn tone="amber" onClick={() => { setForm(blank()); setShowForm(true); }}><Plus size={13} /> Add item</Btn>
      </div>
      {quotaExhausted && (
        <div style={{ fontSize: 11, color: COLORS.amber, textAlign: "right", marginBottom: 12 }}>
          Free AI quota used up for today — available again around {new Date(quotaStatus.next_reset_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.
        </div>
      )}

      {suggestions && (
        <Panel title="Suggested requests" style={{ marginBottom: 16 }} right={
          suggestions.length > 0 && <Btn small tone="ghost" onClick={exportRequestDoc}><Download size={12} /> Export request doc</Btn>
        }>
          {suggestions.length === 0 ? (
            <EmptyRow text="Nothing stood out — inventory and open tickets look fine right now." />
          ) : (
            suggestions.map((s, i) => (
              <div key={i} style={{ padding: "10px 0", borderTop: i > 0 ? `1px solid ${COLORS.border}` : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{s.item}</span>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <Badge tone="gray">{s.recommendedAction}</Badge>
                    <Badge tone={s.priority === "High" ? "red" : s.priority === "Medium" ? "amber" : "gray"}>{s.priority}</Badge>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 4 }}>{s.issue}</div>
                <div style={{ display: "flex", gap: 16, fontSize: 11, color: COLORS.textMuted, marginBottom: 4, flexWrap: "wrap" }}>
                  <span>Repair: {s.repairCostEstimate}</span>
                  <span>Replace: {s.replacementCostEstimate}</span>
                </div>
                {s.notes && <div style={{ fontSize: 11, color: COLORS.textMuted, fontStyle: "italic" }}>{s.notes}</div>}
              </div>
            ))
          )}
          <div style={{ fontSize: 10, color: COLORS.textMuted, marginTop: 8 }}>AI-generated from your current inventory and open tickets — review before acting on it.</div>
        </Panel>
      )}

      {showForm && (
        <Panel title={form.id ? "Edit item" : "New item"} style={{ marginBottom: 16 }} right={<X size={16} style={{ cursor: "pointer" }} onClick={() => setShowForm(false)} />}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Name"><input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Category">
              <select style={inputStyle} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {INVENTORY_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Quantity"><input type="number" min={1} style={inputStyle} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></Field>
            <Field label="Condition">
              <select style={inputStyle} value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })}>
                {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Purchase date"><input type="date" style={inputStyle} value={form.purchase_date} onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} /></Field>
            <Field label="Purchase price (₦)"><input type="number" style={inputStyle} value={form.purchase_price} onChange={(e) => setForm({ ...form, purchase_price: e.target.value })} /></Field>
            <Field label="Estimated value now (₦)"><input type="number" style={inputStyle} value={form.estimated_value} onChange={(e) => setForm({ ...form, estimated_value: e.target.value })} /></Field>
          </div>
          <Field label="Notes"><textarea style={{ ...inputStyle, minHeight: 50 }} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn tone="amber" onClick={save}><Save size={13} /> Save</Btn>
            {form.id && <Btn tone="danger" onClick={() => { remove(form.id); setShowForm(false); }}><Trash2 size={13} /> Delete</Btn>}
          </div>
        </Panel>
      )}

      <Panel>
        {items.length === 0 ? <EmptyRow text="No inventory items yet." /> : (
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 640 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 0.6fr 0.8fr 0.9fr 0.9fr", fontSize: 11, color: COLORS.textMuted, padding: "0 4px 8px", textTransform: "uppercase" }}>
                <div>Name</div><div>Category</div><div>Qty</div><div>Condition</div><div>Purchased</div><div>Est. value</div>
              </div>
              {items.map((it) => (
                <div
                  key={it.id}
                  className="hldt-row" data-clickable="true"
                  onClick={() => { setForm({ ...it, purchase_price: it.purchase_price ?? "", estimated_value: it.estimated_value ?? "", purchase_date: it.purchase_date || "" }); setShowForm(true); }}
                  style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 0.6fr 0.8fr 0.9fr 0.9fr", alignItems: "center", padding: "8px 4px", borderTop: `1px solid ${COLORS.border}`, fontSize: 13, cursor: "pointer" }}
                >
                  <div>{it.name}</div>
                  <div style={{ color: COLORS.textSecondary }}>{it.category}</div>
                  <div style={{ color: COLORS.textSecondary }}>{it.quantity}</div>
                  <div><Badge tone={it.condition === "Faulty" || it.condition === "Poor" ? "red" : it.condition === "Fair" ? "amber" : "green"}>{it.condition}</Badge></div>
                  <div style={{ color: COLORS.textSecondary, fontSize: 12 }}>{it.purchase_date || "—"}</div>
                  <div style={{ color: COLORS.textSecondary, fontSize: 12 }}>{it.estimated_value ? currency(it.estimated_value) : "—"}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Panel>

      {showChat && (
        <Modal title="Ask AI about equipment" onClose={() => setShowChat(false)} width={480}>
          <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 10 }}>
            Describe what you need — an upcoming event, a requirement, a problem — and get suggestions grounded in your current inventory and open tickets.
          </div>
          <div style={{ height: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, marginBottom: 10, padding: "4px 2px" }}>
            {chatMessages.length === 0 ? (
              <EmptyRow text={'e.g. "We have a baptism service next month needing extra lighting" or "ProPresenter keeps crashing during transitions, what should we do?"'} />
            ) : (
              chatMessages.map((m, i) => (
                <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "85%" }}>
                  <div style={{
                    background: m.role === "user" ? COLORS.amberDim : COLORS.surface2,
                    color: m.role === "user" ? COLORS.amber : COLORS.textPrimary,
                    padding: "8px 12px", borderRadius: 10, fontSize: 13, whiteSpace: "pre-wrap",
                  }}>
                    {m.text}
                  </div>
                </div>
              ))
            )}
            {chatSending && <div style={{ fontSize: 12, color: COLORS.textMuted, alignSelf: "flex-start" }}>Thinking...</div>}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              style={{ ...inputStyle, flex: 1 }}
              placeholder="Describe what you need..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !chatSending && sendChatMessage()}
            />
            <Btn tone="amber" onClick={sendChatMessage} disabled={chatSending}>Send</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

function EquipmentTab({ data, isAdmin, myMember, canAccessInventory, canDeleteTickets, reload, notify, pendingHighlight, onPendingHighlightConsumed }) {
  const [view, setView] = useState("tickets");
  const [showForm, setShowForm] = useState(false);
  const [highlightedTicketId, setHighlightedTicketId] = useState(null);

  useEffect(() => {
    if (!pendingHighlight || pendingHighlight.tab !== "equipment") return;
    setView("tickets");
    const t = setTimeout(() => {
      const el = document.getElementById(`ticket-${pendingHighlight.id}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setHighlightedTicketId(pendingHighlight.id);
        setTimeout(() => setHighlightedTicketId((cur) => (cur === pendingHighlight.id ? null : cur)), 2200);
      }
    }, 50);
    onPendingHighlightConsumed?.();
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingHighlight]);
  const blank = () => ({ date: new Date().toISOString().slice(0, 10), systems: Object.fromEntries(SYSTEMS.map((s) => [s, "OK"])), description: "" });
  const [form, setForm] = useState(blank());
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [uploading, setUploading] = useState(false);

  function onPhotoSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  async function submit() {
    if (!myMember) { notify?.("No member record linked to your account — ask an admin", "error"); return; }
    setUploading(true);
    let photoUrl = null;
    if (photoFile) {
      const path = `${myMember.id}/${Date.now()}-${photoFile.name}`;
      const { error: upErr } = await supabase.storage.from("ticket-photos").upload(path, photoFile);
      if (upErr) { notify?.(upErr.message, "error"); setUploading(false); return; }
      const { data: pub } = supabase.storage.from("ticket-photos").getPublicUrl(path);
      photoUrl = pub.publicUrl;
    }
    const hasIssue = Object.values(form.systems).includes("Issue");
    const { error } = await supabase.from("tickets").insert({
      reporter: myMember.name, reporter_id: myMember.id, ticket_date: form.date, systems: form.systems,
      description: form.description, status: hasIssue ? "Open" : "Resolved", photo_url: photoUrl,
    });
    setUploading(false);
    if (error) { notify?.(error.message, "error"); return; }
    notify?.(hasIssue ? "Check submitted — issue logged" : "Check submitted — all clear");
    setForm(blank());
    setPhotoFile(null);
    setPhotoPreview(null);
    setShowForm(false);
    reload();
  }

  async function updateStatus(t, status) {
    await supabase.from("tickets").update({ status }).eq("id", t.id);
    notify?.(`Ticket set to "${status}"`);
    reload();
  }

  async function assign(t, memberId) {
    const member = data.members.find((m) => m.id === memberId);
    const payload = { assigned_to_id: memberId || null, assigned_to: member?.name || null };
    if (memberId && t.status !== "Resolved") payload.status = "Assigned";
    await supabase.from("tickets").update(payload).eq("id", t.id);
    reload();
  }

  async function deleteTicket(t) {
    const { error } = await supabase.from("tickets").delete().eq("id", t.id);
    if (error) { notify?.(error.message, "error"); return; }
    notify?.("Ticket deleted");
    reload();
  }

  return (
    <div>
      <SectionHeader
        title="Equipment"
        subtitle={view === "tickets" ? "Pre/post-service system checks and incident tickets" : "Inventory, valuation, and requests — Technical unit"}
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {canAccessInventory && (
              <div style={{ display: "flex", gap: 4, background: COLORS.surface2, borderRadius: 8, padding: 3 }}>
                <Btn small tone={view === "tickets" ? "amber" : "ghost"} onClick={() => setView("tickets")}>Tickets</Btn>
                <Btn small tone={view === "inventory" ? "amber" : "ghost"} onClick={() => setView("inventory")}><Boxes size={12} /> Inventory</Btn>
              </div>
            )}
            {view === "tickets" && <Btn tone="amber" onClick={() => setShowForm(true)}><Plus size={14} /> New check</Btn>}
          </div>
        }
      />

      {view === "inventory" ? (
        <InventoryPanel notify={notify} />
      ) : (
      <>
      {showForm && (
        <Panel title="System check" style={{ marginBottom: 16 }} right={<X size={16} style={{ cursor: "pointer" }} onClick={() => setShowForm(false)} />}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Reporting as">
              <div style={{ ...inputStyle, display: "flex", alignItems: "center", color: myMember ? COLORS.textPrimary : COLORS.red }}>
                {myMember ? myMember.name : "No member record linked"}
              </div>
            </Field>
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
          <Field label="Photo (optional)">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <label style={{ display: "inline-flex" }}>
                <input type="file" accept="image/*" capture="environment" onChange={onPhotoSelected} style={{ display: "none" }} />
                <span style={{ ...inputStyle, display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", width: "auto", padding: "8px 12px" }}>
                  <Camera size={14} /> {photoFile ? "Change photo" : "Add photo"}
                </span>
              </label>
              {photoPreview && <img src={photoPreview} alt="" style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6 }} />}
            </div>
          </Field>
          <Btn tone="amber" onClick={submit} disabled={uploading}>{uploading ? "Uploading..." : (<><Save size={13} /> Submit</>)}</Btn>
        </Panel>
      )}

      {data.tickets.length === 0 ? <Panel><EmptyRow text="All quiet — no checks logged yet. Equipment's either perfect or nobody's looked. 👀" /></Panel> : data.tickets.map((t) => {
        const issues = SYSTEMS.filter((s) => t.systems[s] === "Issue");
        return (
          <Panel key={t.id} style={{ marginBottom: 12, transition: "box-shadow 400ms ease", boxShadow: highlightedTicketId === t.id ? `0 0 0 2px ${COLORS.amber}` : "none" }}>
            <div id={`ticket-${t.id}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8, gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{t.reporter} <span style={{ color: COLORS.textMuted, fontWeight: 400 }}>· {t.date}</span></div>
                {issues.length > 0 ? <div style={{ fontSize: 12, color: COLORS.red, marginTop: 2 }}>Issues: {issues.join(", ")}</div> : <div style={{ fontSize: 12, color: COLORS.green, marginTop: 2 }}>All systems OK</div>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <Badge tone={t.status === "Resolved" ? "green" : t.status === "Open" ? "red" : "amber"}>{t.status}</Badge>
                {canDeleteTickets && <Trash2 size={14} style={{ cursor: "pointer", color: COLORS.textMuted }} onClick={() => deleteTicket(t)} />}
              </div>
            </div>
            {t.photoUrl && <img src={t.photoUrl} alt="" style={{ maxWidth: 200, maxHeight: 150, borderRadius: 8, marginBottom: 8, display: "block", cursor: "pointer" }} onClick={() => window.open(t.photoUrl, "_blank")} />}
            {t.description && <div style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 8 }}>{t.description}</div>}
            {isAdmin && issues.length > 0 && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {TICKET_STATUSES.map((s) => <Btn key={s} small tone={t.status === s ? "amber" : "ghost"} onClick={() => updateStatus(t, s)}>{s}</Btn>)}
                <select value={t.assignedToId || ""} onChange={(e) => assign(t, e.target.value)} style={{ ...inputStyle, width: 150, fontSize: 12, padding: "5px 8px" }}>
                  <option value="">Assign to...</option>
                  {data.members.filter((m) => !m.unavailable && !m.suspended).map((m) => <option key={m.id} value={m.id}>{m.name} (Tech {m.skills?.technical ?? 3})</option>)}
                </select>
              </div>
            )}
          </Panel>
        );
      })}
      </>
      )}
    </div>
  );
}

/* ---------------- roster ---------------- */

function TuesdayRosterEditor({ existing, members, onClose, onSaved, notify }) {
  const [eventDate, setEventDate] = useState(existing?.eventDate || "");
  const [items, setItems] = useState(existing?.items?.length ? existing.items : TUESDAY_TEMPLATE.map((t, i) => ({ ...t, position: i, assigned_member_id: "", assigned_name: "" })));
  const [published, setPublished] = useState(existing?.published || false);

  function updateItem(idx, patch) {
    setItems(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function addItem() {
    setItems([...items, { title: "", duration_minutes: 5, position: items.length, assigned_member_id: "", assigned_name: "" }]);
  }
  function removeItem(idx) {
    setItems(items.filter((_, i) => i !== idx));
  }

  async function save() {
    if (!eventDate) { notify?.("Pick a date", "error"); return; }
    let rosterId = existing?.id;
    if (rosterId) {
      const { error } = await supabase.from("tuesday_rosters").update({ event_date: eventDate, published }).eq("id", rosterId);
      if (error) { notify?.(error.message, "error"); return; }
      await supabase.from("tuesday_roster_items").delete().eq("roster_id", rosterId);
    } else {
      const { data: created, error } = await supabase.from("tuesday_rosters").insert({ event_date: eventDate, published }).select().single();
      if (error) { notify?.(error.message, "error"); return; }
      rosterId = created.id;
    }
    const rows = items.map((it, i) => ({
      roster_id: rosterId, position: i, title: it.title, duration_minutes: it.duration_minutes || null,
      assigned_member_id: it.assigned_member_id || null, assigned_name: it.assigned_name || null,
    }));
    if (rows.length) {
      const { error } = await supabase.from("tuesday_roster_items").insert(rows);
      if (error) { notify?.(error.message, "error"); return; }
    }
    notify?.(existing ? "Tuesday roster updated" : "Tuesday roster created");
    onSaved();
    onClose();
  }

  return (
    <Modal title={existing ? "Edit Tuesday roster" : "New Tuesday roster"} onClose={onClose} width={520} footer={<><Btn tone="ghost" onClick={onClose}>Cancel</Btn><Btn tone="amber" onClick={save}><Save size={13} /> Save</Btn></>}>
      <Field label="Date"><input type="date" style={inputStyle} value={eventDate} onChange={(e) => setEventDate(e.target.value)} /></Field>
      <div style={{ fontSize: 12, color: COLORS.textSecondary, margin: "10px 0 6px" }}>Flow</div>
      {items.map((it, idx) => (
        <div key={idx} style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center" }}>
          <input style={{ ...inputStyle, flex: 2 }} placeholder="Item title" value={it.title} onChange={(e) => updateItem(idx, { title: e.target.value })} />
          <input type="number" style={{ ...inputStyle, width: 56 }} value={it.duration_minutes || ""} onChange={(e) => updateItem(idx, { duration_minutes: Number(e.target.value) })} />
          <select style={{ ...inputStyle, flex: 1.3 }} value={it.assigned_member_id || ""} onChange={(e) => { const mem = members.find((m) => m.id === e.target.value); updateItem(idx, { assigned_member_id: e.target.value, assigned_name: mem?.name || "" }); }}>
            <option value="">Unassigned</option>
            {members.filter((m) => !m.unavailable && !m.suspended).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <Trash2 size={14} style={{ cursor: "pointer", color: COLORS.textMuted, flexShrink: 0 }} onClick={() => removeItem(idx)} />
        </div>
      ))}
      <Btn small tone="ghost" onClick={addItem}><Plus size={12} /> Add item</Btn>
      <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 8 }}>
        <Btn small tone={published ? "amber" : "ghost"} onClick={() => setPublished(!published)}>
          {published ? <Eye size={12} /> : <EyeOff size={12} />} {published ? "Published" : "Draft"}
        </Btn>
        <span style={{ fontSize: 11, color: COLORS.textMuted }}>{published ? "Visible to everyone" : "Only visible to roster managers"}</span>
      </div>
    </Modal>
  );
}

function SaturdayRosterEditor({ existing, members, onClose, onSaved, notify }) {
  const [eventDate, setEventDate] = useState(existing?.eventDate || "");
  const [callTime, setCallTime] = useState(existing?.callTime || "9:50 AM");
  const [duration, setDuration] = useState(existing?.durationMinutes || 120);
  const [notes, setNotes] = useState(existing?.focusNotes || "");
  const [trainerIds, setTrainerIds] = useState(existing?.trainers?.map((t) => t.memberId).filter(Boolean) || []);
  const [published, setPublished] = useState(existing?.published || false);

  function toggleTrainer(id) {
    setTrainerIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function save() {
    if (!eventDate) { notify?.("Pick a date", "error"); return; }
    let rosterId = existing?.id;
    const payload = { event_date: eventDate, call_time: callTime, duration_minutes: Number(duration), focus_notes: notes, published };
    if (rosterId) {
      const { error } = await supabase.from("saturday_rosters").update(payload).eq("id", rosterId);
      if (error) { notify?.(error.message, "error"); return; }
      await supabase.from("saturday_roster_trainers").delete().eq("roster_id", rosterId);
    } else {
      const { data: created, error } = await supabase.from("saturday_rosters").insert(payload).select().single();
      if (error) { notify?.(error.message, "error"); return; }
      rosterId = created.id;
    }
    const rows = trainerIds.map((id) => ({ roster_id: rosterId, member_id: id, name: members.find((m) => m.id === id)?.name || "" }));
    if (rows.length) {
      const { error } = await supabase.from("saturday_roster_trainers").insert(rows);
      if (error) { notify?.(error.message, "error"); return; }
    }
    notify?.(existing ? "Saturday roster updated" : "Saturday roster created");
    onSaved();
    onClose();
  }

  return (
    <Modal title={existing ? "Edit Saturday roster" : "New Saturday roster"} onClose={onClose} width={460} footer={<><Btn tone="ghost" onClick={onClose}>Cancel</Btn><Btn tone="amber" onClick={save}><Save size={13} /> Save</Btn></>}>
      <Field label="Date"><input type="date" style={inputStyle} value={eventDate} onChange={(e) => setEventDate(e.target.value)} /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Call time"><input style={inputStyle} value={callTime} onChange={(e) => setCallTime(e.target.value)} /></Field>
        <Field label="Duration (minutes)"><input type="number" style={inputStyle} value={duration} onChange={(e) => setDuration(e.target.value)} /></Field>
      </div>
      <Field label="Trainers this week">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {members.filter((m) => !m.unavailable && !m.suspended).map((m) => (
            <Btn key={m.id} small tone={trainerIds.includes(m.id) ? "amber" : "ghost"} onClick={() => toggleTrainer(m.id)}>
              {m.name} · {(((m.skills?.proPresenter ?? 3) + (m.skills?.vmix ?? 3) + (m.skills?.resolume ?? 3) + (m.skills?.technical ?? 3)) / 4).toFixed(1)}
            </Btn>
          ))}
        </div>
      </Field>
      <Field label="Focus notes (choir, lyrics, announcements, etc.)">
        <textarea style={{ ...inputStyle, minHeight: 70 }} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Btn small tone={published ? "amber" : "ghost"} onClick={() => setPublished(!published)}>
          {published ? <Eye size={12} /> : <EyeOff size={12} />} {published ? "Published" : "Draft"}
        </Btn>
        <span style={{ fontSize: 11, color: COLORS.textMuted }}>{published ? "Visible to everyone" : "Only visible to roster managers"}</span>
      </div>
    </Modal>
  );
}

const EVENT_TYPE_LABELS = { sunday: "Sunday service", midweek: "Wednesday midweek", tuesday: "Tuesday meeting", saturday: "Saturday training" };

function AttendanceTab({ data, canManageRosters, myMember, notify }) {
  const [records, setRecords] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [eventType, setEventType] = useState("sunday");
  const [eventDate, setEventDate] = useState(new Date().toISOString().slice(0, 10));
  const [showMark, setShowMark] = useState(false);
  const [draft, setDraft] = useState({});
  const [summaryFor, setSummaryFor] = useState(null);
  const [summaryResult, setSummaryResult] = useState(null);
  const [aiPending, setAiPending] = useState(false);

  const MIN_PRESENT_TARGET = 8;

  function computeStats(member) {
    const now = new Date();
    const thisMonth = now.toISOString().slice(0, 7);
    const memberRecords = records.filter((r) => r.member_id === member.id && r.event_date.slice(0, 7) === thisMonth);
    const allThisMonth = records.filter((r) => r.event_date.slice(0, 7) === thisMonth);

    const present = memberRecords.filter((r) => r.status === "present").length;
    const absent = memberRecords.filter((r) => r.status === "absent").length;
    const excused = memberRecords.filter((r) => r.status === "excused").length;

    const allEvents = new Set(allThisMonth.map((r) => `${r.event_type}|${r.event_date}`));
    const eventsSinceJoin = new Set(
      allThisMonth.filter((r) => !member.joinDate || r.event_date >= member.joinDate).map((r) => `${r.event_type}|${r.event_date}`)
    );
    const proratedMinimum = allEvents.size > 0 ? Math.round((MIN_PRESENT_TARGET * eventsSinceJoin.size) / allEvents.size) : MIN_PRESENT_TARGET;

    const nonExcused = memberRecords.filter((r) => r.status !== "excused").sort((a, b) => a.event_date.localeCompare(b.event_date));
    let currentConsecutiveAbsences = 0;
    for (let i = nonExcused.length - 1; i >= 0; i--) {
      if (nonExcused[i].status === "absent") currentConsecutiveAbsences++;
      else break;
    }

    const excusableAbsences = memberRecords.filter((r) => r.status === "absent");

    return {
      present, absent, excused,
      proratedMinimum, metMinimum: present >= proratedMinimum,
      currentConsecutiveAbsences, excusableAbsences,
    };
  }

  function fallbackRecommendation(stats) {
    if (stats.absent >= 4) return { recommendation: "Suspension already triggered", reasoning: "4 or more absences this month automatically triggers the suspension notice." };
    if (stats.absent >= 3) return { recommendation: "Formal warning already triggered", reasoning: "3 absences this month automatically triggers a second warning." };
    if (stats.currentConsecutiveAbsences >= 2) return { recommendation: "Formal warning already triggered", reasoning: "2 consecutive absences automatically triggers a warning." };
    if (!stats.metMinimum) return { recommendation: "Informal check-in recommended", reasoning: `Below the prorated minimum of ${stats.proratedMinimum} presences this month.` };
    return { recommendation: "No action needed", reasoning: "Meeting expectations this month." };
  }

  async function openSummary(member) {
    const stats = computeStats(member);
    const fb = fallbackRecommendation(stats);
    setSummaryFor(member);
    setSummaryResult({
      stats,
      summary: `${member.name}: ${stats.present} present, ${stats.absent} absent, ${stats.excused} excused this month (target: ${stats.proratedMinimum}+ present).`,
      recommendation: fb.recommendation,
      reasoning: fb.reasoning,
      isAi: false,
    });
    setAiPending(true);
    const { data: result, error } = await supabase.functions.invoke("attendance-ai-summary", { body: { memberId: member.id } });
    setAiPending(false);
    if (!error && result && !result.error && result.summary) {
      setSummaryResult((prev) => (prev && prev.stats === stats ? { stats: result.stats, summary: result.summary, recommendation: result.recommendation, reasoning: result.reasoning, isAi: true, excusableAbsences: stats.excusableAbsences } : prev));
    }
  }

  async function excuseAbsence(recordId) {
    const { error } = await supabase.rpc("excuse_attendance", { p_record_id: recordId });
    if (error) { notify?.(error.message, "error"); return; }
    notify?.("Marked excused");
    load();
    if (summaryFor) openSummary(summaryFor);
  }

  const [editingBatch, setEditingBatch] = useState(null);
  const [editForm, setEditForm] = useState({ eventType: "sunday", eventDate: "" });

  function openEditBatch(batch) {
    setEditingBatch(batch);
    setEditForm({ eventType: batch.eventType, eventDate: batch.eventDate });
  }

  async function saveEditBatch() {
    const { error } = await supabase.rpc("edit_attendance_event", {
      p_old_event_type: editingBatch.eventType,
      p_old_event_date: editingBatch.eventDate,
      p_new_event_type: editForm.eventType,
      p_new_event_date: editForm.eventDate,
    });
    if (error) { notify?.(error.message, "error"); return; }
    notify?.("Event corrected");
    setEditingBatch(null);
    load();
  }

  async function load() {
    const { data: rows } = await supabase.from("attendance_records").select("*").order("event_date", { ascending: false });
    setRecords(rows || []);
    setLoaded(true);
  }

  useEffect(() => {
    load();
    const channel = supabase
      .channel("attendance-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance_records" }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  function openMarking() {
    const existing = {};
    records
      .filter((r) => r.event_type === eventType && r.event_date === eventDate)
      .forEach((r) => { existing[r.member_id] = r.status; });
    setDraft(existing);
    setShowMark(true);
  }

  async function saveMarking() {
    const rows = Object.entries(draft).map(([member_id, status]) => ({
      event_type: eventType, event_date: eventDate, member_id, status,
    }));
    if (rows.length === 0) { setShowMark(false); return; }
    const { error } = await supabase.from("attendance_records").upsert(rows, { onConflict: "event_type,event_date,member_id" });
    if (error) { notify?.(error.message, "error"); return; }
    notify?.("Attendance saved");
    setShowMark(false);
    load();
  }

  const summary = useMemo(() => {
    const byMember = {};
    records.forEach((r) => {
      if (!byMember[r.member_id]) byMember[r.member_id] = { present: 0, absent: 0, excused: 0 };
      byMember[r.member_id][r.status]++;
    });
    return data.members
      .map((m) => ({ m, counts: byMember[m.id] || { present: 0, absent: 0, excused: 0 } }))
      .filter((x) => x.counts.present + x.counts.absent + x.counts.excused > 0)
      .sort((a, b) => (b.counts.present + b.counts.excused) - (a.counts.present + a.counts.excused) || a.m.name.localeCompare(b.m.name));
  }, [records, data.members]);

  const recentDates = useMemo(() => {
    const seen = new Map();
    records.forEach((r) => {
      const key = `${r.event_type}|${r.event_date}`;
      if (!seen.has(key)) seen.set(key, { eventType: r.event_type, eventDate: r.event_date, count: 0, latestCreated: r.created_at });
      const entry = seen.get(key);
      entry.count++;
      if (r.created_at > entry.latestCreated) entry.latestCreated = r.created_at;
    });
    return Array.from(seen.values()).sort((a, b) => b.eventDate.localeCompare(a.eventDate)).slice(0, 10);
  }, [records]);

  if (!loaded) return <SkeletonLoader />;

  return (
    <div>
      <SectionHeader
        title="Attendance"
        subtitle="Who actually showed up, separate from who was scheduled. Click a name for their summary."
        right={canManageRosters && <Btn tone="amber" onClick={() => setShowMark(true)}><Plus size={14} /> Mark attendance</Btn>}
      />

      {showMark && (
        <Panel title="Mark attendance" style={{ marginBottom: 16 }} right={<X size={16} style={{ cursor: "pointer" }} onClick={() => setShowMark(false)} />}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <Field label="Event">
              <select style={inputStyle} value={eventType} onChange={(e) => setEventType(e.target.value)}>
                {Object.entries(EVENT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Date"><input type="date" style={inputStyle} value={eventDate} onChange={(e) => setEventDate(e.target.value)} /></Field>
          </div>
          <Btn small tone="ghost" onClick={openMarking}><RefreshCw size={12} /> Load existing marks for this date</Btn>
          <div style={{ marginTop: 14, maxHeight: 340, overflowY: "auto" }}>
            {data.members.filter((m) => !m.unavailable && !m.suspended).map((m) => (
              <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: `1px solid ${COLORS.border}` }}>
                <span style={{ flex: 1, fontSize: 13 }}>{m.name}</span>
                {["present", "absent", "excused"].map((s) => (
                  <Btn key={s} small tone={draft[m.id] === s ? (s === "present" ? "amber" : s === "absent" ? "danger" : "default") : "ghost"} onClick={() => setDraft({ ...draft, [m.id]: s })}>
                    {s === "present" ? "Present" : s === "absent" ? "Absent" : "Excused"}
                  </Btn>
                ))}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14 }}>
            <Btn tone="amber" onClick={saveMarking}><Save size={13} /> Save attendance</Btn>
          </div>
        </Panel>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16, alignItems: "start" }}>
        <Panel title="Attendance summary">
          {summary.length === 0 ? (
            <EmptyRow text="No attendance recorded yet." />
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1.6fr 0.7fr 0.7fr 0.7fr", fontSize: 11, color: COLORS.textMuted, textTransform: "uppercase", padding: "0 4px 8px" }}>
                <div>Name</div><div>Present</div><div>Absent</div><div>Excused</div>
              </div>
              {summary.map(({ m, counts }) => (
                <div
                  key={m.id}
                  className="hldt-row" data-clickable="true"
                  onClick={() => openSummary(m)}
                  style={{ display: "grid", gridTemplateColumns: "1.6fr 0.7fr 0.7fr 0.7fr", alignItems: "center", padding: "6px 4px", borderTop: `1px solid ${COLORS.border}`, fontSize: 13, cursor: "pointer", borderRadius: 8 }}
                >
                  <div>{m.name}</div>
                  <div style={{ color: COLORS.green }}>{counts.present}</div>
                  <div style={{ color: COLORS.red }}>{counts.absent}</div>
                  <div style={{ color: COLORS.textMuted }}>{counts.excused}</div>
                </div>
              ))}
            </>
          )}
        </Panel>
        <Panel title="Recently marked">
          {recentDates.length === 0 ? (
            <EmptyRow text="Nothing marked yet." />
          ) : (
            recentDates.map((d, i) => {
              const editable = canManageRosters;
              return (
                <RowLine key={i}>
                  <span style={{ flex: 1 }}>{EVENT_TYPE_LABELS[d.eventType]}</span>
                  <span style={{ fontSize: 11, color: COLORS.textMuted, marginRight: editable ? 8 : 0 }}>{d.eventDate} · {d.count} marked</span>
                  {editable && (
                    <Pencil size={13} style={{ cursor: "pointer", color: COLORS.textMuted }} onClick={() => openEditBatch(d)} />
                  )}
                </RowLine>
              );
            })
          )}
        </Panel>
      </div>

      {editingBatch && (
        <Modal title="Fix the event" onClose={() => setEditingBatch(null)} width={340}>
          <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 12 }}>
            Corrects all {editingBatch.count} marks currently filed under {EVENT_TYPE_LABELS[editingBatch.eventType]} · {editingBatch.eventDate}.
          </div>
          <Field label="Event">
            <select style={inputStyle} value={editForm.eventType} onChange={(e) => setEditForm({ ...editForm, eventType: e.target.value })}>
              {Object.entries(EVENT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Date"><input type="date" style={inputStyle} value={editForm.eventDate} onChange={(e) => setEditForm({ ...editForm, eventDate: e.target.value })} /></Field>
          <Btn tone="amber" onClick={saveEditBatch}><Save size={13} /> Save correction</Btn>
        </Modal>
      )}

      {summaryFor && summaryResult && (
        <Modal title={summaryFor.name} onClose={() => { setSummaryFor(null); setSummaryResult(null); }} width={420}>
          <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            <Badge tone="green">{summaryResult.stats.present} present</Badge>
            <Badge tone="red">{summaryResult.stats.absent} absent</Badge>
            <Badge tone="gray">{summaryResult.stats.excused} excused</Badge>
            <Badge tone={summaryResult.stats.metMinimum ? "green" : "amber"}>
              {summaryResult.stats.metMinimum ? "Meets" : "Below"} minimum ({summaryResult.stats.proratedMinimum})
            </Badge>
          </div>
          <div style={{ fontSize: 13, color: COLORS.textPrimary, marginBottom: 4, lineHeight: 1.5 }}>{summaryResult.summary}</div>
          {aiPending && <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 10 }}>Refining with AI...</div>}
          <Panel style={{ background: COLORS.glass2, marginTop: 10 }}>
            <div style={{ fontSize: 11, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>Recommended measure</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.amber, marginBottom: 4 }}>{summaryResult.recommendation}</div>
            <div style={{ fontSize: 12, color: COLORS.textSecondary }}>{summaryResult.reasoning}</div>
          </Panel>
          {summaryResult.stats.excusableAbsences?.length > 0 && canManageRosters && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>Absences this month (can be pardoned)</div>
              {summaryResult.stats.excusableAbsences.map((r) => (
                <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: `1px solid ${COLORS.border}` }}>
                  <span style={{ flex: 1, fontSize: 12 }}>{EVENT_TYPE_LABELS[r.event_type]} · {r.event_date}</span>
                  <Btn small tone="ghost" onClick={() => excuseAbsence(r.id)}>Pardon</Btn>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function nextUpcomingDate(eventDates) {
  const today = todayStringWAT();
  const future = eventDates.map((d) => d.date).filter((d) => d >= today).sort();
  return future[0] || null;
}

function countdownLabel(eventDates) {
  const today = todayStringWAT();
  const allPast = eventDates.every((d) => d.date < today);
  if (allPast) {
    const lastDate = eventDates.map((d) => d.date).sort().slice(-1)[0];
    const diffDays = Math.round((new Date(today + "T00:00:00Z") - new Date(lastDate + "T00:00:00Z")) / 86400000);
    return { text: `${diffDays}d ago`, tone: "gray" };
  }
  const next = nextUpcomingDate(eventDates);
  const diffDays = Math.round((new Date(next + "T00:00:00Z") - new Date(today + "T00:00:00Z")) / 86400000);
  if (diffDays === 0) return { text: "Today!", tone: "amber" };
  if (diffDays === 1) return { text: "Tomorrow", tone: "amber" };
  if (diffDays <= 7) return { text: `In ${diffDays} days`, tone: "amber" };
  return { text: `In ${diffDays} days`, tone: "gray" };
}

function formatDateShort(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

// Time is stored as 24h "HH:MM" (from a native time input) — display
// it friendlier, e.g. "14:00" -> "2:00 PM". Events created before this
// structured input existed may still hold old free-text like "6:00 AM"
// — that doesn't match the strict pattern, so it's shown as-is instead
// of being force-parsed into NaN.
function formatTime12h(hhmm) {
  if (!hhmm) return "";
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return hhmm;
  const h = Number(match[1]), m = Number(match[2]);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

// Groups consecutive dates into ranges, e.g. [9,10,11,13] -> "Sep 9-11, Sep 13".
// A range only collapses to "start-end" when every date inside it shares
// the same time (or none do) — otherwise each date is listed on its own
// so a differing time per day isn't silently hidden.
function formatEventDates(eventDates) {
  const sorted = [...eventDates].sort((a, b) => a.date.localeCompare(b.date));
  const groups = [];
  let current = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prevDay = new Date(sorted[i - 1].date + "T00:00:00Z");
    const thisDay = new Date(sorted[i].date + "T00:00:00Z");
    const isConsecutive = (thisDay - prevDay) === 86400000;
    const sameTime = sorted[i].time === current[0].time;
    if (isConsecutive && sameTime) {
      current.push(sorted[i]);
    } else {
      groups.push(current);
      current = [sorted[i]];
    }
  }
  groups.push(current);

  return groups.map((g) => {
    const label = g.length === 1 ? formatDateShort(g[0].date) : `${formatDateShort(g[0].date)}-${formatDateShort(g[g.length - 1].date).split(" ").pop()}`;
    return g[0].time ? `${label}, ${formatTime12h(g[0].time)}` : label;
  }).join(" · ");
}

function isVideoUrl(url) {
  return /\.(mp4|mov|webm)(\?|$)/i.test(url || "");
}

// Shared between the upload preview and every place a thumbnail
// actually displays, so the crop you frame is genuinely the crop
// you get — a fixed pixel height (as this used to be) lets the
// effective width-to-height ratio balloon out on wide screens,
// revealing far more of the photo than was visible while framing it.
const EVENT_THUMBNAIL_ASPECT = "1.91 / 1";

function ImageFramePicker({ src, focusX, focusY, onChange }) {
  const boxRef = useRef(null);
  function handlePick(e) {
    const rect = boxRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const x = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100));
    onChange(x, y);
  }
  return (
    <div>
      <div
        ref={boxRef}
        onClick={handlePick}
        style={{ position: "relative", width: "100%", aspectRatio: EVENT_THUMBNAIL_ASPECT, borderRadius: 8, overflow: "hidden", cursor: "crosshair", marginTop: 8 }}
      >
        <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: `${focusX}% ${focusY}%`, display: "block" }} />
        <div style={{ position: "absolute", left: `${focusX}%`, top: `${focusY}%`, width: 14, height: 14, marginLeft: -7, marginTop: -7, borderRadius: 999, border: "2px solid white", boxShadow: "0 0 0 1px rgba(0,0,0,0.4)", pointerEvents: "none" }} />
      </div>
      <div style={{ fontSize: 10, color: COLORS.textMuted, marginTop: 4 }}>Tap anywhere on the image to set what stays in frame.</div>
    </div>
  );
}

const REMINDER_OPTIONS = [
  { id: "2_days_before", label: "2 days before" },
  { id: "1_day_before", label: "1 day before" },
  { id: "day_of_9am", label: "Day of, 9am" },
  { id: "2_hours_before", label: "2 hours before", needsTime: true },
  { id: "1_hour_before", label: "1 hour before", needsTime: true },
];

const NORMAL_EVENT_BY_DOW = { 0: "Sunday Service", 2: "Tuesday Meeting", 3: "Wednesday Midweek", 6: "Saturday Training" };

function EventCalendar({ events, roles, members, session, notify }) {
  const [monthCursor, setMonthCursor] = useState(() => {
    const t = nowWAT();
    return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1));
  });
  const [selectedDate, setSelectedDate] = useState(null);
  const [mySubs, setMySubs] = useState([]);

  async function loadSubs() {
    const { data } = await supabase.from("event_reminder_subscriptions").select("*").eq("profile_id", session.user.id);
    setMySubs(data || []);
  }
  useEffect(() => { loadSubs(); }, []);

  const year = monthCursor.getUTCFullYear();
  const month = monthCursor.getUTCMonth();
  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const startWeekday = firstOfMonth.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const today = todayStringWAT();

  const specialByDate = {};
  events.forEach((ev) => {
    (ev.event_dates || []).forEach((d) => {
      if (!specialByDate[d.date]) specialByDate[d.date] = [];
      specialByDate[d.date].push({ event: ev, occurrence: d });
    });
  });

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(`${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }

  async function toggleReminder(eventId, eventDate, reminderType) {
    const existing = mySubs.find((s) => s.event_id === eventId && s.event_date === eventDate && s.reminder_type === reminderType);
    if (existing) {
      await supabase.from("event_reminder_subscriptions").delete().eq("id", existing.id);
    } else {
      const countForOccurrence = mySubs.filter((s) => s.event_id === eventId && s.event_date === eventDate).length;
      if (countForOccurrence >= 2) { notify?.("You can pick up to 2 reminders per event", "error"); return; }
      const { error } = await supabase.from("event_reminder_subscriptions").insert({ event_id: eventId, event_date: eventDate, profile_id: session.user.id, reminder_type: reminderType });
      if (error) { notify?.(error.message, "error"); return; }
    }
    loadSubs();
  }

  const normalLabel = selectedDate ? NORMAL_EVENT_BY_DOW[new Date(selectedDate + "T00:00:00Z").getUTCDay()] : null;
  const specialsToday = selectedDate ? (specialByDate[selectedDate] || []) : [];

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <Btn small tone="ghost" onClick={() => setMonthCursor(new Date(Date.UTC(year, month - 1, 1)))}><ChevronLeft size={14} /></Btn>
        <div style={{ fontWeight: 700, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          {firstOfMonth.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}
        </div>
        <Btn small tone="ghost" onClick={() => setMonthCursor(new Date(Date.UTC(year, month + 1, 1)))}><ChevronRight size={14} /></Btn>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, fontSize: 10, color: COLORS.textMuted, textAlign: "center", marginBottom: 4 }}>
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i}>{d}</div>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {cells.map((dateStr, i) => {
          if (!dateStr) return <div key={i} />;
          const dow = new Date(dateStr + "T00:00:00Z").getUTCDay();
          const hasNormal = dow in NORMAL_EVENT_BY_DOW;
          const hasSpecial = !!specialByDate[dateStr];
          const isToday = dateStr === today;
          const dayNum = Number(dateStr.slice(-2));
          return (
            <div
              key={i}
              onClick={() => setSelectedDate(dateStr)}
              className="hldt-panel-hover"
              style={{
                aspectRatio: "1", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                borderRadius: 8, cursor: "pointer", fontSize: 12,
                background: isToday ? COLORS.amberDim : hasSpecial ? "rgba(232,163,61,0.08)" : hasNormal ? COLORS.glass2 : "transparent",
                border: `1px solid ${isToday ? COLORS.amber : COLORS.border}`,
              }}
            >
              <span style={{ color: isToday ? COLORS.amber : COLORS.textPrimary, fontWeight: isToday ? 700 : 400 }}>{dayNum}</span>
              <div style={{ display: "flex", gap: 2, marginTop: 2 }}>
                {hasNormal && <span style={{ width: 4, height: 4, borderRadius: 999, background: COLORS.green }} />}
                {hasSpecial && <span style={{ width: 4, height: 4, borderRadius: 999, background: COLORS.amber }} />}
              </div>
            </div>
          );
        })}
      </div>

      {selectedDate && (
        <Modal title={formatDateShort(selectedDate)} onClose={() => setSelectedDate(null)} width={380}>
          {normalLabel && (
            <div style={{ marginBottom: specialsToday.length ? 14 : 0 }}>
              <Badge tone="green">{normalLabel}</Badge>
            </div>
          )}
          {specialsToday.length === 0 && !normalLabel && <EmptyRow text="Nothing scheduled." />}
          {specialsToday.map(({ event: ev, occurrence }, idx) => {
            const eventRoles = roles.filter((r) => r.event_id === ev.id && (!r.event_date || r.event_date === selectedDate));
            const subsForThis = mySubs.filter((s) => s.event_id === ev.id && s.event_date === selectedDate);
            return (
              <div key={idx} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: idx < specialsToday.length - 1 ? `1px solid ${COLORS.border}` : "none" }}>
                {ev.thumbnail_url && (
                  isVideoUrl(ev.thumbnail_url) ? (
                    <video src={ev.thumbnail_url} controls style={{ width: "100%", maxHeight: 120, borderRadius: 8, marginBottom: 8 }} />
                  ) : (
                    <img src={ev.thumbnail_url} alt="" style={{ width: "100%", aspectRatio: EVENT_THUMBNAIL_ASPECT, objectFit: "cover", objectPosition: `${ev.thumbnail_focus_x ?? 50}% ${ev.thumbnail_focus_y ?? 50}%`, borderRadius: 8, marginBottom: 8 }} />
                  )
                )}
                <div style={{ fontWeight: 700, fontSize: 15 }}>{ev.title}</div>
                <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 6 }}>
                  {occurrence.time ? formatTime12h(occurrence.time) : "No time set"}{ev.location ? ` · ${ev.location}` : ""}
                </div>
                {ev.description && <div style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 8 }}>{ev.description}</div>}
                {eventRoles.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    {eventRoles.map((r) => {
                      const assignee = members.find((m) => m.id === r.assigned_member_id);
                      return <div key={r.id} style={{ fontSize: 12, color: COLORS.textSecondary }}>{r.role_name}: {assignee?.name || "Unassigned"}</div>;
                    })}
                  </div>
                )}
                <div style={{ fontSize: 11, color: COLORS.textMuted, textTransform: "uppercase", marginBottom: 6 }}>Remind me (up to 2)</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {REMINDER_OPTIONS.filter((o) => !o.needsTime || occurrence.time).map((opt) => {
                    const active = subsForThis.some((s) => s.reminder_type === opt.id);
                    return (
                      <Btn key={opt.id} small tone={active ? "amber" : "ghost"} onClick={() => toggleReminder(ev.id, selectedDate, opt.id)}>
                        {opt.label}
                      </Btn>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </Modal>
      )}
    </div>
  );
}

function SpecialEventsTab({ data, canManageEvents, myUnit, session, notify }) {
  const isMobile = useIsMobile();
  const [events, setEvents] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState("list");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ title: "", description: "", location: "" });
  const [dateList, setDateList] = useState([]);
  const [singleDate, setSingleDate] = useState("");
  const [singleTime, setSingleTime] = useState("");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [rangeTime, setRangeTime] = useState("");
  const [mediaFile, setMediaFile] = useState(null);
  const [mediaFocusX, setMediaFocusX] = useState(50);
  const [mediaFocusY, setMediaFocusY] = useState(50);
  const [mediaPreview, setMediaPreview] = useState(null);
  const [existingThumbnail, setExistingThumbnail] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const [newRoleName, setNewRoleName] = useState({});
  const [newRoleDate, setNewRoleDate] = useState({});

  async function load() {
    const [{ data: ev }, { data: rl }] = await Promise.all([
      supabase.from("special_events").select("*").order("created_at"),
      supabase.from("special_event_roles").select("*"),
    ]);
    setEvents(ev || []);
    setRoles(rl || []);
    setLoaded(true);
  }

  useEffect(() => {
    load();
    const channel = supabase
      .channel("special-events-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "special_events" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "special_event_roles" }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  function ownsEvent(ev) {
    const creator = data.members.find((m) => m.profileId === ev.created_by);
    return canManageEvents && creator?.unit === myUnit;
  }

  // Operations can delete any event and manage roles on any event,
  // regardless of who created it — editing the event's own details
  // (title/date/location/thumbnail) stays scoped to same-unit-owns-it.
  const opsOverride = canManageEvents && myUnit === "Operations";

  function resetForm() {
    setForm({ title: "", description: "", location: "" });
    setDateList([]);
    setMediaFile(null);
    setMediaPreview(null);
    setExistingThumbnail(null);
    setMediaFocusX(50);
    setMediaFocusY(50);
    setEditingId(null);
  }

  function startCreate() {
    resetForm();
    setShowForm(true);
  }

  function startEdit(ev) {
    setForm({ title: ev.title, description: ev.description || "", location: ev.location || "" });
    setDateList(ev.event_dates || []);
    setExistingThumbnail(ev.thumbnail_url);
    setMediaFile(null);
    setMediaPreview(null);
    setMediaFocusX(ev.thumbnail_focus_x ?? 50);
    setMediaFocusY(ev.thumbnail_focus_y ?? 50);
    setEditingId(ev.id);
    setShowForm(true);
  }

  function addSingleDate() {
    if (!singleDate) return;
    setDateList([...dateList, { date: singleDate, time: singleTime || null }]);
    setSingleDate("");
    setSingleTime("");
  }

  function addRange() {
    if (!rangeStart || !rangeEnd || rangeEnd < rangeStart) { notify?.("Pick a valid start and end date", "error"); return; }
    const out = [];
    let d = new Date(rangeStart + "T00:00:00Z");
    const end = new Date(rangeEnd + "T00:00:00Z");
    while (d <= end) {
      out.push({ date: d.toISOString().slice(0, 10), time: rangeTime || null });
      d = new Date(d.getTime() + 86400000);
    }
    setDateList([...dateList, ...out]);
    setRangeStart("");
    setRangeEnd("");
    setRangeTime("");
  }

  function removeDate(idx) {
    setDateList(dateList.filter((_, i) => i !== idx));
  }

  function handleMediaChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMediaFile(file);
    setMediaPreview(URL.createObjectURL(file));
    setExistingThumbnail(null);
    setMediaFocusX(50);
    setMediaFocusY(50);
  }

  async function saveEvent() {
    if (!form.title.trim() || dateList.length === 0) { notify?.("Title and at least one date are required", "error"); return; }
    setUploading(true);
    let thumbnailUrl = existingThumbnail;
    let focusX = mediaFocusX, focusY = mediaFocusY;
    if (mediaFile) {
      const path = `${Date.now()}-${mediaFile.name}`;
      const { error: upErr } = await supabase.storage.from("event-media").upload(path, mediaFile);
      if (upErr) { notify?.(upErr.message, "error"); setUploading(false); return; }
      const { data: pub } = supabase.storage.from("event-media").getPublicUrl(path);
      thumbnailUrl = pub.publicUrl;
      if (mediaFile.type?.startsWith("video")) { focusX = 50; focusY = 50; }
    }
    const payload = {
      title: form.title, description: form.description || null, location: form.location || null,
      event_dates: dateList, thumbnail_url: thumbnailUrl,
      thumbnail_focus_x: focusX, thumbnail_focus_y: focusY,
    };
    const { error } = editingId
      ? await supabase.from("special_events").update(payload).eq("id", editingId)
      : await supabase.from("special_events").insert({ ...payload, created_by: session.user.id });
    setUploading(false);
    if (error) { notify?.(error.message, "error"); return; }
    notify?.(editingId ? "Event updated" : "Event created");
    setShowForm(false);
    resetForm();
    load();
  }

  async function deleteEvent(id) {
    await supabase.from("special_events").delete().eq("id", id);
    load();
  }

  async function addRole(eventId) {
    const name = (newRoleName[eventId] || "").trim();
    if (!name) return;
    const dateScope = newRoleDate[eventId] || null;
    const { error } = await supabase.from("special_event_roles").insert({ event_id: eventId, role_name: name, event_date: dateScope || null });
    if (error) { notify?.(error.message, "error"); return; }
    setNewRoleName({ ...newRoleName, [eventId]: "" });
    setNewRoleDate({ ...newRoleDate, [eventId]: "" });
    load();
  }

  async function assignRole(roleId, memberId) {
    const { error } = await supabase.from("special_event_roles").update({ assigned_member_id: memberId || null }).eq("id", roleId);
    if (error) { notify?.(error.message, "error"); return; }
    load();
  }

  async function changeRoleDate(roleId, newDate) {
    const { error } = await supabase.rpc("reassign_event_role_date", { p_role_id: roleId, p_new_date: newDate || null });
    if (error) { notify?.(error.message, "error"); return; }
    load();
  }

  async function removeRole(roleId) {
    await supabase.from("special_event_roles").delete().eq("id", roleId);
    load();
  }

  if (!loaded) return <SkeletonLoader />;

  const today = todayStringWAT();
  const upcoming = events
    .filter((e) => e.event_dates.some((d) => d.date >= today))
    .sort((a, b) => nextUpcomingDate(a.event_dates).localeCompare(nextUpcomingDate(b.event_dates)));
  const past = events
    .filter((e) => e.event_dates.every((d) => d.date < today))
    .sort((a, b) => (b.event_dates.map((d) => d.date).sort().slice(-1)[0]).localeCompare(a.event_dates.map((d) => d.date).sort().slice(-1)[0]));

  function exportEventRoster(ev) {
    const eventRoles = roles.filter((r) => r.event_id === ev.id);
    const rows = ["Event,Date,Time,Location,Role,Assigned To"];
    if (eventRoles.length === 0) {
      rows.push([ev.title, formatEventDates(ev.event_dates), "", ev.location || "", "", ""].map((v) => `"${v}"`).join(","));
    } else {
      eventRoles.forEach((r) => {
        const assignee = data.members.find((m) => m.id === r.assigned_member_id);
        const occurrence = r.event_date ? ev.event_dates.find((d) => d.date === r.event_date) : null;
        const dateLabel = r.event_date ? formatDateShort(r.event_date) : "All dates";
        const timeLabel = occurrence?.time ? formatTime12h(occurrence.time) : "";
        rows.push([ev.title, dateLabel, timeLabel, ev.location || "", r.role_name, assignee?.name || "Unassigned"]
          .map((v) => `"${String(v).replace(/"/g, "'")}"`).join(","));
      });
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${ev.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-roster-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function renderEvent(ev) {
    const eventRoles = roles.filter((r) => r.event_id === ev.id);
    const countdown = countdownLabel(ev.event_dates);
    const canEditDetails = ownsEvent(ev);
    const canDeleteThis = opsOverride || ownsEvent(ev);
    const canManageRolesThis = opsOverride || ownsEvent(ev);
    return (
      <Panel key={ev.id} style={{ marginBottom: 14, overflow: "hidden" }}>
        {ev.thumbnail_url && (
          <div style={{ margin: "-16px -16px 12px" }}>
            {isVideoUrl(ev.thumbnail_url) ? (
              <video src={ev.thumbnail_url} controls style={{ width: "100%", maxHeight: 220, objectFit: "cover", display: "block" }} />
            ) : (
              <img src={ev.thumbnail_url} alt="" style={{ width: "100%", aspectRatio: EVENT_THUMBNAIL_ASPECT, objectFit: "cover", objectPosition: `${ev.thumbnail_focus_x ?? 50}% ${ev.thumbnail_focus_y ?? 50}%`, display: "block" }} />
            )}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 6 }}>
          <div>
            <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 16, color: COLORS.textPrimary }}>{ev.title}</div>
            <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 2 }}>
              {formatEventDates(ev.event_dates)}{ev.location ? ` · ${ev.location}` : ""}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Badge tone={countdown.tone}>{countdown.text}</Badge>
            <Download size={13} style={{ cursor: "pointer", color: COLORS.textMuted }} onClick={() => exportEventRoster(ev)} />
            {canEditDetails && <Pencil size={13} style={{ cursor: "pointer", color: COLORS.textMuted }} onClick={() => startEdit(ev)} />}
            {canDeleteThis && <Trash2 size={14} style={{ cursor: "pointer", color: COLORS.textMuted }} onClick={() => deleteEvent(ev.id)} />}
          </div>
        </div>
        {ev.description && <div style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 10 }}>{ev.description}</div>}

        <div style={{ fontSize: 11, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>Assignments</div>
        {eventRoles.length === 0 ? (
          <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 8 }}>No roles set up yet.</div>
        ) : (
          eventRoles.map((r) => {
            const assignee = data.members.find((m) => m.id === r.assigned_member_id);
            return (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: `1px solid ${COLORS.border}` }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13 }}>{r.role_name}</div>
                  {ev.event_dates.length > 1 && (
                    canManageRolesThis && (!r.event_date || r.event_date >= today) ? (
                      <select style={{ ...inputStyle, width: "auto", fontSize: 10, padding: "2px 6px", marginTop: 2 }} value={r.event_date || ""} onChange={(e) => changeRoleDate(r.id, e.target.value)}>
                        <option value="">All dates</option>
                        {[...ev.event_dates].sort((a, b) => a.date.localeCompare(b.date)).map((d) => <option key={d.date} value={d.date}>{formatDateShort(d.date)}</option>)}
                      </select>
                    ) : (
                      <div style={{ fontSize: 10, color: COLORS.textMuted }}>{r.event_date ? formatDateShort(r.event_date) : "All dates"}</div>
                    )
                  )}
                </div>
                {canManageRolesThis ? (
                  <select style={{ ...inputStyle, width: "auto", fontSize: 12, padding: "4px 8px" }} value={r.assigned_member_id || ""} onChange={(e) => assignRole(r.id, e.target.value)}>
                    <option value="">Unassigned</option>
                    {data.members.filter((m) => !m.unavailable && !m.suspended).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                ) : (
                  <span style={{ fontSize: 12, color: assignee ? COLORS.textPrimary : COLORS.textMuted }}>{assignee?.name || "Unassigned"}</span>
                )}
                {canManageRolesThis && <X size={13} style={{ cursor: "pointer", color: COLORS.textMuted }} onClick={() => removeRole(r.id)} />}
              </div>
            );
          })
        )}
        {canManageRolesThis && (
          <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 6, marginTop: 10 }}>
            <input style={{ ...inputStyle, flex: 1, fontSize: 12 }} placeholder="Add a role (e.g. ProPresenter Prayer 1)" value={newRoleName[ev.id] || ""} onChange={(e) => setNewRoleName({ ...newRoleName, [ev.id]: e.target.value })} onKeyDown={(e) => e.key === "Enter" && !ev.event_dates.length > 1 && addRole(ev.id)} />
            {ev.event_dates.length > 1 && (
              <select style={{ ...inputStyle, width: isMobile ? "100%" : "auto", fontSize: 12 }} value={newRoleDate[ev.id] || ""} onChange={(e) => setNewRoleDate({ ...newRoleDate, [ev.id]: e.target.value })}>
                <option value="">All dates</option>
                {[...ev.event_dates].sort((a, b) => a.date.localeCompare(b.date)).map((d) => <option key={d.date} value={d.date}>{formatDateShort(d.date)}</option>)}
              </select>
            )}
            <Btn small tone="ghost" onClick={() => addRole(ev.id)}><Plus size={12} /> Add role</Btn>
          </div>
        )}
      </Panel>
    );
  }

  return (
    <div>
      <SectionHeader
        title="Special Events"
        subtitle="One-off events outside the regular weekly schedule."
        right={canManageEvents && <Btn tone="amber" onClick={startCreate}><Plus size={14} /> New event</Btn>}
      />

      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        <Btn small tone={view === "list" ? "amber" : "ghost"} onClick={() => setView("list")}>List</Btn>
        <Btn small tone={view === "calendar" ? "amber" : "ghost"} onClick={() => setView("calendar")}>Calendar</Btn>
      </div>

      {showForm && (
        <Panel title={editingId ? "Edit event" : "New event"} style={{ marginBottom: 16 }} right={<X size={16} style={{ cursor: "pointer" }} onClick={() => { setShowForm(false); resetForm(); }} />}>
          <Field label="Title"><input style={inputStyle} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Location (optional)"><input style={inputStyle} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
          <Field label="Description (optional)"><textarea style={{ ...inputStyle, minHeight: 60 }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>

          <Field label="Thumbnail image or video (optional)">
            <input type="file" accept="image/*,video/*" onChange={handleMediaChange} style={{ fontSize: 12, color: COLORS.textSecondary }} />
            {mediaPreview ? (
              isVideoUrl(mediaFile?.name || "") || mediaFile?.type?.startsWith("video") ? (
                <video src={mediaPreview} controls style={{ width: "100%", maxHeight: 160, marginTop: 8, borderRadius: 8 }} />
              ) : (
                <ImageFramePicker src={mediaPreview} focusX={mediaFocusX} focusY={mediaFocusY} onChange={(x, y) => { setMediaFocusX(x); setMediaFocusY(y); }} />
              )
            ) : existingThumbnail ? (
              isVideoUrl(existingThumbnail) ? (
                <video src={existingThumbnail} controls style={{ width: "100%", maxHeight: 160, marginTop: 8, borderRadius: 8 }} />
              ) : (
                <ImageFramePicker src={existingThumbnail} focusX={mediaFocusX} focusY={mediaFocusY} onChange={(x, y) => { setMediaFocusX(x); setMediaFocusY(y); }} />
              )
            ) : null}
          </Field>

          <div style={{ fontSize: 12, color: COLORS.textSecondary, margin: "12px 0 6px", fontWeight: 600 }}>Dates — flexible, mix ranges and single days</div>

          {dateList.length > 0 && (
            <div style={{ marginBottom: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {dateList.map((d, i) => (
                <Badge key={i} tone="amber">
                  {formatDateShort(d.date)}{d.time ? `, ${formatTime12h(d.time)}` : ""}
                  <X size={10} style={{ marginLeft: 4, cursor: "pointer", verticalAlign: "middle" }} onClick={() => removeDate(i)} />
                </Badge>
              ))}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr auto", gap: 8, alignItems: "end", marginBottom: 8 }}>
            <Field label="Single date"><input type="date" style={inputStyle} value={singleDate} onChange={(e) => setSingleDate(e.target.value)} /></Field>
            <Field label="Time (optional)"><input type="time" style={inputStyle} value={singleTime} onChange={(e) => setSingleTime(e.target.value)} /></Field>
            <Btn small tone="ghost" onClick={addSingleDate}><Plus size={12} /> Add date</Btn>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr auto", gap: 8, alignItems: "end" }}>
            <Field label="Range start"><input type="date" style={inputStyle} value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} /></Field>
            <Field label="Range end"><input type="date" style={inputStyle} value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} /></Field>
            <Field label="Time (optional)"><input type="time" style={inputStyle} value={rangeTime} onChange={(e) => setRangeTime(e.target.value)} /></Field>
            <Btn small tone="ghost" onClick={addRange}><Plus size={12} /> Add range</Btn>
          </div>

          <div style={{ marginTop: 16 }}>
            <Btn tone="amber" onClick={saveEvent} disabled={uploading}>{uploading ? "Saving..." : <><Save size={13} /> {editingId ? "Save changes" : "Create event"}</>}</Btn>
          </div>
        </Panel>
      )}

      {view === "calendar" ? (
        <Panel>
          <EventCalendar events={events} roles={roles} members={data.members} session={session} notify={notify} />
        </Panel>
      ) : (
        <>
          {upcoming.length === 0 ? (
            <Panel><EmptyRow text="No upcoming special events." /></Panel>
          ) : (
            upcoming.map(renderEvent)
          )}

          {past.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <div className="hldt-row" data-clickable="true" onClick={() => setShowPast(!showPast)} style={{ cursor: "pointer", fontSize: 12, color: COLORS.textMuted, padding: "6px 4px", display: "flex", alignItems: "center", gap: 6 }}>
                {showPast ? "Hide" : "Show"} past events ({past.length})
              </div>
              {showPast && past.map(renderEvent)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RosterTab({ data, isAdmin, canManageRosters, myMember, reload, notify, pendingHighlight, onPendingHighlightConsumed }) {
  useEffect(() => {
    if (!pendingHighlight || pendingHighlight.tab !== "roster") return;
    const t = setTimeout(() => {
      document.getElementById(pendingHighlight.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
    onPendingHighlightConsumed?.();
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingHighlight]);

  const teamA = data.members.filter((m) => m.team === "A");
  const teamB = data.members.filter((m) => m.team === "B");
  const services = ["Sunday services (x4)", "Wednesday midweek", "Saturday training", "Tuesday 8PM meeting (mandatory)"];

  const [coverRequests, setCoverRequests] = useState([]);
  const [showCoverForm, setShowCoverForm] = useState(false);
  const [coverForm, setCoverForm] = useState({ eventType: "sunday", eventDate: new Date().toISOString().slice(0, 10), reason: "" });

  async function loadCoverRequests() {
    const { data: rows } = await supabase.from("cover_requests").select("*").eq("status", "open").order("event_date");
    setCoverRequests(rows || []);
  }

  useEffect(() => {
    loadCoverRequests();
    const channel = supabase
      .channel("cover-requests-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "cover_requests" }, loadCoverRequests)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  async function postCoverRequest() {
    if (!myMember) { notify?.("No member record linked to your account", "error"); return; }
    const { error } = await supabase.from("cover_requests").insert({
      requester_id: myMember.id, event_type: coverForm.eventType, event_date: coverForm.eventDate, reason: coverForm.reason,
    });
    if (error) { notify?.(error.message, "error"); return; }
    notify?.("Cover request posted");
    setShowCoverForm(false);
    setCoverForm({ eventType: "sunday", eventDate: new Date().toISOString().slice(0, 10), reason: "" });
    loadCoverRequests();
  }

  async function claimCoverRequest(req) {
    if (!myMember) { notify?.("No member record linked to your account", "error"); return; }
    if (req.requester_id === myMember.id) { notify?.("You can't cover your own request", "error"); return; }
    const { data: updated, error } = await supabase.from("cover_requests").update({ status: "claimed", claimed_by: myMember.id }).eq("id", req.id).eq("status", "open").select();
    if (error) { notify?.(error.message, "error"); return; }
    if (!updated || updated.length === 0) { notify?.("Someone beat you to it — already covered.", "error"); loadCoverRequests(); return; }
    notify?.("You've got it covered");
    loadCoverRequests();
  }

  async function cancelCoverRequest(id) {
    await supabase.from("cover_requests").delete().eq("id", id);
    loadCoverRequests();
  }

  const [tuesdayRosters, setTuesdayRosters] = useState([]);
  const [saturdayRosters, setSaturdayRosters] = useState([]);
  const [editingTuesday, setEditingTuesday] = useState(null);
  const [editingSaturday, setEditingSaturday] = useState(null);
  const [showNewTuesday, setShowNewTuesday] = useState(false);
  const [showNewSaturday, setShowNewSaturday] = useState(false);

  async function loadRosters() {
    const [tRes, tiRes, sRes, stRes] = await Promise.all([
      supabase.from("tuesday_rosters").select("*").order("event_date"),
      supabase.from("tuesday_roster_items").select("*").order("position"),
      supabase.from("saturday_rosters").select("*").order("event_date"),
      supabase.from("saturday_roster_trainers").select("*"),
    ]);
    const itemsByRoster = {};
    (tiRes.data || []).forEach((it) => {
      if (!itemsByRoster[it.roster_id]) itemsByRoster[it.roster_id] = [];
      itemsByRoster[it.roster_id].push(it);
    });
    setTuesdayRosters((tRes.data || []).map((r) => ({
      id: r.id, eventDate: r.event_date, published: r.published,
      items: (itemsByRoster[r.id] || []).map((it) => ({ title: it.title, duration_minutes: it.duration_minutes, assigned_member_id: it.assigned_member_id, assigned_name: it.assigned_name })),
    })));
    const trainersByRoster = {};
    (stRes.data || []).forEach((t) => {
      if (!trainersByRoster[t.roster_id]) trainersByRoster[t.roster_id] = [];
      trainersByRoster[t.roster_id].push({ memberId: t.member_id, name: t.name });
    });
    setSaturdayRosters((sRes.data || []).map((r) => ({
      id: r.id, eventDate: r.event_date, callTime: r.call_time, durationMinutes: r.duration_minutes,
      focusNotes: r.focus_notes, published: r.published, trainers: trainersByRoster[r.id] || [],
    })));
  }

  useEffect(() => {
    loadRosters();
    const channel = supabase
      .channel("roster-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "tuesday_rosters" }, loadRosters)
      .on("postgres_changes", { event: "*", schema: "public", table: "tuesday_roster_items" }, loadRosters)
      .on("postgres_changes", { event: "*", schema: "public", table: "saturday_rosters" }, loadRosters)
      .on("postgres_changes", { event: "*", schema: "public", table: "saturday_roster_trainers" }, loadRosters)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  async function deleteTuesday(id) {
    await supabase.from("tuesday_rosters").delete().eq("id", id);
    notify?.("Tuesday roster deleted");
    loadRosters();
  }
  async function deleteSaturday(id) {
    await supabase.from("saturday_rosters").delete().eq("id", id);
    notify?.("Saturday roster deleted");
    loadRosters();
  }

  return (
    <div>
      <SectionHeader title="Roster" subtitle="Team A / Team B rotation. Reporting time: 1 hour before service." right={<Btn tone="ghost" onClick={() => setShowCoverForm(true)}><RefreshCw size={13} /> Need cover?</Btn>} />
      <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 12 }}>
        To move someone between teams, edit their record from the Members tab — this view is read-only.
      </div>

      {showCoverForm && (
        <Panel title="Post a cover request" style={{ marginBottom: 16 }} right={<X size={16} style={{ cursor: "pointer" }} onClick={() => setShowCoverForm(false)} />}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Event">
              <select style={inputStyle} value={coverForm.eventType} onChange={(e) => setCoverForm({ ...coverForm, eventType: e.target.value })}>
                {Object.entries(EVENT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Date"><input type="date" style={inputStyle} value={coverForm.eventDate} onChange={(e) => setCoverForm({ ...coverForm, eventDate: e.target.value })} /></Field>
          </div>
          <Field label="Reason (optional)"><textarea style={{ ...inputStyle, minHeight: 50 }} value={coverForm.reason} onChange={(e) => setCoverForm({ ...coverForm, reason: e.target.value })} /></Field>
          <Btn tone="amber" onClick={postCoverRequest}><Save size={13} /> Post request</Btn>
        </Panel>
      )}

      {coverRequests.length > 0 && (
        <Panel title="Open cover requests" style={{ marginBottom: 20 }}>
          {coverRequests.map((r) => {
            const requester = data.members.find((m) => m.id === r.requester_id);
            const mine = myMember && r.requester_id === myMember.id;
            return (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: `1px solid ${COLORS.border}` }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13 }}>{requester?.name || "Someone"} needs cover — {EVENT_TYPE_LABELS[r.event_type]}, {r.event_date}</div>
                  {r.reason && <div style={{ fontSize: 11, color: COLORS.textMuted }}>{r.reason}</div>}
                </div>
                {mine ? (
                  <Btn small tone="ghost" onClick={() => cancelCoverRequest(r.id)}>Cancel</Btn>
                ) : (
                  <Btn small tone="amber" onClick={() => claimCoverRequest(r)}>I've got it</Btn>
                )}
              </div>
            );
          })}
        </Panel>
      )}

      <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
        <Panel title="Team A" style={{ flex: 1 }}>
          {teamA.length === 0 ? <EmptyRow text="No members assigned." /> : teamA.map((m) => (
            <RowLine key={m.id} style={{ opacity: m.unavailable ? 0.45 : 1 }} title={m.unavailable ? "Temporarily unavailable" : undefined}>
              <span style={{ flex: 1 }}>{m.name}</span><span style={{ fontSize: 11, color: COLORS.textMuted }}>{m.unit}</span>
            </RowLine>
          ))}
        </Panel>
        <Panel title="Team B" style={{ flex: 1 }}>
          {teamB.length === 0 ? <EmptyRow text="No members assigned." /> : teamB.map((m) => (
            <RowLine key={m.id} style={{ opacity: m.unavailable ? 0.45 : 1 }} title={m.unavailable ? "Temporarily unavailable" : undefined}>
              <span style={{ flex: 1 }}>{m.name}</span><span style={{ fontSize: 11, color: COLORS.textMuted }}>{m.unit}</span>
            </RowLine>
          ))}
        </Panel>
      </div>
      <Panel title="Weekly commitment" style={{ marginBottom: 20 }}>
        {services.map((s) => <RowLine key={s}><Clock size={13} style={{ color: COLORS.textMuted, marginRight: 4 }} />{s}</RowLine>)}
      </Panel>

      <div id="tuesday-roster-section" />
      <SectionHeader title="Tuesday prayer meeting" subtitle="8PM" right={canManageRosters && <Btn small tone="amber" onClick={() => setShowNewTuesday(true)}><Plus size={12} /> New</Btn>} />
      {tuesdayRosters.length === 0 ? (
        <Panel style={{ marginBottom: 20 }}><EmptyRow text="No upcoming Tuesday rosters yet." /></Panel>
      ) : (
        tuesdayRosters.map((r) => (
          <Panel key={r.id} style={{ marginBottom: 12 }} title={new Date(r.eventDate + "T00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
            right={
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {!r.published && <Badge tone="gray">Draft</Badge>}
                {canManageRosters && (<>
                  <Pencil size={13} style={{ cursor: "pointer", color: COLORS.textMuted }} onClick={() => setEditingTuesday(r)} />
                  <Trash2 size={13} style={{ cursor: "pointer", color: COLORS.textMuted }} onClick={() => deleteTuesday(r.id)} />
                </>)}
              </div>
            }
          >
            {r.items.map((it, i) => (
              <RowLine key={i}>
                <span style={{ flex: 1 }}>{it.title}</span>
                <span style={{ fontSize: 11, color: COLORS.textMuted, marginRight: 10 }}>{it.duration_minutes} min</span>
                <span style={{ fontSize: 12, color: COLORS.textSecondary }}>{it.assigned_name || "—"}</span>
              </RowLine>
            ))}
          </Panel>
        ))
      )}

      <div id="saturday-roster-section" />
      <SectionHeader title="Saturday training" subtitle="Call time 9:50 AM · ~2 hours" right={canManageRosters && <Btn small tone="amber" onClick={() => setShowNewSaturday(true)}><Plus size={12} /> New</Btn>} />
      {saturdayRosters.length === 0 ? (
        <Panel><EmptyRow text="No upcoming Saturday rosters yet." /></Panel>
      ) : (
        saturdayRosters.map((r) => (
          <Panel key={r.id} style={{ marginBottom: 12 }} title={new Date(r.eventDate + "T00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
            right={
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {!r.published && <Badge tone="gray">Draft</Badge>}
                {canManageRosters && (<>
                  <Pencil size={13} style={{ cursor: "pointer", color: COLORS.textMuted }} onClick={() => setEditingSaturday(r)} />
                  <Trash2 size={13} style={{ cursor: "pointer", color: COLORS.textMuted }} onClick={() => deleteSaturday(r.id)} />
                </>)}
              </div>
            }
          >
            <div style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 6 }}>Call time {r.callTime} · {r.durationMinutes} min</div>
            {r.trainers.length > 0 && (
              <div style={{ fontSize: 12, marginBottom: 6 }}>
                <span style={{ color: COLORS.textMuted }}>Training this week: </span>
                {r.trainers.map((t) => t.name).join(", ")}
              </div>
            )}
            {r.focusNotes && <div style={{ fontSize: 12, color: COLORS.textSecondary, whiteSpace: "pre-wrap" }}>{r.focusNotes}</div>}
          </Panel>
        ))
      )}

      {(showNewTuesday || editingTuesday) && (
        <TuesdayRosterEditor
          existing={editingTuesday}
          members={data.members}
          notify={notify}
          onClose={() => { setShowNewTuesday(false); setEditingTuesday(null); }}
          onSaved={loadRosters}
        />
      )}
      {(showNewSaturday || editingSaturday) && (
        <SaturdayRosterEditor
          existing={editingSaturday}
          members={data.members}
          notify={notify}
          onClose={() => { setShowNewSaturday(false); setEditingSaturday(null); }}
          onSaved={loadRosters}
        />
      )}
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
    const { error } = await supabase.rpc("update_member_dues", { p_member_id: member.id, p_dues: dues });
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

function DuesTab({ data, isAdmin, reload, myMemberId, notify, pendingPaymentRef }) {
  const [monthPage, setMonthPage] = useState(0);
  const [payingMonth, setPayingMonth] = useState(null);
  const [confirmingRef, setConfirmingRef] = useState(null);

  useEffect(() => {
    const ref = pendingPaymentRef;
    if (!ref) return;
    setConfirmingRef(ref);
    let attempts = 0;
    async function poll() {
      attempts += 1;
      const { data: result, error } = await supabase.functions.invoke("verify-dues-payment", { body: { reference: ref } });
      if (error) { setConfirmingRef(null); notify?.("Couldn't confirm payment status — it'll update once the bank confirms.", "error"); return; }
      if (result.status === "success") { setConfirmingRef(null); notify?.("Payment confirmed!"); reload(); }
      else if (result.status === "failed" || result.status === "abandoned") { setConfirmingRef(null); notify?.("Payment wasn't completed.", "error"); }
      else if (attempts < 6) { setTimeout(poll, 2000); }
      else { setConfirmingRef(null); notify?.("Still processing — check back shortly, it'll update automatically once confirmed."); }
    }
    poll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPaymentRef]);

  async function payNow(month) {
    setPayingMonth(month);
    const { data: result, error } = await supabase.functions.invoke("initialize-dues-payment", { body: { month } });
    setPayingMonth(null);
    if (error || result?.error) { notify?.(result?.error || error.message, "error"); return; }
    window.location.href = result.authorization_url;
  }

  const months = useMemo(() => {
    const out = [];
    for (let i = -2 + monthPage * 5; i <= 2 + monthPage * 5; i++) {
      const mo = monthStringWAT(i);
      if (mo >= DUES_START_MONTH) out.push(mo);
    }
    return out;
  }, [monthPage]);
  const atStart = months.length > 0 && months[0] <= DUES_START_MONTH;
  const [editing, setEditing] = useState(null);

  const pageNav = (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
      <Btn small tone="ghost" disabled={atStart} onClick={() => setMonthPage(monthPage - 1)}><ChevronLeft size={13} /> Earlier</Btn>
      <Btn small tone="ghost" onClick={() => setMonthPage(monthPage + 1)}>Later <ChevronRight size={13} /></Btn>
      {monthPage !== 0 && <Btn small tone="ghost" onClick={() => setMonthPage(0)}>Back to today</Btn>}
    </div>
  );

  if (!isAdmin) {
    const mine = data.members.find((m) => m.id === myMemberId);
    return (
      <div>
        <SectionHeader title="Dues" subtitle="Your dues record" />
        {confirmingRef && <Panel style={{ marginBottom: 12 }}><div style={{ fontSize: 13, color: COLORS.textSecondary }}><RefreshCw size={13} className="hldt-spin" style={{ marginRight: 6, verticalAlign: "middle" }} />Confirming your payment...</div></Panel>}
        {pageNav}
        <Panel>
          {!mine ? (
            <EmptyRow text="No member record is linked to your account yet — ask an admin." />
          ) : (
            <>
              <div style={{ fontSize: 13, marginBottom: 10, color: COLORS.textSecondary }}>{mine.name} · {currency(rate(mine))}/month</div>
              {months.map((mo) => {
                const due = getDue(mine, mo, data.duesPayments);
                const tone = due.status === "paid" ? "green" : due.status === "owing" ? "red" : due.status === "free" ? "amber" : "gray";
                const canPay = due.status !== "paid" && !duesExempt(mine);
                return (
                  <RowLine key={mo}>
                    <span style={{ flex: 1 }}>{mo}</span>
                    {due.amount ? <span style={{ fontSize: 11, color: COLORS.textMuted, marginRight: 8 }}>{currency(due.amount)}</span> : null}
                    <Badge tone={tone}>{due.status === "unset" ? "Not set" : due.status}{due.viaOnline ? " ✓" : ""}</Badge>
                    {canPay && (
                      <Btn small tone="amber" style={{ marginLeft: 8 }} disabled={payingMonth === mo} onClick={() => payNow(mo)}>
                        {payingMonth === mo ? "Redirecting..." : "Pay now"}
                      </Btn>
                    )}
                  </RowLine>
                );
              })}
            </>
          )}
        </Panel>
      </div>
    );
  }

  const [showLedger, setShowLedger] = useState(false);

  function exportLedgerCsv() {
    const rows = ["Member,Month,Amount,Reference,Status,Channel,Paid At"];
    data.duesPayments.forEach((p) => {
      const member = data.members.find((m) => m.id === p.memberId);
      rows.push([member?.name || "Unknown", p.month, currency(p.amountKobo / 100), p.reference, p.status, p.channel || "", p.paidAt || ""]
        .map((v) => `"${String(v).replace(/"/g, "'")}"`).join(","));
    });
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dues-payment-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const myOwnMember = data.members.find((m) => m.id === myMemberId);
  const myCurrentMonth = currentMonthStringWAT();
  const myOwnDue = myOwnMember ? getDue(myOwnMember, myCurrentMonth, data.duesPayments) : null;
  const myOwnCanPay = myOwnMember && myOwnDue && myOwnDue.status !== "paid" && !duesExempt(myOwnMember);

  return (
    <div>
      {myOwnMember && !duesExempt(myOwnMember) && (
        <Panel style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 13, flex: 1 }}>Your dues for {myCurrentMonth} · {currency(rate(myOwnMember))}</span>
            <Badge tone={myOwnDue.status === "paid" ? "green" : myOwnDue.status === "owing" ? "red" : "gray"}>{myOwnDue.status === "unset" ? "Not set" : myOwnDue.status}{myOwnDue.viaOnline ? " ✓" : ""}</Badge>
            {myOwnCanPay && (
              <Btn small tone="amber" disabled={payingMonth === myCurrentMonth} onClick={() => payNow(myCurrentMonth)}>
                {payingMonth === myCurrentMonth ? "Redirecting..." : "Pay now"}
              </Btn>
            )}
          </div>
        </Panel>
      )}
      <SectionHeader
        title="Dues"
        subtitle="Members ₦3,500 · Leaders ₦5,500 expected. Click a cell to record what was actually paid."
        right={<Btn small tone="ghost" onClick={() => setShowLedger(!showLedger)}>{showLedger ? "Hide" : "Show"} payment ledger</Btn>}
      />
      {showLedger && (
        <Panel title="Online payment ledger" style={{ marginBottom: 16 }} right={<Btn small tone="ghost" onClick={exportLedgerCsv}><Download size={12} /> Export CSV</Btn>}>
          {data.duesPayments.length === 0 ? (
            <EmptyRow text="No online payments yet." />
          ) : (
            data.duesPayments.map((p) => {
              const member = data.members.find((m) => m.id === p.memberId);
              const tone = p.status === "success" ? "green" : p.status === "pending" ? "amber" : "red";
              return (
                <RowLine key={p.id}>
                  <span style={{ flex: 1 }}>{member?.name || "Unknown"} · {p.month}</span>
                  <span style={{ fontSize: 11, color: COLORS.textMuted, marginRight: 8 }}>{currency(p.amountKobo / 100)}</span>
                  <Badge tone={tone}>{p.status}</Badge>
                </RowLine>
              );
            })
          )}
        </Panel>
      )}
      {pageNav}
      <Panel>
        <div style={{ overflowX: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: `1.4fr repeat(${months.length}, 0.9fr)`, fontSize: 11, color: COLORS.textMuted, padding: "0 4px 8px", textTransform: "uppercase" }}>
            <div>Member</div>{months.map((mo) => <div key={mo} style={{ textAlign: "center" }}>{mo}</div>)}
          </div>
          {data.members.length === 0 ? <EmptyRow text="No members yet." /> : data.members.map((m) => (
            <div key={m.id} style={{ display: "grid", gridTemplateColumns: `1.4fr repeat(${months.length}, 0.9fr)`, alignItems: "center", padding: "8px 4px", borderTop: `1px solid ${COLORS.border}`, fontSize: 12 }}>
              <div>{m.name} <span style={{ color: COLORS.textMuted }}>· {duesExempt(m) ? (m.unavailable ? "not expected (unavailable)" : "no dues yet (trainee)") : currency(rate(m))}</span></div>
              {months.map((mo) => {
                const due = getDue(m, mo, data.duesPayments);
                const tone = due.status === "paid" ? "green" : due.status === "owing" ? "red" : due.status === "free" ? "amber" : "gray";
                return (
                  <div key={mo} style={{ textAlign: "center", cursor: due.viaOnline ? "default" : "pointer" }} onClick={() => !due.viaOnline && setEditing({ member: m, month: mo })}>
                    <Badge tone={tone}>{due.status === "unset" ? (duesExempt(m) ? (m.unavailable ? "Unavailable" : "Trainee") : "—") : due.amount ? currency(due.amount) : due.status}{due.viaOnline ? " ✓" : ""}</Badge>
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

function FeedbackTab({ data, isAdmin, canReadFeedback, reload, notify }) {
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

      {!canReadFeedback ? <Panel><EmptyRow text="Feedback is only visible to Operations and Welfare." /></Panel> : data.feedback.length === 0 ? <Panel><EmptyRow text="No feedback submitted yet." /></Panel> : data.feedback.map((f) => (
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
