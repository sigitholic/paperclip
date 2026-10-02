import { definePlugin, runWorker, type EnvSecretRefBinding, type PluginContext, type ToolResult, type ToolRunContext } from "@paperclipai/plugin-sdk";
import { assertGatewayRisk, packResult } from "@starnet/pack-kit";
import { DAILY_ROUTINE_KEY, NOC_AGENT_KEY, NOC_LLM_AGENT_KEY, NOC_QA_AGENT_KEY, TOOLS } from "./manifest.js";
import {
  deviceStatus,
  genieacsMode,
  listDevices,
  listPppoeActive,
  mikrotikEndpoint,
  mikrotikMode,
  mikrotikRouters,
  systemResource,
  type PackConfig,
  type ResolveSecret,
  type RouterOutcome,
} from "./sources.js";

type ToolName = (typeof TOOLS)[number]["name"];
type Handler = (cfg: PackConfig, secret: ResolveSecret, p: Record<string, unknown>) => Promise<{ result: ToolResult; snapshot: Record<string, unknown> }>;

const num = (v: unknown, d: number) => (typeof v === "number" && v > 0 ? Math.floor(v) : d);
const routerParam = (p: Record<string, unknown>) => (typeof p.router === "string" && p.router.trim() ? p.router.trim() : undefined);
const unreachable = (outcomes: RouterOutcome<unknown>[]) =>
  outcomes.flatMap((o) => (o.ok ? [] : [`${o.router} UNREACHABLE (${o.error})`]));

const handlers: Record<ToolName, Handler> = {
  "mikrotik.list_routers": async (cfg) => {
    const routers = mikrotikRouters(cfg).map((r) => ({ name: r.name, host: r.host, ...mikrotikEndpoint(r) }));
    const summary = routers.length
      ? `${routers.length} router(s): ${routers.map((r) => `${r.name} ${r.host}:${r.port} ${r.protocol}${r.tls ? "+tls" : ""}`).join(", ")}`
      : "no router configured";
    return { result: packResult(mikrotikMode(cfg), "mikrotik", summary, { routers }), snapshot: {} };
  },
  "mikrotik.list_pppoe_active": async (cfg, secret, p) => {
    const router = routerParam(p);
    const { mode, sessions, routers } = await listPppoeActive(cfg, secret, router);
    const shown = sessions.slice(0, num(p.limit, 50));
    const perRouter = routers.map((o) => (o.ok ? { router: o.router, host: o.host, ok: true, total: o.value } : { router: o.router, host: o.host, ok: false, error: o.error }));
    const parts = [`${sessions.length} active PPPoE sessions on ${routers.length} router(s) (showing ${shown.length})`];
    if (routers.length > 1) parts.push(routers.flatMap((o) => (o.ok ? [`${o.router} ${o.value}`] : [])).join(", "));
    parts.push(...unreachable(routers));
    return {
      result: packResult(mode, "mikrotik", parts.join("; "), { total: sessions.length, sessions: shown, routers: perRouter }),
      // A single-router query must not overwrite the fleet totals the widget shows.
      snapshot: router ? {} : { pppoe: { mode, active: sessions.length, routers: perRouter } },
    };
  },
  "mikrotik.system_resource": async (cfg, secret, p) => {
    const router = routerParam(p);
    const { mode, routers } = await systemResource(cfg, secret, router);
    const ok = routers.flatMap((o) => (o.ok ? [{ router: o.router, ...o.value }] : []));
    const first = ok[0]!;
    const lines = routers.map((o) =>
      o.ok
        ? `${o.router}: ${o.value.board} ${o.value.version}, CPU ${o.value.cpuLoadPct}%, memory ${o.value.memUsedPct}% of ${o.value.totalMemoryMb} MB, uptime ${o.value.uptime}`
        : `${o.router}: UNREACHABLE (${o.error})`,
    );
    const perRouter = routers.map((o) => (o.ok ? { router: o.router, host: o.host, ok: true, resource: o.value } : { router: o.router, host: o.host, ok: false, error: o.error }));
    return {
      result: packResult(mode, "mikrotik", lines.join("\n"), { resource: first, routers: perRouter }),
      snapshot: router
        ? {}
        : {
            router: {
              mode,
              cpuLoadPct: Math.max(...ok.map((r) => r.cpuLoadPct)),
              memUsedPct: Math.max(...ok.map((r) => r.memUsedPct)),
              uptime: first.uptime,
              board: first.board,
              total: routers.length,
              unreachable: routers.filter((o) => !o.ok).map((o) => o.router),
            },
          },
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

    // Materialize the NOC agents + Daily PPPoE routine for a company (idempotent).
    ctx.actions.register("setup", async (params) => {
      const companyId = companyIdOf(params);
      const agent = await ctx.agents.managed.reconcile(NOC_AGENT_KEY, companyId);
      const llmAgent = await ctx.agents.managed.reconcile(NOC_LLM_AGENT_KEY, companyId);
      const qaAgent = await ctx.agents.managed.reconcile(NOC_QA_AGENT_KEY, companyId);
      let routine = await ctx.routines.managed.reconcile(DAILY_ROUTINE_KEY, companyId);
      // The routine outlives a terminated NOC agent and reconcile leaves its assignee alone.
      if (agent.agentId && routine.routine && routine.routine.assigneeAgentId !== agent.agentId) {
        routine = await ctx.routines.managed.reset(DAILY_ROUTINE_KEY, companyId);
      }
      return { agent, llmAgent, qaAgent, routine };
    });

    ctx.actions.register("run-daily-check", async (params) => ctx.routines.managed.run(DAILY_ROUTINE_KEY, companyIdOf(params)));

    // Settings page "Test connections": checks the saved config, one result per source.
    ctx.actions.register("test-connections", async (params) => {
      const companyId = companyIdOf(params);
      const cfg = ((await ctx.config.get(companyId)) ?? {}) as PackConfig;
      const secret: ResolveSecret = (ref, configPath) => ctx.secrets.resolve(ref as EnvSecretRefBinding, { companyId, configPath });
      const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
      let names: string[];
      try {
        names = mikrotikRouters(cfg).map((r) => r.name);
      } catch (err) {
        return { routers: [], genieacs: null, error: message(err) };
      }
      const routers = await Promise.all(
        names.map(async (name) => {
          try {
            const [o] = (await systemResource(cfg, secret, name)).routers;
            return o?.ok
              ? { name, ok: true, summary: `${o.value.board} RouterOS ${o.value.version}, CPU ${o.value.cpuLoadPct}%` }
              : { name, ok: false, error: o?.ok === false ? o.error : "no result" };
          } catch (err) {
            const m = message(err);
            return { name, ok: false, error: m.startsWith(`${name}: `) ? m.slice(name.length + 2) : m };
          }
        }),
      );
      let genieacs: { ok: boolean; summary?: string; error?: string } | null = null;
      if (genieacsMode(cfg) === "live") {
        try {
          const { devices } = await listDevices(cfg, secret);
          genieacs = { ok: true, summary: `${devices.filter((d) => d.online).length}/${devices.length} CPE online` };
        } catch (err) {
          genieacs = { ok: false, error: message(err) };
        }
      }
      return { routers, genieacs };
    });
  },

  async onHealth() {
    return { status: "ok", message: "Starnet ISP pack ready" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
