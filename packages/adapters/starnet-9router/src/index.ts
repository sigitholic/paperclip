/**
 * @starnet/adapter-9router — external Paperclip adapter (installed from Instance settings → Adapters).
 *
 * Runs agents through the built-in Codex lanes, routed to a 9router OpenAI-compatible gateway:
 * the sandboxed CLI engine by default (see sandbox.ts), or the ACP engine when the sandbox is
 * off. This adapter only rewrites the agent config before delegating to
 * `@paperclipai/adapter-codex-local`; it does not fork Codex execution.
 *
 * Agent settings (rendered from `getConfigSchema`):
 *   - ninerouterBaseUrl: gateway URL (`/v1` optional), e.g. a tunnel URL or http://127.0.0.1:20128
 *   - model: 9router model id or combo name
 * The API key is an agent env var bound to a company secret: Secrets & variables →
 * `NINEROUTER_API_KEY`. It is never part of adapterConfig fields.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  AdapterConfigSchema,
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
  AdapterExecutionContext,
  AdapterExecutionResult,
  AdapterModel,
  ServerAdapterModule,
} from "@paperclipai/adapter-utils";
import {
  execute as codexExecute,
  listCodexSkills,
  sessionCodec as codexSessionCodec,
  syncCodexSkills,
} from "@paperclipai/adapter-codex-local/server";
import {
  codexGatewayEnv,
  NINEROUTER_ADAPTER_TYPE,
  NINEROUTER_BASE_URL_KEY,
  NINEROUTER_ENV_KEY,
  NINEROUTER_GATEWAY_ID,
  normalizeBaseUrl,
  TIER_CONFIG_KEY,
} from "@starnet/pack-kit";
import { apiBaseUrl, describePack, fetchContextPack, MEMORY_CONFIG_KEY, memoryEnabled, type MemoryFetch, withContextPack } from "./memory-context.js";
import {
  DEFAULT_MAX_CONTEXT_TOKENS,
  DEFAULT_MAX_TOOL_CALLS,
  describeBreach,
  limitedResult,
  MAX_CONTEXT_TOKENS_KEY,
  MAX_TOOL_CALLS_KEY,
  resolveRunLimits,
  RunLimiter,
  type SpawnedProcess,
  stopProcessTree,
} from "./run-limits.js";
import { SANDBOX_KEY, SANDBOX_NETWORK_KEY, sandboxedCodexConfig, sandboxMode, sandboxNetwork } from "./sandbox.js";
import { checkQaAfterRun, ensureQaStage, type IssueFetch, QA_BYPASS_ERROR_CODE, QA_REVIEWER_KEY, qaReviewer, type QaRequest } from "./qa-gate.js";

export const ADAPTER_TYPE = NINEROUTER_ADAPTER_TYPE;
export const BASE_URL_KEY = NINEROUTER_BASE_URL_KEY;

type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

// Agent reads mask plain env values with this; saving it from a reloaded form persists the mask.
const REDACTED_PLACEHOLDER = "***REDACTED***";

const asString = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Resolved env value: a plain string, or a `{ type: "plain", value }` binding. */
function envValue(env: Record<string, unknown>, key: string): string | undefined {
  const v = env[key];
  if (typeof v === "string") return asString(v);
  const rec = asRecord(v);
  return rec.type === "plain" ? asString(rec.value) : undefined;
}

export function resolveBaseUrl(config: Record<string, unknown>): string {
  const raw = asString(config[BASE_URL_KEY]) ?? asString(process.env.NINEROUTER_BASE_URL);
  if (!raw) throw new Error(`${ADAPTER_TYPE}: set "${BASE_URL_KEY}" (9router URL) in the agent's adapter settings`);
  return normalizeBaseUrl(raw);
}

export type CodexRunConfig = { config: Record<string, unknown>; sandboxed: boolean; droppedArgs: string[] };

/**
 * Codex adapter config routed through 9router: the sandboxed CLI engine by default, or the ACP
 * engine with full host access when `starnetSandbox` is "off".
 */
export function codexRunConfig(config: Record<string, unknown>): CodexRunConfig {
  const baseUrl = resolveBaseUrl(config);
  const {
    [BASE_URL_KEY]: _url,
    [TIER_CONFIG_KEY]: _tier,
    [MEMORY_CONFIG_KEY]: _memory,
    [MAX_TOOL_CALLS_KEY]: _maxToolCalls,
    [MAX_CONTEXT_TOKENS_KEY]: _maxContextTokens,
    [QA_REVIEWER_KEY]: _qaReviewer,
    [SANDBOX_KEY]: _sandbox,
    [SANDBOX_NETWORK_KEY]: _sandboxNetwork,
    ...rest
  } = config;
  const gateway = { id: NINEROUTER_GATEWAY_ID, name: "9router", baseUrl, envKey: NINEROUTER_ENV_KEY };
  const acpConfig = { ...rest, engine: "acp", env: { ...asRecord(config.env), ...codexGatewayEnv(gateway) } };
  if (sandboxMode(config) === "off") return { config: acpConfig, sandboxed: false, droppedArgs: [] };
  const { config: cliConfig, dropped } = sandboxedCodexConfig(acpConfig, gateway, sandboxNetwork(config));
  return { config: cliConfig, sandboxed: true, droppedArgs: dropped };
}

export function toCodexConfig(config: Record<string, unknown>): Record<string, unknown> {
  return codexRunConfig(config).config;
}

export async function listGatewayModels(baseUrl: string, apiKey: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<string[]> {
  const res = await fetchImpl(`${baseUrl}/models`, { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`GET ${baseUrl}/models -> ${res.status}`);
  const body = asRecord(await res.json());
  const items = Array.isArray(body.data) ? body.data : Array.isArray(body.models) ? body.models : [];
  return items.map((m) => asString(asRecord(m).id) ?? asString(asRecord(m).name)).filter((m): m is string => !!m);
}

export async function testEnvironment(ctx: AdapterEnvironmentTestContext, fetchImpl?: FetchLike): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const result = (): AdapterEnvironmentTestResult => ({
    adapterType: ctx.adapterType,
    status: checks.some((c) => c.level === "error") ? "fail" : checks.some((c) => c.level === "warn") ? "warn" : "pass",
    checks,
    testedAt: new Date().toISOString(),
  });

  let baseUrl: string;
  try {
    baseUrl = resolveBaseUrl(ctx.config);
  } catch (err) {
    checks.push({ code: "ninerouter_base_url_missing", level: "error", message: err instanceof Error ? err.message : String(err) });
    return result();
  }
  const apiKey = envValue(asRecord(ctx.config.env), NINEROUTER_ENV_KEY);
  if (!apiKey) {
    checks.push({
      code: "ninerouter_api_key_unresolved",
      level: "warn",
      message: `${NINEROUTER_ENV_KEY} is not visible to the test.`,
      hint: `Bind ${NINEROUTER_ENV_KEY} to a company secret under the agent's Secrets & variables. Secret-bound values are resolved at run time.`,
    });
    return result();
  }
  if (apiKey === REDACTED_PLACEHOLDER) {
    checks.push({
      code: "ninerouter_api_key_placeholder",
      level: "error",
      message: `${NINEROUTER_ENV_KEY} holds the display placeholder "${REDACTED_PLACEHOLDER}", not the real key.`,
      hint: "The page was reloaded after the key was typed, so the masked value was saved. Re-enter the real 9router key (or rotate the secret) and save.",
    });
    return result();
  }
  try {
    const models = await listGatewayModels(baseUrl, apiKey, fetchImpl);
    rememberModels(baseUrl, models);
    checks.push({ code: "ninerouter_reachable", level: "info", message: `9router reachable at ${baseUrl} (${models.length} models/combos).` });
    const model = asString(ctx.config.model);
    if (!model) checks.push({ code: "ninerouter_model_missing", level: "error", message: "Choose a 9router model or combo." });
    else if (models.length && !models.includes(model)) {
      checks.push({ code: "ninerouter_model_unknown", level: "warn", message: `"${model}" is not advertised by this 9router.`, detail: models.slice(0, 30).join(", ") });
    }
  } catch (err) {
    checks.push({ code: "ninerouter_unreachable", level: "error", message: err instanceof Error ? err.message : String(err), hint: "Check the URL, the tunnel, and that the key matches 9router's API key." });
  }
  return result();
}

// The host calls listModels() without agent or company context, so models discovered by a
// successful test or run (the only places that see the URL and key) are cached on disk.
function instanceRoot(env: NodeJS.ProcessEnv): string {
  const home = asString(env.PAPERCLIP_HOME) ?? path.join(os.homedir(), ".paperclip");
  return path.join(home, "instances", asString(env.PAPERCLIP_INSTANCE_ID) ?? "default");
}

export function modelCacheFile(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(instanceRoot(env), "starnet-9router", "models.json");
}

/**
 * Codex home for gateway runs. It must stay outside `<instance>/companies/`: codex_local treats
 * homes there as managed and requires a ChatGPT login or OPENAI_API_KEY before launching, which a
 * run keyed by NINEROUTER_API_KEY never has on a host without a Codex login. It also keeps the
 * host's ChatGPT login out of gateway runs.
 */
export function gatewayCodexHome(companyId: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(instanceRoot(env), "starnet-9router", "codex-home", companyId);
}

/** `config` with CODEX_HOME set to the gateway home, unless the agent configures its own. */
export function withGatewayCodexHome(config: Record<string, unknown>, companyId: string, env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  const runEnv = asRecord(config.env);
  if (envValue(runEnv, "CODEX_HOME")) return config;
  return { ...config, env: { ...runEnv, CODEX_HOME: gatewayCodexHome(companyId, env) } };
}

type ModelCache = Record<string, { models: string[]; fetchedAt: string }>;

function readModelCache(file: string): ModelCache {
  try {
    return asRecord(JSON.parse(fs.readFileSync(file, "utf8"))) as ModelCache;
  } catch {
    return {};
  }
}

export function rememberModels(baseUrl: string, models: string[], file = modelCacheFile()): void {
  if (!models.length) return;
  const cache = readModelCache(file);
  cache[baseUrl] = { models, fetchedAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cache, null, 2), { mode: 0o600 });
}

export function cachedModels(file = modelCacheFile()): AdapterModel[] {
  const ids = new Set(Object.values(readModelCache(file)).flatMap((e) => (Array.isArray(e?.models) ? e.models : [])));
  return [...ids].sort().map((id) => ({ id, label: id }));
}

async function listModels(): Promise<AdapterModel[]> {
  const raw = asString(process.env.NINEROUTER_BASE_URL);
  const key = asString(process.env[NINEROUTER_ENV_KEY]);
  if (raw && key) {
    try {
      const baseUrl = normalizeBaseUrl(raw);
      rememberModels(baseUrl, await listGatewayModels(baseUrl, key));
    } catch {
      // fall back to the cache
    }
  }
  return cachedModels();
}

function refreshCacheFromRun(config: Record<string, unknown>): void {
  const apiKey = envValue(asRecord(config.env), NINEROUTER_ENV_KEY);
  if (!apiKey) return;
  const baseUrl = resolveBaseUrl(config);
  void listGatewayModels(baseUrl, apiKey).then((models) => rememberModels(baseUrl, models)).catch(() => undefined);
}

export function getConfigSchema(): AdapterConfigSchema {
  return {
    fields: [
      {
        key: BASE_URL_KEY,
        label: "9router URL",
        type: "text",
        required: true,
        hint: "Gateway base URL, e.g. https://your-tunnel.example.com or http://127.0.0.1:20128 (/v1 is added). Put the API key in Secrets & variables as NINEROUTER_API_KEY.",
      },
      {
        key: "model",
        label: "Model / combo",
        type: "combobox",
        required: true,
        hint: "9router model id or combo name, e.g. kr/claude-sonnet-4.5",
      },
      {
        key: MEMORY_CONFIG_KEY,
        label: "Starnet Memory context",
        type: "toggle",
        default: true,
        hint: "Prepend the curated <starnet-context> pack from the starnet.memory plugin to every run on an issue. Skipped when the plugin is missing.",
      },
      {
        key: MAX_TOOL_CALLS_KEY,
        label: "Max tool calls per run",
        type: "number",
        default: DEFAULT_MAX_TOOL_CALLS,
        hint: "Stop the run when the agent starts more tool calls than this (0 = no limit).",
      },
      {
        key: MAX_CONTEXT_TOKENS_KEY,
        label: "Max context tokens per run",
        type: "number",
        default: DEFAULT_MAX_CONTEXT_TOKENS,
        hint: "Stop the run when the session context grows past this many tokens (0 = no limit).",
      },
      {
        key: QA_REVIEWER_KEY,
        label: "QA reviewer agent id",
        type: "text",
        hint: "Agent id of the QA reviewer. Issues this agent works on get a review stage for it, so they are not done without QA approval. Empty = no QA gate.",
      },
      {
        key: SANDBOX_KEY,
        label: "Sandbox",
        type: "select",
        default: "workspace-write",
        options: [
          { value: "workspace-write", label: "Workspace only (Codex CLI sandbox)" },
          { value: "off", label: "Off - full host access (Codex ACP)" },
        ],
        hint: "Workspace only: shell commands may write only to the workspace and temp dirs. Off: the agent runs with full access to this machine.",
      },
      {
        key: SANDBOX_NETWORK_KEY,
        label: "Sandbox network access",
        type: "toggle",
        default: false,
        hint: "Off: shell commands reach only this machine (the Paperclip API), not the internet or customer devices. Model calls are not affected.",
      },
    ],
  };
}

export const agentConfigurationDoc = `# ${ADAPTER_TYPE} agent configuration

Adapter: ${ADAPTER_TYPE} (Starnet external adapter; Codex routed through 9router)

Fields:
- ${BASE_URL_KEY} (string, required): 9router base URL; "/v1" is appended when missing. Falls back to server env NINEROUTER_BASE_URL.
- model (string, required): 9router model id or combo name.
- ${MEMORY_CONFIG_KEY} (boolean, default true): inject the starnet.memory context pack for the run's issue into the prompt.
- ${MAX_TOOL_CALLS_KEY} (number, default ${DEFAULT_MAX_TOOL_CALLS}, 0 = off): stop the run after this many tool calls; the run fails with errorCode starnet_run_limit.
- ${MAX_CONTEXT_TOKENS_KEY} (number, default ${DEFAULT_MAX_CONTEXT_TOKENS}, 0 = off): stop the run when the session context exceeds this many tokens.
- ${QA_REVIEWER_KEY} (agent id, optional): before each run, add a review stage for this agent to the run's issue; a run that leaves the issue done without that review approved fails with errorCode ${QA_BYPASS_ERROR_CODE}.
- ${SANDBOX_KEY} ("workspace-write" | "off", default "workspace-write"): "workspace-write" runs the Codex CLI engine (bundled @openai/codex binary unless command is set) in the Codex workspace-write sandbox; "off" runs the Codex ACP engine with full host access.
- ${SANDBOX_NETWORK_KEY} (boolean, default false): network access for sandboxed shell commands. Loopback (the Paperclip API) stays reachable when off.
- env.${NINEROUTER_ENV_KEY} (secret_ref, required): 9router API key bound to a company secret.
- Other codex_local fields (instructionsFilePath, cwd, timeoutSec, modelReasoningEffort, extraArgs, ...) are passed through to Codex.

Notes:
- engine is set by ${SANDBOX_KEY}; a configured engine is ignored.
- In the sandbox, extraArgs that change or bypass the sandbox or change the model provider are dropped.
- Sandboxed runs confine writes and network, not reads.
- Runs use their own Codex home (instances/<id>/starnet-9router/codex-home/<companyId>) unless env.CODEX_HOME is set, so no Codex/ChatGPT login is needed on the host.
- ${MAX_CONTEXT_TOKENS_KEY} only applies to the ACP engine (sandbox off).
- Do not connect subscription logins (ChatGPT, Claude, Copilot) to 9router: likely against provider terms.
- Every prompt, including customer data and tool output, passes through the gateway. Run 9router with REQUIRE_API_KEY=true.
`;

/** Run context with the Starnet Memory pack injected when enabled and available; logs sizes only. */
export async function injectMemoryContext(ctx: AdapterExecutionContext, fetchImpl?: MemoryFetch): Promise<Record<string, unknown>> {
  if (!memoryEnabled(ctx.config)) return ctx.context;
  const result = await fetchContextPack({
    apiUrl: apiBaseUrl(ctx.agent),
    issueId: asString(ctx.context.issueId),
    runId: ctx.runId,
    authToken: ctx.authToken,
    fetchImpl,
  });
  if ("skipped" in result) {
    await ctx.onLog("stdout", `[starnet] memory context skipped: ${result.skipped}\n`);
    return ctx.context;
  }
  await ctx.onLog("stdout", describePack(result.pack));
  return withContextPack(ctx.context, result.pack);
}

/**
 * Runs `run` with the Starnet step/token limiter on the run log. On the first breach it logs the
 * reason and aborts through a signal combined with the operator's, then reports a failed result.
 */
export async function executeWithRunLimits(
  ctx: AdapterExecutionContext,
  run: (ctx: AdapterExecutionContext) => Promise<AdapterExecutionResult>,
  options: { stopProcess?: (target: SpawnedProcess) => void } = {},
): Promise<AdapterExecutionResult> {
  const limiter = new RunLimiter(resolveRunLimits(ctx.config));
  const { maxToolCalls, maxContextTokens } = limiter.limits;
  if (maxToolCalls === 0 && maxContextTokens === 0) return run(ctx);
  const controller = new AbortController();
  const signal = ctx.signal ? AbortSignal.any([ctx.signal, controller.signal]) : controller.signal;
  let spawned: SpawnedProcess | null = null;
  const onSpawn: AdapterExecutionContext["onSpawn"] = async (meta) => {
    spawned = { pid: meta.pid ?? null, processGroupId: meta.processGroupId ?? null };
    await ctx.onSpawn?.(meta);
  };
  const onLog: AdapterExecutionContext["onLog"] = async (stream, chunk) => {
    await ctx.onLog(stream, chunk);
    if (stream !== "stdout" || controller.signal.aborted) return;
    const breach = limiter.observe(chunk);
    if (!breach) return;
    const message = describeBreach(breach);
    await ctx.onLog("stdout", `[starnet] ${message}; stopping the run\n`);
    controller.abort(new Error(message));
    if (spawned && options.stopProcess) options.stopProcess(spawned);
  };
  const result = await run({ ...ctx, signal, onLog, onSpawn });
  return limiter.breach && !ctx.signal?.aborted ? limitedResult(result, limiter) : result;
}

/**
 * Runs `run` behind the QA gate: ensures the reviewer's stage before the run and reports a failed
 * run when the issue ends up done without that review approved. No-op without a reviewer.
 */
export async function executeWithQaGate(
  ctx: AdapterExecutionContext,
  run: (ctx: AdapterExecutionContext) => Promise<AdapterExecutionResult>,
  fetchImpl?: IssueFetch,
): Promise<AdapterExecutionResult> {
  const reviewerAgentId = qaReviewer(ctx.config);
  if (!reviewerAgentId) return run(ctx);
  const req: QaRequest = {
    apiUrl: apiBaseUrl(ctx.agent),
    issueId: asString(ctx.context.issueId),
    agentId: ctx.agent.id,
    reviewerAgentId,
    runId: ctx.runId,
    authToken: ctx.authToken,
    fetchImpl,
  };
  const ensured = await ensureQaStage(req);
  await ctx.onLog(
    "stdout",
    ensured.attached ? `[starnet] QA gate: review stage added for reviewer ${reviewerAgentId}\n` : `[starnet] QA gate: ${ensured.reason}\n`,
  );
  const result = await run(ctx);
  if (!req.issueId || reviewerAgentId === ctx.agent.id) return result;
  const check = await checkQaAfterRun(req);
  if (!check.bypassed) return result;
  await ctx.onLog("stdout", `[starnet] QA gate bypassed: ${check.reason}\n`);
  const resultJson = { ...(result.resultJson ?? {}), starnetQa: { bypassed: true, reason: check.reason, reviewerAgentId } };
  if (result.errorCode) return { ...result, resultJson };
  return {
    ...result,
    exitCode: result.exitCode && result.exitCode !== 0 ? result.exitCode : 1,
    errorCode: QA_BYPASS_ERROR_CODE,
    errorMessage: `Starnet QA gate: ${check.reason}`,
    resultJson,
  };
}

/** One run-log line describing the sandbox the run uses. */
export function describeSandbox(config: Record<string, unknown>, sandboxed: boolean, droppedArgs: string[]): string {
  if (!sandboxed) return "[starnet] sandbox: off (Codex ACP, full host access)\n";
  const network = sandboxNetwork(config) ? "on" : "off (loopback only)";
  const dropped = droppedArgs.length ? `; dropped extraArgs: ${droppedArgs.join(" ")}` : "";
  return `[starnet] sandbox: workspace-write (Codex CLI), network ${network}${dropped}\n`;
}

export function createServerAdapter(): ServerAdapterModule {
  return {
    type: ADAPTER_TYPE,
    runtimeToolDelivery: "native_mcp",
    execute: async (ctx: AdapterExecutionContext) => {
      const { config: runConfig, sandboxed, droppedArgs } = codexRunConfig(ctx.config);
      const config = withGatewayCodexHome(runConfig, ctx.agent.companyId);
      refreshCacheFromRun(ctx.config);
      await ctx.onLog("stdout", describeSandbox(ctx.config, sandboxed, droppedArgs));
      const context = await injectMemoryContext(ctx);
      return executeWithQaGate({ ...ctx, context }, (gated) =>
        executeWithRunLimits(gated, (limited) => codexExecute({ ...limited, config }), {
          stopProcess: sandboxed ? stopProcessTree : undefined,
        }),
      );
    },
    testEnvironment: (ctx) => testEnvironment(ctx),
    acp: { agentId: "codex", skillsMode: "ephemeral", prerequisites: { nodeRange: ">=24.11.0", packages: ["@agentclientprotocol/codex-acp"] } },
    listSkills: listCodexSkills,
    syncSkills: syncCodexSkills,
    sessionCodec: codexSessionCodec,
    models: [],
    listModels,
    refreshModels: listModels,
    supportsLocalAgentJwt: true,
    supportsInstructionsBundle: true,
    instructionsPathKey: "instructionsFilePath",
    requiresMaterializedRuntimeSkills: false,
    agentConfigurationDoc,
    getConfigSchema,
  };
}
