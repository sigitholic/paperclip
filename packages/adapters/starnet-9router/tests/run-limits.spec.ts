import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import { describe, expect, it } from "vitest";
import { executeWithRunLimits } from "../src/index.js";
import { limitedResult, resolveRunLimits, RunLimiter } from "../src/run-limits.js";

const toolCall = (id: string, tag = "tool_call") => `${JSON.stringify({ type: "acpx.tool_call", name: "pwsh", toolCallId: id, status: "pending", tag })}\n`;
const usage = (used: number) => `${JSON.stringify({ type: "acpx.status", text: `usage updated: ${used}/258400`, tag: "usage_update", used, size: 258400 })}\n`;

const okResult: AdapterExecutionResult = { exitCode: 0, signal: null, timedOut: false };

function runCtx(config: Record<string, unknown>, signal?: AbortSignal) {
  const logs: string[] = [];
  const ctx = {
    runId: "run-1",
    agent: { id: "a1", companyId: "c1" },
    runtime: {},
    config,
    context: {},
    signal,
    onLog: async (_s: "stdout" | "stderr", chunk: string) => {
      logs.push(chunk);
    },
  } as unknown as AdapterExecutionContext;
  return { ctx, logs };
}

describe("resolveRunLimits", () => {
  it("uses defaults, accepts numbers or numeric strings, and 0 to turn a limit off", () => {
    expect(resolveRunLimits({})).toEqual({ maxToolCalls: 60, maxContextTokens: 200_000 });
    expect(resolveRunLimits({ starnetMaxToolCalls: "12", starnetMaxContextTokens: 0 })).toEqual({ maxToolCalls: 12, maxContextTokens: 0 });
    expect(resolveRunLimits({ starnetMaxToolCalls: -1, starnetMaxContextTokens: "abc" })).toEqual({ maxToolCalls: 60, maxContextTokens: 200_000 });
  });
});

describe("RunLimiter", () => {
  it("counts initial tool calls once, ignoring updates and repeats", () => {
    const l = new RunLimiter({ maxToolCalls: 2, maxContextTokens: 0 });
    expect(l.observe(toolCall("t1") + toolCall("t1", "tool_call_update") + toolCall("t1") + toolCall("t2"))).toBeNull();
    expect(l.toolCalls).toBe(2);
    expect(l.observe(toolCall("t3"))).toEqual({ limit: "tool_calls", max: 2, observed: 3 });
    expect(l.observe(toolCall("t4"))).toBeNull();
  });

  it("reassembles a JSON line split across chunks and ignores non-event output", () => {
    const l = new RunLimiter({ maxToolCalls: 1, maxContextTokens: 0 });
    const two = toolCall("a") + "[starnet] note\nplain text {\"type\":\"acpx.tool_call\"}\n" + toolCall("b");
    const cut = two.length - 20;
    expect(l.observe(two.slice(0, cut))).toBeNull();
    expect(l.toolCalls).toBe(1);
    expect(l.observe(two.slice(cut))?.limit).toBe("tool_calls");
  });

  it("trips on the session context size from usage updates", () => {
    const l = new RunLimiter({ maxToolCalls: 0, maxContextTokens: 50_000 });
    expect(l.observe(usage(18_765) + toolCall("x"))).toBeNull();
    expect(l.observe(usage(50_001))).toEqual({ limit: "context_tokens", max: 50_000, observed: 50_001 });
  });
});

describe("limitedResult", () => {
  it("reports a failed run with the Starnet code and drops stop and replay markers", () => {
    const l = new RunLimiter({ maxToolCalls: 1, maxContextTokens: 0 });
    l.observe(toolCall("a") + toolCall("b"));
    const out = limitedResult(
      {
        exitCode: null,
        signal: null,
        timedOut: false,
        errorCode: "cancelled",
        executionRecovery: { kind: "interrupted", providerStopped: true, sessionPreserved: true, actionOutcomes: "settled" },
        resultJson: { summary: "x", executionCancellation: { state: "acknowledged" } },
      },
      l,
    );
    expect(out).toMatchObject({ exitCode: 1, errorCode: "starnet_run_limit", errorMessage: expect.stringContaining("2 tool calls exceeds the limit of 1") });
    expect(out).not.toHaveProperty("executionRecovery");
    expect(out.resultJson).toEqual({ summary: "x", starnetRunLimit: { limit: "tool_calls", max: 1, observed: 2, toolCalls: 2, contextTokens: 0, limits: { maxToolCalls: 1, maxContextTokens: 0 } } });
  });
});

describe("executeWithRunLimits", () => {
  it("aborts the run signal on the first breach and returns the limited result", async () => {
    const { ctx, logs } = runCtx({ starnetMaxToolCalls: 2 });
    let seen: AbortSignal | undefined;
    const out = await executeWithRunLimits(ctx, async (c) => {
      seen = c.signal;
      for (const id of ["a", "b", "c", "d"]) {
        if (c.signal?.aborted) break;
        await c.onLog("stdout", toolCall(id));
      }
      return { ...okResult, exitCode: null, errorCode: "cancelled" };
    });
    expect(seen?.aborted).toBe(true);
    expect(out.errorCode).toBe("starnet_run_limit");
    expect(logs.filter((l) => l.includes("acpx.tool_call"))).toHaveLength(3);
    expect(logs.join("")).toContain("[starnet] Starnet run limit: 3 tool calls exceeds the limit of 2 (starnetMaxToolCalls); stopping the run");
  });

  it("passes an operator stop through untouched and follows the operator signal", async () => {
    const operator = new AbortController();
    const { ctx } = runCtx({}, operator.signal);
    const stopped = { ...okResult, exitCode: null, errorCode: "cancelled", resultJson: { executionCancellation: { state: "acknowledged" } } };
    const out = await executeWithRunLimits(ctx, async (c) => {
      operator.abort();
      expect(c.signal?.aborted).toBe(true);
      return stopped;
    });
    expect(out).toBe(stopped);
  });

  it("does not wrap the run when both limits are off", async () => {
    const { ctx } = runCtx({ starnetMaxToolCalls: 0, starnetMaxContextTokens: 0 });
    const out = await executeWithRunLimits(ctx, async (c) => {
      expect(c).toBe(ctx);
      return okResult;
    });
    expect(out).toBe(okResult);
  });
});
