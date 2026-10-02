import { fetchJson, type PackMode } from "@starnet/pack-kit";
import { isNmsKind, type NmsKind, type PackConfig, type Severity } from "./model.js";

export type ResolveSecret = (ref: unknown, configPath: string) => Promise<string>;

export interface NmsSource {
  name: string;
  kind: NmsKind;
  baseUrl: string;
  token: unknown;
  tokenPath: string;
}

export interface Problem { source: string; id: string; host: string; name: string; severity: Severity; since: string | null }
export type HostState = "up" | "down" | "unknown" | "disabled";
export interface HostStatus { source: string; id: string; name: string; address: string | null; status: HostState }

export type SourceOutcome<T> = { source: string; ok: true; value: T } | { source: string; ok: false; error: string };

const MOCK_SOURCE = "mock";
const SOURCE_CONCURRENCY = 4;

/** Sources with a kind and URL, in config order. Names must be unique. */
export function nmsSources(c: PackConfig): NmsSource[] {
  const out: NmsSource[] = [];
  (c.nmsSources ?? []).forEach((s, i) => {
    if (!isNmsKind(s?.kind) || !s.baseUrl?.trim()) return;
    out.push({
      name: s.name?.trim() || `${s.kind}-${i + 1}`,
      kind: s.kind,
      baseUrl: s.baseUrl.trim().replace(/\/+$/, ""),
      token: s.token,
      tokenPath: `nmsSources.${i}.token`,
    });
  });
  const seen = new Set<string>();
  for (const s of out) {
    if (seen.has(s.name)) throw new Error(`duplicate NMS source name "${s.name}"`);
    seen.add(s.name);
  }
  return out;
}

export const nmsMode = (c: PackConfig): PackMode => (nmsSources(c).length ? "live" : "mock");

function selectSources(c: PackConfig, name?: string): NmsSource[] {
  const all = nmsSources(c);
  if (!name) return all;
  const found = all.find((s) => s.name === name);
  if (!found) throw new Error(`unknown NMS source "${name}"; configured: ${all.map((s) => s.name).join(", ") || "none"}`);
  return [found];
}

/** Run `fn` per source with bounded concurrency; fails only when every source fails. */
async function eachSource<T>(sources: NmsSource[], fn: (s: NmsSource) => Promise<T>): Promise<SourceOutcome<T>[]> {
  const out: SourceOutcome<T>[] = new Array(sources.length);
  let next = 0;
  async function worker() {
    while (next < sources.length) {
      const i = next++;
      const s = sources[i]!;
      try {
        out[i] = { source: s.name, ok: true, value: await fn(s) };
      } catch (err) {
        out[i] = { source: s.name, ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(SOURCE_CONCURRENCY, sources.length) }, worker));
  if (out.length && out.every((o) => !o.ok)) throw new Error(out.map((o) => `${o.source}: ${o.ok ? "" : o.error}`).join("; "));
  return out;
}

// --- Zabbix (JSON-RPC, API token as Bearer; Zabbix >= 5.4) ---------------------------------

const ZABBIX_SEVERITY: Record<string, Severity> = { "0": "info", "1": "info", "2": "warning", "3": "average", "4": "high", "5": "disaster" };

async function zabbix<T>(s: NmsSource, token: string, method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<T> {
  const url = s.baseUrl.endsWith("api_jsonrpc.php") ? s.baseUrl : `${s.baseUrl}/api_jsonrpc.php`;
  const res = await fetchJson<{ result?: T; error?: { message?: string; data?: string } }>(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: { jsonrpc: "2.0", method, params, id: 1 },
    timeoutMs,
  });
  if (res.error) throw new Error(`Zabbix ${method}: ${res.error.message ?? "error"}${res.error.data ? ` (${res.error.data})` : ""}`);
  return res.result as T;
}

async function zabbixProblems(s: NmsSource, token: string, limit: number, timeoutMs?: number): Promise<Problem[]> {
  const triggers = await zabbix<Array<{ triggerid: string; description: string; priority: string; lastchange: string; hosts?: Array<{ name: string }> }>>(
    s,
    token,
    "trigger.get",
    {
      output: ["triggerid", "description", "priority", "lastchange"],
      filter: { value: 1 },
      monitored: true,
      active: true,
      skipDependent: true,
      expandDescription: true,
      selectHosts: ["name"],
      sortfield: "lastchange",
      sortorder: "DESC",
      limit,
    },
    timeoutMs,
  );
  return triggers.map((t) => ({
    source: s.name,
    id: t.triggerid,
    host: t.hosts?.map((h) => h.name).join(", ") ?? "",
    name: t.description,
    severity: ZABBIX_SEVERITY[t.priority] ?? "info",
    since: Number(t.lastchange) ? new Date(Number(t.lastchange) * 1000).toISOString() : null,
  }));
}

async function zabbixHosts(s: NmsSource, token: string, timeoutMs?: number): Promise<HostStatus[]> {
  const hosts = await zabbix<Array<{ hostid: string; name: string; status: string; interfaces?: Array<{ ip: string; available: string; main: string }> }>>(
    s,
    token,
    "host.get",
    { output: ["hostid", "name", "status"], selectInterfaces: ["ip", "available", "main"], sortfield: "name" },
    timeoutMs,
  );
  return hosts.map((h) => {
    const ifaces = h.interfaces ?? [];
    const status: HostState =
      h.status === "1" ? "disabled" : ifaces.some((i) => i.available === "1") ? "up" : ifaces.some((i) => i.available === "2") ? "down" : "unknown";
    return { source: s.name, id: h.hostid, name: h.name, address: (ifaces.find((i) => i.main === "1") ?? ifaces[0])?.ip || null, status };
  });
}

// --- LibreNMS (REST /api/v0, X-Auth-Token) ----------------------------------------------------

type LibreDevice = { device_id: number | string; hostname?: string; sysName?: string; display?: string; ip?: string; status?: number | boolean | string; disabled?: number | boolean | string };

const LIBRE_SEVERITY: Record<string, Severity> = { ok: "info", warning: "warning", critical: "high" };
const truthy = (v: unknown) => v === true || v === 1 || v === "1";

async function libre<T>(s: NmsSource, token: string, path: string, timeoutMs?: number): Promise<T> {
  return fetchJson<T>(`${s.baseUrl}/api/v0${path}`, { headers: { "x-auth-token": token }, timeoutMs });
}

const libreName = (d: LibreDevice | undefined) => d?.display || d?.sysName || d?.hostname || "";

async function libreDevices(s: NmsSource, token: string, timeoutMs?: number): Promise<LibreDevice[]> {
  return (await libre<{ devices?: LibreDevice[] }>(s, token, "/devices?type=all", timeoutMs)).devices ?? [];
}

async function libreProblems(s: NmsSource, token: string, limit: number, timeoutMs?: number): Promise<Problem[]> {
  const [alerts, rules, devices] = await Promise.all([
    libre<{ alerts?: Array<{ id: number | string; device_id: number | string; rule_id: number | string; severity?: string; timestamp?: string; hostname?: string; name?: string }> }>(s, token, "/alerts?state=1", timeoutMs),
    libre<{ rules?: Array<{ id: number | string; name: string }> }>(s, token, "/rules", timeoutMs),
    libreDevices(s, token, timeoutMs),
  ]);
  const ruleName = new Map((rules.rules ?? []).map((r) => [String(r.id), r.name]));
  const device = new Map(devices.map((d) => [String(d.device_id), d]));
  return (alerts.alerts ?? []).slice(0, limit).map((a) => ({
    source: s.name,
    id: String(a.id),
    host: a.hostname || libreName(device.get(String(a.device_id))),
    name: a.name || ruleName.get(String(a.rule_id)) || `rule ${a.rule_id}`,
    severity: LIBRE_SEVERITY[(a.severity ?? "").toLowerCase()] ?? "info",
    since: a.timestamp && !Number.isNaN(Date.parse(a.timestamp)) ? new Date(a.timestamp).toISOString() : (a.timestamp ?? null),
  }));
}

async function libreHosts(s: NmsSource, token: string, timeoutMs?: number): Promise<HostStatus[]> {
  return (await libreDevices(s, token, timeoutMs)).map((d) => ({
    source: s.name,
    id: String(d.device_id),
    name: libreName(d),
    address: d.ip || d.hostname || null,
    status: truthy(d.disabled) ? "disabled" : truthy(d.status) ? "up" : "down",
  }));
}

// --- Public API used by the tools -------------------------------------------------------------

async function token(s: NmsSource, secret: ResolveSecret) {
  return s.token ? secret(s.token, s.tokenPath) : "";
}

const MOCK_PROBLEMS: Problem[] = [
  { source: MOCK_SOURCE, id: "1001", host: "OLT-Pusat", name: "PON 1/1/3 down", severity: "high", since: null },
  { source: MOCK_SOURCE, id: "1002", host: "BRAS-1", name: "CPU load > 80% for 5m", severity: "average", since: null },
  { source: MOCK_SOURCE, id: "1003", host: "AP-Tower-2", name: "ICMP loss 20%", severity: "warning", since: null },
];
const MOCK_HOSTS: HostStatus[] = [
  { source: MOCK_SOURCE, id: "1", name: "BRAS-1", address: "10.0.0.1", status: "up" },
  { source: MOCK_SOURCE, id: "2", name: "OLT-Pusat", address: "10.0.0.2", status: "up" },
  { source: MOCK_SOURCE, id: "3", name: "AP-Tower-2", address: "10.0.0.3", status: "down" },
];

export async function listProblems(
  c: PackConfig,
  secret: ResolveSecret,
  opts: { source?: string; limit?: number } = {},
): Promise<{ mode: PackMode; sources: SourceOutcome<Problem[]>[] }> {
  if (nmsMode(c) === "mock") return { mode: "mock", sources: [{ source: MOCK_SOURCE, ok: true, value: MOCK_PROBLEMS }] };
  const limit = opts.limit ?? 200;
  const sources = await eachSource(selectSources(c, opts.source), async (s) => {
    const t = await token(s, secret);
    switch (s.kind) {
      case "zabbix":
        return zabbixProblems(s, t, limit, c.timeoutMs);
      case "librenms":
        return libreProblems(s, t, limit, c.timeoutMs);
      default: {
        const unknown: never = s.kind;
        throw new Error(`unknown NMS kind ${String(unknown)}`);
      }
    }
  });
  return { mode: "live", sources };
}

export async function listHosts(
  c: PackConfig,
  secret: ResolveSecret,
  opts: { source?: string } = {},
): Promise<{ mode: PackMode; sources: SourceOutcome<HostStatus[]>[] }> {
  if (nmsMode(c) === "mock") return { mode: "mock", sources: [{ source: MOCK_SOURCE, ok: true, value: MOCK_HOSTS }] };
  const sources = await eachSource(selectSources(c, opts.source), async (s) => {
    const t = await token(s, secret);
    switch (s.kind) {
      case "zabbix":
        return zabbixHosts(s, t, c.timeoutMs);
      case "librenms":
        return libreHosts(s, t, c.timeoutMs);
      default: {
        const unknown: never = s.kind;
        throw new Error(`unknown NMS kind ${String(unknown)}`);
      }
    }
  });
  return { mode: "live", sources };
}
