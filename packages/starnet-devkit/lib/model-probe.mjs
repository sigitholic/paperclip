// Helpers for scripts/model-tiers-check.mjs. Pure where possible so tests need no server.
// Reads Codex's per-company home under the Paperclip instance (same host only); never writes there.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function instanceRoot(env = process.env) {
  const home = env.PAPERCLIP_HOME?.trim() || join(homedir(), ".paperclip");
  return join(home, "instances", env.PAPERCLIP_INSTANCE_ID?.trim() || "default");
}

export function codexHomeFor(companyId, env = process.env) {
  return join(instanceRoot(env), "companies", companyId, "codex-home");
}

/** Models Codex advertises for the signed-in identity. Advertised is not the same as allowed. */
export function listedCodexModels(codexHome) {
  const file = join(codexHome, "models_cache.json");
  if (!existsSync(file)) return [];
  const cache = JSON.parse(readFileSync(file, "utf8"));
  return (cache.models ?? []).filter((m) => m.visibility === "list").map((m) => m.slug ?? m.id).filter(Boolean);
}

const FAILURE_PATTERNS = [
  ["model_not_allowed", /does not exist or you do not have access|model_not_found|not supported when using codex with a chatgpt account/i],
  ["usage_limit", /usage limit|rate limit|too many requests|\b429\b/i],
  ["auth", /unauthori[sz]ed|\b401\b|token (has )?expired|not logged in|login required/i],
];

export function classifyFailure(text) {
  if (!text) return "unknown";
  for (const [kind, re] of FAILURE_PATTERNS) if (re.test(text)) return kind;
  return "unknown";
}

/** Codex log lines start with a long tracing-span prefix; keep the part around the error. */
export function excerpt(body, max = 300) {
  const at = FAILURE_PATTERNS.map(([, re]) => body.search(re)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  const start = at === undefined ? Math.max(0, body.length - max) : Math.max(0, at - 80);
  return body.slice(start, start + max).trim();
}

/**
 * Paperclip only surfaces "terminal service failure" for ACP runs; the provider's real
 * error lives in Codex's own log. Return the newest error line mentioning `model` since `sinceMs`.
 */
export function readCodexFailure(codexHome, model, sinceMs) {
  const file = join(codexHome, "logs_2.sqlite");
  if (!existsSync(file)) return null;
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db
      .prepare("SELECT feedback_log_body AS body FROM logs WHERE ts >= ? AND level IN ('ERROR','WARN') AND feedback_log_body LIKE ? ORDER BY id DESC LIMIT 20")
      .all(Math.floor(sinceMs / 1000), `%${model}%`);
    const hit = rows.find((r) => classifyFailure(r.body) !== "unknown") ?? rows[0];
    return hit ? excerpt(String(hit.body)) : null;
  } finally {
    db.close();
  }
}
