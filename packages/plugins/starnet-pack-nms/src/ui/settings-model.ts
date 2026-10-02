import { isNmsKind, isSeverity, type NmsKind, type PackConfig, type Severity } from "../model.js";

/** Form state of one NMS source. Empty string = not set. */
export interface SourceDraft {
  name: string;
  kind: NmsKind;
  baseUrl: string;
  tokenSecretId: string;
}

export interface SettingsDraft {
  sources: SourceDraft[];
  webhookSecretId: string;
  alertAssigneeAgentId: string;
  alertMinSeverity: Severity;
  maxNewIssuesPerHour: string;
  timeoutMs: string;
}

const MANAGED_KEYS = ["nmsSources", "webhookToken", "alertAssigneeAgentId", "alertMinSeverity", "maxNewIssuesPerHour", "timeoutMs"] as const;

export const emptySource = (): SourceDraft => ({ name: "", kind: "zabbix", baseUrl: "", tokenSecretId: "" });

function secretIdOf(ref: unknown): string {
  return ref && typeof ref === "object" && typeof (ref as { secretId?: unknown }).secretId === "string" ? (ref as { secretId: string }).secretId : "";
}

const secretRef = (secretId: string) => (secretId ? { type: "secret_ref", secretId } : undefined);
const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const num = (v: string) => (v.trim() === "" ? undefined : Number(v));

export function draftFromConfig(c: PackConfig): SettingsDraft {
  return {
    sources: (c.nmsSources ?? []).map((s, i) => {
      const kind = isNmsKind(s?.kind) ? s.kind : "zabbix";
      return { name: s?.name?.trim() || `${kind}-${i + 1}`, kind, baseUrl: str(s?.baseUrl), tokenSecretId: secretIdOf(s?.token) };
    }),
    webhookSecretId: secretIdOf(c.webhookToken),
    alertAssigneeAgentId: str(c.alertAssigneeAgentId),
    alertMinSeverity: isSeverity(c.alertMinSeverity) ? c.alertMinSeverity : "warning",
    maxNewIssuesPerHour: str(c.maxNewIssuesPerHour),
    timeoutMs: str(c.timeoutMs),
  };
}

function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as Partial<T>;
}

/** Writes the managed keys from the draft; unknown keys in `base` are kept. */
export function configFromDraft(base: Record<string, unknown>, d: SettingsDraft): Record<string, unknown> {
  const next: Record<string, unknown> = { ...base };
  for (const key of MANAGED_KEYS) delete next[key];
  return {
    ...next,
    nmsSources: d.sources.map((s) => compact({ name: s.name.trim(), kind: s.kind, baseUrl: s.baseUrl.trim(), token: secretRef(s.tokenSecretId) })),
    ...compact({
      webhookToken: secretRef(d.webhookSecretId),
      alertAssigneeAgentId: d.alertAssigneeAgentId.trim(),
      alertMinSeverity: d.alertMinSeverity,
      maxNewIssuesPerHour: num(d.maxNewIssuesPerHour),
      timeoutMs: num(d.timeoutMs),
    }),
  };
}

export function validateSource(s: SourceDraft, others: SourceDraft[]): string[] {
  const errors: string[] = [];
  const name = s.name.trim();
  if (!name) errors.push("Nama wajib diisi");
  else if (!/^[\w.-]+$/.test(name)) errors.push("Nama hanya huruf, angka, titik, minus, garis bawah");
  else if (others.some((o) => o.name.trim() === name)) errors.push(`Nama "${name}" sudah dipakai`);
  if (!/^https?:\/\/\S+$/.test(s.baseUrl.trim())) errors.push("URL harus diawali http:// atau https://");
  if (!s.tokenSecretId) errors.push("Token API wajib dipilih");
  return errors;
}

export function validateSettings(d: SettingsDraft): string[] {
  const errors: string[] = [];
  const max = num(d.maxNewIssuesPerHour);
  if (max !== undefined && !(Number.isInteger(max) && max > 0)) errors.push("Batas issue per jam harus bilangan bulat > 0");
  const timeout = num(d.timeoutMs);
  if (timeout !== undefined && !(Number.isInteger(timeout) && timeout >= 1000)) errors.push("Timeout minimal 1000 ms");
  return errors;
}

export const webhookUrl = (origin: string, pluginKey: string, endpointKey: string) =>
  `${origin.replace(/\/+$/, "")}/api/plugins/${pluginKey}/webhooks/${endpointKey}`;

/**
 * Zabbix (6.0+) webhook media type script. Parameters are filled from Zabbix macros; the secret
 * should be a Secret-type global macro such as {$STARNET_WEBHOOK_SECRET}.
 */
export function zabbixTemplate(url: string, companyId: string): { parameters: Array<[string, string]>; script: string } {
  return {
    parameters: [
      ["url", url],
      ["company", companyId],
      ["secret", "{$STARNET_WEBHOOK_SECRET}"],
      ["source", "zabbix"],
      ["eventid", "{EVENT.ID}"],
      ["value", "{EVENT.VALUE}"],
      ["severity", "{EVENT.NSEVERITY}"],
      ["host", "{HOST.NAME}"],
      ["name", "{EVENT.NAME}"],
      ["since", "{EVENT.DATE} {EVENT.TIME}"],
    ],
    script: [
      "var p = JSON.parse(value);",
      "var body = JSON.stringify({",
      "  source: p.source, eventId: p.eventid, status: p.value === '0' ? 'resolved' : 'problem',",
      "  severity: p.severity, host: p.host, name: p.name, since: p.since",
      "});",
      "var req = new HttpRequest();",
      "req.addHeader('Content-Type: application/json');",
      "req.addHeader('x-starnet-company: ' + p.company);",
      "req.addHeader('x-starnet-signature: sha256=' + hmac('sha256', p.secret, body));",
      "var res = req.post(p.url, body);",
      "if (req.getStatus() !== 200) { throw 'Starnet webhook HTTP ' + req.getStatus() + ': ' + res; }",
      "return 'OK';",
    ].join("\n"),
  };
}

/** LibreNMS "API" transport (POST). LibreNMS cannot sign, so the token is sent as a header. */
export function libreTemplate(url: string, companyId: string): { url: string; headers: string; body: string } {
  return {
    url,
    headers: [`x-starnet-company=${companyId}`, "x-starnet-token=<ISI_TOKEN_WEBHOOK>", "content-type=application/json"].join("\n"),
    body: JSON.stringify(
      {
        source: "librenms",
        eventId: "{{ $device_id }}-{{ $rule_id }}",
        status: "{{ $state }}",
        severity: "{{ $severity }}",
        host: "{{ $hostname }}",
        name: "{{ $name }}",
        since: "{{ $timestamp }}",
      },
      null,
      2,
    ),
  };
}
