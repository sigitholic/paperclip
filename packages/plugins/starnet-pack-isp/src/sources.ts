import { basicAuth, fetchJson, type PackMode } from "@starnet/pack-kit";
import { mockDevices, mockPppoe, mockResource } from "./fixtures.js";
import { routerOsQuery } from "./routeros-api.js";
import { mikrotikEndpoint, type MikrotikProtocol, type RouterConfig } from "./endpoint.js";

export { mikrotikEndpoint, type MikrotikProtocol, type RouterConfig };

export interface PackConfig {
  mikrotikRouters?: RouterConfig[];
  mikrotikHost?: string;
  mikrotikProtocol?: MikrotikProtocol;
  mikrotikPort?: number;
  mikrotikUseTls?: boolean;
  mikrotikTlsVerify?: boolean;
  mikrotikUsername?: string;
  mikrotikPassword?: unknown; // secret_ref binding, resolved per call, never stored
  genieacsBaseUrl?: string;
  genieacsUsername?: string;
  genieacsPassword?: unknown;
  onlineWindowMinutes?: number;
  timeoutMs?: number;
}
export type ResolveSecret = (ref: unknown, configPath: string) => Promise<string>;

export interface PppoeSession { router: string; name: string; address: string; callerId: string; uptime: string; service: string }
export interface RouterResource { cpuLoadPct: number; memUsedPct: number; totalMemoryMb: number; uptime: string; version: string; board: string }
export interface Device { id: string; serial: string; model: string; lastInform: string | null; online: boolean; firmware: string | null; pppoeUsername: string | null }

export const DEFAULT_ROUTER = "default";
const MOCK_ROUTER = "mock";
const ROUTER_CONCURRENCY = 4;

/** A configured router plus the config path of its password (for secret resolution). */
export interface MikrotikRouter extends RouterConfig {
  name: string;
  host: string;
  passwordPath: string;
}

export type RouterOutcome<T> =
  | { router: string; host: string; ok: true; value: T }
  | { router: string; host: string; ok: false; error: string };

/** Routers with a host, in config order: the flat fields first (as "default"), then `mikrotikRouters`. */
export function mikrotikRouters(c: PackConfig): MikrotikRouter[] {
  const routers: MikrotikRouter[] = [];
  if (c.mikrotikHost?.trim()) {
    routers.push({
      name: DEFAULT_ROUTER,
      host: c.mikrotikHost.trim(),
      protocol: c.mikrotikProtocol,
      port: c.mikrotikPort,
      useTls: c.mikrotikUseTls,
      tlsVerify: c.mikrotikTlsVerify,
      username: c.mikrotikUsername,
      password: c.mikrotikPassword,
      passwordPath: "mikrotikPassword",
    });
  }
  (c.mikrotikRouters ?? []).forEach((r, i) => {
    if (!r?.host?.trim()) return;
    routers.push({ ...r, name: r.name?.trim() || `router-${i + 1}`, host: r.host.trim(), passwordPath: `mikrotikRouters.${i}.password` });
  });
  const seen = new Set<string>();
  for (const r of routers) {
    if (seen.has(r.name)) throw new Error(`duplicate MikroTik router name "${r.name}"`);
    seen.add(r.name);
  }
  return routers;
}

export const mikrotikMode = (c: PackConfig): PackMode => (mikrotikRouters(c).length ? "live" : "mock");
export const genieacsMode = (c: PackConfig): PackMode => (c.genieacsBaseUrl?.trim() ? "live" : "mock");

function selectRouters(c: PackConfig, name?: string): MikrotikRouter[] {
  const routers = mikrotikRouters(c);
  if (!name) return routers;
  const router = routers.find((r) => r.name === name);
  if (!router) throw new Error(`unknown router "${name}"; configured: ${routers.map((r) => r.name).join(", ") || "none"}`);
  return [router];
}

/** Rows of one RouterOS menu (e.g. "/ppp/active"), as kebab-case string fields for both protocols. */
async function mikrotikRows(c: PackConfig, r: MikrotikRouter, menu: string, secret: ResolveSecret): Promise<Array<Record<string, string>>> {
  const { protocol, port, tls } = mikrotikEndpoint(r);
  const password = r.password ? await secret(r.password, r.passwordPath) : "";
  if (protocol === "api") {
    const [rows] = await routerOsQuery(
      { host: r.host, port, tls, tlsVerify: r.tlsVerify, username: r.username ?? "", password, timeoutMs: c.timeoutMs },
      [`${menu}/print`],
    );
    return rows ?? [];
  }
  const body = await fetchJson<Array<Record<string, string>> | Record<string, string>>(`${tls ? "https" : "http"}://${r.host}:${port}/rest${menu}`, {
    headers: basicAuth(r.username ?? "", password),
    timeoutMs: c.timeoutMs,
  });
  return Array.isArray(body) ? body : [body];
}

/** Run `fn` on each router with bounded concurrency; one router failing does not hide the others. */
async function eachRouter<T>(routers: MikrotikRouter[], fn: (r: MikrotikRouter) => Promise<T>): Promise<RouterOutcome<T>[]> {
  const out: RouterOutcome<T>[] = new Array(routers.length);
  let next = 0;
  async function worker() {
    while (next < routers.length) {
      const i = next++;
      const r = routers[i]!;
      try {
        out[i] = { router: r.name, host: r.host, ok: true, value: await fn(r) };
      } catch (err) {
        out[i] = { router: r.name, host: r.host, ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(ROUTER_CONCURRENCY, routers.length) }, worker));
  if (out.length && out.every((o) => !o.ok)) {
    throw new Error(out.map((o) => `${o.router}: ${o.ok ? "" : o.error}`).join("; "));
  }
  return out;
}

export async function listPppoeActive(
  c: PackConfig,
  secret: ResolveSecret,
  routerName?: string,
): Promise<{ mode: PackMode; sessions: PppoeSession[]; routers: RouterOutcome<number>[] }> {
  if (mikrotikMode(c) === "mock") {
    const sessions = mockPppoe();
    return { mode: "mock", sessions, routers: [{ router: MOCK_ROUTER, host: "", ok: true, value: sessions.length }] };
  }
  const perRouter = await eachRouter(selectRouters(c, routerName), async (r) =>
    (await mikrotikRows(c, r, "/ppp/active", secret))
      .filter((row) => (row.service ?? "pppoe") === "pppoe")
      .map((row) => ({ router: r.name, name: row.name ?? "", address: row.address ?? "", callerId: row["caller-id"] ?? "", uptime: row.uptime ?? "", service: row.service ?? "pppoe" })),
  );
  return {
    mode: "live",
    sessions: perRouter.flatMap((o) => (o.ok ? o.value : [])),
    routers: perRouter.map((o) => (o.ok ? { ...o, value: o.value.length } : o)),
  };
}

export async function systemResource(
  c: PackConfig,
  secret: ResolveSecret,
  routerName?: string,
): Promise<{ mode: PackMode; routers: RouterOutcome<RouterResource>[] }> {
  if (mikrotikMode(c) === "mock") return { mode: "mock", routers: [{ router: MOCK_ROUTER, host: "", ok: true, value: mockResource() }] };
  const routers = await eachRouter(selectRouters(c, routerName), async (r) => {
    const row = (await mikrotikRows(c, r, "/system/resource", secret))[0] ?? {};
    const total = Number(row["total-memory"] ?? 0);
    const free = Number(row["free-memory"] ?? 0);
    return {
      cpuLoadPct: Number(row["cpu-load"] ?? 0),
      memUsedPct: total ? Math.round(((total - free) / total) * 100) : 0,
      totalMemoryMb: Math.round(total / 1048576),
      uptime: row.uptime ?? "",
      version: row.version ?? "",
      board: row["board-name"] ?? "",
    };
  });
  return { mode: "live", routers };
}

const IGD = "InternetGatewayDevice";
const PROJECTION = [
  "_id", "_lastInform", "_deviceId._SerialNumber", "_deviceId._ProductClass",
  `${IGD}.DeviceInfo.SoftwareVersion`, `${IGD}.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username`,
].join(",");

function toDevice(d: Record<string, any>, onlineWindowMs: number, now: number): Device {
  const lastInform = typeof d._lastInform === "string" ? d._lastInform : null;
  return {
    id: String(d._id),
    serial: d._deviceId?._SerialNumber ?? "",
    model: d._deviceId?._ProductClass ?? "",
    lastInform,
    online: lastInform ? now - Date.parse(lastInform) <= onlineWindowMs : false,
    firmware: d[IGD]?.DeviceInfo?.SoftwareVersion?._value ?? null,
    pppoeUsername: d[IGD]?.WANDevice?.["1"]?.WANConnectionDevice?.["1"]?.WANPPPConnection?.["1"]?.Username?._value ?? null,
  };
}

async function genieacsDevices(c: PackConfig, secret: ResolveSecret, query: Record<string, unknown>, now: number): Promise<Device[]> {
  const headers = c.genieacsUsername ? basicAuth(c.genieacsUsername, c.genieacsPassword ? await secret(c.genieacsPassword, "genieacsPassword") : "") : {};
  const url = `${c.genieacsBaseUrl!.trim().replace(/\/$/, "")}/devices/?query=${encodeURIComponent(JSON.stringify(query))}&projection=${PROJECTION}`;
  const rows = await fetchJson<Array<Record<string, unknown>>>(url, { headers, timeoutMs: c.timeoutMs });
  return rows.map((d) => toDevice(d, (c.onlineWindowMinutes ?? 15) * 60_000, now));
}

export async function listDevices(c: PackConfig, secret: ResolveSecret, now = Date.now()): Promise<{ mode: PackMode; devices: Device[] }> {
  if (genieacsMode(c) === "mock") return { mode: "mock", devices: mockDevices(now) };
  return { mode: "live", devices: await genieacsDevices(c, secret, {}, now) };
}

export async function deviceStatus(c: PackConfig, secret: ResolveSecret, deviceId: string, now = Date.now()): Promise<{ mode: PackMode; device: Device | null }> {
  if (genieacsMode(c) === "mock") return { mode: "mock", device: mockDevices(now).find((d) => d.id === deviceId) ?? null };
  const [device] = await genieacsDevices(c, secret, { _id: deviceId }, now);
  return { mode: "live", device: device ?? null };
}
