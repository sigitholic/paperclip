import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type RefObject } from "react";
import { MarkdownBlock, useHostNavigation, usePluginAction, usePluginData, usePluginStream, type PluginPageProps, type PluginSidebarProps } from "@paperclipai/plugin-sdk/ui";
import type { ChatMessage } from "../thread.js";
import { PAGE_ROUTE } from "../manifest.js";

// Plugin UI renders inside the host document, so the host theme tokens (ui/src/index.css)
// apply here too and keep the page aligned with light/dark mode.
const token = {
  fg: "var(--foreground)",
  muted: "var(--muted)",
  mutedFg: "var(--muted-foreground)",
  border: "var(--border)",
  card: "var(--card)",
  primary: "var(--primary)",
  primaryFg: "var(--primary-foreground)",
  destructive: "var(--destructive)",
  bg: "var(--background)",
};

const bubble = (role: ChatMessage["role"]): CSSProperties => ({
  alignSelf: role === "operator" ? "flex-end" : "flex-start",
  maxWidth: "75%",
  padding: "8px 12px",
  borderRadius: 12,
  whiteSpace: role === "agent" ? "normal" : "pre-wrap",
  lineHeight: 1.45,
  fontSize: 14,
  background: role === "operator" ? token.primary : role === "agent" ? token.card : token.muted,
  color: role === "operator" ? token.primaryFg : token.fg,
  border: `1px solid ${role === "agent" ? token.border : "transparent"}`,
});

const timeFmt = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit" });

/**
 * Size the chat to the space left in the host viewport. The host adds its own header, back
 * link and padding around plugin pages, so a fixed `calc(100vh - Npx)` overflows and shows a
 * second scrollbar.
 */
function useFillViewport(ref: RefObject<HTMLElement | null>, bottomGap = 24) {
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      let scrollTop = 0;
      for (let p = el.parentElement; p; p = p.parentElement) scrollTop += p.scrollTop;
      const top = el.getBoundingClientRect().top + scrollTop;
      setHeight(Math.max(320, Math.floor(window.innerHeight - top - bottomGap)));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [ref, bottomGap]);
  return height;
}

function senderLabel(m: ChatMessage) {
  return m.role === "operator" ? "Anda" : m.role === "agent" ? (m.agentName ?? "Agen") : "Office";
}

export function OfficeChatPage({ context }: PluginPageProps) {
  const companyId = context.companyId ?? "";
  const nav = useHostNavigation();
  const thread = usePluginData<{ messages: ChatMessage[] }>("thread", { companyId });
  const stream = usePluginStream<{ type: string }>("chat", { companyId });
  const send = usePluginAction("send");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const height = useFillViewport(rootRef);

  // Live: every worker "thread.changed" stream event refreshes the thread. Polling (2.5 s)
  // runs ONLY as a fallback while the stream is down or unsupported (e.g. 501 on hosts
  // without the stream bridge).
  const liveMode = stream.connected ? "stream" : stream.connecting ? "connecting" : "polling";
  useEffect(() => { if (stream.events.length) thread.refresh(); }, [stream.events.length]);
  useEffect(() => { if (stream.connected) thread.refresh(); }, [stream.connected]);
  useEffect(() => {
    if (liveMode !== "polling") return;
    const t = setInterval(() => thread.refresh(), 2500);
    return () => clearInterval(t);
  }, [liveMode]);
  const messages = thread.data?.messages ?? [];
  // Scroll the list itself (not scrollIntoView, which also scrolls the host page), and again
  // once the measured height lands.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length, height]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true); setError(null);
    try { await send({ companyId, text }); setText(""); thread.refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  const disabled = busy || !text.trim();
  return (
    <div ref={rootRef} data-live={liveMode} style={{ display: "flex", flexDirection: "column", height: height ?? 480, maxWidth: 880, margin: "0 auto", gap: 12, color: token.fg }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Office Chat</h1>
          <div style={{ fontSize: 13, color: token.mutedFg }}>Ngobrol dengan kantor. Permintaan kerja otomatis jadi issue untuk agen yang tepat; balasan agen muncul di sini.</div>
        </div>
        <span style={{ fontSize: 12, color: token.mutedFg, whiteSpace: "nowrap" }}>
          {liveMode === "stream" ? "● live" : liveMode === "polling" ? "refresh otomatis" : "menghubungkan…"}
        </span>
      </div>
      <div ref={listRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, padding: 12, border: `1px solid ${token.border}`, borderRadius: 12 }}>
        {thread.loading && !messages.length ? <div style={{ color: token.mutedFg }}>Memuat…</div> : null}
        {!thread.loading && !messages.length ? <div style={{ color: token.mutedFg }}>Belum ada pesan. Coba: “cek PPPoE aktif di router”.</div> : null}
        {messages.map((m) => (
          <div key={m.id} style={bubble(m.role)} data-role={m.role}>
            <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 2 }}>
              {senderLabel(m)}
              {m.issueIdentifier && m.issueId ? <> · <a {...nav.linkProps(`/issues/${m.issueIdentifier}`)} style={{ color: "inherit" }}>{m.issueIdentifier}</a></> : null}
              {" · "}{timeFmt.format(new Date(m.at))}
            </div>
            {m.role === "agent" ? <MarkdownBlock content={m.text} /> : m.text}
          </div>
        ))}
      </div>
      {error ? <div style={{ color: token.destructive, fontSize: 13 }}>{error}</div> : null}
      <form onSubmit={onSubmit} style={{ display: "flex", gap: 8 }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Tulis pesan… (mis. cek PPPoE aktif di router)" aria-label="Pesan"
          style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: `1px solid ${token.border}`, background: token.bg, color: token.fg, fontSize: 14 }} />
        <button type="submit" disabled={disabled} style={{ padding: "10px 16px", borderRadius: 10, border: 0, background: token.primary, color: token.primaryFg, fontWeight: 600, fontSize: 14, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1 }}>
          {busy ? "Mengirim…" : "Kirim"}
        </button>
      </form>
    </div>
  );
}

/** Same geometry as the host's lucide `MessageSquare` so the row lines up with native nav items. */
function ChatIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function OfficeChatSidebarLink(_: PluginSidebarProps) {
  const nav = useHostNavigation();
  // Reuses the host SidebarNavItem classes (present in the host stylesheet) for identical rhythm and hover.
  return (
    <a {...nav.linkProps(`/${PAGE_ROUTE}`)} className="flex items-center gap-2.5 mx-2 rounded-lg px-2 py-1.5 text-(length:--text-compact) font-medium transition-colors text-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" style={{ textDecoration: "none" }}>
      <span className="relative shrink-0"><ChatIcon /></span>
      <span className="flex-1 truncate">Office Chat</span>
    </a>
  );
}
