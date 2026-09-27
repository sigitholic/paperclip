import type { MemoryItem, MemoryKind, MemoryScopeKind, MemoryTier, SessionL1 } from "@starnet/memory-core";

/** session_l1.issue_id for the agent-level L1 (recent runs across issues). */
export const AGENT_L1_ISSUE = "00000000-0000-0000-0000-000000000000";

export interface StoredItem extends MemoryItem {
  reasons: string[];
  createdByType: string;
  updatedAt: string;
}

export interface NewItem {
  id: string;
  scopeKind: MemoryScopeKind;
  scopeId: string;
  kind: MemoryKind;
  tier: MemoryTier;
  body: string;
  pinned: boolean;
  reasons: string[];
  sourceKind: string;
  sourceId: string | null;
  createdByType: "board" | "agent" | "system";
  createdById: string | null;
}

export interface L1Row extends SessionL1 {
  agentId: string;
  issueId: string;
}

export interface BundleLogRow {
  id: string;
  issueId: string;
  agentId: string | null;
  runId: string | null;
  via: "route" | "tool" | "preview";
  sections: unknown;
  chars: number;
  estTokens: number;
  naiveChars: number;
  naiveTokens: number;
  bundleText: string;
  createdAt: string;
}

export interface AdmissionLogRow {
  id: string;
  sourceKind: string;
  sourceId: string | null;
  scopeKind: MemoryScopeKind | null;
  scopeId: string | null;
  decision: string;
  reasons: string[];
  itemId: string | null;
  createdAt: string;
}

export interface Scope {
  kind: MemoryScopeKind;
  id: string;
}

export interface ItemFilter {
  scopes?: Scope[];
  tiers?: MemoryTier[];
  pinned?: boolean;
  kinds?: MemoryKind[];
  /** Full-text query (OR of words). */
  query?: string;
  limit: number;
}

export interface BundleStats {
  count: number;
  avgChars: number;
  avgNaiveChars: number;
  avgTokens: number;
  avgNaiveTokens: number;
}

export interface MemoryStore {
  insertItem(companyId: string, item: NewItem): Promise<{ inserted: boolean }>;
  getItem(companyId: string, id: string): Promise<StoredItem | null>;
  listItems(companyId: string, filter: ItemFilter): Promise<StoredItem[]>;
  updateItem(companyId: string, id: string, patch: { pinned?: boolean; tier?: MemoryTier }): Promise<boolean>;
  deleteItem(companyId: string, id: string): Promise<boolean>;
  tierCounts(companyId: string): Promise<Record<string, number>>;
  getL1(companyId: string, agentId: string, issueId: string): Promise<L1Row | null>;
  upsertL1(companyId: string, row: L1Row): Promise<void>;
  listL1(companyId: string, filter: { agentId?: string; issueId?: string; limit: number }): Promise<L1Row[]>;
  logBundle(companyId: string, row: BundleLogRow): Promise<void>;
  listBundles(companyId: string, filter: { issueId?: string; agentId?: string; limit: number }): Promise<BundleLogRow[]>;
  bundleStats(companyId: string): Promise<BundleStats>;
  logAdmission(companyId: string, row: AdmissionLogRow): Promise<void>;
  listAdmissions(companyId: string, filter: { scopes?: Scope[]; limit: number }): Promise<AdmissionLogRow[]>;
}

export interface RunInfo {
  id: string;
  agentId: string;
  status: string;
  error: string | null;
  issueId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface CommentInfo {
  id: string;
  issueId: string;
  authorType: string | null;
  authorUserId: string | null;
  authorAgentId: string | null;
  body: string;
}

export interface IssueInfo {
  id: string;
  identifier: string | null;
  title: string;
  description: string | null;
  status: string;
  assigneeAgentId: string | null;
  projectId: string | null;
}

export interface HandoffComment {
  authorLabel: string;
  body: string;
}

/** Read-only access to Paperclip core tables (whitelisted `coreReadTables`). */
export interface CoreReader {
  getRun(companyId: string, runId: string): Promise<RunInfo | null>;
  runComments(companyId: string, issueId: string, run: RunInfo): Promise<string[]>;
  getComment(companyId: string, commentId: string): Promise<CommentInfo | null>;
  getIssue(companyId: string, issueId: string): Promise<IssueInfo | null>;
  /** Newest-last comments on the issue that were not written by `agentId`. */
  handoffComments(companyId: string, issueId: string, agentId: string | null): Promise<HandoffComment[]>;
  /** Size of the naive "send the history" context: this issue's whole thread + the last 24 comments on the agent's other issues. */
  naiveChars(companyId: string, issueId: string, agentId: string | null): Promise<number>;
  /** Display names for UI labels (at most 50 ids each). */
  labels(companyId: string, agentIds: string[], issueIds: string[]): Promise<Labels>;
}

export interface Labels {
  agents: Record<string, string>;
  issues: Record<string, string>;
}
