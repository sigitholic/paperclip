import { describe, expect, it } from "vitest";
import { keywordRouter, type RoutableAgent } from "../src/router.js";

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
