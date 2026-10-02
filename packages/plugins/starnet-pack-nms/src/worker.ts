import {
  definePlugin,
  runWorker,
  type EnvSecretRefBinding,
  type PluginContext,
  type PluginWebhookInput,
  type ToolResult,
  type ToolRunContext,
} from "@paperclipai/plugin-sdk";
import { assertGatewayRisk, packResult, serialByKey } from "@starnet/pack-kit";
import { handleAlert, MAX_EVENTS_PER_DELIVERY, openAlertSummary, parseAlert, signatureMatches, tokenMatches, type AlertOutcome } from "./alerts.js";
import { ALERT_WEBHOOK_KEY, TOOLS } from "./manifest.js";
import { isSeverity, SEVERITIES, severityRank, type PackConfig, type Severity } from "./model.js";
import { listHosts, listProblems, nmsMode, nmsSources, type ResolveSecret, type SourceOutcome } from "./sources.js";

type ToolName = (typeof TOOLS)[number]["name"];
type Handler = (cfg: PackConfig, secret: ResolveSecret, p: Record<string, unknown>) => Promise<ToolResult>;

const num = (v: unknown, d: number) => (typeof v === "number" && v > 0 ? Math.floor(v) : d);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const unreachable = (outcomes: SourceOutcome<unknown>[]) => outcomes.flatMap((o) => (o.ok ? [] : [`${o.source} UNREACHABLE (${o.error})`]));
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

const handlers: Record<ToolName, Handler> = {
  "nms.list_sources": async (cfg) => {
    const sources = nmsSources(cfg).map(({ name, kind, baseUrl }) => ({ name, kind, baseUrl }));
    const summary = sources.length ? `${sources.length} source(s): ${sources.map((s) => `${s.name} (${s.kind}) ${s.baseUrl}`).join(", ")}` : "no NMS source configured";
    return packResult(nmsMode(cfg), "nms", summary, { sources });
  },
  "nms.list_problems": async (cfg, secret, p) => {
    const min: Severity = isSeverity(p.minSeverity) ? p.minSeverity : "info";
    const { mode, sources } = await listProblems(cfg, secret, { source: str(p.source) });
    const all = sources
      .flatMap((o) => (o.ok ? o.value : []))
      .filter((x) => severityRank(x.severity) >= severityRank(min))
      .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || String(b.since ?? "").localeCompare(String(a.since ?? "")));
    const shown = all.slice(0, num(p.limit, 50));
    const bySeverity = Object.fromEntries([...SEVERITIES].reverse().map((s) => [s, all.filter((x) => x.severity === s).length]));
    const parts = [
      `${all.length} active problem(s) on ${sources.length} source(s)`,
      Object.entries(bySeverity).filter(([, n]) => n).map(([s, n]) => `${s} ${n}`).join(", ") || "none",
      ...unreachable(sources),
    ];
    const perSource = sources.map((o) => (o.ok ? { source: o.source, ok: true, total: o.value.length } : { source: o.source, ok: false, error: o.error }));
    return packResult(mode, "nms", parts.join("; "), { total: all.length, bySeverity, problems: shown, sources: perSource });
  },
  "nms.host_status": async (cfg, secret, p) => {
    const query = str(p.query)?.toLowerCase();
    const { mode, sources } = await listHosts(cfg, secret, { source: str(p.source) });
    const all = sources.flatMap((o) => (o.ok ? o.value : []));
    const matched = all.filter((h) => (!query || h.name.toLowerCase().includes(query) || (h.address ?? "").toLowerCase().includes(query)) && (p.onlyDown !== true || h.status === "down"));
    const count = (s: string) => all.filter((h) => h.status === s).length;
    const parts = [
      `${all.length} host(s): up ${count("up")}, down ${count("down")}, unknown ${count("unknown")}, disabled ${count("disabled")}`,
      ...(query || p.onlyDown === true ? [`${matched.length} match`] : []),
      ...unreachable(sources),
    ];
    const perSource = sources.map((o) => (o.ok ? { source: o.source, ok: true, total: o.value.length } : { source: o.source, ok: false, error: o.error }));
    return packResult(mode, "nms", parts.join("; "), {
      total: all.length,
      down: count("down"),
      hosts: matched.slice(0, num(p.limit, 50)),
      sources: perSource,
    });
  },
};

function header(headers: Record<string, string | string[]>, name: string): string | undefined {
  const entry = Object.entries(headers).find(([k]) => k.toLowerCase() === name);
  const v = Array.isArray(entry?.[1]) ? entry[1][0] : entry?.[1];
  return v?.trim() || undefined;
}

let pluginCtx: PluginContext | null = null;
const perCompany = serialByKey();

export async function receiveAlerts(ctx: PluginContext, input: PluginWebhookInput): Promise<Record<AlertOutcome | "invalid", number>> {
  if (input.endpointKey !== ALERT_WEBHOOK_KEY) throw new Error(`unknown webhook ${input.endpointKey}`);
  const companyId = header(input.headers, "x-starnet-company");
  const signature = header(input.headers, "x-starnet-signature");
  const given = header(input.headers, "x-starnet-token") ?? header(input.headers, "authorization")?.replace(/^Bearer\s+/i, "");
  if (!companyId || (!signature && !given)) throw new Error("x-starnet-company and x-starnet-signature (or x-starnet-token) headers are required");
  // Outside an invocation the host only admits companies that saved this plugin's config.
  let cfg: PackConfig;
  try {
    if (!(await ctx.companies.get(companyId))) throw new Error("not found");
    cfg = ((await ctx.config.get(companyId)) ?? {}) as PackConfig;
  } catch {
    throw new Error("unknown company or NMS pack not configured for it");
  }
  if (!cfg.webhookToken) throw new Error("NMS webhook is not enabled for this company (set webhookToken)");
  const expected = await ctx.secrets.resolve(cfg.webhookToken as EnvSecretRefBinding, { companyId, configPath: "webhookToken" });
  const authentic = signature ? signatureMatches(signature, expected, input.rawBody) : tokenMatches(given!, expected);
  if (!authentic) throw new Error(signature ? "invalid webhook signature" : "invalid webhook token");

  let body = input.parsedBody;
  if (body === undefined) {
    try {
      body = JSON.parse(input.rawBody);
    } catch {
      throw new Error("body must be JSON");
    }
  }
  const events = (Array.isArray(body) ? body : [body]).slice(0, MAX_EVENTS_PER_DELIVERY);
  const tally: Record<AlertOutcome | "invalid", number> = { created: 0, duplicate: 0, resolved: 0, unknown_resolved: 0, ignored_severity: 0, suppressed_rate: 0, invalid: 0 };
  await perCompany(companyId, async () => {
    for (const raw of events) {
      let event;
      try {
        event = parseAlert(raw);
      } catch (err) {
        tally.invalid++;
        ctx.logger.warn(`nms webhook: invalid alert: ${message(err)}`);
        continue;
      }
      tally[await handleAlert(ctx, companyId, cfg, event)]++;
    }
  });
  ctx.logger.info(`nms webhook ${input.requestId}: ${JSON.stringify(tally)}`);
  return tally;
}

function companyIdOf(params: Record<string, unknown>): string {
  if (typeof params.companyId !== "string" || !params.companyId) throw new Error("companyId is required");
  return params.companyId;
}

const plugin = definePlugin({
  async setup(ctx) {
    pluginCtx = ctx;
    for (const tool of TOOLS) {
      assertGatewayRisk(tool.name, "read");
      ctx.tools.register(tool.name, tool, async (params: unknown, run: ToolRunContext) => {
        const cfg = ((await ctx.config.get(run.companyId)) ?? {}) as PackConfig;
        const secret: ResolveSecret = (ref, configPath) => ctx.secrets.resolve(ref as EnvSecretRefBinding, { companyId: run.companyId, configPath });
        try {
          return await handlers[tool.name](cfg, secret, (params ?? {}) as Record<string, unknown>);
        } catch (err) {
          return { error: `${tool.name} failed: ${message(err)}` };
        }
      });
    }

    ctx.data.register("alert-summary", async (params) => openAlertSummary(ctx, companyIdOf(params)));

    ctx.actions.register("test-connections", async (params) => {
      const companyId = companyIdOf(params);
      const cfg = ((await ctx.config.get(companyId)) ?? {}) as PackConfig;
      const secret: ResolveSecret = (ref, configPath) => ctx.secrets.resolve(ref as EnvSecretRefBinding, { companyId, configPath });
      let names: string[];
      try {
        names = nmsSources(cfg).map((s) => s.name);
      } catch (err) {
        return { sources: [], error: message(err) };
      }
      const sources = await Promise.all(
        names.map(async (name) => {
          try {
            const [o] = (await listHosts(cfg, secret, { source: name })).sources;
            return o?.ok ? { name, ok: true, summary: `${o.value.length} host` } : { name, ok: false, error: o?.ok === false ? o.error : "no result" };
          } catch (err) {
            const m = message(err);
            return { name, ok: false, error: m.startsWith(`${name}: `) ? m.slice(name.length + 2) : m };
          }
        }),
      );
      return { sources };
    });
  },

  async onWebhook(input) {
    if (!pluginCtx) throw new Error("plugin not ready");
    await receiveAlerts(pluginCtx, input);
  },

  async onHealth() {
    return { status: "ok", message: "Starnet NMS pack ready" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
