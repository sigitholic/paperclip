import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { usePluginAction, type PluginSettingsPageProps } from "@paperclipai/plugin-sdk/ui";
import {
  configFromDraft,
  draftFromConfig,
  emptyRouter,
  tlsIsFixed,
  transportLabel,
  validateRouter,
  type RouterDraft,
  type SettingsDraft,
} from "./settings-model.js";
import type { PackConfig } from "../sources.js";

const PLUGIN_KEY = "starnet.pack-isp";

type Secret = { id: string; name: string };
type TestResult = { routers: Array<{ name: string; ok: boolean; summary?: string; error?: string }>; genieacs: { ok: boolean; summary?: string; error?: string } | null; error?: string };

const s = {
  page: { display: "grid", gap: "1rem", maxWidth: "60rem", minWidth: 0 },
  card: { border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--card)", padding: "0.875rem 1rem", display: "grid", gap: "0.75rem", minWidth: 0 },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" },
  title: { fontWeight: 600, fontSize: "0.9375rem" },
  hint: { color: "var(--muted-foreground)", fontSize: "0.8125rem" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" },
  th: { textAlign: "left", fontWeight: 500, color: "var(--muted-foreground)", padding: "0.375rem 0.5rem", borderBottom: "1px solid var(--border)" },
  td: { padding: "0.4rem 0.5rem", borderBottom: "1px solid var(--border)", verticalAlign: "middle" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(13rem, 1fr))", gap: "0.625rem 0.75rem" },
  label: { display: "grid", gap: "0.25rem", fontSize: "0.75rem", color: "var(--muted-foreground)" },
  input: { height: "2rem", padding: "0 0.5rem", border: "1px solid var(--input)", borderRadius: "calc(var(--radius) - 2px)", background: "var(--background)", color: "var(--foreground)", fontSize: "0.8125rem" },
  btn: { height: "2rem", padding: "0 0.75rem", border: "1px solid var(--border)", borderRadius: "calc(var(--radius) - 2px)", background: "var(--background)", color: "var(--foreground)", fontSize: "0.8125rem", cursor: "pointer" },
  primary: { background: "var(--primary)", color: "var(--primary-foreground)", border: "1px solid var(--primary)" },
  link: { background: "none", border: "none", padding: 0, color: "var(--foreground)", textDecoration: "underline", cursor: "pointer", fontSize: "0.8125rem" },
  error: { color: "var(--destructive)", fontSize: "0.8125rem" },
  ok: { color: "var(--foreground)", fontSize: "0.75rem" },
  footer: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" },
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

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label style={{ ...s.label, ...(wide ? { gridColumn: "1 / -1" } : {}) }}>
      {label}
      {children}
    </label>
  );
}

/** Pick an existing company secret or create one inline; the value goes straight to the host secret store. */
function SecretSelect({ companyId, value, onChange, secrets, onCreated, suggestedName }: {
  companyId: string;
  value: string;
  onChange: (id: string) => void;
  secrets: Secret[];
  onCreated: (secret: Secret) => void;
  suggestedName: string;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState(suggestedName);
  const [secretValue, setSecretValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const created = await hostJson<Secret>(`/api/companies/${companyId}/secrets`, { method: "POST", body: JSON.stringify({ name: name.trim(), value: secretValue }) });
      onCreated(created);
      onChange(created.id);
      setCreating(false);
      setSecretValue("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (creating) {
    return (
      <div style={{ display: "grid", gap: "0.375rem" }}>
        <input style={s.input} placeholder="Nama secret" value={name} onChange={(e) => setName(e.target.value)} />
        <input style={s.input} type="password" autoComplete="new-password" placeholder="Password" value={secretValue} onChange={(e) => setSecretValue(e.target.value)} />
        <div style={{ display: "flex", gap: "0.375rem" }}>
          <button type="button" style={s.btn} onClick={() => setCreating(false)} disabled={busy}>Batal</button>
          <button type="button" style={{ ...s.btn, ...s.primary }} onClick={create} disabled={busy || !name.trim() || !secretValue}>
            {busy ? "Menyimpan…" : "Buat secret"}
          </button>
        </div>
        {error ? <span style={s.error}>{error}</span> : null}
      </div>
    );
  }
  return (
    <select
      style={s.input}
      value={value}
      onChange={(e) => (e.target.value === "__new__" ? setCreating(true) : onChange(e.target.value))}
    >
      <option value="">— tanpa password —</option>
      {secrets.map((x) => (
        <option key={x.id} value={x.id}>{x.name}</option>
      ))}
      <option value="__new__">+ Buat secret baru…</option>
    </select>
  );
}

function RouterEditor({ draft, others, companyId, secrets, onSecretCreated, onCancel, onDone }: {
  draft: RouterDraft;
  others: RouterDraft[];
  companyId: string;
  secrets: Secret[];
  onSecretCreated: (secret: Secret) => void;
  onCancel: () => void;
  onDone: (r: RouterDraft) => void;
}) {
  const [r, setR] = useState(draft);
  const [touched, setTouched] = useState(false);
  const errors = validateRouter(r, others);
  const set = <K extends keyof RouterDraft>(key: K, value: RouterDraft[K]) => setR((prev) => ({ ...prev, [key]: value }));
  const fixedTls = tlsIsFixed(r);

  return (
    <div style={{ ...s.card, background: "var(--muted)" }}>
      <div style={s.grid}>
        <Field label="Nama (unik)"><input style={s.input} value={r.name} placeholder="bras-pusat" onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="Host / IP"><input style={s.input} value={r.host} placeholder="192.168.88.1" onChange={(e) => set("host", e.target.value)} /></Field>
        <Field label="Port"><input style={s.input} value={r.port} inputMode="numeric" placeholder="8728" onChange={(e) => set("port", e.target.value)} /></Field>
        <Field label="Protokol">
          <select style={s.input} value={r.protocol} onChange={(e) => set("protocol", e.target.value as RouterDraft["protocol"])}>
            <option value="">Otomatis dari port</option>
            <option value="api">RouterOS API</option>
            <option value="rest">REST (www/www-ssl)</option>
          </select>
        </Field>
        <Field label="Username"><input style={s.input} value={r.username} autoComplete="off" onChange={(e) => set("username", e.target.value)} /></Field>
        <Field label="Password (company secret)">
          <SecretSelect
            companyId={companyId}
            value={r.passwordSecretId}
            onChange={(id) => set("passwordSecretId", id)}
            secrets={secrets}
            onCreated={onSecretCreated}
            suggestedName={`mikrotik_${(r.name || "router").replace(/\W+/g, "_")}_password`}
          />
        </Field>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "center", fontSize: "0.8125rem" }}>
        <label style={{ display: "flex", gap: "0.375rem", alignItems: "center", opacity: fixedTls ? 0.5 : 1 }}>
          <input type="checkbox" disabled={fixedTls} checked={fixedTls ? r.port.trim() === "8729" : (r.useTls ?? r.protocol === "rest")} onChange={(e) => set("useTls", e.target.checked)} />
          TLS{fixedTls ? " (ditentukan port)" : ""}
        </label>
        <label style={{ display: "flex", gap: "0.375rem", alignItems: "center" }}>
          <input type="checkbox" checked={r.tlsVerify} onChange={(e) => set("tlsVerify", e.target.checked)} />
          Verifikasi sertifikat
        </label>
        <span style={s.hint}>Koneksi: {transportLabel(r)}</span>
      </div>
      {touched && errors.length ? <div style={s.error}>{errors.join(" · ")}</div> : null}
      <div style={s.footer}>
        <button type="button" style={s.btn} onClick={onCancel}>Batal</button>
        <button
          type="button"
          style={{ ...s.btn, ...s.primary }}
          onClick={() => {
            setTouched(true);
            if (!errors.length) onDone(r);
          }}
        >
          Simpan router
        </button>
      </div>
    </div>
  );
}

export function SettingsPage({ context }: PluginSettingsPageProps) {
  const companyId = context.companyId;
  const testConnections = usePluginAction("test-connections");
  const [base, setBase] = useState<Record<string, unknown>>({});
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    Promise.all([
      hostJson<{ configJson?: Record<string, unknown> } | null>(`/api/plugins/${PLUGIN_KEY}/config?companyId=${encodeURIComponent(companyId)}`),
      hostJson<Array<Secret & { scope?: string; status?: string; deletedAt?: string | null }>>(`/api/companies/${companyId}/secrets`),
    ])
      .then(([config, list]) => {
        if (cancelled) return;
        const raw = config?.configJson ?? {};
        const d = draftFromConfig(raw as PackConfig);
        setBase(raw);
        setDraft(d);
        setSaved(JSON.stringify(d));
        setSecrets(list.filter((x) => (x.scope ?? "company") === "company" && !x.deletedAt).map(({ id, name }) => ({ id, name })));
      })
      .catch((err) => !cancelled && setStatus({ tone: "error", text: err instanceof Error ? err.message : String(err) }));
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const dirty = useMemo(() => (draft ? JSON.stringify(draft) !== saved : false), [draft, saved]);
  const secretName = (id: string) => secrets.find((x) => x.id === id)?.name ?? (id ? "(secret tidak ditemukan)" : "—");

  if (!companyId) return <div style={s.hint}>Pilih company terlebih dahulu.</div>;
  if (!draft) return <div style={s.hint}>{status?.text ?? "Memuat konfigurasi…"}</div>;

  const update = (patch: Partial<SettingsDraft>) => setDraft({ ...draft, ...patch });
  const onSecretCreated = (secret: Secret) => setSecrets((prev) => [...prev, secret].sort((a, b) => a.name.localeCompare(b.name)));

  async function save() {
    if (!draft) return;
    setSaving(true);
    setStatus(null);
    try {
      const configJson = configFromDraft(base, draft);
      await hostJson(`/api/plugins/${PLUGIN_KEY}/config`, { method: "POST", body: JSON.stringify({ companyId, configJson }) });
      setBase(configJson);
      setSaved(JSON.stringify(draft));
      setTest(null);
      setStatus({ tone: "ok", text: "Tersimpan." });
    } catch (err) {
      setStatus({ tone: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    setTesting(true);
    setStatus(null);
    try {
      setTest((await testConnections({ companyId })) as TestResult);
    } catch (err) {
      setStatus({ tone: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  }

  const testFor = (name: string) => test?.routers.find((x) => x.name === name);

  return (
    <div style={s.page}>
      <section style={s.card}>
        <div style={s.head}>
          <div>
            <div style={s.title}>Router MikroTik</div>
            <div style={s.hint}>Port 8728/8729 memakai RouterOS API. Gunakan user dengan group read + api.</div>
          </div>
          <button type="button" style={s.btn} onClick={() => setEditing("new")} disabled={editing !== null}>+ Tambah router</button>
        </div>

        {draft.routers.length ? (
          <div style={{ overflowX: "auto" }}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Nama</th>
                <th style={s.th}>Host</th>
                <th style={s.th}>Koneksi</th>
                <th style={s.th}>User</th>
                <th style={s.th}>Password</th>
                <th style={s.th}>Status</th>
                <th style={s.th} />
              </tr>
            </thead>
            <tbody>
              {draft.routers.map((r, i) => {
                const t = testFor(r.name);
                return (
                  <tr key={`${r.name}-${i}`}>
                    <td style={{ ...s.td, fontWeight: 500 }}>{r.name}</td>
                    <td style={s.td}>{r.host}</td>
                    <td style={{ ...s.td, whiteSpace: "nowrap" }}>{transportLabel(r)}</td>
                    <td style={s.td}>{r.username || "—"}</td>
                    <td style={s.td}>{secretName(r.passwordSecretId)}</td>
                    <td style={{ ...s.td, maxWidth: "14rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t?.error ?? t?.summary}>
                      {t ? <span style={t.ok ? s.ok : s.error}>{t.ok ? `OK · ${t.summary}` : `Gagal · ${t.error}`}</span> : <span style={s.hint}>—</span>}
                    </td>
                    <td style={{ ...s.td, whiteSpace: "nowrap", textAlign: "right" }}>
                      <button type="button" style={s.link} onClick={() => setEditing(i)} disabled={editing !== null}>Ubah</button>{" "}
                      <button
                        type="button"
                        style={{ ...s.link, color: "var(--destructive)" }}
                        disabled={editing !== null}
                        onClick={() => window.confirm(`Hapus router "${r.name}"?`) && update({ routers: draft.routers.filter((_, j) => j !== i) })}
                      >
                        Hapus
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        ) : (
          <div style={s.hint}>Belum ada router. Tanpa router, tool MikroTik memakai data MOCK.</div>
        )}

        {editing !== null ? (
          <RouterEditor
            key={String(editing)}
            draft={editing === "new" ? emptyRouter() : draft.routers[editing]!}
            others={draft.routers.filter((_, j) => j !== editing)}
            companyId={companyId}
            secrets={secrets}
            onSecretCreated={onSecretCreated}
            onCancel={() => setEditing(null)}
            onDone={(r) => {
              update({ routers: editing === "new" ? [...draft.routers, r] : draft.routers.map((x, j) => (j === editing ? r : x)) });
              setEditing(null);
            }}
          />
        ) : null}
      </section>

      <section style={s.card}>
        <div style={s.head}>
          <div style={s.title}>GenieACS</div>
          {test?.genieacs ? (
            <span style={test.genieacs.ok ? s.ok : s.error}>{test.genieacs.ok ? `OK · ${test.genieacs.summary}` : `Gagal · ${test.genieacs.error}`}</span>
          ) : null}
        </div>
        <div style={s.grid}>
          <Field label="NBI URL"><input style={s.input} value={draft.genieacsBaseUrl} placeholder="http://acs:7557" onChange={(e) => update({ genieacsBaseUrl: e.target.value })} /></Field>
          <Field label="Username"><input style={s.input} value={draft.genieacsUsername} autoComplete="off" onChange={(e) => update({ genieacsUsername: e.target.value })} /></Field>
          <Field label="Password (company secret)">
            <SecretSelect
              companyId={companyId}
              value={draft.genieacsPasswordSecretId}
              onChange={(id) => update({ genieacsPasswordSecretId: id })}
              secrets={secrets}
              onCreated={onSecretCreated}
              suggestedName="genieacs_password"
            />
          </Field>
        </div>
      </section>

      <details style={s.card}>
        <summary style={{ ...s.title, cursor: "pointer" }}>Lanjutan</summary>
        <div style={s.grid}>
          <Field label="CPE online jika inform dalam (menit)"><input style={s.input} value={draft.onlineWindowMinutes} placeholder="15" inputMode="numeric" onChange={(e) => update({ onlineWindowMinutes: e.target.value })} /></Field>
          <Field label="Timeout per request (ms)"><input style={s.input} value={draft.timeoutMs} placeholder="8000" inputMode="numeric" onChange={(e) => update({ timeoutMs: e.target.value })} /></Field>
        </div>
      </details>

      <div style={s.footer}>
        <button type="button" style={s.btn} onClick={runTest} disabled={testing || dirty || editing !== null} title={dirty ? "Simpan dulu sebelum tes" : undefined}>
          {testing ? "Menguji…" : "Tes koneksi"}
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {status ? <span style={status.tone === "ok" ? s.ok : s.error}>{status.text}</span> : dirty ? <span style={s.hint}>Ada perubahan belum disimpan</span> : null}
          {test?.error ? <span style={s.error}>{test.error}</span> : null}
          <button type="button" style={{ ...s.btn, ...s.primary }} onClick={save} disabled={saving || !dirty || editing !== null}>
            {saving ? "Menyimpan…" : "Simpan"}
          </button>
        </div>
      </div>
    </div>
  );
}
