import type { PluginApiRequestInput, PluginApiResponse, PluginContext, ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import { TOOLS } from "./manifest.js";
import { MemoryError, type MemoryService } from "./service.js";

const str = (v: unknown) => (typeof v === "string" ? v : "");
const RUN_END_EVENTS = ["agent.run.finished", "agent.run.failed", "agent.run.cancelled"] as const;

/** `?tools=a,b` → cleaned list (the caller reports the tools its gateway session shows). */
export function parseToolsQuery(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.join(",") : str(value);
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => /^[A-Za-z0-9._:-]{1,120}$/.test(t))
    .slice(0, 40);
}

function toolError(err: unknown): ToolResult {
  return { error: err instanceof Error ? err.message : String(err) };
}

export function registerMemory(ctx: PluginContext, service: MemoryService) {
  for (const type of RUN_END_EVENTS) {
    ctx.events.on(type, async (e) => {
      await service.onRunEnded(e.companyId, (e.payload ?? {}) as Parameters<MemoryService["onRunEnded"]>[1]);
    });
  }
  ctx.events.on("issue.comment.created", async (e) => {
    await service.onCommentCreated(e.companyId, e);
  });

  const tool = (name: (typeof TOOLS)[number]["name"]) => TOOLS.find((t) => t.name === name)!;

  ctx.tools.register("memory.get_context_bundle", tool("memory.get_context_bundle"), async (params: unknown, run: ToolRunContext) => {
    try {
      const p = (params ?? {}) as { issueId?: unknown };
      const issueId = str(p.issueId) || (await service.resolveRunIssue(run.companyId, run.runId));
      if (!issueId) return { error: "No issue for this run. Pass issueId." };
      const out = await service.buildContext({ companyId: run.companyId, issueId, agentId: run.agentId, runId: run.runId, via: "tool" });
      return { content: out.text, data: { issueId: out.issueId, meta: out.meta, savings: out.savings } };
    } catch (err) {
      return toolError(err);
    }
  });

  ctx.tools.register("memory.recall", tool("memory.recall"), async (params: unknown, run: ToolRunContext) => {
    try {
      const p = (params ?? {}) as { query?: unknown; limit?: unknown };
      const items = await service.recall({ companyId: run.companyId, agentId: run.agentId, query: str(p.query), limit: Number(p.limit) || 3 });
      const content = items.length ? items.map((i) => `- [${i.kind}/${i.tier}] ${i.body}`).join("\n") : "Tidak ada memori yang cocok.";
      return { content, data: { items: items.map((i) => ({ id: i.id, kind: i.kind, tier: i.tier, body: i.body })) } };
    } catch (err) {
      return toolError(err);
    }
  });

  ctx.tools.register("memory.create_note", tool("memory.create_note"), async (params: unknown, run: ToolRunContext) => {
    try {
      const p = (params ?? {}) as { text?: unknown; kind?: unknown };
      const r = await service.createAgentNote({ companyId: run.companyId, agentId: run.agentId, runId: run.runId, text: str(p.text), kind: str(p.kind) });
      const d = r.admission.decision;
      const content = r.duplicate
        ? "Catatan yang sama sudah tersimpan di run ini."
        : d === "reject"
          ? `Ditolak (${r.admission.reasons.join(", ")}). Simpan hanya satu fakta singkat, tanpa transkrip atau rahasia.`
          : d === "quarantine"
            ? "Disimpan ke karantina untuk ditinjau operator; tidak akan dipakai sebagai konteks."
            : "Disimpan sebagai catatan sementara (ephemeral) sampai disetujui board.";
      return { content, data: { decision: d, reasons: r.admission.reasons, itemId: r.itemId } };
    } catch (err) {
      return toolError(err);
    }
  });

  const data = (key: string, fn: (companyId: string, p: Record<string, unknown>) => Promise<unknown>) =>
    ctx.data.register(key, async (params) => {
      const companyId = str(params.companyId);
      if (!companyId) throw new Error("companyId is required");
      return fn(companyId, params);
    });
  data("issue-memory", (companyId, p) => service.issueView(companyId, str(p.issueId)));
  data("agent-memory", (companyId, p) => service.agentView(companyId, str(p.agentId)));
  data("memory-page", (companyId, p) => service.pageView(companyId, { q: str(p.q), tier: str(p.tier), scopeKind: str(p.scopeKind) }));
  data("savings", (companyId) => service.savings(companyId));

  const boardAction = (key: string, fn: (companyId: string, p: Record<string, unknown>, userId: string | null) => Promise<unknown>) =>
    ctx.actions.register(key, async (params, context) => {
      if (context?.actor?.type !== "user") throw new Error("Board user required");
      const companyId = str(params.companyId);
      if (!companyId) throw new Error("companyId is required");
      return fn(companyId, params, context.actor.userId ?? null);
    });
  boardAction("add-note", (companyId, p, userId) =>
    service.addBoardNote({ companyId, scopeKind: str(p.scopeKind), scopeId: str(p.scopeId), text: str(p.text), userId, pin: p.pin !== false }),
  );
  boardAction("set-pinned", (companyId, p) => service.setPinned(companyId, str(p.itemId), p.pinned === true));
  boardAction("promote", (companyId, p) => service.promote(companyId, str(p.itemId)));
  boardAction("forget", (companyId, p) => service.forget(companyId, str(p.itemId)));
  boardAction("preview-bundle", (companyId, p) => service.buildContext({ companyId, issueId: str(p.issueId), via: "preview" }));
}

export async function handleApiRequest(service: MemoryService, input: PluginApiRequestInput): Promise<PluginApiResponse> {
  try {
    if (input.routeKey !== "context") return { status: 404, body: { error: "Unknown route" } };
    const agentId = input.actor.agentId ?? null;
    if (input.actor.actorType !== "agent" || !agentId) return { status: 403, body: { error: "Agent access required" } };
    const out = await service.buildContext({
      companyId: input.companyId,
      issueId: str(input.params.issueId),
      agentId,
      runId: input.actor.runId ?? null,
      grantedTools: parseToolsQuery(input.query.tools),
      via: "route",
    });
    return { status: 200, body: out };
  } catch (err) {
    const status = err instanceof MemoryError ? err.status : 500;
    return { status, body: { error: err instanceof MemoryError ? err.message : "Memory context failed" } };
  }
}
