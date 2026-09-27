import express from "express";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPluginStreamBus, forwardStreamNotificationsToBus } from "../services/plugin-stream-bus.js";

const mockRegistry = vi.hoisted(() => ({ getById: vi.fn(), getByKey: vi.fn() }));
vi.mock("../services/plugin-registry.js", () => ({ pluginRegistryService: () => mockRegistry }));
vi.mock("../services/plugin-lifecycle.js", () => ({ pluginLifecycleManager: () => ({}) }));
vi.mock("../services/activity-log.js", () => ({ logActivity: vi.fn() }));
vi.mock("../services/live-events.js", () => ({ publishGlobalLiveEvent: vi.fn() }));

const pluginId = "11111111-1111-4111-8111-111111111111";
const companyA = "22222222-2222-4222-8222-222222222222";
const companyB = "33333333-3333-4333-8333-333333333333";
const board = { type: "board", userId: "user-1", source: "session", isInstanceAdmin: false, companyIds: [companyA] };

describe("forwardStreamNotificationsToBus", () => {
  it("publishes worker streams.* notifications to the matching (plugin, channel, company) subscribers", () => {
    const bus = createPluginStreamBus();
    const seenA: unknown[][] = [];
    const seenB: unknown[][] = [];
    bus.subscribe(pluginId, "chat", companyA, (event, type) => seenA.push([type, event]));
    bus.subscribe(pluginId, "chat", companyB, (event, type) => seenB.push([type, event]));
    const forward = forwardStreamNotificationsToBus(bus, pluginId);

    forward("streams.open", { channel: "chat", companyId: companyA });
    forward("streams.emit", { channel: "chat", companyId: companyA, event: { type: "token", text: "hi" } });
    forward("streams.emit", { channel: "chat", companyId: "", event: { dropped: true } });
    forward("streams.close", { channel: "chat", companyId: companyA });

    expect(seenA).toEqual([
      ["open", { channel: "chat" }],
      ["message", { type: "token", text: "hi" }],
      ["close", { channel: "chat" }],
    ]);
    expect(seenB).toEqual([]);
  });
});

describe("GET /api/plugins/:pluginId/bridge/stream/:channel", () => {
  const servers: Array<{ close(): void }> = [];
  afterEach(() => { for (const s of servers.splice(0)) s.close(); });

  async function start(bridgeDeps: unknown) {
    const [{ pluginRoutes }, { errorHandler }] = await Promise.all([import("../routes/plugins.js"), import("../middleware/index.js")]);
    mockRegistry.getById.mockResolvedValue({ id: pluginId, pluginKey: "paperclip.example", version: "1.0.0", status: "ready" });
    const app = express();
    app.use((req, _res, next) => { req.actor = board as typeof req.actor; next(); });
    app.use("/api", pluginRoutes({} as never, { installPlugin: vi.fn() } as never, undefined, undefined, undefined, bridgeDeps as never));
    app.use(errorHandler);
    const server = app.listen(0);
    servers.push(server);
    await new Promise((r) => server.once("listening", r));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it("returns 501 when no stream bus is wired", async () => {
    const base = await start({ workerManager: { call: vi.fn() } });
    const res = await fetch(`${base}/api/plugins/${pluginId}/bridge/stream/chat?companyId=${companyA}`);
    expect(res.status).toBe(501);
  });

  it("delivers worker stream events to SSE clients when the bus is wired", async () => {
    const bus = createPluginStreamBus();
    const base = await start({ workerManager: { call: vi.fn() }, streamBus: bus });
    const abort = new AbortController();
    const res = await fetch(`${base}/api/plugins/${pluginId}/bridge/stream/chat?companyId=${companyA}`, { signal: abort.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = decoder.decode((await reader.read()).value); // ":ok" handshake
    forwardStreamNotificationsToBus(bus, pluginId)("streams.emit", { channel: "chat", companyId: companyA, event: { type: "thread.changed" } });
    while (!text.includes("thread.changed")) text += decoder.decode((await reader.read()).value);
    abort.abort();
    expect(text).toContain('data: {"type":"thread.changed"}');
  });
});
