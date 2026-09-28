import { describe, expect, it } from "vitest";
import { isGreeting, keywordRouter, pickDefaultAgent, stripFillers, type RoutableAgent } from "../src/router.js";

const agents: RoutableAgent[] = [
  { id: "noc", name: "NOC Engineer", title: "NOC Engineer (Starnet ISP pack)", role: "engineer", capabilities: "Monitors PPPoE sessions, router health and CPE status" },
  { id: "fin", name: "Finance Officer", title: "Billing & invoices", role: "general", capabilities: null },
  { id: "ceo", name: "CEO", title: null, role: "ceo", capabilities: "Strategy" },
];

describe("keywordRouter", () => {
  it("routes network requests to the NOC agent", async () => {
    const d = await keywordRouter({ text: "cek PPPoE aktif di router", agents });
    expect(d).toMatchObject({ kind: "task", agentId: "noc", title: "Cek PPPoE aktif di router" });
    if (d.kind === "task") expect(d.reason).toMatch(/pppoe/);
  });
  it("routes billing words to finance", async () => {
    expect(await keywordRouter({ text: "tolong rekap tagihan bulan ini", agents })).toMatchObject({ kind: "task", agentId: "fin" });
  });
  it("honours explicit @mentions (name or slug) and strips them from the title", async () => {
    expect(await keywordRouter({ text: "@CEO buat rencana Q4", agents })).toMatchObject({ kind: "task", agentId: "ceo", title: "Buat rencana Q4" });
    expect(await keywordRouter({ text: "@noc-engineer ping core switch", agents })).toMatchObject({ kind: "task", agentId: "noc" });
    expect(await keywordRouter({ text: "@NOC Engineer tolong lihat log", agents })).toMatchObject({ kind: "task", agentId: "noc", title: "Tolong lihat log" });
  });
  it("does not create tasks for small talk or unroutable requests", async () => {
    expect(await keywordRouter({ text: "selamat pagi semua", agents })).toMatchObject({ kind: "reply" });
    const d = await keywordRouter({ text: "tolong pesankan kopi", agents });
    expect(d.kind).toBe("reply");
    if (d.kind === "reply") expect(d.text).toMatch(/belum tahu agen/);
  });
});

describe("default agent for free-form chat", () => {
  const withLlm: RoutableAgent[] = [
    { id: "noc", name: "NOC Engineer", title: "NOC Engineer", role: "engineer", capabilities: "PPPoE and router monitoring", adapterType: "process" },
    { id: "dev", name: "Diag Codex", title: "Probe", role: "engineer", capabilities: null, adapterType: "codex_local" },
    { id: "boss", name: "Kepala Kantor", title: "Kepala kantor", role: "ceo", capabilities: null, adapterType: "codex_local" },
  ];

  it("prefers the CEO, then a chief-like title, then any LLM agent; never a process agent", () => {
    expect(pickDefaultAgent(withLlm)?.id).toBe("boss");
    expect(pickDefaultAgent(withLlm.filter((a) => a.id !== "boss"))?.id).toBe("dev");
    expect(pickDefaultAgent(withLlm.filter((a) => a.adapterType === "process"))).toBeUndefined();
  });
  it("sends unmatched requests to the default agent instead of a canned reply", async () => {
    const d = await keywordRouter({ text: "oke buat beberapa agent untuk operasional kantor ISP", agents: withLlm });
    expect(d).toMatchObject({ kind: "task", agentId: "boss", title: "Buat beberapa agent untuk operasional kantor ISP" });
  });
  it("still routes domain keywords to the specialist", async () => {
    expect(await keywordRouter({ text: "bro cek PPPoE aktif di router", agents: withLlm })).toMatchObject({ kind: "task", agentId: "noc", title: "Cek PPPoE aktif di router" });
  });
  it("answers greetings directly and lists the active agents", async () => {
    const d = await keywordRouter({ text: "selamat siang", agents: withLlm });
    expect(d.kind).toBe("reply");
    if (d.kind === "reply") expect(d.text).toContain("Kepala Kantor");
  });
  it("strips conversational fillers and recognises greetings", () => {
    expect(stripFillers("oke bro, tolong cek router")).toBe("tolong cek router");
    expect(isGreeting("halo bro apa kabar?")).toBe(true);
    expect(isGreeting("halo tolong rekap semua tagihan pelanggan bulan ini ya")).toBe(false);
  });
});
