/**
 * QA gate (Phase 2, LC-4): NOC issues are not done without a QA review.
 *
 * Paperclip core already enforces review stages (`executionPolicy.stages`): when the executor marks
 * an issue done it moves to `in_review` for the stage participant, who must approve or request
 * changes with a comment. Plugins cannot set that policy, so this adapter does it deterministically
 * before the executor's run: when `starnetQaReviewer` names a reviewer agent and the run's issue has
 * no review stage for it, the stage is added through the issue API with the run's own token.
 *
 * Agents may replace an issue's executionPolicy, so after the run the adapter checks the issue: done
 * without a completed review means the gate was bypassed, and the run is reported as failed.
 */
export const QA_REVIEWER_KEY = "starnetQaReviewer";
export const QA_BYPASS_ERROR_CODE = "starnet_qa_bypassed";
const DEFAULT_MAX_REVIEW_ROUNDS = 2;
const CLOSED_STATUSES = new Set(["in_review", "done", "cancelled"]);

export type IssueFetch = (
  url: string,
  init: { method: "GET" | "PATCH"; headers: Record<string, string>; body?: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

type Stage = { id?: string; type?: string; participants?: { type?: string; agentId?: string | null }[] };
type Issue = {
  status?: string;
  assigneeAgentId?: string | null;
  executionPolicy?: (Record<string, unknown> & { stages?: Stage[] }) | null;
  executionState?: { status?: string; completedStageIds?: string[] } | null;
};

export type QaRequest = {
  apiUrl: string;
  issueId: string | undefined;
  agentId: string;
  reviewerAgentId: string | undefined;
  runId: string;
  authToken: string | undefined;
  fetchImpl?: IssueFetch;
};

export type QaEnsureResult = { attached: true; stageId: string | null } | { attached: false; reason: string; stageId?: string | null };
export type QaCheckResult = { bypassed: boolean; reason: string };

const asString = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

export function qaReviewer(config: Record<string, unknown>): string | undefined {
  return asString(config[QA_REVIEWER_KEY]);
}

function reviewStageFor(issue: Issue, reviewerAgentId: string): Stage | undefined {
  return (issue.executionPolicy?.stages ?? []).find(
    (s) => s.type === "review" && (s.participants ?? []).some((p) => p.type === "agent" && p.agentId === reviewerAgentId),
  );
}

function client(req: QaRequest) {
  const fetchImpl = req.fetchImpl ?? (fetch as unknown as IssueFetch);
  const url = `${req.apiUrl}/issues/${encodeURIComponent(req.issueId!)}`;
  const headers = { authorization: `Bearer ${req.authToken}`, "x-paperclip-run-id": req.runId, "content-type": "application/json" };
  return {
    async get(): Promise<Issue> {
      const res = await fetchImpl(url, { method: "GET", headers, signal: AbortSignal.timeout(5_000) });
      if (!res.ok) throw new Error(`GET issue -> ${res.status}`);
      return (await res.json()) as Issue;
    },
    async patch(body: Record<string, unknown>): Promise<Issue> {
      const res = await fetchImpl(url, { method: "PATCH", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(5_000) });
      if (!res.ok) throw new Error(`PATCH issue -> ${res.status}`);
      return (await res.json()) as Issue;
    },
  };
}

function skip(req: QaRequest): string | null {
  if (!req.reviewerAgentId) return "no reviewer configured";
  if (req.reviewerAgentId === req.agentId) return "agent is the reviewer";
  if (!req.issueId) return "run has no issue";
  if (!req.authToken) return "no run token";
  return null;
}

/** Adds the reviewer's review stage to the run's issue when it is missing. Never throws. */
export async function ensureQaStage(req: QaRequest): Promise<QaEnsureResult> {
  const reason = skip(req);
  if (reason) return { attached: false, reason };
  const api = client(req);
  try {
    const issue = await api.get();
    const existing = reviewStageFor(issue, req.reviewerAgentId!);
    if (existing) return { attached: false, reason: "review stage already present", stageId: existing.id ?? null };
    if (issue.assigneeAgentId !== req.agentId) return { attached: false, reason: "issue is not assigned to this agent" };
    if (CLOSED_STATUSES.has(issue.status ?? "")) return { attached: false, reason: `issue is ${issue.status}` };
    const policy = issue.executionPolicy ?? {};
    const stages = [...(policy.stages ?? []), { type: "review", participants: [{ type: "agent", agentId: req.reviewerAgentId }] }];
    const updated = await api.patch({
      executionPolicy: { ...policy, stages, maxReviewRounds: policy.maxReviewRounds ?? DEFAULT_MAX_REVIEW_ROUNDS },
    });
    return { attached: true, stageId: reviewStageFor(updated, req.reviewerAgentId!)?.id ?? null };
  } catch (err) {
    return { attached: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/** After the executor's run: done without the reviewer's stage completed means the gate was bypassed. */
export async function checkQaAfterRun(req: QaRequest): Promise<QaCheckResult> {
  const reason = skip(req);
  if (reason) return { bypassed: false, reason };
  try {
    const issue = await client(req).get();
    if (issue.status !== "done") return { bypassed: false, reason: `issue is ${issue.status}` };
    const stage = reviewStageFor(issue, req.reviewerAgentId!);
    if (!stage) return { bypassed: true, reason: "issue is done but its QA review stage was removed" };
    const completed = stage.id && (issue.executionState?.completedStageIds ?? []).includes(stage.id);
    return completed ? { bypassed: false, reason: "QA review approved" } : { bypassed: true, reason: "issue is done without QA approval" };
  } catch (err) {
    return { bypassed: false, reason: `could not verify QA (${err instanceof Error ? err.message : String(err)})` };
  }
}
