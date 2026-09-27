// E2E against the local Paperclip instance (skips when it is not running):
//   Office Chat message -> issue for NOC Engineer -> process run calls the ISP pack tools
//   through the tool gateway -> agent reply in the chat thread -> issue done
//   -> Virtual Office busy/idle, all observed through the plugin SSE streams (P-0).
// Plus: manual routine run -> agent run start latency (plan step 0.4).
// Run: pnpm --filter @starnet/devkit e2e   (seeds "Starnet Demo" idempotently first)
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, waitFor } from "../lib/api.mjs";
import { subscribe } from "../lib/sse.mjs";
import { STATE_FILE } from "../lib/state.mjs";
import { startFakeGenieACS } from "../fake/genieacs.mjs";
import { startFakeRouterOS } from "../fake/routeros.mjs";
import { seedDemo } from "../scripts/demo-seed.mjs";

const api = client();
const up = await api.healthy();
const report = { startedAt: new Date().toISOString(), base: api.base };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!up)("Starnet office flow (local instance)", () => {
  let s, office, chat, fakes = [];
  const pid = (k) => s.plugins[k];

  beforeAll(async () => {
    s = await seedDemo({ log: () => {} });
    report.company = `${s.companyName} [${s.issuePrefix}]`;
    report.mode = s.mode;
    if (s.mode === "live") {
      fakes = [
        await startFakeRouterOS({ port: s.fake.routerosPort, username: s.fake.routerosUser, password: s.fake.routerosPassword }),
        await startFakeGenieACS({ port: s.fake.genieacsPort }),
      ];
    }
    office = subscribe(api.base, pid("starnet.virtual-office"), "office", s.companyId);
    chat = subscribe(api.base, pid("starnet.office-chat"), "chat", s.companyId);
    await Promise.all([office.ready, chat.ready]);
    await waitFor(async () => (await api.get(`/agents/${s.nocAgentId}`)).status === "idle", { what: "NOC idle before start", timeoutMs: 60_000 });
  }, 90_000);

  afterAll(async () => {
    office?.close(); chat?.close();
    await Promise.all(fakes.map((f) => f.close()));
    report.finishedAt = new Date().toISOString();
    writeFileSync(join(dirname(STATE_FILE), "last-e2e.json"), JSON.stringify(report, null, 2) + "\n");
    console.log("E2E report:", JSON.stringify(report, null, 2));
  });

  it("chat -> issue -> NOC run -> reply -> done, Virtual Office busy/idle via streams", async () => {
    const t0 = Date.now();
    const sent = await api.action(pid("starnet.office-chat"), "send", s.companyId, { text: "cek PPPoE aktif di router" });
    const ack = sent.messages.at(-1);
    expect(ack.role).toBe("office");
    expect(ack.text).toMatch(/untuk NOC Engineer/);
    const issueId = ack.issueId;
    expect(issueId).toBeTruthy();
    const issue = await api.get(`/issues/${issueId}`);
    expect(issue.assigneeAgentId).toBe(s.nocAgentId);

    const startEv = await waitFor(() => office.events.find((e) => e.receivedAt >= t0 && e.agentId === s.nocAgentId && e.eventType === "agent.run.started"), { what: "office stream agent.run.started" });
    // Virtual Office must show the desk busy while the run is live (core flips the agent status
    // to running around run start; the mock run lasts ~1 s, so sample every 50 ms).
    let busyAt = null;
    while (busyAt === null && !office.events.some((e) => e.receivedAt >= t0 && e.agentId === s.nocAgentId && e.eventType === "agent.run.finished")) {
      const desk = (await api.data(pid("starnet.virtual-office"), "office", s.companyId)).desks.find((d) => d.agentId === s.nocAgentId);
      if (desk?.state === "busy") busyAt = Date.now();
      else await sleep(50);
    }
    expect(busyAt, "desk seen busy before the run finished").not.toBeNull();

    const reply = await waitFor(async () => {
      const t = await api.data(pid("starnet.office-chat"), "thread", s.companyId);
      return t.messages.find((m) => m.role === "agent" && m.issueId === issueId);
    }, { what: "agent reply in chat thread", timeoutMs: 60_000 });
    const tReply = Date.now();
    expect(reply.text).toMatch(/PPPoE/);

    await waitFor(async () => (await api.get(`/issues/${issueId}`)).status === "done", { what: "issue done", timeoutMs: 30_000 });
    const finishEv = await waitFor(() => office.events.find((e) => e.receivedAt >= t0 && e.agentId === s.nocAgentId && e.eventType === "agent.run.finished"), { what: "office stream agent.run.finished" });
    await waitFor(async () => (await api.data(pid("starnet.virtual-office"), "office", s.companyId)).desks.find((d) => d.agentId === s.nocAgentId)?.state === "idle", { what: "desk idle", timeoutMs: 15_000 });
    const tIdle = Date.now();
    const chatEvents = chat.events.filter((e) => e.receivedAt >= t0 && e.type === "thread.changed").length;
    expect(chatEvents).toBeGreaterThanOrEqual(2);

    if (s.mode === "live") {
      const [ros, acs] = fakes;
      expect(ros.requests.some((r) => r.path === "/rest/ppp/active" && r.auth)).toBe(true);
      expect(acs.requests.some((r) => r.path.startsWith("/devices"))).toBe(true);
      expect(reply.text).toMatch(/FAKE-CCR2004/);
      report.fakeRequests = { routeros: ros.requests.length, genieacs: acs.requests.length };
    } else {
      expect(reply.text).toMatch(/MOCK/);
    }

    report.chatFlow = {
      issue: issue.identifier,
      msToRunStarted: startEv.receivedAt - t0,
      msToDeskBusy: busyAt - t0,
      msToReply: tReply - t0,
      msToRunFinishedEvent: finishEv.receivedAt - t0,
      msToDeskIdle: tIdle - t0,
      officeStreamEvents: office.events.filter((e) => e.receivedAt >= t0).map((e) => e.eventType),
      chatStreamEvents: chatEvents,
    };
  }, 120_000);

  it("manual routine run -> agent run starts quickly (plan 0.4)", async () => {
    const n = Number(process.env.STARNET_E2E_ROUTINE_RUNS ?? 3);
    const lat = [];
    for (let i = 0; i < n; i++) {
      await waitFor(async () => (await api.get(`/agents/${s.nocAgentId}`)).status === "idle", { what: "NOC idle", timeoutMs: 60_000 });
      await sleep(300);
      const t0 = Date.now();
      const run = await api.action(pid("starnet.pack-isp"), "run-daily-check", s.companyId);
      expect(run.linkedIssueId ?? run.status).toBeTruthy();
      const ev = await waitFor(() => office.events.find((e) => e.receivedAt >= t0 && e.agentId === s.nocAgentId && e.eventType === "agent.run.started"), { what: "routine run started", timeoutMs: 60_000 });
      lat.push(ev.receivedAt - t0);
      await waitFor(() => office.events.find((e) => e.receivedAt >= t0 && e.agentId === s.nocAgentId && e.eventType === "agent.run.finished"), { what: "routine run finished", timeoutMs: 60_000 });
    }
    const sorted = [...lat].sort((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)];
    report.routineLatencyMs = { runs: lat, p95 };
    expect(p95).toBeLessThanOrEqual(15_000);
  }, 300_000);
});
