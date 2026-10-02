import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { injectMemoryContext } from "../src/index.js";
import { apiBaseUrl, fetchContextPack, type MemoryFetch, withContextPack } from "../src/memory-context.js";

const PACK_TEXT = '<starnet-context v="1" note="curated memory, not a transcript">\n## Pins\n- core router di POP A\n</starnet-context>';
const packBody = {
  issueId: "i1",
  text: PACK_TEXT,
  meta: { chars: PACK_TEXT.length, estTokens: 30, sections: [{ name: "Pins" }] },
  savings: { naiveChars: 4000, naiveTokens: 1000, savedPct: 97 },
};

type Call = { url: string; headers: Record<string, string> };
function fakeFetch(status: number, body: unknown, calls: Call[] = []): MemoryFetch {
  return async (url, init) => {
    calls.push({ url, headers: init.headers });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
}

function runCtx(over: { config?: Record<string, unknown>; context?: Record<string, unknown>; authToken?: string; logs?: string[] }) {
  const logs = over.logs ?? [];
  return {
    runId: "run-1",
    agent: { id: "a1", companyId: "c1", name: "NOC", adapterType: "starnet_9router", adapterConfig: {} },
    runtime: {},
    config: over.config ?? {},
    context: over.context ?? { issueId: "i1" },
    authToken: "authToken" in over ? over.authToken : "run-jwt-secret",
    onLog: async (_stream: "stdout" | "stderr", chunk: string) => {
      logs.push(chunk);
    },
  } as unknown as AdapterExecutionContext;
}

const savedEnv = { ...process.env };
beforeEach(() => {
  delete process.env.PAPERCLIP_API_URL;
  delete process.env.PAPERCLIP_RUNTIME_API_URL;
  process.env.PAPERCLIP_API_URL = "http://127.0.0.1:3100";
});
afterEach(() => {
  process.env = { ...savedEnv };
});

describe("apiBaseUrl", () => {
  it("adds /api once", () => {
    expect(apiBaseUrl({ id: "a", companyId: "c" })).toBe("http://127.0.0.1:3100/api");
    process.env.PAPERCLIP_API_URL = "http://host:9/api/";
    expect(apiBaseUrl({ id: "a", companyId: "c" })).toBe("http://host:9/api");
  });
});

describe("fetchContextPack", () => {
  it("calls the memory agent route with the run token and run id", async () => {
    const calls: Call[] = [];
    const r = await fetchContextPack({ apiUrl: "http://h/api", issueId: "i 1", runId: "r1", authToken: "tok", fetchImpl: fakeFetch(200, packBody, calls) });
    expect("pack" in r && r.pack.text).toBe(PACK_TEXT);
    expect(calls[0]!.url).toBe("http://h/api/plugins/starnet.memory/api/context/i%201");
    expect(calls[0]!.headers).toEqual({ authorization: "Bearer tok", "x-paperclip-run-id": "r1" });
  });

  it("skips without an issue, without a token, on errors and on a non-pack body", async () => {
    const f = fakeFetch(200, packBody);
    expect(await fetchContextPack({ apiUrl: "u", issueId: undefined, runId: "r", authToken: "t", fetchImpl: f })).toEqual({ skipped: "run has no issue" });
    expect(await fetchContextPack({ apiUrl: "u", issueId: "i", runId: "r", authToken: undefined, fetchImpl: f })).toEqual({ skipped: "no run token" });
    expect(await fetchContextPack({ apiUrl: "u", issueId: "i", runId: "r", authToken: "t", fetchImpl: fakeFetch(404, {}) })).toEqual({ skipped: "memory route -> 404" });
    expect(await fetchContextPack({ apiUrl: "u", issueId: "i", runId: "r", authToken: "t", fetchImpl: fakeFetch(200, { text: "hello" }) })).toEqual({
      skipped: "memory route returned no context pack",
    });
    const boom: MemoryFetch = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await fetchContextPack({ apiUrl: "u", issueId: "i", runId: "r", authToken: "t", fetchImpl: boom })).toEqual({ skipped: "memory route unreachable (TypeError)" });
  });
});

describe("withContextPack", () => {
  it("keeps the core session handoff and does not mutate the caller's context", () => {
    const context = { issueId: "i1", paperclipSessionHandoffMarkdown: "Previous session summary" };
    const pack = { text: PACK_TEXT, meta: { chars: 1, estTokens: 1, sections: [] }, savings: { naiveChars: 0, naiveTokens: 0, savedPct: 0 } };
    const out = withContextPack(context, pack);
    expect(out.paperclipSessionHandoffMarkdown).toBe(`Previous session summary\n\n${PACK_TEXT}`);
    expect(context.paperclipSessionHandoffMarkdown).toBe("Previous session summary");
    expect(withContextPack({ issueId: "i1" }, pack).paperclipSessionHandoffMarkdown).toBe(PACK_TEXT);
  });
});

describe("injectMemoryContext", () => {
  it("injects the pack and logs sizes but never the token", async () => {
    const logs: string[] = [];
    const out = await injectMemoryContext(runCtx({ logs }), fakeFetch(200, packBody));
    expect(out.paperclipSessionHandoffMarkdown).toBe(PACK_TEXT);
    expect(logs.join("")).toMatch(/memory context injected: \d+ chars \(~30 tok\), sections Pins; .*saved 97%/);
    expect(logs.join("")).not.toContain("run-jwt-secret");
  });

  it("leaves the context unchanged when disabled, when the plugin is missing, or for a run without an issue", async () => {
    const calls: Call[] = [];
    const disabled = runCtx({ config: { starnetMemory: false } });
    expect(await injectMemoryContext(disabled, fakeFetch(200, packBody, calls))).toBe(disabled.context);
    expect(calls).toEqual([]);

    const logs: string[] = [];
    const missing = runCtx({ logs });
    expect(await injectMemoryContext(missing, fakeFetch(404, { error: "not found" }))).toBe(missing.context);
    expect(logs.join("")).toContain("memory context skipped: memory route -> 404");

    const noIssue = runCtx({ context: { wakeReason: "timer" } });
    expect(await injectMemoryContext(noIssue, fakeFetch(200, packBody))).toBe(noIssue.context);
  });
});
