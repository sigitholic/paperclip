/**
 * Model tiers — Starnet's replacement for "model profiles" (removed upstream in PR #12683).
 *
 * Paperclip has exactly one model-selection path: the agent's own `adapterConfig`.
 * Starnet does not route at runtime; templates declare a tier and setup resolves it to
 * the concrete `adapterConfig` fields below. Switching provider or plan means editing
 * one tier map, never a template.
 *
 * Every model here must pass `pnpm --filter @starnet/devkit check:models` on the target
 * account. The ChatGPT "go" plan only serves `gpt-6-luna` (see starnet-docs 07-audit B-01),
 * so the default map differentiates tiers by reasoning effort on that single model.
 *
 * A tier map may route Codex through an OpenAI-compatible gateway (for example 9router).
 * The bundled codex-acp server reads `MODEL_PROVIDER` and `CODEX_CONFIG` from its
 * environment, so the gateway is configured per agent through `adapterConfig.env` only.
 */

export type ModelTier = "fast" | "standard" | "reasoning";
export const MODEL_TIERS: readonly ModelTier[] = ["fast", "standard", "reasoning"];

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";

export interface TierChoice {
  model: string;
  reasoningEffort?: ReasoningEffort;
}

export interface CodexGateway {
  /** Codex `model_providers` key; must not be "openai". */
  id: string;
  name: string;
  /** OpenAI-compatible base URL including `/v1`. */
  baseUrl: string;
  /** Env var Codex reads the gateway API key from. */
  envKey: string;
}

export interface TierMap {
  adapterType: string;
  gateway?: CodexGateway;
  tiers: Record<ModelTier, TierChoice>;
}

/** Env binding understood by Paperclip adapter config (`{ type: "secret_ref", secretId }`). */
export interface SecretRefBinding {
  type: "secret_ref";
  secretId: string;
}

export const DEFAULT_CODEX_TIERS: TierMap = {
  adapterType: "codex_local",
  tiers: {
    fast: { model: "gpt-6-luna", reasoningEffort: "low" },
    standard: { model: "gpt-6-luna", reasoningEffort: "medium" },
    reasoning: { model: "gpt-6-luna", reasoningEffort: "high" },
  },
};

export const NINEROUTER_GATEWAY_ID = "ninerouter";
export const NINEROUTER_ENV_KEY = "NINEROUTER_API_KEY";
/** External adapter `@starnet/adapter-9router`: Codex ACP with the 9router URL as a UI field. */
export const NINEROUTER_ADAPTER_TYPE = "starnet_9router";
export const NINEROUTER_BASE_URL_KEY = "ninerouterBaseUrl";

/**
 * `adapterConfig` key a template uses to declare its tier. Plugins cannot edit an agent's
 * adapterConfig after creation, so the devkit `apply-tier` script resolves it per company.
 */
export const TIER_CONFIG_KEY = "starnetTier";

/**
 * Tier map routed through a 9router instance. Models are 9router ids or combo names.
 * `codex_local` carries the gateway in `env`; `starnet_9router` takes the URL as its own field.
 */
export function ninerouterTiers(opts: {
  baseUrl: string;
  models: Record<ModelTier, string>;
  adapterType?: "codex_local" | typeof NINEROUTER_ADAPTER_TYPE;
}): TierMap {
  return {
    adapterType: opts.adapterType ?? "codex_local",
    gateway: { id: NINEROUTER_GATEWAY_ID, name: "9router", baseUrl: normalizeBaseUrl(opts.baseUrl), envKey: NINEROUTER_ENV_KEY },
    tiers: {
      fast: { model: opts.models.fast },
      standard: { model: opts.models.standard },
      reasoning: { model: opts.models.reasoning },
    },
  };
}

export function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(trimmed)) throw new Error(`gateway baseUrl must be http(s): ${url}`);
  return /\/v1$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

/** `adapterConfig.env` entries that point codex-acp at `gateway`. */
export function codexGatewayEnv(gateway: CodexGateway, apiKey?: SecretRefBinding): Record<string, string | SecretRefBinding> {
  if (gateway.id === "openai") throw new Error('gateway id "openai" would shadow the native provider');
  const env: Record<string, string | SecretRefBinding> = {
    MODEL_PROVIDER: gateway.id,
    CODEX_CONFIG: JSON.stringify({
      model_providers: {
        [gateway.id]: { name: gateway.name, base_url: gateway.baseUrl, env_key: gateway.envKey, wire_api: "responses" },
      },
    }),
  };
  if (apiKey) env[gateway.envKey] = apiKey;
  return env;
}

export function isModelTier(value: unknown): value is ModelTier {
  return typeof value === "string" && (MODEL_TIERS as readonly string[]).includes(value);
}

/** The `adapterConfig` fragment to merge into an agent created for `tier`. */
export function tierAdapterConfig(
  tier: ModelTier,
  map: TierMap = DEFAULT_CODEX_TIERS,
  secrets: { apiKey?: SecretRefBinding } = {},
): Record<string, unknown> {
  const choice = map.tiers[tier];
  if (!choice?.model) throw new Error(`tier "${tier}" has no model in the ${map.adapterType} tier map`);
  switch (map.adapterType) {
    case "codex_local":
      return {
        model: choice.model,
        ...(choice.reasoningEffort ? { modelReasoningEffort: choice.reasoningEffort } : {}),
        ...(map.gateway ? { env: codexGatewayEnv(map.gateway, secrets.apiKey) } : {}),
      };
    case NINEROUTER_ADAPTER_TYPE:
      return {
        model: choice.model,
        ...(map.gateway ? { [NINEROUTER_BASE_URL_KEY]: map.gateway.baseUrl } : {}),
        ...(secrets.apiKey ? { env: { [map.gateway?.envKey ?? NINEROUTER_ENV_KEY]: secrets.apiKey } } : {}),
      };
    default:
      return { model: choice.model };
  }
}

/**
 * Manifest fragment for a tiered agent template. The agent starts paused because its model
 * and gateway are only known per company; `apply-tier` fills them in and resumes it.
 */
export function tierTemplate(tier: ModelTier, adapterType: string = NINEROUTER_ADAPTER_TYPE) {
  return { adapterType, adapterConfig: { [TIER_CONFIG_KEY]: tier }, status: "paused" as const };
}

export function declaredTier(adapterConfig: unknown): ModelTier | null {
  const value = adapterConfig && typeof adapterConfig === "object" ? (adapterConfig as Record<string, unknown>)[TIER_CONFIG_KEY] : undefined;
  return isModelTier(value) ? value : null;
}
