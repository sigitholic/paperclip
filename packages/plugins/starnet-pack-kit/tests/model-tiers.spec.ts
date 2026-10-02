import { describe, expect, it } from "vitest";
import {
  codexGatewayEnv,
  DEFAULT_CODEX_TIERS,
  isModelTier,
  MODEL_TIERS,
  ninerouterTiers,
  normalizeBaseUrl,
  tierAdapterConfig,
  type TierMap,
} from "../src/index.js";

describe("model tiers", () => {
  it("defines every tier in the default codex map", () => {
    for (const tier of MODEL_TIERS) expect(DEFAULT_CODEX_TIERS.tiers[tier].model).toBeTruthy();
  });

  it("resolves a tier to codex adapterConfig fields", () => {
    expect(tierAdapterConfig("reasoning")).toEqual({ model: "gpt-6-luna", modelReasoningEffort: "high" });
  });

  it("omits effort when the tier has none and ignores codex-only keys for other adapters", () => {
    const map: TierMap = {
      adapterType: "claude_local",
      tiers: { fast: { model: "a" }, standard: { model: "b", reasoningEffort: "medium" }, reasoning: { model: "c" } },
    };
    expect(tierAdapterConfig("fast", map)).toEqual({ model: "a" });
    expect(tierAdapterConfig("standard", map)).toEqual({ model: "b" });
  });

  it("rejects a tier without a model", () => {
    const map = { adapterType: "codex_local", tiers: { ...DEFAULT_CODEX_TIERS.tiers, fast: { model: "" } } };
    expect(() => tierAdapterConfig("fast", map)).toThrow(/no model/);
  });

  it("routes codex through a 9router gateway via env only", () => {
    const map = ninerouterTiers({ baseUrl: "https://router.example.com/", models: { fast: "kr/glm-5", standard: "my-combo", reasoning: "cc/claude-opus-4-7" } });
    const cfg = tierAdapterConfig("standard", map, { apiKey: { type: "secret_ref", secretId: "s-1" } });
    expect(cfg.model).toBe("my-combo");
    expect(cfg).not.toHaveProperty("modelReasoningEffort");
    const env = cfg.env as Record<string, unknown>;
    expect(env.MODEL_PROVIDER).toBe("ninerouter");
    expect(env.NINEROUTER_API_KEY).toEqual({ type: "secret_ref", secretId: "s-1" });
    expect(JSON.parse(env.CODEX_CONFIG as string)).toEqual({
      model_providers: { ninerouter: { name: "9router", base_url: "https://router.example.com/v1", env_key: "NINEROUTER_API_KEY", wire_api: "responses" } },
    });
  });

  it("normalizes gateway base URLs and refuses to shadow the openai provider", () => {
    expect(normalizeBaseUrl("http://127.0.0.1:20128")).toBe("http://127.0.0.1:20128/v1");
    expect(normalizeBaseUrl("http://127.0.0.1:20128/v1/")).toBe("http://127.0.0.1:20128/v1");
    expect(() => normalizeBaseUrl("127.0.0.1:20128")).toThrow(/http/);
    expect(() => codexGatewayEnv({ id: "openai", name: "x", baseUrl: "http://x/v1", envKey: "K" })).toThrow(/shadow/);
  });

  it("guards tier names", () => {
    expect(isModelTier("standard")).toBe(true);
    expect(isModelTier("cheap")).toBe(false);
  });
});
