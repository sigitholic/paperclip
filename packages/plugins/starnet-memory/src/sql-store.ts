import type { PluginDatabaseClient } from "@paperclipai/plugin-sdk";
import type { MemoryTier } from "@starnet/memory-core";
import type { AdmissionLogRow, BundleLogRow, BundleStats, CommentInfo, CoreReader, HandoffComment, IssueInfo, ItemFilter, L1Row, Labels, MemoryStore, NewItem, RunInfo, Scope, StoredItem } from "./types.js";

type Row = Record<string, unknown>;
type Db = Pick<PluginDatabaseClient, "namespace" | "query" | "execute">;

const IDENT = /^[a-z_][a-z0-9_]*$/;

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const strOrNull = (v: unknown): string | null => (v == null ? null : str(v));
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : str(v));
const isoOrNull = (v: unknown): string | null => (v == null ? null : iso(v));
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0) || 0);
const json = <T>(v: unknown, fallback: T): T => {
  if (v == null) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
};

/** Words for an OR full-text query: letters/digits only, ≥ 3 chars, max 8. Never raw user syntax. */
export function ftsQuery(text: string): string {
  const words = (text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).slice(0, 8);
  return [...new Set(words)].join(" | ");
}

class Params {
  values: unknown[] = [];
  add(v: unknown): string {
    this.values.push(v);
    return `$${this.values.length}`;
  }
}

function scopeClause(p: Params, scopes: Scope[] | undefined): string {
  if (!scopes || scopes.length === 0) return "";
  const parts = scopes.map((s) => `(scope_kind = ${p.add(s.kind)} AND scope_id = ${p.add(s.id)}::uuid)`);
  return ` AND (${parts.join(" OR ")})`;
}

const ITEM_COLUMNS = `id::text AS id, scope_kind AS "scopeKind", scope_id::text AS "scopeId", kind, tier, body, pinned, reasons,
  source_kind AS "sourceKind", source_id AS "sourceId", created_by_type AS "createdByType", created_by_id AS "createdBy",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

function toItem(r: Row): StoredItem {
  return {
    id: str(r.id),
    scopeKind: str(r.scopeKind) as StoredItem["scopeKind"],
    scopeId: str(r.scopeId),
    kind: str(r.kind) as StoredItem["kind"],
    tier: str(r.tier) as MemoryTier,
    body: str(r.body),
    pinned: r.pinned === true,
    reasons: json<string[]>(r.reasons, []),
    sourceKind: strOrNull(r.sourceKind),
    sourceId: strOrNull(r.sourceId),
    createdByType: str(r.createdByType),
    createdBy: strOrNull(r.createdBy),
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

function toL1(r: Row): L1Row {
  return {
    agentId: str(r.agentId),
    issueId: str(r.issueId),
    summary: str(r.summary),
    pinIds: json<string[]>(r.pinIds, []),
    runCount: num(r.runCount),
    lastRunId: strOrNull(r.lastRunId),
    updatedAt: isoOrNull(r.updatedAt),
    flags: json<string[]>(r.flags, []),
  };
}

function toBundle(r: Row): BundleLogRow {
  return {
    id: str(r.id),
    issueId: str(r.issueId),
    agentId: strOrNull(r.agentId),
    runId: strOrNull(r.runId),
    via: str(r.via) as BundleLogRow["via"],
    sections: json<unknown>(r.sections, []),
    chars: num(r.chars),
    estTokens: num(r.estTokens),
    naiveChars: num(r.naiveChars),
    naiveTokens: num(r.naiveTokens),
    bundleText: str(r.bundleText),
    createdAt: iso(r.createdAt),
  };
}

/** Plugin-namespace storage through the host's restricted `ctx.db`. */
export class SqlMemoryStore implements MemoryStore {
  private readonly ns: string;
  constructor(private readonly db: Db) {
    if (!IDENT.test(db.namespace)) throw new Error("unexpected plugin database namespace");
    this.ns = db.namespace;
  }

  private t(table: string) {
    return `${this.ns}.${table}`;
  }

  async insertItem(companyId: string, item: NewItem) {
    const r = await this.db.execute(
      `INSERT INTO ${this.t("memory_items")} (id, company_id, scope_kind, scope_id, kind, tier, body, pinned, reasons, source_kind, source_id, created_by_type, created_by_id)
       VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13)
       ON CONFLICT (company_id, source_kind, source_id) DO NOTHING`,
      [item.id, companyId, item.scopeKind, item.scopeId, item.kind, item.tier, item.body, item.pinned, JSON.stringify(item.reasons), item.sourceKind, item.sourceId, item.createdByType, item.createdById],
    );
    return { inserted: r.rowCount > 0 };
  }

  async getItem(companyId: string, id: string) {
    const rows = await this.db.query<Row>(`SELECT ${ITEM_COLUMNS} FROM ${this.t("memory_items")} WHERE company_id = $1::uuid AND id = $2::uuid`, [companyId, id]);
    return rows[0] ? toItem(rows[0]) : null;
  }

  async listItems(companyId: string, f: ItemFilter) {
    const p = new Params();
    let where = `company_id = ${p.add(companyId)}::uuid${scopeClause(p, f.scopes)}`;
    // Scalar placeholders only (no array parameters through the host binder).
    if (f.tiers?.length) where += ` AND tier IN (${f.tiers.map((t) => p.add(t)).join(", ")})`;
    if (f.kinds?.length) where += ` AND kind IN (${f.kinds.map((k) => p.add(k)).join(", ")})`;
    if (typeof f.pinned === "boolean") where += ` AND pinned = ${p.add(f.pinned)}`;
    let order = `CASE scope_kind WHEN 'issue' THEN 0 WHEN 'agent' THEN 1 WHEN 'project' THEN 2 ELSE 3 END, created_at DESC`;
    if (f.query !== undefined) {
      const q = ftsQuery(f.query);
      if (!q) return [];
      const ph = p.add(q);
      where += ` AND tsv @@ to_tsquery('simple', ${ph})`;
      order = `ts_rank(tsv, to_tsquery('simple', ${ph})) DESC, created_at DESC`;
    }
    const limit = p.add(Math.max(1, Math.min(200, f.limit)));
    const rows = await this.db.query<Row>(`SELECT ${ITEM_COLUMNS} FROM ${this.t("memory_items")} WHERE ${where} ORDER BY ${order} LIMIT ${limit}`, p.values);
    return rows.map(toItem);
  }

  async updateItem(companyId: string, id: string, patch: { pinned?: boolean; tier?: MemoryTier }) {
    const p = new Params();
    const sets: string[] = [];
    if (typeof patch.pinned === "boolean") sets.push(`pinned = ${p.add(patch.pinned)}`);
    if (patch.tier) sets.push(`tier = ${p.add(patch.tier)}`);
    if (sets.length === 0) return false;
    const r = await this.db.execute(
      `UPDATE ${this.t("memory_items")} SET ${sets.join(", ")}, updated_at = now() WHERE company_id = ${p.add(companyId)}::uuid AND id = ${p.add(id)}::uuid`,
      p.values,
    );
    return r.rowCount > 0;
  }

  async deleteItem(companyId: string, id: string) {
    const r = await this.db.execute(`DELETE FROM ${this.t("memory_items")} WHERE company_id = $1::uuid AND id = $2::uuid`, [companyId, id]);
    return r.rowCount > 0;
  }

  async tierCounts(companyId: string) {
    const rows = await this.db.query<Row>(`SELECT tier, count(*)::int AS n FROM ${this.t("memory_items")} WHERE company_id = $1::uuid GROUP BY tier`, [companyId]);
    return Object.fromEntries(rows.map((r) => [str(r.tier), num(r.n)]));
  }

  async getL1(companyId: string, agentId: string, issueId: string) {
    const rows = await this.db.query<Row>(
      `SELECT agent_id::text AS "agentId", issue_id::text AS "issueId", summary, pin_ids AS "pinIds", run_count AS "runCount", last_run_id::text AS "lastRunId", updated_at AS "updatedAt", flags
       FROM ${this.t("session_l1")} WHERE company_id = $1::uuid AND agent_id = $2::uuid AND issue_id = $3::uuid`,
      [companyId, agentId, issueId],
    );
    return rows[0] ? toL1(rows[0]) : null;
  }

  async upsertL1(companyId: string, row: L1Row) {
    await this.db.execute(
      `INSERT INTO ${this.t("session_l1")} (company_id, agent_id, issue_id, summary, pin_ids, run_count, last_run_id, flags, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::jsonb, $6, $7::uuid, $8::jsonb, coalesce($9::timestamptz, now()))
       ON CONFLICT (company_id, agent_id, issue_id) DO UPDATE SET summary = EXCLUDED.summary, pin_ids = EXCLUDED.pin_ids,
         run_count = EXCLUDED.run_count, last_run_id = EXCLUDED.last_run_id, flags = EXCLUDED.flags, updated_at = EXCLUDED.updated_at`,
      [companyId, row.agentId, row.issueId, row.summary, JSON.stringify(row.pinIds), row.runCount, row.lastRunId, JSON.stringify(row.flags), row.updatedAt],
    );
  }

  async listL1(companyId: string, f: { agentId?: string; issueId?: string; limit: number }) {
    const p = new Params();
    let where = `company_id = ${p.add(companyId)}::uuid`;
    if (f.agentId) where += ` AND agent_id = ${p.add(f.agentId)}::uuid`;
    if (f.issueId) where += ` AND issue_id = ${p.add(f.issueId)}::uuid`;
    const rows = await this.db.query<Row>(
      `SELECT agent_id::text AS "agentId", issue_id::text AS "issueId", summary, pin_ids AS "pinIds", run_count AS "runCount", last_run_id::text AS "lastRunId", updated_at AS "updatedAt", flags
       FROM ${this.t("session_l1")} WHERE ${where} ORDER BY updated_at DESC LIMIT ${p.add(Math.max(1, Math.min(100, f.limit)))}`,
      p.values,
    );
    return rows.map(toL1);
  }

  async logBundle(companyId: string, b: BundleLogRow) {
    await this.db.execute(
      `INSERT INTO ${this.t("bundle_log")} (id, company_id, issue_id, agent_id, run_id, via, sections, chars, est_tokens, naive_chars, naive_tokens, bundle_text)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7::jsonb, $8, $9, $10, $11, $12)`,
      [b.id, companyId, b.issueId, b.agentId, b.runId, b.via, JSON.stringify(b.sections), b.chars, b.estTokens, b.naiveChars, b.naiveTokens, b.bundleText],
    );
  }

  async listBundles(companyId: string, f: { issueId?: string; agentId?: string; limit: number }) {
    const p = new Params();
    let where = `company_id = ${p.add(companyId)}::uuid`;
    if (f.issueId) where += ` AND issue_id = ${p.add(f.issueId)}::uuid`;
    if (f.agentId) where += ` AND agent_id = ${p.add(f.agentId)}::uuid`;
    const rows = await this.db.query<Row>(
      `SELECT id::text AS id, issue_id::text AS "issueId", agent_id::text AS "agentId", run_id::text AS "runId", via, sections, chars,
         est_tokens AS "estTokens", naive_chars AS "naiveChars", naive_tokens AS "naiveTokens", bundle_text AS "bundleText", created_at AS "createdAt"
       FROM ${this.t("bundle_log")} WHERE ${where} ORDER BY created_at DESC LIMIT ${p.add(Math.max(1, Math.min(50, f.limit)))}`,
      p.values,
    );
    return rows.map(toBundle);
  }

  async bundleStats(companyId: string): Promise<BundleStats> {
    const rows = await this.db.query<Row>(
      `SELECT count(*)::int AS n, coalesce(avg(chars), 0)::float8 AS c, coalesce(avg(naive_chars), 0)::float8 AS nc,
         coalesce(avg(est_tokens), 0)::float8 AS t, coalesce(avg(naive_tokens), 0)::float8 AS nt
       FROM ${this.t("bundle_log")} WHERE company_id = $1::uuid AND via <> 'preview'`,
      [companyId],
    );
    const r = rows[0] ?? {};
    return { count: num(r.n), avgChars: Math.round(num(r.c)), avgNaiveChars: Math.round(num(r.nc)), avgTokens: Math.round(num(r.t)), avgNaiveTokens: Math.round(num(r.nt)) };
  }

  async logAdmission(companyId: string, a: AdmissionLogRow) {
    await this.db.execute(
      `INSERT INTO ${this.t("admission_log")} (id, company_id, source_kind, source_id, scope_kind, scope_id, decision, reasons, item_id)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid, $7, $8::jsonb, $9::uuid)`,
      [a.id, companyId, a.sourceKind, a.sourceId, a.scopeKind, a.scopeId, a.decision, JSON.stringify(a.reasons), a.itemId],
    );
  }

  async listAdmissions(companyId: string, f: { scopes?: Scope[]; limit: number }) {
    const p = new Params();
    const where = `company_id = ${p.add(companyId)}::uuid${scopeClause(p, f.scopes)}`;
    const rows = await this.db.query<Row>(
      `SELECT id::text AS id, source_kind AS "sourceKind", source_id AS "sourceId", scope_kind AS "scopeKind", scope_id::text AS "scopeId",
         decision, reasons, item_id::text AS "itemId", created_at AS "createdAt"
       FROM ${this.t("admission_log")} WHERE ${where} ORDER BY created_at DESC LIMIT ${p.add(Math.max(1, Math.min(100, f.limit)))}`,
      p.values,
    );
    return rows.map((r) => ({
      id: str(r.id),
      sourceKind: str(r.sourceKind),
      sourceId: strOrNull(r.sourceId),
      scopeKind: (strOrNull(r.scopeKind) as AdmissionLogRow["scopeKind"]) ?? null,
      scopeId: strOrNull(r.scopeId),
      decision: str(r.decision),
      reasons: json<string[]>(r.reasons, []),
      itemId: strOrNull(r.itemId),
      createdAt: iso(r.createdAt),
    }));
  }
}

/** Read-only core access. Only whitelisted tables; only lengths are read for the naive-size estimate. */
export class SqlCoreReader implements CoreReader {
  constructor(private readonly db: Pick<PluginDatabaseClient, "query">) {}

  async getRun(companyId: string, runId: string): Promise<RunInfo | null> {
    const rows = await this.db.query<Row>(
      `SELECT id::text AS id, agent_id::text AS "agentId", status, error, context_snapshot->>'issueId' AS "issueId",
         started_at AS "startedAt", finished_at AS "finishedAt"
       FROM public.heartbeat_runs WHERE company_id = $1::uuid AND id = $2::uuid`,
      [companyId, runId],
    );
    const r = rows[0];
    return r
      ? { id: str(r.id), agentId: str(r.agentId), status: str(r.status), error: strOrNull(r.error), issueId: strOrNull(r.issueId), startedAt: isoOrNull(r.startedAt), finishedAt: isoOrNull(r.finishedAt) }
      : null;
  }

  async runComments(companyId: string, issueId: string, run: RunInfo): Promise<string[]> {
    const rows = await this.db.query<Row>(
      `SELECT body FROM public.issue_comments
       WHERE company_id = $1::uuid AND issue_id = $2::uuid AND deleted_at IS NULL
         AND (created_by_run_id = $3::uuid OR (author_agent_id = $4::uuid AND created_at >= coalesce($5::timestamptz, now() - interval '1 hour')))
       ORDER BY created_at ASC LIMIT 20`,
      [companyId, issueId, run.id, run.agentId, run.startedAt],
    );
    return rows.map((r) => str(r.body));
  }

  async getComment(companyId: string, commentId: string): Promise<CommentInfo | null> {
    const rows = await this.db.query<Row>(
      `SELECT id::text AS id, issue_id::text AS "issueId", author_type AS "authorType", author_user_id AS "authorUserId",
         author_agent_id::text AS "authorAgentId", body
       FROM public.issue_comments WHERE company_id = $1::uuid AND id = $2::uuid AND deleted_at IS NULL`,
      [companyId, commentId],
    );
    const r = rows[0];
    return r
      ? { id: str(r.id), issueId: str(r.issueId), authorType: strOrNull(r.authorType), authorUserId: strOrNull(r.authorUserId), authorAgentId: strOrNull(r.authorAgentId), body: str(r.body) }
      : null;
  }

  async labels(companyId: string, agentIds: string[], issueIds: string[]): Promise<Labels> {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const pick = (ids: string[]) => [...new Set(ids.filter((id) => uuid.test(id)))].slice(0, 50);
    const out: Labels = { agents: {}, issues: {} };
    const agents = pick(agentIds);
    if (agents.length) {
      const rows = await this.db.query<Row>(
        `SELECT id::text AS id, name FROM public.agents WHERE company_id = $1::uuid AND id IN (${agents.map((_, i) => `$${i + 2}::uuid`).join(", ")})`,
        [companyId, ...agents],
      );
      for (const r of rows) out.agents[str(r.id)] = str(r.name);
    }
    const issues = pick(issueIds);
    if (issues.length) {
      const rows = await this.db.query<Row>(
        `SELECT id::text AS id, identifier, title FROM public.issues WHERE company_id = $1::uuid AND id IN (${issues.map((_, i) => `$${i + 2}::uuid`).join(", ")})`,
        [companyId, ...issues],
      );
      for (const r of rows) out.issues[str(r.id)] = `${strOrNull(r.identifier) ?? str(r.id).slice(0, 8)} — ${str(r.title).slice(0, 60)}`;
    }
    return out;
  }

  async getIssue(companyId: string, issueId: string): Promise<IssueInfo | null> {
    const rows = await this.db.query<Row>(
      `SELECT id::text AS id, identifier, title, description, status, assignee_agent_id::text AS "assigneeAgentId", project_id::text AS "projectId"
       FROM public.issues WHERE company_id = $1::uuid AND id = $2::uuid`,
      [companyId, issueId],
    );
    const r = rows[0];
    return r
      ? { id: str(r.id), identifier: strOrNull(r.identifier), title: str(r.title), description: strOrNull(r.description), status: str(r.status), assigneeAgentId: strOrNull(r.assigneeAgentId), projectId: strOrNull(r.projectId) }
      : null;
  }

  async handoffComments(companyId: string, issueId: string, agentId: string | null): Promise<HandoffComment[]> {
    const rows = await this.db.query<Row>(
      `SELECT c.body, c.author_user_id AS "userId", a.name AS "agentName"
       FROM public.issue_comments c LEFT JOIN public.agents a ON a.id = c.author_agent_id
       WHERE c.company_id = $1::uuid AND c.issue_id = $2::uuid AND c.deleted_at IS NULL
         AND (c.author_agent_id IS NULL OR c.author_agent_id <> coalesce($3::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
       ORDER BY c.created_at DESC LIMIT 12`,
      [companyId, issueId, agentId],
    );
    return rows.reverse().map((r) => ({ authorLabel: r.agentName ? `Agen ${str(r.agentName)}` : "Board", body: str(r.body) }));
  }

  /**
   * Naive baseline = what a "dump the history" prompt would carry for the same knowledge:
   * this issue (title, description, whole thread) + the last 24 comments on the agent's other issues
   * (like the old chat HISTORY_LIMIT = 24). Only lengths are read, never content.
   */
  async naiveChars(companyId: string, issueId: string, agentId: string | null): Promise<number> {
    const rows = await this.db.query<Row>(
      `SELECT
         (SELECT coalesce(sum(length(i.title) + length(coalesce(i.description, ''))), 0) FROM public.issues i
            WHERE i.company_id = $1::uuid AND i.id = $2::uuid)::bigint AS issue,
         (SELECT coalesce(sum(length(c.body)), 0) FROM public.issue_comments c
            WHERE c.company_id = $1::uuid AND c.issue_id = $2::uuid AND c.deleted_at IS NULL)::bigint AS thread,
         (SELECT coalesce(sum(h.len), 0) FROM (SELECT length(c.body) AS len FROM public.issue_comments c JOIN public.issues i ON i.id = c.issue_id
            WHERE c.company_id = $1::uuid AND c.deleted_at IS NULL AND c.issue_id <> $2::uuid AND i.assignee_agent_id = $3::uuid
            ORDER BY c.created_at DESC LIMIT 24) h)::bigint AS history`,
      [companyId, issueId, agentId],
    );
    const r = rows[0] ?? {};
    return num(r.issue) + num(r.thread) + num(r.history);
  }

}
