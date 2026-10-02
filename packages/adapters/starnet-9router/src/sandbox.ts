/**
 * Starnet sandbox (Phase 2, "sandbox"): run Codex through its CLI engine with the Codex
 * `workspace-write` sandbox instead of the ACP engine with full host access.
 *
 * Core remote environments (SSH, sandbox providers) are limited to a hard-coded list of adapter
 * types, and core's local process sandbox is Linux-only and unsupported by ACP. Codex's own
 * sandbox works on Windows (restricted token), Linux and macOS: shell commands can write only to
 * the workspace and temp dirs, and with network access off they reach only loopback (the
 * Paperclip API) - not the internet or customer devices. Reads are not confined.
 *
 * codex-acp reads the gateway from `MODEL_PROVIDER`/`CODEX_CONFIG`; the CLI does not, so the
 * 9router provider is passed as `-c model_providers.*` overrides.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export const SANDBOX_KEY = "starnetSandbox";
export const SANDBOX_NETWORK_KEY = "starnetSandboxNetwork";
export const SANDBOX_MODES = ["workspace-write", "off"] as const;
export type SandboxMode = (typeof SANDBOX_MODES)[number];
export const DEFAULT_SANDBOX_MODE: SandboxMode = "workspace-write";

export type CodexGatewayProvider = { id: string; name: string; baseUrl: string; envKey: string };

export function sandboxMode(config: Record<string, unknown>): SandboxMode {
  const raw = config[SANDBOX_KEY];
  return raw === "off" || raw === false ? "off" : DEFAULT_SANDBOX_MODE;
}

export function sandboxNetwork(config: Record<string, unknown>): boolean {
  return config[SANDBOX_NETWORK_KEY] === true;
}

const PLATFORM_TARGETS: Record<string, { triple: string; pkg: string }> = {
  "win32-x64": { triple: "x86_64-pc-windows-msvc", pkg: "@openai/codex-win32-x64" },
  "win32-arm64": { triple: "aarch64-pc-windows-msvc", pkg: "@openai/codex-win32-arm64" },
  "linux-x64": { triple: "x86_64-unknown-linux-musl", pkg: "@openai/codex-linux-x64" },
  "linux-arm64": { triple: "aarch64-unknown-linux-musl", pkg: "@openai/codex-linux-arm64" },
  "darwin-x64": { triple: "x86_64-apple-darwin", pkg: "@openai/codex-darwin-x64" },
  "darwin-arm64": { triple: "aarch64-apple-darwin", pkg: "@openai/codex-darwin-arm64" },
};

/**
 * Native Codex binary shipped by the `@openai/codex` dependency, or null. Spawned directly:
 * the package's `bin/codex.js` is a Node script that Windows cannot execute as a command.
 */
export function bundledCodexBinary(platform = process.platform, arch = process.arch): string | null {
  const target = PLATFORM_TARGETS[`${platform}-${arch}`];
  if (!target) return null;
  try {
    const codexRequire = createRequire(createRequire(import.meta.url).resolve("@openai/codex/package.json"));
    const vendor = path.join(path.dirname(codexRequire.resolve(`${target.pkg}/package.json`)), "vendor");
    const binary = path.join(vendor, target.triple, "bin", platform === "win32" ? "codex.exe" : "codex");
    return existsSync(binary) ? binary : null;
  } catch {
    return null;
  }
}

const toml = (value: string) => JSON.stringify(value);
const SKIP_GIT_REPO_CHECK = "--skip-git-repo-check";

/** `-c` overrides that select the gateway provider and confine shell commands. */
export function sandboxArgs(gateway: CodexGatewayProvider, network: boolean, platform = process.platform): string[] {
  const p = `model_providers.${gateway.id}`;
  return [
    "-c", `model_provider=${toml(gateway.id)}`,
    "-c", `${p}.name=${toml(gateway.name)}`,
    "-c", `${p}.base_url=${toml(gateway.baseUrl)}`,
    "-c", `${p}.env_key=${toml(gateway.envKey)}`,
    "-c", `${p}.wire_api="responses"`,
    "-c", 'sandbox_mode="workspace-write"',
    "-c", `sandbox_workspace_write.network_access=${network}`,
    ...(platform === "win32" ? ["-c", 'windows.sandbox="unelevated"'] : []),
    // Agent fallback workspaces are not git repos; the sandbox, not git trust, confines writes.
    SKIP_GIT_REPO_CHECK,
  ];
}

const SANDBOX_OVERRIDE = /^(--sandbox(?:=|$)|-s$|--full-auto$|--yolo$|--dangerously-bypass-approvals-and-sandbox$)|^(?:(?:--config=|-c=?)\s*)?(?:sandbox_mode|sandbox_workspace_write\.|windows\.sandbox|model_provider)/;

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Codex CLI config for a sandboxed run. Operator `extraArgs` that would widen or replace the
 * sandbox or provider are dropped (with their `-c` prefix), so the confinement is not optional.
 */
export function sandboxedCodexConfig(
  codexConfig: Record<string, unknown>,
  gateway: CodexGatewayProvider,
  network: boolean,
  binary: string | null = bundledCodexBinary(),
): { config: Record<string, unknown>; dropped: string[] } {
  const extra = stringArray(codexConfig.extraArgs).length ? stringArray(codexConfig.extraArgs) : stringArray(codexConfig.args);
  const kept: string[] = [];
  const dropped: string[] = [];
  for (let i = 0; i < extra.length; i += 1) {
    const arg = extra[i]!;
    const next = extra[i + 1];
    if ((arg === "-c" || arg === "--config") && next !== undefined && SANDBOX_OVERRIDE.test(next)) {
      dropped.push(arg, next);
      i += 1;
    } else if (SANDBOX_OVERRIDE.test(arg)) {
      dropped.push(arg);
    } else if (arg !== SKIP_GIT_REPO_CHECK) {
      kept.push(arg);
    }
  }
  const { args: _args, dangerouslyBypassSandbox: _legacyBypass, ...rest } = codexConfig;
  const command = typeof codexConfig.command === "string" && codexConfig.command.trim() ? codexConfig.command : binary;
  return {
    config: {
      ...rest,
      engine: "cli",
      ...(command ? { command } : {}),
      dangerouslyBypassApprovalsAndSandbox: false,
      extraArgs: [...kept, ...sandboxArgs(gateway, network)],
    },
    dropped,
  };
}
