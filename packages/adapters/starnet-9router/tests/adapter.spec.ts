import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ADAPTER_TYPE, cachedModels, createServerAdapter, getConfigSchema, testEnvironment, toCodexConfig } from "../src/index.js";

beforeEach(() => {
  process.env.PAPERCLIP_HOME = mkdtempSync(join(tmpdir(), "pc-home-"));
  delete process.env.PAPERCLIP_INSTANCE_ID;
  delete process.env.NINEROUTER_BASE_URL;
});

const ok = (models: string[]) => async () => ({ ok: true, status: 200, json: async () => ({ data: models.map((id) => ({ id })) }) });
const ctx = (config: Record<string, unknown>) => ({ companyId: "c1", adapterType: ADAPTER_TYPE, config });

describe("toCodexConfig", () => {
  it("routes the codex ACP session through 9router and keeps other fields", () => {
    const out = toCodexConfig({
      ninerouterBaseUrl: "https://tunnel.example.com/",
      model: "my-combo",
      instructionsFilePath: "/x/AGENTS.md",
      engine: "cli",
      starnetTier: "standard",
      starnetMemory: false,
      env: { NINEROUTER_API_KEY: "sk-1", OTHER: "y" },
    });
    expect(out).not.toHaveProperty("ninerouterBaseUrl");
    expect(out).not.toHaveProperty("starnetTier");
    expect(out).not.toHaveProperty("starnetMemory");
    expect(out).toMatchObject({ model: "my-combo", instructionsFilePath: "/x/AGENTS.md", engine: "acp" });
    const env = out.env as Record<string, string>;
    expect(env).toMatchObject({ NINEROUTER_API_KEY: "sk-1", OTHER: "y", MODEL_PROVIDER: "ninerouter" });
    expect(JSON.parse(env.CODEX_CONFIG).model_providers.ninerouter.base_url).toBe("https://tunnel.example.com/v1");
  });

  it("fails clearly without a base URL", () => {
    expect(() => toCodexConfig({ model: "m" })).toThrow(/ninerouterBaseUrl/);
  });
});

describe("testEnvironment", () => {
  it("passes when 9router answers and advertises the model", async () => {
    const r = await testEnvironment(ctx({ ninerouterBaseUrl: "http://r", model: "kr/glm-5", env: { NINEROUTER_API_KEY: "k" } }), ok(["kr/glm-5"]));
    expect(r.status).toBe("pass");
    expect(r.checks[0]!.code).toBe("ninerouter_reachable");
  });

  it("warns for an unadvertised model and for an unresolved key", async () => {
    const unknown = await testEnvironment(ctx({ ninerouterBaseUrl: "http://r", model: "x", env: { NINEROUTER_API_KEY: { type: "plain", value: "k" } } }), ok(["kr/glm-5"]));
    expect(unknown.status).toBe("warn");
    const noKey = await testEnvironment(ctx({ ninerouterBaseUrl: "http://r", model: "x", env: { NINEROUTER_API_KEY: { type: "secret_ref", secretId: "s" } } }), ok([]));
    expect(noKey.checks.map((c) => c.code)).toEqual(["ninerouter_api_key_unresolved"]);
  });

  it("fails on missing URL or an unreachable gateway without echoing the key", async () => {
    expect((await testEnvironment(ctx({ model: "m" }))).status).toBe("fail");
    const down = await testEnvironment(ctx({ ninerouterBaseUrl: "http://r", model: "m", env: { NINEROUTER_API_KEY: "sk-secret" } }), async () => ({ ok: false, status: 401, json: async () => ({}) }));
    expect(down.status).toBe("fail");
    expect(JSON.stringify(down)).not.toContain("sk-secret");
  });
});

describe("model list", () => {
  it("offers the models discovered by a successful test, merged across gateways", async () => {
    expect(await createServerAdapter().listModels!()).toEqual([]);
    await testEnvironment(ctx({ ninerouterBaseUrl: "http://a", model: "m1", env: { NINEROUTER_API_KEY: "k" } }), ok(["m1", "m2"]));
    await testEnvironment(ctx({ ninerouterBaseUrl: "http://b", model: "m3", env: { NINEROUTER_API_KEY: "k" } }), ok(["m3", "m1"]));
    expect(cachedModels().map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    expect((await createServerAdapter().refreshModels!()).length).toBe(3);
  });

  it("flags a saved redaction placeholder instead of calling the gateway", async () => {
    let called = false;
    const r = await testEnvironment(ctx({ ninerouterBaseUrl: "http://a", model: "m", env: { NINEROUTER_API_KEY: "***REDACTED***" } }), async () => {
      called = true;
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    });
    expect(called).toBe(false);
    expect(r.checks.map((c) => c.code)).toEqual(["ninerouter_api_key_placeholder"]);
  });

  it("does not cache anything when the gateway fails", async () => {
    await testEnvironment(ctx({ ninerouterBaseUrl: "http://a", model: "m", env: { NINEROUTER_API_KEY: "k" } }), async () => ({ ok: false, status: 500, json: async () => ({}) }));
    expect(cachedModels()).toEqual([]);
  });
});

describe("adapter module", () => {
  it("exposes the type, the settings schema and the codex skill hooks", () => {
    const mod = createServerAdapter();
    expect(mod.type).toBe("starnet_9router");
    expect(getConfigSchema().fields.map((f) => f.key)).toEqual(["ninerouterBaseUrl", "model", "starnetMemory"]);
    expect(typeof mod.syncSkills).toBe("function");
    expect(mod.supportsInstructionsBundle).toBe(true);
  });
});
