import { describe, expect, it } from "vitest";
import { REDACTED, copyAdapterFrom, defaultEngine, defaultManager, engineCandidates, type SourceAgent } from "../src/adapter-copy.js";

const agent = (over: Partial<SourceAgent>): SourceAgent => ({ id: "a", name: "A", role: "engineer", status: "idle", adapterType: "codex_local", adapterConfig: {}, ...over });

describe("copyAdapterFrom", () => {
  it("keeps secret refs and model, drops redacted plain values and per-agent wiring", () => {
    const copied = copyAdapterFrom(agent({
      adapterType: "starnet_9router",
      adapterConfig: {
        model: "cx/gpt-6-luna",
        baseUrl: "https://gw.example/v1",
        starnetQaReviewer: "qa-id",
        instructionsFilePath: "/x/AGENTS.md",
        env: {
          ROUTER_KEY: { type: "secret_ref", secretId: "c83e", version: "latest" },
          DEBUG: { type: "plain", value: REDACTED },
        },
        extraArgs: ["--a", REDACTED],
        headers: { Authorization: REDACTED, Accept: "json" },
      },
    }));
    expect(copied.adapter).toEqual({
      type: "starnet_9router",
      config: {
        model: "cx/gpt-6-luna",
        baseUrl: "https://gw.example/v1",
        env: { ROUTER_KEY: { type: "secret_ref", secretId: "c83e", version: "latest" } },
        headers: { Accept: "json" },
      },
    });
    expect(copied.dropped.sort()).toEqual(["env.DEBUG", "extraArgs", "headers.Authorization"]);
  });

  it("refuses process/http agents", () => {
    expect(() => copyAdapterFrom(agent({ adapterType: "process" }))).toThrow();
  });
});

describe("engine and manager defaults", () => {
  const list = [
    agent({ id: "p", adapterType: "process" }),
    agent({ id: "dead", adapterType: "starnet_9router", status: "terminated" }),
    agent({ id: "c", adapterType: "claude_local" }),
    agent({ id: "x", adapterType: "codex_local", role: "ceo" }),
  ];

  it("skips process/terminated agents and prefers the Starnet gateway, then Codex, then Claude", () => {
    expect(engineCandidates(list).map((a) => a.id)).toEqual(["c", "x"]);
    expect(defaultEngine(list)?.id).toBe("x");
    expect(defaultEngine([...list, agent({ id: "g", adapterType: "starnet_9router" })])?.id).toBe("g");
  });

  it("picks the live CEO as default manager", () => {
    expect(defaultManager(list)?.id).toBe("x");
    expect(defaultManager([agent({ id: "y", role: "ceo", status: "terminated" })])).toBeUndefined();
  });
});
