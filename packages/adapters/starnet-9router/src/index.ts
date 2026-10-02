/**
 * @starnet/adapter-9router — external Paperclip adapter (installed from Instance settings → Adapters).
 *
 * Runs agents through the built-in Codex ACP lane, routed to a 9router OpenAI-compatible
 * gateway. The bundled codex-acp server reads `MODEL_PROVIDER` and `CODEX_CONFIG` from its
 * environment, so this adapter only rewrites the agent config before delegating to
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
  AdapterModel,
  ServerAdapterModule,
} from "@paperclipai/adapter-utils";
import {
  execute as codexExecute,
  listCodexSkills,
  sessionCodec as codexSessionCodec,
  syncCodexSkills,
} from "@paperclipai/adapter-codex-local/server";
import { codexGatewayEnv, NINEROUTER_ENV_KEY, NINEROUTER_GATEWAY_ID, normalizeBaseUrl } from "@starnet/pack-kit";

export const ADAPTER_TYPE = "starnet_9router";
export const BASE_URL_KEY = "ninerouterBaseUrl";

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

/** Codex adapter config that routes the ACP session through 9router. */
export function toCodexConfig(config: Record<string, unknown>): Record<string, unknown> {
  const baseUrl = resolveBaseUrl(config);
  const { [BASE_URL_KEY]: _omit, ...rest } = config;
  const gatewayEnv = codexGatewayEnv({ id: NINEROUTER_GATEWAY_ID, name: "9router", baseUrl, envKey: NINEROUTER_ENV_KEY });
  return { ...rest, engine: "acp", env: { ...asRecord(config.env), ...gatewayEnv } };
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
export function modelCacheFile(env: NodeJS.ProcessEnv = process.env): string {
  const home = asString(env.PAPERCLIP_HOME) ?? path.join(os.homedir(), ".paperclip");
  return path.join(home, "instances", asString(env.PAPERCLIP_INSTANCE_ID) ?? "default", "starnet-9router", "models.json");
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
    ],
  };
}

export const agentConfigurationDoc = `# ${ADAPTER_TYPE} agent configuration

Adapter: ${ADAPTER_TYPE} (Starnet external adapter; Codex ACP routed through 9router)

Fields:
- ${BASE_URL_KEY} (string, required): 9router base URL; "/v1" is appended when missing. Falls back to server env NINEROUTER_BASE_URL.
- model (string, required): 9router model id or combo name.
- env.${NINEROUTER_ENV_KEY} (secret_ref, required): 9router API key bound to a company secret.
- Other codex_local fields (instructionsFilePath, cwd, timeoutSec, modelReasoningEffort, ...) are passed through to the Codex ACP engine.

Notes:
- engine is forced to "acp": only codex-acp reads MODEL_PROVIDER/CODEX_CONFIG.
- Do not connect subscription logins (ChatGPT, Claude, Copilot) to 9router: likely against provider terms.
- Every prompt, including customer data and tool output, passes through the gateway. Run 9router with REQUIRE_API_KEY=true.
`;

export function createServerAdapter(): ServerAdapterModule {
  return {
    type: ADAPTER_TYPE,
    runtimeToolDelivery: "native_mcp",
    execute: (ctx: AdapterExecutionContext) => {
      const config = toCodexConfig(ctx.config);
      refreshCacheFromRun(ctx.config);
      return codexExecute({ ...ctx, config });
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
