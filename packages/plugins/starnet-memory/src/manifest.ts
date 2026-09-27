import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

export const PLUGIN_ID = "starnet.memory";
export const PAGE_ROUTE = "memory";
export const STREAM = "memory";

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });

/**
 * Agent tools. Names follow the gateway risk heuristic (name-based): the two readers are `read`,
 * `memory.create_note` contains "create" so the gateway classifies it as `write`.
 */
export const TOOLS = [
  {
    name: "memory.get_context_bundle",
    displayName: "Memory: curated context bundle",
    description:
      "Returns the curated context for the current issue: task brief, handoff, granted tools, L1 session summary, pins and related memory, within a fixed character budget. Call once at the start of a run instead of re-reading the whole thread.",
    parametersSchema: obj({ issueId: { type: "string", description: "Optional. Defaults to the issue of the current run." } }),
  },
  {
    name: "memory.recall",
    displayName: "Memory: recall",
    description: "Full-text search over admitted company/agent memory (never quarantined items). Returns at most 5 short items.",
    parametersSchema: obj({ query: { type: "string" }, limit: { type: "number", description: "1-5, default 3." } }, ["query"]),
  },
  {
    name: "memory.create_note",
    displayName: "Memory: create note",
    description:
      "Save one short decision or lesson for future runs (agent scope, stored as ephemeral until a board user promotes it). Only for real decisions/lessons; never paste transcripts or secrets (they are rejected).",
    parametersSchema: obj(
      {
        text: { type: "string", description: "One fact, max 1200 chars." },
        kind: { type: "string", enum: ["note", "decision", "lesson", "failure"] },
      },
      ["text"],
    ),
  },
] as const;

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Starnet Memory",
  description:
    "Curated, token-efficient memory for agents: L1 session summaries per agent and issue, board pins, admission filter (anti-poisoning, secret scrub, no transcripts) and a budgeted context bundle via tool or agent API route. Memory UI included.",
  author: "Starnet",
  categories: ["automation", "ui"],
  capabilities: [
    "events.subscribe",
    "issues.read",
    "issue.comments.read",
    "agents.read",
    "database.namespace.migrate",
    "database.namespace.read",
    "database.namespace.write",
    "api.routes.register",
    "agent.tools.register",
    "ui.page.register",
    "ui.sidebar.register",
    "ui.detailTab.register",
    "ui.dashboardWidget.register",
  ],
  entrypoints: { worker: "./dist/worker.js", ui: "./dist/ui" },
  database: {
    namespaceSlug: "starnet_memory",
    migrationsDir: "migrations",
    coreReadTables: ["companies", "agents", "issues", "issue_comments", "heartbeat_runs"],
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      defaultGrantedTools: {
        type: "array",
        items: { type: "string" },
        description: "Tool names listed in the bundle when the caller does not report its gateway tool list (?tools=…).",
      },
    },
  },
  tools: TOOLS.map((t) => ({ ...t })),
  apiRoutes: [
    {
      routeKey: "context",
      method: "GET",
      path: "/context/:issueId",
      auth: "agent",
      capability: "api.routes.register",
      checkoutPolicy: "required-for-agent-in-progress",
      companyResolution: { from: "issue", param: "issueId" },
    },
  ],
  ui: {
    slots: [
      { type: "page", id: "memory-page", displayName: "Memory", exportName: "MemoryPage", routePath: PAGE_ROUTE },
      { type: "sidebar", id: "memory-link", displayName: "Memory", exportName: "MemorySidebarLink" },
      { type: "detailTab", id: "memory-issue-tab", displayName: "Memori", exportName: "IssueMemoryTab", entityTypes: ["issue"] },
      { type: "detailTab", id: "memory-agent-tab", displayName: "Memori", exportName: "AgentMemoryTab", entityTypes: ["agent"] },
      { type: "dashboardWidget", id: "memory-savings-widget", displayName: "Memori: hemat konteks", exportName: "MemorySavingsWidget" },
    ],
  },
};

export default manifest;
