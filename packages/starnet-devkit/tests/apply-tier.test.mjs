import { describe, expect, it } from "vitest";
import { selectTargets, tierPatch } from "../scripts/apply-tier.mjs";
import { DEFAULT_CODEX_TIERS, ninerouterTiers } from "../../plugins/starnet-pack-kit/src/model-tiers.ts";

const map = ninerouterTiers({ baseUrl: "https://r.example.com", models: { fast: "f", standard: "combo", reasoning: "r" }, adapterType: "starnet_9router" });
const secret = { type: "secret_ref", secretId: "s-1" };

describe("tierPatch", () => {
  it("fills a paused template with model, URL and key, keeping its other config", () => {
    const agent = { adapterType: "starnet_9router", adapterConfig: { starnetTier: "standard", instructionsFilePath: "/i/AGENTS.md", env: { OTHER: { type: "plain", value: "***REDACTED***" } } } };
    expect(tierPatch(agent, "standard", map, secret)).toEqual({
      adapterType: "starnet_9router",
      adapterConfig: {
        starnetTier: "standard",
        instructionsFilePath: "/i/AGENTS.md",
        model: "combo",
        ninerouterBaseUrl: "https://r.example.com/v1",
        env: { OTHER: { type: "plain", value: "***REDACTED***" }, NINEROUTER_API_KEY: secret },
      },
    });
  });

  it("keeps only adapter-neutral keys when switching adapters", () => {
    const agent = { adapterType: "starnet_9router", adapterConfig: { ninerouterBaseUrl: "https://r/v1", model: "combo", timeoutSec: 600, instructionsFilePath: "/i" } };
    expect(tierPatch(agent, "reasoning", DEFAULT_CODEX_TIERS)).toEqual({
      adapterType: "codex_local",
      adapterConfig: { timeoutSec: 600, instructionsFilePath: "/i", model: "gpt-6-luna", modelReasoningEffort: "high", starnetTier: "reasoning" },
    });
  });
});

describe("selectTargets", () => {
  const agents = [
    { id: "1", name: "NOC Engineer (LLM)", status: "paused", adapterConfig: { starnetTier: "standard" } },
    { id: "2", name: "Kepala Kantor", status: "idle", adapterConfig: { model: "x" } },
    { id: "3", name: "Old NOC", status: "terminated", adapterConfig: { starnetTier: "fast" } },
  ];

  it("picks live agents that declare a tier", () => {
    expect(selectTargets(agents).map((t) => [t.agent.id, t.tier])).toEqual([["1", "standard"]]);
  });

  it("targets one named agent, requiring a tier when it declares none", () => {
    expect(selectTargets(agents, { agentName: "Kepala Kantor", tier: "reasoning" })[0].tier).toBe("reasoning");
    expect(() => selectTargets(agents, { agentName: "Kepala Kantor" })).toThrow(/declares no tier/);
    expect(() => selectTargets(agents, { agentName: "Old NOC" })).toThrow(/not found/);
  });
});
