import { UNSUPPORTED_ADAPTERS, type AgentAdapter } from "./package-builder.js";

/** Marker the host writes over secret-looking values in agent API responses. */
export const REDACTED = "***REDACTED***";

/** Per-agent wiring that must not spread to every agent of a new office. */
const AGENT_SPECIFIC_KEYS = new Set(["starnetQaReviewer", "instructionsFilePath", "instructionsBundleMode", "instructionsRootPath", "instructionsEntryFile", "promptTemplate", "bootstrapPromptTemplate"]);

export interface SourceAgent {
  id: string;
  name: string;
  role?: string | null;
  status?: string | null;
  adapterType: string;
  adapterConfig?: Record<string, unknown> | null;
}

export interface CopiedAdapter {
  adapter: AgentAdapter;
  /** Config paths left out because the host redacted them (plain env values); the operator must re-enter these. */
  dropped: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function strip(value: unknown, path: string, dropped: string[]): unknown {
  if (value === REDACTED) {
    dropped.push(path);
    return undefined;
  }
  if (Array.isArray(value)) {
    if (value.some((v) => v === REDACTED)) {
      dropped.push(path);
      return undefined;
    }
    return value.map((v, i) => strip(v, `${path}[${i}]`, dropped));
  }
  if (!isRecord(value)) return value;
  if (value.type === "plain" && value.value === REDACTED) {
    dropped.push(path);
    return undefined;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    const next = strip(v, path ? `${path}.${k}` : k, dropped);
    if (next !== undefined) out[k] = next;
  }
  return out;
}

/**
 * Copy an existing agent's engine (adapter type + config) for new office agents. Secret references survive the host's
 * redaction; plain values it redacted are dropped and reported instead of being saved as the literal marker.
 */
export function copyAdapterFrom(agent: SourceAgent): CopiedAdapter {
  if (UNSUPPORTED_ADAPTERS.has(agent.adapterType)) throw new Error(`${agent.name} memakai adapter "${agent.adapterType}" yang tidak bisa disalin.`);
  const dropped: string[] = [];
  const base = isRecord(agent.adapterConfig) ? agent.adapterConfig : {};
  const kept: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(base)) {
    if (AGENT_SPECIFIC_KEYS.has(k)) continue;
    const next = strip(v, k, dropped);
    if (next !== undefined) kept[k] = next;
  }
  return { adapter: { type: agent.adapterType, config: kept }, dropped };
}

const PREFERRED = ["starnet_9router", "codex_local", "claude_local"];

export function engineCandidates(agents: SourceAgent[]): SourceAgent[] {
  return agents.filter((a) => a.status !== "terminated" && !UNSUPPORTED_ADAPTERS.has(a.adapterType));
}

export function defaultEngine(agents: SourceAgent[]): SourceAgent | undefined {
  const candidates = engineCandidates(agents);
  for (const type of PREFERRED) {
    const hit = candidates.find((a) => a.adapterType === type);
    if (hit) return hit;
  }
  return candidates[0];
}

export function defaultManager(agents: SourceAgent[]): SourceAgent | undefined {
  return agents.find((a) => a.status !== "terminated" && a.role === "ceo");
}
