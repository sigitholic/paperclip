/**
 * @starnet/pack-kit — the minimum every Starnet pack needs, nothing more.
 *
 * 1. `gatewayRisk()` mirrors Paperclip's tool-gateway name heuristic so packs can
 *    assert (in tests and at registration) how the gateway will classify a tool.
 * 2. `fetchJson()` — HTTP GET with a hard timeout and secret-free error messages.
 * 3. `packResult()` — uniform tool output that always states live vs mock.
 * 4. Model tiers (`model-tiers.ts`) — template tier -> concrete adapterConfig model.
 */

export type GatewayRisk = "read" | "write" | "destructive";
export type PackMode = "live" | "mock";

// Copied from paperclip server/src/services/tool-gateway.ts `inferToolRisk` (upstream @01d9a1218).
// Plugin tools have no explicit risk field yet, so the gateway infers it from the name.
const DESTRUCTIVE = /\b(delete|destroy|remove|drop|truncate|wipe|purge)\b|(^|[:._-])(delete|destroy|remove|drop|truncate|wipe|purge)([:._-]|$)/;
const WRITE = /\b(create|update|write|edit|patch|post|send|publish|merge|commit|apply)\b|(^|[:._-])(create|update|write|edit|patch|post|send|publish|merge|commit|apply)([:._-]|$)/;

export function gatewayRisk(toolName: string): GatewayRisk {
  const lower = toolName.toLowerCase();
  if (DESTRUCTIVE.test(lower)) return "destructive";
  if (WRITE.test(lower)) return "write";
  return "read";
}

/** Throws if the gateway would classify `toolName` differently from `expected`. */
export function assertGatewayRisk(toolName: string, expected: GatewayRisk): void {
  const actual = gatewayRisk(toolName);
  if (actual !== expected) {
    throw new Error(`Tool "${toolName}" would be classified "${actual}" by the gateway, expected "${expected}". Rename it.`);
  }
}

export interface FetchJsonOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** POST sends `body` as JSON (e.g. JSON-RPC). Default GET. */
  method?: "GET" | "POST";
  body?: unknown;
}

/** Fetch a JSON document. Errors never include headers (credentials) or request/response bodies. */
export async function fetchJson<T = unknown>(url: string, opts: FetchJsonOptions = {}): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const method = opts.method ?? "GET";
  const where = `${method} ${new URL(url).origin}${new URL(url).pathname}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { accept: "application/json", ...(method === "POST" ? { "content-type": "application/json" } : {}), ...opts.headers },
      body: method === "POST" ? JSON.stringify(opts.body ?? {}) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const reason = err instanceof Error && err.name === "TimeoutError" ? `timeout after ${timeoutMs}ms` : "network error";
    throw new Error(`${where} failed: ${reason}`);
  }
  if (!res.ok) throw new Error(`${where} failed: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export function basicAuth(username: string, password: string): Record<string, string> {
  return { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` };
}

/** Tool result shape: `content` for the agent, `data` for machines. Mock output is always labeled. */
export function packResult(mode: PackMode, source: string, summary: string, data: Record<string, unknown>) {
  const label = mode === "mock" ? "[MOCK DATA — no device configured] " : "";
  return { content: `${label}${source}: ${summary}`, data: { mode, source, ...data } };
}

/**
 * Run async work one-at-a-time per key (e.g. per company). Plugin state has no
 * compare-and-set, so read-modify-write of a state blob must be serialized.
 */
export function serialByKey() {
  const tails = new Map<string, Promise<unknown>>();
  return function run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const next = (tails.get(key) ?? Promise.resolve()).catch(() => undefined).then(work);
    tails.set(key, next);
    void next.finally(() => { if (tails.get(key) === next) tails.delete(key); }).catch(() => undefined);
    return next;
  };
}

export * from "./model-tiers.js";
