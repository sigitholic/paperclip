// Minimal REST client for a local Paperclip instance (local_trusted mode: no auth header).
import { guardEnv } from "./env.mjs";

export function client(base = guardEnv().base) {
  async function call(method, path, body) {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const json = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
    if (!res.ok) {
      const msg = typeof json === "object" && json ? json.error ?? json.message ?? JSON.stringify(json) : String(json);
      throw Object.assign(new Error(`${method} ${path} -> ${res.status}: ${String(msg).slice(0, 300)}`), { status: res.status, body: json });
    }
    return json;
  }
  const api = {
    base,
    get: (p) => call("GET", p),
    post: (p, b = {}) => call("POST", p, b),
    patch: (p, b = {}) => call("PATCH", p, b),
    async healthy() {
      try { const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) }); return r.ok; } catch { return false; }
    },
    /** Plugin action; companyId must be top-level (host scope) and inside params (plugin input). */
    action: (pluginId, key, companyId, params = {}) => call("POST", `/plugins/${pluginId}/actions/${key}`, { companyId, params: { companyId, ...params } }).then((r) => r?.data ?? r),
    data: (pluginId, key, companyId, params = {}) => call("POST", `/plugins/${pluginId}/data/${key}`, { companyId, params: { companyId, ...params } }).then((r) => r?.data ?? r),
    async plugins() {
      const list = await call("GET", "/plugins");
      return Object.fromEntries((Array.isArray(list) ? list : list.plugins ?? []).map((p) => [p.pluginKey, p]));
    },
  };
  return api;
}

export async function waitFor(fn, { timeoutMs = 30_000, intervalMs = 250, what = "condition" } = {}) {
  const until = Date.now() + timeoutMs;
  let last;
  while (Date.now() < until) {
    try { last = await fn(); if (last) return last; } catch (err) { last = err; }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}${last instanceof Error ? `: ${last.message}` : ""}`);
}
