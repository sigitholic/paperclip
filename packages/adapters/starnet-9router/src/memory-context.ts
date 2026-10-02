/**
 * Starnet Memory context injection (Phase 2, "konteks tersuntik").
 *
 * Before the Codex run starts, the adapter pulls the curated `<starnet-context v="1">` pack for the
 * run's issue from the `starnet.memory` agent route, authenticated with the run's own token, and
 * appends it to `context.paperclipSessionHandoffMarkdown`. Both Codex lanes (exec and ACP) put that
 * field in every prompt, including resumed sessions, and report its size as `sessionHandoffChars`.
 *
 * Best effort: a missing plugin, a non-issue run or any error leaves the run unchanged.
 */
import { buildPaperclipEnv } from "@paperclipai/adapter-utils/server-utils";

export const MEMORY_CONFIG_KEY = "starnetMemory";
export const MEMORY_PLUGIN_KEY = "starnet.memory";
const HANDOFF_KEY = "paperclipSessionHandoffMarkdown";
const BUNDLE_PREFIX = "<starnet-context";

export type MemoryFetch = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type ContextPack = {
  text: string;
  meta: { chars: number; estTokens: number; sections: { name: string }[] };
  savings: { naiveChars: number; naiveTokens: number; savedPct: number };
};

export type ContextPackResult = { pack: ContextPack } | { skipped: string };

const asString = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function memoryEnabled(config: Record<string, unknown>): boolean {
  return config[MEMORY_CONFIG_KEY] !== false;
}

export function apiBaseUrl(agent: { id: string; companyId: string }): string {
  const raw = buildPaperclipEnv(agent).PAPERCLIP_API_URL!.replace(/\/+$/, "");
  return raw.endsWith("/api") ? raw : `${raw}/api`;
}

function toPack(body: unknown): ContextPack | null {
  const rec = asRecord(body);
  const text = asString(rec.text);
  if (!text || !text.startsWith(BUNDLE_PREFIX)) return null;
  const meta = asRecord(rec.meta);
  const savings = asRecord(rec.savings);
  const sections = Array.isArray(meta.sections) ? meta.sections.map((s) => ({ name: asString(asRecord(s).name) ?? "?" })) : [];
  return {
    text,
    meta: { chars: num(meta.chars) || text.length, estTokens: num(meta.estTokens), sections },
    savings: { naiveChars: num(savings.naiveChars), naiveTokens: num(savings.naiveTokens), savedPct: num(savings.savedPct) },
  };
}

export async function fetchContextPack(input: {
  apiUrl: string;
  issueId: string | undefined;
  runId: string;
  authToken: string | undefined;
  fetchImpl?: MemoryFetch;
  timeoutMs?: number;
}): Promise<ContextPackResult> {
  if (!input.issueId) return { skipped: "run has no issue" };
  if (!input.authToken) return { skipped: "no run token" };
  const url = `${input.apiUrl}/plugins/${MEMORY_PLUGIN_KEY}/api/context/${encodeURIComponent(input.issueId)}`;
  const fetchImpl = input.fetchImpl ?? (fetch as unknown as MemoryFetch);
  try {
    const res = await fetchImpl(url, {
      headers: { authorization: `Bearer ${input.authToken}`, "x-paperclip-run-id": input.runId },
      signal: AbortSignal.timeout(input.timeoutMs ?? 5_000),
    });
    if (!res.ok) return { skipped: `memory route -> ${res.status}` };
    const pack = toPack(await res.json());
    return pack ? { pack } : { skipped: "memory route returned no context pack" };
  } catch (err) {
    return { skipped: `memory route unreachable (${err instanceof Error ? err.name : "error"})` };
  }
}

/** A copy of the run context with the pack appended to the session handoff note; the caller's object is not touched. */
export function withContextPack(context: Record<string, unknown>, pack: ContextPack): Record<string, unknown> {
  const existing = asString(context[HANDOFF_KEY]);
  return { ...context, [HANDOFF_KEY]: existing ? `${existing}\n\n${pack.text}` : pack.text };
}

export function describePack(pack: ContextPack): string {
  const sections = pack.meta.sections.map((s) => s.name).join("+") || "-";
  return (
    `[starnet] memory context injected: ${pack.meta.chars} chars (~${pack.meta.estTokens} tok), sections ${sections}; ` +
    `naive history ${pack.savings.naiveChars} chars (~${pack.savings.naiveTokens} tok), saved ${pack.savings.savedPct}%\n`
  );
}
