/**
 * Event -> presence mapping for the Virtual Office (pure; unit-tested).
 * Rule: nothing is invented. "busy" comes from the core agent status (`running`,
 * set by the heartbeat service for the whole run); events only add detail
 * (which run, which issue, since when, last activity). No event -> idle.
 */
export interface LastRun { runId: string; status: string; finishedAt: string | null; issueId: string | null }
export interface Presence {
  runId: string | null;
  issueId: string | null;
  runStartedAt: string | null;
  lastRun: LastRun | null;
  lastActivity: string | null;
  lastActivityAt: string | null;
}
export type PresenceMap = Record<string, Presence>;
export interface OfficeEvent { eventType: string; occurredAt: string; entityId?: string | null; payload?: unknown }
export type DeskState = "busy" | "idle" | "paused" | "error" | "away";
export interface AgentLike { id: string; name: string; title?: string | null; role?: string | null; status: string; lastHeartbeatAt?: string | Date | null }
export interface Desk {
  agentId: string;
  name: string;
  title: string | null;
  agentStatus: string;
  state: DeskState;
  runId: string | null;
  issueId: string | null;
  since: string | null;
  lastRun: LastRun | null;
  lastActivity: string | null;
  lastActivityAt: string | null;
}

export const EMPTY: Presence = { runId: null, issueId: null, runStartedAt: null, lastRun: null, lastActivity: null, lastActivityAt: null };
const END: Record<string, string> = { "agent.run.finished": "succeeded", "agent.run.failed": "failed", "agent.run.cancelled": "cancelled" };
const s = (v: unknown) => (typeof v === "string" && v ? v : null);

export function applyEvent(map: PresenceMap, e: OfficeEvent): PresenceMap {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  const agentId = s(p.agentId);
  if (!agentId) return map;
  const cur = map[agentId] ?? EMPTY;
  const at = e.occurredAt;
  let next: Presence | null = null;
  if (e.eventType === "agent.run.started") {
    next = { ...cur, runId: s(p.runId) ?? s(e.entityId), issueId: s(p.issueId), runStartedAt: s(p.startedAt) ?? at, lastActivity: "run dimulai", lastActivityAt: at };
  } else if (END[e.eventType]) {
    const runId = s(p.runId) ?? s(e.entityId) ?? "";
    const status = s(p.status) === "timed_out" ? "timed_out" : END[e.eventType]!;
    const closesCurrent = !cur.runId || cur.runId === runId;
    next = {
      ...cur,
      ...(closesCurrent ? { runId: null, issueId: null, runStartedAt: null } : {}),
      lastRun: { runId, status, finishedAt: s(p.finishedAt) ?? at, issueId: s(p.issueId) },
      lastActivity: `run ${status}`,
      lastActivityAt: at,
    };
  } else if (e.eventType === "issue.checked_out") {
    next = { ...cur, issueId: cur.runId ? s(e.entityId) ?? cur.issueId : cur.issueId, lastActivity: "mengambil tugas", lastActivityAt: at };
  } else if (e.eventType === "issue.comment.created") {
    next = { ...cur, lastActivity: "menulis komentar", lastActivityAt: at };
  }
  return next ? { ...map, [agentId]: next } : map;
}

export function deriveDesk(agent: AgentLike, presence: Presence | undefined): Desk {
  const p = presence ?? EMPTY;
  const state: DeskState =
    agent.status === "running" ? "busy"
    : agent.status === "paused" ? "paused"
    : agent.status === "error" ? "error"
    : agent.status === "terminated" || agent.status === "pending_approval" ? "away"
    : "idle";
  const busy = state === "busy";
  const hb = agent.lastHeartbeatAt ? new Date(agent.lastHeartbeatAt).toISOString() : null;
  const useHb = hb && (!p.lastActivityAt || hb > p.lastActivityAt);
  return {
    agentId: agent.id,
    name: agent.name,
    title: agent.title ?? null,
    agentStatus: agent.status,
    state,
    runId: busy ? p.runId : null,
    issueId: busy ? p.issueId : null,
    since: busy ? p.runStartedAt : null,
    lastRun: p.lastRun,
    lastActivity: useHb ? "heartbeat" : p.lastActivity,
    lastActivityAt: useHb ? hb : p.lastActivityAt,
  };
}
