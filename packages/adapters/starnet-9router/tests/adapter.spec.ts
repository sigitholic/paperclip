import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateCodexCredentialReadiness } from "@paperclipai/adapter-codex-local/server";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ADAPTER_TYPE,
  cachedModels,
  codexRunConfig,
  createServerAdapter,
  gatewayCodexHome,
  getConfigSchema,
  testEnvironment,
  toCodexConfig,
  withGatewayCodexHome,
} from "../src/index.js";

beforeEach(() => {
  process.env.PAPERCLIP_HOME = mkdtempSync(join(tmpdir(), "pc-home-"));
  delete process.env.PAPERCLIP_INSTANCE_ID;
  delete process.env.NINEROUTER_BASE_URL;
});

const ok = (models: string[]) => async () => ({ ok: true, status: 200, json: async () => ({ data: models.map((id) => ({ id })) }) });
const ctx = (config: Record<string, unknown>) => ({ companyId: "c1", adapterType: ADAPTER_TYPE, config });

describe("toCodexConfig", () => {
  const starnetKeys = ["ninerouterBaseUrl", "starnetTier", "starnetMemory", "starnetMaxToolCalls", "starnetMaxContextTokens", "starnetQaReviewer", "starnetSandbox", "starnetSandboxNetwork"];

  it("routes the codex ACP session through 9router when the sandbox is off", () => {
    const out = toCodexConfig({
      ninerouterBaseUrl: "https://tunnel.example.com/",
      model: "my-combo",
      instructionsFilePath: "/x/AGENTS.md",
      engine: "cli",
      starnetTier: "standard",
      starnetMemory: false,
      starnetMaxToolCalls: 10,
      starnetMaxContextTokens: 1000,
      starnetQaReviewer: "qa-agent",
      starnetSandbox: "off",
      starnetSandboxNetwork: true,
      env: { NINEROUTER_API_KEY: "sk-1", OTHER: "y" },
    });
    for (const key of starnetKeys) expect(out).not.toHaveProperty(key);
    expect(out).toMatchObject({ model: "my-combo", instructionsFilePath: "/x/AGENTS.md", engine: "acp" });
    const env = out.env as Record<string, string>;
    expect(env).toMatchObject({ NINEROUTER_API_KEY: "sk-1", OTHER: "y", MODEL_PROVIDER: "ninerouter" });
    expect(JSON.parse(env.CODEX_CONFIG).model_providers.ninerouter.base_url).toBe("https://tunnel.example.com/v1");
  });

  it("runs the sandboxed Codex CLI by default with the 9router provider as -c overrides", () => {
    const { config, sandboxed } = codexRunConfig({
      ninerouterBaseUrl: "http://127.0.0.1:20128",
      model: "m",
      starnetQaReviewer: "qa",
      env: { NINEROUTER_API_KEY: "sk-1" },
    });
    expect(sandboxed).toBe(true);
    for (const key of starnetKeys) expect(config).not.toHaveProperty(key);
    expect(config).toMatchObject({ engine: "cli", dangerouslyBypassApprovalsAndSandbox: false });
    const args = config.extraArgs as string[];
    expect(args).toContain('model_providers.ninerouter.base_url="http://127.0.0.1:20128/v1"');
    expect(args).toContain('sandbox_mode="workspace-write"');
    expect(args).toContain("sandbox_workspace_write.network_access=false");
  });

  it("fails clearly without a base URL", () => {
    expect(() => toCodexConfig({ model: "m" })).toThrow(/ninerouterBaseUrl/);
  });
});

describe("gateway Codex home", () => {
  it("gives runs their own home that codex_local launches without a Codex login", async () => {
    const config = withGatewayCodexHome({ env: { NINEROUTER_API_KEY: "sk-1" } }, "c1");
    const home = (config.env as Record<string, string>).CODEX_HOME;
    expect(home).toBe(gatewayCodexHome("c1"));
    expect(home).not.toContain(join("instances", "default", "companies"));
    const readiness = (configuredCodexHome: string | null) =>
      evaluateCodexCredentialReadiness({
        env: { PAPERCLIP_HOME: process.env.PAPERCLIP_HOME, CODEX_HOME: join(process.env.PAPERCLIP_HOME!, "no-host-login") },
        companyId: "c1",
        configuredCodexHome,
        configuredApiKey: null,
      });
    expect((await readiness(null)).ready).toBe(false);
    expect((await readiness(home)).ready).toBe(true);
  });

  it("keeps a CODEX_HOME the agent configures", () => {
    const config = { env: { CODEX_HOME: "/custom" } };
    expect(withGatewayCodexHome(config, "c1")).toBe(config);
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
    expect(getConfigSchema().fields.map((f) => f.key)).toEqual(["ninerouterBaseUrl", "model", "starnetMemory", "starnetMaxToolCalls", "starnetMaxContextTokens", "starnetQaReviewer", "starnetSandbox", "starnetSandboxNetwork"]);
    expect(typeof mod.syncSkills).toBe("function");
    expect(mod.supportsInstructionsBundle).toBe(true);
  });
});
