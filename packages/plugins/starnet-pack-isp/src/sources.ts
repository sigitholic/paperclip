import { basicAuth, fetchJson, type PackMode } from "@starnet/pack-kit";
import { mockDevices, mockPppoe, mockResource } from "./fixtures.js";

export interface PackConfig {
  mikrotikHost?: string;
  mikrotikPort?: number;
  mikrotikUseTls?: boolean;
  mikrotikUsername?: string;
  mikrotikPassword?: unknown; // secret_ref binding, resolved per call, never stored
  genieacsBaseUrl?: string;
  genieacsUsername?: string;
  genieacsPassword?: unknown;
  onlineWindowMinutes?: number;
  timeoutMs?: number;
}
export type ResolveSecret = (ref: unknown, configPath: string) => Promise<string>;

export interface PppoeSession { name: string; address: string; callerId: string; uptime: string; service: string }
export interface RouterResource { cpuLoadPct: number; memUsedPct: number; totalMemoryMb: number; uptime: string; version: string; board: string }
export interface Device { id: string; serial: string; model: string; lastInform: string | null; online: boolean; firmware: string | null; pppoeUsername: string | null }

export const mikrotikMode = (c: PackConfig): PackMode => (c.mikrotikHost?.trim() ? "live" : "mock");
export const genieacsMode = (c: PackConfig): PackMode => (c.genieacsBaseUrl?.trim() ? "live" : "mock");

async function mikrotikGet<T>(c: PackConfig, path: string, secret: ResolveSecret): Promise<T> {
  const tls = c.mikrotikUseTls ?? true;
  const port = c.mikrotikPort ?? (tls ? 443 : 80);
  const password = c.mikrotikPassword ? await secret(c.mikrotikPassword, "mikrotikPassword") : "";
  return fetchJson<T>(`${tls ? "https" : "http"}://${c.mikrotikHost!.trim()}:${port}/rest${path}`, {
    headers: basicAuth(c.mikrotikUsername ?? "", password),
    timeoutMs: c.timeoutMs,
  });
}

export async function listPppoeActive(c: PackConfig, secret: ResolveSecret): Promise<{ mode: PackMode; sessions: PppoeSession[] }> {
  if (mikrotikMode(c) === "mock") return { mode: "mock", sessions: mockPppoe() };
  const rows = await mikrotikGet<Array<Record<string, string>>>(c, "/ppp/active", secret);
  const sessions = rows
    .filter((r) => (r.service ?? "pppoe") === "pppoe")
    .map((r) => ({ name: r.name ?? "", address: r.address ?? "", callerId: r["caller-id"] ?? "", uptime: r.uptime ?? "", service: r.service ?? "pppoe" }));
  return { mode: "live", sessions };
}

export async function systemResource(c: PackConfig, secret: ResolveSecret): Promise<{ mode: PackMode; resource: RouterResource }> {
  if (mikrotikMode(c) === "mock") return { mode: "mock", resource: mockResource() };
  const r = await mikrotikGet<Record<string, string>>(c, "/system/resource", secret);
  const total = Number(r["total-memory"] ?? 0);
  const free = Number(r["free-memory"] ?? 0);
  return {
    mode: "live",
    resource: {
      cpuLoadPct: Number(r["cpu-load"] ?? 0),
      memUsedPct: total ? Math.round(((total - free) / total) * 100) : 0,
      totalMemoryMb: Math.round(total / 1048576),
      uptime: r.uptime ?? "",
      version: r.version ?? "",
      board: r["board-name"] ?? "",
    },
  };
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
