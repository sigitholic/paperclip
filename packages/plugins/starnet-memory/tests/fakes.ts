import type {
  AdmissionLogRow,
  BundleLogRow,
  CommentInfo,
  CoreReader,
  HandoffComment,
  IssueInfo,
  ItemFilter,
  L1Row,
  MemoryStore,
  NewItem,
  RunInfo,
  StoredItem,
} from "../src/types.js";
import { ftsQuery } from "../src/sql-store.js";

export class FakeStore implements MemoryStore {
  items = new Map<string, StoredItem & { companyId: string }>();
  l1 = new Map<string, L1Row & { companyId: string }>();
  bundles: Array<BundleLogRow & { companyId: string }> = [];
  admissions: Array<AdmissionLogRow & { companyId: string }> = [];
  private seq = 0;

  async insertItem(companyId: string, item: NewItem) {
    for (const i of this.items.values()) {
      if (i.companyId === companyId && item.sourceId && i.sourceKind === item.sourceKind && i.sourceId === item.sourceId) return { inserted: false };
    }
    const t = new Date(Date.UTC(2026, 8, 27, 0, 0, this.seq++)).toISOString();
    this.items.set(item.id, { ...item, companyId, createdBy: item.createdById, createdAt: t, updatedAt: t });
    return { inserted: true };
  }
  async getItem(companyId: string, id: string) {
    const i = this.items.get(id);
    return i && i.companyId === companyId ? i : null;
  }
  async listItems(companyId: string, f: ItemFilter) {
    let rows = [...this.items.values()].filter((i) => i.companyId === companyId);
    if (f.scopes?.length) rows = rows.filter((i) => f.scopes!.some((s) => s.kind === i.scopeKind && s.id === i.scopeId));
    if (f.tiers?.length) rows = rows.filter((i) => f.tiers!.includes(i.tier));
    if (f.kinds?.length) rows = rows.filter((i) => f.kinds!.includes(i.kind));
    if (typeof f.pinned === "boolean") rows = rows.filter((i) => i.pinned === f.pinned);
    if (f.query !== undefined) {
      const words = ftsQuery(f.query).split(" | ").filter(Boolean);
      if (!words.length) return [];
      rows = rows.filter((i) => words.some((w) => i.body.toLowerCase().includes(w)));
    }
    const rank = { issue: 0, agent: 1, project: 2, company: 3 } as const;
    rows.sort((a, b) => rank[a.scopeKind] - rank[b.scopeKind] || b.createdAt.localeCompare(a.createdAt));
    return rows.slice(0, f.limit);
  }
  async updateItem(companyId: string, id: string, patch: { pinned?: boolean; tier?: StoredItem["tier"] }) {
    const i = await this.getItem(companyId, id);
    if (!i) return false;
    Object.assign(i, patch);
    return true;
  }
  async deleteItem(companyId: string, id: string) {
    const i = await this.getItem(companyId, id);
    return i ? this.items.delete(id) : false;
  }
  async tierCounts(companyId: string) {
    const out: Record<string, number> = {};
    for (const i of this.items.values()) if (i.companyId === companyId) out[i.tier] = (out[i.tier] ?? 0) + 1;
    return out;
  }
  async getL1(companyId: string, agentId: string, issueId: string) {
    return this.l1.get(`${companyId}|${agentId}|${issueId}`) ?? null;
  }
  async upsertL1(companyId: string, row: L1Row) {
    this.l1.set(`${companyId}|${row.agentId}|${row.issueId}`, { ...row, companyId });
  }
  async listL1(companyId: string, f: { agentId?: string; issueId?: string; limit: number }) {
    return [...this.l1.values()]
      .filter((l) => l.companyId === companyId && (!f.agentId || l.agentId === f.agentId) && (!f.issueId || l.issueId === f.issueId))
      .slice(0, f.limit);
  }
  async logBundle(companyId: string, row: BundleLogRow) {
    this.bundles.unshift({ ...row, companyId });
  }
  async listBundles(companyId: string, f: { issueId?: string; agentId?: string; limit: number }) {
    return this.bundles.filter((b) => b.companyId === companyId && (!f.issueId || b.issueId === f.issueId) && (!f.agentId || b.agentId === f.agentId)).slice(0, f.limit);
  }
  async bundleStats(companyId: string) {
    const rows = this.bundles.filter((b) => b.companyId === companyId && b.via !== "preview");
    const avg = (k: "chars" | "naiveChars" | "estTokens" | "naiveTokens") => (rows.length ? Math.round(rows.reduce((s, r) => s + r[k], 0) / rows.length) : 0);
    return { count: rows.length, avgChars: avg("chars"), avgNaiveChars: avg("naiveChars"), avgTokens: avg("estTokens"), avgNaiveTokens: avg("naiveTokens") };
  }
  async logAdmission(companyId: string, row: AdmissionLogRow) {
    this.admissions.unshift({ ...row, companyId });
  }
  async listAdmissions(companyId: string, f: { scopes?: Array<{ kind: string; id: string }>; limit: number }) {
    return this.admissions
      .filter((a) => a.companyId === companyId && (!f.scopes?.length || f.scopes.some((s) => s.kind === a.scopeKind && s.id === a.scopeId)))
      .slice(0, f.limit);
  }
}

export class FakeCore implements CoreReader {
  runs = new Map<string, RunInfo>();
  comments: Array<CommentInfo & { companyId: string; runId?: string; authorName?: string }> = [];
  issues = new Map<string, IssueInfo & { companyId: string }>();
  naive = 20000;

  async getRun(companyId: string, runId: string) {
    return this.runs.get(runId) ?? null;
  }
  async runComments(companyId: string, issueId: string, run: RunInfo) {
    return this.comments.filter((c) => c.companyId === companyId && c.issueId === issueId && c.runId === run.id).map((c) => c.body);
  }
  async getComment(companyId: string, commentId: string) {
    return this.comments.find((c) => c.companyId === companyId && c.id === commentId) ?? null;
  }
  async getIssue(companyId: string, issueId: string) {
    const i = this.issues.get(issueId);
    return i && i.companyId === companyId ? i : null;
  }
  async handoffComments(companyId: string, issueId: string, agentId: string | null): Promise<HandoffComment[]> {
    return this.comments
      .filter((c) => c.companyId === companyId && c.issueId === issueId && c.authorAgentId !== agentId)
      .map((c) => ({ authorLabel: c.authorAgentId ? `Agen ${c.authorName ?? "?"}` : "Board", body: c.body }));
  }
  async naiveChars() {
    return this.naive;
  }
}
