import { describe, expect, it } from "vitest";
import { OFFICE_TEMPLATES, findTemplate } from "../src/templates.js";
import { buildOfficePackage, importRequest } from "../src/package-builder.js";

const adapter = { type: "codex_local", config: { model: "gpt-6-luna", env: { OPENAI_API_KEY: { type: "secret_ref", secretId: "s1" } } } };

/** Same subset the host parser accepts: `key: value` lines, value either a bare scalar or one-line JSON. */
function parseLines(raw: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const line of raw.split("\n").filter(Boolean)) {
    const i = line.indexOf(":");
    const value = line.slice(i + 1).trim();
    out[line.slice(0, i).trim()] = /^(["[{]|-?\d+$)/.test(value) || value === "null" || value === "true" ? JSON.parse(value) : value;
  }
  return out;
}

function frontmatter(md: string) {
  const m = /^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/.exec(md);
  if (!m) throw new Error("no frontmatter");
  return { fields: parseLines(m[1]!), body: m[2]! };
}

describe("office templates", () => {
  it("ships the four offices with exactly one head each and valid reporting lines", () => {
    expect(OFFICE_TEMPLATES.map((t) => t.key)).toEqual(["network", "software", "marketing", "finance"]);
    for (const t of OFFICE_TEMPLATES) {
      const slugs = new Set(t.agents.map((a) => a.slug));
      expect(slugs.size).toBe(t.agents.length);
      expect(t.agents.filter((a) => a.reportsTo === null)).toHaveLength(1);
      for (const a of t.agents) if (a.reportsTo) expect(slugs.has(a.reportsTo)).toBe(true);
      expect(t.routine.cronExpression.split(" ")).toHaveLength(5);
    }
  });

  it("keeps every template ASCII-safe for the single-line YAML values", () => {
    for (const t of OFFICE_TEMPLATES) expect(JSON.stringify(t)).toMatch(/^[\x20-\x7E]*$/);
  });
});

describe("buildOfficePackage", () => {
  const network = findTemplate("network")!;

  it("emits a COMPANY.md root, one AGENTS.md per agent, a project and a recurring task", () => {
    const files = buildOfficePackage(network, { adapter, managerAgentId: null });
    expect(Object.keys(files).sort()).toEqual([
      ".paperclip.yaml",
      "COMPANY.md",
      "agents/mikrotik-specialist/AGENTS.md",
      "agents/network-engineer/AGENTS.md",
      "agents/network-qa/AGENTS.md",
      "agents/noc-manager/AGENTS.md",
      "projects/network-office/PROJECT.md",
      "projects/network-office/tasks/weekly-network-report/TASK.md",
    ]);
    const qa = frontmatter(files["agents/network-qa/AGENTS.md"]!);
    expect(qa.fields).toEqual({ name: "Network QA", slug: "network-qa", title: "Network Quality Assurance", role: "qa", reportsTo: "noc-manager" });
    expect(qa.body).toContain("approval board");
    expect(frontmatter(files["agents/noc-manager/AGENTS.md"]!).fields.reportsTo).toBeNull();
    const task = frontmatter(files["projects/network-office/tasks/weekly-network-report/TASK.md"]!);
    expect(task.fields).toMatchObject({ assignee: "noc-manager", project: "network-office", recurring: true });
  });

  it("puts adapter, least-privilege permissions, no timer heartbeat and the schedule in .paperclip.yaml", () => {
    const ext = parseLines(buildOfficePackage(network, { adapter, managerAgentId: "11111111-1111-4111-8111-111111111111" })[".paperclip.yaml"]!);
    expect(ext.schema).toBe("paperclip/v1");
    expect(ext.schemaVersion).toBe(7);
    const agents = ext.agents as Record<string, Record<string, unknown>>;
    expect(Object.keys(agents)).toHaveLength(4);
    for (const entry of Object.values(agents)) {
      expect(entry.adapter).toEqual(adapter);
      expect(entry.permissions).toEqual({ canCreateAgents: false, canCreateSkills: false });
      expect(entry.runtime).toEqual({ heartbeat: { enabled: false } });
    }
    expect(agents["noc-manager"]!.reportsToExistingAgentId).toBe("11111111-1111-4111-8111-111111111111");
    expect(agents["network-qa"]!.reportsToExistingAgentId).toBeUndefined();
    expect(ext.routines).toEqual({
      "weekly-network-report": { triggers: [{ kind: "schedule", label: "Laporan mingguan jaringan", cronExpression: "0 8 * * 1", timezone: "Asia/Jakarta" }] },
    });
  });

  it("omits the existing-manager link when the head is top-level", () => {
    const ext = parseLines(buildOfficePackage(network, { adapter, managerAgentId: null })[".paperclip.yaml"]!);
    expect((ext.agents as Record<string, Record<string, unknown>>)["noc-manager"]!.reportsToExistingAgentId).toBeUndefined();
  });

  it("refuses adapters the safe importer rejects", () => {
    expect(() => buildOfficePackage(network, { adapter: { type: "process", config: {} }, managerAgentId: null })).toThrow(/tidak bisa dipakai/);
  });
});

describe("importRequest", () => {
  it("previews without pausing and applies with paused automations and skip-on-collision", () => {
    const files = { "COMPANY.md": "x", "agents/a/AGENTS.md": "y" };
    const preview = importRequest("c1", files, false);
    expect(preview).toEqual({
      source: { type: "inline", files, expectedFileCount: 2 },
      include: { company: false, agents: true, projects: true, issues: true, skills: false },
      target: { mode: "existing_company", companyId: "c1" },
      collisionStrategy: "skip",
    });
    expect(importRequest("c1", files, true).pauseAutomations).toBe(true);
  });
});
