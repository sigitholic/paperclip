import { randomUUID } from "node:crypto";
import { definePlugin, runWorker, type PluginContext } from "@paperclipai/plugin-sdk";
import { serialByKey } from "@starnet/pack-kit";
import { STREAM } from "./manifest.js";
import { handleApiRequest, registerMemory } from "./register.js";
import { createMemoryService, type MemoryService } from "./service.js";
import { SqlCoreReader, SqlMemoryStore } from "./sql-store.js";

let service: MemoryService | null = null;

const plugin = definePlugin({
  async setup(ctx: PluginContext) {
    const serial = serialByKey();
    service = createMemoryService({
      store: new SqlMemoryStore(ctx.db),
      core: new SqlCoreReader(ctx.db),
      newId: randomUUID,
      now: () => new Date().toISOString(),
      serial,
      emit: (companyId, event) => {
        ctx.streams.open(STREAM, companyId);
        ctx.streams.emit(STREAM, event);
      },
      defaultGrantedTools: async (companyId) => {
        const cfg = await ctx.config.get(companyId).catch(() => ({}) as Record<string, unknown>);
        return Array.isArray(cfg.defaultGrantedTools) ? cfg.defaultGrantedTools.filter((t): t is string => typeof t === "string") : [];
      },
    });
    registerMemory(ctx, service);
  },
  async onApiRequest(input) {
    if (!service) return { status: 503, body: { error: "Memory not ready" } };
    return handleApiRequest(service, input);
  },
  async onHealth() {
    return { status: "ok", message: "Starnet Memory ready" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
