import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import {
  useHostNavigation,
  usePluginAction,
  usePluginData,
  usePluginStream,
  type PluginDetailTabProps,
  type PluginPageProps,
  type PluginSidebarProps,
  type PluginWidgetProps,
} from "@paperclipai/plugin-sdk/ui";
import { PAGE_ROUTE, STREAM } from "../manifest.js";
import type { AdmissionLogRow, BundleLogRow, L1Row, StoredItem } from "../types.js";

// ---------------------------------------------------------------------------
// Shared bits. Memory text is always rendered as plain text (React escapes it); never as HTML.
// ---------------------------------------------------------------------------

const CURATED_COPY = "Memori dikurasi — kami tidak mengirim seluruh chat ke model. Agen menerima ringkasan singkat + pin, dengan batas karakter tetap.";

const card: CSSProperties = { border: "1px solid rgba(127,127,127,0.25)", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 8 };
const muted: CSSProperties = { fontSize: 12, opacity: 0.7 };
const pre: CSSProperties = { whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.45, margin: 0, fontFamily: "inherit" };
const btn: CSSProperties = { padding: "4px 10px", borderRadius: 8, border: "1px solid rgba(127,127,127,0.35)", background: "transparent", color: "inherit", fontSize: 12, cursor: "pointer" };
const primary: CSSProperties = { ...btn, background: "#2563eb", borderColor: "#2563eb", color: "#fff", fontWeight: 600 };

const TIER_STYLE: Record<string, CSSProperties> = {
  curated: { background: "rgba(16,185,129,0.15)", color: "#059669" },
  ephemeral: { background: "rgba(59,130,246,0.15)", color: "#2563eb" },
  quarantine: { background: "rgba(245,158,11,0.18)", color: "#b45309" },
  reject: { background: "rgba(239,68,68,0.15)", color: "#dc2626" },
};
const TIER_LABEL: Record<string, string> = { curated: "dikurasi", ephemeral: "sementara", quarantine: "karantina", reject: "ditolak" };

function Badge({ tier }: { tier: string }) {
  return (
    <span data-tier={tier} style={{ fontSize: 11, fontWeight: 600, padding: "1px 8px", borderRadius: 999, ...(TIER_STYLE[tier] ?? {}) }}>
      {TIER_LABEL[tier] ?? tier}
    </span>
  );
}

function Section({ title, hint, children, testId }: { title: string; hint?: string; children: ReactNode; testId?: string }) {
  return (
    <section style={card} data-testid={testId}>
      <div>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>
        {hint ? <div style={muted}>{hint}</div> : null}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div style={{ ...muted, fontStyle: "italic" }}>{children}</div>;
}

const fmt = (n: number) => n.toLocaleString("id-ID");
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" }) : "—");

/** Refreshes on every worker stream event; falls back to polling while the stream is down. */
function useLive(companyId: string, refresh: () => void) {
  const stream = usePluginStream<{ type: string }>(STREAM, { companyId });
  const mode = stream.connected ? "stream" : stream.connecting ? "connecting" : "polling";
  useEffect(() => { if (stream.events.length) refresh(); }, [stream.events.length]);
  useEffect(() => { if (stream.connected) refresh(); }, [stream.connected]);
  useEffect(() => {
    if (mode !== "polling") return;
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [mode]);
  return mode;
}

function LiveBadge({ mode }: { mode: string }) {
  const color = mode === "stream" ? "#059669" : "#b45309";
  return <span data-live={mode} style={{ fontSize: 11, color }}>{mode === "stream" ? "● live" : mode === "connecting" ? "○ menyambung…" : "○ refresh 4 dtk"}</span>;
}

function useItemActions(companyId: string, refresh: () => void) {
  const setPinned = usePluginAction("set-pinned");
  const promote = usePluginAction("promote");
  const forget = usePluginAction("forget");
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<unknown>) => async () => {
    setError(null);
    try { await fn(); refresh(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };
  return {
    error,
    pin: (id: string, pinned: boolean) => run(() => setPinned({ companyId, itemId: id, pinned })),
    promote: (id: string) => run(() => promote({ companyId, itemId: id })),
    forget: (id: string) => run(() => forget({ companyId, itemId: id })),
  };
}

function ItemRow({ item, actions }: { item: StoredItem; actions: ReturnType<typeof useItemActions> }) {
  return (
    <li data-item-id={item.id} data-tier={item.tier} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "6px 0", borderTop: "1px solid rgba(127,127,127,0.12)" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {item.pinned ? <span aria-label="pinned">📌</span> : null}
          <Badge tier={item.tier} />
          <span style={muted}>{item.kind} · {item.scopeKind} · {item.sourceKind ?? "—"} · {when(item.createdAt)}</span>
        </div>
        <p style={{ ...pre, marginTop: 4 }}>{item.body}</p>
        {item.reasons.length ? <div style={{ ...muted, color: item.tier === "quarantine" ? "#b45309" : undefined }}>alasan: {item.reasons.join(", ")}</div> : null}
      </div>
      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
        {item.tier !== "quarantine" ? (
          <button style={btn} onClick={actions.pin(item.id, !item.pinned)}>{item.pinned ? "Lepas pin" : "Pin"}</button>
        ) : null}
        {item.tier === "ephemeral" ? <button style={btn} onClick={actions.promote(item.id)}>Setujui</button> : null}
        <button style={btn} onClick={actions.forget(item.id)}>Lupakan</button>
      </div>
    </li>
  );
}

function ItemList({ items, actions, empty }: { items: StoredItem[]; actions: ReturnType<typeof useItemActions>; empty: string }) {
  if (!items.length) return <Empty>{empty}</Empty>;
  return <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>{items.map((i) => <ItemRow key={i.id} item={i} actions={actions} />)}</ul>;
}

function L1Card({ l1, label }: { l1: L1Row; label: string }) {
  return (
    <div data-testid="l1" style={{ borderLeft: "3px solid #2563eb", paddingLeft: 10 }}>
      <div style={muted}>{label} · {l1.runCount} run · diperbarui {when(l1.updatedAt)} · {l1.summary.length}/480 char{l1.flags.length ? ` · ${l1.flags.join(", ")}` : ""}</div>
      <p style={pre}>{l1.summary}</p>
    </div>
  );
}

function AddNote({ companyId, scopes, onDone }: { companyId: string; scopes: Array<{ kind: string; id: string; label: string }>; onDone: () => void }) {
  const add = usePluginAction("add-note");
  const [text, setText] = useState("");
  const [scope, setScope] = useState(0);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true); setResult(null);
    try {
      const s = scopes[scope];
      const r = (await add({ companyId, scopeKind: s.kind, scopeId: s.id, text, pin: true })) as { decision: string; reasons: string[] };
      setResult(
        r.decision === "reject" ? `Ditolak: ${r.reasons.join(", ")}` : r.decision === "quarantine" ? `Masuk karantina: ${r.reasons.join(", ")}` : r.decision === "curated" ? "Tersimpan & di-pin." : `Tersimpan (${r.decision}).`,
      );
      if (r.decision !== "reject") setText("");
      onDone();
    } catch (err) {
      setResult(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Satu fakta singkat, mis. “Router core ada di POP Sleman”" aria-label="Catatan baru"
        style={{ padding: 8, borderRadius: 8, border: "1px solid rgba(127,127,127,0.35)", background: "transparent", color: "inherit", fontSize: 13, resize: "vertical" }} />
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <select value={scope} onChange={(e) => setScope(Number(e.target.value))} aria-label="Cakupan" style={{ ...btn, padding: "4px 6px" }}>
          {scopes.map((s, i) => <option key={s.kind + s.id} value={i}>{s.label}</option>)}
        </select>
        <button type="submit" style={primary} disabled={busy || !text.trim()}>{busy ? "Menyimpan…" : "📌 Pin"}</button>
        {result ? <span data-testid="add-result" style={{ fontSize: 12 }}>{result}</span> : null}
      </div>
      <div style={muted}>Filter otomatis: rahasia disensor, transkrip ditolak, instruksi mencurigakan dikarantina. Di komentar issue, tulis <code>catat: …</code> atau <code>📌 …</code>.</div>
    </form>
  );
}

function BundleCard({ bundle, title }: { bundle: BundleLogRow; title: string }) {
  const [open, setOpen] = useState(false);
  const saved = bundle.naiveChars > 0 ? Math.round(((bundle.naiveChars - bundle.chars) / bundle.naiveChars) * 100) : 0;
  const sections = Array.isArray(bundle.sections) ? (bundle.sections as Array<{ name: string; chars: number; dropped?: boolean }>) : [];
  return (
    <div data-testid="last-bundle" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
        <strong style={{ fontSize: 13 }}>{title}</strong>
        <span style={muted}>{when(bundle.createdAt)} · via {bundle.via}</span>
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <Stat label="Bundle" value={`${fmt(bundle.chars)} char`} sub={`≈ ${fmt(bundle.estTokens)} token`} />
        <Stat label="Transkrip penuh" value={`${fmt(bundle.naiveChars)} char`} sub={`≈ ${fmt(bundle.naiveTokens)} token`} />
        <Stat label="Hemat" value={`${saved}%`} sub="vs kirim semua riwayat" accent />
      </div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {sections.map((s) => (
          <span key={s.name} style={{ fontSize: 11, padding: "1px 8px", borderRadius: 999, background: "rgba(127,127,127,0.12)", textDecoration: s.dropped ? "line-through" : undefined }}>
            {s.name} {s.chars}
          </span>
        ))}
      </div>
      <button style={{ ...btn, alignSelf: "flex-start" }} onClick={() => setOpen(!open)}>{open ? "Sembunyikan isi" : "Lihat isi bundle"}</button>
      {open ? <pre data-testid="bundle-text" style={{ ...pre, fontFamily: "ui-monospace, monospace", fontSize: 12, padding: 8, borderRadius: 8, background: "rgba(127,127,127,0.08)", maxHeight: 360, overflow: "auto" }}>{bundle.bundleText}</pre> : null}
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div>
      <div style={muted}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: accent ? "#059669" : undefined }}>{value}</div>
      {sub ? <div style={muted}>{sub}</div> : null}
    </div>
  );
}

function Admissions({ rows }: { rows: AdmissionLogRow[] }) {
  if (!rows.length) return <Empty>Belum ada catatan yang masuk filter.</Empty>;
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
      {rows.map((a) => (
        <li key={a.id} data-decision={a.decision} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
          <Badge tier={a.decision} />
          <span style={muted}>{a.sourceKind} · {when(a.createdAt)}</span>
          <span>{a.reasons.length ? a.reasons.join(", ") : "lolos"}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Issue tab
// ---------------------------------------------------------------------------

interface IssueMemory {
  issue: { id: string; identifier: string | null; title: string; assigneeAgentId: string | null };
  l1s: L1Row[];
  agentL1: L1Row | null;
  pins: StoredItem[];
  notes: StoredItem[];
  quarantine: StoredItem[];
  bundles: BundleLogRow[];
  admissions: AdmissionLogRow[];
}

export function IssueMemoryTab({ context }: PluginDetailTabProps) {
  const companyId = context.companyId ?? "";
  const issueId = context.entityId;
  const view = usePluginData<IssueMemory>("issue-memory", { companyId, issueId });
  const mode = useLive(companyId, view.refresh);
  const actions = useItemActions(companyId, view.refresh);
  const d = view.data;
  if (view.error) return <div style={{ color: "#dc2626" }}>Memori tidak bisa dimuat: {view.error.message}</div>;
  if (!d) return <div style={muted}>Memuat memori…</div>;
  const scopes = [
    ...(d.issue.assigneeAgentId ? [{ kind: "agent", id: d.issue.assigneeAgentId, label: "Untuk agen issue ini (semua issue-nya)" }] : []),
    { kind: "issue", id: d.issue.id, label: "Hanya issue ini" },
    { kind: "company", id: companyId, label: "Seluruh kantor" },
  ];
  return (
    <div data-testid="issue-memory" style={{ display: "flex", flexDirection: "column", gap: 12, padding: "8px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <div style={{ fontSize: 13 }}>{CURATED_COPY}</div>
        <LiveBadge mode={mode} />
      </div>
      <Section title="Bundle terakhir yang dilihat agen" hint="Persis teks yang diterima agen di awal run." testId="bundle-section">
        {d.bundles[0] ? <BundleCard bundle={d.bundles[0]} title={`${d.bundles.length} bundle tercatat`} /> : <Empty>Belum ada agen yang mengambil konteks untuk issue ini.</Empty>}
      </Section>
      <Section title="Ringkasan sesi (L1)" hint="Dibuat otomatis dan deterministik dari hasil run (tanpa LLM), maks 480 karakter." testId="l1-section">
        {d.l1s.length ? d.l1s.map((l) => <L1Card key={l.agentId} l1={l} label="Issue ini" />) : <Empty>Belum ada ringkasan untuk issue ini.</Empty>}
        {d.agentL1 ? <L1Card l1={d.agentL1} label="Agen (run sebelumnya, lintas issue)" /> : null}
      </Section>
      <Section title="Pins" hint="Selalu ikut ke agen (maks 4 per bundle)." testId="pins-section">
        <ItemList items={d.pins} actions={actions} empty="Belum ada pin." />
        <AddNote companyId={companyId} scopes={scopes} onDone={view.refresh} />
        {actions.error ? <div style={{ color: "#dc2626", fontSize: 12 }}>{actions.error}</div> : null}
      </Section>
      <Section title="Catatan lain" hint="Catatan agen masuk sebagai ‘sementara’ sampai disetujui." testId="notes-section">
        <ItemList items={d.notes} actions={actions} empty="Tidak ada catatan lain." />
      </Section>
      <Section title="Karantina" hint="Terdeteksi sebagai upaya manipulasi (prompt injection). Tidak pernah dikirim ke agen." testId="quarantine-section">
        <ItemList items={d.quarantine} actions={actions} empty="Karantina kosong." />
      </Section>
      <Section title="Filter memori (terbaru)" hint="Teks yang ditolak tidak disimpan; hanya alasannya." testId="admissions-section">
        <Admissions rows={d.admissions} />
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent tab
// ---------------------------------------------------------------------------

interface AgentMemory {
  agentL1: L1Row | null;
  l1s: L1Row[];
  pins: StoredItem[];
  lessons: StoredItem[];
  quarantine: StoredItem[];
  bundles: BundleLogRow[];
  admissions: AdmissionLogRow[];
}

export function AgentMemoryTab({ context }: PluginDetailTabProps) {
  const companyId = context.companyId ?? "";
  const agentId = context.entityId;
  const view = usePluginData<AgentMemory>("agent-memory", { companyId, agentId });
  const mode = useLive(companyId, view.refresh);
  const actions = useItemActions(companyId, view.refresh);
  const d = view.data;
  if (view.error) return <div style={{ color: "#dc2626" }}>Memori tidak bisa dimuat: {view.error.message}</div>;
  if (!d) return <div style={muted}>Memuat memori…</div>;
  return (
    <div data-testid="agent-memory" style={{ display: "flex", flexDirection: "column", gap: 12, padding: "8px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <div style={{ fontSize: 13 }}>{CURATED_COPY}</div>
        <LiveBadge mode={mode} />
      </div>
      <Section title="Memori agen (L1 lintas issue)" hint="Ringkasan run terakhir agen ini; dipakai saat issue baru belum punya riwayat.">
        {d.agentL1 ? <L1Card l1={d.agentL1} label="Agen" /> : <Empty>Belum ada run yang tercatat.</Empty>}
      </Section>
      <Section title="Pins agen">
        <ItemList items={d.pins} actions={actions} empty="Belum ada pin untuk agen ini." />
        <AddNote companyId={companyId} scopes={[{ kind: "agent", id: agentId, label: "Untuk agen ini" }, { kind: "company", id: companyId, label: "Seluruh kantor" }]} onDone={view.refresh} />
      </Section>
      <Section title="Pelajaran & catatan" hint="Dari tool memory.create_note (sementara) atau board (dikurasi).">
        <ItemList items={d.lessons} actions={actions} empty="Belum ada pelajaran." />
      </Section>
      <Section title="Karantina">
        <ItemList items={d.quarantine} actions={actions} empty="Karantina kosong." />
      </Section>
      <Section title="Ringkasan per issue">
        {d.l1s.length ? d.l1s.map((l) => <L1Card key={l.issueId} l1={l} label={`Issue ${l.issueId.slice(0, 8)}`} />) : <Empty>Belum ada.</Empty>}
      </Section>
      <Section title="Bundle terakhir">
        {d.bundles[0] ? <BundleCard bundle={d.bundles[0]} title="Terakhir" /> : <Empty>Belum ada bundle.</Empty>}
      </Section>
      <Section title="Filter memori (terbaru)"><Admissions rows={d.admissions} /></Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Company page, sidebar link, dashboard widget
// ---------------------------------------------------------------------------

interface PageData {
  items: StoredItem[];
  counts: Record<string, number>;
  savings: { count: number; avgChars: number; avgNaiveChars: number; avgTokens: number; avgNaiveTokens: number };
  admissions: AdmissionLogRow[];
  l1s: L1Row[];
}

export function MemoryPage({ context }: PluginPageProps) {
  const companyId = context.companyId ?? "";
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [tier, setTier] = useState("");
  const view = usePluginData<PageData>("memory-page", { companyId, q: query, tier });
  const mode = useLive(companyId, view.refresh);
  const actions = useItemActions(companyId, view.refresh);
  const d = view.data;
  const s = d?.savings;
  const saved = s && s.avgNaiveChars > 0 ? Math.round(((s.avgNaiveChars - s.avgChars) / s.avgNaiveChars) * 100) : 0;
  return (
    <div data-testid="memory-page" style={{ maxWidth: 980, margin: "0 auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Memory</h1>
          <div style={{ fontSize: 13, opacity: 0.75 }}>{CURATED_COPY}</div>
        </div>
        <LiveBadge mode={mode} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
        <section style={card}><Stat label="Dikurasi" value={fmt(d?.counts.curated ?? 0)} /></section>
        <section style={card}><Stat label="Sementara" value={fmt(d?.counts.ephemeral ?? 0)} /></section>
        <section style={card}><Stat label="Karantina" value={fmt(d?.counts.quarantine ?? 0)} /></section>
        <section style={card} data-testid="savings"><Stat label={`Hemat konteks (${fmt(s?.count ?? 0)} bundle)`} value={`${saved}%`} sub={s ? `${fmt(s.avgChars)} vs ${fmt(s.avgNaiveChars)} char rata-rata` : undefined} accent /></section>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); setQuery(q); }} style={{ display: "flex", gap: 8 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari memori…" aria-label="Cari" style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(127,127,127,0.35)", background: "transparent", color: "inherit" }} />
        <select value={tier} onChange={(e) => setTier(e.target.value)} aria-label="Tier" style={{ ...btn, padding: "6px 8px" }}>
          <option value="">Semua tier</option>
          <option value="curated">Dikurasi</option>
          <option value="ephemeral">Sementara</option>
          <option value="quarantine">Karantina</option>
        </select>
        <button type="submit" style={primary}>Cari</button>
      </form>
      <Section title="Item memori" hint="Pin, setujui, atau lupakan. Tidak ada transkrip yang disimpan.">
        {view.error ? <div style={{ color: "#dc2626" }}>{view.error.message}</div> : null}
        {d ? <ItemList items={d.items} actions={actions} empty={query ? "Tidak ada yang cocok." : "Belum ada memori."} /> : <div style={muted}>Memuat…</div>}
        {actions.error ? <div style={{ color: "#dc2626", fontSize: 12 }}>{actions.error}</div> : null}
      </Section>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
        <Section title="Ringkasan sesi terbaru (L1)">
          {d?.l1s.length ? d.l1s.slice(0, 6).map((l) => <L1Card key={l.agentId + l.issueId} l1={l} label={l.issueId.startsWith("00000000") ? "Agen" : `Issue ${l.issueId.slice(0, 8)}`} />) : <Empty>Belum ada.</Empty>}
        </Section>
        <Section title="Filter memori (terbaru)"><Admissions rows={d?.admissions ?? []} /></Section>
      </div>
    </div>
  );
}

export function MemorySidebarLink(_: PluginSidebarProps) {
  const nav = useHostNavigation();
  return (
    <a {...nav.linkProps(`/${PAGE_ROUTE}`)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", fontSize: 13, fontWeight: 500, color: "inherit", textDecoration: "none" }}>
      <span aria-hidden="true">🧠</span> Memory
    </a>
  );
}

export function MemorySavingsWidget({ context }: PluginWidgetProps) {
  const companyId = context.companyId ?? "";
  const view = usePluginData<{ count: number; avgChars: number; avgNaiveChars: number; avgTokens: number; avgNaiveTokens: number; savedPct: number }>("savings", { companyId });
  useLive(companyId, view.refresh);
  const d = view.data;
  return (
    <div data-testid="memory-widget" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontWeight: 600 }}>Memori: hemat konteks</div>
      {d && d.count > 0 ? (
        <>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#059669" }}>{d.savedPct}%</div>
          <div style={muted}>rata-rata {fmt(d.avgChars)} char (≈{fmt(d.avgTokens)} token) per bundle vs {fmt(d.avgNaiveChars)} char (≈{fmt(d.avgNaiveTokens)} token) transkrip penuh · {fmt(d.count)} bundle</div>
        </>
      ) : (
        <Empty>Belum ada bundle. Agen mengambil konteks di awal run.</Empty>
      )}
    </div>
  );
}
