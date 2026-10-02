import { mikrotikEndpoint, type MikrotikProtocol, type RouterConfig } from "../endpoint.js";
import type { PackConfig } from "../sources.js";

/** Form state of one router. Strings for inputs; empty string = not set. */
export interface RouterDraft {
  name: string;
  host: string;
  protocol: "" | MikrotikProtocol;
  port: string;
  useTls: boolean | null;
  tlsVerify: boolean;
  username: string;
  passwordSecretId: string;
}

export interface SettingsDraft {
  routers: RouterDraft[];
  genieacsBaseUrl: string;
  genieacsUsername: string;
  genieacsPasswordSecretId: string;
  onlineWindowMinutes: string;
  timeoutMs: string;
}

const FLAT_MIKROTIK_KEYS = [
  "mikrotikHost",
  "mikrotikProtocol",
  "mikrotikPort",
  "mikrotikUseTls",
  "mikrotikTlsVerify",
  "mikrotikUsername",
  "mikrotikPassword",
] as const;

export const emptyRouter = (): RouterDraft => ({
  name: "",
  host: "",
  protocol: "",
  port: "8728",
  useTls: null,
  tlsVerify: true,
  username: "",
  passwordSecretId: "",
});

function secretIdOf(ref: unknown): string {
  return ref && typeof ref === "object" && typeof (ref as { secretId?: unknown }).secretId === "string" ? (ref as { secretId: string }).secretId : "";
}

const secretRef = (secretId: string) => (secretId ? { type: "secret_ref", secretId } : undefined);
const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));

function routerDraft(r: RouterConfig, fallbackName: string): RouterDraft {
  return {
    name: r.name?.trim() || fallbackName,
    host: str(r.host),
    protocol: r.protocol ?? "",
    port: str(r.port),
    useTls: typeof r.useTls === "boolean" ? r.useTls : null,
    tlsVerify: r.tlsVerify ?? true,
    username: str(r.username),
    passwordSecretId: secretIdOf(r.password),
  };
}

/** The flat `mikrotik*` router (if any) becomes the first row, named "default". */
export function draftFromConfig(c: PackConfig): SettingsDraft {
  const routers: RouterDraft[] = [];
  if (c.mikrotikHost?.trim()) {
    routers.push(
      routerDraft(
        {
          name: "default",
          host: c.mikrotikHost,
          protocol: c.mikrotikProtocol,
          port: c.mikrotikPort,
          useTls: c.mikrotikUseTls,
          tlsVerify: c.mikrotikTlsVerify,
          username: c.mikrotikUsername,
          password: c.mikrotikPassword,
        },
        "default",
      ),
    );
  }
  (c.mikrotikRouters ?? []).forEach((r, i) => routers.push(routerDraft(r, `router-${i + 1}`)));
  return {
    routers,
    genieacsBaseUrl: str(c.genieacsBaseUrl),
    genieacsUsername: str(c.genieacsUsername),
    genieacsPasswordSecretId: secretIdOf(c.genieacsPassword),
    onlineWindowMinutes: str(c.onlineWindowMinutes),
    timeoutMs: str(c.timeoutMs),
  };
}

function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as Partial<T>;
}

const num = (v: string) => (v.trim() === "" ? undefined : Number(v));

/** All routers are written to `mikrotikRouters`; the flat fields are removed. Unknown keys are kept. */
export function configFromDraft(base: Record<string, unknown>, d: SettingsDraft): Record<string, unknown> {
  const next: Record<string, unknown> = { ...base };
  for (const key of FLAT_MIKROTIK_KEYS) delete next[key];
  next.mikrotikRouters = d.routers.map((r) =>
    compact({
      name: r.name.trim(),
      host: r.host.trim(),
      protocol: r.protocol || undefined,
      port: num(r.port),
      useTls: r.useTls ?? undefined,
      tlsVerify: r.tlsVerify ? undefined : false,
      username: r.username.trim(),
      password: secretRef(r.passwordSecretId),
    }),
  );
  const rest = compact({
    genieacsBaseUrl: d.genieacsBaseUrl.trim(),
    genieacsUsername: d.genieacsUsername.trim(),
    genieacsPassword: secretRef(d.genieacsPasswordSecretId),
    onlineWindowMinutes: num(d.onlineWindowMinutes),
    timeoutMs: num(d.timeoutMs),
  });
  for (const key of ["genieacsBaseUrl", "genieacsUsername", "genieacsPassword", "onlineWindowMinutes", "timeoutMs"]) delete next[key];
  return { ...next, ...rest };
}

export function validateRouter(r: RouterDraft, others: RouterDraft[]): string[] {
  const errors: string[] = [];
  if (!r.name.trim()) errors.push("Nama wajib diisi");
  else if (!/^[\w.-]+$/.test(r.name.trim())) errors.push("Nama hanya huruf, angka, titik, minus, garis bawah");
  else if (others.some((o) => o.name.trim() === r.name.trim())) errors.push(`Nama "${r.name.trim()}" sudah dipakai`);
  if (!r.host.trim()) errors.push("Host wajib diisi");
  if (r.port.trim() && !(Number.isInteger(Number(r.port)) && Number(r.port) > 0 && Number(r.port) < 65536)) errors.push("Port tidak valid");
  return errors;
}

/** Human summary of the transport a router will use, e.g. "API 8728" or "REST+TLS 443". */
export function transportLabel(r: RouterDraft): string {
  const e = mikrotikEndpoint({ protocol: r.protocol || undefined, port: num(r.port), useTls: r.useTls ?? undefined });
  return `${e.protocol === "api" ? "API" : "REST"}${e.tls ? "+TLS" : ""} ${e.port}`;
}

/** TLS is fixed by the port for 8728 (plain) and 8729 (TLS). */
export function tlsIsFixed(r: RouterDraft): boolean {
  const e = mikrotikEndpoint({ protocol: r.protocol || undefined, port: num(r.port) });
  return e.protocol === "api" && (r.port.trim() === "8728" || r.port.trim() === "8729");
}
