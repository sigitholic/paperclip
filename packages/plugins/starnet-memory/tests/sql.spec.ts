import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// Host validators (read-only import from Paperclip core; we never modify core).
import {
  derivePluginDatabaseNamespace,
  validatePluginMigrationStatement,
  validatePluginRuntimeExecute,
  validatePluginRuntimeQuery,
} from "../../../../server/src/services/plugin-database.js";
import manifest from "../src/manifest.js";
import { ftsQuery, SqlCoreReader, SqlMemoryStore } from "../src/sql-store.js";
import { AGENT_L1_ISSUE } from "../src/types.js";

const NS = derivePluginDatabaseNamespace(manifest.id, manifest.database!.namespaceSlug);
const CORE = manifest.database!.coreReadTables!;
const ID = "11111111-1111-4111-8111-111111111111";

function split(sql: string): string[] {
  return sql.split(/;\s*$/m).map((s) => s.trim()).filter((s) => s.replace(/--.*$/gm, "").trim());
}

/** Records every statement and checks it with the same validator the host runs. */
function recordingDb() {
  const queries: string[] = [];
  const executes: string[] = [];
  const db = {
    namespace: NS,
    async query(sql: string, params: unknown[] = []) {
      validatePluginRuntimeQuery(sql, NS, CORE);
      expect(Math.max(0, ...[...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])))).toBe(params.length);
      queries.push(sql);
      return [];
    },
    async execute(sql: string, params: unknown[] = []) {
      validatePluginRuntimeExecute(sql, NS);
      expect(Math.max(0, ...[...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])))).toBe(params.length);
      executes.push(sql);
      return { rowCount: 1 };
    },
  };
  return { db, queries, executes };
}

describe("plugin SQL passes the host's validators", () => {
  it("migration uses the host-derived namespace and only allowed statements", () => {
    const sql = readFileSync(new URL("../migrations/001_starnet_memory.sql", import.meta.url), "utf8");
    expect(NS).toBe("plugin_starnet_memory_94b82c7db8");
    const statements = split(sql);
    expect(statements.length).toBe(9);
    for (const s of statements) validatePluginMigrationStatement(s, NS, CORE);
  });

  it("every runtime query and write", async () => {
    const { db, queries, executes } = recordingDb();
    const store = new SqlMemoryStore(db);
    const core = new SqlCoreReader(db);
    await store.insertItem(ID, { id: ID, scopeKind: "agent", scopeId: ID, kind: "pin", tier: "curated", body: "x", pinned: true, reasons: [], sourceKind: "ui", sourceId: ID, createdByType: "board", createdById: null });
    await store.getItem(ID, ID);
    await store.listItems(ID, { limit: 5 });
    await store.listItems(ID, { scopes: [{ kind: "issue", id: ID }, { kind: "company", id: ID }], tiers: ["curated", "ephemeral"], kinds: ["decision"], pinned: false, query: "router POP Sleman", limit: 3 });
    expect(await store.listItems(ID, { query: "!!", limit: 3 })).toEqual([]);
    await store.updateItem(ID, ID, { pinned: true, tier: "curated" });
    expect(await store.updateItem(ID, ID, {})).toBe(false);
    await store.deleteItem(ID, ID);
    await store.tierCounts(ID);
    await store.getL1(ID, ID, AGENT_L1_ISSUE);
    await store.upsertL1(ID, { agentId: ID, issueId: ID, summary: "s", pinIds: [], runCount: 1, lastRunId: ID, updatedAt: null, flags: [] });
    await store.listL1(ID, { agentId: ID, issueId: ID, limit: 5 });
    await store.logBundle(ID, { id: ID, issueId: ID, agentId: ID, runId: null, via: "route", sections: [], chars: 1, estTokens: 1, naiveChars: 2, naiveTokens: 1, bundleText: "b", createdAt: "" });
    await store.listBundles(ID, { issueId: ID, agentId: ID, limit: 1 });
    expect(await store.bundleStats(ID)).toEqual({ count: 0, avgChars: 0, avgNaiveChars: 0, avgTokens: 0, avgNaiveTokens: 0 });
    await store.logAdmission(ID, { id: ID, sourceKind: "comment", sourceId: ID, scopeKind: "agent", scopeId: ID, decision: "reject", reasons: [], itemId: null, createdAt: "" });
    await store.listAdmissions(ID, { scopes: [{ kind: "agent", id: ID }], limit: 5 });
    expect(await core.getRun(ID, ID)).toBeNull();
    await core.runComments(ID, ID, { id: ID, agentId: ID, status: "succeeded", error: null, issueId: ID, startedAt: null, finishedAt: null });
    expect(await core.getComment(ID, ID)).toBeNull();
    expect(await core.getIssue(ID, ID)).toBeNull();
    await core.handoffComments(ID, ID, null);
    expect(await core.naiveChars(ID, ID, ID)).toBe(0);
    expect(await core.labels(ID, [ID, ID, "not-a-uuid"], [ID])).toEqual({ agents: {}, issues: {} });
    expect(await core.labels(ID, [], [])).toEqual({ agents: {}, issues: {} });
    expect(queries.length).toBe(17);
    expect(executes.length).toBe(6);
  });

  it("rejects an unexpected namespace and builds safe FTS queries", () => {
    expect(() => new SqlMemoryStore({ namespace: "public; drop", query: async () => [], execute: async () => ({ rowCount: 0 }) })).toThrow();
    expect(ftsQuery("Router POP Sleman & 'x' | ! a")).toBe("router | pop | sleman");
    expect(ftsQuery("")).toBe("");
  });
});
