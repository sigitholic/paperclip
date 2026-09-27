import { useEffect } from "react";
import { useHostNavigation, usePluginData, usePluginStream, type PluginPageProps, type PluginSidebarProps, type PluginWidgetProps } from "@paperclipai/plugin-sdk/ui";
import type { Desk, DeskState } from "../presence.js";
import { PAGE_ROUTE } from "../manifest.js";

type OfficeDesk = Desk & { issue: { id: string; identifier: string | null; title: string } | null };
interface Office { generatedAt: string; counts: Record<string, number>; desks: OfficeDesk[]; log: Array<{ at: string; eventType: string; agentId: string; issueId: string | null }> }

const COLOR: Record<DeskState, string> = { busy: "#f59e0b", idle: "#10b981", paused: "#6b7280", error: "#ef4444", away: "#9ca3af" };
const LABEL: Record<DeskState, string> = { busy: "Sedang bekerja", idle: "Idle", paused: "Dijeda", error: "Error", away: "Tidak aktif" };

function ago(iso: string | null) {
  if (!iso) return "belum ada aktivitas";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 60 ? `${s} dtk lalu` : s < 3600 ? `${Math.round(s / 60)} mnt lalu` : s < 86400 ? `${Math.round(s / 3600)} jam lalu` : `${Math.round(s / 86400)} hari lalu`;
}

/**
 * Live office data: refresh on every worker stream event. The host's plugin stream bridge
 * can be unavailable (501 on this Paperclip build), so fall back to a short poll.
 */
function useOffice(companyId: string) {
  const office = usePluginData<Office>("office", { companyId });
  const stream = usePluginStream<{ type: string }>("office", { companyId });
  useEffect(() => { if (stream.events.length) office.refresh(); }, [stream.events.length]);
  useEffect(() => { const t = setInterval(() => office.refresh(), stream.connected ? 15000 : 2500); return () => clearInterval(t); }, [stream.connected]);
  return { office, live: stream.connected };
}

function DeskArt({ state }: { state: DeskState }) {
  const screen = state === "busy" ? COLOR.busy : state === "error" ? COLOR.error : "#1f2937";
  return (
    <svg viewBox="0 0 120 70" width="100%" height="70" aria-hidden="true">
      <rect x="10" y="48" width="100" height="6" rx="2" fill="#a16207" />
      <rect x="20" y="54" width="4" height="14" fill="#854d0e" /><rect x="96" y="54" width="4" height="14" fill="#854d0e" />
      <rect x="40" y="16" width="40" height="28" rx="3" fill="#111827" />
      <rect x="43" y="19" width="34" height="22" rx="2" fill={screen} opacity={state === "busy" ? 0.9 : 0.6} />
      <rect x="57" y="44" width="6" height="4" fill="#374151" />
      {state === "away" ? null : <circle cx="60" cy="8" r="6" fill={COLOR[state]} />}
    </svg>
  );
}

function DeskCard({ d }: { d: OfficeDesk }) {
  const nav = useHostNavigation();
  return (
    <div data-desk-state={d.state} style={{ border: `1px solid ${COLOR[d.state]}55`, borderTop: `4px solid ${COLOR[d.state]}`, borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
      <DeskArt state={d.state} />
      <div style={{ fontWeight: 600 }}><a {...nav.linkProps(`/agents/${d.agentId}`)} style={{ color: "inherit", textDecoration: "none" }}>{d.name}</a></div>
      <div style={{ fontSize: 12, opacity: 0.7 }}>{d.title ?? "—"}</div>
      <div style={{ fontSize: 13, color: COLOR[d.state], fontWeight: 600 }}>{LABEL[d.state]}{d.state === "busy" && d.since ? ` · sejak ${ago(d.since)}` : ""}</div>
      {d.state === "busy" ? (
        <div style={{ fontSize: 12 }}>
          {d.issue ? <>Mengerjakan <a {...nav.linkProps(`/issues/${d.issue.identifier ?? d.issue.id}`)}>{d.issue.identifier}</a>: {d.issue.title}</> : "Run aktif (detail tugas belum terlihat)"}
        </div>
      ) : null}
      <div style={{ fontSize: 11, opacity: 0.65 }}>
        Aktivitas terakhir: {d.lastActivity ?? "—"} · {ago(d.lastActivityAt)}
        {d.lastRun ? <> · run terakhir: {d.lastRun.status}</> : null}
      </div>
    </div>
  );
}

export function VirtualOfficePage({ context }: PluginPageProps) {
  const { office, live } = useOffice(context.companyId ?? "");
  const o = office.data;
  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Virtual Office</h1>
        <div style={{ fontSize: 13, opacity: 0.7 }}>
          Status diambil dari data Paperclip asli (status agen, run, issue aktif). Tanpa event = idle.{live ? " • live" : " • refresh otomatis 2,5 dtk"}
          {o ? ` • ${o.counts.busy} bekerja, ${o.counts.idle} idle dari ${o.counts.total} agen` : ""}
        </div>
      </div>
      {office.error ? <div style={{ color: "#dc2626" }}>{office.error.message}</div> : null}
      {!o && office.loading ? <div style={{ opacity: 0.6 }}>Memuat…</div> : null}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
        {o?.desks.map((d) => <DeskCard key={d.agentId} d={d} />)}
      </div>
    </div>
  );
}

export function VirtualOfficeWidget({ context }: PluginWidgetProps) {
  const { office } = useOffice(context.companyId ?? "");
  const o = office.data;
  if (!o) return <div>{office.error ? office.error.message : "Memuat Virtual Office…"}</div>;
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <strong>Virtual Office</strong>
      <div>{o.counts.busy} bekerja · {o.counts.idle} idle · {o.counts.total} agen</div>
      {o.desks.filter((d) => d.state === "busy").map((d) => <div key={d.agentId} style={{ fontSize: 12 }}>● {d.name}: {d.issue?.identifier ?? "run aktif"}</div>)}
    </div>
  );
}

export function VirtualOfficeSidebarLink(_: PluginSidebarProps) {
  const nav = useHostNavigation();
  return (
    <a {...nav.linkProps(`/${PAGE_ROUTE}`)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", fontSize: 13, fontWeight: 500, color: "inherit", textDecoration: "none" }}>
      <span aria-hidden="true">🏢</span> Virtual Office
    </a>
  );
}
