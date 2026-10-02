import net from "node:net";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeLength, encodeSentence, routerOsQuery, SentenceDecoder } from "../src/routeros-api.js";
import { listPppoeActive, mikrotikEndpoint, systemResource } from "../src/sources.js";

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
    expect(pppoe).toEqual({ mode: "live", sessions: [{ name: "pelanggan-01", address: "10.10.0.2", callerId: "AA:BB:CC:00:00:01", uptime: "1d2h", service: "pppoe" }] });
    const res = await systemResource(config(), secret);
    expect(res.resource).toEqual({ cpuLoadPct: 12, memUsedPct: 50, totalMemoryMb: 1024, uptime: "3w", version: "7.16", board: "CCR2004" });
    expect(commands).toContain("/system/resource/print");
  });

  it("picks the protocol and TLS mode from the well-known ports", () => {
    expect(mikrotikEndpoint({ mikrotikPort: 8728, mikrotikUseTls: true })).toEqual({ protocol: "api", port: 8728, tls: false });
    expect(mikrotikEndpoint({ mikrotikPort: 8729 })).toEqual({ protocol: "api", port: 8729, tls: true });
    expect(mikrotikEndpoint({ mikrotikProtocol: "api" })).toEqual({ protocol: "api", port: 8728, tls: false });
    expect(mikrotikEndpoint({})).toEqual({ protocol: "rest", port: 443, tls: true });
    expect(mikrotikEndpoint({ mikrotikPort: 8080, mikrotikUseTls: false })).toEqual({ protocol: "rest", port: 8080, tls: false });
  });
});
