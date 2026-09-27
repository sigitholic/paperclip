import {
  admit,
  buildBundle,
  compareToNaive,
  oneLine,
  parsePinCommand,
  summarizeL1,
  type AdmissionResult,
  type MemoryKind,
  type MemoryScopeKind,
  type MemoryTier,
  type RunOutcome,
} from "@starnet/memory-core";
import { AGENT_L1_ISSUE, type CoreReader, type IssueInfo, type MemoryStore, type Scope, type StoredItem } from "./types.js";

export interface MemoryEvent {
  type: "l1.updated" | "item.changed" | "bundle.logged" | "admission.logged";
  issueId?: string | null;
  agentId?: string | null;
  itemId?: string | null;
  decision?: string;
  at: string;
}

export interface ServiceDeps {
  store: MemoryStore;
  core: CoreReader;
  newId: () => string;
  now: () => string;
  emit: (companyId: string, event: MemoryEvent) => void;
  defaultGrantedTools?: (companyId: string) => Promise<string[]>;
  /** Serialises work per key (e.g. per agent) so concurrent events cannot interleave L1 writes. */
  serial?: <T>(key: string, fn: () => Promise<T>) => Promise<T>;
}

export class MemoryError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPE_KINDS: MemoryScopeKind[] = ["issue", "agent", "project", "company"];
const NOTE_KINDS: MemoryKind[] = ["note", "decision", "lesson", "failure"];

export function assertUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new MemoryError(`${label} must be a UUID`, 400);
  return value.toLowerCase();
}

interface RunEndedPayload {
  runId?: string;
  agentId?: string;
  status?: string;
  error?: string | null;
  issueId?: string | null;
  finishedAt?: string | null;
}

export function createMemoryService(deps: ServiceDeps) {
  const { store, core } = deps;
  const serial = deps.serial ?? (<T>(_k: string, fn: () => Promise<T>) => fn());
  const emit = (companyId: string, e: Omit<MemoryEvent, "at">) => deps.emit(companyId, { ...e, at: deps.now() });

  function scopesFor(companyId: string, issue: IssueInfo | null, agentId: string | null): Scope[] {
    const scopes: Scope[] = [];
    if (issue) scopes.push({ kind: "issue", id: issue.id });
    if (agentId) scopes.push({ kind: "agent", id: agentId });
    if (issue?.projectId) scopes.push({ kind: "project", id: issue.projectId });
    scopes.push({ kind: "company", id: companyId });
    return scopes;
  }

  async function pinnedIds(companyId: string, scopes: Scope[]): Promise<string[]> {
    const pins = await store.listItems(companyId, { scopes, tiers: ["curated"], pinned: true, limit: 8 });
    return pins.map((p) => p.id);
  }

  /** Stores an admitted item (or only logs the rejection) and records the decision. Never stores rejected text. */
  async function admitAndStore(
    companyId: string,
    input: {
      text: string;
      kind: MemoryKind;
      source: "board" | "agent" | "system" | "chat";
      scope: Scope;
      sourceKind: string;
      sourceId: string;
      createdById: string | null;
      pinWhenCurated: boolean;
    },
  ): Promise<{ admission: AdmissionResult; itemId: string | null; duplicate: boolean }> {
    const admission = admit(input.text, input.kind, input.source);
    let itemId: string | null = null;
    let duplicate = false;
    if (admission.decision !== "reject") {
      itemId = deps.newId();
      const { inserted } = await store.insertItem(companyId, {
        id: itemId,
        scopeKind: input.scope.kind,
        scopeId: input.scope.id,
        kind: input.kind,
        tier: admission.decision,
        body: admission.text,
        pinned: input.pinWhenCurated && admission.decision === "curated",
        reasons: admission.reasons,
        sourceKind: input.sourceKind,
        sourceId: input.sourceId,
        createdByType: input.source === "chat" ? "system" : input.source,
        createdById: input.createdById,
      });
      if (!inserted) {
        duplicate = true;
        itemId = null;
      }
    }
    if (!duplicate) {
      await store.logAdmission(companyId, {
        id: deps.newId(),
        sourceKind: input.sourceKind,
        sourceId: input.sourceId,
        scopeKind: input.scope.kind,
        scopeId: input.scope.id,
        decision: admission.decision,
        reasons: admission.reasons,
        itemId,
        createdAt: deps.now(),
      });
      emit(companyId, { type: "admission.logged", itemId, decision: admission.decision, issueId: input.scope.kind === "issue" ? input.scope.id : null, agentId: input.scope.kind === "agent" ? input.scope.id : null });
    }
    return { admission, itemId, duplicate };
  }

  return {
    /** agent.run.finished / failed / cancelled → deterministic L1 for (agent, issue) and (agent). Observe-only. */
    async onRunEnded(companyId: string, payload: RunEndedPayload): Promise<{ updated: boolean }> {
      const runId = payload.runId;
      const agentId = payload.agentId;
      if (!runId || !agentId || !UUID.test(runId) || !UUID.test(agentId)) return { updated: false };
      return serial(`agent:${agentId}`, async () => {
        const run = (await core.getRun(companyId, runId)) ?? {
          id: runId, agentId, status: payload.status ?? "unknown", error: payload.error ?? null, issueId: payload.issueId ?? null, startedAt: null, finishedAt: payload.finishedAt ?? null,
        };
        const issueId = payload.issueId ?? run.issueId;
        const comments = issueId && UUID.test(issueId) ? await core.runComments(companyId, issueId, run) : [];
        const status = payload.status ?? run.status;
        // Default: do not write. A successful run that said nothing adds no memory.
        if (comments.length === 0 && (status === "succeeded" || status === "cancelled")) return { updated: false };
        const outcome: RunOutcome = { runId, status, finishedAt: payload.finishedAt ?? run.finishedAt ?? deps.now(), comments, error: payload.error ?? run.error };
        let updated = false;
        const issue = issueId && UUID.test(issueId) ? await core.getIssue(companyId, issueId) : null;
        if (issue) {
          const prev = await store.getL1(companyId, agentId, issue.id);
          const next = summarizeL1(prev, outcome, { pinIds: await pinnedIds(companyId, [{ kind: "issue", id: issue.id }, { kind: "agent", id: agentId }]) });
          if (next !== prev) {
            await store.upsertL1(companyId, { ...next, agentId, issueId: issue.id });
            updated = true;
          }
        }
        const prevAgent = await store.getL1(companyId, agentId, AGENT_L1_ISSUE);
        const nextAgent = summarizeL1(prevAgent, outcome, { pinIds: await pinnedIds(companyId, [{ kind: "agent", id: agentId }]) });
        if (nextAgent !== prevAgent) {
          await store.upsertL1(companyId, { ...nextAgent, agentId, issueId: AGENT_L1_ISSUE });
          updated = true;
        }
        if (updated) emit(companyId, { type: "l1.updated", issueId: issue?.id ?? null, agentId });
        return { updated };
      });
    },

    /** Board comment "📌 …", "catat: …", "/pin …" → pin for the issue's assigned agent (or the company). */
    async onCommentCreated(companyId: string, event: { actorType?: string; entityId?: string; payload?: unknown }) {
      if (event.actorType !== "user") return { handled: false };
      const commentId = (event.payload as { commentId?: unknown } | null)?.commentId;
      if (typeof commentId !== "string" || !UUID.test(commentId)) return { handled: false };
      const comment = await core.getComment(companyId, commentId);
      if (!comment || comment.authorAgentId || !comment.authorUserId) return { handled: false };
      const note = parsePinCommand(comment.body);
      if (note === null) return { handled: false };
      const issue = await core.getIssue(companyId, comment.issueId);
      const scope: Scope = issue?.assigneeAgentId ? { kind: "agent", id: issue.assigneeAgentId } : { kind: "company", id: companyId };
      const result = await admitAndStore(companyId, {
        text: note, kind: "pin", source: "board", scope, sourceKind: "comment", sourceId: comment.id, createdById: comment.authorUserId, pinWhenCurated: true,
      });
      if (result.itemId) emit(companyId, { type: "item.changed", itemId: result.itemId, issueId: comment.issueId, agentId: issue?.assigneeAgentId ?? null });
      return { handled: true, decision: result.admission.decision, reasons: result.admission.reasons, itemId: result.itemId };
    },

    async resolveRunIssue(companyId: string, runId: string): Promise<string | null> {
      const run = await core.getRun(companyId, runId);
      return run?.issueId && UUID.test(run.issueId) ? run.issueId : null;
    },

    /** The curated context bundle for (issue, agent). Logged unless `via` is "preview". */
    async buildContext(input: { companyId: string; issueId: string; agentId?: string | null; runId?: string | null; grantedTools?: string[] | null; via: "route" | "tool" | "preview" }) {
      const { companyId } = input;
      const issue = await core.getIssue(companyId, assertUuid(input.issueId, "issueId"));
      if (!issue) throw new MemoryError("Issue not found", 404);
      const agentId = input.agentId ?? issue.assigneeAgentId;
      const scopes = scopesFor(companyId, issue, agentId);
      const [l1, agentL1, pins, handoffRaw, naive] = await Promise.all([
        agentId ? store.getL1(companyId, agentId, issue.id) : null,
        agentId ? store.getL1(companyId, agentId, AGENT_L1_ISSUE) : null,
        store.listItems(companyId, { scopes, tiers: ["curated"], pinned: true, limit: 8 }),
        core.handoffComments(companyId, issue.id, agentId),
        core.naiveChars(companyId, issue.id, agentId),
      ]);
      let hits = await store.listItems(companyId, { scopes, tiers: ["curated", "ephemeral"], pinned: false, query: `${issue.title} ${issue.description ?? ""}`.slice(0, 400), limit: 3 });
      if (hits.length === 0) {
        hits = await store.listItems(companyId, { scopes, tiers: ["curated", "ephemeral"], pinned: false, kinds: ["decision", "lesson", "failure", "approval"], limit: 3 });
      }
      // Pin commands are represented by their (admitted) items, never as raw handoff text.
      const handoff = handoffRaw.filter((c) => parsePinCommand(c.body) === null).map((c) => `${c.authorLabel}: ${oneLine(c.body)}`);
      const granted = input.grantedTools && input.grantedTools.length > 0 ? input.grantedTools : ((await deps.defaultGrantedTools?.(companyId)) ?? []);
      const bundle = buildBundle({
        task: { identifier: issue.identifier, title: issue.title, description: issue.description, status: issue.status },
        handoff,
        grantedTools: granted,
        l1,
        agentL1,
        pins,
        hits,
      });
      const savings = compareToNaive(Math.max(naive, 0), bundle);
      if (input.via !== "preview") {
        await store.logBundle(companyId, {
          id: deps.newId(),
          issueId: issue.id,
          agentId: agentId ?? null,
          runId: input.runId ?? null,
          via: input.via,
          sections: bundle.meta.sections,
          chars: bundle.meta.chars,
          estTokens: bundle.meta.estTokens,
          naiveChars: savings.naiveChars,
          naiveTokens: savings.naiveTokens,
          bundleText: bundle.text,
          createdAt: deps.now(),
        });
        emit(companyId, { type: "bundle.logged", issueId: issue.id, agentId: agentId ?? null });
      }
      return { issueId: issue.id, agentId: agentId ?? null, text: bundle.text, meta: bundle.meta, savings };
    },

    async recall(input: { companyId: string; agentId: string | null; query: string; limit?: number }) {
      const limit = Math.max(1, Math.min(5, Math.floor(input.limit ?? 3)));
      const scopes: Scope[] = [{ kind: "company", id: input.companyId }];
      if (input.agentId) scopes.unshift({ kind: "agent", id: input.agentId });
      return store.listItems(input.companyId, { scopes, tiers: ["curated", "ephemeral"], query: input.query, limit });
    },

    /** memory.create_note: agent write, agent scope, ephemeral at most. Idempotent per (run, text). */
    async createAgentNote(input: { companyId: string; agentId: string; runId: string; text: string; kind?: string }) {
      const kind = NOTE_KINDS.includes(input.kind as MemoryKind) ? (input.kind as MemoryKind) : "note";
      const sourceId = `${input.runId}:${hash(input.text)}`;
      return admitAndStore(input.companyId, {
        text: input.text, kind, source: "agent", scope: { kind: "agent", id: input.agentId }, sourceKind: "tool", sourceId, createdById: input.agentId, pinWhenCurated: false,
      });
    },

    /** Board (UI) note or pin. */
    async addBoardNote(input: { companyId: string; scopeKind: string; scopeId: string; text: string; userId: string | null; pin: boolean }) {
      if (!SCOPE_KINDS.includes(input.scopeKind as MemoryScopeKind)) throw new MemoryError("invalid scopeKind", 400);
      const scope: Scope = { kind: input.scopeKind as MemoryScopeKind, id: assertUuid(input.scopeId, "scopeId") };
      const result = await admitAndStore(input.companyId, {
        text: input.text, kind: input.pin ? "pin" : "note", source: "board", scope, sourceKind: "ui", sourceId: deps.newId(), createdById: input.userId, pinWhenCurated: input.pin,
      });
      if (result.itemId) emit(input.companyId, { type: "item.changed", itemId: result.itemId });
      return { decision: result.admission.decision, reasons: result.admission.reasons, itemId: result.itemId };
    },

    async setPinned(companyId: string, itemId: string, pinned: boolean) {
      const item = await store.getItem(companyId, assertUuid(itemId, "itemId"));
      if (!item) throw new MemoryError("Item not found", 404);
      if (item.tier === "quarantine") throw new MemoryError("Quarantined items cannot be pinned", 409);
      // A board pin is an approval: pinning promotes the item to curated.
      await store.updateItem(companyId, item.id, pinned ? { pinned: true, tier: "curated" } : { pinned: false });
      emit(companyId, { type: "item.changed", itemId: item.id });
      return { ok: true };
    },

    async promote(companyId: string, itemId: string) {
      const item = await store.getItem(companyId, assertUuid(itemId, "itemId"));
      if (!item) throw new MemoryError("Item not found", 404);
      if (item.tier !== "ephemeral") throw new MemoryError(`Only ephemeral items can be promoted (tier: ${item.tier})`, 409);
      await store.updateItem(companyId, item.id, { tier: "curated" });
      emit(companyId, { type: "item.changed", itemId: item.id });
      return { ok: true };
    },

    async forget(companyId: string, itemId: string) {
      const ok = await store.deleteItem(companyId, assertUuid(itemId, "itemId"));
      if (!ok) throw new MemoryError("Item not found", 404);
      emit(companyId, { type: "item.changed", itemId });
      return { ok: true };
    },

    async issueView(companyId: string, issueId: string) {
      const issue = await core.getIssue(companyId, assertUuid(issueId, "issueId"));
      if (!issue) throw new MemoryError("Issue not found", 404);
      const agentId = issue.assigneeAgentId;
      const scopes = scopesFor(companyId, issue, agentId);
      const [l1s, agentL1, pins, notes, quarantine, bundles, admissions] = await Promise.all([
        store.listL1(companyId, { issueId: issue.id, limit: 10 }),
        agentId ? store.getL1(companyId, agentId, AGENT_L1_ISSUE) : null,
        store.listItems(companyId, { scopes, tiers: ["curated"], pinned: true, limit: 20 }),
        store.listItems(companyId, { scopes: scopes.filter((s) => s.kind !== "company"), tiers: ["curated", "ephemeral"], pinned: false, limit: 20 }),
        store.listItems(companyId, { scopes: scopes.filter((s) => s.kind !== "company"), tiers: ["quarantine"], limit: 20 }),
        store.listBundles(companyId, { issueId: issue.id, limit: 5 }),
        store.listAdmissions(companyId, { scopes: scopes.filter((s) => s.kind !== "company"), limit: 10 }),
      ]);
      const labels = await core.labels(companyId, l1s.map((l) => l.agentId), []);
      return { issue: { id: issue.id, identifier: issue.identifier, title: issue.title, assigneeAgentId: agentId }, l1s, agentL1, pins, notes, quarantine, bundles, admissions, labels };
    },

    async agentView(companyId: string, agentId: string) {
      const id = assertUuid(agentId, "agentId");
      const scope: Scope[] = [{ kind: "agent", id }];
      const [agentL1, l1s, pins, lessons, quarantine, bundles, admissions] = await Promise.all([
        store.getL1(companyId, id, AGENT_L1_ISSUE),
        store.listL1(companyId, { agentId: id, limit: 11 }),
        store.listItems(companyId, { scopes: scope, tiers: ["curated"], pinned: true, limit: 20 }),
        store.listItems(companyId, { scopes: scope, tiers: ["curated", "ephemeral"], pinned: false, limit: 20 }),
        store.listItems(companyId, { scopes: scope, tiers: ["quarantine"], limit: 20 }),
        store.listBundles(companyId, { agentId: id, limit: 5 }),
        store.listAdmissions(companyId, { scopes: scope, limit: 10 }),
      ]);
      const issueL1s = l1s.filter((l) => l.issueId !== AGENT_L1_ISSUE).slice(0, 10);
      const labels = await core.labels(companyId, [id], [...issueL1s.map((l) => l.issueId), ...bundles.map((b) => b.issueId)]);
      return { agentL1, l1s: issueL1s, pins, lessons, quarantine, bundles, admissions, labels };
    },

    async pageView(companyId: string, filter: { q?: string; tier?: string; scopeKind?: string }) {
      const tiers = ["curated", "ephemeral", "quarantine"].includes(filter.tier ?? "") ? [filter.tier as MemoryTier] : undefined;
      const q = typeof filter.q === "string" && filter.q.trim() ? filter.q.trim().slice(0, 200) : undefined;
      const [items, counts, stats, admissions, l1s] = await Promise.all([
        store.listItems(companyId, { tiers, query: q, limit: 100 }),
        store.tierCounts(companyId),
        store.bundleStats(companyId),
        store.listAdmissions(companyId, { limit: 20 }),
        store.listL1(companyId, { limit: 20 }),
      ]);
      const scoped = SCOPE_KINDS.includes(filter.scopeKind as MemoryScopeKind) ? items.filter((i) => i.scopeKind === filter.scopeKind) : items;
      const agentL1s = await store.listL1(companyId, { issueId: AGENT_L1_ISSUE, limit: 50 });
      const labels = await core.labels(companyId, [...agentL1s.map((l) => l.agentId), ...l1s.map((l) => l.agentId)], l1s.map((l) => l.issueId));
      const agents = agentL1s.map((l) => ({ id: l.agentId, name: labels.agents[l.agentId] ?? l.agentId.slice(0, 8), updatedAt: l.updatedAt, runCount: l.runCount }));
      return { items: scoped, counts, savings: stats, admissions, l1s, agents, labels };
    },

    async savings(companyId: string) {
      const stats = await store.bundleStats(companyId);
      const savedPct = stats.avgNaiveChars > 0 ? Math.round(((stats.avgNaiveChars - stats.avgChars) / stats.avgNaiveChars) * 1000) / 10 : 0;
      return { ...stats, savedPct };
    },
  };
}

export type MemoryService = ReturnType<typeof createMemoryService>;

function hash(text: string): string {
  // FNV-1a 32-bit: stable idempotency key, not a security primitive.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export type { StoredItem };
