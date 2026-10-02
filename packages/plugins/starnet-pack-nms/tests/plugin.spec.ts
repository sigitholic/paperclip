import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Company, PluginWebhookInput } from "@paperclipai/plugin-sdk";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import { gatewayRisk } from "@starnet/pack-kit";
import { ALERT_ORIGIN_KIND, parseAlert, signBody } from "../src/alerts.js";
import manifest, { PLUGIN_ID, TOOLS } from "../src/manifest.js";
import plugin, { receiveAlerts } from "../src/worker.js";

type Result = { content?: string; data?: any; error?: string };
const COMPANY = "company-1";
const SECRET = "resolved:wh";

async function harness(config: Record<string, unknown> = {}) {
  const h = createTestHarness({ manifest, config });
  h.seed({ companies: [{ id: COMPANY, name: "STAA" } as Company] });
  Object.assign(h.ctx.secrets, { resolve: async (ref: { secretId: string }) => `resolved:${ref.secretId}` });
  await plugin.definition.setup(h.ctx);
  return h;
}

describe("manifest", () => {
  it("declares only read-classified tools (gateway name heuristic)", () => {
    for (const t of TOOLS) expect(gatewayRisk(`${PLUGIN_ID}:${t.name}`)).toBe("read");
  });
  it("declares the alerts webhook", () => {
    expect(manifest.capabilities).toContain("webhooks.receive");
    expect(manifest.webhooks?.map((w) => w.endpointKey)).toEqual(["alerts"]);
  });
});

describe("mock mode (no source configured)", () => {
  it("returns labeled fixture problems filtered by severity", async () => {
    const h = await harness();
    const r = await h.executeTool<Result>("nms.list_problems", { minSeverity: "average" }, { companyId: COMPANY });
    expect(r.content).toMatch(/^\[MOCK DATA/);
    expect(r.data.problems.map((p: any) => p.severity)).toEqual(["high", "average"]);
    expect(r.data.total).toBe(2);
  });
  it("filters hosts by onlyDown", async () => {
    const h = await harness();
    const r = await h.executeTool<Result>("nms.host_status", { onlyDown: true }, { companyId: COMPANY });
    expect(r.data.hosts.map((x: any) => x.name)).toEqual(["AP-Tower-2"]);
    expect(r.data.down).toBe(1);
  });
});

describe("live mode against fake Zabbix + LibreNMS", () => {
  const seen: Array<{ req: IncomingMessage; body: string }> = [];
  let base = "";
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ req, body });
      const url = new URL(req.url!, "http://x");
      const json = (v: unknown) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(v)); };
      if (url.pathname === "/zabbix/api_jsonrpc.php") {
        if (req.headers.authorization !== "Bearer resolved:ztok") return json({ jsonrpc: "2.0", error: { message: "Not authorized." }, id: 1 });
        const { method } = JSON.parse(body);
        if (method === "trigger.get") return json({ jsonrpc: "2.0", result: [{ triggerid: "77", description: "OLT down", priority: "5", lastchange: "1700000000", hosts: [{ name: "OLT-1" }] }], id: 1 });
        if (method === "host.get")
          return json({ jsonrpc: "2.0", result: [
            { hostid: "1", name: "OLT-1", status: "0", interfaces: [{ ip: "10.0.0.2", available: "2", main: "1" }] },
            { hostid: "2", name: "BRAS", status: "0", interfaces: [{ ip: "10.0.0.1", available: "1", main: "1" }] },
          ], id: 1 });
      }
      if (url.pathname.startsWith("/api/v0/")) {
        if (req.headers["x-auth-token"] !== "resolved:ltok") { res.statusCode = 401; return res.end(); }
        if (url.pathname === "/api/v0/alerts") return json({ alerts: [{ id: 5, device_id: 9, rule_id: 3, severity: "critical", timestamp: "2026-10-01 10:00:00" }] });
        if (url.pathname === "/api/v0/rules") return json({ rules: [{ id: 3, name: "Port down" }] });
        if (url.pathname === "/api/v0/devices") return json({ devices: [{ device_id: 9, hostname: "sw-9", ip: "10.0.9.1", status: 0, disabled: 0 }] });
      }
      res.statusCode = 404;
      res.end();
    });
  });
  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => { server.closeAllConnections(); server.close(); });

  const config = () => ({
    nmsSources: [
      { name: "zbx", kind: "zabbix", baseUrl: `${base}/zabbix/`, token: { type: "secret_ref", secretId: "ztok" } },
      { name: "lnms", kind: "librenms", baseUrl: base, token: { type: "secret_ref", secretId: "ltok" } },
    ],
  });

  it("merges problems from both sources, highest severity first", async () => {
    const h = await harness(config());
    const r = await h.executeTool<Result>("nms.list_problems", {}, { companyId: COMPANY });
    expect(r.content).not.toMatch(/MOCK/);
    expect(r.data.problems).toEqual([
      { source: "zbx", id: "77", host: "OLT-1", name: "OLT down", severity: "disaster", since: "2023-11-14T22:13:20.000Z" },
      expect.objectContaining({ source: "lnms", id: "5", host: "sw-9", name: "Port down", severity: "high" }),
    ]);
    const rpc = seen.find((x) => x.req.url === "/zabbix/api_jsonrpc.php")!;
    expect(rpc.req.method).toBe("POST");
    expect(JSON.parse(rpc.body)).toMatchObject({ jsonrpc: "2.0", method: "trigger.get", params: { filter: { value: 1 } } });
  });

  it("reports host status per source and filters by query", async () => {
    const h = await harness(config());
    const r = await h.executeTool<Result>("nms.host_status", { query: "olt" }, { companyId: COMPANY });
    expect(r.data).toMatchObject({ total: 3, down: 2, hosts: [{ name: "OLT-1", status: "down", address: "10.0.0.2" }] });
  });

  it("keeps working when one source fails and names it", async () => {
    const cfg = config();
    cfg.nmsSources[1]!.token = { type: "secret_ref", secretId: "wrong" };
    const h = await harness(cfg);
    const r = await h.executeTool<Result>("nms.list_problems", {}, { companyId: COMPANY });
    expect(r.data.total).toBe(1);
    expect(r.content).toMatch(/lnms UNREACHABLE \(GET .*\/api\/v0\/alerts failed: HTTP 401\)/);
    expect(r.content).not.toMatch(/resolved:/);
  });

  it("surfaces a Zabbix JSON-RPC error", async () => {
    const h = await harness({ nmsSources: [{ name: "zbx", kind: "zabbix", baseUrl: `${base}/zabbix`, token: { type: "secret_ref", secretId: "bad" } }] });
    const r = await h.executeTool<Result>("nms.host_status", {}, { companyId: COMPANY });
    expect(r.error).toMatch(/Zabbix host\.get: Not authorized/);
  });

  it("test-connections returns one result per source", async () => {
    const h = await harness(config());
    const out = await h.performAction<any>("test-connections", { companyId: COMPANY });
    expect(out.sources).toEqual([
      { name: "zbx", ok: true, summary: "2 host" },
      { name: "lnms", ok: true, summary: "1 host" },
    ]);
  });
});

describe("alert webhook", () => {
  const cfg = { webhookToken: { type: "secret_ref", secretId: "wh" }, alertAssigneeAgentId: "agent-noc", maxNewIssuesPerHour: 3 };
  const alert = (over: Record<string, unknown> = {}) => ({ source: "zabbix", eventId: "100", status: "problem", severity: "4", host: "OLT-1", name: "PON down", ...over });
  const deliver = (h: Awaited<ReturnType<typeof harness>>, body: unknown, headers: Record<string, string> = {}) => {
    const rawBody = JSON.stringify(body);
    const input: PluginWebhookInput = {
      endpointKey: "alerts",
      headers: { "x-starnet-company": COMPANY, "x-starnet-signature": signBody(SECRET, rawBody), ...headers },
      rawBody,
      parsedBody: body,
      requestId: "req-1",
    };
    return receiveAlerts(h.ctx, input);
  };
  const alertIssues = (h: Awaited<ReturnType<typeof harness>>) => h.ctx.issues.list({ companyId: COMPANY, originKind: ALERT_ORIGIN_KIND });

  it("rejects missing, wrong and unconfigured credentials", async () => {
    const h = await harness(cfg);
    await expect(deliver(h, alert(), { "x-starnet-signature": "sha256=00" })).rejects.toThrow(/invalid webhook signature/);
    const noSig = { endpointKey: "alerts", headers: { "x-starnet-company": COMPANY }, rawBody: "{}", requestId: "r" };
    await expect(receiveAlerts(h.ctx, noSig)).rejects.toThrow(/headers are required/);
    await expect(deliver(h, alert(), { "x-starnet-company": "other" })).rejects.toThrow(/unknown company or NMS pack not configured/);
    const off = await harness({});
    await expect(deliver(off, alert())).rejects.toThrow(/not enabled/);
    expect(await alertIssues(h)).toHaveLength(0);
  });

  it("accepts the plain token header (LibreNMS) but checks it", async () => {
    const h = await harness(cfg);
    const headers = (token: string) => ({ "x-starnet-company": COMPANY, "x-starnet-token": token });
    const input = (token: string): PluginWebhookInput => ({ endpointKey: "alerts", headers: headers(token), rawBody: JSON.stringify(alert()), requestId: "r" });
    await expect(receiveAlerts(h.ctx, input("nope"))).rejects.toThrow(/invalid webhook token/);
    expect((await receiveAlerts(h.ctx, input(SECRET))).created).toBe(1);
  });

  it("creates one issue per event, dedupes, and closes it on recovery", async () => {
    const h = await harness(cfg);
    expect(await deliver(h, alert())).toMatchObject({ created: 1 });
    expect(await deliver(h, alert())).toMatchObject({ duplicate: 1 });
    const [issue] = await alertIssues(h);
    expect(issue).toMatchObject({ title: "[HIGH] OLT-1: PON down", priority: "high", status: "todo", assigneeAgentId: "agent-noc", originId: "zabbix:100" });

    expect(await deliver(h, alert({ status: "resolved" }))).toMatchObject({ resolved: 1 });
    expect((await alertIssues(h))[0]!.status).toBe("done");
    expect(await deliver(h, alert({ status: "resolved" }))).toMatchObject({ unknown_resolved: 1 });

    // LibreNMS reuses ids per device+rule: a re-fire after recovery opens a new issue.
    expect(await deliver(h, alert())).toMatchObject({ created: 1 });
    expect(await alertIssues(h)).toHaveLength(2);
  });

  it("drops alerts below the minimum severity and caps new issues per hour", async () => {
    const h = await harness(cfg);
    expect(await deliver(h, alert({ severity: "info" }))).toMatchObject({ ignored_severity: 1 });
    const batch = [1, 2, 3, 4, 5].map((i) => alert({ eventId: String(i) }));
    expect(await deliver(h, [...batch, { nonsense: true }])).toMatchObject({ created: 3, suppressed_rate: 2, invalid: 1 });
    expect(await h.getData<any>("alert-summary", { companyId: COMPANY })).toMatchObject({ open: 3, counts: { high: 3 }, suppressedThisHour: 2 });
  });

  it("parses Zabbix and LibreNMS spellings", () => {
    expect(parseAlert({ source: "librenms", eventId: "9-3", status: "0", severity: "critical", host: "sw-9", name: "Port down" })).toMatchObject({ status: "resolved", severity: "high" });
    expect(parseAlert({ source: "librenms", eventId: "9-3", status: "3", severity: "warning", host: "sw-9" })).toMatchObject({ status: "problem", severity: "warning" });
    expect(parseAlert(alert({ severity: "5", url: "javascript:alert(1)" }))).toMatchObject({ severity: "disaster", url: null });
    expect(() => parseAlert(alert({ status: "maybe" }))).toThrow(/not problem\/resolved/);
    expect(() => parseAlert([alert()])).toThrow(/JSON object/);
  });
});
