import { TEMPLATE_VERSION, TIMEZONE, type OfficeTemplate } from "./templates.js";

export interface AgentAdapter {
  type: string;
  config: Record<string, unknown>;
}

export interface BuildOptions {
  adapter: AgentAdapter;
  /** Existing agent the office head reports to; null makes the head top-level. */
  managerAgentId: string | null;
}

/** Adapters the core safe importer rejects (`IMPORT_FORBIDDEN_ADAPTER_TYPES`). */
export const UNSUPPORTED_ADAPTERS = new Set(["process", "http"]);

/** Bundle shape this package follows; unstamped bundles are read as an older shape and draw an import warning. */
export const BUNDLE_SCHEMA_VERSION = 7;

export const IMPORT_INCLUDE = { company: false, agents: true, projects: true, issues: true, skills: false } as const;

// The core portability parser understands a YAML subset: `key: value` lines whose value may be one-line JSON.
function frontmatter(fields: Record<string, unknown>, body: string) {
  const lines = Object.entries(fields).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `---\n${lines.join("\n")}\n---\n\n${body.trim()}\n`;
}

function extensionFile(fields: Record<string, unknown>) {
  return Object.entries(fields).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n") + "\n";
}

export function buildOfficePackage(template: OfficeTemplate, opts: BuildOptions): Record<string, string> {
  if (UNSUPPORTED_ADAPTERS.has(opts.adapter.type)) {
    throw new Error(`Adapter "${opts.adapter.type}" tidak bisa dipakai untuk import; pilih agent dengan mesin AI.`);
  }
  const slugs = new Set(template.agents.map((a) => a.slug));
  for (const a of template.agents) {
    if (a.reportsTo && !slugs.has(a.reportsTo)) throw new Error(`${template.key}: ${a.slug} melapor ke ${a.reportsTo} yang tidak ada`);
  }
  if (!slugs.has(template.routine.assignee)) throw new Error(`${template.key}: routine assignee ${template.routine.assignee} tidak ada`);
  const headSlug = template.agents.find((a) => a.reportsTo === null)?.slug;
  if (!headSlug) throw new Error(`${template.key}: tidak ada kepala office`);

  const metadata = { starnet: { officeTemplate: template.key, templateVersion: TEMPLATE_VERSION } };
  const files: Record<string, string> = {};

  files["COMPANY.md"] = frontmatter(
    { name: template.name, schema: "agentcompanies/v1", slug: `starnet-${template.key}-office`, description: template.summary },
    `# ${template.name}\n\n${template.summary}`,
  );
  for (const a of template.agents) {
    files[`agents/${a.slug}/AGENTS.md`] = frontmatter(
      { name: a.name, slug: a.slug, title: a.title, role: a.role, reportsTo: a.reportsTo },
      a.instructions,
    );
  }
  const p = template.project;
  files[`projects/${p.slug}/PROJECT.md`] = frontmatter({ name: p.name, slug: p.slug, description: p.description, owner: headSlug }, p.description);
  const r = template.routine;
  files[`projects/${p.slug}/tasks/${r.slug}/TASK.md`] = frontmatter(
    { name: r.name, slug: r.slug, assignee: r.assignee, project: p.slug, recurring: true },
    r.instructions,
  );

  const agents = Object.fromEntries(template.agents.map((a) => [a.slug, {
    adapter: { type: opts.adapter.type, config: opts.adapter.config },
    // Invariant: the factory drafts agents; tool grants and hiring rights come from the board later.
    permissions: { canCreateAgents: false, canCreateSkills: false },
    // Wake on assignment only, not on a timer, to keep token use proportional to real work.
    runtime: { heartbeat: { enabled: false } },
    ...(a.slug === headSlug && opts.managerAgentId ? { reportsToExistingAgentId: opts.managerAgentId } : {}),
    metadata,
  }]));
  files[".paperclip.yaml"] = extensionFile({
    schema: "paperclip/v1",
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    agents,
    routines: { [r.slug]: { triggers: [{ kind: "schedule", label: r.name, cronExpression: r.cronExpression, timezone: TIMEZONE }] } },
  });
  return files;
}

export interface ImportRequest {
  source: { type: "inline"; files: Record<string, string>; expectedFileCount: number };
  include: typeof IMPORT_INCLUDE;
  target: { mode: "existing_company"; companyId: string };
  collisionStrategy: "skip";
  pauseAutomations?: true;
}

/**
 * Re-installing skips agents/projects that already exist instead of duplicating them, and new agents/routines start
 * paused so the board consciously resumes them.
 */
export function importRequest(companyId: string, files: Record<string, string>, apply: boolean): ImportRequest {
  return {
    source: { type: "inline", files, expectedFileCount: Object.keys(files).length },
    include: IMPORT_INCLUDE,
    target: { mode: "existing_company", companyId },
    collisionStrategy: "skip",
    ...(apply ? { pauseAutomations: true as const } : {}),
  };
}
