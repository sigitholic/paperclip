import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import { gatewayRisk } from "@starnet/pack-kit";
import manifest, { PLUGIN_ID, TOOLS } from "../src/manifest.js";
import plugin from "../src/worker.js";

type Result = { content?: string; data?: any; error?: string };
const COMPANY = "company-1";

async function harness(config: Record<string, unknown> = {}) {
  const h = createTestHarness({ manifest, config });
  await plugin.definition.setup(h.ctx);
  return h;
}

describe("manifest", () => {
  it("declares only read-classified tools (gateway name heuristic)", () => {
    for (const t of TOOLS) expect(gatewayRisk(`${PLUGIN_ID}:${t.name}`)).toBe("read");
  });
  it("routine targets the managed NOC agent daily at 07:00 Asia/Jakarta", () => {
    const r = manifest.routines![0]!;
    expect(r.assigneeRef).toEqual({ resourceKind: "agent", resourceKey: "noc-engineer" });
    expect(r.triggers![0]).toMatchObject({ cronExpression: "0 7 * * *", timezone: "Asia/Jakarta" });
  });
});

describe("mock mode (no host configured)", () => {
  it("returns labeled fixture data and records the widget snapshot", async () => {
    const h = await harness();
    const run = { companyId: COMPANY };
    const pppoe = await h.executeTool<Result>("mikrotik.list_pppoe_active", { limit: 3 }, run);
    const res = await h.executeTool<Result>("mikrotik.system_resource", {}, run);
    const cpe = await h.executeTool<Result>("genieacs.list_devices", {}, run);
    for (const r of [pppoe, res, cpe]) {
      expect(r.content).toMatch(/^\[MOCK DATA/);
      expect(r.data.mode).toBe("mock");
    }
    expect(pppoe.data.sessions).toHaveLength(3);
    expect(pppoe.data.total).toBe(137);
    expect(cpe.data).toMatchObject({ total: 40, online: 36 });

    const dev = await h.executeTool<Result>("genieacs.device_status", { deviceId: cpe.data.devices[7].id }, run);
    expect(dev.data.device.online).toBe(false);

    const last = await h.getData<any>("last-check", { companyId: COMPANY });
    expect(last).toMatchObject({ pppoe: { active: 137 }, router: { cpuLoadPct: 23 }, cpe: { online: 36, total: 40 } });
    expect(last.checkedAt).toBeTypeOf("string");
  });

  it("reports missing deviceId as a tool error", async () => {
    const h = await harness();
    const r = await h.executeTool<Result>("genieacs.device_status", {}, { companyId: COMPANY });
    expect(r.error).toMatch(/deviceId is required/);
  });
});

describe("live mode against a fake RouterOS REST + GenieACS NBI", () => {
  const seen: IncomingMessage[] = [];
  let base = "";
  const server = createServer((req, res) => {
    seen.push(req);
    const url = new URL(req.url!, "http://x");
    const body =
      url.pathname === "/rest/ppp/active" ? [{ name: "a@isp", service: "pppoe", address: "100.64.0.2", "caller-id": "AA", uptime: "1h" }, { name: "l2tp", service: "l2tp" }]
      : url.pathname === "/rest/system/resource" ? { "cpu-load": "91", "total-memory": "1073741824", "free-memory": "107374182", uptime: "3d", version: "7.16", "board-name": "RB5009" }
      : url.pathname === "/devices/" ? [{ _id: "DEV1", _lastInform: new Date().toISOString(), _deviceId: { _SerialNumber: "S1", _ProductClass: "HG8245" } }]
      : undefined;
    if (req.headers.authorization === `Basic ${Buffer.from("slow:").toString("base64")}`) return; // never answers
    if (body === undefined) { res.statusCode = 404; res.end(); return; }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(body));
  });
  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => { server.closeAllConnections(); server.close(); });

  it("calls /rest/ppp/active and /rest/system/resource with basic auth from a secret ref", async () => {
    const [host, port] = base.split(":");
    const h = await harness({ mikrotikHost: host, mikrotikPort: Number(port), mikrotikUseTls: false, mikrotikUsername: "noc", mikrotikPassword: { type: "secret_ref", secretId: "s1" } });
    const pppoe = await h.executeTool<Result>("mikrotik.list_pppoe_active", {}, { companyId: COMPANY });
    expect(pppoe.data).toMatchObject({ mode: "live", total: 1 });
    expect(pppoe.content).not.toMatch(/MOCK/);
    const res = await h.executeTool<Result>("mikrotik.system_resource", {}, { companyId: COMPANY });
    expect(res.data.resource).toMatchObject({ cpuLoadPct: 91, memUsedPct: 90, totalMemoryMb: 1024 });
    expect(seen.at(-1)!.headers.authorization).toMatch(/^Basic /);
  });

  it("queries GenieACS NBI /devices with a projection", async () => {
    const h = await harness({ genieacsBaseUrl: `http://${base}/` });
    const cpe = await h.executeTool<Result>("genieacs.list_devices", {}, { companyId: COMPANY });
    expect(cpe.data).toMatchObject({ mode: "live", total: 1, online: 1 });
    expect(seen.at(-1)!.url).toMatch(/^\/devices\/\?query=%7B%7D&projection=_id,_lastInform/);
  });

  it("times out without leaking credentials", async () => {
    const [host, port] = base.split(":");
    const h = await harness({ mikrotikHost: host, mikrotikPort: Number(port), mikrotikUseTls: false, mikrotikUsername: "slow", timeoutMs: 200 });
    const r = await h.executeTool<Result>("mikrotik.list_pppoe_active", {}, { companyId: COMPANY });
    expect(r.error).toMatch(/timeout after 200ms/);
    expect(r.error).not.toMatch(/Basic|slow/);
  });
});
