import { describe, expect, it } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";
import { emptyThread, runNote, syncIssue, taskBrief, track, type Thread } from "../src/thread.js";

const C = "company-1";
let n = 0;
const id = () => `m${++n}`;

describe("thread mapping (pure)", () => {
  const base = (): Thread => track(emptyThread(), "iss-1", { messageId: "op-1", agentId: "noc", agentName: "NOC Engineer", identifier: "STA-10" });

  it("relays only new agent comments and status changes, once", () => {
    const comments = [{ id: "c1", body: "137 sesi PPPoE aktif", authorAgentId: "noc" }, { id: "c2", body: "board note", authorAgentId: null }];
    const t1 = syncIssue(base(), "iss-1", { status: "done" }, comments, id);
    expect(t1.messages.map((m) => [m.role, m.text])).toEqual([["agent", "137 sesi PPPoE aktif"], ["office", "STA-10 selesai ✅"]]);
    expect(t1.messages[0]).toMatchObject({ agentName: "NOC Engineer", issueIdentifier: "STA-10" });
    const t2 = syncIssue(t1, "iss-1", { status: "done" }, comments, id);
    expect(t2).toBe(t1); // idempotent: no duplicate relay
  });
  it("keeps chronological order when the status event is processed before the comment", () => {
    const t1 = syncIssue(base(), "iss-1", { status: "done" }, [], id);
    const t2 = syncIssue(t1, "iss-1", { status: "done" }, [{ id: "c1", body: "hasil", authorAgentId: "noc", createdAt: "2000-01-01T00:00:00.000Z" }], id);
    expect(t2.messages.map((m) => m.role)).toEqual(["agent", "office"]);
  });
  it("moves an earlier status note after a reply that arrives later with a newer timestamp", () => {
    const t1 = syncIssue(base(), "iss-1", { status: "done" }, [], id);
    const future = new Date(Date.now() + 5000).toISOString();
    const t2 = syncIssue(t1, "iss-1", { status: "done" }, [{ id: "c1", body: "hasil", authorAgentId: "noc", createdAt: future }], id);
    expect(t2.messages.map((m) => [m.role, m.text])).toEqual([["agent", "hasil"], ["office", "STA-10 selesai ✅"]]);
  });
  it("ignores issues that did not come from the chat", () => {
    const t = base();
    expect(syncIssue(t, "other", { status: "done" }, [{ id: "x", body: "hi", authorAgentId: "noc" }], id)).toBe(t);
    expect(runNote(t, "agent.run.started", { issueId: "other" }, id)).toBeNull();
  });
  it("maps run lifecycle to office notes", () => {
    expect(runNote(base(), "agent.run.started", { issueId: "iss-1" }, id)?.text).toBe("NOC Engineer mulai mengerjakan STA-10…");
    expect(runNote(base(), "agent.run.failed", { issueId: "iss-1", error: "exit 1" }, id)?.text).toMatch(/gagal: exit 1/);
    expect(runNote(base(), "agent.run.finished", { issueId: "iss-1" }, id)).toBeNull();
  });
  it("gives the agent only the single request (role isolation)", () => {
    expect(taskBrief("cek PPPoE")).toContain("> cek PPPoE");
  });
});

describe("worker (harness)", () => {
  async function setup() {
    const h = createTestHarness({ manifest });
    const now = new Date();
    h.seed({ agents: [{ id: "noc", companyId: C, name: "NOC Engineer", title: "NOC Engineer", role: "engineer", status: "idle", capabilities: "PPPoE and router monitoring" } as never] });
    await plugin.definition.setup(h.ctx);
    return { h, now };
  }

  it("turns a request into an assigned issue and relays the agent reply", async () => {
    const { h } = await setup();
    await h.performAction("send", { companyId: C, text: "cek PPPoE aktif di router" });
    const issues = await h.ctx.issues.list({ companyId: C });
    expect(issues).toHaveLength(1);
    const issue = issues[0]!;
    expect(issue).toMatchObject({ assigneeAgentId: "noc", title: "Cek PPPoE aktif di router" });
    expect(issue.description).not.toContain("selamat"); // only this request

    let thread = await h.getData<{ messages: Array<{ role: string; text: string }> }>("thread", { companyId: C });
    expect(thread.messages.map((m) => m.role)).toEqual(["operator", "office"]);
    expect(thread.messages[1]!.text).toMatch(/untuk NOC Engineer/);

    // The reply is written after the run starts; keep its timestamp later than the run note
    // so the chronological thread order is deterministic (no same/next-millisecond flake).
    const replyAt = new Date(Date.now() + 1000);
    h.seed({ issueComments: [{ id: "c1", issueId: issue.id, companyId: C, body: "Ada 137 sesi PPPoE aktif.", authorAgentId: "noc", authorUserId: null, createdAt: replyAt, updatedAt: replyAt } as never] });
    await h.emit("agent.run.started", { issueId: issue.id, agentId: "noc" }, { companyId: C, entityId: "run-1", entityType: "heartbeat_run" });
    await h.emit("issue.comment.created", { agentId: "noc" }, { companyId: C, entityId: issue.id, entityType: "issue" });
    thread = await h.getData("thread", { companyId: C });
    const texts = thread.messages.map((m) => m.text);
    expect(texts.some((t) => t.startsWith("NOC Engineer mulai mengerjakan"))).toBe(true);
    expect(thread.messages.at(-1)).toMatchObject({ role: "agent", text: "Ada 137 sesi PPPoE aktif." });
  });

  it("answers small talk without creating issues", async () => {
    const { h } = await setup();
    await h.performAction("send", { companyId: C, text: "selamat pagi" });
    expect(await h.ctx.issues.list({ companyId: C })).toHaveLength(0);
  });
});
