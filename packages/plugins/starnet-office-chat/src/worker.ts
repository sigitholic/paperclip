import { randomUUID } from "node:crypto";
import { definePlugin, runWorker, type PluginContext, type PluginEvent } from "@paperclipai/plugin-sdk";
import { serialByKey } from "@starnet/pack-kit";
import { keywordRouter, type ChatRouter } from "./router.js";
import { append, emptyThread, runNote, syncIssue, taskBrief, track, type ChatMessage, type Thread } from "./thread.js";

export const STREAM = "chat";
const RUN_EVENTS = ["agent.run.started", "agent.run.finished", "agent.run.failed", "agent.run.cancelled"] as const;
const INACTIVE = new Set(["terminated", "pending_approval"]);

const threadKey = (companyId: string) => ({ scopeKind: "company" as const, scopeId: companyId, stateKey: "thread" });
const str = (v: unknown) => (typeof v === "string" ? v : "");
const msg = (role: ChatMessage["role"], text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id: randomUUID(), at: new Date().toISOString(), role, text, ...extra });

/** Swap `router` for an LLM-backed ChatRouter later; nothing else changes. */
export function createOfficeChat(router: ChatRouter = keywordRouter) {
  return definePlugin({
    async setup(ctx: PluginContext) {
      const serial = serialByKey();
      const load = async (companyId: string) => ((await ctx.state.get(threadKey(companyId))) as Thread | null) ?? emptyThread();
      const save = async (companyId: string, t: Thread) => {
        await ctx.state.set(threadKey(companyId), t);
        ctx.streams.open(STREAM, companyId);
        ctx.streams.emit(STREAM, { type: "thread.changed", at: new Date().toISOString() });
      };

      async function syncTracked(companyId: string, issueId: string, t: Thread): Promise<Thread> {
        if (!t.tracked[issueId]) return t;
        const [issue, comments] = await Promise.all([ctx.issues.get(issueId, companyId), ctx.issues.listComments(issueId, companyId)]);
        return syncIssue(t, issueId, issue, comments, randomUUID);
      }

      ctx.actions.register("send", async (params) => {
        const companyId = str(params.companyId);
        const text = str(params.text).trim().slice(0, 2000);
        if (!companyId) throw new Error("companyId is required");
        if (!text) throw new Error("text is required");
        return serial(companyId, async () => {
          const operator = msg("operator", text);
          let t = append(await load(companyId), operator);
          const agents = (await ctx.agents.list({ companyId })).filter((a) => !INACTIVE.has(a.status));
          const decision = await router({ text, agents });
          const agent = decision.kind === "task" ? agents.find((a) => a.id === decision.agentId) : undefined;
          if (decision.kind === "task" && agent) {
            // Paperclip-native task layer: issue + assignment + wake. The agent sees only this request.
            const issue = await ctx.issues.create({ companyId, title: decision.title, description: taskBrief(text), assigneeAgentId: agent.id, status: "todo", priority: "medium", originId: operator.id });
            await ctx.issues.requestWakeup(issue.id, companyId, { reason: "office_chat_request", idempotencyKey: `office-chat:${operator.id}` });
            t = track(t, issue.id, { messageId: operator.id, agentId: agent.id, agentName: agent.name, identifier: issue.identifier ?? null });
            t = append(t, msg("office", `Siap. Saya buat ${issue.identifier ?? "issue baru"} untuk ${agent.name} (${decision.reason}).`, { issueId: issue.id, issueIdentifier: issue.identifier, agentId: agent.id, agentName: agent.name }));
          } else {
            t = append(t, msg("office", decision.kind === "reply" ? decision.text : "Agen tujuan tidak aktif."));
          }
          await save(companyId, t);
          return { messages: t.messages.slice(-2) };
        });
      });

      ctx.data.register("thread", async (params) => {
        const companyId = str(params.companyId);
        if (!companyId) throw new Error("companyId is required");
        return { messages: (await load(companyId)).messages };
      });

      const onIssue = (e: PluginEvent) => serial(e.companyId, async () => {
        const before = await load(e.companyId);
        const after = await syncTracked(e.companyId, e.entityId ?? "", before);
        if (after !== before) await save(e.companyId, after);
      });
      ctx.events.on("issue.comment.created", onIssue);
      ctx.events.on("issue.updated", onIssue);

      for (const type of RUN_EVENTS) {
        ctx.events.on(type, (e) => serial(e.companyId, async () => {
          const payload = (e.payload ?? {}) as { issueId?: string | null; error?: string | null };
          const before = await load(e.companyId);
          if (!payload.issueId || !before.tracked[payload.issueId]) return;
          const note = runNote(before, type, payload, randomUUID);
          const after = await syncTracked(e.companyId, payload.issueId, note ? append(before, note) : before);
          if (after !== before) await save(e.companyId, after);
        }));
      }
    },
    async onHealth() {
      return { status: "ok", message: "Office Chat ready" };
    },
  });
}

const plugin = createOfficeChat();
export default plugin;
runWorker(plugin, import.meta.url);
