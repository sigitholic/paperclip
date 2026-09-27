import { describe, expect, it } from "vitest";
import { assertGatewayRisk, gatewayRisk, packResult, serialByKey } from "../src/index.js";

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
