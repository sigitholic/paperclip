/**
 * Per-run step and token limits (Phase 2, "batas langkah dan token per run").
 *
 * The Codex ACP engine writes one JSON line per runtime event to the run log. The limiter counts
 * initial tool calls (`acpx.tool_call` with tag `tool_call`; `tool_call_update` lines are progress
 * of the same call) and tracks the session context size from `acpx.status` / `usage_update`
 * (`used`). On the first breach the adapter aborts the run through the same signal an operator
 * stop uses, so the engine cancels the turn cooperatively and then force-stops after `graceSec`.
 */
import type { AdapterExecutionResult } from "@paperclipai/adapter-utils";

export const MAX_TOOL_CALLS_KEY = "starnetMaxToolCalls";
export const MAX_CONTEXT_TOKENS_KEY = "starnetMaxContextTokens";
export const DEFAULT_MAX_TOOL_CALLS = 60;
export const DEFAULT_MAX_CONTEXT_TOKENS = 200_000;
export const RUN_LIMIT_ERROR_CODE = "starnet_run_limit";

export type RunLimits = { maxToolCalls: number; maxContextTokens: number };
export type RunLimitBreach = { limit: "tool_calls" | "context_tokens"; max: number; observed: number };

function limitValue(raw: unknown, fallback: number): number {
  const n = typeof raw === "string" && raw.trim() ? Number(raw) : raw;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/** Limits from adapterConfig; 0 turns a limit off. */
export function resolveRunLimits(config: Record<string, unknown>): RunLimits {
  return {
    maxToolCalls: limitValue(config[MAX_TOOL_CALLS_KEY], DEFAULT_MAX_TOOL_CALLS),
    maxContextTokens: limitValue(config[MAX_CONTEXT_TOKENS_KEY], DEFAULT_MAX_CONTEXT_TOKENS),
  };
}

export function describeBreach(b: RunLimitBreach): string {
  return b.limit === "tool_calls"
    ? `Starnet run limit: ${b.observed} tool calls exceeds the limit of ${b.max} (${MAX_TOOL_CALLS_KEY})`
    : `Starnet run limit: context ${b.observed} tokens exceeds the limit of ${b.max} (${MAX_CONTEXT_TOKENS_KEY})`;
}

export class RunLimiter {
  readonly toolCallIds = new Set<string>();
  toolCalls = 0;
  contextTokens = 0;
  breach: RunLimitBreach | null = null;
  private partial = "";

  constructor(readonly limits: RunLimits) {}

  /** Feed a stdout chunk; returns the breach the first time a limit is crossed. */
  observe(chunk: string): RunLimitBreach | null {
    const lines = (this.partial + chunk).split("\n");
    this.partial = lines.pop() ?? "";
    let fresh: RunLimitBreach | null = null;
    for (const line of lines) {
      const b = this.observeLine(line);
      if (b && !fresh) fresh = b;
    }
    return fresh;
  }

  private observeLine(line: string): RunLimitBreach | null {
    if (!line.startsWith('{"type":"acpx.')) return null;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return null;
    }
    if (event.type === "acpx.tool_call" && event.tag !== "tool_call_update") {
      const id = typeof event.toolCallId === "string" ? event.toolCallId : "";
      if (id && this.toolCallIds.has(id)) return null;
      if (id) this.toolCallIds.add(id);
      this.toolCalls += 1;
    } else if (event.type === "acpx.status" && event.tag === "usage_update" && typeof event.used === "number") {
      this.contextTokens = Math.max(this.contextTokens, event.used);
    } else {
      return null;
    }
    return this.check();
  }

  private check(): RunLimitBreach | null {
    if (this.breach) return null;
    const { maxToolCalls, maxContextTokens } = this.limits;
    if (maxToolCalls > 0 && this.toolCalls > maxToolCalls) {
      this.breach = { limit: "tool_calls", max: maxToolCalls, observed: this.toolCalls };
    } else if (maxContextTokens > 0 && this.contextTokens > maxContextTokens) {
      this.breach = { limit: "context_tokens", max: maxContextTokens, observed: this.contextTokens };
    }
    return this.breach;
  }
}

/**
 * Result reported when the limiter stopped the run: a failed run with a Starnet error code, not an
 * operator stop. The engine's acknowledged-cancellation marker and interrupted-session replay
 * evidence are dropped so the host neither treats it as a Stop nor replays the run.
 */
export function limitedResult(result: AdapterExecutionResult, limiter: RunLimiter): AdapterExecutionResult {
  const breach = limiter.breach!;
  const { executionCancellation: _stop, ...resultJson } = (result.resultJson ?? {}) as Record<string, unknown>;
  const { executionRecovery: _replay, ...rest } = result;
  return {
    ...rest,
    exitCode: result.exitCode && result.exitCode !== 0 ? result.exitCode : 1,
    timedOut: false,
    errorCode: RUN_LIMIT_ERROR_CODE,
    errorMessage: describeBreach(breach),
    resultJson: {
      ...resultJson,
      starnetRunLimit: { ...breach, toolCalls: limiter.toolCalls, contextTokens: limiter.contextTokens, limits: limiter.limits },
    },
  };
}
