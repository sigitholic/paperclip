import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Issue, PluginContext } from "@paperclipai/plugin-sdk";
import { isSeverity, severityRank, type PackConfig, type Severity } from "./model.js";

export const ALERT_ORIGIN_KIND = "plugin:starnet.pack-nms:alert" as const;
export const MAX_EVENTS_PER_DELIVERY = 50;
const DEFAULT_MAX_NEW_PER_HOUR = 30;
const TEXT_LIMIT = 200;

export interface AlertEvent {
  source: string;
  eventId: string;
  status: "problem" | "resolved";
  severity: Severity;
  host: string;
  name: string;
  since: string | null;
  url: string | null;
}

export type AlertOutcome = "created" | "duplicate" | "resolved" | "unknown_resolved" | "ignored_severity" | "suppressed_rate";

const SEVERITY_ALIASES: Record<string, Severity> = {
  "0": "info",
  "1": "info",
  "2": "warning",
  "3": "average",
  "4": "high",
  "5": "disaster",
  "not classified": "info",
  information: "info",
  info: "info",
  ok: "info",
  warning: "warning",
  warn: "warning",
  average: "average",
  minor: "average",
  high: "high",
  major: "high",
  critical: "high",
  disaster: "disaster",
};

// LibreNMS states: 0 ok, 1 alert, 2 acknowledged, 3 worse, 4 better.
const PROBLEM = new Set(["problem", "1", "2", "3", "4", "alert", "firing", "triggered", "down", "acknowledged", "worse", "better"]);
const RESOLVED = new Set(["resolved", "ok", "0", "recovery", "recovered", "up", "resolve"]);

const text = (v: unknown) => (v === undefined || v === null ? "" : String(v)).replace(/\s+/g, " ").trim().slice(0, TEXT_LIMIT);

/**
 * Normalize one alert. The documented payload is
 * `{ source, eventId, status: "problem"|"resolved", severity, host, name, since?, url? }`; common
 * Zabbix/LibreNMS spellings of status and severity are accepted too.
 */
export function parseAlert(body: unknown): AlertEvent {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("alert must be a JSON object");
  const b = body as Record<string, unknown>;
  const source = text(b.source);
  const eventId = text(b.eventId ?? b.event_id ?? b.id);
  if (!source) throw new Error("alert.source is required");
  if (!eventId) throw new Error("alert.eventId is required");
  const rawStatus = text(b.status ?? b.state).toLowerCase();
  const status = PROBLEM.has(rawStatus) ? "problem" : RESOLVED.has(rawStatus) ? "resolved" : null;
  if (!status) throw new Error(`alert.status "${rawStatus}" is not problem/resolved`);
  const rawSeverity = text(b.severity).toLowerCase();
  const severity = isSeverity(rawSeverity) ? rawSeverity : (SEVERITY_ALIASES[rawSeverity] ?? "warning");
  const host = text(b.host ?? b.hostname);
  const name = text(b.name ?? b.title ?? b.problem);
  if (!host && !name) throw new Error("alert needs host or name");
  const url = text(b.url);
  return { source, eventId, status, severity, host, name, since: text(b.since ?? b.timestamp) || null, url: /^https?:\/\//.test(url) ? url : null };
}

function digest(v: string) {
  return createHash("sha256").update(v, "utf8").digest();
}

/** Constant-time comparison of the caller token with the configured secret. */
export function tokenMatches(given: string, expected: string): boolean {
  return expected.length > 0 && timingSafeEqual(digest(given), digest(expected));
}

export const signBody = (secret: string, rawBody: string) => `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;

/** `x-starnet-signature: sha256=<hex HMAC-SHA256(rawBody, secret)>`; keeps the secret out of stored webhook headers. */
export function signatureMatches(signature: string, secret: string, rawBody: string): boolean {
  return secret.length > 0 && timingSafeEqual(digest(signature.trim().toLowerCase()), digest(signBody(secret, rawBody)));
}

const PRIORITY: Record<Severity, Issue["priority"]> = { disaster: "critical", high: "high", average: "medium", warning: "low", info: "low" };
const OPEN = (i: Issue) => i.status !== "done" && i.status !== "cancelled";

export const alertTitle = (e: AlertEvent) => `[${e.severity.toUpperCase()}] ${e.host || e.source}: ${e.name || "alert"}`.slice(0, TEXT_LIMIT);
export const severityOfTitle = (title: string): Severity | null => {
  const m = /^\[([A-Z]+)\]/.exec(title);
  const s = m?.[1]?.toLowerCase();
  return isSeverity(s) ? s : null;
};

function describe(e: AlertEvent) {
  return [
    `Alert dari NMS **${e.source}** (event \`${e.eventId}\`).`,
    "",
    `- Host: ${e.host || "—"}`,
    `- Masalah: ${e.name || "—"}`,
    `- Severity: ${e.severity}`,
    `- Sejak: ${e.since ?? "—"}`,
    ...(e.url ? [`- Link NMS: ${e.url}`] : []),
    "",
    "_Dibuat otomatis oleh Starnet NMS Pack dari webhook. Issue ditutup otomatis saat NMS mengirim status pulih._",
  ].join("\n");
}

interface RateState { hourStart: number; created: number; suppressed: number }
const rateKey = (companyId: string) => ({ scopeKind: "company" as const, scopeId: companyId, stateKey: "alert-rate" });

/** Create, dedupe or close the NOC issue for one alert. Caller serializes per company. */
export async function handleAlert(ctx: PluginContext, companyId: string, cfg: PackConfig, e: AlertEvent, now = Date.now()): Promise<AlertOutcome> {
  const originId = `${e.source}:${e.eventId}`.slice(0, TEXT_LIMIT);
  // LibreNMS reuses its alert id per device+rule, so a closed issue does not block a new one.
  const existing = (await ctx.issues.list({ companyId, originKind: ALERT_ORIGIN_KIND, originId, limit: 20 })).find(OPEN);

  if (e.status === "resolved") {
    if (!existing) return "unknown_resolved";
    await ctx.issues.createComment(existing.id, `✅ Pulih menurut ${e.source}${e.since ? ` (${e.since})` : ""}. Issue ditutup otomatis.`, companyId);
    await ctx.issues.update(existing.id, { status: "done" }, companyId);
    return "resolved";
  }

  if (existing) return "duplicate";
  if (severityRank(e.severity) < severityRank(cfg.alertMinSeverity ?? "warning")) return "ignored_severity";

  const hourStart = Math.floor(now / 3_600_000) * 3_600_000;
  const prev = ((await ctx.state.get(rateKey(companyId))) ?? null) as RateState | null;
  const rate: RateState = prev && prev.hourStart === hourStart ? prev : { hourStart, created: 0, suppressed: 0 };
  if (rate.created >= (cfg.maxNewIssuesPerHour ?? DEFAULT_MAX_NEW_PER_HOUR)) {
    await ctx.state.set(rateKey(companyId), { ...rate, suppressed: rate.suppressed + 1 });
    return "suppressed_rate";
  }

  await ctx.issues.create({
    companyId,
    title: alertTitle(e),
    description: describe(e),
    status: "todo",
    priority: PRIORITY[e.severity],
    assigneeAgentId: cfg.alertAssigneeAgentId?.trim() || undefined,
    originKind: ALERT_ORIGIN_KIND,
    originId,
    billingCode: "starnet-pack-nms:alert",
  });
  await ctx.state.set(rateKey(companyId), { ...rate, created: rate.created + 1 });
  return "created";
}

/** Open alert issues by severity, for the widget. */
export async function openAlertSummary(ctx: PluginContext, companyId: string) {
  const issues = await ctx.issues.list({ companyId, originKind: ALERT_ORIGIN_KIND, limit: 500 });
  const counts: Record<Severity, number> = { disaster: 0, high: 0, average: 0, warning: 0, info: 0 };
  let open = 0;
  for (const i of issues.filter(OPEN)) {
    open++;
    counts[severityOfTitle(i.title) ?? "warning"]++;
  }
  const rate = ((await ctx.state.get(rateKey(companyId))) ?? null) as RateState | null;
  return { open, counts, suppressedThisHour: rate && rate.hourStart === Math.floor(Date.now() / 3_600_000) * 3_600_000 ? rate.suppressed : 0 };
}
