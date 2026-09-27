/** Where a memory item lives. `issue` + `agent` together form an L1 session key. */
export type MemoryScopeKind = "company" | "project" | "agent" | "issue";

/** What kind of fact an item is. Only clear signals are ever written (default: do not write). */
export type MemoryKind = "decision" | "approval" | "lesson" | "failure" | "note" | "pin" | "summary";

/** Who produced the text. Board users are trusted more than agents or chat. */
export type MemorySource = "board" | "agent" | "system" | "chat";

/** Storage tier after admission. `quarantine` is stored for review but never enters a bundle. */
export type MemoryTier = "curated" | "ephemeral" | "quarantine";

export type AdmissionDecision = MemoryTier | "reject";

export interface MemoryItem {
  id: string;
  scopeKind: MemoryScopeKind;
  scopeId: string;
  kind: MemoryKind;
  tier: MemoryTier;
  body: string;
  pinned?: boolean;
  sourceKind?: string | null;
  sourceId?: string | null;
  createdBy?: string | null;
  createdAt: string;
}

/** L1 session memory: one short summary per (agent, issue) or chat thread, plus pinned item ids. */
export interface SessionL1 {
  summary: string;
  pinIds: string[];
  lastRunId: string | null;
  runCount: number;
  updatedAt: string | null;
  /** Non-fatal notes from the summarizer, e.g. "poison_line_dropped". */
  flags: string[];
}

/** What a finished run left behind. Only data the host already stores; no LLM involved. */
export interface RunOutcome {
  runId: string;
  status: string;
  finishedAt: string;
  summary?: string | null;
  /** The agent's own comments on the issue from this run, oldest first. */
  comments?: string[];
  error?: string | null;
}

export interface BundleTask {
  identifier?: string | null;
  title: string;
  description?: string | null;
  status?: string | null;
}

export interface BundleInput {
  task: BundleTask;
  /** Handoff lines (other agents' last comments, board decisions), oldest first. */
  handoff?: string[];
  grantedTools?: string[];
  l1?: SessionL1 | null;
  /** Agent-level L1 (the agent's recent runs across issues), e.g. for routine runs on fresh issues. */
  agentL1?: SessionL1 | null;
  /** Pinned items, most important first. Only `curated` pins are used. */
  pins?: MemoryItem[];
  /** Recall hits (L2/L3), best first. `quarantine` items are never used. */
  hits?: MemoryItem[];
}

export type BundleSectionName = "task" | "handoff" | "tools" | "l1" | "agent" | "pins" | "hits";

export interface BundleSectionMeta {
  name: BundleSectionName;
  chars: number;
  items: number;
  truncated: boolean;
  dropped: boolean;
}

export interface BundleBudgets {
  total: number;
  task: number;
  handoffLines: number;
  handoffLineChars: number;
  tools: number;
  toolCount: number;
  l1: number;
  agentL1: number;
  pins: number;
  pinChars: number;
  hits: number;
  hitChars: number;
}

export interface ContextBundle {
  text: string;
  meta: {
    version: 1;
    chars: number;
    estTokens: number;
    sections: BundleSectionMeta[];
    droppedSections: BundleSectionName[];
    /** Items left out because they were quarantined, looked poisoned or duplicated a pin. */
    filteredItems: number;
    /** Secrets scrubbed from bundle content (defence in depth; admission should have caught them). */
    redactions: number;
    budgets: BundleBudgets;
  };
}
