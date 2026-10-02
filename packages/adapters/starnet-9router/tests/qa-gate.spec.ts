import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeWithQaGate } from "../src/index.js";
import { checkQaAfterRun, ensureQaStage, type IssueFetch, type QaRequest } from "../src/qa-gate.js";

const NOC = "11111111-1111-4111-8111-111111111111";
const QA = "22222222-2222-4222-8222-222222222222";
const STAGE = "33333333-3333-4333-8333-333333333333";

type Call = { method: string; url: string; headers: Record<string, string>; body?: unknown };

/** A tiny issue API: GET returns the current issue, PATCH merges the body and assigns stage ids. */
function issueApi(initial: Record<string, unknown>, calls: Call[] = [], status = 200): { fetch: IssueFetch; issue: () => Record<string, unknown> } {
  let issue = { ...initial };
  const fetchImpl: IssueFetch = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, url, headers: init.headers, body });
    if (status !== 200) return { ok: false, status, json: async () => ({}) };
    if (init.method === "PATCH") {
      const policy = body.executionPolicy;
      issue = { ...issue, executionPolicy: { ...policy, stages: policy.stages.map((s: Record<string, unknown>) => ({ id: s.id ?? STAGE, ...s })) } };
    }
    return { ok: true, status: 200, json: async () => issue };
  };
  return { fetch: fetchImpl, issue: () => issue };
}

const req = (fetchImpl: IssueFetch, over: Partial<QaRequest> = {}): QaRequest => ({
  apiUrl: "http://h/api",
  issueId: "i1",
  agentId: NOC,
  reviewerAgentId: QA,
  runId: "run-1",
  authToken: "run-jwt",
  fetchImpl,
  ...over,
});

const reviewPolicy = { stages: [{ id: STAGE, type: "review", participants: [{ type: "agent", agentId: QA }] }] };

describe("ensureQaStage", () => {
  it("adds a review stage for the reviewer with the run token and keeps the existing policy", async () => {
    const calls: Call[] = [];
    const api = issueApi({ status: "todo", assigneeAgentId: NOC, executionPolicy: { mode: "normal", commentRequired: true, stages: [] } }, calls);
    expect(await ensureQaStage(req(api.fetch))).toEqual({ attached: true, stageId: STAGE });
    expect(calls.map((c) => c.method)).toEqual(["GET", "PATCH"]);
    expect(calls[1]!.url).toBe("http://h/api/issues/i1");
    expect(calls[1]!.headers).toMatchObject({ authorization: "Bearer run-jwt", "x-paperclip-run-id": "run-1" });
    expect(calls[1]!.body).toEqual({
      executionPolicy: { mode: "normal", commentRequired: true, maxReviewRounds: 2, stages: [{ type: "review", participants: [{ type: "agent", agentId: QA }] }] },
    });
  });

  it("does nothing when the stage exists, the issue belongs to someone else, or it is already in review/done", async () => {
    const calls: Call[] = [];
    expect(await ensureQaStage(req(issueApi({ status: "todo", assigneeAgentId: NOC, executionPolicy: reviewPolicy }, calls).fetch))).toEqual({
      attached: false,
      reason: "review stage already present",
      stageId: STAGE,
    });
    expect(await ensureQaStage(req(issueApi({ status: "todo", assigneeAgentId: QA }, calls).fetch))).toMatchObject({ reason: "issue is not assigned to this agent" });
    expect(await ensureQaStage(req(issueApi({ status: "in_review", assigneeAgentId: NOC }, calls).fetch))).toMatchObject({ reason: "issue is in_review" });
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("skips the reviewer's own runs, runs without an issue or token, and reports API errors without throwing", async () => {
    const calls: Call[] = [];
    const api = issueApi({}, calls);
    expect(await ensureQaStage(req(api.fetch, { agentId: QA }))).toEqual({ attached: false, reason: "agent is the reviewer" });
    expect(await ensureQaStage(req(api.fetch, { issueId: undefined }))).toEqual({ attached: false, reason: "run has no issue" });
    expect(await ensureQaStage(req(api.fetch, { authToken: undefined }))).toEqual({ attached: false, reason: "no run token" });
    expect(await ensureQaStage(req(api.fetch, { reviewerAgentId: undefined }))).toEqual({ attached: false, reason: "no reviewer configured" });
    expect(calls).toEqual([]);
    expect(await ensureQaStage(req(issueApi({}, [], 403).fetch))).toEqual({ attached: false, reason: "GET issue -> 403" });
  });
});

describe("checkQaAfterRun", () => {
  it("accepts an issue in review or done with the reviewer's stage approved", async () => {
    expect(await checkQaAfterRun(req(issueApi({ status: "in_review", executionPolicy: reviewPolicy }).fetch))).toMatchObject({ bypassed: false });
    const approved = { status: "done", executionPolicy: reviewPolicy, executionState: { status: "completed", completedStageIds: [STAGE] } };
    expect(await checkQaAfterRun(req(issueApi(approved).fetch))).toEqual({ bypassed: false, reason: "QA review approved" });
  });

  it("flags done without approval and done with the stage removed", async () => {
    expect(await checkQaAfterRun(req(issueApi({ status: "done", executionPolicy: reviewPolicy, executionState: null }).fetch))).toEqual({
      bypassed: true,
      reason: "issue is done without QA approval",
    });
    expect(await checkQaAfterRun(req(issueApi({ status: "done", executionPolicy: null }).fetch))).toEqual({
      bypassed: true,
      reason: "issue is done but its QA review stage was removed",
    });
  });
});

describe("executeWithQaGate", () => {
  const savedEnv = { ...process.env };
  beforeEach(() => {
    process.env.PAPERCLIP_API_URL = "http://127.0.0.1:3100";
  });
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  function runCtx(config: Record<string, unknown>, agentId = NOC) {
    const logs: string[] = [];
    const ctx = {
      runId: "run-1",
      agent: { id: agentId, companyId: "c1" },
      runtime: {},
      config,
      context: { issueId: "i1" },
      authToken: "run-jwt",
      onLog: async (_s: "stdout" | "stderr", chunk: string) => {
        logs.push(chunk);
      },
    } as unknown as AdapterExecutionContext;
    return { ctx, logs };
  }
  const ok: AdapterExecutionResult = { exitCode: 0, signal: null, timedOut: false };

  it("adds the stage before the run and fails a run that closes the issue past QA", async () => {
    const api = issueApi({ status: "todo", assigneeAgentId: NOC, executionPolicy: null });
    const { ctx, logs } = runCtx({ starnetQaReviewer: QA });
    let stagesDuringRun = 0;
    const out = await executeWithQaGate(
      ctx,
      async () => {
        stagesDuringRun = (api.issue().executionPolicy as { stages: unknown[] }).stages.length;
        // The agent drops the policy and closes the issue in one PATCH.
        Object.assign(api.issue(), { status: "done", executionPolicy: null });
        return ok;
      },
      api.fetch,
    );
    expect(stagesDuringRun).toBe(1);
    expect(logs.join("")).toContain(`[starnet] QA gate: review stage added for reviewer ${QA}`);
    expect(logs.join("")).toContain("[starnet] QA gate bypassed: issue is done but its QA review stage was removed");
    expect(out).toMatchObject({ exitCode: 1, errorCode: "starnet_qa_bypassed", resultJson: { starnetQa: { bypassed: true, reviewerAgentId: QA } } });
  });

  it("keeps an earlier error code and leaves the reviewer's own runs alone", async () => {
    const done = issueApi({ status: "done", assigneeAgentId: NOC, executionPolicy: null });
    const limited = { ...ok, exitCode: 1, errorCode: "starnet_run_limit" };
    const out = await executeWithQaGate(runCtx({ starnetQaReviewer: QA }).ctx, async () => limited, done.fetch);
    expect(out.errorCode).toBe("starnet_run_limit");
    expect(out.resultJson).toMatchObject({ starnetQa: { bypassed: true } });

    const calls: Call[] = [];
    const reviewer = runCtx({ starnetQaReviewer: QA }, QA);
    expect(await executeWithQaGate(reviewer.ctx, async () => ok, issueApi({ status: "in_review" }, calls).fetch)).toBe(ok);
    expect(calls).toEqual([]);
    expect(reviewer.logs.join("")).toContain("[starnet] QA gate: agent is the reviewer");
  });

  it("is a no-op without a reviewer", async () => {
    const { ctx, logs } = runCtx({});
    expect(await executeWithQaGate(ctx, async () => ok)).toBe(ok);
    expect(logs).toEqual([]);
  });
});
