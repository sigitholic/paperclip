// Pure types and rules shared by the worker and the settings UI (no Node imports).

export type NmsKind = "zabbix" | "librenms";
export const NMS_KINDS: readonly NmsKind[] = ["zabbix", "librenms"];

export type Severity = "info" | "warning" | "average" | "high" | "disaster";
export const SEVERITIES: readonly Severity[] = ["info", "warning", "average", "high", "disaster"];
export const severityRank = (s: Severity) => SEVERITIES.indexOf(s);

export interface NmsSourceConfig {
  name?: string;
  kind?: NmsKind;
  baseUrl?: string;
  token?: unknown; // secret_ref binding
}

export interface PackConfig {
  nmsSources?: NmsSourceConfig[];
  /** Shared secret callers send in `x-starnet-token`; webhooks are rejected until it is set. */
  webhookToken?: unknown;
  alertAssigneeAgentId?: string;
  alertMinSeverity?: Severity;
  maxNewIssuesPerHour?: number;
  timeoutMs?: number;
}

export function isSeverity(v: unknown): v is Severity {
  return typeof v === "string" && (SEVERITIES as readonly string[]).includes(v);
}

export function isNmsKind(v: unknown): v is NmsKind {
  return typeof v === "string" && (NMS_KINDS as readonly string[]).includes(v);
}
