import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bundledCodexBinary, sandboxArgs, sandboxedCodexConfig, sandboxMode, sandboxNetwork } from "../src/sandbox.js";

const gateway = { id: "ninerouter", name: "9router", baseUrl: "http://r/v1", envKey: "NINEROUTER_API_KEY" };

describe("sandbox settings", () => {
  it("defaults to workspace-write without network", () => {
    expect(sandboxMode({})).toBe("workspace-write");
    expect(sandboxMode({ starnetSandbox: "off" })).toBe("off");
    expect(sandboxMode({ starnetSandbox: "anything" })).toBe("workspace-write");
    expect(sandboxNetwork({})).toBe(false);
    expect(sandboxNetwork({ starnetSandboxNetwork: true })).toBe(true);
  });

  it("selects the gateway provider and confines shell commands", () => {
    const args = sandboxArgs(gateway, false, "win32");
    expect(args.filter((a) => a !== "-c")).toEqual([
      'model_provider="ninerouter"',
      'model_providers.ninerouter.name="9router"',
      'model_providers.ninerouter.base_url="http://r/v1"',
      'model_providers.ninerouter.env_key="NINEROUTER_API_KEY"',
      'model_providers.ninerouter.wire_api="responses"',
      'sandbox_mode="workspace-write"',
      "sandbox_workspace_write.network_access=false",
      'windows.sandbox="unelevated"',
      "--skip-git-repo-check",
    ]);
    expect(sandboxArgs(gateway, true, "linux")).not.toContain('windows.sandbox="unelevated"');
    expect(sandboxArgs(gateway, true, "linux")).toContain("sandbox_workspace_write.network_access=true");
  });
});

describe("sandboxedCodexConfig", () => {
  it("forces the CLI engine and drops operator args that would widen the sandbox", () => {
    const { config, dropped } = sandboxedCodexConfig(
      {
        engine: "acp",
        model: "m",
        dangerouslyBypassApprovalsAndSandbox: true,
        extraArgs: ["--yolo", "-c", 'sandbox_mode="danger-full-access"', "--config=sandbox_workspace_write.network_access=true", "-c", 'model_reasoning_effort="high"', "--search"],
      },
      gateway,
      false,
      "C:/codex.exe",
    );
    expect(config).toMatchObject({ engine: "cli", command: "C:/codex.exe", dangerouslyBypassApprovalsAndSandbox: false, model: "m" });
    expect(dropped).toEqual(["--yolo", "-c", 'sandbox_mode="danger-full-access"', "--config=sandbox_workspace_write.network_access=true"]);
    const args = config.extraArgs as string[];
    expect(args.slice(0, 3)).toEqual(["-c", 'model_reasoning_effort="high"', "--search"]);
    expect(args).toContain('sandbox_mode="workspace-write"');
  });

  it("keeps an operator command and falls back to PATH codex without a bundled binary", () => {
    expect(sandboxedCodexConfig({ command: "/opt/codex" }, gateway, false, "/bundled").config.command).toBe("/opt/codex");
    expect(sandboxedCodexConfig({}, gateway, false, null).config).not.toHaveProperty("command");
  });
});

describe("bundledCodexBinary", () => {
  it("finds the native binary of the @openai/codex dependency", () => {
    const binary = bundledCodexBinary();
    expect(binary).not.toBeNull();
    expect(existsSync(binary!)).toBe(true);
    expect(bundledCodexBinary("sunos", "x64")).toBeNull();
  });
});
