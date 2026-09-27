import { describe, expect, it } from "vitest";
import { applyEvent, deriveDesk, type PresenceMap } from "../src/presence.js";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";

const T0 = "2026-09-27T00:00:00.000Z";
const T1 = "2026-09-27T00:00:05.000Z";
const agent = (status: string) => ({ id: "noc", name: "NOC Engineer", title: "NOC", status });

describe("applyEvent + deriveDesk", () => {
  it("run start -> busy with issue; run finish -> idle with last run", () => {
    let m: PresenceMap = {};
    m = applyEvent(m, { eventType: "agent.run.started", occurredAt: T0, entityId: "run-1", payload: { agentId: "noc", runId: "run-1", issueId: "iss-1", startedAt: T0 } });
    expect(deriveDesk(agent("running"), m.noc)).toMatchObject({ state: "busy", runId: "run-1", issueId: "iss-1", since: T0 });
    m = applyEvent(m, { eventType: "agent.run.finished", occurredAt: T1, entityId: "run-1", payload: { agentId: "noc", runId: "run-1", status: "succeeded", issueId: "iss-1", finishedAt: T1 } });
    expect(deriveDesk(agent("idle"), m.noc)).toMatchObject({ state: "idle", runId: null, issueId: null, lastRun: { runId: "run-1", status: "succeeded" }, lastActivityAt: T1 });
  });
  it("never invents state: no events -> idle, core status wins over stale events", () => {
    expect(deriveDesk(agent("idle"), undefined)).toMatchObject({ state: "idle", lastActivity: null, lastActivityAt: null });
    const m = applyEvent({}, { eventType: "agent.run.started", occurredAt: T0, payload: { agentId: "noc", runId: "r" } });
    expect(deriveDesk(agent("idle"), m.noc).state).toBe("idle"); // missed finish event does not leave a ghost "busy"
    expect(deriveDesk(agent("running"), undefined)).toMatchObject({ state: "busy", issueId: null }); // core says running
    expect(deriveDesk(agent("paused"), undefined).state).toBe("paused");
    expect(deriveDesk(agent("error"), undefined).state).toBe("error");
  });
  it("ignores events without an agent and older runs finishing", () => {
    const m0: PresenceMap = {};
    expect(applyEvent(m0, { eventType: "issue.comment.created", occurredAt: T0, payload: {} })).toBe(m0);
    let m = applyEvent({}, { eventType: "agent.run.started", occurredAt: T0, payload: { agentId: "noc", runId: "new" } });
    m = applyEvent(m, { eventType: "agent.run.failed", occurredAt: T1, payload: { agentId: "noc", runId: "old", status: "failed" } });
    expect(m.noc).toMatchObject({ runId: "new", lastRun: { runId: "old", status: "failed" } });
  });
});

describe("worker (harness)", () => {
  it("serves desks from agents + events", async () => {
    const h = createTestHarness({ manifest });
    h.seed({ agents: [{ id: "noc", companyId: "c1", name: "NOC Engineer", title: "NOC", role: "engineer", status: "running" } as never] });
    await plugin.definition.setup(h.ctx);
    await h.emit("agent.run.started", { agentId: "noc", runId: "run-1", issueId: null, startedAt: T0 }, { companyId: "c1", entityId: "run-1", entityType: "heartbeat_run", occurredAt: T0 });
    const office = await h.getData<{ counts: Record<string, number>; desks: Array<{ state: string; runId: string | null }>; log: unknown[] }>("office", { companyId: "c1" });
    expect(office.counts).toMatchObject({ total: 1, busy: 1 });
    expect(office.desks[0]).toMatchObject({ state: "busy", runId: "run-1" });
    expect(office.log).toHaveLength(1);
  });
});
