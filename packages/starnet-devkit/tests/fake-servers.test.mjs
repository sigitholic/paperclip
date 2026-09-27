import { afterAll, describe, expect, it } from "vitest";
import { startFakeGenieACS } from "../fake/genieacs.mjs";
import { startFakeRouterOS } from "../fake/routeros.mjs";
import { guardEnv } from "../lib/env.mjs";

const basic = (u, p) => ({ authorization: `Basic ${Buffer.from(`${u}:${p}`).toString("base64")}` });

describe("fake RouterOS", async () => {
  const ros = await startFakeRouterOS({ port: 0, password: "pw-test" });
  afterAll(() => ros.close());
  it("rejects bad credentials and records the attempt without secrets", async () => {
    const res = await fetch(`${ros.url}/rest/ppp/active`, { headers: basic("noc-ro", "wrong") });
    expect(res.status).toBe(401);
    expect(ros.requests.at(-1)).toMatchObject({ path: "/rest/ppp/active", auth: false });
    expect(JSON.stringify(ros.requests)).not.toContain("pw-test");
  });
  it("serves PPP active + system resource in RouterOS v7 REST shape", async () => {
    const ppp = await (await fetch(`${ros.url}/rest/ppp/active`, { headers: basic("noc-ro", "pw-test") })).json();
    expect(ppp.filter((s) => s.service === "pppoe")).toHaveLength(3);
    const res = await (await fetch(`${ros.url}/rest/system/resource`, { headers: basic("noc-ro", "pw-test") })).json();
    expect(res).toMatchObject({ "board-name": "FAKE-CCR2004", "cpu-load": "31" });
    expect((await fetch(`${ros.url}/rest/nope`, { headers: basic("noc-ro", "pw-test") })).status).toBe(404);
  });
});

describe("fake GenieACS", async () => {
  const acs = await startFakeGenieACS({ port: 0 });
  afterAll(() => acs.close());
  it("lists devices with 8/10 online and filters by _id", async () => {
    const all = await (await fetch(`${acs.url}/devices/?query=${encodeURIComponent("{}")}&projection=_id,_lastInform`)).json();
    expect(all).toHaveLength(10);
    const fresh = all.filter((d) => Date.now() - Date.parse(d._lastInform) <= 15 * 60_000);
    expect(fresh).toHaveLength(8);
    const one = await (await fetch(`${acs.url}/devices/?query=${encodeURIComponent(JSON.stringify({ _id: all[9]._id }))}`)).json();
    expect(one.map((d) => d._id)).toEqual([all[9]._id]);
  });
});

describe("guardEnv", () => {
  it("drops DATABASE_URL and refuses non-local instances", () => {
    process.env.DATABASE_URL = "postgres://should-not-leak";
    process.env.PAPERCLIP_URL = "http://127.0.0.1:3100";
    expect(guardEnv().base).toBe("http://127.0.0.1:3100");
    expect(process.env.DATABASE_URL).toBeUndefined();
    process.env.PAPERCLIP_URL = "https://prod.example.com";
    expect(() => guardEnv()).toThrow(/refuses non-local/);
    delete process.env.PAPERCLIP_URL;
  });
});
