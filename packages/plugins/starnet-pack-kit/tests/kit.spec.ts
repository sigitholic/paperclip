import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { assertGatewayRisk, fetchJson, gatewayRisk, packResult, serialByKey } from "../src/index.js";

describe("fetchJson", () => {
  it("POSTs a JSON body and keeps credentials out of errors", async () => {
    const seen: Array<{ method?: string; type?: string; body: string }> = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push({ method: req.method, type: req.headers["content-type"], body });
        res.statusCode = req.url?.startsWith("/fail") ? 403 : 200;
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      expect(await fetchJson(`${base}/rpc`, { method: "POST", body: { method: "x" } })).toEqual({ ok: true });
      expect(seen[0]).toEqual({ method: "POST", type: "application/json", body: '{"method":"x"}' });
      await fetchJson(`${base}/get`);
      expect(seen[1]).toMatchObject({ method: "GET", body: "" });
      await expect(fetchJson(`${base}/fail?token=s3cret`, { method: "POST", headers: { authorization: "Bearer s3cret" } })).rejects.toThrow(
        new RegExp(`^POST ${base}/fail failed: HTTP 403$`),
      );
    } finally {
      server.close();
    }
  });
});

describe("gatewayRisk", () => {
  it("matches the gateway heuristic for read, write and destructive names", () => {
    expect(gatewayRisk("starnet.pack-isp:mikrotik.list_pppoe_active")).toBe("read");
    expect(gatewayRisk("mikrotik.apply_reboot")).toBe("write");
    expect(gatewayRisk("mikrotik.delete_pppoe_secret")).toBe("destructive");
    // the trap: operational verbs the heuristic does not know
    expect(gatewayRisk("mikrotik.reboot")).toBe("read");
    expect(() => assertGatewayRisk("olt.disable_port", "write")).toThrow(/classified "read"/);
  });
});

describe("packResult", () => {
  it("labels mock output", () => {
    const r = packResult("mock", "mikrotik", "3 sessions", { count: 3 });
    expect(r.content).toMatch(/^\[MOCK DATA/);
    expect(r.data).toMatchObject({ mode: "mock", source: "mikrotik", count: 3 });
    expect(packResult("live", "mikrotik", "3 sessions", {}).content).toBe("mikrotik: 3 sessions");
  });
});

describe("serialByKey", () => {
  it("runs work for the same key one at a time, even after a failure", async () => {
    const run = serialByKey();
    const order: string[] = [];
    const slow = (tag: string, ms: number) => async () => { order.push(`${tag}:start`); await new Promise((r) => setTimeout(r, ms)); order.push(`${tag}:end`); };
    const failing = run("c1", async () => { throw new Error("boom"); });
    await Promise.all([run("c1", slow("a", 20)), run("c1", slow("b", 1)), failing.catch(() => undefined)]);
    expect(order).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });
});
