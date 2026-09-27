import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { MarkdownBlock, useHostNavigation, usePluginAction, usePluginData, usePluginStream, type PluginPageProps, type PluginSidebarProps } from "@paperclipai/plugin-sdk/ui";
import type { ChatMessage } from "../thread.js";
import { PAGE_ROUTE } from "../manifest.js";

const bubble = (role: ChatMessage["role"]): CSSProperties => ({
  alignSelf: role === "operator" ? "flex-end" : "flex-start",
  maxWidth: "75%",
  padding: "8px 12px",
  borderRadius: 12,
  whiteSpace: role === "agent" ? "normal" : "pre-wrap",
  lineHeight: 1.45,
  fontSize: 14,
  background: role === "operator" ? "#2563eb" : role === "agent" ? "rgba(16,185,129,0.12)" : "rgba(127,127,127,0.12)",
  color: role === "operator" ? "#fff" : "inherit",
  border: role === "agent" ? "1px solid rgba(16,185,129,0.35)" : "1px solid transparent",
});

export function OfficeChatPage({ context }: PluginPageProps) {
  const companyId = context.companyId ?? "";
  const nav = useHostNavigation();
  const thread = usePluginData<{ messages: ChatMessage[] }>("thread", { companyId });
  const stream = usePluginStream<{ type: string }>("chat", { companyId });
  const send = usePluginAction("send");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Live: every worker "thread.changed" event refreshes. The host stream bridge can be
  // unavailable (501 on this Paperclip build), so fall back to a short poll.
  useEffect(() => { if (stream.events.length) thread.refresh(); }, [stream.events.length]);
  useEffect(() => { const t = setInterval(() => thread.refresh(), stream.connected ? 15000 : 2500); return () => clearInterval(t); }, [stream.connected]);
  const messages = thread.data?.messages ?? [];
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages.length]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true); setError(null);
    try { await send({ companyId, text }); setText(""); thread.refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 120px)", maxWidth: 880, margin: "0 auto", padding: 16, gap: 12 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Office Chat</h1>
        <div style={{ fontSize: 13, opacity: 0.7 }}>Ngobrol dengan kantor. Permintaan kerja otomatis jadi issue untuk agen yang tepat; balasan agen muncul di sini.{stream.connected ? " • live" : " • refresh otomatis 2,5 dtk"}</div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, padding: 12, border: "1px solid rgba(127,127,127,0.25)", borderRadius: 12 }}>
        {thread.loading && !messages.length ? <div style={{ opacity: 0.6 }}>Memuat…</div> : null}
        {!thread.loading && !messages.length ? <div style={{ opacity: 0.6 }}>Belum ada pesan. Coba: “cek PPPoE aktif di router”.</div> : null}
        {messages.map((m) => (
          <div key={m.id} style={bubble(m.role)} data-role={m.role}>
            <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 2 }}>
              {m.role === "operator" ? "Anda" : m.role === "agent" ? (m.agentName ?? "Agen") : "Office"}
              {m.issueIdentifier && m.issueId ? <> · <a {...nav.linkProps(`/issues/${m.issueIdentifier}`)} style={{ color: "inherit" }}>{m.issueIdentifier}</a></> : null}
              {" · "}{new Date(m.at).toLocaleTimeString()}
            </div>
            {m.role === "agent" ? <MarkdownBlock content={m.text} /> : m.text}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {error ? <div style={{ color: "#dc2626", fontSize: 13 }}>{error}</div> : null}
      <form onSubmit={onSubmit} style={{ display: "flex", gap: 8 }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Tulis pesan… (mis. cek PPPoE aktif di router)" aria-label="Pesan"
          style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(127,127,127,0.35)", background: "transparent", color: "inherit", fontSize: 14 }} />
        <button type="submit" disabled={busy || !text.trim()} style={{ padding: "10px 16px", borderRadius: 10, border: 0, background: "#2563eb", color: "#fff", fontWeight: 600, opacity: busy || !text.trim() ? 0.6 : 1 }}>
          {busy ? "Mengirim…" : "Kirim"}
        </button>
      </form>
    </div>
  );
}

export function OfficeChatSidebarLink(_: PluginSidebarProps) {
  const nav = useHostNavigation();
  return (
    <a {...nav.linkProps(`/${PAGE_ROUTE}`)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", fontSize: 13, fontWeight: 500, color: "inherit", textDecoration: "none" }}>
      <span aria-hidden="true">💬</span> Office Chat
    </a>
  );
}
