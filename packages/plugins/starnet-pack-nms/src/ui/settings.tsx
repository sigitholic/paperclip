import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { usePluginAction, type PluginSettingsPageProps } from "@paperclipai/plugin-sdk/ui";
import { ALERT_WEBHOOK_KEY, PLUGIN_ID } from "../manifest.js";
import { NMS_KINDS, SEVERITIES, type PackConfig } from "../model.js";
import {
  configFromDraft,
  draftFromConfig,
  emptySource,
  libreTemplate,
  validateSettings,
  validateSource,
  webhookUrl,
  zabbixTemplate,
  type SettingsDraft,
  type SourceDraft,
} from "./settings-model.js";

type Secret = { id: string; name: string };
type Agent = { id: string; name: string; status?: string };
type TestResult = { sources: Array<{ name: string; ok: boolean; summary?: string; error?: string }>; error?: string };

const KIND_LABEL: Record<SourceDraft["kind"], string> = { zabbix: "Zabbix", librenms: "LibreNMS" };

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
  code: { margin: 0, padding: "0.5rem 0.625rem", background: "var(--muted)", borderRadius: "calc(var(--radius) - 2px)", fontSize: "0.75rem", whiteSpace: "pre-wrap", wordBreak: "break-all", fontFamily: "var(--font-mono, monospace)" },
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

function Copyable({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ display: "grid", gap: "0.25rem" }}>
      <div style={{ ...s.label, ...s.head }}>
        <span>{label}</span>
        <button
          type="button"
          style={s.link}
          onClick={() => void navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
        >
          {copied ? "Tersalin" : "Salin"}
        </button>
      </div>
      <pre style={s.code}>{text}</pre>
    </div>
  );
}

/** Pick an existing company secret or create one inline; the value goes straight to the host secret store. */
function SecretSelect({ companyId, value, onChange, secrets, onCreated, suggestedName, emptyLabel }: {
  companyId: string;
  value: string;
  onChange: (id: string) => void;
  secrets: Secret[];
  onCreated: (secret: Secret) => void;
  suggestedName: string;
  emptyLabel: string;
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
        <input style={s.input} type="password" autoComplete="new-password" placeholder="Nilai secret" value={secretValue} onChange={(e) => setSecretValue(e.target.value)} />
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
    <select style={s.input} value={value} onChange={(e) => (e.target.value === "__new__" ? setCreating(true) : onChange(e.target.value))}>
      <option value="">{emptyLabel}</option>
      {secrets.map((x) => (
        <option key={x.id} value={x.id}>{x.name}</option>
      ))}
      <option value="__new__">+ Buat secret baru…</option>
    </select>
  );
}

function SourceEditor({ draft, others, companyId, secrets, onSecretCreated, onCancel, onDone }: {
  draft: SourceDraft;
  others: SourceDraft[];
  companyId: string;
  secrets: Secret[];
  onSecretCreated: (secret: Secret) => void;
  onCancel: () => void;
  onDone: (src: SourceDraft) => void;
}) {
  const [src, setSrc] = useState(draft);
  const [touched, setTouched] = useState(false);
  const errors = validateSource(src, others);
  const set = <K extends keyof SourceDraft>(key: K, value: SourceDraft[K]) => setSrc((prev) => ({ ...prev, [key]: value }));

  return (
    <div style={{ ...s.card, background: "var(--muted)" }}>
      <div style={s.grid}>
        <Field label="Nama (unik)"><input style={s.input} value={src.name} placeholder="zabbix-pusat" onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="Jenis">
          <select style={s.input} value={src.kind} onChange={(e) => set("kind", e.target.value as SourceDraft["kind"])}>
            {NMS_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </Field>
        <Field label="URL">
          <input style={s.input} value={src.baseUrl} placeholder={src.kind === "zabbix" ? "https://nms.example/zabbix" : "https://librenms.example"} onChange={(e) => set("baseUrl", e.target.value)} />
        </Field>
        <Field label="Token API (company secret)">
          <SecretSelect
            companyId={companyId}
            value={src.tokenSecretId}
            onChange={(id) => set("tokenSecretId", id)}
            secrets={secrets}
            onCreated={onSecretCreated}
            suggestedName={`${src.kind}_${(src.name || "nms").replace(/\W+/g, "_")}_token`}
            emptyLabel="— pilih token —"
          />
        </Field>
      </div>
      <span style={s.hint}>
        {src.kind === "zabbix"
          ? "Zabbix 5.4+: Users → API tokens. Pakai user dengan role read-only."
          : "LibreNMS: Settings → API → Create API access token. Pakai user read-only."}
      </span>
      {touched && errors.length ? <div style={s.error}>{errors.join(" · ")}</div> : null}
      <div style={s.footer}>
        <button type="button" style={s.btn} onClick={onCancel}>Batal</button>
        <button
          type="button"
          style={{ ...s.btn, ...s.primary }}
          onClick={() => {
            setTouched(true);
            if (!errors.length) onDone(src);
          }}
        >
          Simpan source
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
  const [saved, setSaved] = useState("");
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    Promise.all([
      hostJson<{ configJson?: Record<string, unknown> } | null>(`/api/plugins/${PLUGIN_ID}/config?companyId=${encodeURIComponent(companyId)}`),
      hostJson<Array<Secret & { scope?: string; deletedAt?: string | null }>>(`/api/companies/${companyId}/secrets`),
      hostJson<Agent[]>(`/api/companies/${companyId}/agents`),
    ])
      .then(([config, secretList, agentList]) => {
        if (cancelled) return;
        const raw = config?.configJson ?? {};
        const d = draftFromConfig(raw as PackConfig);
        setBase(raw);
        setDraft(d);
        setSaved(JSON.stringify(d));
        setSecrets(secretList.filter((x) => (x.scope ?? "company") === "company" && !x.deletedAt).map(({ id, name }) => ({ id, name })));
        setAgents(agentList.filter((a) => a.status !== "terminated").map(({ id, name, status }) => ({ id, name, status })));
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
  const settingsErrors = validateSettings(draft);
  const url = webhookUrl(window.location.origin, PLUGIN_ID, ALERT_WEBHOOK_KEY);
  const zbx = zabbixTemplate(url, companyId);
  const lnms = libreTemplate(url, companyId);

  async function save() {
    if (!draft || settingsErrors.length) return;
    setSaving(true);
    setStatus(null);
    try {
      const configJson = configFromDraft(base, draft);
      await hostJson(`/api/plugins/${PLUGIN_ID}/config`, { method: "POST", body: JSON.stringify({ companyId, configJson }) });
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

  const testFor = (name: string) => test?.sources.find((x) => x.name === name);

  return (
    <div style={s.page}>
      <section style={s.card}>
        <div style={s.head}>
          <div>
            <div style={s.title}>Sumber NMS</div>
            <div style={s.hint}>Zabbix dan LibreNMS, dibaca read-only oleh agent NOC.</div>
          </div>
          <button type="button" style={s.btn} onClick={() => setEditing("new")} disabled={editing !== null}>+ Tambah source</button>
        </div>

        {draft.sources.length ? (
          <div style={{ overflowX: "auto" }}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Nama</th>
                  <th style={s.th}>Jenis</th>
                  <th style={s.th}>URL</th>
                  <th style={s.th}>Token</th>
                  <th style={s.th}>Status</th>
                  <th style={s.th} />
                </tr>
              </thead>
              <tbody>
                {draft.sources.map((src, i) => {
                  const t = testFor(src.name);
                  return (
                    <tr key={`${src.name}-${i}`}>
                      <td style={{ ...s.td, fontWeight: 500 }}>{src.name}</td>
                      <td style={s.td}>{KIND_LABEL[src.kind]}</td>
                      <td style={{ ...s.td, maxWidth: "16rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={src.baseUrl}>{src.baseUrl}</td>
                      <td style={s.td}>{secretName(src.tokenSecretId)}</td>
                      <td style={{ ...s.td, maxWidth: "14rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t?.error ?? t?.summary}>
                        {t ? <span style={t.ok ? s.ok : s.error}>{t.ok ? `OK · ${t.summary}` : `Gagal · ${t.error}`}</span> : <span style={s.hint}>—</span>}
                      </td>
                      <td style={{ ...s.td, whiteSpace: "nowrap", textAlign: "right" }}>
                        <button type="button" style={s.link} onClick={() => setEditing(i)} disabled={editing !== null}>Ubah</button>{" "}
                        <button
                          type="button"
                          style={{ ...s.link, color: "var(--destructive)" }}
                          disabled={editing !== null}
                          onClick={() => window.confirm(`Hapus source "${src.name}"?`) && update({ sources: draft.sources.filter((_, j) => j !== i) })}
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
          <div style={s.hint}>Belum ada source. Tanpa source, tool NMS memakai data MOCK.</div>
        )}

        {editing !== null ? (
          <SourceEditor
            key={String(editing)}
            draft={editing === "new" ? emptySource() : draft.sources[editing]!}
            others={draft.sources.filter((_, j) => j !== editing)}
            companyId={companyId}
            secrets={secrets}
            onSecretCreated={onSecretCreated}
            onCancel={() => setEditing(null)}
            onDone={(src) => {
              update({ sources: editing === "new" ? [...draft.sources, src] : draft.sources.map((x, j) => (j === editing ? src : x)) });
              setEditing(null);
            }}
          />
        ) : null}
      </section>

      <section style={s.card}>
        <div>
          <div style={s.title}>Alert → Issue NOC</div>
          <div style={s.hint}>NMS mengirim alert ke webhook; plugin membuat issue dan menutupnya otomatis saat pulih.</div>
        </div>
        <div style={s.grid}>
          <Field label="Secret webhook (company secret)">
            <SecretSelect
              companyId={companyId}
              value={draft.webhookSecretId}
              onChange={(id) => update({ webhookSecretId: id })}
              secrets={secrets}
              onCreated={onSecretCreated}
              suggestedName="nms_webhook_secret"
              emptyLabel="— webhook nonaktif —"
            />
          </Field>
          <Field label="Assign issue ke agent">
            <select style={s.input} value={draft.alertAssigneeAgentId} onChange={(e) => update({ alertAssigneeAgentId: e.target.value })}>
              <option value="">— tidak di-assign —</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              {draft.alertAssigneeAgentId && !agents.some((a) => a.id === draft.alertAssigneeAgentId) ? <option value={draft.alertAssigneeAgentId}>(agent tidak ditemukan)</option> : null}
            </select>
          </Field>
          <Field label="Severity minimum">
            <select style={s.input} value={draft.alertMinSeverity} onChange={(e) => update({ alertMinSeverity: e.target.value as SettingsDraft["alertMinSeverity"] })}>
              {SEVERITIES.map((sev) => <option key={sev} value={sev}>{sev}</option>)}
            </select>
          </Field>
          <Field label="Maks issue baru per jam">
            <input style={s.input} value={draft.maxNewIssuesPerHour} placeholder="30" inputMode="numeric" onChange={(e) => update({ maxNewIssuesPerHour: e.target.value })} />
          </Field>
        </div>
        {draft.webhookSecretId ? (
          <details>
            <summary style={{ ...s.hint, cursor: "pointer" }}>Cara menghubungkan Zabbix / LibreNMS</summary>
            <div style={{ display: "grid", gap: "0.75rem", marginTop: "0.625rem" }}>
              <Copyable label="Webhook URL (harus bisa dijangkau server NMS)" text={url} />
              <div style={s.hint}>
                <strong>Zabbix 6.0+</strong>: Alerts → Media types → Create, tipe Webhook. Buat global macro <code>{"{$STARNET_WEBHOOK_SECRET}"}</code> bertipe Secret text berisi nilai secret webhook di atas.
                Tambahkan media ke user, lalu buat trigger action yang mengirim ke media ini untuk problem dan recovery.
              </div>
              <Copyable label="Parameter media type" text={zbx.parameters.map(([k, v]) => `${k} = ${v}`).join("\n")} />
              <Copyable label="Script media type" text={zbx.script} />
              <div style={s.hint}>
                <strong>LibreNMS</strong>: Alerts → Alert Transports → API, method POST. Ganti <code>&lt;ISI_TOKEN_WEBHOOK&gt;</code> dengan nilai secret webhook.
                LibreNMS tidak bisa menandatangani payload, jadi token ikut tercatat di log delivery webhook Paperclip — pakai secret khusus untuk webhook ini.
              </div>
              <Copyable label="API URL" text={lnms.url} />
              <Copyable label="Headers" text={lnms.headers} />
              <Copyable label="Body" text={lnms.body} />
            </div>
          </details>
        ) : (
          <div style={s.hint}>Pilih atau buat secret webhook untuk mengaktifkan alert dan menampilkan template konfigurasi NMS.</div>
        )}
      </section>

      <details style={s.card}>
        <summary style={{ ...s.title, cursor: "pointer" }}>Lanjutan</summary>
        <div style={s.grid}>
          <Field label="Timeout per request (ms)"><input style={s.input} value={draft.timeoutMs} placeholder="8000" inputMode="numeric" onChange={(e) => update({ timeoutMs: e.target.value })} /></Field>
        </div>
      </details>

      <div style={s.footer}>
        <button type="button" style={s.btn} onClick={runTest} disabled={testing || dirty || editing !== null || !draft.sources.length} title={dirty ? "Simpan dulu sebelum tes" : undefined}>
          {testing ? "Menguji…" : "Tes koneksi"}
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {settingsErrors.length ? <span style={s.error}>{settingsErrors.join(" · ")}</span> : null}
          {status ? <span style={status.tone === "ok" ? s.ok : s.error}>{status.text}</span> : dirty ? <span style={s.hint}>Ada perubahan belum disimpan</span> : null}
          {test?.error ? <span style={s.error}>{test.error}</span> : null}
          <button type="button" style={{ ...s.btn, ...s.primary }} onClick={save} disabled={saving || !dirty || editing !== null || settingsErrors.length > 0}>
            {saving ? "Menyimpan…" : "Simpan"}
          </button>
        </div>
      </div>
    </div>
  );
}
