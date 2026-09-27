import { definePlugin, runWorker, type PluginContext, type PluginEvent } from "@paperclipai/plugin-sdk";
import { serialByKey } from "@starnet/pack-kit";
import { applyEvent, deriveDesk, type PresenceMap } from "./presence.js";

export const STREAM = "office";
const EVENTS = ["agent.run.started", "agent.run.finished", "agent.run.failed", "agent.run.cancelled", "issue.checked_out", "issue.comment.created"] as const;
const LOG_SIZE = 30;

interface OfficeState { presence: PresenceMap; log: Array<{ at: string; eventType: string; agentId: string; issueId: string | null }> }
const key = (companyId: string) => ({ scopeKind: "company" as const, scopeId: companyId, stateKey: "office" });

const plugin = definePlugin({
  async setup(ctx: PluginContext) {
    const serial = serialByKey();
    const load = async (companyId: string) => ((await ctx.state.get(key(companyId))) as OfficeState | null) ?? { presence: {}, log: [] };

    const onEvent = (e: PluginEvent) => serial(e.companyId, async () => {
      const agentId = (e.payload as { agentId?: unknown } | null)?.agentId;
      if (typeof agentId !== "string" || !agentId) return; // only agent-attributed events move a desk
      const st = await load(e.companyId);
      const presence = applyEvent(st.presence, e);
      if (presence === st.presence) return;
      const issueId = (e.payload as { issueId?: string }).issueId ?? (e.entityType === "issue" ? e.entityId ?? null : null);
      const log = [...st.log, { at: e.occurredAt, eventType: e.eventType, agentId, issueId }].slice(-LOG_SIZE);
      await ctx.state.set(key(e.companyId), { presence, log });
      ctx.streams.open(STREAM, e.companyId);
      ctx.streams.emit(STREAM, { type: "office.changed", agentId, eventType: e.eventType, at: e.occurredAt });
    });
    for (const type of EVENTS) ctx.events.on(type, onEvent);

    ctx.data.register("office", async (params) => {
      const companyId = typeof params.companyId === "string" ? params.companyId : "";
      if (!companyId) throw new Error("companyId is required");
      const [agents, st] = await Promise.all([ctx.agents.list({ companyId }), load(companyId)]);
      const desks = await Promise.all(agents.map(async (a) => {
        const desk = deriveDesk(a, st.presence[a.id]);
        const issue = desk.issueId ? await ctx.issues.get(desk.issueId, companyId) : null;
        return { ...desk, issue: issue ? { id: issue.id, identifier: issue.identifier, title: issue.title } : null };
      }));
      const count = (state: string) => desks.filter((d) => d.state === state).length;
      return { generatedAt: new Date().toISOString(), counts: { total: desks.length, busy: count("busy"), idle: count("idle"), paused: count("paused"), error: count("error") }, desks, log: st.log.slice(-10) };
    });
  },
  async onHealth() {
    return { status: "ok", message: "Virtual Office ready" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
