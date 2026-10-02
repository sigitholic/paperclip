import net from "node:net";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeLength, encodeSentence, routerOsQuery, SentenceDecoder } from "../src/routeros-api.js";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";
import { listPppoeActive, mikrotikEndpoint, mikrotikRouters, systemResource } from "../src/sources.js";

const USER = "noc-ro";
const PASS = "s3cret";
const commands: string[] = [];

// Fake RouterOS API: >= 6.43 login, read-only print commands.
const server = net.createServer((socket) => {
  const decoder = new SentenceDecoder();
  let authed = false;
  socket.on("data", (chunk) => {
    for (const [cmd, ...args] of decoder.push(chunk)) {
      commands.push(cmd!);
      const send = (...words: string[]) => socket.write(encodeSentence(words));
      if (cmd === "/login") {
        authed = args.includes(`=name=${USER}`) && args.includes(`=password=${PASS}`);
        if (authed) send("!done");
        else { send("!trap", "=message=invalid user name or password (6)"); send("!done"); }
      } else if (!authed) {
        send("!fatal", "not logged in");
      } else if (cmd === "/ppp/active/print") {
        send("!re", "=.id=*1", "=name=pelanggan-01", "=service=pppoe", "=caller-id=AA:BB:CC:00:00:01", "=address=10.10.0.2", "=uptime=1d2h");
        send("!re", "=.id=*2", "=name=l2tp-x", "=service=l2tp", "=address=10.20.0.2", "=uptime=5m");
        send("!done");
      } else if (cmd === "/system/resource/print") {
        send("!re", "=cpu-load=12", "=total-memory=1073741824", "=free-memory=536870912", "=uptime=3w", "=version=7.16", "=board-name=CCR2004");
        send("!done");
      } else {
        send("!trap", "=message=no such command");
        send("!done");
      }
    }
  });
});
let port = 0;
beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const api = { host: "127.0.0.1", tls: false, username: USER, password: PASS, timeoutMs: 2000 };
const secret = async () => PASS;

describe("RouterOS API protocol", () => {
  it("encodes word lengths across the 1-5 byte forms and decodes split chunks", () => {
    expect([...encodeLength(0x7f)]).toEqual([0x7f]);
    expect([...encodeLength(0x80)]).toEqual([0x80, 0x80]);
    expect([...encodeLength(0x4000)]).toEqual([0xc0, 0x40, 0x00]);
    expect([...encodeLength(0x200000)]).toEqual([0xe0, 0x20, 0x00, 0x00]);
    const long = "x".repeat(300);
    const bytes = encodeSentence(["!re", `=comment=${long}`]);
    const d = new SentenceDecoder();
    expect(d.push(bytes.subarray(0, 5))).toEqual([]);
    expect(d.push(bytes.subarray(5))).toEqual([["!re", `=comment=${long}`]]);
  });

  it("logs in and returns print rows", async () => {
    const [rows] = await routerOsQuery({ ...api, port }, ["/ppp/active/print"]);
    expect(rows).toHaveLength(2);
    expect(rows![0]).toMatchObject({ name: "pelanggan-01", "caller-id": "AA:BB:CC:00:00:01" });
  });

  it("reports a wrong password clearly", async () => {
    await expect(routerOsQuery({ ...api, port, password: "nope" }, ["/system/resource/print"])).rejects.toThrow(/login failed/);
  });

  it("surfaces a refused connection", async () => {
    await expect(routerOsQuery({ ...api, port: 1 }, ["/system/resource/print"])).rejects.toThrow(/RouterOS API 127\.0\.0\.1:1/);
  });
});

describe("pack tools over the RouterOS API", () => {
  const config = () => ({ mikrotikHost: "127.0.0.1", mikrotikProtocol: "api" as const, mikrotikPort: port, mikrotikUsername: USER, mikrotikPassword: { type: "secret_ref", secretId: "s" }, timeoutMs: 2000 });

  it("maps PPPoE sessions and router resources like the REST path", async () => {
    const pppoe = await listPppoeActive(config(), secret);
    expect(pppoe.mode).toBe("live");
    expect(pppoe.sessions).toEqual([{ router: "default", name: "pelanggan-01", address: "10.10.0.2", callerId: "AA:BB:CC:00:00:01", uptime: "1d2h", service: "pppoe" }]);
    const res = await systemResource(config(), secret);
    expect(res.routers).toEqual([
      { router: "default", host: "127.0.0.1", ok: true, value: { cpuLoadPct: 12, memUsedPct: 50, totalMemoryMb: 1024, uptime: "3w", version: "7.16", board: "CCR2004" } },
    ]);
    expect(commands).toContain("/system/resource/print");
  });

  it("picks the protocol and TLS mode from the well-known ports", () => {
    expect(mikrotikEndpoint({ port: 8728, useTls: true })).toEqual({ protocol: "api", port: 8728, tls: false });
    expect(mikrotikEndpoint({ port: 8729 })).toEqual({ protocol: "api", port: 8729, tls: true });
    expect(mikrotikEndpoint({ protocol: "api" })).toEqual({ protocol: "api", port: 8728, tls: false });
    expect(mikrotikEndpoint({})).toEqual({ protocol: "rest", port: 443, tls: true });
    expect(mikrotikEndpoint({ port: 8080, useTls: false })).toEqual({ protocol: "rest", port: 8080, tls: false });
  });
});

describe("multiple MikroTik routers", () => {
  const ref = (secretId: string) => ({ type: "secret_ref", secretId });
  const fleet = () => ({
    ...{ mikrotikHost: "127.0.0.1", mikrotikPort: port, mikrotikProtocol: "api" as const, mikrotikUsername: USER, mikrotikPassword: ref("main") },
    mikrotikRouters: [
      { name: "bras-2", host: "127.0.0.1", port, protocol: "api" as const, username: USER, password: ref("bras") },
      { name: "dead", host: "127.0.0.1", port: 1, protocol: "api" as const, username: USER, password: ref("dead") },
      { name: "no-host" },
    ],
    timeoutMs: 2000,
  });
  const paths: string[] = [];
  const recordingSecret = async (_ref: unknown, configPath: string) => {
    paths.push(configPath);
    return PASS;
  };

  it("lists the flat router as 'default' plus named routers with a host, and rejects duplicate names", () => {
    expect(mikrotikRouters(fleet()).map((r) => [r.name, r.passwordPath])).toEqual([
      ["default", "mikrotikPassword"],
      ["bras-2", "mikrotikRouters.0.password"],
      ["dead", "mikrotikRouters.1.password"],
    ]);
    expect(() => mikrotikRouters({ mikrotikRouters: [{ name: "a", host: "x" }, { name: "a", host: "y" }] })).toThrow(/duplicate/);
  });

  it("reads all routers, resolves each router's own secret, and reports the unreachable one", async () => {
    paths.length = 0;
    const pppoe = await listPppoeActive(fleet(), recordingSecret);
    expect(pppoe.sessions.map((s) => s.router)).toEqual(["default", "bras-2"]);
    expect(pppoe.routers.map((o) => [o.router, o.ok])).toEqual([["default", true], ["bras-2", true], ["dead", false]]);
    expect(paths.sort()).toEqual(["mikrotikPassword", "mikrotikRouters.0.password", "mikrotikRouters.1.password"]);
  });

  it("queries one router by name and rejects an unknown name", async () => {
    const res = await systemResource(fleet(), recordingSecret, "bras-2");
    expect(res.routers.map((o) => o.router)).toEqual(["bras-2"]);
    await expect(systemResource(fleet(), recordingSecret, "nope")).rejects.toThrow(/unknown router "nope"; configured: default, bras-2, dead/);
  });

  it("fails the tool only when every selected router is down", async () => {
    await expect(systemResource(fleet(), recordingSecret, "dead")).rejects.toThrow(/^dead: RouterOS API/);
  });

  it("tools report per-router results and keep the fleet snapshot for the widget", async () => {
    const h = createTestHarness({ manifest, config: fleet() });
    h.ctx.secrets.resolve = async () => PASS;
    await plugin.definition.setup(h.ctx);
    const run = { companyId: "company-1" };
    type R = { content: string; data: any };
    const routers = await h.executeTool<R>("mikrotik.list_routers", {}, run);
    expect(routers.data.routers.map((r: any) => `${r.name}:${r.protocol}`)).toEqual(["default:api", "bras-2:api", "dead:api"]);
    expect(JSON.stringify(routers.data)).not.toContain("secret");

    const pppoe = await h.executeTool<R>("mikrotik.list_pppoe_active", {}, run);
    expect(pppoe.data.total).toBe(2);
    expect(pppoe.content).toMatch(/default 1, bras-2 1/);
    expect(pppoe.content).toMatch(/dead UNREACHABLE/);

    const res = await h.executeTool<R>("mikrotik.system_resource", {}, run);
    expect(res.data.resource.board).toBe("CCR2004");
    expect(res.data.routers.filter((r: any) => !r.ok).map((r: any) => r.router)).toEqual(["dead"]);

    await h.executeTool<R>("mikrotik.system_resource", { router: "bras-2" }, run);
    const last = await h.getData<any>("last-check", { companyId: "company-1" });
    expect(last).toMatchObject({ pppoe: { active: 2 }, router: { total: 3, unreachable: ["dead"], cpuLoadPct: 12 } });
  });
});
