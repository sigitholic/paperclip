import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useHostNavigation, type PluginPageProps, type PluginSidebarProps } from "@paperclipai/plugin-sdk/ui";
import { OFFICE_TEMPLATES, type OfficeTemplate } from "../templates.js";
import { buildOfficePackage, importRequest } from "../package-builder.js";
import { copyAdapterFrom, defaultEngine, defaultManager, engineCandidates, type SourceAgent } from "../adapter-copy.js";
import { PAGE_ROUTE } from "../manifest.js";

interface Plan { slug: string; action: string; plannedName?: string; plannedTitle?: string; reason: string | null }
interface Preview { plan: { agentPlans: Plan[]; projectPlans: Plan[]; issuePlans: Plan[] }; warnings: string[]; errors: string[] }
interface Applied { agents: Array<{ slug: string; id: string | null; action: string; name: string; reason: string | null }>; warnings?: string[] }

type Phase =
  | { kind: "idle" }
  | { kind: "busy"; label: string }
  | { kind: "preview"; preview: Preview; dropped: string[] }
  | { kind: "done"; applied: Applied }
  | { kind: "error"; message: string };

const s = {
  page: { display: "grid", gap: "1rem", padding: "1rem", maxWidth: "64rem", minWidth: 0 },
  card: { border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--card)", padding: "0.875rem 1rem", display: "grid", gap: "0.625rem", minWidth: 0 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(18rem, 1fr))", gap: "0.75rem" },
  title: { fontWeight: 600, fontSize: "0.9375rem" },
  hint: { color: "var(--muted-foreground)", fontSize: "0.8125rem" },
  label: { display: "grid", gap: "0.25rem", fontSize: "0.75rem", color: "var(--muted-foreground)" },
  select: { height: "2rem", padding: "0 0.5rem", border: "1px solid var(--input)", borderRadius: "calc(var(--radius) - 2px)", background: "var(--background)", color: "var(--foreground)", fontSize: "0.8125rem" },
  btn: { height: "2rem", padding: "0 0.75rem", border: "1px solid var(--border)", borderRadius: "calc(var(--radius) - 2px)", background: "var(--background)", color: "var(--foreground)", fontSize: "0.8125rem", cursor: "pointer" },
  primary: { background: "var(--primary)", color: "var(--primary-foreground)", border: "1px solid var(--primary)" },
  row: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" },
  list: { margin: 0, paddingLeft: "1.1rem", fontSize: "0.8125rem", display: "grid", gap: "0.125rem" },
  error: { color: "var(--destructive)", fontSize: "0.8125rem" },
} satisfies Record<string, CSSProperties>;

async function hostJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "include", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) {
    let message = text;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      // plain-text error body
    }
    throw new Error(message || `HTTP ${res.status}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

const ACTION_LABEL: Record<string, string> = { create: "dibuat", created: "dibuat", skip: "dilewati (sudah ada)", skipped: "dilewati (sudah ada)", update: "diperbarui", updated: "diperbarui" };

function TemplateCard({ template, companyId, engine, managerId }: { template: OfficeTemplate; companyId: string; engine: SourceAgent | undefined; managerId: string }) {
  const nav = useHostNavigation();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  function build() {
    if (!engine) throw new Error("Pilih dulu mesin AI untuk agent baru.");
    const copied = copyAdapterFrom(engine);
    return { files: buildOfficePackage(template, { adapter: copied.adapter, managerAgentId: managerId || null }), dropped: copied.dropped };
  }

  async function preview() {
    setPhase({ kind: "busy", label: "Memeriksa…" });
    try {
      const { files, dropped } = build();
      const result = await hostJson<Preview>(`/api/companies/${companyId}/imports/preview`, { method: "POST", body: JSON.stringify(importRequest(companyId, files, false)) });
      setPhase({ kind: "preview", preview: result, dropped });
    } catch (err) {
      setPhase({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function install() {
    setPhase({ kind: "busy", label: "Memasang…" });
    try {
      const { files } = build();
      const applied = await hostJson<Applied>(`/api/companies/${companyId}/imports/apply`, { method: "POST", body: JSON.stringify(importRequest(companyId, files, true)) });
      setPhase({ kind: "done", applied });
    } catch (err) {
      setPhase({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div style={s.card} data-office={template.key}>
      <div style={s.title}>{template.name}</div>
      <div style={s.hint}>{template.summary}</div>
      <ul style={s.list}>
        {template.agents.map((a) => <li key={a.slug}>{a.name}{a.reportsTo === null ? " (kepala)" : ""}</li>)}
      </ul>
      <div style={s.hint}>Routine: {template.routine.name}</div>

      {phase.kind === "preview" ? (
        <div style={{ display: "grid", gap: "0.375rem" }}>
          <ul style={s.list}>
            {phase.preview.plan.agentPlans.map((p) => <li key={p.slug}>{p.plannedName ?? p.slug}: {ACTION_LABEL[p.action] ?? p.action}</li>)}
            {phase.preview.plan.projectPlans.map((p) => <li key={`p-${p.slug}`}>Project {p.plannedName ?? p.slug}: {ACTION_LABEL[p.action] ?? p.action}</li>)}
            {phase.preview.plan.issuePlans.map((p) => <li key={`i-${p.slug}`}>Routine {p.plannedTitle ?? p.slug}: {ACTION_LABEL[p.action] ?? p.action}</li>)}
          </ul>
          {phase.dropped.length ? <div style={s.hint}>Nilai berikut tidak ikut disalin karena tersimpan langsung (bukan secret); isi ulang di halaman agent bila perlu: {phase.dropped.join(", ")}</div> : null}
          {phase.preview.warnings.map((w) => <div key={w} style={s.hint}>{w}</div>)}
          {phase.preview.errors.map((e) => <div key={e} style={s.error}>{e}</div>)}
        </div>
      ) : null}

      {phase.kind === "done" ? (
        <div style={{ display: "grid", gap: "0.375rem" }}>
          <ul style={s.list}>
            {phase.applied.agents.map((a) => (
              <li key={a.slug}>
                {a.id ? <a {...nav.linkProps(`/agents/${a.id}`)}>{a.name}</a> : a.name}: {ACTION_LABEL[a.action] ?? a.action}
              </li>
            ))}
          </ul>
          <div style={s.hint}>Agent baru dan routine-nya berstatus Dijeda. Beri izin tool yang perlu, lalu nyalakan (Resume) dari halaman agent.</div>
        </div>
      ) : null}

      {phase.kind === "error" ? <div style={s.error}>{phase.message}</div> : null}

      <div style={s.row}>
        <button type="button" style={s.btn} disabled={phase.kind === "busy" || !engine} onClick={preview}>Pratinjau</button>
        <button
          type="button"
          style={{ ...s.btn, ...s.primary }}
          disabled={phase.kind !== "preview" || phase.preview.errors.length > 0}
          onClick={install}
        >
          {phase.kind === "busy" ? phase.label : "Install office"}
        </button>
      </div>
    </div>
  );
}

export function InstallOfficePage({ context }: PluginPageProps) {
  const companyId = context.companyId ?? "";
  const [agents, setAgents] = useState<SourceAgent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [engineId, setEngineId] = useState("");
  const [managerId, setManagerId] = useState("");

  useEffect(() => {
    if (!companyId) return;
    hostJson<SourceAgent[]>(`/api/companies/${companyId}/agents`)
      .then((list) => {
        setAgents(list);
        setEngineId(defaultEngine(list)?.id ?? "");
        setManagerId(defaultManager(list)?.id ?? "");
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [companyId]);

  const candidates = useMemo(() => engineCandidates(agents ?? []), [agents]);
  const active = useMemo(() => (agents ?? []).filter((a) => a.status !== "terminated"), [agents]);
  const engine = candidates.find((a) => a.id === engineId);

  return (
    <div style={s.page}>
      <div>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>Install Office</h1>
        <div style={s.hint}>
          Pasang satu kantor siap pakai ke company ini. Agent dibuat dalam status Dijeda dan tanpa izin tool; board yang
          memberi izin dan menyalakannya. Memasang ulang tidak menggandakan agent yang sudah ada.
        </div>
      </div>
      {error ? <div style={s.error}>{error}</div> : null}
      {!agents && !error ? <div style={s.hint}>Memuat…</div> : null}
      {agents ? (
        <div style={{ ...s.card, gridTemplateColumns: "repeat(auto-fill, minmax(16rem, 1fr))" }}>
          <label style={s.label}>
            Mesin AI agent baru (disalin dari agent)
            <select style={s.select} value={engineId} onChange={(e) => setEngineId(e.target.value)}>
              {candidates.length === 0 ? <option value="">Belum ada agent dengan mesin AI</option> : null}
              {candidates.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.adapterType})</option>)}
            </select>
          </label>
          <label style={s.label}>
            Kepala office melapor ke
            <select style={s.select} value={managerId} onChange={(e) => setManagerId(e.target.value)}>
              <option value="">Tidak ada (jadi pimpinan tertinggi)</option>
              {active.map((a) => <option key={a.id} value={a.id}>{a.name}{a.role ? ` (${a.role})` : ""}</option>)}
            </select>
          </label>
          {candidates.length === 0 ? <div style={s.error}>Buat dulu satu agent yang memakai mesin AI (mis. Codex atau Claude), lalu kembali ke sini.</div> : null}
        </div>
      ) : null}
      <div style={s.grid}>
        {agents ? OFFICE_TEMPLATES.map((t) => <TemplateCard key={`${t.key}:${engineId}:${managerId}`} template={t} companyId={companyId} engine={engine} managerId={managerId} />) : null}
      </div>
    </div>
  );
}

export function InstallOfficeSidebarLink(_: PluginSidebarProps) {
  const nav = useHostNavigation();
  return (
    <a {...nav.linkProps(`/${PAGE_ROUTE}`)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", fontSize: 13, fontWeight: 500, color: "inherit", textDecoration: "none" }}>
      <span aria-hidden="true">🧩</span> Install Office
    </a>
  );
}
