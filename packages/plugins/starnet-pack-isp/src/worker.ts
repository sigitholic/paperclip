import { definePlugin, runWorker, type EnvSecretRefBinding, type PluginContext, type ToolResult, type ToolRunContext } from "@paperclipai/plugin-sdk";
import { assertGatewayRisk, packResult } from "@starnet/pack-kit";
import { DAILY_ROUTINE_KEY, NOC_AGENT_KEY, TOOLS } from "./manifest.js";
import { deviceStatus, listDevices, listPppoeActive, systemResource, type PackConfig, type ResolveSecret } from "./sources.js";

type ToolName = (typeof TOOLS)[number]["name"];
type Handler = (cfg: PackConfig, secret: ResolveSecret, p: Record<string, unknown>) => Promise<{ result: ToolResult; snapshot: Record<string, unknown> }>;

const num = (v: unknown, d: number) => (typeof v === "number" && v > 0 ? Math.floor(v) : d);

const handlers: Record<ToolName, Handler> = {
  "mikrotik.list_pppoe_active": async (cfg, secret, p) => {
    const { mode, sessions } = await listPppoeActive(cfg, secret);
    const shown = sessions.slice(0, num(p.limit, 50));
    return {
      result: packResult(mode, "mikrotik", `${sessions.length} active PPPoE sessions (showing ${shown.length})`, { total: sessions.length, sessions: shown }),
      snapshot: { pppoe: { mode, active: sessions.length } },
    };
  },
  "mikrotik.system_resource": async (cfg, secret) => {
    const { mode, resource: r } = await systemResource(cfg, secret);
    return {
      result: packResult(mode, "mikrotik", `${r.board} ${r.version}, CPU ${r.cpuLoadPct}%, memory ${r.memUsedPct}% of ${r.totalMemoryMb} MB, uptime ${r.uptime}`, { resource: r }),
      snapshot: { router: { mode, cpuLoadPct: r.cpuLoadPct, memUsedPct: r.memUsedPct, uptime: r.uptime, board: r.board } },
    };
  },
  "genieacs.list_devices": async (cfg, secret, p) => {
    const { mode, devices } = await listDevices(cfg, secret);
    const online = devices.filter((d) => d.online).length;
    const shown = (p.onlineOnly === true ? devices.filter((d) => d.online) : devices).slice(0, num(p.limit, 50));
    return {
      result: packResult(mode, "genieacs", `${online}/${devices.length} CPE online`, { total: devices.length, online, devices: shown }),
      snapshot: { cpe: { mode, total: devices.length, online } },
    };
  },
  "genieacs.device_status": async (cfg, secret, p) => {
    const id = typeof p.deviceId === "string" ? p.deviceId : "";
    if (!id) throw new Error("deviceId is required");
    const { mode, device } = await deviceStatus(cfg, secret, id);
    const summary = device ? `${device.id} is ${device.online ? "online" : "OFFLINE"} (last inform ${device.lastInform ?? "never"})` : `device ${id} not found`;
    return { result: packResult(mode, "genieacs", summary, { device }), snapshot: {} };
  },
};

const lastCheckKey = (companyId: string) => ({ scopeKind: "company" as const, scopeId: companyId, stateKey: "last-check" });

async function recordSnapshot(ctx: PluginContext, companyId: string, snapshot: Record<string, unknown>) {
  if (!Object.keys(snapshot).length) return;
  const prev = ((await ctx.state.get(lastCheckKey(companyId))) ?? {}) as Record<string, unknown>;
  await ctx.state.set(lastCheckKey(companyId), { ...prev, ...snapshot, checkedAt: new Date().toISOString() });
}

function companyIdOf(params: Record<string, unknown>): string {
  if (typeof params.companyId !== "string" || !params.companyId) throw new Error("companyId is required");
  return params.companyId;
}

const plugin = definePlugin({
  async setup(ctx) {
    for (const tool of TOOLS) {
      assertGatewayRisk(tool.name, "read"); // fail fast if a rename would change gateway classification
      ctx.tools.register(tool.name, tool, async (params: unknown, run: ToolRunContext) => {
        const cfg = (await ctx.config.get(run.companyId)) as PackConfig;
        const secret: ResolveSecret = (ref, configPath) => ctx.secrets.resolve(ref as EnvSecretRefBinding, { companyId: run.companyId, configPath });
        try {
          const { result, snapshot } = await handlers[tool.name](cfg, secret, (params ?? {}) as Record<string, unknown>);
          await recordSnapshot(ctx, run.companyId, snapshot);
          return result;
        } catch (err) {
          return { error: `${tool.name} failed: ${err instanceof Error ? err.message : String(err)}` };
        }
      });
    }

    ctx.data.register("last-check", async (params) => (await ctx.state.get(lastCheckKey(companyIdOf(params)))) ?? null);

    // Materialize the NOC Engineer agent + Daily PPPoE routine for a company (idempotent).
    ctx.actions.register("setup", async (params) => {
      const companyId = companyIdOf(params);
      const agent = await ctx.agents.managed.reconcile(NOC_AGENT_KEY, companyId);
      const routine = await ctx.routines.managed.reconcile(DAILY_ROUTINE_KEY, companyId);
      return { agent, routine };
    });

    ctx.actions.register("run-daily-check", async (params) => ctx.routines.managed.run(DAILY_ROUTINE_KEY, companyIdOf(params)));
  },

  async onHealth() {
    return { status: "ok", message: "Starnet ISP pack ready" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
